import {
	addProtocol,
	type ExpressionSpecification,
	type FilterSpecification,
	type Map as MaplibreMap,
	type VectorTileSource,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { type Area, showSpotPopup } from "#/components/spot-popup";

// The flat-ground layers on the map, from one PMTiles file per tent and
// season (see lib/map-data.ts; made by pipeline/flatness/src/bin/mapfiles.rs):
//
// - a smooth surface of scores, so the more spots for the tent, the greener
//   the area;
// - from zoom 14, the areas where the tent fits (neighbouring 10 m spots
//   merged into one shape) in orange, which stands out from both the green
//   and the topo map. The surface fades out as they appear.
//
// The files hold the data for every slope limit, so the controls only change
// what the map draws: no new downloads, instant.
//
// About the surface:
// The files hold one point per square (80 m at zoom 12, doubling with each
// zoom out) with how many of its cells are spots. A MapLibre heatmap blurs
// every point into its surroundings and adds the blurs up. Adding up is the
// catch: with the points this dense, the sum quickly saturates. But the
// points sit on a regular grid, so the sum can be normalised to an average:
//
//   - MapLibre's blur (heatmap kernel) is a Gaussian, 0.3989 · e^(−4.5 r²/R²)
//     for radius R. Summed over a grid with spacing d, the blurs add up to
//     about 0.28 · (R/d)² everywhere.
//   - With R = 2d, that is ≈ 1.1, so an intensity of 0.9 turns the sum back
//     into a weighted average of the nearby scores: an interpolated surface.
//   - This only holds if R/d stays the same at every zoom, see `radius` below.

// pmtiles:// URLs are read from a PMTiles file with HTTP range requests:
// just the bytes of each tile, from any static host or bucket.
addProtocol("pmtiles", new Protocol().tile);

const SOURCE = "flat";
const MIN_ZOOM = 5; // the files have zooms 5–16 (see mapfiles.rs)
const SQUARE_ZOOM = 12; // squares stop shrinking here: 80 m

// The slope limits the files have areas and counts for (LIMITS in
// mapfiles.rs), in degrees.
export const SLOPE_LIMITS = [1, 2, 3] as const;
export type SlopeLimit = (typeof SLOPE_LIMITS)[number];
export function isSlopeLimit(value: unknown): value is SlopeLimit {
	return SLOPE_LIMITS.includes(value as SlopeLimit);
}

// Colours, exported so the legend uses exactly the same ones.
// The surface: [score (see `score`), colour].
export const SCORE_COLOURS: [number, string][] = [
	[0.05, "#e5f5e0"],
	[0.15, "#a1d99b"],
	[0.3, "#41ab5d"],
	[0.5, "#006d2c"],
	[0.8, "#00441b"],
];
// The areas where the tent fits, when zoomed in.
export const AREA_COLOUR = "#f16913";
export const AREA_OUTLINE_COLOUR = "#a63603";

// Grid spacing in screen pixels at a whole zoom level, the same at every
// level because squares double in size as the map halves in scale:
// 80 m · 4096 · 512 px / 40 075 017 m ≈ 4.2 px, stretched by 1 / cos(lat) in
// Web Mercator, so ≈ 8.9 px at 62°N (Rondane, Dovre).
const SPACING_PX = 8.9;
const RADIUS_PX = 2 * SPACING_PX;

// Between whole zoom levels the map shows the tiles of the level below,
// scaled up by up to 2×, so the spacing grows with the zoom fraction and
// snaps back at the next level. The radius follows: R at each whole level,
// growing exponentially to 2R just before the next. From zoom 12 the squares
// stop shrinking (80 m), so the spacing, and the radius, simply double with
// every zoom level in.
function radius(): ExpressionSpecification {
	const stops: number[] = [];
	for (let z = MIN_ZOOM; z < SQUARE_ZOOM; z++) {
		stops.push(z, RADIUS_PX, z + 0.999, 2 * RADIUS_PX);
	}
	stops.push(SQUARE_ZOOM, RADIUS_PX, 22, RADIUS_PX * 2 ** (22 - SQUARE_ZOOM));
	return ["interpolate", ["exponential", 2], ["zoom"], ...stops];
}

// A square's score: the square root of the share of its cells that are spots
// at the limit (c1, c2, c3: spots at up to 1°, 2°, 3°; n: cells). A tent
// needs one spot, not a meadow, and the square root lifts squares with a few
// spots into view: 1 in 64 → 0.13, 6 → 0.31, a third → 0.58.
function score(maxSlope: SlopeLimit): ExpressionSpecification {
	return ["sqrt", ["/", ["get", `c${maxSlope}`], ["get", "n"]]];
}

// The areas at the limit, at least minArea m² (smaller ones are more often
// noise than a site).
function areasFilter(
	maxSlope: SlopeLimit,
	minArea: number,
): FilterSpecification {
	return [
		"all",
		["==", ["get", "limit"], maxSlope],
		[">=", ["get", "m2"], minArea],
	];
}

export type FlatFilter = {
	url: string; // the tent and season's file, as a pmtiles:// URL
	maxSlope: SlopeLimit;
	minArea: number; // m²
};

// Adds the layers the first time; afterwards points them at another file
// (tent or season changed) and redraws with the filter.
export function showFlat(
	map: MaplibreMap,
	{ url, maxSlope, minArea }: FlatFilter,
) {
	const source = map.getSource<VectorTileSource>(SOURCE);
	if (source) {
		if (source.url !== url) source.setUrl(url);
		map.setPaintProperty("flat-scores", "heatmap-weight", score(maxSlope));
		map.setFilter("flat-areas", areasFilter(maxSlope, minArea));
		map.setFilter("flat-area-outlines", areasFilter(maxSlope, minArea));
		return;
	}
	map.addSource(SOURCE, { type: "vector", url });
	map.addLayer({
		id: "flat-scores",
		type: "heatmap",
		source: SOURCE,
		"source-layer": "scores",
		// Faded out by then (see heatmap-opacity). A heatmap at opacity 0
		// still has every point blurred on each redraw; past maxzoom it's
		// skipped.
		maxzoom: 16,
		paint: {
			"heatmap-weight": score(maxSlope),
			"heatmap-radius": radius(),
			"heatmap-intensity": 0.9,
			"heatmap-opacity": [
				"interpolate",
				["linear"],
				["zoom"],
				// Gone once the areas are clear: the surface is blurred about
				// 160 m around each square, so close up it would spill onto
				// slopes next to the areas, where there are no spots.
				13.5,
				0.75,
				15,
				0.3,
				16,
				0,
			],
			// Density is now the interpolated score: transparent where there
			// are no spots, deeper green the more there are.
			"heatmap-color": [
				"interpolate",
				["linear"],
				["heatmap-density"],
				0,
				"rgba(0, 0, 0, 0)",
				...SCORE_COLOURS.flat(),
			],
		},
	});
	// Orange from the legend's swatch (AREA_COLOUR), outlined so that even a
	// lone 10 m spot, a couple of pixels at zoom 14, stands out.
	map.addLayer({
		id: "flat-areas",
		type: "fill",
		source: SOURCE,
		"source-layer": "areas",
		minzoom: 14,
		filter: areasFilter(maxSlope, minArea),
		paint: {
			"fill-color": AREA_COLOUR,
			"fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.3, 16, 0.45],
		},
	});
	map.addLayer({
		id: "flat-area-outlines",
		type: "line",
		source: SOURCE,
		"source-layer": "areas",
		minzoom: 14,
		filter: areasFilter(maxSlope, minArea),
		paint: {
			"line-color": AREA_OUTLINE_COLOUR,
			"line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 17, 2],
		},
	});

	// Click an area for links to check it's real before going: photos of
	// the ground at the clicked spot.
	map.on("click", "flat-areas", (event) => {
		const area = event.features?.[0]?.properties;
		if (area) {
			showSpotPopup(map, event.lngLat, area as Area);
		}
	});
	map.on("mouseenter", "flat-areas", () => {
		map.getCanvas().style.cursor = "pointer";
	});
	map.on("mouseleave", "flat-areas", () => {
		map.getCanvas().style.cursor = "";
	});
}

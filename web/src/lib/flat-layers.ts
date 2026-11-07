import {
	addProtocol,
	type ExpressionSpecification,
	type Map as MaplibreMap,
	type VectorTileSource,
} from "maplibre-gl";

// The flat-ground layers on the map, fed by our /tiles route:
//
// - a smooth surface of scores, so the more spots for the tent, the greener
//   the area;
// - from zoom 14, the areas where the tent fits (neighbouring 10 m spots
//   merged into one shape) in orange, which stands out from both the green
//   and the topo map. The surface fades out as they appear.
//
// About the surface:
// The tiles hold one point per bin (80 m at zoom 12, doubling with each zoom
// out) with that bin's score. A MapLibre heatmap blurs every point into its
// surroundings and adds the blurs up. Adding up is the catch: with the
// points this dense, the sum quickly saturates. But the points sit on a
// regular grid, so the sum can be normalised to an average:
//
//   - MapLibre's blur (heatmap kernel) is a Gaussian, 0.3989 · e^(−4.5 r²/R²)
//     for radius R. Summed over a grid with spacing d, the blurs add up to
//     about 0.28 · (R/d)² everywhere.
//   - With R = 2d, that is ≈ 1.1, so an intensity of 0.9 turns the sum back
//     into a weighted average of the nearby scores: an interpolated surface.
//   - This only holds if R/d stays the same at every zoom, see `radius` below.

const SOURCE = "flat";
const MIN_ZOOM = 5; // tiles exist for zooms 5–16 (see the tile route)
const MAX_BIN_ZOOM = 12; // bins stop shrinking here: 80 m
const MAX_ZOOM = 16;

// Slopes the pipeline stores: MAX_STORED_SLOPE_DEG in pipeline/flatness.
export const MAX_SLOPE_DEG = 10;

// Colours, exported so the legend uses exactly the same ones.
// The surface: [score (see the tile route), colour].
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
// level because bins double in size as the map halves in scale:
// 80 m · 4096 · 512 px / 40 075 017 m ≈ 4.2 px, stretched by 1 / cos(lat) in
// Web Mercator, so ≈ 8.9 px at 62°N (Rondane, Dovre).
const SPACING_PX = 8.9;
const RADIUS_PX = 2 * SPACING_PX;

// Between whole zoom levels the map shows the tiles of the level below,
// scaled up by up to 2×, so the spacing grows with the zoom fraction and
// snaps back at the next level. The radius follows: R at each whole level,
// growing exponentially to 2R just before the next. From zoom 12 the bins
// stop shrinking (80 m), so the spacing, and the radius, simply double with
// every zoom level in.
function radius(): ExpressionSpecification {
	const stops: number[] = [];
	for (let z = MIN_ZOOM; z < MAX_BIN_ZOOM; z++) {
		stops.push(z, RADIUS_PX, z + 0.999, 2 * RADIUS_PX);
	}
	stops.push(MAX_BIN_ZOOM, RADIUS_PX, 22, RADIUS_PX * 2 ** (22 - MAX_BIN_ZOOM));
	return ["interpolate", ["exponential", 2], ["zoom"], ...stops];
}

export type FlatFilter = {
	tent: string;
	maxSlope: number;
	minArea: number; // m²: smaller areas are left out
	tileVersion: string; // see server/tile-version.ts
};

// MapLibre cancels tile requests it no longer needs as you pan and zoom, and
// the dev server logs every cancelled request as an "aborted" error. Tiles
// are cheap and cached forever (see `tileUrl`), so let them finish instead:
// URLs starting with campfinder:// come here, and this fetches without
// passing on MapLibre's cancel signal. MapLibre still drops the tiles it no
// longer needs; the browser keeps them for when you pan back.
const PROTOCOL = "campfinder";
addProtocol(PROTOCOL, async ({ url }) => {
	const response = await fetch(
		url.replace(`${PROTOCOL}://`, `${window.location.origin}/`),
	);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return { data: await response.arrayBuffer() };
});

function tileUrl({ tent, maxSlope, minArea, tileVersion }: FlatFilter) {
	// The version makes the URL name exactly one tile's content, so
	// browsers may keep it forever (see the tile route's Cache-Control).
	const params = new URLSearchParams({
		tent,
		maxSlope: String(maxSlope),
		minArea: String(minArea),
		v: tileVersion,
	});
	return `${PROTOCOL}://tiles/{z}/{x}/{y}?${params}`;
}

// Adds the layer the first time; afterwards only swaps the tile URL so the
// map refetches with the new filter.
export function showFlat(map: MaplibreMap, filter: FlatFilter) {
	const source = map.getSource<VectorTileSource>(SOURCE);
	if (source) {
		source.setTiles([tileUrl(filter)]);
		return;
	}
	map.addSource(SOURCE, {
		type: "vector",
		tiles: [tileUrl(filter)],
		minzoom: MIN_ZOOM,
		maxzoom: MAX_ZOOM, // zoomed in further, zoom 16 tiles are enlarged
	});
	map.addLayer({
		id: "flat-scores",
		type: "heatmap",
		source: SOURCE,
		"source-layer": "scores",
		paint: {
			"heatmap-weight": ["get", "score"],
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
		paint: {
			"line-color": AREA_OUTLINE_COLOUR,
			"line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 17, 2],
		},
	});
}

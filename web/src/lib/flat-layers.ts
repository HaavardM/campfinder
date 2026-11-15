import {
	addProtocol,
	type ExpressionSpecification,
	type FilterSpecification,
	type Map as MaplibreMap,
	type VectorTileSource,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import { showParkingPopup } from "#/components/parking-popup";
import { type Area, showSpotPopup } from "#/components/spot-popup";
import { type Lot, type ParkingLimit, RANK_DISTANCE } from "#/lib/parking";

// The flat-ground layers on the map, from one PMTiles file per tent and
// season (see lib/map-data.ts; made by pipeline/flatness/src/bin/mapfiles.rs):
//
// - a smooth surface of scores, so the more spots for the tent, the greener
//   the area;
// - from zoom 14, the areas where the tent fits (neighbouring 10 m spots
//   merged into one shape) in orange, which stands out from both the green
//   and the topo map, darker where flatter: the areas at the flatter limits
//   are filled too, underneath, each faintly, so where a 1° area lies
//   inside the 2° and 3° ones the fills add up. Only the chosen limit's
//   areas are outlined and clickable. The surface fades out as they appear;
// - from zoom 11, parking lots from OpenStreetMap in blue, bigger the more
//   flat ground for the tent they have around them: where to drive to.
//   `bestParking` ranks the ones in view for the panel.
//
// Close to parking: with a distance chosen, the surface counts only spots
// within it of a parking lot, so green leads to spots you can reach, and
// the areas farther away (or with no parking known) are dimmed, not hidden:
// OSM doesn't know every lot. Lots are ranked by the flat ground within
// that distance. Distances are straight lines.
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
// Parking lots: road-sign blue, distinct from the green surface, the orange
// areas and the red trails.
export const PARKING_COLOUR = "#1d4ed8";

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
// Within a distance of parking, the count of those spots only (c3_500:
// spots at up to 3° within 500 m), which the files leave out when it's 0.
function score(
	maxSlope: SlopeLimit,
	maxParking: ParkingLimit | undefined,
): ExpressionSpecification {
	const count: ExpressionSpecification = maxParking
		? ["coalesce", ["get", `c${maxSlope}_${maxParking}`], 0]
		: ["get", `c${maxSlope}`];
	return ["sqrt", ["/", count, ["get", "n"]]];
}

// Is the area within the distance of parking? `parking_m` is how far its
// nearest cell is, missing when no lot is within MAX_PARKING_M. Any area counts
// when no distance is chosen.
function nearParking(
	maxParking: ParkingLimit | undefined,
): ExpressionSpecification | boolean {
	return maxParking
		? ["<=", ["coalesce", ["get", "parking_m"], Number.MAX_VALUE], maxParking]
		: true;
}

// Areas near parking at full strength, the others faint. Each limit's fill
// is faint on its own, so ground flat enough for all three is stronger than
// ground only within 3°. MapLibre wants the zoom at the top of
// an expression, so the choice is made at each zoom stop.
function areaOpacity(
	maxParking: ParkingLimit | undefined,
): ExpressionSpecification {
	const near = nearParking(maxParking);
	return [
		"interpolate",
		["linear"],
		["zoom"],
		14,
		["case", near, 0.2, 0.05],
		16,
		["case", near, 0.3, 0.08],
	];
}

// The property with a lot's flat ground for the filter: m3_500 is the m² of
// spots at up to 3° within 500 m (mapfiles.rs leaves it out when 0).
function flatAroundKey(
	maxSlope: SlopeLimit,
	maxParking: ParkingLimit | undefined,
) {
	return `m${maxSlope}_${maxParking ?? RANK_DISTANCE}`;
}

// A lot's dot: grey with no flat ground in reach, blue and bigger the more
// there is. The radius grows with the square root, so the dot's area grows
// with the flat ground: 3 px for none, 6 px for 9 ha, 12 px for 100 ha.
function parkingPaint(
	maxSlope: SlopeLimit,
	maxParking: ParkingLimit | undefined,
) {
	const flat: ExpressionSpecification = [
		"coalesce",
		["get", flatAroundKey(maxSlope, maxParking)],
		0,
	];
	const size: ExpressionSpecification = [
		"interpolate",
		["linear"],
		["sqrt", flat],
		0,
		3,
		300,
		6,
		1000,
		12,
	];
	return {
		flat,
		color: ["case", [">", flat, 0], PARKING_COLOUR, "#94a3b8"],
		radius: [
			"interpolate",
			["linear"],
			["zoom"],
			11,
			size,
			16,
			["*", size, 1.6],
		],
	} satisfies Record<string, ExpressionSpecification>;
}

function outlineOpacity(
	maxParking: ParkingLimit | undefined,
): ExpressionSpecification {
	return ["case", nearParking(maxParking), 1, 0.25];
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

// The areas at the flatter limits, for the shading underneath.
function flatterFilter(
	maxSlope: SlopeLimit,
	minArea: number,
): FilterSpecification {
	return [
		"all",
		["<", ["get", "limit"], maxSlope],
		[">=", ["get", "m2"], minArea],
	];
}

export type FlatFilter = {
	url: string; // the tent and season's file, as a pmtiles:// URL
	maxSlope: SlopeLimit;
	minArea: number; // m²
	maxParking?: ParkingLimit; // m; any distance if not set
};

// The slope limit last shown, for the parking popup's numbers: the click
// handler is added once, so it reads this rather than the filter it was
// added with.
let currentMaxSlope: SlopeLimit = 3;

// Adds the layers the first time; afterwards points them at another file
// (tent or season changed) and redraws with the filter.
export function showFlat(map: MaplibreMap, filter: FlatFilter) {
	const { url, maxSlope, minArea, maxParking } = filter;
	currentMaxSlope = maxSlope;
	const parking = parkingPaint(maxSlope, maxParking);
	const source = map.getSource<VectorTileSource>(SOURCE);
	if (source) {
		if (source.url !== url) source.setUrl(url);
		map.setPaintProperty(
			"flat-scores",
			"heatmap-weight",
			score(maxSlope, maxParking),
		);
		map.setFilter("flat-areas-flatter", flatterFilter(maxSlope, minArea));
		map.setFilter("flat-areas", areasFilter(maxSlope, minArea));
		map.setFilter("flat-area-outlines", areasFilter(maxSlope, minArea));
		for (const layer of ["flat-areas-flatter", "flat-areas"]) {
			map.setPaintProperty(layer, "fill-opacity", areaOpacity(maxParking));
		}
		map.setPaintProperty(
			"flat-area-outlines",
			"line-opacity",
			outlineOpacity(maxParking),
		);
		map.setPaintProperty("flat-parking", "circle-color", parking.color);
		map.setPaintProperty("flat-parking", "circle-radius", parking.radius);
		map.setLayoutProperty("flat-parking", "circle-sort-key", parking.flat);
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
			"heatmap-weight": score(maxSlope, maxParking),
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
	// The shading: the flatter limits' areas, under the chosen limit's and
	// in the same orange, not clickable.
	map.addLayer({
		id: "flat-areas-flatter",
		type: "fill",
		source: SOURCE,
		"source-layer": "areas",
		minzoom: 14,
		filter: flatterFilter(maxSlope, minArea),
		paint: {
			"fill-color": AREA_COLOUR,
			"fill-opacity": areaOpacity(maxParking),
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
			"fill-opacity": areaOpacity(maxParking),
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
			"line-opacity": outlineOpacity(maxParking),
		},
	});
	// Parking lots, on top; the ones with the most flat ground drawn last,
	// over the others.
	map.addLayer({
		id: "flat-parking",
		type: "circle",
		source: SOURCE,
		"source-layer": "parking",
		minzoom: 11,
		layout: { "circle-sort-key": parking.flat },
		paint: {
			"circle-color": parking.color,
			"circle-radius": parking.radius,
			"circle-stroke-color": "#ffffff",
			"circle-stroke-width": 1.5,
		},
	});

	// Click a parking lot for the flat ground around it, or an area for
	// links to check it's real before going: photos of the ground at the
	// clicked spot. One handler for both, taking whatever is drawn on top
	// (MapLibre lists the topmost feature first), so a lot on an area wins.
	const clickable = ["flat-parking", "flat-areas"];
	map.on("click", (event) => {
		const [top] = map.queryRenderedFeatures(event.point, {
			layers: clickable,
		});
		if (top?.layer.id === "flat-parking" && top.geometry.type === "Point") {
			const [lng, lat] = top.geometry.coordinates;
			showParkingPopup(
				map,
				{ lng, lat },
				top.properties as Lot,
				currentMaxSlope,
			);
		} else if (top?.layer.id === "flat-areas") {
			showSpotPopup(map, event.lngLat, top.properties as Area);
		}
	});
	for (const layer of clickable) {
		map.on("mouseenter", layer, () => {
			map.getCanvas().style.cursor = "pointer";
		});
		map.on("mouseleave", layer, () => {
			map.getCanvas().style.cursor = "";
		});
	}
}

// A parking lot in the panel's list.
export type RankedLot = {
	lot: Lot;
	m2: number; // flat ground for the tent within the distance
	lng: number;
	lat: number;
};

// The lots in view with the most flat ground for the tent around them,
// best first. Reads the parking from the tiles already loaded, so it needs
// no downloads of its own; the files have it from zoom 9. A lot on a tile
// edge is in both tiles, hence the de-duplication by OSM id.
export function bestParking(
	map: MaplibreMap,
	{ maxSlope, maxParking }: Pick<FlatFilter, "maxSlope" | "maxParking">,
	count = 5,
): RankedLot[] {
	if (!map.getSource(SOURCE)) return [];
	const key = flatAroundKey(maxSlope, maxParking);
	const bounds = map.getBounds();
	const lots = new Map<string, RankedLot>();
	for (const feature of map.querySourceFeatures(SOURCE, {
		sourceLayer: "parking",
	})) {
		if (feature.geometry.type !== "Point") continue;
		const [lng, lat] = feature.geometry.coordinates;
		const lot = feature.properties as Lot;
		const m2 = Number(feature.properties[key] ?? 0);
		if (m2 > 0 && bounds.contains([lng, lat])) {
			lots.set(lot.osm_id, { lot, m2, lng, lat });
		}
	}
	return [...lots.values()].sort((a, b) => b.m2 - a.m2).slice(0, count);
}

import type {
	ExpressionSpecification,
	Map as MaplibreMap,
	VectorTileSource,
} from "maplibre-gl";

// The flat-ground layers on the map, fed by our /tiles route:
//
// - a smooth surface of fitness scores, so the better the ground for the
//   tent, the greener the area;
// - from zoom 15, the 10 m cells where the tent fits, for picking a spot.
//   They fade in as the surface fades to a faint background.
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
const MIN_ZOOM = 7; // tiles exist for zooms 7–16 (see the tile route)
const MAX_BIN_ZOOM = 12; // bins stop shrinking here: 80 m
const MAX_ZOOM = 16;

// Slopes the pipeline stores: MAX_STORED_SLOPE_DEG in pipeline/flatness.
export const MAX_SLOPE_DEG = 10;

// Colour scale: [fitness score, colour]. Exported so the legend uses exactly
// the same scale.
export const SCORE_COLOURS: [number, string][] = [
	[0.05, "#e5f5e0"],
	[0.15, "#a1d99b"],
	[0.3, "#41ab5d"],
	[0.5, "#006d2c"],
	[0.8, "#00441b"],
];

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

export type FlatFilter = { tent: string; maxSlope: number };

function tileUrl({ tent, maxSlope }: FlatFilter) {
	// MapLibre fetches tiles from a worker, so the URL must be absolute.
	const params = new URLSearchParams({ tent, maxSlope: String(maxSlope) });
	return `${window.location.origin}/tiles/{z}/{x}/{y}?${params}`;
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
				14.5,
				0.75,
				16,
				0.25,
			],
			// Density is now the interpolated score: transparent where there's
			// hardly any usable ground, deeper green the better it gets.
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
	map.addLayer({
		id: "flat-cells",
		type: "fill",
		source: SOURCE,
		"source-layer": "cells",
		paint: {
			"fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, 0.7],
			// Flattest ground darkest green, up to yellow at the max slope.
			"fill-color": [
				"interpolate",
				["linear"],
				["get", "slope"],
				0,
				"#00441b",
				2,
				"#238b45",
				4,
				"#74c476",
				6,
				"#c7e9c0",
				MAX_SLOPE_DEG,
				"#fee08b",
			],
		},
	});
}

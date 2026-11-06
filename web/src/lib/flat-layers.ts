import type { Map as MaplibreMap, VectorTileSource } from "maplibre-gl";

// The flat-ground layers on the map, fed by our /tiles route.
//
// Zoomed out: a heatmap of "bins" (the share of each bin that is flat
// enough). From zoom 14: the 10 m "cells", coloured by slope.

const SOURCE = "flat";
const CELLS_FROM_ZOOM = 14;

export type FlatFilter = { tent: string; maxSlope: number };

function tileUrl({ tent, maxSlope }: FlatFilter) {
	// MapLibre fetches tiles from a worker, so the URL must be absolute.
	const params = new URLSearchParams({ tent, maxSlope: String(maxSlope) });
	return `${window.location.origin}/tiles/{z}/{x}/{y}?${params}`;
}

/// Adds the layers the first time, afterwards only swaps the tile URL so the
/// map refetches with the new filter.
export function showFlat(map: MaplibreMap, filter: FlatFilter) {
	const source = map.getSource<VectorTileSource>(SOURCE);
	if (source) {
		source.setTiles([tileUrl(filter)]);
	} else {
		addFlatLayers(map, filter);
	}
}

function addFlatLayers(map: MaplibreMap, filter: FlatFilter) {
	map.addSource(SOURCE, {
		type: "vector",
		tiles: [tileUrl(filter)],
		maxzoom: 16, // deeper zooms reuse zoom 16 tiles
	});

	map.addLayer({
		id: "flat-heatmap",
		type: "heatmap",
		source: SOURCE,
		"source-layer": "bins",
		maxzoom: CELLS_FROM_ZOOM,
		paint: {
			"heatmap-weight": ["get", "share"],
			"heatmap-radius": 20,
			"heatmap-intensity": 1.6,
			"heatmap-opacity": 0.75,
			// Transparent where nothing is flat, deep green where most is.
			"heatmap-color": [
				"interpolate",
				["linear"],
				["heatmap-density"],
				0,
				"rgba(0, 0, 0, 0)",
				0.2,
				"#c7e9c0",
				0.5,
				"#74c476",
				0.8,
				"#31a354",
				1,
				"#006d2c",
			],
		},
	});

	map.addLayer({
		id: "flat-cells",
		type: "fill",
		source: SOURCE,
		"source-layer": "cells",
		minzoom: CELLS_FROM_ZOOM,
		paint: {
			"fill-opacity": 0.55,
			// Flattest ground darkest green, up to yellow at 10°.
			"fill-color": [
				"interpolate",
				["linear"],
				["get", "slope"],
				0,
				"#006d2c",
				3,
				"#31a354",
				6,
				"#addd8e",
				10,
				"#fee08b",
			],
		},
	});
}

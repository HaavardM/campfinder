import type { Map as MaplibreMap, VectorTileSource } from "maplibre-gl";

// The flat-ground layers on the map, fed by our /tiles route.
//
// Zoomed out: "bins", squares coloured by the share of their ground where the
// tent fits, so the areas with the most spots stand out. From zoom 14: the
// 10 m "cells", coloured by slope.
//
// The tile route decides which of the two a tile holds, so the layers have no
// zoom limits of their own. That matters while zooming: MapLibre shows the
// previous zoom's tiles until the new ones arrive, and those must still draw.

const SOURCE = "flat";

/// Colour scale for the zoomed-out squares: [share of ground, colour].
/// Exported so the legend uses exactly the same scale.
export const SHARE_COLOURS: [number, string][] = [
	[0.05, "#e5f5e0"],
	[0.15, "#a1d99b"],
	[0.3, "#41ab5d"],
	[0.5, "#006d2c"],
	[0.8, "#00441b"],
];

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
		id: "flat-bins",
		type: "fill",
		source: SOURCE,
		"source-layer": "bins",
		// Hide squares with only a few scattered spots.
		filter: [">=", ["get", "share"], SHARE_COLOURS[0][0]],
		paint: {
			// Antialiased edges leave thin seams between neighbouring squares.
			"fill-antialias": false,
			"fill-opacity": 0.7,
			"fill-color": [
				"interpolate",
				["linear"],
				["get", "share"],
				...SHARE_COLOURS.flat(),
			],
		},
	});

	map.addLayer({
		id: "flat-cells",
		type: "fill",
		source: SOURCE,
		"source-layer": "cells",
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

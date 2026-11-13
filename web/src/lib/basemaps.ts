import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";

// Kartverket's free map tiles. "webmercator" is the tile grid used by web maps
// (EPSG:3857); Kartverket also serves UTM grids, which web maps can't use
// directly.
function kartverketTiles(layer: string) {
	return `https://cache.kartverket.no/v1/wmts/1.0.0/${layer}/default/webmercator/{z}/{y}/{x}.png`;
}

export const BASEMAPS = {
	topo: { label: "Topo", layer: "topo" },
	grey: { label: "Grey", layer: "topograatone" },
} as const;

export type Basemap = keyof typeof BASEMAPS;

export function isBasemap(value: unknown): value is Basemap {
	return typeof value === "string" && value in BASEMAPS;
}

// One raster source and layer per basemap. Switching basemap only toggles
// layer visibility, so the map never reloads its style.
export function basemapStyle(visible: Basemap): StyleSpecification {
	const names = Object.keys(BASEMAPS) as Basemap[];
	return {
		version: 8,
		sources: Object.fromEntries(
			names.map((name) => [
				name,
				{
					type: "raster",
					tiles: [kartverketTiles(BASEMAPS[name].layer)],
					tileSize: 256,
					maxzoom: 18,
					attribution: "© Kartverket",
				},
			]),
		),
		layers: names.map((name) => ({
			id: name,
			type: "raster",
			source: name,
			layout: { visibility: name === visible ? "visible" : "none" },
			// No fade-in: on zooming, the sharper tiles replace the enlarged
			// ones straight away, rather than every tile blending in over
			// 0.3 s, which looked like the map reloading.
			paint: { "raster-fade-duration": 0 },
		})),
	};
}

export function showBasemap(map: MaplibreMap, visible: Basemap) {
	for (const name of Object.keys(BASEMAPS)) {
		map.setLayoutProperty(
			name,
			"visibility",
			name === visible ? "visible" : "none",
		);
	}
}

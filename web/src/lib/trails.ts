import type {
	LayerSpecification,
	Map as MaplibreMap,
	SourceSpecification,
} from "maplibre-gl";
import type { Season } from "#/lib/seasons";

// Marked trails from Kartverket's Tur- og friluftsruter (the national trail
// database: DNT's routes, municipal trails, ski tracks), drawn as light red
// lines on transparent images. Hiking trails in summer, ski trails in
// winter: the season decides which is shown.
//
// It's a WMS: rather than ready-made tiles, the server draws an image for
// any box it's asked for. MapLibre fills in {bbox-epsg-3857} with each
// tile's box in web-map metres, so it can be used like a tile source.
//
// Each image is drawn on request, slower than the basemap's ready-made
// tiles, and MapLibre loads at most 16 images at a time: so few, large
// images (512 px), and none past zoom 15 (about 1 m per pixel here), where
// MapLibre enlarges those instead. The server draws nothing when zoomed
// out further than 1:1 million (about zoom 9).
const TRAILS: Record<Season, string> = {
	summer: "Fotrute",
	winter: "Skiloype",
};

function trailImages(layer: string) {
	return (
		"https://wms.geonorge.no/skwms1/wms.friluftsruter2?SERVICE=WMS&VERSION=1.3.0" +
		`&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}` +
		"&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE"
	);
}

// One source and layer per season, hidden until `showTrails`.
export const TRAIL_SOURCES: Record<string, SourceSpecification> =
	Object.fromEntries(
		Object.entries(TRAILS).map(([season, layer]) => [
			`trails-${season}`,
			{
				type: "raster",
				tiles: [trailImages(layer)],
				tileSize: 512,
				minzoom: 9,
				maxzoom: 15,
				attribution: "Turruter © Kartverket",
			},
		]),
	);

export const TRAIL_LAYERS: LayerSpecification[] = Object.keys(TRAILS).map(
	(season) => ({
		id: `trails-${season}`,
		type: "raster",
		source: `trails-${season}`,
		layout: { visibility: "none" },
		// No fade-in, as for the basemaps.
		paint: { "raster-fade-duration": 0 },
	}),
);

export function showTrails(map: MaplibreMap, season: Season, visible: boolean) {
	for (const name of Object.keys(TRAILS)) {
		map.setLayoutProperty(
			`trails-${name}`,
			"visibility",
			visible && name === season ? "visible" : "none",
		);
	}
}

import type {
	LayerSpecification,
	Map as MaplibreMap,
	SourceSpecification,
} from "maplibre-gl";

// Kartverket's hillshade of the 1 m terrain model, the same model the
// pipeline computes slopes from: the ground lit from several directions,
// so close up it shows the hummocks, boulders, ditches and banks that
// decide whether a spot is really flat. Laid over the basemap, half see-
// through. In places it shows stripes along the laser-scanning flight lines.
//
// Like the trails, a WMS, with large images (512 px) for fewer requests,
// as JPEG: a quarter of PNG's size for a shaded image, and nothing here
// needs to be see-through (the layer's opacity does that).
// From zoom 12, where 1 m detail starts to show; zoomed further out it
// would be a lot of server work for a grey blur. Up to zoom 15, about 1 m
// per pixel here, the model's own detail: closer in, MapLibre enlarges
// those images rather than asking for new ones with nothing more in them.
export const HILLSHADE = "hillshade";

export const HILLSHADE_SOURCE: SourceSpecification = {
	type: "raster",
	tiles: [
		"https://wms.geonorge.no/skwms1/wms.hoyde-dtm?SERVICE=WMS&VERSION=1.3.0" +
			"&REQUEST=GetMap&LAYERS=DTM:multiskyggerelieff&STYLES=&CRS=EPSG:3857" +
			"&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg",
	],
	tileSize: 512,
	minzoom: 12,
	maxzoom: 15,
	attribution: "Terrengmodell © Kartverket",
};

export const HILLSHADE_LAYER: LayerSpecification = {
	id: HILLSHADE,
	type: "raster",
	source: HILLSHADE,
	layout: { visibility: "none" },
	// No fade-in, as for the basemaps.
	paint: { "raster-opacity": 0.5, "raster-fade-duration": 0 },
};

export function showHillshade(map: MaplibreMap, visible: boolean) {
	map.setLayoutProperty(HILLSHADE, "visibility", visible ? "visible" : "none");
}

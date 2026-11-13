import {
	GeolocateControl,
	Map as MaplibreMap,
	NavigationControl,
	ScaleControl,
	type StyleSpecification,
	setWorkerUrl,
	TerrainControl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { type RefObject, useEffect, useState } from "react";

import { type Basemap, basemapStyle } from "#/lib/basemaps";
import { HILLSHADE, HILLSHADE_LAYER, HILLSHADE_SOURCE } from "#/lib/hillshade";
import { TERRAIN, TERRAIN_SOURCE } from "#/lib/terrain";
import { TRAIL_LAYERS, TRAIL_SOURCES } from "#/lib/trails";

// MapLibre parses tiles in a Web Worker. By default it looks for the worker
// file next to its own module, which breaks once Vite bundles it.
// `?worker&url` makes Vite bundle the worker itself and hand us its URL.
setWorkerUrl(workerUrl);

export type MapView = { lat: number; lon: number; zoom: number };

// Everything the map starts with. The overlays come after the basemap in
// `layers`, so they draw above it; the flat-ground layers are added once
// the map has loaded, so they draw above all of these. Every overlay starts
// hidden: MapLibre fetches nothing for a hidden layer.
function mapStyle(basemap: Basemap): StyleSpecification {
	const base = basemapStyle(basemap);
	return {
		...base,
		sources: {
			...base.sources,
			[HILLSHADE]: HILLSHADE_SOURCE,
			...TRAIL_SOURCES,
			[TERRAIN]: TERRAIN_SOURCE,
		},
		layers: [...base.layers, HILLSHADE_LAYER, ...TRAIL_LAYERS],
	};
}

// Creates a MapLibre map inside `containerRef` once, and returns it after its
// style has loaded (null before that). The map then owns its own position:
// React never pushes a view back into it, it only listens for moves.
export function useMaplibre(
	containerRef: RefObject<HTMLDivElement | null>,
	initialView: MapView,
	initialBasemap: Basemap,
): MaplibreMap | null {
	const [map, setMap] = useState<MaplibreMap | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once; later views and basemaps are applied by the caller.
	useEffect(() => {
		if (!containerRef.current) return;

		const instance = new MaplibreMap({
			container: containerRef.current,
			style: mapStyle(initialBasemap),
			center: [initialView.lon, initialView.lat],
			zoom: initialView.zoom,
			maxZoom: 18,
			// Tilt in 3D. MapLibre allows 60°, where the top of the screen
			// looks out several times further than the camera is high: lots
			// of distant tiles, loaded last. 50° roughly halves that.
			maxPitch: 50,
			// Roughly Norway, with some margin, so the map can't drift off.
			maxBounds: [
				[-5, 55],
				[40, 73],
			],
			attributionControl: { compact: true },
			// Tiles that have left the screen are kept for when you zoom or pan
			// back: by default about five screens' worth per source, so zooming
			// out a few levels and back in again had to load them all again.
			// Ten screens' worth, but at most 200 tiles per source: each keeps
			// its image in graphics memory (a 256 px tile about 0.35 MB), and a
			// phone short of it can drop and redraw the whole map.
			maxTileCacheZoomLevels: 10,
			maxTileCacheSize: 200,
		});

		// visualizePitch: the compass tilts with the map, which shows the view
		// is tilted in 3D (and tapping it straightens it again).
		instance.addControl(
			new NavigationControl({ visualizePitch: true }),
			"top-right",
		);
		// 3D on and off. Off at first: it costs data and battery on a phone.
		instance.addControl(new TerrainControl({ source: TERRAIN }), "top-right");
		instance.addControl(
			new GeolocateControl({
				positionOptions: { enableHighAccuracy: true },
				trackUserLocation: true,
			}),
			"top-right",
		);
		instance.addControl(new ScaleControl(), "bottom-left");

		instance.on("load", () => setMap(instance));
		return () => {
			setMap(null);
			instance.remove();
		};
	}, []);

	return map;
}

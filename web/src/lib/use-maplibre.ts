import {
	GeolocateControl,
	Map as MaplibreMap,
	NavigationControl,
	ScaleControl,
	setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { type RefObject, useEffect, useState } from "react";

import { type Basemap, basemapStyle } from "#/lib/basemaps";

// MapLibre parses tiles in a Web Worker. By default it looks for the worker
// file next to its own module, which breaks once Vite bundles it.
// `?worker&url` makes Vite bundle the worker itself and hand us its URL.
setWorkerUrl(workerUrl);

export type MapView = { lat: number; lon: number; zoom: number };

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
			style: basemapStyle(initialBasemap),
			center: [initialView.lon, initialView.lat],
			zoom: initialView.zoom,
			maxZoom: 18,
			// Roughly Norway, with some margin, so the map can't drift off.
			maxBounds: [
				[-5, 55],
				[40, 73],
			],
			attributionControl: { compact: true },
		});

		instance.addControl(new NavigationControl(), "top-right");
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

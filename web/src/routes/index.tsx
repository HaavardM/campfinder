import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { MapPanel } from "#/components/map-panel";
import { type Basemap, isBasemap, showBasemap } from "#/lib/basemaps";
import { type MapView, useMaplibre } from "#/lib/use-maplibre";

// Everything that describes the current view lives in the URL, so a reload or
// a shared link opens the same place. Example: /?lat=61.93&lon=9.73&zoom=10
type MapSearch = MapView & { basemap: Basemap };

const RONDANE: MapSearch = { lat: 61.93, lon: 9.73, zoom: 10, basemap: "topo" };

function numberOr(value: unknown, fallback: number) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const Route = createFileRoute("/")({
	// MapLibre needs a browser (WebGL, window), so don't render on the server.
	ssr: false,
	validateSearch: (search): MapSearch => ({
		lat: numberOr(search.lat, RONDANE.lat),
		lon: numberOr(search.lon, RONDANE.lon),
		zoom: numberOr(search.zoom, RONDANE.zoom),
		basemap: isBasemap(search.basemap) ? search.basemap : RONDANE.basemap,
	}),
	component: MapPage,
});

function MapPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/" });
	const containerRef = useRef<HTMLDivElement>(null);
	const map = useMaplibre(containerRef, search, search.basemap);

	// Map → URL: after each pan or zoom, write the new view into the URL.
	// `replace` keeps the browser history from filling up with every move.
	useEffect(() => {
		if (!map) return;
		const onMoveEnd = () => {
			const center = map.getCenter();
			navigate({
				search: (previous) => ({
					...previous,
					// 5 decimals ≈ 1 m, plenty for a map view.
					lat: Number(center.lat.toFixed(5)),
					lon: Number(center.lng.toFixed(5)),
					zoom: Number(map.getZoom().toFixed(2)),
				}),
				replace: true,
			});
		};
		map.on("moveend", onMoveEnd);
		return () => {
			map.off("moveend", onMoveEnd);
		};
	}, [map, navigate]);

	useEffect(() => {
		if (map) showBasemap(map, search.basemap);
	}, [map, search.basemap]);

	return (
		<main className="relative h-dvh w-full">
			{/* Sized with h-full rather than absolute positioning: MapLibre sets
			    position: relative on its container. */}
			<div ref={containerRef} className="h-full w-full" />
			<MapPanel
				basemap={search.basemap}
				onBasemapChange={(basemap) =>
					navigate({
						search: (previous) => ({ ...previous, basemap }),
						replace: true,
					})
				}
				onPlaceSelect={(place) =>
					map?.flyTo({ center: [place.lon, place.lat], zoom: 14 })
				}
				onRegionSelect={(region) =>
					map?.fitBounds(region.bounds, { padding: 40 })
				}
			/>
		</main>
	);
}

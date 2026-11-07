import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { MapPanel } from "#/components/map-panel";
import { type Basemap, isBasemap, showBasemap } from "#/lib/basemaps";
import {
	googleSatelliteUrl,
	isSlopeLimit,
	type SlopeLimit,
	showFlat,
} from "#/lib/flat-layers";
import { getManifest, pmtilesUrl } from "#/lib/map-data";
import { isSeason, type Season } from "#/lib/seasons";
import { type MapView, useMaplibre } from "#/lib/use-maplibre";

// Everything that describes the current view lives in the URL, so a reload or
// a shared link opens the same place. Example: /?lat=61.93&lon=9.73&zoom=10
type MapSearch = MapView & {
	basemap: Basemap;
	tent?: string; // tent slug; the first tent if not set
	season: Season;
	maxSlope: SlopeLimit; // degrees: the limits the files have
	minArea: number; // m²: smaller areas with room for the tent are left out
};

const RONDANE: MapSearch = {
	lat: 61.93,
	lon: 9.73,
	zoom: 10,
	basemap: "topo",
	season: "summer",
	maxSlope: 3,
	minArea: 300,
};

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
		tent: typeof search.tent === "string" ? search.tent : undefined,
		season: isSeason(search.season) ? search.season : RONDANE.season,
		maxSlope: isSlopeLimit(search.maxSlope)
			? search.maxSlope
			: RONDANE.maxSlope,
		minArea: numberOr(search.minArea, RONDANE.minArea),
	}),
	loader: () => getManifest(),
	component: MapPage,
});

function MapPage() {
	const search = Route.useSearch();
	const manifest = Route.useLoaderData();
	const tents = manifest.tents;
	const navigate = useNavigate({ from: "/" });
	// A control changed: update its value in the URL. `replace` keeps the
	// browser history from filling up with every change.
	const setSearch = (change: Partial<MapSearch>) =>
		navigate({
			search: (previous) => ({ ...previous, ...change }),
			replace: true,
		});
	const containerRef = useRef<HTMLDivElement>(null);
	const map = useMaplibre(containerRef, search, search.basemap);
	const tent = search.tent ?? tents[0]?.slug;

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

	useEffect(() => {
		const url = tent && pmtilesUrl(manifest, tent, search.season);
		if (map && url) {
			showFlat(map, {
				url,
				maxSlope: search.maxSlope,
				minArea: search.minArea,
			});
		}
	}, [map, manifest, tent, search.season, search.maxSlope, search.minArea]);

	return (
		<main className="relative h-dvh w-full">
			{/* Sized with h-full rather than absolute positioning: MapLibre sets
			    position: relative on its container. */}
			<div ref={containerRef} className="h-full w-full" />
			<MapPanel
				tents={tents}
				tent={tent}
				onTentChange={(tent) => setSearch({ tent })}
				season={search.season}
				onSeasonChange={(season) => setSearch({ season })}
				maxSlope={search.maxSlope}
				onMaxSlopeChange={(maxSlope) => setSearch({ maxSlope })}
				minArea={search.minArea}
				onMinAreaChange={(minArea) => setSearch({ minArea })}
				photoUrl={googleSatelliteUrl(search.lat, search.lon, search.zoom)}
				basemap={search.basemap}
				onBasemapChange={(basemap) => setSearch({ basemap })}
				onPlaceSelect={(place) =>
					map?.flyTo({ center: [place.lon, place.lat], zoom: 14 })
				}
				onRegionSelect={(region) =>
					map?.fitBounds(region.bounds, { padding: 40 })
				}
			/>{" "}
		</main>
	);
}

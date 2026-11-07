import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { MapPanel } from "#/components/map-panel";
import { type Basemap, isBasemap, showBasemap } from "#/lib/basemaps";
import { isSeason, type Season, showFlat } from "#/lib/flat-layers";
import { type MapView, useMaplibre } from "#/lib/use-maplibre";
import { getTents } from "#/server/tents";
import { getTileVersion } from "#/server/tile-version";

// Everything that describes the current view lives in the URL, so a reload or
// a shared link opens the same place. Example: /?lat=61.93&lon=9.73&zoom=10
type MapSearch = MapView & {
	basemap: Basemap;
	tent?: string; // tent slug; the first tent if not set
	season: Season;
	maxSlope: number; // degrees
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
		maxSlope: numberOr(search.maxSlope, RONDANE.maxSlope),
		minArea: numberOr(search.minArea, RONDANE.minArea),
	}),
	loader: async () => {
		const [tents, tileVersion] = await Promise.all([
			getTents(),
			getTileVersion(),
		]);
		return { tents, tileVersion };
	},
	component: MapPage,
});

function MapPage() {
	const search = Route.useSearch();
	const { tents, tileVersion } = Route.useLoaderData();
	const navigate = useNavigate({ from: "/" });
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
		if (map && tent) {
			const { season, maxSlope, minArea } = search;
			showFlat(map, { tent, season, maxSlope, minArea, tileVersion });
		}
	}, [map, tent, search.season, search.maxSlope, search.minArea, tileVersion]);

	return (
		<main className="relative h-dvh w-full">
			{/* Sized with h-full rather than absolute positioning: MapLibre sets
			    position: relative on its container. */}
			<div ref={containerRef} className="h-full w-full" />
			<MapPanel
				tents={tents}
				tent={tent}
				onTentChange={(tent) =>
					navigate({
						search: (previous) => ({ ...previous, tent }),
						replace: true,
					})
				}
				season={search.season}
				onSeasonChange={(season) =>
					navigate({
						search: (previous) => ({ ...previous, season }),
						replace: true,
					})
				}
				maxSlope={search.maxSlope}
				onMaxSlopeChange={(maxSlope) =>
					navigate({
						search: (previous) => ({ ...previous, maxSlope }),
						replace: true,
					})
				}
				minArea={search.minArea}
				onMinAreaChange={(minArea) =>
					navigate({
						search: (previous) => ({ ...previous, minArea }),
						replace: true,
					})
				}
				// Google's satellite view of the same place, to look at the
				// ground itself (Kartverket's aerial photos need a licence).
				photoUrl={`https://www.google.com/maps/@${search.lat},${search.lon},${Math.round(search.zoom)}z/data=!3m1!1e3`}
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

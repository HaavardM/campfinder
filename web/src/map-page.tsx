import { useEffect, useRef, useState } from "react";

import { MapPanel } from "#/components/map-panel";
import { type Basemap, isBasemap, showBasemap } from "#/lib/basemaps";
import {
	googleSatelliteUrl,
	isSlopeLimit,
	type SlopeLimit,
	showFlat,
} from "#/lib/flat-layers";
import { type Manifest, pmtilesUrl } from "#/lib/map-data";
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

// A number from the URL; NaN if it's missing or not a number.
function numberIn(params: URLSearchParams, key: string) {
	const value = params.get(key);
	return value === null ? Number.NaN : Number(value);
}

function numberOr(value: number, fallback: number) {
	return Number.isFinite(value) ? value : fallback;
}

// The view from the URL, with defaults for what's missing or wrong.
function readSearch(params: URLSearchParams): MapSearch {
	const basemap = params.get("basemap");
	const season = params.get("season");
	const maxSlope = numberIn(params, "maxSlope");
	return {
		lat: numberOr(numberIn(params, "lat"), RONDANE.lat),
		lon: numberOr(numberIn(params, "lon"), RONDANE.lon),
		zoom: numberOr(numberIn(params, "zoom"), RONDANE.zoom),
		basemap: isBasemap(basemap) ? basemap : RONDANE.basemap,
		tent: params.get("tent") ?? undefined,
		season: isSeason(season) ? season : RONDANE.season,
		maxSlope: isSlopeLimit(maxSlope) ? maxSlope : RONDANE.maxSlope,
		minArea: numberOr(numberIn(params, "minArea"), RONDANE.minArea),
	};
}

// The view as a URL query: "lat=61.93&lon=9.73&zoom=10&…".
function writeSearch(search: MapSearch) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search)) {
		if (value !== undefined) params.set(key, String(value));
	}
	return params.toString();
}

export function MapPage({ manifest }: { manifest: Manifest }) {
	const [search, setSearchState] = useState(() =>
		readSearch(new URLSearchParams(window.location.search)),
	);
	const tents = manifest.tents;
	const setSearch = (change: Partial<MapSearch>) =>
		setSearchState((previous) => ({ ...previous, ...change }));

	// State → URL, whatever changed it. `replaceState` keeps the browser
	// history from filling up with every change.
	useEffect(() => {
		window.history.replaceState(null, "", `?${writeSearch(search)}`);
	}, [search]);
	const containerRef = useRef<HTMLDivElement>(null);
	const map = useMaplibre(containerRef, search, search.basemap);
	const tent = search.tent ?? tents[0]?.slug;

	// Map → state: after each pan or zoom, keep the new view.
	useEffect(() => {
		if (!map) return;
		const onMoveEnd = () => {
			const center = map.getCenter();
			setSearchState((previous) => ({
				...previous,
				// 5 decimals ≈ 1 m, plenty for a map view.
				lat: Number(center.lat.toFixed(5)),
				lon: Number(center.lng.toFixed(5)),
				zoom: Number(map.getZoom().toFixed(2)),
			}));
		};
		map.on("moveend", onMoveEnd);
		return () => {
			map.off("moveend", onMoveEnd);
		};
	}, [map]);

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
			/>
		</main>
	);
}

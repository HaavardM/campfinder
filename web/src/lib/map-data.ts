import type { Season } from "#/lib/seasons";

// The map's data is plain files: one PMTiles file per tent and season (all
// the map tiles in one file, read piece by piece with HTTP range requests),
// and manifest.json saying which tents and files there are. They're made by
// pipeline/run.sh and can be served from any static host or bucket. Set
// VITE_MAP_URL when building to read them from elsewhere.
const MAP_URL = import.meta.env.VITE_MAP_URL ?? "/map";

export type Tent = { slug: string; name: string };

export type Manifest = {
	tents: Tent[];
	// "keron-4-gt.summer" → "keron-4-gt.summer.3f9a1c0e2b7d.pmtiles". A hash
	// of the content in the name: a changed file has a new URL, so the files
	// themselves can be cached for good.
	files: Record<string, string>;
};

// The manifest itself is small and changes with every build: ask each time.
export async function getManifest(): Promise<Manifest> {
	const response = await fetch(`${MAP_URL}/manifest.json`, {
		cache: "no-cache",
	});
	if (!response.ok)
		throw new Error(`${MAP_URL}/manifest.json: ${response.status}`);
	return response.json();
}

// The PMTiles URL for a tent and season, as MapLibre's pmtiles:// protocol
// wants it; undefined if that combination wasn't built.
export function pmtilesUrl(manifest: Manifest, tent: string, season: Season) {
	const file = manifest.files[`${tent}.${season}`];
	return (
		file && `pmtiles://${new URL(`${MAP_URL}/${file}`, window.location.href)}`
	);
}

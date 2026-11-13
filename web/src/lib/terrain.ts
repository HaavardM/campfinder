import type { SourceSpecification } from "maplibre-gl";

// Heights for 3D: the open Terrain Tiles on AWS (made by Mapzen; no key
// needed). Each PNG tile stores a height per pixel in its colours
// ("terrarium": red · 256 + green + blue / 256 − 32768 metres). Down to
// about 10 m per pixel at zoom 15, and within a few metres of the real
// summits in Rondane and Jotunheimen: enough to see a spot's surroundings
// (under a steep slope, in a bowl, on a ridge), not the 1 m detail the
// hillshade shows. MapLibre's 3D button (TerrainControl) drapes every layer
// over it.
export const TERRAIN = "terrain";

export const TERRAIN_SOURCE: SourceSpecification = {
	type: "raster-dem",
	tiles: [
		"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
	],
	encoding: "terrarium",
	tileSize: 256,
	maxzoom: 15,
	attribution: "Terrain Tiles: Mapzen, AWS Open Data",
};

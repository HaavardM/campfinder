import { createFileRoute } from "@tanstack/react-router";

import { sql } from "#/server/db";

// GET /tiles/{z}/{x}/{y}?tent=keron-4-gt&maxSlope=5
//
// A vector tile (Mapbox Vector Tile format) of flat ground, built by PostGIS:
//
// - zoom 14 and closer: layer "cells", the 10 m cells themselves;
// - further out: layer "bins", one point per bin of cells with the share of
//   the bin that is flat enough, for the heatmap. Sending every cell at low
//   zoom would mean hundreds of thousands of polygons per tile.
//
// Cells are stored in UTM 33 (EPSG:25833); web map tiles are in Web Mercator
// (EPSG:3857), so geometries are transformed on the way out.

const CELLS_FROM_ZOOM = 14;

export const Route = createFileRoute("/tiles/$z/$x/$y")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const z = Number(params.z);
				const x = Number(params.x);
				const y = Number(params.y);
				const search = new URL(request.url).searchParams;
				const tent = search.get("tent") ?? "";
				const maxSlope = Number(search.get("maxSlope") ?? 5);
				if (![z, x, y, maxSlope].every(Number.isFinite)) {
					return new Response("bad tile request", { status: 400 });
				}

				const [row] =
					z >= CELLS_FROM_ZOOM
						? await cellsTile(z, x, y, tent, maxSlope)
						: await binsTile(z, x, y, tent, maxSlope);
				return new Response(row.mvt, {
					headers: {
						"Content-Type": "application/vnd.mapbox-vector-tile",
						"Cache-Control": "public, max-age=60",
					},
				});
			},
		},
	},
});

function cellsTile(
	z: number,
	x: number,
	y: number,
	tent: string,
	maxSlope: number,
) {
	return sql`
		WITH bounds AS (
			-- The tile's square in Web Mercator, and a slightly larger box in
			-- UTM 33 for the index lookup (the square's edges bend a little
			-- when transformed, so pad it).
			SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS web,
			       ST_Expand(ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 25833), 50) AS utm
		),
		cells AS (
			SELECT ST_AsMVTGeom(ST_Transform(c.geom, 3857), bounds.web) AS geom,
			       c.max_slope_deg AS slope,
			       c.heading_deg AS heading,
			       c.elevation_m AS elevation
			FROM cell c, bounds
			WHERE c.tent = ${tent}
			  AND c.max_slope_deg <= ${maxSlope}
			  AND c.geom && bounds.utm
		)
		SELECT ST_AsMVT(cells, 'cells') AS mvt FROM cells`;
}

function binsTile(
	z: number,
	x: number,
	y: number,
	tent: string,
	maxSlope: number,
) {
	// Bins double in size with each zoom level out, so a tile always holds
	// roughly the same number of points: 40 m at zoom 13, 80 m at 12, …
	const binM = 10 * 2 ** (CELLS_FROM_ZOOM + 1 - z);
	const cellsPerBin = (binM / 10) ** 2;
	return sql`
		WITH bounds AS (
			SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS web,
			       ST_Expand(ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 25833), ${binM}) AS utm
		),
		bins AS (
			-- Integer division groups cells into bins: cheap, no geometry work.
			SELECT c.x / ${binM} AS bx, c.y / ${binM} AS by, count(*) AS flat_cells
			FROM cell c, bounds
			WHERE c.tent = ${tent}
			  AND c.max_slope_deg <= ${maxSlope}
			  AND c.geom && bounds.utm
			GROUP BY 1, 2
		),
		points AS (
			SELECT ST_AsMVTGeom(
			           ST_Transform(ST_Point((bx + 0.5) * ${binM}, (by + 0.5) * ${binM}, 25833), 3857),
			           bounds.web) AS geom,
			       flat_cells::float / ${cellsPerBin} AS share
			FROM bins, bounds
		)
		SELECT ST_AsMVT(points, 'bins') AS mvt FROM points`;
}

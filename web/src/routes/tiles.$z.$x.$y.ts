import { createFileRoute } from "@tanstack/react-router";

import { sql } from "#/server/db";

// GET /tiles/{z}/{x}/{y}?tent=keron-4-gt&maxSlope=5
//
// A vector tile (Mapbox Vector Tile format) of points, one per bin, scored
// by how good the ground is for the tent. Built by PostGIS from the
// pre-counted `bin` table (see db/schema.sql and db/bins.sql); the map
// interpolates between the points (see lib/flat-layers.ts).
//
// The score is the average over the bin's 10 m cells of:
// 1 where the tent fits at up to 1°, falling linearly to 0 at maxSlope;
// 0 where it doesn't fit at all. So 1 = the whole bin is perfect ground.
//
// Bins exist for zooms 7–12. Tiles at zooms 13–16 use the 80 m bins of
// zoom 12, but each covers a smaller area, so it holds only the points it
// needs: enlarging one zoom-12 tile instead would make the map blur all of
// its thousands of points with a huge radius.
//
// From zoom 15 a second layer, "cells", holds the 10 m cells where the tent
// fits within maxSlope: the actual spots, for when you've zoomed in on an
// area. (Two layers in one tile is just the two encoded layers one after
// the other, hence the || below.)

const MIN_ZOOM = 7;
const MAX_BIN_ZOOM = 12;
const CELLS_FROM_ZOOM = 15;
const MAX_ZOOM = 16;

export const Route = createFileRoute("/tiles/$z/$x/$y")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const z = Number(params.z);
				const x = Number(params.x);
				const y = Number(params.y);
				const search = new URL(request.url).searchParams;
				const tent = search.get("tent");
				const maxSlope = Number(search.get("maxSlope") || Number.NaN);
				if (!tent || ![z, x, y, maxSlope].every(Number.isFinite)) {
					return new Response("expected /tiles/z/x/y?tent=…&maxSlope=…", {
						status: 400,
					});
				}
				if (z < MIN_ZOOM || z > MAX_ZOOM) {
					return new Response(null, { status: 204 });
				}

				const [row] = await tile(z, x, y, tent, maxSlope);
				return new Response(row.mvt, {
					headers: {
						"Content-Type": "application/vnd.mapbox-vector-tile",
						// Data only changes when the pipeline reloads it.
						"Cache-Control": "public, max-age=3600",
					},
				});
			},
		},
	},
});

function tile(z: number, x: number, y: number, tent: string, maxSlope: number) {
	// Bins double in size with each zoom level out: 80 m at zoom 12, 160 m
	// at 11, … so they always look about the same size on screen.
	const binZoom = Math.min(z, MAX_BIN_ZOOM);
	const binM = 80 * 2 ** (MAX_BIN_ZOOM - binZoom);
	const cellsPerBin = (binM / 10) ** 2;
	return sql`
		WITH tile AS (
			-- The tile's square in Web Mercator, and its extent in UTM 33 bin
			-- numbers (one bin of margin: the square's edges bend a little
			-- when transformed).
			SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS web,
			       ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 25833) AS utm
		),
		scored AS (
			SELECT b.bx, b.by,
			       -- Slope step k covers slopes up to 0.5 k + 0.5 degrees.
			       sum(b.cells * greatest(0, least(1,
			           (${maxSlope} - (0.5 * b.step + 0.5)) / greatest(${maxSlope} - 1, 0.5)
			       ))) / ${cellsPerBin} AS score
			FROM bin b, tile
			-- The ::int casts matter: floor() returns a double, and comparing the
			-- integer bx with a double stops Postgres using the index range.
			WHERE b.tent = ${tent}
			  AND b.zoom = ${binZoom}
			  AND b.bx BETWEEN floor(ST_XMin(tile.utm) / ${binM})::int - 1 AND floor(ST_XMax(tile.utm) / ${binM})::int + 1
			  AND b.by BETWEEN floor(ST_YMin(tile.utm) / ${binM})::int - 1 AND floor(ST_YMax(tile.utm) / ${binM})::int + 1
			GROUP BY b.bx, b.by
		),
		points AS (
			-- The bin's centre, moved to Web Mercator.
			-- Buffer 0: every point lands in exactly one tile. With the default
			-- buffer, points near an edge would be in two tiles and counted twice.
			SELECT ST_AsMVTGeom(
			           ST_Transform(ST_Point((bx + 0.5) * ${binM}, (by + 0.5) * ${binM}, 25833), 3857),
			           tile.web, 4096, 0) AS geom,
			       -- real, not numeric: ST_AsMVT writes numeric values as text.
			       score::real AS score
			FROM scored, tile
			WHERE score > 0
		),
		cells AS (
			-- The cells themselves, found through the primary key (tent, x, y)
			-- with whole-metre ranges. Only from zoom 15: a tile is then about
			-- 1 km across, a few thousand cells at most.
			SELECT ST_AsMVTGeom(
			           ST_Transform(ST_MakeEnvelope(c.x, c.y, c.x + 10, c.y + 10, 25833), 3857),
			           tile.web) AS geom,
			       c.max_slope_deg AS slope
			FROM cell c, tile
			WHERE ${z} >= ${CELLS_FROM_ZOOM}
			  AND c.tent = ${tent}
			  AND c.max_slope_deg <= ${maxSlope}
			  AND c.x BETWEEN floor(ST_XMin(tile.utm))::int - 10 AND floor(ST_XMax(tile.utm))::int
			  AND c.y BETWEEN floor(ST_YMin(tile.utm))::int - 10 AND floor(ST_YMax(tile.utm))::int
		)
		SELECT (SELECT ST_AsMVT(points, 'scores') FROM points)
		    || (SELECT ST_AsMVT(cells, 'cells') FROM cells) AS mvt`;
}

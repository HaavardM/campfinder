import { createFileRoute } from "@tanstack/react-router";

import { sql } from "#/server/db";

// GET /tiles/{z}/{x}/{y}?tent=keron-4-gt&maxSlope=5&v=3.1730900000
// (v only makes the URL unique per data and format version, for caching:
// change TILE_FORMAT in server/tile-version.ts with any change below that
// changes what a tile holds.)
//
// A vector tile (Mapbox Vector Tile format) of points, one per bin, scored
// by how many spots for the tent it has. Built by PostGIS from the cells
// pre-counted per slope step in table `block` (80 m) and view `bin` (larger;
// see db/schema.sql); the map interpolates between the
// points (see lib/flat-layers.ts).
//
// A spot is a 10 m cell where the tent fits within maxSlope. The score is
// the square root of the share of the bin's cells that are spots. A tent
// needs one spot, not a meadow, and at 1–2° a good 80 m bin typically has
// only a handful; the square root lifts those into view: 1 spot in 64 →
// 0.13, 6 → 0.31, a third of the bin → 0.58, all → 1.
//
// Bins exist for zooms 5–12 (zoom 12's are the blocks). Tiles at zooms
// 13–16 use the 80 m bins of zoom 12, but each covers a smaller area, so it
// holds only the points it needs: enlarging one zoom-12 tile instead would
// make the map blur all of its thousands of points with a huge radius.
//
// From zoom 14 a second layer, "areas", holds the spots merged into areas:
// neighbouring spots become one outlined shape, a lone spot a 10 m square.
// (Two layers in one tile is just the two encoded layers one after the
// other, hence the || below.)

const MIN_ZOOM = 5;
const MAX_BIN_ZOOM = 12;
const BLOCK_M = 80; // the blocks: 8 × 8 cells of 10 m, the bins of zoom 12
const AREAS_FROM_ZOOM = 14;
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
						// Keep forever: the tile URL carries the data's and the tile
						// format's versions (see lib/flat-layers.ts), so new data or
						// new code means new URLs, never a stale tile.
						"Cache-Control": "public, max-age=31536000, immutable",
					},
				});
			},
		},
	},
});

// The bins (or blocks) `size` metres across that overlap the tile, by their
// numbers bx and by, plus one of margin: the tile's square bends a little
// when moved to UTM. The ::int casts matter: floor() returns a double, and
// comparing the integer bx with a double stops Postgres using the index.
function nearTile(size: number) {
	return sql`
		b.bx BETWEEN floor(ST_XMin(tile.utm) / ${size})::int - 1 AND floor(ST_XMax(tile.utm) / ${size})::int + 1
		AND b.by BETWEEN floor(ST_YMin(tile.utm) / ${size})::int - 1 AND floor(ST_YMax(tile.utm) / ${size})::int + 1`;
}

function tile(z: number, x: number, y: number, tent: string, maxSlope: number) {
	// Bins double in size with each zoom level out: 80 m at zoom 12, 160 m
	// at 11, … so they always look about the same size on screen.
	const binZoom = Math.min(z, MAX_BIN_ZOOM);
	const binM = BLOCK_M * 2 ** (MAX_BIN_ZOOM - binZoom);
	const cellsPerBin = (binM / 10) ** 2;
	// Each bin's slope step counts: the blocks themselves at zoom 12.
	const bins =
		binZoom === MAX_BIN_ZOOM
			? sql`SELECT bx, by, cells_up_to_step FROM block WHERE tent = ${tent}`
			: sql`SELECT bx, by, cells_up_to_step FROM bin WHERE tent = ${tent} AND zoom = ${binZoom}`;
	return sql`
		WITH tile AS (
			-- The tile's square in Web Mercator and in UTM 33, and the request's
			-- numbers with their types spelled out: parameters arrive untyped,
			-- and Postgres would otherwise guess from context: text for
			-- "z >= 14", where '9' >= '14', and integer division for
			-- "spots / cells", where 6 / 64 = 0.
			SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS web,
			       ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 25833) AS utm,
			       ${z}::int AS z,
			       ${maxSlope}::real AS max_slope,
			       ${cellsPerBin}::real AS cells_per_bin
		),
		scored AS (
			SELECT b.bx, b.by,
			       -- Element k counts the cells up to 0.5 k degrees, so the spots
			       -- are element 2 · maxSlope (the slider moves in 0.5°).
			       sqrt(b.cells_up_to_step[(2 * tile.max_slope)::int] / tile.cells_per_bin) AS score
			FROM (${bins}) b, tile
			WHERE ${nearTile(binM)}
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
		spots AS (
			-- The spots, unpacked from their blocks: byte i of a block is the
			-- cell in column i % 8 and row i / 8, counting from the block's
			-- south-west corner, in tenths of a degree (255: no spot). Only from
			-- zoom 14: a tile is then about 1 km across. The margin of a block
			-- lets areas continue into the tile's buffer, so their outlines
			-- don't stop at its edges.
			SELECT b.bx * ${BLOCK_M} + i % 8 * 10 AS x,
			       b.by * ${BLOCK_M} + i / 8 * 10 AS y
			FROM block b, tile, generate_series(0, 63) AS i
			WHERE tile.z >= ${AREAS_FROM_ZOOM}
			  AND b.tent = ${tent}
			  AND ${nearTile(BLOCK_M)}
			  AND get_byte(b.slopes, i) <= tile.max_slope * 10
		),
		areas AS (
			-- ST_CoverageUnion melts the spots' 10 m squares into polygons, and
			-- ST_Dump splits the result into one row per area. A coverage union
			-- is made for shapes that only touch along shared edges, like grid
			-- squares, and is much faster than a general ST_Union. Merged in
			-- UTM, where the squares line up exactly, then moved to Web
			-- Mercator.
			SELECT ST_AsMVTGeom(ST_Transform(area, 3857), tile.web) AS geom
			FROM (
				SELECT (ST_Dump(ST_CoverageUnion(ST_MakeEnvelope(x, y, x + 10, y + 10, 25833)))).geom AS area
				FROM spots
			) merged, tile
		)
		SELECT (SELECT ST_AsMVT(points, 'scores') FROM points)
		    || (SELECT ST_AsMVT(areas, 'areas') FROM areas) AS mvt`;
}

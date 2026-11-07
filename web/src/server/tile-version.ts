import { createServerFn } from "@tanstack/react-start";

import { sql } from "#/server/db";

// What the tile route's tiles hold: their layers and how they're computed.
// Change it with any such change (see routes/tiles.$z.$x.$y.ts), so
// browsers fetch the new tiles instead of the ones they cached.
const TILE_FORMAT = 4;

// The tiles' version: the format, and when the map's data was last loaded
// (the newest loaded file's time, as recorded by pipeline/04_load_cells.sh).
// It goes into the tile URLs, so they change with either, and browsers can
// keep tiles forever (see lib/flat-layers.ts).
export const getTileVersion = createServerFn().handler(async () => {
	const [row] = await sql<{ loaded: string }[]>`
		SELECT coalesce(max(csv_mtime), 0)::text AS loaded FROM block_load`;
	return `${TILE_FORMAT}.${row.loaded}`;
});

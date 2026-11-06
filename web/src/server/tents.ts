import { createServerFn } from "@tanstack/react-start";

import { sql } from "#/server/db";

export type Tent = { slug: string; name: string };

// The tents the pipeline has computed, for the tent picker.
export const getTents = createServerFn().handler(async (): Promise<Tent[]> => {
	const rows = await sql<Tent[]>`SELECT slug, name FROM tent ORDER BY name`;
	return [...rows];
});

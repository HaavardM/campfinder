import { createFileRoute } from "@tanstack/react-router";

import { sql } from "#/server/db";

// GET /api/health: confirms the app can reach PostGIS.
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () => {
				const [row] = await sql`select postgis_version() as postgis`;
				return Response.json({ ok: true, postgis: row.postgis });
			},
		},
	},
});

import postgres from "postgres";

// One shared connection pool for the server. postgres.js writes queries as
// tagged templates (sql`select ... where id = ${id}`), and every ${value}
// becomes a query parameter, never pasted into the SQL text.
export const sql = postgres(
	process.env.DATABASE_URL ??
		"postgres://campfinder:campfinder@localhost:5432/campfinder",
);

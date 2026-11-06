import postgres from "postgres";

// One shared connection pool for the server. postgres.js writes queries as
// tagged templates (sql`select ... where id = ${id}`), and every ${value}
// becomes a query parameter, never pasted into the SQL text.
//
// Kept on globalThis because the dev server re-runs this module on every
// edit: a new pool each time would leave the old ones' connections open.
// So changes to the options below need a dev server restart.
const globalForDb = globalThis as { sql?: postgres.Sql };
globalForDb.sql ??= postgres(
	process.env.DATABASE_URL ??
		"postgres://campfinder:campfinder@localhost:5432/campfinder",
	{
		// No JIT: Postgres compiles queries it estimates as expensive to
		// machine code first. The tile query looks expensive on paper but
		// runs in ~3 ms; compiling it took ~375 ms, every time.
		connection: { jit: "off" },
	},
);
export const sql = globalForDb.sql;

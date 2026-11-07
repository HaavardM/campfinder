import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import sirv from "sirv";
import { defineConfig, type Plugin } from "vite";

// In development, serve the pipeline's map files at /map (the default
// VITE_MAP_URL), with HTTP range requests as PMTiles needs. Only the dev
// server: a production build never includes them; they're published to the
// R2 bucket separately (pipeline/publish.sh).
function localMapFiles(): Plugin {
	return {
		name: "local-map-files",
		configureServer(server) {
			server.middlewares.use(
				"/map",
				sirv("../pipeline/data/map", { dev: true }),
			);
		},
	};
}

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		localMapFiles(),
		tailwindcss(),
		// SPA mode: `vite build` writes plain static files (an HTML shell plus
		// JavaScript), ready for any static host or bucket. There's no server:
		// the map data are files too (see src/lib/map-data.ts).
		tanstackStart({
			spa: { enabled: true, prerender: { outputPath: "/index.html" } },
		}),
		viteReact(),
	],
});

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
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

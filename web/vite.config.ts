import tailwindcss from "@tailwindcss/vite";
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

// Two pages: the map (/) and the true-size tent viewer (/tent).
export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [localMapFiles(), tailwindcss(), viteReact()],
	build: {
		rollupOptions: {
			input: { map: "index.html", tent: "tent.html" },
		},
	},
});

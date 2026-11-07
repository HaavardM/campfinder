# Campfinder web app

TanStack Start (React) with shadcn/ui and MapLibre, built as a static site.
See the [top-level README](../README.md) to run and publish it, and
[PLAN.md](../PLAN.md) for what the map shows.

- `src/routes/index.tsx`: the map page; its state lives in the URL.
- `src/lib/map-data.ts`: the map's files (`manifest.json` and one PMTiles file
  per tent and season), from `VITE_MAP_URL`.
- `src/lib/flat-layers.ts`: how the map draws them, and the photo links.
- `src/components/map-panel.tsx`: the controls.

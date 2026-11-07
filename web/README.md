# Campfinder web app

TanStack Start (React) with shadcn/ui and MapLibre. See the
[top-level README](../README.md) to run it, and [PLAN.md](../PLAN.md) for
what the map shows.

- `src/routes/index.tsx`: the map page; its state lives in the URL.
- `src/routes/tiles.$z.$x.$y.ts`: vector tiles from PostGIS (the heatmap
  points and the orange areas).
- `src/lib/flat-layers.ts`: how the map draws them, and the photo links.
- `src/components/map-panel.tsx`: the controls.

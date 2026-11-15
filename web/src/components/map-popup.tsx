import { type Map as MaplibreMap, Popup } from "maplibre-gl";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

type LngLat = { lng: number; lat: number };

// Opens a popup at `at` with React content; `render` gets a function that
// closes it. A click elsewhere on the map closes it too. MapLibre owns the
// popup's box, React draws what's inside.
export function openPopup(
	map: MaplibreMap,
	at: LngLat,
	render: (close: () => void) => ReactNode,
) {
	const container = document.createElement("div");
	const root = createRoot(container);
	const popup = new Popup({
		className: "spot-popup",
		closeButton: false,
		maxWidth: "none",
		offset: 8,
	})
		.setLngLat(at)
		.setDOMContent(container)
		.addTo(map);
	// Not straight away: the close can come from a click React is handling.
	popup.on("close", () => queueMicrotask(() => root.unmount()));
	root.render(render(() => popup.remove()));
}

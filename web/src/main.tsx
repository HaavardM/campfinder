import { createRoot } from "react-dom/client";

import "./styles.css";
import { getManifest } from "#/lib/map-data";
import { MapPage } from "#/map-page";

// The manifest says which tents and map files there are; the page needs it
// before it can show anything.
const manifest = await getManifest();
// biome-ignore lint/style/noNonNullAssertion: index.html has it.
createRoot(document.getElementById("root")!).render(
	<MapPage manifest={manifest} />,
);

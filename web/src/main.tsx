import { createRoot } from "react-dom/client";

import "./styles.css";
import { getManifest } from "#/lib/map-data";
import { MapPage } from "#/map-page";

// Dark mode follows the operating system setting (see theme.css).
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const followSystem = () =>
	document.documentElement.classList.toggle("dark", dark.matches);
followSystem();
dark.addEventListener("change", followSystem);

// The manifest says which tents and map files there are; the page needs it
// before it can show anything.
const manifest = await getManifest();
// biome-ignore lint/style/noNonNullAssertion: index.html has it.
createRoot(document.getElementById("root")!).render(
	<MapPage manifest={manifest} />,
);

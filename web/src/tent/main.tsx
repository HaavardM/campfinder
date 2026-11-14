import { createRoot } from "react-dom/client";

import "./styles.css";
import "#/tent/scene";
import { TentPanel } from "#/tent/components/tent-panel";
import { WalkHud } from "#/tent/components/walk-hud";

// The 3D scene draws itself into #scene; React only draws the panel and
// the walking read-out on top.
// biome-ignore lint/style/noNonNullAssertion: tent.html has it.
createRoot(document.getElementById("root")!).render(
	<>
		<TentPanel />
		<WalkHud />
	</>,
);

import { cn } from "cn";
import { useEffect, useState } from "react";

import { type Hud, listeners } from "#/tent/scene";
import { cm } from "#/tent/specs";

// Bottom of the screen while walking, sitting or lying: how much room is
// above your head, or above your face when lying down.
export function WalkHud() {
	const [hud, setHud] = useState<Hud | null>(null);
	useEffect(() => {
		listeners.hud = setHud;
	}, []);
	if (!hud) return null;

	const into = hud.inside && hud.clearance < 0;
	const part = hud.pose === "lying" ? "face" : "head";
	const where = !hud.inside
		? "outside the tent"
		: into
			? `${part} ${cm(-hud.clearance)} into the fabric`
			: `${cm(hud.clearance)} above your ${part}`;

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-3">
			<div
				className={cn(
					"rounded-full border px-4 py-2 text-sm shadow-lg tabular-nums",
					into
						? "border-destructive bg-destructive text-white"
						: "bg-card/90 text-card-foreground backdrop-blur",
				)}
			>
				<span className="font-medium capitalize">{hud.pose}</span> · eyes at{" "}
				{cm(hud.eye)} · {where}
			</div>
			<div className="rounded-full bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
				{hud.looking
					? `${hud.seated ? "Look around" : "WASD to walk"} · Esc frees the mouse`
					: "Click the view to look around"}
			</div>
		</div>
	);
}

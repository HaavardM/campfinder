import { cn } from "cn";
import { useEffect, useState } from "react";

import { controls, type Hud, listeners } from "#/tent/scene";
import { cm } from "#/tent/specs";
import { touchOnly } from "#/tent/touch";
import { Joystick } from "./joystick";

// Bottom of the screen while walking, sitting or lying: how much room is
// above your head, or above your face when lying down.
export function WalkHud() {
	const [hud, setHud] = useState<Hud | null>(null);
	const [gyro, setGyro] = useState(false);
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

	let hint: string;
	if (touchOnly) {
		hint = `${gyro ? "Turn the phone" : "Drag"} to look around`;
		if (!hud.seated) hint += " · joystick to walk";
	} else if (!hud.looking) {
		hint = "Click the view to look around";
	} else {
		hint = `${hud.seated ? "Look around" : "WASD to walk"} · Esc frees the mouse`;
	}

	return (
		<>
			{touchOnly && !hud.seated && <Joystick />}
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
				{/* On a phone, tap the hint to switch between dragging and turning
				the phone to look around. */}
				<button
					type="button"
					className="pointer-events-auto rounded-full bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur disabled:pointer-events-none"
					disabled={!touchOnly}
					onClick={async () => setGyro(await controls.setGyro(!gyro))}
				>
					{hint}
				</button>
			</div>
		</>
	);
}

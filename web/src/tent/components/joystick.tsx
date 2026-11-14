import { cn } from "cn";
import { useEffect, useState } from "react";

import { controls } from "#/tent/scene";

const SIZE = 112; // px across
const REACH = SIZE / 2 - 20; // how far the knob can move from the centre

// An on-screen joystick for walking on a touch screen: push the knob the
// way you want to go, further to go faster.
// `raised` moves it up out of the way of the measurements at the bottom.
export function Joystick(props: { raised: boolean }) {
	const [knob, setKnob] = useState({ x: 0, y: 0 });
	// Gone while still held (another finger switched the view): stop.
	useEffect(() => () => controls.setStick(0, 0), []);

	function move(e: React.PointerEvent<HTMLDivElement>) {
		const box = e.currentTarget.getBoundingClientRect();
		let x = e.clientX - (box.left + box.width / 2);
		let y = e.clientY - (box.top + box.height / 2);
		const length = Math.hypot(x, y);
		if (length > REACH) {
			x *= REACH / length;
			y *= REACH / length;
		}
		setKnob({ x, y });
		// Screen y grows downwards; pushing up is walking forward.
		controls.setStick(x / REACH, -y / REACH);
	}

	function release() {
		setKnob({ x: 0, y: 0 });
		controls.setStick(0, 0);
	}

	return (
		<div
			className={cn(
				"fixed left-[max(--spacing(6),env(safe-area-inset-left))] z-10 touch-none rounded-full border-2 border-white/60 bg-black/25 backdrop-blur-sm",
				props.raised ? "bottom-36" : "bottom-16",
			)}
			style={{ width: SIZE, height: SIZE }}
			onPointerDown={(e) => {
				e.currentTarget.setPointerCapture(e.pointerId);
				move(e);
			}}
			onPointerMove={(e) => {
				if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
			}}
			onPointerUp={release}
			onPointerCancel={release}
			// Touch only; a keyboard walks with WASD.
			aria-hidden="true"
		>
			<div
				className="absolute top-1/2 left-1/2 size-12 rounded-full bg-white/80 shadow"
				style={{
					transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
				}}
			/>
		</div>
	);
}

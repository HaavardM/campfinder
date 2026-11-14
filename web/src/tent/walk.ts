import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { COT, EYES, PEOPLE } from "./specs";

// First person: look with the mouse, and walk with WASD when standing.
// Each view sets the pose: standing, sitting in a chair, or lying on a cot.
// Walk as yourself or as your partner: eye heights scale with height.

export type Pose = keyof typeof EYES;

const SPEED = 1.2; // m/s, an unhurried indoor pace

export type Walk = {
	active: boolean;
	pose: Pose;
	height: number;
	// Height of the cot's bed, for lying down.
	bedHeight: number;
	// Start at floor point `at`, in `pose`, looking at `lookAt`. Seated,
	// you can look round but not walk off.
	enter(
		at: THREE.Vector3,
		lookAt: THREE.Vector3,
		pose: Pose,
		seated: boolean,
	): void;
	exit(): void;
	update(dt: number): void;
	isLocked(): boolean;
};

export function buildWalk(
	camera: THREE.PerspectiveCamera,
	element: HTMLElement,
): Walk {
	const controls = new PointerLockControls(camera, element);
	const keys = new Set<string>();
	let eye = EYES.standing;
	let seated = false;

	function targetEye() {
		if (walk.pose === "lying") return walk.bedHeight + EYES.lying;
		return (EYES[walk.pose] * walk.height) / PEOPLE.you;
	}

	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const move = new THREE.Vector3();

	const walk: Walk = {
		active: false,
		pose: "standing",
		height: PEOPLE.you,
		bedHeight: COT.heightLow,
		enter(at, lookAt, pose, sit) {
			walk.active = true;
			walk.pose = pose;
			seated = sit;
			eye = targetEye();
			camera.position.set(at.x, eye, at.z);
			camera.lookAt(lookAt);
			// Browsers only let a page grab the mouse right after a click;
			// otherwise wait for the click on the view.
			if (navigator.userActivation?.isActive) controls.lock();
		},
		exit() {
			walk.active = false;
			controls.unlock();
		},
		update(dt) {
			if (!walk.active) return;
			if (!seated) {
				camera.getWorldDirection(forward);
				forward.y = 0;
				forward.normalize();
				right.set(-forward.z, 0, forward.x);
				move.set(0, 0, 0);
				if (keys.has("KeyW")) move.add(forward);
				if (keys.has("KeyS")) move.sub(forward);
				if (keys.has("KeyD")) move.add(right);
				if (keys.has("KeyA")) move.sub(right);
				if (move.lengthSq() > 0) {
					camera.position.addScaledVector(move.normalize(), SPEED * dt);
				}
			}
			// Ease towards the eye height of the chosen pose.
			eye += (targetEye() - eye) * Math.min(1, dt * 6);
			camera.position.y = eye;
		},
		isLocked: () => controls.isLocked,
	};

	window.addEventListener("keydown", (e) => {
		if (!walk.active) return;
		keys.add(e.code);
		// In full screen with Esc kept for the page (see useFullscreen), the
		// browser no longer frees the mouse itself.
		if (e.code === "Escape" && controls.isLocked) controls.unlock();
	});
	window.addEventListener("keyup", (e) => keys.delete(e.code));
	// Click the view to grab the mouse again after Esc.
	element.addEventListener("click", () => {
		if (walk.active && !controls.isLocked) controls.lock();
	});
	return walk;
}

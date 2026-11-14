import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { COT, EYES, PEOPLE } from "./specs";
import { touchOnly } from "./touch";

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
	// The on-screen joystick on a touch screen: x to the right, y forward,
	// each from -1 to 1.
	setStick(x: number, y: number): void;
	// Look around by turning the phone itself. Resolves to whether it is
	// on: iPhones ask for permission first, which needs a tap.
	setGyro(on: boolean): Promise<boolean>;
};

// The phone's tilt as the browser reports it, in degrees.
type Orientation = { alpha: number; beta: number; gamma: number };

// iPhones ask before giving a page the phone's tilt; the method is missing
// from the DOM types.
type AskingOrientationEvent = typeof DeviceOrientationEvent & {
	requestPermission?: () => Promise<"granted" | "denied">;
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

	const stick = new THREE.Vector2();
	const forward = new THREE.Vector3();
	const right = new THREE.Vector3();
	const move = new THREE.Vector3();

	// Gyro look. The browser gives the phone's tilt as angles from lying
	// flat, screen up, with its top pointing at alpha. Turn that into where
	// the back camera would point, then turn the whole world by `heading` so
	// that switching it on, or a new view, keeps the way you were looking.
	let gyro = false;
	let tilt: Orientation | null = null;
	let heading: number | null = null;
	const phone = new THREE.Quaternion();
	const phoneEuler = new THREE.Euler();
	// Lying flat the screen faces up; the camera should look out of the back
	// of the phone held upright, so tip it up 90° about its side.
	const upright = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
	const screenTurn = new THREE.Quaternion();
	const yAxis = new THREE.Vector3(0, 1, 0);
	const zAxis = new THREE.Vector3(0, 0, 1);
	const look = new THREE.Euler(0, 0, 0, "YXZ");
	// Only listened to while gyro look is on: on Android the sensors run as
	// long as anyone listens.
	function readTilt(e: DeviceOrientationEvent) {
		if (e.alpha === null || e.beta === null || e.gamma === null) return;
		tilt = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
	}

	function lookWithPhone() {
		if (!tilt) return;
		const d = THREE.MathUtils.degToRad;
		phoneEuler.set(d(tilt.beta), d(tilt.alpha), -d(tilt.gamma), "YXZ");
		phone.setFromEuler(phoneEuler).multiply(upright);
		// Held sideways, the screen is turned against the phone.
		const angle = d(screen.orientation?.angle ?? 0);
		phone.multiply(screenTurn.setFromAxisAngle(zAxis, -angle));
		if (heading === null) {
			const want = look.setFromQuaternion(camera.quaternion).y;
			heading = want - look.setFromQuaternion(phone).y;
		}
		camera.quaternion.setFromAxisAngle(yAxis, heading).multiply(phone);
	}

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
			heading = null;
			if (gyro) window.addEventListener("deviceorientation", readTilt);
			// Browsers only let a page grab the mouse right after a click;
			// otherwise wait for the click on the view. Touch screens look by
			// dragging instead.
			if (!touchOnly && navigator.userActivation?.isActive) controls.lock();
		},
		exit() {
			walk.active = false;
			controls.unlock();
			// Gyro look stays chosen for next time, but the sensors can rest.
			window.removeEventListener("deviceorientation", readTilt);
		},
		update(dt) {
			if (!walk.active) return;
			if (gyro) lookWithPhone();
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
				move.addScaledVector(forward, stick.y).addScaledVector(right, stick.x);
				// Full speed at full stick, slower with the stick part way.
				if (move.lengthSq() > 0) {
					camera.position.addScaledVector(move.clampLength(0, 1), SPEED * dt);
				}
			}
			// Ease towards the eye height of the chosen pose.
			eye += (targetEye() - eye) * Math.min(1, dt * 6);
			camera.position.y = eye;
		},
		isLocked: () => controls.isLocked,
		setStick(x, y) {
			stick.set(x, y);
		},
		async setGyro(on) {
			const event = DeviceOrientationEvent as AskingOrientationEvent;
			if (on && event.requestPermission) {
				// Rejects rather than says no on an insecure page, or when the
				// tap that asked was too long ago.
				const answer = await event.requestPermission().catch(() => "denied");
				if (answer !== "granted") return false;
			}
			if (on) window.addEventListener("deviceorientation", readTilt);
			else window.removeEventListener("deviceorientation", readTilt);
			gyro = on;
			tilt = null;
			heading = null;
			return on;
		},
	};

	window.addEventListener("keydown", (e) => {
		if (!walk.active) return;
		keys.add(e.code);
		// In full screen with Esc kept for the page (see useFullscreen), the
		// browser no longer frees the mouse itself.
		if (e.code === "Escape" && controls.isLocked) controls.unlock();
	});
	window.addEventListener("keyup", (e) => keys.delete(e.code));
	// A key let go in another window never sends its keyup here.
	window.addEventListener("blur", () => keys.clear());
	// Click the view to grab the mouse again after Esc.
	element.addEventListener("click", () => {
		if (!touchOnly && walk.active && !controls.isLocked) controls.lock();
	});

	// On a touch screen, drag a finger across the view to look around:
	// sideways turns, up and down tilts, as far as straight up or down.
	// With gyro look the phone tilts; a drag only turns you round. Only the
	// first finger looks; a second one resting on the screen is ignored.
	let last: { id: number; x: number; y: number } | null = null;
	element.addEventListener("pointerdown", (e) => {
		if (!walk.active || e.pointerType !== "touch" || last) return;
		last = { id: e.pointerId, x: e.clientX, y: e.clientY };
		element.setPointerCapture(e.pointerId);
	});
	element.addEventListener("pointermove", (e) => {
		if (e.pointerId !== last?.id) return;
		const dx = (e.clientX - last.x) * 0.005;
		const dy = (e.clientY - last.y) * 0.005;
		if (gyro && heading !== null) {
			heading += dx;
		} else {
			look.setFromQuaternion(camera.quaternion);
			look.y += dx;
			look.x = THREE.MathUtils.clamp(look.x + dy, -Math.PI / 2, Math.PI / 2);
			// Level: no roll left over from holding the phone tilted.
			look.z = 0;
			camera.quaternion.setFromEuler(look);
		}
		last = { id: e.pointerId, x: e.clientX, y: e.clientY };
	});
	function letGo(e: PointerEvent) {
		if (e.pointerId === last?.id) last = null;
	}
	element.addEventListener("pointerup", letGo);
	element.addEventListener("pointercancel", letGo);
	return walk;
}

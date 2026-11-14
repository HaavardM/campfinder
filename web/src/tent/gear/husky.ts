import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { noise } from "../noise";
import { item, solid, v3 } from "./common";

// A Siberian husky asleep, curled up nose to tail the way they do in the
// cold. An adult is 50–60 cm at the shoulder and 20–27 kg; curled up it
// takes about 60 × 45 cm of floor and is about 22 cm high at the haunch.
//
// The body is one smooth surface grown from overlapping soft blobs
// (metaballs): spine, haunch, chest, head, muzzle, paws and tail each a few
// blobs, which melt into each other like a real curled-up dog. Each blob
// also carries a coat colour, blended across the surface: beige-brown saddle,
// white belly, chest, legs and face mask.

const COAT = new THREE.Color("#b08a5f"); // beige-brown coat
const DARK = new THREE.Color("#8a6440"); // darker brown back, cap and ears
const WHITE = new THREE.Color("#ece8e1");

// A blob of the body (`shape`), or only a marker that steers the coat
// colour round it without adding any volume.
type Blob = {
	at: THREE.Vector3;
	radius: number;
	colour: THREE.Color;
	shape: boolean;
};

// The curl: an oval round the dog's middle. `angle` goes round it from the
// rump (about -2) along the back to the shoulders (about 1.8); `out` is how
// far from the middle, `y` how high.
const curl = (angle: number, out: number, y: number) =>
	v3(Math.cos(angle) * out * 1.15, y, Math.sin(angle) * out * 0.9);

// Where the head rests and which way the nose points: tucked into the
// inside of the curl, chin on the front paws, nose towards the rump.
const HEAD = curl(2.55, 0.14, 0.12);
const NOSE = curl(-2.8, 0.3, 0.12).sub(HEAD).setY(0).normalize();
const SIDE = v3(-NOSE.z, 0, NOSE.x);

// A point by the head: `sideways` and `forward` along the face, `y` metres
// above the floor.
const fromHead = (sideways: number, forward: number, y: number) =>
	HEAD.clone()
		.addScaledVector(SIDE, sideways)
		.addScaledVector(NOSE, forward)
		.setY(y);

function blobs(): Blob[] {
	const list: Blob[] = [];
	const body = (at: THREE.Vector3, radius: number, colour: THREE.Color) =>
		list.push({ at, radius, colour, shape: true });
	const marker = (at: THREE.Vector3, radius: number, colour: THREE.Color) =>
		list.push({ at, radius, colour, shape: false });

	// The body: a tight, thick curl, so from above it is a solid bean with
	// no hole, highest over the haunch and lower towards the shoulders.
	// Coat: beige-brown, darker along the spine; the white belly is below.
	for (let i = 0; i <= 8; i++) {
		const t = i / 8;
		const a = -2.05 + t * 3.75;
		const r = 0.1 - 0.025 * t;
		body(curl(a, 0.13, 0.095 - 0.02 * t), r, COAT);
		marker(curl(a, 0.2, 0.2 - 0.04 * t), 0.07, DARK);
	}
	// The inside of the curl, filled by the belly and folded legs: white.
	body(v3(0, 0.055, 0), 0.085, WHITE);
	// The haunch: the high, round hip over the folded hind leg, and the hind
	// paw sticking out by the tail.
	body(curl(-1.55, 0.17, 0.12), 0.095, COAT);
	body(curl(-2.45, 0.27, 0.03), 0.032, WHITE);
	// White chest and the front legs, tucked forward under the chin.
	body(curl(1.95, 0.1, 0.06), 0.065, WHITE);
	for (const s of [-1, 1]) {
		for (let k = 0; k <= 4; k++) {
			body(fromHead(s * 0.04, -0.04 + k * 0.03, 0.022), 0.024, WHITE);
		}
	}

	// The neck, flowing from the shoulders up into the back of the head.
	const shoulder = curl(1.7, 0.13, 0.075);
	for (const t of [0.33, 0.66]) {
		body(
			shoulder
				.clone()
				.lerp(HEAD, t)
				.setY(0.09 + 0.02 * t),
			0.068,
			COAT,
		);
	}

	// Head: beige-brown skull with a darker cap, white cheeks and muzzle, a
	// beige-brown bridge down the nose.
	body(HEAD.clone(), 0.062, COAT);
	marker(fromHead(0, -0.02, 0.17), 0.05, DARK);
	for (const s of [-1, 1]) body(fromHead(s * 0.034, 0.03, 0.08), 0.036, WHITE);
	// The snout: a smooth taper, closely spaced so it blends into one shape.
	for (let k = 0; k <= 6; k++) {
		const t = k / 6;
		body(
			fromHead(0, 0.05 + 0.1 * t, 0.082 - 0.012 * t),
			0.036 - 0.014 * t,
			WHITE,
		);
	}
	marker(fromHead(0, 0.08, 0.115), 0.025, COAT);

	// The thick, bushy tail: from the rump round the outside of the haunch
	// and across in front of the face, resting on the floor; white tip.
	const tail = new THREE.CatmullRomCurve3([
		curl(-1.95, 0.19, 0.1),
		curl(-2.4, 0.24, 0.06),
		curl(-2.85, 0.27, 0.045),
		curl(-3.25, 0.26, 0.045),
	]);
	const steps = 10;
	for (let k = 0; k <= steps; k++) {
		const t = k / steps;
		const r = 0.038 + 0.014 * Math.sin(Math.PI * t);
		body(tail.getPoint(t), r, t > 0.8 ? WHITE : COAT);
	}
	return list;
}

// Grow the surface: blobs into a field, the field into triangles, then copy
// the triangles out so the large working grid can be dropped.
function surface(list: Blob[]): THREE.BufferGeometry {
	// Cells small enough (SPAN / CELLS, about 7 mm) for the snout and ears.
	const SPAN = 0.82; // metres the grid covers along each axis
	const CELLS = 120;
	const CENTRE = v3(0, 0.15, 0);
	const SUBTRACT = 150; // a short blend range: each part keeps its shape
	const field = new MarchingCubes(
		CELLS,
		new THREE.MeshBasicMaterial(),
		false,
		false,
		50000,
	);
	for (const { at, radius, shape } of list) {
		if (!shape) continue;
		// A lone blob's surface is where strength / d² - subtract = isolation.
		const d = radius / SPAN;
		const strength = d * d * (field.isolation + SUBTRACT);
		const b = at.clone().sub(CENTRE).divideScalar(SPAN).addScalar(0.5);
		field.addBall(b.x, b.y, b.z, strength, SUBTRACT);
	}
	field.update();

	const values = (name: string) =>
		(field.geometry.getAttribute(name).array as Float32Array).slice(
			0,
			field.count * 3,
		);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(values("position"), 3),
	);
	geometry.setAttribute(
		"normal",
		new THREE.Float32BufferAttribute(values("normal"), 3),
	);
	field.geometry.dispose();
	// Grid units (-1..1) to metres in the dog's own space.
	geometry.scale(SPAN / 2, SPAN / 2, SPAN / 2);
	geometry.translate(CENTRE.x, CENTRE.y, CENTRE.z);
	return mergeVertices(geometry, 1e-5);
}

// Coat colour at each vertex: the nearby blobs' colours, weighted by how
// close they are, with a little noise so it reads as fur, not plastic.
function paint(geometry: THREE.BufferGeometry, list: Blob[]) {
	const pos = geometry.getAttribute("position");
	const colours = new Float32Array(pos.count * 3);
	const p = new THREE.Vector3();
	const c = new THREE.Color();
	for (let i = 0; i < pos.count; i++) {
		p.fromBufferAttribute(pos, i);
		c.setRGB(0, 0, 0);
		let total = 0;
		for (const blob of list) {
			const near = 1 - p.distanceTo(blob.at) / (blob.radius * 1.8);
			if (near <= 0) continue;
			const w = near ** 3;
			c.r += blob.colour.r * w;
			c.g += blob.colour.g * w;
			c.b += blob.colour.b * w;
			total += w;
		}
		if (total > 0) c.multiplyScalar(1 / total);
		else c.copy(COAT);
		c.multiplyScalar(
			0.9 + 0.2 * noise(p.x * 60 + p.y * 40, p.z * 60 - p.y * 40, 3),
		);
		c.toArray(colours, i * 3);
	}
	geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

export function husky() {
	const dog = item(
		"Sleeping Siberian husky",
		"about 60 × 45 cm curled up",
		[0.6, 0.45],
	);
	const list = blobs();
	const body = surface(list);
	paint(body, list);
	dog.add(
		solid(
			new THREE.Mesh(
				body,
				new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
			),
		),
	);

	// Pointed ears folded back, closed eyes and a black nose: small sharp
	// details the soft surface can't make.
	const ear = new THREE.MeshStandardMaterial({ color: DARK, roughness: 1 });
	const black = new THREE.MeshStandardMaterial({
		color: "#141414",
		roughness: 0.4,
	});
	for (const s of [-1, 1]) {
		const e = solid(
			new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.06, 4), ear),
		);
		e.position.copy(fromHead(s * 0.035, -0.03, 0.19));
		e.quaternion.setFromUnitVectors(
			v3(0, 1, 0),
			v3(0, 1, 0)
				.addScaledVector(NOSE, -0.7)
				.addScaledVector(SIDE, s * 0.25)
				.normalize(),
		);
		const eye = solid(
			new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.018, 2, 6), black),
		);
		eye.position.copy(fromHead(s * 0.028, 0.05, 0.148));
		eye.quaternion.setFromUnitVectors(v3(0, 1, 0), SIDE);
		dog.add(e, eye);
	}
	const tip = solid(
		new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), black),
	);
	tip.position.copy(fromHead(0, 0.155, 0.072));
	dog.add(tip);

	// Turn the whole dog so his nose points along +x, the front of every
	// item, so the layout can turn him to face something.
	const turn = Math.atan2(NOSE.z, NOSE.x);
	for (const part of dog.children) {
		part.position.applyAxisAngle(v3(0, 1, 0), turn);
		part.rotateOnWorldAxis(v3(0, 1, 0), turn);
	}
	return dog;
}

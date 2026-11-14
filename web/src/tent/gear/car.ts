import * as THREE from "three";
import { box, cylinder, item, rod, rubber, solid, v3 } from "./common";

// An estate car at the size of a Subaru Outback (6th generation, 2020–25):
// 4.87 m long, 1.875 m wide, 1.675 m high with roof rails, 2.745 m
// wheelbase, 21 cm ground clearance, 225/60 R18 tyres. A generic shape at
// that size, for scale next to the tent. The front is +x.

const LENGTH = 4.87;
const WIDTH = 1.875;
const WHEELBASE = 2.745;
const FRONT_AXLE = LENGTH / 2 - 0.95; // 95 cm front overhang
const REAR_AXLE = FRONT_AXLE - WHEELBASE;
const TYRE_RADIUS = (0.457 + 2 * 0.135) / 2; // 18" rim + 60 % of 225 mm, twice
const TYRE_WIDTH = 0.225;

// The car seen from the side: bumper, bonnet, windscreen, roof, tailgate.
const PROFILE: [number, number][] = [
	[2.36, 0.3],
	[2.435, 0.5],
	[2.41, 0.76],
	[2.2, 0.9],
	[1.05, 1.0],
	[0.15, 1.55],
	[-1.9, 1.58],
	[-2.3, 1.5],
	[-2.42, 1.08],
	[-2.43, 0.55],
	[-2.36, 0.3],
];

// The glass, just proud of the body along the windscreen and tailgate, and
// a little wider so it shows on the sides.
const GLASS: [number, number][] = [
	[1.0, 1.04],
	[0.14, 1.565],
	[-1.88, 1.585],
	[-2.31, 1.51],
	[-2.425, 1.1],
	[-2.3, 1.07],
	[0.95, 1.03],
];

function extrude(
	points: [number, number][],
	depth: number,
	material: THREE.Material,
	bevel: number,
) {
	const shape = new THREE.Shape(
		points.map(([x, y]) => new THREE.Vector2(x, y)),
	);
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: depth - 2 * bevel,
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelSegments: 4,
		curveSegments: 4,
	});
	geometry.translate(0, 0, -(depth - 2 * bevel) / 2);
	return solid(new THREE.Mesh(geometry, material));
}

export function car() {
	const result = item(
		"Estate car, Subaru Outback size",
		"487 × 188 cm, 168 cm high",
		[LENGTH, WIDTH],
	);
	const paint = new THREE.MeshPhysicalMaterial({
		color: "#2f4a3c",
		metalness: 0.5,
		roughness: 0.35,
		clearcoat: 1,
		clearcoatRoughness: 0.1,
	});
	const glass = new THREE.MeshPhysicalMaterial({
		color: "#15191d",
		metalness: 0.2,
		roughness: 0.05,
		clearcoat: 1,
	});
	const black = new THREE.MeshStandardMaterial({
		color: "#1a1b1c",
		roughness: 0.7,
	});

	result.add(extrude(PROFILE, 1.79, paint, 0.05));
	result.add(extrude(GLASS, 1.72, glass, 0.03));

	// Pillars between the side windows, in body colour.
	for (const side of [-1, 1]) {
		for (const [x, top] of [
			[-0.62, 1.565],
			[-1.88, 1.58],
		]) {
			const pillar = box(0.1, top - 1.05, 0.02, paint);
			pillar.position.set(x, (top + 1.05) / 2, side * 0.865);
			result.add(pillar);
		}
	}

	// Black plastic cladding along the sills and round the wheel arches,
	// as on rugged estates.
	const sill = box(
		WHEELBASE - 2 * TYRE_RADIUS - 0.1,
		0.14,
		WIDTH - 0.02,
		black,
		0.03,
	);
	sill.position.set((FRONT_AXLE + REAR_AXLE) / 2, 0.35, 0);
	result.add(sill);
	for (const x of [FRONT_AXLE, REAR_AXLE]) {
		for (const side of [-1, 1]) {
			const arch = solid(
				new THREE.Mesh(
					new THREE.TorusGeometry(TYRE_RADIUS + 0.06, 0.04, 8, 24, Math.PI),
					black,
				),
			);
			arch.position.set(x, TYRE_RADIUS, side * (WIDTH / 2 - 0.03));
			arch.scale.z = 1.4;
			result.add(arch);
			result.add(wheel(x, side));
		}
	}

	// Roof rails on short posts, which make up the full 1.675 m height.
	for (const side of [-1, 1]) {
		const z = side * 0.62;
		result.add(rod(v3(0.0, 1.645, z), v3(-1.95, 1.645, z), 0.016, black));
		for (const x of [-0.05, -1.9]) {
			const post = box(0.06, 0.07, 0.04, black, 0.01);
			post.position.set(x, 1.6, z);
			result.add(post);
		}
	}

	// Lights, grille, mirrors and number plates (blank).
	const headlight = new THREE.MeshStandardMaterial({
		color: "#e8eef2",
		emissive: "#dfe8ff",
		emissiveIntensity: 0.3,
		roughness: 0.1,
	});
	const taillight = new THREE.MeshStandardMaterial({
		color: "#7a1010",
		emissive: "#ff2020",
		emissiveIntensity: 0.25,
		roughness: 0.2,
	});
	const plate = new THREE.MeshStandardMaterial({
		color: "#f2f2ee",
		roughness: 0.5,
	});
	for (const side of [-1, 1]) {
		const head = box(0.08, 0.1, 0.32, headlight, 0.02);
		head.position.set(2.39, 0.78, side * 0.62);
		const tail = box(0.06, 0.2, 0.22, taillight, 0.02);
		tail.position.set(-2.415, 1.0, side * 0.7);
		const mirror = box(0.14, 0.12, 0.2, paint, 0.03);
		mirror.position.set(0.95, 1.1, side * 0.98);
		result.add(head, tail, mirror);
	}
	const grille = box(0.04, 0.24, 1.0, black, 0.02);
	grille.position.set(2.42, 0.62, 0);
	const frontPlate = box(0.01, 0.11, 0.52, plate);
	frontPlate.position.set(2.445, 0.42, 0);
	const rearPlate = box(0.01, 0.11, 0.52, plate);
	rearPlate.position.set(-2.44, 0.72, 0);
	const bumper = box(0.12, 0.16, 1.7, black, 0.04);
	bumper.position.set(-2.38, 0.38, 0);
	result.add(grille, frontPlate, rearPlate, bumper);
	return result;
}

function wheel(x: number, side: number): THREE.Group {
	const group = new THREE.Group();
	const rim = new THREE.MeshStandardMaterial({
		color: "#8d9196",
		metalness: 0.8,
		roughness: 0.3,
	});
	const tyre = solid(
		new THREE.Mesh(
			new THREE.TorusGeometry(TYRE_RADIUS - 0.07, 0.09, 12, 32),
			rubber,
		),
	);
	tyre.scale.z = TYRE_WIDTH / 0.18;
	const disc = cylinder(0.457 / 2, TYRE_WIDTH - 0.04, rim);
	disc.rotation.x = Math.PI / 2;
	// Spokes on the outer face.
	for (let i = 0; i < 5; i++) {
		const a = (i / 5) * Math.PI * 2;
		const spoke = box(0.2, 0.035, 0.02, rim);
		spoke.position.set(
			Math.cos(a) * 0.1,
			Math.sin(a) * 0.1,
			side * (TYRE_WIDTH / 2 - 0.01),
		);
		spoke.rotation.z = a;
		group.add(spoke);
	}
	group.add(tyre, disc);
	group.position.set(x, TYRE_RADIUS, side * (WIDTH / 2 - TYRE_WIDTH / 2));
	return group;
}

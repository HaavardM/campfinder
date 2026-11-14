import * as THREE from "three";
import { COT, cm } from "../specs";
import { quilt, tiled } from "../textures";
import {
	aluminium,
	box,
	fabric,
	item,
	rubber,
	sheet,
	solid,
	tube,
	v3,
} from "./common";

// Helinox Cot One Convertible Long. Two side poles run through sleeves sewn
// into the fabric; end bars spread the poles and tension the fabric; bowed
// leg frames clip under the poles. The head end is +x.

export function cot(withLegExtensions: boolean, bagColour: string) {
	const { length, width, legFrames } = COT;
	const h = withLegExtensions ? COT.heightWithLegs : COT.heightLow;
	const cot = item(
		"Helinox Cot One Convertible Long",
		`${Math.round(length * 100)} × ${cm(width)}, ${cm(h)} high`,
		[length, width],
	);
	const w = width / 2;
	const rail = 0.0125; // pole radius

	// Side poles, slightly shorter than the cot so the end bars wrap them.
	for (const side of [-1, 1]) {
		cot.add(
			tube(
				[
					v3(-length / 2 + 0.03, h, side * w),
					v3(length / 2 - 0.03, h, side * w),
				],
				rail,
			),
		);
	}

	// End bars: bent slightly upwards, they push the poles apart.
	for (const end of [-1, 1]) {
		const x = end * (length / 2 - 0.02);
		cot.add(tube([v3(x, h, -w), v3(x, h + 0.015, 0), v3(x, h, w)], 0.011));
	}

	// The bed: dark fabric that sags a few centimetres in the middle and
	// wraps up round the poles at the sides.
	const bedFabric = fabric("#2b2d2f");
	cot.add(
		sheet(
			(u, s) => {
				const x = (u - 0.5) * (length - 0.06);
				const z = (s - 0.5) * 2 * w;
				const across = Math.sin(Math.PI * s);
				const along = Math.sin(Math.PI * u) ** 0.3;
				return v3(x, h - 0.03 * across * along, z);
			},
			48,
			16,
			bedFabric,
		),
	);
	// Sleeves round the side poles.
	for (const side of [-1, 1]) {
		const sleeve = solid(
			new THREE.Mesh(
				new THREE.CylinderGeometry(
					rail + 0.004,
					rail + 0.004,
					length - 0.08,
					16,
				),
				bedFabric,
			),
		);
		sleeve.rotation.z = Math.PI / 2;
		sleeve.position.set(0, h, side * w);
		cot.add(sleeve);
	}

	// Leg frames: each a bow from one pole down to the ground and back up
	// to the other, with rubber feet where it touches.
	for (let i = 0; i < legFrames; i++) {
		const x = -length / 2 + 0.15 + (i * (length - 0.3)) / (legFrames - 1);
		cot.add(
			tube(
				[
					v3(x, h - rail, -w),
					v3(x, h * 0.45, -w + 0.02),
					v3(x, 0.012, -w + 0.09),
					v3(x, 0.02, 0),
					v3(x, 0.012, w - 0.09),
					v3(x, h * 0.45, w - 0.02),
					v3(x, h - rail, w),
				],
				0.0085,
			),
		);
		for (const side of [-1, 1]) {
			const foot = box(0.03, 0.012, 0.05, rubber, 0.005);
			foot.position.set(x, 0.006, side * (w - 0.09));
			cot.add(foot);
		}
		// Clips that hold the frame to the poles.
		for (const side of [-1, 1]) {
			const clip = box(0.035, 0.03, 0.03, aluminium, 0.006);
			clip.position.set(x, h - 0.008, side * w);
			cot.add(clip);
		}
	}

	cot.add(...bed(h, bagColour));
	return cot;
}

// A sleeping pad and a down mummy bag, so the cot reads as a bed.
function bed(h: number, bagColour: string): THREE.Object3D[] {
	const top = h + 0.005;
	const pad = box(
		1.95,
		0.06,
		0.6,
		new THREE.MeshStandardMaterial({
			color: "#3d5a73",
			roughness: 0.8,
			// Insulated channels across the pad, about 16 cm apart.
			bumpMap: tiled(quilt(), 12, 1),
			bumpScale: 1,
		}),
		0.025,
	);
	pad.position.set(0, top + 0.03, 0);

	const bagMaterial = new THREE.MeshStandardMaterial({
		color: bagColour,
		roughness: 0.55,
		bumpMap: quilt(),
		bumpScale: 2,
		side: THREE.DoubleSide,
	});
	const bag = mummyBag(bagMaterial);
	bag.position.set(-0.02, top + 0.06, 0);

	return [pad, bag];
}

// A mummy bag: wide at the shoulders, narrow at the feet, with a hood.
// Built from oval slices along its length; the underside is flattened
// where it lies on the pad.
function mummyBag(material: THREE.Material): THREE.Mesh {
	const length = 2.05; // long size, for someone 195 cm tall
	// Half width and loft along the bag, foot (0) to head (1).
	const halfWidth = (t: number) =>
		t < 0.8
			? 0.17 + 0.12 * Math.sin((t / 0.8) * (Math.PI / 2))
			: 0.29 - 0.12 * ((t - 0.8) / 0.2) ** 2;
	const loft = (t: number) =>
		t < 0.85 ? 0.1 + 0.05 * Math.sin(t * Math.PI) : 0.13;
	// Rounded ends.
	const endCap = (t: number) =>
		Math.sqrt(Math.max(0, 1 - (Math.abs(t - 0.5) * 2) ** 12));

	return sheet(
		(u, s) => {
			const x = (u - 0.5) * length;
			const a = s * Math.PI * 2;
			const cap = endCap(u);
			const z = Math.cos(a) * halfWidth(u) * cap;
			const up = Math.sin(a);
			const y = (up > 0 ? up * loft(u) : up * 0.02) * cap;
			return v3(x, y, z);
		},
		64,
		32,
		material,
	);
}

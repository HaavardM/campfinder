import * as THREE from "three";
import { cm } from "../specs";
import { tiled, weave } from "../textures";
import { box, item, rod, solid, v3 } from "./common";

// A person `height` metres tall, sitting in a camp chair and facing +x:
// hips on the sling about 31 cm up, thighs rising to the knees, shins down
// to the floor, leaning back a little with the forearms on the thighs.
// Joint heights are fractions of standing height from standard
// anthropometric tables (Drillis & Contini), so a 180 cm person is a scaled
// 195 cm one. Widths scale too.
const JOINTS = {
	ankle: 0.039,
	knee: 0.285,
	hip: 0.53,
	waist: 0.6,
	chest: 0.72,
	shoulder: 0.818,
	chin: 0.87,
};

export function person(name: string, height: number, coat: string) {
	const H = height;
	const k = H / 1.95; // widths and limb thickness scale with height
	const human = item(name, `${cm(H)} tall, sitting`, [0.75, 0.5]);

	const jacket = new THREE.MeshStandardMaterial({
		color: coat,
		roughness: 0.6,
		bumpMap: tiled(weave(), 20, 20),
		bumpScale: 0.3,
	});
	const trousers = new THREE.MeshStandardMaterial({
		color: "#2e3238",
		roughness: 0.85,
		bumpMap: tiled(weave(), 20, 20),
		bumpScale: 0.3,
	});
	const skin = new THREE.MeshStandardMaterial({
		color: "#d9b195",
		roughness: 0.7,
	});
	const boots = new THREE.MeshStandardMaterial({
		color: "#3b2a1e",
		roughness: 0.6,
	});
	const wool = new THREE.MeshStandardMaterial({
		color: "#c8b48a",
		roughness: 1,
	});

	const y = (f: number) => f * H;
	const hipZ = 0.09 * k;
	const shoulderZ = 0.2 * k;

	// Hip, knee and ankle: the thigh and shin keep their standing lengths but
	// fold at the knee, with the shin nearly upright.
	const thigh = y(JOINTS.hip - JOINTS.knee);
	const shin = y(JOINTS.knee - JOINTS.ankle);
	const ankleY = y(JOINTS.ankle) + 0.03;
	const hip = v3(-0.05, 0.31 + 0.11 * k, 0);
	const kneeY = ankleY + Math.sqrt(shin ** 2 - 0.06 ** 2);
	const forward = Math.sqrt(Math.max(thigh ** 2 - (kneeY - hip.y) ** 2, 0));
	const knee = v3(hip.x + forward, kneeY, 0);
	const ankle = v3(knee.x + 0.06, ankleY, 0);

	// Legs: thigh and shin, a little thicker at the top.
	for (const side of [-1, 1]) {
		const z = side * hipZ;
		const at = (p: THREE.Vector3, squeeze: number) =>
			p.clone().setZ(z * squeeze);
		human.add(rod(at(hip, 1), at(knee, 0.95), 0.07 * k, trousers));
		human.add(rod(at(knee, 0.95), at(ankle, 0.9), 0.05 * k, trousers));
		const boot = box(0.3 * k, 0.1 * k, 0.11 * k, boots, 0.035 * k);
		boot.position.set(ankle.x + 0.05 * k, 0.05 * k, z * 0.9);
		human.add(boot);
	}

	// Everything above the hips is built as if standing, in `upper`, then
	// hung from the hip joint leaning back a little.
	const upper = new THREE.Group();
	upper.position.y = -y(JOINTS.hip);
	const pivot = new THREE.Group();
	pivot.position.copy(hip);
	pivot.rotation.z = 0.2;
	pivot.add(upper);
	human.add(pivot);

	// Torso: turned on a lathe from a side profile, then flattened front to
	// back. Hips, waist, chest, shoulders.
	const profile = [
		[0.0, JOINTS.hip - 0.04],
		[0.15, JOINTS.hip - 0.03],
		[0.17, JOINTS.hip + 0.02],
		[0.15, JOINTS.waist],
		[0.18, JOINTS.chest],
		[0.2, JOINTS.shoulder - 0.03],
		[0.12, JOINTS.shoulder + 0.01],
		[0.06, JOINTS.shoulder + 0.02],
	].map(([r, f]) => new THREE.Vector2(r * k, y(f)));
	const torso = solid(
		new THREE.Mesh(new THREE.LatheGeometry(profile, 32), jacket),
	);
	torso.scale.x = 0.62;
	upper.add(torso);

	// Arms with the forearms lying forward along the thighs.
	for (const side of [-1, 1]) {
		const shoulder = v3(0, y(JOINTS.shoulder) - 0.04 * k, side * shoulderZ);
		const elbow = v3(
			0.02,
			y(JOINTS.hip) + 0.17 * k,
			side * (shoulderZ - 0.02 * k),
		);
		const wrist = v3(
			0.3 * k,
			y(JOINTS.hip) + 0.22 * k,
			side * (hipZ + 0.04 * k),
		);
		upper.add(rod(shoulder, elbow, 0.046 * k, jacket));
		upper.add(rod(elbow, wrist, 0.04 * k, jacket));
		const hand = solid(
			new THREE.Mesh(new THREE.SphereGeometry(0.045 * k, 16, 12), skin),
		);
		hand.scale.set(0.7, 1.3, 0.5);
		hand.position.copy(wrist).add(v3(0.01, -0.05 * k, 0));
		upper.add(hand);
	}

	// Neck and head, the top of the head exactly at full height under a
	// beanie.
	upper.add(
		rod(
			v3(0, y(JOINTS.shoulder), 0),
			v3(0, y(JOINTS.chin) + 0.02, 0),
			0.055 * k,
			skin,
		),
	);
	const headH = 0.24 * k; // chin to crown
	const head = solid(
		new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), skin),
	);
	head.scale.set(0.2 * k, headH, 0.16 * k);
	head.position.set(0.01, H - headH / 2, 0);
	upper.add(head);
	const nose = solid(
		new THREE.Mesh(new THREE.ConeGeometry(0.014 * k, 0.04 * k, 8), skin),
	);
	nose.rotation.z = -Math.PI / 2;
	nose.position.set(0.01 + 0.1 * k + 0.012, H - headH * 0.55, 0);
	upper.add(nose);
	const beanie = solid(
		new THREE.Mesh(
			new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
			wool,
		),
	);
	beanie.scale.set(0.21 * k, headH * 0.92, 0.17 * k);
	beanie.position.set(0.01, H - headH * 0.47, 0);
	const brim = solid(
		new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 32), wool),
	);
	brim.rotation.x = Math.PI / 2;
	brim.scale.set(0.2 * k, 0.165 * k, 0.4);
	brim.position.set(0.01, H - headH * 0.45, 0);
	upper.add(beanie, brim);
	return human;
}

import * as THREE from "three";
import { FURNITURE, STOVE } from "../specs";
import { make } from "../textures";
import {
	box,
	cylinder,
	type Item,
	item,
	rod,
	solid,
	steel,
	v3,
} from "./common";

// Winnerwell Nomad View, L size. A stainless box on folding legs, with a
// big glass window in the door (front, +x) and one down each side, fold
// out shelves on both sides and the pipe rising from the back of the top.

export type Stove = Item & {
	// Light out of the door glass and the two side windows.
	fires: THREE.SpotLight[];
	// How bright the firelight is before flicker; set per time of day.
	fireLevel: number;
	// Flickers the flames and their light together; call every frame with
	// the time in seconds.
	burn(seconds: number): void;
};

// Where the pipe leaves the top, along the stove's length from its centre.
export const PIPE_X = -STOVE.bodyLength / 2 + 0.07;

export function stove(): Stove {
	const s = STOVE;
	const result = item(
		"Winnerwell Nomad View L",
		"46 × 25 × 25 cm body, 65 cm wide with shelves, Ø 8.9 cm pipe",
		[s.bodyLength, s.widthWithShelves],
	) as Stove;

	const metal = steel(6, 3);
	const dark = new THREE.MeshStandardMaterial({
		color: "#1d1d1f",
		metalness: 0.5,
		roughness: 0.6,
	});
	const bottom = s.legHeight;
	const top = s.legHeight + s.bodyHeight;
	const mid = (bottom + top) / 2;

	const body = box(s.bodyLength, s.bodyHeight, s.bodyWidth, metal, 0.008);
	body.position.y = mid;
	result.add(body);

	const glass = new THREE.MeshStandardMaterial({
		color: "#3a2a20",
		roughness: 0.05,
		transparent: true,
		opacity: 0.35,
	});
	// The fire seen through the glass: a painted picture of flames on a
	// dark firebox, flickered in `burn`.
	const glow = new THREE.MeshBasicMaterial({ map: flameTexture() });

	// Door on the front, with its glass, hinges, handle and air spinner.
	const door = box(
		0.006,
		s.bodyHeight - 0.02,
		s.bodyWidth - 0.02,
		metal,
		0.003,
	);
	door.position.set(s.bodyLength / 2 + 0.003, mid, 0);
	result.add(door);
	addWindow(
		result,
		glass,
		glow,
		v3(s.bodyLength / 2 + 0.007, mid + 0.02, 0),
		0.15,
		0.17,
		v3(1, 0, 0),
	);
	for (const y of [mid - 0.07, mid + 0.07]) {
		const hinge = cylinder(0.006, 0.025, dark);
		hinge.position.set(s.bodyLength / 2 + 0.006, y, -s.bodyWidth / 2 + 0.012);
		result.add(hinge);
	}
	const handle = rod(
		v3(s.bodyLength / 2 + 0.02, mid - 0.03, s.bodyWidth / 2 - 0.03),
		v3(s.bodyLength / 2 + 0.02, mid + 0.04, s.bodyWidth / 2 - 0.03),
		0.007,
		dark,
	);
	result.add(handle);
	const spinner = cylinder(0.024, 0.004, metal);
	spinner.rotation.z = Math.PI / 2;
	spinner.position.set(s.bodyLength / 2 + 0.008, bottom + 0.035, 0);
	result.add(spinner);

	// A long window down each side.
	for (const side of [-1, 1]) {
		addWindow(
			result,
			glass,
			glow,
			v3(0.01, mid + 0.01, side * (s.bodyWidth / 2 + 0.001)),
			0.3,
			0.13,
			v3(0, 0, side),
		);
	}

	// Pipe collar on the top plate.
	const collar = cylinder(s.pipeDiameter / 2 + 0.006, 0.035, metal);
	collar.position.set(PIPE_X, top + 0.0175, 0);
	result.add(collar);

	addLegs(result, metal);
	addShelves(result, metal, dark);
	addPipe(result, metal, dark);

	const k = kettle();
	k.position.set(0.11, top, 0);
	result.add(k);

	// Heat-resistant mat under it, with a bound edge.
	const { length, width } = FURNITURE.fireMat;
	const mat = box(
		length,
		0.006,
		width,
		new THREE.MeshStandardMaterial({ color: "#8d8b84", roughness: 1 }),
		0.003,
	);
	mat.position.set(0.12, 0.004, 0);
	result.add(mat);

	// Firelight: the fire burns inside the box, so its light only comes out
	// through the glass, in a wide soft cone from the door into the tent and
	// one from each long side window. `share` is each window's part of
	// the light, by glass area. With high quality rendering they cast
	// shadows, so at night the chairs, cots and the two of you throw shadows
	// across the tent.
	const lightThrough = (
		at: THREE.Vector3,
		towards: THREE.Vector3,
		share: number,
	) => {
		const light = new THREE.SpotLight("#ff8a3c", 0, 9, 1.35, 1, 1.6);
		light.position.copy(at);
		light.target.position.copy(at).add(towards);
		light.shadow.mapSize.set(1024, 1024);
		light.shadow.camera.near = 0.05;
		light.shadow.bias = -0.002;
		light.userData.share = share;
		result.add(light, light.target);
		return light;
	};
	result.fires = [
		lightThrough(v3(s.bodyLength / 2 + 0.01, mid, 0), v3(1, -0.1, 0), 0.25),
		lightThrough(v3(0.01, mid, s.bodyWidth / 2 + 0.01), v3(0, -0.1, 1), 0.375),
		lightThrough(
			v3(0.01, mid, -s.bodyWidth / 2 - 0.01),
			v3(0, -0.1, -1),
			0.375,
		),
	];
	result.fireLevel = 1;

	// The stove is lit by its own fire from inside, so it never shadows it.
	// (It stands inside the tent, out of the sun, so it casts no other
	// shadows worth drawing either.)
	result.traverse((o) => {
		o.castShadow = false;
	});

	// A wood fire never burns evenly.
	const map = glow.map as THREE.Texture;
	result.burn = (t) => {
		map.offset.x = Math.sin(t * 2.3) * 0.04 + Math.sin(t * 5.1) * 0.02;
		map.offset.y = Math.sin(t * 7.7) * 0.03;
		const flicker = 0.8 + 0.12 * Math.sin(t * 9.1) + 0.08 * Math.sin(t * 15.3);
		glow.color.setScalar(flicker);
		for (const light of result.fires) {
			light.intensity = result.fireLevel * flicker * light.userData.share * 2;
		}
	};
	return result;
}

// A pane of glass with the firelight glowing through it. `facing` says
// which way the pane faces: out of the front (x) or the side (z).
function addWindow(
	group: THREE.Group,
	glass: THREE.Material,
	glow: THREE.Material,
	at: THREE.Vector3,
	width: number,
	height: number,
	facing: THREE.Vector3,
) {
	const pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glass);
	const light = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glow);
	for (const m of [light, pane]) {
		m.position.copy(at);
		// Planes face +z; turn them to face out along `facing`.
		m.rotation.y = Math.atan2(facing.x, facing.z);
	}
	// The glass sits a millimetre in front of the fire picture.
	pane.position.addScaledVector(facing, 0.001);
	group.add(light, pane);
}

// Flames over a bed of embers, painted once. Slightly wider than needed so
// it can be shifted around for the flicker.
function flameTexture(): THREE.CanvasTexture {
	const texture = make(
		128,
		1,
		(ctx) => {
			ctx.fillStyle = "#140b06";
			ctx.fillRect(0, 0, 128, 128);
			const embers = ctx.createLinearGradient(0, 128, 0, 60);
			embers.addColorStop(0, "#ff5a10");
			embers.addColorStop(0.3, "#b8300a");
			embers.addColorStop(1, "rgba(60,15,5,0)");
			ctx.fillStyle = embers;
			ctx.fillRect(0, 60, 128, 68);
			const tongues = [
				[18, 60],
				[40, 85],
				[62, 70],
				[84, 92],
				[106, 64],
			];
			for (const [x, height] of tongues) {
				const g = ctx.createLinearGradient(0, 120, 0, 120 - height);
				g.addColorStop(0, "#fff0a0");
				g.addColorStop(0.35, "#ffb030");
				g.addColorStop(1, "rgba(255,90,20,0)");
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.moveTo(x - 14, 122);
				ctx.quadraticCurveTo(x - 12, 120 - height * 0.5, x, 120 - height);
				ctx.quadraticCurveTo(x + 12, 120 - height * 0.5, x + 14, 122);
				ctx.fill();
			}
		},
		true,
	);
	texture.wrapS = THREE.MirroredRepeatWrapping;
	return texture;
}

// Four flat steel legs that fold under the body, splayed a little outwards.
function addLegs(group: THREE.Group, metal: THREE.Material) {
	const s = STOVE;
	for (const x of [-1, 1]) {
		for (const z of [-1, 1]) {
			const leg = box(0.022, s.legHeight + 0.02, 0.004, metal);
			leg.position.set(
				x * (s.bodyLength / 2 - 0.035),
				s.legHeight / 2,
				z * (s.bodyWidth / 2 - 0.004 + 0.012),
			);
			leg.rotation.x = -z * 0.12;
			group.add(leg);
			const foot = box(0.04, 0.004, 0.03, metal);
			foot.position.set(leg.position.x, 0.002, z * (s.bodyWidth / 2 + 0.02));
			group.add(foot);
		}
	}
}

// Side shelves folded out level with the top, with slots and a lip.
function addShelves(
	group: THREE.Group,
	metal: THREE.Material,
	dark: THREE.Material,
) {
	const s = STOVE;
	const top = s.legHeight + s.bodyHeight;
	const width = (s.widthWithShelves - s.bodyWidth) / 2;
	const length = s.bodyLength - 0.06;
	for (const side of [-1, 1]) {
		const z = side * (s.bodyWidth / 2 + width / 2);
		const shelf = box(length, 0.004, width, metal, 0.0015);
		shelf.position.set(0, top - 0.002, z);
		group.add(shelf);
		const lip = box(length, 0.012, 0.004, metal);
		lip.position.set(0, top + 0.004, side * (s.bodyWidth / 2 + width - 0.002));
		group.add(lip);
		for (let i = 0; i < 4; i++) {
			const slot = box(0.06, 0.001, 0.012, dark);
			slot.position.set(-0.13 + i * 0.087, top + 0.0005, z);
			group.add(slot);
		}
	}
}

// Pipe sections 43 cm long, each crimped at the bottom to slide into the
// one below, a damper handle in the first section, and a mesh spark
// arrester on top.
function addPipe(
	group: THREE.Group,
	metal: THREE.Material,
	dark: THREE.Material,
) {
	const s = STOVE;
	const r = s.pipeDiameter / 2;
	const start = s.legHeight + s.bodyHeight + 0.035;
	const arrester = 0.22;
	const end = s.totalHeight - arrester;
	for (let y = start; y < end; y += 0.43) {
		const length = Math.min(0.43, end - y);
		const section = cylinder(r, length - 0.012, metal);
		section.position.set(PIPE_X, y + 0.012 + (length - 0.012) / 2, 0);
		const crimp = cylinder(r - 0.003, 0.012, metal);
		crimp.position.set(PIPE_X, y + 0.006, 0);
		group.add(section, crimp);
	}
	// Damper: a rod across the pipe with a coiled grip.
	const damperY = start + 0.2;
	group.add(
		rod(
			v3(PIPE_X, damperY, -r - 0.01),
			v3(PIPE_X, damperY, r + 0.07),
			0.003,
			metal,
		),
	);
	const grip = cylinder(0.008, 0.04, dark);
	grip.rotation.x = Math.PI / 2;
	grip.position.set(PIPE_X, damperY, r + 0.06);
	group.add(grip);

	const mesh = new THREE.MeshStandardMaterial({
		color: "#4a4c50",
		metalness: 0.7,
		roughness: 0.5,
		transparent: true,
		opacity: 0.7,
	});
	const cage = cylinder(0.058, arrester - 0.03, mesh);
	cage.position.set(PIPE_X, end + (arrester - 0.03) / 2, 0);
	const cap = cylinder(0.003, 0.03, metal, 0.075);
	cap.position.set(PIPE_X, s.totalHeight - 0.015, 0);
	group.add(cage, cap);
}

// A camp kettle: round belly, lid with a knob, spout and wire handle.
function kettle(): THREE.Group {
	const group = new THREE.Group();
	const enamel = new THREE.MeshStandardMaterial({
		color: "#2c3a36",
		metalness: 0.3,
		roughness: 0.35,
	});
	const profile = [
		[0.06, 0],
		[0.085, 0.01],
		[0.09, 0.05],
		[0.08, 0.1],
		[0.055, 0.125],
		[0.05, 0.13],
	].map(([x, y]) => new THREE.Vector2(x, y));
	const belly = solid(
		new THREE.Mesh(new THREE.LatheGeometry(profile, 32), enamel),
	);
	const lid = cylinder(0.05, 0.01, enamel);
	lid.position.y = 0.135;
	const knob = cylinder(0.012, 0.018, enamel);
	knob.position.y = 0.148;
	const spout = rod(v3(0.07, 0.05, 0), v3(0.13, 0.11, 0), 0.011, enamel);
	const wire = new THREE.MeshStandardMaterial({
		color: "#8a8d90",
		metalness: 0.9,
		roughness: 0.3,
	});
	const handle = solid(
		new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.003, 6, 24, Math.PI), wire),
	);
	handle.position.y = 0.12;
	handle.rotation.y = Math.PI / 2;
	group.add(belly, lid, knob, spout, handle);
	return group;
}

import * as THREE from "three";
import { cm, FURNITURE } from "../specs";
import { birchBark, fur, tiled, woodGrain } from "../textures";
import {
	aluminium,
	box,
	cylinder,
	fabric,
	item,
	rod,
	rubber,
	sheet,
	solid,
	steel,
	tube,
	v3,
} from "./common";

// A small rubber foot where a pole meets the floor.
function foot(at: THREE.Vector3): THREE.Mesh {
	const mesh = solid(
		new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), rubber),
	);
	mesh.scale.set(1, 0.6, 1);
	mesh.position.copy(at).setY(0.008);
	return mesh;
}

// Helinox Chair One. Two hubs under the seat, each with four shock-corded
// poles: two legs down to the floor and two up into pockets at the corners
// of the seat. The seat is one fabric sling hung between the front pockets
// and the top of the back, sagging to its lowest point at seat height.
export function chair(colour: string) {
	const { width, depth, height, seat } = FURNITURE.chair;
	const chair = item(
		"Camp chair (Helinox Chair One size)",
		"52 × 50 × 66 cm, seat 34 cm",
		[depth, width],
	);
	const halfW = width / 2 - 0.02;
	const front = depth / 2;
	const back = -depth / 2;

	const frontHub = v3(0.07, 0.15, 0);
	const backHub = v3(-0.08, 0.17, 0);
	const frontCorner = (z: number) => v3(front - 0.04, seat + 0.07, z);
	const backTop = (z: number) => v3(back + 0.02, height, z);

	for (const z of [-halfW, halfW]) {
		// Legs.
		const frontFoot = v3(front, 0.01, z);
		const backFoot = v3(back + 0.02, 0.01, z);
		chair.add(rod(frontHub, frontFoot, 0.0075), foot(frontFoot));
		chair.add(rod(backHub, backFoot, 0.0075), foot(backFoot));
		// Uprights into the seat's pockets.
		chair.add(rod(frontHub, frontCorner(z * 0.92), 0.0075));
		chair.add(rod(backHub, backTop(z * 0.85), 0.0075));
	}
	for (const hub of [frontHub, backHub]) {
		const h = box(0.05, 0.03, 0.05, aluminium, 0.01);
		h.position.copy(hub);
		chair.add(h);
	}

	// The sling: a curve from the front edge down to the seat and up the
	// back, narrower at the back, and sagging more in the middle.
	const sling = fabric(colour);
	const path = new THREE.CubicBezierCurve(
		new THREE.Vector2(front - 0.04, seat + 0.07),
		new THREE.Vector2(0.0, seat - 0.02),
		new THREE.Vector2(back + 0.02, seat),
		new THREE.Vector2(back + 0.02, height),
	);
	chair.add(
		sheet(
			(u, s) => {
				const p = path.getPoint(u);
				const across = (s - 0.5) * 2;
				const half = halfW * (0.92 - 0.07 * u);
				const sag = 0.03 * (1 - across * across) * Math.sin(Math.PI * u);
				return v3(p.x + sag * 0.3, p.y - sag, across * half);
			},
			32,
			12,
			sling,
		),
	);
	return chair;
}

// Helinox Table One: one hub with four legs and four poles holding up a
// top of aluminium slats on a fabric frame.
export function table(
	name = "Camp table (Helinox Table One size)",
	{ width, depth, height } = FURNITURE.table,
) {
	const table = item(
		name,
		`${Math.round(width * 100)} × ${cm(depth)}, ${cm(height)} high`,
		[width, depth],
	);
	const hub = v3(0, 0.17, 0);
	for (const x of [-1, 1]) {
		for (const z of [-1, 1]) {
			const f = v3(x * (width / 2 - 0.04), 0.01, z * (depth / 2 - 0.03));
			table.add(rod(hub, f, 0.0075), foot(f));
			table.add(
				rod(
					hub,
					v3(x * (width / 2 - 0.05), height - 0.01, z * (depth / 2 - 0.04)),
					0.0075,
				),
			);
		}
	}
	const h = box(0.06, 0.035, 0.06, aluminium, 0.01);
	h.position.copy(hub);
	table.add(h);

	// Fabric frame round the edge, slats across it.
	const edge = fabric("#2d2f31", 30, 2);
	for (const z of [-1, 1]) {
		const side = box(width, 0.02, 0.025, edge, 0.004);
		side.position.set(0, height - 0.005, z * (depth / 2 - 0.0125));
		table.add(side);
	}
	const slatMaterial = new THREE.MeshStandardMaterial({
		color: "#55595e",
		metalness: 0.6,
		roughness: 0.35,
	});
	const slats = Math.round(width / 0.066); // 9 on a 60 cm table
	for (let i = 0; i < slats; i++) {
		const slat = box(0.058, 0.008, depth - 0.02, slatMaterial, 0.003);
		slat.position.set(
			-width / 2 + 0.035 + i * ((width - 0.07) / (slats - 1)),
			height,
			0,
		);
		table.add(slat);
	}
	// A mug, for scale.
	const mug = cylinder(
		0.04,
		0.09,
		new THREE.MeshStandardMaterial({ color: "#9b2f22", roughness: 0.4 }),
	);
	mug.position.set(0.12, height + 0.05, 0.05);
	table.add(mug);
	return table;
}

// A plank crate of split birch.
export function woodBox() {
	const { length, width, height } = FURNITURE.woodBox;
	const wood = item("Firewood box", "45 × 32 × 30 cm", [length, width]);
	const planks = new THREE.MeshStandardMaterial({
		map: tiled(woodGrain(), 1.5, 0.3),
		roughness: 0.85,
	});
	const t = 0.015; // plank thickness
	const rows = 3;
	const plankH = (height - 0.02) / rows - 0.01;
	for (let r = 0; r < rows; r++) {
		const y = 0.02 + plankH / 2 + r * (plankH + 0.01);
		for (const z of [-1, 1]) {
			const p = box(length, plankH, t, planks, 0.002);
			p.position.set(0, y, z * (width / 2 - t / 2));
			wood.add(p);
		}
		for (const x of [-1, 1]) {
			const p = box(t, plankH, width - 2 * t, planks, 0.002);
			p.position.set(x * (length / 2 - t / 2), y, 0);
			wood.add(p);
		}
	}
	const floor = box(length - 0.01, 0.015, width - 0.01, planks);
	floor.position.y = 0.012;
	wood.add(floor);
	// Corner posts.
	for (const x of [-1, 1]) {
		for (const z of [-1, 1]) {
			const post = box(0.03, height, 0.03, planks);
			post.position.set(
				x * (length / 2 - 0.03),
				height / 2,
				z * (width / 2 - 0.03),
			);
			wood.add(post);
		}
	}

	// Logs: birch bark round the outside, pale wood on the cut ends.
	const bark = new THREE.MeshStandardMaterial({
		map: birchBark(),
		roughness: 0.9,
	});
	const endGrain = new THREE.MeshStandardMaterial({
		color: "#e2cfa8",
		roughness: 1,
	});
	const logs = [
		[-0.08, 0.06, 0.04],
		[0.0, 0.06, 0.045],
		[0.09, 0.06, 0.04],
		[-0.04, 0.13, 0.042],
		[0.05, 0.13, 0.038],
		[0.0, 0.2, 0.036],
	];
	for (const [z, y, r] of logs) {
		const log = solid(
			new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.4, 14), [
				bark,
				endGrain,
				endGrain,
			]),
		);
		log.rotation.z = Math.PI / 2;
		log.rotation.x = z * 2;
		log.position.set(0.02, height - 0.08 + y, z);
		wood.add(log);
	}
	return wood;
}

// A reindeer hide on the floor: wobbly outline, fur on top.
export function hide() {
	const { length, width } = FURNITURE.hide;
	const hide = item("Reindeer hide", "about 140 × 100 cm", [length, width]);
	const shape = new THREE.Shape();
	for (let i = 0; i <= 64; i++) {
		const a = (i / 64) * Math.PI * 2;
		const wobble = 1 + 0.08 * Math.sin(a * 5) + 0.05 * Math.sin(a * 9);
		// Leg flaps at the four diagonals.
		const legs = 0.12 * Math.max(0, Math.cos(4 * a - Math.PI)) ** 6;
		const x = (length / 2) * Math.cos(a) * (wobble + legs);
		const y =
			(width / 2) *
			Math.sin(a) *
			(wobble + legs) *
			(0.85 + 0.15 * Math.abs(Math.cos(a)));
		if (i === 0) shape.moveTo(x, y);
		else shape.lineTo(x, y);
	}
	const geometry = new THREE.ExtrudeGeometry(shape, {
		depth: 0.012,
		bevelEnabled: true,
		bevelThickness: 0.004,
		bevelSize: 0.01,
		bevelSegments: 2,
	});
	geometry.rotateX(-Math.PI / 2);
	const furTexture = fur();
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({
			map: furTexture,
			bumpMap: furTexture,
			bumpScale: 2,
			roughness: 1,
		}),
	);
	mesh.position.y = 0.004;
	mesh.receiveShadow = true;
	hide.add(mesh);
	return hide;
}

// A 90 L duffel: a soft tube with a zip along the top, compression straps
// round it and grab handles on the ends.
export function duffel(colour: string) {
	const { length, diameter } = FURNITURE.duffel;
	const bag = item("90 L duffel", "70 × 36 cm", [length, diameter]);
	const r = diameter / 2;
	const body = solid(
		new THREE.Mesh(
			new THREE.CapsuleGeometry(r, length - diameter, 8, 24),
			new THREE.MeshStandardMaterial({
				color: colour,
				roughness: 0.45,
				metalness: 0.05,
			}),
		),
	);
	body.rotation.z = Math.PI / 2;
	body.scale.set(0.82, 1, 1); // after the rotation local x is up: it sags
	body.position.y = r * 0.82;
	bag.add(body);

	const webbing = new THREE.MeshStandardMaterial({
		color: "#1f1f1f",
		roughness: 0.8,
	});
	for (const x of [-0.17, 0.17]) {
		const strap = solid(
			new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.006, 6, 32), webbing),
		);
		strap.rotation.y = Math.PI / 2;
		strap.scale.set(1, 0.82, 1);
		strap.position.set(x, r * 0.82, 0);
		bag.add(strap);
	}
	const zip = box(length - diameter, 0.006, 0.012, webbing);
	zip.position.y = r * 1.64;
	bag.add(zip);
	for (const x of [-1, 1]) {
		const handle = solid(
			new THREE.Mesh(
				new THREE.TorusGeometry(0.05, 0.008, 6, 16, Math.PI),
				webbing,
			),
		);
		handle.rotation.y = Math.PI / 2;
		handle.position.set(x * (length / 2 + 0.002), r * 0.82, 0);
		handle.rotation.z = x * (Math.PI / 2);
		bag.add(handle);
	}
	return bag;
}

// ICECO APL35: a dual-zone compressor cool box, all brushed aluminium: case
// and one big lid. Only the handles, control panel and vents are black.
// Published size 68.6 × 36.6 × 39.9 cm. Control panel and display on one
// end, folding handles on both ends, vents on the compressor end.
export function fridge() {
	const L = 0.686;
	const W = 0.366;
	const H = 0.399;
	const fridge = item("ICECO APL35 fridge", "68.6 × 36.6 × 39.9 cm", [L, W]);
	const alu = steel(6, 6);
	alu.color.set("#b9bcbf");
	// The lid a shade darker, so its edge reads against the case.
	const lidAlu = alu.clone();
	lidAlu.color.set("#a7abaf");
	const black = new THREE.MeshStandardMaterial({
		color: "#1b1c1e",
		roughness: 0.6,
	});

	// The case stands on the floor; the lid sits on top of it.
	const body = box(L, H - 0.045, W, alu, 0.02);
	body.position.y = (H - 0.045) / 2;
	fridge.add(body);
	// One lid across the whole top.
	const lid = box(L - 0.01, 0.045, W - 0.01, lidAlu, 0.018);
	lid.position.y = H - 0.0225;
	fridge.add(lid);
	// Control panel and a glowing temperature display on the +x end.
	const panel = box(0.004, 0.09, 0.2, black, 0.002);
	panel.position.set(L / 2 + 0.002, H - 0.12, 0);
	const display = new THREE.Mesh(
		new THREE.PlaneGeometry(0.07, 0.03),
		new THREE.MeshBasicMaterial({ color: "#5fb3ff" }),
	);
	display.rotation.y = Math.PI / 2;
	display.position.set(L / 2 + 0.0045, H - 0.11, -0.04);
	fridge.add(panel, display);
	// Vents on the compressor end.
	for (let i = 0; i < 6; i++) {
		const vent = box(0.003, 0.008, 0.16, black);
		vent.position.set(L / 2 + 0.001, 0.07 + i * 0.022, 0.0);
		fridge.add(vent);
	}
	// Folding handles, lying flat against the ends.
	for (const x of [-1, 1]) {
		const handle = rod(
			v3(x * (L / 2 + 0.02), H - 0.07, -0.13),
			v3(x * (L / 2 + 0.02), H - 0.07, 0.13),
			0.009,
			black,
		);
		fridge.add(handle);
	}
	return fridge;
}

// A stainless steel dog bowl with water in it: Ø 22 cm at the rim, 7 cm
// high.
export function waterBowl() {
	const bowl = item("Water bowl", "Ø 22 cm", [0.22, 0.22]);
	const profile = [
		[0.0, 0.002],
		[0.085, 0.002],
		[0.09, 0.01],
		[0.105, 0.065],
		[0.11, 0.07],
		[0.1, 0.07],
		[0.085, 0.012],
		[0.0, 0.012],
	].map(([x, y]) => new THREE.Vector2(x, y));
	const metal = steel(2, 2);
	bowl.add(solid(new THREE.Mesh(new THREE.LatheGeometry(profile, 40), metal)));
	const water = new THREE.Mesh(
		new THREE.CircleGeometry(0.097, 40),
		new THREE.MeshStandardMaterial({
			color: "#2a3a42",
			roughness: 0.05,
			metalness: 0.1,
			transparent: true,
			opacity: 0.85,
		}),
	);
	water.rotation.x = -Math.PI / 2;
	water.position.y = 0.05;
	bowl.add(water);
	return bowl;
}

// A two-burner camp kitchen for cooking proper food on the table in summer,
// at the size of a Primus Tupike: 47.5 × 29.5 × 8.2 cm (published). Used
// open, without the lid and windscreens: just the burners on the table. On
// them, a pot with a lid and a cast-iron pan of sausages. The gas canister stands on the floor under the
// table it is on, `tableHeight` below, on its hose over the back edge. Front
// is +x, the width runs along z; the origin is under the middle of the base.
export function campKitchen(tableHeight: number): THREE.Group {
	const kitchen = new THREE.Group();
	const L = 0.295; // depth, front to back
	const W = 0.475; // width
	const H = 0.082; // base height
	const casing = new THREE.MeshStandardMaterial({
		color: "#2b2d30",
		metalness: 0.4,
		roughness: 0.5,
	});
	const wood = new THREE.MeshStandardMaterial({
		map: tiled(woodGrain(), 0.3, 0.3),
		roughness: 0.8,
	});
	const metal = steel(2, 2);
	const black = new THREE.MeshStandardMaterial({
		color: "#151516",
		roughness: 0.6,
	});
	const flame = new THREE.MeshBasicMaterial({
		color: "#4f8cff",
		transparent: true,
		opacity: 0.6,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	});

	// Base with wooden end panels.
	const base = box(L, H, W - 0.03, casing, 0.006);
	base.position.y = H / 2;
	kitchen.add(base);
	for (const side of [-1, 1]) {
		const end = box(L, H, 0.015, wood, 0.004);
		end.position.set(0, H / 2, side * (W / 2 - 0.0075));
		kitchen.add(end);
	}

	// Two burners, each with a pot grid, a blue flame and a front knob.
	const burners = [-0.115, 0.115];
	for (const z of burners) {
		const ring = cylinder(0.035, 0.012, metal);
		ring.position.set(0, H + 0.006, z);
		const fire = new THREE.Mesh(
			new THREE.ConeGeometry(0.04, 0.018, 20, 1, true),
			flame,
		);
		fire.position.set(0, H + 0.02, z);
		kitchen.add(ring, fire);
		for (let k = 0; k < 4; k++) {
			const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
			const out = v3(Math.cos(a), 0, Math.sin(a));
			kitchen.add(
				rod(
					v3(0, H + 0.02, z).addScaledVector(out, 0.03),
					v3(0, H + 0.02, z).addScaledVector(out, 0.1),
					0.003,
					black,
				),
			);
		}
		const knob = cylinder(0.014, 0.018, black);
		knob.rotation.z = Math.PI / 2;
		knob.position.set(L / 2 + 0.009, H / 2, z);
		kitchen.add(knob);
	}

	// A 2.5 L pot with a lid on one burner.
	const top = H + 0.024; // the pot grid
	const pot = cylinder(0.1, 0.12, metal);
	pot.position.set(0, top + 0.06, burners[1]);
	const potLid = cylinder(0.102, 0.006, metal);
	potLid.position.set(0, top + 0.123, burners[1]);
	const grip = cylinder(0.012, 0.014, black);
	grip.position.set(0, top + 0.133, burners[1]);
	kitchen.add(pot, potLid, grip);

	// A cast-iron frying pan of sausages on the other, handle to the front.
	const iron = new THREE.MeshStandardMaterial({
		color: "#1d1e1f",
		metalness: 0.3,
		roughness: 0.6,
	});
	const pan = [
		[0, 0],
		[0.11, 0],
		[0.125, 0.04],
		[0.118, 0.04],
		[0.104, 0.006],
		[0, 0.006],
	].map(([x, y]) => new THREE.Vector2(x, y));
	const panMesh = solid(new THREE.Mesh(new THREE.LatheGeometry(pan, 32), iron));
	panMesh.position.set(0, top, burners[0]);
	const handle = rod(
		v3(0.12, top + 0.03, burners[0]),
		v3(0.3, top + 0.04, burners[0]),
		0.009,
		iron,
	);
	kitchen.add(panMesh, handle);
	const sausage = new THREE.MeshStandardMaterial({
		color: "#7a3b22",
		roughness: 0.5,
	});
	for (let k = 0; k < 4; k++) {
		const z = burners[0] - 0.06 + k * 0.04;
		kitchen.add(
			rod(v3(-0.06, top + 0.02, z), v3(0.06, top + 0.02, z), 0.012, sausage),
		);
	}

	// A 230 g gas canister on the floor under the table, on its hose.
	const canister = cylinder(
		0.055,
		0.09,
		new THREE.MeshStandardMaterial({
			color: "#2f4d6e",
			metalness: 0.5,
			roughness: 0.4,
		}),
	);
	const floor = -tableHeight;
	canister.position.set(0.05, floor + 0.045, -0.1);
	kitchen.add(
		canister,
		tube(
			[
				v3(-L / 2 + 0.01, 0.03, -W / 2 + 0.03),
				v3(-L / 2 - 0.04, 0, -W / 2 + 0.03),
				v3(-L / 2 - 0.05, floor * 0.6, -0.15),
				v3(0.05, floor + 0.1, -0.1),
			],
			0.005,
			black,
		),
	);
	return kitchen;
}

// A cutting board with a knife, two tomatoes and an onion.
export function cuttingBoard(): THREE.Group {
	const board = new THREE.Group();
	const wood = new THREE.MeshStandardMaterial({
		map: tiled(woodGrain(), 1, 1),
		roughness: 0.8,
	});
	const slab = box(0.3, 0.015, 0.2, wood, 0.004);
	slab.position.y = 0.0075;
	board.add(slab);
	const blade = box(0.15, 0.002, 0.025, steel(1, 1));
	blade.position.set(0.02, 0.016, 0.07);
	const handle = box(
		0.1,
		0.014,
		0.018,
		new THREE.MeshStandardMaterial({ color: "#1d1e1f" }),
		0.005,
	);
	handle.position.set(-0.105, 0.022, 0.07);
	board.add(blade, handle);
	const tomato = new THREE.MeshStandardMaterial({
		color: "#c0321f",
		roughness: 0.35,
	});
	for (const [x, z] of [
		[-0.06, -0.04],
		[0.0, -0.05],
	]) {
		const t = solid(
			new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), tomato),
		);
		t.scale.y = 0.85;
		t.position.set(x, 0.04, z);
		board.add(t);
	}
	const onion = solid(
		new THREE.Mesh(
			new THREE.SphereGeometry(0.035, 16, 12),
			new THREE.MeshStandardMaterial({ color: "#c79a5a", roughness: 0.6 }),
		),
	);
	onion.position.set(0.08, 0.045, -0.03);
	board.add(onion);
	return board;
}

// EcoFlow DELTA 3 power station: 398 × 200 × 284 mm, 12.5 kg (published).
// A grey case with the display and ports on the wide front (+x) and two
// carrying handles along the top.
export function ecoflow() {
	const D = 0.2; // depth, front to back
	const W = 0.398;
	const H = 0.284;
	const power = item("EcoFlow DELTA 3", "40 × 20 cm, 28 cm high", [D, W]);
	const grey = new THREE.MeshStandardMaterial({
		color: "#a9adb2",
		roughness: 0.55,
	});
	const dark = new THREE.MeshStandardMaterial({
		color: "#2a2c2f",
		roughness: 0.5,
	});
	const body = box(D, H, W, grey, 0.02);
	body.position.y = H / 2;
	const front = box(0.004, H - 0.06, W - 0.05, dark, 0.004);
	front.position.set(D / 2 + 0.001, H / 2 - 0.01, 0);
	const display = new THREE.Mesh(
		new THREE.PlaneGeometry(0.07, 0.04),
		new THREE.MeshBasicMaterial({ color: "#7fd0ff" }),
	);
	display.rotation.y = Math.PI / 2;
	display.position.set(D / 2 + 0.0035, H - 0.08, 0);
	power.add(body, front, display);
	// USB and car sockets under the display.
	for (let i = 0; i < 4; i++) {
		const port = box(0.002, 0.012, 0.02, grey);
		port.position.set(D / 2 + 0.0035, H / 2 - 0.03, -0.09 + i * 0.06);
		power.add(port);
	}
	// Two handles along the top.
	for (const x of [-1, 1]) {
		power.add(
			rod(
				v3(x * (D / 2 - 0.03), H + 0.012, -W / 2 + 0.06),
				v3(x * (D / 2 - 0.03), H + 0.012, W / 2 - 0.06),
				0.008,
				dark,
			),
		);
	}
	return power;
}

// YETI LoadOut GoBox 60 gear case: 76.2 × 37.6 × 34.0 cm (published). A
// charcoal box with a lid, latches on the long sides and grab handles at the
// ends.
export function goBox() {
	const L = 0.762;
	const W = 0.376;
	const H = 0.34;
	const box60 = item("YETI LoadOut GoBox 60", "76 × 38 cm, 34 cm high", [L, W]);
	const shell = new THREE.MeshStandardMaterial({
		color: "#3b3e41",
		roughness: 0.6,
	});
	const trim = new THREE.MeshStandardMaterial({
		color: "#26282a",
		roughness: 0.7,
	});
	const body = box(L, H - 0.05, W, shell, 0.03);
	body.position.y = (H - 0.05) / 2;
	const lid = box(L + 0.01, 0.05, W + 0.01, shell, 0.02);
	lid.position.y = H - 0.025;
	box60.add(body, lid);
	for (const z of [-1, 1]) {
		for (const x of [-0.2, 0.2]) {
			const latch = box(0.05, 0.06, 0.012, trim, 0.004);
			latch.position.set(x, H - 0.06, z * (W / 2 + 0.006));
			box60.add(latch);
		}
	}
	for (const x of [-1, 1]) {
		box60.add(
			rod(
				v3(x * (L / 2 + 0.02), H - 0.09, -0.08),
				v3(x * (L / 2 + 0.02), H - 0.09, 0.08),
				0.01,
				trim,
			),
		);
	}
	return box60;
}

// A drying line tied between `a` and `b` on the tent wall, sagging a little
// in the middle, with clothes pegged on it: a towel, a base-layer top, a
// buff and two pairs of wool socks. Typical sizes.
export function dryingLine(a: THREE.Vector3, b: THREE.Vector3): THREE.Group {
	const line = new THREE.Group();
	const sag = 0.05;
	const at = (t: number) =>
		a
			.clone()
			.lerp(b, t)
			.setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));
	line.add(
		tube(
			Array.from({ length: 21 }, (_, i) => at(i / 20)),
			0.0015,
			new THREE.MeshStandardMaterial({ color: "#d9592b", roughness: 0.7 }),
			64,
		),
	);
	// Garments as thin cloth hanging straight down from the line, the width
	// along it: [where along the line, width, length, colour].
	const clothes: [number, number, number, string][] = [
		[0.2, 0.4, 0.5, "#4f7a8c"], // towel
		[0.42, 0.42, 0.55, "#3a3d42"], // base-layer top
		[0.6, 0.2, 0.25, "#b5662f"], // buff
		[0.72, 0.08, 0.24, "#c9bda6"], // wool socks
		[0.76, 0.08, 0.24, "#c9bda6"],
		[0.82, 0.08, 0.24, "#7d6a58"],
		[0.86, 0.08, 0.24, "#7d6a58"],
	];
	const along = b.clone().sub(a).setY(0).normalize();
	const turn = Math.atan2(along.x, along.z);
	for (const [t, width, length, colour] of clothes) {
		const cloth = box(0.012, length, width, fabric(colour, 20, 20), 0.004);
		cloth.position.copy(at(t)).add(v3(0, -length / 2 - 0.005, 0));
		cloth.rotation.y = turn;
		const peg = box(
			0.012,
			0.04,
			0.01,
			new THREE.MeshStandardMaterial({ color: "#e9d27a" }),
		);
		peg.position.copy(at(t));
		peg.rotation.y = turn;
		line.add(cloth, peg);
	}
	return line;
}

// Hangs from the apex on a 25 cm cord. Its light is used at night.
export function lantern(apex: number) {
	const group = new THREE.Group();
	const metal = new THREE.MeshStandardMaterial({
		color: "#2c2d2f",
		metalness: 0.6,
		roughness: 0.4,
	});
	const cord = cylinder(0.0015, 0.22, rubber);
	cord.position.y = apex - 0.11;
	const hook = solid(
		new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.002, 6, 16), metal),
	);
	hook.position.y = apex - 0.235;
	const cap = cylinder(0.02, 0.025, metal, 0.05);
	cap.position.y = apex - 0.26;
	const glass = new THREE.Mesh(
		new THREE.CylinderGeometry(0.042, 0.042, 0.1, 24),
		new THREE.MeshStandardMaterial({
			color: "#fff3d6",
			emissive: "#ffcf86",
			emissiveIntensity: 0.4,
			roughness: 0.2,
		}),
	);
	glass.position.y = apex - 0.32;
	const base = cylinder(0.05, 0.025, metal);
	base.position.y = apex - 0.38;
	const light = new THREE.PointLight("#ffd29a", 0, 10, 1.6);
	light.position.copy(glass.position);
	group.add(cord, hook, cap, glass, base, light);
	return { group, light };
}

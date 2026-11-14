import * as THREE from "three";
import {
	mergeGeometries,
	mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { fbm, random } from "./noise";

// An invented high mountain plateau in the spirit of Hardangervidda or
// Rondane: wide rolling heath with lichen and heather, scattered boulders
// left by the ice, small tarns, and rounded mountains on the horizon with
// snow on their tops. Heights are metres above the tent site.

const WATER_LEVEL = -3.2;
const smoothstep = THREE.MathUtils.smoothstep;

function groundHeight(x: number, z: number): number {
	const r = Math.hypot(x, z);

	let height = 0;

	// Long, gentle swells of the plateau, and small hummocks on top. The
	// camp site is kept flat; the plateau starts a few metres out.
	const plateau = smoothstep(r, 7, 40);
	if (plateau > 0) {
		const swells = (fbm(x / 220 + 5, z / 220 + 9, 5) - 0.5) * 22;
		const hummocks = (fbm(x / 9, z / 9, 3, 7) - 0.5) * 0.7;
		height += (swells + hummocks) * plateau;
	}

	// Rounded mountains far off, highest towards the north (-z).
	const far = smoothstep(r, 1500, 4500);
	if (far > 0) {
		const north = 0.55 + 0.45 * Math.max(0, -z / r);
		const massif = fbm(x / 1400 + 3, z / 1400 + 1, 5, 3) ** 1.6;
		height += far * massif * 1500 * north;
	}
	return height;
}

const COLOURS = {
	lichen: new THREE.Color("#b9b590"),
	heather: new THREE.Color("#6e5e4c"),
	dwarfBirch: new THREE.Color("#6d7343"),
	scree: new THREE.Color("#7d7b74"),
	snow: new THREE.Color("#eef1f4"),
	shore: new THREE.Color("#5d5848"),
};

function groundColour(x: number, z: number, y: number, out: THREE.Color) {
	const patch = fbm(x / 7, z / 7, 3, 11);
	const patch2 = fbm(x / 30, z / 30, 3, 13);
	out.copy(COLOURS.lichen).lerp(COLOURS.heather, smoothstep(patch, 0.4, 0.62));
	out.lerp(COLOURS.dwarfBirch, smoothstep(patch2, 0.55, 0.7) * 0.8);

	if (y < WATER_LEVEL + 0.6) out.lerp(COLOURS.shore, 0.7);

	// Bare rock and snow on the mountains; old snowfields on the plateau.
	const r = Math.hypot(x, z);
	out.lerp(COLOURS.scree, smoothstep(y, 60, 220));
	if (y > 330) {
		const snowLine = 330 + fbm(x / 300, z / 300, 3, 21) * 260;
		out.lerp(COLOURS.snow, smoothstep(y, snowLine, snowLine + 60));
	}
	if (r > 120 && y < 60) {
		const snowfield = fbm(x / 90, z / 90, 4, 31);
		out.lerp(COLOURS.snow, smoothstep(snowfield, 0.74, 0.77));
	}
	return out;
}

// The ground is a disc of rings that get further apart with distance: fine
// detail around the tent, coarse far away where it is only a few pixels.
function buildGround(): THREE.Mesh {
	const around = 400;
	const rings = 230;
	const positions: number[] = [0, 0, 0];
	const colours: number[] = [];
	const indices: number[] = [];
	const c = new THREE.Color();
	groundColour(0, 0, 0, c);
	colours.push(c.r, c.g, c.b);

	for (let j = 0; j < rings; j++) {
		const r = 0.6 * 1.045 ** j;
		for (let i = 0; i < around; i++) {
			const a = (i / around) * Math.PI * 2;
			const x = r * Math.cos(a);
			const z = r * Math.sin(a);
			const y = groundHeight(x, z);
			positions.push(x, y, z);
			groundColour(x, z, y, c);
			colours.push(c.r, c.g, c.b);
		}
	}
	// The centre fan, then quads between rings.
	for (let i = 0; i < around; i++) {
		indices.push(0, 1 + ((i + 1) % around), 1 + i);
	}
	for (let j = 0; j < rings - 1; j++) {
		for (let i = 0; i < around; i++) {
			const a = 1 + j * around + i;
			const b = 1 + j * around + ((i + 1) % around);
			indices.push(a, b, a + around, b, b + around, a + around);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
	);
	mesh.receiveShadow = true;
	return mesh;
}

function buildWater(): THREE.Mesh {
	const mesh = new THREE.Mesh(
		new THREE.CircleGeometry(5000, 64),
		new THREE.MeshStandardMaterial({
			color: "#26404f",
			roughness: 0.08,
			metalness: 0.3,
		}),
	);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = WATER_LEVEL;
	return mesh;
}

// A lumpy stone: an icosahedron with its corners pushed in and out.
function stoneGeometry(seed: number): THREE.BufferGeometry {
	const geometry = new THREE.IcosahedronGeometry(1, 1);
	const pos = geometry.attributes.position;
	const rand = random(seed);
	const v = new THREE.Vector3();
	// Same corner must move the same way on every face it belongs to.
	const moved = new Map<string, number>();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
		if (!moved.has(key)) moved.set(key, 0.75 + rand() * 0.45);
		v.multiplyScalar(moved.get(key) as number);
		v.y *= 0.65; // glacial boulders are squat
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	geometry.computeVertexNormals();
	return geometry;
}

function buildBoulders(): THREE.Group {
	const group = new THREE.Group();
	const material = new THREE.MeshStandardMaterial({
		color: "#8a8780",
		roughness: 0.9,
		flatShading: true,
	});
	const rand = random(42);
	const matrix = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const e = new THREE.Euler();

	// Only boulders near the tent can throw a shadow into the sun's shadow
	// area round it; the rest of the plateau's are drawn without.
	const NEAR = 25;
	for (let s = 0; s < 3; s++) {
		const count = 400;
		const geometry = stoneGeometry(s + 1);
		const near: THREE.Matrix4[] = [];
		const far: THREE.Matrix4[] = [];
		while (near.length + far.length < count) {
			// Denser near the camp so there is something to look at.
			const r = 9 + 700 * rand() ** 2;
			const a = rand() * Math.PI * 2;
			const x = r * Math.cos(a);
			const z = r * Math.sin(a);
			const y = groundHeight(x, z);
			if (y < WATER_LEVEL + 0.3) continue;
			const size = 0.15 + 1.1 * rand() ** 4;
			e.set(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
			q.setFromEuler(e);
			matrix.compose(
				new THREE.Vector3(x, y + size * 0.2, z),
				q,
				new THREE.Vector3(size * (0.8 + rand() * 0.6), size, size),
			);
			(r < NEAR ? near : far).push(matrix.clone());
		}
		for (const [matrices, casts] of [
			[near, true],
			[far, false],
		] as const) {
			const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
			for (const [i, m] of matrices.entries()) mesh.setMatrixAt(i, m);
			mesh.computeBoundingSphere();
			mesh.castShadow = casts;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
	}
	return group;
}

// Close round the tent, where you see the ground up close: tufts of grass
// and sedge, and low clumps of heather. Each kind is one instanced mesh;
// they take shadows but do not cast them.
const TENT_EDGE = 2.3; // nothing grows on the groundsheet

// A tuft: a handful of thin blades leaning out from one root.
function tuftGeometry(): THREE.BufferGeometry {
	const rand = random(61);
	const blades: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 9; i++) {
		const height = 0.07 + rand() * 0.09;
		const blade = new THREE.ConeGeometry(0.005, height, 3, 1, true);
		blade.translate(0, height / 2, 0);
		blade.rotateZ((rand() - 0.5) * 0.7);
		blade.rotateY(rand() * Math.PI * 2);
		blade.translate((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.04);
		blades.push(blade);
	}
	return mergeGeometries(blades);
}

// Heather: a low cushion of a few small lumps.
function heatherGeometry(): THREE.BufferGeometry {
	const rand = random(62);
	const lumps: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 4; i++) {
		const lump = new THREE.IcosahedronGeometry(0.035 + rand() * 0.02, 0);
		lump.scale(1, 0.6, 1);
		lump.translate((rand() - 0.5) * 0.1, 0.03, (rand() - 0.5) * 0.1);
		lumps.push(lump);
	}
	// Share corners between faces: a quarter of the vertices to process.
	return mergeVertices(mergeGeometries(lumps));
}

// Scattered round the tent out to `reach` metres past its edge, denser
// close in. Split into 8 slices round the tent, each its own mesh, so the
// ones behind the camera are skipped.
function scatter(
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	count: number,
	reach: number,
	colours: string[],
	seed: number,
): THREE.Group {
	const SLICES = 8;
	const group = new THREE.Group();
	const rand = random(seed);
	const matrix = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	const c = new THREE.Color();
	const perSlice = Math.ceil(count / SLICES);
	for (let slice = 0; slice < SLICES; slice++) {
		const mesh = new THREE.InstancedMesh(geometry, material, perSlice);
		for (let i = 0; i < perSlice; i++) {
			const r = TENT_EDGE + reach * rand() ** 1.6;
			const a = ((slice + rand()) / SLICES) * Math.PI * 2;
			const x = r * Math.cos(a);
			const z = r * Math.sin(a);
			const size = 0.7 + rand() * 0.7;
			q.setFromAxisAngle(up, rand() * Math.PI * 2);
			matrix.compose(
				new THREE.Vector3(x, groundHeight(x, z), z),
				q,
				new THREE.Vector3(size, size, size),
			);
			mesh.setMatrixAt(i, matrix);
			c.set(colours[Math.floor(rand() * colours.length)]);
			c.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
			mesh.setColorAt(i, c);
		}
		// Instanced meshes are culled by one sphere round all instances.
		mesh.computeBoundingSphere();
		mesh.receiveShadow = true;
		group.add(mesh);
	}
	return group;
}

// Beyond about 10 m single blades are thinner than a pixel and only
// shimmer, so the close ground cover stops there.
function buildGroundCover(): THREE.Group {
	const group = new THREE.Group();
	group.add(
		scatter(
			tuftGeometry(),
			// Open cones: their insides only face the ground.
			new THREE.MeshStandardMaterial({ roughness: 1 }),
			9000,
			9,
			["#8f9256", "#a39d66", "#7a8448", "#b0a874"],
			63,
		),
		scatter(
			heatherGeometry(),
			new THREE.MeshStandardMaterial({ roughness: 1 }),
			1600,
			9,
			["#6a5a50", "#5d5446", "#665a58", "#57503f"],
			64,
		),
	);
	return group;
}

// Low clumps of dwarf birch and willow.
function buildShrubs(): THREE.InstancedMesh {
	const count = 2500;
	const mesh = new THREE.InstancedMesh(
		new THREE.IcosahedronGeometry(1, 0),
		new THREE.MeshStandardMaterial({
			color: "#585e35",
			roughness: 1,
			flatShading: true,
		}),
		count,
	);
	const rand = random(7);
	const matrix = new THREE.Matrix4();
	let placed = 0;
	while (placed < count) {
		const r = 6 + 160 * rand() ** 1.5;
		const a = rand() * Math.PI * 2;
		const x = r * Math.cos(a);
		const z = r * Math.sin(a);
		const y = groundHeight(x, z);
		if (y < WATER_LEVEL + 0.4) continue;
		const size = 0.08 + rand() * 0.14;
		matrix.compose(
			new THREE.Vector3(x, y, z),
			new THREE.Quaternion(),
			new THREE.Vector3(size * 1.6, size * 0.6, size * 1.4),
		);
		mesh.setMatrixAt(placed++, matrix);
	}
	mesh.receiveShadow = true;
	return mesh;
}

// A varde: the stacked-stone cairns that mark trails across the vidda.
function buildCairn(): THREE.Group {
	const group = new THREE.Group();
	const material = new THREE.MeshStandardMaterial({
		color: "#8f8b82",
		roughness: 0.9,
		flatShading: true,
	});
	const geometry = stoneGeometry(9);
	const rand = random(5);
	let y = 0;
	for (let i = 0; i < 8; i++) {
		const size = 0.45 - i * 0.04;
		const stone = new THREE.Mesh(geometry, material);
		stone.scale.set(size, size * 0.7, size * 0.9);
		stone.rotation.y = rand() * Math.PI;
		y += size * 0.45;
		stone.position.set((rand() - 0.5) * 0.08, y, (rand() - 0.5) * 0.08);
		y += size * 0.25;
		stone.castShadow = true;
		group.add(stone);
	}
	const x = 22;
	const z = -14;
	group.position.set(x, groundHeight(x, z), z);
	return group;
}

function buildStars(): THREE.Points {
	const rand = random(99);
	const positions: number[] = [];
	for (let i = 0; i < 3000; i++) {
		const a = rand() * Math.PI * 2;
		const up = Math.asin(rand()); // more stars low, like a real hemisphere
		const r = 9000;
		positions.push(
			r * Math.cos(up) * Math.cos(a),
			r * Math.sin(up),
			r * Math.cos(up) * Math.sin(a),
		);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	return new THREE.Points(
		geometry,
		new THREE.PointsMaterial({
			color: "#ffffff",
			size: 1.6,
			sizeAttenuation: false,
			fog: false,
		}),
	);
}

export type Landscape = { group: THREE.Group; stars: THREE.Points };

export function buildLandscape(): Landscape {
	const group = new THREE.Group();
	const stars = buildStars();
	group.add(
		buildGround(),
		buildWater(),
		buildBoulders(),
		buildShrubs(),
		buildGroundCover(),
		buildCairn(),
		stars,
	);
	return { group, stars };
}

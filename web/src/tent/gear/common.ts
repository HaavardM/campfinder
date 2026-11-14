import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { brushed, tiled, weave } from "../textures";

// Every item is a Group whose origin is on the floor at the centre of its
// footprint, with its length along x and its front facing +x. `userData`
// describes it for the info panel and holds its footprint for clearance
// checks.

export type Item = THREE.Group & {
	userData: {
		name: string;
		size: string;
		// Footprint length (x) and width (z) in metres.
		footprint: [number, number];
	};
};

export function item(
	name: string,
	size: string,
	footprint: [number, number],
): Item {
	const group = new THREE.Group() as Item;
	group.userData = { name, size, footprint };
	return group;
}

// Anodised aluminium, as on Helinox frames.
export const aluminium = new THREE.MeshStandardMaterial({
	color: "#34383d",
	metalness: 0.6,
	roughness: 0.35,
});

// Rubber feet, tyres and grips.
export const rubber = new THREE.MeshStandardMaterial({
	color: "#161616",
	roughness: 0.9,
});

// Stainless steel with a brushed finish, for the stove.
export function steel(u = 4, v = 4) {
	return new THREE.MeshStandardMaterial({
		color: "#c4c7cb",
		metalness: 0.85,
		roughness: 0.32,
		bumpMap: tiled(brushed(), u, v),
		bumpScale: 0.3,
	});
}

// Woven synthetic fabric. `u` × `v` is how many 2 cm weave tiles fit in one
// unit of the shape's UVs: the default 50 suits UVs in metres (`sheet`).
export function fabric(colour: string, u = 50, v = 50) {
	return new THREE.MeshStandardMaterial({
		color: colour,
		roughness: 0.85,
		bumpMap: tiled(weave(), u, v),
		bumpScale: 0.4,
		side: THREE.DoubleSide,
	});
}

// Shadows on: every solid object both casts and receives them.
export function solid<T extends THREE.Object3D>(object: T): T {
	object.traverse((o) => {
		o.castShadow = true;
		o.receiveShadow = true;
	});
	return object;
}

export function box(
	x: number,
	y: number,
	z: number,
	material: THREE.Material,
	rounding = 0,
): THREE.Mesh {
	const geometry =
		rounding > 0
			? new RoundedBoxGeometry(x, y, z, 3, rounding)
			: new THREE.BoxGeometry(x, y, z);
	return solid(new THREE.Mesh(geometry, material));
}

export function cylinder(
	radius: number,
	height: number,
	material: THREE.Material,
	radiusBottom = radius,
): THREE.Mesh {
	return solid(
		new THREE.Mesh(
			new THREE.CylinderGeometry(radius, radiusBottom, height, 24),
			material,
		),
	);
}

// A bent tube through `points`, such as a pole or a frame. Long tubes
// need more `segments` to stay smooth.
export function tube(
	points: THREE.Vector3[],
	radius: number,
	material: THREE.Material = aluminium,
	segments = 48,
): THREE.Mesh {
	const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
	return solid(
		new THREE.Mesh(
			new THREE.TubeGeometry(curve, segments, radius, 8),
			material,
		),
	);
}

// A straight rod from `a` to `b`, with rounded ends.
export function rod(
	a: THREE.Vector3,
	b: THREE.Vector3,
	radius: number,
	material: THREE.Material = aluminium,
): THREE.Mesh {
	const length = a.distanceTo(b);
	const mesh = new THREE.Mesh(
		new THREE.CapsuleGeometry(
			radius,
			Math.max(length - 2 * radius, 0.001),
			4,
			10,
		),
		material,
	);
	mesh.position.copy(a).add(b).multiplyScalar(0.5);
	mesh.quaternion.setFromUnitVectors(
		new THREE.Vector3(0, 1, 0),
		b.clone().sub(a).normalize(),
	);
	return solid(mesh);
}

export const v3 = (x: number, y: number, z: number) =>
	new THREE.Vector3(x, y, z);

// A surface spanned over a grid: `at(u, v)` gives the point for u and v in
// [0, 1]. UVs are set in metres along each direction, so tiled textures
// keep their real size.
export function sheet(
	at: (u: number, v: number) => THREE.Vector3,
	segmentsU: number,
	segmentsV: number,
	material: THREE.Material,
): THREE.Mesh {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	// Distance travelled so far down each column, for the v coordinate.
	const above: THREE.Vector3[] = [];
	const down: number[] = [];
	for (let j = 0; j <= segmentsV; j++) {
		let along = 0;
		for (let i = 0; i <= segmentsU; i++) {
			const p = at(i / segmentsU, j / segmentsV);
			if (i > 0) along += p.distanceTo(at((i - 1) / segmentsU, j / segmentsV));
			down[i] = j === 0 ? 0 : down[i] + p.distanceTo(above[i]);
			above[i] = p;
			positions.push(p.x, p.y, p.z);
			uvs.push(along, down[i]);
		}
	}
	for (let j = 0; j < segmentsV; j++) {
		for (let i = 0; i < segmentsU; i++) {
			const a = j * (segmentsU + 1) + i;
			const b = a + segmentsU + 1;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return solid(new THREE.Mesh(geometry, material));
}

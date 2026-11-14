import * as THREE from "three";
import { rod, solid, tube } from "./gear/common";
import { noise } from "./noise";
import { cm, PEOPLE, TENT } from "./specs";
import { mottle, tiled, weave } from "./textures";

// The tent is centred on the origin with its two doors facing +x and -x.
//
// Shape: every pole is a half circle of radius R in a vertical plane, so all
// pole points lie on a hemisphere. Between two neighbouring poles the
// fabric is not on the sphere; it pulls in towards the straight line
// between the poles. We describe the whole surface with one function:
//
//   point(φ, α) = R · cos α · bow(φ) · (cos φ, ·, sin φ)  at height R · sin α
//
// where φ is the compass angle around the tent, α the angle up from the
// ground, and bow(φ) is 1 on a pole and a bit less than 1 between poles.

const R = TENT.radius;
const POINTS = 10; // where the fabric is held out round the base
const PANEL = (2 * Math.PI) / POINTS; // angle between two of them

// Pole feet sit at ±half a panel from +x, so a door can be centred on +x.
const POINT_OFFSET = PANEL / 2;

// How far the fabric reaches out in direction φ, relative to R.
function bow(phi: number): number {
	// Angle from the middle of the panel we are in, between -PANEL/2 and +PANEL/2.
	const fromMiddle =
		THREE.MathUtils.euclideanModulo(phi + PANEL / 2, PANEL) - PANEL / 2;
	// On a flat panel (a decagon) the distance out is cos(half panel) / cos(angle).
	const flat = Math.cos(PANEL / 2) / Math.cos(fromMiddle);
	return flat + (1 - flat) * TENT.roundness;
}

// Height of the fabric above the floor point (x, z). 0 outside the tent.
// This is what headroom is measured against.
export function heightAt(x: number, z: number): number {
	const r = Math.hypot(x, z);
	const edge = R * bow(Math.atan2(z, x));
	if (r >= edge) return 0;
	return R * Math.sqrt(1 - (r / edge) ** 2);
}

// Distance from the axis to the fabric at height y in direction φ.
export function wallRadius(phi: number, y: number): number {
	if (y >= R) return 0;
	return R * bow(phi) * Math.sqrt(1 - (y / R) ** 2);
}

// The closed line on the floor where the fabric is exactly `height` up.
// Inside the line you have at least that much headroom.
function headroomLine(height: number, segments = 200): THREE.Vector3[] {
	const points: THREE.Vector3[] = [];
	for (let i = 0; i <= segments; i++) {
		const phi = (i / segments) * Math.PI * 2;
		const r = wallRadius(phi, height);
		points.push(new THREE.Vector3(r * Math.cos(phi), 0, r * Math.sin(phi)));
	}
	return points;
}

function surfacePoint(phi: number, alpha: number, out = new THREE.Vector3()) {
	const r = R * Math.cos(alpha) * bow(phi);
	return out.set(r * Math.cos(phi), R * Math.sin(alpha), r * Math.sin(phi));
}

// Cloth is never perfectly smooth: it sags inward by up to about 1.5 cm, in
// patches some 30 cm across, fading out towards the tight top. Moves the
// smooth surface point `p` (in direction φ) onto the real cloth. Sampled by
// position, so the seam where the fabric mesh wraps round matches.
function sag(p: THREE.Vector3, phi: number) {
	const alpha = Math.asin(Math.min(p.y / R, 1));
	const inward =
		noise(p.x * 3 + p.y * 2, p.z * 3 - p.y * 2, 5) * 0.015 * Math.cos(alpha);
	p.x -= Math.cos(phi) * inward;
	p.z -= Math.sin(phi) * inward;
	return p;
}

// A point on the cloth itself: for the fabric mesh and the pole sleeves
// lying on it.
function fabricPoint(phi: number, alpha: number, out = new THREE.Vector3()) {
	return sag(surfacePoint(phi, alpha, out), phi);
}

// Doors are arches on the panels facing +x and -x. Is (φ, y) inside one?
// Door shape: measured along the wall from the straight side, the opening
// reaches `width · √(1 − (y / height)²)` at height y. The front door faces
// +x, the back door is the same shape turned to face -x. The straight side
// is on the left seen from outside, which is the larger compass angle.
const DOOR_EDGE = THREE.MathUtils.degToRad(TENT.door.edge);

function inDoor(phi: number, y: number): boolean {
	const { width, height } = TENT.door;
	if (y >= height) return false;
	return [0, Math.PI].some((facing) => {
		const a =
			THREE.MathUtils.euclideanModulo(phi - facing + Math.PI, 2 * Math.PI) -
			Math.PI;
		const along = (DOOR_EDGE - a) * wallRadius(phi, y);
		return along >= 0 && along < width * Math.sqrt(1 - (y / height) ** 2);
	});
}

// Height of the polyester band round the bottom of the fly (estimate).
const BAND = 0.22;

// Fabric colours. The PC fly is a sand coloured polycotton
// with a polyester band at the bottom (band height is an estimate).
const COLOURS = {
	polycotton: new THREE.Color("#cfc4a8"),
	bottomBand: new THREE.Color("#7c7a68"),
	door: new THREE.Color("#b3a78b"),
	vent: new THREE.Color("#55524a"),
};

function fabricColour(phi: number, y: number, out: THREE.Color) {
	if (y < BAND) return out.copy(COLOURS.bottomBand);
	if (inDoor(phi, y)) return out.copy(COLOURS.door);
	// 4 vents near the top between the doors, 2 low ones on the sides.
	const quarter = THREE.MathUtils.euclideanModulo(phi, Math.PI / 2);
	if (y > 1.75 && y < 1.9 && Math.abs(quarter - Math.PI / 4) < 0.12)
		return out.copy(COLOURS.vent);
	const side = Math.abs(
		Math.abs(THREE.MathUtils.euclideanModulo(phi, Math.PI)) - Math.PI / 2,
	);
	if (y > 0.4 && y < 0.55 && side < 0.07) return out.copy(COLOURS.vent);
	return out.copy(COLOURS.polycotton);
}

function buildFabric(): THREE.Mesh {
	const around = 360;
	const up = 80;
	const positions: number[] = [];
	const colours: number[] = [];
	// UVs in metres (round the ground and up the wall) for the weave.
	const uvs: number[] = [];
	const indices: number[] = [];
	const p = new THREE.Vector3();
	const c = new THREE.Color();

	for (let j = 0; j <= up; j++) {
		const alpha = (j / up) * (Math.PI / 2);
		for (let i = 0; i <= around; i++) {
			const phi = (i / around) * Math.PI * 2;
			fabricPoint(phi, alpha, p);
			positions.push(p.x, p.y, p.z);
			fabricColour(phi, p.y, c);
			colours.push(c.r, c.g, c.b);
			uvs.push(phi * R, alpha * R);
		}
	}
	for (let j = 0; j < up; j++) {
		for (let i = 0; i < around; i++) {
			const a = j * (around + 1) + i;
			const b = a + around + 1;
			indices.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
	geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		roughness: 0.95,
		bumpMap: weave(),
		bumpScale: 0.6,
		// Lights up from inside at night; see lighting.ts.
		emissive: new THREE.Color("#ff9a4a"),
		emissiveIntensity: 0,
	});
	cutOpenDoors(material, true);
	const mesh = new THREE.Mesh(geometry, material);
	// The shadow must also have a hole where a door is open.
	mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
		depthPacking: THREE.RGBADepthPacking,
	});
	cutOpenDoors(mesh.customDepthMaterial);
	// The fabric is the outer wall, so there is nothing behind it for the
	// stove's firelight to shadow, and it would only shadow itself in
	// specks. It lives on its own layer: the cameras and the sun's shadow
	// include that layer, the firelight's shadow does not.
	mesh.layers.set(FABRIC_LAYER);
	return solid(mesh);
}

// The render layer the fabric is on; see buildFabric.
export const FABRIC_LAYER = 1;

// Which doors are open: x is the front door (+x), y the back door (-x).
const doorsOpen = { value: new THREE.Vector2(0, 0) };

// Light coming through the fabric, set by lighting.ts for the time of day:
// where the sun is, and how much sun and sky light gets through.
export const throughFabric = {
	sunDirection: { value: new THREE.Vector3(0, 1, 0) },
	sunThrough: { value: new THREE.Color(0, 0, 0) },
	skyThrough: { value: new THREE.Color(0, 0, 0) },
};

const f = (v: number) => v.toFixed(5); // a number for GLSL

// An open door is a hole in the fabric. Rather than cutting the mesh, the
// shader skips every pixel that lies inside an open door's arch. Same test
// as inDoor, but on the exact pixel position so the edge is crisp.
//
// With `daylight`, the inside of the fabric also glows with the light
// coming through the polycotton: bright where the sun is on the outside,
// dimmer on the shaded side, a little skylight everywhere.
function cutOpenDoors(material: THREE.Material, daylight = false) {
	material.onBeforeCompile = (shader) => {
		shader.uniforms.doorsOpen = doorsOpen;
		Object.assign(shader.uniforms, throughFabric);
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vTent;")
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\nvTent = position;",
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				`#include <common>
				varying vec3 vTent;
				uniform vec2 doorsOpen;
				// Same door shape as inDoor in tent.ts.
				bool inDoorway(vec3 p, float facing) {
					float y = p.y / ${f(TENT.door.height)};
					if (y >= 1.0) return false;
					float a = mod(atan(p.z, p.x) - facing + PI, 2.0 * PI) - PI;
					float along = (${f(DOOR_EDGE)} - a) * length(p.xz);
					return along >= 0.0 && along < ${f(TENT.door.width)} * sqrt(1.0 - y * y);
				}
				uniform vec3 sunDirection;
				uniform vec3 sunThrough;
				uniform vec3 skyThrough;`,
			)
			.replace(
				"#include <emissivemap_fragment>",
				daylight
					? `#include <emissivemap_fragment>
				if (!gl_FrontFacing) {
					vec3 outward = dir;
					float sunOnOutside = max(dot(outward, sunDirection), 0.0);
					// Whatever shades the outside of the cloth from the sun,
					// sleeves, guy lines, vent hoods, shows through as a soft
					// shadow: use the sun's shadow at this point.
					// Four samples are enough: light through cloth is soft.
					#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
						DirectionalLightShadow sunShadow = directionalLightShadows[ 0 ];
						vec4 sc = vDirectionalShadowCoord[ 0 ];
						sc.xyz /= sc.w;
						sc.z += sunShadow.shadowBias;
						if ( all( greaterThanEqual( sc.xyz, vec3( 0.0 ) ) ) && all( lessThanEqual( sc.xyz, vec3( 1.0 ) ) ) ) {
							vec2 t = 1.5 / sunShadow.shadowMapSize;
							sunOnOutside *= 0.25 * (
								texture2DCompare( directionalShadowMap[ 0 ], sc.xy + vec2( -t.x, -t.y ), sc.z ) +
								texture2DCompare( directionalShadowMap[ 0 ], sc.xy + vec2( t.x, -t.y ), sc.z ) +
								texture2DCompare( directionalShadowMap[ 0 ], sc.xy + vec2( -t.x, t.y ), sc.z ) +
								texture2DCompare( directionalShadowMap[ 0 ], sc.xy + vec2( t.x, t.y ), sc.z )
							);
						}
					#endif
					float skyOnOutside = 0.5 + 0.5 * outward.y;
					// Seams and sleeves are two layers of cloth: less light gets
					// through. Only the light through the cloth: lit from inside at
					// night, they don't show.
					totalEmissiveRadiance += diffuseColor.rgb * (1.0 - 0.5 * seam)
						* (sunThrough * sunOnOutside + skyThrough * skyOnOutside);
				}`
					: "#include <emissivemap_fragment>",
			)
			.replace(
				"void main() {",
				`void main() {
				if ((doorsOpen.x > 0.5 && inDoorway(vTent, 0.0)) ||
					(doorsOpen.y > 0.5 && inDoorway(vTent, PI))) discard;
				// Where the cloth is doubled: the pole sleeves sewn along the
				// outside, 4 cm wide, which show from inside as darker bands
				// along the poles; and a 1.5 cm seam along the top of the
				// bottom band.
				vec3 dir = normalize(vTent);
				float seam = 1.0 - smoothstep(0.004, 0.0075, abs(vTent.y - ${f(BAND)}));
				${TENT.poles
					.map((pole) => {
						const { normal: n, offset } = polePlane(pole);
						const toPole = `abs(dot(dir, vec3(${[n.x, n.y, n.z].map(f)})) - ${f(offset)}) * ${f(R)}`;
						return `seam = max(seam, 1.0 - smoothstep(${f(SLEEVE - 0.004)}, ${f(SLEEVE + 0.002)}, ${toPole}));`;
					})
					.join("\n")}`,
			);
	};
}

// The rolled-up door, tied above the opening.
function buildRoll(facing: number): THREE.Mesh {
	// Rolled up and tied beside the straight side, against the door pole.
	const az = facing + DOOR_EDGE + THREE.MathUtils.degToRad(4);
	// It follows the curve of the wall, lying on the outside of it.
	const points: THREE.Vector3[] = [];
	for (let i = 0; i <= 16; i++) {
		const y = 0.12 + (i / 16) * (TENT.door.height - 0.17);
		points.push(onCloth(az, y, 0.05).point);
	}
	const roll = tube(
		points,
		0.05,
		new THREE.MeshStandardMaterial({ color: COLOURS.door, roughness: 0.95 }),
	);
	roll.visible = false;
	return roll;
}

// A point on the outside of the fabric at compass angle φ and height y,
// with the directions needed to place things on it: `out` away from the
// tent, `along` horizontally round it, `up` up the wall.
export function onWall(phi: number, y: number, lift = 0) {
	const r = wallRadius(phi, y);
	const alpha = Math.asin(Math.min(y / R, 1));
	const out = new THREE.Vector3(
		Math.cos(alpha) * Math.cos(phi),
		Math.sin(alpha),
		Math.cos(alpha) * Math.sin(phi),
	);
	const along = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi));
	const up = new THREE.Vector3().crossVectors(out, along);
	const point = new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
	point.addScaledVector(out, lift);
	return { point, out, along, up };
}

// The same, but on the real, sagging cloth: for the things lying on the
// fabric (zips, vents, the rolled door, guy line tabs). Layout and
// clearances use the smooth `onWall`.
function onCloth(phi: number, y: number, lift = 0) {
	const w = onWall(phi, y);
	sag(w.point, phi).addScaledVector(w.out, lift);
	return w;
}

const trim = new THREE.MeshStandardMaterial({
	color: "#2b2a26",
	roughness: 0.8,
});
const webbing = new THREE.MeshStandardMaterial({
	color: "#3a3a36",
	roughness: 0.9,
});
const alu = new THREE.MeshStandardMaterial({
	color: "#9a9ea3",
	metalness: 0.8,
	roughness: 0.35,
});

// The poles run in fabric sleeves sewn along the outside: each pole shows
// as a raised seam over the dome. At the feet the pole sits in a cup on a
// webbing strap, pegged to the ground.
const SLEEVE = 0.02; // sleeve radius

type Pole = (typeof TENT.poles)[number];

// The pole's feet and highest point as directions from the dome's centre,
// and the plane through them. Three points on a sphere fix a plane; the
// plane cuts the sphere in a circle, which is the pole. Above the ground
// that circle is only the pole itself.
function polePlane(pole: Pole) {
	const d = THREE.MathUtils.degToRad;
	const onDome = (az: number, up: number) =>
		new THREE.Vector3(
			Math.cos(d(up)) * Math.cos(d(az)),
			Math.sin(d(up)),
			Math.cos(d(up)) * Math.sin(d(az)),
		);
	const a = onDome(pole.from, 0);
	const top = onDome(pole.over, pole.up);
	const b = onDome(pole.to, 0);
	const normal = new THREE.Vector3()
		.crossVectors(b.clone().sub(a), top.clone().sub(a))
		.normalize();
	return { a, top, b, normal, offset: normal.dot(a) };
}

// The line a pole's sleeve follows: the circle on the dome through its two
// feet and its highest point, laid on the fabric and lifted by the sleeve
// radius so the sleeve sits on it.
function polePath(pole: Pole): THREE.Vector3[] {
	const { a, top, b, normal, offset } = polePlane(pole);
	// The circle's centre is the plane's closest point to the origin.
	const centre = normal.clone().multiplyScalar(offset);
	const u = a.clone().sub(centre).normalize();
	const w = new THREE.Vector3().crossVectors(normal, u);
	const angle = (p: THREE.Vector3) => {
		const q = p.clone().sub(centre);
		return THREE.MathUtils.euclideanModulo(
			Math.atan2(q.dot(w), q.dot(u)),
			2 * Math.PI,
		);
	};
	// Go from a to b the way that passes over the top.
	let end = angle(b);
	if (angle(top) > end) end -= 2 * Math.PI;
	const radius = a.distanceTo(centre);
	const points: THREE.Vector3[] = [];
	for (let i = 0; i <= 96; i++) {
		const t = (i / 96) * end;
		const dir = centre
			.clone()
			.addScaledVector(u, Math.cos(t) * radius)
			.addScaledVector(w, Math.sin(t) * radius)
			.normalize();
		const phi = Math.atan2(dir.z, dir.x);
		const alpha = Math.asin(THREE.MathUtils.clamp(dir.y, 0, 1));
		points.push(fabricPoint(phi, alpha).addScaledVector(dir, SLEEVE));
	}
	return points;
}

function buildSleeves(): THREE.Group {
	const group = new THREE.Group();
	const sleeve = new THREE.MeshStandardMaterial({
		color: "#b8ad91",
		roughness: 0.95,
		bumpMap: weave(),
		bumpScale: 0.6,
	});
	const feet = new Set<number>();
	for (const pole of TENT.poles) {
		group.add(tube(polePath(pole), SLEEVE, sleeve, 192));
		feet.add(pole.from).add(pole.to);
	}
	for (const deg of feet) {
		const phi = THREE.MathUtils.degToRad(deg);
		const dir = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
		const cup = solid(
			new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 12), trim),
		);
		cup.position
			.copy(dir)
			.multiplyScalar(R + SLEEVE)
			.setY(0.025);
		const strap = solid(
			new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.025), webbing),
		);
		strap.position
			.copy(dir)
			.multiplyScalar(R + 0.1)
			.setY(0.003);
		strap.rotation.y = -phi;
		group.add(cup, strap, peg(dir.clone().multiplyScalar(R + 0.18)));
	}
	return group;
}

// An aluminium Y-peg driven into the ground, its head showing.
function peg(at: THREE.Vector3): THREE.Group {
	const group = new THREE.Group();
	const shaft = solid(
		new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), alu),
	);
	shaft.position.y = 0.02;
	const head = solid(
		new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 12), alu),
	);
	head.position.y = 0.05;
	group.add(shaft, head);
	group.position.copy(at).setY(0);
	return group;
}

// The 10 guy lines, one from each pole sleeve at about 1.3 m (estimate)
// out to a peg 1.4 m beyond the tent wall.
function buildGuyLines(): THREE.Group {
	const group = new THREE.Group();
	const cord = new THREE.MeshStandardMaterial({
		color: "#d9592b",
		roughness: 0.7,
	});
	for (let k = 0; k < POINTS; k++) {
		const phi = POINT_OFFSET + k * PANEL;
		const from = onCloth(phi, 1.3, 0.03).point;
		const to = new THREE.Vector3(
			Math.cos(phi),
			0,
			Math.sin(phi),
		).multiplyScalar(R + 1.4);
		to.y = 0.04;
		const line = rod(from, to, 0.0018, cord);
		const tab = solid(
			new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01), webbing),
		);
		const w = onCloth(phi, 1.3, 0.025);
		tab.position.copy(w.point);
		tab.quaternion.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis(w.along, w.up, w.out),
		);
		group.add(line, tab, peg(to));
	}
	return group;
}

// Hooded vents: a flap of fabric over each vent opening, held out by a
// stiffener so air gets in but rain does not. 4 high up and 2 low.
function buildVents(): THREE.Group {
	const group = new THREE.Group();
	const flap = new THREE.MeshStandardMaterial({
		color: COLOURS.polycotton,
		roughness: 0.95,
		side: THREE.DoubleSide,
		// Plane UVs run 0–1 over the flap: tile the 2 cm weave to its size.
		bumpMap: tiled(weave(), 0.3 / 0.02, 0.17 / 0.02),
		bumpScale: 0.6,
	});
	const vents: [phi: number, top: number, width: number][] = [
		[Math.PI / 4, 1.92, 0.3],
		[(3 * Math.PI) / 4, 1.92, 0.3],
		[(5 * Math.PI) / 4, 1.92, 0.3],
		[(7 * Math.PI) / 4, 1.92, 0.3],
		[Math.PI / 2, 0.58, 0.32],
		[-Math.PI / 2, 0.58, 0.32],
	];
	for (const [phi, top, width] of vents) {
		const w = onCloth(phi, top, 0.006);
		const hinge = new THREE.Group();
		hinge.position.copy(w.point);
		hinge.quaternion.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis(w.along, w.up, w.out),
		);
		const geometry = new THREE.PlaneGeometry(width, 0.17);
		geometry.translate(0, -0.085, 0); // hinge along the top edge
		const mesh = solid(new THREE.Mesh(geometry, flap));
		mesh.rotation.x = -0.5; // bottom edge held out from the wall
		hinge.add(mesh);
		group.add(hinge);
	}
	return group;
}

// Zips round both doors: a dark tape centred on the cloth, so the outline
// shows from inside and out, and a zip slider at each bottom end.
function buildDoorZips(): THREE.Group {
	const group = new THREE.Group();
	const { width, height } = TENT.door;
	for (const facing of [0, Math.PI]) {
		const edge = facing + DOOR_EDGE;
		const points: THREE.Vector3[] = [];
		// Up the straight side...
		for (let i = 0; i <= 16; i++) {
			points.push(onCloth(edge, Math.max(0.005, (i / 16) * height)).point);
		}
		// ...and down the curved side to the ground.
		for (let i = 1; i <= 48; i++) {
			const t = (i / 48) * (Math.PI / 2);
			const y = Math.max(0.005, height * Math.cos(t));
			const along = width * Math.sin(t);
			const guess = edge - along / wallRadius(edge, y);
			points.push(onCloth(edge - along / wallRadius(guess, y), y).point);
		}
		group.add(tube(points, 0.006, trim, 128));
		for (const end of [points[0], points[points.length - 1]]) {
			const slider = solid(
				new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), alu),
			);
			slider.position.copy(end).setY(0.03);
			group.add(slider);
		}
	}
	return group;
}

// Floor of the tent: same outline as the fabric at the ground.
function buildFloor(): THREE.Mesh {
	// Shapes are drawn in x/y; we lay it flat with y becoming -z.
	const shape = new THREE.Shape(
		headroomLine(0).map((p) => new THREE.Vector2(p.x, -p.z)),
	);
	const geometry = new THREE.ShapeGeometry(shape);
	geometry.rotateX(-Math.PI / 2);
	// UVs are the shape's own coordinates, in metres, so the textures keep
	// their real size.
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshStandardMaterial({
			color: "#6a6c5c",
			map: mottle(),
			bumpMap: weave(),
			bumpScale: 0.4,
			roughness: 0.95,
		}),
	);
	mesh.position.y = 0.004;
	mesh.receiveShadow = true;
	return mesh;
}

export type Tent = {
	group: THREE.Group;
	fabric: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
	setDoors(front: boolean, back: boolean): void;
};

export function buildTent(): Tent {
	const group = new THREE.Group();
	const fabric = buildFabric() as Tent["fabric"];
	const rolls = [buildRoll(0), buildRoll(Math.PI)];
	group.add(
		fabric,
		buildSleeves(),
		buildDoorZips(),
		buildVents(),
		buildGuyLines(),
		buildFloor(),
		...rolls,
	);
	function setDoors(front: boolean, back: boolean) {
		doorsOpen.value.set(Number(front), Number(back));
		rolls[0].visible = front;
		rolls[1].visible = back;
	}
	return { group, fabric, setDoors };
}

// The headroom lines drawn on the floor, and their colours (also used by
// the legend in the panel): where each of you can stand upright, then 150
// and 100 cm.
export const HEADROOM: [height: number, colour: string][] = [
	[PEOPLE.you, "#e2513b"],
	[PEOPLE.partner, "#d68a1c"],
	[1.5, "#2f5d8a"],
	[1.0, "#2f5d8a"],
];

export function buildHeadroomLines(): THREE.Group {
	const group = new THREE.Group();
	for (const [height, colour] of HEADROOM) {
		const points = headroomLine(height);
		const line = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(points),
			new THREE.LineDashedMaterial({
				color: colour,
				dashSize: 0.06,
				gapSize: 0.04,
			}),
		);
		line.computeLineDistances();
		line.position.y = 0.012;
		group.add(line, label(cm(height), points[0]));
	}
	return group;
}

// A small text label lying on the floor.
function label(text: string, at: THREE.Vector3): THREE.Mesh {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	ctx.font = "bold 40px system-ui, sans-serif";
	ctx.fillStyle = "#1d1d1b";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, 128, 32);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(0.4, 0.1),
		new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
	);
	mesh.rotation.x = -Math.PI / 2;
	mesh.rotation.z = Math.PI / 2;
	mesh.position.set(at.x - 0.08, 0.013, at.z);
	return mesh;
}

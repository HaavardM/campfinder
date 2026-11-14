import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import type { Season } from "#/lib/seasons";
import {
	campKitchen,
	car,
	chair,
	cot,
	cuttingBoard,
	dryingLine,
	duffel,
	ecoflow,
	fridge,
	goBox,
	hide,
	husky,
	type Item,
	lantern,
	PIPE_X,
	person,
	stove,
	table,
	waterBowl,
	woodBox,
} from "./gear";
import { buildLandscape } from "./landscape";
import { buildLighting, type TimeOfDay } from "./lighting";
import { COT, cm, FURNITURE, PEOPLE, STOVE, TENT } from "./specs";
import {
	buildHeadroomLines,
	buildTent,
	FABRIC_LAYER,
	heightAt,
	onWall,
	wallRadius,
} from "./tent";
import { buildWalk } from "./walk";

// ---------------------------------------------------------------- scene

const canvas = document.querySelector("#scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Nothing casting a shadow moves on its own, so shadows are only redrawn
// when something changes: see `redrawShadows`.
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

function redrawShadows() {
	renderer.shadowMap.needsUpdate = true;
}

const scene = new THREE.Scene();

// Near plane of 2 cm so you can put your face right up to the fabric.
const camera = new THREE.PerspectiveCamera(70, 1, 0.02, 30000);
camera.position.set(7, 3.2, 6);
camera.layers.enable(FABRIC_LAYER);

// Floor plan: straight down, without perspective, north (-z) up.
const plan = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
plan.position.set(0, 20, 0);
plan.up.set(0, 0, -1);
plan.lookAt(0, 0, 0);
plan.layers.enable(FABRIC_LAYER);

const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 0.9, 0);
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.minDistance = 0.3;
orbit.maxDistance = 300;
orbit.enableDamping = true;

const planControls = new OrbitControls(plan, canvas);
planControls.enableRotate = false;
planControls.screenSpacePanning = true;
planControls.enabled = false;

const landscape = buildLandscape();
const tent = buildTent();
scene.add(landscape.group, tent.group);

const headroom = buildHeadroomLines();
scene.add(headroom);

// 10 cm grid, shown with the floor plan and the see-through tent.
const grid = new THREE.GridHelper(5, 50, "#6c6c66", "#9a9a90");
grid.position.y = 0.006;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
grid.visible = false;
scene.add(grid);

// ---------------------------------------------------------------- gear

const BAG = "#8e2a22";
const theStove = stove();
const cots = [cot(false, BAG), cot(false, BAG)];
const yourChair = chair("#3e5872");
const partnersChair = chair("#7a4b2a");

// You both sit in your chairs: each person is part of their chair, so
// dragging the chair takes them along.
const you = person("You", PEOPLE.you, "#2f6f8f");
const partner = person("Your partner", PEOPLE.partner, "#b0342b");
yourChair.add(you);
partnersChair.add(partner);

const theCar = car();
const theWoodBox = woodBox();
const bigTable = table(
	"Camp table (Helinox Table Two size)",
	FURNITURE.bigTable,
);
// Summer cooking on it: the camp kitchen at one end, facing in, and a
// cutting board at the other. Part of the table, so they move with it. You
// sit across its long sides.
{
	const top = FURNITURE.bigTable.height + 0.005;
	const kitchen = campKitchen(top);
	kitchen.position.set(-0.24, top, 0);
	const board = cuttingBoard();
	board.position.set(0.24, top, -0.12);
	bigTable.add(kitchen, board);
}
const smallTable = table();
const theHusky = husky();

const jack = onWall(Math.PI, TENT.stoveJackHeight);

// Default layout, in metres and degrees. Doors are at +x (front) and -x
// (back). The stove stands in front of the back door with its pipe straight
// up through the jack above that door; its glass door faces into the tent.
// The cots run along both side walls, leaving an aisle from the front door
// to the stove.
const LAYOUT: [Item, x: number, z: number, turn: number][] = [
	[theStove, jack.point.x - PIPE_X, 0, 0],
	// Head end (+x on a cot) turned towards the stove: you sleep with your
	// heads by the fire.
	[cots[0], 0.15, 1.1, 180],
	[cots[1], 0.15, -1.1, 180],
	[yourChair, 0.75, 0.47, 180],
	[partnersChair, 0.75, -0.47, 180],
	[smallTable, 0.75, 0, 0], // between the chairs
	[theWoodBox, -0.91, 0, 90], // just behind the stove
	[bigTable, -0.25, 0, 90], // in summer, where the stove stands
	[hide(), 0.3, 0, 90], // in the aisle
	// Your partner's duffel, in the corner by the closed back door at the
	// head of her cot.
	[duffel("#26282b"), -1.15, -1.1, -60],
	[fridge(), -1.55, 0.45, 90], // by the closed back door, your side
	[ecoflow(), -1.55, 0.97, 90], // power station beside the fridge, in the corner by the wall
	// Stowed between the cots and the walls, where the roof is too low to
	// stand but plenty for gear.
	[goBox(), 0.15, 1.75, 0], // behind your cot
	[duffel("#26282b"), -0.6, 1.65, 0], // your duffel, beside the GoBox
	[theHusky, -1.5, -0.33, 0], // by the closed back door; turned to face your partner below
	[waterBowl(), -1.7, -0.85, 0], // his water, on the far side of him from the fridge
	[theCar, 4.2, -3.6, -35], // parked outside
];
const items = LAYOUT.map(([it]) => it);

// Winter: the stove and its firewood. Summer: no stove, a big table in its
// place.
const WINTER_ONLY: Item[] = [theStove, theWoodBox, smallTable];
const SUMMER_ONLY: Item[] = [bigTable];

// In summer there's no fire to watch: you sit across the table from each
// other, you on the front door side, your partner on the back door side.
const SUMMER_CHAIRS: [Item, x: number, z: number, turn: number][] = [
	[yourChair, 0.33, 0, 180],
	[partnersChair, -0.83, 0, 0],
];
const CHAIRS: Item[] = [yourChair, partnersChair];
let season: Season = "winter";

function showFor(s: Season) {
	for (const it of WINTER_ONLY) it.visible = s === "winter";
	for (const it of SUMMER_ONLY) it.visible = s === "summer";
}

function setSeason(next: Season) {
	season = next;
	showFor(next);
	if (selected && !selected.visible) select(null);
	for (const spot of next === "summer"
		? SUMMER_CHAIRS
		: LAYOUT.filter(([it]) => CHAIRS.includes(it))) {
		place(spot);
	}
	if (selected) outline.setFromObject(selected);
	hangLantern();
	lighting.setStove(next === "winter");
	// Seated, follow your chair to its new spot.
	if (view === "sit") setView("sit");
	redrawShadows();
	showInfo();
}

// Where each of you rests your head on your cot: the head-end corner on
// the aisle side. (On a cot, local +x is the head end; the cots are turned,
// so the aisle is local +z on the first and -z on the second.)
function pillow(mine: number): THREE.Vector3 {
	return cots[mine].localToWorld(
		new THREE.Vector3(0.92, 0, mine === 0 ? 0.22 : -0.22),
	);
}

function place([it, x, z, turn]: [Item, number, number, number]) {
	it.position.set(x, 0, z);
	it.rotation.y = THREE.MathUtils.degToRad(turn);
}

function placeDefaults() {
	for (const spot of LAYOUT) place(spot);
	if (season === "summer") for (const spot of SUMMER_CHAIRS) place(spot);
	// The dog lies with his face towards your partner on her cot.
	const her = pillow(1).sub(theHusky.position);
	theHusky.rotation.y = Math.atan2(-her.z, her.x);
	redrawShadows();
}
placeDefaults();
scene.add(...items);

const hanging = lantern(TENT.radius);
scene.add(hanging.group);

let line: THREE.Group;
// An optional line to dry clothes on (off at start; a switch in the panel),
// across the tent between the walls at 1.9 m,
// in the warm air from the stove but well clear of its pipe, and clear of
// the lantern in both seasons.
{
	const x = 0.25;
	const y = 1.9;
	// Where the wall is 1.9 m high, on each side: halve the gap to it.
	const wall = (side: number) => {
		let inside = 0;
		let outside = side * TENT.radius;
		for (let i = 0; i < 30; i++) {
			const mid = (inside + outside) / 2;
			if (heightAt(x, mid) > y) inside = mid;
			else outside = mid;
		}
		return new THREE.Vector3(x, y, inside);
	};
	line = dryingLine(wall(-1), wall(1));
	line.visible = false;
	scene.add(line);
}

// The lantern hangs from the roof: at the top in winter, and in summer
// right above the big table, to light it for cooking and eating. It is
// built hanging from the apex, so lower it by how much lower the roof is
// where it hangs.
function hangLantern() {
	const at = season === "summer" ? bigTable.position : new THREE.Vector3();
	hanging.group.position.set(at.x, heightAt(at.x, at.z) - TENT.radius, at.z);
}

// The stove jack: a silicone ring in the fabric above the back door, lying
// on the tent wall.
const jackRing = new THREE.Mesh(
	new THREE.RingGeometry(STOVE.pipeDiameter / 2, 0.17, 32),
	new THREE.MeshStandardMaterial({
		color: "#5a5c5e",
		roughness: 0.6,
		side: THREE.DoubleSide,
	}),
);
jackRing.position.copy(jack.point);
jackRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), jack.out);
scene.add(jackRing);

function pipePosition(): THREE.Vector3 {
	return theStove.localToWorld(new THREE.Vector3(PIPE_X, 0, 0));
}

// ---------------------------------------------------------------- lights

const lighting = buildLighting(renderer, scene, {
	stove: theStove,
	lantern: hanging.light,
	fabric: tent.fabric.material,
	stars: landscape.stars,
});

// ---------------------------------------------------------------- views

export type View = "outside" | "walk" | "sit" | "lie" | "plan";
type Who = keyof typeof PEOPLE;

let view: View = "outside";
let walkingAs: Who = "you";
const walk = buildWalk(camera, canvas);

// Walking, sitting and lying are all seen through your own eyes.
function firstPerson() {
	return view === "walk" || view === "sit" || view === "lie";
}

// Seen through your own eyes, you are the camera, so hide whoever you are.
function showPeople() {
	you.visible = !firstPerson() || walkingAs !== "you";
	partner.visible = !firstPerson() || walkingAs !== "partner";
	redrawShadows();
}

function setView(next: View) {
	view = next;
	// Send the walking read-out afresh, in case nothing was listening yet.
	lastHud = "";
	orbit.enabled = next === "outside";
	planControls.enabled = next === "plan";
	showPeople();
	// Walking: in the middle, in front of the drying line, looking at the
	// stove by the back door.
	// Sitting: in your chair, over the middle of its seat, looking at the
	// stove in winter and across the table at the other one of you in
	// summer.
	const stoveFront = theStove.localToWorld(new THREE.Vector3(0.3, 0.4, 0));
	const other = walkingAs === "you" ? partnersChair : yourChair;
	const across = other.position.clone().setY(1.0);
	if (next === "walk") {
		walk.enter(new THREE.Vector3(0.05, 0, 0), stoveFront, "standing", false);
	} else if (next === "sit") {
		const chair = walkingAs === "you" ? yourChair : partnersChair;
		const seat = chair.localToWorld(new THREE.Vector3(-0.05, 0, 0));
		walk.enter(
			seat,
			season === "summer" ? across : stoveFront,
			"sitting",
			true,
		);
	} else if (next === "lie") {
		// On your back on your cot, head on the pillow corner, so you look
		// out past your sleeping bag's hood.
		const head = pillow(walkingAs === "you" ? 0 : 1);
		// Look across at the dog and the other one of you in their chair.
		const look = theHusky.position.clone().lerp(other.position, 0.5).setY(0.4);
		walk.enter(head, look, "lying", true);
	} else {
		if (walk.active) walk.exit();
		lastHud = "";
		listeners.hud(null);
	}
	if (next === "plan") {
		plan.zoom = 1;
		planControls.target.set(0, 0, 0);
		plan.position.set(0, 20, 0);
	}
	if (next === "outside") {
		camera.position.set(7, 3.2, 6);
		orbit.target.set(0, 0.9, 0);
	}
}

// ---------------------------------------------------------------- drag

// In the outside view and the plan, drag any item across the floor. Q and E
// turn the selected item by 15°.
const raycaster = new THREE.Raycaster();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointer = new THREE.Vector2();
const grabOffset = new THREE.Vector3();
let selected: Item | null = null;
let dragging = false;
const outline = new THREE.BoxHelper(new THREE.Object3D(), "#f2c14e");
outline.visible = false;
scene.add(outline);

function activeCamera(): THREE.Camera {
	return view === "plan" ? plan : camera;
}

// Aims the raycaster at the pointer and returns the floor point under it.
function floorPoint(e: PointerEvent): THREE.Vector3 | null {
	const rect = canvas.getBoundingClientRect();
	pointer.set(
		((e.clientX - rect.left) / rect.width) * 2 - 1,
		-((e.clientY - rect.top) / rect.height) * 2 + 1,
	);
	raycaster.setFromCamera(pointer, activeCamera());
	return raycaster.ray.intersectPlane(floor, new THREE.Vector3());
}

function select(it: Item | null) {
	selected = it;
	outline.visible = it !== null;
	if (it) outline.setFromObject(it);
	showInfo();
}

// After an item moved or turned.
function moved(it: Item) {
	if (it === bigTable) hangLantern();
	outline.setFromObject(it);
	redrawShadows();
	showInfo();
}

canvas.addEventListener("pointerdown", (e) => {
	if (firstPerson()) return;
	const at = floorPoint(e);
	const shown = items.filter((it) => it.visible);
	const hit = raycaster.intersectObjects(shown, true)[0];
	select(hit ? owner(hit.object) : null);
	if (selected && at) {
		grabOffset.copy(selected.position).sub(at);
		dragging = true;
		orbit.enabled = false;
		planControls.enabled = false;
		canvas.setPointerCapture(e.pointerId);
	}
});

canvas.addEventListener("pointermove", (e) => {
	if (!dragging || !selected) return;
	const at = floorPoint(e);
	if (!at) return;
	selected.position.set(at.x + grabOffset.x, 0, at.z + grabOffset.z);
	moved(selected);
});

canvas.addEventListener("pointerup", () => {
	if (!dragging) return;
	dragging = false;
	orbit.enabled = view === "outside";
	planControls.enabled = view === "plan";
});

window.addEventListener("keydown", (e) => {
	if (!selected || firstPerson()) return;
	const step = THREE.MathUtils.degToRad(15);
	if (e.code === "KeyQ") selected.rotation.y += step;
	else if (e.code === "KeyE") selected.rotation.y -= step;
	else if (e.code === "Escape") return select(null);
	else return;
	moved(selected);
});

// The item a clicked mesh belongs to.
function owner(object: THREE.Object3D): Item {
	let o = object;
	while (!items.includes(o as Item) && o.parent) o = o.parent;
	return o as Item;
}

// ---------------------------------------------------------------- measuring

// Corners of a `length` × `width` rectangle centred on an item's origin,
// on the floor in world coordinates. Defaults to the item's footprint.
function corners(it: Item, [l, w] = it.userData.footprint): THREE.Vector2[] {
	return [
		[-l / 2, -w / 2],
		[l / 2, -w / 2],
		[l / 2, w / 2],
		[-l / 2, w / 2],
	].map(([x, z]) => {
		const p = it.localToWorld(new THREE.Vector3(x, 0, z));
		return new THREE.Vector2(p.x, p.z);
	});
}

function pointToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
	const ab = b.clone().sub(a);
	const t = THREE.MathUtils.clamp(
		p.clone().sub(a).dot(ab) / ab.lengthSq(),
		0,
		1,
	);
	return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function inside(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
	return poly.every((a, i) => {
		const b = poly[(i + 1) % poly.length];
		return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
	});
}

// Gap between two footprints, 0 if they overlap.
function gap(a: Item, b: Item): number {
	const pa = corners(a);
	const pb = corners(b);
	if (pa.some((p) => inside(p, pb)) || pb.some((p) => inside(p, pa))) return 0;
	let best = Number.POSITIVE_INFINITY;
	for (const [from, to] of [
		[pa, pb],
		[pb, pa],
	]) {
		for (const p of from) {
			to.forEach((q, i) => {
				best = Math.min(best, pointToSegment(p, q, to[(i + 1) % to.length]));
			});
		}
	}
	return best;
}

// How far the hot stove body is from the fabric, measured level with its
// top plate where the wall is closest.
function stoveToFabric(): number {
	const top = STOVE.legHeight + STOVE.bodyHeight;
	const body = corners(theStove, [STOVE.bodyLength, STOVE.bodyWidth]);
	return Math.min(
		...body.map((p) => wallRadius(Math.atan2(p.y, p.x), top) - p.length()),
	);
}

// What the panel shows: the selected item and the stove's clearances, all
// rounded to the centimetre.
export type Info = {
	selected: { name: string; size: string; fabricAbove: string } | null;
	// Only in winter, with the stove up.
	stove: { toFabric: number; toCot: number; pipeOffJack: number } | null;
};

// What the walk view shows: how much room there is above your head.
export type Hud = {
	pose: string;
	eye: number;
	inside: boolean;
	// Standing or sitting: from the top of your head to the
	// fabric. Lying: from your face. Negative when it presses in.
	clearance: number;
	looking: boolean;
	// Sitting or lying: you can look round but not walk.
	seated: boolean;
};

export const listeners = {
	info: (_: Info) => {},
	hud: (_: Hud | null) => {},
};

const centimetre = (m: number) => Math.round(m * 100) / 100;

// The panel only re-renders when a rounded value changes, not on every
// pointer move of a drag.
let lastInfo = "";
function showInfo() {
	const pipe = pipePosition();
	const p = selected?.position;
	const above = p ? heightAt(p.x, p.z) : 0;
	const info: Info = {
		selected:
			selected && p
				? {
						name: selected.userData.name,
						size: selected.userData.size,
						fabricAbove: above > 0 ? cm(above) : "outside the tent",
					}
				: null,
		stove:
			season === "winter"
				? {
						toFabric: centimetre(stoveToFabric()),
						toCot: centimetre(Math.min(...cots.map((c) => gap(theStove, c)))),
						pipeOffJack: centimetre(
							Math.hypot(pipe.x - jack.point.x, pipe.z - jack.point.z),
						),
					}
				: null,
	};
	const key = JSON.stringify(info);
	if (key === lastInfo) return;
	lastInfo = key;
	listeners.info(info);
}

let lastHud = "";
function showHud() {
	const p = camera.position;
	const fabric = heightAt(p.x, p.z);
	const hud: Hud = {
		pose: walk.pose,
		eye: centimetre(p.y),
		inside: fabric > 0,
		// The top of the head is about 12 cm above the eyes; lying on your
		// back, the tip of your nose about 3 cm.
		clearance: centimetre(fabric - p.y - (walk.pose === "lying" ? 0.03 : 0.12)),
		looking: walk.isLocked(),
		seated: view !== "walk",
	};
	const key = JSON.stringify(hud);
	if (key === lastHud) return;
	lastHud = key;
	listeners.hud(hud);
}

// ---------------------------------------------------------------- controls

// See-through tent: a faint fabric that lets you see the layout from
// outside. Opaque fabric stays out of the transparent pass, so it hides
// everything inside it for free.
function setSeeThrough(on: boolean) {
	seeThrough = on;
	const m = tent.fabric.material;
	m.transparent = on;
	m.opacity = on ? 0.18 : 1;
	m.depthWrite = !on;
	m.needsUpdate = true;
	grid.visible = on;
}

// High quality: render with 4× multisampling, then add ambient occlusion,
// the soft darkening where things meet: under the cots, in the corners
// where the fabric meets the floor, round feet and legs. Only for the
// perspective views; the floor plan is drawn directly. Built during the
// warm-up after start-up (see warmUp), so switching it on is instant.
let composer: EffectComposer | null = null;
let highQuality = false;

function buildComposer(): EffectComposer {
	const c = new EffectComposer(
		renderer,
		new THREE.WebGLRenderTarget(1, 1, {
			type: THREE.HalfFloatType,
			samples: 4,
		}),
	);
	const ao = new GTAOPass(scene, camera, 1, 1);
	ao.updateGtaoMaterial({
		radius: 0.35,
		distanceExponent: 1.5,
		thickness: 1,
		scale: 1,
	});
	ao.blendIntensity = 0.85;
	// The occlusion is worked out from a picture of the scene's depth and
	// normals. Drawn one-sided, the inside of the tent fabric is missing
	// from it, and the mountains beyond darken the fabric instead.
	ao.normalMaterial.side = THREE.DoubleSide;
	c.addPass(new RenderPass(scene, camera));
	c.addPass(ao);
	c.addPass(new OutputPass());
	return c;
}

export const controls = {
	setView,
	setSeason,
	setTime(time: TimeOfDay) {
		lighting.set(time);
		redrawShadows();
	},
	setSeeThrough,
	setDryingLine(on: boolean) {
		line.visible = on;
		redrawShadows();
	},
	setHeadroom(on: boolean) {
		headroom.visible = on;
	},
	setDoors(front: boolean, back: boolean) {
		tent.setDoors(front, back);
		doorsShut = !front && !back;
		redrawShadows();
	},
	setWalkAs(who: Who) {
		walkingAs = who;
		walk.height = PEOPLE[who];
		// Sitting or lying, move to their chair or cot; walking, just change
		// eye height.
		if (view === "sit" || view === "lie") setView(view);
		else showPeople();
	},
	// Rebuild both cots with or without the leg extensions, in place, so
	// everything holding on to them keeps working.
	setLegKit(on: boolean) {
		walk.bedHeight = on ? COT.heightWithLegs : COT.heightLow;
		for (const old of cots) {
			const fresh = cot(on, BAG);
			dispose(old);
			old.clear();
			old.add(...fresh.children);
			old.userData = fresh.userData;
		}
		if (selected) moved(selected);
		else redrawShadows();
	},
	reset() {
		placeDefaults();
		hangLantern();
		select(null);
	},
	refresh: () => {
		lastInfo = "";
		showInfo();
	},
	setHighQuality(on: boolean) {
		highQuality = on;
		if (on && !composer) {
			composer = buildComposer();
			resize();
		}
		// Only the light out of the door glass casts shadows: every lit pixel
		// samples each shadow map, so one is a third of the cost of three.
		// The door glass faces the chairs, where its shadows show most.
		theStove.fires[0].castShadow = on;
		redrawShadows();
	},
};

// Free the GPU memory of everything under `object`.
function dispose(object: THREE.Object3D) {
	object.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		o.geometry.dispose();
		for (const m of [o.material].flat() as THREE.MeshStandardMaterial[]) {
			m.map?.dispose();
			m.bumpMap?.dispose();
			m.dispose();
		}
	});
}

// ---------------------------------------------------------------- loop

function resize() {
	const w = canvas.clientWidth;
	const h = canvas.clientHeight;
	const aspect = w / h;
	renderer.setSize(w, h, false);
	camera.aspect = aspect;
	camera.updateProjectionMatrix();
	// Plan shows 5.4 m across the short side of the screen.
	const half = 2.7;
	plan.left = -half * Math.max(aspect, 1);
	plan.right = half * Math.max(aspect, 1);
	plan.top = half / Math.min(aspect, 1);
	plan.bottom = -half / Math.min(aspect, 1);
	plan.updateProjectionMatrix();
	// High quality renders at normal pixel density, even on a retina
	// screen: a quarter of the pixels, and its 4× multisampling keeps the
	// edges sharp. Ambient occlusion is soft, so the loss can't be seen.
	composer?.setPixelRatio(1);
	composer?.setSize(w, h);
}
window.addEventListener("resize", resize);

// Inside with both doors shut and the fabric opaque, nothing outside can be
// seen: skip drawing the landscape and the car altogether.
let seeThrough = false;
let doorsShut = false;
let sealedIn = false;
function hideOutsideWhenSealedIn() {
	const p = camera.position;
	const sealed =
		firstPerson() && doorsShut && !seeThrough && heightAt(p.x, p.z) > 0;
	if (sealed === sealedIn) return;
	sealedIn = sealed;
	landscape.group.visible = !sealed;
	theCar.visible = !sealed;
	// Keep the shadow map whole for when you step back out.
	if (!sealed) redrawShadows();
}

const clock = new THREE.Clock();
function frame() {
	const dt = Math.min(clock.getDelta(), 0.1);
	theStove.burn(clock.elapsedTime);
	if (view === "outside") orbit.update();
	if (view === "plan") planControls.update();
	walk.update(dt);
	if (firstPerson()) showHud();
	hideOutsideWhenSealedIn();
	if (composer && highQuality && view !== "plan") composer.render(dt);
	else renderer.render(scene, activeCamera());
	requestAnimationFrame(frame);
}

// Compile the shaders for the other modes right after start-up, while
// nothing changes on screen, so switching to summer or to high quality later
// doesn't freeze the view for a moment while the GPU compiles. Summer has
// different lights (no stove), high quality adds the firelight's shadow and
// the ambient occlusion passes, rendered once off screen.
function warmUp() {
	showFor(season === "winter" ? "summer" : "winter");
	renderer.compile(scene, camera);
	showFor(season);
	const fire = theStove.fires[0];
	fire.castShadow = true;
	renderer.compile(scene, camera);
	if (!composer) {
		composer = buildComposer();
		resize();
	}
	// One off-screen frame with the firelight shadow drawn, too.
	redrawShadows();
	composer.renderToScreen = false;
	composer.render(0);
	composer.renderToScreen = true;
	fire.castShadow = highQuality;
	redrawShadows();
}

resize();
lighting.set("day");
setSeason("winter");
// Start in your chair by the stove.
setView("sit");
frame();
requestAnimationFrame(() => setTimeout(warmUp));

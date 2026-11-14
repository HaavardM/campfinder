import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { throughFabric as daylight, FABRIC_LAYER } from "./tent";

// Sun, sky and the lights inside the tent, with three times of day.

export type TimeOfDay = "day" | "evening" | "night";

type Preset = {
	sunElevation: number; // degrees above the horizon
	sunAzimuth: number; // degrees, 0 = +x, 90 = +z
	sunColour: string;
	sunIntensity: number;
	ambient: number;
	exposure: number;
	// Soft fill light inside the tent from the glowing walls.
	throughFabric: number;
	fire: number;
	lantern: number;
	// How much the tent glows from the stove when seen from outside.
	glow: number;
	stars: boolean;
	// Haze colour near the horizon, and how strongly the sky reflects in
	// water and steel.
	fog: string;
	reflections: number;
};

const PRESETS: Record<TimeOfDay, Preset> = {
	day: {
		sunElevation: 38,
		sunAzimuth: 140,
		sunColour: "#fff6e8",
		sunIntensity: 3,
		ambient: 1.1,
		exposure: 0.55,
		throughFabric: 1.5,
		fire: 1.5,
		lantern: 0,
		glow: 0,
		stars: false,
		fog: "#c3d0da",
		reflections: 1,
	},
	evening: {
		sunElevation: 3,
		sunAzimuth: 200,
		sunColour: "#ffb070",
		sunIntensity: 2,
		ambient: 0.5,
		exposure: 0.5,
		throughFabric: 0.6,
		fire: 4,
		lantern: 1.5,
		glow: 0.03,
		stars: false,
		fog: "#c9a58e",
		reflections: 1,
	},
	night: {
		sunElevation: -8,
		sunAzimuth: 250,
		sunColour: "#9fb4d9", // moonlight
		sunIntensity: 0.25,
		ambient: 0.12,
		exposure: 0.7,
		throughFabric: 0,
		fire: 6,
		lantern: 2.5,
		glow: 0.1,
		stars: true,
		fog: "#0d1420",
		reflections: 0.15,
	},
};

export type Lighting = {
	set(time: TimeOfDay): void;
	// Whether the stove is lit: in summer there is none, so no firelight
	// glow on the tent at night.
	setStove(on: boolean): void;
};

export function buildLighting(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	parts: {
		// The stove flickers its own firelight; lighting sets how bright.
		stove: { fireLevel: number };
		lantern: THREE.PointLight;
		fabric: THREE.MeshStandardMaterial;
		stars: THREE.Points;
	},
): Lighting {
	const sky = new Sky();
	sky.scale.setScalar(20000);
	const u = sky.material.uniforms;
	u.turbidity.value = 4;
	u.rayleigh.value = 1.2;
	u.mieCoefficient.value = 0.004;
	u.mieDirectionalG.value = 0.8;
	scene.add(sky);

	const sun = new THREE.DirectionalLight();
	sun.castShadow = true;
	// 2048² over 20 m: 1 cm texels, sharp enough once softened. Covers the
	// tent and the car beside it.
	sun.shadow.mapSize.set(2048, 2048);
	const s = sun.shadow.camera;
	s.left = s.bottom = -10;
	s.right = s.top = 10;
	// The tent fabric is on its own layer (see tent.ts); it does shade the
	// inside from the sun.
	s.layers.enable(FABRIC_LAYER);
	s.near = 1;
	s.far = 120;
	sun.shadow.bias = -0.0004;
	sun.shadow.normalBias = 0.02;
	scene.add(sun, sun.target);

	const ambient = new THREE.HemisphereLight("#bcd3ea", "#6b6450");
	scene.add(ambient);

	const throughFabric = new THREE.PointLight("#fff1dc", 0, 5, 1);
	throughFabric.position.set(0, 1.6, 0);
	scene.add(throughFabric);

	const fog = new THREE.FogExp2("#c6d3dc", 0.00009);
	scene.fog = fog;

	// Reflections (water, steel) come from the sky, blurred into an
	// environment map. Made once per time of day and kept.
	const pmrem = new THREE.PMREMGenerator(renderer);
	const skyScene = new THREE.Scene();
	const environments = new Map<TimeOfDay, THREE.Texture>();
	let current: TimeOfDay | null = null;
	let stoveOn = true;

	function set(time: TimeOfDay) {
		if (time === current) return;
		current = time;
		const p = PRESETS[time];
		const sunDir = new THREE.Vector3().setFromSphericalCoords(
			1,
			THREE.MathUtils.degToRad(90 - p.sunElevation),
			THREE.MathUtils.degToRad(90 - p.sunAzimuth),
		);
		u.sunPosition.value.copy(sunDir);

		// The light itself: the sun, or the moon at night from higher up.
		const lightDir =
			p.sunElevation > 0
				? sunDir
				: new THREE.Vector3(-0.4, 0.7, 0.5).normalize();
		sun.position.copy(lightDir).multiplyScalar(60);
		sun.color.set(p.sunColour);
		sun.intensity = p.sunIntensity;
		ambient.intensity = p.ambient;
		throughFabric.intensity = p.throughFabric;
		// Polycotton lets a fraction of the light through; sunlit panels glow
		// much brighter than the shaded side.
		const sunUp = p.sunElevation > 0;
		daylight.sunDirection.value.copy(sunDir);
		daylight.sunThrough.value
			.set(p.sunColour)
			.multiplyScalar(sunUp ? p.sunIntensity * 0.2 : 0);
		daylight.skyThrough.value
			.copy(ambient.color)
			.multiplyScalar(sunUp ? p.ambient * 0.08 : 0);
		parts.stove.fireLevel = p.fire;
		parts.lantern.intensity = lanternLevel(p);
		parts.fabric.emissiveIntensity = stoveOn ? p.glow : 0;
		parts.stars.visible = p.stars;
		renderer.toneMappingExposure = p.exposure;
		fog.color.set(p.fog);

		if (!environments.has(time)) {
			skyScene.add(sky);
			environments.set(time, pmrem.fromScene(skyScene).texture);
			scene.add(sky);
		}
		scene.environment = environments.get(time) as THREE.Texture;
		scene.environmentIntensity = p.reflections;
	}

	// Without the fire, the lantern is the light to cook and eat by.
	const lanternLevel = (p: Preset) => p.lantern * (stoveOn ? 1 : 1.8);

	function setStove(on: boolean) {
		stoveOn = on;
		if (!current) return;
		parts.fabric.emissiveIntensity = on ? PRESETS[current].glow : 0;
		parts.lantern.intensity = lanternLevel(PRESETS[current]);
	}

	return { set, setStove };
}

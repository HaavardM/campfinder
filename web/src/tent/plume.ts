import * as THREE from "three";

// Something rising from a point: smoke from the chimney, sparks at night,
// steam from the kettle. Each puff is a small square turned to face the
// camera, and works out where it is from the clock alone: it is born at
// the origin, rises and spreads over `life` seconds, drifts with the wind,
// grows and fades, then starts again. Nothing is updated per frame but the
// time.

export type PlumeOptions = {
	count: number;
	life: number; // seconds from birth to gone
	rise: number; // metres risen over a life
	spread: number; // metres out from the middle by the end
	drift: THREE.Vector3; // metres moved by the wind over a life, growing late
	size: [start: number, end: number]; // metres across
	// Set later for smoke, which changes with the time of day.
	colour?: THREE.ColorRepresentation;
	opacity: number;
	// Added on top rather than blended: for sparks, which glow.
	glowing?: boolean;
	// The clock, in seconds; plumes moving together can share one.
	time?: { value: number };
};

export type Plume = THREE.Mesh<
	THREE.InstancedBufferGeometry,
	THREE.ShaderMaterial
>;

// `count` squares 1 × 1 in the xy plane, each with four random numbers in
// `seed` for its shader to place it by. Shared with the falling snow.
export function seededSquares(count: number): THREE.InstancedBufferGeometry {
	const geometry = new THREE.InstancedBufferGeometry();
	const square = new THREE.PlaneGeometry(1, 1);
	geometry.index = square.index;
	geometry.setAttribute("position", square.getAttribute("position"));
	geometry.setAttribute("uv", square.getAttribute("uv"));
	const seeds = new Float32Array(count * 4);
	for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
	geometry.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
	geometry.instanceCount = count;
	return geometry;
}

export function plume(o: PlumeOptions): Plume {
	const material = new THREE.ShaderMaterial({
		uniforms: {
			time: o.time ?? { value: 0 },
			colour: { value: new THREE.Color(o.colour ?? "#ffffff") },
			opacity: { value: o.opacity },
			life: { value: o.life },
			rise: { value: o.rise },
			spread: { value: o.spread },
			drift: { value: o.drift.clone() },
			size: { value: new THREE.Vector2(...o.size) },
		},
		transparent: true,
		depthWrite: false,
		blending: o.glowing ? THREE.AdditiveBlending : THREE.NormalBlending,
		vertexShader: /* glsl */ `
			uniform float time;
			uniform float life;
			uniform float rise;
			uniform float spread;
			uniform vec3 drift;
			uniform vec2 size;
			// When in its life it is (x), which way it spreads (y), how far
			// (z), and a wobble (w).
			attribute vec4 seed;
			varying vec2 vUv;
			varying float vAge;
			void main() {
				float age = fract(time / life + seed.x);
				float angle = seed.y * 6.2831853;
				vec3 at = vec3(0.0, rise * age, 0.0) + drift * age * age;
				at.xz += vec2(cos(angle), sin(angle)) * spread * sqrt(age) * seed.z;
				at.x += sin(time * 0.9 + seed.w * 6.28 + age * 4.0) * spread * 0.25 * age;
				// A square around that point, facing the camera.
				vec4 centre = modelViewMatrix * vec4(at, 1.0);
				centre.xy += position.xy * mix(size.x, size.y, age);
				gl_Position = projectionMatrix * centre;
				vUv = uv;
				vAge = age;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 colour;
			uniform float opacity;
			varying vec2 vUv;
			varying float vAge;
			void main() {
				float soft = smoothstep(1.0, 0.0, length(vUv - 0.5) * 2.0);
				float fade = smoothstep(0.0, 0.03, vAge) * (1.0 - vAge);
				gl_FragColor = vec4(colour, soft * soft * fade * opacity);
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
			}
		`,
	});
	const mesh = new THREE.Mesh(seededSquares(o.count), material);
	// The puffs are placed in the shader, so three can't tell where they are.
	mesh.frustumCulled = false;
	return mesh;
}

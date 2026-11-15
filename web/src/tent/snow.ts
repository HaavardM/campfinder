import * as THREE from "three";
import { seededSquares } from "./plume";
import { TENT } from "./specs";

// Falling snow: flakes in a box 24 m across and 12 m high that travels
// with the camera, so it snows wherever you look from. Like the plumes,
// each flake works out where it is from the clock: it falls, drifts with
// the wind and sways, and wraps round to the top of the box. None fall
// inside the tent.

const ACROSS = 24;
const HIGH = 12;

// Set `light` in its uniforms for how bright the flakes are, and `time`
// every frame.
export type Snow = THREE.Mesh<
	THREE.InstancedBufferGeometry,
	THREE.ShaderMaterial
>;

export function snowfall(count = 6000): Snow {
	const material = new THREE.ShaderMaterial({
		uniforms: { time: { value: 0 }, light: { value: 1 } },
		transparent: true,
		depthWrite: false,
		vertexShader: /* glsl */ `
			uniform float time;
			attribute vec4 seed;
			varying vec2 vUv;
			const float across = ${ACROSS.toFixed(1)};
			const float high = ${HIGH.toFixed(1)};
			void main() {
				// Falling at 0.6 to 1.1 m/s, blown along x and a little along z.
				vec3 at = seed.xyz * vec3(across, high, across);
				at.y -= time * (0.6 + seed.w * 0.5);
				at.xz += time * vec2(0.5, 0.15);
				at.x += sin(time * 0.8 + seed.w * 20.0) * 0.15;
				at.z += cos(time * 0.6 + seed.w * 13.0) * 0.15;
				// Wrap into the box round the camera.
				vec3 low = cameraPosition - vec3(across, high, across) * 0.5;
				at = low + mod(at - low, vec3(across, high, across));
				// Out of the tent: a dome about as high as it is wide.
				float shown = step(${(TENT.radius + 0.1).toFixed(2)}, length(at));
				vec4 centre = viewMatrix * vec4(at, 1.0);
				// Drawn 2.5 to 4.5 cm across, larger than real flakes, so they read
				// on a screen.
				centre.xy += position.xy * (0.025 + seed.w * 0.02) * shown;
				gl_Position = projectionMatrix * centre;
				vUv = uv;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float light;
			varying vec2 vUv;
			void main() {
				float soft = smoothstep(1.0, 0.3, length(vUv - 0.5) * 2.0);
				gl_FragColor = vec4(vec3(light), soft * 0.9);
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
			}
		`,
	});
	const mesh = new THREE.Mesh(seededSquares(count), material);
	// The flakes are placed in the shader, so three can't tell where they are.
	mesh.frustumCulled = false;
	return mesh;
}

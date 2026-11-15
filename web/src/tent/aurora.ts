import * as THREE from "three";
import { NOISE_GLSL } from "./noise";

// The northern lights: curtains of green, fading to purple at the top,
// low over the northern sky (-z). A dome 9 km out, beyond the mountains,
// added on top of the sky behind it; the tent and the mountains hide it
// like anything else. Each curtain has a sharp lower edge that wanders
// along the horizon, fine vertical rays that shimmer, and fades upwards.
// Set `time` in its uniforms every frame.
export function aurora(): THREE.Mesh<
	THREE.SphereGeometry,
	THREE.ShaderMaterial
> {
	const material = new THREE.ShaderMaterial({
		uniforms: { time: { value: 0 } },
		side: THREE.BackSide,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		vertexShader: /* glsl */ `
			varying vec3 vDirection;
			void main() {
				vDirection = position;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float time;
			varying vec3 vDirection;

			${NOISE_GLSL}

			void main() {
				vec3 d = normalize(vDirection);
				float around = atan(d.z, d.x);
				float up = asin(d.y);
				// Strongest towards north (-z), gone behind you.
				float north = smoothstep(1.9, 0.4, abs(around + 1.5708));
				// Most of the dome stays dark; skip the work there.
				if (north <= 0.0) {
					gl_FragColor = vec4(0.0);
					return;
				}

				vec3 colour = vec3(0.0);
				for (int i = 0; i < 2; i++) {
					float k = float(i);
					// The lower edge, 12 to 25 degrees up, snaking, with small
					// folds running along it.
					float edge = 0.22 + k * 0.12
						+ 0.08 * sin(around * 2.0 + time * 0.16 + k * 2.0)
						+ 0.04 * sin(around * 5.0 - time * 0.25 + k)
						+ 0.012 * sin(around * 23.0 + time * 1.1 + k * 4.0);
					float above = up - edge;
					float curtain = smoothstep(-0.015, 0.01, above) * exp(-max(above, 0.0) * (7.0 - k * 2.0));
					if (curtain < 0.002) continue;
					// Fine rays that flicker and travel sideways along the curtain.
					float rays = 0.3 + 0.7 * noise(vec2(around * 60.0 + time * 0.5 + k * 13.0, time * 0.8));
					rays *= 0.6 + 0.4 * noise(vec2(around * 12.0 - time * 0.2, k));
					// Patches that slowly swell and fade.
					float swell = 0.55 + 0.45 * noise(vec2(around * 3.0 + k * 7.0, time * 0.25));
					vec3 hue = mix(vec3(0.1, 1.0, 0.45), vec3(0.7, 0.2, 0.65), smoothstep(0.05, 0.25, above));
					colour += hue * curtain * rays * swell * (1.0 - k * 0.4);
				}
				gl_FragColor = vec4(colour * north * 0.6, 1.0);
			}
		`,
	});
	// Only the upper half: there is never any below the horizon.
	const dome = new THREE.SphereGeometry(
		9000,
		64,
		16,
		0,
		Math.PI * 2,
		0,
		Math.PI / 2,
	);
	return new THREE.Mesh(dome, material);
}

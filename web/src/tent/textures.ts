import * as THREE from "three";
import { random } from "./noise";

// Small textures drawn in code, so the app needs no image files. Most are
// used as bump maps: grey values that fake fine surface relief in the
// lighting. `size` is how many metres one copy of the texture covers; the
// geometry's UVs are in metres, so `repeat` turns metres into copies.

type Draw = (ctx: CanvasRenderingContext2D, px: number) => void;

export function make(px: number, size: number, draw: Draw, colour = false) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = px;
	draw(canvas.getContext("2d") as CanvasRenderingContext2D, px);
	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1 / size, 1 / size);
	texture.anisotropy = 8;
	if (colour) texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, build: () => THREE.Texture) {
	if (!cache.has(key)) cache.set(key, build());
	return cache.get(key) as THREE.Texture;
}

// Plain weave: threads going over and under each other, with slubs (thicker
// spots) as in cotton. One tile is 2 cm of cloth.
export function weave() {
	return cached("weave", () =>
		make(256, 0.02, (ctx, px) => {
			const rand = random(3);
			const threads = 32;
			const step = px / threads;
			ctx.fillStyle = "#808080";
			ctx.fillRect(0, 0, px, px);
			for (let i = 0; i < threads; i++) {
				for (let j = 0; j < threads; j++) {
					// Warp over weft on alternating squares.
					const over = (i + j) % 2 === 0;
					const shade = 110 + rand() * 50 + (over ? 30 : -10);
					ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
					if (over) ctx.fillRect(i * step + 1, j * step, step - 2, step);
					else ctx.fillRect(i * step, j * step + 1, step, step - 2);
				}
			}
		}),
	);
}

// Fur for the reindeer hide: thousands of short strokes, mostly lying one
// way. Used as the colour map.
export function fur() {
	return cached("fur", () =>
		make(
			512,
			0.25,
			(ctx, px) => {
				const rand = random(8);
				ctx.fillStyle = "#857663";
				ctx.fillRect(0, 0, px, px);
				for (let i = 0; i < 14000; i++) {
					const x = rand() * px;
					const y = rand() * px;
					const len = 6 + rand() * 10;
					const a = Math.PI / 2 + (rand() - 0.5) * 0.8;
					const l = 70 + rand() * 90;
					ctx.strokeStyle = `rgba(${l + 25},${l + 12},${l},0.5)`;
					ctx.lineWidth = 1 + rand();
					ctx.beginPath();
					ctx.moveTo(x, y);
					ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
					ctx.stroke();
				}
			},
			true,
		),
	);
}

// Birch bark: white with dark horizontal lenticels. Colour map; one tile
// wraps once round a log.
export function birchBark() {
	return cached("birch", () => {
		const t = make(
			256,
			1,
			(ctx, px) => {
				const rand = random(12);
				ctx.fillStyle = "#e9e5da";
				ctx.fillRect(0, 0, px, px);
				for (let i = 0; i < 90; i++) {
					const l = 30 + rand() * 60;
					ctx.fillStyle = `rgba(${l},${l},${l - 5},${0.5 + rand() * 0.5})`;
					ctx.fillRect(
						rand() * px,
						rand() * px,
						2 + rand() * 4,
						6 + rand() * 30,
					);
				}
			},
			true,
		);
		return t;
	});
}

// Wood grain for crate planks: long wavy lines. Colour map.
export function woodGrain() {
	return cached("wood", () =>
		make(
			256,
			0.3,
			(ctx, px) => {
				const rand = random(21);
				ctx.fillStyle = "#9a7148";
				ctx.fillRect(0, 0, px, px);
				for (let i = 0; i < 60; i++) {
					const y0 = rand() * px;
					const l = 100 + rand() * 60;
					ctx.strokeStyle = `rgba(${l},${l * 0.7},${l * 0.45},0.6)`;
					ctx.lineWidth = 1 + rand() * 2;
					ctx.beginPath();
					for (let x = 0; x <= px; x += 8) {
						const y = y0 + Math.sin(x / 40 + i) * 4;
						if (x === 0) ctx.moveTo(x, y);
						else ctx.lineTo(x, y);
					}
					ctx.stroke();
				}
			},
			true,
		),
	);
}

// Brushed stainless steel: fine lines in one direction. Bump map.
export function brushed() {
	return cached("brushed", () =>
		make(256, 0.1, (ctx, px) => {
			const rand = random(31);
			ctx.fillStyle = "#808080";
			ctx.fillRect(0, 0, px, px);
			for (let y = 0; y < px; y++) {
				const l = 100 + rand() * 60;
				ctx.fillStyle = `rgb(${l},${l},${l})`;
				ctx.fillRect(0, y, px, 1);
			}
		}),
	);
}

// Quilted down: rows of puffy baffles. Bump map, one baffle per tile.
export function quilt() {
	return cached("quilt", () =>
		make(64, 0.12, (ctx, px) => {
			const g = ctx.createLinearGradient(0, 0, px, 0);
			g.addColorStop(0, "#202020");
			g.addColorStop(0.5, "#e0e0e0");
			g.addColorStop(1, "#202020");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, px, px);
		}),
	);
}

// A copy of `texture` repeated `u` × `v` times over a shape whose UVs run
// from 0 to 1 (three's built-in geometries).
export function tiled(texture: THREE.Texture, u: number, v: number) {
	const copy = texture.clone();
	copy.repeat.set(u, v);
	copy.needsUpdate = true;
	return copy;
}

// Soft blotches of wear and dirt, for the groundsheet. Colour map, mostly
// light grey so it only shades the material colour a little; one tile is
// 1.5 m.
export function mottle() {
	return cached("mottle", () =>
		make(
			256,
			1.5,
			(ctx, px) => {
				const rand = random(41);
				ctx.fillStyle = "#e6e6e6";
				ctx.fillRect(0, 0, px, px);
				for (let i = 0; i < 160; i++) {
					const x = rand() * px;
					const y = rand() * px;
					const r = 6 + rand() * 30;
					const g = ctx.createRadialGradient(x, y, 0, x, y, r);
					const l = 150 + rand() * 90;
					g.addColorStop(0, `rgba(${l},${l},${l - 10},0.35)`);
					g.addColorStop(1, `rgba(${l},${l},${l - 10},0)`);
					ctx.fillStyle = g;
					ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
				}
			},
			true,
		),
	);
}

// Smooth 2D noise for the landscape. Value noise: a random number at every
// whole grid point, blended smoothly between them. Layering several sizes
// ("octaves") gives natural looking terrain.

function hash(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

// Noise in [0, 1] with features about 1 unit across.
export function noise(x: number, y: number, seed = 1): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const tx = smooth(x - x0);
	const ty = smooth(y - y0);
	const a = hash(x0, y0, seed);
	const b = hash(x0 + 1, y0, seed);
	const c = hash(x0, y0 + 1, seed);
	const d = hash(x0 + 1, y0 + 1, seed);
	return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// Several octaves, each half the size and half the strength. In [0, 1].
export function fbm(x: number, y: number, octaves: number, seed = 1): number {
	let sum = 0;
	let amplitude = 0.5;
	let total = 0;
	for (let i = 0; i < octaves; i++) {
		sum += amplitude * noise(x, y, seed + i * 17);
		total += amplitude;
		x *= 2;
		y *= 2;
		amplitude *= 0.5;
	}
	return sum / total;
}

// Deterministic random numbers so the scene looks the same every load.
export function random(seed: number): () => number {
	let i = 0;
	return () => hash(i++, 0, seed);
}

/** Small deterministic noise helpers for procedural scenery (no allocations per call). */

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1]. */
export function valueNoise3(x: number, y: number, z: number, seed = 1): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/** Fractal value noise normalized to [0, 1]. */
export function fbm3(x: number, y: number, z: number, octaves = 5, seed = 1): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum +=
      valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 101) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** Ridged multifractal noise in [0, 1]; sharp crests suit mountain ranges. */
export function ridged3(x: number, y: number, z: number, octaves = 5, seed = 7): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    const n = valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 131);
    let ridge = 1 - Math.abs(n * 2 - 1);
    ridge *= ridge * weight;
    weight = Math.min(1, Math.max(0, ridge * 1.6));
    sum += ridge * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum / norm;
}

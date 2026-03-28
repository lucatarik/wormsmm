import { mulberry32 } from './rng.js';

/**
 * Generate a terrain heightmap using layered sine waves.
 * @param {number} seed - Seed for reproducible terrain
 * @param {number} width - World width in pixels
 * @param {number} gameHeight - World height in pixels
 * @returns {Int32Array} heightmap[x] = y coordinate of terrain surface
 */
export function generateHeightmap(seed, width, gameHeight) {
  const rng = mulberry32(seed);

  const waves = [
    { freq: 0.006, amp: 0.18, phase: rng() * Math.PI * 2 },
    { freq: 0.013, amp: 0.12, phase: rng() * Math.PI * 2 },
    { freq: 0.028, amp: 0.08, phase: rng() * Math.PI * 2 },
    { freq: 0.055, amp: 0.04, phase: rng() * Math.PI * 2 },
    { freq: 0.110, amp: 0.02, phase: rng() * Math.PI * 2 },
  ];

  const heightmap = new Int32Array(width);
  const baseY = gameHeight * 0.52;

  for (let x = 0; x < width; x++) {
    let y = baseY;
    for (const w of waves) {
      y += Math.sin(x * w.freq + w.phase) * gameHeight * w.amp;
    }
    heightmap[x] = Math.round(
      Math.max(gameHeight * 0.22, Math.min(gameHeight * 0.88, y))
    );
  }

  return heightmap;
}

/**
 * Build a flat pixel array from a heightmap.
 * 1 = solid terrain, 0 = air.
 * @param {Int32Array} heightmap
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} pixels[y * width + x]
 */
export function buildTerrainPixels(heightmap, width, height) {
  const pixels = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = heightmap[x]; y < height; y++) {
      pixels[y * width + x] = 1;
    }
  }
  return pixels;
}

/**
 * Find the surface Y position (first solid pixel from top) at a given X.
 * @param {Uint8Array} pixels
 * @param {number} x
 * @param {number} width
 * @param {number} height
 * @returns {number} Y of surface, or height if no solid found
 */
export function findSurfaceY(pixels, x, width, height) {
  const ix = Math.max(0, Math.min(width - 1, Math.floor(x)));
  for (let y = 0; y < height; y++) {
    if (pixels[y * width + ix] === 1) {
      return y;
    }
  }
  return height;
}

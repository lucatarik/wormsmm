/**
 * Mulberry32 seeded PRNG - fast 32-bit pseudo-random number generator.
 * @param {number} seed - Integer seed value
 * @returns {function(): number} Random function returning [0, 1)
 */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using a seeded RNG.
 * @param {Array} arr - Array to shuffle (mutated in place)
 * @param {function(): number} rng - Random number generator function
 * @returns {Array} The shuffled array
 */
export function seededShuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a random integer between min (inclusive) and max (inclusive) using seeded RNG.
 * @param {function(): number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function rngInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array using seeded RNG.
 * @param {function(): number} rng
 * @param {Array} arr
 * @returns {*}
 */
export function rngPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// @ts-check

import { seededRandom } from '../utils/helpers.js';

export const LEGACY_SESSION_RNG_ALGORITHM = 'lcg-v1';
export const LEGACY_SESSION_RNG_STREAM = 'pieces:shared-v1';

const UINT32_RANGE = 0x100000000;
const UINT32_MAX = 0xffffffff;

/**
 * @typedef {Readonly<{
 *   algorithm: 'lcg-v1',
 *   seed: number,
 *   stream: 'pieces:shared-v1',
 * }>} LegacySessionRngDescriptor
 */

/**
 * @typedef {{
 *   cryptoProvider?: {getRandomValues: (values: Uint32Array) => Uint32Array}|null,
 *   fallbackRandom?: (() => number),
 * }} SessionSeedGenerationOptions
 */

/**
 * Accept only a canonical finite uint32 seed. This boundary deliberately does
 * not inherit seededRandom's historical coercion of strings and other values.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeSessionSeed(value) {
    if (typeof value !== 'number'
        || !Number.isFinite(value)
        || !Number.isInteger(value)
        || value < 0
        || value > UINT32_MAX) {
        throw new TypeError('Session seed must be a finite uint32 integer');
    }

    return Object.is(value, -0) ? 0 : value;
}

/**
 * Generate a uint32 seed. Production prefers Web Crypto; both sources are
 * injectable so tests and headless callers can choose a deterministic path.
 *
 * @param {SessionSeedGenerationOptions} [options]
 * @returns {number}
 */
export function generateSessionSeed(options = {}) {
    const cryptoProvider = options.cryptoProvider === undefined
        ? globalThis.crypto
        : options.cryptoProvider;

    if (cryptoProvider !== null && cryptoProvider !== undefined) {
        if (typeof cryptoProvider.getRandomValues !== 'function') {
            throw new TypeError('Session seed crypto provider must implement getRandomValues');
        }
        const words = new Uint32Array(1);
        cryptoProvider.getRandomValues(words);
        return normalizeSessionSeed(words[0]);
    }

    const fallbackRandom = options.fallbackRandom ?? Math.random;
    if (typeof fallbackRandom !== 'function') {
        throw new TypeError('Session seed fallback must be a function');
    }
    const draw = fallbackRandom();
    if (typeof draw !== 'number' || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
        throw new TypeError('Session seed fallback must return a finite number in [0, 1)');
    }
    return normalizeSessionSeed(Math.floor(draw * UINT32_RANGE));
}

/**
 * @param {number} seed
 * @returns {LegacySessionRngDescriptor}
 */
export function createLegacySessionRngDescriptor(seed) {
    const normalizedSeed = normalizeSessionSeed(seed);
    return Object.freeze({
        algorithm: LEGACY_SESSION_RNG_ALGORITHM,
        seed: normalizedSeed,
        stream: LEGACY_SESSION_RNG_STREAM,
    });
}

/**
 * Bind the existing legacy LCG to one game state. Validation and construction
 * happen before either property is assigned, so invalid inputs cannot leave a
 * half-initialized RNG seam.
 *
 * @param {Record<string, any>} gameState
 * @param {number} seed
 * @returns {LegacySessionRngDescriptor}
 */
export function bindLegacySessionRng(gameState, seed) {
    if (gameState === null || typeof gameState !== 'object' || Array.isArray(gameState)) {
        throw new TypeError('Session RNG requires a game-state object');
    }

    const descriptor = createLegacySessionRngDescriptor(seed);
    const randomGenerator = seededRandom(descriptor.seed);

    gameState.randomGenerator = randomGenerator;
    gameState.rngDescriptor = descriptor;
    return descriptor;
}

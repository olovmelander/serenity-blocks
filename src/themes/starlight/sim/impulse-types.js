/**
 * Stardust impulse kinds (numeric — written straight into the compute impulse buffer).
 *
 * Extracted from stardust-particles.js so pure-JS consumers (the reaction adapters and
 * their renderer-free tests) can map to these values without importing the three/webgpu
 * compute module. stardust-particles.js re-exports this so existing importers are unaffected.
 */
export const IMPULSE_TYPE = Object.freeze({ RADIAL: 0, VORTEX: 1, ATTRACTOR: 2 });

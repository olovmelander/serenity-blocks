import { normalizeQuality } from '../../utils/quality.js';

/**
 * Every tier keeps the whole picture — the ray-traced hole, its disk, the lensed galaxy and
 * every event. Tiers trade march resolution, particle counts and offscreen work.
 *
 *   marchSteps   integration budget per ray near the hole
 *   stepScale    step length as a fraction of the distance to the hole (smaller = truer)
 *   diskDetail   read a second, finer octave of the gas texture
 *   starLayers   layers of resolved, lensed stars
 *   skySize      galaxy panorama resolution [width, height]
 *   dustCount    orbiting motes          sparkCount  combo ejecta
 *   infallMotes  motes per fed piece     infallSlots pieces in flight at once
 *   pixelRatio   device-pixel-ratio cap; dynamic resolution works below it
 *   minScale     floor of the dynamic resolution scale
 */
export const QUALITY_PRESETS = Object.freeze({
    Extreme: Object.freeze({
        marchSteps: 96,
        stepScale: 0.1,
        diskDetail: true,
        starLayers: 2,
        skySize: [768, 384],
        dustCount: 5200,
        sparkCount: 6400,
        infallMotes: 144,
        infallSlots: 8,
        enablePost: true,
        bloomScale: 0.5,
        dispersion: true,
        pixelRatio: 1.15,
        minScale: 0.6,
    }),
    Ultra: Object.freeze({
        marchSteps: 80,
        stepScale: 0.115,
        diskDetail: true,
        starLayers: 2,
        skySize: [640, 320],
        dustCount: 3800,
        sparkCount: 4400,
        infallMotes: 120,
        infallSlots: 8,
        enablePost: true,
        bloomScale: 0.5,
        dispersion: true,
        pixelRatio: 1.1,
        minScale: 0.58,
    }),
    High: Object.freeze({
        marchSteps: 64,
        stepScale: 0.135,
        diskDetail: true,
        starLayers: 2,
        skySize: [512, 256],
        dustCount: 2400,
        sparkCount: 2800,
        infallMotes: 96,
        infallSlots: 8,
        enablePost: true,
        bloomScale: 0.45,
        dispersion: true,
        pixelRatio: 1.0,
        minScale: 0.55,
    }),
    Medium: Object.freeze({
        marchSteps: 48,
        stepScale: 0.17,
        diskDetail: true,
        starLayers: 2,
        skySize: [512, 256],
        dustCount: 1500,
        sparkCount: 1800,
        infallMotes: 72,
        infallSlots: 6,
        enablePost: true,
        bloomScale: 0.38,
        dispersion: false,
        pixelRatio: 0.95,
        minScale: 0.5,
    }),
    Low: Object.freeze({
        marchSteps: 36,
        stepScale: 0.21,
        diskDetail: false,
        starLayers: 1,
        skySize: [384, 192],
        dustCount: 800,
        sparkCount: 1000,
        infallMotes: 48,
        infallSlots: 6,
        enablePost: true,
        bloomScale: 0.32,
        dispersion: false,
        pixelRatio: 0.85,
        minScale: 0.5,
    }),
    Minimal: Object.freeze({
        marchSteps: 28,
        stepScale: 0.26,
        diskDetail: false,
        starLayers: 1,
        skySize: [256, 128],
        dustCount: 420,
        sparkCount: 520,
        infallMotes: 32,
        infallSlots: 4,
        enablePost: false,
        bloomScale: 0,
        dispersion: false,
        pixelRatio: 0.85,
        minScale: 0.5,
    }),
});

/** `Minimum` is the label older saved settings carry for the cheapest tier. */
export function normalizeBlackHoleQuality(quality) {
    const legacyMinimum = String(quality ?? '').trim().toLowerCase() === 'minimum';
    return normalizeQuality(legacyMinimum ? 'Minimal' : quality);
}

export function resolveBlackHoleQuality(quality) {
    const name = normalizeBlackHoleQuality(quality);
    return { name, preset: QUALITY_PRESETS[name] };
}

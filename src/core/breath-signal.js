// @ts-check

/**
 * The breath the player is following, for whatever should breathe with it.
 *
 * When the breathing guide leads a breath over the theme (Serenity Mode, "Over the theme"), it
 * publishes how full the lungs are; the shared camera breath every theme carries
 * (src/themes/shared/camera-breath.js) then follows that breath instead of its own 4 s / 6 s
 * clock, so the world breathes with you. When nobody guides, there is no signal and every
 * theme keeps its own breath.
 *
 * No DOM, no clock and no imports: the boot path (the guide) and the themes both import it.
 */

/** @type {(() => number) | null} */
let source = null;

/**
 * Publish the breath being followed, or stop publishing it.
 * @param {(() => number) | null} read returns the lungs' fill now, 0 empty .. 1 full
 */
export function setBreathSignal(read) {
    source = typeof read === 'function' ? read : null;
}

/**
 * The fill being followed now.
 * @returns {number | null} 0..1, or null while nobody is guiding a breath
 */
export function readBreathSignal() {
    if (!source) return null;
    let value;
    try {
        value = source();
    } catch {
        return null;
    }
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

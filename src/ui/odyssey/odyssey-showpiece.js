/**
 * The orb's showpiece: when a goal is met, the theme plays its strongest reactions as one short
 * reel before the ceremony. The reel is built from the Serenity effects catalogue (the same
 * events a real quad, cascade and perfect clear send), re-timed from physics pacing to a
 * celebration, so every theme answers with the reactions it was authored for.
 */
import {
    buildEffect, createEffectContext, effectDuration,
} from '../serenity-mode/serenity-effects.js';

/** The default reel: a quad, a six-wave cascade, and the board emptying. */
export const DEFAULT_ODYSSEY_SHOWPIECE = Object.freeze(['quad', 'cascade-6', 'perfect-clear']);

/**
 * Themes whose strongest reaction is not the default reel's. Keyed by theme id; each is an
 * ordered list of catalogue effect ids. Tune with screenshots on a GPU machine (playground
 * `?effect=<id>`); every theme without an entry plays the default reel.
 */
export const ODYSSEY_THEME_SHOWPIECES = Object.freeze({});

/**
 * The catalogue's physics pacing, compressed: a reel, not a replay. At 0.45 the quad, the
 * cascade and the perfect clear ran together into one 1.3 s blur; at 0.75 each lands as its
 * own burst and the cascade still reads as a cascade.
 */
export const SHOWPIECE_TIME_SCALE = 0.75;
/** Breath between the reel's effects. */
export const SHOWPIECE_GAP_MS = 320;
/**
 * After the reel's last event (the board emptying) the theme's own answer plays out before the
 * ceremony covers it: a theme's perfect-clear reaction runs for seconds (Serenity Warp falls
 * through its gate), and 300 ms showed only its first frames.
 */
export const SHOWPIECE_SETTLE_MS = 2600;
export const SHOWPIECE_SOURCE = 'odyssey-goal';

export function getOdysseyShowpieceEffects(themeId) {
    return ODYSSEY_THEME_SHOWPIECES[themeId] || DEFAULT_ODYSSEY_SHOWPIECE;
}

/**
 * @param {object} options
 * @param {string} [options.themeId] the finished orb's theme
 * @param {string|number} [options.levelId]
 * @param {boolean} [options.reducedMotion] one still moment (the perfect clear) instead of a reel
 * @param {(shapeKey: string) => string|null|undefined} [options.colorFor]
 * @returns {{ at: number, type: string, payload: object }[]} the reel's events, ms from its start
 */
export function buildOdysseyShowpiece({
    themeId = null, levelId = null, reducedMotion = false, colorFor,
} = {}) {
    const stamp = (payload) => ({ ...payload, source: SHOWPIECE_SOURCE, ...(levelId == null ? {} : { levelId }) });
    if (reducedMotion) {
        const steps = buildEffect('perfect-clear', createEffectContext({ colorFor })) || [];
        const clear = steps.find((step) => step.type === 'perfectClear');
        return clear ? [{ at: 0, type: clear.type, payload: stamp(clear.payload) }] : [];
    }
    const reel = [];
    let offset = 0;
    for (const effectId of getOdysseyShowpieceEffects(themeId)) {
        // A fresh context per effect: no plain "chain-breaking" lock between them.
        const steps = buildEffect(effectId, createEffectContext({ colorFor }));
        if (!steps?.length) continue;
        const base = offset;
        for (const step of steps) {
            reel.push({
                at: Math.round(base + step.at * SHOWPIECE_TIME_SCALE),
                type: step.type,
                payload: stamp(step.payload),
            });
        }
        offset = base + Math.round(effectDuration(steps) * SHOWPIECE_TIME_SCALE) + SHOWPIECE_GAP_MS;
    }
    return reel;
}

/** How long a reel holds the stage before the ceremony: its last event plus a settle. */
export function odysseyShowpieceDuration(steps) {
    return (steps.length ? steps[steps.length - 1].at : 0) + SHOWPIECE_SETTLE_MS;
}

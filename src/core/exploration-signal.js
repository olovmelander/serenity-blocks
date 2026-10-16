// @ts-check

/**
 * Infinity's exploration, for whatever should move with it.
 *
 * While the player looks around the tower (the wheel, the right stick, the tower map), the
 * mode's ascent director (src/ui/infinity/ascent/) publishes where the view is and how it is
 * moving. The shared camera breath every theme carries (src/themes/shared/camera-breath.js)
 * then cranes the theme's camera with the view, and BaseTheme slows the theme's clock, so the
 * world holds its breath while you look. When nobody explores there is no signal and every
 * theme is exactly as it was.
 *
 * No DOM, no clock and no imports, like breath-signal.js: the boot path (BaseTheme) and the
 * themes both import it.
 */

/**
 * @typedef {object} ExplorationState
 * @property {number} weight how present the exploration is: 0 playing .. 1 looking (eased)
 * @property {number} rise where the view is: toward +1 well above the rows the player plays
 *   in, toward -1 far below them, 0 at them (saturating)
 * @property {number} speed how the view moves: +1 rising fast, -1 falling fast
 * @property {number} timeScale how fast the world's clock should run: 1 .. about 0.25
 */

/** @type {(() => Partial<ExplorationState> | null) | null} */
let source = null;

/** Reused for every read (themes read it every frame). @type {ExplorationState} */
const state = {
    weight: 0, rise: 0, speed: 0, timeScale: 1,
};

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function clamp(value, min, max, fallback) {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
}

/**
 * Publish the exploration, or stop publishing it.
 * @param {(() => Partial<ExplorationState> | null) | null} read returns the state now (or null
 *   while nobody explores)
 */
export function setExplorationSignal(read) {
    source = typeof read === 'function' ? read : null;
}

/**
 * The exploration now. The object is reused between calls: read what you need from it.
 * @returns {Readonly<ExplorationState> | null} null while nobody explores
 */
export function readExplorationSignal() {
    if (!source) return null;
    let value;
    try {
        value = source();
    } catch {
        return null;
    }
    if (!value) return null;
    const weight = clamp(value.weight, 0, 1, 0);
    if (weight <= 0) return null;
    state.weight = weight;
    state.rise = clamp(value.rise, -1, 1, 0);
    state.speed = clamp(value.speed, -1, 1, 0);
    state.timeScale = clamp(value.timeScale, 0.05, 1, 1);
    return state;
}

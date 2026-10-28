// @ts-check
/**
 * @fileoverview The Odyssey map's graphics settings, read the way the themes read theirs (perf
 * audit 2026-10-28, "graphics settings never reach the map").
 *
 * The board read the quality tier once at build and nothing else: the Render Scale slider and the
 * Anti-aliasing switch never reached it, and a board kept alive across orbs kept its first tier
 * for the whole Odyssey session. The themes take all three from one place: the tier from the
 * settings, and the render scale and antialiasing from the globals main.js keeps
 * (themes/base-theme.js getGlobalRenderScale / getGlobalAntialias: the player's settings, as the
 * desktop performance policy resolves them on a packaged build). This reads the same three.
 *
 * What a change can do to a built board: the render scale applies live (a resize, as the themes
 * resize); the tier and the antialiasing are built into it (chapter and world lanes, particle
 * counts, the scene pass's MSAA), so they take effect when the board is next built: under the next
 * return gate, or on the next visit (see `qualityRebuildReason`).
 */

import { getGlobalAntialias, getGlobalRenderScale } from '../../themes/base-theme.js';
import { sceneSamples } from '../../themes/shared/scene-antialias.js';
import { clampRenderScale } from '../../utils/desktop-performance-policy.js';

/** The tier the board builds when the settings name none. */
const DEFAULT_TIER = 'High';

/**
 * The live settings: the manager's (its `update()` replaces the object, and `window.settings` is
 * pointed at the new one only later) over `window.settings`.
 * @param {any} [win]
 * @returns {Record<string, any>}
 */
export function readOdysseySettings(win = globalThis.window) {
    const managed = win?.serenityBlocks?.settingsManager?.get?.();
    const legacy = win?.settings;
    if (managed && legacy) return { ...legacy, ...managed };
    return managed ?? legacy ?? {};
}

/**
 * The player's render scale as the themes apply it (the global main.js keeps, clamped as
 * computeScenePixelRatio clamps it): 1 unless Settings > Render Scale or the desktop policy says.
 * @param {number} [scale]
 * @returns {number}
 */
export function readOdysseyRenderScale(scale = getGlobalRenderScale()) {
    return clampRenderScale(scale);
}

/**
 * @typedef {object} OdysseyQualityProfile
 * @property {string} tier effect quality tier, as stored ('Minimal' ... 'Extreme')
 * @property {number} renderScale the player's render scale (clamped as the themes clamp it)
 * @property {boolean} antialias the game's antialiasing switch
 * @property {number} sceneSamples the scene pass's MSAA at this tier with this switch (4 or 0)
 */

/**
 * @param {{settings?: Record<string, any>, renderScale?: number, antialias?: boolean}} [sources]
 * @returns {OdysseyQualityProfile}
 */
export function readOdysseyQualityProfile({
    settings = readOdysseySettings(),
    renderScale = getGlobalRenderScale(),
    antialias = getGlobalAntialias(),
} = {}) {
    const tier = typeof settings?.effectQuality === 'string' && settings.effectQuality
        ? settings.effectQuality
        : DEFAULT_TIER;
    const aa = antialias !== false;
    return {
        tier,
        renderScale: readOdysseyRenderScale(renderScale),
        antialias: aa,
        sceneSamples: sceneSamples(tier, aa),
    };
}

/**
 * Why a board built with `built` no longer matches the settings (null when it does): a new tier
 * changes what was built at every level; the antialiasing switch only changes the scene pass's
 * samples, so it matters only where the tier draws with MSAA.
 * @param {OdysseyQualityProfile|null|undefined} built
 * @param {OdysseyQualityProfile} live
 * @returns {'tier'|'antialiasing'|null}
 */
export function qualityRebuildReason(built, live) {
    if (!built || !live) return null;
    if (built.tier !== live.tier) return 'tier';
    if (built.sceneSamples !== live.sceneSamples) return 'antialiasing';
    return null;
}

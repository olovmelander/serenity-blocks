/**
 * The world's answers to the journey between two orbs: small things on the orbs and the rail
 * themselves, so coming back out of an orb and riding to the next one is seen by the world.
 *
 *   - The finished orb's STARS LAND on it: each drops onto its seat over the orb's crown and
 *     settles, one after the other (LevelNodeManager.landStars).
 *   - A RIPPLE of light runs along the rail from the finished orb to the one ahead as the ride
 *     to it begins: the rail lights up ahead of you (OdysseyPathRenderer.playRipple).
 *   - The orb ahead WAKES as the light reaches it: it swells once (LevelNodeManager.pulseNode).
 *
 * Seen after every orb, so all three are short and quiet, and none of them moves anything a
 * resting view depends on. Reduced motion gets none of it: the stars are simply there.
 * This file is the schedules (pure) and the one call the flow makes.
 */

/** The stars' landing: each takes `durationMs`, the next starts `staggerMs` later. */
export const STAR_LANDING = Object.freeze({
    durationMs: 560,
    staggerMs: 150,
    /** How far above its seat a star starts, in glass radii. */
    drop: 2.2,
    /** How big it swells as it lands (its settled size is 1). */
    swell: 1.3,
});

/** How long the whole landing takes (ms). */
export function starLandingTotalMs(slots = 3) {
    return STAR_LANDING.durationMs + STAR_LANDING.staggerMs * (slots - 1);
}

/**
 * One star's pose `elapsedMs` into the landing.
 * @param {number} elapsedMs since the landing began
 * @param {number} slot 0..2, left to right
 * @returns {{scale: number, lift: number}} `scale`: of its settled size (0 before it appears);
 *   `lift`: how far above its seat it is, in glass radii
 */
export function starLandingPose(elapsedMs, slot) {
    const t = (elapsedMs - slot * STAR_LANDING.staggerMs) / STAR_LANDING.durationMs;
    if (!(t > 0)) return { scale: 0, lift: STAR_LANDING.drop };
    if (t >= 1) return { scale: 1, lift: 0 };
    const fall = 1 - (1 - t) ** 3;
    // Up to its swell as it touches down (t = 0.7), then settling to its own size.
    const land = t < 0.7
        ? (t / 0.7) ** 0.6 * STAR_LANDING.swell
        : STAR_LANDING.swell - (STAR_LANDING.swell - 1) * (1 - (1 - (t - 0.7) / 0.3) ** 2);
    return { scale: land, lift: STAR_LANDING.drop * (1 - fall) };
}

/** The rail's ripple: its width (world units) and how its light rises and dies. */
export const RAIL_RIPPLE = Object.freeze({
    width: 7,
    /** Share of the run over which it lights up, and over which it fades once arrived. */
    fadeIn: 0.12,
    fadeOutSeconds: 0.5,
    /** How long a run takes (ms): a floor, plus this much a world unit, up to a ceiling. */
    minMs: 950,
    msPerUnit: 9,
    maxMs: 2600,
});

/**
 * Where a ripple is and how bright, `elapsed` seconds into it.
 * @param {{from: number, to: number, elapsed: number, duration: number, strength: number}} ripple
 *   path positions (0..1), seconds
 * @param {number} arcLength the path's length in world units
 * @returns {{head: number, strength: number, arrived: boolean, done: boolean}} `head` in world
 *   units along the path
 */
export function resolveRailRipple(ripple, arcLength) {
    const raw = ripple.elapsed / ripple.duration;
    if (raw <= 0) {
        return {
            head: ripple.from * arcLength, strength: 0, arrived: false, done: false,
        };
    }
    const t = Math.min(1, raw);
    // Away fast, arriving gently: the light leads the ride and waits for it at the orb.
    const eased = 1 - (1 - t) ** 2.4;
    const fadeIn = Math.min(1, t / RAIL_RIPPLE.fadeIn);
    const after = Math.max(0, ripple.elapsed - ripple.duration);
    const fadeOut = Math.max(0, 1 - after / RAIL_RIPPLE.fadeOutSeconds);
    return {
        head: (ripple.from + (ripple.to - ripple.from) * eased) * arcLength,
        strength: ripple.strength * fadeIn * fadeIn * (3 - 2 * fadeIn) * fadeOut * fadeOut,
        arrived: raw >= 1,
        done: after >= RAIL_RIPPLE.fadeOutSeconds,
    };
}

/** How long the ripple between two path positions runs (ms). */
export function railRippleDurationMs(from, to, arcLength) {
    const units = Math.abs(to - from) * arcLength;
    return Math.max(RAIL_RIPPLE.minMs, Math.min(RAIL_RIPPLE.maxMs, RAIL_RIPPLE.minMs + units * RAIL_RIPPLE.msPerUnit));
}

/**
 * The rail lights up from one orb to the next, and the orb ahead wakes as the light reaches
 * it. Called as the ride to it begins (and, on a plain return to the map, as the world opens).
 * Never throws; a board without a rail or orbs simply does nothing.
 * @param {object|null} board OdysseyBoardController (nodeManager, pathRenderer)
 * @param {object} run
 * @param {number} run.fromId the orb the light leaves
 * @param {number} run.toId the orb it runs to
 * @param {number} [run.delayMs]
 * @param {boolean} [run.reducedMotion]
 * @returns {boolean} whether the light set off
 */
export function lightRailAhead(board, {
    fromId, toId, delayMs = 0, reducedMotion = false,
} = {}) {
    const nodes = board?.nodeManager;
    const rail = board?.pathRenderer;
    if (!nodes || !rail?.playRipple || reducedMotion) return false;
    try {
        const from = Number.isFinite(fromId) ? nodes.getNodePathPosition?.(fromId) : null;
        const to = Number.isFinite(toId) ? nodes.getNodePathPosition?.(toId) : null;
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
        return rail.playRipple({
            from,
            to,
            delayMs,
            durationMs: railRippleDurationMs(from, to, rail.pathCurve?.getLength?.() || 2500),
            onArrive: () => nodes.pulseNode?.(toId, 1000, 0.12),
        });
    } catch (error) {
        console.warn('[Odyssey] The rail could not light up ahead:', error);
        return false;
    }
}

/**
 * The world answers an orb just finished as its gate opens: its stars land on it and it swells
 * once. On a plain return to the map the rail lights up toward the orb ahead at once; when the
 * journey rides on, the flow lights it as the ride begins (lightRailAhead). Never throws.
 * @param {object|null} board OdysseyBoardController (nodeManager, pathRenderer)
 * @param {object} answer
 * @param {number} answer.finishedId the orb just cleared
 * @param {number|null} [answer.nextId] the orb ahead (unlocked)
 * @param {boolean} [answer.ripple] light the rail toward `nextId` now (a plain return)
 * @param {boolean} [answer.reducedMotion]
 * @returns {boolean} whether anything was started
 */
export function answerOrbFinished(board, {
    finishedId, nextId = null, ripple = true, reducedMotion = false,
} = {}) {
    const nodes = board?.nodeManager;
    if (!nodes || !Number.isFinite(finishedId) || reducedMotion) return false;
    try {
        nodes.landStars?.(finishedId);
        nodes.pulseNode?.(finishedId, 760);
    } catch (error) {
        console.warn('[Odyssey] The world could not answer the finished orb:', error);
        return false;
    }
    if (ripple) lightRailAhead(board, { fromId: finishedId, toId: nextId, delayMs: 420 });
    return true;
}

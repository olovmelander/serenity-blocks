/**
 * Time spent breathing in the worlds outside a Hale session (the Breathing tab's practice), kept
 * on this device: `serenity.breathPractice` = { v: 1, seconds, worlds: { <world id>: seconds } }.
 *
 * It counts toward opening worlds and sessions by practice (breath-collection.js), alongside the
 * Hale practice log. A stretch is counted from when the guide starts on a world to when it stops,
 * changes world or the page is hidden; a stretch of a few seconds (a world glimpsed while
 * browsing) is not practice.
 */
export const BREATH_PRACTICE_KEY = 'serenity.breathPractice';
/** Shorter than this, a stretch in one world is browsing, not practice. */
export const MIN_STRETCH_SECONDS = 20;
/** A stretch never counts for more than this (a guide left running unattended). */
export const MAX_STRETCH_SECONDS = 30 * 60;

function defaultStorage() {
    try {
        return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** @returns {{v: 1, seconds: number, worlds: Object<string, number>}} */
export function readBreathPractice(storage = defaultStorage()) {
    try {
        const raw = JSON.parse(storage?.getItem(BREATH_PRACTICE_KEY) || 'null');
        const worlds = {};
        Object.entries(raw?.worlds || {}).forEach(([id, seconds]) => {
            if (typeof id === 'string' && Number.isFinite(seconds) && seconds > 0) worlds[id] = Math.round(seconds);
        });
        const seconds = Object.values(worlds).reduce((sum, value) => sum + value, 0);
        return { v: 1, seconds, worlds };
    } catch {
        return { v: 1, seconds: 0, worlds: {} };
    }
}

/** Add a stretch of practice in one world. Returns whether it counted. */
export function addBreathPractice(worldId, seconds, storage = defaultStorage()) {
    const counted = Math.min(MAX_STRETCH_SECONDS, Math.round(Number(seconds) || 0));
    if (!worldId || counted < MIN_STRETCH_SECONDS) return false;
    const practice = readBreathPractice(storage);
    practice.worlds[worldId] = (practice.worlds[worldId] || 0) + counted;
    practice.seconds += counted;
    try {
        storage?.setItem(BREATH_PRACTICE_KEY, JSON.stringify(practice));
        return true;
    } catch {
        return false;
    }
}

/**
 * Follow the breathing guide and record its stand-alone practice. A Hale session drives the
 * guide too (`isExternallyControlled`): those minutes are the practice log's, not counted here.
 * @param {{guide: object, storage?: object, now?: () => number, onRecorded?: () => void,
 *   target?: EventTarget, doc?: Document}} options
 * @returns {{flush: () => void, stop: () => void}}
 */
export function trackStandalonePractice({
    guide, storage = defaultStorage(), now = () => Date.now(), onRecorded = null,
    target = globalThis.window, doc = globalThis.document,
} = {}) {
    let stretch = null;
    const breathing = () => Boolean(guide?.isActive) && !guide?.isExternallyControlled && !doc?.hidden;
    const flush = () => {
        if (!stretch) return;
        const counted = addBreathPractice(stretch.world, (now() - stretch.since) / 1000, storage);
        stretch = null;
        if (counted) onRecorded?.();
    };
    const sync = () => {
        const world = breathing() ? guide.currentTechnique : null;
        if (stretch && stretch.world === world) return;
        flush();
        if (world) stretch = { world, since: now() };
    };
    const events = ['breathingGuideChange', 'breathingTechniqueChange'];
    events.forEach((type) => target?.addEventListener?.(type, sync));
    doc?.addEventListener?.('visibilitychange', sync);
    sync();
    return {
        flush: () => {
            flush();
            sync();
        },
        stop: () => {
            flush();
            events.forEach((type) => target?.removeEventListener?.(type, sync));
            doc?.removeEventListener?.('visibilitychange', sync);
        },
    };
}

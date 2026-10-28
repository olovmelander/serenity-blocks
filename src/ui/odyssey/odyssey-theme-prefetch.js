// @ts-check
/**
 * @fileoverview Warming level themes from the Odyssey map (perf audit 2026-10-28, "theme prefetches
 * push the picked orb's theme out and land on glides").
 *
 * The map warms the theme of the orb the player has picked, so Play enters a loaded theme, and,
 * on a guess, the themes of orbs they may pick next: the one under the cursor and the picked
 * orb's neighbours. The theme cache holds two themes (ThemeManager.maxCachedThemes; one in
 * packaged-Windows startup and safe mode) and the active one cannot leave it, which leaves room
 * for one more. Every guess took that room: hovering another orb, or the neighbours' warm-up
 * 420 ms after a pick, pushed the picked orb's theme out, and Play loaded it again under the
 * tunnel. A theme load also runs the theme's import and init on the main thread, and a guess
 * started at the first idle moment: in a glide (orbs pass under a moving cursor), a scroll, or
 * the return's reveal.
 *
 * The picked orb's theme is warmed as before. A guess (OdysseyThemeWarmups):
 * - waits for a quiet map (OdysseyBoardController.isQuietForSpeculativeWork) with no entry,
 *   return or journey interlude on it, and, for a hovered orb, for the cursor to rest on it;
 * - never starts while another theme load is in flight or scheduled, so the room it sees is the
 *   room it gets;
 * - never pushes out a theme still wanted: the picked orb's, or another guess's while it holds
 *   (the next neighbour keeps the room from the previous one). It may push out one nobody wants;
 * - is dropped once nobody wants it (the cursor left the orb, another orb was picked) or after
 *   WAIT_MS.
 * A pick made while a guess is loading waits for it to land, then pushes it out: started side by
 * side, whichever load finished last kept the room.
 */
import { isOdysseyWorldInterlude } from './odyssey-world-return.js';

/** How often a waiting guess looks at the map again. */
const POLL_MS = 250;
/** How long a guess may wait for a quiet map before it is dropped. */
const WAIT_MS = 6000;
/** How long the cursor rests on an orb before its theme is worth warming: not the orbs it crosses. */
const HOVER_DWELL_MS = 300;
/** How long the player stays on a picked orb before its neighbours are warmed. */
const NEIGHBOUR_DELAY_MS = 420;

/**
 * The OdysseyMode members read and written here (OdysseyMode is not type-checked).
 * @typedef {{
 *   isActive?: boolean,
 *   isInBoardView?: boolean,
 *   isEnteringLevel?: boolean,
 *   selectedLevelId?: number | null,
 *   _boardReturnOperation?: object | null,
 *   boardController?: { hoveredLevelId?: number | null, isQuietForSpeculativeWork?: () => boolean } | null,
 *   transitionManager?: any,
 *   deps?: { themeManager?: any },
 *   levelRegistry: { resolveLevelPresentation: (level: any) => any, getLevelsInChapter: (chapter: any) => any[] },
 *   currentThemePrefetchLevelId?: number | null,
 *   currentThemePrefetchPromise?: Promise<unknown> | null,
 *   levelThemePrefetchTimer?: ReturnType<typeof setTimeout> | null,
 *   _themeWarmups?: OdysseyThemeWarmups,
 * }} OdysseyThemePrefetchMode
 */

/**
 * @typedef {{
 *   level: any,
 *   themeName: string,
 *   wants: Array<() => boolean>,
 *   notBefore: number,
 *   until: number,
 *   resolve: (warmed: boolean) => void,
 *   promise: Promise<boolean>,
 * }} WarmupEntry
 */

/** @param {OdysseyThemePrefetchMode} mode */
function themeManagerOf(mode) {
    return mode.transitionManager?.themeManager ?? mode.deps?.themeManager ?? null;
}

/** @param {WarmupEntry} entry */
const isWanted = (entry) => entry.wants.some((wanted) => wanted());

/**
 * The theme ThemeManager.ensureThemeCacheCapacity evicts next to make room: the least recently
 * used one that is neither active nor being switched to. Null when it cannot tell.
 * @param {any} manager
 * @returns {string | null}
 */
function nextEvictedTheme(manager) {
    const order = manager?.themeLRU;
    if (!Array.isArray(order)) return null;
    for (const name of order) {
        const instance = manager.themeInstances.get(name);
        if (instance && instance !== manager.activeTheme && instance !== manager.pendingThemeInstance) {
            return name;
        }
    }
    return null;
}

/** @param {() => void} run */
function runWhenIdle(run) {
    if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(() => run(), { timeout: 450 });
    } else {
        setTimeout(run, 0);
    }
}

/** The map's guesses at the next theme the player needs, one load at a time (see the file header). */
export class OdysseyThemeWarmups {
    /**
     * @param {OdysseyThemePrefetchMode} mode
     * @param {{ now?: () => number, idle?: (run: () => void) => void }} [env]
     */
    constructor(mode, { now = () => Date.now(), idle = runWhenIdle } = {}) {
        this.mode = mode;
        this.now = now;
        this.idle = idle;
        /** @type {WarmupEntry[]} */
        this.queue = [];
        /** @type {Map<string, WarmupEntry>} guesses that loaded, kept from eviction while wanted */
        this.warmed = new Map();
        /** @type {Promise<boolean> | null} the guess loading now */
        this.inFlight = null;
        /** @type {ReturnType<typeof setTimeout> | null} */
        this.timer = null;
        this.idleArmed = false;
    }

    /**
     * Warm `level`'s theme once the map is quiet, while `wanted()` holds.
     * @param {any} level
     * @param {{ wanted: () => boolean, dwellMs?: number }} options
     * @returns {Promise<boolean>} whether the theme was warmed
     */
    request(level, { wanted, dwellMs = 0 }) {
        const themeName = level?.theme?.primary;
        if (!themeName) return Promise.resolve(false);
        const pending = this.queue.find((entry) => entry.themeName === themeName);
        if (pending) {
            pending.wants.push(wanted);
            return pending.promise;
        }
        const now = this.now();
        /** @type {(warmed: boolean) => void} */
        let resolve = () => {};
        /** @type {Promise<boolean>} */
        const promise = new Promise((done) => { resolve = done; });
        this.queue.push({
            level, themeName, wants: [wanted], notBefore: now + dwellMs, until: now + WAIT_MS, resolve, promise,
        });
        this._schedule(0);
        return promise;
    }

    /** Drop every waiting guess (a pick, a return, the mode stopping). A load in flight lands. */
    clear() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.queue.splice(0).forEach((entry) => entry.resolve(false));
        this.warmed.clear();
    }

    /** @param {number} delayMs */
    _schedule(delayMs) {
        if (this.timer || this.queue.length === 0) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this._tick();
        }, delayMs);
    }

    _prune() {
        const now = this.now();
        this.queue = this.queue.filter((entry) => {
            if (now <= entry.until && isWanted(entry)) return true;
            entry.resolve(false);
            return false;
        });
    }

    _tick() {
        this._prune();
        if (this.queue.length === 0 || this.inFlight) return;
        if (!this._mayLoad() || this.idleArmed) {
            this._schedule(POLL_MS);
            return;
        }
        // Start in idle time, as the transition manager's own low-priority prefetches do.
        this.idleArmed = true;
        this.idle(() => {
            this.idleArmed = false;
            this._tryStart();
        });
    }

    _tryStart() {
        this._prune();
        const now = this.now();
        const entry = !this.inFlight && this._mayLoad() ? this.queue.find((e) => now >= e.notBefore) : null;
        if (entry) this._start(entry);
        if (!this.inFlight) this._schedule(POLL_MS);
    }

    /** The map is quiet and no other theme load is in flight or scheduled. */
    _mayLoad() {
        const { mode } = this;
        if (!mode.isActive || !mode.isInBoardView || mode.isEnteringLevel || mode._boardReturnOperation
            || isOdysseyWorldInterlude(mode)) return false;
        if (mode.boardController?.isQuietForSpeculativeWork?.() !== true) return false;
        const manager = themeManagerOf(mode);
        if ((manager?.inFlightThemeLoads?.size ?? 0) > 0) return false;
        return (mode.transitionManager?.prefetchRecords?.size ?? 0) === 0;
    }

    /** Themes a guess must not push out: the picked orb's, and the guesses still wanted. */
    _kept() {
        const kept = new Set();
        const { selectedLevelId } = this.mode;
        const picked = selectedLevelId === null || selectedLevelId === undefined ? null
            : this.mode.levelRegistry.resolveLevelPresentation(selectedLevelId)?.theme?.primary;
        if (picked) kept.add(picked);
        this.warmed.forEach((entry, name) => {
            if (isWanted(entry)) kept.add(name);
            else this.warmed.delete(name);
        });
        return kept;
    }

    /**
     * Whether `themeName` can enter the cache without pushing out a theme still wanted.
     * @param {string} themeName
     */
    _fits(themeName) {
        const manager = themeManagerOf(this.mode);
        const cache = manager?.themeInstances;
        const cap = manager?.maxCachedThemes;
        if (!cache || typeof cap !== 'number' || !(cap >= 1)) return false;
        if (cache.has(themeName) || cache.size < cap) return true;
        const evicted = nextEvictedTheme(manager);
        return evicted !== null && !this._kept().has(evicted);
    }

    /** @param {WarmupEntry} entry */
    _start(entry) {
        this.queue.splice(this.queue.indexOf(entry), 1);
        if (!this._fits(entry.themeName)) {
            entry.resolve(false);
            return;
        }
        // Started now ('high'): the wait above stood in for the transition manager's idle wait,
        // and starting later would let another load take the room this one was given.
        /** @type {Promise<unknown>} */
        let started;
        try {
            const { transitionManager } = this.mode;
            started = Promise.resolve(transitionManager.prefetchLevelTheme(entry.level, { priority: 'high' }));
        } catch (error) {
            started = Promise.reject(error);
        }
        /** @type {Promise<boolean>} */
        const load = started
            .then((warmed) => {
                if (warmed === true) this.warmed.set(entry.themeName, entry);
                return warmed === true;
            }, (error) => {
                console.warn('[Odyssey] Theme warm-up failed:', entry.themeName, error);
                return false;
            })
            .then((warmed) => {
                if (this.inFlight === load) this.inFlight = null;
                entry.resolve(warmed);
                this._schedule(POLL_MS);
                return warmed;
            });
        this.inFlight = load;
    }
}

/** @param {OdysseyThemePrefetchMode} mode */
function warmupsOf(mode) {
    if (!mode._themeWarmups) mode._themeWarmups = new OdysseyThemeWarmups(mode);
    return mode._themeWarmups;
}

/**
 * Stop the neighbours' timer and drop the waiting guesses (OdysseyMode._clearLevelThemePrefetchTimer).
 * @param {OdysseyThemePrefetchMode} mode
 */
export function clearOdysseyThemePrefetch(mode) {
    if (mode.levelThemePrefetchTimer) {
        clearTimeout(mode.levelThemePrefetchTimer);
        mode.levelThemePrefetchTimer = null;
    }
    mode._themeWarmups?.clear();
}

/**
 * Warm the theme of the orb under the cursor, once it rests there on a quiet map.
 * @param {OdysseyThemePrefetchMode} mode
 * @param {number} levelId
 * @returns {Promise<boolean>}
 */
export function warmOdysseyHoveredLevelTheme(mode, levelId) {
    const level = mode.levelRegistry.resolveLevelPresentation(levelId);
    if (!level || !mode.transitionManager?.prefetchLevelTheme) return Promise.resolve(false);
    return warmupsOf(mode).request(level, {
        wanted: () => mode.boardController?.hoveredLevelId === levelId && mode.selectedLevelId !== levelId,
        dwellMs: HOVER_DWELL_MS,
    });
}

/**
 * Warm a picked orb's theme (OdysseyMode._prefetchLikelyLevelThemes) and, with `includeAdjacent`,
 * guess at its neighbours once the player stays on it, the next orb first.
 * @param {OdysseyThemePrefetchMode} mode
 * @param {any} levelOrId
 * @param {{ priority?: string, includeAdjacent?: boolean, trackAsCurrent?: boolean }} [options]
 * @returns {Promise<unknown>}
 */
export function prefetchOdysseyLevelThemes(mode, levelOrId, options = {}) {
    const level = typeof levelOrId === 'object'
        ? levelOrId
        : mode.levelRegistry.resolveLevelPresentation(levelOrId);
    const priority = options.priority === 'high' ? 'high' : 'low';
    const trackAsCurrent = options.trackAsCurrent !== false;
    const transitions = mode.transitionManager;
    if (!level || !transitions?.prefetchLevelTheme) return Promise.resolve(false);

    clearOdysseyThemePrefetch(mode);
    const landing = mode._themeWarmups?.inFlight;
    const prefetchPromise = landing
        ? landing.then(() => (mode.isActive && (!trackAsCurrent || mode.currentThemePrefetchLevelId === level.id)
            ? transitions.prefetchLevelTheme(level, { priority }) : false))
        : transitions.prefetchLevelTheme(level, { priority });
    if (trackAsCurrent) {
        mode.currentThemePrefetchLevelId = level.id ?? null;
        mode.currentThemePrefetchPromise = prefetchPromise;
    }

    if (options.includeAdjacent === true) {
        mode.levelThemePrefetchTimer = setTimeout(() => {
            mode.levelThemePrefetchTimer = null;
            if (mode.selectedLevelId !== level.id || mode.isEnteringLevel) return;
            const chapterLevels = mode.levelRegistry.getLevelsInChapter(level.chapter)
                .map((entry) => mode.levelRegistry.resolveLevelPresentation(entry))
                .filter(Boolean);
            const index = chapterLevels.findIndex((entry) => entry.id === level.id);
            if (index < 0) return;
            [chapterLevels[index + 1], chapterLevels[index - 1]]
                .filter(Boolean)
                .forEach((adjacentLevel) => {
                    warmupsOf(mode).request(adjacentLevel, { wanted: () => mode.selectedLevelId === level.id });
                });
        }, NEIGHBOUR_DELAY_MS);
    }

    return prefetchPromise;
}

// @ts-check

/**
 * What the tower remembers: the big moments of this climb, kept at the height they happened
 * (rows from the floor), so looking down the tower is also looking back over it.
 *
 * It listens to the game's own events for one Infinity session: LINE_CLEAR (each wave of a
 * chain), PIECE_LOCK (the next piece closes the chain before it) and PERFECT_CLEAR. A chain that
 * was big enough becomes a mark when it closes: "6-chain cascade", "Four lines at once",
 * "Perfect clear". The tower map and the ascent's overlay draw them; the overlay names the one
 * the view passes.
 */

import { eventBus as defaultBus, EVENTS } from '../../../events/event-bus.js';

export const MEMORY = Object.freeze({
    /** The smallest chain (waves of clears from one piece) worth remembering. */
    MIN_CHAIN: 3,
    /** The fewest lines in one wave worth remembering. */
    MIN_LINES: 4,
    /** Marks kept (the most significant). */
    MAX_MARKS: 24,
    /** A chain with no new wave for this long is closed even without a next piece. */
    CHAIN_SETTLE_MS: 1500,
    /** The view's centre within this many rows of a mark names it. */
    NEAR_ROWS: 3.5,
});

/**
 * @typedef {object} TowerMark
 * @property {number} height rows from the floor where it began
 * @property {'perfect'|'chain'|'lines'} kind
 * @property {string} label
 * @property {number} at ms (the clock the memory was given)
 * @property {number} weight how significant (the most significant are kept)
 */

/**
 * The words for a moment.
 * @param {{chain: number, lines: number, waveLines: number, perfect: boolean}} moment
 * @returns {{kind: 'perfect'|'chain'|'lines', label: string, weight: number} | null}
 */
export function describeMoment({
    chain, lines, waveLines, perfect,
}) {
    if (perfect) return { kind: 'perfect', label: 'Perfect clear', weight: 1000 + lines };
    if (chain >= MEMORY.MIN_CHAIN) {
        const suffix = lines > chain ? ` · ${lines} lines` : '';
        return { kind: 'chain', label: `${chain}-chain cascade${suffix}`, weight: chain * 10 + lines };
    }
    if (waveLines >= MEMORY.MIN_LINES) {
        const label = waveLines === 4 ? 'Four lines at once' : `${waveLines} lines at once`;
        return { kind: 'lines', label, weight: waveLines * 6 };
    }
    return null;
}

/**
 * How long ago, in words. @param {number} ms
 * @returns {string}
 */
export function agoText(ms) {
    const minutes = Math.floor(Math.max(0, ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? '1 h ago' : `${hours} h ago`;
}

export class TowerMemory {
    /**
     * @param {{
     *   getBoardLength: () => number,
     *   now?: () => number,
     *   bus?: { on: (name: string, handler: (payload: any) => void) => (() => void) },
     * }} options
     */
    constructor({ getBoardLength, now, bus = defaultBus }) {
        this.getBoardLength = getBoardLength;
        this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : 0));
        this.bus = bus;
        /** @type {TowerMark[]} */
        this._marks = [];
        /** @type {null|{height: number, chain: number, lines: number, waveLines: number, perfect: boolean, last: number}} */
        this.open = null;
        /** @type {Array<() => void>} */
        this.unsubscribe = [];
        /** @type {Set<(marks: TowerMark[]) => void>} */
        this.listeners = new Set();
        this.version = 0;
    }

    /** Listen to the game for this session. */
    start() {
        if (this.unsubscribe.length || !this.bus?.on) return;
        this.unsubscribe.push(
            this.bus.on(EVENTS.LINE_CLEAR, (payload) => this.noteClear(payload || {})),
            this.bus.on(EVENTS.PIECE_LOCK, () => this.close()),
            this.bus.on(EVENTS.PERFECT_CLEAR, () => this.notePerfectClear()),
        );
    }

    stop() {
        this.unsubscribe.splice(0).forEach((off) => { try { off?.(); } catch { /* already gone */ } });
    }

    clear() {
        this._marks = [];
        this.open = null;
        this._changed();
    }

    /** @param {(marks: TowerMark[]) => void} listener @returns {() => void} */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** @param {{lineCount?: number, clearedRows?: number[], cascadeCount?: number}} clear */
    noteClear({ lineCount = 0, clearedRows = [], cascadeCount = 1 }) {
        const rows = Array.isArray(clearedRows) ? clearedRows.filter(Number.isFinite) : [];
        const lines = Math.max(Number(lineCount) || 0, rows.length);
        if (lines <= 0) return;
        const now = this.now();
        if (this.open && now - this.open.last > MEMORY.CHAIN_SETTLE_MS) this.close();
        const boardLength = Number(this.getBoardLength?.()) || 0;
        const mean = rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : NaN;
        const height = Number.isFinite(mean) && boardLength > 0 ? Math.max(0, boardLength - mean - 0.5) : NaN;
        if (!this.open) {
            this.open = {
                height: Number.isFinite(height) ? height : 0,
                chain: 0,
                lines: 0,
                waveLines: 0,
                perfect: false,
                last: now,
            };
        }
        const chain = Math.max(1, Math.floor(Number(cascadeCount) || 1));
        this.open.chain = Math.max(this.open.chain, chain);
        this.open.lines += lines;
        this.open.waveLines = Math.max(this.open.waveLines, lines);
        this.open.last = now;
        if (!Number.isFinite(height)) return;
        // The chain is remembered where it began (its first wave).
        if (chain === 1) this.open.height = height;
    }

    notePerfectClear() {
        if (!this.open) {
            this.open = {
                height: 0, chain: 1, lines: 0, waveLines: 0, perfect: true, last: this.now(),
            };
        } else {
            this.open.perfect = true;
        }
    }

    /** Close the open chain: remember it if it was big enough. */
    close() {
        const moment = this.open;
        this.open = null;
        if (!moment) return;
        const words = describeMoment(moment);
        if (!words) return;
        this._marks.push({
            height: moment.height, kind: words.kind, label: words.label, at: moment.last, weight: words.weight,
        });
        if (this._marks.length > MEMORY.MAX_MARKS) {
            this._marks.sort((a, b) => b.weight - a.weight || b.at - a.at);
            this._marks.length = MEMORY.MAX_MARKS;
        }
        this._marks.sort((a, b) => a.height - b.height);
        this._changed();
    }

    /** The marks, lowest first (a chain still open is closed once it has settled). */
    get marks() {
        if (this.open && this.now() - this.open.last > MEMORY.CHAIN_SETTLE_MS) this.close();
        return this._marks;
    }

    /**
     * The mark nearest a height, if one is close enough.
     * @param {number} height @param {number} [within]
     * @returns {TowerMark | null}
     */
    nearest(height, within = MEMORY.NEAR_ROWS) {
        let best = null;
        let bestDistance = within;
        for (const mark of this.marks) {
            const distance = Math.abs(mark.height - height);
            if (distance <= bestDistance) {
                best = mark;
                bestDistance = distance;
            }
        }
        return best;
    }

    /** "6-chain cascade · 4 min ago". @param {TowerMark} mark */
    caption(mark) {
        return `${mark.label} · ${agoText(this.now() - mark.at)}`;
    }

    dispose() {
        this.stop();
        this.listeners.clear();
        this._marks = [];
        this.open = null;
    }

    _changed() {
        this.version += 1;
        this.listeners.forEach((listener) => {
            try { listener(this._marks); } catch (error) { console.warn('[TowerMemory] listener failed:', error); }
        });
    }
}

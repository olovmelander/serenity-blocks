// @ts-check
/**
 * The rising tide (level design audit 2026-11, phase 3's optional survival variant): rubble rows rise from below
 * on a schedule that tightens over time, so a survival orb is a race of clearing speed.
 *
 * Deterministic: the schedule runs on the attempt's simulation clock and the gaps come from the attempt's seed, so
 * a replay or a benchmark seed rises the same way. A gap column holds for a short run of rows, so one long I piece
 * can clear several tide rows at once, then moves.
 */

import { columnsToMask, maskArrayToBits } from '../garbage.js';

const COLUMNS = 10;
const TIDE_SEED_SALT = 0x7e1de;

/**
 * @typedef {{ startSeconds: number, firstEverySeconds: number, lastEverySeconds: number, rampSeconds: number }} TideConfig
 */

/** Whether a tide config is usable: a first row, an interval that only tightens, and a ramp to get there. */
export function isOdysseyTideConfig(config) {
    if (!config || typeof config !== 'object') return false;
    const {
        startSeconds, firstEverySeconds, lastEverySeconds, rampSeconds,
    } = config;
    return [startSeconds, firstEverySeconds, lastEverySeconds, rampSeconds].every(Number.isFinite)
        && startSeconds >= 0 && lastEverySeconds > 0 && firstEverySeconds >= lastEverySeconds && rampSeconds > 0;
}

/** Seconds between rows at time t: eases from the first interval to the last over the ramp, then holds. */
export function tideIntervalAt(config, seconds) {
    const progress = Math.min(1, Math.max(0, (seconds - config.startSeconds) / config.rampSeconds));
    return config.firstEverySeconds + (config.lastEverySeconds - config.firstEverySeconds) * progress;
}

function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One attempt's tide.
 * @param {TideConfig} config
 * @param {number} seed the attempt's seed
 */
export function createOdysseyTide(config, seed) {
    const random = mulberry32((Number(seed) || 0) ^ TIDE_SEED_SALT);
    let nextRowAt = config.startSeconds;
    let risen = 0;
    let gap = Math.floor(random() * COLUMNS);
    let runLeft = 0;

    function nextGap() {
        if (runLeft <= 0) {
            // A new column, never the one just used, held for a run of 1-4 rows.
            gap = (gap + 1 + Math.floor(random() * (COLUMNS - 1))) % COLUMNS;
            runLeft = 1 + Math.floor(random() * 4);
        }
        runLeft -= 1;
        return gap;
    }

    return {
        /** Rows risen so far. */
        get risen() { return risen; },
        /** Seconds until the next row, from the given time. */
        secondsUntilNext(seconds) { return Math.max(0, nextRowAt - seconds); },
        /**
         * The rows due by this time, as garbage entries (oldest first), and advance the schedule past them.
         * @param {number} seconds
         */
        take(seconds) {
            const entries = [];
            while (seconds >= nextRowAt) {
                entries.push({
                    type: 'line',
                    attackId: 'odyssey-tide',
                    variant: 'normal',
                    holeMask: maskArrayToBits(columnsToMask([nextGap()])),
                    color: '#808080',
                });
                risen += 1;
                nextRowAt += tideIntervalAt(config, nextRowAt);
            }
            return entries;
        },
    };
}

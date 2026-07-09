/**
 * @fileoverview Odyssey startup trace — lightweight timing instrumentation for the
 * board boot sequence (the 30s→≤10s startup optimization work).
 *
 * Wraps performance.now() deltas plus performance.mark/measure (prefix `odyssey:`)
 * so the same segments show up both as ONE console summary line and in the DevTools
 * Performance panel. Always on: a dozen marks per startup is negligible, and the
 * summary line is the regression canary for future startup creep.
 */

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());

function safeMark(name) {
    try {
        performance?.mark?.(name);
    } catch { /* mark unsupported — trace still works off now() */ }
}

function safeMeasure(name, startMark, endMark) {
    try {
        performance?.measure?.(name, startMark, endMark);
    } catch { /* measure unsupported or marks missing — non-fatal */ }
}

/**
 * Create a startup trace.
 * @param {string} label console prefix, e.g. '[OdysseyStartup]'
 * @returns {{begin(name:string):void, end(name:string):void, event(name:string):void,
 *            elapsed():number, summary():string}}
 */
export function createStartupTrace(label = 'OdysseyStartup') {
    const t0 = now();
    const starts = new Map();
    const durations = new Map(); // insertion order = step order in the summary line

    return {
        begin(name) {
            starts.set(name, now());
            safeMark(`odyssey:${name}:start`);
        },
        end(name) {
            const start = starts.get(name);
            if (start === undefined) return;
            durations.set(name, now() - start);
            starts.delete(name);
            safeMark(`odyssey:${name}:end`);
            safeMeasure(`odyssey:${name}`, `odyssey:${name}:start`, `odyssey:${name}:end`);
        },
        event(name) {
            console.log(`[${label}] ${name} +${((now() - t0) / 1000).toFixed(1)}s`);
            safeMark(`odyssey:${name}`);
        },
        elapsed() {
            return now() - t0;
        },
        summary() {
            const total = Math.round(now() - t0);
            const parts = [...durations.entries()]
                .map(([name, ms]) => `${name} ${Math.round(ms)}`)
                .join(' | ');
            const line = `[${label}] total ${total}ms | ${parts}`;
            console.log(line);
            return line;
        },
    };
}

export default { createStartupTrace };

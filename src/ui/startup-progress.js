// @ts-check
/**
 * The loading screen's progress line: it follows the boot's real milestones (the startup trace),
 * never runs backward, and moves only by a compositor transition (ADR-0020: the line keeps
 * moving while a shader compiles behind it). Between milestones a slow shimmer runs along it,
 * so a long warm never looks stuck.
 */

import { onStartupMark } from './startup-debug.js';

/** Startup trace phase → how far along the boot is (0..1). */
export const STARTUP_PROGRESS_STEPS = Object.freeze({
    'startup-pipeline:boot-started': 0.1,
    'startup-pipeline:app-ready': 0.34,
    'theme-warm:start': 0.44,
    'theme-warm:started': 0.6,
    'theme-warm:end': 0.72,
    'intro:show-start': 0.8,
    'intro:pipelines-async-start': 0.84,
    'boot-warp:theme-ready': 0.9,
    'boot-warp:prewarm-requested': 0.93,
    'boot-warp:committed': 0.98,
    'boot-warp:visible-start': 1,
    'startup-shell:dismiss-request': 1,
});

let shown = 0;

function shell() {
    try {
        return globalThis.document?.getElementById?.('startup-shell') ?? null;
    } catch {
        return null;
    }
}

/**
 * Move the line to `fraction` (it never goes back).
 * @param {number} fraction
 * @returns {number} what the line shows now
 */
export function setStartupProgress(fraction) {
    const next = Math.max(0, Math.min(1, Number(fraction) || 0));
    if (next <= shown) return shown;
    shown = next;
    try {
        const el = shell();
        el?.style?.setProperty?.('--sb-progress', next.toFixed(3));
        if (next >= 1) el?.classList?.add?.('is-ready');
    } catch {
        // cosmetic only
    }
    return shown;
}

let installed = null;

/** Follow the startup trace (idempotent). @returns {() => void} */
export function installStartupProgress() {
    if (!installed) {
        installed = onStartupMark((phase) => {
            const step = STARTUP_PROGRESS_STEPS[phase];
            if (step !== undefined) setStartupProgress(step);
        });
    }
    return installed;
}

export function resetStartupProgressForTests() {
    installed?.();
    installed = null;
    shown = 0;
}

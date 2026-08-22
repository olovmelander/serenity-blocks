/**
 * Odyssey URL-flag readers — the hardcoded-default call sites audit OD-14 pins
 * (tests/unit/odyssey-flag-registry-drift.test.js): registry default == call-site
 * default, read locally rather than through readFlag(). Extracted from
 * OdysseyMode.js (plan §3d god-file ceiling); the idioms are unchanged.
 */

/**
 * DEV-only layout editor (?odysseyEditor=1).
 * @returns {boolean}
 */
export function isOdysseyLayoutEditorEnabled() {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
        return false;
    }

    try {
        const search = new URLSearchParams(window.location?.search || '');
        return search.get('odysseyEditor') === '1';
    } catch {
        return false;
    }
}

/**
 * Whether to expose the console debug handles (window.odysseyMode / window.testOdysseyLevel).
 * These are DEV/tooling only — testOdysseyLevel unlocks levels into the real save, so it must
 * never ship to players (Steam leaderboard is console-gameable otherwise; masterplan §2 #4).
 * Allowed in a DEV build, or when a capture/validation harness flag is present so the offline
 * screenshot/perf tooling keeps working against any build mode.
 * @returns {boolean}
 */
export function isOdysseyDebugExposureEnabled() {
    if (typeof window === 'undefined') return false;
    if (import.meta.env.DEV) return true;
    try {
        const search = new URLSearchParams(window.location?.search || '');
        return search.get('odysseyAAA') === '1'
            || search.get('odysseyDebug') === '1'
            || search.has('odysseyCaptureChapters');
    } catch {
        return false;
    }
}

/**
 * Loading-optimization Phase 1: keep the WebGPU board resident across level
 * entry/return instead of disposing + rebuilding it (the cold-start cost, paid twice).
 * Default ON. Disable with ?odysseyKeepBoard=0 if VRAM/TDR pressure shows up — that
 * restores the exact previous dispose-and-rebuild behaviour.
 * @returns {boolean}
 */
export function readOdysseyKeepBoardFlag() {
    if (typeof window === 'undefined') {
        return true;
    }
    try {
        const search = new URLSearchParams(window.location?.search || '');
        const raw = search.get('odysseyKeepBoard');
        if (raw === '0' || raw === 'false' || raw === 'off') {
            return false;
        }
    } catch {
        // fall through to default
    }
    return true;
}

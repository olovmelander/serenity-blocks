// @ts-check
/**
 * Studio-ident hold style while the first theme warms behind it (ADR-0020).
 *
 * The moving hold (.sb-lit loops: orbit arcs, glow breathe, glint, sheen) is only honest while
 * nothing stalls the compositor. A synchronous pipeline/program compile does stall it, and moving
 * loops then visibly stop and jump, so:
 *  - no async path at all (rollback flag, no WebGPU adapter, backend prototype unresolved) → the
 *    static hold (.sb-lit--static), as before ADR-0020;
 *  - a warm on a synchronous renderer (a classic WebGL / WebGL2 backend theme) → the loops pause in
 *    place (.sb-lit--paused) BEFORE its start() (a classic WebGLRenderer compiles its programs on
 *    the first frame it renders inside start()) until the warm ends: a stall shows the frame the
 *    pause holds, and neither edge jumps. What a theme turned out to be is remembered per device,
 *    so only a never-seen theme is paused through its first start() just in case.
 */

const KIND_KEY = 'serenity.identHoldThemeKinds';
const ARMING_CLASS = 'sb-warp-arming';
const PAUSED_CLASS = 'sb-lit--paused';
// What the warp's GPU replica draws (boot-warp-transition-scene.js GLOW_OPACITY / GLOW_SCALE).
const REPLICA_GLOW = { opacity: '0.87', transform: 'scale(1.04)' };

/** @typedef {Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }} WebGPUNavigator */

function browserGPU() {
    return typeof navigator !== 'undefined' ? /** @type {WebGPUNavigator} */ (navigator).gpu : null;
}

let adapterAvailable = null; // null = not probed
let adapterProbe = null;
let armingAnimations = [];

function shellElement() {
    try {
        return globalThis.document?.getElementById?.('startup-shell') ?? null;
    } catch {
        return null;
    }
}

/**
 * Resolve whether a WebGPU adapter is actually available (navigator.gpu can exist with no adapter:
 * blocklisted GPU, old driver). Memoized; never rejects.
 * @returns {Promise<boolean>}
 */
export function probeWebGPUAdapter() {
    if (!adapterProbe) {
        const gpu = browserGPU();
        adapterProbe = Promise.resolve()
            .then(() => (gpu?.requestAdapter ? gpu.requestAdapter() : null))
            .then((adapter) => Boolean(adapter))
            .catch(() => false)
            .then((available) => {
                adapterAvailable = available;
                return available;
            });
    }
    return adapterProbe;
}

/**
 * @param {{ canUseAsyncLoadingSurface?: () => boolean } | null | undefined} themeManager
 * @returns {boolean}
 */
export function identHoldIsStatic(themeManager) {
    const hasWebGPU = Boolean(browserGPU()) && adapterAvailable !== false;
    return !hasWebGPU || themeManager?.canUseAsyncLoadingSurface?.() !== true;
}

/** @param {boolean} paused */
export function setIdentHoldPaused(paused) {
    try {
        shellElement()?.classList?.toggle(PAUSED_CLASS, paused);
    } catch {
        // cosmetic only
    }
}

function readKinds() {
    try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(KIND_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function rememberKind(theme, kind) {
    try {
        const kinds = readKinds();
        if (kinds[theme] === kind) return;
        kinds[theme] = kind;
        globalThis.localStorage?.setItem(KIND_KEY, JSON.stringify(kinds));
    } catch {
        // best effort
    }
}

/**
 * ThemeManager.prewarmTheme onPhase hook.
 * @param {string} phase
 * @param {{ theme?: string, asyncActive?: boolean, syncRenderer?: boolean } | undefined} payload
 */
export function onIdentHoldWarmPhase(phase, payload) {
    const theme = typeof payload?.theme === 'string' ? payload.theme : null;
    if (phase === 'start') {
        const kind = theme ? readKinds()[theme] : undefined;
        setIdentHoldPaused(kind !== 'async' && kind !== 'shared');
    } else if (phase === 'started') {
        let kind = 'shared';
        if (payload?.syncRenderer === true) kind = 'sync';
        else if (payload?.asyncActive === true) kind = 'async';
        if (theme) rememberKind(theme, kind);
        setIdentHoldPaused(kind === 'sync');
    } else if (phase === 'end') {
        setIdentHoldPaused(false);
    }
}

function settleKeyframes(shell) {
    const out = [];
    try {
        if (typeof getComputedStyle !== 'function') return out;
        const glow = shell.querySelector?.('.startup-logo__glow');
        if (glow && typeof glow.animate === 'function') {
            const style = getComputedStyle(glow);
            out.push({
                el: glow,
                keyframes: [{ opacity: style.opacity, transform: style.transform }, REPLICA_GLOW],
            });
        }
        // Settle the loading pulse before the wordmark's measured title handoff.
        // Its wrapper stays untransformed, so the destination geometry is stable.
        const wordmark = shell.querySelector?.('.startup-logo__name-text');
        if (wordmark && typeof wordmark.animate === 'function') {
            const style = getComputedStyle(wordmark);
            out.push({
                el: wordmark,
                // Release the transform so CSS can move the wordmark into the title.
                fill: 'none',
                keyframes: [
                    { opacity: style.opacity, transform: style.transform },
                    { opacity: '1', transform: 'scale(1)' },
                ],
            });
        }
        const logo = shell.querySelector?.('.startup-logo');
        if (logo && typeof logo.animate === 'function') {
            const { opacity } = getComputedStyle(logo);
            if (opacity !== '1') out.push({ el: logo, keyframes: [{ opacity }, { opacity: '1' }] });
        }
    } catch {
        // cosmetic only
    }
    return out;
}

/**
 * The warp is about to take over (~130 ms before the match-cut): settle the ident onto what the
 * GPU replica draws (glint gone, glow at its parked value, logo at full opacity), from wherever
 * its loops were. Chromium starts no CSS transition when the same style change removes an
 * animation, so the eases run through Web Animations, which `animation: none` does not touch.
 * @param {boolean} on
 */
export function setIdentArming(on) {
    const shell = shellElement();
    if (!shell) return;
    if (!on) {
        armingAnimations.splice(0).forEach((animation) => {
            try {
                animation.cancel();
            } catch {
                // cosmetic only
            }
        });
        try {
            shell.classList?.remove?.(ARMING_CLASS);
        } catch {
            // cosmetic only
        }
        return;
    }
    const settles = settleKeyframes(shell);
    try {
        shell.classList?.add?.(ARMING_CLASS);
        shell.classList?.remove?.(PAUSED_CLASS); // the warp owns the screen from here
    } catch {
        return;
    }
    armingAnimations = settles.map(({ el, keyframes, fill = 'forwards' }) => {
        try {
            return el.animate(keyframes, { duration: 110, easing: 'linear', fill });
        } catch {
            return null;
        }
    }).filter(Boolean);
}

export function resetStartupIdentHoldForTests() {
    adapterAvailable = null;
    adapterProbe = null;
    armingAnimations = [];
}

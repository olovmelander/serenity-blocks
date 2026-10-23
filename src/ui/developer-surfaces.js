/**
 * Settings' developer surfaces — the Open DevTools row and the URL-parameter reference (which
 * tells players that unlockAll=1 works) — are for development (audit R-07 step 7): a dev build,
 * or a desktop build started with SERENITY_ENABLE_DIAGNOSTICS=1. The main process refuses
 * DevTools requests from release builds on its own as well.
 * @returns {boolean}
 */
export function developerSurfacesEnabled() {
    if (import.meta.env.DEV) return true;
    return typeof window !== 'undefined' && window.electronAPI?.diagnosticsEnabled === true;
}

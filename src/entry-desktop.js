function reportStartupFailure(statusText, error) {
    const detail = error?.stack || error?.message || String(error);
    console.error('[DesktopEntry] Failed to import main renderer bundle:', error);
    const startupShell = window.__serenityStartupShell || window.__serenityStartupBridge;
    startupShell?.fail?.(statusText, detail);
}

if (typeof window !== 'undefined') {
    const startupShell = window.__serenityStartupShell || window.__serenityStartupBridge;
    startupShell?.set?.('Importing main application');
    try {
        window.electronAPI?.invoke?.('desktop:startup-mark', { phase: 'renderer-entry-started' });
    } catch (error) {
        console.warn('[DesktopEntry] Failed to report renderer entry start:', error);
    }
}

import('./main.js')
    .then(() => {
        const shell = window.__serenityStartupShell || window.__serenityStartupBridge;
        shell?.markBundleStarted?.('Renderer bundle loaded');
    })
    .catch((error) => {
        reportStartupFailure('Renderer bundle import failed', error);
    });

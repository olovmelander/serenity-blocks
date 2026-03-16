if (typeof window !== 'undefined') {
    window.__serenityStartupShell?.set?.('Importing main application');
    try {
        window.electronAPI?.invoke?.('desktop:startup-mark', { phase: 'renderer-entry-started' });
    } catch (error) {
        console.warn('[DesktopEntry] Failed to report renderer entry start:', error);
    }
}

import('./main.js').catch((error) => {
    const detail = error?.stack || error?.message || String(error);
    console.error('[DesktopEntry] Failed to import main renderer bundle:', error);
    window.__serenityStartupShell?.fail?.('Renderer bundle import failed', detail);
});

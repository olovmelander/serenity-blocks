function attemptCleanup(dispose) {
    try {
        dispose();
    } catch (error) {
        console.warn('[Main] Cleanup failed:', error);
    }
}

/** Retire mode-owned work before destroying the services its callbacks use. */
export function cleanupApplication(app) {
    if (app.cleanupPromise) return app.cleanupPromise;
    app.isCleaningUp = true;
    // Publish ownership before any disposer can recursively request cleanup.
    app.cleanupPromise = Promise.resolve().then(async () => {
        try {
            await app.gameModeManager?.cleanup?.();
        } catch (error) {
            console.warn('[Main] Game mode cleanup failed:', error);
        }
        // SerenityMode still needs the shared hub while deactivating.
        attemptCleanup(() => app.modalManager?.destroy?.());
        attemptCleanup(() => app.serenityHub?.destroy?.());
        app.serenityHub = null;
        attemptCleanup(() => app.phaserGame?.destroy?.(true));
        app.phaserGame = null;
        app.boardScene = null;
        for (const manager of [app.themeManager, app.inputController, app.soundManager]) {
            attemptCleanup(() => manager?.cleanup?.());
        }
        app.isInitialized = false;
        console.log('🧹 Application cleaned up');
    });

    attemptCleanup(() => app.settingsManager?.dispose?.());
    for (const handler of app.cleanupHandlers.splice(0)) attemptCleanup(() => handler?.());
    attemptCleanup(() => app.stopFPSMonitor?.());
    attemptCleanup(() => app.frameRateController?.stopHybridLoop?.());
    if (app.animationFrameId != null) {
        cancelAnimationFrame(app.animationFrameId);
        app.animationFrameId = null;
    }
    return app.cleanupPromise;
}

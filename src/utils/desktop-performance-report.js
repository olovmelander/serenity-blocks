/**
 * Desktop (Electron) performance-report plumbing — extracted from main.js so the
 * desktop investigation telemetry can grow without the god-file (plan §3d line
 * ceiling) growing with it. Behaviour is unchanged: the moved code keeps its call
 * order, its once-only install flags and its per-stage timer map, which are now
 * this module's private state instead of main.js module scope.
 *
 * `desktopRuntimeConfig` is reassigned in main.js as the Electron handshake lands,
 * so the config is read through a provider rather than captured at import time —
 * main.js calls `configureDesktopPerformanceReports` once at module scope.
 */
import { GAME_MODES } from '../core/constants.js';
import { performanceMonitor } from './performance-monitor.js';

const FIRST_INTERACTION_EVENT_TYPES = ['pointerdown', 'mousedown', 'wheel', 'keydown', 'touchstart'];

const desktopBenchmarkReportTimers = new Map();
let desktopBenchmarkReportHooksInstalled = false;
let firstInteractionReportInstalled = false;
let getRuntimeConfig = () => ({});

/**
 * Point the reporter at main.js's live `desktopRuntimeConfig` binding.
 * @param {{ getRuntimeConfig: () => object }} options
 */
export function configureDesktopPerformanceReports({ getRuntimeConfig: provider }) {
    if (typeof provider === 'function') {
        getRuntimeConfig = provider;
    }
}

export function getDesktopSettingsSnapshot(appInstance = null) {
    const settings = appInstance?.settingsManager?.get?.() || null;
    const performancePolicy = appInstance?.desktopPerformancePolicy || globalThis.window?.desktopPerformancePolicy || null;
    return {
        resolution: typeof window !== 'undefined'
            ? {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio || 1,
            }
            : null,
        displayMode: settings?.displayMode ?? 'windowed',
        vsyncEnabled: settings?.vsyncEnabled ?? true,
        targetFrameRate: settings?.targetFrameRate ?? 60,
        effectQuality: settings?.effectQuality ?? null,
        renderScale: settings?.renderScale ?? 1,
        backgroundTabBehavior: settings?.backgroundTabBehavior ?? null,
        enableAntialiasing: settings?.enableAntialiasing ?? true,
        enableBloom: settings?.enableBloom ?? true,
        enableShadows: settings?.enableShadows ?? true,
        particleQuality: settings?.particleQuality ?? null,
        textureQuality: settings?.textureQuality ?? null,
        qualityTier: performancePolicy?.qualityTier ?? settings?.effectQuality ?? null,
        internalRenderResolution: performancePolicy?.internalRenderResolution ?? null,
    };
}

export async function storeDesktopPerformanceReport(stage, appInstance = null, extra = {}) {
    if (!window.electronAPI?.storeDesktopPerformanceReport) {
        return null;
    }

    let processMetrics = null;
    try {
        processMetrics = await window.electronAPI.getProcessMetrics?.();
    } catch (error) {
        console.warn(`[DesktopRuntime] Failed to fetch process metrics (${stage}):`, error?.message || error);
    }

    const runtimeConfig = getRuntimeConfig();
    const snapshot = performanceMonitor.createDesktopInvestigationSnapshot({
        stage,
        appMode: runtimeConfig.appMode,
        runtimeConfig,
        runtimeProfile: runtimeConfig.windowsProfile || runtimeConfig.appMode,
        settingsSnapshot: getDesktopSettingsSnapshot(appInstance),
        processMetrics,
        windowBounds: processMetrics?.windowBounds || runtimeConfig.windowBounds || null,
        displayScaleFactor: processMetrics?.displayScaleFactor
            ?? runtimeConfig.displayScaleFactor
            ?? null,
        devicePixelRatio: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : null,
        performancePolicy: appInstance?.desktopPerformancePolicy || globalThis.window?.desktopPerformancePolicy || null,
        monitorRefreshRate: appInstance?.frameRateController?.monitorRefreshRate || null,
        extra,
    });

    try {
        return await window.electronAPI.storeDesktopPerformanceReport({ stage, snapshot });
    } catch (error) {
        console.warn(`[DesktopRuntime] Failed to store performance report (${stage}):`, error?.message || error);
        return null;
    }
}

export function clearScheduledDesktopPerformanceReports() {
    desktopBenchmarkReportTimers.forEach((timeoutId) => {
        clearTimeout(timeoutId);
    });
    desktopBenchmarkReportTimers.clear();
}

export function scheduleDesktopPerformanceReport(stage, appInstance = null, extra = {}, delayMs = 550) {
    if (typeof window === 'undefined') {
        return;
    }

    const existingTimeout = desktopBenchmarkReportTimers.get(stage);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
        desktopBenchmarkReportTimers.delete(stage);
        void storeDesktopPerformanceReport(stage, appInstance, extra);
    }, delayMs);
    desktopBenchmarkReportTimers.set(stage, timeoutId);
}

export function installDesktopBenchmarkReportHooks(appInstance) {
    if (desktopBenchmarkReportHooksInstalled || typeof window === 'undefined') {
        return;
    }

    desktopBenchmarkReportHooksInstalled = true;

    const handleModalShown = (event) => {
        const modalName = event?.detail?.modalName;
        if (modalName === 'start') {
            scheduleDesktopPerformanceReport('menu-idle', appInstance, {
                modalName,
            }, 700);
            return;
        }

        if (modalName === 'settings') {
            scheduleDesktopPerformanceReport('settings-open', appInstance, {
                modalName,
            }, 450);
        }
    };

    const handleHubVisibilityChange = (event) => {
        if (event?.detail?.visible) {
            scheduleDesktopPerformanceReport('hub-open', appInstance, {
                currentTab: event?.detail?.currentTab || null,
            }, 450);
        }
    };

    window.addEventListener('modalShown', handleModalShown);
    window.addEventListener('serenityHubVisibilityChange', handleHubVisibilityChange);
    appInstance.cleanupHandlers.push(() => {
        window.removeEventListener('modalShown', handleModalShown);
        window.removeEventListener('serenityHubVisibilityChange', handleHubVisibilityChange);
        clearScheduledDesktopPerformanceReports();
    });

    const unsubscribeModeStarted = appInstance.gameModeManager?.on?.('modeStarted', ({ modeId }) => {
        if (modeId === GAME_MODES.SINGLE_PLAYER) {
            scheduleDesktopPerformanceReport('single-player-idle', appInstance, { modeId }, 1200);
            return;
        }

        if (modeId === GAME_MODES.ODYSSEY) {
            scheduleDesktopPerformanceReport('odyssey-idle', appInstance, { modeId }, 1200);
        }
    });

    if (unsubscribeModeStarted) {
        appInstance.cleanupHandlers.push(unsubscribeModeStarted);
    }
}

export function installFirstInteractionPerformanceReport(appInstance = null, onInteraction = null) {
    if (firstInteractionReportInstalled || typeof window === 'undefined') {
        return;
    }

    firstInteractionReportInstalled = true;
    const teardown = [];

    const handleInteraction = (event) => {
        teardown.forEach((unsubscribe) => unsubscribe());
        teardown.length = 0;

        performanceMonitor.recordEvent('startup_first_interaction', {
            inputType: event?.type || 'unknown',
        });
        Promise.resolve(onInteraction?.(event))
            .catch((error) => {
                console.warn('[Startup] Failed to activate deferred desktop services:', error);
            })
            .finally(() => {
                void storeDesktopPerformanceReport('first-interaction', appInstance, {
                    inputType: event?.type || 'unknown',
                });
            });
    };

    FIRST_INTERACTION_EVENT_TYPES.forEach((eventName) => {
        const listener = (event) => handleInteraction(event);
        window.addEventListener(eventName, listener, { capture: true, passive: true, once: true });
        teardown.push(() => window.removeEventListener(eventName, listener, { capture: true }));
    });
}

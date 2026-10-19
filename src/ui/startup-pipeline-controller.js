import { performanceMonitor } from '../utils/performance-monitor.js';
import { markStartup } from './startup-debug.js';
import { installStartupProgress } from './startup-progress.js';
import {
    STARTUP_IDENT_MIN_VISIBLE_MS,
    STARTUP_PIPELINE_EVENTS,
    STARTUP_WATCHDOG_MS,
    createStartupPipelineStateMachine,
    isStartupPipelineAbort,
    waitForStartupStep,
} from './startup-pipeline-state-machine.js';

export { STARTUP_IDENT_MIN_VISIBLE_MS };

/**
 * Browser-facing startup coordinator. The underlying state machine remains pure;
 * this layer owns trace/KPI side effects and cinematic resource cleanup.
 *
 * Player input never skips the opening: a click or key before the title lands is ignored, and
 * the intro's own "Press any key" prompt takes over once it shows. Only the URL flag, reduced
 * motion, the minimal startup profile and the watchdog skip it.
 */
export function createStartupPipelineController(options = {}) {
    // The loading screen's progress line follows the milestones this pipeline traces.
    installStartupProgress();
    const introAnimation = options.introAnimation || null;
    const visualResources = new Set();

    const disposeVisuals = () => {
        visualResources.forEach((resource) => resource.dispose?.());
        visualResources.clear();
    };

    const stateMachine = createStartupPipelineStateMachine({
        watchdogMs: options.watchdogMs ?? STARTUP_WATCHDOG_MS,
        onTransition: ({
            event,
            elapsedMs,
            metadata,
            snapshot,
        }) => {
            const eventName = event.toLowerCase().replace(/_/g, '-');
            markStartup(`startup-pipeline:${eventName}`, {
                elapsedMs: Math.round(elapsedMs),
                introStatus: snapshot.introStatus,
                ...metadata,
            });

            if (event === STARTUP_PIPELINE_EVENTS.MENU_READY) {
                performanceMonitor.recordEvent('startup_time_to_menu_ready', {
                    timeToMenuReadyMs: Math.round(snapshot.metrics.timeToMenuReadyMs),
                });
            }
            if (event === STARTUP_PIPELINE_EVENTS.INTRO_DONE
                || event === STARTUP_PIPELINE_EVENTS.INTRO_SKIPPED) {
                performanceMonitor.recordEvent('startup_intro_duration', {
                    introDurationMs: Math.round(snapshot.metrics.introDurationMs || 0),
                    status: snapshot.introStatus,
                    reason: snapshot.introSkipReason,
                });
            }
            if (event === STARTUP_PIPELINE_EVENTS.MENU_VISIBLE) {
                performanceMonitor.recordEvent('startup_time_to_menu_visible', {
                    timeToMenuVisibleMs: Math.round(snapshot.metrics.timeToMenuVisibleMs),
                    introStatus: snapshot.introStatus,
                    reason: snapshot.introSkipReason,
                    degraded: snapshot.degraded === true,
                });
            }
        },
        onIntroSkipped: (snapshot) => {
            disposeVisuals();
            introAnimation?.skip?.();
            document.body.classList.add('startup-intro-skipped');
            markStartup('startup-pipeline:visuals-disposed', {
                reason: snapshot.introSkipReason,
                menuReady: snapshot.menuReady,
            });
        },
        onCallbackError: (error) => {
            console.warn('[Startup] Pipeline callback failed:', error);
        },
    });

    return {
        get signal() {
            return stateMachine.signal;
        },
        start: (metadata = {}) => stateMachine.start({
            watchdogMs: stateMachine.watchdogMs,
            ...metadata,
        }),
        snapshot: () => stateMachine.snapshot(),
        markAppReady: (metadata) => stateMachine.markAppReady(metadata),
        markMenuReady: (metadata) => stateMachine.markMenuReady(metadata),
        markIntroRunning: (metadata) => stateMachine.markIntroRunning(metadata),
        markIntroInteractive: (metadata) => stateMachine.markIntroInteractive(metadata),
        markIntroDismissing: (metadata) => stateMachine.markIntroDismissing(metadata),
        markIntroDone: (metadata) => stateMachine.markIntroDone(metadata),
        skipIntro: (reason, metadata) => stateMachine.skipIntro(reason, metadata),
        waitForMenuVisible: () => stateMachine.waitForMenuVisible(),
        async waitForStep(value, abortedValue = undefined) {
            try {
                return await waitForStartupStep(value, stateMachine.signal);
            } catch (error) {
                if (isStartupPipelineAbort(error)) return abortedValue;
                throw error;
            }
        },
        trackVisual(resource) {
            if (resource) visualResources.add(resource);
            return resource;
        },
        releaseVisual(resource) {
            visualResources.delete(resource);
        },
        disposeVisuals,
        dispose() {
            disposeVisuals();
            stateMachine.dispose();
        },
    };
}

export default createStartupPipelineController;

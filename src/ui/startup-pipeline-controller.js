import { performanceMonitor } from '../utils/performance-monitor.js';
import { markStartup } from './startup-debug.js';
import {
    STARTUP_IDENT_MIN_VISIBLE_MS,
    STARTUP_PIPELINE_EVENTS,
    STARTUP_WATCHDOG_MS,
    createStartupPipelineStateMachine,
    isStartupPipelineAbort,
    waitForStartupStep,
} from './startup-pipeline-state-machine.js';

export { STARTUP_IDENT_MIN_VISIBLE_MS };

function installIntroSkipInput(onSkip) {
    if (typeof window === 'undefined' || typeof onSkip !== 'function') {
        return () => {};
    }

    const handleInput = (event) => {
        if (event.type === 'keydown' && event.repeat) return;
        onSkip(event.type);
    };
    const pointerOptions = { capture: true, passive: true };

    window.addEventListener('pointerdown', handleInput, pointerOptions);
    window.addEventListener('touchstart', handleInput, pointerOptions);
    window.addEventListener('keydown', handleInput, { capture: true });

    return () => {
        window.removeEventListener('pointerdown', handleInput, pointerOptions);
        window.removeEventListener('touchstart', handleInput, pointerOptions);
        window.removeEventListener('keydown', handleInput, { capture: true });
    };
}

/**
 * Browser-facing startup coordinator. The underlying state machine remains pure;
 * this layer owns trace/KPI side effects, skip input, and cinematic resource cleanup.
 */
export function createStartupPipelineController(options = {}) {
    const introAnimation = options.introAnimation || null;
    const visualResources = new Set();
    let removeIntroSkipInput = null;

    const disarmIntroSkipInput = () => {
        removeIntroSkipInput?.();
        removeIntroSkipInput = null;
    };
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
                disarmIntroSkipInput();
            }
            if (event === STARTUP_PIPELINE_EVENTS.MENU_VISIBLE) {
                performanceMonitor.recordEvent('startup_time_to_menu_visible', {
                    timeToMenuVisibleMs: Math.round(snapshot.metrics.timeToMenuVisibleMs),
                    introStatus: snapshot.introStatus,
                    reason: snapshot.introSkipReason,
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
        armIntroSkipInput(isNativeInteractionReady) {
            disarmIntroSkipInput();
            removeIntroSkipInput = installIntroSkipInput((inputType) => {
                if (stateMachine.snapshot().introStatus !== 'running') return;
                if (isNativeInteractionReady?.()) return;
                stateMachine.skipIntro('user-input', { inputType });
            });
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
            disarmIntroSkipInput();
            disposeVisuals();
            stateMachine.dispose();
        },
    };
}

export default createStartupPipelineController;

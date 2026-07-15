export const STARTUP_IDENT_MIN_VISIBLE_MS = 4000;
export const STARTUP_WATCHDOG_MS = 45000;

export const STARTUP_PIPELINE_EVENTS = Object.freeze({
    BOOT_STARTED: 'BOOT_STARTED',
    APP_READY: 'APP_READY',
    MENU_READY: 'MENU_READY',
    INTRO_RUNNING: 'INTRO_RUNNING',
    INTRO_DONE: 'INTRO_DONE',
    INTRO_SKIPPED: 'INTRO_SKIPPED',
    WATCHDOG: 'WATCHDOG',
    MENU_VISIBLE: 'MENU_VISIBLE',
});

function defaultNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function elapsedBetween(startedAt, completedAt) {
    if (startedAt === null || completedAt === null) {
        return null;
    }
    return Math.max(0, completedAt - startedAt);
}

function createStartupPipelineAbortError(reason = 'startup-aborted') {
    const error = new Error(`Startup pipeline interrupted: ${reason}`);
    error.name = 'StartupPipelineAbortError';
    error.reason = reason;
    return error;
}

function createStartupPipelineTransitionError(message) {
    const error = new Error(message);
    error.name = 'StartupPipelineTransitionError';
    return error;
}

export function isStartupPipelineAbort(error) {
    return error?.name === 'StartupPipelineAbortError';
}

function abortErrorFromSignal(signal) {
    return signal?.reason instanceof Error
        ? signal.reason
        : createStartupPipelineAbortError(signal?.reason || 'startup-aborted');
}

/**
 * Make an existing startup promise interruptible without changing the underlying
 * subsystem API. The original work may finish later, but it can no longer hold the
 * menu pipeline after the startup watchdog or a user skip fires.
 */
export function waitForStartupStep(value, signal) {
    if (!signal) {
        return Promise.resolve(value);
    }
    if (signal.aborted) {
        return Promise.reject(abortErrorFromSignal(signal));
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let onAbort = null;
        const finish = (callback, result) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            callback(result);
        };
        onAbort = () => finish(reject, abortErrorFromSignal(signal));

        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(value).then(
            (result) => finish(resolve, result),
            (error) => finish(reject, error),
        );
    });
}

/**
 * Coordinates startup readiness and cinematic outcome as parallel state tracks.
 * MENU_VISIBLE is derived in exactly one place: MENU_READY plus an intro terminal
 * outcome. The shell remains the caller's visual guard until that state is reached.
 */
export class StartupPipelineStateMachine {
    constructor(options = {}) {
        this.watchdogMs = Math.max(1, options.watchdogMs ?? STARTUP_WATCHDOG_MS);
        this.nowFn = options.nowFn || defaultNow;
        this.setTimeoutFn = options.setTimeoutFn || ((callback, ms) => setTimeout(callback, ms));
        this.clearTimeoutFn = options.clearTimeoutFn || ((timerId) => clearTimeout(timerId));
        this.onTransition = options.onTransition || null;
        this.onIntroSkipped = options.onIntroSkipped || null;
        this.onMenuVisible = options.onMenuVisible || null;
        this.onCallbackError = options.onCallbackError || null;

        this.startedAt = null;
        this.appReadyAt = null;
        this.menuReadyAt = null;
        this.introStartedAt = null;
        this.introTerminalAt = null;
        this.menuVisibleAt = null;
        this.introStatus = 'idle';
        this.introSkipReason = null;
        this.watchdogFired = false;
        // True when the menu was forced visible in a degraded state (the watchdog
        // fired before app readiness, so the static DOM menu is shown as a fallback).
        this.degraded = false;
        this.history = [];
        this.disposed = false;
        this.watchdogId = null;
        this.abortController = new AbortController();

        this.menuVisiblePromise = new Promise((resolve) => {
            this.resolveMenuVisible = resolve;
        });
    }

    get signal() {
        return this.abortController.signal;
    }

    start(metadata = {}) {
        this.assertNotDisposed();
        if (this.startedAt !== null) {
            return this.snapshot();
        }

        this.startedAt = this.nowFn();
        this.emit(STARTUP_PIPELINE_EVENTS.BOOT_STARTED, metadata);
        this.watchdogId = this.setTimeoutFn(() => this.handleWatchdog(), this.watchdogMs);
        return this.snapshot();
    }

    markAppReady(metadata = {}) {
        this.assertStarted(STARTUP_PIPELINE_EVENTS.APP_READY);
        if (this.appReadyAt !== null) {
            return this.snapshot();
        }

        this.appReadyAt = this.nowFn();
        this.emit(STARTUP_PIPELINE_EVENTS.APP_READY, metadata);
        return this.snapshot();
    }

    markMenuReady(metadata = {}) {
        this.assertStarted(STARTUP_PIPELINE_EVENTS.MENU_READY);
        if (this.appReadyAt === null) {
            throw createStartupPipelineTransitionError('MENU_READY requires APP_READY');
        }
        if (this.menuReadyAt !== null) {
            return this.snapshot();
        }

        this.menuReadyAt = this.nowFn();
        this.emit(STARTUP_PIPELINE_EVENTS.MENU_READY, metadata);
        this.reconcileMenuVisibility();
        return this.snapshot();
    }

    markIntroRunning(metadata = {}) {
        this.assertStarted(STARTUP_PIPELINE_EVENTS.INTRO_RUNNING);
        if (this.introStatus === 'running') {
            return this.snapshot();
        }
        if (this.introStatus !== 'idle') {
            throw createStartupPipelineTransitionError(
                `INTRO_RUNNING is illegal after intro status "${this.introStatus}"`,
            );
        }

        this.introStatus = 'running';
        this.introStartedAt = this.nowFn();
        this.emit(STARTUP_PIPELINE_EVENTS.INTRO_RUNNING, metadata);
        return this.snapshot();
    }

    markIntroDone(metadata = {}) {
        this.assertStarted(STARTUP_PIPELINE_EVENTS.INTRO_DONE);
        if (this.introStatus === 'done' || this.introStatus === 'skipped') {
            return this.snapshot();
        }
        if (this.introStatus !== 'running') {
            throw createStartupPipelineTransitionError('INTRO_DONE requires INTRO_RUNNING');
        }

        this.introStatus = 'done';
        this.introTerminalAt = this.nowFn();
        this.emit(STARTUP_PIPELINE_EVENTS.INTRO_DONE, metadata);
        this.reconcileMenuVisibility();
        return this.snapshot();
    }

    skipIntro(reason = 'requested', metadata = {}) {
        this.assertStarted(STARTUP_PIPELINE_EVENTS.INTRO_SKIPPED);
        if (this.introStatus === 'done' || this.introStatus === 'skipped') {
            return this.snapshot();
        }

        this.introStatus = 'skipped';
        this.introSkipReason = reason;
        this.introTerminalAt = this.nowFn();
        if (!this.signal.aborted) {
            this.abortController.abort(createStartupPipelineAbortError(reason));
        }
        this.emit(STARTUP_PIPELINE_EVENTS.INTRO_SKIPPED, {
            ...metadata,
            reason,
        });
        this.invokeCallback(this.onIntroSkipped, this.snapshot());
        this.reconcileMenuVisibility();
        return this.snapshot();
    }

    waitForMenuVisible() {
        if (this.menuVisibleAt !== null) {
            return Promise.resolve(this.snapshot());
        }
        return this.menuVisiblePromise;
    }

    snapshot() {
        const introDurationMs = this.introStatus === 'skipped' && this.introStartedAt === null
            ? 0
            : elapsedBetween(this.introStartedAt, this.introTerminalAt);
        const metrics = {
            timeToAppReadyMs: elapsedBetween(this.startedAt, this.appReadyAt),
            timeToMenuReadyMs: elapsedBetween(this.startedAt, this.menuReadyAt),
            introDurationMs,
            timeToMenuVisibleMs: elapsedBetween(this.startedAt, this.menuVisibleAt),
        };

        return {
            started: this.startedAt !== null,
            appReady: this.appReadyAt !== null,
            menuReady: this.menuReadyAt !== null,
            menuVisible: this.menuVisibleAt !== null,
            degraded: this.degraded,
            disposed: this.disposed,
            introStatus: this.introStatus,
            introSkipReason: this.introSkipReason,
            watchdogFired: this.watchdogFired,
            watchdogMs: this.watchdogMs,
            metrics,
            history: this.history.map((entry) => ({
                ...entry,
                metadata: { ...entry.metadata },
            })),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.clearWatchdog();
        // Settle any pending menu-visible awaiter so a caller (e.g. bootstrap's error
        // path, which disposes the pipeline) can never hang on waitForMenuVisible().
        if (this.resolveMenuVisible) {
            this.resolveMenuVisible(this.snapshot());
            this.resolveMenuVisible = null;
        }
    }

    assertStarted(event) {
        this.assertNotDisposed();
        if (this.startedAt === null) {
            throw createStartupPipelineTransitionError(`${event} requires BOOT_STARTED`);
        }
    }

    assertNotDisposed() {
        if (this.disposed) {
            throw createStartupPipelineTransitionError('Startup pipeline has been disposed');
        }
    }

    handleWatchdog() {
        this.watchdogId = null;
        if (this.disposed || this.menuVisibleAt !== null) return;

        this.watchdogFired = true;
        this.emit(STARTUP_PIPELINE_EVENTS.WATCHDOG, {
            watchdogMs: this.watchdogMs,
        });
        this.skipIntro('watchdog', {
            watchdogMs: this.watchdogMs,
        });
        // The watchdog is TERMINAL: it must always leave the pipeline in a usable
        // menu state. skipIntro's reconcile is a no-op when app readiness never
        // arrived (menuReadyAt is null) — the exact hung-init case — so force a
        // DEGRADED menu-visible here. Without this the ident hangs forever.
        if (this.menuVisibleAt === null) {
            this.markMenuVisible(true);
        }
    }

    reconcileMenuVisibility() {
        const introTerminal = this.introStatus === 'done' || this.introStatus === 'skipped';
        if (this.menuVisibleAt !== null || this.menuReadyAt === null || !introTerminal) {
            return;
        }
        this.markMenuVisible(false);
    }

    /**
     * Sole writer of MENU_VISIBLE. `degraded` is true only for the watchdog fallback
     * (app readiness never arrived); the normal reconcile path passes false.
     */
    markMenuVisible(degraded) {
        if (this.menuVisibleAt !== null) {
            return;
        }
        this.menuVisibleAt = this.nowFn();
        this.degraded = degraded;
        this.clearWatchdog();
        this.emit(STARTUP_PIPELINE_EVENTS.MENU_VISIBLE, {
            introStatus: this.introStatus,
            introSkipReason: this.introSkipReason,
            degraded,
        });
        const snapshot = this.snapshot();
        this.invokeCallback(this.onMenuVisible, snapshot);
        if (this.resolveMenuVisible) {
            this.resolveMenuVisible(snapshot);
            this.resolveMenuVisible = null;
        }
    }

    clearWatchdog() {
        if (this.watchdogId === null) return;
        this.clearTimeoutFn(this.watchdogId);
        this.watchdogId = null;
    }

    emit(event, metadata = {}) {
        const atMs = this.nowFn();
        const entry = {
            event,
            atMs,
            elapsedMs: this.startedAt === null ? 0 : Math.max(0, atMs - this.startedAt),
            metadata: { ...metadata },
        };
        this.history.push(entry);
        this.invokeCallback(this.onTransition, {
            ...entry,
            snapshot: this.snapshot(),
        });
    }

    invokeCallback(callback, payload) {
        if (typeof callback !== 'function') return;
        try {
            callback(payload);
        } catch (error) {
            if (typeof this.onCallbackError === 'function') {
                this.onCallbackError(error);
            }
        }
    }
}

export function createStartupPipelineStateMachine(options = {}) {
    return new StartupPipelineStateMachine(options);
}

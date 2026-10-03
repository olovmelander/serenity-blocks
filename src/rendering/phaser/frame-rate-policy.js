/** Phaser presentation caps are independent from the simulation clock. */
export function phaserFrameRateConfig(frameRate = 60) {
    const limit = Number.isFinite(Number(frameRate)) && Number(frameRate) > 0 ? Number(frameRate) : 0;
    return {
        target: limit || 60, limit, forceSetTimeOut: false, smoothStep: false,
    };
}

const presentationClocks = new WeakMap();
const CADENCE_TOLERANCE_MS = 0.05;

function installTimeStepPresentationGate(loop) {
    // The native limiter retains elapsed delta after forwarding it, and loses
    // refresh-matched frames around its modulo threshold. Use its public normal
    // step for clock accounting; the owned callback below controls presentation.
    loop.stepLimitFPS = function limitPresentation(time) {
        return this.step(time);
    };
}

function presentationCallback(game, callback, clock) {
    return function present(time, delta) {
        const now = game.loop.time;
        // Retain time before the first accepted frame when the cap skips RAFs.
        if (clock.lastTime === null) clock.lastTime = now - delta;
        const limit = game.loop.fpsLimit;
        if (limit > 0) {
            const cadence = 1000 / limit;
            if (clock.limit !== limit || clock.deadline === null) {
                clock.limit = limit;
                clock.deadline = now - delta + cadence;
            }
            if (now + CADENCE_TOLERANCE_MS < clock.deadline) return undefined;
            const intervals = Math.max(1, Math.floor((now + CADENCE_TOLERANCE_MS - clock.deadline) / cadence) + 1);
            clock.deadline += intervals * cadence;
        } else {
            clock.limit = limit;
            clock.deadline = null;
        }
        let elapsed = now - clock.lastTime;
        clock.lastTime = now;
        // Visibility resets and sleeping gaps must not fast-forward effects.
        if (elapsed > 250) elapsed = 1000 / (game.loop.targetFps || 60);
        if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
        return callback.call(this, time, elapsed);
    };
}

function presentationClock(game) {
    let clock = presentationClocks.get(game);
    if (!clock) {
        clock = {
            lastTime: null, deadline: null, limit: null, methodsInstalled: false, callback: null,
        };
        presentationClocks.set(game, clock);
    }
    return clock;
}

/** Normalize Phaser's limiter accumulator to elapsed time once per presented step. */
export function installPhaserPresentationClock(game) {
    const clock = presentationClock(game);
    installTimeStepPresentationGate(game.loop);
    if (clock.methodsInstalled) return;
    clock.methodsInstalled = true;
    for (const method of ['step', 'headlessStep']) {
        if (typeof game[method] === 'function') game[method] = presentationCallback(game, game[method], clock);
    }
    const reset = () => {
        clock.lastTime = null;
        clock.deadline = null;
    };
    for (const event of ['visible', 'resume', 'focus']) game.events?.on?.(event, reset);
}

/** Shared board configuration for every independently owned Phaser game. */
export function phaserBoardRuntimeConfig(dependencies, type) {
    return {
        type,
        audio: { noAudio: true },
        fps: phaserFrameRateConfig(
            dependencies.frameRateController?.targetFPS
                ?? dependencies.settingsManager?.get?.().targetFrameRate
                ?? 60,
        ),
        callbacks: { postBoot: installPhaserPresentationClock },
    };
}

/**
 * Phaser has no public live limiter setter. Construct its documented TimeStep
 * with the new config and restart the same callback through public lifecycle
 * methods, rather than mutating its private limiter/smoothing fields.
 */
export function applyPhaserFrameRate(game, frameRate) {
    const previous = game?.loop;
    if (!previous || !game.config || game.pendingDestroy) return false;
    const fps = { ...game.config.fps, ...phaserFrameRateConfig(frameRate) };
    if (previous.fpsLimit === fps.limit && previous.targetFps === fps.target) return false;

    const next = new previous.constructor(game, fps);
    installTimeStepPresentationGate(next);
    const wasStarted = previous.started;
    const wasRunning = previous.running;
    const clock = presentationClock(game);
    let { callback } = previous;
    if (!clock.methodsInstalled && callback !== clock.callback) {
        callback = presentationCallback(game, callback, clock);
        clock.callback = callback;
    }
    previous.stop();
    game.loop = next;
    game.config.fps = fps;
    if (wasStarted) {
        next.start(callback);
        if (!wasRunning) next.sleep();
    }
    // Scene clocks/input durations use these public counters. Keep continuity
    // across a cap change; start() resets its own delta history for the new cap.
    next.time = previous.time;
    next.frame = previous.frame;
    next.startTime = previous.startTime;
    next.inFocus = previous.inFocus;
    previous.destroy();
    return true;
}

/**
 * A virtual clock for frame-exact capture, injected into the page before any of its scripts.
 *
 * Software rendering (SwiftShader) draws a themed frame in seconds, not milliseconds, so a
 * recording made in real time would stutter and every animation would run at its own speed.
 * This clock lets the capture script own time instead: while it is frozen, requestAnimationFrame,
 * performance.now, Date, setTimeout and setInterval all read a virtual time that only moves when
 * `step(ms)` is called, so each captured frame is exactly 1/fps of game time later than the last,
 * however long it took to draw.
 *
 * It starts thawed (real time, every call passed through), so the app boots and loads at full
 * speed; the capture script freezes it around a shot and thaws it between shots. Thawing carries
 * the clock on from where virtual time stopped (time never runs backwards) and hands any pending
 * virtual timers to real ones.
 *
 * CSS animations and transitions run on the browser's own clock; the capture script pauses the
 * document timeline (CDP Animation.setPlaybackRate 0) and `step()` advances every animation by
 * hand.
 *
 * Installed as `window.__trailerClock`. This file is the source of a function serialised into
 * the page, so it must stay self-contained.
 */
/* eslint-disable no-restricted-globals, no-underscore-dangle */
export function installVirtualClock() {
    if (window.__trailerClock) return;
    const realPerfNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);
    const RealDate = Date;
    const realRaf = window.requestAnimationFrame.bind(window);
    const realSetTimeout = window.setTimeout.bind(window);
    const realClearTimeout = window.clearTimeout.bind(window);
    const realSetInterval = window.setInterval.bind(window);
    const realClearInterval = window.clearInterval.bind(window);

    const dateOffset = realDateNow() - realPerfNow();
    let frozen = false;
    let perfOffset = 0; // added to the real clock while thawed, so thawing never jumps back
    let virtualNow = 0;
    const now = () => (frozen ? virtualNow : realPerfNow() + perfOffset);

    // ---- requestAnimationFrame: always queued here, flushed by a real frame or by step() ----
    let rafId = 0;
    let rafQueue = new Map();
    let pumpScheduled = false;
    const flushRaf = (timestamp) => {
        const queue = rafQueue;
        rafQueue = new Map();
        queue.forEach((callback) => {
            try {
                callback(timestamp);
            } catch (error) {
                console.error(error);
            }
        });
    };
    const schedulePump = () => {
        if (pumpScheduled || frozen) return;
        pumpScheduled = true;
        realRaf(() => {
            pumpScheduled = false;
            if (frozen) return;
            flushRaf(now());
        });
    };
    window.requestAnimationFrame = (callback) => {
        rafId += 1;
        rafQueue.set(rafId, callback);
        schedulePump();
        return rafId;
    };
    window.cancelAnimationFrame = (id) => {
        rafQueue.delete(id);
    };

    // ---- timers: virtual while frozen, real while thawed ----
    const VIRTUAL_ID_BASE = 2e9;
    let timerSeq = VIRTUAL_ID_BASE;
    const virtualTimers = new Map(); // id -> { due, delay, callback, args, repeat }
    const handedOff = new Map(); // virtual id -> real id, after a thaw
    const addVirtualTimer = (callback, delay, args, repeat) => {
        timerSeq += 1;
        const wait = Math.max(0, Number(delay) || 0);
        virtualTimers.set(timerSeq, {
            due: virtualNow + wait, delay: wait, callback, args, repeat,
        });
        return timerSeq;
    };
    const clearAny = (id, realClear) => {
        if (virtualTimers.delete(id)) return;
        if (handedOff.has(id)) {
            realClear(handedOff.get(id));
            handedOff.delete(id);
            return;
        }
        realClear(id);
    };
    window.setTimeout = (callback, delay, ...args) => (frozen
        ? addVirtualTimer(callback, delay, args, false)
        : realSetTimeout(callback, delay, ...args));
    window.setInterval = (callback, delay, ...args) => (frozen
        ? addVirtualTimer(callback, delay, args, true)
        : realSetInterval(callback, delay, ...args));
    window.clearTimeout = (id) => clearAny(id, realClearTimeout);
    window.clearInterval = (id) => clearAny(id, realClearInterval);
    // Idle callbacks would otherwise run on the real clock between frozen frames.
    if (typeof window.requestIdleCallback === 'function') {
        const realRequestIdle = window.requestIdleCallback.bind(window);
        const realCancelIdle = window.cancelIdleCallback.bind(window);
        window.requestIdleCallback = (callback, options) => (frozen
            ? addVirtualTimer(() => callback({ didTimeout: false, timeRemaining: () => 8 }), 1, [], false)
            : realRequestIdle(callback, options));
        window.cancelIdleCallback = (id) => clearAny(id, realCancelIdle);
    }
    const runTimer = (timer) => {
        if (typeof timer.callback !== 'function') return;
        try {
            timer.callback(...timer.args);
        } catch (error) {
            console.error(error);
        }
    };

    // ---- clocks ----
    performance.now = now;
    function VirtualDate(...args) {
        if (!new.target) return new RealDate(Math.floor(now() + dateOffset)).toString();
        return args.length ? new RealDate(...args) : new RealDate(Math.floor(now() + dateOffset));
    }
    VirtualDate.prototype = RealDate.prototype;
    VirtualDate.now = () => Math.floor(now() + dateOffset);
    VirtualDate.parse = RealDate.parse;
    VirtualDate.UTC = RealDate.UTC;
    window.Date = VirtualDate;

    // ---- CSS animations, advanced by hand while the document timeline is paused ----
    const advanceAnimations = (ms) => {
        document.getAnimations().forEach((animation) => {
            if (animation.playState === 'finished' || animation.playState === 'idle') return;
            const current = Number(animation.currentTime) || 0;
            try {
                animation.currentTime = current + ms * (animation.playbackRate || 1);
            } catch {
                // A detached or removed animation; it no longer draws.
            }
        });
    };

    const nextRealFrame = () => new Promise((resolve) => { realRaf(resolve); });
    const yieldToTasks = () => new Promise((resolve) => { realSetTimeout(resolve, 0); });

    window.__trailerClock = {
        get frozen() { return frozen; },
        now,
        freeze() {
            if (frozen) return;
            virtualNow = realPerfNow() + perfOffset;
            frozen = true;
        },
        thaw() {
            if (!frozen) return;
            frozen = false;
            perfOffset = virtualNow - realPerfNow();
            virtualTimers.forEach((timer, id) => {
                const remaining = Math.max(0, timer.due - virtualNow);
                const realId = timer.repeat
                    ? realSetInterval(timer.callback, timer.delay, ...timer.args)
                    : realSetTimeout(timer.callback, remaining, ...timer.args);
                handedOff.set(id, realId);
            });
            virtualTimers.clear();
            if (rafQueue.size) schedulePump();
        },
        /**
         * Move virtual time on by `ms`: fire every timer that falls due on the way, in order, then
         * run one animation frame inside a real browser frame so what it draws is presented.
         * `settleMs` lets real-time work (fetches, GPU readbacks, workers) catch up first.
         */
        async step(ms, { settleMs = 0 } = {}) {
            if (!frozen) throw new Error('virtual clock: step() needs freeze() first');
            const target = virtualNow + ms;
            for (let guard = 0; guard < 10000; guard += 1) {
                let nextId = null;
                let next = null;
                virtualTimers.forEach((timer, id) => {
                    if (timer.due <= target && (!next || timer.due < next.due)) {
                        next = timer;
                        nextId = id;
                    }
                });
                if (!next) break;
                virtualNow = Math.max(virtualNow, next.due);
                if (next.repeat) {
                    next.due = virtualNow + Math.max(1, next.delay);
                } else {
                    virtualTimers.delete(nextId);
                }
                runTimer(next);
                // Let promise chains the timer started run (and maybe set more timers).
                // eslint-disable-next-line no-await-in-loop
                await Promise.resolve();
            }
            virtualNow = target;
            if (settleMs > 0) {
                await new Promise((resolve) => { realSetTimeout(resolve, settleMs); });
            } else {
                await yieldToTasks();
            }
            advanceAnimations(ms);
            await nextRealFrame();
            flushRaf(virtualNow);
        },
        /** Real-time wait that ignores the virtual clock (for loading between shots). */
        realSleep: (ms) => new Promise((resolve) => { realSetTimeout(resolve, ms); }),
        realNow: realPerfNow,
    };
}

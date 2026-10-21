/**
 * Into an orb: light gathers onto the chosen orb, the orb opens into a gate that swells over the
 * screen while the world darkens round it, the passage plays while the next board prepares, and
 * on arrival a second gate opens from the light ahead onto the board. The picture is drawn by
 * portal-gate.js; this class owns the timing, the readiness hold and the callbacks.
 */
import { TRANSITION_LAYERS } from './transition-layer-constants.js';
import {
    GATE_MAX_FRAME_STEP_MS, advancePortalTravel, createPortalGate, drawPortalGate, portalEase, portalReach,
} from './portal-gate.js';
import { flashScale } from '../../utils/photosensitivity.js';

const DEFAULT_TIMINGS = Object.freeze({
    ignitionDelayMs: 60,
    blackoutStartMs: 340,
    blackoutFullMs: 900,
    revealDurationMs: 640,
    particleDecayMs: 520,
    maxBlackoutHoldMs: 5200,
});

const BLACKOUT_READY_THRESHOLD = 0.96;
const ABORT_FADE_MS = 240;
const WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
/** The share of the opening by which the gate covers the whole frame (readiness waits for it). */
export const ENTRY_GATE_COVERED_AT = 0.86;

const { clamp01 } = portalEase;
const easeOutCubic = portalEase.outCubic;
const easeInOutCubic = portalEase.inOutCubic;
const smooth = (lo, hi, value) => {
    const t = clamp01((value - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
};

function toCssColor(value, fallback = '#ffffff') {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value.getStyle === 'function') return value.getStyle();
    if (typeof value.getHexString === 'function') return `#${value.getHexString()}`;
    return fallback;
}

function normalizeAnchor(anchor = {}) {
    // A hidden orb's projection is not a visible portal attachment point.
    if (anchor.onScreen === false) {
        return {
            x: 0.5, y: 0.5, radius: 0.14, onScreen: false,
        };
    }
    const x = Number.isFinite(anchor.x) ? anchor.x : 0.5;
    const y = Number.isFinite(anchor.y) ? anchor.y : 0.5;
    const radius = Number.isFinite(anchor.radius) ? anchor.radius : 0.14;

    return {
        x: clamp01(x),
        y: clamp01(y),
        radius: Math.max(0.04, Math.min(radius, 0.32)),
        onScreen: anchor.onScreen !== false,
    };
}

function normalizePalette(palette = {}) {
    return {
        primary: toCssColor(palette.primary, '#ffd38a'),
        accent: toCssColor(palette.accent, '#fff3c8'),
        highlight: toCssColor(palette.highlight, '#ffffff'),
        shadow: toCssColor(palette.shadow, 'rgba(8, 14, 24, 0.96)'),
    };
}

function normalizeTimings(timings = {}) {
    return {
        ignitionDelayMs: timings.ignitionDelayMs ?? DEFAULT_TIMINGS.ignitionDelayMs,
        blackoutStartMs: timings.blackoutStartMs ?? DEFAULT_TIMINGS.blackoutStartMs,
        blackoutFullMs: timings.blackoutFullMs ?? DEFAULT_TIMINGS.blackoutFullMs,
        revealDurationMs: timings.revealDurationMs ?? DEFAULT_TIMINGS.revealDurationMs,
        particleDecayMs: timings.particleDecayMs ?? DEFAULT_TIMINGS.particleDecayMs,
        maxBlackoutHoldMs: timings.maxBlackoutHoldMs ?? DEFAULT_TIMINGS.maxBlackoutHoldMs,
    };
}

export class JourneyEntryTransition {
    constructor({
        documentRef = globalThis.document,
        windowRef = globalThis.window,
        performanceRef = globalThis.performance,
        requestAnimationFrameRef = globalThis.requestAnimationFrame?.bind(globalThis),
        cancelAnimationFrameRef = globalThis.cancelAnimationFrame?.bind(globalThis),
    } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.performance = performanceRef;
        this.requestAnimationFrame = requestAnimationFrameRef;
        this.cancelAnimationFrame = cancelAnimationFrameRef;
        this.activeRun = null;
        this.handleResize = this.onResize.bind(this);
    }

    async play(config = {}) {
        if (!this.document?.body || !this.requestAnimationFrame || !this.cancelAnimationFrame) {
            return { success: false, aborted: true, reason: 'environment-unavailable' };
        }

        if (this.activeRun) {
            this.abort('replaced');
        }

        const run = this.createRun(config);
        this.activeRun = run;
        this.mount(run);

        return new Promise((resolve) => {
            run.resolve = resolve;
            run.frameId = this.requestAnimationFrame(() => this.tick(run));
        });
    }

    abort(reason = 'aborted') {
        if (!this.activeRun || this.activeRun.finishing) {
            return;
        }

        this.finish(this.activeRun, {
            success: false,
            aborted: true,
            reason,
        });
    }

    dispose() {
        this.abort('dispose');
        this.teardown();
    }

    createRun(config) {
        const anchor = normalizeAnchor(config.anchor);
        const palette = normalizePalette(config.palette);
        // A caller can opt in through game settings; the OS preference always wins.
        const reducedMotion = config.reducedMotion === true
            || this.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        const timings = normalizeTimings(config.timings);
        if (reducedMotion) {
            timings.blackoutStartMs = 0;
            timings.blackoutFullMs = Math.min(220, timings.blackoutFullMs);
            timings.revealDurationMs = Math.min(220, timings.revealDurationMs);
        }
        const callbacks = config.callbacks || {};
        const qualityPreset = config.qualityPreset || 'High';

        return {
            anchor,
            // The world's camera moves toward the orb as the gate gathers and opens: where the
            // caller can say where the orb is now, the gate stays on it. An orb that was off
            // screen at the click has no place to gather: its gate stays centred.
            trackAnchor: anchor.onScreen && typeof config.trackAnchor === 'function' ? config.trackAnchor : null,
            palette,
            timings,
            reducedMotion,
            callbacks,
            startedAt: this.performance.now(),
            // The gate's own clock (ms): starts at the first frame drawn, steps at most
            // GATE_MAX_FRAME_STEP_MS a frame (reduced motion keeps real time).
            clock: { t: 0, last: null },
            revealStartedAt: null,
            readyTriggered: false,
            readySettled: false,
            readyFailed: false,
            readyError: null,
            revealTriggered: false,
            revealSettled: false,
            revealFailed: false,
            revealError: null,
            playableTriggered: false,
            playableSettled: false,
            playableFailed: false,
            playableError: null,
            finishing: false,
            frameId: null,
            resolve: null,
            dom: null,
            canvasSize: { width: 1, height: 1, dpr: 1 },
            gate: reducedMotion ? null : createPortalGate({ qualityPreset, palette, documentRef: this.document }),
            // What of the arrival's light the player allows (Reduce flashing).
            flash: flashScale(),
            travelState: { travel: 0, lastTravelAt: null },
        };
    }

    mount(run) {
        const root = this.document.createElement('div');
        root.className = 'journey-entry-transition';
        root.setAttribute(WHEEL_LOCK_ATTRIBUTE, 'true');
        root.style.cssText = `
            position: fixed;
            inset: 0;
            overflow: hidden;
            pointer-events: auto;
            z-index: ${TRANSITION_LAYERS.JOURNEY_ENTRY};
            opacity: 1;
        `;

        // The calm path allocates no canvas and has no gate, glow or passage: only an opaque dark
        // layer changes opacity.
        if (run.reducedMotion) {
            const veil = this.document.createElement('div');
            veil.style.cssText = 'position: absolute; inset: 0; background: #05070d; opacity: 0;';
            root.setAttribute('data-reduced-motion', 'true');
            root.appendChild(veil);
            this.document.body.appendChild(root);
            run.dom = { root, veil };
            return;
        }

        // One canvas draws the whole gate: the darkening world round it, the passage, the rims.
        const canvas = this.document.createElement('canvas');
        canvas.className = 'journey-portal-gate';
        canvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;
        root.appendChild(canvas);
        this.document.body.appendChild(root);

        let ctx = null;
        try {
            ctx = canvas.getContext('2d');
        } catch {
            ctx = null;
        }

        run.dom = { root, canvas, ctx };
        this.resizeCanvas(run);
        this.window?.addEventListener?.('resize', this.handleResize);
    }

    onResize() {
        if (this.activeRun && !this.activeRun.reducedMotion) {
            this.resizeCanvas(this.activeRun);
        }
    }

    resizeCanvas(run) {
        const width = this.window?.innerWidth || 1;
        const height = this.window?.innerHeight || 1;
        const dpr = this.window?.devicePixelRatio || 1;
        const { canvas } = run.dom;
        if (canvas) {
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        run.canvasSize = { width, height, dpr };
    }

    tick(run) {
        if (run.finishing || run !== this.activeRun) {
            return;
        }

        const frame = this.frameAt(run);
        this.updateReadiness(run, frame.blackoutOpacity, frame.now);
        this.updateReveal(run, frame.clock);
        this.updatePlayable(run, frame.clock);
        this.render(run, frame);

        if (!run.finishing) {
            run.frameId = this.requestAnimationFrame(() => this.tick(run));
        }
    }

    /** @private this moment of the run, as tick and the abort hold draw it */
    frameAt(run) {
        const now = this.performance.now();
        const { clock } = run;
        if (clock.last === null) clock.last = run.reducedMotion ? run.startedAt : now;
        const step = Math.max(0, now - clock.last);
        clock.t += run.reducedMotion ? step : Math.min(GATE_MAX_FRAME_STEP_MS, step);
        clock.last = now;
        const elapsed = clock.t;
        const sinceIgnition = Math.max(0, elapsed - run.timings.ignitionDelayMs);
        const baseBlackoutProgress = clamp01(
            (elapsed - run.timings.blackoutStartMs)
            / Math.max(1, run.timings.blackoutFullMs - run.timings.blackoutStartMs),
        );
        const blackoutOpacity = this.computeBlackoutOpacity(run, baseBlackoutProgress, elapsed);
        return {
            now, clock: elapsed, elapsed, sinceIgnition, blackoutOpacity, opening: baseBlackoutProgress,
        };
    }

    /**
     * An abort keeps the passage moving while the mode unwinds: its onAbort can wait seconds on a
     * preparation still in flight, and a frozen passage then a hard cut read as a crash
     * (audit 2026-10-18). Drawing only — no readiness, reveal or playable steps.
     * @private
     */
    holdWhileAborting(run) {
        if (!run.dom || run.reducedMotion) return;
        run.abortHold = true;
        const step = () => {
            if (!run.abortHold) return;
            this.render(run, this.frameAt(run));
            run.frameId = this.requestAnimationFrame(step);
        };
        run.frameId = this.requestAnimationFrame(step);
    }

    /** @private an aborted run fades out instead of vanishing in one frame */
    fadeOutAndTeardown(run) {
        const root = run?.dom?.root;
        if (!root || run.reducedMotion || typeof this.window?.setTimeout !== 'function') {
            this.teardown(run);
            return;
        }
        root.style.transition = `opacity ${ABORT_FADE_MS}ms ease-out`;
        root.style.opacity = '0';
        this.window.setTimeout(() => this.teardown(run), ABORT_FADE_MS);
    }

    /**
     * How covered the frame is (0..1): the readiness signal. It follows the gate, which covers
     * the whole frame by ENTRY_GATE_COVERED_AT of its opening, so preparation never starts with
     * the world still showing round the gate.
     */
    computeBlackoutOpacity(run, baseBlackoutProgress, now) {
        if (!run.revealTriggered) {
            if (run.readyTriggered) {
                return 1;
            }
            if (run.reducedMotion) return easeInOutCubic(baseBlackoutProgress);
            return clamp01(baseBlackoutProgress / ENTRY_GATE_COVERED_AT);
        }

        const revealElapsed = now - run.revealStartedAt;
        const revealProgress = clamp01(revealElapsed / Math.max(1, run.timings.revealDurationMs));
        return 1 - easeOutCubic(revealProgress);
    }

    updateReadiness(run, blackoutOpacity, now) {
        if (run.readyTriggered) {
            if (!run.readySettled) {
                const holdElapsed = now - (run.blackoutTriggeredAt ?? now);
                if (holdElapsed > run.timings.maxBlackoutHoldMs) {
                    this.finish(run, {
                        success: false,
                        aborted: true,
                        reason: 'blackout-timeout',
                    });
                }
            }
            return;
        }

        if (blackoutOpacity < (run.reducedMotion ? 1 : BLACKOUT_READY_THRESHOLD)) {
            return;
        }

        run.readyTriggered = true;
        run.blackoutTriggeredAt = now;

        // The hold left before the timeout aborts, so readiness waits can fit inside it and end
        // in a guarded reveal rather than a cut back to the map (audit 2026-10-18).
        const hold = {
            remainingMs: () => Math.max(0, run.timings.maxBlackoutHoldMs
                - (this.performance.now() - run.blackoutTriggeredAt)),
        };
        Promise.resolve()
            .then(() => {
                if (run.finishing || run !== this.activeRun) return false;
                return run.callbacks.onBlackoutReached?.(hold);
            })
            .then((result) => {
                if (run.finishing || run !== this.activeRun) return;
                run.readySettled = true;
                run.readyFailed = result === false;
                if (run.readyFailed) {
                    this.finish(run, {
                        success: false,
                        aborted: true,
                        reason: 'blackout-callback-rejected',
                    });
                }
            })
            .catch((error) => {
                if (run.finishing || run !== this.activeRun) return;
                run.readySettled = true;
                run.readyFailed = true;
                run.readyError = error;
                this.finish(run, {
                    success: false,
                    aborted: true,
                    reason: 'blackout-callback-error',
                    error,
                });
            });
    }

    updateReveal(run, now) {
        if (!run.readyTriggered || !run.readySettled || run.readyFailed || run.revealTriggered) {
            return;
        }

        run.revealTriggered = true;
        run.revealStartedAt = now;

        Promise.resolve()
            .then(() => {
                if (run.finishing || run !== this.activeRun) return false;
                return run.callbacks.onRevealStart?.();
            })
            .then((result) => {
                if (run.finishing || run !== this.activeRun) return;
                run.revealSettled = true;
                run.revealFailed = result === false;
                if (run.revealFailed) {
                    this.finish(run, {
                        success: false,
                        aborted: true,
                        reason: 'reveal-callback-rejected',
                    });
                }
            })
            .catch((error) => {
                if (run.finishing || run !== this.activeRun) return;
                run.revealSettled = true;
                run.revealFailed = true;
                run.revealError = error;
                this.finish(run, {
                    success: false,
                    aborted: true,
                    reason: 'reveal-callback-error',
                    error,
                });
            });
    }

    updatePlayable(run, now) {
        if (!run.revealTriggered || !run.revealSettled || run.revealFailed || run.playableTriggered) {
            return;
        }

        const revealElapsed = now - run.revealStartedAt;
        const revealProgress = clamp01(revealElapsed / Math.max(1, run.timings.revealDurationMs));
        if (revealProgress < 1) {
            return;
        }

        run.playableTriggered = true;

        if (run.dom?.root) {
            run.dom.root.style.pointerEvents = 'none';
        }

        Promise.resolve()
            .then(() => {
                if (run.finishing || run !== this.activeRun) return false;
                return run.callbacks.onPlayable?.();
            })
            .then((result) => {
                if (run.finishing || run !== this.activeRun) return;
                run.playableSettled = true;
                run.playableFailed = result === false;
                if (run.playableFailed) {
                    this.finish(run, {
                        success: false,
                        aborted: true,
                        reason: 'playable-callback-rejected',
                    });
                }
            })
            .catch((error) => {
                if (run.finishing || run !== this.activeRun) return;
                run.playableSettled = true;
                run.playableFailed = true;
                run.playableError = error;
                this.finish(run, {
                    success: false,
                    aborted: true,
                    reason: 'playable-callback-error',
                    error,
                });
            });
    }

    render(run, frame) {
        if (run.reducedMotion) {
            run.dom.veil.style.opacity = String(clamp01(frame.blackoutOpacity));
            if (
                run.revealTriggered
                && frame.clock - run.revealStartedAt >= run.timings.revealDurationMs
                && run.revealSettled
                && !run.revealFailed
                && run.playableSettled
                && !run.playableFailed
            ) {
                this.finish(run, { success: true, aborted: false });
            }
            return;
        }

        const revealProgress = run.revealTriggered
            ? clamp01((frame.clock - run.revealStartedAt) / Math.max(1, run.timings.revealDurationMs))
            : 0;
        this.drawGate(run, frame, revealProgress);

        if (
            run.revealTriggered
            && revealProgress >= 1
            && run.revealSettled
            && !run.revealFailed
            && run.playableSettled
            && !run.playableFailed
        ) {
            this.finish(run, { success: true, aborted: false });
        }
    }

    /**
     * The gate as it stands this frame: gathering on the orb, opening over the screen, the
     * passage while the board prepares, a second gate opening onto the board on arrival.
     * @returns {object} the frame for drawPortalGate, and `speed` for the travel
     */
    describeGate(run, frame, revealProgress) {
        const { width, height } = run.canvasSize;
        if (run.trackAnchor && !run.readyTriggered) {
            // Follow the orb while the gate is still on it (a hidden or failed read keeps the last).
            try {
                const live = run.trackAnchor();
                if (live && live.onScreen !== false && Number.isFinite(live.x) && Number.isFinite(live.y)) {
                    run.anchor = normalizeAnchor(live);
                }
            } catch {
                run.trackAnchor = null;
            }
        }
        const { anchor, timings } = run;
        const middle = { x: width / 2, y: height / 2 };
        const orb = {
            x: anchor.x * width,
            y: anchor.y * height,
            r: anchor.radius * Math.min(width, height),
        };
        // The light gathering on a small, far orb still needs room to be seen.
        const gatherRadius = Math.max(orb.r, Math.min(width, height) * 0.05);
        const time = frame.clock / 1000;
        if (run.revealTriggered) {
            // Arrival: the light ahead swells, then the gate onto the board opens from it.
            const q = revealProgress;
            const open = easeOutCubic(clamp01((q - 0.12) / 0.88));
            return {
                speed: 1 + q * 3.2,
                time,
                center: middle,
                region: {
                    kind: 'hole', x: middle.x, y: middle.y, r: portalReach(width, height, middle.x, middle.y) * 1.06 * open,
                },
                rim: 1 - q * q,
                // The light swells as the gate starts to open and is gone by the time it is a
                // third open, so the board is never seen through a haze.
                bloom: Math.sin(Math.PI * Math.min(1, q * 2.6)) * (1 - q),
                rush: q * 1.8,
            };
        }
        if (run.readyTriggered) {
            // The passage, while the board prepares: the light ahead breathes, the travel never stops.
            return {
                speed: 1, time, center: middle, region: { kind: 'all' },
            };
        }
        // The orb opens into a gate that swells over the screen and glides to its middle. Both are
        // complete at the moment readiness fires, so preparation never starts with world showing.
        const { opening } = frame;
        const covered = clamp01(opening / (ENTRY_GATE_COVERED_AT * BLACKOUT_READY_THRESHOLD));
        const grow = portalEase.inCubic(covered);
        const glide = easeInOutCubic(covered);
        const center = {
            x: orb.x + (middle.x - orb.x) * glide,
            y: orb.y + (middle.y - orb.y) * glide,
        };
        const reach = portalReach(width, height, center.x, center.y);
        const radius = orb.r * 0.9 * smooth(0, 0.1, opening) + (reach * 1.04 - orb.r * 0.9) * grow;
        const gatherSpan = Math.max(1, timings.blackoutStartMs - timings.ignitionDelayMs + 140);
        const gatherT = clamp01((frame.elapsed - timings.ignitionDelayMs) / gatherSpan);
        return {
            speed: 1.25 + opening * 0.4,
            time,
            center,
            region: {
                kind: 'disc', x: center.x, y: center.y, r: radius,
            },
            dim: smooth(0, 1, opening) * 0.9,
            rim: 1,
            rush: opening * 0.5,
            gather: anchor.onScreen && gatherT > 0
                ? {
                    x: orb.x, y: orb.y, r: gatherRadius, t: gatherT, fade: 1 - smooth(0.18, 0.55, opening),
                }
                : null,
        };
    }

    /** @private */
    drawGate(run, frame, revealProgress) {
        const { ctx } = run.dom;
        if (!ctx || !run.gate) return;
        const { width, height, dpr } = run.canvasSize;
        const gate = this.describeGate(run, frame, revealProgress);
        const travel = advancePortalTravel(run.travelState, frame.clock, gate.speed);
        ctx.setTransform?.(1, 0, 0, 1, 0, 0);
        ctx.clearRect?.(0, 0, width * dpr, height * dpr);
        drawPortalGate(ctx, run.gate, {
            ...gate,
            width,
            height,
            dpr,
            travel,
            direction: 1,
            flash: run.flash,
        });
    }

    finish(run, result) {
        let finalResult = result;
        if (run.finishing) {
            return;
        }

        run.finishing = true;
        if (run.frameId !== null) {
            this.cancelAnimationFrame(run.frameId);
            run.frameId = null;
        }
        if (!result.success) this.holdWhileAborting(run);

        Promise.resolve()
            .then(async () => {
                if (result.success) {
                    await run.callbacks.onComplete?.();
                } else {
                    await run.callbacks.onAbort?.(result);
                }
            })
            .catch((error) => {
                // Completion/cleanup callbacks must not leave an unhandled rejected
                // promise after the transition has already resolved or been replaced.
                finalResult = {
                    ...result,
                    success: false,
                    aborted: true,
                    reason: result.success ? 'complete-callback-error' : result.reason,
                    error,
                };
            })
            .finally(() => {
                run.abortHold = false;
                if (run.frameId !== null) {
                    this.cancelAnimationFrame(run.frameId);
                    run.frameId = null;
                }
                if (run === this.activeRun) {
                    this.activeRun = null;
                }
                if (result.success) this.teardown(run);
                else this.fadeOutAndTeardown(run);
                run.resolve?.(finalResult);
            });
    }

    teardown(run = this.activeRun) {
        // A replaced run can finish its async abort after its successor mounts.
        // It owns its DOM, but must not detach the successor's resize listener.
        if (!this.activeRun || this.activeRun === run) {
            this.window?.removeEventListener?.('resize', this.handleResize);
        }

        const root = run?.dom?.root;
        if (root?.parentNode) {
            root.parentNode.removeChild(root);
        }
        // Release the full-screen backing now rather than at a later GC, which could otherwise
        // land inside the next portal's preparation hold.
        const canvas = run?.dom?.canvas;
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}

export default JourneyEntryTransition;

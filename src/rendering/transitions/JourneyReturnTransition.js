/**
 * Back out of an orb: the board closes into a shrinking gate (the passage rising round it), the
 * passage streams back the other way while the world prepares, and the world opens through a
 * gate at the orb just finished. The picture is drawn by portal-gate.js; this class owns the
 * timing, the readiness hold and the callbacks.
 */
import { TRANSITION_LAYERS } from './transition-layer-constants.js';
import {
    GATE_MAX_FRAME_STEP_MS, advancePortalTravel, createPortalGate, drawPortalGate, portalEase, portalReach,
} from './portal-gate.js';
import { flashScale } from '../../utils/photosensitivity.js';

const DEFAULT_TIMINGS = Object.freeze({
    departureDelayMs: 60,
    blackoutStartMs: 100,
    blackoutFullMs: 720,
    revealDurationMs: 780,
    particleDecayMs: 760,
    maxBlackoutHoldMs: 7200,
});

const BLACKOUT_READY_THRESHOLD = 0.96;
const WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
/** The share of the closing by which the board's gate has shut (readiness waits for it). */
export const RETURN_GATE_SHUT_AT = 0.88;

const { clamp01 } = portalEase;
const easeOutCubic = portalEase.outCubic;
const easeInOutCubic = portalEase.inOutCubic;

function toCssColor(value, fallback = '#ffffff') {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value.getStyle === 'function') return value.getStyle();
    if (typeof value.getHexString === 'function') return `#${value.getHexString()}`;
    return fallback;
}

function normalizeAnchor(anchor = {}) {
    // A hidden anchor's projection is no attachment point: clamped, the aperture opened at the
    // screen's edge. Centre it, as the entry does (audit 2026-10-18).
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
        radius: Math.max(0.04, Math.min(radius, 0.38)),
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
        departureDelayMs: timings.departureDelayMs ?? DEFAULT_TIMINGS.departureDelayMs,
        blackoutStartMs: timings.blackoutStartMs ?? DEFAULT_TIMINGS.blackoutStartMs,
        blackoutFullMs: timings.blackoutFullMs ?? DEFAULT_TIMINGS.blackoutFullMs,
        revealDurationMs: timings.revealDurationMs ?? DEFAULT_TIMINGS.revealDurationMs,
        particleDecayMs: timings.particleDecayMs ?? DEFAULT_TIMINGS.particleDecayMs,
        maxBlackoutHoldMs: timings.maxBlackoutHoldMs ?? DEFAULT_TIMINGS.maxBlackoutHoldMs,
    };
}

export class JourneyReturnTransition {
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
        const departureAnchor = normalizeAnchor(config.departureAnchor);
        const arrivalAnchor = normalizeAnchor(config.arrivalAnchor);
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
            departureAnchor,
            arrivalAnchor,
            // The world's camera settles on the finished orb as its gate opens: where the caller
            // can say where the orb is now, the gate stays on it.
            trackArrivalAnchor: typeof config.trackArrivalAnchor === 'function' ? config.trackArrivalAnchor : null,
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
        root.className = 'journey-return-transition';
        root.setAttribute(WHEEL_LOCK_ATTRIBUTE, 'true');
        root.style.cssText = `
            position: fixed;
            inset: 0;
            overflow: hidden;
            pointer-events: auto;
            z-index: ${TRANSITION_LAYERS.JOURNEY_RETURN};
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

        // One canvas draws the whole gate: the passage round the closing board, the passage, the
        // gate opening onto the world, their rims.
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

        const now = this.performance.now();
        const { clock } = run;
        if (clock.last === null) clock.last = run.reducedMotion ? run.startedAt : now;
        const step = Math.max(0, now - clock.last);
        clock.t += run.reducedMotion ? step : Math.min(GATE_MAX_FRAME_STEP_MS, step);
        clock.last = now;
        const elapsed = clock.t;
        const baseBlackoutProgress = clamp01(
            (elapsed - run.timings.blackoutStartMs)
            / Math.max(1, run.timings.blackoutFullMs - run.timings.blackoutStartMs),
        );
        const blackoutOpacity = this.computeBlackoutOpacity(run, baseBlackoutProgress, elapsed);

        this.updateReadiness(run, blackoutOpacity, now);
        this.updateReveal(run, elapsed);
        this.render(run, {
            now,
            clock: elapsed,
            elapsed,
            blackoutOpacity,
            closing: baseBlackoutProgress,
        });

        if (!run.finishing) {
            run.frameId = this.requestAnimationFrame(() => this.tick(run));
        }
    }

    /**
     * How covered the frame is (0..1): the readiness signal. It follows the board's gate, which
     * has shut by RETURN_GATE_SHUT_AT of its closing, so the mode never stops the board while
     * part of it still shows.
     */
    computeBlackoutOpacity(run, baseBlackoutProgress, now) {
        if (!run.revealTriggered) {
            if (run.readyTriggered) {
                return 1;
            }
            if (run.reducedMotion) return easeInOutCubic(baseBlackoutProgress);
            return clamp01(baseBlackoutProgress / RETURN_GATE_SHUT_AT);
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

        Promise.resolve()
            .then(() => {
                if (run.finishing || run !== this.activeRun) return false;
                return run.callbacks.onBlackoutReached?.();
            })
            .then((result) => {
                if (run.finishing || run !== this.activeRun) return;
                if (result && typeof result === 'object' && result.arrivalAnchor) {
                    run.arrivalAnchor = normalizeAnchor(result.arrivalAnchor);
                }
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
        if (run.dom?.root) {
            run.dom.root.style.pointerEvents = 'none';
        }

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

    render(run, frame) {
        if (run.reducedMotion) {
            run.dom.veil.style.opacity = String(clamp01(frame.blackoutOpacity));
            if (
                run.revealTriggered
                && frame.clock - run.revealStartedAt >= run.timings.revealDurationMs
                && run.revealSettled
                && !run.revealFailed
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
        ) {
            this.finish(run, { success: true, aborted: false });
        }
    }

    /**
     * The gate as it stands this frame: the board shutting into a point, the passage back, the
     * world opening round the finished orb.
     * @returns {object} the frame for drawPortalGate, and `speed` for the travel
     */
    describeGate(run, frame, revealProgress) {
        const { width, height } = run.canvasSize;
        if (run.trackArrivalAnchor && run.revealTriggered) {
            // Follow the orb as the world's camera settles on it (a hidden or failed read keeps the last).
            try {
                const live = run.trackArrivalAnchor();
                if (live && live.onScreen !== false && Number.isFinite(live.x) && Number.isFinite(live.y)) {
                    run.arrivalAnchor = normalizeAnchor(live);
                }
            } catch {
                run.trackArrivalAnchor = null;
            }
        }
        const time = frame.clock / 1000;
        const at = (anchor) => ({
            x: anchor.x * width,
            y: anchor.y * height,
            r: anchor.radius * Math.min(width, height),
        });
        const board = at(run.departureAnchor);
        const orb = at(run.arrivalAnchor);
        if (run.revealTriggered) {
            // The world opens round the finished orb: the gate starts at the orb and swells past
            // the frame; the light ahead slides there first, while the gate is still small.
            const q = revealProgress;
            const slide = easeInOutCubic(clamp01(q / 0.3));
            const center = {
                x: board.x + (orb.x - board.x) * slide,
                y: board.y + (orb.y - board.y) * slide,
            };
            const open = easeOutCubic(clamp01((q - 0.06) / 0.94));
            const reach = portalReach(width, height, orb.x, orb.y);
            return {
                speed: 1 + q * 1.6,
                time,
                center,
                region: {
                    kind: 'hole', x: orb.x, y: orb.y, r: orb.r * 0.8 + (reach * 1.06 - orb.r * 0.8) * open,
                },
                rim: 1 - q * q,
                bloom: 0.4 * (1 - q) ** 2,
                rush: (1 - q) * 0.6,
            };
        }
        if (run.readyTriggered) {
            // The passage back, while the world prepares.
            return {
                speed: 1.1, time, center: { x: board.x, y: board.y }, region: { kind: 'all' },
            };
        }
        // The board closes into a gate that shuts on its middle as the passage rises round it.
        const shut = clamp01(frame.closing / (RETURN_GATE_SHUT_AT * BLACKOUT_READY_THRESHOLD));
        const reach = portalReach(width, height, board.x, board.y);
        return {
            speed: 1.3,
            time,
            center: { x: board.x, y: board.y },
            region: {
                kind: 'hole', x: board.x, y: board.y, r: reach * 1.06 * (1 - easeInOutCubic(shut)),
            },
            rim: 1,
            rush: 0.4 + shut * 0.6,
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
            direction: -1,
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
                if (run === this.activeRun) {
                    this.activeRun = null;
                }
                this.teardown(run);
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

export default JourneyReturnTransition;

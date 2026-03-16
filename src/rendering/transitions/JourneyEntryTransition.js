import { TRANSITION_LAYERS } from './transition-layer-constants.js';

const DEFAULT_TIMINGS = Object.freeze({
    ignitionDelayMs: 120,
    blackoutStartMs: 420,
    blackoutFullMs: 760,
    revealDurationMs: 420,
    particleDecayMs: 520,
    maxBlackoutHoldMs: 5200,
});

const QUALITY_PARTICLE_COUNTS = Object.freeze({
    Minimal: 34,
    Low: 48,
    Medium: 68,
    High: 92,
    Ultra: 128,
    Extreme: 168,
});

const BLACKOUT_READY_THRESHOLD = 0.96;
const WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
const HOLD_STAGE_THRESHOLDS_MS = Object.freeze({
    seamless: 900,
    sustained: 1800,
    arrivalVoid: 3000,
});

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t) {
    return 1 - ((1 - t) ** 3);
}

function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - (((-2 * t) + 2) ** 3) / 2;
}

function randomBetween(min, max) {
    return min + (Math.random() * (max - min));
}

function toCssColor(value, fallback = '#ffffff') {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value.getStyle === 'function') return value.getStyle();
    if (typeof value.getHexString === 'function') return `#${value.getHexString()}`;
    return fallback;
}

function normalizeAnchor(anchor = {}) {
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
        const timings = normalizeTimings(config.timings);
        const callbacks = config.callbacks || {};
        const qualityPreset = config.qualityPreset || 'High';
        const particleCount = QUALITY_PARTICLE_COUNTS[qualityPreset] ?? QUALITY_PARTICLE_COUNTS.High;

        return {
            anchor,
            palette,
            timings,
            callbacks,
            startedAt: this.performance.now(),
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
            particles: this.createParticles(particleCount, anchor, palette),
        };
    }

    createParticles(count, _anchor, palette) {
        const particles = [];
        const colors = [palette.primary, palette.accent, palette.highlight];

        for (let index = 0; index < count; index += 1) {
            const angle = randomBetween(0, Math.PI * 2);
            const speed = randomBetween(120, 520);
            const arc = randomBetween(-0.6, 0.6);
            particles.push({
                angle,
                speed,
                arc,
                drift: randomBetween(-80, 80),
                size: randomBetween(1.4, 5.6),
                lifeMs: randomBetween(360, 820),
                delayMs: randomBetween(0, 140),
                color: colors[index % colors.length],
            });
        }

        return particles;
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

        const canvas = this.document.createElement('canvas');
        canvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;

        const flare = this.document.createElement('div');
        flare.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            mix-blend-mode: screen;
            background:
                radial-gradient(circle at ${run.anchor.x * 100}% ${run.anchor.y * 100}%,
                    ${run.palette.highlight} 0%,
                    ${run.palette.accent} 10%,
                    ${run.palette.primary} 22%,
                    rgba(0, 0, 0, 0) 48%);
        `;

        const veil = this.document.createElement('div');
        veil.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: #000000;
            opacity: 0;
        `;

        const holdLayer = this.document.createElement('div');
        holdLayer.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0) 42%);
            mix-blend-mode: screen;
        `;

        const vignette = this.document.createElement('div');
        vignette.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0.5;
            background:
                radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0) 32%),
                radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.04) 0%, rgba(0, 0, 0, 0.76) 100%);
        `;

        root.appendChild(canvas);
        root.appendChild(flare);
        root.appendChild(veil);
        root.appendChild(holdLayer);
        root.appendChild(vignette);
        this.document.body.appendChild(root);

        let ctx = null;
        try {
            ctx = canvas.getContext('2d');
        } catch {
            ctx = null;
        }

        run.dom = {
            root,
            canvas,
            ctx,
            flare,
            veil,
            holdLayer,
            vignette,
        };

        this.resizeCanvas(run);
        this.window?.addEventListener?.('resize', this.handleResize);
    }

    onResize() {
        if (this.activeRun) {
            this.resizeCanvas(this.activeRun);
        }
    }

    resizeCanvas(run) {
        const width = this.window?.innerWidth || 1;
        const height = this.window?.innerHeight || 1;
        const dpr = this.window?.devicePixelRatio || 1;
        const { canvas } = run.dom;

        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        run.canvasSize = { width, height, dpr };
    }

    tick(run) {
        if (run.finishing || run !== this.activeRun) {
            return;
        }

        const now = this.performance.now();
        const elapsed = now - run.startedAt;
        const sinceIgnition = Math.max(0, elapsed - run.timings.ignitionDelayMs);
        const baseBlackoutProgress = clamp01(
            (elapsed - run.timings.blackoutStartMs)
            / Math.max(1, run.timings.blackoutFullMs - run.timings.blackoutStartMs),
        );
        const blackoutOpacity = this.computeBlackoutOpacity(run, baseBlackoutProgress, now);

        this.updateReadiness(run, blackoutOpacity, now);
        this.updateReveal(run, now);
        this.updatePlayable(run, now);
        this.render(run, {
            now,
            elapsed,
            sinceIgnition,
            blackoutOpacity,
        });

        if (!run.finishing) {
            run.frameId = this.requestAnimationFrame(() => this.tick(run));
        }
    }

    computeBlackoutOpacity(run, baseBlackoutProgress, now) {
        if (!run.revealTriggered) {
            if (run.readyTriggered) {
                return 1;
            }
            return easeInOutCubic(baseBlackoutProgress);
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

        if (blackoutOpacity < BLACKOUT_READY_THRESHOLD) {
            return;
        }

        run.readyTriggered = true;
        run.blackoutTriggeredAt = now;

        Promise.resolve(run.callbacks.onBlackoutReached?.())
            .then((result) => {
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

        Promise.resolve(run.callbacks.onRevealStart?.())
            .then((result) => {
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

        Promise.resolve(run.callbacks.onPlayable?.())
            .then((result) => {
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
        const {
            ctx,
            flare,
            veil,
            holdLayer,
            vignette,
        } = run.dom;
        const { width, height, dpr } = run.canvasSize;
        const revealElapsed = run.revealTriggered ? frame.now - run.revealStartedAt : 0;
        const revealProgress = run.revealTriggered
            ? clamp01(revealElapsed / Math.max(1, run.timings.revealDurationMs))
            : 0;
        const particleFadeProgress = run.revealTriggered
            ? clamp01(revealElapsed / Math.max(1, run.timings.particleDecayMs))
            : 0;
        const ignitionProgress = clamp01(frame.sinceIgnition / 620);
        const holdElapsed = run.readyTriggered ? frame.now - (run.blackoutTriggeredAt ?? frame.now) : 0;
        const waitingForReadiness = run.readyTriggered && !run.readySettled;
        const holdStage = waitingForReadiness ? this.getHoldStage(frame.elapsed) : 0;
        const holdBreath = waitingForReadiness
            ? (0.07 + (((Math.sin(holdElapsed * 0.0035) + 1) * 0.5) * 0.08))
            : 0;
        const holdPulse = waitingForReadiness
            ? (Math.sin(holdElapsed * 0.008) * (0.04 + (holdStage * 0.018)))
            : 0;
        const flareOpacity = (1 - revealProgress) * clamp01(
            0.12
            + (easeOutCubic(ignitionProgress) * 0.88)
            + holdBreath
            + (holdStage * 0.03),
        );
        const holdLayerOpacity = waitingForReadiness
            ? clamp01(0.1 + (holdStage * 0.12) + (((Math.sin(holdElapsed * 0.0024) + 1) * 0.5) * 0.08))
            : 0;

        if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width * dpr, height * dpr);
            ctx.scale(dpr, dpr);
            this.drawParticles(run, frame, particleFadeProgress);
            this.drawHoldAtmosphere(run, frame, holdStage);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        flare.style.opacity = String(Math.max(0, flareOpacity));
        veil.style.opacity = String(clamp01(frame.blackoutOpacity));
        holdLayer.style.opacity = String(holdLayerOpacity);
        holdLayer.style.background = this.buildHoldBackground(run, holdStage, holdElapsed);
        vignette.style.opacity = String(clamp01(0.42 + (frame.blackoutOpacity * 0.36) + holdPulse));

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

    drawParticles(run, frame, particleFadeProgress) {
        const { ctx } = run.dom;
        if (!ctx) return;

        const { width, height } = run.canvasSize;
        const originX = run.anchor.x * width;
        const originY = run.anchor.y * height;
        const ignitionTime = run.startedAt + run.timings.ignitionDelayMs;
        const globalFade = 1 - easeOutCubic(particleFadeProgress);

        for (const particle of run.particles) {
            const ageMs = frame.now - ignitionTime - particle.delayMs;
            if (ageMs <= 0) {
                continue;
            }

            const localProgress = clamp01(ageMs / particle.lifeMs);
            const fade = (1 - easeOutCubic(localProgress)) * globalFade;
            if (fade <= 0.002) {
                continue;
            }

            const distance = particle.speed * (ageMs / 1000);
            const drift = particle.drift * ((ageMs / 1000) ** 1.35);
            const spread = 1 + (run.anchor.radius * 6);
            const x = originX
                + (Math.cos(particle.angle) * distance * spread)
                + (Math.sin(particle.arc * Math.PI) * drift);
            const y = originY
                + (Math.sin(particle.angle) * distance * spread)
                - ((localProgress ** 1.2) * 180)
                + (particle.arc * 60);
            const size = particle.size * (0.5 + ((1 - localProgress) * 0.9));

            ctx.globalAlpha = fade;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    drawHoldAtmosphere(run, frame, holdStage) {
        const { ctx } = run.dom;
        if (!ctx || holdStage <= 0 || run.revealTriggered) return;

        const { width, height } = run.canvasSize;
        const driftTime = frame.now * 0.00035;
        const anchorX = run.anchor.x * width;
        const anchorY = run.anchor.y * height;
        const moteCount = 8 + (holdStage * 4);

        for (let index = 0; index < moteCount; index += 1) {
            const phase = driftTime + (index * 0.73);
            const orbit = 120 + (holdStage * 48) + ((index % 5) * 22);
            const angle = phase + (index * 1.17);
            const x = anchorX + (Math.cos(angle) * orbit) + Math.sin(phase * 0.7) * 18;
            const y = anchorY + (Math.sin(angle * 0.82) * orbit * 0.48) + Math.cos(phase * 0.9) * 24;
            const size = 1.8 + ((index % 4) * 0.6) + (holdStage * 0.28);
            const alpha = 0.025 + (((Math.sin(phase * 1.9) + 1) * 0.5) * 0.035) + (holdStage * 0.012);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = index % 3 === 0 ? run.palette.highlight : run.palette.accent;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    getHoldStage(totalElapsedMs) {
        if (totalElapsedMs < HOLD_STAGE_THRESHOLDS_MS.seamless) {
            return 0;
        }
        if (totalElapsedMs < HOLD_STAGE_THRESHOLDS_MS.sustained) {
            return 1;
        }
        if (totalElapsedMs < HOLD_STAGE_THRESHOLDS_MS.arrivalVoid) {
            return 2;
        }
        return 3;
    }

    buildHoldBackground(run, holdStage, holdElapsedMs) {
        const anchorX = Math.round(run.anchor.x * 100);
        const anchorY = Math.round(run.anchor.y * 100);
        const shimmer = ((Math.sin(holdElapsedMs * 0.0022) + 1) * 0.5);

        if (holdStage >= 3) {
            return `
                radial-gradient(circle at ${anchorX}% ${anchorY}%,
                    rgba(255, 255, 255, ${0.04 + (shimmer * 0.04)}) 0%,
                    rgba(255, 255, 255, 0.012) 8%,
                    rgba(8, 12, 24, 0.12) 24%,
                    rgba(4, 8, 18, 0.54) 52%,
                    rgba(0, 0, 0, 0.88) 100%),
                radial-gradient(circle at 50% 52%,
                    ${run.palette.shadow} 0%,
                    rgba(0, 0, 0, 0.96) 74%)
            `;
        }

        const sweepAlpha = holdStage >= 2 ? 0.09 + (shimmer * 0.06) : 0.04 + (shimmer * 0.03);
        return `
            radial-gradient(circle at ${anchorX}% ${anchorY}%,
                rgba(255, 255, 255, ${0.03 + (shimmer * 0.03)}) 0%,
                rgba(255, 255, 255, 0.06) 14%,
                rgba(0, 0, 0, 0) 44%),
            linear-gradient(${120 + (shimmer * 20)}deg,
                rgba(255, 255, 255, 0) 18%,
                rgba(255, 255, 255, ${sweepAlpha}) 46%,
                rgba(255, 255, 255, 0) 74%)
        `;
    }

    finish(run, result) {
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
            .finally(() => {
                if (run === this.activeRun) {
                    this.activeRun = null;
                }
                this.teardown(run);
                run.resolve?.(result);
            });
    }

    teardown(run = this.activeRun) {
        this.window?.removeEventListener?.('resize', this.handleResize);

        const root = run?.dom?.root;
        if (root?.parentNode) {
            root.parentNode.removeChild(root);
        }
    }
}

export default JourneyEntryTransition;

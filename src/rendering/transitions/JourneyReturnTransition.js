import { TRANSITION_LAYERS } from './transition-layer-constants.js';
import { advancePortalTravel, createPortalTunnel, drawPortalTunnel } from './portal-tunnel.js';

const DEFAULT_TIMINGS = Object.freeze({
    departureDelayMs: 60,
    blackoutStartMs: 300,
    blackoutFullMs: 620,
    revealDurationMs: 680,
    particleDecayMs: 760,
    maxBlackoutHoldMs: 7200,
});

const QUALITY_PARTICLE_COUNTS = Object.freeze({
    Minimal: 28,
    Low: 40,
    Medium: 56,
    High: 78,
    Ultra: 104,
    Extreme: 136,
});

const BLACKOUT_READY_THRESHOLD = 0.96;
const WHEEL_LOCK_ATTRIBUTE = 'data-odyssey-wheel-lock';
const HOLD_STAGE_THRESHOLDS_MS = Object.freeze({
    seamless: 900,
    sustained: 1800,
    arrivalVoid: 3200,
});

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function easeInCubic(t) {
    return t * t * t;
}

function easeOutCubic(t) {
    return 1 - ((1 - t) ** 3);
}

function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - (((-2 * t) + 2) ** 3) / 2;
}

function easeOutQuad(t) {
    return 1 - ((1 - t) * (1 - t));
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
        const particleCount = QUALITY_PARTICLE_COUNTS[qualityPreset] ?? QUALITY_PARTICLE_COUNTS.High;

        return {
            departureAnchor,
            arrivalAnchor,
            palette,
            timings,
            reducedMotion,
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
            finishing: false,
            frameId: null,
            resolve: null,
            dom: null,
            canvasSize: { width: 1, height: 1, dpr: 1 },
            departureParticles: reducedMotion ? [] : this.createParticles(particleCount, palette, 'departure'),
            arrivalParticles: reducedMotion
                ? [] : this.createParticles(Math.round(particleCount * 0.78), palette, 'arrival'),
            tunnel: reducedMotion ? null : createPortalTunnel({ qualityPreset, palette }),
            travelState: { travel: 0, lastTravelAt: null },
        };
    }

    createParticles(count, palette, mode) {
        const particles = [];
        const colors = [palette.primary, palette.accent, palette.highlight];

        for (let index = 0; index < count; index += 1) {
            particles.push({
                angle: randomBetween(0, Math.PI * 2),
                orbit: randomBetween(mode === 'departure' ? 42 : 20, mode === 'departure' ? 180 : 108),
                drift: randomBetween(mode === 'departure' ? -56 : -30, mode === 'departure' ? 56 : 30),
                speed: randomBetween(mode === 'departure' ? 110 : 50, mode === 'departure' ? 210 : 120),
                size: randomBetween(mode === 'departure' ? 0.9 : 0.7, mode === 'departure' ? 3.2 : 2.1),
                lifeMs: randomBetween(mode === 'departure' ? 320 : 520, mode === 'departure' ? 720 : 1200),
                delayMs: randomBetween(0, mode === 'departure' ? 180 : 260),
                color: colors[index % colors.length],
            });
        }

        return particles;
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

        // The calm path allocates no particle canvas and has no glow, aperture,
        // vignette or white frame: only an opaque dark layer changes opacity.
        if (run.reducedMotion) {
            const veil = this.document.createElement('div');
            veil.style.cssText = 'position: absolute; inset: 0; background: #05070d; opacity: 0;';
            root.setAttribute('data-reduced-motion', 'true');
            root.appendChild(veil);
            this.document.body.appendChild(root);
            run.dom = { root, veil };
            return;
        }

        const canvas = this.document.createElement('canvas');
        canvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;

        const departureGlow = this.document.createElement('div');
        departureGlow.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            mix-blend-mode: screen;
            background:
                radial-gradient(circle at ${run.departureAnchor.x * 100}% ${run.departureAnchor.y * 100}%,
                    ${run.palette.highlight} 0%,
                    ${run.palette.accent} 8%,
                    ${run.palette.primary} 18%,
                    rgba(0, 0, 0, 0) 44%);
        `;

        const arrivalGlow = this.document.createElement('div');
        arrivalGlow.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            mix-blend-mode: screen;
            background:
                radial-gradient(circle at ${run.arrivalAnchor.x * 100}% ${run.arrivalAnchor.y * 100}%,
                    rgba(255, 255, 255, 0.95) 0%,
                    ${run.palette.highlight} 6%,
                    ${run.palette.accent} 12%,
                    rgba(0, 0, 0, 0) 36%);
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
            opacity: 0.58;
            background:
                radial-gradient(circle at 50% 45%, rgba(255, 255, 255, 0.02), rgba(0, 0, 0, 0) 24%),
                radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.82) 100%);
        `;

        // The tunnel rides above the veil: leaving an orb pulls you back out through its light.
        const tunnelCanvas = this.document.createElement('canvas');
        tunnelCanvas.className = 'journey-portal-tunnel';
        tunnelCanvas.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;

        root.appendChild(canvas);
        root.appendChild(departureGlow);
        root.appendChild(arrivalGlow);
        root.appendChild(veil);
        root.appendChild(holdLayer);
        root.appendChild(vignette);
        root.appendChild(tunnelCanvas);
        this.document.body.appendChild(root);

        let ctx = null;
        let tunnelCtx = null;
        try {
            ctx = canvas.getContext('2d');
            tunnelCtx = tunnelCanvas.getContext('2d');
        } catch {
            ctx = ctx || null;
            tunnelCtx = null;
        }

        run.dom = {
            root,
            canvas,
            ctx,
            departureGlow,
            arrivalGlow,
            veil,
            holdLayer,
            vignette,
            tunnelCanvas,
            tunnelCtx,
        };

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
        [run.dom.canvas, run.dom.tunnelCanvas].filter(Boolean).forEach((canvas) => {
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        });

        run.canvasSize = { width, height, dpr };
    }

    tick(run) {
        if (run.finishing || run !== this.activeRun) {
            return;
        }

        const now = this.performance.now();
        const elapsed = now - run.startedAt;
        const baseBlackoutProgress = clamp01(
            (elapsed - run.timings.blackoutStartMs)
            / Math.max(1, run.timings.blackoutFullMs - run.timings.blackoutStartMs),
        );
        const blackoutOpacity = this.computeBlackoutOpacity(run, baseBlackoutProgress, now);

        this.updateReadiness(run, blackoutOpacity, now);
        this.updateReveal(run, now);
        this.render(run, {
            now,
            elapsed,
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
                && frame.now - run.revealStartedAt >= run.timings.revealDurationMs
                && run.revealSettled
                && !run.revealFailed
            ) {
                this.finish(run, { success: true, aborted: false });
            }
            return;
        }

        const {
            ctx,
            departureGlow,
            arrivalGlow,
            veil,
            holdLayer,
            vignette,
        } = run.dom;
        const { width, height, dpr } = run.canvasSize;
        const revealElapsed = run.revealTriggered ? frame.now - run.revealStartedAt : 0;
        const revealProgress = run.revealTriggered
            ? clamp01(revealElapsed / Math.max(1, run.timings.revealDurationMs))
            : 0;
        const revealEase = easeOutCubic(revealProgress);
        const apertureProgress = run.revealTriggered ? easeOutQuad(revealProgress) : 0;
        const particleFadeProgress = run.revealTriggered
            ? clamp01(revealElapsed / Math.max(1, run.timings.particleDecayMs))
            : 0;
        const departureCollapse = clamp01(
            (frame.elapsed - run.timings.departureDelayMs)
            / Math.max(220, run.timings.blackoutStartMs - run.timings.departureDelayMs + 220),
        );
        const holdElapsed = run.readyTriggered ? frame.now - (run.blackoutTriggeredAt ?? frame.now) : 0;
        const waitingForReadiness = run.readyTriggered && !run.readySettled;
        const holdStage = waitingForReadiness ? this.getHoldStage(holdElapsed) : 0;
        const holdBreath = waitingForReadiness
            ? (0.06 + (((Math.sin(holdElapsed * 0.0032) + 1) * 0.5) * 0.09))
            : 0;

        if (ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width * dpr, height * dpr);
            ctx.scale(dpr, dpr);
            this.drawDepartureParticles(run, frame, departureCollapse, particleFadeProgress);
            this.drawArrivalParticles(run, frame, revealProgress, particleFadeProgress);
            this.drawHoldAtmosphere(run, frame, holdStage);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        this.drawTunnel(run, frame, { revealProgress, waitingForReadiness, holdElapsed });

        departureGlow.style.opacity = String(clamp01(
            (1 - revealProgress)
            * (0.08 + (easeOutCubic(departureCollapse) * 0.34) + (holdBreath * 0.35)),
        ));
        arrivalGlow.style.opacity = String(clamp01(
            run.revealTriggered
                ? ((1 - revealProgress) * (0.16 + (revealEase * 0.18)))
                : 0,
        ));
        veil.style.opacity = String(clamp01(frame.blackoutOpacity));
        veil.style.background = this.buildRevealVeilBackground(run, {
            blackoutOpacity: frame.blackoutOpacity,
            apertureProgress,
        });
        holdLayer.style.opacity = String(waitingForReadiness
            ? clamp01(0.12 + (holdStage * 0.12) + (((Math.sin(holdElapsed * 0.0024) + 1) * 0.5) * 0.08))
            : 0);
        holdLayer.style.background = this.buildHoldBackground(run, holdStage, holdElapsed);
        vignette.style.opacity = String(clamp01(
            0.48
            + (frame.blackoutOpacity * 0.34)
            + (run.revealTriggered ? ((1 - revealProgress) * 0.08) : 0),
        ));

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
     * Pull back out of the orb: rings stream inward around the board as the veil closes, keep
     * flowing while the world prepares, then carry you to the finished orb and bloom open there.
     */
    drawTunnel(run, frame, { revealProgress, waitingForReadiness, holdElapsed }) {
        const { tunnelCtx } = run.dom;
        if (!tunnelCtx || !run.tunnel) return;
        const { width, height, dpr } = run.canvasSize;
        let intensity;
        let speed;
        let bloom = 0;
        let toward = 0;
        if (run.revealTriggered) {
            intensity = 1 - easeOutCubic(revealProgress);
            speed = 1 + revealProgress * 2.4;
            bloom = Math.sin(Math.PI * Math.min(1, revealProgress * 1.1)) * 0.8;
            toward = easeInOutCubic(revealProgress);
        } else {
            const closing = easeInOutCubic(clamp01(frame.blackoutOpacity));
            const breathing = waitingForReadiness ? 0.86 + (Math.sin(holdElapsed * 0.0021) * 0.14) : 1;
            intensity = closing * breathing;
            speed = 1.4 - (0.4 * closing);
        }
        const travel = advancePortalTravel(run.travelState, frame.now, speed);
        const fromX = run.departureAnchor.x * width;
        const fromY = run.departureAnchor.y * height;
        const toX = run.arrivalAnchor.x * width;
        const toY = run.arrivalAnchor.y * height;
        tunnelCtx.setTransform(1, 0, 0, 1, 0, 0);
        tunnelCtx.clearRect(0, 0, width * dpr, height * dpr);
        tunnelCtx.scale(dpr, dpr);
        drawPortalTunnel(tunnelCtx, run.tunnel, {
            width,
            height,
            cx: fromX + ((toX - fromX) * toward),
            cy: fromY + ((toY - fromY) * toward),
            travel,
            intensity,
            bloom,
            direction: -1,
        });
        tunnelCtx.setTransform(1, 0, 0, 1, 0, 0);
    }

    drawDepartureParticles(run, frame, departureCollapse, particleFadeProgress) {
        const { ctx } = run.dom;
        if (!ctx || run.revealTriggered) return;

        const { width, height } = run.canvasSize;
        const originX = run.departureAnchor.x * width;
        const originY = run.departureAnchor.y * height;
        const globalFade = (1 - easeOutCubic(clamp01(departureCollapse + (particleFadeProgress * 0.18)))) * 0.52;
        const collapse = easeInCubic(departureCollapse);

        for (const particle of run.departureParticles) {
            const ageMs = frame.elapsed - particle.delayMs;
            if (ageMs <= 0) continue;

            const localProgress = clamp01(ageMs / particle.lifeMs);
            const fade = (1 - easeOutCubic(localProgress)) * globalFade;
            if (fade <= 0.002) continue;

            const orbit = particle.orbit * (1 - collapse);
            const inward = easeInCubic(localProgress);
            const drift = particle.drift * (1 - localProgress) * 0.14;
            const angle = particle.angle + (particle.speed * ageMs * 0.000015);
            const x = originX + (Math.cos(angle) * orbit * (1 - inward)) + drift;
            const y = originY + (Math.sin(angle) * orbit * 0.62 * (1 - inward)) - (collapse * 30);
            const size = particle.size * (0.5 + ((1 - collapse) * 0.46));

            ctx.globalAlpha = fade;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    drawArrivalParticles(run, frame, revealProgress, particleFadeProgress) {
        const { ctx } = run.dom;
        if (!ctx || !run.revealTriggered) return;

        const { width, height } = run.canvasSize;
        const originX = run.arrivalAnchor.x * width;
        const originY = run.arrivalAnchor.y * height;
        const globalFade = (1 - easeOutCubic(clamp01(particleFadeProgress))) * 0.18;
        const revealEase = easeOutCubic(revealProgress);

        for (const particle of run.arrivalParticles) {
            const ageMs = revealProgress * run.timings.particleDecayMs - particle.delayMs;
            if (ageMs <= 0) continue;

            const localProgress = clamp01(ageMs / particle.lifeMs);
            const fade = (1 - easeOutCubic(localProgress)) * globalFade;
            if (fade <= 0.002) continue;

            const orbit = particle.orbit * (0.55 + (revealEase * 1.35));
            const x = originX + (Math.cos(particle.angle + (localProgress * 0.35)) * orbit) + (particle.drift * 0.08);
            const y = originY + (Math.sin(particle.angle + (localProgress * 0.42)) * orbit * 0.52) - (localProgress * 16);
            const size = particle.size * (0.46 + ((1 - localProgress) * 0.4));

            ctx.globalAlpha = fade;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    buildRevealVeilBackground(run, frame) {
        if (!run.revealTriggered || frame.apertureProgress <= 0) {
            return '#000000';
        }

        const anchorX = Math.round(run.arrivalAnchor.x * 100);
        const anchorY = Math.round(run.arrivalAnchor.y * 100);
        const innerRadius = 2 + (run.arrivalAnchor.radius * 18) + (frame.apertureProgress * 22);
        const outerRadius = innerRadius + 10 + (frame.apertureProgress * 42);
        const glowAlpha = 0.1 + ((1 - frame.blackoutOpacity) * 0.06);

        return `
            radial-gradient(circle ${outerRadius}% at ${anchorX}% ${anchorY}%,
                rgba(0, 0, 0, 0) 0%,
                rgba(0, 0, 0, 0) ${innerRadius}%,
                rgba(255, 255, 255, ${glowAlpha}) ${innerRadius + 2}%,
                rgba(0, 0, 0, 0.72) ${innerRadius + 9}%,
                rgba(0, 0, 0, 0.96) ${outerRadius}%,
                rgba(0, 0, 0, 1) 100%)
        `;
    }

    drawHoldAtmosphere(run, frame, holdStage) {
        const { ctx } = run.dom;
        if (!ctx || holdStage <= 0 || run.revealTriggered) return;

        const { width, height } = run.canvasSize;
        const driftTime = frame.now * 0.00034;
        const anchorX = run.arrivalAnchor.x * width;
        const anchorY = run.arrivalAnchor.y * height;
        const moteCount = 10 + (holdStage * 4);

        for (let index = 0; index < moteCount; index += 1) {
            const phase = driftTime + (index * 0.68);
            const orbit = 96 + (holdStage * 44) + ((index % 4) * 28);
            const angle = phase + (index * 1.22);
            const x = anchorX + (Math.cos(angle) * orbit) + Math.sin(phase * 0.7) * 16;
            const y = anchorY + (Math.sin(angle * 0.86) * orbit * 0.45) + Math.cos(phase * 0.88) * 22;
            const size = 1.8 + ((index % 3) * 0.72) + (holdStage * 0.24);
            const alpha = 0.028 + (((Math.sin(phase * 1.8) + 1) * 0.5) * 0.038) + (holdStage * 0.012);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = index % 3 === 0 ? run.palette.highlight : run.palette.accent;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    getHoldStage(holdElapsedMs) {
        if (holdElapsedMs < HOLD_STAGE_THRESHOLDS_MS.seamless) {
            return 0;
        }
        if (holdElapsedMs < HOLD_STAGE_THRESHOLDS_MS.sustained) {
            return 1;
        }
        if (holdElapsedMs < HOLD_STAGE_THRESHOLDS_MS.arrivalVoid) {
            return 2;
        }
        return 3;
    }

    buildHoldBackground(run, holdStage, holdElapsedMs) {
        const anchorX = Math.round(run.arrivalAnchor.x * 100);
        const anchorY = Math.round(run.arrivalAnchor.y * 100);
        const shimmer = ((Math.sin(holdElapsedMs * 0.0021) + 1) * 0.5);

        if (holdStage >= 3) {
            return `
                radial-gradient(circle at ${anchorX}% ${anchorY}%,
                    rgba(255, 255, 255, ${0.04 + (shimmer * 0.05)}) 0%,
                    rgba(255, 255, 255, 0.014) 8%,
                    rgba(8, 12, 24, 0.12) 22%,
                    rgba(4, 8, 18, 0.56) 52%,
                    rgba(0, 0, 0, 0.9) 100%),
                radial-gradient(circle at 50% 52%,
                    ${run.palette.shadow} 0%,
                    rgba(0, 0, 0, 0.97) 76%)
            `;
        }

        const sweepAlpha = holdStage >= 2 ? 0.1 + (shimmer * 0.06) : 0.05 + (shimmer * 0.03);
        return `
            radial-gradient(circle at ${anchorX}% ${anchorY}%,
                rgba(255, 255, 255, ${0.03 + (shimmer * 0.03)}) 0%,
                rgba(255, 255, 255, 0.06) 12%,
                rgba(0, 0, 0, 0) 42%),
            linear-gradient(${130 + (shimmer * 18)}deg,
                rgba(255, 255, 255, 0) 18%,
                rgba(255, 255, 255, ${sweepAlpha}) 48%,
                rgba(255, 255, 255, 0) 78%)
        `;
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
        // Release the full-screen veil and tunnel backings now rather than at a later GC,
        // which could otherwise land inside the next portal's preparation hold.
        [run?.dom?.canvas, run?.dom?.tunnelCanvas].forEach((canvas) => {
            if (!canvas) return;
            canvas.width = 0;
            canvas.height = 0;
        });
    }
}

export default JourneyReturnTransition;

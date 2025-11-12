/**
 * @fileoverview Fluid Dreams Theme - Dreamy flowing scene with morphing blobs, iridescent bubbles, and flowing ribbons
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Fluid Dreams Theme
 * Features:
 * - Morphing blobs with gooey effects
 * - Iridescent bubbles floating upward
 * - Flowing ribbon streams
 */
export default class FluidDreamsTheme extends BaseTheme {
    constructor() {
        super('fluid-dreams');

        // Gameplay effects
        this.liquidSplashes = [];
        this.iridescenceWaves = [];
        this.dreamRipples = [];
        this.fluidStreams = [];
        this.prismBursts = [];
        this.morphBlobs = [];
        this.comboMultiplier = 1.0;
        this.effectsAnimationFrame = null;
        this.lastEffectsFrameTime = 0;
        this.eventUnsubscribers = [];
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Morphing Blobs for Gooey Effect
        const blobContainer = this.getContainer('morphing-blobs');
        if (blobContainer && blobContainer.children.length === 0) {
            const numBlobs = 8;
            for (let i = 0; i < numBlobs; i++) {
                const blob = document.createElement('div');
                blob.className = 'morph-blob';
                const size = Math.random() * 150 + 100; // 100px to 250px
                blob.style.width = `${size}px`;
                blob.style.height = `${size}px`;

                // Set random animation properties using CSS variables
                blob.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`);
                blob.style.setProperty('--y-start', `${Math.random() * 80 + 10}vh`);
                blob.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`);
                blob.style.setProperty('--y-end', `${Math.random() * 80 + 10}vh`);
                blob.style.setProperty('--scale-start', `${Math.random() * 0.5 + 0.8}`);
                blob.style.setProperty('--scale-end', `${Math.random() * 0.5 + 0.8}`);

                blob.style.animationDelay = `-${Math.random() * 10}s, -${Math.random() * 15}s, -${Math.random() * 20}s`;
                blobContainer.appendChild(blob);
            }
        }

        // 2. Iridescent Bubbles
        const bubbleContainer = this.getContainer('iridescent-bubbles');
        if (bubbleContainer && bubbleContainer.children.length === 0) {
            const numBubbles = 20;
            for (let i = 0; i < numBubbles; i++) {
                const bubble = document.createElement('div');
                bubble.className = 'iridescent-bubble';
                const size = Math.random() * 80 + 20; // 20px to 100px
                bubble.style.width = `${size}px`;
                bubble.style.height = `${size}px`;

                bubble.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                bubble.style.setProperty('--y-start', `${110}vh`); // Start from bottom
                bubble.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                bubble.style.setProperty('--y-end', `${-10}vh`); // Float to top
                bubble.style.setProperty('--scale', `${Math.random() * 0.4 + 0.8}`);

                const duration = Math.random() * 15 + 20; // 20s to 35s
                bubble.style.animationDuration = `${duration}s`;
                bubble.style.animationDelay = `-${Math.random() * duration}s`;
                bubbleContainer.appendChild(bubble);
            }
        }

        // 3. Flowing Ribbons
        const ribbonContainer = this.getContainer('ribbon-streams');
        if (ribbonContainer && ribbonContainer.children.length === 0) {
            const numRibbons = 5;
            for (let i = 0; i < numRibbons; i++) {
                const ribbon = document.createElement('div');
                ribbon.className = 'ribbon-stream';

                ribbon.style.setProperty('--x-start', `${Math.random() * 120 - 10}vw`);
                ribbon.style.setProperty('--y-start', `${Math.random() * 120 - 10}vh`);
                ribbon.style.setProperty('--x-end', `${Math.random() * 120 - 10}vw`);
                ribbon.style.setProperty('--y-end', `${Math.random() * 120 - 10}vh`);
                ribbon.style.setProperty('--r-start', `${Math.random() * 720 - 360}deg`);
                ribbon.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);

                const duration = Math.random() * 20 + 30; // 30s to 50s
                ribbon.style.animationDelay = `-${Math.random() * duration}s, -${Math.random() * 10}s`;
                ribbonContainer.appendChild(ribbon);
            }
        }

        // Setup gameplay effects
        this.setupGameplayEffects();
    }

    setupGameplayEffects() {
        // Create canvas for gameplay effects
        const themeContainer = document.getElementById('fluid-dreams-theme');
        if (!themeContainer) return;

        let canvas = document.getElementById('fluid-dreams-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'fluid-dreams-effects-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '100';
            themeContainer.appendChild(canvas);
        }

        this.effectsCanvas = canvas;
        this.effectsCtx = canvas.getContext('2d', { alpha: true, desynchronized: true });

        // Size canvas
        const resizeCanvas = () => {
            if (!this.effectsCanvas) return;
            const rect = themeContainer.getBoundingClientRect();
            this.effectsCanvas.width = rect.width;
            this.effectsCanvas.height = rect.height;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Setup event listeners
        this.setupEventListeners();

        // Start effects animation loop
        this.startEffectsLoop();
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data) {
        const { lineCount } = data;
        this.createLiquidSplash(lineCount);

        if (lineCount >= 2) {
            this.createDreamRipples(lineCount);
        }

        if (lineCount >= 3) {
            this.createFluidStreams(lineCount);
        }
    }

    handleCombo(data) {
        const { comboCount } = data;
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.5);

        if (comboCount >= 2) {
            this.createIridescenceWave(comboCount);
        }

        if (comboCount >= 4) {
            this.createPrismBurst(comboCount);
        }

        if (comboCount >= 6) {
            this.createMorphBlob(comboCount);
        }
    }

    createLiquidSplash(lineCount) {
        if (!this.effectsCanvas) return;

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = [
            { h: 280, s: 70, l: 65 }, // Purple
            { h: 200, s: 80, l: 60 }, // Cyan
            { h: 320, s: 75, l: 70 }, // Pink
            { h: 180, s: 70, l: 65 }, // Aqua
        ];

        const particleCount = Math.min(lineCount * 35 + this.comboMultiplier * 30, 300);

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (Math.random() * 4 + 3) * this.comboMultiplier;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.liquidSplashes.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                maxLife: Math.random() * 0.9 + 0.7,
                size: Math.random() * 8 + 3,
                color,
                viscosity: Math.random() * 0.15 + 0.85,
                shimmer: Math.random() * Math.PI * 2,
                trail: [],
            });
        }
    }

    createIridescenceWave(comboCount) {
        if (!this.effectsCanvas) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        for (let i = 0; i < Math.min(comboCount * 2, 10); i++) {
            this.iridescenceWaves.push({
                x: Math.random() * width,
                y: Math.random() * height,
                radius: 0,
                maxRadius: Math.random() * 400 + 300,
                life: 1.0,
                maxLife: 1.5 + Math.random() * 0.8,
                hueOffset: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 0.05,
                rotation: 0,
            });
        }
    }

    createDreamRipples(lineCount) {
        if (!this.effectsCanvas) return;

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;

        for (let i = 0; i < lineCount * 3; i++) {
            this.dreamRipples.push({
                x: centerX + (Math.random() - 0.5) * 200,
                y: centerY + (Math.random() - 0.5) * 200,
                radius: 0,
                maxRadius: Math.random() * 250 + 200,
                life: 1.0,
                maxLife: 1.2 + Math.random() * 0.6,
                hue: Math.random() * 360,
                frequency: Math.random() * 8 + 6,
                amplitude: Math.random() * 15 + 10,
                phase: Math.random() * Math.PI * 2,
            });
        }
    }

    createFluidStreams(lineCount) {
        if (!this.effectsCanvas) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        for (let i = 0; i < Math.min(lineCount * 2, 12); i++) {
            const startX = Math.random() * width;
            const startY = Math.random() * height;
            const angle = Math.random() * Math.PI * 2;
            const length = Math.random() * 300 + 200;

            const points = [];
            const segments = 20;
            for (let j = 0; j <= segments; j++) {
                const t = j / segments;
                const deviation = Math.sin(t * Math.PI * 4) * 50;
                points.push({
                    x: startX + Math.cos(angle) * length * t + Math.cos(angle + Math.PI / 2) * deviation,
                    y: startY + Math.sin(angle) * length * t + Math.sin(angle + Math.PI / 2) * deviation,
                });
            }

            this.fluidStreams.push({
                points,
                life: 1.0,
                maxLife: 1.0 + Math.random() * 0.5,
                hue: Math.random() * 360,
                width: Math.random() * 8 + 4,
                flowOffset: 0,
                flowSpeed: Math.random() * 0.1 + 0.05,
            });
        }
    }

    createPrismBurst(comboCount) {
        if (!this.effectsCanvas) return;

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;

        const rayCount = Math.min(comboCount * 4, 24);
        const rays = [];

        for (let i = 0; i < rayCount; i++) {
            const angle = (Math.PI * 2 / rayCount) * i;
            const length = Math.random() * 200 + 150;
            rays.push({
                angle,
                length,
                hue: (360 / rayCount) * i,
                width: Math.random() * 6 + 3,
            });
        }

        this.prismBursts.push({
            x: centerX,
            y: centerY,
            rays,
            life: 1.0,
            maxLife: 1.2 + Math.random() * 0.5,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.08,
            expansion: 0,
        });
    }

    createMorphBlob(comboCount) {
        if (!this.effectsCanvas) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        for (let i = 0; i < Math.min(Math.floor(comboCount / 3), 3); i++) {
            const points = [];
            const numPoints = 8;
            const baseRadius = Math.random() * 80 + 60;

            for (let j = 0; j < numPoints; j++) {
                const angle = (Math.PI * 2 / numPoints) * j;
                const radius = baseRadius + (Math.random() - 0.5) * 40;
                points.push({
                    angle,
                    radius,
                    targetRadius: baseRadius + (Math.random() - 0.5) * 40,
                    morphSpeed: Math.random() * 0.02 + 0.01,
                });
            }

            this.morphBlobs.push({
                x: Math.random() * width,
                y: Math.random() * height,
                points,
                life: 1.0,
                maxLife: 2.5 + Math.random() * 1.0,
                hue: Math.random() * 360,
                hueShift: (Math.random() - 0.5) * 2,
                rotation: 0,
                rotationSpeed: (Math.random() - 0.5) * 0.03,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
            });
        }
    }

    startEffectsLoop() {
        if (this.effectsAnimationFrame) return;

        const tick = (timestamp) => {
            if (!this.effectsAnimationFrame || !this.isActive) {
                return;
            }

            if (!this.lastEffectsFrameTime) {
                this.lastEffectsFrameTime = timestamp;
            }

            const delta = Math.min((timestamp - this.lastEffectsFrameTime) / 1000, 0.1);
            this.lastEffectsFrameTime = timestamp;

            this.updateEffects(delta);
            this.renderEffects();

            this.effectsAnimationFrame = requestAnimationFrame(tick);
        };

        this.lastEffectsFrameTime = 0;
        this.effectsAnimationFrame = requestAnimationFrame(tick);
    }

    stopEffectsLoop() {
        if (this.effectsAnimationFrame) {
            cancelAnimationFrame(this.effectsAnimationFrame);
            this.effectsAnimationFrame = null;
        }
        this.lastEffectsFrameTime = 0;
    }

    updateEffects(delta) {
        // Update liquid splashes
        for (let i = this.liquidSplashes.length - 1; i >= 0; i--) {
            const p = this.liquidSplashes[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1; // Gentle gravity
            p.vx *= p.viscosity;
            p.vy *= p.viscosity;
            p.life -= delta / p.maxLife;
            p.shimmer += 0.15;

            if (p.life <= 0) {
                this.liquidSplashes.splice(i, 1);
            }
        }

        // Update iridescence waves
        for (let i = this.iridescenceWaves.length - 1; i >= 0; i--) {
            const wave = this.iridescenceWaves[i];
            wave.radius += (wave.maxRadius / wave.maxLife) * delta;
            wave.life -= delta / wave.maxLife;
            wave.rotation += wave.rotationSpeed;

            if (wave.life <= 0) {
                this.iridescenceWaves.splice(i, 1);
            }
        }

        // Update dream ripples
        for (let i = this.dreamRipples.length - 1; i >= 0; i--) {
            const ripple = this.dreamRipples[i];
            ripple.radius += (ripple.maxRadius / ripple.maxLife) * delta;
            ripple.life -= delta / ripple.maxLife;
            ripple.phase += 0.1;

            if (ripple.life <= 0) {
                this.dreamRipples.splice(i, 1);
            }
        }

        // Update fluid streams
        for (let i = this.fluidStreams.length - 1; i >= 0; i--) {
            const stream = this.fluidStreams[i];
            stream.life -= delta / stream.maxLife;
            stream.flowOffset += stream.flowSpeed;

            if (stream.life <= 0) {
                this.fluidStreams.splice(i, 1);
            }
        }

        // Update prism bursts
        for (let i = this.prismBursts.length - 1; i >= 0; i--) {
            const burst = this.prismBursts[i];
            burst.life -= delta / burst.maxLife;
            burst.rotation += burst.rotationSpeed;
            burst.expansion += delta * 100;

            if (burst.life <= 0) {
                this.prismBursts.splice(i, 1);
            }
        }

        // Update morph blobs
        for (let i = this.morphBlobs.length - 1; i >= 0; i--) {
            const blob = this.morphBlobs[i];
            blob.life -= delta / blob.maxLife;
            blob.x += blob.vx;
            blob.y += blob.vy;
            blob.rotation += blob.rotationSpeed;
            blob.hue += blob.hueShift;

            // Morph blob points
            blob.points.forEach((point) => {
                const diff = point.targetRadius - point.radius;
                point.radius += diff * point.morphSpeed;

                // Set new target occasionally
                if (Math.abs(diff) < 5) {
                    point.targetRadius = blob.points[0].radius * 0.7 + (Math.random() - 0.5) * 60;
                }
            });

            if (blob.life <= 0) {
                this.morphBlobs.splice(i, 1);
            }
        }
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render dream ripples
        this.dreamRipples.forEach((ripple) => {
            const alpha = ripple.life * 0.6;
            ctx.strokeStyle = `hsla(${ripple.hue}, 70%, 65%, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `hsl(${ripple.hue}, 70%, 65%)`;

            // Draw wavy ripple
            ctx.beginPath();
            for (let angle = 0; angle <= Math.PI * 2; angle += 0.1) {
                const wave = Math.sin(angle * ripple.frequency + ripple.phase) * ripple.amplitude;
                const r = ripple.radius + wave;
                const x = ripple.x + Math.cos(angle) * r;
                const y = ripple.y + Math.sin(angle) * r;
                if (angle === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            ctx.stroke();
        });

        // Render iridescence waves
        this.iridescenceWaves.forEach((wave) => {
            const alpha = wave.life * 0.5;
            ctx.save();
            ctx.translate(wave.x, wave.y);
            ctx.rotate(wave.rotation);

            // Multiple colored rings
            for (let ring = 0; ring < 4; ring++) {
                const hue = (wave.hueOffset + ring * 90) % 360;
                const radius = wave.radius + ring * 15;
                ctx.strokeStyle = `hsla(${hue}, 80%, 70%, ${alpha * (1 - ring * 0.2)})`;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 25;
                ctx.shadowColor = `hsl(${hue}, 80%, 70%)`;
                ctx.beginPath();
                ctx.arc(0, 0, radius, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.restore();
        });

        // Render fluid streams
        this.fluidStreams.forEach((stream) => {
            const alpha = stream.life * 0.7;

            // Create gradient along path
            const gradient = ctx.createLinearGradient(
                stream.points[0].x,
                stream.points[0].y,
                stream.points[stream.points.length - 1].x,
                stream.points[stream.points.length - 1].y
            );

            for (let i = 0; i <= 5; i++) {
                const hue = (stream.hue + i * 60) % 360;
                gradient.addColorStop(i / 5, `hsl(${hue}, 75%, 65%)`);
            }

            ctx.strokeStyle = gradient;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = stream.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowBlur = 20;
            ctx.shadowColor = `hsl(${stream.hue}, 75%, 65%)`;

            ctx.beginPath();
            ctx.moveTo(stream.points[0].x, stream.points[0].y);
            for (let i = 1; i < stream.points.length; i++) {
                ctx.lineTo(stream.points[i].x, stream.points[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        });

        // Render liquid splashes
        this.liquidSplashes.forEach((p) => {
            const alpha = p.life;
            const shimmer = Math.sin(p.shimmer) * 0.3 + 0.7;
            const { h, s, l } = p.color;

            // Outer glow
            const glowGradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
            glowGradient.addColorStop(0, `hsla(${h}, ${s}%, ${l}%, ${alpha * shimmer * 0.6})`);
            glowGradient.addColorStop(0.5, `hsla(${h}, ${s}%, ${l}%, ${alpha * shimmer * 0.3})`);
            glowGradient.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`);

            ctx.fillStyle = glowGradient;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            ctx.fill();

            // Core
            const coreGradient = ctx.createRadialGradient(
                p.x - p.size * 0.3,
                p.y - p.size * 0.3,
                0,
                p.x,
                p.y,
                p.size
            );
            coreGradient.addColorStop(0, `hsla(${h}, ${s}%, ${Math.min(l + 20, 95)}%, ${alpha * shimmer})`);
            coreGradient.addColorStop(0.6, `hsla(${h}, ${s}%, ${l}%, ${alpha * shimmer * 0.8})`);
            coreGradient.addColorStop(1, `hsla(${h}, ${s}%, ${l - 10}%, ${alpha * shimmer * 0.5})`);

            ctx.fillStyle = coreGradient;
            ctx.shadowBlur = 15;
            ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        // Render prism bursts
        this.prismBursts.forEach((burst) => {
            const alpha = burst.life;
            ctx.save();
            ctx.translate(burst.x, burst.y);
            ctx.rotate(burst.rotation);

            burst.rays.forEach((ray) => {
                const length = ray.length + burst.expansion;
                ctx.strokeStyle = `hsla(${ray.hue}, 85%, 70%, ${alpha})`;
                ctx.lineWidth = ray.width;
                ctx.shadowBlur = 25;
                ctx.shadowColor = `hsl(${ray.hue}, 85%, 70%)`;
                ctx.lineCap = 'round';

                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(ray.angle) * length, Math.sin(ray.angle) * length);
                ctx.stroke();
            });

            ctx.restore();
        });

        // Render morph blobs
        this.morphBlobs.forEach((blob) => {
            const alpha = blob.life * 0.6;
            ctx.save();
            ctx.translate(blob.x, blob.y);
            ctx.rotate(blob.rotation);

            // Create blob path
            ctx.beginPath();
            for (let i = 0; i < blob.points.length; i++) {
                const point = blob.points[i];
                const nextPoint = blob.points[(i + 1) % blob.points.length];

                const x1 = Math.cos(point.angle) * point.radius;
                const y1 = Math.sin(point.angle) * point.radius;
                const x2 = Math.cos(nextPoint.angle) * nextPoint.radius;
                const y2 = Math.sin(nextPoint.angle) * nextPoint.radius;

                const cpAngle = point.angle + (nextPoint.angle - point.angle) / 2;
                const cpRadius = (point.radius + nextPoint.radius) / 2;
                const cpX = Math.cos(cpAngle) * cpRadius;
                const cpY = Math.sin(cpAngle) * cpRadius;

                if (i === 0) {
                    ctx.moveTo(x1, y1);
                }
                ctx.quadraticCurveTo(cpX, cpY, x2, y2);
            }
            ctx.closePath();

            // Fill with gradient
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, blob.points[0].radius * 1.5);
            gradient.addColorStop(0, `hsla(${blob.hue}, 75%, 75%, ${alpha})`);
            gradient.addColorStop(0.5, `hsla(${(blob.hue + 60) % 360}, 70%, 65%, ${alpha * 0.7})`);
            gradient.addColorStop(1, `hsla(${(blob.hue + 120) % 360}, 65%, 55%, ${alpha * 0.4})`);

            ctx.fillStyle = gradient;
            ctx.shadowBlur = 30;
            ctx.shadowColor = `hsl(${blob.hue}, 75%, 70%)`;
            ctx.fill();

            // Outline
            ctx.strokeStyle = `hsla(${blob.hue}, 80%, 85%, ${alpha * 0.8})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.restore();
        });

        // Reset shadow
        ctx.shadowBlur = 0;
    }

    stop() {
        this.stopEffectsLoop();
        super.stop();
    }

    cleanup() {
        this.cleanupEffects();
        super.cleanup();
    }

    cleanupEffects() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clear effect arrays
        this.liquidSplashes = [];
        this.iridescenceWaves = [];
        this.dreamRipples = [];
        this.fluidStreams = [];
        this.prismBursts = [];
        this.morphBlobs = [];

        // Stop animation loop
        this.stopEffectsLoop();

        // Remove canvas
        if (this.effectsCanvas) {
            this.effectsCanvas.remove();
            this.effectsCanvas = null;
            this.effectsCtx = null;
        }
    }
}

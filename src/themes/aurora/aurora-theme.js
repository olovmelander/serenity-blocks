import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { AURORA_TETROMINOS } from './aurora-tetrominos.js';

/**
 * Enhanced Aurora Theme - "Living Sky" Edition
 *
 * Features:
 * - Dynamic "Activity Cycle": Aurora grows, shrinks, fades, and intensifies organically over time.
 * - Varied Forms: Can be a subtle horizon glow, a medium curtain, or a massive full-screen storm.
 * - Deep Green/Emerald Palette with "Pit" capability.
 * - Extended Graphical Presets (Minimum to Extreme).
 */
export default class AuroraTheme extends BaseTheme {
    constructor() {
        super('aurora');

        // Core
        this.canvas = null;
        this.ctx = null;
        this.animationFrameId = null;
        this.isRunning = false;

        // Resources
        this.pillarTexture = null;

        // State
        this.width = 0;
        this.height = 0;
        this.time = 0;
        this.lastTime = 0;
        this.eventUnsubscribers = [];

        // Dynamic Activity State
        this.activityLevel = 0.5; // 0.0 to 1.0
        this.activityPhase = Math.random() * 1000;

        // Entities
        this.stars = [];
        this.shootingStars = [];

        // Graphics quality
        this.qualityChangeHandler = null;
        this.currentQuality = 'High';

        // Quality Presets
        this.qualityPresets = {
            Minimum: {
                starCount: 50,
                layerCount: 1,
                stripWidth: 100,
                overlap: 0.7,
                noiseDetail: 1,
                shootingStars: false,
            },
            Low: {
                starCount: 100,
                layerCount: 1,
                stripWidth: 90,
                overlap: 0.75,
                noiseDetail: 2,
                shootingStars: false,
            },
            Medium: {
                starCount: 200,
                layerCount: 2,
                stripWidth: 80,
                overlap: 0.8,
                noiseDetail: 2,
                shootingStars: true,
            },
            High: {
                starCount: 350,
                layerCount: 3,
                stripWidth: 65,
                overlap: 0.85,
                noiseDetail: 2,
                shootingStars: true,
            },
            Ultra: {
                starCount: 600,
                layerCount: 3,
                stripWidth: 50,
                overlap: 0.9,
                noiseDetail: 3,
                shootingStars: true,
            },
            Extreme: {
                starCount: 900,
                layerCount: 4,
                stripWidth: 50,
                overlap: 0.9,
                noiseDetail: 3,
                shootingStars: true,
            },
        };

        // Current Configuration
        this.config = {
            ...this.qualityPresets[this.currentQuality],
            baseSpeed: 0.0002,
            comboIntensity: 0,
            targetComboIntensity: 0,
        };
    }

    async createScene() {
        this.setupCanvas();
        this.createPillarTexture();
        this.initStars();

        // Apply quality preset and setup listener
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        this.setupEventListeners();

        this.isRunning = true;
        this.lastTime = performance.now();
        this.animate(this.lastTime);

        console.log(`[AuroraTheme] Living Sky scene initialized. Quality: ${this.currentQuality}`);
    }

    // Quality system methods
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[AuroraTheme] Unknown preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        const preset = this.qualityPresets[quality];
        Object.assign(this.config, preset);

        // Re-initialize stars if already created
        if (this.stars.length > 0) {
            this.initStars();
        }

        console.log(`[AuroraTheme] Applied ${quality} graphics preset`);
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;
            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    setupCanvas() {
        let container = this.getContainer('aurora-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'aurora-theme';
            this.registerContainer(container);
            const bgContainer = document.getElementById('background-container');
            if (bgContainer) bgContainer.appendChild(container);
            else document.body.appendChild(container);
        }

        container.innerHTML = '';
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        // Deep atmospheric background (Rich Deep Green/Black)
        this.canvas.style.background = 'radial-gradient(circle at 50% 100%, #082a18 0%, #000502 100%)';

        container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', () => this.resize(window.innerWidth, window.innerHeight));
    }

    createPillarTexture() {
        const height = 512;
        const width = 64;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const grad = ctx.createLinearGradient(0, height, 0, 0);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        // Deeper, richer green profile
        grad.addColorStop(0.1, 'rgba(0, 80, 40, 0)'); // Dark forest fade-in
        grad.addColorStop(0.25, 'rgba(0, 255, 110, 0.95)'); // Intense Neon Emerald
        grad.addColorStop(0.5, 'rgba(20, 180, 100, 0.8)'); // Rich Mid-Green
        grad.addColorStop(0.75, 'rgba(0, 120, 100, 0.4)'); // Deep Teal fade
        grad.addColorStop(1, 'rgba(0, 40, 60, 0)'); // Dark fade out

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // Horizontal Soft Falloff (Smoother Sine-like profile)
        const hGrad = ctx.createLinearGradient(0, 0, width, 0);
        hGrad.addColorStop(0, 'rgba(0,0,0,1)'); // Fully erased at edge
        hGrad.addColorStop(0.1, 'rgba(0,0,0,0.8)');
        hGrad.addColorStop(0.5, 'rgba(0,0,0,0)'); // Fully visible at center
        hGrad.addColorStop(0.9, 'rgba(0,0,0,0.8)');
        hGrad.addColorStop(1, 'rgba(0,0,0,1)'); // Fully erased at edge

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = hGrad;
        ctx.fillRect(0, 0, width, height);

        this.pillarTexture = canvas;
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        this.initStars();
    }

    initStars() {
        this.stars = [];
        for (let i = 0; i < this.config.starCount; i++) {
            this.stars.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                size: Math.random() * 1.5 + 0.2,
                baseAlpha: Math.random() * 0.6 + 0.1,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.003 + 0.001,
            });
        }
    }

    setupEventListeners() {
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            this.config.targetComboIntensity = Math.min(data.comboCount * 0.6, 4.0);
            if (data.comboCount >= 2 && this.config.shootingStars) {
                this.spawnShootingStar();
            }
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            this.config.targetComboIntensity += 0.4;
        });

        this.eventUnsubscribers.push(comboUnsub, lineClearUnsub);
    }

    spawnShootingStar() {
        this.shootingStars.push({
            x: Math.random() * this.width,
            y: Math.random() * this.height * 0.6,
            vx: -15 - Math.random() * 10,
            vy: 2 + Math.random() * 5,
            life: 1.0,
            trail: [],
        });
    }

    animate(timestamp) {
        if (!this.isRunning) return;

        const dt = timestamp - this.lastTime;
        this.lastTime = timestamp;
        this.time += dt;

        this.update(dt);
        this.render();

        this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
    }

    update(dt) {
        // 1. Update Activity Level
        const t = this.time * 0.0001 + this.activityPhase;
        let rawActivity = Math.sin(t) * 0.5 + Math.sin(t * 0.57) * 0.3 + Math.sin(t * 1.618) * 0.2;
        rawActivity = (rawActivity + 1) / 2;

        this.activityLevel += (rawActivity - this.activityLevel) * 0.01;

        // 2. Update Combo Intensity
        this.config.comboIntensity += (this.config.targetComboIntensity - this.config.comboIntensity) * 0.03;
        this.config.targetComboIntensity *= 0.98;

        // 3. Update Shooting Stars
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const s = this.shootingStars[i];
            s.x += s.vx;
            s.y += s.vy;
            s.life -= 0.015;
            s.trail.push({ x: s.x, y: s.y });
            if (s.trail.length > 15) s.trail.shift();
            if (s.life <= 0) this.shootingStars.splice(i, 1);
        }
    }

    render() {
        if (!this.ctx) return;
        const { ctx } = this;
        const w = this.width;
        const h = this.height;

        // Clear
        ctx.fillStyle = '#000502';
        ctx.fillRect(0, 0, w, h);

        // Stars
        ctx.fillStyle = 'white';
        for (const star of this.stars) {
            const twinkle = Math.sin(this.time * star.twinkleSpeed + star.twinklePhase);
            const alpha = star.baseAlpha + twinkle * 0.2;
            ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // Aurora Layers
        ctx.globalCompositeOperation = 'screen';

        const effectiveActivity = Math.min(1.2, this.activityLevel + this.config.comboIntensity * 0.2);

        if (effectiveActivity > 0.05) {
            const layers = [];
            const count = this.config.layerCount;

            for (let i = 0; i < count; i++) {
                const t = i / (count - 1 || 1);

                const yBase = 0.3 + t * 0.6;
                const yActivityOffset = effectiveActivity * 0.1;
                const y = h * (yBase + yActivityOffset);

                layers.push({
                    y,
                    speed: (0.5 + t * 0.6) * (0.5 + effectiveActivity * 1.5),
                    scale: (1.5 + t * 0.5) * effectiveActivity,
                    brightness: (0.2 + t * 0.3) * effectiveActivity,
                    offset: i * 2000,
                });
            }

            for (let i = 0; i < layers.length; i++) {
                this.renderOrganicLayer(ctx, layers[i], i);
            }
        }

        // Shooting Stars
        if (this.config.shootingStars) {
            ctx.globalCompositeOperation = 'lighter';
            for (const s of this.shootingStars) {
                if (s.trail.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(s.trail[0].x, s.trail[0].y);
                    for (const p of s.trail) ctx.lineTo(p.x, p.y);
                    ctx.strokeStyle = `rgba(200, 255, 220, ${s.life * 0.4})`;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
                ctx.fillStyle = `rgba(220, 255, 240, ${s.life})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
    }

    renderOrganicLayer(ctx, layer, index) {
        if (!this.pillarTexture) return;

        const t = this.time * this.config.baseSpeed * layer.speed;

        const { stripWidth } = this.config;
        const { overlap } = this.config;
        const step = stripWidth * (1 - overlap);

        // Extend rendering well beyond screen edges to prevent visible cutoffs
        // especially when strips are tilted or the curve moves
        const padding = Math.max(this.width * 0.2, 300);
        const startStep = -Math.ceil(padding / step);
        const endStep = Math.ceil((this.width + padding) / step);

        const detail = this.config.noiseDetail;

        const noise = (x, time) => {
            const xScaled = x * 0.0008;
            let val = Math.sin(xScaled * 1.0 + time) * 1.0;
            if (detail >= 2) val += Math.sin(xScaled * 2.3 - time * 0.8) * 0.5;
            if (detail >= 3) val += Math.sin(xScaled * 4.7 + time * 1.5) * 0.25;
            return val;
        };

        const intensityNoise = (x, time) => Math.sin(x * 0.0015 + time * 1.2) * 0.5
                + Math.sin(x * 0.004 - time * 0.5) * 0.3 + 0.5;

        for (let i = startStep; i < endStep; i++) {
            const x = i * step;

            const noiseVal = noise(x + layer.offset, t);
            const curveY = noiseVal * 150;

            const nextNoiseVal = noise(x + layer.offset + 10, t);
            const slope = (nextNoiseVal - noiseVal) * 10;

            const baseY = layer.y + curveY;

            const fold = intensityNoise(x + layer.offset, t);
            const foldIntensity = Math.max(0, fold);

            const comboBoost = this.config.comboIntensity * 0.15;

            let alpha = (layer.brightness + comboBoost) * foldIntensity;
            alpha = Math.min(0.85, alpha);

            if (alpha < 0.02) continue;

            const hScale = 1.2 + foldIntensity * 0.8 + this.config.comboIntensity * 0.2;
            const drawHeight = 600 * layer.scale * hScale;

            ctx.globalAlpha = alpha;

            const tilt = -0.15 + slope * 0.08;

            ctx.setTransform(1, 0, tilt, 1, x, baseY - drawHeight);
            ctx.drawImage(this.pillarTexture, 0, 0, stripWidth, drawHeight);
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();
        super.stop();
    }

    cleanup() {
        this.stop();
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
        this.pillarTexture = null;
        super.cleanup();
    }

    getTetrominoConfig() {
        return AURORA_TETROMINOS;
    }
}

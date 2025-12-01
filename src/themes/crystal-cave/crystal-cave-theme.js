/**
 * @fileoverview Crystal Cave Theme - Deep Underground Mystical Experience (Optimized)
 * 
 * Performance-optimized version featuring:
 * - Cached gradients and static elements
 * - Reduced particle counts
 * - Simplified blur effects using opacity
 * - Throttled effect spawning
 * - Batched drawing operations
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CRYSTAL_CAVE_TETROMINOS } from './crystal-cave-tetrominos.js';

export default class CrystalCaveTheme extends BaseTheme {
    constructor() {
        super('crystal-cave');
        this.canvas = null;
        this.ctx = null;
        this.animationFrameId = null;
        this.time = 0;
        this.frameCount = 0;

        // Color configuration
        this.config = {
            crystalCount: { far: 35, mid: 25, near: 15 },
            colors: {
                bgTop: '#010103',
                bgMid: '#050208',
                bgBottom: '#0a0312',
                mist: '#0d0520',
                water: '#0a1525',
                palettes: [
                    { main: '#8040c0', glow: '#c070ff', light: '#e8d0ff' },
                    { main: '#00a080', glow: '#40ffc0', light: '#c0fff0' },
                    { main: '#2060c0', glow: '#60a0ff', light: '#d0e8ff' },
                    { main: '#c04080', glow: '#ff70b0', light: '#ffd0e8' },
                    { main: '#c08020', glow: '#ffc040', light: '#fff0c0' },
                    { main: '#40a0a0', glow: '#60ffff', light: '#d0ffff' },
                ],
            },
        };

        // Visual state
        this.layers = [];
        this.particles = [];
        this.waterDrops = [];
        this.waterRipples = [];
        this.energyArcs = [];
        this.lightRays = [];
        this.stalactites = [];
        
        // Cached elements
        this.cachedBackground = null;
        this.cachedVignette = null;
        this.cachedStalactites = null;
        
        // Center collision sparkles (replaces orb)
        this.centerSparkles = [];
        this.centerBursts = [];
        
        this.resonance = 0;
        this.targetResonance = 0;
        this.waterLevel = 0;

        // Quality presets with enhanced visuals
        this.qualityPresets = {
            Minimal: {
                crystalCount: { far: 8, mid: 6, near: 4 },
                particleCount: 20,
                waterDropRate: 0.003,
                maxRipples: 2,
                stalactiteCount: 0,
                enableMistLayers: false,
                enableWaterReflections: false,
                enableLightRays: false,
                enableLockEffects: false,
                enableCrystalGlow: false,
                maxEnergyArcs: 2,
                maxLightRays: 0,
                skipFrames: 1,
            },
            Low: {
                crystalCount: { far: 12, mid: 8, near: 5 },
                particleCount: 35,
                waterDropRate: 0.005,
                maxRipples: 4,
                stalactiteCount: 4,
                enableMistLayers: false,
                enableWaterReflections: false,
                enableLightRays: false,
                enableLockEffects: true,
                enableCrystalGlow: true,
                maxEnergyArcs: 4,
                maxLightRays: 1,
                skipFrames: 0,
            },
            Medium: {
                crystalCount: { far: 16, mid: 10, near: 6 },
                particleCount: 50,
                waterDropRate: 0.008,
                maxRipples: 6,
                stalactiteCount: 6,
                enableMistLayers: true,
                enableWaterReflections: false,
                enableLightRays: true,
                enableLockEffects: true,
                enableCrystalGlow: true,
                maxEnergyArcs: 6,
                maxLightRays: 2,
                skipFrames: 0,
            },
            High: {
                crystalCount: { far: 22, mid: 14, near: 8 },
                particleCount: 70,
                waterDropRate: 0.012,
                maxRipples: 10,
                stalactiteCount: 10,
                enableMistLayers: true,
                enableWaterReflections: true,
                enableLightRays: true,
                enableLockEffects: true,
                enableCrystalGlow: true,
                maxEnergyArcs: 8,
                maxLightRays: 3,
                skipFrames: 0,
            },
            Ultra: {
                crystalCount: { far: 30, mid: 20, near: 10 },
                particleCount: 90,
                waterDropRate: 0.015,
                maxRipples: 14,
                stalactiteCount: 15,
                enableMistLayers: true,
                enableWaterReflections: true,
                enableLightRays: true,
                enableLockEffects: true,
                enableCrystalGlow: true,
                maxEnergyArcs: 12,
                maxLightRays: 4,
                skipFrames: 0,
            },
            Extreme: {
                crystalCount: { far: 40, mid: 26, near: 14 },
                particleCount: 120,
                waterDropRate: 0.02,
                maxRipples: 18,
                stalactiteCount: 22,
                enableMistLayers: true,
                enableWaterReflections: true,
                enableLightRays: true,
                enableLockEffects: true,
                enableCrystalGlow: true,
                maxEnergyArcs: 16,
                maxLightRays: 6,
                skipFrames: 0,
            },
        };

        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;
        this.eventUnsubscribers = [];
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) quality = 'High';
        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        this.config.crystalCount = this.activePreset.crystalCount;
    }

    setupQualityListener() {
        this.qualityChangeHandler = (event) => {
            if (event.detail?.effectQuality && event.detail.effectQuality !== this.currentQuality) {
                this.applyQualityPreset(event.detail.effectQuality);
                this.initElements();
                this.cacheStaticElements();
            }
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    async createScene() {
        this.applyQualityPreset(this.getGraphicsQuality());

        const themeContainer = document.getElementById('crystal-cave-theme');
        if (!themeContainer) return;

        let canvas = document.getElementById('crystal-cave-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'crystal-cave-canvas';
            Object.assign(canvas.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
            });
            themeContainer.appendChild(canvas);
        }
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        this.resizeHandler = () => this.resize();
        window.addEventListener('resize', this.resizeHandler);
        this.resize();

        this.setupEventListeners();
        this.setupQualityListener();
        this.animate();
    }

    resize() {
        if (!this.canvas) return;
        // Cap DPR for performance
        const dpr = Math.min(1.25, window.devicePixelRatio || 1);
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.ctx.scale(dpr, dpr);
        this.displayWidth = window.innerWidth;
        this.displayHeight = window.innerHeight;
        this.waterLevel = this.displayHeight * 0.85;
        this.initElements();
        this.cacheStaticElements();
    }

    cacheStaticElements() {
        // Cache background gradient
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = this.displayWidth;
        bgCanvas.height = this.displayHeight;
        const bgCtx = bgCanvas.getContext('2d');
        
        const grad = bgCtx.createLinearGradient(0, 0, 0, this.displayHeight);
        grad.addColorStop(0, this.config.colors.bgTop);
        grad.addColorStop(0.4, this.config.colors.bgMid);
        grad.addColorStop(0.7, this.config.colors.bgBottom);
        grad.addColorStop(1, this.config.colors.water);
        bgCtx.fillStyle = grad;
        bgCtx.fillRect(0, 0, this.displayWidth, this.displayHeight);
        this.cachedBackground = bgCanvas;

        // Cache vignette
        const vigCanvas = document.createElement('canvas');
        vigCanvas.width = this.displayWidth;
        vigCanvas.height = this.displayHeight;
        const vigCtx = vigCanvas.getContext('2d');
        
        const vignette = vigCtx.createRadialGradient(
            this.displayWidth / 2, this.displayHeight / 2, this.displayWidth * 0.25,
            this.displayWidth / 2, this.displayHeight / 2, this.displayWidth * 0.85
        );
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(0.6, 'rgba(0,0,0,0.3)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.7)');
        vigCtx.fillStyle = vignette;
        vigCtx.fillRect(0, 0, this.displayWidth, this.displayHeight);
        this.cachedVignette = vigCanvas;

        // Cache stalactites
        if (this.stalactites.length > 0) {
            const stalCanvas = document.createElement('canvas');
            stalCanvas.width = this.displayWidth;
            stalCanvas.height = 150; // Max stalactite height
            const stalCtx = stalCanvas.getContext('2d');
            
            this.stalactites.forEach((s) => {
                const grad = stalCtx.createLinearGradient(s.x, 0, s.x, s.length);
                grad.addColorStop(0, '#1a1025');
                grad.addColorStop(0.7, '#0d0815');
                grad.addColorStop(1, s.color.main);
                
                stalCtx.beginPath();
                stalCtx.moveTo(s.x - s.width / 2, 0);
                stalCtx.lineTo(s.x, s.length);
                stalCtx.lineTo(s.x + s.width / 2, 0);
                stalCtx.closePath();
                stalCtx.fillStyle = grad;
                stalCtx.fill();
            });
            this.cachedStalactites = stalCanvas;
        }
    }

    initElements() {
        this.layers = [];
        this.particles = [];
        this.waterDrops = [];
        this.waterRipples = [];
        this.stalactites = [];
        this.energyArcs = [];
        this.lightRays = [];
        this.centerSparkles = [];
        this.centerBursts = [];

        const preset = this.activePreset;

        // Create crystal layers - use opacity for depth instead of blur
        this.createLayer(preset.crystalCount.far, 0.25, 0.3, 0.015, 0.6);
        this.createLayer(preset.crystalCount.mid, 0.6, 0.65, 0.04, 0.3);
        this.createLayer(preset.crystalCount.near, 1.0, 0.85, 0.08, 0.1);

        // Ambient particles
        for (let i = 0; i < preset.particleCount; i++) {
            this.particles.push(this.createParticle(true));
        }

        // Stalactites
        if (preset.stalactiteCount > 0) {
            this.createStalactites();
        }
    }

    createLayer(count, scale, opacity, parallaxFactor, mistOpacity) {
        const crystals = [];
        const sides = ['top', 'bottom', 'left', 'right'];
        const countPerSide = Math.ceil(count / 4);

        sides.forEach((side) => {
            for (let i = 0; i < countPerSide; i++) {
                const t = (i + Math.random()) / countPerSide;
                crystals.push(this.generateCrystal(scale, opacity, side, t));
            }
        });

        this.layers.push({ crystals, parallaxFactor, zIndex: scale, mistOpacity });
    }

    generateCrystal(scaleBase, opacityBase, side, t) {
        const scale = scaleBase * (0.7 + Math.random() * 0.5);
        const thickness = (45 + Math.random() * 45) * scale;
        const length = (70 + Math.random() * 100) * scale;
        const palette = this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)];
        
        // Reduced cluster count for performance
        const clusterCount = Math.floor(Math.random() * 2);

        let x, y, rotation;

        if (side === 'top') {
            x = this.displayWidth * t;
            y = 0;
            rotation = (Math.random() - 0.5) * 0.3;
        } else if (side === 'bottom') {
            x = this.displayWidth * t;
            y = this.displayHeight;
            rotation = Math.PI + (Math.random() - 0.5) * 0.3;
        } else if (side === 'left') {
            x = 0;
            y = this.displayHeight * t;
            rotation = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
        } else {
            x = this.displayWidth;
            y = this.displayHeight * t;
            rotation = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
        }

        const cache = this.createCrystalCache(thickness, length, palette, clusterCount);

        return {
            x, y, side, rotation, length, cache,
            color: palette,
            opacity: opacityBase,
            pulsePhase: Math.random() * Math.PI * 2,
            flare: 0,
        };
    }

    createCrystalCache(w, h, palette, clusterCount) {
        const canvas = document.createElement('canvas');
        const pad = 50;
        const clusterWidth = w * 2;
        canvas.width = clusterWidth + pad * 2;
        canvas.height = h + pad * 2;
        const ctx = canvas.getContext('2d');

        const cx = canvas.width / 2;
        const cy = pad;

        // Draw secondary crystals (simplified)
        for (let i = 0; i < clusterCount; i++) {
            const offsetX = (Math.random() - 0.5) * w * 1.2;
            const smallScale = 0.4 + Math.random() * 0.3;
            ctx.save();
            ctx.translate(cx + offsetX, cy);
            ctx.rotate((Math.random() - 0.5) * 0.4);
            this.drawSimpleCrystal(ctx, 0, 0, w * smallScale, h * smallScale, palette, 0.6);
            ctx.restore();
        }

        // Main crystal
        this.drawSimpleCrystal(ctx, cx, cy, w, h, palette, 1.0);

        return canvas;
    }

    // Enhanced crystal drawing with more glow
    drawSimpleCrystal(ctx, cx, cy, w, h, palette, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;

        const facetWidth = w * 0.35;
        
        // Ambient light halo (drawn first, behind crystal)
        const haloGrad = ctx.createRadialGradient(cx, cy + h * 0.4, 0, cx, cy + h * 0.4, h * 0.8);
        haloGrad.addColorStop(0, `${palette.glow}50`);
        haloGrad.addColorStop(0.4, `${palette.glow}25`);
        haloGrad.addColorStop(0.7, `${palette.glow}10`);
        haloGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(cx, cy + h * 0.4, h * 0.8, 0, Math.PI * 2);
        ctx.fill();
        
        // Crystal shape
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy + h * 0.1);
        ctx.lineTo(cx - facetWidth, cy + h * 0.5);
        ctx.lineTo(cx - w * 0.12, cy + h * 0.85);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx + w * 0.12, cy + h * 0.82);
        ctx.lineTo(cx + facetWidth, cy + h * 0.45);
        ctx.lineTo(cx + w / 2, cy + h * 0.08);
        ctx.lineTo(cx + w * 0.2, cy);
        ctx.lineTo(cx - w * 0.2, cy);
        ctx.closePath();

        // Multi-layer glow for intense light
        ctx.shadowBlur = 45;
        ctx.shadowColor = palette.glow;
        ctx.fillStyle = palette.main;
        ctx.fill();
        // Second pass for more glow
        ctx.shadowBlur = 25;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Internal gradient with brighter core
        const innerGrad = ctx.createRadialGradient(
            cx - w * 0.1, cy + h * 0.12, 0,
            cx, cy + h * 0.45, h * 0.65
        );
        innerGrad.addColorStop(0, '#ffffff');
        innerGrad.addColorStop(0.15, palette.light);
        innerGrad.addColorStop(0.35, palette.glow);
        innerGrad.addColorStop(0.55, palette.main);
        innerGrad.addColorStop(1, '#050210');
        ctx.fillStyle = innerGrad;
        ctx.fill();

        // Left facet highlight
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy + h * 0.1);
        ctx.lineTo(cx - facetWidth, cy + h * 0.5);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx - w * 0.2, cy);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fill();

        // Right facet shadow
        ctx.beginPath();
        ctx.moveTo(cx + w / 2, cy + h * 0.08);
        ctx.lineTo(cx + facetWidth, cy + h * 0.45);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx + w * 0.2, cy);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 0, 20, 0.35)';
        ctx.fill();

        // Center ridge
        ctx.beginPath();
        ctx.moveTo(cx, cy + h * 0.05);
        ctx.lineTo(cx, cy + h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Top highlight
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.2, cy);
        ctx.lineTo(cx + w * 0.2, cy);
        ctx.lineTo(cx, cy + h * 0.06);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();

        // Edge rim
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy + h * 0.1);
        ctx.lineTo(cx - facetWidth, cy + h * 0.5);
        ctx.lineTo(cx - w * 0.12, cy + h * 0.85);
        ctx.strokeStyle = palette.glow;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.restore();
    }

    createStalactites() {
        const count = this.activePreset.stalactiteCount;
        for (let i = 0; i < count; i++) {
            const x = (i / count) * this.displayWidth + (Math.random() - 0.5) * (this.displayWidth / count);
            this.stalactites.push({
                x,
                length: 25 + Math.random() * 80,
                width: 6 + Math.random() * 12,
                color: this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)],
            });
        }
    }

    createParticle(isAmbient = false, x, y) {
        const colors = ['#ffffff', '#c0a0ff', '#a0ffc0', '#80c0ff'];
        return {
            x: x ?? Math.random() * this.displayWidth,
            y: y ?? Math.random() * this.displayHeight,
            vx: (Math.random() - 0.5) * (isAmbient ? 0.25 : 2.5),
            vy: (Math.random() - 0.5) * (isAmbient ? 0.25 : 2.5) + (isAmbient ? -0.08 : 0),
            size: Math.random() * (isAmbient ? 2 : 3),
            life: 1.0,
            decay: isAmbient ? 0.002 : 0.02,
            color: isAmbient ? colors[Math.floor(Math.random() * colors.length)] : this.config.colors.palettes[Math.floor(Math.random() * 6)].glow,
            isAmbient,
        };
    }

    createWaterRipple(x, y) {
        return {
            x, y,
            radius: 2,
            maxRadius: 25 + Math.random() * 30,
            life: 1.0,
            speed: 0.6 + Math.random() * 0.3,
        };
    }

    setupEventListeners() {
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (settings?.backgroundComboEffects !== false) {
                this.triggerComboEffect(data.comboCount || data.count || 1);
            }
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (settings?.backgroundComboEffects !== false) {
                this.triggerLineClearEffect(data.lineCount || 1);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (settings?.backgroundComboEffects !== false) {
                this.triggerPieceLockEffect();
            }
        });

        this.eventUnsubscribers.push(comboUnsub, lineClearUnsub, pieceLockUnsub);
    }

    triggerPieceLockEffect() {
        if (!this.activePreset.enableLockEffects) return;

        // Strong resonance pulse for impact feel
        this.targetResonance = Math.min(this.targetResonance + 0.25, 0.6);

        const layers = [this.layers[0], this.layers[1], this.layers[2]];
        const crystals = layers.flatMap((l) => l?.crystals || []);
        
        // === CRYSTAL FLASH WAVE ===
        // Flash 4-7 crystals with high intensity
        const flashCount = 4 + Math.floor(Math.random() * 4);
        const flashedCrystals = [];
        
        for (let i = 0; i < flashCount && crystals.length > 0; i++) {
            const crystal = crystals[Math.floor(Math.random() * crystals.length)];
            crystal.flare = 0.5 + Math.random() * 0.4; // Higher intensity
            flashedCrystals.push(crystal);
        }

        // === SHOCKWAVE RINGS ===
        // Create expanding shockwave from center
        const palette = this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)];
        
        // Primary shockwave
        this.centerBursts.push({
            x: this.displayWidth / 2,
            y: this.displayHeight / 2,
            radius: 10,
            maxRadius: 120 + Math.random() * 60,
            life: 0.85,
            color: palette.glow,
            speed: 3,
        });
        
        // Secondary delayed shockwave (smaller)
        this.centerBursts.push({
            x: this.displayWidth / 2,
            y: this.displayHeight / 2,
            radius: 5,
            maxRadius: 70 + Math.random() * 40,
            life: 0.7,
            color: '#ffffff',
            speed: 2,
        });

        // === SPARKLE EXPLOSION FROM CENTER ===
        const centerSparkleCount = 12 + Math.floor(Math.random() * 8);
        for (let i = 0; i < centerSparkleCount; i++) {
            const angle = (i / centerSparkleCount) * Math.PI * 2 + Math.random() * 0.4;
            const speed = 2 + Math.random() * 4;
            const sparkleColor = this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)];
            
            this.centerSparkles.push({
                x: this.displayWidth / 2 + (Math.random() - 0.5) * 20,
                y: this.displayHeight / 2 + (Math.random() - 0.5) * 20,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * 2.5,
                life: 1.0,
                decay: 0.015 + Math.random() * 0.01,
                color: sparkleColor.glow,
                trail: [],
            });
        }

        // White hot core sparkles
        for (let i = 0; i < 6; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 2;
            this.centerSparkles.push({
                x: this.displayWidth / 2,
                y: this.displayHeight / 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 3 + Math.random() * 2,
                life: 1.0,
                decay: 0.025,
                color: '#ffffff',
                trail: [],
            });
        }

        // === EDGE PARTICLE BURSTS ===
        // Spawn particles at all four edges
        const edgeSparkleCount = 8 + Math.floor(Math.random() * 6);
        for (let i = 0; i < edgeSparkleCount; i++) {
            const edge = Math.floor(Math.random() * 4);
            let x, y, vx, vy;
            
            if (edge === 0) { // top - particles fall down
                x = Math.random() * this.displayWidth;
                y = Math.random() * 30;
                vx = (Math.random() - 0.5) * 2;
                vy = 1 + Math.random() * 2;
            } else if (edge === 1) { // bottom - particles rise up
                x = Math.random() * this.displayWidth;
                y = this.displayHeight - Math.random() * 30;
                vx = (Math.random() - 0.5) * 2;
                vy = -(1 + Math.random() * 2);
            } else if (edge === 2) { // left - particles go right
                x = Math.random() * 30;
                y = Math.random() * this.displayHeight;
                vx = 1 + Math.random() * 2;
                vy = (Math.random() - 0.5) * 2;
            } else { // right - particles go left
                x = this.displayWidth - Math.random() * 30;
                y = Math.random() * this.displayHeight;
                vx = -(1 + Math.random() * 2);
                vy = (Math.random() - 0.5) * 2;
            }
            
            const particleColor = this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)];
            this.particles.push({
                x, y, vx, vy,
                size: 2 + Math.random() * 2,
                life: 1.0,
                decay: 0.02,
                color: particleColor.glow,
                isAmbient: false,
            });
        }

        // === CRYSTAL TIP SPARKLE BURSTS ===
        // Spawn sparkles from 2-3 random crystal tips
        const crystalBurstCount = 2 + Math.floor(Math.random() * 2);
        for (let b = 0; b < crystalBurstCount && crystals.length > 0; b++) {
            const crystal = crystals[Math.floor(Math.random() * crystals.length)];
            let tipX = crystal.x, tipY = crystal.y;
            
            if (crystal.side === 'top') tipY += crystal.length * 0.7;
            else if (crystal.side === 'bottom') tipY -= crystal.length * 0.7;
            else if (crystal.side === 'left') tipX += crystal.length * 0.7;
            else tipX -= crystal.length * 0.7;
            
            // Sparkle burst from crystal tip
            const tipSparkles = 6 + Math.floor(Math.random() * 4);
            for (let s = 0; s < tipSparkles; s++) {
                const angle = (s / tipSparkles) * Math.PI * 2 + Math.random() * 0.5;
                const speed = 1.5 + Math.random() * 3;
                
                this.centerSparkles.push({
                    x: tipX + (Math.random() - 0.5) * 10,
                    y: tipY + (Math.random() - 0.5) * 10,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 1.5 + Math.random() * 2,
                    life: 0.9,
                    decay: 0.02 + Math.random() * 0.015,
                    color: crystal.color.glow,
                    trail: [],
                });
            }
        }

        // === LIGHT RAY FLASH ===
        // Chance for a quick light ray
        if (Math.random() < 0.3 && this.activePreset.enableLightRays) {
            this.lightRays.push({
                x: this.displayWidth * 0.2 + Math.random() * this.displayWidth * 0.6,
                width: 25 + Math.random() * 35,
                color: palette.glow,
                life: 0.5,
                angle: (Math.random() - 0.5) * 0.2,
            });
        }
    }

    triggerLineClearEffect(lineCount) {
        this.targetResonance = Math.min(this.targetResonance + 0.15 + lineCount * 0.08, 1.2);

        const rippleCount = Math.min(lineCount, Math.floor(this.activePreset.maxRipples / 2));
        for (let i = 0; i < rippleCount; i++) {
            if (this.waterRipples.length < this.activePreset.maxRipples) {
                const x = this.displayWidth * 0.2 + Math.random() * this.displayWidth * 0.6;
                this.waterRipples.push(this.createWaterRipple(x, this.waterLevel));
            }
        }

        if (lineCount >= 4 && this.activePreset.enableLightRays) {
            this.triggerLightRays(2);
        }
    }

    triggerComboEffect(count) {
        this.targetResonance = Math.min(this.targetResonance + 0.3 + count * 0.08, 2.5);

        const layers = [this.layers[1], this.layers[2]];
        const crystals = layers.flatMap((l) => l?.crystals || []);

        const activationCount = Math.min(count + 2, 8);
        const arcsCreated = [];
        
        for (let i = 0; i < activationCount; i++) {
            if (crystals.length === 0) break;
            const crystal = crystals[Math.floor(Math.random() * crystals.length)];
            crystal.flare = 0.8;

            // Energy arc - longer reaching from crystal tips
            if (this.energyArcs.length < this.activePreset.maxEnergyArcs) {
                let sx = crystal.x, sy = crystal.y;
                // Start arc from crystal tip
                if (crystal.side === 'top') sy += crystal.length * 0.9;
                else if (crystal.side === 'bottom') sy -= crystal.length * 0.9;
                else if (crystal.side === 'left') sx += crystal.length * 0.9;
                else sx -= crystal.length * 0.9;

                this.energyArcs.push({
                    sx, sy,
                    ex: this.displayWidth / 2,
                    ey: this.displayHeight / 2,
                    color: crystal.color.glow,
                    life: 1.0,
                    width: 3 + Math.random() * 3, // Thicker beams
                });
                arcsCreated.push(crystal.color);
            }

            // Reduced particle burst at crystal
            for (let p = 0; p < 3; p++) {
                let px = crystal.x, py = crystal.y;
                if (crystal.side === 'top') py += crystal.length * 0.6;
                else if (crystal.side === 'bottom') py -= crystal.length * 0.6;
                else if (crystal.side === 'left') px += crystal.length * 0.6;
                else px -= crystal.length * 0.6;
                this.particles.push(this.createParticle(false, px, py));
            }
        }

        // Trigger center collision burst when energy arcs are created
        if (arcsCreated.length > 0) {
            this.triggerCenterBurst(arcsCreated, count);
        }

        if (count >= 5 && this.activePreset.enableLightRays) {
            this.triggerLightRays(Math.min(count - 3, this.activePreset.maxLightRays));
        }

        const rippleCount = Math.min(count, Math.floor(this.activePreset.maxRipples / 3));
        for (let i = 0; i < rippleCount; i++) {
            if (this.waterRipples.length < this.activePreset.maxRipples) {
                const x = this.displayWidth * 0.15 + Math.random() * this.displayWidth * 0.7;
                this.waterRipples.push(this.createWaterRipple(x, this.waterLevel));
            }
        }
    }

    triggerLightRays(count) {
        for (let i = 0; i < count; i++) {
            if (this.lightRays.length >= this.activePreset.maxLightRays * 2) break;
            const palette = this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)];
            this.lightRays.push({
                x: this.displayWidth * 0.1 + Math.random() * this.displayWidth * 0.8,
                width: 15 + Math.random() * 30,
                color: palette.glow,
                life: 1.0,
                angle: (Math.random() - 0.5) * 0.15,
            });
        }
    }

    triggerCenterBurst(colors, comboCount) {
        const cx = this.displayWidth / 2;
        const cy = this.displayHeight / 2;
        
        // Create expanding burst ring
        this.centerBursts.push({
            x: cx,
            y: cy,
            radius: 5,
            maxRadius: 60 + comboCount * 15,
            life: 1.0,
            color: colors[0]?.glow || '#c070ff',
            speed: 2 + comboCount * 0.5,
        });

        // Spawn sparkles radiating outward from center
        const sparkleCount = Math.min(8 + comboCount * 3, 25);
        for (let i = 0; i < sparkleCount; i++) {
            const angle = (i / sparkleCount) * Math.PI * 2 + Math.random() * 0.3;
            const speed = 2 + Math.random() * 4 + comboCount * 0.5;
            const palette = colors[Math.floor(Math.random() * colors.length)] || this.config.colors.palettes[0];
            
            this.centerSparkles.push({
                x: cx + (Math.random() - 0.5) * 10,
                y: cy + (Math.random() - 0.5) * 10,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * 3,
                life: 1.0,
                decay: 0.015 + Math.random() * 0.01,
                color: palette.glow || palette,
                trail: [],
            });
        }

        // Extra bright core sparkles
        const coreCount = Math.min(4 + comboCount, 12);
        for (let i = 0; i < coreCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 2;
            
            this.centerSparkles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 3 + Math.random() * 2,
                life: 1.0,
                decay: 0.02,
                color: '#ffffff',
                trail: [],
            });
        }
    }

    animate() {
        if (!this.canvas || !this.isActive) return;

        this.frameCount++;
        this.time += 0.016;
        
        // Smooth resonance
        this.resonance += (this.targetResonance - this.resonance) * 0.05;
        this.targetResonance *= 0.96;
        if (this.resonance < 0.01) this.resonance = 0;

        // Skip water drops on minimal preset
        if (this.activePreset.skipFrames === 0 || this.frameCount % 2 === 0) {
            this.updateWaterDrops();
            
            if (Math.random() < this.activePreset.waterDropRate && this.stalactites.length > 0) {
                const s = this.stalactites[Math.floor(Math.random() * this.stalactites.length)];
                if (this.waterDrops.length < 10) {
                    this.waterDrops.push({ x: s.x, y: s.length, vy: 0, gravity: 0.12, size: 2 + Math.random(), alpha: 0.8 });
                }
            }
        }

        // Draw scene with cached elements
        if (this.cachedBackground) {
            this.ctx.drawImage(this.cachedBackground, 0, 0);
        }

        // Enhanced ambient glow with pulsing effect
        if (this.resonance > 0.05) {
            const pulseGlow = Math.sin(this.time * 4) * 0.02 + 0.98;
            const glowIntensity = this.resonance * 0.1 * pulseGlow;
            
            // Center radial glow
            const cx = this.displayWidth / 2;
            const cy = this.displayHeight / 2;
            const glowGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.displayWidth * 0.5);
            glowGrad.addColorStop(0, `rgba(140, 80, 220, ${glowIntensity * 0.8})`);
            glowGrad.addColorStop(0.5, `rgba(100, 50, 180, ${glowIntensity * 0.4})`);
            glowGrad.addColorStop(1, 'transparent');
            this.ctx.fillStyle = glowGrad;
            this.ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
            
            // Screen flash on high resonance
            if (this.resonance > 0.8) {
                const flashIntensity = (this.resonance - 0.8) * 0.3;
                this.ctx.fillStyle = `rgba(200, 150, 255, ${flashIntensity})`;
                this.ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
            }
        }

        if (this.activePreset.enableLightRays) {
            this.drawLightRays();
        }

        if (this.cachedStalactites) {
            this.ctx.drawImage(this.cachedStalactites, 0, 0);
        }

        this.drawLayers();
        this.drawWaterPool();
        this.drawWaterDrops();
        this.drawWaterRipples();
        this.drawParticles();
        this.drawEnergyArcs();
        this.drawCenterEffects();

        if (this.activePreset.enableMistLayers) {
            this.drawMistLayers();
        }

        if (this.cachedVignette) {
            this.ctx.drawImage(this.cachedVignette, 0, 0);
        }

        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    updateWaterDrops() {
        for (let i = this.waterDrops.length - 1; i >= 0; i--) {
            const drop = this.waterDrops[i];
            drop.vy += drop.gravity;
            drop.y += drop.vy;

            if (drop.y >= this.waterLevel) {
                if (this.waterRipples.length < this.activePreset.maxRipples) {
                    this.waterRipples.push(this.createWaterRipple(drop.x, this.waterLevel));
                }
                this.waterDrops.splice(i, 1);
            }
        }
    }

    drawLayers() {
        const drift = Math.sin(this.time * 0.12) * 12;
        // Resonance-based shake intensity
        const shakeIntensity = this.resonance * 6;

        this.layers.forEach((layer) => {
            // Use opacity for depth instead of expensive blur filter
            const depthOpacity = layer.zIndex < 0.5 ? 0.55 : 1;
            
            layer.crystals.forEach((c) => {
                const pulse = (Math.sin(this.time * 0.5 + c.pulsePhase) + 1) / 2;
                const flare = c.flare || 0;
                
                // Shake effect when resonance is high
                const shakeX = shakeIntensity > 0.1 ? (Math.random() - 0.5) * shakeIntensity : 0;
                const shakeY = shakeIntensity > 0.1 ? (Math.random() - 0.5) * shakeIntensity * 0.5 : 0;

                // Calculate crystal tip position for ambient glow
                let tipX = c.x, tipY = c.y;
                if (c.side === 'top') tipY += c.length * 0.6;
                else if (c.side === 'bottom') tipY -= c.length * 0.6;
                else if (c.side === 'left') tipX += c.length * 0.6;
                else tipX -= c.length * 0.6;

                // Draw ambient light glow from crystal (before crystal itself)
                if (this.activePreset.enableCrystalGlow) {
                    const glowSize = c.length * (0.4 + pulse * 0.15 + flare * 0.3);
                    const glowAlpha = (0.08 + pulse * 0.04 + flare * 0.15) * c.opacity * depthOpacity;
                    
                    this.ctx.globalCompositeOperation = 'screen';
                    const ambientGlow = this.ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, glowSize);
                    ambientGlow.addColorStop(0, `${c.color.glow}${Math.floor(glowAlpha * 255).toString(16).padStart(2, '0')}`);
                    ambientGlow.addColorStop(0.5, `${c.color.glow}${Math.floor(glowAlpha * 0.4 * 255).toString(16).padStart(2, '0')}`);
                    ambientGlow.addColorStop(1, 'transparent');
                    this.ctx.fillStyle = ambientGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(tipX, tipY, glowSize, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.globalCompositeOperation = 'source-over';
                }

                this.ctx.save();
                this.ctx.translate(c.x + drift * layer.parallaxFactor + shakeX, c.y + shakeY);
                this.ctx.rotate(c.rotation);

                const pad = 50;
                this.ctx.globalAlpha = c.opacity * depthOpacity * (0.9 + pulse * 0.1);
                this.ctx.drawImage(c.cache, -c.cache.width / 2, -pad);

                // Glow overlay for pulsing and flare effects
                if (this.activePreset.enableCrystalGlow && (flare > 0.03 || pulse > 0.4 || this.resonance > 0.08)) {
                    this.ctx.globalCompositeOperation = 'screen';
                    this.ctx.globalAlpha = Math.min((this.resonance * 0.3 + pulse * 0.2 + flare * 0.5) * c.opacity, 0.75);
                    this.ctx.drawImage(c.cache, -c.cache.width / 2, -pad);
                    
                    // Extra intense glow when flaring
                    if (flare > 0.25) {
                        this.ctx.globalCompositeOperation = 'lighter';
                        this.ctx.globalAlpha = flare * 0.35;
                        this.ctx.drawImage(c.cache, -c.cache.width / 2, -pad);
                    }
                }

                if (c.flare > 0) c.flare *= 0.88;

                this.ctx.restore();
            });

            // Mist layer with resonance effect
            if (layer.mistOpacity > 0 && this.activePreset.enableMistLayers) {
                const mistAlpha = layer.mistOpacity * 0.35 + this.resonance * 0.05;
                this.ctx.fillStyle = `rgba(13, 5, 32, ${mistAlpha})`;
                this.ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);
            }
        });
    }

    drawWaterPool() {
        // Simplified water - single gradient, no per-frame creation
        this.ctx.fillStyle = 'rgba(8, 20, 40, 0.7)';
        this.ctx.fillRect(0, this.waterLevel - 5, this.displayWidth, this.displayHeight - this.waterLevel + 5);

        // Simple shimmer line
        const shimmer = Math.sin(this.time * 1.5) * 0.2 + 0.5;
        this.ctx.strokeStyle = `rgba(80, 150, 220, ${shimmer * 0.25})`;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.waterLevel);
        this.ctx.lineTo(this.displayWidth, this.waterLevel);
        this.ctx.stroke();

        // Reflections (simplified)
        if (this.activePreset.enableWaterReflections && this.resonance > 0.15) {
            this.ctx.fillStyle = `rgba(120, 80, 200, ${this.resonance * 0.08})`;
            this.ctx.fillRect(0, this.waterLevel, this.displayWidth, this.displayHeight - this.waterLevel);
        }
    }

    drawWaterDrops() {
        this.ctx.fillStyle = 'rgba(150, 200, 255, 0.8)';
        this.waterDrops.forEach((drop) => {
            this.ctx.beginPath();
            this.ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawWaterRipples() {
        for (let i = this.waterRipples.length - 1; i >= 0; i--) {
            const ripple = this.waterRipples[i];
            ripple.radius += ripple.speed;
            ripple.life -= 0.02;

            if (ripple.life <= 0 || ripple.radius > ripple.maxRadius) {
                this.waterRipples.splice(i, 1);
                continue;
            }

            this.ctx.beginPath();
            this.ctx.ellipse(ripple.x, ripple.y, ripple.radius, ripple.radius * 0.25, 0, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(120, 180, 230, ${ripple.life * 0.4})`;
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();
        }
    }

    drawLightRays() {
        for (let i = this.lightRays.length - 1; i >= 0; i--) {
            const ray = this.lightRays[i];
            ray.life -= 0.01;

            if (ray.life <= 0) {
                this.lightRays.splice(i, 1);
                continue;
            }

            this.ctx.save();
            this.ctx.translate(ray.x, 0);
            this.ctx.rotate(ray.angle);
            this.ctx.fillStyle = `${ray.color}${Math.floor(ray.life * 25).toString(16).padStart(2, '0')}`;
            this.ctx.fillRect(-ray.width / 2, 0, ray.width, this.displayHeight);
            this.ctx.restore();
        }
    }

    drawParticles() {
        this.ctx.globalCompositeOperation = 'screen';
        
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;

            if (p.isAmbient) {
                if (p.life < 0) p.life = 1;
                if (p.x < 0) p.x = this.displayWidth;
                if (p.x > this.displayWidth) p.x = 0;
                if (p.y < 0) p.y = this.displayHeight;
                if (p.y > this.displayHeight) p.y = 0;
            } else if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.life * (p.isAmbient ? 0.3 : 0.8);
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
    }

    drawCenterEffects() {
        // Draw expanding burst rings
        for (let i = this.centerBursts.length - 1; i >= 0; i--) {
            const burst = this.centerBursts[i];
            burst.radius += burst.speed;
            burst.life -= 0.025;

            if (burst.life <= 0 || burst.radius > burst.maxRadius) {
                this.centerBursts.splice(i, 1);
                continue;
            }

            // Outer ring
            this.ctx.beginPath();
            this.ctx.arc(burst.x, burst.y, burst.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = `${burst.color}${Math.floor(burst.life * 180).toString(16).padStart(2, '0')}`;
            this.ctx.lineWidth = 3 + burst.life * 4;
            this.ctx.stroke();

            // Inner glow ring
            this.ctx.beginPath();
            this.ctx.arc(burst.x, burst.y, burst.radius * 0.7, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${burst.life * 0.4})`;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Center flash (only at start)
            if (burst.life > 0.8) {
                const flashAlpha = (burst.life - 0.8) * 5;
                const flashGrad = this.ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, 40);
                flashGrad.addColorStop(0, `rgba(255, 255, 255, ${flashAlpha * 0.8})`);
                flashGrad.addColorStop(0.3, `${burst.color}${Math.floor(flashAlpha * 150).toString(16).padStart(2, '0')}`);
                flashGrad.addColorStop(1, 'transparent');
                this.ctx.fillStyle = flashGrad;
                this.ctx.beginPath();
                this.ctx.arc(burst.x, burst.y, 40, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }

        // Draw center sparkles with trails
        this.ctx.globalCompositeOperation = 'screen';
        
        for (let i = this.centerSparkles.length - 1; i >= 0; i--) {
            const s = this.centerSparkles[i];
            
            // Store trail position
            if (s.trail.length < 6) {
                s.trail.push({ x: s.x, y: s.y });
            } else {
                s.trail.shift();
                s.trail.push({ x: s.x, y: s.y });
            }

            // Update position
            s.x += s.vx;
            s.y += s.vy;
            s.vx *= 0.98; // Slight drag
            s.vy *= 0.98;
            s.life -= s.decay;

            if (s.life <= 0) {
                this.centerSparkles.splice(i, 1);
                continue;
            }

            // Draw trail
            if (s.trail.length > 1) {
                this.ctx.beginPath();
                this.ctx.moveTo(s.trail[0].x, s.trail[0].y);
                for (let t = 1; t < s.trail.length; t++) {
                    this.ctx.lineTo(s.trail[t].x, s.trail[t].y);
                }
                this.ctx.lineTo(s.x, s.y);
                this.ctx.strokeStyle = `${s.color}${Math.floor(s.life * 100).toString(16).padStart(2, '0')}`;
                this.ctx.lineWidth = s.size * 0.5;
                this.ctx.stroke();
            }

            // Draw sparkle head
            this.ctx.fillStyle = s.color;
            this.ctx.globalAlpha = s.life;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            this.ctx.fill();

            // Bright core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = s.life * 0.8;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, s.size * 0.4, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
    }

    drawEnergyArcs() {
        if (this.energyArcs.length === 0) return;
        
        this.ctx.globalCompositeOperation = 'screen';
        
        for (let i = this.energyArcs.length - 1; i >= 0; i--) {
            const arc = this.energyArcs[i];
            arc.life -= 0.025; // Slower decay = longer beams
            
            if (arc.life <= 0) {
                this.energyArcs.splice(i, 1);
                continue;
            }

            // Calculate arc points with jagged lightning effect
            const points = [{ x: arc.sx, y: arc.sy }];
            const segments = 8; // More segments for smoother lightning
            
            for (let j = 1; j <= segments; j++) {
                const t = j / segments;
                const tx = arc.sx + (arc.ex - arc.sx) * t;
                const ty = arc.sy + (arc.ey - arc.sy) * t;
                // Jitter decreases toward the end for cleaner center impact
                const jitterAmount = 35 * arc.life * (1 - t * 0.5);
                const jitterX = (Math.random() - 0.5) * jitterAmount;
                const jitterY = (Math.random() - 0.5) * jitterAmount;
                points.push({ x: tx + jitterX, y: ty + jitterY });
            }

            // Outer glow (wider, more transparent)
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let p = 1; p < points.length; p++) {
                this.ctx.lineTo(points[p].x, points[p].y);
            }
            this.ctx.strokeStyle = `${arc.color}60`;
            this.ctx.lineWidth = (arc.width + 6) * arc.life;
            this.ctx.lineCap = 'round';
            this.ctx.stroke();

            // Middle glow
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let p = 1; p < points.length; p++) {
                this.ctx.lineTo(points[p].x, points[p].y);
            }
            this.ctx.strokeStyle = `${arc.color}a0`;
            this.ctx.lineWidth = (arc.width + 2) * arc.life;
            this.ctx.stroke();

            // Core (bright center)
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let p = 1; p < points.length; p++) {
                this.ctx.lineTo(points[p].x, points[p].y);
            }
            this.ctx.strokeStyle = arc.color;
            this.ctx.lineWidth = arc.width * arc.life;
            this.ctx.stroke();

            // White hot core
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let p = 1; p < points.length; p++) {
                this.ctx.lineTo(points[p].x, points[p].y);
            }
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${arc.life * 0.6})`;
            this.ctx.lineWidth = Math.max(1, (arc.width - 1) * arc.life * 0.5);
            this.ctx.stroke();
        }
        
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.lineCap = 'butt';
    }

    drawMistLayers() {
        // Single simplified mist layer
        this.ctx.fillStyle = `rgba(15, 8, 30, ${0.25 + this.resonance * 0.08})`;
        this.ctx.fillRect(0, this.displayHeight * 0.65, this.displayWidth, this.displayHeight * 0.35);

        this.ctx.fillStyle = `rgba(10, 5, 25, ${0.3 + this.resonance * 0.05})`;
        this.ctx.fillRect(0, 0, this.displayWidth, this.displayHeight * 0.25);
    }

    stop() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        if (this.qualityChangeHandler) window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        
        this.eventUnsubscribers.forEach((u) => u());
        this.eventUnsubscribers = [];
        
        this.layers = [];
        this.particles = [];
        this.waterDrops = [];
        this.waterRipples = [];
        this.energyArcs = [];
        this.lightRays = [];
        this.stalactites = [];
        this.centerSparkles = [];
        this.centerBursts = [];
        this.cachedBackground = null;
        this.cachedVignette = null;
        this.cachedStalactites = null;
        
        super.stop();
    }

    getTetrominoConfig() {
        return CRYSTAL_CAVE_TETROMINOS;
    }
}

/**
 * @fileoverview Geode Theme - Deep Underground Crystal Cavern
 * 
 * An immersive journey into a mystical geode cavern featuring:
 * - Luminous crystal clusters with intense inner glow
 * - Deep atmospheric cave environment
 * - Flowing mist and ethereal light rays
 * - Dynamic piece lock and combo effects
 * - Crystal resonance energy effects
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { GEODE_TETROMINOS } from './geode-tetrominos.js';

export default class GeodeTheme extends BaseTheme {
    constructor() {
        super('geode');
        this.canvas = null;
        this.ctx = null;
        this.animationTime = 0;

        // Cave structure elements
        this.crystalClusters = [];
        this.caveWalls = [];
        this.stalactites = [];
        this.stalagmites = [];
        this.caveFloor = [];
        this.rockFormations = [];

        // Atmospheric elements
        this.dustParticles = [];
        this.lightRays = [];
        this.ambientGlows = [];
        this.mist = [];
        this.floatingSparkles = [];

        // Gameplay reactive elements
        this.energyPulses = [];
        this.crystalResonance = [];
        this.floorRipples = [];
        this.lockSparkles = [];
        this.lockBursts = [];

        // Visual state
        this.comboMultiplier = 1.0;
        this.pulseIntensity = 0.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        this.crystalShakeIntensity = 0;
        this.ambientPulse = 0;

        // Cached gradients and textures
        this.cachedGradients = {};
        this.cachedCrystals = new Map(); // Cache crystal textures

        // Event tracking
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
        
        // Performance: throttle frame updates
        this.frameSkip = 0;

        // Crystal color palettes - more vibrant
        this.crystalPalettes = [
            { hues: [280, 290, 270], saturation: 75, lightness: [45, 55, 40], name: 'amethyst', glow: '#c070ff' },
            { hues: [190, 200, 180], saturation: 80, lightness: [50, 60, 45], name: 'aquamarine', glow: '#60ffff' },
            { hues: [340, 350, 330], saturation: 70, lightness: [50, 58, 45], name: 'rose-quartz', glow: '#ff80c0' },
            { hues: [265, 275, 255], saturation: 65, lightness: [40, 50, 35], name: 'deep-purple', glow: '#a060ff' },
            { hues: [160, 170, 150], saturation: 80, lightness: [45, 55, 40], name: 'emerald', glow: '#50ffa0' },
            { hues: [220, 230, 210], saturation: 75, lightness: [48, 58, 43], name: 'sapphire', glow: '#6090ff' },
        ];

        this.qualityPresets = {
            Minimal: {
                wallCount: 2,
                stalagmiteCount: 3,
                mistCount: 2,
                crystalClusterCount: 6,
                ambientGlowCount: 0,
                maxDustParticles: 10,
                maxLightRays: 1,
                maxEnergyPulses: 3,
                maxSparkles: 15,
                enableLockEffects: false,
                enableEnhancedGlow: false,
                enableInternalSparkles: false,
            },
            Low: {
                wallCount: 3,
                stalagmiteCount: 4,
                mistCount: 2,
                crystalClusterCount: 8,
                ambientGlowCount: 2,
                maxDustParticles: 15,
                maxLightRays: 2,
                maxEnergyPulses: 4,
                maxSparkles: 25,
                enableLockEffects: true,
                enableEnhancedGlow: false,
                enableInternalSparkles: false,
            },
            Medium: {
                wallCount: 4,
                stalagmiteCount: 5,
                mistCount: 3,
                crystalClusterCount: 12,
                ambientGlowCount: 3,
                maxDustParticles: 22,
                maxLightRays: 3,
                maxEnergyPulses: 6,
                maxSparkles: 35,
                enableLockEffects: true,
                enableEnhancedGlow: true,
                enableInternalSparkles: false,
            },
            High: {
                wallCount: 5,
                stalagmiteCount: 7,
                mistCount: 4,
                crystalClusterCount: 16,
                ambientGlowCount: 4,
                maxDustParticles: 30,
                maxLightRays: 4,
                maxEnergyPulses: 8,
                maxSparkles: 50,
                enableLockEffects: true,
                enableEnhancedGlow: true,
                enableInternalSparkles: true,
            },
            Ultra: {
                wallCount: 6,
                stalagmiteCount: 9,
                mistCount: 6,
                crystalClusterCount: 20,
                ambientGlowCount: 5,
                maxDustParticles: 40,
                maxLightRays: 5,
                maxEnergyPulses: 12,
                maxSparkles: 65,
                enableLockEffects: true,
                enableEnhancedGlow: true,
                enableInternalSparkles: true,
            },
            Extreme: {
                wallCount: 8,
                stalagmiteCount: 12,
                mistCount: 8,
                crystalClusterCount: 26,
                ambientGlowCount: 6,
                maxDustParticles: 55,
                maxLightRays: 7,
                maxEnergyPulses: 16,
                maxSparkles: 85,
                enableLockEffects: true,
                enableEnhancedGlow: true,
                enableInternalSparkles: true,
            },
        };
        
        this.currentQuality = 'Medium';
        this.activePreset = this.qualityPresets.Medium;
    }

    applyQualityPreset(quality) {
        const preset = this.qualityPresets[quality] ?? this.qualityPresets.Medium;
        this.currentQuality = quality in this.qualityPresets ? quality : 'Medium';
        this.activePreset = preset;
        console.log(`💎 Geode: Applied ${this.currentQuality} quality preset`);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'Medium';
    }

    async createScene() {
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        const themeContainer = document.getElementById('geode-theme');
        this.canvas = document.getElementById('geode-canvas');

        if (!this.canvas && themeContainer) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'geode-canvas';
            Object.assign(this.canvas.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: '1',
            });
            themeContainer.appendChild(this.canvas);
        }

        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Clear all existing elements
        this.clearAllElements();
        this.cacheGradients();

        // Initialize scene elements
        this.createCaveStructure();
        this.createCaveFloor();
        this.createRockFormations();
        this.createStalagmites();
        this.createCrystalClusters();
        this.createMist();
        this.createDustParticles();
        this.createLightRays();
        this.createAmbientGlows();
        this.createFloatingSparkles();

        this.setupEventListeners();
        this.animate();
    }

    clearAllElements() {
        this.crystalClusters = [];
        this.caveWalls = [];
        this.stalactites = [];
        this.stalagmites = [];
        this.caveFloor = [];
        this.rockFormations = [];
        this.dustParticles = [];
        this.lightRays = [];
        this.ambientGlows = [];
        this.mist = [];
        this.floatingSparkles = [];
        this.energyPulses = [];
        this.crystalResonance = [];
        this.floorRipples = [];
        this.lockSparkles = [];
        this.lockBursts = [];
    }

    cacheGradients() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        // Deep cave background - darker and more atmospheric
        const bgGradient = this.ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w / 2, h / 2, Math.max(w, h) * 0.8);
        bgGradient.addColorStop(0, '#0c0515');
        bgGradient.addColorStop(0.3, '#08030f');
        bgGradient.addColorStop(0.6, '#050208');
        bgGradient.addColorStop(1, '#020104');
        this.cachedGradients.background = bgGradient;

        // Vignette
        const vignette = this.ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.9);
        vignette.addColorStop(0, 'transparent');
        vignette.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
        this.cachedGradients.vignette = vignette;
    }

    createCaveStructure() {
        const preset = this.activePreset;
        
        // Cave walls
        for (let i = 0; i < preset.wallCount; i++) {
            const side = i < preset.wallCount / 2 ? 'left' : 'right';
            const x = side === 'left' 
                ? Math.random() * this.canvas.width * 0.12 
                : this.canvas.width * 0.88 + Math.random() * this.canvas.width * 0.12;
            
            this.caveWalls.push({
                x, baseX: x,
                y: Math.random() * this.canvas.height,
                width: 80 + Math.random() * 120,
                height: 150 + Math.random() * 250,
                side,
                roughness: 10 + Math.random() * 20,
                baseRoughness: 10 + Math.random() * 20,
                hue: 260 + Math.random() * 25,
                breathPhase: Math.random() * Math.PI * 2,
                breathSpeed: 0.0002 + Math.random() * 0.0002,
                breathAmplitude: 3 + Math.random() * 8,
            });
        }

    }

    createCaveFloor() {
        const segments = 20;
        for (let i = 0; i < segments; i++) {
            this.caveFloor.push({
                x: (this.canvas.width / segments) * i,
                y: this.canvas.height * 0.88 + (Math.random() - 0.5) * 30,
                baseY: this.canvas.height * 0.88 + (Math.random() - 0.5) * 30,
                width: this.canvas.width / segments + 5,
                roughness: 8 + Math.random() * 15,
                hue: 265 + Math.random() * 15,
                breathPhase: Math.random() * Math.PI * 2,
                breathSpeed: 0.0001 + Math.random() * 0.0001,
                breathAmplitude: 2 + Math.random() * 3,
            });
        }
    }

    createRockFormations() {
        const count = 25;
        for (let i = 0; i < count; i++) {
            const isFloor = Math.random() > 0.25;
            this.rockFormations.push({
                x: Math.random() * this.canvas.width,
                y: isFloor 
                    ? this.canvas.height * 0.82 + Math.random() * this.canvas.height * 0.15
                    : Math.random() * this.canvas.height * 0.65,
                baseX: 0, baseY: 0,
                width: 30 + Math.random() * 70,
                height: (30 + Math.random() * 70) * (0.6 + Math.random() * 0.4),
                hue: 260 + Math.random() * 25,
                roughness: 5 + Math.random() * 12,
                isFloor,
                floatPhase: Math.random() * Math.PI * 2,
                floatSpeed: 0.00005 + Math.random() * 0.0001,
                floatAmplitude: 1 + Math.random() * 2,
            });
        }
        // Set base positions
        this.rockFormations.forEach(r => { r.baseX = r.x; r.baseY = r.y; });
    }

    createStalagmites() {
        const preset = this.activePreset;
        for (let i = 0; i < preset.stalagmiteCount; i++) {
            const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
            this.stalagmites.push({
                x: Math.random() * this.canvas.width,
                baseX: Math.random() * this.canvas.width,
                y: this.canvas.height,
                height: 60 + Math.random() * 140,
                width: 15 + Math.random() * 40,
                hue: palette.hues[0],
                palette,
                glowIntensity: 0.5 + Math.random() * 0.4,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: 0.0001 + Math.random() * 0.0003,
                swayAmplitude: 3 + Math.random() * 10,
            });
        }
        this.stalagmites.forEach(s => { s.baseX = s.x; });
    }

    createCrystalClusters() {
        const preset = this.activePreset;
        
        for (let i = 0; i < preset.crystalClusterCount; i++) {
            const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
            const x = Math.random() * this.canvas.width;
            const y = Math.random() * this.canvas.height;
            const size = 50 + Math.random() * 80; // Smaller clusters
            const crystalCount = 2 + Math.floor(Math.random() * 3); // 2-4 crystals

            const crystals = [];
            for (let j = 0; j < crystalCount; j++) {
                const angle = (Math.random() * Math.PI * 0.8) - Math.PI / 2 - Math.PI * 0.15;
                const height = size * (0.5 + Math.random() * 0.55);
                const width = height * (0.18 + Math.random() * 0.12);
                const hue = palette.hues[Math.floor(Math.random() * palette.hues.length)];

                const crystal = {
                    offsetX: (Math.random() - 0.5) * size * 0.6,
                    offsetY: (Math.random() - 0.5) * size * 0.4,
                    baseOffsetX: 0, baseOffsetY: 0,
                    width, height,
                    angle, baseAngle: angle,
                    hue,
                    saturation: palette.saturation,
                    glowIntensity: 0.8 + Math.random() * 0.4,
                    wobblePhase: Math.random() * Math.PI * 2,
                    wobbleSpeed: 0.0002 + Math.random() * 0.0003,
                    wobbleAmount: 0.01 + Math.random() * 0.025,
                    cache: null, // Will store cached texture
                };
                
                // Pre-render crystal to cache
                crystal.cache = this.createCrystalCache(crystal);
                crystals.push(crystal);
            }
            crystals.forEach(c => { c.baseOffsetX = c.offsetX; c.baseOffsetY = c.offsetY; });

            this.crystalClusters.push({
                x, y, baseX: x, baseY: y,
                size, crystals,
                palette,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.015 + Math.random() * 0.015,
                baseGlow: 0.6 + Math.random() * 0.4,
                glowIntensity: 1.0,
                flare: 0,
                floatPhase: Math.random() * Math.PI * 2,
                floatSpeedX: 0.0003 + Math.random() * 0.0004,
                floatSpeedY: 0.0005 + Math.random() * 0.0005,
                floatAmplitudeX: 8 + Math.random() * 15,
                floatAmplitudeY: 10 + Math.random() * 20,
                rotationPhase: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.0002,
                rotationAmount: (Math.random() - 0.5) * 0.06,
            });
        }
    }

    // Cache crystal texture to offscreen canvas (HUGE performance boost)
    createCrystalCache(crystal) {
        const w = crystal.width;
        const h = crystal.height;
        const hue = crystal.hue;
        const sat = crystal.saturation;
        
        // Create offscreen canvas with minimal padding
        const padding = Math.max(w, h) * 0.3;
        const cacheCanvas = document.createElement('canvas');
        cacheCanvas.width = w + padding * 2;
        cacheCanvas.height = h + padding * 2;
        const ctx = cacheCanvas.getContext('2d');
        
        ctx.translate(cacheCanvas.width / 2, cacheCanvas.height - padding * 0.5);
        
        const facetW = w * 0.38;

        // === HEXAGONAL PRISM CRYSTAL SHAPE ===
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(-facetW * 0.6, -h * 0.75);
        ctx.lineTo(-w / 2, -h * 0.5);
        ctx.lineTo(-w / 2, h * 0.05);
        ctx.lineTo(-w * 0.3, h * 0.12);
        ctx.lineTo(0, h * 0.15);
        ctx.lineTo(w * 0.3, h * 0.12);
        ctx.lineTo(w / 2, h * 0.05);
        ctx.lineTo(w / 2, -h * 0.5);
        ctx.lineTo(facetW * 0.6, -h * 0.75);
        ctx.closePath();

        // Internal gradient
        const innerGrad = ctx.createLinearGradient(0, -h, 0, h * 0.15);
        innerGrad.addColorStop(0, `hsla(${hue}, ${sat + 10}%, 75%, 1)`);
        innerGrad.addColorStop(0.15, `hsla(${hue}, ${sat}%, 60%, 0.98)`);
        innerGrad.addColorStop(0.4, `hsla(${hue}, ${sat}%, 45%, 0.95)`);
        innerGrad.addColorStop(0.7, `hsla(${hue}, ${sat - 5}%, 30%, 0.9)`);
        innerGrad.addColorStop(1, `hsla(${hue}, ${sat - 10}%, 18%, 0.85)`);
        ctx.fillStyle = innerGrad;
        ctx.fill();

        // Left bright facet
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(-facetW * 0.6, -h * 0.75);
        ctx.lineTo(-w / 2, -h * 0.5);
        ctx.lineTo(-w / 2, h * 0.05);
        ctx.lineTo(-w * 0.1, -h * 0.2);
        ctx.closePath();
        const leftGrad = ctx.createLinearGradient(-w / 2, -h * 0.5, 0, -h * 0.3);
        leftGrad.addColorStop(0, `hsla(${hue}, ${sat - 10}%, 85%, 0.5)`);
        leftGrad.addColorStop(0.5, `hsla(${hue}, ${sat}%, 70%, 0.3)`);
        leftGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = leftGrad;
        ctx.fill();

        // Right dark facet
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(facetW * 0.6, -h * 0.75);
        ctx.lineTo(w / 2, -h * 0.5);
        ctx.lineTo(w / 2, h * 0.05);
        ctx.lineTo(w * 0.1, -h * 0.2);
        ctx.closePath();
        ctx.fillStyle = `hsla(${hue + 10}, ${sat - 20}%, 12%, 0.5)`;
        ctx.fill();

        // Center ridge
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(0, h * 0.15);
        const ridgeGrad = ctx.createLinearGradient(0, -h, 0, h * 0.15);
        ridgeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        ridgeGrad.addColorStop(0.3, `hsla(${hue}, ${sat}%, 80%, 0.4)`);
        ridgeGrad.addColorStop(0.7, `hsla(${hue}, ${sat}%, 60%, 0.15)`);
        ridgeGrad.addColorStop(1, 'transparent');
        ctx.strokeStyle = ridgeGrad;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Top cap highlight
        ctx.beginPath();
        ctx.moveTo(-facetW * 0.5, -h * 0.78);
        ctx.lineTo(0, -h);
        ctx.lineTo(facetW * 0.5, -h * 0.78);
        ctx.lineTo(0, -h * 0.7);
        ctx.closePath();
        const topGrad = ctx.createLinearGradient(0, -h, 0, -h * 0.7);
        topGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        topGrad.addColorStop(1, `hsla(${hue}, ${sat}%, 80%, 0.2)`);
        ctx.fillStyle = topGrad;
        ctx.fill();

        // Edge rim light
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h * 0.5);
        ctx.lineTo(-w / 2, h * 0.05);
        ctx.lineTo(-w * 0.3, h * 0.12);
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, 70%, 0.4)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        return {
            canvas: cacheCanvas,
            width: cacheCanvas.width,
            height: cacheCanvas.height,
        };
    }

    createMist() {
        const preset = this.activePreset;
        for (let i = 0; i < preset.mistCount; i++) {
            this.mist.push({
                x: Math.random() * this.canvas.width,
                baseX: Math.random() * this.canvas.width,
                y: this.canvas.height * 0.65 + Math.random() * this.canvas.height * 0.3,
                width: 200 + Math.random() * 400,
                height: 50 + Math.random() * 100,
                opacity: 0.06 + Math.random() * 0.1,
                hue: 270 + Math.random() * 30,
                driftPhase: Math.random() * Math.PI * 2,
                driftSpeed: 0.0001 + Math.random() * 0.0002,
                driftAmplitude: 30 + Math.random() * 50,
            });
        }
    }

    createDustParticles() {
        const preset = this.activePreset;
        for (let i = 0; i < preset.maxDustParticles; i++) {
            this.dustParticles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.25,
                vy: (Math.random() - 0.5) * 0.25,
                size: 0.5 + Math.random() * 2.5,
                opacity: 0.2 + Math.random() * 0.4,
                hue: 260 + Math.random() * 60,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.02 + Math.random() * 0.03,
            });
        }
    }

    createLightRays() {
        const preset = this.activePreset;
        for (let i = 0; i < preset.maxLightRays; i++) {
            const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
            this.lightRays.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.5,
                angle: Math.random() * Math.PI * 2,
                length: this.canvas.height * (0.3 + Math.random() * 0.6),
                width: 1 + Math.random() * 3,
                hue: palette.hues[0],
                opacity: 0.08 + Math.random() * 0.15,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.008 + Math.random() * 0.015,
                rotationSpeed: (Math.random() - 0.5) * 0.0005,
            });
        }
    }

    createAmbientGlows() {
        const preset = this.activePreset;
        for (let i = 0; i < preset.ambientGlowCount; i++) {
            const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
            this.ambientGlows.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                baseX: 0, baseY: 0,
                radius: 100 + Math.random() * 250,
                hue: palette.hues[0],
                opacity: 0.05 + Math.random() * 0.12,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.008 + Math.random() * 0.012,
                driftPhase: Math.random() * Math.PI * 2,
                driftSpeed: 0.0002 + Math.random() * 0.0002,
                driftAmplitude: 20 + Math.random() * 40,
            });
        }
        this.ambientGlows.forEach(g => { g.baseX = g.x; g.baseY = g.y; });
    }

    createFloatingSparkles() {
        const preset = this.activePreset;
        for (let i = 0; i < preset.maxSparkles; i++) {
            const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
            this.floatingSparkles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -0.1 - Math.random() * 0.3,
                size: 1 + Math.random() * 2,
                color: palette.glow,
                opacity: 0.3 + Math.random() * 0.5,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.05 + Math.random() * 0.08,
            });
        }
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.handlePieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);

        window.addEventListener('resize', () => {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.cacheGradients();
        });
    }

    handlePieceLock() {
        if (!this.activePreset.enableLockEffects) return;

        // Pulse intensity
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.18, 0.5);
        this.crystalShakeIntensity = Math.min(this.crystalShakeIntensity + 0.1, 0.35);

        // Flash multiple crystals and spawn sparkles from them
        const flashCount = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < flashCount && this.crystalClusters.length > 0; i++) {
            const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
            cluster.flare = 0.5 + Math.random() * 0.3;
            cluster.glowIntensity = Math.min(cluster.glowIntensity + 0.4, 2.5);
            
            // Spawn sparkles from this crystal
            const sparkleCount = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < sparkleCount; j++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 1.5 + Math.random() * 2.5;
                
                this.lockSparkles.push({
                    x: cluster.x + (Math.random() - 0.5) * 20,
                    y: cluster.y + (Math.random() - 0.5) * 20,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 1.5 + Math.random() * 2,
                    color: cluster.palette.glow,
                    life: 1.0,
                    decay: 0.018 + Math.random() * 0.012,
                });
            }
        }
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        this.onCombo(comboCount);
    }

    onLineClear(lineCount, comboCount = 0) {
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.4 * lineCount, 2.0);

        // Make crystals glow and spawn sparkles
        this.crystalClusters.forEach((cluster) => {
            cluster.glowIntensity = Math.min(cluster.glowIntensity + 0.5, 3.0);
            cluster.flare = Math.min(cluster.flare + 0.4, 1.0);
        });

        this.crystalShakeIntensity = Math.min(this.crystalShakeIntensity + 0.25 * (1 + comboCount * 0.3), 1.2);

        // Sparkles from crystals on line clear
        const crystalSparkleCount = Math.min(lineCount * 2 + 2, 8);
        for (let c = 0; c < crystalSparkleCount && this.crystalClusters.length > 0; c++) {
            const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
            const sparkles = 3 + lineCount * 2;
            
            for (let i = 0; i < sparkles; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 1 + Math.random() * 3;
                
                this.lockSparkles.push({
                    x: cluster.x + (Math.random() - 0.5) * 25,
                    y: cluster.y + (Math.random() - 0.5) * 25,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 1.5 + Math.random() * 2,
                    color: cluster.palette.glow,
                    life: 1.0,
                    decay: 0.016 + Math.random() * 0.01,
                });
            }
        }

        // Energy pulses from crystals
        const pulseCount = Math.min(lineCount + 1, 4);
        for (let p = 0; p < pulseCount; p++) {
            if (this.energyPulses.length < this.activePreset.maxEnergyPulses && this.crystalClusters.length > 0) {
                const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
                this.energyPulses.push({
                    x: cluster.x,
                    y: cluster.y,
                    radius: 10,
                    maxRadius: 150 + lineCount * 50,
                    opacity: 0.6,
                    hue: cluster.crystals[0].hue,
                    growthRate: 3 + lineCount * 0.5,
                });

                // Floor ripple
                this.floorRipples.push({
                    x: cluster.x,
                    y: this.canvas.height * 0.88,
                    radius: 0,
                    maxRadius: 200 + lineCount * 50,
                    opacity: 0.4,
                    hue: cluster.crystals[0].hue,
                    growthRate: 4 + lineCount * 0.6,
                });
            }
        }

        // Tetris = light rays
        if (lineCount >= 4) {
            for (let i = 0; i < 3; i++) {
                const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
                this.lightRays.push({
                    x: this.canvas.width * 0.2 + Math.random() * this.canvas.width * 0.6,
                    y: 0,
                    angle: Math.PI / 2 + (Math.random() - 0.5) * 0.3,
                    length: this.canvas.height,
                    width: 4 + Math.random() * 4,
                    hue: palette.hues[0],
                    opacity: 0.4,
                    pulsePhase: 0,
                    pulseSpeed: 0,
                    rotationSpeed: 0,
                    temporary: true,
                    life: 1.0,
                });
            }
        }
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 3.0);
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.6 * comboCount, 2.5);

        // Screen shake
        if (comboCount >= 5) {
            this.screenShake.intensity = Math.min(8 + (comboCount - 5) * 2.5, 18);
            if (comboCount >= 7) {
                this.chromaticAberration = Math.min(5 + (comboCount - 7) * 1.5, 12);
            }
        } else if (comboCount >= 3) {
            this.screenShake.intensity = Math.min(3 + comboCount * 0.8, 7);
        }

        // Crystal resonance beams
        if (comboCount >= 2) {
            const beamCount = Math.min(comboCount, 5);
            for (let i = 0; i < beamCount; i++) {
                if (this.crystalResonance.length < 12 && this.crystalClusters.length >= 2) {
                    const c1 = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
                    const c2 = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];

                    if (c1 !== c2) {
                        this.crystalResonance.push({
                            x1: c1.x, y1: c1.y,
                            x2: c2.x, y2: c2.y,
                            opacity: 0.6 + comboCount * 0.06,
                            hue: c1.crystals[0].hue,
                            life: 1.0,
                            decay: 0.012,
                            width: 2.5 + comboCount * 0.4,
                        });
                    }
                }
            }
        }

        // Sparkles from crystals during combos
        if (comboCount >= 2 && this.crystalClusters.length > 0) {
            // Spawn sparkles from multiple crystals
            const crystalBurstCount = Math.min(comboCount + 2, 6);
            for (let c = 0; c < crystalBurstCount; c++) {
                const cluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
                const sparkleCount = 4 + comboCount * 2;
                
                for (let i = 0; i < sparkleCount; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 1.5 + Math.random() * 3;
                    
                    this.lockSparkles.push({
                        x: cluster.x + (Math.random() - 0.5) * 30,
                        y: cluster.y + (Math.random() - 0.5) * 30,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        size: 1.5 + Math.random() * 2.5,
                        color: cluster.palette.glow,
                        life: 1.0,
                        decay: 0.015 + Math.random() * 0.01,
                    });
                }
            }
        }

        // Big combo center sparkle burst (for very high combos)
        if (comboCount >= 5) {
            const burstCount = 10 + comboCount * 2;
            for (let i = 0; i < burstCount; i++) {
                const angle = (i / burstCount) * Math.PI * 2;
                const speed = 2 + Math.random() * 4;
                const palette = this.crystalPalettes[Math.floor(Math.random() * this.crystalPalettes.length)];
                
                this.lockSparkles.push({
                    x: this.canvas.width / 2,
                    y: this.canvas.height / 2,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 2 + Math.random() * 3,
                    color: palette.glow,
                    life: 1.0,
                    decay: 0.012,
                });
            }
        }
    }

    animate() {
        if (!this.isActive || !this.ctx || !this.canvas) return;

        this.animationTime += 0.016;
        this.ambientPulse = Math.sin(this.animationTime * 0.5) * 0.1 + 0.9;

        // Decay effects
        this.pulseIntensity *= 0.98;
        if (this.pulseIntensity < 0.01) this.pulseIntensity = 0;
        
        this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.008);
        
        this.screenShake.intensity *= 0.9;
        if (this.screenShake.intensity < 0.1) this.screenShake.intensity = 0;
        
        this.chromaticAberration *= 0.92;
        if (this.chromaticAberration < 0.1) this.chromaticAberration = 0;
        
        this.crystalShakeIntensity *= 0.94;
        if (this.crystalShakeIntensity < 0.03) this.crystalShakeIntensity = 0;

        // Screen shake
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity * 2;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity * 2;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        this.updateMovements();

        // Draw
        this.ctx.save();
        if (this.screenShake.intensity > 0) {
            this.ctx.translate(this.screenShake.x, this.screenShake.y);
        }

        this.drawBackground();
        this.drawCaveWalls();
        this.drawCaveFloor();
        this.drawFloorRipples();
        this.drawAmbientGlows();
        this.drawLightRays();
        this.drawRockFormations();
        this.drawMist();
        this.drawFloatingSparkles();
        this.drawDustParticles();
        this.drawStalagmites();
        this.drawCrystalClusters();
        this.drawEnergyPulses();
        this.drawCrystalResonance();
        this.drawLockEffects();
        this.drawVignette();

        this.ctx.restore();

        if (this.chromaticAberration > 0) {
            this.drawChromaticAberration();
        }

        this.registerAnimation(requestAnimationFrame(() => this.animate()));
    }

    updateMovements() {
        // Crystal clusters
        this.crystalClusters.forEach((cluster) => {
            cluster.floatPhase += cluster.floatSpeedX;
            cluster.x = cluster.baseX + Math.sin(cluster.floatPhase) * cluster.floatAmplitudeX;
            cluster.y = cluster.baseY + Math.sin(cluster.floatPhase * 1.3) * cluster.floatAmplitudeY;
            cluster.rotationPhase += cluster.rotationSpeed;

            cluster.crystals.forEach((crystal) => {
                crystal.wobblePhase += crystal.wobbleSpeed;
                crystal.angle = crystal.baseAngle + Math.sin(crystal.wobblePhase) * crystal.wobbleAmount;
            });

            // Decay flare
            if (cluster.flare > 0) cluster.flare *= 0.92;
        });

        // Stalagmites
        this.stalagmites.forEach((s) => {
            s.swayPhase += s.swaySpeed;
            s.x = s.baseX + Math.sin(s.swayPhase) * s.swayAmplitude;
        });

        // Cave walls
        this.caveWalls.forEach((wall) => {
            wall.breathPhase += wall.breathSpeed;
            wall.roughness = wall.baseRoughness + Math.sin(wall.breathPhase) * wall.breathAmplitude;
            wall.x = wall.baseX + Math.sin(wall.breathPhase) * 3;
        });

        // Light rays
        this.lightRays.forEach((ray) => {
            ray.angle += ray.rotationSpeed * 0.3;
        });

        // Ambient glows
        this.ambientGlows.forEach((glow) => {
            glow.driftPhase += glow.driftSpeed;
            glow.x = glow.baseX + Math.sin(glow.driftPhase) * glow.driftAmplitude;
            glow.y = glow.baseY + Math.cos(glow.driftPhase * 0.7) * glow.driftAmplitude * 0.6;
        });

        // Mist
        this.mist.forEach((m) => {
            m.driftPhase += m.driftSpeed;
            m.x = m.baseX + Math.sin(m.driftPhase) * m.driftAmplitude;
        });

        // Rock formations
        this.rockFormations.forEach((rock) => {
            rock.floatPhase += rock.floatSpeed;
            rock.y = rock.baseY + Math.sin(rock.floatPhase) * rock.floatAmplitude;
        });

        // Cave floor
        this.caveFloor.forEach((segment) => {
            segment.breathPhase += segment.breathSpeed;
            segment.y = segment.baseY + Math.sin(segment.breathPhase) * segment.breathAmplitude;
        });

        // Floating sparkles
        this.floatingSparkles.forEach((s) => {
            s.x += s.vx;
            s.y += s.vy;
            s.twinklePhase += s.twinkleSpeed;

            // Wrap
            if (s.y < -10) s.y = this.canvas.height + 10;
            if (s.x < -10) s.x = this.canvas.width + 10;
            if (s.x > this.canvas.width + 10) s.x = -10;
        });
    }

    drawBackground() {
        if (this.cachedGradients.background) {
            this.ctx.fillStyle = this.cachedGradients.background;
        } else {
            this.ctx.fillStyle = '#050208';
        }
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Ambient pulse glow
        if (this.pulseIntensity > 0.05) {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            const glowGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.canvas.width * 0.5);
            glowGrad.addColorStop(0, `rgba(150, 80, 220, ${this.pulseIntensity * 0.08})`);
            glowGrad.addColorStop(0.5, `rgba(100, 50, 180, ${this.pulseIntensity * 0.04})`);
            glowGrad.addColorStop(1, 'transparent');
            this.ctx.fillStyle = glowGrad;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    drawVignette() {
        if (this.cachedGradients.vignette) {
            this.ctx.fillStyle = this.cachedGradients.vignette;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    drawCaveWalls() {
        this.caveWalls.forEach((wall) => {
            this.ctx.save();
            this.ctx.beginPath();
            
            const segments = 10;
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const xOffset = (wall.side === 'left' ? 1 : -1) * Math.sin(t * Math.PI) * wall.roughness;
                const x = wall.x + xOffset;
                const y = wall.y - wall.height / 2 + t * wall.height;

                if (i === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }

            const gradient = this.ctx.createLinearGradient(wall.x - 60, wall.y, wall.x + 60, wall.y);
            gradient.addColorStop(0, `hsla(${wall.hue}, 18%, 8%, 0.25)`);
            gradient.addColorStop(0.5, `hsla(${wall.hue}, 22%, 12%, 0.45)`);
            gradient.addColorStop(1, `hsla(${wall.hue}, 18%, 8%, 0.25)`);

            this.ctx.fillStyle = gradient;
            this.ctx.fill();
            this.ctx.restore();
        });
    }

    drawCrystalClusters() {
        this.crystalClusters.forEach((cluster) => {
            cluster.pulsePhase += cluster.pulseSpeed;
            const pulse = Math.sin(cluster.pulsePhase) * 0.35 + 0.65;

            // Decay glow
            if (cluster.glowIntensity > 1.0) cluster.glowIntensity *= 0.96;

            const totalGlow = cluster.baseGlow * pulse * cluster.glowIntensity * (1 + this.pulseIntensity * 0.6) * this.ambientPulse;
            const flare = cluster.flare || 0;

            this.ctx.save();

            // Crystal shake
            let shakeX = 0, shakeY = 0;
            if (this.crystalShakeIntensity > 0) {
                shakeX = (Math.random() - 0.5) * this.crystalShakeIntensity * 10;
                shakeY = (Math.random() - 0.5) * this.crystalShakeIntensity * 10;
            }

            this.ctx.translate(cluster.x + shakeX, cluster.y + shakeY);
            this.ctx.rotate(Math.sin(cluster.rotationPhase) * cluster.rotationAmount);

            // Draw each crystal using cached texture
            cluster.crystals.forEach((crystal) => {
                if (!crystal.cache) return;
                
                this.ctx.save();
                this.ctx.translate(crystal.offsetX, crystal.offsetY);
                this.ctx.rotate(crystal.angle);

                const w = crystal.width;
                const h = crystal.height;
                const cache = crystal.cache;

                // Draw cached crystal texture
                this.ctx.globalAlpha = 0.95 + pulse * 0.05;
                this.ctx.drawImage(
                    cache.canvas,
                    -cache.width / 2,
                    -cache.height + cache.height * 0.23
                );
                this.ctx.globalAlpha = 1;

                // Subtle tip glow (only during flare/combo)
                if (flare > 0.2) {
                    const tipSize = w * (0.6 + flare * 0.4);
                    const tipAlpha = Math.min(flare * 0.5, 0.4);
                    this.ctx.fillStyle = `hsla(${crystal.hue}, ${crystal.saturation}%, 80%, ${tipAlpha})`;
                    this.ctx.beginPath();
                    this.ctx.arc(0, -h, tipSize, 0, Math.PI * 2);
                    this.ctx.fill();
                }

                this.ctx.restore();
            });

            this.ctx.restore();
        });
    }

    drawDustParticles() {
        this.dustParticles.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < -10) p.x = this.canvas.width + 10;
            if (p.x > this.canvas.width + 10) p.x = -10;
            if (p.y < -10) p.y = this.canvas.height + 10;
            if (p.y > this.canvas.height + 10) p.y = -10;

            p.pulsePhase += p.pulseSpeed;
            const pulse = Math.sin(p.pulsePhase) * 0.35 + 0.65;
            const opacity = p.opacity * pulse * (1 + this.comboMultiplier * 0.15);

            this.ctx.fillStyle = `hsla(${p.hue}, 65%, 70%, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawFloatingSparkles() {
        // Subtle sparkles
        this.floatingSparkles.forEach((s) => {
            const twinkle = Math.sin(s.twinklePhase) * 0.3 + 0.7;
            const opacity = s.opacity * twinkle * this.ambientPulse * 0.5;

            this.ctx.fillStyle = s.color;
            this.ctx.globalAlpha = opacity;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, Math.max(0.5, s.size * 0.7), 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1;
    }

    drawLightRays() {
        // Remove temporary rays
        for (let i = this.lightRays.length - 1; i >= 0; i--) {
            const ray = this.lightRays[i];
            if (ray.temporary) {
                ray.life -= 0.015;
                if (ray.life <= 0) {
                    this.lightRays.splice(i, 1);
                    continue;
                }
                ray.opacity = ray.life * 0.4;
            }
        }

        // Batch all light rays with same composite operation
        this.ctx.globalCompositeOperation = 'screen';
        this.lightRays.forEach((ray) => {
            ray.pulsePhase += ray.pulseSpeed;
            ray.angle += ray.rotationSpeed;

            const pulse = Math.sin(ray.pulsePhase) * 0.4 + 0.6;
            const comboBoost = 1 + this.pulseIntensity * 0.5 + this.comboMultiplier * 0.25;
            const opacity = ray.opacity * pulse * comboBoost * this.ambientPulse;

            this.ctx.save();
            this.ctx.translate(ray.x, ray.y);
            this.ctx.rotate(ray.angle);

            // Simplified: single color ray instead of gradient
            this.ctx.fillStyle = `hsla(${ray.hue}, 70%, 60%, ${opacity * 0.7})`;
            this.ctx.fillRect(-ray.width / 2, ray.length * 0.15, ray.width, ray.length * 0.7);

            this.ctx.restore();
        });
        this.ctx.globalCompositeOperation = 'source-over';
    }

    drawAmbientGlows() {
        // Very subtle ambient glow - much smaller and fainter
        this.ambientGlows.forEach((glow) => {
            glow.pulsePhase += glow.pulseSpeed;
            const pulse = Math.sin(glow.pulsePhase) * 0.2 + 0.8;
            const opacity = glow.opacity * pulse * (1 + this.comboMultiplier * 0.1) * this.ambientPulse * 0.3;

            this.ctx.fillStyle = `hsla(${glow.hue}, 50%, 45%, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(glow.x, glow.y, glow.radius * 0.25, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawEnergyPulses() {
        for (let i = this.energyPulses.length - 1; i >= 0; i--) {
            const pulse = this.energyPulses[i];

            pulse.radius += pulse.growthRate;
            pulse.opacity *= 0.94;

            if (pulse.radius >= pulse.maxRadius || pulse.opacity < 0.03) {
                this.energyPulses.splice(i, 1);
                continue;
            }

            // Ring only - no glow gradient (much faster)
            const safeRadius = Math.max(1, pulse.radius);
            this.ctx.strokeStyle = `hsla(${pulse.hue}, 75%, 60%, ${pulse.opacity})`;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, safeRadius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    drawCrystalResonance() {
        if (this.crystalResonance.length === 0) return;
        
        this.ctx.lineCap = 'round';
        
        for (let i = this.crystalResonance.length - 1; i >= 0; i--) {
            const res = this.crystalResonance[i];
            res.life -= res.decay;

            if (res.life <= 0) {
                this.crystalResonance.splice(i, 1);
                continue;
            }

            res.opacity = res.life * 0.7;

            // Simplified: single color beam instead of gradient
            this.ctx.strokeStyle = `hsla(${res.hue}, 80%, 70%, ${res.opacity})`;
            this.ctx.lineWidth = res.width + Math.sin(this.animationTime * 6 + i) * 1.2;
            this.ctx.beginPath();
            this.ctx.moveTo(res.x1, res.y1);

            // Curved beam
            const midX = (res.x1 + res.x2) / 2 + Math.sin(this.animationTime * 4 + i) * 35;
            const midY = (res.y1 + res.y2) / 2 + Math.cos(this.animationTime * 4 + i) * 35;
            this.ctx.quadraticCurveTo(midX, midY, res.x2, res.y2);
            this.ctx.stroke();
        }
        this.ctx.lineCap = 'butt';
    }

    drawLockEffects() {
        // Lock bursts
        for (let i = this.lockBursts.length - 1; i >= 0; i--) {
            const burst = this.lockBursts[i];
            burst.radius += burst.speed;
            burst.life -= 0.025;

            if (burst.life <= 0 || burst.radius > burst.maxRadius) {
                this.lockBursts.splice(i, 1);
                continue;
            }

            const safeRadius = Math.max(1, burst.radius);
            this.ctx.strokeStyle = `${burst.color}${Math.floor(burst.life * 200).toString(16).padStart(2, '0')}`;
            this.ctx.lineWidth = 3 + burst.life * 3;
            this.ctx.beginPath();
            this.ctx.arc(burst.x, burst.y, safeRadius, 0, Math.PI * 2);
            this.ctx.stroke();

            // Inner ring
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${burst.life * 0.4})`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(burst.x, burst.y, Math.max(1, safeRadius * 0.6), 0, Math.PI * 2);
            this.ctx.stroke();
        }

        // Lock sparkles - draw as twinkling particles
        this.ctx.globalCompositeOperation = 'screen';
        for (let i = this.lockSparkles.length - 1; i >= 0; i--) {
            const s = this.lockSparkles[i];
            
            // Store previous position for trail
            const prevX = s.x;
            const prevY = s.y;
            
            s.x += s.vx;
            s.y += s.vy;
            s.vx *= 0.96;
            s.vy *= 0.96;
            s.life -= s.decay;

            if (s.life <= 0) {
                this.lockSparkles.splice(i, 1);
                continue;
            }

            const sparkleSize = Math.max(0.5, s.size * s.life);
            const twinkle = Math.sin(this.animationTime * 15 + i) * 0.3 + 0.7;
            
            // Trail line
            if (s.life > 0.3) {
                this.ctx.strokeStyle = s.color;
                this.ctx.globalAlpha = s.life * 0.4;
                this.ctx.lineWidth = sparkleSize * 0.5;
                this.ctx.beginPath();
                this.ctx.moveTo(prevX, prevY);
                this.ctx.lineTo(s.x, s.y);
                this.ctx.stroke();
            }

            // Outer glow
            this.ctx.fillStyle = s.color;
            this.ctx.globalAlpha = s.life * twinkle * 0.6;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, sparkleSize * 1.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Main sparkle
            this.ctx.fillStyle = s.color;
            this.ctx.globalAlpha = s.life * twinkle;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, sparkleSize, 0, Math.PI * 2);
            this.ctx.fill();

            // Bright white core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = s.life * twinkle * 0.9;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, Math.max(0.5, sparkleSize * 0.5), 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
    }

    drawFloorRipples() {
        while (this.floorRipples.length > 6) this.floorRipples.shift();

        for (let i = this.floorRipples.length - 1; i >= 0; i--) {
            const ripple = this.floorRipples[i];
            ripple.radius += ripple.growthRate;
            ripple.opacity *= 0.95;

            if (ripple.radius >= ripple.maxRadius || ripple.opacity < 0.03) {
                this.floorRipples.splice(i, 1);
                continue;
            }

            const safeRadius = Math.max(1, ripple.radius);
            this.ctx.strokeStyle = `hsla(${ripple.hue}, 70%, 55%, ${ripple.opacity})`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.ellipse(ripple.x, ripple.y, safeRadius, Math.max(1, safeRadius * 0.25), 0, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    drawChromaticAberration() {
        if (this.chromaticAberration <= 0) return;

        const offset = this.chromaticAberration * 0.9;
        const intensity = Math.min(this.chromaticAberration / 10, 0.18);

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.fillStyle = `rgba(255, 0, 0, ${intensity})`;
        this.ctx.fillRect(-offset, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = `rgba(0, 100, 255, ${intensity})`;
        this.ctx.fillRect(offset, 0, this.canvas.width, this.canvas.height);

        if (this.chromaticAberration > 6) {
            this.ctx.globalCompositeOperation = 'lighten';
            this.ctx.fillStyle = `rgba(255, 255, 255, ${(this.chromaticAberration - 6) * 0.035})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.restore();
    }

    drawCaveFloor() {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.caveFloor[0].y);

        for (let i = 0; i < this.caveFloor.length; i++) {
            const segment = this.caveFloor[i];
            const nextSegment = this.caveFloor[i + 1] || segment;
            const roughnessOffset = Math.sin(this.animationTime * 0.08 + i * 0.5) * segment.roughness;

            if (i < this.caveFloor.length - 1) {
                this.ctx.quadraticCurveTo(segment.x, segment.y + roughnessOffset, (segment.x + nextSegment.x) / 2, (segment.y + nextSegment.y) / 2);
            } else {
                this.ctx.lineTo(segment.x + segment.width, segment.y + roughnessOffset);
            }
        }

        this.ctx.lineTo(this.canvas.width, this.canvas.height);
        this.ctx.lineTo(0, this.canvas.height);
        this.ctx.closePath();

        const gradient = this.ctx.createLinearGradient(0, this.canvas.height * 0.85, 0, this.canvas.height);
        gradient.addColorStop(0, 'hsla(268, 22%, 10%, 0.7)');
        gradient.addColorStop(1, 'hsla(272, 18%, 6%, 0.9)');

        this.ctx.fillStyle = gradient;
        this.ctx.fill();
        this.ctx.restore();
    }

    drawRockFormations() {
        this.rockFormations.forEach((rock) => {
            this.ctx.save();
            this.ctx.beginPath();

            const points = 9;
            for (let i = 0; i <= points; i++) {
                const angle = (i / points) * Math.PI * 2;
                const variation = Math.sin(angle * 3.5 + rock.roughness) * 0.22 + 0.88;
                const x = rock.x + Math.cos(angle) * (rock.width / 2) * variation;
                const y = rock.y + Math.sin(angle) * (rock.height / 2) * variation;

                if (i === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();

            // Simplified: solid color instead of gradient
            this.ctx.fillStyle = `hsla(${rock.hue}, 14%, 10%, 0.7)`;
            this.ctx.fill();
            this.ctx.restore();
        });
    }

    drawStalagmites() {
        this.stalagmites.forEach((s) => {
            this.ctx.save();

            const pulse = Math.sin(this.animationTime * 1.5 + s.x * 0.01) * 0.15 + 0.85;
            const glow = s.glowIntensity * pulse * (1 + this.pulseIntensity * 0.2) * this.ambientPulse;

            // Stalagmite shape - simplified path
            this.ctx.beginPath();
            this.ctx.moveTo(s.x - s.width / 2, s.y);
            this.ctx.lineTo(s.x - s.width * 0.2, s.y - s.height * 0.6);
            this.ctx.lineTo(s.x, s.y - s.height);
            this.ctx.lineTo(s.x + s.width * 0.2, s.y - s.height * 0.6);
            this.ctx.lineTo(s.x + s.width / 2, s.y);
            this.ctx.closePath();

            // Simplified: single color with subtle glow-based lightness
            const lightness = 30 + glow * 15;
            this.ctx.fillStyle = `hsla(${s.hue}, 55%, ${lightness}%, 0.9)`;
            this.ctx.fill();

            // Very subtle tip highlight - only during combos
            if (this.pulseIntensity > 0.3) {
                this.ctx.fillStyle = `hsla(${s.hue}, 70%, 60%, ${0.2 * this.pulseIntensity})`;
                this.ctx.beginPath();
                this.ctx.arc(s.x, s.y - s.height, s.width * 0.4, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.ctx.restore();
        });
    }

    drawMist() {
        // Very subtle mist - barely visible ellipses
        this.mist.forEach((m) => {
            const pulse = Math.sin(this.animationTime * 0.3 + m.x * 0.005) * 0.15 + 0.85;
            const comboBoost = 1 + this.comboMultiplier * 0.15 + this.pulseIntensity * 0.1;
            const opacity = m.opacity * pulse * Math.min(comboBoost, 1.5) * 0.4;

            this.ctx.fillStyle = `hsla(${m.hue}, 25%, 40%, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.ellipse(m.x, m.y, m.width / 2.5, m.height / 2.5, 0, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        super.stop();
        this.animationTime = 0;
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.clearAllElements();
        this.cachedCrystals.clear();
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        this.crystalShakeIntensity = 0;
    }

    getTetrominoConfig() {
        return GEODE_TETROMINOS;
    }
}

/**
 * @fileoverview Geode Theme - Luminous Fiber-Optic Starfield
 * 
 * An immersive cosmic cavern featuring:
 * - Dense starfield spanning the entire screen
 * - Fiber-optic strands hanging and floating throughout
 * - Dynamic sparkle bursts on gameplay events
 * - Warm cosmic color palette (oranges, reds, magentas)
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
        this.frameCount = 0;
        this.lastFrameTime = 0;

        // Scene elements
        this.stars = [];
        this.strands = [];
        this.ambientParticles = [];

        // Gameplay reactive elements
        this.energyPulses = [];
        this.sparkles = [];
        this.shootingStars = [];
        this.novaFlashes = [];
        this.starRipples = [];

        // Visual state
        this.comboMultiplier = 1.0;
        this.pulseIntensity = 0.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        this.ambientPulse = 0;

        // Cached gradients
        this.cachedGradients = {};
        this.spriteCache = {};
        
        // Performance: Spatial grid for star ripple checks
        this.starGrid = null;
        this.gridCellSize = 80;
        this.gridCols = 0;
        this.gridRows = 0;
        
        // Performance: Pre-computed sin/cos lookup table
        this.sinTable = new Float32Array(360);
        this.cosTable = new Float32Array(360);
        for (let i = 0; i < 360; i++) {
            const rad = (i / 360) * Math.PI * 2;
            this.sinTable[i] = Math.sin(rad);
            this.cosTable[i] = Math.cos(rad);
        }
        
        // Performance: Reusable typed arrays for batch operations
        this.tempVec2 = new Float32Array(2);

        // Event tracking
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Color palette - warm cosmic spectrum
        this.starColors = [
            '#ff6030', '#ff8040', '#ffa050', '#ffb060', '#ffc070', // oranges
            '#ff5040', '#ff4050', '#ff3060', '#ff2070', // reds
            '#ffd060', '#ffe080', '#fff0a0', // yellows
            '#ff70ff', '#ff60e0', '#e060ff', '#c060ff', '#a050ff', // magentas/purples
            '#60ffff', '#50e0ff', '#40c0ff', // teals (accent)
            '#60ff90', '#50ffa0', // greens (accent)
        ];

        this.qualityPresets = {
            Minimal: {
                // Element counts
                starCount: 800,
                strandCount: 0,
                ambientParticleCount: 30,
                maxEnergyPulses: 3,
                maxSparkles: 30,
                maxShootingStars: 4,
                maxNovaFlashes: 2,
                maxStarRipples: 2,
                // Rendering quality
                enableStarGlow: false,
                starGlowSizeThreshold: 3,
                starBrightnessThreshold: 0.1,
                enableSparkleCore: false,
                maxTrailLength: 8,
                trailBatchCount: 2,
                // Effect toggles
                enableChromaticAberration: false,
                enableScreenShake: true,
                enableVignette: false,
                enableNovaRays: false,
                enableAmbientPulseGlow: false,
                // Burst counts
                shootingStarsPerLock: 2,
                sparklesPerLock: 2,
                sparklesPerLineClear: 3,
                burstPointsPerLineClear: 4,
            },
            Low: {
                // Element counts
                starCount: 1500,
                strandCount: 0,
                ambientParticleCount: 50,
                maxEnergyPulses: 5,
                maxSparkles: 50,
                maxShootingStars: 6,
                maxNovaFlashes: 3,
                maxStarRipples: 3,
                // Rendering quality
                enableStarGlow: false,
                starGlowSizeThreshold: 2.5,
                starBrightnessThreshold: 0.08,
                enableSparkleCore: true,
                maxTrailLength: 10,
                trailBatchCount: 2,
                // Effect toggles
                enableChromaticAberration: false,
                enableScreenShake: true,
                enableVignette: true,
                enableNovaRays: false,
                enableAmbientPulseGlow: true,
                // Burst counts
                shootingStarsPerLock: 2,
                sparklesPerLock: 3,
                sparklesPerLineClear: 4,
                burstPointsPerLineClear: 6,
            },
            Medium: {
                // Element counts
                starCount: 3000,
                strandCount: 0,
                ambientParticleCount: 60,
                maxEnergyPulses: 8,
                maxSparkles: 80,
                maxShootingStars: 10,
                maxNovaFlashes: 4,
                maxStarRipples: 4,
                // Rendering quality
                enableStarGlow: true,
                starGlowSizeThreshold: 2.5,
                starBrightnessThreshold: 0.05,
                enableSparkleCore: true,
                maxTrailLength: 12,
                trailBatchCount: 3,
                // Effect toggles
                enableChromaticAberration: true,
                enableScreenShake: true,
                enableVignette: true,
                enableNovaRays: true,
                enableAmbientPulseGlow: true,
                // Burst counts
                shootingStarsPerLock: 3,
                sparklesPerLock: 4,
                sparklesPerLineClear: 5,
                burstPointsPerLineClear: 8,
            },
            High: {
                // Element counts
                starCount: 5000,
                strandCount: 0,
                ambientParticleCount: 70,
                maxEnergyPulses: 12,
                maxSparkles: 120,
                maxShootingStars: 15,
                maxNovaFlashes: 5,
                maxStarRipples: 5,
                // Rendering quality
                enableStarGlow: true,
                starGlowSizeThreshold: 2,
                starBrightnessThreshold: 0.05,
                enableSparkleCore: true,
                maxTrailLength: 15,
                trailBatchCount: 3,
                // Effect toggles
                enableChromaticAberration: true,
                enableScreenShake: true,
                enableVignette: true,
                enableNovaRays: true,
                enableAmbientPulseGlow: true,
                // Burst counts
                shootingStarsPerLock: 3,
                sparklesPerLock: 5,
                sparklesPerLineClear: 6,
                burstPointsPerLineClear: 10,
            },
            Ultra: {
                // Element counts
                starCount: 7000,
                strandCount: 0,
                ambientParticleCount: 80,
                maxEnergyPulses: 16,
                maxSparkles: 160,
                maxShootingStars: 20,
                maxNovaFlashes: 6,
                maxStarRipples: 6,
                // Rendering quality
                enableStarGlow: true,
                starGlowSizeThreshold: 1.8,
                starBrightnessThreshold: 0.04,
                enableSparkleCore: true,
                maxTrailLength: 18,
                trailBatchCount: 3,
                // Effect toggles
                enableChromaticAberration: true,
                enableScreenShake: true,
                enableVignette: true,
                enableNovaRays: true,
                enableAmbientPulseGlow: true,
                // Burst counts
                shootingStarsPerLock: 4,
                sparklesPerLock: 6,
                sparklesPerLineClear: 7,
                burstPointsPerLineClear: 12,
            },
            Extreme: {
                // Element counts
                starCount: 8000,
                strandCount: 0,
                ambientParticleCount: 100,
                maxEnergyPulses: 20,
                maxSparkles: 200,
                maxShootingStars: 25,
                maxNovaFlashes: 8,
                maxStarRipples: 8,
                // Rendering quality
                enableStarGlow: true,
                starGlowSizeThreshold: 1.5,
                starBrightnessThreshold: 0.03,
                enableSparkleCore: true,
                maxTrailLength: 20,
                trailBatchCount: 4,
                // Effect toggles
                enableChromaticAberration: true,
                enableScreenShake: true,
                enableVignette: true,
                enableNovaRays: true,
                enableAmbientPulseGlow: true,
                // Burst counts
                shootingStarsPerLock: 4,
                sparklesPerLock: 7,
                sparklesPerLineClear: 8,
                burstPointsPerLineClear: 14,
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
    
    // Performance: Fast sin/cos using lookup table
    fastSin(phase) {
        const index = ((phase * 57.2957795) % 360 + 360) % 360 | 0; // radians to degrees, ensure positive
        return this.sinTable[index];
    }
    
    fastCos(phase) {
        const index = ((phase * 57.2957795) % 360 + 360) % 360 | 0;
        return this.cosTable[index];
    }
    
    // Performance: Build spatial grid for efficient star lookups
    buildStarGrid() {
        if (!this.canvas) return;
        
        this.gridCols = Math.ceil(this.canvas.width / this.gridCellSize);
        this.gridRows = Math.ceil(this.canvas.height / this.gridCellSize);
        this.starGrid = new Array(this.gridCols * this.gridRows);
        
        for (let i = 0; i < this.starGrid.length; i++) {
            this.starGrid[i] = [];
        }
        
        // Assign stars to grid cells
        for (let i = 0; i < this.stars.length; i++) {
            const star = this.stars[i];
            const cellX = Math.floor(star.x / this.gridCellSize);
            const cellY = Math.floor(star.y / this.gridCellSize);
            if (cellX >= 0 && cellX < this.gridCols && cellY >= 0 && cellY < this.gridRows) {
                this.starGrid[cellY * this.gridCols + cellX].push(star);
            }
        }
    }
    
    // Performance: Get stars in cells that intersect a circle
    getStarsInRadius(x, y, radius) {
        if (!this.starGrid) return this.stars;
        
        const minCellX = Math.max(0, Math.floor((x - radius) / this.gridCellSize));
        const maxCellX = Math.min(this.gridCols - 1, Math.floor((x + radius) / this.gridCellSize));
        const minCellY = Math.max(0, Math.floor((y - radius) / this.gridCellSize));
        const maxCellY = Math.min(this.gridRows - 1, Math.floor((y + radius) / this.gridCellSize));
        
        const result = [];
        for (let cy = minCellY; cy <= maxCellY; cy++) {
            for (let cx = minCellX; cx <= maxCellX; cx++) {
                const cell = this.starGrid[cy * this.gridCols + cx];
                if (cell) {
                    for (let i = 0; i < cell.length; i++) {
                        result.push(cell[i]);
                    }
                }
            }
        }
        return result;
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

        this.clearAllElements();
        this.cacheGradients();
        this.cacheStarSprites();

        // Initialize scene elements
        this.createStars();
        this.createStrands();
        this.createAmbientParticles();
        
        // Performance: Build spatial grid for star ripple lookups
        this.buildStarGrid();

        this.setupEventListeners();
        this.lastFrameTime = performance.now();
        this.animate();
    }

    clearAllElements() {
        this.stars = [];
        this.strands = [];
        this.ambientParticles = [];
        this.energyPulses = [];
        this.sparkles = [];
        this.shootingStars = [];
        this.novaFlashes = [];
        this.starRipples = [];
    }

    cacheGradients() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        // Deep space background with warm undertones
        const bgGradient = this.ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.9);
        bgGradient.addColorStop(0, '#0c0408');
        bgGradient.addColorStop(0.3, '#080306');
        bgGradient.addColorStop(0.6, '#050204');
        bgGradient.addColorStop(1, '#020102');
        this.cachedGradients.background = bgGradient;

        // Vignette
        const vignette = this.ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.9);
        vignette.addColorStop(0, 'transparent');
        vignette.addColorStop(0.6, 'rgba(0, 0, 0, 0.15)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
        this.cachedGradients.vignette = vignette;
    }

    cacheStarSprites() {
        this.spriteCache = {};
        // Create a sprite for each color
        // Base size 32x32 to allow for scaling up without blur
        const size = 32;
        const center = size / 2;
        const radius = size / 2 - 2;

        // Cache colored stars
        this.starColors.forEach(color => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(center, center, radius, 0, Math.PI * 2);
            ctx.fill();

            this.spriteCache[color] = canvas;
        });

        // Cache white star for cores/intense effects
        const whiteCanvas = document.createElement('canvas');
        whiteCanvas.width = size;
        whiteCanvas.height = size;
        const wCtx = whiteCanvas.getContext('2d');
        wCtx.fillStyle = '#ffffff';
        wCtx.beginPath();
        wCtx.arc(center, center, radius, 0, Math.PI * 2);
        wCtx.fill();
        this.spriteCache['#ffffff'] = whiteCanvas;
    }

    createStars() {
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Dense starfield across entire screen
        // More density at top, gradually thinning toward bottom
        for (let i = 0; i < preset.starCount; i++) {
            // Bias toward top but cover whole screen
            const yBias = Math.pow(Math.random(), 1.8);
            const y = yBias * h;

            // Size varies - smaller stars more common
            const sizeBias = Math.pow(Math.random(), 2);
            const size = 0.3 + sizeBias * 3;

            this.stars.push({
                x: Math.random() * w,
                y: y,
                size: size,
                color: this.starColors[(Math.random() * this.starColors.length) | 0],
                brightness: 0.2 + Math.random() * 0.8,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.015 + Math.random() * 0.045,
                // Slight drift for parallax feel
                driftX: (Math.random() - 0.5) * 0.05,
                driftY: (Math.random() - 0.5) * 0.02,
                rippleBoost: 0, // Initialize to 0 for faster checks
            });
        }
    }

    createStrands() {
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Fiber-optic strands distributed across screen
        for (let i = 0; i < preset.strandCount; i++) {
            const x = Math.random() * w;
            // Start from various heights, mostly from top half
            const startY = Math.random() * h * 0.6;
            // Longer strands
            const length = 80 + Math.random() * 350;
            const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];

            this.strands.push({
                x: x,
                baseX: x,
                startY: startY,
                length: length,
                width: 0.4 + Math.random() * 1.8,
                color: color,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: 0.0008 + Math.random() * 0.002,
                swayAmount: 3 + Math.random() * 12,
                brightness: 0.3 + Math.random() * 0.7,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.008 + Math.random() * 0.02,
                // Tip properties
                tipSize: 1 + Math.random() * 2.5,
                tipBrightness: 0.6 + Math.random() * 0.4,
            });
        }
    }

    createAmbientParticles() {
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Floating particles drifting slowly
        for (let i = 0; i < preset.ambientParticleCount; i++) {
            this.ambientParticles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.4,
                vy: -0.15 - Math.random() * 0.3,
                size: 0.8 + Math.random() * 2.5,
                color: this.starColors[Math.floor(Math.random() * this.starColors.length)],
                opacity: 0.3 + Math.random() * 0.5,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.02 + Math.random() * 0.04,
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
            // Rebuild spatial grid for new dimensions
            this.buildStarGrid();
        });
    }

    handlePieceLock() {
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.1, 0.4);

        const w = this.canvas.width;
        const h = this.canvas.height;
        const preset = this.activePreset;

        // === SHOOTING STARS ===
        // Spawn shooting stars streaking across the screen (uses preset count)
        const shootingCount = preset.shootingStarsPerLock + Math.floor(Math.random() * 2);
        const maxTrailLen = preset.maxTrailLength;
        for (let i = 0; i < shootingCount && this.shootingStars.length < preset.maxShootingStars; i++) {
            const color = this.starColors[(Math.random() * this.starColors.length) | 0];
            // Random direction - mostly diagonal
            const angle = Math.random() * Math.PI * 2;
            const speed = 8 + Math.random() * 12;

            // Start from edges or random positions
            let startX, startY;
            if (Math.random() > 0.5) {
                // Start from top/sides
                startX = Math.random() * w;
                startY = Math.random() * h * 0.4;
            } else {
                // Start from random position
                startX = Math.random() * w;
                startY = Math.random() * h * 0.6;
            }

            this.shootingStars.push({
                x: startX,
                y: startY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * 3,
                color: color,
                life: 1.0,
                decay: 0.025 + Math.random() * 0.015,
                trail: [], // Store trail positions
                maxTrailLength: maxTrailLen + ((Math.random() * 4) | 0), // Uses preset with small variance
            });
        }

        // === NOVA FLASH ===
        // Create a bright flash that illuminates nearby stars
        if (Math.random() > 0.3 && this.novaFlashes.length < preset.maxNovaFlashes) {
            const color = this.starColors[(Math.random() * this.starColors.length) | 0];
            this.novaFlashes.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.1 + Math.random() * h * 0.5,
                radius: 0,
                maxRadius: 80 + Math.random() * 60,
                brightness: 1.0,
                decay: 0.04 + Math.random() * 0.02,
                color: color,
            });
        }

        // === STAR RIPPLE ===
        // A wave that makes stars pulse brighter as it passes
        if (Math.random() > 0.5 && this.starRipples.length < preset.maxStarRipples) {
            this.starRipples.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.1 + Math.random() * h * 0.5,
                radius: 0,
                speed: 6 + Math.random() * 4,
                width: 40 + Math.random() * 30, // Width of the ripple ring
                life: 1.0,
                decay: 0.012,
            });
        }

        // Spawn some sparkles too (uses preset count)
        const sparkleCount = preset.sparklesPerLock + ((Math.random() * 2) | 0);
        for (let i = 0; i < sparkleCount; i++) {
            const color = this.starColors[(Math.random() * this.starColors.length) | 0];
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 2;

            this.sparkles.push({
                x: w * 0.3 + Math.random() * w * 0.4,
                y: h * 0.2 + Math.random() * h * 0.4,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.5 + Math.random() * 2,
                color: color,
                life: 1.0,
                decay: 0.02 + Math.random() * 0.015,
            });
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
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.3 * lineCount, 2.0);

        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Spawn sparkle bursts from multiple points (uses preset counts)
        const burstCount = Math.min(lineCount * 2 + 2, preset.burstPointsPerLineClear);
        const sparklesPerBurst = preset.sparklesPerLineClear + lineCount;
        
        for (let c = 0; c < burstCount; c++) {
            const x = Math.random() * w;
            const y = Math.random() * h * 0.7;
            const color = this.starColors[(Math.random() * this.starColors.length) | 0];

            for (let i = 0; i < sparklesPerBurst; i++) {
                const angle = (i / sparklesPerBurst) * Math.PI * 2 + Math.random() * 0.3;
                const speed = 1.5 + Math.random() * 3;

                this.sparkles.push({
                    x: x + (Math.random() - 0.5) * 30,
                    y: y + (Math.random() - 0.5) * 30,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 2 + Math.random() * 2.5,
                    color: color,
                    life: 1.0,
                    decay: 0.015 + Math.random() * 0.01,
                });
            }
        }

        // Energy pulses
        const pulseCount = Math.min(lineCount, 3);
        for (let p = 0; p < pulseCount; p++) {
            if (this.energyPulses.length < preset.maxEnergyPulses) {
                const color = this.starColors[(Math.random() * this.starColors.length) | 0];
                this.energyPulses.push({
                    x: Math.random() * w,
                    y: Math.random() * h * 0.6,
                    radius: 10,
                    maxRadius: 100 + lineCount * 40,
                    opacity: 0.5,
                    color: color,
                    growthRate: 3 + lineCount * 0.5,
                });
            }
        }
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.2, 2.5);
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.4 * comboCount, 2.0);

        const preset = this.activePreset;

        // Screen shake for high combos (uses preset toggle)
        if (preset.enableScreenShake) {
            if (comboCount >= 5) {
                this.screenShake.intensity = Math.min(5 + (comboCount - 5) * 1.8, 12);
                // Chromatic aberration for very high combos (uses preset toggle)
                if (preset.enableChromaticAberration && comboCount >= 7) {
                    this.chromaticAberration = Math.min(3 + (comboCount - 7) * 1, 8);
                }
            } else if (comboCount >= 3) {
                this.screenShake.intensity = Math.min(2 + comboCount * 0.6, 5);
            }
        }

        // Big sparkle burst for combos
        if (comboCount >= 2) {
            const burstCount = Math.min(comboCount * 4, 30);
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;

            for (let i = 0; i < burstCount; i++) {
                const angle = (i / burstCount) * Math.PI * 2;
                const speed = 2 + Math.random() * 4;
                const color = this.starColors[(Math.random() * this.starColors.length) | 0];

                this.sparkles.push({
                    x: cx + (Math.random() - 0.5) * 50,
                    y: cy + (Math.random() - 0.5) * 50,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 2 + Math.random() * 3,
                    color: color,
                    life: 1.0,
                    decay: 0.012,
                });
            }
        }
    }

    animate() {
        if (!this.isActive || !this.ctx || !this.canvas) return;

        // Use delta time for frame-rate independent animation
        const now = performance.now();
        const deltaTime = Math.min((now - this.lastFrameTime) / 16.667, 2); // Cap at 2x to prevent huge jumps
        this.lastFrameTime = now;
        this.frameCount++;

        this.animationTime += 0.016 * deltaTime;
        this.ambientPulse = this.fastSin(this.animationTime * 0.4) * 0.1 + 0.9;

        // Decay effects (frame-rate independent)
        const decayFactor = Math.pow(0.97, deltaTime);
        this.pulseIntensity *= decayFactor;
        if (this.pulseIntensity < 0.01) this.pulseIntensity = 0;

        this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.005 * deltaTime);

        const shakeDecay = Math.pow(0.9, deltaTime);
        this.screenShake.intensity *= shakeDecay;
        if (this.screenShake.intensity < 0.1) this.screenShake.intensity = 0;

        const chromaDecay = Math.pow(0.92, deltaTime);
        this.chromaticAberration *= chromaDecay;
        if (this.chromaticAberration < 0.1) this.chromaticAberration = 0;

        // Screen shake
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity * 2;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity * 2;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        const ctx = this.ctx;
        
        // Draw
        ctx.save();
        if (this.screenShake.intensity > 0) {
            ctx.translate(this.screenShake.x, this.screenShake.y);
        }

        this.drawBackground();
        this.updateStarRipples(); // Update star brightness from ripples
        this.drawStars();
        this.drawStrands();
        this.drawAmbientParticles();
        this.drawEnergyPulses();
        this.drawNovaFlashes();
        this.drawShootingStars();
        this.drawSparkles();
        this.drawVignette();

        ctx.restore();

        if (this.chromaticAberration > 0) {
            this.drawChromaticAberration();
        }

        this.registerAnimation(requestAnimationFrame(() => this.animate()));
    }

    drawBackground() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        if (this.cachedGradients.background) {
            ctx.fillStyle = this.cachedGradients.background;
        } else {
            ctx.fillStyle = '#030204';
        }
        ctx.fillRect(0, 0, w, h);

        // Ambient pulse glow during combos (uses preset toggle)
        if (this.activePreset.enableAmbientPulseGlow && this.pulseIntensity > 0.05) {
            const cx = w / 2;
            const cy = h * 0.4;
            const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.6);
            glowGrad.addColorStop(0, `rgba(255, 120, 80, ${this.pulseIntensity * 0.06})`);
            glowGrad.addColorStop(0.4, `rgba(200, 80, 150, ${this.pulseIntensity * 0.03})`);
            glowGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = glowGrad;
            ctx.fillRect(0, 0, w, h);
        }
    }

    drawStars() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;
        const preset = this.activePreset;
        const pulseIntensityFactor = 1 + this.pulseIntensity * 0.4;
        const ambientPulse = this.ambientPulse;
        const stars = this.stars;
        const starCount = stars.length;
        const spriteCache = this.spriteCache;
        const whiteSprite = spriteCache['#ffffff'];
        
        // Quality settings
        const brightnessThreshold = preset.starBrightnessThreshold;
        const enableGlow = preset.enableStarGlow;
        const glowSizeThreshold = preset.starGlowSizeThreshold;
        
        // Performance: Process stars in batches, skip very dim stars
        for (let i = 0; i < starCount; i++) {
            const star = stars[i];
            
            // Update position with slight drift
            star.x += star.driftX;
            star.y += star.driftY;

            // Wrap around
            if (star.x < -5) star.x = w + 5;
            else if (star.x > w + 5) star.x = -5;
            if (star.y < -5) star.y = h + 5;
            else if (star.y > h + 5) star.y = -5;

            // Twinkle using fast lookup
            star.twinklePhase += star.twinkleSpeed;
            const twinkle = this.fastSin(star.twinklePhase) * 0.4 + 0.6;

            // Include ripple boost in brightness calculation
            const rippleBoost = star.rippleBoost;
            const baseBrightness = star.brightness * twinkle * pulseIntensityFactor * ambientPulse;
            const brightness = baseBrightness + rippleBoost;
            
            // Performance: Skip nearly invisible stars (uses preset threshold)
            if (brightness < brightnessThreshold) continue;
            
            const clampedBrightness = brightness > 1 ? 1 : brightness;

            // Size boost from ripple
            const effectiveSize = rippleBoost > 0 ? star.size * (1 + rippleBoost * 0.8) : star.size;

            // Draw star using sprite
            const sprite = spriteCache[star.color];
            if (sprite) {
                ctx.globalAlpha = clampedBrightness;
                const diameter = effectiveSize * 2.3;
                const offset = diameter * 0.5;
                ctx.drawImage(sprite, star.x - offset, star.y - offset, diameter, diameter);
            }

            // Extra glow only for larger/brighter stars (uses preset settings)
            if (enableGlow && ((star.size > glowSizeThreshold && brightness > 0.6) || rippleBoost > 0.4)) {
                ctx.globalAlpha = clampedBrightness * 0.4;
                const glowDiameter = effectiveSize * 5.06; // 2.2 * 2.3
                const glowOffset = glowDiameter * 0.5;

                if (sprite) {
                    ctx.drawImage(sprite, star.x - glowOffset, star.y - glowOffset, glowDiameter, glowDiameter);
                }

                // White core only for intense ripple effect
                if (rippleBoost > 0.5 && whiteSprite) {
                    ctx.globalAlpha = rippleBoost * 0.7;
                    const coreDiameter = effectiveSize * 1.38; // 0.6 * 2.3
                    const coreOffset = coreDiameter * 0.5;
                    ctx.drawImage(whiteSprite, star.x - coreOffset, star.y - coreOffset, coreDiameter, coreDiameter);
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    drawStrands() {
        const ctx = this.ctx;
        const strands = this.strands;
        const strandCount = strands.length;
        const spriteCache = this.spriteCache;
        const whiteSprite = spriteCache['#ffffff'];
        const pulseIntensityFactor = 1 + this.pulseIntensity * 0.5;
        const ambientPulse = this.ambientPulse;
        
        ctx.lineCap = 'round';
        
        for (let i = 0; i < strandCount; i++) {
            const strand = strands[i];
            
            // Sway animation using fast lookup
            strand.swayPhase += strand.swaySpeed;
            strand.pulsePhase += strand.pulseSpeed;

            const swayX = this.fastSin(strand.swayPhase) * strand.swayAmount;
            const pulse = this.fastSin(strand.pulsePhase) * 0.3 + 0.7;
            const brightness = strand.brightness * pulse * pulseIntensityFactor * ambientPulse;
            
            // Performance: Skip dim strands
            if (brightness < 0.08) continue;

            // End position with sway
            const endX = strand.x + swayX;
            const endY = strand.startY + strand.length;

            // Performance: Use solid color with alpha fade instead of gradient for most strands
            ctx.strokeStyle = strand.color;
            ctx.globalAlpha = brightness;
            ctx.lineWidth = strand.width;

            ctx.beginPath();
            ctx.moveTo(strand.x, strand.startY);

            // Simplified curve with one control point for better performance
            const midY = strand.startY + strand.length * 0.5;
            const midX = strand.x + swayX * 0.5;

            ctx.quadraticCurveTo(midX, midY, endX, endY);
            ctx.stroke();

            // Bright glowing tip - simplified to 2 draws instead of 3
            const tipPulse = this.fastSin(strand.pulsePhase * 1.5) * 0.3 + 0.7;
            const tipBright = strand.tipBrightness * tipPulse * brightness;
            
            if (tipBright < 0.1) continue;

            const sprite = spriteCache[strand.color];

            if (sprite) {
                // Combined glow (skip outer, keep inner)
                ctx.globalAlpha = tipBright * 0.6;
                const innerDiameter = strand.tipSize * 4.14; // 1.8 * 2.3
                const innerOffset = innerDiameter * 0.5;
                ctx.drawImage(sprite, endX - innerOffset, endY - innerOffset, innerDiameter, innerDiameter);
            }

            if (whiteSprite) {
                // Bright core
                ctx.globalAlpha = tipBright * 0.9;
                const coreDiameter = strand.tipSize * 2.3;
                const coreOffset = coreDiameter * 0.5;
                ctx.drawImage(whiteSprite, endX - coreOffset, endY - coreOffset, coreDiameter, coreDiameter);
            }
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
    }

    drawAmbientParticles() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;
        const particles = this.ambientParticles;
        const particleCount = particles.length;
        const spriteCache = this.spriteCache;
        const comboFactor = 1 + this.comboMultiplier * 0.25;
        const ambientPulse = this.ambientPulse;

        for (let i = 0; i < particleCount; i++) {
            const p = particles[i];
            
            // Update position
            p.x += p.vx;
            p.y += p.vy;
            p.twinklePhase += p.twinkleSpeed;

            // Wrap around
            if (p.y < -10) {
                p.y = h + 10;
                p.x = Math.random() * w;
            }
            if (p.x < -10) p.x = w + 10;
            else if (p.x > w + 10) p.x = -10;

            const twinkle = this.fastSin(p.twinklePhase) * 0.35 + 0.65;
            const brightness = p.opacity * twinkle * comboFactor * ambientPulse;
            
            // Performance: Skip dim particles
            if (brightness < 0.08) continue;

            // Single draw with combined glow (skip outer for performance)
            const sprite = spriteCache[p.color];
            if (sprite) {
                ctx.globalAlpha = brightness;
                const coreDiameter = p.size * 2.3;
                const coreOffset = coreDiameter * 0.5;
                ctx.drawImage(sprite, p.x - coreOffset, p.y - coreOffset, coreDiameter, coreDiameter);
            }
        }
        ctx.globalAlpha = 1;
    }

    drawEnergyPulses() {
        const ctx = this.ctx;
        const pulses = this.energyPulses;
        const PI2 = Math.PI * 2;
        
        for (let i = pulses.length - 1; i >= 0; i--) {
            const pulse = pulses[i];

            pulse.radius += pulse.growthRate;
            pulse.opacity *= 0.94;

            if (pulse.radius >= pulse.maxRadius || pulse.opacity < 0.03) {
                pulses.splice(i, 1);
                continue;
            }

            const safeRadius = pulse.radius > 1 ? pulse.radius : 1;

            // Outer ring
            ctx.strokeStyle = pulse.color;
            ctx.globalAlpha = pulse.opacity;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(pulse.x, pulse.y, safeRadius, 0, PI2);
            ctx.stroke();

            // Inner ring - only draw if opacity is visible
            if (pulse.opacity > 0.1) {
                ctx.strokeStyle = '#ffffff';
                ctx.globalAlpha = pulse.opacity * 0.5;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(pulse.x, pulse.y, safeRadius * 0.6, 0, PI2);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }

    drawSparkles() {
        const ctx = this.ctx;
        const sparkles = this.sparkles;
        const preset = this.activePreset;
        const maxSparkles = preset.maxSparkles * 1.5;
        const spriteCache = this.spriteCache;
        const whiteSprite = spriteCache['#ffffff'];
        const animTime = this.animationTime * 18;
        const enableCore = preset.enableSparkleCore;
        
        ctx.globalCompositeOperation = 'screen';

        for (let i = sparkles.length - 1; i >= 0; i--) {
            const s = sparkles[i];

            // Update
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.03; // Light gravity
            s.vx *= 0.98;
            s.vy *= 0.98;
            s.life -= s.decay;

            if (s.life <= 0 || sparkles.length > maxSparkles) {
                sparkles.splice(i, 1);
                continue;
            }

            const sparkleSize = s.size * s.life;
            if (sparkleSize < 0.3) continue; // Performance: skip tiny sparkles
            
            const twinkle = this.fastSin(animTime + i) * 0.3 + 0.7;
            const lifeAlpha = s.life * twinkle;
            
            // Performance: Skip very dim sparkles
            if (lifeAlpha < 0.1) continue;

            // Simplified: single main sparkle draw instead of 3
            const sprite = spriteCache[s.color];
            if (sprite) {
                ctx.globalAlpha = lifeAlpha;
                const mainDiameter = sparkleSize * 2.3;
                const mainOffset = mainDiameter * 0.5;
                ctx.drawImage(sprite, s.x - mainOffset, s.y - mainOffset, mainDiameter, mainDiameter);
            }

            // Bright core only for larger sparkles (uses preset setting)
            if (enableCore && sparkleSize > 1 && whiteSprite) {
                ctx.globalAlpha = lifeAlpha * 0.9;
                const coreDiameter = sparkleSize * 0.92; // 0.4 * 2.3
                const coreOffset = coreDiameter * 0.5;
                ctx.drawImage(whiteSprite, s.x - coreOffset, s.y - coreOffset, coreDiameter, coreDiameter);
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    drawShootingStars() {
        const ctx = this.ctx;
        const shootingStars = this.shootingStars;
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const spriteCache = this.spriteCache;
        const whiteSprite = spriteCache['#ffffff'];
        const trailBatchCount = preset.trailBatchCount;
        
        ctx.globalCompositeOperation = 'screen';
        ctx.lineCap = 'round';

        for (let i = shootingStars.length - 1; i >= 0; i--) {
            const star = shootingStars[i];

            // Store current position in trail
            star.trail.unshift({ x: star.x, y: star.y });
            if (star.trail.length > star.maxTrailLength) {
                star.trail.pop();
            }

            // Update position
            star.x += star.vx;
            star.y += star.vy;
            star.life -= star.decay;

            // Slight deceleration
            star.vx *= 0.98;
            star.vy *= 0.98;

            // Remove if dead or off-screen
            if (star.life <= 0 ||
                star.x < -50 || star.x > w + 50 ||
                star.y < -50 || star.y > h + 50) {
                shootingStars.splice(i, 1);
                continue;
            }

            // Performance: Draw trail as batched path instead of many segments
            const trail = star.trail;
            const trailLen = trail.length;
            if (trailLen > 1) {
                // Draw in batches based on preset (uses trailBatchCount)
                const batchCount = Math.min(trailBatchCount, trailLen - 1);
                const segPerBatch = Math.ceil((trailLen - 1) / batchCount);
                
                ctx.strokeStyle = star.color;
                
                for (let b = 0; b < batchCount; b++) {
                    const startIdx = b * segPerBatch;
                    const endIdx = Math.min(startIdx + segPerBatch, trailLen - 1);
                    if (startIdx >= trailLen - 1) break;
                    
                    const avgT = (startIdx + endIdx) * 0.5 / trailLen;
                    const trailAlpha = (1 - avgT) * star.life * 0.8;
                    const trailWidth = star.size * (1 - avgT * 0.7);
                    
                    ctx.globalAlpha = trailAlpha;
                    ctx.lineWidth = trailWidth;
                    ctx.beginPath();
                    ctx.moveTo(trail[startIdx].x, trail[startIdx].y);
                    
                    for (let t = startIdx + 1; t <= endIdx; t++) {
                        ctx.lineTo(trail[t].x, trail[t].y);
                    }
                    ctx.stroke();
                }
            }

            // Draw head glow - combined into single sprite draw
            const sprite = spriteCache[star.color];
            if (sprite) {
                ctx.globalAlpha = star.life * 0.8;
                const headDiameter = star.size * 3.45; // 1.5 * 2.3
                const headOffset = headDiameter * 0.5;
                ctx.drawImage(sprite, star.x - headOffset, star.y - headOffset, headDiameter, headDiameter);
            }

            // White core
            if (whiteSprite) {
                ctx.globalAlpha = star.life * 0.95;
                const coreDiameter = star.size * 1.61; // 0.7 * 2.3
                const coreOffset = coreDiameter * 0.5;
                ctx.drawImage(whiteSprite, star.x - coreOffset, star.y - coreOffset, coreDiameter, coreDiameter);
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
    }

    drawNovaFlashes() {
        const ctx = this.ctx;
        const novas = this.novaFlashes;
        const enableRays = this.activePreset.enableNovaRays;
        
        ctx.globalCompositeOperation = 'screen';

        for (let i = novas.length - 1; i >= 0; i--) {
            const nova = novas[i];

            // Expand radius quickly at first, then slow
            nova.radius += (nova.maxRadius - nova.radius) * 0.15;
            nova.brightness -= nova.decay;

            if (nova.brightness <= 0) {
                novas.splice(i, 1);
                continue;
            }

            // Performance: Use sprite-based glow instead of gradient when possible
            const sprite = this.spriteCache[nova.color];
            const whiteSprite = this.spriteCache['#ffffff'];
            
            if (sprite) {
                // Outer glow using sprite
                ctx.globalAlpha = nova.brightness * 0.5;
                const glowDiameter = nova.radius * 2;
                const glowOffset = glowDiameter * 0.5;
                ctx.drawImage(sprite, nova.x - glowOffset, nova.y - glowOffset, glowDiameter, glowDiameter);
            }

            if (whiteSprite) {
                // Bright center using white sprite
                ctx.globalAlpha = nova.brightness * 0.8;
                const coreDiameter = nova.radius * 0.6;
                const coreOffset = coreDiameter * 0.5;
                ctx.drawImage(whiteSprite, nova.x - coreOffset, nova.y - coreOffset, coreDiameter, coreDiameter);
            }

            // Star-like rays - only for bright flashes (uses preset toggle)
            if (enableRays && nova.brightness > 0.4) {
                ctx.strokeStyle = '#ffffff';
                ctx.globalAlpha = nova.brightness * 0.6;
                ctx.lineWidth = 2;

                const rayLength = nova.radius * 0.8;
                // Pre-calculated angles for 4 rays at 45° intervals
                const cos45 = 0.7071;
                
                ctx.beginPath();
                // Draw all 4 rays in a single path
                ctx.moveTo(nova.x, nova.y);
                ctx.lineTo(nova.x + cos45 * rayLength, nova.y + cos45 * rayLength);
                ctx.moveTo(nova.x, nova.y);
                ctx.lineTo(nova.x - cos45 * rayLength, nova.y + cos45 * rayLength);
                ctx.moveTo(nova.x, nova.y);
                ctx.lineTo(nova.x - cos45 * rayLength, nova.y - cos45 * rayLength);
                ctx.moveTo(nova.x, nova.y);
                ctx.lineTo(nova.x + cos45 * rayLength, nova.y - cos45 * rayLength);
                ctx.stroke();
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    updateStarRipples() {
        const ctx = this.ctx;
        const ripples = this.starRipples;
        const maxDim = Math.max(this.canvas.width, this.canvas.height);
        
        // Process ripples and boost star brightness
        for (let i = ripples.length - 1; i >= 0; i--) {
            const ripple = ripples[i];

            ripple.radius += ripple.speed;
            ripple.life -= ripple.decay;

            if (ripple.life <= 0 || ripple.radius > maxDim) {
                ripples.splice(i, 1);
                continue;
            }

            // Boost brightness of stars within the ripple ring
            const halfWidth = ripple.width * 0.5;
            const innerRadius = ripple.radius - halfWidth;
            const outerRadius = ripple.radius + halfWidth;
            const outerRadiusSq = outerRadius * outerRadius;
            const innerRadiusSq = innerRadius * innerRadius;
            const ringCenter = ripple.radius;
            const lifeFactor = ripple.life * 1.5;
            const invHalfWidth = 1 / halfWidth;

            // Performance: Use spatial grid to only check nearby stars
            const nearbyStars = this.getStarsInRadius(ripple.x, ripple.y, outerRadius);
            const nearbyCount = nearbyStars.length;
            
            for (let j = 0; j < nearbyCount; j++) {
                const star = nearbyStars[j];
                const dx = star.x - ripple.x;
                const dy = star.y - ripple.y;
                const distSq = dx * dx + dy * dy;

                // Quick squared distance check (avoids sqrt for most stars)
                if (distSq < innerRadiusSq || distSq > outerRadiusSq) continue;
                
                const dist = Math.sqrt(distSq);

                // Calculate how centered the star is in the ring
                const distFromCenter = dist - ringCenter;
                const absDistFromCenter = distFromCenter < 0 ? -distFromCenter : distFromCenter;
                const intensity = 1 - (absDistFromCenter * invHalfWidth);
                const boost = intensity * lifeFactor;

                // Temporarily boost the star's brightness
                if (boost > star.rippleBoost) {
                    star.rippleBoost = boost;
                }
            }

            // Draw the ripple ring itself (subtle)
            ctx.strokeStyle = `rgba(255, 200, 150, ${ripple.life * 0.15})`;
            ctx.lineWidth = ripple.width * 0.3;
            ctx.beginPath();
            ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Performance: Decay ripple boost on stars using for loop
        const stars = this.stars;
        const starCount = stars.length;
        for (let i = 0; i < starCount; i++) {
            const star = stars[i];
            if (star.rippleBoost > 0) {
                star.rippleBoost *= 0.92;
                if (star.rippleBoost < 0.01) star.rippleBoost = 0;
            }
        }
    }

    drawVignette() {
        // Uses preset toggle for vignette effect
        if (this.activePreset.enableVignette && this.cachedGradients.vignette) {
            this.ctx.fillStyle = this.cachedGradients.vignette;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    drawChromaticAberration() {
        if (this.chromaticAberration <= 0) return;

        const offset = this.chromaticAberration * 0.8;
        const intensity = Math.min(this.chromaticAberration / 10, 0.12);

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.fillStyle = `rgba(255, 80, 50, ${intensity})`;
        this.ctx.fillRect(-offset, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = `rgba(80, 50, 255, ${intensity})`;
        this.ctx.fillRect(offset, 0, this.canvas.width, this.canvas.height);

        if (this.chromaticAberration > 4) {
            this.ctx.globalCompositeOperation = 'lighten';
            this.ctx.fillStyle = `rgba(255, 255, 255, ${(this.chromaticAberration - 4) * 0.025})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.restore();
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
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;

        // Reset any ripple boost on stars
        this.stars.forEach((star) => {
            star.rippleBoost = 0;
        });
    }

    getTetrominoConfig() {
        return GEODE_TETROMINOS;
    }
}

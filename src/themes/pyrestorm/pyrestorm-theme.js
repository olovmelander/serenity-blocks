import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { PYRESTORM_TETROMINOS } from './pyrestorm-tetrominos.js';

export default class PyrestormTheme extends BaseTheme {
    constructor() {
        super('pyrestorm');

        // Canvas & Context
        this.canvas = null;
        this.ctx = null;
        this.width = 0;
        this.height = 0;

        // Animation Loop
        this.animationFrameId = null;
        this.lastTime = 0;
        this.time = 0; // Global animation time

        // Game State
        this.comboCount = 0;
        this.intensity = 0; // 0 to 1, based on game pace/combo
        this.shake = 0; // Screen shake intensity

        // Visual Elements
        this.bgMountainPoints = []; // Distant mountains
        this.mountainPoints = [];   // Foreground mountains
        this.lavaPaths = [];        // River path data

        // Particle Systems
        this.riverParticles = [];   // Floating lava chunks (fluid)
        this.particles = [];        // Standard air particles (embers, smoke)
        this.sparkles = [];         // High-priority combo sparkles
        this.geysers = [];          // Vertical lava eruptions
        this.lightningBolts = [];   // Lightning

        this.lightningTimer = 0;
        this.lightningFlash = 0;

        // Graphics quality
        this.qualityChangeHandler = null;
        this.currentQuality = 'Extreme';

        // Graphical Presets - Enhanced visuals across all quality levels
        this.qualityPresets = {
            Minimum: {
                maxParticles: 40,
                enableRiverParticles: true,
                enableSparkles: true,
                enableGeysers: false,
                enableLightning: true,
                enableShake: true,
                bgMountainDetail: 3,
                fgMountainDetail: 4,
                riverDetail: 15,
                shadows: false,
                // Effect multipliers - increased for better combo effects
                effectMultiplier: 0.25,
                explosionMultiplier: 0.3,
                sparkleMultiplier: 0.2,
                geyserMultiplier: 0,
                ambientSpawnRate: 1.0,
                smokeRate: 0.04,
                // River quality settings
                riverLayers: 2,
                riverGlow: false,
                riverAnimation: true,
                riverWidthMult: 0.7,
                riverBrightness: 0.5
            },
            Low: {
                maxParticles: 80,
                enableRiverParticles: true,
                enableSparkles: true,
                enableGeysers: false,
                enableLightning: true,
                enableShake: true,
                bgMountainDetail: 3,
                fgMountainDetail: 5,
                riverDetail: 20,
                shadows: false,
                effectMultiplier: 0.35,
                explosionMultiplier: 0.4,
                sparkleMultiplier: 0.3,
                geyserMultiplier: 0.15,
                ambientSpawnRate: 1.3,
                smokeRate: 0.05,
                riverLayers: 3,
                riverGlow: true,
                riverAnimation: true,
                riverWidthMult: 0.8,
                riverBrightness: 0.6
            },
            Medium: {
                maxParticles: 150,
                enableRiverParticles: true,
                enableSparkles: true,
                enableGeysers: true,
                enableLightning: true,
                enableShake: true,
                bgMountainDetail: 4,
                fgMountainDetail: 7,
                riverDetail: 30,
                shadows: false,
                effectMultiplier: 0.5,
                explosionMultiplier: 0.55,
                sparkleMultiplier: 0.45,
                geyserMultiplier: 0.3,
                ambientSpawnRate: 1.8,
                smokeRate: 0.07,
                riverLayers: 4,
                riverGlow: true,
                riverAnimation: true,
                riverWidthMult: 0.9,
                riverBrightness: 0.7
            },
            High: {
                maxParticles: 300,
                enableRiverParticles: true,
                enableSparkles: true,
                enableGeysers: true,
                enableLightning: true,
                enableShake: true,
                bgMountainDetail: 5,
                fgMountainDetail: 10,
                riverDetail: 45,
                shadows: true,
                effectMultiplier: 0.7,
                explosionMultiplier: 0.75,
                sparkleMultiplier: 0.65,
                geyserMultiplier: 0.55,
                ambientSpawnRate: 2.2,
                smokeRate: 0.1,
                riverLayers: 5,
                riverGlow: true,
                riverAnimation: true,
                riverWidthMult: 1.0,
                riverBrightness: 0.85
            },
            Ultra: {
                maxParticles: 550,
                enableRiverParticles: true,
                enableSparkles: true,
                enableGeysers: true,
                enableLightning: true,
                enableShake: true,
                bgMountainDetail: 6,
                fgMountainDetail: 14,
                riverDetail: 65,
                shadows: true,
                effectMultiplier: 0.9,
                explosionMultiplier: 0.95,
                sparkleMultiplier: 0.85,
                geyserMultiplier: 0.8,
                ambientSpawnRate: 2.8,
                smokeRate: 0.13,
                riverLayers: 6,
                riverGlow: true,
                riverAnimation: true,
                riverWidthMult: 1.2,
                riverBrightness: 0.95
            },
            Extreme: {
                maxParticles: 900,
                enableRiverParticles: true,
                enableSparkles: true,
                enableGeysers: true,
                enableLightning: true,
                enableShake: true,
                bgMountainDetail: 7,
                fgMountainDetail: 18,
                riverDetail: 90,
                shadows: true,
                effectMultiplier: 1.2,
                explosionMultiplier: 1.2,
                sparkleMultiplier: 1.2,
                geyserMultiplier: 1.2,
                ambientSpawnRate: 3.5,
                smokeRate: 0.18,
                riverLayers: 7,
                riverGlow: true,
                riverAnimation: true,
                riverWidthMult: 1.4,
                riverBrightness: 1.0
            }
        };

        // Current Quality Setting
        this.config = this.qualityPresets[this.currentQuality];

        // Colors (Static across presets)
        this.colors = {
            mountain: '#120202',
            skyTop: '#050000',
            skyBottom: '#2d0a0a',
            lava: '#ff4500',
            ember: '#ffaa00',
        };

        // Bind methods
        this.handleResize = this.handleResize.bind(this);
        this.animate = this.animate.bind(this);
    }

    /**
     * Initialize the theme
     */
    async createScene() {
        // 1. Setup Container
        const container = this.getContainer('pyrestorm-theme');
        if (!container) return;

        // Clear any existing DOM elements
        container.innerHTML = '';
        container.style.background = '#000';
        container.style.overflow = 'hidden';

        // 2. Create Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '1';
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d', { alpha: false });

        // 3. Initial Resize & Setup
        this.handleResize();
        window.addEventListener('resize', this.handleResize);

        // 4. Apply quality preset and setup listener
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // 5. Setup Event Listeners
        this.setupEventListeners();

        // 6. Start Animation
        this.isActive = true;
        this.lastTime = performance.now();
        this.animate(this.lastTime);

        console.log(`🔥 Pyrestorm: Inferno Engine 2.5.4 Started [Quality: ${this.currentQuality}]`);
    }

    // Quality system methods
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[Pyrestorm] Unknown preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.config = this.qualityPresets[quality];

        // Trim existing particle arrays to new limits
        this.trimEffectCollections();

        // Re-generate static elements with new detail settings
        this.generateMountains();

        console.log(`🔥 Pyrestorm: Applied ${quality} graphics preset`);
    }

    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (!collection || typeof limit !== 'number' || limit <= 0) return;
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        clamp(this.particles, this.config.maxParticles);
        clamp(this.sparkles, Math.round(20 * this.config.sparkleMultiplier));
        clamp(this.riverParticles, Math.round(100 * this.config.effectMultiplier));
        clamp(this.geysers, 5);
        clamp(this.lightningBolts, 3);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
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

    setupEventListeners() {
        // Line Clear - Bursts of fire & sparkles (scaled by quality)
        this.onLineClear = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            const count = data.lines || data.count || 1;
            const mult = this.config.effectMultiplier;

            this.triggerExplosion(count);

            if (this.config.enableSparkles && this.config.sparkleMultiplier > 0) {
                // Scale sparkles: base of 2-4 per line, scaled by multiplier
                const sparkleCount = Math.max(1, Math.round((2 + count) * this.config.sparkleMultiplier));
                this.triggerSparkles(sparkleCount);
            }

            // Scale intensity gain by quality
            this.intensity = Math.min(1, this.intensity + 0.15 * count * (0.5 + mult * 0.5));

            if (this.config.enableShake) {
                // Scale shake: 2-6 per line based on quality
                this.shake += count * (2 + mult * 4);
            }
        });

        // Combo - Increasing heat, lightning, and geysers (heavily scaled)
        this.onCombo = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            const count = data.combo || data.count || 0;
            this.comboCount = count;
            const mult = this.config.effectMultiplier;

            if (count > 0) {
                // Scale intensity gain
                this.intensity = Math.min(1, this.intensity + 0.1 * count * (0.5 + mult * 0.5));

                if (this.config.enableShake) {
                    // Much reduced shake for combos
                    this.shake += count * (1 + mult * 2);
                }

                if (this.config.enableSparkles && this.config.sparkleMultiplier > 0) {
                    // Very limited sparkles on combo - max 3-8 based on quality
                    const sparkleCount = Math.max(1, Math.round((1 + count * 0.5) * this.config.sparkleMultiplier));
                    this.triggerSparkles(Math.min(sparkleCount, 8));
                }

                // Only trigger expensive effects on higher combos and quality
                if (count > 1) { // Lowered threshold for visibility
                    if (this.config.enableLightning && mult >= 0.15 && count > 2) {
                        this.triggerLightning(count);
                    }
                    if (this.config.enableGeysers && this.config.geyserMultiplier > 0) {
                        // Try to spawn geyser from a river
                        let geyserX = null;
                        if (this.lavaPaths.length > 0) {
                            const randomPath = this.lavaPaths[Math.floor(Math.random() * this.lavaPaths.length)];
                            if (randomPath.pathPoints && randomPath.pathPoints.length > 0) {
                                // Pick a random point on the river
                                const pt = randomPath.pathPoints[Math.floor(Math.random() * randomPath.pathPoints.length)];
                                geyserX = pt.x;
                            }
                        }
                        this.triggerGeyser(count, geyserX);
                    }
                }

                // --- RIVER COMBO EFFECTS ---
                // 1. Surge: Boost river intensity and flow
                this.lavaPaths.forEach(path => {
                    path.surgeIntensity = Math.min(2.0, (path.surgeIntensity || 0) + count * 0.3);
                });

                // 2. Magma Burst: Spawn fresh hot magma particles in the rivers
                if (this.config.enableRiverParticles) {
                    // Significantly increased burst count for visibility
                    const burstCount = Math.min(40, count * 8);
                    this.lavaPaths.forEach((path, index) => {
                        for (let i = 0; i < burstCount; i++) {
                            this.riverParticles.push({
                                pathIndex: index,
                                progress: Math.random() * 0.2, // Spawn strictly at top
                                baseSpeed: 0.1 + Math.random() * 0.1, // Much faster
                                size: path.baseWidth * (0.6 + Math.random() * 0.8) * mult, // Larger
                                type: 'magma', // Always hot magma
                                colorType: 0.9 + Math.random() * 0.1, // Pure white-hot
                                offset: (Math.random() - 0.5) * path.baseWidth * 0.8,
                                lateralDrift: (Math.random() - 0.5) * 0.2,
                                wobblePhase: Math.random() * Math.PI * 2,
                                wobbleSpeed: 2.0 + Math.random() * 2.0,
                                wobbleAmplitude: 0.2,
                                pulsePhase: Math.random() * Math.PI * 2,
                                rotation: Math.random() * Math.PI * 2,
                                rotationSpeed: (Math.random() - 0.5) * 0.5,
                                stretch: 0.8 + Math.random() * 0.4
                            });
                        }
                    });
                }
            }
        });
    }

    handleResize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.generateMountains();
    }

    getBezierPoints(p0, p1, p2, p3, steps = 50) {
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;

            const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
            const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;
            points.push({ x, y });
        }
        return points;
    }

    generateMountains() {
        this.bgMountainPoints = [];
        this.mountainPoints = [];
        this.lavaPaths = [];
        this.riverParticles = [];

        // --- 1. Background Mountains ---
        const bgPeakCount = this.config.bgMountainDetail;
        const bgStep = this.width / bgPeakCount;
        this.bgMountainPoints.push({ x: 0, y: this.height });
        this.bgMountainPoints.push({ x: 0, y: this.height * 0.65 });

        for (let i = 1; i <= bgPeakCount; i++) {
            const x = i * bgStep;
            const y = this.height * (0.55 + Math.random() * 0.15);
            const midX = x - bgStep / 2;
            const midY = (this.bgMountainPoints[this.bgMountainPoints.length - 1].y + y) / 2 + (Math.random() - 0.5) * 30;

            this.bgMountainPoints.push({ x: midX, y: midY });
            this.bgMountainPoints.push({ x: x, y: y });
        }
        this.bgMountainPoints.push({ x: this.width, y: this.height });


        // --- 2. Foreground Mountains ---
        const peakCount = this.config.fgMountainDetail;
        const step = this.width / peakCount;
        this.mountainPoints.push({ x: 0, y: this.height });
        this.mountainPoints.push({ x: 0, y: this.height * 0.65 });

        for (let i = 1; i <= peakCount; i++) {
            const x = i * step;
            const y = this.height * (0.55 + Math.random() * 0.3);

            const midX = x - step / 2;
            const midY = (this.mountainPoints[this.mountainPoints.length - 1].y + y) / 2 + (Math.random() - 0.5) * 120;

            this.mountainPoints.push({ x: midX, y: midY });
            this.mountainPoints.push({ x: x, y: y });

            // --- Magma Rivers ---
            // Reduce river frequency on lower settings
            const riverChance = this.currentQuality === 'Minimum' ? 0.1 : 0.25;

            if (Math.random() > (1 - riverChance)) {
                // Offset start position slightly down the slope for natural emergence
                const slopeOffset = 8 + Math.random() * 15;
                const startX = x + (Math.random() - 0.5) * 20;
                const startY = y + slopeOffset;

                // Create more organic flow path with multiple direction changes
                const flowDirection = Math.random() > 0.5 ? 1 : -1;
                const cp1x = startX + flowDirection * (30 + Math.random() * 60);
                const cp1y = startY + (this.height - startY) * (0.25 + Math.random() * 0.15);
                const cp2x = startX + flowDirection * (Math.random() - 0.3) * 180;
                const cp2y = startY + (this.height - startY) * (0.6 + Math.random() * 0.2);
                const endX = startX + (Math.random() - 0.5) * 350;
                const endY = this.height + 50;

                const pathPoints = this.getBezierPoints(
                    { x: startX, y: startY },
                    { x: cp1x, y: cp1y },
                    { x: cp2x, y: cp2y },
                    { x: endX, y: endY },
                    this.config.riverDetail
                );

                // Calculate slope steepness at each point for speed variation
                const slopeData = [];
                for (let j = 0; j < pathPoints.length - 1; j++) {
                    const dx = pathPoints[j + 1].x - pathPoints[j].x;
                    const dy = pathPoints[j + 1].y - pathPoints[j].y;
                    const steepness = Math.abs(dy) / (Math.abs(dx) + 1);
                    slopeData.push(Math.min(2, 0.5 + steepness * 0.5));
                }
                slopeData.push(slopeData[slopeData.length - 1] || 1);

                this.lavaPaths.push({
                    startX, startY,
                    cp1x, cp1y,
                    cp2x, cp2y,
                    endX, endY,
                    baseWidth: 5 + Math.random() * 10,
                    pathPoints: pathPoints,
                    slopeData: slopeData,
                    // Source pool properties for natural emergence
                    sourceSize: 12 + Math.random() * 18,
                    sourcePhase: Math.random() * Math.PI * 2,
                    bubblePhase: Math.random() * Math.PI * 2,
                    // Flow animation properties
                    flowOffset: Math.random() * 1000,
                    flowSpeed: 2 + Math.random() * 2, // Reduced speed slightly
                    surgeIntensity: 0 // Initialize surge
                });

                // Pre-populate river with particles so it flows all the way down immediately
                if (this.config.enableRiverParticles) {
                    const particleCount = Math.floor(pathPoints.length * (0.5 + this.config.effectMultiplier * 0.5));
                    for (let k = 0; k < particleCount; k++) {
                        const progress = Math.random();
                        const isCrust = Math.random() < 0.6;
                        this.riverParticles.push({
                            pathIndex: this.lavaPaths.length - 1,
                            progress: progress,
                            baseSpeed: 0.04 + Math.random() * 0.05 + this.intensity * 0.02,
                            size: (5 + Math.random() * 10) * (isCrust ? 1.0 : 0.8) * this.config.effectMultiplier,
                            type: isCrust ? 'crust' : 'magma',
                            colorType: Math.random(),
                            offset: (Math.random() - 0.5) * pathPoints[0].x * 0.0 // Placeholder, updated in loop
                                + (Math.random() - 0.5) * 10, // Initial random offset
                            lateralDrift: (Math.random() - 0.5) * 0.2,
                            wobblePhase: Math.random() * Math.PI * 2,
                            wobbleSpeed: 1.0 + Math.random() * 2.0,
                            wobbleAmplitude: 0.1 + Math.random() * 0.3,
                            pulsePhase: Math.random() * Math.PI * 2,
                            rotation: Math.random() * Math.PI * 2,
                            rotationSpeed: (Math.random() - 0.5) * 0.5,
                            stretch: 0.8 + Math.random() * 0.4
                        });
                    }
                }
            }
        }
        this.mountainPoints.push({ x: this.width, y: this.height });
    }

    triggerExplosion(strength) {
        // Scale explosion particles using preset multiplier
        const mult = this.config.explosionMultiplier;
        if (mult <= 0) return;

        // Base count scaled: 5-25 particles depending on quality and strength
        const baseCount = 5 + strength * 5;
        const count = Math.max(2, Math.floor(baseCount * mult));

        const centerX = this.width / 2;
        const centerY = this.height * 0.5;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (5 + Math.random() * 15 + strength * 3) * mult;
            this.particles.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                decay: 0.015 + Math.random() * 0.02,
                size: (3 + Math.random() * 5) * (0.5 + mult * 0.5),
                color: Math.random() > 0.3 ? '#ffcc00' : '#ff4500',
                type: 'spark'
            });
        }
    }

    triggerSparkles(count) {
        if (!this.config.enableSparkles || this.config.sparkleMultiplier <= 0) return;

        // Cap sparkle count to prevent performance issues
        const maxSparkles = Math.min(count, 10);
        const mult = this.config.sparkleMultiplier;

        for (let i = 0; i < maxSparkles; i++) {
            this.sparkles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                life: 1.0,
                decay: 0.01 + Math.random() * 0.02, // Faster decay
                size: (2 + Math.random() * 4) * mult,
                color: '#ffffff',
                glowColor: Math.random() > 0.5 ? '#ffd700' : '#ff4500',
                rotation: Math.random() * Math.PI,
                rotSpeed: (Math.random() - 0.5) * 0.08
            });
        }
    }

    triggerGeyser(strength, specificX = null) {
        if (!this.config.enableGeysers || this.config.geyserMultiplier <= 0) return;

        const mult = this.config.geyserMultiplier;
        const x = specificX !== null ? specificX : Math.random() * this.width;
        // Scale height by quality
        // Scale height by quality - taller geysers
        const height = this.height * (0.4 + Math.min(0.5, strength * 0.1)) * mult;

        this.geysers.push({
            x: x,
            y: this.height,
            targetHeight: height,
            currentHeight: 0,
            width: (35 + strength * 15) * mult, // Wider
            life: 1.0,
            decay: 0.015, // Slower decay
            color: '#ff4500'
        });

        // Scale geyser particles by quality: 2-15 particles
        const pCount = Math.max(2, Math.round(5 * mult + strength * mult));

        for (let i = 0; i < pCount; i++) {
            this.particles.push({
                x: x + (Math.random() - 0.5) * 40 * mult,
                y: this.height,
                vx: (Math.random() - 0.5) * 5 * mult,
                vy: (-10 - Math.random() * 10) * mult,
                life: 1.0,
                decay: 0.025,
                size: 3 * mult,
                color: '#ffaa00',
                type: 'spark'
            });
        }
    }

    triggerLightning(combo) {
        if (!this.config.enableLightning) return;

        const mult = this.config.effectMultiplier;

        // Flash intensity scaled by quality
        this.lightningFlash = (0.5 + Math.min(0.4, combo * 0.08)) * (0.5 + mult * 0.5);

        if (this.config.enableShake) {
            // Reduced shake for lightning
            this.shake += (5 + combo) * mult;
        }

        // On Low quality, only do flash (no bolt drawing)
        if (mult < 0.3) return;

        const startX = Math.random() * this.width;
        const endX = startX + (Math.random() - 0.5) * 300 * mult;

        this.lightningBolts.push({
            startX: startX,
            startY: 0,
            endX: endX,
            endY: this.height * (0.5 + mult * 0.3),
            segments: [],
            life: 1.0,
            width: (2 + combo) * mult
        });

        const bolt = this.lightningBolts[this.lightningBolts.length - 1];
        let currX = bolt.startX;
        let currY = bolt.startY;
        // Scale segment count by quality: 4-12 segments
        const steps = Math.max(4, Math.round(8 * mult));
        const dy = (bolt.endY - bolt.startY) / steps;

        bolt.segments.push({ x: currX, y: currY });
        for (let i = 0; i < steps; i++) {
            currX += (bolt.endX - bolt.startX) / steps + (Math.random() - 0.5) * 100 * mult;
            currY += dy + (Math.random() - 0.5) * 30;
            bolt.segments.push({ x: currX, y: currY });
        }
    }

    update(dt) {
        this.time += dt;
        this.intensity = Math.max(0, this.intensity - dt * 0.1);
        this.shake = Math.max(0, this.shake - dt * 15);
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 8);

        const mult = this.config.effectMultiplier;

        // --- Ambient Sparkles (very rare, scaled by quality) ---
        if (this.config.enableSparkles && this.config.sparkleMultiplier > 0) {
            // Only spawn ambient sparkles rarely: 0.5-2% chance per frame
            if (Math.random() < 0.005 * this.config.sparkleMultiplier) {
                this.triggerSparkles(1);
            }
        }

        // --- Update River Particles (Floating Magma Blobs & Crust) ---
        // --- Update River Particles (Floating Magma Blobs & Crust) ---
        if (this.config.enableRiverParticles) {
            // Reduced spawn rate since we pre-populate, just need to maintain flow
            const riverSpawnChance = (0.15 + this.intensity * 0.2) * mult;

            this.lavaPaths.forEach((path, index) => {
                // Decay surge
                path.surgeIntensity = Math.max(0, (path.surgeIntensity || 0) - dt * 0.8);

                // Update river flow offset - accelerated by surge
                const surgeSpeedMult = 1 + (path.surgeIntensity || 0) * 2;
                path.flowOffset += path.flowSpeed * dt * (1 + this.intensity * 0.5) * surgeSpeedMult;

                if (Math.random() < riverSpawnChance) {
                    const baseSpeed = 0.04 + Math.random() * 0.05;
                    // Create clusters
                    const clusterCount = Math.random() < 0.3 ? 2 : 1;

                    for (let c = 0; c < clusterCount; c++) {
                        const isCrust = Math.random() < 0.6;

                        this.riverParticles.push({
                            pathIndex: index,
                            progress: c * 0.005,
                            baseSpeed: baseSpeed + this.intensity * 0.02,
                            size: path.baseWidth * (isCrust ? (0.4 + Math.random() * 0.5) : (0.3 + Math.random() * 0.6)) * mult,
                            type: isCrust ? 'crust' : 'magma',
                            colorType: Math.random(),
                            offset: (Math.random() - 0.5) * path.baseWidth * 0.7,
                            lateralDrift: (Math.random() - 0.5) * 0.2,
                            wobblePhase: Math.random() * Math.PI * 2,
                            wobbleSpeed: 1.0 + Math.random() * 2.0,
                            wobbleAmplitude: 0.1 + Math.random() * 0.3,
                            pulsePhase: Math.random() * Math.PI * 2,
                            rotation: Math.random() * Math.PI * 2,
                            rotationSpeed: (Math.random() - 0.5) * (isCrust ? 0.2 : 0.5),
                            stretch: isCrust ? (0.8 + Math.random() * 0.4) : (0.7 + Math.random() * 0.6)
                        });
                    }
                }
            });

            // Cap river particles - Reduced limit for performance
            const maxRiverParticles = Math.round(100 * mult);
            while (this.riverParticles.length > maxRiverParticles) {
                this.riverParticles.shift();
            }

            for (let i = this.riverParticles.length - 1; i >= 0; i--) {
                const p = this.riverParticles[i];
                const path = this.lavaPaths[p.pathIndex];
                if (!path) {
                    this.riverParticles.splice(i, 1);
                    continue;
                }

                // Get slope multiplier for current position
                const slopeIndex = Math.floor(p.progress * (path.slopeData?.length - 1 || 0));
                const slopeMult = path.slopeData?.[slopeIndex] || 1;

                // Speed varies with slope - faster on steeper sections
                p.progress += p.baseSpeed * slopeMult * dt;

                // Update wobble and rotation for organic movement
                p.wobblePhase += p.wobbleSpeed * dt;
                p.rotation += p.rotationSpeed * dt;

                // Lateral drift
                p.offset += p.lateralDrift * dt;
                const maxOffset = path.baseWidth * 0.65;
                if (Math.abs(p.offset) > maxOffset) {
                    p.lateralDrift *= -0.8;
                    p.offset = Math.sign(p.offset) * maxOffset;
                }

                if (p.progress >= 1) this.riverParticles.splice(i, 1);
            }
        }

        // --- Update Sparkles ---
        for (let i = this.sparkles.length - 1; i >= 0; i--) {
            const s = this.sparkles[i];
            s.x += s.vx;
            s.y += s.vy;
            s.rotation += s.rotSpeed;
            s.life -= s.decay;
            if (s.life <= 0) this.sparkles.splice(i, 1);
        }

        // Cap sparkles to prevent buildup
        const maxSparkles = Math.round(20 * this.config.sparkleMultiplier);
        while (this.sparkles.length > maxSparkles) {
            this.sparkles.shift();
        }

        // --- Update Geysers ---
        for (let i = this.geysers.length - 1; i >= 0; i--) {
            const g = this.geysers[i];
            g.currentHeight += (g.targetHeight - g.currentHeight) * 5 * dt;
            g.life -= g.decay;
            if (g.life <= 0) this.geysers.splice(i, 1);
        }

        // --- Update Air Particles (scaled spawn rate) ---
        const activeParticles = this.config.maxParticles * (1 + this.intensity * 0.5);
        if (this.particles.length < activeParticles) {
            // Spawn rate scaled by config: 0.5-3 base + intensity bonus
            const baseSpawnRate = this.config.ambientSpawnRate;
            const spawnRate = Math.max(1, Math.floor(baseSpawnRate + this.intensity * baseSpawnRate * 2));
            for (let i = 0; i < spawnRate; i++) {
                this.particles.push({
                    x: Math.random() * this.width,
                    y: this.height + 20,
                    vx: (Math.random() - 0.5) * 2,
                    vy: -(1.5 + Math.random() * 3 + this.intensity * 2),
                    life: 1.0,
                    decay: 0.004 + Math.random() * 0.012,
                    size: (1.5 + Math.random() * 3 + this.intensity) * (0.5 + mult * 0.5),
                    color: Math.random() > 0.6 ? '#ffaa00' : '#ff4400',
                    type: 'ember',
                    wobble: Math.random() * Math.PI * 2
                });
            }
        }

        // Smoke frequency scaled by config
        if (Math.random() < this.config.smokeRate + this.intensity * this.config.smokeRate) {
            this.particles.push({
                x: Math.random() * this.width,
                y: this.height + 50,
                vx: (Math.random() - 0.5) * 1.5,
                vy: -(0.8 + Math.random() * 1.5),
                life: 1.0,
                decay: 0.002,
                size: (20 + Math.random() * 30) * (0.5 + mult * 0.5),
                color: '#0a0202',
                type: 'smoke'
            });
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= p.decay;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            if (p.type === 'ember') {
                p.x += p.vx + Math.sin(this.time * 3 + p.wobble) * 0.8;
                p.y += p.vy;
                if (p.life < 0.3) p.size *= 0.95;
            } else if (p.type === 'spark') {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.25;
                p.vx *= 0.96;
            } else if (p.type === 'smoke') {
                p.x += p.vx;
                p.y += p.vy;
                p.size += 0.15;
            }
        }

        // Update Lightning
        for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this.lightningBolts[i];
            bolt.life -= dt * 5;
            if (bolt.life <= 0) this.lightningBolts.splice(i, 1);
        }
    }

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const width = this.width;
        const height = this.height;

        // --- 1. Background (Sky) ---
        // Organic pulsing effect (breathing + flickering)
        const t = this.time;
        const breath = Math.sin(t * 0.8) * 0.5 + 0.5; // Slow breathing
        const flicker = Math.sin(t * 3.5) * 0.3 + Math.sin(t * 8.2) * 0.1; // Fast fire flicker
        // Amplified pulse: stronger base breath, much stronger flicker
        const skyPulse = breath * 0.3 + flicker * 0.15;

        const fireGradient = ctx.createRadialGradient(
            width / 2, height * 1.2, 0,
            width / 2, height * 0.8, height * 1.2
        );

        // Dynamic colors that shift with the pulse - Amplified multipliers
        // Core: Bright orange/yellow, pulsing to white-hot
        const coreG = Math.floor(100 + this.intensity * 80 + Math.max(0, skyPulse * 120));
        const coreA = 0.4 + this.intensity * 0.3 + Math.max(0, skyPulse * 0.3);

        // Mid: Deep red/orange, pulsing brightness
        const midR = Math.floor(200 + Math.max(0, skyPulse * 55));
        const midG = Math.floor(50 + this.intensity * 30 + Math.max(0, skyPulse * 30));
        const midA = 0.3 + this.intensity * 0.2 + Math.max(0, skyPulse * 0.2);

        fireGradient.addColorStop(0, `rgba(255, ${Math.min(255, coreG)}, 0, ${Math.min(1, coreA)})`);
        fireGradient.addColorStop(0.4, `rgba(${Math.min(255, midR)}, ${Math.min(255, midG)}, 0, ${Math.min(1, midA)})`);
        fireGradient.addColorStop(1, '#050000');

        ctx.fillStyle = fireGradient;
        ctx.fillRect(0, 0, width, height);

        if (this.lightningFlash > 0) {
            ctx.fillStyle = `rgba(255, 220, 180, ${this.lightningFlash * 0.4})`;
            ctx.fillRect(0, 0, width, height);
        }

        // --- Screen Shake ---
        let shakeX = 0;
        let shakeY = 0;
        if (this.config.enableShake && this.shake > 0) {
            shakeX = (Math.random() - 0.5) * this.shake;
            shakeY = (Math.random() - 0.5) * this.shake;
            ctx.save();
            ctx.translate(shakeX, shakeY);
        }

        // --- 2. Mountains ---
        // Background
        ctx.beginPath();
        if (this.bgMountainPoints.length > 0) {
            ctx.moveTo(this.bgMountainPoints[0].x, this.bgMountainPoints[0].y);
            for (let i = 1; i < this.bgMountainPoints.length; i++) ctx.lineTo(this.bgMountainPoints[i].x, this.bgMountainPoints[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(20, 5, 5, 0.6)';
        ctx.fill();

        // Foreground
        ctx.beginPath();
        if (this.mountainPoints.length > 0) {
            ctx.moveTo(this.mountainPoints[0].x, this.mountainPoints[0].y);
            for (let i = 1; i < this.mountainPoints.length; i++) ctx.lineTo(this.mountainPoints[i].x, this.mountainPoints[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = '#0a0202';
        ctx.fill();

        // Rim Light
        const rimWidth = 2 + this.comboCount * 1.5 + this.intensity * 5;
        const rimAlpha = 0.3 + Math.min(0.7, this.comboCount * 0.1);
        ctx.strokeStyle = `rgba(255, 80, 0, ${rimAlpha})`;
        ctx.lineWidth = rimWidth;
        if (this.config.shadows) {
            ctx.shadowBlur = 10 + this.comboCount * 5;
            ctx.shadowColor = '#ff4500';
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // --- 3. Magma Rivers (Quality-Scaled Rendering) ---
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        const riverConfig = this.config;
        const riverIntensityBase = 1 + this.intensity + (this.comboCount * 0.15);
        const widthMult = riverConfig.riverWidthMult;
        const brightness = riverConfig.riverBrightness;
        const layers = riverConfig.riverLayers;

        // Animation pulse for higher quality rivers
        const riverPulse = riverConfig.riverAnimation
            ? 0.85 + Math.sin(this.time * 2) * 0.15
            : 1.0;
        const flowPulse = riverConfig.riverAnimation
            ? 0.9 + Math.sin(this.time * 3 + Math.PI) * 0.1
            : 1.0;

        this.lavaPaths.forEach((path, pathIndex) => {
            const surge = path.surgeIntensity || 0;
            const baseWidth = path.baseWidth * widthMult * riverIntensityBase * (1 + surge * 0.2);

            // Surge brightness boost
            const surgeBright = 1 + surge * 0.5;

            // === SOURCE POOL / CRATER at river origin ===
            // Creates a natural-looking emergence point instead of a straight edge
            const sourceSize = (path.sourceSize || 15) * widthMult;
            const sourcePulse = 0.9 + Math.sin(this.time * 2.5 + (path.sourcePhase || 0)) * 0.1;
            const bubblePulse = 0.8 + Math.sin(this.time * 4 + (path.bubblePhase || 0)) * 0.2;

            // Outer crater glow (Medium+ only)
            if (layers >= 3) {
                const craterGlow = ctx.createRadialGradient(
                    path.startX, path.startY - sourceSize * 0.3, 0,
                    path.startX, path.startY - sourceSize * 0.3, sourceSize * 2.5 * sourcePulse
                );
                craterGlow.addColorStop(0, `rgba(255, 80, 0, ${0.4 * brightness})`);
                craterGlow.addColorStop(0.4, `rgba(180, 30, 0, ${0.2 * brightness})`);
                craterGlow.addColorStop(1, 'rgba(80, 0, 0, 0)');
                ctx.fillStyle = craterGlow;
                ctx.beginPath();
                ctx.ellipse(path.startX, path.startY - sourceSize * 0.3, sourceSize * 2.5 * sourcePulse, sourceSize * 1.8 * sourcePulse, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Source pool (all qualities)
            const poolGrad = ctx.createRadialGradient(
                path.startX, path.startY, 0,
                path.startX, path.startY, sourceSize * 1.5
            );
            poolGrad.addColorStop(0, `rgba(255, ${200 + surge * 50}, ${80 + surge * 100}, ${0.9 * brightness * bubblePulse})`);
            poolGrad.addColorStop(0.3, `rgba(255, ${120 + surge * 50}, ${20 + surge * 50}, ${0.7 * brightness})`);
            poolGrad.addColorStop(0.7, `rgba(${200 + surge * 55}, 50, 0, ${0.5 * brightness})`);
            poolGrad.addColorStop(1, 'rgba(100, 20, 0, 0)');
            ctx.fillStyle = poolGrad;
            ctx.beginPath();
            ctx.ellipse(path.startX, path.startY, sourceSize * 1.5, sourceSize * 1.0, 0, 0, Math.PI * 2);
            ctx.fill();

            // Bubbling effect in source (High+ only)
            if (layers >= 4) {
                const bubbleCount = 3;
                for (let b = 0; b < bubbleCount; b++) {
                    const bubbleAngle = this.time * 1.5 + b * (Math.PI * 2 / bubbleCount) + pathIndex;
                    const bubbleR = sourceSize * 0.4 * (0.5 + Math.sin(bubbleAngle * 2) * 0.5);
                    const bubbleX = path.startX + Math.cos(bubbleAngle) * sourceSize * 0.5;
                    const bubbleY = path.startY + Math.sin(bubbleAngle * 0.7) * sourceSize * 0.3;
                    const bubbleAlpha = 0.3 + Math.sin(bubbleAngle * 3) * 0.2;

                    ctx.fillStyle = `rgba(255, 220, 120, ${bubbleAlpha * brightness})`;
                    ctx.beginPath();
                    ctx.arc(bubbleX, bubbleY, bubbleR, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // === RIVER FLOW ===
            // Layer 1: Outer glow (Ultra/Extreme only)
            if (layers >= 5) {
                ctx.beginPath();
                ctx.moveTo(path.startX, path.startY);
                ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
                ctx.lineWidth = baseWidth * 4.0 * riverPulse;
                ctx.strokeStyle = `rgba(80, 0, 0, ${0.15 * brightness})`;
                if (this.config.shadows) {
                    ctx.shadowBlur = 40;
                    ctx.shadowColor = '#ff2200';
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // Layer 2: Wide glow (High+ only)
            if (layers >= 4 && riverConfig.riverGlow) {
                ctx.beginPath();
                ctx.moveTo(path.startX, path.startY);
                ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
                ctx.lineWidth = baseWidth * 3.0 * riverPulse;
                ctx.strokeStyle = `rgba(120, 20, 0, ${0.25 * brightness})`;
                if (this.config.shadows) {
                    ctx.shadowBlur = 25;
                    ctx.shadowColor = '#ff4400';
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // Layer 3: Inner glow (Medium+ only)
            if (layers >= 3 && riverConfig.riverGlow) {
                ctx.beginPath();
                ctx.moveTo(path.startX, path.startY);
                ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
                ctx.lineWidth = baseWidth * 2.0 * flowPulse;
                ctx.strokeStyle = `rgba(180, 40, 0, ${0.4 * brightness})`;
                ctx.stroke();
            }

            // Layer 4: Base lava (all qualities)
            ctx.beginPath();
            ctx.moveTo(path.startX, path.startY);
            ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
            ctx.lineWidth = baseWidth * 1.2;
            ctx.strokeStyle = `rgba(200, 60, 0, ${0.7 * brightness})`;
            ctx.stroke();

            // Layer 5: Hot core (Low+ only)
            if (layers >= 2) {
                ctx.beginPath();
                ctx.moveTo(path.startX, path.startY);
                ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
                ctx.lineWidth = baseWidth * 0.6 * flowPulse;
                ctx.strokeStyle = `rgba(255, 120, 20, ${0.8 * brightness})`;
                ctx.stroke();
            }

            // Layer 6: Brightest center (High+ only)
            if (layers >= 4) {
                ctx.beginPath();
                ctx.moveTo(path.startX, path.startY);
                ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
                ctx.lineWidth = baseWidth * 0.25;
                ctx.strokeStyle = `rgba(255, ${200 + surge * 55}, ${100 + surge * 100}, ${0.6 * brightness * riverPulse})`;
                ctx.stroke();
            }

            // Layer 7: Moving Hot spots along the river (Extreme only)
            if (layers >= 6 && path.pathPoints && path.pathPoints.length > 2) {
                const hotSpotCount = Math.floor(path.pathPoints.length / 6);
                const totalPoints = path.pathPoints.length;

                for (let i = 0; i < hotSpotCount; i++) {
                    // Calculate moving position based on flowOffset
                    const spacing = totalPoints / hotSpotCount;
                    const baseIdx = i * spacing;
                    const flowIdx = (baseIdx + path.flowOffset) % totalPoints;

                    const idx = Math.floor(flowIdx);
                    const nextIdx = (idx + 1) % totalPoints;
                    const sub = flowIdx - idx;

                    const p1 = path.pathPoints[idx];
                    const p2 = path.pathPoints[nextIdx];

                    if (!p1 || !p2) continue;

                    const x = p1.x + (p2.x - p1.x) * sub;
                    const y = p1.y + (p2.y - p1.y) * sub;

                    const hotPulse = 0.5 + Math.sin(this.time * 4 + pathIndex + i) * 0.5;
                    const spotSize = baseWidth * 0.9 * hotPulse;

                    // Hot spot glow
                    const gradient = ctx.createRadialGradient(
                        x, y, 0,
                        x, y, spotSize * 2
                    );
                    gradient.addColorStop(0, `rgba(255, 240, 180, ${0.7 * hotPulse})`);
                    gradient.addColorStop(0.4, `rgba(255, 120, 40, ${0.4 * hotPulse})`);
                    gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');

                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(x, y, spotSize * 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });

        if (this.config.enableRiverParticles) {
            const riverLayers = this.config.riverLayers;

            this.riverParticles.forEach(p => {
                const path = this.lavaPaths[p.pathIndex];
                if (!path || !path.pathPoints || path.pathPoints.length < 2) return;

                const pointCount = path.pathPoints.length;
                const safeProgress = Math.max(0, Math.min(p.progress, 1));
                const floatIndex = safeProgress * (pointCount - 1);
                const index = Math.floor(floatIndex);
                const nextIndex = Math.min(index + 1, pointCount - 1);
                const subProgress = floatIndex - index;

                const p1 = path.pathPoints[index];
                const p2 = path.pathPoints[nextIndex];

                if (!p1 || !p2) return;

                const baseX = p1.x + (p2.x - p1.x) * subProgress;
                const baseY = p1.y + (p2.y - p1.y) * subProgress;

                // Enhanced wobble with variable amplitude
                const wobbleAmp = p.wobbleAmplitude || 0.3;
                const wobbleX = Math.sin(p.wobblePhase) * p.size * wobbleAmp;
                const wobbleY = Math.cos(p.wobblePhase * 0.7) * p.size * wobbleAmp * 0.3;
                const finalX = baseX + p.offset + wobbleX;
                const finalY = baseY + wobbleY;

                // Pulsing size effect
                const pulseFactor = 0.85 + Math.sin(p.wobblePhase * 1.5 + p.pulsePhase) * 0.15;
                const size = p.size * pulseFactor;

                // Get stretch and rotation for elongated blob shape
                const stretch = p.stretch || 1;
                // Save context for rotation
                ctx.save();
                ctx.translate(finalX, finalY);
                ctx.rotate(p.rotation);

                // SIMPLIFIED RENDERING: Use ellipses instead of complex paths
                if (p.type === 'crust') {
                    // --- CRUST PARTICLE (Dark, solid) ---
                    const crustVal = 20 + Math.floor(p.colorType * 30);
                    ctx.fillStyle = `rgb(${crustVal + 20}, ${crustVal}, ${crustVal})`;

                    // Simple ellipse for crust
                    ctx.beginPath();
                    ctx.ellipse(0, 0, size * stretch, size / stretch, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // Simple crack (High+ only)
                    if (riverLayers >= 4) {
                        ctx.strokeStyle = `rgba(255, 60, 0, ${0.4 * pulseFactor})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(-size * 0.4, 0);
                        ctx.lineTo(size * 0.4, 0);
                        ctx.stroke();
                    }

                } else {
                    // --- MAGMA PARTICLE (Bright, glowing) ---
                    let r, g, b;
                    if (p.colorType < 0.5) {
                        r = 255; g = Math.floor(100 + p.colorType * 200); b = 0;
                    } else {
                        r = 255; g = Math.floor(200 + (p.colorType - 0.5) * 110); b = Math.floor((p.colorType - 0.5) * 150);
                    }

                    // Glow (Medium+ quality) - Single layer for performance
                    if (riverLayers >= 3) {
                        ctx.globalAlpha = 0.4;
                        ctx.fillStyle = `rgba(${r}, ${Math.floor(g * 0.5)}, 0, 0.4)`;
                        ctx.beginPath();
                        ctx.ellipse(0, 0, size * 2.0 * stretch, size * 2.0 / stretch, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Core
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, size * stretch, size / stretch, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // Highlight (High+ quality)
                    if (riverLayers >= 4) {
                        ctx.globalAlpha = 0.7 * pulseFactor;
                        ctx.fillStyle = `rgba(255, 255, ${150 + Math.floor(p.colorType * 100)}, 0.8)`;
                        ctx.beginPath();
                        ctx.ellipse(0, 0, size * 0.4 * stretch, size * 0.4 / stretch, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                ctx.restore();
            });
        }
        ctx.restore();

        // --- 4. Geysers ---
        if (this.config.enableGeysers) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            this.geysers.forEach(g => {
                const grad = ctx.createLinearGradient(g.x, this.height, g.x, this.height - g.currentHeight);
                // Brighter core for visibility against lava
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.3, '#ffaa00');
                grad.addColorStop(0.7, '#ff4500');
                grad.addColorStop(1, 'rgba(255, 69, 0, 0)');

                ctx.fillStyle = grad;
                ctx.globalAlpha = g.life;
                ctx.fillRect(g.x - g.width / 2, this.height - g.currentHeight, g.width, g.currentHeight);
            });
            ctx.restore();
        }

        // --- 5. Particles ---
        ctx.save();
        // Smoke
        this.particles.forEach(p => {
            if (p.type !== 'smoke') return;
            ctx.globalAlpha = p.life * 0.5;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        // Fire/Sparks
        ctx.globalCompositeOperation = 'lighter';
        this.particles.forEach(p => {
            if (p.type === 'smoke') return;
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            if (p.type === 'spark' && this.config.shadows) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = p.color;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // Sparkles (High Priority)
        if (this.config.enableSparkles) {
            this.sparkles.forEach(s => {
                ctx.globalAlpha = s.life;
                ctx.fillStyle = s.color;
                if (this.config.shadows) {
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = s.glowColor;
                }

                ctx.save();
                ctx.translate(s.x, s.y);
                ctx.rotate(s.rotation);

                // Draw star shape
                ctx.beginPath();
                const spikes = 4;
                const outerRadius = s.size * 2;
                const innerRadius = s.size * 0.5;
                for (let i = 0; i < spikes * 2; i++) {
                    const r = (i % 2 === 0) ? outerRadius : innerRadius;
                    const a = (Math.PI * i) / spikes;
                    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                ctx.shadowBlur = 0;
            });
        }

        // Lightning
        if (this.config.enableLightning) {
            this.lightningBolts.forEach(bolt => {
                ctx.globalAlpha = bolt.life;
                ctx.strokeStyle = '#fff5cc';
                ctx.lineWidth = bolt.width;
                if (this.config.shadows) {
                    ctx.shadowBlur = 20;
                    ctx.shadowColor = '#ffaa00';
                }
                ctx.beginPath();
                if (bolt.segments.length > 0) {
                    ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y);
                    for (let i = 1; i < bolt.segments.length; i++) ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y);
                }
                ctx.stroke();
            });
        }

        ctx.restore();

        if (this.config.enableShake && this.shake > 0) ctx.restore();
    }

    animate(timestamp) {
        if (!this.isActive) return;
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        const safeDt = Math.min(dt, 0.1);
        this.update(safeDt);
        this.draw();
        this.animationFrameId = requestAnimationFrame(this.animate);
    }

    stop() {
        this.isActive = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.onLineClear) this.onLineClear();
        if (this.onCombo) this.onCombo();
        this.teardownQualityListener();
        window.removeEventListener('resize', this.handleResize);
        if (this.canvas) {
            this.canvas.remove();
            this.canvas = null;
        }
        super.stop();
    }

    getTetrominoConfig() {
        return PYRESTORM_TETROMINOS;
    }
}

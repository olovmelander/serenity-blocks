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

        // Gameplay reactive elements
        this.energyPulses = [];
        this.crystalResonance = [];
        this.floorRipples = [];

        // Visual state
        this.comboMultiplier = 1.0;
        this.pulseIntensity = 0.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        this.crystalShakeIntensity = 0;

        // Performance limits (default to Medium)
        this.wallCount = 6;
        this.stalactiteCount = 8;
        this.stalagmiteCount = 12;
        this.mistCount = 10;
        this.crystalClusterCount = 12;
        this.ambientGlowCount = 8;
        this.maxDustParticles = 40;
        this.maxLightRays = 8;
        this.maxEnergyPulses = 15;

        // Cached gradients
        this.cachedGradients = {};

        // Event tracking
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        this.qualityPresets = {
            Minimal: {
                wallCount: 2,
                stalactiteCount: 2,
                stalagmiteCount: 4,
                mistCount: 4,
                crystalClusterCount: 4,
                ambientGlowCount: 3,
                maxDustParticles: 15,
                maxLightRays: 2,
                maxEnergyPulses: 5,
            },
            Low: {
                wallCount: 4,
                stalactiteCount: 4,
                stalagmiteCount: 6,
                mistCount: 6,
                crystalClusterCount: 7,
                ambientGlowCount: 5,
                maxDustParticles: 25,
                maxLightRays: 4,
                maxEnergyPulses: 8,
            },
            Medium: {
                wallCount: 6,
                stalactiteCount: 8,
                stalagmiteCount: 12,
                mistCount: 10,
                crystalClusterCount: 12,
                ambientGlowCount: 8,
                maxDustParticles: 40,
                maxLightRays: 8,
                maxEnergyPulses: 15,
            },
            High: {
                wallCount: 8,
                stalactiteCount: 12,
                stalagmiteCount: 16,
                mistCount: 14,
                crystalClusterCount: 16,
                ambientGlowCount: 10,
                maxDustParticles: 55,
                maxLightRays: 12,
                maxEnergyPulses: 22,
            },
            Ultra: {
                wallCount: 10,
                stalactiteCount: 16,
                stalagmiteCount: 20,
                mistCount: 18,
                crystalClusterCount: 22,
                ambientGlowCount: 14,
                maxDustParticles: 70,
                maxLightRays: 16,
                maxEnergyPulses: 30,
            },
            Extreme: {
                wallCount: 14,
                stalactiteCount: 22,
                stalagmiteCount: 27,
                mistCount: 24,
                crystalClusterCount: 30,
                ambientGlowCount: 19,
                maxDustParticles: 95,
                maxLightRays: 22,
                maxEnergyPulses: 40,
            },
        };
        this.currentQuality = 'Medium';
        this.activePreset = this.qualityPresets.Medium;
        this.applyQualityPreset('Medium');
    }

    applyQualityPreset(quality) {
        const preset = this.qualityPresets[quality] ?? this.qualityPresets.Medium;
        this.currentQuality = quality in this.qualityPresets ? quality : 'Medium';
        this.activePreset = preset;

        this.wallCount = preset.wallCount;
        this.stalactiteCount = preset.stalactiteCount;
        this.stalagmiteCount = preset.stalagmiteCount;
        this.mistCount = preset.mistCount;
        this.crystalClusterCount = preset.crystalClusterCount;
        this.ambientGlowCount = preset.ambientGlowCount;
        this.maxDustParticles = preset.maxDustParticles;
        this.maxLightRays = preset.maxLightRays;
        this.maxEnergyPulses = preset.maxEnergyPulses;

        console.log(`💎 Geode: Applying ${this.currentQuality} quality preset`);
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
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            this.canvas.style.zIndex = '1';
            themeContainer.appendChild(this.canvas);
        }

        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
        });

        // CRITICAL: Set canvas size BEFORE creating elements
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Clear all existing scene elements to prevent duplicates
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
        this.energyPulses = [];
        this.crystalResonance = [];
        this.floorRipples = [];

        this.cacheGradients();

        // Initialize scene elements in order (back to front)
        this.createCaveStructure();
        this.createCaveFloor();
        this.createRockFormations();
        this.createStalagmites();
        this.createCrystalClusters();
        this.createMist();
        this.createDustParticles();
        this.createLightRays();
        this.createAmbientGlows();

        this.setupEventListeners();
        this.animate();
    }

    cacheGradients() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        // Deep cave background gradient - more natural with multiple centers
        const bgGradient = this.ctx.createRadialGradient(
            w * 0.4,
            h * 0.3,
            0,
            w / 2,
            h / 2,
            Math.max(w, h) * 0.7,
        );
        bgGradient.addColorStop(0, 'hsla(270, 35%, 10%, 1)');
        bgGradient.addColorStop(0.3, 'hsla(265, 30%, 8%, 1)');
        bgGradient.addColorStop(0.6, 'hsla(275, 25%, 6%, 1)');
        bgGradient.addColorStop(1, 'hsla(280, 20%, 4%, 1)');
        this.cachedGradients.background = bgGradient;
    }

    createCaveStructure() {
        // Create cave walls for depth and structure
        const wallCount = this.wallCount ?? 6;
        for (let i = 0; i < wallCount; i++) {
            const side = i < wallCount / 2 ? 'left' : 'right';
            const x = side === 'left' ? Math.random() * this.canvas.width * 0.15 : this.canvas.width * 0.85 + Math.random() * this.canvas.width * 0.15;
            const y = Math.random() * this.canvas.height;
            const width = Math.random() * 100 + 80;
            const height = Math.random() * 200 + 150;

            this.caveWalls.push({
                x,
                y,
                baseX: x,
                baseY: y,
                width,
                height,
                side,
                roughness: Math.random() * 20 + 10,
                baseRoughness: Math.random() * 20 + 10,
                hue: Math.random() * 20 + 260, // Purple-blue range
                // Slow breathing movement
                breathPhase: Math.random() * Math.PI * 2,
                breathSpeed: Math.random() * 0.0003 + 0.0001,
                breathAmplitude: Math.random() * 8 + 3,
            });
        }

        // Create stalactites from ceiling
        const stalactiteCount = this.stalactiteCount ?? 8;
        for (let i = 0; i < stalactiteCount; i++) {
            const x = Math.random() * this.canvas.width;
            const length = Math.random() * 150 + 80;
            const width = Math.random() * 40 + 20;

            this.stalactites.push({
                x,
                baseX: x,
                y: 0,
                length,
                width,
                hue: Math.random() * 30 + 260,
                glowIntensity: Math.random() * 0.3 + 0.5,
                // Gentle swaying movement
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: Math.random() * 0.0004 + 0.0002,
                swayAmplitude: Math.random() * 12 + 5,
            });
        }
    }

    createCaveFloor() {
        // Create a natural cave floor with subtle texture
        const floorSegments = 15;
        for (let i = 0; i < floorSegments; i++) {
            const x = (this.canvas.width / floorSegments) * i;
            const y = this.canvas.height * 0.85 + Math.random() * 40 - 20;

            this.caveFloor.push({
                x,
                y,
                baseY: y,
                width: this.canvas.width / floorSegments + 5,
                roughness: Math.random() * 15 + 10,
                hue: Math.random() * 15 + 265,
                // Subtle floor breathing
                breathPhase: Math.random() * Math.PI * 2,
                breathSpeed: Math.random() * 0.0002 + 0.00005,
                breathAmplitude: Math.random() * 3 + 1,
            });
        }
    }

    createRockFormations() {
        // Add natural rock formations on floor and walls
        const rockCount = 20;
        for (let i = 0; i < rockCount; i++) {
            const isFloor = Math.random() > 0.3;
            const x = Math.random() * this.canvas.width;
            const y = isFloor
                ? this.canvas.height * 0.8 + Math.random() * this.canvas.height * 0.15
                : Math.random() * this.canvas.height * 0.7;

            const size = Math.random() * 60 + 30;
            const aspectRatio = Math.random() * 0.4 + 0.6;

            this.rockFormations.push({
                x,
                y,
                baseX: x,
                baseY: y,
                width: size,
                height: size * aspectRatio,
                hue: Math.random() * 20 + 260,
                roughness: Math.random() * 10 + 5,
                isFloor,
                // Very subtle movement
                floatPhase: Math.random() * Math.PI * 2,
                floatSpeed: Math.random() * 0.0001 + 0.00005,
                floatAmplitude: Math.random() * 2 + 1,
            });
        }
    }

    createStalagmites() {
        // Create stalagmites (growing up from floor) to match stalactites
        const stalagmiteCount = this.stalagmiteCount ?? 12;
        for (let i = 0; i < stalagmiteCount; i++) {
            const x = Math.random() * this.canvas.width;
            const height = Math.random() * 120 + 60;
            const width = Math.random() * 35 + 15;

            this.stalagmites.push({
                x,
                baseX: x,
                y: this.canvas.height,
                height,
                width,
                hue: Math.random() * 30 + 260,
                glowIntensity: Math.random() * 0.3 + 0.5,
                // Subtle swaying
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: Math.random() * 0.0003 + 0.0001,
                swayAmplitude: Math.random() * 8 + 3,
            });
        }
    }

    createMist() {
        // Add low-lying mist for atmosphere
        const mistCount = this.mistCount ?? 10;
        for (let i = 0; i < mistCount; i++) {
            this.mist.push({
                x: Math.random() * this.canvas.width,
                y: this.canvas.height * 0.7 + Math.random() * this.canvas.height * 0.25,
                width: Math.random() * 300 + 150,
                height: Math.random() * 80 + 40,
                opacity: Math.random() * 0.15 + 0.05,
                hue: Math.random() * 30 + 270,
                // Slow drifting
                driftPhase: Math.random() * Math.PI * 2,
                driftSpeed: Math.random() * 0.0002 + 0.00008,
                driftAmplitude: Math.random() * 40 + 20,
                baseX: 0, // Will be set on first update
            });
        }
    }

    createCrystalClusters() {
        // Create natural crystal formations - fewer but more impressive clusters
        const clusterCount = this.crystalClusterCount ?? 12;

        const crystalPalettes = [
            {
                hues: [280, 285, 275, 290], saturation: 65, lightness: [40, 50, 35], name: 'amethyst',
            },
            {
                hues: [190, 195, 185, 200], saturation: 70, lightness: [45, 55, 40], name: 'aquamarine',
            },
            {
                hues: [340, 345, 335, 350], saturation: 60, lightness: [42, 52, 38], name: 'rose-quartz',
            },
            {
                hues: [270, 275, 265, 280], saturation: 55, lightness: [35, 45, 30], name: 'deep-purple',
            },
            {
                hues: [180, 185, 175, 190], saturation: 65, lightness: [38, 48, 33], name: 'cyan-crystal',
            },
            {
                hues: [160, 165, 155, 170], saturation: 75, lightness: [40, 50, 35], name: 'emerald',
            },
        ];

        for (let i = 0; i < clusterCount; i++) {
            const palette = crystalPalettes[Math.floor(Math.random() * crystalPalettes.length)];
            const x = Math.random() * this.canvas.width;
            const y = Math.random() * this.canvas.height;
            const size = Math.random() * 120 + 80;
            const crystalCount = Math.floor(Math.random() * 5) + 3;

            const crystals = [];
            for (let j = 0; j < crystalCount; j++) {
                const angle = (Math.random() * Math.PI) - Math.PI / 2; // Point upward mostly
                const height = Math.random() * size * 0.8 + size * 0.4;
                const width = height * (Math.random() * 0.2 + 0.15);
                const offsetX = (Math.random() - 0.5) * size * 0.6;
                const offsetY = (Math.random() - 0.5) * size * 0.3;
                const hue = palette.hues[Math.floor(Math.random() * palette.hues.length)];

                crystals.push({
                    offsetX,
                    offsetY,
                    baseOffsetX: offsetX,
                    baseOffsetY: offsetY,
                    width,
                    height,
                    angle,
                    baseAngle: angle,
                    hue,
                    saturation: palette.saturation,
                    glowIntensity: Math.random() * 0.5 + 0.7,
                    // Individual crystal subtle movement
                    wobblePhase: Math.random() * Math.PI * 2,
                    wobbleSpeed: Math.random() * 0.0004 + 0.0001,
                    wobbleAmount: Math.random() * 0.03 + 0.01,
                });
            }

            this.crystalClusters.push({
                x,
                y,
                baseX: x, // Store original position
                baseY: y,
                size,
                crystals,
                palette: palette.name,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                baseGlow: Math.random() * 0.3 + 0.6,
                glowIntensity: 1.0,
                // Movement properties
                floatPhase: Math.random() * Math.PI * 2,
                floatSpeedX: Math.random() * 0.0005 + 0.0002,
                floatSpeedY: Math.random() * 0.0008 + 0.0003,
                floatAmplitudeX: Math.random() * 15 + 5,
                floatAmplitudeY: Math.random() * 20 + 8,
                rotationPhase: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.0003,
                rotationAmount: (Math.random() - 0.5) * 0.08,
            });
        }
    }

    createDustParticles() {
        for (let i = 0; i < this.maxDustParticles; i++) {
            this.dustParticles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 2.5 + 0.5,
                opacity: Math.random() * 0.4 + 0.2,
                hue: Math.random() * 60 + 260,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.03 + 0.01,
            });
        }
    }

    createLightRays() {
        for (let i = 0; i < this.maxLightRays; i++) {
            const angle = Math.random() * Math.PI * 2;
            const length = Math.random() * this.canvas.height * 0.8 + this.canvas.height * 0.3;

            this.lightRays.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                angle,
                length,
                width: Math.random() * 2 + 0.5,
                hue: Math.random() * 60 + 260,
                opacity: Math.random() * 0.2 + 0.1,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.02 + 0.005,
                rotationSpeed: (Math.random() - 0.5) * 0.001,
            });
        }
    }

    createAmbientGlows() {
        const glowCount = this.ambientGlowCount ?? 8;
        for (let i = 0; i < glowCount; i++) {
            this.ambientGlows.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                radius: Math.random() * 200 + 100,
                hue: Math.random() * 60 + 260,
                opacity: Math.random() * 0.15 + 0.05,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.015 + 0.005,
            });
        }
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

        window.addEventListener('resize', () => {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.cacheGradients();
        });
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
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.3 * lineCount, 1.5);

        // Make crystals glow and shake
        this.crystalClusters.forEach((cluster) => {
            cluster.glowIntensity = Math.min(cluster.glowIntensity + 0.4, 2.5);
        });

        // Add crystal shake based on combo
        this.crystalShakeIntensity = Math.min(this.crystalShakeIntensity + 0.15 * (1 + comboCount * 0.3), 1.0);

        // Create energy pulse effect
        if (this.energyPulses.length < this.maxEnergyPulses) {
            const sourceCluster = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
            if (sourceCluster) {
                this.energyPulses.push({
                    x: sourceCluster.x,
                    y: sourceCluster.y,
                    radius: 10,
                    maxRadius: 200 + lineCount * 50,
                    opacity: 0.6,
                    hue: sourceCluster.crystals[0].hue,
                    growthRate: 3 + lineCount * 0.5,
                });

                // Create floor ripple from crystal
                this.floorRipples.push({
                    x: sourceCluster.x,
                    y: this.canvas.height * 0.85,
                    radius: 0,
                    maxRadius: 300 + lineCount * 80,
                    opacity: 0.5,
                    hue: sourceCluster.crystals[0].hue,
                    growthRate: 4 + lineCount * 0.8,
                });
            }
        }
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.2, 2.5);
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.5 * comboCount, 2.0);

        // Screen shake for high combos - INTENSE for 5+
        if (comboCount >= 5) {
            this.screenShake.intensity = Math.min(6 + (comboCount - 5) * 2, 14);
            // Chromatic aberration for top-level combos (7+)
            if (comboCount >= 7) {
                this.chromaticAberration = Math.min(4 + (comboCount - 7) * 1.2, 10);
            }
        } else if (comboCount >= 3) {
            this.screenShake.intensity = Math.min(2 + comboCount * 0.6, 5);
        }

        // Create crystal resonance between nearby crystals
        if (comboCount >= 2) {
            for (let i = 0; i < Math.min(comboCount, 3); i++) {
                if (this.crystalResonance.length < 10) {
                    const cluster1 = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];
                    const cluster2 = this.crystalClusters[Math.floor(Math.random() * this.crystalClusters.length)];

                    if (cluster1 && cluster2 && cluster1 !== cluster2) {
                        this.crystalResonance.push({
                            x1: cluster1.x,
                            y1: cluster1.y,
                            x2: cluster2.x,
                            y2: cluster2.y,
                            opacity: 0.6 + comboCount * 0.05,
                            hue: cluster1.crystals[0].hue,
                            life: 1.0,
                            decay: 0.015,
                            width: 2 + comboCount * 0.3,
                        });
                    }
                }
            }
        }
    }

    animate() {
        if (!this.isActive || !this.ctx || !this.canvas) return;

        this.animationTime += 0.016;

        // Decay effects
        if (this.pulseIntensity > 0) {
            this.pulseIntensity *= 0.985;
        }
        if (this.comboMultiplier > 1) {
            this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.01);
        }
        if (this.screenShake.intensity > 0) {
            this.screenShake.intensity *= 0.92;
            if (this.screenShake.intensity < 0.1) this.screenShake.intensity = 0;
        }
        if (this.chromaticAberration > 0) {
            this.chromaticAberration *= 0.94;
            if (this.chromaticAberration < 0.1) this.chromaticAberration = 0;
        }
        if (this.crystalShakeIntensity > 0) {
            this.crystalShakeIntensity *= 0.95;
            if (this.crystalShakeIntensity < 0.05) this.crystalShakeIntensity = 0;
        }

        // Update screen shake position
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity * 2;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity * 2;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        // Update element positions for smooth movement
        this.updateMovements();

        // Apply screen shake transform
        this.ctx.save();
        if (this.screenShake.intensity > 0) {
            this.ctx.translate(this.screenShake.x, this.screenShake.y);
        }

        // Draw scene (back to front for proper layering)
        this.drawBackground();
        this.drawCaveWalls();
        this.drawCaveFloor();
        this.drawFloorRipples();
        this.drawAmbientGlows();
        this.drawLightRays();
        this.drawRockFormations();
        this.drawMist();
        this.drawDustParticles();
        this.drawStalagmites();
        this.drawCrystalClusters();
        this.drawStalactites();
        this.drawEnergyPulses();
        this.drawCrystalResonance();

        // Restore transform
        this.ctx.restore();

        // Apply chromatic aberration if active (drawn separately for effect)
        if (this.chromaticAberration > 0) {
            this.drawChromaticAberration();
        }

        this.registerAnimation(requestAnimationFrame(() => this.animate()));
    }

    updateMovements() {
        // Update crystal cluster positions with floating motion
        this.crystalClusters.forEach((cluster) => {
            cluster.floatPhase += cluster.floatSpeedX;
            const floatX = Math.sin(cluster.floatPhase) * cluster.floatAmplitudeX;
            const floatY = Math.sin(cluster.floatPhase * 1.3 + cluster.floatSpeedY * 100) * cluster.floatAmplitudeY;

            cluster.x = cluster.baseX + floatX;
            cluster.y = cluster.baseY + floatY;

            // Update rotation
            cluster.rotationPhase += cluster.rotationSpeed;

            // Update individual crystal wobbling
            cluster.crystals.forEach((crystal) => {
                crystal.wobblePhase += crystal.wobbleSpeed;
                crystal.angle = crystal.baseAngle + Math.sin(crystal.wobblePhase) * crystal.wobbleAmount;
            });
        });

        // Update stalactite swaying
        this.stalactites.forEach((stalactite) => {
            stalactite.swayPhase += stalactite.swaySpeed;
            stalactite.x = stalactite.baseX + Math.sin(stalactite.swayPhase) * stalactite.swayAmplitude;
        });

        // Update cave wall breathing
        this.caveWalls.forEach((wall) => {
            wall.breathPhase += wall.breathSpeed;
            const breathe = Math.sin(wall.breathPhase) * wall.breathAmplitude;
            wall.roughness = wall.baseRoughness + breathe;
            wall.x = wall.baseX + breathe * 0.5;
        });

        // Update light ray slow rotation
        this.lightRays.forEach((ray) => {
            ray.angle += ray.rotationSpeed * 0.3; // Slower rotation
        });

        // Update ambient glow drifting
        this.ambientGlows.forEach((glow) => {
            if (!glow.driftPhase) {
                glow.driftPhase = Math.random() * Math.PI * 2;
                glow.driftSpeed = Math.random() * 0.0003 + 0.0001;
                glow.driftAmplitude = Math.random() * 30 + 15;
                glow.baseX = glow.x;
                glow.baseY = glow.y;
            }

            glow.driftPhase += glow.driftSpeed;
            glow.x = glow.baseX + Math.sin(glow.driftPhase) * glow.driftAmplitude;
            glow.y = glow.baseY + Math.cos(glow.driftPhase * 0.7) * glow.driftAmplitude * 0.8;
        });

        // Update stalagmite swaying
        this.stalagmites.forEach((stalagmite) => {
            stalagmite.swayPhase += stalagmite.swaySpeed;
            stalagmite.x = stalagmite.baseX + Math.sin(stalagmite.swayPhase) * stalagmite.swayAmplitude;
        });

        // Update rock formation floating
        this.rockFormations.forEach((rock) => {
            rock.floatPhase += rock.floatSpeed;
            const float = Math.sin(rock.floatPhase) * rock.floatAmplitude;
            rock.y = rock.baseY + float;
        });

        // Update cave floor breathing
        this.caveFloor.forEach((segment) => {
            segment.breathPhase += segment.breathSpeed;
            segment.y = segment.baseY + Math.sin(segment.breathPhase) * segment.breathAmplitude;
        });

        // Update mist drifting
        this.mist.forEach((m) => {
            if (!m.baseX) {
                m.baseX = m.x;
            }
            m.driftPhase += m.driftSpeed;
            m.x = m.baseX + Math.sin(m.driftPhase) * m.driftAmplitude;
        });
    }

    drawBackground() {
        if (!this.ctx || !this.canvas) return;

        if (this.cachedGradients.background) {
            this.ctx.fillStyle = this.cachedGradients.background;
        } else {
            this.ctx.fillStyle = 'hsla(270, 25%, 8%, 1)';
        }
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawCaveWalls() {
        this.caveWalls.forEach((wall) => {
            this.ctx.save();

            // Create rough, organic wall shape
            this.ctx.beginPath();
            const segments = 8;
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const x = wall.x + (wall.side === 'left' ? 1 : -1) * Math.sin(t * Math.PI) * wall.roughness;
                const y = wall.y - wall.height / 2 + t * wall.height;

                if (i === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }

            // Fill with subtle gradient
            const gradient = this.ctx.createLinearGradient(wall.x - 50, wall.y, wall.x + 50, wall.y);
            gradient.addColorStop(0, `hsla(${wall.hue}, 20%, 10%, 0.3)`);
            gradient.addColorStop(0.5, `hsla(${wall.hue}, 25%, 15%, 0.5)`);
            gradient.addColorStop(1, `hsla(${wall.hue}, 20%, 10%, 0.3)`);

            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            this.ctx.restore();
        });
    }

    drawStalactites() {
        this.stalactites.forEach((stalactite) => {
            this.ctx.save();

            const pulse = Math.sin(this.animationTime * 2 + stalactite.x) * 0.2 + 0.8;
            const glow = stalactite.glowIntensity * pulse * (1 + this.pulseIntensity * 0.3);

            // Draw stalactite shape
            this.ctx.beginPath();
            this.ctx.moveTo(stalactite.x, stalactite.y);
            this.ctx.quadraticCurveTo(
                stalactite.x - stalactite.width / 2,
                stalactite.length * 0.3,
                stalactite.x - stalactite.width * 0.3,
                stalactite.length * 0.6,
            );
            this.ctx.lineTo(stalactite.x, stalactite.length);
            this.ctx.lineTo(stalactite.x + stalactite.width * 0.3, stalactite.length * 0.6);
            this.ctx.quadraticCurveTo(
                stalactite.x + stalactite.width / 2,
                stalactite.length * 0.3,
                stalactite.x,
                stalactite.y,
            );

            // Gradient fill
            const gradient = this.ctx.createLinearGradient(stalactite.x, 0, stalactite.x, stalactite.length);
            gradient.addColorStop(0, `hsla(${stalactite.hue}, 50%, 30%, 0.4)`);
            gradient.addColorStop(0.7, `hsla(${stalactite.hue}, 60%, 40%, 0.6)`);
            gradient.addColorStop(1, `hsla(${stalactite.hue}, 70%, 50%, ${0.3 + glow * 0.3})`);

            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            // Glow at tip
            const glowGradient = this.ctx.createRadialGradient(
                stalactite.x,
                stalactite.length,
                0,
                stalactite.x,
                stalactite.length,
                stalactite.width * 2,
            );
            glowGradient.addColorStop(0, `hsla(${stalactite.hue}, 80%, 60%, ${0.4 * glow})`);
            glowGradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = glowGradient;
            this.ctx.fillRect(
                stalactite.x - stalactite.width * 2,
                stalactite.length - stalactite.width * 2,
                stalactite.width * 4,
                stalactite.width * 4,
            );

            this.ctx.restore();
        });
    }

    drawCrystalClusters() {
        this.crystalClusters.forEach((cluster) => {
            cluster.pulsePhase += cluster.pulseSpeed;
            const pulse = Math.sin(cluster.pulsePhase) * 0.3 + 0.7;

            // Decay glow intensity
            if (cluster.glowIntensity > 1.0) {
                cluster.glowIntensity *= 0.98;
            }

            const totalGlow = cluster.baseGlow * pulse * cluster.glowIntensity * (1 + this.pulseIntensity * 0.4);

            this.ctx.save();

            // Add crystal shake effect
            let shakeX = 0;
            let shakeY = 0;
            if (this.crystalShakeIntensity > 0) {
                shakeX = (Math.random() - 0.5) * this.crystalShakeIntensity * 6;
                shakeY = (Math.random() - 0.5) * this.crystalShakeIntensity * 6;
            }

            this.ctx.translate(cluster.x + shakeX, cluster.y + shakeY);

            // Apply slow rotation to entire cluster
            const clusterRotation = Math.sin(cluster.rotationPhase) * cluster.rotationAmount;
            this.ctx.rotate(clusterRotation);

            // Draw each crystal in the cluster
            cluster.crystals.forEach((crystal) => {
                this.ctx.save();
                this.ctx.translate(crystal.offsetX, crystal.offsetY);
                this.ctx.rotate(crystal.angle);

                // Draw crystal body
                this.ctx.beginPath();
                this.ctx.moveTo(0, -crystal.height);
                this.ctx.lineTo(crystal.width / 2, 0);
                this.ctx.lineTo(-crystal.width / 2, 0);
                this.ctx.closePath();

                // Gradient for 3D effect
                const gradient = this.ctx.createLinearGradient(-crystal.width / 2, 0, crystal.width / 2, 0);
                gradient.addColorStop(0, `hsla(${crystal.hue}, ${crystal.saturation}%, 30%, 0.7)`);
                gradient.addColorStop(0.5, `hsla(${crystal.hue}, ${crystal.saturation}%, 50%, 0.9)`);
                gradient.addColorStop(1, `hsla(${crystal.hue}, ${crystal.saturation}%, 35%, 0.7)`);

                this.ctx.fillStyle = gradient;
                this.ctx.fill();

                // Inner highlight
                this.ctx.beginPath();
                this.ctx.moveTo(0, -crystal.height);
                this.ctx.lineTo(crystal.width * 0.15, -crystal.height * 0.3);
                this.ctx.lineTo(0, -crystal.height * 0.5);
                this.ctx.closePath();
                this.ctx.fillStyle = `hsla(${crystal.hue}, ${crystal.saturation}%, 80%, ${0.4 * totalGlow})`;
                this.ctx.fill();

                // Outer glow
                const glowSize = Math.max(crystal.width, crystal.height) * 1.5;
                const glowGradient = this.ctx.createRadialGradient(0, -crystal.height / 2, 0, 0, -crystal.height / 2, glowSize);
                glowGradient.addColorStop(0, `hsla(${crystal.hue}, ${crystal.saturation}%, 60%, ${0.3 * totalGlow})`);
                glowGradient.addColorStop(0.5, `hsla(${crystal.hue}, ${crystal.saturation}%, 50%, ${0.15 * totalGlow})`);
                glowGradient.addColorStop(1, 'transparent');

                this.ctx.fillStyle = glowGradient;
                this.ctx.fillRect(-glowSize / 2, -crystal.height - glowSize / 2, glowSize, glowSize);

                this.ctx.restore();
            });

            this.ctx.restore();
        });
    }

    drawDustParticles() {
        this.dustParticles.forEach((particle) => {
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;

            // Wrap around edges
            if (particle.x < -10) particle.x = this.canvas.width + 10;
            if (particle.x > this.canvas.width + 10) particle.x = -10;
            if (particle.y < -10) particle.y = this.canvas.height + 10;
            if (particle.y > this.canvas.height + 10) particle.y = -10;

            // Pulse effect
            particle.pulsePhase += particle.pulseSpeed;
            const pulse = Math.sin(particle.pulsePhase) * 0.3 + 0.7;
            const opacity = particle.opacity * pulse * (1 + this.comboMultiplier * 0.2);

            // Draw particle
            this.ctx.fillStyle = `hsla(${particle.hue}, 60%, 70%, ${opacity})`;
            this.ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
        });
    }

    drawLightRays() {
        this.lightRays.forEach((ray) => {
            ray.pulsePhase += ray.pulseSpeed;
            ray.angle += ray.rotationSpeed;

            const pulse = Math.sin(ray.pulsePhase) * 0.4 + 0.6;
            // Enhanced light ray intensity during combos
            const comboBoost = 1 + this.pulseIntensity * 0.5 + this.comboMultiplier * 0.3;
            const opacity = ray.opacity * pulse * comboBoost;

            this.ctx.save();
            this.ctx.translate(ray.x, ray.y);
            this.ctx.rotate(ray.angle);

            // Draw ray as gradient line
            const gradient = this.ctx.createLinearGradient(0, 0, 0, ray.length);
            gradient.addColorStop(0, `hsla(${ray.hue}, 70%, 60%, 0)`);
            gradient.addColorStop(0.3, `hsla(${ray.hue}, 70%, 60%, ${opacity})`);
            gradient.addColorStop(0.7, `hsla(${ray.hue}, 70%, 60%, ${opacity})`);
            gradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(-ray.width / 2, 0, ray.width, ray.length);

            this.ctx.restore();
        });
    }

    drawAmbientGlows() {
        this.ambientGlows.forEach((glow) => {
            glow.pulsePhase += glow.pulseSpeed;
            const pulse = Math.sin(glow.pulsePhase) * 0.3 + 0.7;
            const opacity = glow.opacity * pulse * (1 + this.comboMultiplier * 0.15);

            const gradient = this.ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.radius);
            gradient.addColorStop(0, `hsla(${glow.hue}, 60%, 50%, ${opacity})`);
            gradient.addColorStop(0.5, `hsla(${glow.hue}, 60%, 50%, ${opacity * 0.5})`);
            gradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(glow.x - glow.radius, glow.y - glow.radius, glow.radius * 2, glow.radius * 2);
        });
    }

    drawEnergyPulses() {
        for (let i = this.energyPulses.length - 1; i >= 0; i--) {
            const pulse = this.energyPulses[i];

            pulse.radius += pulse.growthRate;
            pulse.opacity *= 0.96;

            if (pulse.radius >= pulse.maxRadius || pulse.opacity < 0.05) {
                this.energyPulses.splice(i, 1);
                continue;
            }

            // Draw expanding ring
            this.ctx.strokeStyle = `hsla(${pulse.hue}, 70%, 60%, ${pulse.opacity})`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.ctx.stroke();

            // Draw glow
            const gradient = this.ctx.createRadialGradient(pulse.x, pulse.y, pulse.radius - 10, pulse.x, pulse.y, pulse.radius + 10);
            gradient.addColorStop(0, 'transparent');
            gradient.addColorStop(0.5, `hsla(${pulse.hue}, 70%, 60%, ${pulse.opacity * 0.4})`);
            gradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(
                pulse.x - pulse.radius - 10,
                pulse.y - pulse.radius - 10,
                (pulse.radius + 10) * 2,
                (pulse.radius + 10) * 2,
            );
        }
    }

    drawCrystalResonance() {
        for (let i = this.crystalResonance.length - 1; i >= 0; i--) {
            const resonance = this.crystalResonance[i];

            resonance.life -= resonance.decay;

            if (resonance.life <= 0) {
                this.crystalResonance.splice(i, 1);
                continue;
            }

            resonance.opacity = resonance.life * 0.6;

            // Draw energy beam between crystals
            const gradient = this.ctx.createLinearGradient(resonance.x1, resonance.y1, resonance.x2, resonance.y2);
            gradient.addColorStop(0, `hsla(${resonance.hue}, 80%, 70%, ${resonance.opacity})`);
            gradient.addColorStop(0.5, `hsla(${resonance.hue}, 80%, 70%, ${resonance.opacity * 0.5})`);
            gradient.addColorStop(1, `hsla(${resonance.hue}, 80%, 70%, ${resonance.opacity})`);

            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = (resonance.width || 2) + Math.sin(this.animationTime * 5 + i) * 1;
            this.ctx.beginPath();
            this.ctx.moveTo(resonance.x1, resonance.y1);

            // Add curve for more organic feel
            const midX = (resonance.x1 + resonance.x2) / 2 + Math.sin(this.animationTime * 3 + i) * 30;
            const midY = (resonance.y1 + resonance.y2) / 2 + Math.cos(this.animationTime * 3 + i) * 30;
            this.ctx.quadraticCurveTo(midX, midY, resonance.x2, resonance.y2);
            this.ctx.stroke();
        }
    }

    drawFloorRipples() {
        // Limit to max 5 ripples for performance
        while (this.floorRipples.length > 5) {
            this.floorRipples.shift();
        }

        for (let i = this.floorRipples.length - 1; i >= 0; i--) {
            const ripple = this.floorRipples[i];

            ripple.radius += ripple.growthRate;
            ripple.opacity *= 0.96;

            if (ripple.radius >= ripple.maxRadius || ripple.opacity < 0.05) {
                this.floorRipples.splice(i, 1);
                continue;
            }

            // Draw simplified expanding ripple ring on the floor
            this.ctx.strokeStyle = `hsla(${ripple.hue}, 70%, 55%, ${ripple.opacity})`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.ellipse(ripple.x, ripple.y, ripple.radius, ripple.radius * 0.3, 0, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    drawChromaticAberration() {
        if (this.chromaticAberration <= 0) return;

        // Ultra-efficient chromatic aberration using composite operations
        // This draws colored overlays instead of processing pixels
        const offset = this.chromaticAberration * 0.8;
        const intensity = Math.min(this.chromaticAberration / 8, 0.15);

        // Save the current canvas state
        this.ctx.save();

        // Red channel overlay (shifted left)
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.fillStyle = `rgba(255, 0, 0, ${intensity})`;
        this.ctx.fillRect(-offset, 0, this.canvas.width, this.canvas.height);

        // Blue channel overlay (shifted right)
        this.ctx.fillStyle = `rgba(0, 100, 255, ${intensity})`;
        this.ctx.fillRect(offset, 0, this.canvas.width, this.canvas.height);

        // Add a subtle white flash overlay for impact
        if (this.chromaticAberration > 5) {
            this.ctx.globalCompositeOperation = 'lighten';
            this.ctx.fillStyle = `rgba(255, 255, 255, ${(this.chromaticAberration - 5) * 0.03})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.restore();
    }

    drawCaveFloor() {
        // Draw natural cave floor
        this.ctx.save();
        this.ctx.beginPath();

        // Create continuous floor shape
        this.ctx.moveTo(0, this.caveFloor[0].y);

        for (let i = 0; i < this.caveFloor.length; i++) {
            const segment = this.caveFloor[i];
            const nextSegment = this.caveFloor[i + 1] || this.caveFloor[i];

            // Add roughness with sine wave
            const roughnessOffset = Math.sin(this.animationTime * 0.1 + i) * segment.roughness;

            if (i < this.caveFloor.length - 1) {
                this.ctx.quadraticCurveTo(
                    segment.x,
                    segment.y + roughnessOffset,
                    (segment.x + nextSegment.x) / 2,
                    (segment.y + nextSegment.y) / 2,
                );
            } else {
                this.ctx.lineTo(segment.x + segment.width, segment.y + roughnessOffset);
            }
        }

        // Complete the shape
        this.ctx.lineTo(this.canvas.width, this.canvas.height);
        this.ctx.lineTo(0, this.canvas.height);
        this.ctx.closePath();

        // Fill with gradient
        const gradient = this.ctx.createLinearGradient(0, this.canvas.height * 0.8, 0, this.canvas.height);
        gradient.addColorStop(0, 'hsla(265, 25%, 12%, 0.6)');
        gradient.addColorStop(1, 'hsla(270, 20%, 8%, 0.8)');

        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        this.ctx.restore();
    }

    drawRockFormations() {
        this.rockFormations.forEach((rock) => {
            this.ctx.save();

            // Draw organic rock shape
            this.ctx.beginPath();

            const points = 8;
            for (let i = 0; i <= points; i++) {
                const angle = (i / points) * Math.PI * 2;
                const radiusVariation = Math.sin(angle * 3 + rock.roughness) * 0.2 + 0.9;
                const x = rock.x + Math.cos(angle) * (rock.width / 2) * radiusVariation;
                const y = rock.y + Math.sin(angle) * (rock.height / 2) * radiusVariation;

                if (i === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }

            this.ctx.closePath();

            // Fill with dark, subtle color
            const gradient = this.ctx.createRadialGradient(
                rock.x - rock.width * 0.2,
                rock.y - rock.height * 0.2,
                0,
                rock.x,
                rock.y,
                Math.max(rock.width, rock.height) / 2,
            );
            gradient.addColorStop(0, `hsla(${rock.hue}, 20%, 18%, 0.5)`);
            gradient.addColorStop(0.6, `hsla(${rock.hue}, 15%, 12%, 0.7)`);
            gradient.addColorStop(1, `hsla(${rock.hue}, 10%, 8%, 0.8)`);

            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            this.ctx.restore();
        });
    }

    drawStalagmites() {
        this.stalagmites.forEach((stalagmite) => {
            this.ctx.save();

            const pulse = Math.sin(this.animationTime * 2 + stalagmite.x) * 0.2 + 0.8;
            const glow = stalagmite.glowIntensity * pulse * (1 + this.pulseIntensity * 0.3);

            // Draw stalagmite shape (inverted stalactite)
            this.ctx.beginPath();
            this.ctx.moveTo(stalagmite.x, stalagmite.y);
            this.ctx.quadraticCurveTo(
                stalagmite.x - stalagmite.width / 2,
                stalagmite.y - stalagmite.height * 0.3,
                stalagmite.x - stalagmite.width * 0.3,
                stalagmite.y - stalagmite.height * 0.6,
            );
            this.ctx.lineTo(stalagmite.x, stalagmite.y - stalagmite.height);
            this.ctx.lineTo(stalagmite.x + stalagmite.width * 0.3, stalagmite.y - stalagmite.height * 0.6);
            this.ctx.quadraticCurveTo(
                stalagmite.x + stalagmite.width / 2,
                stalagmite.y - stalagmite.height * 0.3,
                stalagmite.x,
                stalagmite.y,
            );

            // Gradient fill
            const gradient = this.ctx.createLinearGradient(
                stalagmite.x,
                stalagmite.y,
                stalagmite.x,
                stalagmite.y - stalagmite.height,
            );
            gradient.addColorStop(0, `hsla(${stalagmite.hue}, 50%, 30%, 0.4)`);
            gradient.addColorStop(0.7, `hsla(${stalagmite.hue}, 60%, 40%, 0.6)`);
            gradient.addColorStop(1, `hsla(${stalagmite.hue}, 70%, 50%, ${0.3 + glow * 0.3})`);

            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            // Glow at tip
            const glowGradient = this.ctx.createRadialGradient(
                stalagmite.x,
                stalagmite.y - stalagmite.height,
                0,
                stalagmite.x,
                stalagmite.y - stalagmite.height,
                stalagmite.width * 2,
            );
            glowGradient.addColorStop(0, `hsla(${stalagmite.hue}, 80%, 60%, ${0.4 * glow})`);
            glowGradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = glowGradient;
            this.ctx.fillRect(
                stalagmite.x - stalagmite.width * 2,
                stalagmite.y - stalagmite.height - stalagmite.width * 2,
                stalagmite.width * 4,
                stalagmite.width * 4,
            );

            this.ctx.restore();
        });
    }

    drawMist() {
        this.mist.forEach((m) => {
            this.ctx.save();

            const pulse = Math.sin(this.animationTime * 0.5 + m.x * 0.01) * 0.2 + 0.8;
            // Boost mist brightness during combos
            const comboBoost = 1 + this.comboMultiplier * 0.4 + this.pulseIntensity * 0.3;
            const opacity = m.opacity * pulse * Math.min(comboBoost, 2.5);

            // Draw elliptical mist patch
            const gradient = this.ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.width / 2);
            gradient.addColorStop(0, `hsla(${m.hue}, 40%, 50%, ${opacity})`);
            gradient.addColorStop(0.5, `hsla(${m.hue}, 35%, 45%, ${opacity * 0.5})`);
            gradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = gradient;
            this.ctx.save();
            this.ctx.translate(m.x, m.y);
            this.ctx.scale(1, m.height / m.width);
            this.ctx.beginPath();
            this.ctx.arc(0, 0, m.width / 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            this.ctx.restore();
        });
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        super.stop();
        this.animationTime = 0;
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.energyPulses = [];
        this.crystalResonance = [];
        this.floorRipples = [];
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        this.crystalShakeIntensity = 0;
    }

    /**
     * Provide Geode themed tetromino styling (jewel-toned glow palette)
     * @returns {Object} Geode tetromino configuration
     */
    getTetrominoConfig() {
        return GEODE_TETROMINOS;
    }
}

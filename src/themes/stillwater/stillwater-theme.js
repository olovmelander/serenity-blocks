import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { STILLWATER_TETROMINOS } from './stillwater-tetrominos.js';

export default class StillwaterTheme extends BaseTheme {
    constructor() {
        super('stillwater');

        // Combo effects
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.waterRipples = [];
        this.mysticalWisps = [];
        this.tranquilSparkles = [];
        this.fireflySwarms = [];
        this.lightBeams = [];
        this.comboMultiplier = 1.0;
        this.eventUnsubscribers = [];
        this.treeGlowIntensity = 0;

        // Tree layer references for glow effects
        this.distantTreesContainer = null;
        this.midTreesContainer = null;
        this.closeTreesContainer = null;
        this.foregroundTreesContainer = null;
        this.waterContainer = null; // For water horizon glow

        // Performance limits - optimized defaults
        this.MAX_RIPPLES = 6;
        this.MAX_WISPS = 4;
        this.MAX_SPARKLES = 120;
        this.MAX_FIREFLY_SWARMS = 3;
        this.MAX_LIGHT_BEAMS = 5;

        // Performance optimization flags
        this.useSimplifiedGlow = true;
        this.batchRender = true;
        this.frameCounter = 0;
        this.lastTreeGlowUpdate = 0;

        // Graphics quality presets - optimized for better performance
        this.qualityPresets = {
            Minimal: {
                staticWaterRipples: 2,
                distantTreeClusters: 2,
                midTrees: 3,
                closeTrees: 2,
                foregroundTrees: 2,
                rocks: 4,
                dustMotes: 12,
                fireflies: 4,
                mysticalOrbs: 2,
                lightRays: 1,
                maxRipples: 2,
                maxWisps: 1,
                maxSparkles: 25,
                maxFireflySwarms: 1,
                maxLightBeams: 1,
                wispPoints: 6,
                glowIntensity: 0.4,
                useShadowBlur: false,
                useDropShadow: false,
                glowUpdateInterval: 4, // Update every 4 frames
            },
            Low: {
                staticWaterRipples: 3,
                distantTreeClusters: 3,
                midTrees: 5,
                closeTrees: 3,
                foregroundTrees: 3,
                rocks: 6,
                dustMotes: 20,
                fireflies: 6,
                mysticalOrbs: 3,
                lightRays: 2,
                maxRipples: 3,
                maxWisps: 2,
                maxSparkles: 40,
                maxFireflySwarms: 1,
                maxLightBeams: 2,
                wispPoints: 8,
                glowIntensity: 0.5,
                useShadowBlur: false,
                useDropShadow: false,
                glowUpdateInterval: 3, // Update every 3 frames
            },
            Medium: {
                staticWaterRipples: 5,
                distantTreeClusters: 4,
                midTrees: 7,
                closeTrees: 4,
                foregroundTrees: 4,
                rocks: 10,
                dustMotes: 30,
                fireflies: 10,
                mysticalOrbs: 5,
                lightRays: 3,
                maxRipples: 4,
                maxWisps: 3,
                maxSparkles: 70,
                maxFireflySwarms: 2,
                maxLightBeams: 3,
                wispPoints: 12,
                glowIntensity: 0.7,
                useShadowBlur: false,
                useDropShadow: true,
                glowUpdateInterval: 2, // Update every 2 frames
            },
            High: {
                staticWaterRipples: 6,
                distantTreeClusters: 4,
                midTrees: 9,
                closeTrees: 5,
                foregroundTrees: 5,
                rocks: 12,
                dustMotes: 40,
                fireflies: 12,
                mysticalOrbs: 6,
                lightRays: 4,
                maxRipples: 5,
                maxWisps: 3,
                maxSparkles: 90,
                maxFireflySwarms: 2,
                maxLightBeams: 4,
                wispPoints: 15,
                glowIntensity: 0.9,
                useShadowBlur: true,
                useDropShadow: true,
                glowUpdateInterval: 1, // Update every frame
            },
            Ultra: {
                staticWaterRipples: 10,
                distantTreeClusters: 5,
                midTrees: 12,
                closeTrees: 6,
                foregroundTrees: 7,
                rocks: 18,
                dustMotes: 60,
                fireflies: 18,
                mysticalOrbs: 10,
                lightRays: 6,
                maxRipples: 8,
                maxWisps: 5,
                maxSparkles: 150,
                maxFireflySwarms: 4,
                maxLightBeams: 6,
                wispPoints: 25,
                glowIntensity: 1.2,
                useShadowBlur: true,
                useDropShadow: true,
                glowUpdateInterval: 1, // Update every frame
            },
            Extreme: {
                staticWaterRipples: 15,
                distantTreeClusters: 7,
                midTrees: 16,
                closeTrees: 8,
                foregroundTrees: 10,
                rocks: 25,
                dustMotes: 90,
                fireflies: 25,
                mysticalOrbs: 15,
                lightRays: 9,
                maxRipples: 12,
                maxWisps: 8,
                maxSparkles: 220,
                maxFireflySwarms: 6,
                maxLightBeams: 9,
                wispPoints: 35,
                glowIntensity: 1.5,
                useShadowBlur: true,
                useDropShadow: true,
                glowUpdateInterval: 1, // Update every frame
            },
        };

        this.currentQuality = 'Medium'; // Default to Medium for better performance
        this.activePreset = this.qualityPresets.Medium;
    }

    /**
     * Apply graphics quality preset
     * @param {string} quality - Quality level: 'Low', 'Medium', 'High', or 'Ultra'
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Unknown quality preset: ${quality}, using High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // Update max limits based on preset
        this.MAX_RIPPLES = this.activePreset.maxRipples;
        this.MAX_WISPS = this.activePreset.maxWisps;
        this.MAX_SPARKLES = this.activePreset.maxSparkles;
        this.MAX_FIREFLY_SWARMS = this.activePreset.maxFireflySwarms;
        this.MAX_LIGHT_BEAMS = this.activePreset.maxLightBeams;

        console.log(`🌊 Stillwater: Applying ${quality} quality preset`);
    }

    /**
     * Get current graphics quality from settings
     * @returns {string} Quality level
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        // NOTE: This is a simplified version - see script.js lines 5767-5954 for full implementation

        // Apply graphics quality preset from settings
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        console.log(`🌊 Stillwater: Using ${quality} quality preset`);

        // Water Ripples
        const ripplesContainer = document.getElementById('stillwater-water-ripples');
        if (ripplesContainer && ripplesContainer.children.length === 0) {
            const rippleCount = this.activePreset.staticWaterRipples;
            for (let i = 0; i < rippleCount; i++) {
                const ripple = document.createElement('div');
                ripple.className = 'stillwater-water-ripple';
                ripple.style.left = `${Math.random() * 100}%`;
                ripple.style.top = `${Math.random() * 80 + 10}%`;
                ripple.style.animationDelay = `${Math.random() * 12}s`;
                ripple.style.animationDuration = `${Math.random() * 8 + 10}s`;
                ripplesContainer.appendChild(ripple);
            }
            this.registerContainer(ripplesContainer);
        }

        // Store reference to water container for glow effects
        this.waterContainer = document.getElementById('stillwater-water');

        // Mist layers
        ['stillwater-mist-back', 'stillwater-mist-mid', 'stillwater-mist-front'].forEach(
            (id, index) => {
                const mistContainer = document.getElementById(id);
                if (mistContainer && mistContainer.children.length === 0) {
                    const mist = document.createElement('div');
                    mist.className = `stillwater-mist-layer-${index}`;
                    mist.style.animationDelay = `-${index * 15}s`;
                    mistContainer.appendChild(mist);
                    this.registerContainer(mistContainer);
                }
            },
        );

        // Layer 1 - Distant Trees (Deep forest background)
        const distantTreesContainer = document.getElementById('stillwater-distant-trees');
        if (distantTreesContainer && distantTreesContainer.children.length === 0) {
            const numClusters = this.activePreset.distantTreeClusters;
            const clusterWidth = 100 / numClusters;

            for (let i = 0; i < numClusters; i++) {
                const start = i * clusterWidth;
                const end = (i + 1) * clusterWidth - 5; // Small gap between clusters
                const baseHeight = 120 + Math.random() * 20;

                const tree = document.createElement('div');
                tree.className = 'stillwater-distant-tree-cluster';
                tree.style.left = `${start}%`;
                tree.style.width = `${end - start}%`;
                tree.style.setProperty('--height', `${baseHeight}px`);
                tree.style.setProperty('--sway-duration', `${Math.random() * 20 + 40}s`);
                tree.style.setProperty('--sway-delay', `-${Math.random() * 20}s`);
                distantTreesContainer.appendChild(tree);
            }
            this.registerContainer(distantTreesContainer);
        }
        // Store reference for glow effects
        this.distantTreesContainer = distantTreesContainer;

        // Layer 2 - Mid Trees (Varied organic silhouettes)
        const midTreesContainer = document.getElementById('stillwater-mid-trees');
        if (midTreesContainer && midTreesContainer.children.length === 0) {
            const numTrees = this.activePreset.midTrees;
            for (let i = 0; i < numTrees; i++) {
                const pos = (i / numTrees) * 100 + Math.random() * (100 / numTrees) * 0.5;
                const tree = document.createElement('div');
                tree.className = 'stillwater-mid-tree';
                const height = Math.random() * 80 + 160;
                const width = Math.random() * 35 + 25;
                tree.style.left = `${pos}%`;
                tree.style.setProperty('--tree-height', `${height}px`);
                tree.style.setProperty('--tree-width', `${width}px`);
                tree.style.setProperty('--sway-duration', `${Math.random() * 15 + 30}s`);
                tree.style.setProperty('--sway-delay', `-${Math.random() * 15}s`);
                tree.style.setProperty('--sway-amount', `${Math.random() * 1 + 0.5}deg`);
                midTreesContainer.appendChild(tree);
            }
            this.registerContainer(midTreesContainer);
        }
        // Store reference for glow effects
        this.midTreesContainer = midTreesContainer;

        // Layer 3 - Close Trees (Defined trunks)
        const closeTreesContainer = document.getElementById('stillwater-close-trees');
        if (closeTreesContainer && closeTreesContainer.children.length === 0) {
            const numTrees = this.activePreset.closeTrees;
            for (let i = 0; i < numTrees; i++) {
                const pos = (i / numTrees) * 100 + Math.random() * (100 / numTrees) * 0.3;
                const tree = document.createElement('div');
                tree.className = 'stillwater-close-tree';
                const height = Math.random() * 100 + 200;
                tree.style.left = `${pos}%`;
                tree.style.setProperty('--tree-height', `${height}px`);
                tree.style.setProperty('--sway-duration', `${Math.random() * 12 + 25}s`);
                tree.style.setProperty('--sway-delay', `-${Math.random() * 12}s`);
                closeTreesContainer.appendChild(tree);
            }
            this.registerContainer(closeTreesContainer);
        }
        // Store reference for glow effects
        this.closeTreesContainer = closeTreesContainer;

        // Layer 4 - Foreground Trees (Large prominent trunks)
        const foregroundTreesContainer = document.getElementById('stillwater-foreground-trees');
        if (foregroundTreesContainer && foregroundTreesContainer.children.length === 0) {
            const numTrees = this.activePreset.foregroundTrees;
            for (let i = 0; i < numTrees; i++) {
                const pos = (i / numTrees) * 100 + Math.random() * (100 / numTrees) * 0.2;
                const tree = document.createElement('div');
                tree.className = 'stillwater-foreground-tree';
                const height = Math.random() * 150 + 250;
                const width = Math.random() * 30 + 25;
                tree.style.left = `${pos}%`;
                tree.style.setProperty('--tree-height', `${height}px`);
                tree.style.setProperty('--tree-width', `${width}px`);
                tree.style.setProperty('--sway-duration', `${Math.random() * 10 + 20}s`);
                tree.style.setProperty('--sway-delay', `-${Math.random() * 10}s`);
                foregroundTreesContainer.appendChild(tree);
            }
            this.registerContainer(foregroundTreesContainer);
        }
        // Store reference for glow effects
        this.foregroundTreesContainer = foregroundTreesContainer;

        // Layer 5 - Rocks along waterline
        const rocksContainer = document.getElementById('stillwater-rocks');
        if (rocksContainer && rocksContainer.children.length === 0) {
            const rockCount = this.activePreset.rocks;
            for (let i = 0; i < rockCount; i++) {
                const rock = document.createElement('div');
                rock.className = 'stillwater-rock';
                const size = Math.random() * 25 + 15;
                rock.style.width = `${size}px`;
                rock.style.height = `${size * 0.6}px`;
                rock.style.left = `${Math.random() * 100}%`;
                rock.style.borderRadius = `${Math.random() * 50}% ${Math.random() * 50}% ${Math.random() * 50}% ${Math.random() * 50}%`;
                rocksContainer.appendChild(rock);
            }
            this.registerContainer(rocksContainer);
        }

        // Layer 9 - Floating Particles
        const particlesContainer = document.getElementById('stillwater-particles');
        if (particlesContainer && particlesContainer.children.length === 0) {
            // Dust motes
            const dustCount = this.activePreset.dustMotes;
            for (let i = 0; i < dustCount; i++) {
                const dust = document.createElement('div');
                dust.className = 'stillwater-dust-mote';
                const size = Math.random() * 2 + 1;
                dust.style.width = `${size}px`;
                dust.style.height = `${size}px`;
                dust.style.left = `${Math.random() * 100}%`;
                dust.style.top = `${Math.random() * 100}%`;
                dust.style.setProperty('--drift-x', `${Math.random() * 100 - 50}px`);
                dust.style.setProperty('--drift-y', `${Math.random() * 150 - 75}px`);
                dust.style.setProperty('--float-duration', `${Math.random() * 20 + 20}s`);
                dust.style.animationDelay = `${Math.random() * 20}s`;
                particlesContainer.appendChild(dust);
            }

            // Fireflies (mystical blinking lights)
            const fireflyCount = this.activePreset.fireflies;
            for (let i = 0; i < fireflyCount; i++) {
                const firefly = document.createElement('div');
                firefly.className = 'stillwater-firefly';
                const size = Math.random() * 4 + 3;
                firefly.style.width = `${size}px`;
                firefly.style.height = `${size}px`;
                firefly.style.left = `${Math.random() * 100}%`;
                firefly.style.top = `${Math.random() * 80 + 10}%`;
                firefly.style.setProperty('--drift-x', `${Math.random() * 120 - 60}px`);
                firefly.style.setProperty('--drift-y', `${Math.random() * 80 - 40}px`);
                firefly.style.setProperty('--float-duration', `${Math.random() * 15 + 15}s`);
                firefly.style.setProperty('--blink-duration', `${Math.random() * 3 + 2}s`);
                firefly.style.animationDelay = `${Math.random() * 15}s`;
                particlesContainer.appendChild(firefly);
            }

            // Mystical orbs (larger glowing particles)
            const orbCount = this.activePreset.mysticalOrbs;
            for (let i = 0; i < orbCount; i++) {
                const orb = document.createElement('div');
                orb.className = 'stillwater-mystical-orb';
                const size = Math.random() * 12 + 8;
                orb.style.width = `${size}px`;
                orb.style.height = `${size}px`;
                orb.style.left = `${Math.random() * 100}%`;
                orb.style.top = `${Math.random() * 70 + 15}%`;
                orb.style.setProperty('--drift-x', `${Math.random() * 150 - 75}px`);
                orb.style.setProperty('--drift-y', `${Math.random() * 100 - 50}px`);
                orb.style.setProperty('--float-duration', `${Math.random() * 25 + 25}s`);
                orb.style.setProperty('--pulse-duration', `${Math.random() * 4 + 3}s`);
                orb.style.animationDelay = `${Math.random() * 20}s`;
                particlesContainer.appendChild(orb);
            }

            // Light rays (mystical beams through mist)
            const rayCount = this.activePreset.lightRays;
            for (let i = 0; i < rayCount; i++) {
                const ray = document.createElement('div');
                ray.className = 'stillwater-light-ray';
                ray.style.left = `${Math.random() * 100}%`;
                ray.style.top = `${Math.random() * 40}%`;
                ray.style.setProperty('--ray-angle', `${Math.random() * 30 - 15}deg`);
                ray.style.setProperty('--ray-duration', `${Math.random() * 10 + 15}s`);
                ray.style.animationDelay = `${Math.random() * 15}s`;
                particlesContainer.appendChild(ray);
            }

            this.registerContainer(particlesContainer);
        }

        // Setup combo effects canvas
        this.setupComboEffects();

        // Setup event listeners for combo effects
        this.setupEventListeners();

        // Setup quality change listener
        this.setupQualityListener();

        // Start animation loop
        this.animate();
    }

    updateTreeGlow() {
        // PERFORMANCE: Only update tree glow based on quality interval
        if (this.frameCounter % this.activePreset.glowUpdateInterval !== 0) {
            return;
        }

        // Only apply filters if drop-shadow is enabled in quality preset
        if (!this.activePreset.useDropShadow) {
            return;
        }

        // Apply subtle mystical glow to tree layers with increasing intensity from back to front
        const glowActive = this.treeGlowIntensity > 0.05; // Threshold to avoid micro-updates

        // Distant trees - Very subtle lavender glow (most subtle)
        if (this.distantTreesContainer) {
            if (glowActive) {
                const glowBlur = this.treeGlowIntensity * 6 * this.activePreset.glowIntensity;
                this.distantTreesContainer.style.filter = `drop-shadow(0 0 ${glowBlur}px #b39ddb)`;
            } else {
                this.distantTreesContainer.style.filter = '';
            }
        }

        // Mid trees - Soft cyan glow (subtle)
        if (this.midTreesContainer) {
            if (glowActive) {
                const glowBlur = this.treeGlowIntensity * 8 * this.activePreset.glowIntensity;
                this.midTreesContainer.style.filter = `drop-shadow(0 0 ${glowBlur}px #5fc3c1)`;
            } else {
                this.midTreesContainer.style.filter = '';
            }
        }

        // Close trees - Pale yellow glow (moderate) - single drop-shadow for performance
        if (this.closeTreesContainer) {
            if (glowActive) {
                const glowBlur = this.treeGlowIntensity * 10 * this.activePreset.glowIntensity;
                this.closeTreesContainer.style.filter = `drop-shadow(0 0 ${glowBlur}px #fff9c4)`;
            } else {
                this.closeTreesContainer.style.filter = '';
            }
        }

        // Foreground trees - Brighter cyan-blue glow (most visible) - single drop-shadow for performance
        if (this.foregroundTreesContainer) {
            if (glowActive) {
                const glowBlur = this.treeGlowIntensity * 12 * this.activePreset.glowIntensity;
                this.foregroundTreesContainer.style.filter = `drop-shadow(0 0 ${glowBlur}px #80deea)`;
            } else {
                this.foregroundTreesContainer.style.filter = '';
            }
        }
    }

    updateWaterGlow() {
        // PERFORMANCE: Only update water glow based on quality interval
        if (this.frameCounter % this.activePreset.glowUpdateInterval !== 0) {
            return;
        }

        // Only apply filters if drop-shadow is enabled in quality preset
        if (!this.activePreset.useDropShadow) {
            return;
        }

        // Apply mystical glow to water horizon
        if (this.waterContainer) {
            const glowActive = this.treeGlowIntensity > 0.05;
            if (glowActive) {
                const glowBlur = this.treeGlowIntensity * 10 * this.activePreset.glowIntensity;
                // Single drop-shadow for performance (removed double shadow)
                this.waterContainer.style.filter = `drop-shadow(0 0 ${glowBlur}px #5fc3c1)`;
            } else {
                this.waterContainer.style.filter = '';
            }
        }
    }

    setupComboEffects() {
        const themeContainer = document.getElementById('stillwater-theme');
        if (!themeContainer) return;

        // Create canvas for combo effects
        let canvas = themeContainer.querySelector('.stillwater-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'stillwater-effects-canvas';
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
        this.effectsCtx = canvas.getContext('2d', { alpha: true });

        // Size canvas
        const resizeEffectsCanvas = () => {
            if (!this.effectsCanvas || !themeContainer) return;
            const rect = themeContainer.getBoundingClientRect();
            this.effectsCanvas.width = rect.width;
            this.effectsCanvas.height = rect.height;
        };
        resizeEffectsCanvas();
        window.addEventListener('resize', resizeEffectsCanvas);
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

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        const qualityChangeHandler = (event) => {
            if (!this.isActive) return;

            const newQuality = this.getGraphicsQuality();
            if (newQuality !== this.currentQuality) {
                console.log(`🌊 Stillwater: Quality changed from ${this.currentQuality} to ${newQuality}`);
                this.applyQualityPreset(newQuality);

                // Note: Existing scene elements won't be updated until theme is reloaded
                // Only dynamic limits (MAX_RIPPLES, etc.) are updated immediately
            }
        };

        window.addEventListener('settingsChanged', qualityChangeHandler);

        // Store reference to remove later
        this.qualityChangeHandler = qualityChangeHandler;
    }

    handleLineClear(data) {
        const { lineCount } = data;

        // Pulse the tree glow
        this.treeGlowIntensity = Math.min(1, this.treeGlowIntensity + 0.3 * lineCount);

        // Create water ripple bursts
        this.createWaterRipples(lineCount);

        // Create tranquil sparkles for multi-line clears
        if (lineCount >= 2) {
            this.createTranquilSparkles(lineCount * 15);
        }

        // Create mystical wisps for big clears
        if (lineCount >= 3) {
            this.createMysticalWisp();
        }
    }

    handleCombo(data) {
        const { comboCount } = data;
        this.comboMultiplier = Math.min(1 + comboCount * 0.2, 2.5);

        // Pulse the tree glow
        this.treeGlowIntensity = Math.min(1, this.treeGlowIntensity + 0.4);

        // Create firefly swarms
        if (comboCount >= 2) {
            this.createFireflySwarm(comboCount);
        }

        // Create light beams for higher combos
        if (comboCount >= 3) {
            this.createLightBeam();
        }

        // Create additional sparkles
        if (comboCount >= 4) {
            this.createTranquilSparkles(comboCount * 10);
        }
    }

    createWaterRipples(lineCount) {
        if (!this.effectsCanvas) return;
        if (this.waterRipples.length >= this.MAX_RIPPLES) return;

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;
        const waterlineY = height * 0.75; // Position at water surface

        const rippleCount = Math.min(lineCount, this.MAX_RIPPLES - this.waterRipples.length);

        for (let i = 0; i < rippleCount; i++) {
            const x = Math.random() * width;

            this.waterRipples.push({
                x,
                y: waterlineY,
                radius: 5,
                maxRadius: 100 + Math.random() * 80,
                life: 1.0,
                maxLife: 1.5 + Math.random() * 0.8,
                width: 2,
                color: '#5fc3c1',
            });
        }
    }

    createMysticalWisp() {
        if (!this.effectsCanvas) return;
        if (this.mysticalWisps.length >= this.MAX_WISPS) return;

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;

        // Create flowing wisp trail with point count based on quality
        const startX = Math.random() * width;
        const startY = height * 0.3 + Math.random() * height * 0.4;
        const points = [];
        const pointCount = this.activePreset.wispPoints; // Use quality-based point count

        for (let i = 0; i < pointCount; i++) {
            const t = i / pointCount;
            points.push({
                x: startX + (Math.random() - 0.5) * 100,
                y: startY + (Math.random() - 0.5) * 100,
                life: 1.0 - t * 0.5,
            });
        }

        this.mysticalWisps.push({
            points,
            life: 1.0,
            maxLife: 2.0 + Math.random() * 0.5,
            color: '#b39ddb',
            flowSpeed: 0.5 + Math.random() * 0.3,
        });
    }

    createTranquilSparkles(count) {
        if (!this.effectsCanvas) return;
        if (this.tranquilSparkles.length >= this.MAX_SPARKLES) {
            // Remove oldest sparkles
            this.tranquilSparkles.splice(0, Math.floor(this.MAX_SPARKLES * 0.3));
        }

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;
        // Mystical forest colors: soft cyan, pale yellow, lavender, soft white
        const colors = ['#5fc3c1', '#fff9c4', '#b39ddb', '#e8f5e9', '#80deea'];
        const sparkleCount = Math.min(count, this.MAX_SPARKLES);

        for (let i = 0; i < sparkleCount; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height * 0.8;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.tranquilSparkles.push({
                x,
                y,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 1.5 - 0.5, // Gentle upward drift
                life: 1.0,
                maxLife: 1.5 + Math.random() * 1.0,
                size: Math.random() * 3 + 1,
                twinkle: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.1 + 0.05,
                color,
            });
        }
    }

    createFireflySwarm(comboCount) {
        if (!this.effectsCanvas) return;
        if (this.fireflySwarms.length >= this.MAX_FIREFLY_SWARMS) return;

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;
        const centerX = Math.random() * width;
        const centerY = Math.random() * height * 0.6 + height * 0.2;

        const fireflies = [];
        const fireflyCount = Math.floor(8 + comboCount * 3) * this.comboMultiplier;

        for (let i = 0; i < fireflyCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 50;

            fireflies.push({
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
                vx: (Math.random() - 0.5) * 0.8,
                vy: (Math.random() - 0.5) * 0.8,
                blink: Math.random() * Math.PI * 2,
                blinkSpeed: Math.random() * 0.15 + 0.1,
            });
        }

        this.fireflySwarms.push({
            fireflies,
            life: 1.0,
            maxLife: 2.5 + Math.random() * 0.5,
            color: '#fff9c4',
        });
    }

    createLightBeam() {
        if (!this.effectsCanvas) return;
        if (this.lightBeams.length >= this.MAX_LIGHT_BEAMS) return;

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;

        this.lightBeams.push({
            x: Math.random() * width,
            y: 0,
            width: 40 + Math.random() * 60,
            height: height * 0.4 + Math.random() * height * 0.3,
            angle: (Math.random() - 0.5) * 20,
            life: 1.0,
            maxLife: 2.0 + Math.random() * 0.8,
            color: '#e8f5e9',
            opacity: 0.15,
        });
    }

    updateEffects(delta) {
        // Update water ripples
        for (let i = this.waterRipples.length - 1; i >= 0; i--) {
            const ripple = this.waterRipples[i];
            ripple.radius += (ripple.maxRadius / ripple.maxLife) * delta;
            ripple.life -= delta / ripple.maxLife;

            if (ripple.life <= 0) {
                this.waterRipples.splice(i, 1);
            }
        }

        // Update mystical wisps
        for (let i = this.mysticalWisps.length - 1; i >= 0; i--) {
            const wisp = this.mysticalWisps[i];
            wisp.life -= delta / wisp.maxLife;

            // Flow the points
            wisp.points.forEach((p, idx) => {
                p.x += Math.sin(Date.now() * 0.001 + idx) * wisp.flowSpeed;
                p.y += Math.cos(Date.now() * 0.001 + idx) * wisp.flowSpeed * 0.5;
            });

            if (wisp.life <= 0) {
                this.mysticalWisps.splice(i, 1);
            }
        }

        // Update tranquil sparkles
        for (let i = this.tranquilSparkles.length - 1; i >= 0; i--) {
            const sparkle = this.tranquilSparkles[i];
            sparkle.x += sparkle.vx;
            sparkle.y += sparkle.vy;
            sparkle.twinkle += sparkle.twinkleSpeed;
            sparkle.life -= delta / sparkle.maxLife;

            if (sparkle.life <= 0) {
                this.tranquilSparkles.splice(i, 1);
            }
        }

        // Update firefly swarms
        for (let i = this.fireflySwarms.length - 1; i >= 0; i--) {
            const swarm = this.fireflySwarms[i];
            swarm.life -= delta / swarm.maxLife;

            swarm.fireflies.forEach((f) => {
                f.x += f.vx;
                f.y += f.vy;
                f.blink += f.blinkSpeed;

                // Gentle random movement changes
                if (Math.random() < 0.02) {
                    f.vx += (Math.random() - 0.5) * 0.2;
                    f.vy += (Math.random() - 0.5) * 0.2;
                }
            });

            if (swarm.life <= 0) {
                this.fireflySwarms.splice(i, 1);
            }
        }

        // Update light beams
        for (let i = this.lightBeams.length - 1; i >= 0; i--) {
            const beam = this.lightBeams[i];
            beam.life -= delta / beam.maxLife;

            if (beam.life <= 0) {
                this.lightBeams.splice(i, 1);
            }
        }

        // Decay tree glow
        if (this.treeGlowIntensity > 0) {
            this.treeGlowIntensity *= 0.92;
            if (this.treeGlowIntensity < 0.01) this.treeGlowIntensity = 0;
        }
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;
        const { useShadowBlur } = this.activePreset;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render light beams (optimized - no save/restore)
        this.lightBeams.forEach((beam) => {
            const alpha = beam.life * beam.opacity;

            ctx.globalAlpha = alpha;
            ctx.translate(beam.x, beam.y);
            ctx.rotate((beam.angle * Math.PI) / 180);

            // Create gradient (could be cached but beams are infrequent)
            const gradient = ctx.createLinearGradient(0, 0, 0, beam.height);
            gradient.addColorStop(0, `${beam.color}00`);
            gradient.addColorStop(0.3, beam.color);
            gradient.addColorStop(0.7, beam.color);
            gradient.addColorStop(1, `${beam.color}00`);

            ctx.fillStyle = gradient;
            ctx.fillRect(-beam.width / 2, 0, beam.width, beam.height);

            // Reset transform
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
        });

        // Render water ripples (elliptical for perspective view) - optimized
        this.waterRipples.forEach((ripple) => {
            const alpha = ripple.life * 0.6;

            ctx.globalAlpha = alpha;
            ctx.strokeStyle = ripple.color;
            ctx.lineWidth = ripple.width;

            // Only use shadow blur if quality allows
            if (useShadowBlur) {
                ctx.shadowBlur = 8;
                ctx.shadowColor = ripple.color;
            }

            ctx.beginPath();
            // Draw ellipse to simulate viewing water surface at an angle
            ctx.ellipse(ripple.x, ripple.y, ripple.radius, ripple.radius * 0.3, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Reset shadow blur
            if (useShadowBlur) {
                ctx.shadowBlur = 0;
            }
        });

        // Reset alpha
        ctx.globalAlpha = 1;

        // Render mystical wisps - optimized
        this.mysticalWisps.forEach((wisp) => {
            const alpha = wisp.life * 0.5;

            ctx.globalAlpha = alpha;
            ctx.strokeStyle = wisp.color;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Only use shadow blur if quality allows
            if (useShadowBlur) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = wisp.color;
            }

            ctx.beginPath();
            wisp.points.forEach((p, idx) => {
                if (idx === 0) {
                    ctx.moveTo(p.x, p.y);
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            });
            ctx.stroke();

            // Reset shadow blur
            if (useShadowBlur) {
                ctx.shadowBlur = 0;
            }
        });

        // Reset alpha
        ctx.globalAlpha = 1;

        // Render tranquil sparkles - optimized batch rendering
        this.tranquilSparkles.forEach((sparkle) => {
            const twinkleAlpha = (Math.sin(sparkle.twinkle) + 1) / 2;
            const alpha = sparkle.life * twinkleAlpha * 0.8;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = sparkle.color;

            // Only use shadow blur if quality allows
            if (useShadowBlur) {
                ctx.shadowBlur = 6;
                ctx.shadowColor = sparkle.color;
            }

            ctx.beginPath();
            ctx.arc(sparkle.x, sparkle.y, sparkle.size, 0, Math.PI * 2);
            ctx.fill();

            // Reset shadow blur
            if (useShadowBlur) {
                ctx.shadowBlur = 0;
            }
        });

        // Reset alpha
        ctx.globalAlpha = 1;

        // Render firefly swarms - optimized batch rendering
        this.fireflySwarms.forEach((swarm) => {
            // Set shadow blur once per swarm if quality allows
            if (useShadowBlur) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = swarm.color;
            }

            ctx.fillStyle = swarm.color;

            swarm.fireflies.forEach((f) => {
                const blinkAlpha = (Math.sin(f.blink) + 1) / 2;
                const alpha = swarm.life * blinkAlpha * 0.9;

                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(f.x, f.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
            });

            // Reset shadow blur after swarm
            if (useShadowBlur) {
                ctx.shadowBlur = 0;
            }
        });

        // Final reset
        ctx.globalAlpha = 1;
    }

    animate() {
        if (!this.isActive) return;

        this.frameCounter++;

        // Update tree glow for combo effects (throttled by quality preset)
        this.updateTreeGlow();

        // Update water horizon glow (throttled by quality preset)
        this.updateWaterGlow();

        // Update and render combo effects
        this.updateEffects(0.016);
        this.renderEffects();

        // Continue animation loop
        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Remove quality change listener
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Clear combo effects
        this.waterRipples = [];
        this.mysticalWisps = [];
        this.tranquilSparkles = [];
        this.fireflySwarms = [];
        this.lightBeams = [];
        this.comboMultiplier = 1.0;
        this.treeGlowIntensity = 0;

        // Clear effects canvas
        if (this.effectsCanvas && this.effectsCtx) {
            this.effectsCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }

        // Clear references
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.distantTreesContainer = null;
        this.midTreesContainer = null;
        this.closeTreesContainer = null;
        this.foregroundTreesContainer = null;
        this.waterContainer = null;

        super.stop();
    }

    /**
     * Get custom tetromino configuration for Stillwater theme
     * @returns {Object} Tetromino configuration with mystical forest colors
     */
    getTetrominoConfig() {
        return STILLWATER_TETROMINOS;
    }
}

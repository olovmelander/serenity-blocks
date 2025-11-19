import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { FALL_TETROMINOS } from './fall-tetrominos.js';

export default class FallTheme extends BaseTheme {
    constructor() {
        super('fall');

        // Canvas properties
        this.canvas = null;
        this.ctx = null;

        // Ember particles (upward-floating glowing particles)
        this.embers = [];
        this.maxEmbers = 25;

        // Wind physics
        this.windForce = 0;
        this.targetWindForce = 0;
        this.nextWindChange = Math.random() * 200 + 100;
        this.time = 0;

        // Event-based effects
        this.comboCount = 0;
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.comboHueShift = 0;
        this.currentSaturation = 100;
        this.currentBrightness = 100;
        this.lineClears = [];
        this.pieceLockEffects = [];
        this.leafBurstParticles = [];
        this.fireRings = [];
        this.emberBursts = [];
        this.fireflies = [];

        // Resize handler
        this.resizeHandler = null;

        // Animation frame ID
        this.animFrameId = null;

        // DOM-driven leaf physics
        this.leafParticles = [];
        this.lastFrameTime = 0;

        // Event bus unsubscribers
        this.eventUnsubscribers = [];

        // Graphics quality presets
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            'Minimal': {
                // Leaf particles
                leafLayerBackCount: 7,
                leafLayerMidCount: 5,
                leafLayerFrontCount: 4,
                groundLeavesCount: 18,
                // Wind and atmospheric
                windParticlesCount: 3,
                // Embers and fireflies
                maxEmbers: 7,
                initialFireflies: 4,
                maxFireflies: 6,
                // Tree branches
                treeBranchSystems: 1,
                treeBranchDepth: 3,
                // Combo effects scaling
                comboEffectScale: 0.3,
                leafBurstScale: 0.3,
                emberBurstScale: 0.3,
                maxFireRings: 1,
                maxEmberBursts: 1,
                maxLeafBurstParticles: 30,
                // Combo interaction multipliers
                comboColorShiftIntensity: 0.4,
                comboWindGustMultiplier: 0.5,
                comboFireflySpawnMultiplier: 0.5,
                comboMultiplierGain: 0.15,
            },
            'Low': {
                // Leaf particles
                leafLayerBackCount: 12,
                leafLayerMidCount: 8,
                leafLayerFrontCount: 6,
                groundLeavesCount: 30,
                // Wind and atmospheric
                windParticlesCount: 5,
                // Embers and fireflies
                maxEmbers: 12,
                initialFireflies: 6,
                maxFireflies: 10,
                // Tree branches
                treeBranchSystems: 1,
                treeBranchDepth: 4,
                // Combo effects scaling
                comboEffectScale: 0.5,
                leafBurstScale: 0.5,
                emberBurstScale: 0.5,
                maxFireRings: 2,
                maxEmberBursts: 2,
                maxLeafBurstParticles: 50,
                // Combo interaction multipliers
                comboColorShiftIntensity: 0.6,
                comboWindGustMultiplier: 0.7,
                comboFireflySpawnMultiplier: 0.7,
                comboMultiplierGain: 0.17,
            },
            'Medium': {
                // Leaf particles
                leafLayerBackCount: 16,
                leafLayerMidCount: 12,
                leafLayerFrontCount: 9,
                groundLeavesCount: 50,
                // Wind and atmospheric
                windParticlesCount: 7,
                // Embers and fireflies
                maxEmbers: 18,
                initialFireflies: 10,
                maxFireflies: 15,
                // Tree branches
                treeBranchSystems: 2,
                treeBranchDepth: 5,
                // Combo effects scaling
                comboEffectScale: 0.75,
                leafBurstScale: 0.7,
                emberBurstScale: 0.7,
                maxFireRings: 3,
                maxEmberBursts: 3,
                maxLeafBurstParticles: 75,
                // Combo interaction multipliers
                comboColorShiftIntensity: 0.8,
                comboWindGustMultiplier: 0.85,
                comboFireflySpawnMultiplier: 0.85,
                comboMultiplierGain: 0.19,
            },
            'High': {
                // Leaf particles
                leafLayerBackCount: 22,
                leafLayerMidCount: 16,
                leafLayerFrontCount: 12,
                groundLeavesCount: 70,
                // Wind and atmospheric
                windParticlesCount: 10,
                // Embers and fireflies
                maxEmbers: 25,
                initialFireflies: 15,
                maxFireflies: 20,
                // Tree branches
                treeBranchSystems: 3,
                treeBranchDepth: 6,
                // Combo effects scaling
                comboEffectScale: 0.9,
                leafBurstScale: 0.85,
                emberBurstScale: 0.85,
                maxFireRings: 4,
                maxEmberBursts: 4,
                maxLeafBurstParticles: 100,
                // Combo interaction multipliers
                comboColorShiftIntensity: 0.95,
                comboWindGustMultiplier: 0.95,
                comboFireflySpawnMultiplier: 1.0,
                comboMultiplierGain: 0.2,
            },
            'Ultra': {
                // Leaf particles
                leafLayerBackCount: 28,
                leafLayerMidCount: 20,
                leafLayerFrontCount: 15,
                groundLeavesCount: 90,
                // Wind and atmospheric
                windParticlesCount: 15,
                // Embers and fireflies
                maxEmbers: 35,
                initialFireflies: 20,
                maxFireflies: 30,
                // Tree branches
                treeBranchSystems: 4,
                treeBranchDepth: 7,
                // Combo effects scaling
                comboEffectScale: 1.0,
                leafBurstScale: 1.0,
                emberBurstScale: 1.0,
                maxFireRings: 6,
                maxEmberBursts: 6,
                maxLeafBurstParticles: 120,
                // Combo interaction multipliers
                comboColorShiftIntensity: 1.0,
                comboWindGustMultiplier: 1.0,
                comboFireflySpawnMultiplier: 1.0,
                comboMultiplierGain: 0.2,
            },
            'Extreme': {
                // Leaf particles
                leafLayerBackCount: 38,
                leafLayerMidCount: 27,
                leafLayerFrontCount: 20,
                groundLeavesCount: 120,
                // Wind and atmospheric
                windParticlesCount: 20,
                // Embers and fireflies
                maxEmbers: 48,
                initialFireflies: 27,
                maxFireflies: 40,
                // Tree branches
                treeBranchSystems: 4,
                treeBranchDepth: 9,
                // Combo effects scaling
                comboEffectScale: 1.35,
                leafBurstScale: 1.35,
                emberBurstScale: 1.35,
                maxFireRings: 8,
                maxEmberBursts: 8,
                maxLeafBurstParticles: 160,
                // Combo interaction multipliers
                comboColorShiftIntensity: 1.4,
                comboWindGustMultiplier: 1.3,
                comboFireflySpawnMultiplier: 1.5,
                comboMultiplierGain: 0.25,
            }
        };
        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets['High'];

        // Apply default preset values
        this.maxFireRings = this.activePreset.maxFireRings;
        this.maxEmberBursts = this.activePreset.maxEmberBursts;
        this.maxLeafBurstParticles = this.activePreset.maxLeafBurstParticles;
        this.maxFirefliesLimit = this.activePreset.maxFireflies;
    }

    getTetrominoConfig() {
        return FALL_TETROMINOS;
    }

    /**
     * Get current graphics quality setting from game settings
     * @returns {string} Current quality level ('Low' | 'Medium' | 'High' | 'Ultra')
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    /**
     * Apply a graphics quality preset to the theme
     * @param {string} quality - Quality level to apply
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[FallTheme] Unknown preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        const preset = this.activePreset;

        // Update limits
        this.maxEmbers = preset.maxEmbers;
        this.maxFireRings = preset.maxFireRings;
        this.maxEmberBursts = preset.maxEmberBursts;
        this.maxLeafBurstParticles = preset.maxLeafBurstParticles;
        this.maxFirefliesLimit = preset.maxFireflies;

        // Trim existing particle collections to new limits
        this.trimEffectCollections();

        console.log(`[FallTheme] Applying ${quality} graphics preset`);
    }

    /**
     * Trim effect collections to match current quality preset limits
     */
    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (!collection || typeof limit !== 'number' || limit <= 0) return;
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        // Trim particle arrays to current limits
        clamp(this.embers, this.maxEmbers * 4); // Allow some burst overhead
        clamp(this.fireflies, this.maxFirefliesLimit);
        clamp(this.leafBurstParticles, this.maxLeafBurstParticles);
        clamp(this.fireRings, this.maxFireRings);
        clamp(this.emberBursts, this.maxEmberBursts);
    }

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            // Apply new preset and recreate quality-dependent elements
            this.applyQualityPreset(newQuality);
            this.recreateQualityDependentElements();
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    /**
     * Remove graphics quality change listener
     */
    teardownQualityListener() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    /**
     * Recreate DOM elements that depend on quality settings
     * Called when quality changes during runtime
     */
    recreateQualityDependentElements() {
        const preset = this.activePreset;

        // Recreate leaf layers with new counts
        const leafLayers = [
            {
                container: document.getElementById('fall-leaves-back'),
                count: preset.leafLayerBackCount,
                minSize: 15,
                maxSize: 25,
                depthFactor: 0.3,
            },
            {
                container: document.getElementById('fall-leaves-mid'),
                count: preset.leafLayerMidCount,
                minSize: 20,
                maxSize: 35,
                depthFactor: 0.6,
            },
            {
                container: document.getElementById('fall-leaves-front'),
                count: preset.leafLayerFrontCount,
                minSize: 25,
                maxSize: 45,
                depthFactor: 1.0,
            },
        ];

        // Clear and recreate leaf particles
        this.leafParticles = [];

        const leafShapes = [
            'M15 0 C0 5, 5 25, 15 30 C25 25, 30 5, 15 0 Z',
            'M15 0 L17 10 L30 12 L18 18 L22 30 L15 25 L8 30 L12 18 L0 12 L13 10 Z',
            'M15 0 C 0 10, 0 20, 5 30 C 10 25, 20 25, 25 30 C 30 20, 30 10, 15 0 Z',
        ];

        const leafColors = [
            '#ff5722', '#ff9100', '#ffb300', '#ff6f00', '#ff8a50',
            '#ffa726', '#fb8c00', '#f4511e', '#ff7043', '#ffab40',
        ];

        leafLayers.forEach((layer) => {
            if (!layer.container) return;

            // Clear existing leaves
            layer.container.innerHTML = '';

            // Create new leaves based on quality
            for (let i = 0; i < layer.count; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'leaf';
                const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                const color = leafColors[Math.floor(Math.random() * leafColors.length)];

                const isHeroLeaf = Math.random() < 0.15;
                if (isHeroLeaf) {
                    leaf.classList.add('hero-leaf');
                }

                leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                leaf.style.width = `${size}px`;
                leaf.style.height = `${size}px`;

                layer.container.appendChild(leaf);
            }

            // Recreate leaf particles
            const leaves = Array.from(layer.container.querySelectorAll('.leaf'));
            leaves.forEach((leafEl) => {
                leafEl.style.animation = 'none';
                this.leafParticles.push(this.createLeafParticle(leafEl, layer.depthFactor));
            });
        });

        // Recreate ground leaves
        const groundContainer = document.querySelector('.ground-leaves');
        if (groundContainer) {
            groundContainer.innerHTML = '';
            for (let i = 0; i < preset.groundLeavesCount; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'ground-leaf';
                const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                const size = Math.random() * 25 + 20;
                leaf.style.width = `${size}px`;
                leaf.style.height = `${size}px`;
                leaf.style.left = `${Math.random() * 100}%`;
                leaf.style.bottom = `${Math.random() * 40 - 10}px`;
                leaf.style.opacity = Math.random() * 0.5 + 0.5;

                leaf.style.setProperty('--r1', `${Math.random() * 20 - 10}deg`);
                leaf.style.setProperty('--r2', `${Math.random() * 20 - 10}deg`);
                leaf.style.animationDuration = `${Math.random() * 5 + 5}s`;
                leaf.style.animationDelay = `-${Math.random() * 10}s`;

                groundContainer.appendChild(leaf);
            }
        }

        // Recreate wind particles
        const windContainer = document.getElementById('fall-wind-particles');
        if (windContainer) {
            windContainer.innerHTML = '';
            for (let i = 0; i < preset.windParticlesCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'fall-wind-particle';
                particle.style.top = `${Math.random() * 100}%`;
                const duration = Math.random() * 3 + 2;
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;
                windContainer.appendChild(particle);
            }
        }

        // Recreate tree branches with quality-based count
        this.regenerateTreeBranches();

        // Adjust firefly count
        while (this.fireflies.length < preset.initialFireflies && this.fireflies.length < preset.maxFireflies) {
            this.fireflies.push(this.createFirefly());
        }

        console.log(`[FallTheme] Recreated quality-dependent elements for ${this.currentQuality}`);
    }

    /**
     * Regenerate tree branches based on current quality preset
     */
    regenerateTreeBranches() {
        const container = document.getElementById('fall-tree-branches');
        if (!container) return;

        container.innerHTML = '';

        const preset = this.activePreset;
        const { width, height } = this.getViewportSize();

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.pointerEvents = 'none';

        const branchConfigs = [
            { xPercent: 10, yPercent: 20, size: 0.8, opacity: 0.4, angle: 30 },
            { xPercent: 85, yPercent: 15, size: 1.0, opacity: 0.5, angle: -25 },
            { xPercent: 50, yPercent: 10, size: 0.6, opacity: 0.35, angle: 10 },
            { xPercent: 30, yPercent: 5, size: 0.7, opacity: 0.38, angle: 15 },
        ];

        const systemsToCreate = Math.min(preset.treeBranchSystems, branchConfigs.length);

        for (let i = 0; i < systemsToCreate; i++) {
            const system = branchConfigs[i];
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const x = (system.xPercent / 100) * width;
            const y = (system.yPercent / 100) * height;
            g.setAttribute('transform', `translate(${x}, ${y}) rotate(${system.angle}) scale(${system.size})`);
            g.setAttribute('opacity', system.opacity);

            this.drawBranch(g, 0, 0, -120 * system.size, preset.treeBranchDepth, 20);
            svg.appendChild(g);
        }

        container.appendChild(svg);
    }

    async createScene() {
        // Apply graphics quality preset at scene creation
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        const preset = this.activePreset;

        // Define leaf shapes and colors - more vibrant, glowing autumn palette
        const leafShapes = [
            'M15 0 C0 5, 5 25, 15 30 C25 25, 30 5, 15 0 Z', // Simple teardrop
            'M15 0 L17 10 L30 12 L18 18 L22 30 L15 25 L8 30 L12 18 L0 12 L13 10 Z', // Maple-like
            'M15 0 C 0 10, 0 20, 5 30 C 10 25, 20 25, 25 30 C 30 20, 30 10, 15 0 Z', // Oak-like
        ];

        // Brilliant, glowing autumn colors - oranges, reds, and golden yellows
        const leafColors = [
            '#ff5722', // Vibrant red-orange
            '#ff9100', // Brilliant orange
            '#ffb300', // Golden amber
            '#ff6f00', // Deep vibrant orange
            '#ff8a50', // Peachy orange
            '#ffa726', // Warm orange
            '#fb8c00', // Rich orange
            '#f4511e', // Red-orange
            '#ff7043', // Coral orange
            '#ffab40', // Light golden orange
        ];

        // Multi-layered falling leaves - using quality preset counts
        const leafLayers = [
            {
                container: document.getElementById('fall-leaves-back'),
                count: preset.leafLayerBackCount,
                minSize: 15,
                maxSize: 25,
                minDuration: 15,
                maxDuration: 20,
                depthFactor: 0.3, // Back = far away
            },
            {
                container: document.getElementById('fall-leaves-mid'),
                count: preset.leafLayerMidCount,
                minSize: 20,
                maxSize: 35,
                minDuration: 10,
                maxDuration: 15,
                depthFactor: 0.6, // Mid depth
            },
            {
                container: document.getElementById('fall-leaves-front'),
                count: preset.leafLayerFrontCount,
                minSize: 25,
                maxSize: 45,
                minDuration: 7,
                maxDuration: 12,
                depthFactor: 1.0, // Front = close
            },
        ];

        this.leafParticles = [];

        leafLayers.forEach((layer) => {
            if (!layer.container) {
                return;
            }

            if (layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    const leaf = document.createElement('div');
                    leaf.className = 'leaf';
                    const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];

                    // Depth-based color variation
                    const color = leafColors[Math.floor(Math.random() * leafColors.length)];

                    // Add occasional "hero" glowing leaf (extra bright)
                    const isHeroLeaf = Math.random() < 0.15; // 15% chance
                    if (isHeroLeaf) {
                        leaf.classList.add('hero-leaf');
                    }

                    leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                    const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                    leaf.style.width = `${size}px`;
                    leaf.style.height = `${size}px`;

                    layer.container.appendChild(leaf);
                }
                this.registerContainer(layer.container);
            }

            const leaves = Array.from(layer.container.querySelectorAll('.leaf'));
            leaves.forEach((leafEl) => {
                leafEl.style.animation = 'none';
                this.leafParticles.push(this.createLeafParticle(leafEl, layer.depthFactor));
            });
        });

        this.updateLeafParticles(0);

        // Dynamic Ground leaves - using quality preset count
        const groundContainer = document.querySelector('.ground-leaves');
        if (groundContainer && groundContainer.children.length === 0) {
            groundContainer.style.backgroundImage = '';
            for (let i = 0; i < preset.groundLeavesCount; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'ground-leaf';
                const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                const size = Math.random() * 25 + 20;
                leaf.style.width = `${size}px`;
                leaf.style.height = `${size}px`;
                leaf.style.left = `${Math.random() * 100}%`;
                leaf.style.bottom = `${Math.random() * 40 - 10}px`;
                leaf.style.opacity = Math.random() * 0.5 + 0.5;

                leaf.style.setProperty('--r1', `${Math.random() * 20 - 10}deg`);
                leaf.style.setProperty('--r2', `${Math.random() * 20 - 10}deg`);
                leaf.style.animationDuration = `${Math.random() * 5 + 5}s`;
                leaf.style.animationDelay = `-${Math.random() * 10}s`;

                groundContainer.appendChild(leaf);
            }
            this.registerContainer(groundContainer);
        }

        // Wind Particles - using quality preset count
        const windContainer = document.getElementById('fall-wind-particles');
        if (windContainer && windContainer.children.length === 0) {
            for (let i = 0; i < preset.windParticlesCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'fall-wind-particle';
                particle.style.top = `${Math.random() * 100}%`;
                const duration = Math.random() * 3 + 2;
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;
                windContainer.appendChild(particle);
            }
            this.registerContainer(windContainer);
        }

        // Generate procedural tree branches
        this.generateTreeBranches();

        // Initialize canvas for ember particles and effects
        this.canvas = document.getElementById('fall-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        // Initialize ember particles
        for (let i = 0; i < this.maxEmbers; i++) {
            this.embers.push(this.createEmber());
        }

        // Initialize fireflies (gentle floating glowing particles) - using quality preset count
        for (let i = 0; i < preset.initialFireflies; i++) {
            this.fireflies.push(this.createFirefly());
        }

        // Set up event listeners for game events
        this.setupEventListeners();

        // Start animation loop
        this.lastFrameTime = 0;
        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    generateTreeBranches() {
        const container = document.getElementById('fall-tree-branches');
        if (!container || container.children.length > 0) return;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.pointerEvents = 'none';

        // Get viewport dimensions to calculate absolute positions
        const { width, height } = this.getViewportSize();

        // Generate 2-3 branch systems with percentage-based positions
        const branchSystems = [
            { xPercent: 10, yPercent: 20, size: 0.8, opacity: 0.4, angle: 30 },
            { xPercent: 85, yPercent: 15, size: 1.0, opacity: 0.5, angle: -25 },
            { xPercent: 50, yPercent: 10, size: 0.6, opacity: 0.35, angle: 10 },
        ];

        branchSystems.forEach((system) => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            // Convert percentages to absolute pixel values
            const x = (system.xPercent / 100) * width;
            const y = (system.yPercent / 100) * height;
            g.setAttribute('transform', `translate(${x}, ${y}) rotate(${system.angle}) scale(${system.size})`);
            g.setAttribute('opacity', system.opacity);

            // Draw branches recursively
            this.drawBranch(g, 0, 0, -120 * system.size, 6, 20);
            svg.appendChild(g);
        });

        container.appendChild(svg);
    }

    drawBranch(parent, x1, y1, y2, depth, angle) {
        if (depth === 0) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const length = Math.abs(y2);
        const thickness = depth * 1.5;

        // Draw branch as path
        path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y2}`);
        path.setAttribute('stroke', 'rgba(20, 10, 5, 0.8)');
        path.setAttribute('stroke-width', thickness);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill', 'none');
        parent.appendChild(path);

        // Recursively draw sub-branches
        if (depth > 1) {
            const numBranches = Math.random() > 0.5 ? 2 : 3;
            for (let i = 0; i < numBranches; i++) {
                const branchAngle = (Math.random() - 0.5) * angle;
                const branchLength = length * (0.6 + Math.random() * 0.2);
                const x2 = x1 + Math.sin(branchAngle * Math.PI / 180) * branchLength;
                const y2New = y2 + Math.cos(branchAngle * Math.PI / 180) * branchLength;
                this.drawBranch(parent, x1, y2, y2New, depth - 1, angle * 0.8);
            }
        }
    }

    getViewportSize() {
        if (typeof window === 'undefined') {
            return { width: 1024, height: 768 };
        }

        const doc = typeof document !== 'undefined' ? document.documentElement : null;
        return {
            width: window.innerWidth || (doc ? doc.clientWidth : 1024) || 1024,
            height: window.innerHeight || (doc ? doc.clientHeight : 768) || 768,
        };
    }

    createLeafParticle(element, depth) {
        const { height } = this.getViewportSize();
        const depthScale = 0.6 + depth * 0.8;
        const particle = {
            element,
            depth,
            xPercent: Math.random() * 100,
            y: Math.random() * height - height * 0.2,
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: (0.35 + Math.random() * 0.8) * depthScale,
            swayAmplitudeFactor: (0.006 + Math.random() * 0.012) * (0.6 + depth),
            driftSpeedFactor: (Math.random() * 0.006 + 0.002) * (Math.random() < 0.5 ? -1 : 1) * (0.6 + depth),
            driftOffset: 0,
            baseFallSpeed: (45 + Math.random() * 35) * depthScale,
            maxFallSpeed: (80 + Math.random() * 40) * depthScale,
            gravity: (18 + Math.random() * 14) * depthScale,
            velocityY: 0,
            turbulencePhase: Math.random() * Math.PI * 2,
            turbulenceSpeed: Math.random() * 1.5 + 0.5,
            turbulenceAmount: 6 + Math.random() * 10,
            rotation: Math.random() * 360,
            rotationSpeed: (20 + Math.random() * 35) * (Math.random() < 0.5 ? -1 : 1),
        };

        particle.velocityY = particle.baseFallSpeed * (0.3 + Math.random() * 0.4);
        return particle;
    }

    resetLeafParticle(particle, viewportHeight) {
        const height = viewportHeight ?? this.getViewportSize().height;
        particle.y = -Math.random() * (height * 0.25) - 80;
        particle.xPercent = Math.random() * 100;
        particle.driftOffset = 0;
        particle.velocityY = particle.baseFallSpeed * (0.3 + Math.random() * 0.4);
        particle.swayPhase = Math.random() * Math.PI * 2;
        particle.turbulencePhase = Math.random() * Math.PI * 2;
    }

    updateLeafParticles(deltaSeconds = 0) {
        if (!this.leafParticles.length) {
            return;
        }

        const { width, height } = this.getViewportSize();
        const dt = Math.max(deltaSeconds, 0);

        this.leafParticles.forEach((leaf) => {
            const depthInfluence = 0.5 + leaf.depth;

            leaf.velocityY = Math.min(
                leaf.velocityY + leaf.gravity * dt,
                leaf.maxFallSpeed,
            );

            leaf.turbulencePhase += leaf.turbulenceSpeed * dt;
            const turbulence = Math.sin(leaf.turbulencePhase) * leaf.turbulenceAmount;
            leaf.y += (leaf.velocityY + turbulence) * dt;

            leaf.swayPhase += leaf.swaySpeed * dt;
            const sway = Math.sin(leaf.swayPhase) * (leaf.swayAmplitudeFactor * width);

            const driftSpeed = leaf.driftSpeedFactor * width;
            const windPush = this.windForce * 35 * depthInfluence;
            leaf.driftOffset += (driftSpeed + windPush) * dt;

            const maxDrift = width * 0.25 * depthInfluence;
            if (leaf.driftOffset > maxDrift) {
                leaf.driftOffset = maxDrift;
            } else if (leaf.driftOffset < -maxDrift) {
                leaf.driftOffset = -maxDrift;
            }

            const x = (leaf.xPercent / 100) * width + sway + leaf.driftOffset;
            leaf.rotation += leaf.rotationSpeed * dt;

            leaf.element.style.transform = `translate3d(${x}px, ${leaf.y}px, 0) rotate(${leaf.rotation}deg)`;

            if (leaf.y > height + 120) {
                this.resetLeafParticle(leaf, height);
            }
        });
    }

    createEmber() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height + Math.random() * 100,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -(Math.random() * 0.5 + 0.3), // Upward
            life: 1.0,
            size: Math.random() * 2 + 1.5,
            opacity: Math.random() * 0.4 + 0.6,
            twinkle: Math.random() * Math.PI * 2,
            twinkleSpeed: Math.random() * 0.03 + 0.02,
            hue: Math.random() * 30 + 10, // 10-40 (orange to yellow range)
        };
    }

    resetEmber(ember) {
        ember.x = Math.random() * this.canvas.width;
        ember.y = this.canvas.height + Math.random() * 100;
        ember.vx = (Math.random() - 0.5) * 0.3;
        ember.vy = -(Math.random() * 0.5 + 0.3);
        ember.life = 1.0;
        ember.size = Math.random() * 2 + 1.5;
        ember.opacity = Math.random() * 0.4 + 0.6;
        ember.twinkle = Math.random() * Math.PI * 2;
        ember.hue = Math.random() * 30 + 10;
    }

    createFirefly() {
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            baseX: Math.random() * this.canvas.width,
            baseY: Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            wander: Math.random() * Math.PI * 2,
            wanderSpeed: Math.random() * 0.02 + 0.01,
            wanderRadius: Math.random() * 25 + 15,
            size: Math.random() * 1.5 + 1,
            glow: Math.random() * Math.PI * 2,
            glowSpeed: Math.random() * 0.05 + 0.03,
            opacity: Math.random() * 0.6 + 0.4,
            hue: Math.random() * 20 + 40, // Yellow-green range
            pulsePhase: Math.random() * Math.PI * 2,
            pulseSpeed: Math.random() * 0.04 + 0.02,
        };
    }

    setupEventListeners() {
        // Clean up old listeners first
        this.teardownEventListeners();

        // Listen for game events via event bus
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleLineClear(data);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleCombo(data);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handlePieceLock(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    teardownEventListeners() {
        if (!this.eventUnsubscribers.length) {
            return;
        }

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[FallTheme] Failed to remove event listener', error);
            }
        });

        this.eventUnsubscribers = [];
    }

    shouldProcessComboEffects() {
        if (!this.isActive) return false;
        if (typeof window === 'undefined') return true;
        const settings = window.settings;
        return settings?.backgroundComboEffects === true;
    }

    normalizeEventPayload(payload = {}) {
        if (payload && typeof payload === 'object' && 'detail' in payload && payload.detail) {
            return payload.detail;
        }
        return payload || {};
    }

    handleLineClear(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;

        console.log(`[FallTheme] Line clear event: ${lineCount} lines`, detail);
        this.onLineClear(lineCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        console.log(`[FallTheme] Combo event: ${comboCount}`, detail);
        this.onCombo(comboCount);
    }

    handlePieceLock(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        this.onPieceLock(detail);
    }

    onLineClear(lineCount) {
        console.log(`[FallTheme] Processing line clear: ${lineCount} lines`);

        // Increase combo multiplier - scaled by quality preset
        const multiplierGain = this.activePreset.comboMultiplierGain || 0.2;
        this.comboMultiplier = Math.min(1 + this.comboCount * multiplierGain, 2.5);
        this.comboDecay = 300; // 5 seconds at 60fps

        // Create massive leaf burst effect - leaves swirl up and outward
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Spawn swirling leaves (more for more lines cleared) - scaled by quality
        const baseLeafBurst = lineCount * 15 + this.comboCount * 10;
        const leafBurstCount = Math.min(
            Math.ceil(baseLeafBurst * this.activePreset.leafBurstScale),
            this.maxLeafBurstParticles
        );
        for (let i = 0; i < leafBurstCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 4 + 2 + lineCount;
            const distance = Math.random() * 50;

            this.leafBurstParticles.push({
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 2, // Upward bias
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 20,
                size: Math.random() * 8 + 4,
                life: 1.0,
                opacity: Math.random() * 0.8 + 0.4,
                hue: Math.random() * 60, // Autumn colors (orange-red range)
                gravity: 0.15,
                swirl: Math.random() * Math.PI * 2,
                swirlSpeed: (Math.random() - 0.5) * 0.3,
            });
        }

        // Create expanding fire ring for big line clears - quality limited
        if (lineCount >= 2 && this.fireRings.length < this.maxFireRings) {
            this.fireRings.push({
                x: centerX,
                y: centerY,
                radius: 0,
                maxRadius: 150 + lineCount * 50,
                expansion: 3 + lineCount,
                opacity: 1.0,
                life: 1.0,
                thickness: 4 + lineCount * 2,
                hue: 20 + Math.random() * 20, // Orange to red
            });
        }

        // Massive ember burst - upward explosion - scaled by quality
        const baseEmberBurst = lineCount * 12 + this.comboCount * 8;
        const emberCount = Math.ceil(baseEmberBurst * this.activePreset.emberBurstScale);
        for (let i = 0; i < emberCount; i++) {
            const angle = (Math.random() - 0.5) * Math.PI; // Upward cone
            const speed = Math.random() * 5 + 3 + lineCount;
            this.embers.push({
                x: centerX + (Math.random() - 0.5) * 100,
                y: centerY,
                vx: Math.cos(angle) * speed * 0.5,
                vy: Math.sin(angle) * speed - 3, // Strong upward force
                life: 1.0,
                size: Math.random() * 4 + 2,
                opacity: 1.0,
                twinkle: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.08 + 0.04,
                hue: Math.random() * 30 + 10, // Yellow-orange-red
                isBurst: true,
                gravity: -0.05, // Slight upward drift
            });
        }

        // Trigger strong wind gust based on line count - scaled by quality preset
        const windMultiplier = this.activePreset.comboWindGustMultiplier || 1.0;
        const gustBonus = (lineCount * 3 + this.comboCount * 2) * windMultiplier;
        this.targetWindForce = (Math.random() < 0.5 ? -1 : 1) * (1.5 + gustBonus * 0.5);

        // Keep ember count reasonable
        if (this.embers.length > this.maxEmbers * 4) {
            this.embers = this.embers.slice(-this.maxEmbers * 4);
        }
    }

    onCombo(comboCount) {
        this.comboCount = comboCount;
        console.log(`[FallTheme] Combo multiplier: ${this.comboMultiplier}x`);

        // Progressive color shift based on combo - shift toward golden/amber tones
        // Scaled by quality preset for more or less dramatic effects
        const colorIntensity = this.activePreset.comboColorShiftIntensity || 1.0;
        const maxHueShift = -30 * colorIntensity; // Shift toward golden yellow (negative = counter-clockwise on hue wheel)
        const maxSaturation = 50 * colorIntensity; // Moderate saturation boost for richness
        const maxBrightness = 25 * colorIntensity; // Gentle brightness increase

        this.comboHueShift = Math.max(comboCount * -5 * colorIntensity, maxHueShift); // Gentle shift toward gold
        this.currentSaturation = 100 + Math.min(comboCount * 8 * colorIntensity, maxSaturation);
        this.currentBrightness = 100 + Math.min(comboCount * 4 * colorIntensity, maxBrightness);

        const themeContainer = document.getElementById('fall-theme');
        if (themeContainer) {
            themeContainer.style.filter = `hue-rotate(${this.comboHueShift}deg) saturate(${this.currentSaturation}%) brightness(${this.currentBrightness}%)`;
        }

        // Create ember burst spiral for high combos - quality limited
        if (comboCount >= 5 && this.emberBursts.length < this.maxEmberBursts) {
            const centerX = this.canvas.width / 2;
            const centerY = this.canvas.height / 2;

            this.emberBursts.push({
                x: centerX,
                y: centerY,
                particles: [],
                angle: 0,
                radius: 0,
                maxRadius: 200 + comboCount * 30,
                spinSpeed: 0.2,
                expansionRate: 4,
                life: 1.0,
                direction: Math.random() < 0.5 ? 1 : -1,
            });
        }

        // Spawn extra fireflies on big combos - quality limited and scaled by preset
        if (comboCount >= 3) {
            const fireflyMultiplier = this.activePreset.comboFireflySpawnMultiplier || 1.0;
            const firefliesToSpawn = Math.min(Math.ceil(comboCount * 2 * fireflyMultiplier), 10);
            for (let i = 0; i < firefliesToSpawn && this.fireflies.length < this.maxFirefliesLimit; i++) {
                this.fireflies.push(this.createFirefly());
            }
        }
    }

    onPieceLock(detail) {
        // Create small ember puff at lock position
        const x = detail.x ?? this.canvas.width / 2;
        const y = detail.y ?? this.canvas.height / 2;

        // Small burst of embers
        for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 1.5 + 0.5;
            this.embers.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1,
                life: 1.0,
                size: Math.random() * 2 + 1,
                opacity: 0.6,
                twinkle: 0,
                twinkleSpeed: 0.04,
                hue: Math.random() * 25 + 15,
                isBurst: true,
                gravity: 0,
            });
        }
    }

    animate(timestamp) {
        if (!this.isActive) {
            return;
        }

        const now = typeof timestamp === 'number'
            ? timestamp
            : (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let deltaSeconds = 0;
        if (this.lastFrameTime) {
            const deltaMs = Math.min(Math.max(now - this.lastFrameTime, 0), 100);
            deltaSeconds = deltaMs / 1000;
        }
        this.lastFrameTime = now;

        this.time += 1;

        // Decay combo multiplier
        if (this.comboDecay > 0) {
            this.comboDecay -= 1;
            if (this.comboDecay === 0) {
                this.comboMultiplier = 1.0;
            }
        }

        // Smoothly return colors to normal (5 second decay)
        const colorDecaySpeed = 0.03; // Slower return for 5 second duration
        this.comboHueShift += (0 - this.comboHueShift) * colorDecaySpeed;
        this.currentSaturation += (100 - this.currentSaturation) * colorDecaySpeed;
        this.currentBrightness += (100 - this.currentBrightness) * colorDecaySpeed;

        // Update theme filter with smooth interpolation
        const themeContainer = document.getElementById('fall-theme');
        if (themeContainer && (Math.abs(this.comboHueShift) > 0.5 || Math.abs(this.currentSaturation - 100) > 0.5 || Math.abs(this.currentBrightness - 100) > 0.5)) {
            themeContainer.style.filter = `hue-rotate(${this.comboHueShift}deg) saturate(${this.currentSaturation}%) brightness(${this.currentBrightness}%)`;
        } else if (themeContainer && Math.abs(this.comboHueShift) <= 0.5) {
            // Fully reset when close enough
            themeContainer.style.filter = '';
            this.comboHueShift = 0;
            this.currentSaturation = 100;
            this.currentBrightness = 100;
        }

        // Enhanced wind physics with smooth transitions (boosted by combos)
        if (this.time >= this.nextWindChange) {
            this.targetWindForce = (Math.random() - 0.5) * 1.5 * this.comboMultiplier;
            this.nextWindChange = this.time + Math.random() * 300 + 200;
        }

        // Smooth wind transition
        const frameFactor = deltaSeconds ? Math.min(deltaSeconds * 60, 2) : 1;
        const windTransitionSpeed = 0.02 * frameFactor;
        this.windForce += (this.targetWindForce - this.windForce) * windTransitionSpeed;

        // Update DOM leaf particles with physics-driven motion
        this.updateLeafParticles(deltaSeconds);

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw and update fire rings
        for (let i = this.fireRings.length - 1; i >= 0; i--) {
            const ring = this.fireRings[i];

            ring.radius += ring.expansion;
            ring.life -= 0.01;
            ring.opacity = ring.life;

            if (ring.life <= 0 || ring.radius > ring.maxRadius) {
                this.fireRings.splice(i, 1);
                continue;
            }

            // Draw glowing expanding ring
            this.ctx.beginPath();
            this.ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = `hsla(${ring.hue}, 100%, 65%, ${ring.opacity * 0.6})`;
            this.ctx.lineWidth = ring.thickness;
            this.ctx.stroke();

            // Inner glow
            this.ctx.beginPath();
            this.ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = `hsla(${ring.hue + 10}, 100%, 75%, ${ring.opacity * 0.4})`;
            this.ctx.lineWidth = ring.thickness * 0.5;
            this.ctx.stroke();
        }

        // Draw and update ember burst spirals
        for (let i = this.emberBursts.length - 1; i >= 0; i--) {
            const burst = this.emberBursts[i];

            burst.angle += burst.spinSpeed * burst.direction;
            burst.radius += burst.expansionRate;
            burst.life -= 0.008;

            // Spawn particles along the spiral
            if (Math.random() < 0.6 && burst.radius < burst.maxRadius) {
                const particleAngle = burst.angle + Math.random() * Math.PI * 0.4;
                const particleRadius = burst.radius + Math.random() * 30;
                burst.particles.push({
                    x: burst.x + Math.cos(particleAngle) * particleRadius,
                    y: burst.y + Math.sin(particleAngle) * particleRadius,
                    size: Math.random() * 3 + 1.5,
                    opacity: Math.random() * 0.9 + 0.3,
                    vx: Math.cos(particleAngle) * 2,
                    vy: Math.sin(particleAngle) * 2 - 1.5,
                    life: 1.0,
                    hue: Math.random() * 30 + 15,
                });
            }

            // Update and draw burst particles
            for (let j = burst.particles.length - 1; j >= 0; j--) {
                const p = burst.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.015;
                p.opacity = p.life;

                if (p.life <= 0) {
                    burst.particles.splice(j, 1);
                    continue;
                }

                // Draw glowing particle
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                this.ctx.fillStyle = `hsla(${p.hue}, 100%, 60%, ${p.opacity * 0.3})`;
                this.ctx.fill();

                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.opacity})`;
                this.ctx.fill();
            }

            if (burst.life <= 0 || burst.radius > burst.maxRadius) {
                this.emberBursts.splice(i, 1);
            }
        }

        // Draw and update leaf burst particles
        for (let i = this.leafBurstParticles.length - 1; i >= 0; i--) {
            const leaf = this.leafBurstParticles[i];

            // Physics
            leaf.x += leaf.vx + this.windForce * 0.8;
            leaf.y += leaf.vy;
            leaf.vy += leaf.gravity;
            leaf.vx *= 0.98; // Air resistance

            // Swirling motion
            leaf.swirl += leaf.swirlSpeed;
            leaf.x += Math.cos(leaf.swirl) * 2;
            leaf.y += Math.sin(leaf.swirl) * 2;

            leaf.rotation += leaf.rotationSpeed;
            leaf.life -= 0.012;
            leaf.opacity = leaf.life * 0.9;

            if (leaf.life <= 0 || leaf.y > this.canvas.height + 100) {
                this.leafBurstParticles.splice(i, 1);
                continue;
            }

            // Draw stylized leaf
            this.ctx.save();
            this.ctx.translate(leaf.x, leaf.y);
            this.ctx.rotate(leaf.rotation * Math.PI / 180);
            this.ctx.globalAlpha = leaf.opacity;

            // Leaf shape (teardrop)
            this.ctx.fillStyle = `hsl(${leaf.hue}, 80%, 50%)`;
            this.ctx.beginPath();
            this.ctx.moveTo(0, -leaf.size);
            this.ctx.quadraticCurveTo(leaf.size * 0.5, 0, 0, leaf.size);
            this.ctx.quadraticCurveTo(-leaf.size * 0.5, 0, 0, -leaf.size);
            this.ctx.fill();

            // Highlight
            this.ctx.fillStyle = `hsl(${leaf.hue + 10}, 90%, 65%)`;
            this.ctx.beginPath();
            this.ctx.arc(-leaf.size * 0.2, -leaf.size * 0.3, leaf.size * 0.3, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = 1;
            this.ctx.restore();
        }

        // Update and draw fireflies
        for (let i = this.fireflies.length - 1; i >= 0; i--) {
            const firefly = this.fireflies[i];

            // Gentle wandering motion
            firefly.wander += firefly.wanderSpeed;
            firefly.baseX += firefly.vx;
            firefly.baseY += firefly.vy;

            // Wandering offset
            const wanderX = Math.cos(firefly.wander) * firefly.wanderRadius;
            const wanderY = Math.sin(firefly.wander * 0.7) * firefly.wanderRadius;

            firefly.x = firefly.baseX + wanderX;
            firefly.y = firefly.baseY + wanderY;

            // Pulsing glow
            firefly.pulsePhase += firefly.pulseSpeed;
            firefly.glow += firefly.glowSpeed;

            // Wrap around screen
            if (firefly.baseX < -50) {
                firefly.baseX = this.canvas.width + 50;
            } else if (firefly.baseX > this.canvas.width + 50) {
                firefly.baseX = -50;
            }

            if (firefly.baseY < -50) {
                firefly.baseY = this.canvas.height + 50;
            } else if (firefly.baseY > this.canvas.height + 50) {
                firefly.baseY = -50;
            }

            // Draw firefly with gentle pulsing glow
            const pulseEffect = Math.sin(firefly.pulsePhase) * 0.4 + 0.6; // 0.2 to 1.0
            const glowEffect = Math.sin(firefly.glow) * 0.3 + 0.7;
            const alpha = firefly.opacity * pulseEffect;

            // Soft outer glow
            this.ctx.beginPath();
            this.ctx.arc(firefly.x, firefly.y, firefly.size * 6, 0, Math.PI * 2);
            const gradient = this.ctx.createRadialGradient(
                firefly.x, firefly.y, 0,
                firefly.x, firefly.y, firefly.size * 6
            );
            gradient.addColorStop(0, `hsla(${firefly.hue}, 100%, 70%, ${alpha * 0.4})`);
            gradient.addColorStop(0.5, `hsla(${firefly.hue}, 100%, 65%, ${alpha * 0.2})`);
            gradient.addColorStop(1, `hsla(${firefly.hue}, 100%, 60%, 0)`);
            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            // Medium glow
            this.ctx.beginPath();
            this.ctx.arc(firefly.x, firefly.y, firefly.size * 3, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${firefly.hue}, 100%, 75%, ${alpha * 0.5})`;
            this.ctx.fill();

            // Bright core with twinkle
            this.ctx.beginPath();
            this.ctx.arc(firefly.x, firefly.y, firefly.size * glowEffect, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${firefly.hue}, 100%, 85%, ${alpha})`;
            this.ctx.fill();
        }

        // Limit firefly count (remove extras after combos) - use quality limit
        if (this.fireflies.length > this.maxFirefliesLimit) {
            this.fireflies = this.fireflies.slice(0, this.maxFirefliesLimit);
        }

        // Update and draw embers
        for (let i = this.embers.length - 1; i >= 0; i--) {
            const ember = this.embers[i];

            // Update position with wind influence
            ember.x += ember.vx + this.windForce * 0.5;
            ember.y += ember.vy;

            // Apply gravity if it exists
            if (ember.gravity !== undefined) {
                ember.vy += ember.gravity;
            }

            ember.twinkle += ember.twinkleSpeed;

            // Sway motion
            ember.x += Math.sin(this.time * 0.02 + i) * 0.2;

            // Fade out
            ember.life -= ember.isBurst ? 0.015 : 0.004;

            // Reset or remove
            if (ember.life <= 0 || ember.y < -50) {
                if (ember.isBurst) {
                    this.embers.splice(i, 1);
                } else {
                    this.resetEmber(ember);
                }
                continue;
            }

            // Draw ember with multi-layer glow
            const twinkleEffect = Math.sin(ember.twinkle) * 0.3 + 0.7;
            const alpha = ember.opacity * ember.life * twinkleEffect;

            // Layer 1: Large outer glow
            this.ctx.beginPath();
            this.ctx.arc(ember.x, ember.y, ember.size * 4, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${ember.hue}, 100%, 60%, ${alpha * 0.15})`;
            this.ctx.fill();

            // Layer 2: Medium glow
            this.ctx.beginPath();
            this.ctx.arc(ember.x, ember.y, ember.size * 2, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${ember.hue}, 100%, 65%, ${alpha * 0.4})`;
            this.ctx.fill();

            // Layer 3: Bright core
            this.ctx.beginPath();
            this.ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${ember.hue}, 100%, 75%, ${alpha})`;
            this.ctx.fill();
        }

        // Request next frame
        this.animFrameId = requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
        this.registerAnimation(this.animFrameId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Remove event bus listeners
        this.teardownEventListeners();

        // Remove graphics quality listener
        this.teardownQualityListener();

        // Reset combo filter
        const themeContainer = document.getElementById('fall-theme');
        if (themeContainer) {
            themeContainer.style.filter = '';
        }

        // Clean up particles
        this.leafParticles = [];
        this.leafBurstParticles = [];
        this.fireRings = [];
        this.emberBursts = [];
        this.embers = [];
        this.fireflies = [];
        this.lastFrameTime = 0;
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.comboCount = 0;
        this.comboHueShift = 0;
        this.currentSaturation = 100;
        this.currentBrightness = 100;

        super.stop();
    }
}

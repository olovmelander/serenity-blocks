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

        // Resize handler with debounce
        this.resizeTimeout = null;
        this.resizeHandler = () => {
            if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
        };

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
                leafLayerBackCount: 60,
                leafLayerMidCount: 40,
                leafLayerFrontCount: 20,
                groundLeavesCount: 0,
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
                leafLayerBackCount: 80,
                leafLayerMidCount: 60,
                leafLayerFrontCount: 40,
                groundLeavesCount: 25,
                // Wind and atmospheric
                windParticlesCount: 4,
                // Embers and fireflies
                maxEmbers: 10,
                initialFireflies: 5,
                maxFireflies: 8,
                // Tree branches
                treeBranchSystems: 1,
                treeBranchDepth: 3,
                // Combo effects scaling
                comboEffectScale: 0.4,
                leafBurstScale: 0.4,
                emberBurstScale: 0.4,
                maxFireRings: 1,
                maxEmberBursts: 1,
                maxLeafBurstParticles: 40,
                // Combo interaction multipliers
                comboColorShiftIntensity: 0.5,
                comboWindGustMultiplier: 0.6,
                comboFireflySpawnMultiplier: 0.6,
                comboMultiplierGain: 0.16,
            },
            'Medium': {
                // Leaf particles
                leafLayerBackCount: 100,
                leafLayerMidCount: 80,
                leafLayerFrontCount: 60,
                groundLeavesCount: 45,
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
                leafLayerBackCount: 120,
                leafLayerMidCount: 100,
                leafLayerFrontCount: 80,
                groundLeavesCount: 45,
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
                leafLayerBackCount: 140,
                leafLayerMidCount: 120,
                leafLayerFrontCount: 100,
                groundLeavesCount: 45,
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
                leafLayerBackCount: 160,
                leafLayerMidCount: 140,
                leafLayerFrontCount: 120,
                groundLeavesCount: 60,
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
        this.maxLeafBurstParticles = this.activePreset.maxLeafBurstParticles;
        this.maxFirefliesLimit = this.activePreset.maxFireflies;

        // Generic object pool for canvas particles (embers, bursts, etc.)
        this.particlePool = [];

        // Pre-rendered leaf images for canvas rendering
        this.leafImages = [];
    }

    /**
     * Pre-render leaf shapes to offscreen canvases for high performance
     */
    preRenderLeaves() {
        this.leafImages = [];
        const leafShapes = [
            'M15,0 C12,8 2,10 2,15 C5,18 2,24 6,26 C10,24 12,26 15,30 C18,26 20,24 24,26 C28,24 25,18 28,15 C28,10 18,8 15,0 Z',
            'M15,0 C10,5 5,5 5,10 C2,12 5,15 2,20 C5,25 10,25 15,30 C20,25 25,25 28,20 C25,15 28,12 25,10 C25,5 20,5 15,0 Z',
            'M15,0 C5,10 2,20 15,30 C28,20 25,10 15,0 M15,0 L15,30',
            'M15,0 Q5,15 15,30 Q25,15 15,0',
        ];

        const leafColors = [
            '#d32f2f', '#ff5722', '#ff9100', '#ffc107', '#ffeb3b',
            '#795548', '#5d4037', '#e64a19', '#fbc02d', '#8e24aa'
        ];

        leafShapes.forEach(pathData => {
            leafColors.forEach(color => {
                const canvas = document.createElement('canvas');
                canvas.width = 40;
                canvas.height = 40;
                const ctx = canvas.getContext('2d');

                // Scale and center
                ctx.translate(5, 5);

                const p = new Path2D(pathData);
                ctx.fillStyle = color;
                ctx.fill(p);

                // Add stroke for definition
                ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                ctx.lineWidth = 1;
                ctx.stroke(p);

                this.leafImages.push(canvas);
            });
        });
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

        // Pre-render leaves if needed
        if (this.leafImages.length === 0) {
            this.preRenderLeaves();
        }

        // Clear existing DOM leaves
        ['fall-leaves-back', 'fall-leaves-mid', 'fall-leaves-front'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });

        // Recreate leaf particles
        this.leafParticles = [];

        const layers = [
            { count: preset.leafLayerBackCount, depth: 0.3, minSize: 15, maxSize: 25 },
            { count: preset.leafLayerMidCount, depth: 0.6, minSize: 20, maxSize: 35 },
            { count: preset.leafLayerFrontCount, depth: 1.0, minSize: 25, maxSize: 45 }
        ];

        layers.forEach(layer => {
            for (let i = 0; i < layer.count; i++) {
                const img = this.leafImages[Math.floor(Math.random() * this.leafImages.length)];
                const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                this.leafParticles.push(this.createLeafParticle(img, layer.depth, size));
            }
        });

        // Create overlay for combo effects if not exists
        let overlay = document.getElementById('fall-theme-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'fall-theme-overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '10'; // Above leaves
            overlay.style.mixBlendMode = 'overlay';
            overlay.style.transition = 'background-color 0.1s';

            const themeContainer = document.getElementById('fall-theme');
            if (themeContainer) themeContainer.appendChild(overlay);
        }

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

        // Initialize canvas for ember particles and effects - DO THIS FIRST
        this.canvas = document.getElementById('fall-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        // Resize handler with debounce
        this.resizeHandler = () => {
            if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 100);
        };
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        // Pre-render leaves for canvas rendering
        if (this.leafImages.length === 0) {
            this.preRenderLeaves();
        }

        // Clear any existing DOM leaves (just in case)
        ['fall-leaves-back', 'fall-leaves-mid', 'fall-leaves-front'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });

        // Initialize leaf particles for canvas rendering
        this.leafParticles = [];
        const layers = [
            { count: preset.leafLayerBackCount, depth: 0.3, minSize: 15, maxSize: 25 },
            { count: preset.leafLayerMidCount, depth: 0.6, minSize: 20, maxSize: 35 },
            { count: preset.leafLayerFrontCount, depth: 1.0, minSize: 25, maxSize: 45 }
        ];

        layers.forEach(layer => {
            for (let i = 0; i < layer.count; i++) {
                const img = this.leafImages[Math.floor(Math.random() * this.leafImages.length)];
                const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                this.leafParticles.push(this.createLeafParticle(img, layer.depth, size));
            }
        });

        // Initial update to position leaves
        this.updateLeafParticles(0);

        // Dynamic Ground leaves - using quality preset count
        // Note: Ground leaves are still DOM for now as they are static/CSS animated
        const leafShapes = [
            'M15,0 C12,8 2,10 2,15 C5,18 2,24 6,26 C10,24 12,26 15,30 C18,26 20,24 24,26 C28,24 25,18 28,15 C28,10 18,8 15,0 Z',
            'M15,0 C10,5 5,5 5,10 C2,12 5,15 2,20 C5,25 10,25 15,30 C20,25 25,25 28,20 C25,15 28,12 25,10 C25,5 20,5 15,0 Z',
            'M15,0 C5,10 2,20 15,30 C28,20 25,10 15,0 M15,0 L15,30',
            'M15,0 Q5,15 15,30 Q25,15 15,0',
        ];

        const leafColors = [
            '#d32f2f', '#ff5722', '#ff9100', '#ffc107', '#ffeb3b',
            '#795548', '#5d4037', '#e64a19', '#fbc02d', '#8e24aa'
        ];

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

    createLeafParticle(image, depth, size) {
        const { height } = this.getViewportSize();
        const depthScale = 0.6 + depth * 0.8;

        // 3D Rotation axis (random vector)
        const axisX = Math.random() * 2 - 1;
        const axisY = Math.random() * 2 - 1;
        const axisZ = Math.random() * 2 - 1;
        const axisLen = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);

        return {
            image,
            depth,
            size: size || (20 + Math.random() * 20),
            xPercent: Math.random() * 100,
            y: Math.random() * height - height * 0.2,

            // Movement Physics
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: (0.5 + Math.random() * 1.0) * depthScale,
            swayAmplitude: (20 + Math.random() * 40) * depthScale,

            // Flutter (fast wobble)
            flutterPhase: Math.random() * Math.PI * 2,
            flutterSpeed: (3 + Math.random() * 5) * depthScale,
            flutterAmount: (2 + Math.random() * 3) * depthScale,

            driftSpeedFactor: (Math.random() * 0.006 + 0.002) * (Math.random() < 0.5 ? -1 : 1) * (0.6 + depth),
            driftOffset: 0,

            baseFallSpeed: (35 + Math.random() * 25) * depthScale,
            maxFallSpeed: (90 + Math.random() * 40) * depthScale,
            gravity: (15 + Math.random() * 10) * depthScale,
            velocityY: 0,

            turbulencePhase: Math.random() * Math.PI * 2,
            turbulenceSpeed: Math.random() * 1.5 + 0.5,
            turbulenceAmount: 6 + Math.random() * 10,

            // 3D Rotation
            rotation: Math.random() * 360,
            rotationSpeed: (20 + Math.random() * 60) * (Math.random() < 0.5 ? -1 : 1),

            // Tumble (3D flip)
            tumblePhase: Math.random() * Math.PI * 2,
            tumbleSpeed: (1 + Math.random() * 3) * depthScale,
            axis: { x: axisX / axisLen, y: axisY / axisLen, z: axisZ / axisLen },

            // State
            isGroundGust: false,
        };
    }



    /**
     * Get a generic particle object from the pool
     */
    getParticle() {
        if (this.particlePool.length > 0) {
            return this.particlePool.pop();
        }
        return {};
    }

    /**
     * Recycle a generic particle object
     */
    recycleParticle(p) {
        // Optional: clear properties if needed, but usually overwriting is enough
        this.particlePool.push(p);
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

            // Gravity and Velocity
            if (leaf.isGroundGust) {
                // Ground gust particles have different physics (fly up then fall)
                leaf.velocityY += leaf.gravity * dt * 2; // Heavier gravity for gust leaves
                leaf.y += leaf.velocityY * dt;

                // Remove if fell back below screen
                if (leaf.velocityY > 0 && leaf.y > height + 50) {
                    leaf.needsRemoval = true;
                }
            } else {
                // Normal falling leaves
                leaf.velocityY = Math.min(
                    leaf.velocityY + leaf.gravity * dt,
                    leaf.maxFallSpeed
                );

                leaf.turbulencePhase += leaf.turbulenceSpeed * dt;
                const turbulence = Math.sin(leaf.turbulencePhase) * leaf.turbulenceAmount;
                leaf.y += (leaf.velocityY + turbulence) * dt;
            }

            // Horizontal Movement (Sway + Flutter + Wind)
            leaf.swayPhase += leaf.swaySpeed * dt;
            leaf.flutterPhase += leaf.flutterSpeed * dt;

            // Complex sway: Main sway + fast flutter
            const sway = Math.sin(leaf.swayPhase) * leaf.swayAmplitude;
            const flutter = Math.sin(leaf.flutterPhase) * leaf.flutterAmount;

            // Wind influence
            const driftSpeed = leaf.driftSpeedFactor * width;
            // Wind affects rotation and tumble too
            const windPush = this.windForce * 50 * depthInfluence;
            leaf.driftOffset += (driftSpeed + windPush) * dt;

            // Clamp drift for normal leaves to keep them in play area roughly
            if (!leaf.isGroundGust) {
                const maxDrift = width * 0.3 * depthInfluence;
                if (leaf.driftOffset > maxDrift) leaf.driftOffset = maxDrift;
                else if (leaf.driftOffset < -maxDrift) leaf.driftOffset = -maxDrift;
            }

            const x = (leaf.xPercent / 100) * width + sway + flutter + leaf.driftOffset;

            // Rotation and Tumble
            leaf.rotation += leaf.rotationSpeed * dt;
            leaf.tumblePhase += leaf.tumbleSpeed * dt;

            // 3D Transform Simulation on Canvas
            const tumbleAngle = Math.sin(leaf.tumblePhase);

            // Simulate 3D tumble by scaling one axis
            // If tumbling around X, Y scale changes. If Y, X scale changes.
            // We'll simplify and just scale Y based on tumble to look like it's flipping
            const tumbleScale = Math.cos(leaf.tumblePhase);

            this.ctx.save();
            this.ctx.translate(x, leaf.y);
            this.ctx.rotate(leaf.rotation * Math.PI / 180);

            // Apply tumble scale (simulate 3D)
            if (this.currentQuality !== 'Minimal' && this.currentQuality !== 'Low') {
                this.ctx.scale(1, tumbleScale);
            }

            this.ctx.drawImage(leaf.image, -leaf.size / 2, -leaf.size / 2, leaf.size, leaf.size);
            this.ctx.restore();

            // Reset normal leaves if they go off screen
            if (!leaf.isGroundGust && leaf.y > height + 120) {
                this.resetLeafParticle(leaf, height);
            }
        });

        // Clean up gust particles
        for (let i = this.leafParticles.length - 1; i >= 0; i--) {
            if (this.leafParticles[i].needsRemoval) {
                this.leafParticles.splice(i, 1);
            }
        }
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
        const p = this.getParticle();
        p.x = Math.random() * this.canvas.width;
        p.y = Math.random() * this.canvas.height;
        p.baseX = Math.random() * this.canvas.width;
        p.baseY = Math.random() * this.canvas.height;
        p.vx = (Math.random() - 0.5) * 0.4;
        p.vy = (Math.random() - 0.5) * 0.4;
        p.wander = Math.random() * Math.PI * 2;
        p.wanderSpeed = Math.random() * 0.02 + 0.01;
        p.wanderRadius = Math.random() * 25 + 15;
        p.size = Math.random() * 1.5 + 1;
        p.glow = Math.random() * Math.PI * 2;
        p.glowSpeed = Math.random() * 0.05 + 0.03;
        p.opacity = Math.random() * 0.6 + 0.4;
        p.hue = Math.random() * 20 + 40; // Yellow-green range
        p.pulsePhase = Math.random() * Math.PI * 2;
        p.pulseSpeed = Math.random() * 0.04 + 0.02;
        return p;
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
        const { width, height } = this.getViewportSize();

        // GROUND GUST EFFECT: Spawn leaves from the bottom
        if (lineCount >= 1) {
            const gustCount = Math.min(lineCount * 5 + this.comboCount * 3, 30);

            for (let i = 0; i < gustCount; i++) {
                // Get random pre-rendered image
                const img = this.leafImages[Math.floor(Math.random() * this.leafImages.length)];
                const size = Math.random() * 20 + 20;

                // Create particle
                const particle = this.createLeafParticle(img, 1.2, size); // High depth for front
                particle.isGroundGust = true;
                particle.y = height + Math.random() * 50; // Start below screen
                particle.xPercent = Math.random() * 100;
                particle.velocityY = -(Math.random() * 400 + 300 + lineCount * 50); // Shoot up
                particle.vx = (Math.random() - 0.5) * 200; // Spread X
                particle.gravity = 400; // Heavy gravity to fall back fast

                // Override update logic to use vx
                particle.driftOffset = (Math.random() - 0.5) * width * 0.5;

                this.leafParticles.push(particle);
            }
        }

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

            const p = this.getParticle();
            p.x = centerX + Math.cos(angle) * distance;
            p.y = centerY + Math.sin(angle) * distance;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 2; // Upward bias
            p.rotation = Math.random() * 360;
            p.rotationSpeed = (Math.random() - 0.5) * 20;
            p.size = Math.random() * 8 + 4;
            p.life = 1.0;
            p.opacity = Math.random() * 0.8 + 0.4;
            p.hue = Math.random() * 60; // Autumn colors
            p.gravity = 0.15;
            p.swirl = Math.random() * Math.PI * 2;
            p.swirlSpeed = (Math.random() - 0.5) * 0.3;

            this.leafBurstParticles.push(p);
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

            const p = this.getParticle();
            p.x = centerX + (Math.random() - 0.5) * 100;
            p.y = centerY;
            p.vx = Math.cos(angle) * speed * 0.5;
            p.vy = Math.sin(angle) * speed - 3; // Strong upward force
            p.life = 1.0;
            p.size = Math.random() * 4 + 2;
            p.opacity = 1.0;
            p.twinkle = Math.random() * Math.PI * 2;
            p.twinkleSpeed = Math.random() * 0.08 + 0.04;
            p.hue = Math.random() * 30 + 10; // Yellow-orange-red
            p.isBurst = true;
            p.gravity = -0.05; // Slight upward drift

            this.embers.push(p);
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

            const burst = {
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
            };
            this.emberBursts.push(burst);
        }

        // Spawn extra fireflies on big combos - quality limited and scaled by preset
        if (comboCount >= 3) {
            const fireflyMultiplier = this.activePreset.comboFireflySpawnMultiplier || 1.0;
            const firefliesToSpawn = Math.min(Math.ceil(comboCount * 2 * fireflyMultiplier), 10);
            for (let i = 0; i < firefliesToSpawn && this.fireflies.length < this.maxFirefliesLimit; i++) {
                this.fireflies.push(this.createFirefly());
            }
        }

        // Add wind impulse
        this.targetWindForce += comboCount * 0.5;
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
        if (!this.isActive || !this.ctx || !this.canvas) {
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

        // Update theme overlay for combo effects (Golden Hour effect)
        const overlay = document.getElementById('fall-theme-overlay');
        if (overlay) {
            if (this.comboMultiplier > 1.0) {
                // Calculate amber/gold tint intensity
                const intensity = Math.min((this.comboMultiplier - 1.0) * 0.3, 0.6);
                overlay.style.backgroundColor = `rgba(255, 160, 0, ${intensity})`; // Amber tint
            } else {
                overlay.style.backgroundColor = 'transparent';
            }
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

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Update and draw leaf particles (after clearing canvas)
        this.updateLeafParticles(deltaSeconds);

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

            if (Math.random() < 0.6 && burst.radius < burst.maxRadius) {
                const particleAngle = burst.angle + Math.random() * Math.PI * 0.4;
                const particleRadius = burst.radius + Math.random() * 30;

                const p = this.getParticle();
                p.x = burst.x + Math.cos(particleAngle) * particleRadius;
                p.y = burst.y + Math.sin(particleAngle) * particleRadius;
                p.size = Math.random() * 3 + 1.5;
                p.opacity = Math.random() * 0.9 + 0.3;
                p.vx = Math.cos(particleAngle) * 2;
                p.vy = Math.sin(particleAngle) * 2 - 1.5;
                p.life = 1.0;
                p.hue = Math.random() * 30 + 15;

                burst.particles.push(p);
            }

            // Update and draw burst particles
            for (let j = burst.particles.length - 1; j >= 0; j--) {
                const p = burst.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.015;
                p.opacity = p.life;

                if (p.life <= 0) {
                    this.recycleParticle(p);
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
                this.recycleParticle(leaf);
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
        while (this.fireflies.length > this.maxFirefliesLimit) {
            const p = this.fireflies.pop();
            this.recycleParticle(p);
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
                    this.recycleParticle(ember);
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

        // Clear pool
        this.particlePool = [];

        super.stop();
    }
}

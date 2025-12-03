
import { BaseTheme } from '../base-theme.js';
import { MEADOW_TETROMINOS } from './meadow-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import WebGLMeadowEnvironment from './webgl-meadow-environment.js';
import WebGLMeadowGrass from './webgl-meadow-grass.js';
import WebGLMeadowFlowers from './webgl-meadow-flowers.js';
import WebGLMeadowCreatures from './webgl-meadow-creatures.js';
import WebGLMeadowEffects from './webgl-meadow-effects.js';

/**
 * Meadow Theme - An idyllic sun-dappled meadow experience (WebGL Enhanced)
 */
export default class MeadowTheme extends BaseTheme {
    constructor() {
        super('meadow');
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;

        // WebGL Renderers
        this.webglEnvironment = null;
        this.webglGrass = null;
        this.webglFlowers = null;
        this.webglCreatures = null;
        this.webglEffects = null;

        // Canvases
        this.bgCanvas = null;
        this.grassCanvas = null;
        this.flowerCanvas = null;
        this.creatureCanvas = null;
        this.effectsCanvas = null;

        // Graphics quality presets - Drastically reduced counts for a calmer look
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                grassCount: 500,
                flowerCount: 15,
                butterflyCount: 1,
                beeCount: 0,
                fireflyCount: 0,
                pollenCount: 5,
            },
            Low: {
                grassCount: 1000,
                flowerCount: 30,
                butterflyCount: 2,
                beeCount: 1,
                fireflyCount: 2,
                pollenCount: 10,
            },
            Medium: {
                grassCount: 2000,
                flowerCount: 50,
                butterflyCount: 4,
                beeCount: 2,
                fireflyCount: 5,
                pollenCount: 20,
            },
            High: {
                grassCount: 3500,
                flowerCount: 80,
                butterflyCount: 6,
                beeCount: 3,
                fireflyCount: 10,
                pollenCount: 30,
            },
            Ultra: {
                grassCount: 5000,
                flowerCount: 120,
                butterflyCount: 10,
                beeCount: 5,
                fireflyCount: 20,
                pollenCount: 50,
            },
            Extreme: {
                grassCount: 8000,
                flowerCount: 200,
                butterflyCount: 15,
                beeCount: 8,
                fireflyCount: 30,
                pollenCount: 80,
            },
        };

        this.activePreset = this.qualityPresets.High;
        this.qualityChangeHandler = null;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[MeadowTheme] Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        if (this.isActive) {
            this.refreshQualityDependentElements();
        }

        console.log(`🌸 [MeadowTheme] Applied ${quality} quality preset`);
    }

    refreshQualityDependentElements() {
        if (this.webglGrass) {
            this.webglGrass.generateGrass(this.activePreset.grassCount, window.innerWidth, window.innerHeight);
        }
        if (this.webglFlowers) {
            this.webglFlowers.generateFlowers(this.activePreset.flowerCount, window.innerWidth, window.innerHeight);
        }
        if (this.webglCreatures) {
            this.webglCreatures.spawnCreatures(this.activePreset, window.innerWidth, window.innerHeight);
        }
        if (this.webglEffects) {
            this.webglEffects.particles = []; // Clear existing
            this.webglEffects.createPollen(this.activePreset.pollenCount, window.innerWidth, window.innerHeight);
        }
    }

    setupQualityListener() {
        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        const themeContainer = document.getElementById('meadow-theme');
        if (!themeContainer) return;

        // Clear existing content
        themeContainer.innerHTML = '';
        themeContainer.style.background = '#000'; // Fallback

        // Apply quality preset
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // Setup WebGL Layers (Order matters for Z-index)

        // 1. Environment (Sky, Sun, Clouds) - Background
        this.setupWebGLEnvironment(themeContainer);

        // 2. Grass - Behind grid/board
        this.setupWebGLGrass(themeContainer);

        // 3. Flowers - Intermixed with grass
        this.setupWebGLFlowers(themeContainer);

        // 4. Creatures - Flying around
        this.setupWebGLCreatures(themeContainer);

        // 5. Effects - Top layer (Pollen, Bursts)
        this.setupWebGLEffects(themeContainer);

        // Setup Event Listeners
        this.setupEventListeners();

        // Force initial resize to ensure canvases are not default 300x150
        this.handleResize();

        // Start Animation Loop
        this.startAnimation();
    }

    setupWebGLEnvironment(container) {
        const canvas = this.createCanvas('meadow-environment-canvas', 0);
        container.appendChild(canvas);
        this.bgCanvas = canvas;

        this.webglEnvironment = new WebGLMeadowEnvironment(canvas);
        if (!this.webglEnvironment.init()) {
            console.warn('Meadow: Failed to init WebGL Environment');
        }
    }

    setupWebGLGrass(container) {
        const canvas = this.createCanvas('meadow-grass-canvas', 1);
        container.appendChild(canvas);
        this.grassCanvas = canvas;

        this.webglGrass = new WebGLMeadowGrass(canvas);
        if (this.webglGrass.init()) {
            this.webglGrass.generateGrass(this.activePreset.grassCount, window.innerWidth, window.innerHeight);
        } else {
            console.warn('Meadow: Failed to init WebGL Grass');
        }
    }

    setupWebGLFlowers(container) {
        const canvas = this.createCanvas('meadow-flowers-canvas', 2);
        container.appendChild(canvas);
        this.flowerCanvas = canvas;

        this.webglFlowers = new WebGLMeadowFlowers(canvas);
        if (this.webglFlowers.init()) {
            this.webglFlowers.generateFlowers(this.activePreset.flowerCount, window.innerWidth, window.innerHeight);
        } else {
            console.warn('Meadow: Failed to init WebGL Flowers');
        }
    }

    setupWebGLCreatures(container) {
        const canvas = this.createCanvas('meadow-creatures-canvas', 3);
        container.appendChild(canvas);
        this.creatureCanvas = canvas;

        this.webglCreatures = new WebGLMeadowCreatures(canvas);
        if (this.webglCreatures.init()) {
            this.webglCreatures.spawnCreatures(this.activePreset, window.innerWidth, window.innerHeight);
        } else {
            console.warn('Meadow: Failed to init WebGL Creatures');
        }
    }

    setupWebGLEffects(container) {
        const canvas = this.createCanvas('meadow-effects-canvas', 100); // Top layer
        container.appendChild(canvas);
        this.effectsCanvas = canvas;

        this.webglEffects = new WebGLMeadowEffects(canvas);
        if (this.webglEffects.init()) {
            this.webglEffects.createPollen(this.activePreset.pollenCount, window.innerWidth, window.innerHeight);
        } else {
            console.warn('Meadow: Failed to init WebGL Effects');
        }
    }

    createCanvas(id, zIndex) {
        const canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = zIndex;
        canvas.style.pointerEvents = 'none';
        return canvas;
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && this.webglEffects) {
                // Burst of petals/light
                // Center of screen or random
                const x = window.innerWidth / 2 + (Math.random() - 0.5) * 400;
                const y = window.innerHeight / 2 + (Math.random() - 0.5) * 400;
                this.webglEffects.createBurst(x, y, 20 + data.lineCount * 10, [1.0, 0.8, 0.2, 1.0]);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && this.webglEffects && data.comboCount > 1) {
                // More bursts
                const x = Math.random() * window.innerWidth;
                const y = Math.random() * window.innerHeight;
                this.webglEffects.createBurst(x, y, 15, [0.5, 1.0, 0.5, 1.0]);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);

        // Resize listener
        const resizeHandler = () => this.handleResize();
        window.addEventListener('resize', resizeHandler);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', resizeHandler));
    }

    handleResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (this.webglEnvironment) this.webglEnvironment.resize(w, h);
        if (this.webglGrass) {
            this.webglGrass.resize(w, h);
            // Optionally regenerate grass if density looks wrong, but scaling is usually fine
        }
        if (this.webglFlowers) this.webglFlowers.resize(w, h);
        if (this.webglCreatures) this.webglCreatures.resize(w, h);
        if (this.webglEffects) this.webglEffects.resize(w, h);
    }

    startAnimation() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);

        const loop = (timestamp) => {
            if (!this.isActive) return;

            // Convert to seconds for shaders to avoid hyperspeed
            const timeInSeconds = timestamp * 0.001;

            const dt = (timestamp - this.lastTime) / 1000;
            this.lastTime = timestamp;

            // Render all layers
            if (this.webglEnvironment) this.webglEnvironment.render(timeInSeconds);
            if (this.webglGrass) this.webglGrass.render(timeInSeconds, 0.0); // Wind strength 0 for now
            if (this.webglFlowers) this.webglFlowers.render(timeInSeconds, 0.0);
            if (this.webglCreatures) this.webglCreatures.render(timeInSeconds, dt);
            if (this.webglEffects) this.webglEffects.render(timeInSeconds, dt);

            this.animationFrameId = requestAnimationFrame(loop);
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }

    cleanup() {
        super.cleanup();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.teardownQualityListener();

        // Clean up WebGL contexts if needed (usually handled by GC when canvas is removed)
        const container = document.getElementById('meadow-theme');
        if (container) {
            container.innerHTML = '';
        }
    }
}

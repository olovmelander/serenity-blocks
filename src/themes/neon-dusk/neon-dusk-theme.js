import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { NEON_DUSK_TETROMINOS } from './neon-dusk-tetrominos.js';
import WebGLNeonEnvironment from './webgl-neon-environment.js';
import WebGLNeonEffects from './webgl-neon-effects.js';
import WebGLNeonSun from './webgl-neon-sun.js';
import WebGLNeonMountains from './webgl-neon-mountains.js';
import WebGLNeonGrid from './webgl-neon-grid.js';

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');
        // Performance limits
        this.MAX_PARTICLES = 180;
        this.MAX_ARCS = 6;
        this.MAX_SCANLINES = 12;
        this.MAX_RINGS = 8;
        this.MAX_VORTEXES = 3;
        this.MAX_GLITCHES = 15;

        // Pre-calculated color cache for performance
        this.colorCache = new Map();
        this.initColorCache();

        // Gameplay effects
        this.neonBurstParticles = [];
        this.electricArcs = [];
        this.digitalScanLines = [];
        this.hologramRings = [];
        this.cyberVortexes = [];
        this.glitchPulses = [];
        this.gridWaves = []; // Wave effects for grid
        this.comboMultiplier = 1.0;
        this.effectsAnimationFrame = null;
        this.lastEffectsFrameTime = 0;
        this.eventUnsubscribers = [];

        // WebGL Renderers
        this.webglEnvironment = null; // Unified Background
        this.webglBackEffects = null; // Background Effects (Rings behind sun)
        this.webglEffects = null;     // Particles
        this.webglSun = null;         // Sun Renderer
        this.webglMountains = null;   // Mountains Renderer
        this.webglGrid = null;        // Grid Renderer (Foreground)
        this.bgCanvas = null;
        this.backEffectsCanvas = null;
        this.sunCanvas = null;
        this.mountainsCanvas = null;
        this.gridCanvas = null;
        this.effectsCanvas = null;

        // DOM references for rebuilds
        this.particlesContainer = null;

        // Graphics quality state
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            Minimal: {
                floatingParticles: 12,
                maxParticles: 60,
                maxArcs: 2,
                maxScanlines: 3,
                maxRings: 2,
                maxVortexes: 0,
                maxGlitches: 4,
            },
            Low: {
                floatingParticles: 18,
                maxParticles: 100,
                maxArcs: 3,
                maxScanlines: 5,
                maxRings: 3,
                maxVortexes: 1,
                maxGlitches: 6,
            },
            Medium: {
                floatingParticles: 28,
                maxParticles: 140,
                maxArcs: 5,
                maxScanlines: 8,
                maxRings: 5,
                maxVortexes: 2,
                maxGlitches: 10,
            },
            High: {
                floatingParticles: 40,
                maxParticles: 180,
                maxArcs: 6,
                maxScanlines: 12,
                maxRings: 8,
                maxVortexes: 3,
                maxGlitches: 15,
            },
            Ultra: {
                floatingParticles: 60,
                maxParticles: 240,
                maxArcs: 10,
                maxScanlines: 18,
                maxRings: 12,
                maxVortexes: 5,
                maxGlitches: 22,
            },
            Extreme: {
                floatingParticles: 85,
                maxParticles: 350,
                maxArcs: 15,
                maxScanlines: 25,
                maxRings: 18,
                maxVortexes: 8,
                maxGlitches: 35,
            },
        };

        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;

        // Random starting time offset so sun starts at different position each time
        this.timeOffset = Math.random() * 10000;

        this.currentSunPos = { x: 0, y: 0.25 };
        this.mountainGlowIntensity = 0.0;
    }

    // Initialize color cache to avoid repeated hex conversions
    initColorCache() {
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ff0088', '#ffff00'];
        // Pre-calculate alpha variations for common values
        for (const color of colors) {
            for (let alpha = 0; alpha <= 255; alpha += 5) {
                const key = `${color}-${alpha}`;
                const hex = alpha.toString(16).padStart(2, '0');
                this.colorCache.set(key, `${color}${hex}`);
            }
        }
    }

    // Fast color with alpha lookup
    getColorWithAlpha(color, alpha) {
        const alphaValue = Math.floor(alpha * 255);
        const quantized = Math.floor(alphaValue / 5) * 5; // Quantize to nearest 5
        const key = `${color}-${quantized}`;
        return this.colorCache.get(key) || `${color}${alphaValue.toString(16).padStart(2, '0')}`;
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Neon Dusk: Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        const preset = this.activePreset;
        this.MAX_PARTICLES = preset.maxParticles;
        this.MAX_ARCS = preset.maxArcs;
        this.MAX_SCANLINES = preset.maxScanlines;
        this.MAX_RINGS = preset.maxRings;
        this.MAX_VORTEXES = preset.maxVortexes;
        this.MAX_GLITCHES = preset.maxGlitches;

        this.trimEffectCollections();

        console.log(`🌆 Neon Dusk: Applying ${quality} quality preset`);
    }

    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (!collection || typeof limit !== 'number') return;
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        clamp(this.neonBurstParticles, this.MAX_PARTICLES);
        clamp(this.electricArcs, this.MAX_ARCS);
        clamp(this.digitalScanLines, this.MAX_SCANLINES);
        clamp(this.hologramRings, this.MAX_RINGS);
        clamp(this.cyberVortexes, this.MAX_VORTEXES);
        clamp(this.glitchPulses, this.MAX_GLITCHES);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        }

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
            this.refreshQualityDependentElements();
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    refreshQualityDependentElements() {
        // WebGL Environment handles quality updates internally via uniforms if needed
        // For now, we just trim effects
        this.trimEffectCollections();
    }

    // Legacy DOM methods removed to prevent 'two suns' and clutter
    // All background elements are now rendered in WebGLNeonEnvironment

    async createScene() {
        // Force background to black to hide any previous theme artifacts
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (themeContainer) {
            themeContainer.style.background = '#050010'; // Deep dark purple/black
            // Force clear any background image
            themeContainer.style.backgroundImage = 'none';
        }

        // Aggressive cleanup of potential leftover elements from other themes
        // Specifically target Synthwave Sunset and other theme elements that might persist
        const potentialLeftovers = document.querySelectorAll(
            '.sun, .mountain, .grid, .starfield, ' +
            '#synthwave-sunset-sun, .synthwave-sun-canvas, ' +
            '#synthwave-sunset-grid, .synthwave-grid-canvas, ' +
            '.synthwave-effects-canvas, [class*="synthwave"]'
        );
        potentialLeftovers.forEach(el => {
            el.remove();
        });

        // Also remove any canvases in our container that aren't ours
        if (themeContainer) {
            const allCanvases = themeContainer.querySelectorAll('canvas');
            allCanvases.forEach(canvas => {
                if (!canvas.id.startsWith('neon-dusk-')) {
                    canvas.remove();
                }
            });
        }

        // Apply graphics quality preset before building the scene
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        // Setup WebGL Background (Environment: Sky, Grid)
        this.setupWebGLBackground();

        // Setup WebGL Background Effects (Rings behind sun)
        this.setupBackEffects();

        // Setup WebGL Sun (Separate layer for better control)
        this.setupWebGLSun();

        // Setup WebGL Mountains (In front of sun)
        this.setupWebGLMountains();

        // Setup WebGL Grid (In front of mountains)
        this.setupWebGLGrid();

        // Setup WebGL Effects (Particles: Ambient & Gameplay)
        this.setupGameplayEffects();

        // Initialize ambient particles (now WebGL-based)
        this.initAmbientParticles();

        // Listen for runtime changes to graphics quality
        this.setupQualityListener();
    }

    setupWebGLBackground() {
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (!themeContainer) return;

        // Clear any existing canvases to prevent duplicates
        const existingBg = document.getElementById('neon-dusk-background-canvas');
        if (existingBg) existingBg.remove();

        // Remove any old DOM containers if they exist
        const containers = [
            'neon-dusk-stars', 'neon-dusk-clouds', 'neon-dusk-meteors',
            'neon-dusk-particles', 'neon-dusk-mountains-back',
            'neon-dusk-mountains-mid', 'neon-dusk-mountains-front'
        ];
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        // Create new background canvas
        let canvas = document.createElement('canvas');
        canvas.id = 'neon-dusk-background-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '0'; // Behind everything
        themeContainer.insertBefore(canvas, themeContainer.firstChild);

        this.bgCanvas = canvas;

        // Initialize Environment Renderer
        this.webglEnvironment = new WebGLNeonEnvironment(canvas);
        if (!this.webglEnvironment.init()) {
            console.warn('Neon Dusk: Failed to init WebGL Environment');
        }

        // Handle resize
        const resize = () => {
            const rect = themeContainer.getBoundingClientRect();
            if (this.bgCanvas && this.webglEnvironment) {
                this.webglEnvironment.resize(rect.width, rect.height);
            }
        };
        resize();
        window.addEventListener('resize', resize);
        resize();
        window.addEventListener('resize', resize);
    }

    setupBackEffects() {
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (!themeContainer) return;

        // Clear existing
        const existing = document.getElementById('neon-dusk-back-effects-canvas');
        if (existing) existing.remove();

        // Create canvas (layer behind sun)
        let canvas = document.createElement('canvas');
        canvas.id = 'neon-dusk-back-effects-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '0.5'; // Above bg (0), below sun (1)
        canvas.style.pointerEvents = 'none';
        themeContainer.appendChild(canvas);

        this.backEffectsCanvas = canvas;

        // Initialize Effects Renderer for background
        this.webglBackEffects = new WebGLNeonEffects(canvas);
        if (!this.webglBackEffects.init()) {
            console.warn('Neon Dusk: Failed to init WebGL Back Effects');
        }

        // Handle resize
        const resize = () => {
            const rect = themeContainer.getBoundingClientRect();
            if (this.backEffectsCanvas && this.webglBackEffects) {
                this.webglBackEffects.resize(rect.width, rect.height);
            }
        };
        resize();
        window.addEventListener('resize', resize);
    }

    setupWebGLSun() {
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (!themeContainer) return;

        // Clear any existing sun canvas
        const existingSun = document.getElementById('neon-dusk-sun-canvas');
        if (existingSun) existingSun.remove();

        // Create sun canvas (layer between background and effects)
        let canvas = document.createElement('canvas');
        canvas.id = 'neon-dusk-sun-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '1'; // Above background (0), below effects (100)
        canvas.style.pointerEvents = 'none';
        themeContainer.appendChild(canvas);

        this.sunCanvas = canvas;

        // Initialize Sun Renderer
        this.webglSun = new WebGLNeonSun(canvas);
        if (!this.webglSun.init()) {
            console.warn('Neon Dusk: Failed to init WebGL Sun');
        }

        // Handle resize
        const resize = () => {
            const rect = themeContainer.getBoundingClientRect();
            if (this.sunCanvas && this.webglSun) {
                this.webglSun.resize(rect.width, rect.height);
            }
        };
        resize();
        window.addEventListener('resize', resize);
    }

    setupWebGLMountains() {
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (!themeContainer) return;

        // Clear any existing mountains canvas
        const existingMountains = document.getElementById('neon-dusk-mountains-canvas');
        if (existingMountains) existingMountains.remove();

        // Create mountains canvas (layer in front of sun)
        let canvas = document.createElement('canvas');
        canvas.id = 'neon-dusk-mountains-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '2'; // Above sun (1), below effects (100)
        canvas.style.pointerEvents = 'none';
        themeContainer.appendChild(canvas);

        this.mountainsCanvas = canvas;

        // Initialize Mountains Renderer
        this.webglMountains = new WebGLNeonMountains(canvas);
        if (!this.webglMountains.init()) {
            console.warn('Neon Dusk: Failed to init WebGL Mountains');
        }

        // Handle resize
        const resize = () => {
            const rect = themeContainer.getBoundingClientRect();
            if (this.mountainsCanvas && this.webglMountains) {
                this.webglMountains.resize(rect.width, rect.height);
            }
        };
        resize();
        window.addEventListener('resize', resize);
    }

    setupWebGLGrid() {
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (!themeContainer) return;

        // Clear any existing grid canvas
        const existingGrid = document.getElementById('neon-dusk-grid-canvas');
        if (existingGrid) existingGrid.remove();

        // Create grid canvas (layer in front of mountains)
        let canvas = document.createElement('canvas');
        canvas.id = 'neon-dusk-grid-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '3'; // Above mountains (2), below effects (100)
        canvas.style.pointerEvents = 'none';
        themeContainer.appendChild(canvas);

        this.gridCanvas = canvas;

        // Initialize Grid Renderer
        this.webglGrid = new WebGLNeonGrid(canvas);
        if (!this.webglGrid.init()) {
            console.warn('Neon Dusk: Failed to init WebGL Grid');
        }

        // Handle resize
        const resize = () => {
            const rect = themeContainer.getBoundingClientRect();
            if (this.gridCanvas && this.webglGrid) {
                this.webglGrid.resize(rect.width, rect.height);
            }
        };
        resize();
        window.addEventListener('resize', resize);
    }

    initAmbientParticles() {
        // Clear existing
        this.ambientParticles = [];

        const count = this.activePreset?.floatingParticles ?? 40;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ff0088', '#ffff00'];

        for (let i = 0; i < count; i++) {
            this.ambientParticles.push({
                x: Math.random() * window.innerWidth,
                y: Math.random() * window.innerHeight,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 3 + 1,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: 1.0, // Always alive
                maxLife: 1.0,
                type: 0 // Circle/Particle
            });
        }
    }

    setupGameplayEffects() {
        // Create canvas for gameplay effects
        const themeContainer = document.getElementById('neon-dusk-theme');
        if (!themeContainer) return;

        let canvas = document.getElementById('neon-dusk-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'neon-dusk-effects-canvas';
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

        // Initialize WebGL Effects
        this.webglEffects = new WebGLNeonEffects(canvas);
        if (!this.webglEffects.init()) {
            console.warn('Neon Dusk: Failed to init WebGL Effects');
            // Fallback?
        }

        // Size canvas
        const resizeCanvas = () => {
            if (!this.effectsCanvas) return;
            const rect = themeContainer.getBoundingClientRect();
            // WebGL needs explicit width/height
            this.webglEffects.resize(rect.width, rect.height);
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Setup event listeners
        this.setupEventListeners();

        // Start effects animation loop
        this.startEffectsLoop();
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

    handleLineClear(data) {
        const { lineCount } = data;
        // Removed createNeonBurst to stop center sparkles

        if (lineCount >= 2) {
            this.createDigitalScanLines(lineCount);
        }

        if (lineCount >= 3) {
            this.createHologramRings(lineCount);
        }
    }

    handleCombo(data) {
        const { comboCount } = data;
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 3.5);

        // Boost mountain glow
        this.mountainGlowIntensity = Math.min(this.mountainGlowIntensity + 0.3, 1.0);

        if (comboCount >= 2) {
            this.createGlitchPulse(comboCount);
        }

        if (comboCount >= 4) {
            this.createElectricArcs(comboCount);
        }

        if (comboCount >= 4) {
            this.createElectricArcs(comboCount);
        }

        // Removed createCyberVortex to stop center sparkles
    }





    createElectricArcs(comboCount) {
        if (!this.effectsCanvas) return;

        // Limit arcs
        if (this.electricArcs.length >= this.MAX_ARCS) return;

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;
        const arcCount = Math.min(Math.floor(comboCount / 2), this.MAX_ARCS - this.electricArcs.length);
        const colors = ['#00ffff', '#ff00ff', '#00ff88'];

        for (let i = 0; i < arcCount; i++) {
            const startX = Math.random() * width;
            const startY = Math.random() * height;
            const endX = Math.random() * width;
            const endY = Math.random() * height;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.electricArcs.push({
                startX,
                startY,
                endX,
                endY,
                life: 1.0,
                maxLife: 0.4 + Math.random() * 0.3,
                color,
                segments: this.generateArcSegments(startX, startY, endX, endY, 6),
                width: Math.random() * 3 + 2,
            });
        }
    }

    generateArcSegments(x1, y1, x2, y2, count) {
        const segments = [{ x: x1, y: y1 }];
        const dx = (x2 - x1) / count;
        const dy = (y2 - y1) / count;

        for (let i = 1; i < count; i++) {
            const deviation = (Math.random() - 0.5) * 40;
            segments.push({
                x: x1 + dx * i + deviation,
                y: y1 + dy * i + deviation,
            });
        }
        segments.push({ x: x2, y: y2 });
        return segments;
    }

    createDigitalScanLines(lineCount) {
        if (!this.effectsCanvas) return;

        // Limit scan lines
        if (this.digitalScanLines.length >= this.MAX_SCANLINES) return;

        const { height } = this.effectsCanvas;
        const colors = ['#00ffff', '#ff00ff', '#00ff88'];
        const scanCount = Math.min(lineCount * 2, this.MAX_SCANLINES - this.digitalScanLines.length);

        for (let i = 0; i < scanCount; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.digitalScanLines.push({
                y: Math.random() * height,
                life: 1.0,
                maxLife: 0.8 + Math.random() * 0.4,
                speed: (Math.random() * 200 + 150) * (Math.random() > 0.5 ? 1 : -1),
                height: Math.random() * 3 + 1,
                color,
                opacity: Math.random() * 0.4 + 0.6,
            });
        }
    }

    createHologramRings(lineCount) {
        if (!this.effectsCanvas) return;

        // Limit rings
        if (this.hologramRings.length >= this.MAX_RINGS) return;

        // Rings now pulse from the sun position
        let centerX = this.effectsCanvas.width / 2;
        let centerY = this.effectsCanvas.height / 2;

        if (this.currentSunPos) {
            // Convert sun UV coordinates to pixel coordinates
            // uv.x = (pixelX - width/2) / height  => pixelX = uv.x * height + width/2
            // uv.y = (pixelY - height/2) / height => pixelY = uv.y * height + height/2 (but Y is inverted in canvas)
            // Actually sunY is 0.25 (up), so pixelY should be (0.5 - sunY) * height
            centerX = this.currentSunPos.x * this.effectsCanvas.height + this.effectsCanvas.width / 2;
            centerY = (0.5 - this.currentSunPos.y) * this.effectsCanvas.height;
        }

        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ffff00'];
        const ringCount = Math.min(lineCount, this.MAX_RINGS - this.hologramRings.length);
        const maxDim = Math.max(this.effectsCanvas.width, this.effectsCanvas.height);

        for (let i = 0; i < ringCount; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.hologramRings.push({
                x: centerX,
                y: centerY,
                radius: 10,
                maxRadius: maxDim * 1.2, // Expand to cover screen
                life: 1.0,
                maxLife: 1.2 + Math.random() * 0.5,
                color,
                width: Math.random() * 3 + 2,
            });
        }
    }

    createGlitchPulse(comboCount) {
        if (!this.effectsCanvas) return;

        // Limit glitch pulses
        if (this.glitchPulses.length >= this.MAX_GLITCHES) return;

        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;
        const colors = ['#00ffff', '#ff00ff', '#ffff00'];
        const glitchCount = Math.min(comboCount * 2, this.MAX_GLITCHES - this.glitchPulses.length);

        for (let i = 0; i < glitchCount; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.glitchPulses.push({
                x: Math.random() * width,
                y: Math.random() * height,
                width: Math.random() * 100 + 50,
                height: Math.random() * 20 + 10,
                life: 1.0,
                maxLife: 0.3 + Math.random() * 0.2,
                color,
                offsetX: (Math.random() - 0.5) * 20,
            });
        }
    }



    startEffectsLoop() {
        if (this.effectsAnimationFrame) return;

        const tick = (timestamp) => {
            if (!this.effectsAnimationFrame || !this.isActive) {
                return;
            }

            if (!this.lastEffectsFrameTime) {
                this.lastEffectsFrameTime = timestamp;
            }

            const delta = Math.min((timestamp - this.lastEffectsFrameTime) / 1000, 0.1);
            this.lastEffectsFrameTime = timestamp;

            this.updateEffects(delta);
            this.renderEffects(timestamp / 1000);

            this.effectsAnimationFrame = requestAnimationFrame(tick);
        };

        this.lastEffectsFrameTime = 0;
        this.effectsAnimationFrame = requestAnimationFrame(tick);
    }

    stopEffectsLoop() {
        if (this.effectsAnimationFrame) {
            cancelAnimationFrame(this.effectsAnimationFrame);
            this.effectsAnimationFrame = null;
        }
        this.lastEffectsFrameTime = 0;
    }

    updateEffects(delta) {
        // Removed neon burst update logic
        this.neonBurstParticles = []; // Ensure empty

        // Decay mountain glow
        if (this.mountainGlowIntensity > 0) {
            this.mountainGlowIntensity -= delta * 0.5; // Slow decay
            if (this.mountainGlowIntensity < 0) this.mountainGlowIntensity = 0;
        }

        // Update electric arcs - reduced flicker frequency for performance
        let writeIndex = 0;
        for (let i = 0; i < this.electricArcs.length; i++) {
            const arc = this.electricArcs[i];
            arc.life -= delta / arc.maxLife;

            // Regenerate segments less frequently (30% -> 15% chance)
            if (Math.random() > 0.85) {
                arc.segments = this.generateArcSegments(
                    arc.startX,
                    arc.startY,
                    arc.endX,
                    arc.endY,
                    6, // Reduced from 8 segments to 6 for performance
                );
            }

            if (arc.life > 0) {
                this.electricArcs[writeIndex++] = arc;
            }
        }
        this.electricArcs.length = writeIndex;

        // Update digital scan lines
        writeIndex = 0;
        for (let i = 0; i < this.digitalScanLines.length; i++) {
            const line = this.digitalScanLines[i];
            line.y += line.speed * delta;
            line.life -= delta / line.maxLife;

            if (line.life > 0) {
                this.digitalScanLines[writeIndex++] = line;
            }
        }
        this.digitalScanLines.length = writeIndex;

        // Update hologram rings
        writeIndex = 0;
        for (let i = 0; i < this.hologramRings.length; i++) {
            const ring = this.hologramRings[i];
            ring.radius += (ring.maxRadius / ring.maxLife) * delta;
            ring.life -= delta / ring.maxLife;

            if (ring.life > 0) {
                this.hologramRings[writeIndex++] = ring;
            }
        }
        this.hologramRings.length = writeIndex;

        // Update glitch pulses - reduce offset recalculation frequency
        writeIndex = 0;
        for (let i = 0; i < this.glitchPulses.length; i++) {
            const pulse = this.glitchPulses[i];
            pulse.life -= delta / pulse.maxLife;
            // Only update offset 50% of the time for performance
            if (Math.random() > 0.5) {
                pulse.offsetX = (Math.random() - 0.5) * 20;
            }

            if (pulse.life > 0) {
                this.glitchPulses[writeIndex++] = pulse;
            }
        }
        this.glitchPulses.length = writeIndex;

        // Removed cyber vortex update logic
        this.cyberVortexes = []; // Ensure empty



        // Update ambient particles
        for (let i = 0; i < this.ambientParticles.length; i++) {
            const p = this.ambientParticles[i];
            p.x += p.vx;
            p.y += p.vy;

            // Wrap around screen
            if (p.x < 0) p.x = window.innerWidth;
            if (p.x > window.innerWidth) p.x = 0;
            if (p.y < 0) p.y = window.innerHeight;
            if (p.y > window.innerHeight) p.y = 0;
        }
    }

    calculateSunPosition(time) {
        // Smooth left-to-right horizontal drift centered around screen center
        // The sun drifts continuously from left to right in a straight line

        // Movement range (percentage of viewport from center)
        const horizontalRange = 1.8; // Normalized range (screen width is roughly aspect ratio, e.g. 1.77)

        // Apply time offset so sun starts at different position each time
        const t = time + this.timeOffset;

        // Continuous left-to-right drift using modulo to loop smoothly
        const driftSpeed = 0.0007; // Very slow speed
        const driftProgress = (t * driftSpeed) % 1; // 0 to 1 progress

        // Map progress to position: -horizontalRange (left) to +horizontalRange (right)
        const aspect = window.innerWidth / window.innerHeight;
        const sunX = (driftProgress * 2 - 1) * horizontalRange * aspect;

        // Fixed vertical position
        const sunY = 0.25;

        return { x: sunX, y: sunY };
    }

    renderEffects(time) {
        // Render Environment (Sky only now)
        if (this.webglEnvironment) {
            this.webglEnvironment.render(time);
        }

        // Calculate dynamic sun position
        const sunPos = this.calculateSunPosition(time);
        this.currentSunPos = sunPos;

        // Render Sun (Separate layer for vibrant effects)
        if (this.webglSun) {
            this.webglSun.render(time, {
                x: sunPos.x,
                y: sunPos.y,
                radius: 0.25,        // Size
                colorTop: [1.0, 0.0, 1.0],    // Magenta top
                colorBottom: [0.0, 1.0, 1.0]  // Cyan bottom
            });
        }

        // Render Background Effects (Rings behind sun)
        if (this.webglBackEffects) {
            this.webglBackEffects.render(
                null, // bursts
                null, // arcs
                null, // scanlines
                this.hologramRings, // RINGS HERE
                null, // vortexes
                null, // glitches
                null  // ambient
            );
        }

        // Render Mountains (In front of sun)
        if (this.webglMountains) {
            this.webglMountains.render(this.mountainGlowIntensity);
        }

        // Render Grid (In front of mountains)
        if (this.webglGrid) {
            this.webglGrid.render(time, []);
        }

        // Render Effects
        if (this.webglEffects) {
            this.webglEffects.render(
                this.neonBurstParticles,
                this.electricArcs,
                this.digitalScanLines,
                null, // Rings moved to background
                this.cyberVortexes,
                this.glitchPulses,
                this.ambientParticles // Pass ambient particles
            );
        }
    }

    stop() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        this.stopEffectsLoop();
        super.stop();
    }

    cleanup() {
        this.cleanupEffects();
        super.cleanup();
    }

    cleanupEffects() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clear effect arrays
        this.neonBurstParticles = [];
        this.electricArcs = [];
        this.digitalScanLines = [];
        this.hologramRings = [];
        this.cyberVortexes = [];
        this.glitchPulses = [];

        // Stop animation loop
        this.stopEffectsLoop();

        // Remove canvas
        if (this.effectsCanvas) {
            this.effectsCanvas.remove();
            this.effectsCanvas = null;
        }
        if (this.backEffectsCanvas) {
            this.backEffectsCanvas.remove();
            this.backEffectsCanvas = null;
        }
    }

    // Meteor methods removed as they are no longer used

    /**
     * Provide neon-themed tetromino styling so blocks match the skyline palette
     * @returns {Object} Neon Dusk tetromino configuration
     */
    getTetrominoConfig() {
        return NEON_DUSK_TETROMINOS;
    }
}

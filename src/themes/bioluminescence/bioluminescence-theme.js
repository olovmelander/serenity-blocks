import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { BIOLUMINESCENCE_TETROMINOS } from './bioluminescence-tetrominos.js';
import WebGLBioRenderer from './webgl-bio-renderer.js';
import { BLOCK_SIZE, COLS, ROWS } from '../../core/constants.js';

export default class BioluminescenceTheme extends BaseTheme {
    constructor() {
        super('bioluminescence');
        this.canvas = null;
        this.ctx = null;
        this.webglCanvas = null;
        this.webglRenderer = null;
        this.useWebGL = false;
        this.resizeHandler = null;
        this.time = 0;

        // Background elements
        this.glowingPlants = []; // Various bioluminescent plants
        this.crystalFormations = []; // Glowing crystal clusters
        this.groundMushrooms = []; // Traditional mushroom shapes at ground level
        this.biolumRocks = []; // Glowing rocks and stones
        this.groundGlow = []; // Ground-level glow patches
        this.fireflies = [];
        this.spores = [];
        this.ambientGlows = []; // Floating ambient light spots
        this.luminousVines = []; // Hanging glowing vines
        this.globalRipples = []; // Screen-wide shockwaves
        this.alienFlora = []; // Strange bottom-layer plants

        // Performance limits
        this.MAX_PARTICLES = 200;
        this.MAX_ENERGY_WAVES = 8;
        this.MAX_LIGHT_BURSTS = 5;
        this.MAX_COMBO_ORBS = 20;
        this.MAX_AURORAS = 3;

        // Gameplay effects
        this.energyWaves = [];
        this.lightBursts = [];
        this.comboOrbs = [];
        this.auroraEffects = [];
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Cached gradients
        this.cachedGradients = {};

        // Performance optimizations
        this.staticCanvas = null;
        this.staticCtx = null;
        this.needsStaticRedraw = true;
        this.frameCount = 0;

        // Graphics quality presets
        this.qualityPresets = {
            Minimal: {
                groundGlow: 5,
                biolumRocks: 4,
                groundMushrooms: 3,
                mushroomSpots: { min: 1, max: 1 },
                glowingPlants: 5,
                plantFronds: { min: 2, max: 2 },
                crystalFormations: 3,
                luminousVines: 2,
                vineSegments: { min: 2, max: 3 },
                fireflies: 15,
                fireflyTrailLength: 2,
                spores: 30,
                ambientGlows: 10,
                grassBlades: 2,
                auroraWaves: { min: 1, max: 1 },
                auroraResolution: 25,
                vineOrbFrequency: 5,
                tendrilNodeFrequency: 5,
                mushroomGillSpacing: 10,
                staticRedrawInterval: 5,
            },
            Low: {
                groundGlow: 8,
                biolumRocks: 7,
                groundMushrooms: 6,
                mushroomSpots: { min: 1, max: 2 },
                glowingPlants: 8,
                plantFronds: { min: 2, max: 3 },
                crystalFormations: 4,
                luminousVines: 3,
                vineSegments: { min: 3, max: 4 },
                fireflies: 25,
                fireflyTrailLength: 3,
                spores: 50,
                ambientGlows: 15,
                grassBlades: 3,
                auroraWaves: { min: 1, max: 2 },
                auroraResolution: 20,
                vineOrbFrequency: 4,
                tendrilNodeFrequency: 4,
                mushroomGillSpacing: 8,
                staticRedrawInterval: 4,
            },
            Medium: {
                groundGlow: 12,
                biolumRocks: 10,
                groundMushrooms: 9,
                mushroomSpots: { min: 2, max: 3 },
                glowingPlants: 12,
                plantFronds: { min: 3, max: 4 },
                crystalFormations: 6,
                luminousVines: 5,
                vineSegments: { min: 4, max: 5 },
                fireflies: 40,
                fireflyTrailLength: 4,
                spores: 75,
                ambientGlows: 22,
                grassBlades: 4,
                auroraWaves: { min: 2, max: 3 },
                auroraResolution: 18,
                vineOrbFrequency: 3,
                tendrilNodeFrequency: 3,
                mushroomGillSpacing: 7,
                staticRedrawInterval: 3,
            },
            High: {
                groundGlow: 15,
                biolumRocks: 14,
                groundMushrooms: 11,
                mushroomSpots: { min: 2, max: 4 },
                glowingPlants: 16,
                plantFronds: { min: 3, max: 4 },
                crystalFormations: 8,
                luminousVines: 7,
                vineSegments: { min: 5, max: 6 },
                fireflies: 50,
                fireflyTrailLength: 5,
                spores: 100,
                ambientGlows: 28,
                grassBlades: 4,
                auroraWaves: { min: 2, max: 2 },
                auroraResolution: 15,
                vineOrbFrequency: 3,
                tendrilNodeFrequency: 3,
                mushroomGillSpacing: 6,
                staticRedrawInterval: 3,
            },
            Ultra: {
                groundGlow: 20,
                biolumRocks: 18,
                groundMushrooms: 15,
                mushroomSpots: { min: 3, max: 6 },
                glowingPlants: 22,
                plantFronds: { min: 4, max: 5 },
                crystalFormations: 10,
                luminousVines: 9,
                vineSegments: { min: 6, max: 8 },
                fireflies: 80,
                fireflyTrailLength: 8,
                spores: 150,
                ambientGlows: 40,
                grassBlades: 5,
                auroraWaves: { min: 3, max: 3 },
                auroraResolution: 10,
                vineOrbFrequency: 2,
                tendrilNodeFrequency: 2,
                mushroomGillSpacing: 4,
                staticRedrawInterval: 2,
            },
            Extreme: {
                groundGlow: 28,
                biolumRocks: 35,
                groundMushrooms: 28,
                mushroomSpots: { min: 4, max: 8 },
                glowingPlants: 40,
                plantFronds: { min: 5, max: 6 },
                crystalFormations: 20,
                luminousVines: 16,
                vineSegments: { min: 8, max: 10 },
                fireflies: 120,
                fireflyTrailLength: 10,
                spores: 200,
                ambientGlows: 55,
                grassBlades: 6,
                auroraWaves: { min: 4, max: 4 },
                auroraResolution: 8,
                vineOrbFrequency: 1,
                tendrilNodeFrequency: 1,
                mushroomGillSpacing: 3,
                staticRedrawInterval: 1,
            },
        };

        this.currentQuality = 'High'; // Default
        this.activePreset = this.qualityPresets.High;
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
        this.activePreset = { ...this.qualityPresets[quality] };

        if (this.useWebGL) {
            // Boost particle counts for WebGL
            this.activePreset.fireflies *= 20;
            this.activePreset.spores *= 10;
            this.activePreset.ambientGlows *= 2;

            console.log(`🍄 Bioluminescence: WebGL active, boosting particles (Fireflies: ${this.activePreset.fireflies}, Spores: ${this.activePreset.spores})`);

            // Allocate WebGL buffers
            const totalParticles = this.activePreset.fireflies + this.activePreset.spores + this.activePreset.ambientGlows;
            if (this.webglRenderer) {
                this.webglRenderer.allocateParticles(totalParticles * 2); // Buffer for extra particles
            }
        }

        console.log(`🍄 Bioluminescence: Applying ${quality} quality preset`);

        // Flag for redraw with new quality settings
        this.needsStaticRedraw = true;
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
        console.log('🍄 Bioluminescence theme: createScene() called');

        // Look for canvas in the theme container
        const themeContainer = document.getElementById('bioluminescence-theme');
        this.canvas = document.getElementById('bio-canvas');

        if (!this.canvas && themeContainer) {
            // Create canvas if it doesn't exist
            console.log('🍄 Creating new canvas element');
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'bio-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            themeContainer.appendChild(this.canvas);
        }

        if (!this.canvas) {
            console.error('❌ Bioluminescence: Could not create or find canvas');
            return;
        }

        console.log('✅ Bioluminescence: Canvas ready, dimensions:', this.canvas.width, 'x', this.canvas.height);

        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
            willReadFrequently: false,
        });

        // Create static layer canvas for background elements
        this.staticCanvas = document.createElement('canvas');
        this.staticCtx = this.staticCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false,
        });

        // Create WebGL canvas
        this.webglCanvas = document.createElement('canvas');
        this.webglCanvas.id = 'bio-webgl-canvas';
        this.webglCanvas.style.position = 'absolute';
        this.webglCanvas.style.top = '0';
        this.webglCanvas.style.left = '0';
        this.webglCanvas.style.width = '100%';
        this.webglCanvas.style.height = '100%';
        this.webglCanvas.style.pointerEvents = 'none';
        this.webglCanvas.style.zIndex = '0'; // Behind main canvas
        themeContainer.appendChild(this.webglCanvas);

        // Set initial canvas size BEFORE creating elements
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.staticCanvas.width = window.innerWidth;
        this.staticCanvas.height = window.innerHeight;
        this.webglCanvas.width = window.innerWidth;
        this.webglCanvas.height = window.innerHeight;

        // Initialize WebGL renderer
        this.webglRenderer = new WebGLBioRenderer(this.webglCanvas);
        if (this.webglRenderer.init()) {
            this.useWebGL = true;
            this.webglRenderer.initTextureShaders(); // Initialize texture support
            console.log('🍄 Bioluminescence: WebGL renderer active');
        } else {
            console.warn('🍄 Bioluminescence: WebGL initialization failed, falling back to Canvas2D');
            this.useWebGL = false;
        }

        // Cache gradients after setting size
        this.cacheGradients();

        // Apply graphics quality preset from settings
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        console.log(`🍄 Bioluminescence: Using ${quality} quality preset`);

        // Initialize scene elements (NOW canvas has proper dimensions)
        this.createGroundGlow();
        this.createBiolumRocks();
        this.createGroundMushrooms();
        this.createGlowingPlants();
        this.createCrystalFormations();
        this.createLuminousVines();
        this.createFireflies();
        this.createSpores();
        this.createAmbientGlows();

        // Generate texture atlas for WebGL
        if (this.useWebGL) {
            this.generateTextureAtlas();
        }

        // Setup gameplay event listeners
        this.setupEventListeners();

        // Listen for settings changes to update quality
        this.setupQualityListener();

        console.log('🍄 Scene setup complete, starting animation. Plants:', this.glowingPlants.length, 'Fireflies:', this.fireflies.length);
        this.animate();
    }

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.qualityChangeHandler = (event) => {
            if (event.detail && event.detail.effectQuality) {
                const newQuality = event.detail.effectQuality;
                console.log(`🍄 Bioluminescence: Quality changed to ${newQuality}`);

                // Clear existing elements
                this.groundGlow = [];
                this.biolumRocks = [];
                this.groundMushrooms = [];
                this.glowingPlants = [];
                this.groundFoliage = []; // Clear foliage
                this.crystalFormations = [];
                this.luminousVines = [];
                this.fireflies = [];
                this.spores = [];
                this.ambientGlows = [];
                this.alienFlora = []; // Clear alien flora

                // Apply new quality preset
                this.applyQualityPreset(newQuality);

                // Recreate scene elements with new quality
                this.createGroundGlow();
                this.createBiolumRocks();
                this.createGroundMushrooms();
                this.createGlowingPlants();
                this.createGroundFoliage(); // Recreate foliage
                this.createCrystalFormations();
                this.createLuminousVines();
                this.createFireflies();
                this.createSpores();
                this.createAmbientGlows();
                this.createAlienFlora(); // Recreate alien flora

                // Force static redraw
                this.needsStaticRedraw = true;
            }
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    generateTextureAtlas() {
        if (!this.useWebGL) return;

        const ATLAS_SIZE = 4096; // Increased from 2048 for better quality
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_SIZE;
        canvas.height = ATLAS_SIZE;
        const ctx = canvas.getContext('2d');

        let currentX = 0;
        let currentY = 0;
        let rowHeight = 0;

        // Helper to add item to atlas
        const addToAtlas = (item) => {
            if (!item.cache) return;

            const w = item.cache.width;
            const h = item.cache.height;

            if (currentX + w > ATLAS_SIZE) {
                currentX = 0;
                currentY += rowHeight + 2; // Add padding
                rowHeight = 0;
            }

            if (currentY + h > ATLAS_SIZE) {
                console.warn('Texture atlas full!');
                return;
            }

            ctx.drawImage(item.cache, currentX, currentY);

            // Store UVs (normalized 0..1)
            item.uv = {
                x: currentX / ATLAS_SIZE,
                y: currentY / ATLAS_SIZE,
                w: w / ATLAS_SIZE,
                h: h / ATLAS_SIZE
            };

            currentX += w + 2; // Padding
            rowHeight = Math.max(rowHeight, h);
        };

        // Process all static elements
        this.biolumRocks.forEach(addToAtlas);
        this.groundMushrooms.forEach(addToAtlas);
        this.crystalFormations.forEach(addToAtlas);
        this.glowingPlants.forEach(addToAtlas);
        if (this.groundFoliage) this.groundFoliage.forEach(addToAtlas); // Add foliage to atlas
        if (this.alienFlora) this.alienFlora.forEach(addToAtlas); // Add alien flora

        // Upload to WebGL
        this.webglRenderer.uploadTexture(canvas);
        console.log('🍄 Bioluminescence: Texture atlas generated');
    }

    resizeCanvas() {
        if (!this.canvas || !this.ctx) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.staticCanvas) {
            this.staticCanvas.width = window.innerWidth;
            this.staticCanvas.height = window.innerHeight;
        }
        if (this.webglCanvas) {
            this.webglCanvas.width = window.innerWidth;
            this.webglCanvas.height = window.innerHeight;
            if (this.webglRenderer) {
                this.webglRenderer.gl.viewport(0, 0, window.innerWidth, window.innerHeight);
            }
        }
        this.cacheGradients();
        this.needsStaticRedraw = true;
    }

    cacheGradients() {
        if (!this.ctx || !this.canvas) return;

        // Background gradient - deep forest to bioluminescent glow
        this.cachedGradients.background = this.ctx.createRadialGradient(
            this.canvas.width * 0.5,
            this.canvas.height * 0.5,
            0,
            this.canvas.width * 0.5,
            this.canvas.height * 0.5,
            this.canvas.height * 0.9,
        );
        this.cachedGradients.background.addColorStop(0, '#0a1f1f');
        this.cachedGradients.background.addColorStop(0.4, '#061518');
        this.cachedGradients.background.addColorStop(0.7, '#040d12');
        this.cachedGradients.background.addColorStop(1, '#020508');

        // Atmosphere gradient - reused every frame
        const centerX = this.canvas.width * 0.5;
        const centerY = this.canvas.height * 0.6;
        this.cachedGradients.atmosphere = this.ctx.createRadialGradient(
            centerX,
            centerY,
            this.canvas.height * 0.2,
            centerX,
            centerY,
            this.canvas.height * 0.9,
        );
        this.cachedGradients.atmosphere.addColorStop(0, 'rgba(20, 255, 200, 0.08)');
        this.cachedGradients.atmosphere.addColorStop(0.4, 'rgba(10, 200, 150, 0.04)');
        this.cachedGradients.atmosphere.addColorStop(0.7, 'rgba(5, 150, 100, 0.02)');
        this.cachedGradients.atmosphere.addColorStop(1, 'rgba(0, 100, 80, 0)');
    }

    createGroundGlow() {
        // Create glowing patches on the ground for ambient lighting
        const glowCount = this.activePreset.groundGlow;
        for (let i = 0; i < glowCount; i++) {
            const hue = Math.random() * 40 + 165;
            const radiusX = Math.random() * 100 + 80;

            // Pre-cache gradient for each glow
            const gradient = this.staticCtx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
            gradient.addColorStop(0, `hsla(${hue}, 100%, 60%, 1)`);
            gradient.addColorStop(0.5, `hsla(${hue}, 90%, 50%, 0.5)`);
            gradient.addColorStop(1, 'rgba(0, 150, 120, 0)');

            this.groundGlow.push({
                x: Math.random() * this.canvas.width,
                y: this.canvas.height - Math.random() * 100,
                radiusX,
                radiusY: Math.random() * 40 + 30,
                opacity: Math.random() * 0.15 + 0.08,
                pulseSpeed: Math.random() * 0.008 + 0.004,
                pulsePhase: Math.random() * Math.PI * 2,
                hue,
                gradient,
            });
        }
    }

    createBiolumRocks() {
        // Create glowing rocks scattered on the ground
        const rockCount = this.activePreset.biolumRocks;
        for (let i = 0; i < rockCount; i++) {
            const size = Math.random() * 30 + 20;
            const rock = {
                x: Math.random() * this.canvas.width,
                y: this.canvas.height - Math.random() * 60,
                width: size,
                height: size * (0.5 + Math.random() * 0.4),
                glowIntensity: Math.random() * 0.6 + 0.4,
                pulseSpeed: Math.random() * 0.015 + 0.008,
                pulsePhase: Math.random() * Math.PI * 2,
                hue: Math.random() * 40 + 170,
                shape: Math.random() > 0.5 ? 'rounded' : 'angular',
                layer: Math.random(),
            };

            // Cache the rock rendering
            rock.cache = document.createElement('canvas');
            const cacheSize = size * 4; // Enough space for glow
            rock.cache.width = cacheSize;
            rock.cache.height = cacheSize;
            const ctx = rock.cache.getContext('2d');
            const cx = cacheSize / 2;
            const cy = cacheSize / 2;

            // Draw glow
            const glowGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rock.width * 2);
            glowGradient.addColorStop(0, `hsla(${rock.hue}, 100%, 65%, 0.4)`);
            glowGradient.addColorStop(0.5, `hsla(${rock.hue}, 90%, 55%, 0.2)`);
            glowGradient.addColorStop(1, 'rgba(100, 200, 255, 0)');

            ctx.fillStyle = glowGradient;
            ctx.beginPath();
            ctx.arc(cx, cy, rock.width * 2, 0, Math.PI * 2);
            ctx.fill();

            // Draw rock body
            if (rock.shape === 'rounded') {
                ctx.beginPath();
                ctx.ellipse(cx, cy, rock.width / 2, rock.height / 2, 0, 0, Math.PI * 2);

                const rockGradient = ctx.createRadialGradient(cx - rock.width * 0.2, cy - rock.height * 0.2, rock.width * 0.1, cx, cy, rock.width / 2);
                rockGradient.addColorStop(0, `hsla(${rock.hue}, 90%, 60%, 0.8)`);
                rockGradient.addColorStop(0.5, `hsla(${rock.hue}, 80%, 50%, 0.7)`);
                rockGradient.addColorStop(1, `hsla(${rock.hue}, 70%, 40%, 0.6)`);

                ctx.fillStyle = rockGradient;
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.moveTo(cx - rock.width / 2, cy + rock.height / 2);
                ctx.lineTo(cx - rock.width * 0.3, cy - rock.height * 0.3);
                ctx.lineTo(cx, cy - rock.height / 2);
                ctx.lineTo(cx + rock.width * 0.3, cy - rock.height * 0.2);
                ctx.lineTo(cx + rock.width / 2, cy + rock.height * 0.3);
                ctx.lineTo(cx + rock.width * 0.3, cy + rock.height / 2);
                ctx.closePath();

                const rockGradient = ctx.createLinearGradient(cx, cy - rock.height / 2, cx, cy + rock.height / 2);
                rockGradient.addColorStop(0, `hsla(${rock.hue}, 75%, 45%, 0.7)`);
                rockGradient.addColorStop(0.5, `hsla(${rock.hue}, 85%, 55%, 0.75)`);
                rockGradient.addColorStop(1, `hsla(${rock.hue}, 95%, 65%, 0.85)`);

                ctx.fillStyle = rockGradient;
                ctx.fill();

                ctx.strokeStyle = `hsla(${rock.hue}, 100%, 75%, 0.5)`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            this.biolumRocks.push(rock);
        }
        this.biolumRocks.sort((a, b) => a.layer - b.layer);
    }

    createGroundFoliage() {
        // Create grassy/fern-like elements for the bottom layer
        const foliageCount = this.activePreset.glowingPlants * 2; // More dense than plants

        for (let i = 0; i < foliageCount; i++) {
            const size = Math.random() * 40 + 20;
            const foliage = {
                x: Math.random() * this.canvas.width,
                y: this.canvas.height,
                width: size,
                height: size * (Math.random() * 1.5 + 1),
                hue: Math.random() * 40 + 120, // Green/Cyan
                swaySpeed: Math.random() * 0.02 + 0.01,
                swayPhase: Math.random() * Math.PI * 2,
                type: Math.random() > 0.5 ? 'fern' : 'grass',
                layer: Math.random() * 0.3, // Mostly background
            };

            // Cache foliage
            foliage.cache = document.createElement('canvas');
            foliage.cache.width = foliage.width * 2;
            foliage.cache.height = foliage.height * 1.5;
            const ctx = foliage.cache.getContext('2d');

            const cx = foliage.width;
            const cy = foliage.height * 1.2;

            ctx.translate(cx, cy);

            // Draw foliage
            if (foliage.type === 'fern') {
                // Fern frond
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.quadraticCurveTo(foliage.width * 0.2, -foliage.height * 0.5, 0, -foliage.height);
                ctx.quadraticCurveTo(-foliage.width * 0.2, -foliage.height * 0.5, 0, 0);

                const grad = ctx.createLinearGradient(0, 0, 0, -foliage.height);
                grad.addColorStop(0, `hsla(${foliage.hue}, 60%, 20%, 0.8)`);
                grad.addColorStop(1, `hsla(${foliage.hue}, 70%, 40%, 0.6)`);
                ctx.fillStyle = grad;
                ctx.fill();

                // Leaves
                for (let j = 0; j < 8; j++) {
                    const y = -foliage.height * (j / 8);
                    const w = foliage.width * 0.4 * (1 - j / 8);

                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.quadraticCurveTo(w, y - 5, w * 1.5, y - 2);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.quadraticCurveTo(-w, y - 5, -w * 1.5, y - 2);
                    ctx.stroke();
                }
            } else {
                // Grass clump
                const bladeCount = 5;
                for (let j = 0; j < bladeCount; j++) {
                    const angle = (j - bladeCount / 2) * 0.2;
                    const h = foliage.height * (0.8 + Math.random() * 0.4);

                    ctx.save();
                    ctx.rotate(angle);
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.quadraticCurveTo(5, -h / 2, 0, -h);
                    ctx.quadraticCurveTo(-5, -h / 2, 0, 0);

                    ctx.fillStyle = `hsla(${foliage.hue + Math.random() * 20}, 60%, 30%, 0.7)`;
                    ctx.fill();
                    ctx.restore();
                }
            }

            // Add to plants array (reusing glowingPlants array or new one?)
            // Let's add to a new array but render with plants
            if (!this.groundFoliage) this.groundFoliage = [];
            this.groundFoliage.push(foliage);
        }
    }

    createGroundMushrooms() {
        // Create enhanced mushroom shapes with detailed textures and lighting
        const mushroomCount = this.activePreset.groundMushrooms;
        for (let i = 0; i < mushroomCount; i++) {
            const size = Math.random() * 60 + 40;
            const spotRange = this.activePreset.mushroomSpots;
            const mushroom = {
                x: Math.random() * this.canvas.width,
                y: this.canvas.height,
                capWidth: size * (1 + Math.random() * 0.5),
                capHeight: size * 0.4,
                stemWidth: size * 0.25,
                stemHeight: size * 0.6,
                glowIntensity: Math.random() * 0.7 + 0.3,
                pulseSpeed: Math.random() * 0.018 + 0.01,
                pulsePhase: Math.random() * Math.PI * 2,
                tiltAngle: (Math.random() - 0.5) * 0.2,
                hue: Math.random() * 50 + 160,
                capShape: Math.random() > 0.5 ? 'dome' : 'flat',
                hasGills: true, // Always have gills for detail
                spotCount: Math.floor(Math.random() * (spotRange.max - spotRange.min + 1)) + spotRange.min,
                spots: [],
                layer: Math.random(),
            };

            // Create spots on cap
            for (let j = 0; j < mushroom.spotCount; j++) {
                mushroom.spots.push({
                    offsetX: (Math.random() - 0.5) * mushroom.capWidth * 0.7,
                    offsetY: (Math.random() - 0.5) * mushroom.capHeight * 0.5,
                    size: Math.random() * 8 + 4,
                    intensity: Math.random() * 0.6 + 0.4,
                    blur: Math.random() * 2 + 1,
                });
            }

            // Cache mushroom rendering
            mushroom.cache = document.createElement('canvas');
            const cacheWidth = mushroom.capWidth * 3; // More padding for glow
            const cacheHeight = (mushroom.stemHeight + mushroom.capHeight) * 3;
            mushroom.cache.width = cacheWidth;
            mushroom.cache.height = cacheHeight;
            const ctx = mushroom.cache.getContext('2d');
            const cx = cacheWidth / 2;
            const cy = cacheHeight * 0.8; // Base of stem near bottom

            ctx.translate(cx, cy);
            ctx.rotate(mushroom.tiltAngle);

            // 1. Draw main glow aura (Volumetric)
            const auraGradient = ctx.createRadialGradient(0, -mushroom.stemHeight - mushroom.capHeight / 2, 0, 0, -mushroom.stemHeight - mushroom.capHeight / 2, mushroom.capWidth * 1.5);
            auraGradient.addColorStop(0, `hsla(${mushroom.hue}, 100%, 70%, 0.4)`);
            auraGradient.addColorStop(0.4, `hsla(${mushroom.hue}, 90%, 60%, 0.2)`);
            auraGradient.addColorStop(1, 'rgba(100, 220, 200, 0)');

            ctx.fillStyle = auraGradient;
            ctx.beginPath();
            ctx.arc(0, -mushroom.stemHeight - mushroom.capHeight / 2, mushroom.capWidth * 1.5, 0, Math.PI * 2);
            ctx.fill();

            // 2. Draw Stem (Textured)
            const stemGradient = ctx.createLinearGradient(-mushroom.stemWidth / 2, 0, mushroom.stemWidth / 2, 0);
            stemGradient.addColorStop(0, `hsla(${mushroom.hue}, 40%, 20%, 0.9)`);
            stemGradient.addColorStop(0.3, `hsla(${mushroom.hue}, 50%, 30%, 0.95)`);
            stemGradient.addColorStop(0.7, `hsla(${mushroom.hue}, 50%, 30%, 0.95)`);
            stemGradient.addColorStop(1, `hsla(${mushroom.hue}, 40%, 20%, 0.9)`);

            ctx.fillStyle = stemGradient;
            ctx.beginPath();
            // Curved stem
            ctx.moveTo(-mushroom.stemWidth / 2, 0);
            ctx.quadraticCurveTo(-mushroom.stemWidth * 0.4, -mushroom.stemHeight * 0.5, -mushroom.stemWidth * 0.4, -mushroom.stemHeight);
            ctx.lineTo(mushroom.stemWidth * 0.4, -mushroom.stemHeight);
            ctx.quadraticCurveTo(mushroom.stemWidth * 0.4, -mushroom.stemHeight * 0.5, mushroom.stemWidth / 2, 0);
            ctx.closePath();
            ctx.fill();

            // Stem texture (striations)
            ctx.strokeStyle = `hsla(${mushroom.hue}, 60%, 40%, 0.3)`;
            ctx.lineWidth = 1;
            for (let k = 0; k < 5; k++) {
                const xOff = (Math.random() - 0.5) * mushroom.stemWidth * 0.6;
                ctx.beginPath();
                ctx.moveTo(xOff, 0);
                ctx.quadraticCurveTo(xOff * 0.8, -mushroom.stemHeight * 0.5, xOff * 0.8, -mushroom.stemHeight);
                ctx.stroke();
            }

            // 3. Draw Gills (Under cap)
            const capY = -mushroom.stemHeight;
            ctx.save();
            ctx.translate(0, capY);

            // Gill shape clipping
            ctx.beginPath();
            ctx.ellipse(0, 0, mushroom.capWidth / 2, mushroom.capHeight / 3, 0, 0, Math.PI * 2);
            ctx.clip();

            // Gill background
            ctx.fillStyle = `hsla(${mushroom.hue}, 60%, 15%, 1)`;
            ctx.fill();

            // Glowing gills
            ctx.strokeStyle = `hsla(${mushroom.hue}, 80%, 50%, 0.6)`;
            ctx.lineWidth = 1.5;
            const gillCount = 40;
            for (let k = 0; k < gillCount; k++) {
                const angle = (k / gillCount) * Math.PI * 2;
                const r = mushroom.capWidth / 2;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r * 0.6); // Flattened Y
                ctx.stroke();
            }
            ctx.restore();


            // 4. Draw Cap (Detailed)
            ctx.beginPath();
            if (mushroom.capShape === 'dome') {
                ctx.ellipse(0, capY - mushroom.capHeight / 3, mushroom.capWidth / 2, mushroom.capHeight, 0, Math.PI, 0); // Top half
                // Bottom curve
                ctx.bezierCurveTo(
                    mushroom.capWidth / 2, capY + mushroom.capHeight * 0.2,
                    -mushroom.capWidth / 2, capY + mushroom.capHeight * 0.2,
                    -mushroom.capWidth / 2, capY - mushroom.capHeight / 3
                );
            } else {
                // Flat/Wavy cap
                ctx.moveTo(-mushroom.capWidth / 2, capY);
                ctx.bezierCurveTo(
                    -mushroom.capWidth * 0.2, capY - mushroom.capHeight * 1.5,
                    mushroom.capWidth * 0.2, capY - mushroom.capHeight * 1.5,
                    mushroom.capWidth / 2, capY
                );
                ctx.bezierCurveTo(
                    mushroom.capWidth * 0.4, capY + mushroom.capHeight * 0.3,
                    -mushroom.capWidth * 0.4, capY + mushroom.capHeight * 0.3,
                    -mushroom.capWidth / 2, capY
                );
            }
            ctx.closePath();

            // Cap Gradient (Subsurface scattering feel)
            const capGradient = ctx.createRadialGradient(
                0, capY - mushroom.capHeight, 0,
                0, capY - mushroom.capHeight / 2, mushroom.capWidth / 2
            );
            capGradient.addColorStop(0, `hsla(${mushroom.hue}, 90%, 75%, 1.0)`); // Bright top center
            capGradient.addColorStop(0.4, `hsla(${mushroom.hue}, 80%, 50%, 0.95)`); // Mid body
            capGradient.addColorStop(0.8, `hsla(${mushroom.hue}, 70%, 30%, 0.9)`); // Darker edges
            capGradient.addColorStop(1, `hsla(${mushroom.hue}, 60%, 20%, 0.9)`); // Rim

            ctx.fillStyle = capGradient;
            ctx.fill();

            // 5. Cap Texture (Veins/Noise)
            ctx.save();
            ctx.clip(); // Clip to cap shape
            ctx.strokeStyle = `hsla(${mushroom.hue}, 90%, 80%, 0.15)`;
            ctx.lineWidth = 2;
            for (let k = 0; k < 8; k++) {
                const angle = Math.random() * Math.PI;
                const r = Math.random() * mushroom.capWidth * 0.4;
                ctx.beginPath();
                ctx.arc(0, capY - mushroom.capHeight, r + k * 5, angle, angle + Math.PI);
                ctx.stroke();
            }
            ctx.restore();

            // 6. Glowing Spots
            for (const spot of mushroom.spots) {
                const spotX = spot.offsetX;
                const spotY = capY - mushroom.capHeight * 0.6 + spot.offsetY;

                // Spot Glow
                const spotGlow = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spot.size * 2);
                spotGlow.addColorStop(0, `hsla(${mushroom.hue + 30}, 100%, 90%, ${0.8 * spot.intensity})`);
                spotGlow.addColorStop(0.4, `hsla(${mushroom.hue + 20}, 100%, 70%, ${0.4 * spot.intensity})`);
                spotGlow.addColorStop(1, 'rgba(0,0,0,0)');

                ctx.fillStyle = spotGlow;
                ctx.beginPath();
                ctx.arc(spotX, spotY, spot.size * 2, 0, Math.PI * 2);
                ctx.fill();

                // Spot Core
                ctx.fillStyle = `hsla(${mushroom.hue + 40}, 100%, 95%, ${0.9 * spot.intensity})`;
                ctx.beginPath();
                ctx.ellipse(spotX, spotY, spot.size, spot.size * 0.7, Math.random(), 0, Math.PI * 2);
                ctx.fill();
            }

            // 7. Rim Light (Backlighting effect)
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.strokeStyle = `hsla(${mushroom.hue}, 100%, 80%, 0.4)`;
            ctx.lineWidth = 2;
            ctx.stroke(); // Stroke the cap path defined earlier
            ctx.restore();

            // Fix positioning: Move up so the stem base (at 80% of cache height) sits on the bottom
            // Center is at 50%. Base is at 80%. Difference is 30% of height.
            // We want Base to be at canvas.height.
            // So Center (y) must be at canvas.height - 0.3 * cacheHeight.
            mushroom.y = this.canvas.height - cacheHeight * 0.3 + Math.random() * 20; // Slight variation

            this.groundMushrooms.push(mushroom);
        }
        this.groundMushrooms.sort((a, b) => a.layer - b.layer);
    }

    createAlienFlora() {
        // Create strange, bioluminescent organic shapes for the bottom layer
        const count = Math.floor(this.canvas.width / 40); // Increased density (was 60)

        for (let i = 0; i < count; i++) {
            const rand = Math.random();
            const type = rand > 0.7 ? 'tentacle' : (rand > 0.4 ? 'bulb' : 'spiral');
            const size = Math.random() * 60 + 40;
            const hue = Math.random() * 60 + 260; // Purple/Pink/Blue range

            const flora = {
                x: Math.random() * this.canvas.width,
                y: this.canvas.height, // Will adjust
                width: size,
                height: size * (Math.random() * 2 + 1.5),
                hue: hue,
                type: type,
                swaySpeed: Math.random() * 0.03 + 0.02,
                swayPhase: Math.random() * Math.PI * 2,
                layer: Math.random() * 0.4,
                glowIntensity: Math.random() * 0.5 + 0.5,
            };

            // Cache
            flora.cache = document.createElement('canvas');
            const cacheW = size * 3;
            const cacheH = flora.height * 1.5;
            flora.cache.width = cacheW;
            flora.cache.height = cacheH;
            const ctx = flora.cache.getContext('2d');

            const cx = cacheW / 2;
            const cy = cacheH * 0.9; // Base near bottom

            ctx.translate(cx, cy);

            if (type === 'tentacle') {
                // Wavy tentacle
                ctx.beginPath();
                ctx.moveTo(0, 0);
                // Control points for S-shape
                ctx.bezierCurveTo(
                    size * 0.5, -flora.height * 0.3,
                    -size * 0.5, -flora.height * 0.6,
                    0, -flora.height
                );

                // Thick base, thin tip
                ctx.lineCap = 'round';
                for (let k = 0; k < 10; k++) {
                    ctx.lineWidth = (1 - k / 10) * size * 0.3 + 2;
                    ctx.strokeStyle = `hsla(${hue}, 80%, ${30 + k * 5}%, ${0.1 + k / 20})`;
                    ctx.stroke();
                }

                // Glowing tip
                const tipGlow = ctx.createRadialGradient(0, -flora.height, 0, 0, -flora.height, size * 0.8);
                tipGlow.addColorStop(0, `hsla(${hue}, 100%, 80%, 1)`);
                tipGlow.addColorStop(0.4, `hsla(${hue}, 100%, 60%, 0.5)`);
                tipGlow.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = tipGlow;
                ctx.beginPath();
                ctx.arc(0, -flora.height, size * 0.8, 0, Math.PI * 2);
                ctx.fill();

                // Bioluminescent spots along stalk
                for (let k = 1; k < 5; k++) {
                    const y = -flora.height * (k / 5);
                    ctx.fillStyle = `hsla(${hue + 20}, 100%, 70%, 0.6)`;
                    ctx.beginPath();
                    ctx.arc(Math.sin(k) * 5, y, 2, 0, Math.PI * 2);
                    ctx.fill();
                }

            } else if (type === 'bulb') {
                // Bulb on stalk
                // Stalk
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.quadraticCurveTo(size * 0.2, -flora.height * 0.5, 0, -flora.height);
                ctx.lineWidth = size * 0.15;
                ctx.strokeStyle = `hsla(${hue}, 60%, 20%, 0.8)`;
                ctx.stroke();

                // Bulb
                const bulbY = -flora.height;
                const bulbSize = size * 0.4;

                // Bulb Glow
                const bulbGlow = ctx.createRadialGradient(0, bulbY, 0, 0, bulbY, bulbSize * 3);
                bulbGlow.addColorStop(0, `hsla(${hue}, 100%, 60%, 0.6)`);
                bulbGlow.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = bulbGlow;
                ctx.beginPath();
                ctx.arc(0, bulbY, bulbSize * 3, 0, Math.PI * 2);
                ctx.fill();

                // Bulb Body
                const bulbGrad = ctx.createRadialGradient(0, bulbY - bulbSize * 0.3, 0, 0, bulbY, bulbSize);
                bulbGrad.addColorStop(0, `hsla(${hue}, 100%, 80%, 0.9)`);
                bulbGrad.addColorStop(0.5, `hsla(${hue}, 90%, 50%, 0.8)`);
                bulbGrad.addColorStop(1, `hsla(${hue}, 80%, 30%, 0.8)`);
                ctx.fillStyle = bulbGrad;
                ctx.beginPath();
                ctx.arc(0, bulbY, bulbSize, 0, Math.PI * 2);
                ctx.fill();

                // Internal filaments
                ctx.strokeStyle = `hsla(${hue + 30}, 100%, 90%, 0.5)`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(0, bulbY, bulbSize * 0.6, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                // Spiral/Fiddlehead
                ctx.beginPath();
                ctx.moveTo(0, 0);

                // Spiral shape
                const spiralTurns = 2;
                const points = 20;
                for (let k = 0; k <= points; k++) {
                    const t = k / points;
                    const angle = t * Math.PI * 2 * spiralTurns;
                    const r = (1 - t) * size * 0.5; // Tapering radius
                    const x = Math.cos(angle) * r;
                    const y = -flora.height * t + Math.sin(angle) * r * 0.5;
                    if (k === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }

                ctx.lineCap = 'round';
                ctx.lineWidth = size * 0.1;
                ctx.strokeStyle = `hsla(${hue}, 70%, 40%, 0.8)`;
                ctx.stroke();

                // Glowing dots along spiral
                for (let k = 0; k <= points; k += 2) {
                    const t = k / points;
                    const angle = t * Math.PI * 2 * spiralTurns;
                    const r = (1 - t) * size * 0.5;
                    const x = Math.cos(angle) * r;
                    const y = -flora.height * t + Math.sin(angle) * r * 0.5;

                    ctx.fillStyle = `hsla(${hue + 40}, 100%, 80%, 0.8)`;
                    ctx.beginPath();
                    ctx.arc(x, y, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Fix Y position
            // Base is at 90% of cache height. Center is 50%.
            // Shift up by (0.9 - 0.5) * cacheH = 0.4 * cacheH
            flora.y = this.canvas.height - cacheH * 0.4 + Math.random() * 30;

            if (!this.alienFlora) this.alienFlora = [];
            this.alienFlora.push(flora);
        }

        if (this.alienFlora) this.alienFlora.sort((a, b) => a.layer - b.layer);
    }

    createGlowingPlants() {
        const plantCount = this.activePreset.glowingPlants;
        const plantTypes = ['fern', 'flower', 'grass', 'bulb', 'tendril'];

        for (let i = 0; i < plantCount; i++) {
            const type = plantTypes[Math.floor(Math.random() * plantTypes.length)];
            const x = Math.random() * this.canvas.width;
            const baseY = this.canvas.height;

            const plant = {
                type,
                x,
                y: baseY,
                height: Math.random() * 120 + 60,
                width: Math.random() * 60 + 30,
                glowIntensity: Math.random() * 0.6 + 0.4,
                pulseSpeed: Math.random() * 0.015 + 0.008,
                pulsePhase: Math.random() * Math.PI * 2,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: Math.random() * 0.01 + 0.005,
                swayAmount: Math.random() * 15 + 5,
                hue: Math.random() * 40 + 160, // Cyan to green range
                layer: Math.random(),
            };

            // Type-specific properties
            if (type === 'fern') {
                const frondRange = this.activePreset.plantFronds;
                plant.fronds = Math.floor(Math.random() * (frondRange.max - frondRange.min + 1)) + frondRange.min;
            } else if (type === 'flower') {
                plant.petals = Math.floor(Math.random() * 4) + 5;
                plant.centerSize = Math.random() * 8 + 6;
            } else if (type === 'bulb') {
                plant.bulbSize = Math.random() * 20 + 15;
                plant.stemHeight = plant.height * 0.7;
            } else if (type === 'tendril') {
                plant.segments = Math.floor(Math.random() * 6) + 5;
            }

            this.glowingPlants.push(plant);
        }

        // Sort by layer for depth
        this.glowingPlants.sort((a, b) => a.layer - b.layer);
    }

    createCrystalFormations() {
        const formationCount = this.activePreset.crystalFormations;

        for (let i = 0; i < formationCount; i++) {
            const crystalCount = Math.floor(Math.random() * 4) + 3;
            const crystals = [];
            const baseX = Math.random() * this.canvas.width;
            const baseY = this.canvas.height - Math.random() * 80;

            // Calculate bounds for cache canvas
            let minX = 0, maxX = 0, minY = 0, maxY = 0;

            for (let j = 0; j < crystalCount; j++) {
                const crystal = {
                    offsetX: (Math.random() - 0.5) * 40,
                    height: Math.random() * 50 + 30,
                    width: Math.random() * 15 + 10,
                    angle: (Math.random() - 0.5) * 0.3,
                    glowIntensity: Math.random() * 0.5 + 0.5,
                };
                crystals.push(crystal);

                // Approximate bounds
                minX = Math.min(minX, crystal.offsetX - crystal.width);
                maxX = Math.max(maxX, crystal.offsetX + crystal.width);
                minY = Math.min(minY, -crystal.height); // Crystals grow up
            }

            const formation = {
                x: baseX,
                y: baseY,
                crystals,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulsePhase: Math.random() * Math.PI * 2,
                hue: Math.random() * 30 + 170, // Cyan-ish crystals
                layer: Math.random() * 0.5, // Front layer mostly
            };

            // Cache formation
            formation.cache = document.createElement('canvas');
            const width = (maxX - minX) + 60; // Padding for glow
            const height = (maxY - minY) + 60; // Padding
            formation.cache.width = width;
            formation.cache.height = height;
            const ctx = formation.cache.getContext('2d');

            // Center of formation in cache
            const cx = width / 2;
            const cy = height - 30; // Bottom with padding

            ctx.translate(cx, cy);

            for (const crystal of crystals) {
                ctx.save();
                ctx.translate(crystal.offsetX, 0);
                ctx.rotate(crystal.angle);

                // Draw crystal glow
                const glowGradient = ctx.createRadialGradient(0, -crystal.height / 2, 0, 0, -crystal.height / 2, crystal.width * 3);
                glowGradient.addColorStop(0, `hsla(${formation.hue}, 100%, 70%, 0.3)`);
                glowGradient.addColorStop(0.5, `hsla(${formation.hue}, 90%, 60%, 0.1)`);
                glowGradient.addColorStop(1, 'rgba(100, 200, 255, 0)');

                ctx.fillStyle = glowGradient;
                ctx.beginPath();
                ctx.arc(0, -crystal.height / 2, crystal.width * 3, 0, Math.PI * 2);
                ctx.fill();

                // Draw crystal body
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-crystal.width / 2, -crystal.height);
                ctx.lineTo(crystal.width / 2, -crystal.height);
                ctx.closePath();

                const crystalGradient = ctx.createLinearGradient(0, 0, 0, -crystal.height);
                crystalGradient.addColorStop(0, `hsla(${formation.hue}, 80%, 45%, 0.8)`);
                crystalGradient.addColorStop(0.5, `hsla(${formation.hue}, 90%, 60%, 0.7)`);
                crystalGradient.addColorStop(1, `hsla(${formation.hue}, 100%, 70%, 0.9)`);

                ctx.fillStyle = crystalGradient;
                ctx.fill();

                // Add highlight
                ctx.strokeStyle = `hsla(${formation.hue}, 100%, 85%, 0.6)`;
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.restore();
            }

            this.crystalFormations.push(formation);
        }

        this.crystalFormations.sort((a, b) => a.layer - b.layer);
    }

    createLuminousVines() {
        const vineCount = this.activePreset.luminousVines;

        for (let i = 0; i < vineCount; i++) {
            const segments = [];
            const segmentRange = this.activePreset.vineSegments;
            const segmentCount = Math.floor(Math.random() * (segmentRange.max - segmentRange.min + 1)) + segmentRange.min;
            const startX = Math.random() * this.canvas.width;

            let currentX = startX;
            let currentY = 0;

            for (let j = 0; j < segmentCount; j++) {
                const segmentLength = Math.random() * 40 + 30;
                const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.4; // Mostly downward

                segments.push({
                    x: currentX,
                    y: currentY,
                    length: segmentLength,
                    angle,
                    thickness: Math.max(2, 8 - j * 0.5), // Taper off
                    glowSize: Math.random() * 10 + 8,
                });

                currentX += Math.cos(angle) * segmentLength;
                currentY += Math.sin(angle) * segmentLength;
            }

            this.luminousVines.push({
                segments,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulsePhase: Math.random() * Math.PI * 2,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: Math.random() * 0.015 + 0.008,
                hue: Math.random() * 40 + 160,
            });
        }
    }

    createFireflies() {
        const fireflyCount = this.activePreset.fireflies;
        for (let i = 0; i < fireflyCount; i++) {
            this.fireflies.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                size: Math.random() * 3 + 2,
                brightness: Math.random() * 0.8 + 0.2,
                pulseSpeed: Math.random() * 0.05 + 0.02,
                pulsePhase: Math.random() * Math.PI * 2,
                color: Math.random() > 0.7 ? 'cyan' : 'green',
                trail: [],
            });
        }
    }

    createSpores() {
        const sporeCount = this.activePreset.spores;
        for (let i = 0; i < sporeCount; i++) {
            this.spores.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 1.5 - 0.5,
                size: Math.random() * 2 + 1,
                opacity: Math.random() * 0.6 + 0.2,
                driftPhase: Math.random() * Math.PI * 2,
                driftSpeed: Math.random() * 0.02 + 0.01,
            });
        }
    }

    createAmbientGlows() {
        const glowCount = this.activePreset.ambientGlows;
        for (let i = 0; i < glowCount; i++) {
            this.ambientGlows.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.8,
                size: Math.random() * 60 + 30,
                opacity: Math.random() * 0.12 + 0.04,
                pulseSpeed: Math.random() * 0.012 + 0.006,
                pulsePhase: Math.random() * Math.PI * 2,
                driftSpeed: Math.random() * 0.0003 + 0.0001,
                driftPhase: Math.random() * Math.PI * 2,
                hue: Math.random() * 50 + 155,
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

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive) {
                this.handlePieceLock(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
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
    }

    handlePieceLock(data) {
        const piece = data.piece || data.detail?.piece;
        if (!piece) return;

        // Calculate screen coordinates (assuming centered board)
        const boardWidth = COLS * BLOCK_SIZE;
        const boardHeight = ROWS * BLOCK_SIZE;
        const startX = (this.canvas.width - boardWidth) / 2;
        const startY = (this.canvas.height - boardHeight) / 2;

        // Use piece center
        const x = startX + (piece.x + 1.5) * BLOCK_SIZE;
        const y = startY + (piece.y + 1.5) * BLOCK_SIZE;

        // 1. Create Global Ripple (affects all flora)
        this.createGlobalRipple(x, y);

        // 2. Create Visual Shockwave (Ring)
        this.createBioShockwave(x, y, piece.color);

        // 3. Create Enhanced Burst (Particles + Streaks)
        this.createBioBurst(x, y, piece.color);

        // 4. Flash background strongly
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.8, 1.5); // Can go above 1.0 for super bright
    }

    createGlobalRipple(x, y) {
        this.globalRipples.push({
            x,
            y,
            radius: 0,
            maxRadius: Math.max(this.canvas.width, this.canvas.height) * 1.5,
            speed: 8,
            strength: 4.0, // MUCH Stronger effect
            life: 1.0,
            decay: 0.008
        });
    }

    createBioShockwave(x, y, color) {
        // A refractive ring effect
        this.energyWaves.push({
            x,
            y,
            radius: 10,
            maxRadius: 400, // Larger
            opacity: 1.0, // Fully opaque start
            life: 1.0,
            speed: 15, // Faster
            delay: 0,
            started: true,
            color: color || '#00ffcc',
            type: 'shockwave'
        });
    }

    createBioBurst(x, y, color) {
        const particleCount = this.useWebGL ? 300 : 50; // Massive burst

        // 1. Standard Particles
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 10 + 5; // Faster

            const particle = {
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 6 + 3,
                opacity: 1.0,
                life: 1.0,
                color: color || (Math.random() > 0.5 ? 'cyan' : 'green'),
                pulsePhase: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.2,
                isBurst: true
            };
            this.lightBursts.push(particle);
        }

        // 2. Energy Streaks (Spiraling outwards)
        const streakCount = 24; // More streaks
        for (let i = 0; i < streakCount; i++) {
            const angle = (i / streakCount) * Math.PI * 2;
            const speed = 15 + Math.random() * 8;

            const particle = {
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 5 + Math.random() * 5,
                opacity: 1.0,
                life: 1.5,
                color: '#ffffff', // Bright core
                pulsePhase: 0,
                rotationSpeed: 0,
                isBurst: true,
                isStreak: true,
                drag: 0.95
            };
            this.lightBursts.push(particle);
        }
    }

    onLineClear(lineCount, comboCount) {
        // Update combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);

        // Pulse intensity based on combo
        this.pulseIntensity = Math.min(0.5 + comboCount * 0.15, 1.5);

        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Energy waves from center
        if (this.energyWaves.length < this.MAX_ENERGY_WAVES) {
            const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), this.MAX_ENERGY_WAVES - this.energyWaves.length);
            for (let i = 0; i < waveCount; i++) {
                this.energyWaves.push({
                    x: centerX,
                    y: centerY,
                    radius: 0,
                    maxRadius: 400 + comboCount * 60,
                    opacity: 0.9,
                    life: 1.0,
                    speed: 5 + comboCount * 0.5,
                    delay: i * 0.12,
                    started: false,
                });
            }
        }

        // Light burst particles
        if (this.lightBursts.length < this.MAX_PARTICLES) {
            const burstCount = Math.min(lineCount * 20 + comboCount * 15, this.MAX_PARTICLES - this.lightBursts.length);
            for (let i = 0; i < burstCount; i++) {
                this.lightBursts.push(this.createLightBurstParticle(centerX, centerY, lineCount));
            }
        }

        // Combo orbs for medium combos
        if (comboCount >= 3 && this.comboOrbs.length < this.MAX_COMBO_ORBS) {
            const orbCount = Math.min(comboCount * 2, this.MAX_COMBO_ORBS - this.comboOrbs.length);
            for (let i = 0; i < orbCount; i++) {
                this.comboOrbs.push(this.createComboOrb());
            }
        }

        // Aurora effects for high combos
        if (comboCount >= 6 && this.auroraEffects.length < this.MAX_AURORAS) {
            const auroraCount = Math.min(Math.floor(comboCount / 4), this.MAX_AURORAS - this.auroraEffects.length);
            for (let i = 0; i < auroraCount; i++) {
                this.auroraEffects.push(this.createAurora());
            }
        }

        // Make all plants glow more intensely
        this.glowingPlants.forEach((plant) => {
            plant.glowIntensity = Math.min(plant.glowIntensity + 0.4 + comboCount * 0.1, 2.5);
        });

        // Make ground mushrooms glow brighter
        this.groundMushrooms.forEach((mushroom) => {
            mushroom.glowIntensity = Math.min(mushroom.glowIntensity + 0.5 + comboCount * 0.15, 3.0);
        });

        // Make rocks pulse
        this.biolumRocks.forEach((rock) => {
            rock.glowIntensity = Math.min(rock.glowIntensity + 0.3 + comboCount * 0.1, 2.0);
        });

        // Make crystals shine brighter
        this.crystalFormations.forEach((formation) => {
            formation.crystals.forEach((crystal) => {
                crystal.glowIntensity = Math.min(crystal.glowIntensity + 0.3, 2.0);
            });
        });

        // Flag for static elements redraw on next frame
        this.needsStaticRedraw = true;

        // Spawn bioluminescent reaction particles around plants
        if (comboCount >= 2) {
            this.createBioReactionParticles(comboCount);
        }
    }

    createLightBurstParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10 + 5 + lineCount * 2;

        return {
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 6 + 3,
            opacity: Math.random() * 0.9 + 0.5,
            life: 1.0,
            color: Math.random() > 0.5 ? 'cyan' : 'green',
            pulsePhase: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
        };
    }

    createComboOrb() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height + 50,
            vx: (Math.random() - 0.5) * 3,
            vy: -(Math.random() * 4 + 3),
            size: Math.random() * 12 + 6,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            spiralPhase: Math.random() * Math.PI * 2,
            spiralSpeed: Math.random() * 0.1 + 0.05,
        };
    }

    createAurora() {
        const waveRange = this.activePreset.auroraWaves;
        const waveCount = Math.floor(Math.random() * (waveRange.max - waveRange.min + 1)) + waveRange.min;
        const waves = [];

        for (let i = 0; i < waveCount; i++) {
            waves.push({
                amplitude: Math.random() * 100 + 50,
                frequency: Math.random() * 0.01 + 0.005,
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.02 + 0.01,
                yOffset: Math.random() * 200,
            });
        }

        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height * 0.5,
            waves,
            opacity: 0.7,
            life: 1.0,
            width: Math.random() * 400 + 300,
            driftSpeed: (Math.random() - 0.5) * 0.5,
        };
    }

    createBioReactionParticles(comboCount) {
        // Create glowing particles that emit from random plants
        const plantCount = Math.min(this.glowingPlants.length, 5 + comboCount);

        for (let i = 0; i < plantCount; i++) {
            const plant = this.glowingPlants[Math.floor(Math.random() * this.glowingPlants.length)];
            const particleCount = Math.floor(Math.random() * 8) + 5;

            for (let j = 0; j < particleCount; j++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 3 + 2;

                if (this.lightBursts.length < this.MAX_PARTICLES) {
                    this.lightBursts.push({
                        x: plant.x,
                        y: plant.y - plant.height * 0.5,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed - 1,
                        size: Math.random() * 4 + 2,
                        opacity: Math.random() * 0.8 + 0.4,
                        life: 1.0,
                        color: Math.random() > 0.5 ? 'cyan' : 'green',
                        pulsePhase: Math.random() * Math.PI * 2,
                        rotationSpeed: (Math.random() - 0.5) * 0.2,
                        hue: plant.hue,
                    });
                }
            }
        }
    }

    drawBackground() {
        if (!this.ctx || !this.canvas) return;

        // Deep forest background with bioluminescent glow
        if (this.cachedGradients.background) {
            this.ctx.fillStyle = this.cachedGradients.background;
        } else {
            this.ctx.fillStyle = '#0a1f1f';
        }
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Add ambient bioluminescent atmosphere using cached gradient
        if (this.cachedGradients.atmosphere) {
            this.ctx.fillStyle = this.cachedGradients.atmosphere;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    drawAmbientGlows() {
        for (const glow of this.ambientGlows) {
            glow.pulsePhase += glow.pulseSpeed;
            glow.driftPhase += glow.driftSpeed;

            const pulse = Math.sin(glow.pulsePhase) * 0.3 + 0.7;
            const drift = Math.sin(glow.driftPhase) * 60;

            const x = glow.x + drift;
            const y = glow.y + Math.cos(glow.driftPhase * 1.3) * 40;

            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, glow.size);
            gradient.addColorStop(0, `hsla(${glow.hue}, 100%, 65%, ${glow.opacity * pulse * (1 + this.pulseIntensity * 0.3)})`);
            gradient.addColorStop(0.4, `hsla(${glow.hue}, 90%, 55%, ${glow.opacity * pulse * 0.6})`);
            gradient.addColorStop(0.7, `hsla(${glow.hue}, 80%, 45%, ${glow.opacity * pulse * 0.3})`);
            gradient.addColorStop(1, 'rgba(0, 150, 120, 0)');

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, glow.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawGroundGlow() {
        for (const glow of this.groundGlow) {
            glow.pulsePhase += glow.pulseSpeed;
            const pulse = Math.sin(glow.pulsePhase) * 0.3 + 0.7;

            // Use pre-cached gradient with dynamic opacity
            this.ctx.save();
            this.ctx.translate(glow.x, glow.y);
            this.ctx.globalAlpha = glow.opacity * pulse * (1 + this.pulseIntensity * 0.2);

            this.ctx.fillStyle = glow.gradient;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, glow.radiusX, glow.radiusY, 0, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
            this.ctx.globalAlpha = 1.0; // Reset
        }
    }

    drawBiolumRocks() {
        for (const rock of this.biolumRocks) {
            rock.pulsePhase += rock.pulseSpeed;
            const pulse = Math.sin(rock.pulsePhase) * 0.3 + 0.7;

            // Decay intense glow
            if (rock.glowIntensity > 0.6) {
                rock.glowIntensity *= 0.988;
            }

            const glowMult = rock.glowIntensity * pulse * (1 + this.pulseIntensity * 0.3);

            if (rock.cache) {
                this.ctx.save();
                this.ctx.translate(rock.x, rock.y);

                // Scale for pulse effect
                const scale = 1.0 + (pulse - 0.7) * 0.1;
                this.ctx.scale(scale, scale);

                // Adjust opacity for glow
                this.ctx.globalAlpha = Math.min(1.0, 0.7 + glowMult * 0.3);

                // Draw cached rock centered
                this.ctx.drawImage(rock.cache, -rock.cache.width / 2, -rock.cache.height / 2);

                this.ctx.restore();
            }
        }
    }

    drawGroundMushrooms() {
        for (const mushroom of this.groundMushrooms) {
            mushroom.pulsePhase += mushroom.pulseSpeed;
            const pulse = Math.sin(mushroom.pulsePhase) * 0.3 + 0.7;

            // Decay intense glow
            if (mushroom.glowIntensity > 0.7) {
                mushroom.glowIntensity *= 0.985;
            }

            const glowMult = mushroom.glowIntensity * pulse * (1 + this.pulseIntensity * 0.35);

            if (mushroom.cache) {
                this.ctx.save();
                this.ctx.translate(mushroom.x, mushroom.y);

                // Scale for pulse effect
                const scale = 1.0 + (pulse - 0.7) * 0.05;
                this.ctx.scale(scale, scale);

                // Adjust opacity for glow
                this.ctx.globalAlpha = Math.min(1.0, 0.8 + glowMult * 0.2);

                // Draw cached mushroom centered on stem base
                // The cache was drawn with stem base at (cx, cy)
                // So we draw image at (-cx, -cy)
                this.ctx.drawImage(mushroom.cache, -mushroom.cache.width / 2, -mushroom.cache.height * 0.8);

                this.ctx.restore();
            }
        }
    }

    drawLuminousVines() {
        for (const vine of this.luminousVines) {
            vine.pulsePhase += vine.pulseSpeed;
            vine.swayPhase += vine.swaySpeed;

            const pulse = Math.sin(vine.pulsePhase) * 0.3 + 0.7;
            const sway = Math.sin(vine.swayPhase) * 15;

            for (let i = 0; i < vine.segments.length; i++) {
                const segment = vine.segments[i];
                const swayOffset = sway * (i / vine.segments.length);

                const x1 = segment.x + swayOffset;
                const y1 = segment.y;
                const x2 = x1 + Math.cos(segment.angle) * segment.length;
                const y2 = y1 + Math.sin(segment.angle) * segment.length;

                // Draw glowing vine segment
                const gradient = this.ctx.createLinearGradient(x1, y1, x2, y2);
                gradient.addColorStop(0, `hsla(${vine.hue}, 100%, 60%, ${0.3 * pulse})`);
                gradient.addColorStop(1, `hsla(${vine.hue}, 100%, 60%, ${0.2 * pulse})`);

                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = segment.thickness;
                this.ctx.lineCap = 'round';
                this.ctx.beginPath();
                this.ctx.moveTo(x1, y1);
                this.ctx.lineTo(x2, y2);
                this.ctx.stroke();

                // Add glowing orbs along vine
                if (i % this.activePreset.vineOrbFrequency === 0) {
                    const glowGradient = this.ctx.createRadialGradient(x2, y2, 0, x2, y2, segment.glowSize);
                    glowGradient.addColorStop(0, `hsla(${vine.hue}, 100%, 70%, ${0.7 * pulse})`);
                    glowGradient.addColorStop(0.5, `hsla(${vine.hue}, 100%, 60%, ${0.4 * pulse})`);
                    glowGradient.addColorStop(1, 'rgba(0, 255, 200, 0)');

                    this.ctx.fillStyle = glowGradient;
                    this.ctx.beginPath();
                    this.ctx.arc(x2, y2, segment.glowSize, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
        }
    }

    drawCrystalFormations() {
        for (const formation of this.crystalFormations) {
            formation.pulsePhase += formation.pulseSpeed;
            const pulse = Math.sin(formation.pulsePhase) * 0.3 + 0.7;

            // Update crystal glow (for logic, though not used in cached render)
            for (const crystal of formation.crystals) {
                if (crystal.glowIntensity > 0.5) {
                    crystal.glowIntensity *= 0.985;
                }
            }

            // Use average glow intensity for pulse boost
            const avgGlow = formation.crystals.reduce((sum, c) => sum + c.glowIntensity, 0) / formation.crystals.length;
            const glowMult = avgGlow * pulse * (1 + this.pulseIntensity * 0.4);

            if (formation.cache) {
                this.ctx.save();
                this.ctx.translate(formation.x, formation.y);

                // Scale for pulse effect
                const scale = 1.0 + (pulse - 0.7) * 0.05;
                this.ctx.scale(scale, scale);

                // Adjust opacity
                this.ctx.globalAlpha = Math.min(1.0, 0.8 + glowMult * 0.2);

                // Draw cached formation
                // Center X is width/2, Center Y is height-30 (from creation)
                // So we draw at -width/2, -(height-30)
                this.ctx.drawImage(formation.cache, -formation.cache.width / 2, -(formation.cache.height - 30));

                this.ctx.restore();
            }
        }
    }

    drawGlowingPlants() {
        for (const plant of this.glowingPlants) {
            plant.pulsePhase += plant.pulseSpeed;
            plant.swayPhase += plant.swaySpeed;

            const pulse = Math.sin(plant.pulsePhase) * 0.3 + 0.7;
            const sway = Math.sin(plant.swayPhase) * plant.swayAmount;

            // Decay intense glow
            if (plant.glowIntensity > 1) {
                plant.glowIntensity *= 0.97;
            }

            const glowMult = plant.glowIntensity * pulse * (1 + this.pulseIntensity * 0.3);

            this.ctx.save();
            this.ctx.translate(plant.x, plant.y);

            // Draw based on plant type
            if (plant.type === 'fern') {
                this.drawFern(plant, sway, glowMult);
            } else if (plant.type === 'flower') {
                this.drawFlower(plant, sway, glowMult);
            } else if (plant.type === 'grass') {
                this.drawGrass(plant, sway, glowMult);
            } else if (plant.type === 'bulb') {
                this.drawBulb(plant, sway, glowMult);
            } else if (plant.type === 'tendril') {
                this.drawTendril(plant, sway, glowMult);
            }

            this.ctx.restore();
        }
    }

    drawFern(plant, sway, glowMult) {
        const stemHeight = plant.height;

        // Draw stem
        this.ctx.strokeStyle = `hsla(${plant.hue}, 70%, 40%, 0.8)`;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(sway, -stemHeight);
        this.ctx.stroke();

        // Draw fronds
        for (let i = 0; i < plant.fronds; i++) {
            const frondY = -stemHeight * (i / plant.fronds);
            const frondLength = plant.width * (1 - i / plant.fronds) * 0.8;
            const side = i % 2 === 0 ? 1 : -1;

            // Draw frond
            const gradient = this.ctx.createLinearGradient(sway, frondY, sway + frondLength * side, frondY);
            gradient.addColorStop(0, `hsla(${plant.hue}, 80%, 50%, ${0.6 * glowMult})`);
            gradient.addColorStop(1, `hsla(${plant.hue}, 100%, 65%, ${0.3 * glowMult})`);

            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(sway, frondY);
            this.ctx.quadraticCurveTo(
                sway + frondLength * side * 0.5,
                frondY - 10,
                sway + frondLength * side,
                frondY,
            );
            this.ctx.stroke();

            // Glow at frond tip
            const glowGradient = this.ctx.createRadialGradient(
                sway + frondLength * side,
                frondY,
                0,
                sway + frondLength * side,
                frondY,
                15,
            );
            glowGradient.addColorStop(0, `hsla(${plant.hue}, 100%, 70%, ${0.6 * glowMult})`);
            glowGradient.addColorStop(1, 'rgba(0, 255, 200, 0)');

            this.ctx.fillStyle = glowGradient;
            this.ctx.beginPath();
            this.ctx.arc(sway + frondLength * side, frondY, 15, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawFlower(plant, sway, glowMult) {
        const stemHeight = plant.height * 0.7;
        const flowerY = -stemHeight;

        // Draw stem
        this.ctx.strokeStyle = `hsla(${plant.hue}, 60%, 35%, 0.9)`;
        this.ctx.lineWidth = 4;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.quadraticCurveTo(sway * 0.5, -stemHeight * 0.5, sway, flowerY);
        this.ctx.stroke();

        // Draw petals
        this.ctx.save();
        this.ctx.translate(sway, flowerY);

        for (let i = 0; i < plant.petals; i++) {
            const angle = (Math.PI * 2 / plant.petals) * i;
            const petalLength = plant.width * 0.4;

            this.ctx.save();
            this.ctx.rotate(angle);

            // Petal glow
            const glowGradient = this.ctx.createRadialGradient(petalLength * 0.5, 0, 0, petalLength * 0.5, 0, petalLength);
            glowGradient.addColorStop(0, `hsla(${plant.hue}, 100%, 70%, ${0.7 * glowMult})`);
            glowGradient.addColorStop(0.5, `hsla(${plant.hue}, 100%, 65%, ${0.4 * glowMult})`);
            glowGradient.addColorStop(1, 'rgba(0, 255, 200, 0)');

            this.ctx.fillStyle = glowGradient;
            this.ctx.beginPath();
            this.ctx.ellipse(petalLength * 0.5, 0, petalLength * 0.8, petalLength * 0.3, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Petal body
            const petalGradient = this.ctx.createLinearGradient(0, 0, petalLength, 0);
            petalGradient.addColorStop(0, `hsla(${plant.hue}, 90%, 55%, 0.9)`);
            petalGradient.addColorStop(1, `hsla(${plant.hue}, 100%, 70%, ${0.7 + glowMult * 0.2})`);

            this.ctx.fillStyle = petalGradient;
            this.ctx.beginPath();
            this.ctx.ellipse(petalLength * 0.5, 0, petalLength * 0.6, petalLength * 0.25, 0, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        }

        // Draw center
        const centerGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, plant.centerSize);
        centerGradient.addColorStop(0, `hsla(${plant.hue + 30}, 100%, 80%, ${0.95 * glowMult})`);
        centerGradient.addColorStop(0.5, `hsla(${plant.hue + 20}, 100%, 70%, ${0.8 * glowMult})`);
        centerGradient.addColorStop(1, `hsla(${plant.hue}, 90%, 60%, 0.6)`);

        this.ctx.fillStyle = centerGradient;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, plant.centerSize, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
    }

    drawGrass(plant, sway, glowMult) {
        const blades = this.activePreset.grassBlades;

        for (let i = 0; i < blades; i++) {
            const offsetX = (i - blades / 2) * 8;
            const bladeHeight = plant.height * (0.7 + Math.random() * 0.3);
            const bladeSway = sway + (Math.random() - 0.5) * 10;

            const gradient = this.ctx.createLinearGradient(offsetX, 0, offsetX + bladeSway, -bladeHeight);
            gradient.addColorStop(0, `hsla(${plant.hue}, 70%, 40%, 0.8)`);
            gradient.addColorStop(0.7, `hsla(${plant.hue}, 90%, 60%, ${0.6 * glowMult})`);
            gradient.addColorStop(1, `hsla(${plant.hue}, 100%, 70%, ${0.9 * glowMult})`);

            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = 3;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(offsetX, 0);
            this.ctx.quadraticCurveTo(
                offsetX + bladeSway * 0.5,
                -bladeHeight * 0.6,
                offsetX + bladeSway,
                -bladeHeight,
            );
            this.ctx.stroke();

            // Tip glow
            const tipGradient = this.ctx.createRadialGradient(
                offsetX + bladeSway,
                -bladeHeight,
                0,
                offsetX + bladeSway,
                -bladeHeight,
                12,
            );
            tipGradient.addColorStop(0, `hsla(${plant.hue}, 100%, 75%, ${0.8 * glowMult})`);
            tipGradient.addColorStop(1, 'rgba(0, 255, 200, 0)');

            this.ctx.fillStyle = tipGradient;
            this.ctx.beginPath();
            this.ctx.arc(offsetX + bladeSway, -bladeHeight, 12, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawBulb(plant, sway, glowMult) {
        const { stemHeight } = plant;
        const bulbY = -stemHeight;

        // Draw stem
        this.ctx.strokeStyle = `hsla(${plant.hue}, 60%, 35%, 0.9)`;
        this.ctx.lineWidth = 5;
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.quadraticCurveTo(sway * 0.5, -stemHeight * 0.5, sway, bulbY);
        this.ctx.stroke();

        // Draw bulb glow
        const bulbGlowGradient = this.ctx.createRadialGradient(sway, bulbY, 0, sway, bulbY, plant.bulbSize * 2);
        bulbGlowGradient.addColorStop(0, `hsla(${plant.hue}, 100%, 70%, ${0.7 * glowMult})`);
        bulbGlowGradient.addColorStop(0.5, `hsla(${plant.hue}, 100%, 65%, ${0.4 * glowMult})`);
        bulbGlowGradient.addColorStop(1, 'rgba(0, 255, 200, 0)');

        this.ctx.fillStyle = bulbGlowGradient;
        this.ctx.beginPath();
        this.ctx.arc(sway, bulbY, plant.bulbSize * 2, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw bulb body
        const bulbGradient = this.ctx.createRadialGradient(sway - plant.bulbSize * 0.2, bulbY - plant.bulbSize * 0.2, plant.bulbSize * 0.2, sway, bulbY, plant.bulbSize);
        bulbGradient.addColorStop(0, `hsla(${plant.hue}, 100%, 75%, ${0.95 * glowMult})`);
        bulbGradient.addColorStop(0.5, `hsla(${plant.hue}, 90%, 65%, ${0.85 * glowMult})`);
        bulbGradient.addColorStop(1, `hsla(${plant.hue}, 80%, 55%, 0.7)`);

        this.ctx.fillStyle = bulbGradient;
        this.ctx.beginPath();
        this.ctx.arc(sway, bulbY, plant.bulbSize, 0, Math.PI * 2);
        this.ctx.fill();

        // Add highlight
        this.ctx.fillStyle = `hsla(${plant.hue}, 100%, 90%, ${0.6 * glowMult})`;
        this.ctx.beginPath();
        this.ctx.arc(sway - plant.bulbSize * 0.3, bulbY - plant.bulbSize * 0.3, plant.bulbSize * 0.3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    drawTendril(plant, sway, glowMult) {
        let currentX = 0;
        let currentY = 0;
        const segmentHeight = plant.height / plant.segments;

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);

        for (let i = 0; i < plant.segments; i++) {
            const waveOffset = Math.sin((i / plant.segments) * Math.PI * 2 + plant.swayPhase) * sway * (i / plant.segments);
            currentX = waveOffset;
            currentY -= segmentHeight;

            this.ctx.lineTo(currentX, currentY);

            // Add glowing nodes
            if (i % this.activePreset.tendrilNodeFrequency === 0) {
                const nodeGradient = this.ctx.createRadialGradient(currentX, currentY, 0, currentX, currentY, 10);
                nodeGradient.addColorStop(0, `hsla(${plant.hue}, 100%, 75%, ${0.9 * glowMult})`);
                nodeGradient.addColorStop(0.5, `hsla(${plant.hue}, 100%, 65%, ${0.5 * glowMult})`);
                nodeGradient.addColorStop(1, 'rgba(0, 255, 200, 0)');

                this.ctx.fillStyle = nodeGradient;
                this.ctx.beginPath();
                this.ctx.arc(currentX, currentY, 10, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }

        const gradient = this.ctx.createLinearGradient(0, 0, 0, currentY);
        gradient.addColorStop(0, `hsla(${plant.hue}, 70%, 45%, 0.7)`);
        gradient.addColorStop(1, `hsla(${plant.hue}, 90%, 60%, ${0.5 * glowMult})`);

        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.stroke();
    }

    drawSpores() {
        for (const spore of this.spores) {
            spore.x += spore.vx;
            spore.y += spore.vy;
            spore.driftPhase += spore.driftSpeed;

            // Add drift
            spore.x += Math.sin(spore.driftPhase) * 0.5;

            // Wrap around
            if (spore.x < 0) spore.x = this.canvas.width;
            if (spore.x > this.canvas.width) spore.x = 0;
            if (spore.y < -10) spore.y = this.canvas.height + 10;

            // Draw spore with glow
            if (!this.useWebGL) {
                const gradient = this.ctx.createRadialGradient(spore.x, spore.y, 0, spore.x, spore.y, spore.size * 3);
                gradient.addColorStop(0, `rgba(150, 255, 220, ${spore.opacity})`);
                gradient.addColorStop(0.5, `rgba(100, 220, 180, ${spore.opacity * 0.5})`);
                gradient.addColorStop(1, 'rgba(50, 180, 150, 0)');

                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(spore.x, spore.y, spore.size * 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    drawFireflies() {
        for (const firefly of this.fireflies) {
            // Random wandering movement
            firefly.vx += (Math.random() - 0.5) * 0.2;
            firefly.vy += (Math.random() - 0.5) * 0.2;

            // Limit speed
            const speed = Math.sqrt(firefly.vx * firefly.vx + firefly.vy * firefly.vy);
            if (speed > 2) {
                firefly.vx = (firefly.vx / speed) * 2;
                firefly.vy = (firefly.vy / speed) * 2;
            }

            firefly.x += firefly.vx;
            firefly.y += firefly.vy;
            firefly.pulsePhase += firefly.pulseSpeed;

            // Wrap around
            if (firefly.x < 0) firefly.x = this.canvas.width;
            if (firefly.x > this.canvas.width) firefly.x = 0;
            if (firefly.y < 0) firefly.y = this.canvas.height;
            if (firefly.y > this.canvas.height) firefly.y = 0;

            const pulse = Math.sin(firefly.pulsePhase) * 0.4 + 0.6;
            const alpha = firefly.brightness * pulse;

            if (!this.useWebGL) {
                // Draw trail
                firefly.trail.push({ x: firefly.x, y: firefly.y });
                if (firefly.trail.length > this.activePreset.fireflyTrailLength) firefly.trail.shift();

                for (let i = 0; i < firefly.trail.length; i++) {
                    const trailPoint = firefly.trail[i];
                    const trailAlpha = (i / firefly.trail.length) * alpha * 0.3;
                    const trailSize = (i / firefly.trail.length) * firefly.size;

                    const trailGradient = this.ctx.createRadialGradient(
                        trailPoint.x,
                        trailPoint.y,
                        0,
                        trailPoint.x,
                        trailPoint.y,
                        trailSize * 2,
                    );

                    if (firefly.color === 'cyan') {
                        trailGradient.addColorStop(0, `rgba(100, 255, 255, ${trailAlpha})`);
                        trailGradient.addColorStop(1, 'rgba(50, 200, 200, 0)');
                    } else {
                        trailGradient.addColorStop(0, `rgba(150, 255, 100, ${trailAlpha})`);
                        trailGradient.addColorStop(1, 'rgba(100, 200, 50, 0)');
                    }

                    this.ctx.fillStyle = trailGradient;
                    this.ctx.beginPath();
                    this.ctx.arc(trailPoint.x, trailPoint.y, trailSize * 2, 0, Math.PI * 2);
                    this.ctx.fill();
                }

                // Draw main firefly glow
                const gradient = this.ctx.createRadialGradient(
                    firefly.x,
                    firefly.y,
                    0,
                    firefly.x,
                    firefly.y,
                    firefly.size * 3,
                );

                if (firefly.color === 'cyan') {
                    gradient.addColorStop(0, `rgba(200, 255, 255, ${alpha})`);
                    gradient.addColorStop(0.3, `rgba(100, 255, 255, ${alpha * 0.7})`);
                    gradient.addColorStop(0.6, `rgba(50, 200, 200, ${alpha * 0.3})`);
                    gradient.addColorStop(1, 'rgba(20, 150, 150, 0)');
                } else {
                    gradient.addColorStop(0, `rgba(220, 255, 150, ${alpha})`);
                    gradient.addColorStop(0.3, `rgba(150, 255, 100, ${alpha * 0.7})`);
                    gradient.addColorStop(0.6, `rgba(100, 200, 50, ${alpha * 0.3})`);
                    gradient.addColorStop(1, 'rgba(50, 150, 20, 0)');
                }

                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(firefly.x, firefly.y, firefly.size * 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    renderStaticElements() {
        if (!this.staticCtx || !this.staticCanvas) return;

        // Temporarily swap context to draw on static canvas
        const originalCtx = this.ctx;
        this.ctx = this.staticCtx;

        // Clear static canvas
        this.ctx.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);

        // Draw static/slow-changing elements
        this.drawAmbientGlows();
        this.drawGroundGlow();

        if (!this.useWebGL) {
            this.drawBiolumRocks();
            this.drawGroundMushrooms();
            this.drawCrystalFormations();
            this.drawGlowingPlants();
        }

        this.drawLuminousVines();

        // Restore original context
        this.ctx = originalCtx;
    }

    animate() {
        if (!this.isActive) {
            console.log('🍄 Animation stopped: theme not active');
            return;
        }

        if (this.time === 0) {
            console.log('🍄 First frame of animation');
        }

        this.time += 1;
        this.frameCount++;

        // Decay pulse intensity
        if (this.pulseIntensity > 0) {
            this.pulseIntensity *= 0.92; // Faster decay from high value
        }

        // Redraw static elements based on quality preset (or when flagged)
        if (this.needsStaticRedraw || this.frameCount % this.activePreset.staticRedrawInterval === 0) {
            this.renderStaticElements();
            this.needsStaticRedraw = false;
        }

        // Clear main canvas and draw background
        this.drawBackground();

        // Draw cached static layer
        if (this.staticCanvas) {
            this.ctx.drawImage(this.staticCanvas, 0, 0);
        }

        // Draw animated elements
        this.drawSpores();

        // Draw energy waves
        for (let i = this.energyWaves.length - 1; i >= 0; i--) {
            const wave = this.energyWaves[i];

            wave.delay -= 0.016;
            if (wave.delay <= 0 && !wave.started) {
                wave.started = true;
            }

            if (!wave.started) continue;

            wave.radius += wave.speed;
            wave.life -= 0.01;
            wave.opacity = wave.life * 0.7;

            if (wave.life <= 0 || wave.radius > wave.maxRadius) {
                this.energyWaves.splice(i, 1);
                continue;
            }

            // Draw multiple ring layers
            for (let j = 0; j < 3; j++) {
                const offsetRadius = wave.radius - j * 15;
                if (offsetRadius <= 0) continue;

                this.ctx.beginPath();
                this.ctx.arc(wave.x, wave.y, offsetRadius, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(100, 255, 220, ${wave.opacity * (1 - j * 0.3)})`;
                this.ctx.lineWidth = 4 + j;
                this.ctx.stroke();
            }
        }

        // Draw light burst particles
        for (let i = this.lightBursts.length - 1; i >= 0; i--) {
            const p = this.lightBursts[i];

            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.98;
            p.vy *= 0.98;
            p.life -= p.isBurst ? 0.03 : 0.012; // Faster decay for bursts
            p.opacity = p.life * 0.9;
            p.pulsePhase += 0.15;

            if (p.life <= 0 || p.y > this.canvas.height || p.x < 0 || p.x > this.canvas.width) {
                this.lightBursts.splice(i, 1);
                continue;
            }

            if (!this.useWebGL) {
                const pulse = Math.sin(p.pulsePhase) * 0.3 + 0.7;

                const gradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);

                if (p.color === 'cyan') {
                    gradient.addColorStop(0, `rgba(200, 255, 255, ${p.opacity * pulse})`);
                    gradient.addColorStop(0.5, `rgba(100, 255, 255, ${p.opacity * pulse * 0.6})`);
                    gradient.addColorStop(1, 'rgba(50, 200, 200, 0)');
                } else {
                    gradient.addColorStop(0, `rgba(220, 255, 150, ${p.opacity * pulse})`);
                    gradient.addColorStop(0.5, `rgba(150, 255, 100, ${p.opacity * pulse * 0.6})`);
                    gradient.addColorStop(1, 'rgba(100, 200, 50, 0)');
                }

                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }

        // Draw combo orbs
        for (let i = this.comboOrbs.length - 1; i >= 0; i--) {
            const orb = this.comboOrbs[i];

            orb.spiralPhase += orb.spiralSpeed;
            orb.x += orb.vx + Math.cos(orb.spiralPhase) * 2;
            orb.y += orb.vy;
            orb.vx *= 0.99;
            orb.vy *= 0.98;
            orb.life -= 0.008;
            orb.opacity = orb.life * 0.8;
            orb.pulsePhase += 0.12;

            if (orb.life <= 0 || orb.y < -50) {
                this.comboOrbs.splice(i, 1);
                continue;
            }

            const pulse = Math.sin(orb.pulsePhase) * 0.4 + 0.6;

            // Outer glow
            const outerGrad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size * 2.5);
            outerGrad.addColorStop(0, `rgba(150, 255, 220, ${orb.opacity * pulse * 0.5})`);
            outerGrad.addColorStop(0.5, `rgba(100, 220, 180, ${orb.opacity * pulse * 0.3})`);
            outerGrad.addColorStop(1, 'rgba(50, 180, 150, 0)');

            this.ctx.fillStyle = outerGrad;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Core
            const coreGrad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size);
            coreGrad.addColorStop(0, `rgba(255, 255, 255, ${orb.opacity * pulse})`);
            coreGrad.addColorStop(0.4, `rgba(200, 255, 240, ${orb.opacity * pulse * 0.8})`);
            coreGrad.addColorStop(1, `rgba(150, 255, 220, ${orb.opacity * pulse * 0.3})`);

            this.ctx.fillStyle = coreGrad;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw aurora effects
        for (let i = this.auroraEffects.length - 1; i >= 0; i--) {
            const aurora = this.auroraEffects[i];

            aurora.x += aurora.driftSpeed;
            aurora.life -= 0.005;
            aurora.opacity = aurora.life * 0.6;

            if (aurora.life <= 0) {
                this.auroraEffects.splice(i, 1);
                continue;
            }

            // Draw each wave layer
            for (let j = 0; j < aurora.waves.length; j++) {
                const wave = aurora.waves[j];
                wave.phase += wave.speed;

                this.ctx.beginPath();
                this.ctx.moveTo(aurora.x, aurora.y + wave.yOffset);

                // Quality-based resolution
                const step = this.activePreset.auroraResolution;
                for (let x = 0; x <= aurora.width; x += step) {
                    const waveX = aurora.x + x;
                    const waveY = aurora.y + wave.yOffset + Math.sin(x * wave.frequency + wave.phase) * wave.amplitude;
                    this.ctx.lineTo(waveX, waveY);
                }

                const gradient = this.ctx.createLinearGradient(aurora.x, aurora.y, aurora.x + aurora.width, aurora.y);
                gradient.addColorStop(0, 'rgba(100, 255, 220, 0)');
                gradient.addColorStop(0.2, `rgba(150, 255, 230, ${aurora.opacity * 0.5})`);
                gradient.addColorStop(0.5, `rgba(100, 255, 220, ${aurora.opacity})`);
                gradient.addColorStop(0.8, `rgba(150, 255, 230, ${aurora.opacity * 0.5})`);
                gradient.addColorStop(1, 'rgba(100, 255, 220, 0)');

                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }
        }

        this.drawFireflies();

        // WebGL Rendering
        if (this.useWebGL && this.webglRenderer) {
            // Collect particles
            const particles = [];

            // Helper to apply ripple effect to particles
            const applyParticleRipple = (p) => {
                let boost = 0;
                for (const ripple of this.globalRipples) {
                    const dx = p.x - ripple.x;
                    const dy = p.y - ripple.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const diff = Math.abs(dist - ripple.radius);
                    const width = 200; // Wider band (was 100)
                    if (diff < width) {
                        // Smooth falloff
                        const t = 1 - diff / width;
                        boost += t * t * ripple.life * ripple.strength;
                    }
                }
                return boost;
            };

            // Update and Add fireflies
            for (const f of this.fireflies) {
                // Update logic
                f.vx += (Math.random() - 0.5) * 0.2;
                f.vy += (Math.random() - 0.5) * 0.2;
                const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
                if (speed > 2) {
                    f.vx = (f.vx / speed) * 2;
                    f.vy = (f.vy / speed) * 2;
                }
                f.x += f.vx;
                f.y += f.vy;
                f.pulsePhase += f.pulseSpeed;
                if (f.x < 0) f.x = this.canvas.width;
                if (f.x > this.canvas.width) f.x = 0;
                if (f.y < 0) f.y = this.canvas.height;
                if (f.y > this.canvas.height) f.y = 0;

                // Apply ripple boost
                const boost = applyParticleRipple(f);

                // Flash white if boosted
                let color = f.color;
                if (boost > 0.5) color = '#ffffff';
                else if (boost > 0.2) color = '#ccffff';

                const p = {
                    x: f.x,
                    y: f.y,
                    size: f.size * (1 + boost), // Double size at peak
                    opacity: Math.min(1.0, f.brightness * (Math.sin(f.pulsePhase) * 0.4 + 0.6) + boost),
                    color: color
                };
                particles.push(p);
            }

            // Add spores
            for (const s of this.spores) {
                const boost = applyParticleRipple(s);

                let color = '#aaffdd';
                if (boost > 0.5) color = '#ffffff';

                const p = {
                    x: s.x,
                    y: s.y,
                    size: s.size * (1 + boost),
                    opacity: Math.min(1.0, s.opacity + boost * 0.8),
                    color: color
                };
                particles.push(p);
            }

            // Add light bursts
            for (const p of this.lightBursts) {
                particles.push(p);
            }

            this.webglRenderer.uploadParticles(particles);
            this.webglRenderer.render(this.time * 0.001, this.pulseIntensity);

            // Helper to apply ripple effect to sprites
            const applyRipple = (sprite) => {
                let boost = 0;
                let swayBoost = 0;

                for (const ripple of this.globalRipples) {
                    const dx = sprite.x - ripple.x;
                    const dy = sprite.y - ripple.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    const diff = Math.abs(dist - ripple.radius);
                    const width = 250; // Even wider for flora
                    if (diff < width) {
                        const t = 1 - diff / width;
                        const intensity = t * t * ripple.life * ripple.strength;
                        boost += intensity;
                        swayBoost += intensity * 3.0; // More sway
                    }
                }
                return { boost, swayBoost };
            };

            // Render textured sprites (static elements)
            const sprites = [];

            // Rocks
            for (const rock of this.biolumRocks) {
                rock.pulsePhase += rock.pulseSpeed;
                const { boost } = applyRipple(rock);

                const pulse = Math.sin(rock.pulsePhase) * 0.3 + 0.7 + boost;
                if (rock.glowIntensity > 0.6) rock.glowIntensity *= 0.988;
                const glowMult = rock.glowIntensity * pulse * (1 + this.pulseIntensity * 0.3);

                // Update opacity for WebGL
                rock.opacity = Math.min(1.0, 0.7 + glowMult * 0.3);
                // Size is already set in width/height, but we can modulate it if needed
                // rock.size = rock.width * (1.0 + (pulse - 0.7) * 0.1); 
                // Actually, the cache size is fixed. We render the cache.
                // The cache width is rock.width * 4 (for rocks).
                // We need to pass the cache width as the size to the shader.
                rock.size = rock.cache ? rock.cache.width * (1.0 + (pulse - 0.7) * 0.1) : rock.width;

                sprites.push(rock);
            }

            // Mushrooms
            for (const m of this.groundMushrooms) {
                m.pulsePhase += m.pulseSpeed;
                const { boost, swayBoost } = applyRipple(m);

                const pulse = Math.sin(m.pulsePhase) * 0.3 + 0.7 + boost;
                if (m.glowIntensity > 0.7) m.glowIntensity *= 0.985;
                const glowMult = m.glowIntensity * pulse * (1 + this.pulseIntensity * 0.35);

                m.opacity = Math.min(1.0, 0.8 + glowMult * 0.2);
                m.size = m.cache ? m.cache.width * (1.0 + (pulse - 0.7) * 0.05) : m.capWidth;
                m.sway = 1.0 + swayBoost; // Enable sway

                sprites.push(m);
            }

            // Crystals
            for (const f of this.crystalFormations) {
                f.pulsePhase += f.pulseSpeed;
                const { boost } = applyRipple(f);

                const pulse = Math.sin(f.pulsePhase) * 0.3 + 0.7 + boost;

                // Update internal crystals glow (logic only)
                for (const c of f.crystals) {
                    if (c.glowIntensity > 0.5) c.glowIntensity *= 0.985;
                }
                const avgGlow = f.crystals.reduce((sum, c) => sum + c.glowIntensity, 0) / f.crystals.length;
                const glowMult = avgGlow * pulse * (1 + this.pulseIntensity * 0.4);

                f.opacity = Math.min(1.0, 0.8 + glowMult * 0.2);
                f.size = f.cache ? f.cache.width * (1.0 + (pulse - 0.7) * 0.05) : 100;
                f.sway = 0.0; // Crystals don't sway

                sprites.push(f);
            }
            // Plants
            for (const p of this.glowingPlants) {
                p.swayPhase += p.swaySpeed;
                p.pulsePhase += p.pulseSpeed;
                const { boost, swayBoost } = applyRipple(p);

                const pulse = Math.sin(p.pulsePhase) * 0.3 + 0.7 + boost;
                const glowMult = pulse * (1 + this.pulseIntensity * 0.3);

                p.opacity = Math.min(1.0, 0.8 + glowMult * 0.2);
                p.size = p.cache ? p.cache.width : p.height;
                p.sway = 1.5 + swayBoost; // Stronger sway for plants

                sprites.push(p);
            }

            // Ground Foliage (New!)
            if (this.groundFoliage) {
                for (const f of this.groundFoliage) {
                    f.swayPhase += f.swaySpeed;
                    const { boost, swayBoost } = applyRipple(f);
                    // Foliage sways more
                    f.opacity = 0.8 + boost * 0.2;
                    f.size = f.cache ? f.cache.width : f.width;
                    f.sway = 2.0 + swayBoost; // Maximum sway

                    sprites.push(f);
                }
            }

            // Alien Flora (New!)
            if (this.alienFlora) {
                for (const f of this.alienFlora) {
                    f.swayPhase += f.swaySpeed;
                    const { boost, swayBoost } = applyRipple(f);

                    const pulse = Math.sin(this.time * 0.002 + f.swayPhase) * 0.5 + 0.5 + boost;

                    f.opacity = Math.min(1.0, 0.7 + pulse * 0.3);
                    f.size = f.cache ? f.cache.width : f.width;
                    f.sway = 1.5 + swayBoost;

                    sprites.push(f);
                }
            }

            // Sort by layer/y for depth? WebGL handles draw order by array order.
            // They are already sorted by layer in creation, but we are mixing them here.
            // We should sort sprites by layer or Y.
            sprites.sort((a, b) => (a.layer || 0) - (b.layer || 0));

            this.webglRenderer.renderTexturedParticles(sprites, this.time * 0.001);
        }

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Remove quality change listener
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Clear gameplay effects
        this.energyWaves = [];
        this.lightBursts = [];
        this.comboOrbs = [];
        this.auroraEffects = [];
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.pendingComboCount = 0;

        // Clean up static canvas
        if (this.staticCanvas) {
            this.staticCanvas = null;
            this.staticCtx = null;
        }

        // Clean up WebGL
        if (this.webglRenderer) {
            this.webglRenderer.destroy();
            this.webglRenderer = null;
        }
        if (this.webglCanvas && this.webglCanvas.parentNode) {
            this.webglCanvas.parentNode.removeChild(this.webglCanvas);
            this.webglCanvas = null;
        }

        super.stop();
    }

    /**
     * Get custom tetromino configuration for Bioluminescence theme
     * @returns {Object} Tetromino configuration with glowing cyan-green colors
     */
    getTetrominoConfig() {
        return BIOLUMINESCENCE_TETROMINOS;
    }
}

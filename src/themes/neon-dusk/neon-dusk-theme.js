import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { NEON_DUSK_TETROMINOS } from './neon-dusk-tetrominos.js';

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');
        this.meteorPool = [];
        this.meteorsContainer = null;
        this.meteorAnimationFrame = null;
        this.lastMeteorFrameTime = 0;

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
        this.comboMultiplier = 1.0;
        this.effectsAnimationFrame = null;
        this.lastEffectsFrameTime = 0;
        this.eventUnsubscribers = [];

        // DOM references for rebuilds
        this.starsContainer = null;
        this.cloudsContainer = null;
        this.particlesContainer = null;

        // Graphics quality state
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            Minimal: {
                starCount: 50,
                cloudCount: 3,
                meteorCount: 2,
                floatingParticles: 12,
                maxParticles: 60,
                maxArcs: 2,
                maxScanlines: 3,
                maxRings: 2,
                maxVortexes: 0,
                maxGlitches: 4,
            },
            Low: {
                starCount: 80,
                cloudCount: 4,
                meteorCount: 3,
                floatingParticles: 18,
                maxParticles: 100,
                maxArcs: 3,
                maxScanlines: 5,
                maxRings: 3,
                maxVortexes: 1,
                maxGlitches: 6,
            },
            Medium: {
                starCount: 120,
                cloudCount: 6,
                meteorCount: 5,
                floatingParticles: 28,
                maxParticles: 140,
                maxArcs: 5,
                maxScanlines: 8,
                maxRings: 5,
                maxVortexes: 2,
                maxGlitches: 10,
            },
            High: {
                starCount: 150,
                cloudCount: 8,
                meteorCount: 6,
                floatingParticles: 40,
                maxParticles: 180,
                maxArcs: 6,
                maxScanlines: 12,
                maxRings: 8,
                maxVortexes: 3,
                maxGlitches: 15,
            },
            Ultra: {
                starCount: 220,
                cloudCount: 10,
                meteorCount: 8,
                floatingParticles: 60,
                maxParticles: 240,
                maxArcs: 10,
                maxScanlines: 18,
                maxRings: 12,
                maxVortexes: 5,
                maxGlitches: 22,
            },
            Extreme: {
                starCount: 300,
                cloudCount: 14,
                meteorCount: 12,
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
        this.createStars(true);
        this.createClouds(true);
        this.createFloatingParticles(true);
        this.rebuildMeteorPool();
        this.trimEffectCollections();
    }

    createStars(force = false) {
        if (!this.starsContainer) {
            this.starsContainer = this.getContainer('neon-dusk-stars');
        }

        const container = this.starsContainer;
        if (!container) return;
        if (!force && container.children.length > 0) return;

        container.textContent = '';
        const starCount = this.activePreset?.starCount ?? 150;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'neon-dusk-star';
            const size = Math.random() * 2.5 + 1;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 60}%`;
            star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
            star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
            fragment.appendChild(star);
        }

        container.appendChild(fragment);
    }

    createClouds(force = false) {
        if (!this.cloudsContainer) {
            this.cloudsContainer = this.getContainer('neon-dusk-clouds');
        }

        const container = this.cloudsContainer;
        if (!container) return;
        if (!force && container.children.length > 0) return;

        container.textContent = '';
        const cloudCount = this.activePreset?.cloudCount ?? 8;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'neon-dusk-cloud';
            cloud.style.top = `${10 + Math.random() * 50}%`;
            const duration = Math.random() * 40 + 60;
            cloud.style.setProperty('--cloud-duration', `${duration}s`);
            cloud.style.setProperty('--cloud-delay', `-${Math.random() * duration}s`);
            fragment.appendChild(cloud);
        }

        container.appendChild(fragment);
    }

    createFloatingParticles(force = false) {
        if (!this.particlesContainer) {
            this.particlesContainer = this.getContainer('neon-dusk-particles');
        }

        const container = this.particlesContainer;
        if (!container) return;
        if (!force && container.children.length > 0) return;

        container.textContent = '';
        const particleCount = this.activePreset?.floatingParticles ?? 40;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ff0088', '#ffff00'];
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'neon-dusk-particle';
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.bottom = `${Math.random() * 100}%`;
            const particleColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.setProperty('--particle-color', particleColor);
            particle.style.setProperty('--particle-duration', `${Math.random() * 10 + 15}s`);
            particle.style.setProperty('--particle-delay', `${Math.random() * 10}s`);
            particle.style.setProperty('--drift-x', `${Math.random() * 200 - 100}px`);
            fragment.appendChild(particle);
        }

        container.appendChild(fragment);
    }

    rebuildMeteorPool() {
        if (!this.meteorsContainer) {
            this.meteorsContainer = this.getContainer('neon-dusk-meteors');
        }

        const container = this.meteorsContainer;
        if (!container) return;

        container.textContent = '';
        this.stopMeteorLoop();
        this.meteorPool = [];
        this.initializeMeteors(container, this.activePreset?.meteorCount ?? 6);
    }

    async createScene() {
        // Apply graphics quality preset before building the scene
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        // Stars, clouds, meteors, and particles respond to quality levels
        this.createStars(true);
        this.createClouds(true);
        this.rebuildMeteorPool();

        // Mountain Silhouettes - Back Layer
        const mountainsBack = document.getElementById('neon-dusk-mountains-back');
        if (mountainsBack && mountainsBack.children.length === 0) {
            const mountain = document.createElement('div');
            mountain.className = 'neon-dusk-mountain-back';
            mountain.style.width = '100%';
            mountain.style.height = '100%';
            mountain.style.setProperty('--h0', '70%');
            mountain.style.setProperty('--p1', '8%');
            mountain.style.setProperty('--h1', '65%');
            mountain.style.setProperty('--p2', '18%');
            mountain.style.setProperty('--h2', '45%');
            mountain.style.setProperty('--p3', '28%');
            mountain.style.setProperty('--h3', '55%');
            mountain.style.setProperty('--p4', '38%');
            mountain.style.setProperty('--h4', '35%');
            mountain.style.setProperty('--p5', '48%');
            mountain.style.setProperty('--h5', '50%');
            mountain.style.setProperty('--p6', '58%');
            mountain.style.setProperty('--h6', '40%');
            mountain.style.setProperty('--p7', '68%');
            mountain.style.setProperty('--h7', '55%');
            mountain.style.setProperty('--p8', '78%');
            mountain.style.setProperty('--h8', '45%');
            mountain.style.setProperty('--p9', '88%');
            mountain.style.setProperty('--h9', '60%');
            mountain.style.setProperty('--h10', '65%');
            mountainsBack.appendChild(mountain);
            this.registerContainer(mountainsBack);
        }

        // Mountain Silhouettes - Mid Layer
        const mountainsMid = document.getElementById('neon-dusk-mountains-mid');
        if (mountainsMid && mountainsMid.children.length === 0) {
            const mountain = document.createElement('div');
            mountain.className = 'neon-dusk-mountain-mid';
            mountain.style.width = '100%';
            mountain.style.height = '100%';
            mountain.style.setProperty('--h0', '65%');
            mountain.style.setProperty('--p1', '12%');
            mountain.style.setProperty('--h1', '60%');
            mountain.style.setProperty('--p2', '22%');
            mountain.style.setProperty('--h2', '40%');
            mountain.style.setProperty('--p3', '32%');
            mountain.style.setProperty('--h3', '50%');
            mountain.style.setProperty('--p4', '42%');
            mountain.style.setProperty('--h4', '30%');
            mountain.style.setProperty('--p5', '52%');
            mountain.style.setProperty('--h5', '45%');
            mountain.style.setProperty('--p6', '62%');
            mountain.style.setProperty('--h6', '35%');
            mountain.style.setProperty('--p7', '72%');
            mountain.style.setProperty('--h7', '50%');
            mountain.style.setProperty('--p8', '82%');
            mountain.style.setProperty('--h8', '40%');
            mountain.style.setProperty('--h9', '60%');
            mountainsMid.appendChild(mountain);
            this.registerContainer(mountainsMid);
        }

        // Mountain Silhouettes - Front Layer
        const mountainsFront = document.getElementById('neon-dusk-mountains-front');
        if (mountainsFront && mountainsFront.children.length === 0) {
            const mountain = document.createElement('div');
            mountain.className = 'neon-dusk-mountain-front';
            mountain.style.width = '100%';
            mountain.style.height = '100%';
            mountain.style.setProperty('--h0', '60%');
            mountain.style.setProperty('--p1', '10%');
            mountain.style.setProperty('--h1', '55%');
            mountain.style.setProperty('--p2', '20%');
            mountain.style.setProperty('--h2', '35%');
            mountain.style.setProperty('--p3', '30%');
            mountain.style.setProperty('--h3', '45%');
            mountain.style.setProperty('--p4', '40%');
            mountain.style.setProperty('--h4', '25%');
            mountain.style.setProperty('--p5', '50%');
            mountain.style.setProperty('--h5', '40%');
            mountain.style.setProperty('--p6', '60%');
            mountain.style.setProperty('--h6', '30%');
            mountain.style.setProperty('--p7', '70%');
            mountain.style.setProperty('--h7', '45%');
            mountain.style.setProperty('--p8', '80%');
            mountain.style.setProperty('--h8', '35%');
            mountain.style.setProperty('--p9', '90%');
            mountain.style.setProperty('--h9', '50%');
            mountain.style.setProperty('--h10', '55%');
            mountainsFront.appendChild(mountain);
            this.registerContainer(mountainsFront);
        }

        // Floating neon particles / polygons respond to quality level
        this.createFloatingParticles(true);

        // Setup gameplay effects
        this.setupGameplayEffects();

        // Listen for runtime changes to graphics quality
        this.setupQualityListener();
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
        this.effectsCtx = canvas.getContext('2d', { alpha: true, desynchronized: true });

        // Size canvas
        const resizeCanvas = () => {
            if (!this.effectsCanvas) return;
            const rect = themeContainer.getBoundingClientRect();
            this.effectsCanvas.width = rect.width;
            this.effectsCanvas.height = rect.height;
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
        this.createNeonBurst(lineCount);

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

        if (comboCount >= 2) {
            this.createGlitchPulse(comboCount);
        }

        if (comboCount >= 4) {
            this.createElectricArcs(comboCount);
        }

        if (comboCount >= 7) {
            this.createCyberVortex(comboCount);
        }
    }

    createNeonBurst(lineCount) {
        if (!this.effectsCanvas) return;

        // Enforce particle limit more strictly
        if (this.neonBurstParticles.length >= this.MAX_PARTICLES) {
            // Remove oldest particles (40% instead of 30%)
            this.neonBurstParticles.splice(0, Math.floor(this.MAX_PARTICLES * 0.4));
        }

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ffff00', '#ff0088'];
        // Reduced particle count: was lineCount * 20, now lineCount * 12
        const burstCount = Math.min(
            lineCount * 12 + this.comboMultiplier * 8,
            this.MAX_PARTICLES - this.neonBurstParticles.length,
        );

        for (let i = 0; i < burstCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (Math.random() * 3 + 2) * this.comboMultiplier;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.neonBurstParticles.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                maxLife: Math.random() * 0.8 + 0.6,
                size: Math.random() * 4 + 2,
                color,
                glow: Math.random() * 15 + 10,
            });
        }
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

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ffff00'];
        const ringCount = Math.min(lineCount, this.MAX_RINGS - this.hologramRings.length);

        for (let i = 0; i < ringCount; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            this.hologramRings.push({
                x: centerX,
                y: centerY,
                radius: 10,
                maxRadius: Math.random() * 300 + 250,
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

    createCyberVortex(comboCount) {
        if (!this.effectsCanvas) return;

        // Limit vortexes
        if (this.cyberVortexes.length >= this.MAX_VORTEXES) return;

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = ['#00ffff', '#ff00ff', '#00ff88'];
        const vortexCount = Math.min(Math.floor(comboCount / 4), this.MAX_VORTEXES - this.cyberVortexes.length);

        for (let i = 0; i < vortexCount; i++) {
            const color = colors[i % colors.length];
            const particles = [];
            // Reduced from 60 to 40 for better performance
            const particleCount = 40;

            for (let j = 0; j < particleCount; j++) {
                const angle = (j / particleCount) * Math.PI * 2;
                const radius = 60 + Math.random() * 40;
                particles.push({
                    angle,
                    radius,
                    angularSpeed: Math.random() * 0.1 + 0.15,
                    radiusSpeed: Math.random() * 2 + 1,
                });
            }

            this.cyberVortexes.push({
                x: centerX + (Math.random() - 0.5) * 200,
                y: centerY + (Math.random() - 0.5) * 200,
                life: 1.0,
                maxLife: 2.0 + Math.random() * 0.5,
                color,
                particles,
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
            this.renderEffects();

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
        // Update neon burst particles - batch removal for better performance
        let writeIndex = 0;
        for (let i = 0; i < this.neonBurstParticles.length; i++) {
            const p = this.neonBurstParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15; // Gravity
            p.life -= delta / p.maxLife;

            if (p.life > 0) {
                this.neonBurstParticles[writeIndex++] = p;
            }
        }
        this.neonBurstParticles.length = writeIndex;

        // Update electric arcs - reduced flicker frequency for performance
        writeIndex = 0;
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

        // Update cyber vortexes
        writeIndex = 0;
        for (let i = 0; i < this.cyberVortexes.length; i++) {
            const vortex = this.cyberVortexes[i];
            vortex.life -= delta / vortex.maxLife;

            // Optimize particle updates
            const { particles } = vortex;
            for (let j = 0; j < particles.length; j++) {
                const p = particles[j];
                p.angle += p.angularSpeed * delta;
                p.radius += p.radiusSpeed * delta;
            }

            if (vortex.life > 0) {
                this.cyberVortexes[writeIndex++] = vortex;
            }
        }
        this.cyberVortexes.length = writeIndex;
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const { width } = this.effectsCanvas;
        const { height } = this.effectsCanvas;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Batch render by effect type to reduce state changes
        // Render digital scan lines
        for (let i = 0; i < this.digitalScanLines.length; i++) {
            const line = this.digitalScanLines[i];
            const alpha = line.life * line.opacity;
            ctx.strokeStyle = this.getColorWithAlpha(line.color, alpha);
            ctx.lineWidth = line.height;
            ctx.shadowBlur = 15;
            ctx.shadowColor = line.color;
            ctx.beginPath();
            ctx.moveTo(0, line.y);
            ctx.lineTo(width, line.y);
            ctx.stroke();
        }

        // Render hologram rings
        for (let i = 0; i < this.hologramRings.length; i++) {
            const ring = this.hologramRings[i];
            ctx.strokeStyle = this.getColorWithAlpha(ring.color, ring.life);
            ctx.lineWidth = ring.width;
            ctx.shadowBlur = 20;
            ctx.shadowColor = ring.color;
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Render neon burst particles - group by color to reduce state changes
        const particlesByColor = {};
        for (let i = 0; i < this.neonBurstParticles.length; i++) {
            const p = this.neonBurstParticles[i];
            if (!particlesByColor[p.color]) {
                particlesByColor[p.color] = [];
            }
            particlesByColor[p.color].push(p);
        }

        for (const color in particlesByColor) {
            const particles = particlesByColor[color];
            ctx.shadowColor = color;

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                ctx.fillStyle = this.getColorWithAlpha(p.color, p.life);
                ctx.shadowBlur = p.glow;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Render electric arcs
        for (let i = 0; i < this.electricArcs.length; i++) {
            const arc = this.electricArcs[i];
            ctx.strokeStyle = this.getColorWithAlpha(arc.color, arc.life);
            ctx.lineWidth = arc.width;
            ctx.shadowBlur = 25;
            ctx.shadowColor = arc.color;
            ctx.beginPath();
            ctx.moveTo(arc.segments[0].x, arc.segments[0].y);
            for (let j = 1; j < arc.segments.length; j++) {
                ctx.lineTo(arc.segments[j].x, arc.segments[j].y);
            }
            ctx.stroke();
        }

        // Render glitch pulses
        for (let i = 0; i < this.glitchPulses.length; i++) {
            const pulse = this.glitchPulses[i];
            const alpha = pulse.life * 0.7;
            ctx.fillStyle = this.getColorWithAlpha(pulse.color, alpha);
            ctx.shadowBlur = 10;
            ctx.shadowColor = pulse.color;
            ctx.fillRect(pulse.x + pulse.offsetX, pulse.y, pulse.width, pulse.height);
        }

        // Render cyber vortexes - optimized to reduce arc() calls
        for (let i = 0; i < this.cyberVortexes.length; i++) {
            const vortex = this.cyberVortexes[i];
            const alpha = vortex.life * 0.78; // 200/255 ≈ 0.78
            ctx.fillStyle = this.getColorWithAlpha(vortex.color, alpha);
            ctx.shadowBlur = 15;
            ctx.shadowColor = vortex.color;

            // Use Path2D for better performance with many particles
            const { particles } = vortex;
            for (let j = 0; j < particles.length; j++) {
                const p = particles[j];
                const x = vortex.x + Math.cos(p.angle) * p.radius;
                const y = vortex.y + Math.sin(p.angle) * p.radius;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Reset shadow
        ctx.shadowBlur = 0;
    }

    stop() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        this.pauseMeteorPool();
        this.stopEffectsLoop();
        super.stop();
    }

    cleanup() {
        this.teardownMeteorPool();
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
            this.effectsCtx = null;
        }
    }

    initializeMeteors(container, meteorCount = 6) {
        this.meteorsContainer = container;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < meteorCount; i++) {
            const meteor = document.createElement('div');
            meteor.className = 'neon-dusk-meteor';
            meteor.style.animation = 'none';
            meteor.style.left = '0';
            meteor.style.top = '0';
            meteor.style.opacity = '0';
            meteor.style.transform = 'translate3d(-9999px, -9999px, 0) rotate(-45deg)';

            this.meteorPool.push({
                element: meteor,
                active: false,
                elapsed: 0,
                duration: this.random(2.2, 3.5),
                delayRemaining: this.random(0.2, 4),
                startX: 0,
                startY: 0,
                distanceX: 0,
                distanceY: 0,
            });

            fragment.appendChild(meteor);
        }

        container.appendChild(fragment);
        this.startMeteorLoop();
    }

    resumeMeteorPool() {
        this.meteorPool.forEach((meteor) => {
            meteor.active = false;
            meteor.elapsed = 0;
            meteor.delayRemaining = this.random(0.3, 3.5);
            meteor.element.style.opacity = '0';
            meteor.element.style.transform = 'translate3d(-9999px, -9999px, 0) rotate(-45deg)';
        });
        this.startMeteorLoop();
    }

    pauseMeteorPool() {
        this.stopMeteorLoop();
        this.meteorPool.forEach((meteor) => {
            meteor.active = false;
            meteor.elapsed = 0;
            meteor.delayRemaining = this.random(1, 4);
            meteor.element.style.opacity = '0';
        });
    }

    teardownMeteorPool() {
        this.stopMeteorLoop();
        if (!this.meteorPool.length) {
            return;
        }

        if (this.meteorsContainer) {
            this.meteorsContainer.textContent = '';
        }

        this.meteorPool = [];
        this.meteorsContainer = null;
    }

    startMeteorLoop() {
        if (this.meteorAnimationFrame || !this.meteorsContainer) {
            return;
        }

        const tick = (timestamp) => {
            if (!this.meteorAnimationFrame) {
                return;
            }

            if (!this.lastMeteorFrameTime) {
                this.lastMeteorFrameTime = timestamp;
            }

            const delta = Math.min((timestamp - this.lastMeteorFrameTime) / 1000, 0.1);
            this.lastMeteorFrameTime = timestamp;

            if (!this.isActive) {
                this.stopMeteorLoop();
                return;
            }

            this.updateMeteors(delta);
            this.meteorAnimationFrame = requestAnimationFrame(tick);
        };

        this.lastMeteorFrameTime = 0;
        this.meteorAnimationFrame = requestAnimationFrame(tick);
    }

    stopMeteorLoop() {
        if (this.meteorAnimationFrame) {
            cancelAnimationFrame(this.meteorAnimationFrame);
            this.meteorAnimationFrame = null;
        }
        this.lastMeteorFrameTime = 0;
    }

    updateMeteors(delta) {
        this.meteorPool.forEach((meteor) => {
            if (!meteor.active) {
                meteor.delayRemaining -= delta;
                if (meteor.delayRemaining <= 0) {
                    this.activateMeteor(meteor);
                }
                return;
            }

            meteor.elapsed += delta;
            const progress = meteor.elapsed / meteor.duration;

            if (progress >= 1) {
                this.resetMeteor(meteor);
                return;
            }

            const translateX = meteor.startX + meteor.distanceX * progress;
            const translateY = meteor.startY + meteor.distanceY * progress;
            meteor.element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(-45deg)`;
            meteor.element.style.opacity = `${this.computeMeteorOpacity(progress)}`;
        });
    }

    activateMeteor(meteor) {
        if (!this.meteorsContainer) {
            return;
        }

        const width = this.meteorsContainer.offsetWidth || window.innerWidth;
        const height = this.meteorsContainer.offsetHeight || window.innerHeight;
        const startX = this.random(-0.15 * width, width * 0.4);
        const startY = this.random(0, height * 0.6);
        const travelDistance = Math.max(width, height) * this.random(0.9, 1.4);

        meteor.active = true;
        meteor.elapsed = 0;
        meteor.duration = this.random(2.2, 3.6);
        meteor.startX = startX;
        meteor.startY = startY;
        meteor.distanceX = travelDistance;
        meteor.distanceY = travelDistance;
        meteor.element.style.opacity = '0';
        meteor.element.style.transform = `translate3d(${startX}px, ${startY}px, 0) rotate(-45deg)`;
    }

    resetMeteor(meteor) {
        meteor.active = false;
        meteor.elapsed = 0;
        meteor.delayRemaining = this.random(1.2, 4.2);
        meteor.element.style.opacity = '0';
    }

    computeMeteorOpacity(progress) {
        if (progress <= 0.1) {
            return progress / 0.1; // Fade in to 1 by 10%
        }

        if (progress >= 0.9) {
            return ((1 - progress) / 0.1) * 0.5; // 90% -> 0.5, 100% -> 0
        }

        const normalized = (progress - 0.1) / 0.8; // 0 at 10%, 1 at 90%
        return 1 - normalized * 0.5;
    }

    /**
     * Provide neon-themed tetromino styling so blocks match the skyline palette
     * @returns {Object} Neon Dusk tetromino configuration
     */
    getTetrominoConfig() {
        return NEON_DUSK_TETROMINOS;
    }
}

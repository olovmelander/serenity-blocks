import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { ASTRAL_WEAVE_TETROMINOS } from './astral-weave-tetrominos.js';

/**
 * Astral Weave Theme - Enhanced Cosmic Tapestry
 * 
 * A breathtaking visualization of cosmic threads weaving through space.
 * Features:
 * - Deep space nebula background with animated color shifts
 * - Luminous weaving threads with multi-layer glow
 * - Ambient star field with twinkling
 * - Cosmic fog/mist layers
 * - Energy pulses and cosmic orbs
 * - Constellation formations
 * - Warp point vortexes
 * - Piece lock effects (thread pulses, mini sparkles)
 */
export default class AstralWeaveTheme extends BaseTheme {
    constructor() {
        super('astral-weave');

        this.tetrominoConfig = ASTRAL_WEAVE_TETROMINOS;

        this.canvas = null;
        this.ctx = null;
        this.resizeHandler = null;
        this.time = 0;

        // Visual elements
        this.threads = [];
        this.particles = [];
        this.rifts = [];
        this.energyPulses = [];
        this.energyBeams = [];
        this.cosmicOrbs = [];
        this.constellations = [];
        this.warpPoints = [];
        this.stardust = [];
        this.backgroundStars = [];
        this.nebulaClouds = [];
        this.fogLayers = [];

        // State
        this.comboIntensity = 0;
        this.weaveSpeed = 1.0;
        this.riftOpenness = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.backgroundHue = 0;
        this.nebulaPhase = 0;

        // Color palette - Enhanced ethereal colors
        this.colorPalette = {
            primary: ['#00ffff', '#00e5ff', '#00d4ff'],      // Cyans
            secondary: ['#ff00ff', '#e040fb', '#d500f9'],    // Magentas
            accent: ['#ffd700', '#ffab00', '#ff6d00'],       // Golds/Ambers
            aurora: ['#00ff88', '#00e676', '#69f0ae'],       // Greens
            cosmic: ['#7c4dff', '#651fff', '#6200ea'],       // Deep purples
        };

        // Performance limits
        this.MAX_PARTICLES = 100;
        this.MAX_THREADS = 12;
        this.MAX_PULSES = 5;
        this.MAX_BEAMS = 8;
        this.MAX_ORBS = 12;
        this.MAX_CONSTELLATIONS = 3;
        this.MAX_WARP_POINTS = 4;
        this.MAX_STARDUST = 150;

        // Quality presets - Enhanced with atmosphere controls
        this.qualityPresets = {
            Minimal: {
                threads: 4,
                particles: 20,
                resolution: 0.4,
                maxBeams: 2,
                maxOrbs: 3,
                maxConstellations: 0,
                maxWarpPoints: 1,
                maxStardust: 25,
                maxPulses: 2,
                backgroundStars: 40,
                nebulaClouds: 0,
                fogLayers: 0,
                enableScreenShake: false,
                enableTrails: false,
                enableThreadGlow: false,
                enableParticleGlow: false,
                enableRiftEffect: false,
                enableNebula: false,
                enableFog: false,
                enablePieceLockEffects: false,
                stardustSpawnRate: 0.06,
                particleBurstMultiplier: 0.4,
                threadThickness: 1.0,
                threadGlowLayers: 0,
                pulseWidth: 2,
                beamWidth: 1.5,
                orbTrailLength: 0,
                constellationStars: 4,
            },
            Low: {
                threads: 6,
                particles: 40,
                resolution: 0.5,
                maxBeams: 3,
                maxOrbs: 5,
                maxConstellations: 1,
                maxWarpPoints: 1,
                maxStardust: 50,
                maxPulses: 3,
                backgroundStars: 60,
                nebulaClouds: 2,
                fogLayers: 1,
                enableScreenShake: false,
                enableTrails: false,
                enableThreadGlow: true,
                enableParticleGlow: false,
                enableRiftEffect: true,
                enableNebula: true,
                enableFog: false,
                enablePieceLockEffects: true,
                stardustSpawnRate: 0.1,
                particleBurstMultiplier: 0.6,
                threadThickness: 1.2,
                threadGlowLayers: 1,
                pulseWidth: 3,
                beamWidth: 2,
                orbTrailLength: 4,
                constellationStars: 5,
            },
            Medium: {
                threads: 10,
                particles: 70,
                resolution: 0.75,
                maxBeams: 5,
                maxOrbs: 8,
                maxConstellations: 2,
                maxWarpPoints: 2,
                maxStardust: 80,
                maxPulses: 4,
                backgroundStars: 100,
                nebulaClouds: 3,
                fogLayers: 2,
                enableScreenShake: true,
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                enableNebula: true,
                enableFog: true,
                enablePieceLockEffects: true,
                stardustSpawnRate: 0.15,
                particleBurstMultiplier: 0.8,
                threadThickness: 1.4,
                threadGlowLayers: 2,
                pulseWidth: 4,
                beamWidth: 2.5,
                orbTrailLength: 6,
                constellationStars: 6,
            },
            High: {
                threads: 14,
                particles: 100,
                resolution: 1.0,
                maxBeams: 7,
                maxOrbs: 10,
                maxConstellations: 3,
                maxWarpPoints: 3,
                maxStardust: 120,
                maxPulses: 5,
                backgroundStars: 150,
                nebulaClouds: 4,
                fogLayers: 3,
                enableScreenShake: true,
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                enableNebula: true,
                enableFog: true,
                enablePieceLockEffects: true,
                stardustSpawnRate: 0.2,
                particleBurstMultiplier: 1.0,
                threadThickness: 1.6,
                threadGlowLayers: 3,
                pulseWidth: 5,
                beamWidth: 3,
                orbTrailLength: 10,
                constellationStars: 7,
            },
            Ultra: {
                threads: 18,
                particles: 140,
                resolution: 1.0,
                maxBeams: 9,
                maxOrbs: 13,
                maxConstellations: 3,
                maxWarpPoints: 4,
                maxStardust: 150,
                maxPulses: 6,
                backgroundStars: 200,
                nebulaClouds: 5,
                fogLayers: 3,
                enableScreenShake: true,
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                enableNebula: true,
                enableFog: true,
                enablePieceLockEffects: true,
                stardustSpawnRate: 0.25,
                particleBurstMultiplier: 1.1,
                threadThickness: 1.8,
                threadGlowLayers: 4,
                pulseWidth: 6,
                beamWidth: 3.5,
                orbTrailLength: 12,
                constellationStars: 8,
            },
            Extreme: {
                threads: 22,
                particles: 180,
                resolution: 1.0,
                maxBeams: 11,
                maxOrbs: 15,
                maxConstellations: 4,
                maxWarpPoints: 5,
                maxStardust: 180,
                maxPulses: 7,
                backgroundStars: 300,
                nebulaClouds: 6,
                fogLayers: 4,
                enableScreenShake: true,
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                enableNebula: true,
                enableFog: true,
                enablePieceLockEffects: true,
                stardustSpawnRate: 0.3,
                particleBurstMultiplier: 1.2,
                threadThickness: 2.0,
                threadGlowLayers: 4,
                pulseWidth: 7,
                beamWidth: 4,
                orbTrailLength: 15,
                constellationStars: 9,
            },
        };
        this.activePreset = this.qualityPresets.High;
        this.currentQuality = 'High';

        // Event handling
        this.eventUnsubscribers = [];
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[Astral Weave] Unknown quality preset: ${quality}, using High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // Update max limits
        this.MAX_PARTICLES = this.activePreset.particles;
        this.MAX_THREADS = this.activePreset.threads;
        this.MAX_PULSES = this.activePreset.maxPulses;
        this.MAX_BEAMS = this.activePreset.maxBeams;
        this.MAX_ORBS = this.activePreset.maxOrbs;
        this.MAX_CONSTELLATIONS = this.activePreset.maxConstellations;
        this.MAX_WARP_POINTS = this.activePreset.maxWarpPoints;
        this.MAX_STARDUST = this.activePreset.maxStardust;

        console.log(`✨ [Astral Weave] Applied ${quality} quality preset`);
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.qualityChangeHandler = (event) => {
            if (event.detail && event.detail.effectQuality) {
                const newQuality = event.detail.effectQuality;
                this.applyQualityPreset(newQuality);

                if (this.canvas) {
                    this.threads = [];
                    this.initThreads();
                    this.initBackgroundStars();
                    this.initNebulaClouds();
                    this.initFogLayers();

                    // Trim arrays
                    this.particles = this.particles.slice(0, this.MAX_PARTICLES);
                    this.energyPulses = this.energyPulses.slice(0, this.MAX_PULSES);
                    this.energyBeams = this.energyBeams.slice(0, this.MAX_BEAMS);
                    this.cosmicOrbs = this.cosmicOrbs.slice(0, this.MAX_ORBS);
                    this.constellations = this.constellations.slice(0, this.MAX_CONSTELLATIONS);
                    this.warpPoints = this.warpPoints.slice(0, this.MAX_WARP_POINTS);
                    this.stardust = this.stardust.slice(0, this.MAX_STARDUST);
                }
            }
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    async createScene() {
        let container = document.getElementById('astral-weave-theme');
        if (!container) {
            container = document.createElement('div');
            container.id = 'astral-weave-theme';
            container.className = 'theme-container';
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 0.5s ease-in-out',
            });

            this.canvas = document.createElement('canvas');
            this.canvas.id = 'astral-weave-canvas';
            Object.assign(this.canvas.style, {
                display: 'block',
                width: '100%',
                height: '100%',
            });

            container.appendChild(this.canvas);
            document.body.appendChild(container);
            this.registerContainer(container);

            container.offsetHeight;
            container.classList.add('active');
            container.style.opacity = '1';
        } else {
            this.canvas = document.getElementById('astral-weave-canvas');
        }

        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        this.initBackgroundStars();
        this.initNebulaClouds();
        this.initFogLayers();
        this.initThreads();
        this.initParticles();
        this.setupEventListeners();
        this.setupQualityListener();

        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Reinitialize background elements on resize
        if (this.backgroundStars.length > 0) {
            this.initBackgroundStars();
            this.initNebulaClouds();
        }
    }

    initBackgroundStars() {
        this.backgroundStars = [];
        const count = this.activePreset.backgroundStars;
        
        for (let i = 0; i < count; i++) {
            this.backgroundStars.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: Math.random() * 1.8 + 0.3,
                brightness: Math.random() * 0.6 + 0.4,
                twinkleSpeed: Math.random() * 0.03 + 0.01,
                twinklePhase: Math.random() * Math.PI * 2,
                color: this.getRandomStarColor(),
            });
        }
    }

    getRandomStarColor() {
        const rand = Math.random();
        if (rand < 0.6) return '#ffffff';
        if (rand < 0.75) return '#e0f0ff';
        if (rand < 0.85) return '#ffe8d0';
        if (rand < 0.92) return '#d0e8ff';
        return '#ffd0e0';
    }

    initNebulaClouds() {
        this.nebulaClouds = [];
        if (!this.activePreset.enableNebula) return;
        
        const count = this.activePreset.nebulaClouds;
        const colors = [
            { r: 80, g: 0, b: 120 },   // Purple
            { r: 0, g: 60, b: 100 },   // Deep blue
            { r: 100, g: 0, b: 80 },   // Magenta
            { r: 0, g: 80, b: 80 },    // Teal
            { r: 60, g: 20, b: 100 },  // Violet
            { r: 20, g: 40, b: 80 },   // Navy
        ];
        
        for (let i = 0; i < count; i++) {
            const color = colors[i % colors.length];
            this.nebulaClouds.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                radius: Math.random() * 300 + 200,
                color,
                alpha: Math.random() * 0.15 + 0.05,
                driftX: (Math.random() - 0.5) * 0.2,
                driftY: (Math.random() - 0.5) * 0.1,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.005 + 0.002,
            });
        }
    }

    initFogLayers() {
        this.fogLayers = [];
        if (!this.activePreset.enableFog) return;
        
        const count = this.activePreset.fogLayers;
        for (let i = 0; i < count; i++) {
            this.fogLayers.push({
                y: this.canvas.height * (0.3 + i * 0.2),
                height: Math.random() * 150 + 100,
                alpha: Math.random() * 0.08 + 0.03,
                speed: Math.random() * 0.3 + 0.1,
                offset: Math.random() * 1000,
            });
        }
    }

    initThreads() {
        this.threads = [];
        const count = this.activePreset.threads;
        const baseThickness = this.activePreset.threadThickness;

        // Enhanced thread colors with gradients
        const threadColors = [
            { main: '#00ffff', glow: '#00e5ff' },
            { main: '#ff00ff', glow: '#e040fb' },
            { main: '#7c4dff', glow: '#651fff' },
            { main: '#00ff88', glow: '#00e676' },
            { main: '#ffd700', glow: '#ffab00' },
        ];

        for (let i = 0; i < count; i++) {
            const colorSet = threadColors[i % threadColors.length];
            this.threads.push({
                y: Math.random() * this.canvas.height,
                amplitude: Math.random() * 120 + 40,
                frequency: Math.random() * 0.008 + 0.003,
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.003 + 0.001,
                color: colorSet.main,
                glowColor: colorSet.glow,
                thickness: baseThickness * (Math.random() * 0.5 + 0.75),
                alpha: Math.random() * 0.4 + 0.15,
                waveOffset: Math.random() * 100,
            });
        }
    }

    initParticles() {
        this.particles = [];
        const count = this.activePreset.particles;
        for (let i = 0; i < count; i++) {
            this.particles.push(this.createParticle());
        }
    }

    createParticle() {
        const colors = ['#00ffff', '#ff00ff', '#7c4dff', '#00ff88', '#ffd700'];
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            size: Math.random() * 2.5 + 0.5,
            alpha: Math.random() * 0.6 + 0.2,
            life: Math.random() * 0.5 + 0.5,
            decay: Math.random() * 0.004 + 0.001,
            color: colors[Math.floor(Math.random() * colors.length)],
            trail: [],
        };
    }

    createEnergyBeam(x, y, targetX, targetY) {
        const colors = ['#00ffff', '#ff00ff', '#7c4dff'];
        return {
            x,
            y,
            targetX,
            targetY,
            progress: 0,
            life: 1.0,
            width: Math.random() * 4 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            particles: [],
        };
    }

    createCosmicOrb(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 2;
        const colors = ['#00ffff', '#ff00ff', '#ffd700', '#00ff88'];
        return {
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 8 + 4,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            trail: [],
        };
    }

    createWarpPoint(x, y) {
        return {
            x,
            y,
            radius: 0,
            maxRadius: Math.random() * 180 + 120,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.06,
            life: 1.0,
            particles: [],
            color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff',
        };
    }

    createConstellation() {
        const centerX = Math.random() * this.canvas.width;
        const centerY = Math.random() * this.canvas.height;
        const stars = [];
        const starCount = this.activePreset.constellationStars;
        const colors = ['#00ffff', '#ff00ff', '#ffffff', '#ffd700'];

        for (let i = 0; i < starCount; i++) {
            const angle = (Math.PI * 2 / starCount) * i + Math.random() * 0.5;
            const distance = Math.random() * 120 + 60;
            stars.push({
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
                size: Math.random() * 4 + 1.5,
                brightness: Math.random() * 0.5 + 0.5,
                color: colors[Math.floor(Math.random() * colors.length)],
            });
        }

        return {
            stars,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
        };
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
    }

    handleLineClear(data) {
        const count = data.lineCount || 1;
        const combo = data.comboCount || 0;
        this.comboIntensity += count * 0.25;
        this.weaveSpeed = 1.0 + this.comboIntensity;

        // Spawn effects at random screen locations
        const numSpawnPoints = Math.min(count + 1, 4);
        const spawnPoints = [];
        for (let i = 0; i < numSpawnPoints; i++) {
            spawnPoints.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
            });
        }

        // Particle burst
        const particlesPerSpawn = Math.floor(count * 6 * this.activePreset.particleBurstMultiplier);
        spawnPoints.forEach((spawn) => {
            for (let i = 0; i < particlesPerSpawn; i++) {
                if (this.particles.length < this.MAX_PARTICLES * 1.5) {
                    this.particles.push({
                        ...this.createParticle(),
                        x: spawn.x,
                        y: spawn.y,
                        vx: (Math.random() - 0.5) * 14,
                        vy: (Math.random() - 0.5) * 14,
                        life: 1.0,
                        alpha: 0.9,
                    });
                }
            }
        });

        // Energy pulses
        spawnPoints.forEach((spawn, index) => {
            if (this.energyPulses.length < this.MAX_PULSES) {
                const colors = ['#00ffff', '#ff00ff', '#ffd700', '#7c4dff'];
                this.energyPulses.push({
                    x: spawn.x,
                    y: spawn.y,
                    radius: 0,
                    maxRadius: 350 + count * 60,
                    alpha: 0.8,
                    color: count >= 4 ? '#ffd700' : colors[index % colors.length],
                });
            }
        });

        // Energy beams
        if (count >= 2 && this.energyBeams.length < this.activePreset.maxBeams) {
            for (let i = 0; i < Math.min(count, 4); i++) {
                const startX = Math.random() * this.canvas.width;
                const startY = Math.random() * this.canvas.height;
                const endX = Math.random() * this.canvas.width;
                const endY = Math.random() * this.canvas.height;
                this.energyBeams.push(this.createEnergyBeam(startX, startY, endX, endY));
            }
        }

        // Cosmic orbs
        if (count >= 2 && this.cosmicOrbs.length < this.activePreset.maxOrbs) {
            spawnPoints.forEach((spawn) => {
                this.cosmicOrbs.push(this.createCosmicOrb(spawn.x, spawn.y));
            });
        }

        // Warp points for big clears
        if (count >= 3 && this.warpPoints.length < this.activePreset.maxWarpPoints) {
            const warpX = Math.random() * this.canvas.width;
            const warpY = Math.random() * this.canvas.height;
            this.warpPoints.push(this.createWarpPoint(warpX, warpY));
        }

        // Screen shake
        if (this.activePreset.enableScreenShake && combo >= 3) {
            this.screenShake.intensity = Math.min(combo * 2.5, 15);
        }
    }

    handleCombo(data) {
        const combo = data.comboCount || 0;
        this.comboIntensity += combo * 0.12;
        this.riftOpenness = Math.min(1.0, combo * 0.18);

        // Constellations for big combos
        if (combo >= 5 && this.constellations.length < this.activePreset.maxConstellations) {
            this.constellations.push(this.createConstellation());
        }

        // Extra warp point for massive combos
        if (combo >= 7 && this.warpPoints.length < this.activePreset.maxWarpPoints) {
            const warpX = Math.random() * this.canvas.width;
            const warpY = Math.random() * this.canvas.height;
            this.warpPoints.push(this.createWarpPoint(warpX, warpY));
        }
    }

    handlePieceLock() {
        if (!this.activePreset.enablePieceLockEffects) return;

        // Subtle thread pulse
        this.threads.forEach(thread => {
            thread.alpha = Math.min(thread.alpha + 0.08, 0.6);
        });

        // Spawn a few sparkle particles
        if (Math.random() < 0.4) {
            const sparkleCount = Math.floor(Math.random() * 3) + 1;
            for (let i = 0; i < sparkleCount; i++) {
                if (this.stardust.length < this.MAX_STARDUST) {
                    this.stardust.push({
                        x: Math.random() * this.canvas.width,
                        y: Math.random() * this.canvas.height,
                        vx: (Math.random() - 0.5) * 0.5,
                        vy: (Math.random() - 0.5) * 0.5,
                        size: Math.random() * 2 + 1,
                        alpha: 0.8,
                        life: 0.8,
                        twinkle: Math.random() * Math.PI * 2,
                    });
                }
            }
        }
    }

    update() {
        this.time++;
        this.backgroundHue = (this.backgroundHue + 0.05) % 360;
        this.nebulaPhase += 0.002;

        // Decay intensity
        this.comboIntensity *= 0.97;
        this.weaveSpeed = 1.0 + this.comboIntensity * 2;
        this.riftOpenness *= 0.98;

        // Thread alpha decay back to normal
        this.threads.forEach(thread => {
            thread.alpha *= 0.995;
            if (thread.alpha < 0.15) thread.alpha = 0.15;
        });

        // Screen shake
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.intensity *= 0.88;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        // Update nebula clouds
        this.nebulaClouds.forEach(cloud => {
            cloud.x += cloud.driftX;
            cloud.y += cloud.driftY;
            cloud.pulsePhase += cloud.pulseSpeed;
            
            // Wrap around screen
            if (cloud.x < -cloud.radius) cloud.x = this.canvas.width + cloud.radius;
            if (cloud.x > this.canvas.width + cloud.radius) cloud.x = -cloud.radius;
            if (cloud.y < -cloud.radius) cloud.y = this.canvas.height + cloud.radius;
            if (cloud.y > this.canvas.height + cloud.radius) cloud.y = -cloud.radius;
        });

        // Update background stars twinkling
        this.backgroundStars.forEach(star => {
            star.twinklePhase += star.twinkleSpeed;
        });

        // Spawn stardust
        if (Math.random() < this.activePreset.stardustSpawnRate && this.stardust.length < this.MAX_STARDUST) {
            this.stardust.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 1.5 + 0.3,
                alpha: Math.random() * 0.5 + 0.3,
                life: 1.0,
                twinkle: Math.random() * Math.PI * 2,
            });
        }

        // Update threads
        this.threads.forEach((thread) => {
            thread.phase += thread.speed * this.weaveSpeed;
        });

        // Update particles with trails
        this.particles.forEach((p, index) => {
            if (this.activePreset.enableTrails) {
                p.trail.unshift({ x: p.x, y: p.y, alpha: p.alpha });
                if (p.trail.length > 8) p.trail.pop();
            }

            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            p.vx *= 0.98;
            p.vy *= 0.98;

            if (p.life <= 0) {
                this.particles[index] = this.createParticle();
            }
        });

        // Update stardust
        for (let i = this.stardust.length - 1; i >= 0; i--) {
            const dust = this.stardust[i];
            dust.x += dust.vx;
            dust.y += dust.vy;
            dust.life -= 0.008;
            dust.twinkle += 0.12;

            if (dust.life <= 0) {
                this.stardust.splice(i, 1);
            }
        }

        // Update pulses
        for (let i = this.energyPulses.length - 1; i >= 0; i--) {
            const pulse = this.energyPulses[i];
            pulse.radius += 12 + this.comboIntensity * 6;
            pulse.alpha -= 0.012;
            if (pulse.alpha <= 0 || pulse.radius > pulse.maxRadius) {
                this.energyPulses.splice(i, 1);
            }
        }

        // Update energy beams
        for (let i = this.energyBeams.length - 1; i >= 0; i--) {
            const beam = this.energyBeams[i];
            beam.progress += 0.04;
            beam.life -= 0.015;

            if (beam.life <= 0 || beam.progress >= 1) {
                this.energyBeams.splice(i, 1);
            }
        }

        // Update cosmic orbs
        for (let i = this.cosmicOrbs.length - 1; i >= 0; i--) {
            const orb = this.cosmicOrbs[i];

            if (this.activePreset.enableTrails && this.activePreset.orbTrailLength > 0) {
                orb.trail.unshift({ x: orb.x, y: orb.y, size: orb.size });
                if (orb.trail.length > this.activePreset.orbTrailLength) orb.trail.pop();
            }

            orb.x += orb.vx;
            orb.y += orb.vy;
            orb.vx *= 0.97;
            orb.vy *= 0.97;
            orb.life -= 0.006;
            orb.pulsePhase += 0.1;

            if (orb.life <= 0 || orb.x < -50 || orb.x > this.canvas.width + 50
                || orb.y < -50 || orb.y > this.canvas.height + 50) {
                this.cosmicOrbs.splice(i, 1);
            }
        }

        // Update warp points
        for (let i = this.warpPoints.length - 1; i >= 0; i--) {
            const warp = this.warpPoints[i];
            warp.radius += 5;
            warp.rotation += warp.rotationSpeed;
            warp.life -= 0.004;

            // Spawn particles from warp point
            if (Math.random() < 0.5 && warp.particles.length < 35) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 4 + 1;
                warp.particles.push({
                    x: warp.x,
                    y: warp.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: Math.random() * 2.5 + 0.5,
                    life: 1.0,
                    alpha: 0.9,
                });
            }

            // Update warp particles
            for (let j = warp.particles.length - 1; j >= 0; j--) {
                const p = warp.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                p.alpha = p.life * 0.9;

                if (p.life <= 0) {
                    warp.particles.splice(j, 1);
                }
            }

            if (warp.life <= 0 || warp.radius > warp.maxRadius) {
                this.warpPoints.splice(i, 1);
            }
        }

        // Update constellations
        for (let i = this.constellations.length - 1; i >= 0; i--) {
            const constellation = this.constellations[i];
            constellation.life -= 0.002;
            constellation.pulsePhase += 0.05;

            if (constellation.life <= 0) {
                this.constellations.splice(i, 1);
            }
        }
    }

    draw() {
        if (!this.ctx) return;

        this.ctx.save();
        this.ctx.translate(this.screenShake.x, this.screenShake.y);

        // Draw animated background gradient
        this.drawBackground();

        // Draw nebula clouds
        if (this.activePreset.enableNebula) {
            this.drawNebulaClouds();
        }

        // Draw background stars
        this.drawBackgroundStars();

        // Draw fog layers
        if (this.activePreset.enableFog) {
            this.drawFogLayers();
        }

        // Draw stardust
        this.ctx.globalCompositeOperation = 'lighter';
        this.stardust.forEach((dust) => {
            const twinkle = Math.sin(dust.twinkle) * 0.4 + 0.6;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = dust.alpha * dust.life * twinkle;
            this.ctx.beginPath();
            this.ctx.arc(dust.x, dust.y, dust.size, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Draw Rift (Center Glow)
        if (this.activePreset.enableRiftEffect && this.riftOpenness > 0.01) {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            const riftGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.canvas.width * 0.5 * this.riftOpenness);
            riftGradient.addColorStop(0, `rgba(255, 255, 255, ${this.riftOpenness * 0.7})`);
            riftGradient.addColorStop(0.2, `rgba(0, 255, 255, ${this.riftOpenness * 0.4})`);
            riftGradient.addColorStop(0.5, `rgba(255, 0, 255, ${this.riftOpenness * 0.2})`);
            riftGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = riftGradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Draw constellations
        this.drawConstellations();

        // Draw warp points
        this.drawWarpPoints();

        // Draw energy beams
        this.drawEnergyBeams();

        // Draw threads
        this.drawThreads();

        // Draw energy pulses
        this.drawEnergyPulses();

        // Draw cosmic orbs
        this.drawCosmicOrbs();

        // Draw particles
        this.drawParticles();

        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1.0;
        this.ctx.restore();
    }

    drawBackground() {
        // Animated multi-layer gradient
        const hueShift = Math.sin(this.time * 0.0008) * 10;
        
        const bgGradient = this.ctx.createRadialGradient(
            this.canvas.width * 0.3,
            this.canvas.height * 0.3,
            0,
            this.canvas.width * 0.5,
            this.canvas.height * 0.5,
            this.canvas.width * 0.8
        );
        
        bgGradient.addColorStop(0, `hsl(${260 + hueShift}, 80%, 8%)`);
        bgGradient.addColorStop(0.3, `hsl(${270 + hueShift}, 70%, 6%)`);
        bgGradient.addColorStop(0.6, `hsl(${280 + hueShift}, 60%, 4%)`);
        bgGradient.addColorStop(1, `hsl(${290 + hueShift}, 50%, 2%)`);
        
        this.ctx.fillStyle = bgGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Secondary gradient for depth
        const secondaryGradient = this.ctx.createRadialGradient(
            this.canvas.width * 0.8,
            this.canvas.height * 0.7,
            0,
            this.canvas.width * 0.8,
            this.canvas.height * 0.7,
            this.canvas.width * 0.5
        );
        
        secondaryGradient.addColorStop(0, `hsla(${200 + hueShift}, 60%, 15%, 0.15)`);
        secondaryGradient.addColorStop(0.5, `hsla(${220 + hueShift}, 50%, 10%, 0.1)`);
        secondaryGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        this.ctx.fillStyle = secondaryGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawNebulaClouds() {
        this.nebulaClouds.forEach(cloud => {
            const pulse = Math.sin(cloud.pulsePhase) * 0.3 + 0.7;
            const gradient = this.ctx.createRadialGradient(
                cloud.x, cloud.y, 0,
                cloud.x, cloud.y, cloud.radius
            );
            
            const { r, g, b } = cloud.color;
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${cloud.alpha * pulse})`);
            gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${cloud.alpha * pulse * 0.5})`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(
                cloud.x - cloud.radius,
                cloud.y - cloud.radius,
                cloud.radius * 2,
                cloud.radius * 2
            );
        });
    }

    drawBackgroundStars() {
        this.backgroundStars.forEach(star => {
            const twinkle = Math.sin(star.twinklePhase) * 0.3 + 0.7;
            this.ctx.fillStyle = star.color;
            this.ctx.globalAlpha = star.brightness * twinkle;
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1;
    }

    drawFogLayers() {
        this.fogLayers.forEach(fog => {
            const offset = (this.time * fog.speed + fog.offset) % (this.canvas.width * 2);
            
            const gradient = this.ctx.createLinearGradient(
                0, fog.y - fog.height / 2,
                0, fog.y + fog.height / 2
            );
            gradient.addColorStop(0, 'rgba(60, 30, 90, 0)');
            gradient.addColorStop(0.5, `rgba(60, 30, 90, ${fog.alpha})`);
            gradient.addColorStop(1, 'rgba(60, 30, 90, 0)');
            
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(-offset, fog.y - fog.height / 2, this.canvas.width * 3, fog.height);
        });
    }

    drawConstellations() {
        this.constellations.forEach((constellation) => {
            const pulse = Math.sin(constellation.pulsePhase) * 0.3 + 0.7;
            this.ctx.globalAlpha = constellation.life * pulse;

            // Draw connecting lines
            this.ctx.strokeStyle = '#00ffff';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            for (let i = 0; i < constellation.stars.length; i++) {
                const star = constellation.stars[i];
                if (i === 0) {
                    this.ctx.moveTo(star.x, star.y);
                } else {
                    this.ctx.lineTo(star.x, star.y);
                }
            }
            this.ctx.closePath();
            this.ctx.stroke();

            // Draw stars with glow
            constellation.stars.forEach((star) => {
                const starGlow = this.ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.size * 4);
                starGlow.addColorStop(0, `rgba(255, 255, 255, ${star.brightness})`);
                starGlow.addColorStop(0.3, `${star.color}${Math.floor(star.brightness * 180).toString(16).padStart(2, '0')}`);
                starGlow.addColorStop(1, `${star.color}00`);

                this.ctx.fillStyle = starGlow;
                this.ctx.beginPath();
                this.ctx.arc(star.x, star.y, star.size * 4, 0, Math.PI * 2);
                this.ctx.fill();
            });
        });
    }

    drawWarpPoints() {
        this.warpPoints.forEach((warp) => {
            this.ctx.save();
            this.ctx.translate(warp.x, warp.y);
            this.ctx.rotate(warp.rotation);

            // Draw spiraling energy arcs
            for (let i = 0; i < 4; i++) {
                const angle = (Math.PI * 2 / 4) * i + warp.rotation * 2;
                const spiralRadius = warp.radius * 0.7;

                const arcColor = i % 2 === 0 ? warp.color : (warp.color === '#00ffff' ? '#ff00ff' : '#00ffff');
                this.ctx.strokeStyle = arcColor;
                this.ctx.lineWidth = 2.5;
                this.ctx.globalAlpha = warp.life * 0.7;

                this.ctx.beginPath();
                this.ctx.arc(0, 0, spiralRadius, angle, angle + Math.PI * 0.7);
                this.ctx.stroke();
            }

            // Draw center vortex
            const vortexGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, warp.radius * 0.5);
            vortexGradient.addColorStop(0, `rgba(255, 255, 255, ${warp.life * 0.9})`);
            vortexGradient.addColorStop(0.3, `${warp.color}${Math.floor(warp.life * 200).toString(16).padStart(2, '0')}`);
            vortexGradient.addColorStop(1, `${warp.color}00`);

            this.ctx.fillStyle = vortexGradient;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, warp.radius * 0.5, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();

            // Draw warp particles
            warp.particles.forEach((p) => {
                const color = Math.random() > 0.5 ? '#00ffff' : '#ff00ff';
                this.ctx.fillStyle = color;
                this.ctx.globalAlpha = p.alpha;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            });
        });
    }

    drawEnergyBeams() {
        this.energyBeams.forEach((beam) => {
            const currentX = beam.x + (beam.targetX - beam.x) * beam.progress;
            const currentY = beam.y + (beam.targetY - beam.y) * beam.progress;

            // Outer glow
            const beamGradient = this.ctx.createLinearGradient(beam.x, beam.y, currentX, currentY);
            beamGradient.addColorStop(0, `${beam.color}cc`);
            beamGradient.addColorStop(0.5, `${beam.color}88`);
            beamGradient.addColorStop(1, `${beam.color}00`);

            this.ctx.strokeStyle = beamGradient;
            this.ctx.lineWidth = this.activePreset.beamWidth * 3.5;
            this.ctx.globalAlpha = beam.life * 0.35;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(beam.x, beam.y);
            this.ctx.lineTo(currentX, currentY);
            this.ctx.stroke();

            // Core beam
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = this.activePreset.beamWidth;
            this.ctx.globalAlpha = beam.life * 0.85;
            this.ctx.beginPath();
            this.ctx.moveTo(beam.x, beam.y);
            this.ctx.lineTo(currentX, currentY);
            this.ctx.stroke();
        });
    }

    drawThreads() {
        this.threads.forEach((thread) => {
            // Glow layers
            if (this.activePreset.enableThreadGlow) {
                const glowLayers = this.activePreset.threadGlowLayers;
                for (let layer = glowLayers; layer > 0; layer--) {
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = thread.glowColor;
                    this.ctx.lineWidth = thread.thickness * (1 + layer * 2);
                    this.ctx.globalAlpha = (thread.alpha + this.comboIntensity * 0.15) * (0.12 / layer);

                    for (let x = 0; x < this.canvas.width; x += 15) {
                        const y = thread.y + Math.sin(x * thread.frequency + thread.phase) * thread.amplitude;
                        if (x === 0) this.ctx.moveTo(x, y);
                        else this.ctx.lineTo(x, y);
                    }
                    this.ctx.stroke();
                }
            }

            // Core thread
            this.ctx.beginPath();
            this.ctx.strokeStyle = thread.color;
            this.ctx.lineWidth = thread.thickness;
            this.ctx.globalAlpha = thread.alpha + (this.comboIntensity * 0.2);

            for (let x = 0; x < this.canvas.width; x += 15) {
                const y = thread.y + Math.sin(x * thread.frequency + thread.phase) * thread.amplitude;
                if (x === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.stroke();
        });
    }

    drawEnergyPulses() {
        this.energyPulses.forEach((pulse) => {
            // Outer ring glow
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = pulse.color;
            this.ctx.lineWidth = this.activePreset.pulseWidth * 1.5;
            this.ctx.globalAlpha = pulse.alpha * 0.25;
            this.ctx.stroke();

            // Inner ring
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = this.activePreset.pulseWidth * 0.6;
            this.ctx.globalAlpha = pulse.alpha * 0.7;
            this.ctx.stroke();
        });
    }

    drawCosmicOrbs() {
        this.cosmicOrbs.forEach((orb) => {
            const pulse = Math.sin(orb.pulsePhase) * 0.3 + 0.7;

            // Draw trail
            if (this.activePreset.enableTrails) {
                for (let i = 0; i < orb.trail.length; i++) {
                    const trailPoint = orb.trail[i];
                    const trailFade = 1 - (i / orb.trail.length);

                    const trailGradient = this.ctx.createRadialGradient(
                        trailPoint.x, trailPoint.y, 0,
                        trailPoint.x, trailPoint.y, trailPoint.size * 2.5 * trailFade
                    );
                    
                    const alpha = Math.floor(orb.life * trailFade * 150);
                    trailGradient.addColorStop(0, `${orb.color}${alpha.toString(16).padStart(2, '0')}`);
                    trailGradient.addColorStop(1, `${orb.color}00`);

                    this.ctx.fillStyle = trailGradient;
                    this.ctx.beginPath();
                    this.ctx.arc(trailPoint.x, trailPoint.y, trailPoint.size * 2.5 * trailFade, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }

            // Draw outer glow
            const orbGlow = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size * 3.5);
            orbGlow.addColorStop(0, `rgba(255, 255, 255, ${orb.life * pulse})`);
            const alpha = Math.floor(orb.life * pulse * 200);
            orbGlow.addColorStop(0.25, `${orb.color}${alpha.toString(16).padStart(2, '0')}`);
            orbGlow.addColorStop(1, `${orb.color}00`);

            this.ctx.fillStyle = orbGlow;
            this.ctx.globalAlpha = orb.life;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 3.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = orb.life * pulse;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 0.6, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawParticles() {
        this.ctx.globalCompositeOperation = 'lighter';
        
        this.particles.forEach((p) => {
            // Draw trail
            if (this.activePreset.enableTrails && p.trail.length > 1) {
                for (let i = 1; i < p.trail.length; i++) {
                    const trailPoint = p.trail[i];
                    const trailFade = 1 - (i / p.trail.length);
                    this.ctx.fillStyle = p.color;
                    this.ctx.globalAlpha = trailPoint.alpha * p.life * trailFade * 0.4;
                    this.ctx.beginPath();
                    this.ctx.arc(trailPoint.x, trailPoint.y, p.size * trailFade, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }

            // Draw particle glow
            if (this.activePreset.enableParticleGlow) {
                const particleGlow = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.5);
                particleGlow.addColorStop(0, '#ffffff');
                particleGlow.addColorStop(0.4, p.color);
                particleGlow.addColorStop(1, `${p.color}00`);

                this.ctx.fillStyle = particleGlow;
                this.ctx.globalAlpha = p.alpha * p.life;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
                this.ctx.fill();
            } else {
                this.ctx.fillStyle = p.color;
                this.ctx.globalAlpha = p.alpha * p.life;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });
    }

    animate() {
        if (!this.isActive) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }

    cleanup() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        window.removeEventListener('resize', this.resizeHandler);

        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Clear all visual elements
        this.threads = [];
        this.particles = [];
        this.rifts = [];
        this.energyPulses = [];
        this.energyBeams = [];
        this.cosmicOrbs = [];
        this.constellations = [];
        this.warpPoints = [];
        this.stardust = [];
        this.backgroundStars = [];
        this.nebulaClouds = [];
        this.fogLayers = [];

        // Reset state
        this.comboIntensity = 0;
        this.weaveSpeed = 1.0;
        this.riftOpenness = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };

        this.isActive = false;
    }

    getTetrominoConfig() {
        return ASTRAL_WEAVE_TETROMINOS;
    }
}

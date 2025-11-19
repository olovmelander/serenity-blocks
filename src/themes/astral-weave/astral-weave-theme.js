import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { ASTRAL_WEAVE_TETROMINOS } from './astral-weave-tetrominos.js';

export default class AstralWeaveTheme extends BaseTheme {
    constructor() {
        super('astral-weave');
        
        // Set tetromino configuration
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

        // State
        this.comboIntensity = 0;
        this.weaveSpeed = 1.0;
        this.riftOpenness = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };

        // Performance limits
        this.MAX_PARTICLES = 100;
        this.MAX_THREADS = 12;
        this.MAX_PULSES = 5;
        this.MAX_BEAMS = 8;
        this.MAX_ORBS = 12;
        this.MAX_CONSTELLATIONS = 3;
        this.MAX_WARP_POINTS = 4;
        this.MAX_STARDUST = 150;

        // Quality settings - comprehensive control over visual fidelity
        this.qualityPresets = {
            'Minimal': { 
                // Core visuals
                threads: 3, 
                particles: 15, 
                resolution: 0.3,
                // Combo effects
                maxBeams: 2, 
                maxOrbs: 3, 
                maxConstellations: 0, 
                maxWarpPoints: 1,
                maxStardust: 20, 
                maxPulses: 2,
                // Effect toggles
                enableScreenShake: false, 
                enableTrails: false,
                enableThreadGlow: false,
                enableParticleGlow: false,
                enableRiftEffect: false,
                // Spawn rates (0-1 scale)
                stardustSpawnRate: 0.08,
                particleBurstMultiplier: 0.4,
                // Visual quality
                threadThickness: 0.8,
                threadGlowLayers: 0,
                pulseWidth: 2,
                beamWidth: 1.5,
                orbTrailLength: 0,
                constellationStars: 4
            },
            'Low': { 
                threads: 6, 
                particles: 40, 
                resolution: 0.5,
                maxBeams: 3, 
                maxOrbs: 5, 
                maxConstellations: 1, 
                maxWarpPoints: 1,
                maxStardust: 50,
                maxPulses: 3,
                enableScreenShake: false, 
                enableTrails: false,
                enableThreadGlow: true,
                enableParticleGlow: false,
                enableRiftEffect: true,
                stardustSpawnRate: 0.12,
                particleBurstMultiplier: 0.6,
                threadThickness: 1.0,
                threadGlowLayers: 1,
                pulseWidth: 3,
                beamWidth: 2,
                orbTrailLength: 3,
                constellationStars: 5
            },
            'Medium': { 
                threads: 10, 
                particles: 80, 
                resolution: 0.75,
                maxBeams: 5, 
                maxOrbs: 8, 
                maxConstellations: 2, 
                maxWarpPoints: 2,
                maxStardust: 80,
                maxPulses: 4,
                enableScreenShake: true, 
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                stardustSpawnRate: 0.18,
                particleBurstMultiplier: 0.8,
                threadThickness: 1.3,
                threadGlowLayers: 2,
                pulseWidth: 4,
                beamWidth: 2.5,
                orbTrailLength: 6,
                constellationStars: 6
            },
            'High': { 
                threads: 15, 
                particles: 120, 
                resolution: 1.0,
                maxBeams: 7, 
                maxOrbs: 10, 
                maxConstellations: 3, 
                maxWarpPoints: 3,
                maxStardust: 120,
                maxPulses: 5,
                enableScreenShake: true, 
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                stardustSpawnRate: 0.25,
                particleBurstMultiplier: 1.0,
                threadThickness: 1.6,
                threadGlowLayers: 3,
                pulseWidth: 5,
                beamWidth: 3,
                orbTrailLength: 10,
                constellationStars: 7
            },
            'Ultra': { 
                threads: 18, 
                particles: 160, 
                resolution: 1.0,
                maxBeams: 9, 
                maxOrbs: 13, 
                maxConstellations: 3, 
                maxWarpPoints: 4,
                maxStardust: 150,
                maxPulses: 6,
                enableScreenShake: true, 
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                stardustSpawnRate: 0.3,
                particleBurstMultiplier: 1.1,
                threadThickness: 1.8,
                threadGlowLayers: 4,
                pulseWidth: 6,
                beamWidth: 3.5,
                orbTrailLength: 12,
                constellationStars: 8
            },
            'Extreme': { 
                threads: 22, 
                particles: 200, 
                resolution: 1.0,
                maxBeams: 11, 
                maxOrbs: 15, 
                maxConstellations: 4, 
                maxWarpPoints: 5,
                maxStardust: 180,
                maxPulses: 7,
                enableScreenShake: true, 
                enableTrails: true,
                enableThreadGlow: true,
                enableParticleGlow: true,
                enableRiftEffect: true,
                stardustSpawnRate: 0.35,
                particleBurstMultiplier: 1.2,
                threadThickness: 2.0,
                threadGlowLayers: 4,
                pulseWidth: 7,
                beamWidth: 4,
                orbTrailLength: 15,
                constellationStars: 9
            }
        };
        this.activePreset = this.qualityPresets['High'];
        this.currentQuality = 'High';

        // Event handling
        this.eventUnsubscribers = [];
    }

    /**
     * Apply graphics quality preset
     * @param {string} quality - Quality level: 'Minimal', 'Low', 'Medium', 'High', 'Ultra', or 'Extreme'
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[Astral Weave] Unknown quality preset: ${quality}, using High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // Update max limits based on preset
        this.MAX_PARTICLES = this.activePreset.particles;
        this.MAX_THREADS = this.activePreset.threads;
        this.MAX_PULSES = this.activePreset.maxPulses;
        this.MAX_BEAMS = this.activePreset.maxBeams;
        this.MAX_ORBS = this.activePreset.maxOrbs;
        this.MAX_CONSTELLATIONS = this.activePreset.maxConstellations;
        this.MAX_WARP_POINTS = this.activePreset.maxWarpPoints;
        this.MAX_STARDUST = this.activePreset.maxStardust;

        console.log(`✨ [Astral Weave] Applying ${quality} quality preset`, this.activePreset);
    }

    /**
     * Get current graphics quality from settings
     * @returns {string} Quality level
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.qualityChangeHandler = (event) => {
            if (event.detail && event.detail.effectQuality) {
                const newQuality = event.detail.effectQuality;
                console.log(`✨ [Astral Weave] Quality changed to ${newQuality}`);

                // Apply new quality preset
                this.applyQualityPreset(newQuality);

                // Recreate visual elements with new quality
                if (this.canvas) {
                    this.threads = [];
                    this.initThreads();
                    
                    // Trim arrays to new limits
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
        // Dynamic container creation to fix "Theme container not found"
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
                zIndex: '-1', // Behind WebGL layer but visible
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 0.5s ease-in-out'
            });

            this.canvas = document.createElement('canvas');
            this.canvas.id = 'astral-weave-canvas';
            Object.assign(this.canvas.style, {
                display: 'block',
                width: '100%',
                height: '100%'
            });

            container.appendChild(this.canvas);
            document.body.appendChild(container);

            // Register for cleanup
            this.registerContainer(container);

            // Manually activate since BaseTheme missed it
            // Force reflow
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

        // Apply graphics quality preset from settings
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        console.log(`✨ [Astral Weave] Using ${quality} quality preset`);

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
        // Re-init if needed, or just let the loop handle it
    }

    initThreads() {
        this.threads = [];
        const count = this.activePreset.threads;
        const baseThickness = this.activePreset.threadThickness;
        
        for (let i = 0; i < count; i++) {
            this.threads.push({
                y: Math.random() * this.canvas.height,
                amplitude: Math.random() * 100 + 50,
                frequency: Math.random() * 0.01 + 0.005,
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.002 + 0.001,
                color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff', // Cyan or Magenta
                thickness: baseThickness * (Math.random() * 0.5 + 0.75), // Vary from base
                alpha: Math.random() * 0.3 + 0.1
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
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            size: Math.random() * 2 + 0.5,
            alpha: Math.random() * 0.5 + 0.2,
            life: Math.random() * 0.5 + 0.5, // 0.5 to 1.0
            decay: Math.random() * 0.005 + 0.002,
            color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff',
            trail: []
        };
    }

    createEnergyBeam(x, y, targetX, targetY) {
        return {
            x: x,
            y: y,
            targetX: targetX,
            targetY: targetY,
            progress: 0,
            life: 1.0,
            width: Math.random() * 4 + 2,
            color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff',
            particles: []
        };
    }

    createCosmicOrb(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 2;
        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 6 + 3,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            color: Math.random() > 0.5 ? '#00ffff' : '#ff00ff',
            trail: []
        };
    }

    createWarpPoint(x, y) {
        return {
            x: x,
            y: y,
            radius: 0,
            maxRadius: Math.random() * 150 + 100,
            rotation: 0,
            rotationSpeed: (Math.random() - 0.5) * 0.05,
            life: 1.0,
            particles: []
        };
    }

    createConstellation() {
        const centerX = Math.random() * this.canvas.width;
        const centerY = Math.random() * this.canvas.height;
        const stars = [];
        const starCount = this.activePreset.constellationStars;
        
        for (let i = 0; i < starCount; i++) {
            const angle = (Math.PI * 2 / starCount) * i + Math.random() * 0.5;
            const distance = Math.random() * 100 + 50;
            stars.push({
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
                size: Math.random() * 3 + 1,
                brightness: Math.random() * 0.5 + 0.5
            });
        }
        
        return {
            stars: stars,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2
        };
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => this.handleLineClear(data));
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => this.handleCombo(data));
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data) {
        const count = data.lineCount || 1;
        const combo = data.comboCount || 0;
        this.comboIntensity += count * 0.2;
        this.weaveSpeed = 1.0 + this.comboIntensity;

        // Create random spawn points across the screen
        const numSpawnPoints = Math.min(count + 1, 4);
        const spawnPoints = [];
        for (let i = 0; i < numSpawnPoints; i++) {
            spawnPoints.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height
            });
        }

        // Add burst of particles from random locations (quality-scaled)
        const particlesPerSpawn = Math.floor(count * 5 * this.activePreset.particleBurstMultiplier);
        spawnPoints.forEach(spawn => {
            for (let i = 0; i < particlesPerSpawn; i++) {
                this.particles.push({
                    ...this.createParticle(),
                    x: spawn.x,
                    y: spawn.y,
                    vx: (Math.random() - 0.5) * 12,
                    vy: (Math.random() - 0.5) * 12,
                    life: 1.0,
                    alpha: 0.8
                });
            }
        });

        // Add energy pulses at random locations
        spawnPoints.forEach((spawn, index) => {
        if (this.energyPulses.length < this.MAX_PULSES) {
            this.energyPulses.push({
                    x: spawn.x,
                    y: spawn.y,
                radius: 0,
                    maxRadius: 300 + count * 50,
                    alpha: 0.7,
                    color: count >= 4 ? '#ffd700' : (index % 2 === 0 ? '#00ffff' : '#ff00ff')
                });
            }
        });

        // Create energy beams connecting random points
        if (count >= 2 && this.energyBeams.length < this.activePreset.maxBeams) {
            for (let i = 0; i < Math.min(count, 3); i++) {
                const startX = Math.random() * this.canvas.width;
                const startY = Math.random() * this.canvas.height;
                const endX = Math.random() * this.canvas.width;
                const endY = Math.random() * this.canvas.height;
                this.energyBeams.push(this.createEnergyBeam(startX, startY, endX, endY));
            }
        }

        // Create cosmic orbs at random positions
        if (count >= 2 && this.cosmicOrbs.length < this.activePreset.maxOrbs) {
            spawnPoints.forEach(spawn => {
                this.cosmicOrbs.push(this.createCosmicOrb(spawn.x, spawn.y));
            });
        }

        // Create warp points for big clears
        if (count >= 3 && this.warpPoints.length < this.activePreset.maxWarpPoints) {
            const warpX = Math.random() * this.canvas.width;
            const warpY = Math.random() * this.canvas.height;
            this.warpPoints.push(this.createWarpPoint(warpX, warpY));
        }

        // Screen shake for combos
        if (this.activePreset.enableScreenShake && combo >= 3) {
            this.screenShake.intensity = Math.min(combo * 2, 12);
        }
    }

    handleCombo(data) {
        const combo = data.comboCount || 0;
        this.comboIntensity += combo * 0.1;
        this.riftOpenness = Math.min(1.0, combo * 0.15);

        // Create constellations for big combos at random positions
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

    update() {
        this.time++;

        // Decay intensity
        this.comboIntensity *= 0.98;
        this.weaveSpeed = 1.0 + this.comboIntensity * 2;
        this.riftOpenness *= 0.99;

        // Update screen shake
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.intensity *= 0.9;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        // Spawn stardust randomly (quality-scaled spawn rate)
        if (Math.random() < this.activePreset.stardustSpawnRate && this.stardust.length < this.activePreset.maxStardust) {
            this.stardust.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 1.5 + 0.3,
                alpha: Math.random() * 0.4 + 0.2,
                life: 1.0,
                twinkle: Math.random() * Math.PI * 2
            });
        }

        // Update threads
        this.threads.forEach(thread => {
            thread.phase += thread.speed * this.weaveSpeed;
        });

        // Update particles with trails
        this.particles.forEach((p, index) => {
            if (this.activePreset.enableTrails) {
                p.trail.unshift({ x: p.x, y: p.y, alpha: p.alpha });
                if (p.trail.length > 6) p.trail.pop();
            }

            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            p.vx *= 0.99;
            p.vy *= 0.99;

            if (p.life <= 0) {
                this.particles[index] = this.createParticle();
            }
        });

        // Update stardust
        for (let i = this.stardust.length - 1; i >= 0; i--) {
            const dust = this.stardust[i];
            dust.x += dust.vx;
            dust.y += dust.vy;
            dust.life -= 0.01;
            dust.twinkle += 0.1;
            
            if (dust.life <= 0) {
                this.stardust.splice(i, 1);
            }
        }

        // Update pulses
        for (let i = this.energyPulses.length - 1; i >= 0; i--) {
            const pulse = this.energyPulses[i];
            pulse.radius += 10 + this.comboIntensity * 5;
            pulse.alpha -= 0.015;
            if (pulse.alpha <= 0 || pulse.radius > pulse.maxRadius) {
                this.energyPulses.splice(i, 1);
            }
        }

        // Update energy beams
        for (let i = this.energyBeams.length - 1; i >= 0; i--) {
            const beam = this.energyBeams[i];
            beam.progress += 0.05;
            beam.life -= 0.02;
            
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
            orb.vx *= 0.98;
            orb.vy *= 0.98;
            orb.life -= 0.008;
            orb.pulsePhase += 0.1;
            
            if (orb.life <= 0 || orb.x < -50 || orb.x > this.canvas.width + 50 || 
                orb.y < -50 || orb.y > this.canvas.height + 50) {
                this.cosmicOrbs.splice(i, 1);
            }
        }

        // Update warp points
        for (let i = this.warpPoints.length - 1; i >= 0; i--) {
            const warp = this.warpPoints[i];
            warp.radius += 4;
            warp.rotation += warp.rotationSpeed;
            warp.life -= 0.005;
            
            // Spawn particles from warp point
            if (Math.random() < 0.4 && warp.particles.length < 30) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 3 + 1;
                warp.particles.push({
                    x: warp.x,
                    y: warp.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: Math.random() * 2 + 0.5,
                    life: 1.0,
                    alpha: 0.8
                });
            }
            
            // Update warp particles
            for (let j = warp.particles.length - 1; j >= 0; j--) {
                const p = warp.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                p.alpha = p.life * 0.8;
                
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
            constellation.life -= 0.003;
            constellation.pulsePhase += 0.05;
            
            if (constellation.life <= 0) {
                this.constellations.splice(i, 1);
            }
        }
    }

    draw() {
        if (!this.ctx) return;

        // Apply screen shake
        this.ctx.save();
        this.ctx.translate(this.screenShake.x, this.screenShake.y);

        // Clear and draw background with animated gradient
        const bgGradient = this.ctx.createLinearGradient(
            0, 0, 
            this.canvas.width * Math.sin(this.time * 0.001), 
            this.canvas.height
        );
        bgGradient.addColorStop(0, '#0a001a'); // Deep Indigo
        bgGradient.addColorStop(0.5, '#15002a'); // Mid violet
        bgGradient.addColorStop(1, '#1a0033'); // Dark Violet
        this.ctx.fillStyle = bgGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw stardust
        this.ctx.globalCompositeOperation = 'lighter';
        this.stardust.forEach(dust => {
            const twinkle = Math.sin(dust.twinkle) * 0.4 + 0.6;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = dust.alpha * dust.life * twinkle;
            this.ctx.beginPath();
            this.ctx.arc(dust.x, dust.y, dust.size, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Draw Rift (Center Glow) - quality-dependent
        if (this.activePreset.enableRiftEffect && this.riftOpenness > 0.01) {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            const riftGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.canvas.width * 0.5 * this.riftOpenness);
            riftGradient.addColorStop(0, `rgba(255, 255, 255, ${this.riftOpenness * 0.6})`);
            riftGradient.addColorStop(0.3, `rgba(0, 255, 255, ${this.riftOpenness * 0.3})`);
            riftGradient.addColorStop(0.6, `rgba(255, 0, 255, ${this.riftOpenness * 0.15})`);
            riftGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = riftGradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Draw constellations
        this.constellations.forEach(constellation => {
            const pulse = Math.sin(constellation.pulsePhase) * 0.3 + 0.7;
            this.ctx.globalAlpha = constellation.life * pulse;
            
            // Draw connecting lines
            this.ctx.strokeStyle = '#00ffff';
            this.ctx.lineWidth = 1;
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
            
            // Draw stars
            constellation.stars.forEach(star => {
                const starGlow = this.ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.size * 3);
                starGlow.addColorStop(0, `rgba(255, 255, 255, ${star.brightness})`);
                starGlow.addColorStop(0.5, `rgba(0, 255, 255, ${star.brightness * 0.5})`);
                starGlow.addColorStop(1, 'rgba(0, 255, 255, 0)');
                
                this.ctx.fillStyle = starGlow;
                this.ctx.beginPath();
                this.ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
                this.ctx.fill();
            });
        });

        // Draw warp points
        this.warpPoints.forEach(warp => {
            this.ctx.save();
            this.ctx.translate(warp.x, warp.y);
            this.ctx.rotate(warp.rotation);
            
            // Draw spiraling energy
            for (let i = 0; i < 3; i++) {
                const angle = (Math.PI * 2 / 3) * i + warp.rotation * 2;
                const spiralRadius = warp.radius * 0.7;
                
                this.ctx.strokeStyle = i % 2 === 0 ? '#00ffff' : '#ff00ff';
                this.ctx.lineWidth = 2;
                this.ctx.globalAlpha = warp.life * 0.6;
                
                this.ctx.beginPath();
                this.ctx.arc(0, 0, spiralRadius, angle, angle + Math.PI * 0.8);
                this.ctx.stroke();
            }
            
            // Draw center vortex
            const vortexGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, warp.radius * 0.5);
            vortexGradient.addColorStop(0, `rgba(255, 255, 255, ${warp.life * 0.8})`);
            vortexGradient.addColorStop(0.5, `rgba(0, 255, 255, ${warp.life * 0.4})`);
            vortexGradient.addColorStop(1, 'rgba(255, 0, 255, 0)');
            
            this.ctx.fillStyle = vortexGradient;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, warp.radius * 0.5, 0, Math.PI * 2);
            this.ctx.fill();
            
            this.ctx.restore();
            
            // Draw warp particles
            warp.particles.forEach(p => {
                const color = Math.random() > 0.5 ? '#00ffff' : '#ff00ff';
                this.ctx.fillStyle = color;
                this.ctx.globalAlpha = p.alpha;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            });
        });

        // Draw energy beams
        this.energyBeams.forEach(beam => {
            const currentX = beam.x + (beam.targetX - beam.x) * beam.progress;
            const currentY = beam.y + (beam.targetY - beam.y) * beam.progress;
            
            // Outer glow
            const beamGradient = this.ctx.createLinearGradient(beam.x, beam.y, currentX, currentY);
            beamGradient.addColorStop(0, beam.color + 'aa');
            beamGradient.addColorStop(0.5, beam.color + '66');
            beamGradient.addColorStop(1, beam.color + '00');
            
            this.ctx.strokeStyle = beamGradient;
            this.ctx.lineWidth = this.activePreset.beamWidth * 3;
            this.ctx.globalAlpha = beam.life * 0.3;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(beam.x, beam.y);
            this.ctx.lineTo(currentX, currentY);
            this.ctx.stroke();
            
            // Core beam
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = this.activePreset.beamWidth;
            this.ctx.globalAlpha = beam.life * 0.8;
            this.ctx.beginPath();
            this.ctx.moveTo(beam.x, beam.y);
            this.ctx.lineTo(currentX, currentY);
            this.ctx.stroke();
        });

        // Draw Threads with quality-dependent glow layers
        this.threads.forEach(thread => {
            // Glow layers (quality-dependent)
            if (this.activePreset.enableThreadGlow) {
                const glowLayers = this.activePreset.threadGlowLayers;
                for (let layer = glowLayers; layer > 0; layer--) {
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = thread.color;
                    this.ctx.lineWidth = thread.thickness * (1 + layer * 1.5);
                    this.ctx.globalAlpha = (thread.alpha + this.comboIntensity * 0.1) * (0.15 / layer);

                    for (let x = 0; x < this.canvas.width; x += 20) {
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
            this.ctx.globalAlpha = thread.alpha + (this.comboIntensity * 0.15);

            for (let x = 0; x < this.canvas.width; x += 20) {
                const y = thread.y + Math.sin(x * thread.frequency + thread.phase) * thread.amplitude;
                if (x === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.stroke();
        });

        // Draw energy Pulses at their positions (quality-scaled width)
        this.energyPulses.forEach(pulse => {
            // Outer ring
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = pulse.color;
            this.ctx.lineWidth = this.activePreset.pulseWidth * 1.2;
            this.ctx.globalAlpha = pulse.alpha * 0.3;
            this.ctx.stroke();
            
            // Inner ring
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = this.activePreset.pulseWidth * 0.5;
            this.ctx.globalAlpha = pulse.alpha * 0.6;
            this.ctx.stroke();
        });

        // Draw cosmic orbs
        this.cosmicOrbs.forEach(orb => {
            const pulse = Math.sin(orb.pulsePhase) * 0.3 + 0.7;
            
            // Draw trail
            if (this.activePreset.enableTrails) {
                for (let i = 0; i < orb.trail.length; i++) {
                    const trailPoint = orb.trail[i];
                    const trailFade = 1 - (i / orb.trail.length);
                    
                    const trailGradient = this.ctx.createRadialGradient(
                        trailPoint.x, trailPoint.y, 0,
                        trailPoint.x, trailPoint.y, trailPoint.size * 2 * trailFade
                    );
                    trailGradient.addColorStop(0, orb.color + Math.floor(orb.life * trailFade * 100).toString(16).padStart(2, '0'));
                    trailGradient.addColorStop(1, orb.color + '00');
                    
                    this.ctx.fillStyle = trailGradient;
                    this.ctx.beginPath();
                    this.ctx.arc(trailPoint.x, trailPoint.y, trailPoint.size * 2 * trailFade, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
            
            // Draw outer glow
            const orbGlow = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size * 3);
            orbGlow.addColorStop(0, `rgba(255, 255, 255, ${orb.life * pulse})`);
            orbGlow.addColorStop(0.3, orb.color + Math.floor(orb.life * pulse * 180).toString(16).padStart(2, '0'));
            orbGlow.addColorStop(1, orb.color + '00');
            
            this.ctx.fillStyle = orbGlow;
            this.ctx.globalAlpha = orb.life;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 3, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = orb.life * pulse;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 0.5, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Draw Particles with trails
        this.ctx.globalCompositeOperation = 'lighter';
        this.particles.forEach(p => {
            // Draw trail
            if (this.activePreset.enableTrails && p.trail.length > 1) {
                for (let i = 1; i < p.trail.length; i++) {
                    const trailPoint = p.trail[i];
                    const trailFade = 1 - (i / p.trail.length);
                    this.ctx.fillStyle = p.color || '#ffffff';
                    this.ctx.globalAlpha = trailPoint.alpha * p.life * trailFade * 0.4;
                    this.ctx.beginPath();
                    this.ctx.arc(trailPoint.x, trailPoint.y, p.size * trailFade, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
            
            // Draw particle glow (quality-dependent)
            if (this.activePreset.enableParticleGlow) {
                const particleGlow = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
                particleGlow.addColorStop(0, '#ffffff');
                particleGlow.addColorStop(0.5, p.color || '#ffffff');
                particleGlow.addColorStop(1, (p.color || '#ffffff') + '00');
                
                this.ctx.fillStyle = particleGlow;
                this.ctx.globalAlpha = p.alpha * p.life;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                this.ctx.fill();
            } else {
                // Simple solid particle for low quality
                this.ctx.fillStyle = p.color || '#ffffff';
                this.ctx.globalAlpha = p.alpha * p.life;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });

        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1.0;
        this.ctx.restore(); // Restore screen shake
    }

    animate() {
        if (!this.isActive) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }

    cleanup() {
        this.eventUnsubscribers.forEach(unsub => unsub());
        window.removeEventListener('resize', this.resizeHandler);
        
        // Remove quality change listener
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
        
        // Reset state
        this.comboIntensity = 0;
        this.weaveSpeed = 1.0;
        this.riftOpenness = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        
        this.isActive = false;
    }
    
    getTetrominoConfig() {
        console.log('🎨 [Astral Weave] getTetrominoConfig() called, returning:', ASTRAL_WEAVE_TETROMINOS);
        return ASTRAL_WEAVE_TETROMINOS;
    }
}

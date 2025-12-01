/**
 * @fileoverview Geode Theme - Luminous Fiber-Optic Starfield
 * 
 * An immersive cosmic cavern featuring:
 * - Dense starfield spanning the entire screen
 * - Fiber-optic strands hanging and floating throughout
 * - Dynamic sparkle bursts on gameplay events
 * - Warm cosmic color palette (oranges, reds, magentas)
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { GEODE_TETROMINOS } from './geode-tetrominos.js';

export default class GeodeTheme extends BaseTheme {
    constructor() {
        super('geode');
        this.canvas = null;
        this.ctx = null;
        this.animationTime = 0;

        // Scene elements
        this.stars = [];
        this.strands = [];
        this.ambientParticles = [];

        // Gameplay reactive elements
        this.energyPulses = [];
        this.sparkles = [];
        this.shootingStars = [];
        this.novaFlashes = [];
        this.starRipples = [];

        // Visual state
        this.comboMultiplier = 1.0;
        this.pulseIntensity = 0.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        this.ambientPulse = 0;

        // Cached gradients
        this.cachedGradients = {};

        // Event tracking
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Color palette - warm cosmic spectrum
        this.starColors = [
            '#ff6030', '#ff8040', '#ffa050', '#ffb060', '#ffc070', // oranges
            '#ff5040', '#ff4050', '#ff3060', '#ff2070', // reds
            '#ffd060', '#ffe080', '#fff0a0', // yellows
            '#ff70ff', '#ff60e0', '#e060ff', '#c060ff', '#a050ff', // magentas/purples
            '#60ffff', '#50e0ff', '#40c0ff', // teals (accent)
            '#60ff90', '#50ffa0', // greens (accent)
        ];

        this.qualityPresets = {
            Minimal: {
                starCount: 800,
                strandCount: 60,
                ambientParticleCount: 30,
                maxEnergyPulses: 3,
                maxSparkles: 30,
                maxShootingStars: 4,
                maxNovaFlashes: 2,
                maxStarRipples: 2,
            },
            Low: {
                starCount: 1500,
                strandCount: 100,
                ambientParticleCount: 50,
                maxEnergyPulses: 5,
                maxSparkles: 50,
                maxShootingStars: 6,
                maxNovaFlashes: 3,
                maxStarRipples: 3,
            },
            Medium: {
                starCount: 3000,
                strandCount: 0,
                ambientParticleCount: 80,
                maxEnergyPulses: 8,
                maxSparkles: 80,
                maxShootingStars: 10,
                maxNovaFlashes: 4,
                maxStarRipples: 4,
            },
            High: {
                starCount: 5000,
                strandCount: 0,
                ambientParticleCount: 120,
                maxEnergyPulses: 12,
                maxSparkles: 120,
                maxShootingStars: 15,
                maxNovaFlashes: 5,
                maxStarRipples: 5,
            },
            Ultra: {
                starCount: 8000,
                strandCount: 0,
                ambientParticleCount: 160,
                maxEnergyPulses: 16,
                maxSparkles: 160,
                maxShootingStars: 20,
                maxNovaFlashes: 6,
                maxStarRipples: 6,
            },
            Extreme: {
                starCount: 10000,
                strandCount: 0,
                ambientParticleCount: 200,
                maxEnergyPulses: 20,
                maxSparkles: 200,
                maxShootingStars: 25,
                maxNovaFlashes: 8,
                maxStarRipples: 8,
            },
        };
        
        this.currentQuality = 'Medium';
        this.activePreset = this.qualityPresets.Medium;
    }

    applyQualityPreset(quality) {
        const preset = this.qualityPresets[quality] ?? this.qualityPresets.Medium;
        this.currentQuality = quality in this.qualityPresets ? quality : 'Medium';
        this.activePreset = preset;
        console.log(`💎 Geode: Applied ${this.currentQuality} quality preset`);
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
            Object.assign(this.canvas.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: '1',
            });
            themeContainer.appendChild(this.canvas);
        }

        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        this.clearAllElements();
        this.cacheGradients();

        // Initialize scene elements
        this.createStars();
        this.createStrands();
        this.createAmbientParticles();

        this.setupEventListeners();
        this.animate();
    }

    clearAllElements() {
        this.stars = [];
        this.strands = [];
        this.ambientParticles = [];
        this.energyPulses = [];
        this.sparkles = [];
        this.shootingStars = [];
        this.novaFlashes = [];
        this.starRipples = [];
    }

    cacheGradients() {
        if (!this.ctx || !this.canvas) return;

        const w = this.canvas.width;
        const h = this.canvas.height;

        // Deep space background with warm undertones
        const bgGradient = this.ctx.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.9);
        bgGradient.addColorStop(0, '#0c0408');
        bgGradient.addColorStop(0.3, '#080306');
        bgGradient.addColorStop(0.6, '#050204');
        bgGradient.addColorStop(1, '#020102');
        this.cachedGradients.background = bgGradient;

        // Vignette
        const vignette = this.ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.9);
        vignette.addColorStop(0, 'transparent');
        vignette.addColorStop(0.6, 'rgba(0, 0, 0, 0.15)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
        this.cachedGradients.vignette = vignette;
    }

    createStars() {
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Dense starfield across entire screen
        // More density at top, gradually thinning toward bottom
        for (let i = 0; i < preset.starCount; i++) {
            // Bias toward top but cover whole screen
            const yBias = Math.pow(Math.random(), 1.8);
            const y = yBias * h;
            
            // Size varies - smaller stars more common
            const sizeBias = Math.pow(Math.random(), 2);
            const size = 0.3 + sizeBias * 3;
            
            this.stars.push({
                x: Math.random() * w,
                y: y,
                size: size,
                color: this.starColors[Math.floor(Math.random() * this.starColors.length)],
                brightness: 0.2 + Math.random() * 0.8,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.015 + Math.random() * 0.045,
                // Slight drift for parallax feel
                driftX: (Math.random() - 0.5) * 0.05,
                driftY: (Math.random() - 0.5) * 0.02,
            });
        }
    }

    createStrands() {
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Fiber-optic strands distributed across screen
        for (let i = 0; i < preset.strandCount; i++) {
            const x = Math.random() * w;
            // Start from various heights, mostly from top half
            const startY = Math.random() * h * 0.6;
            // Longer strands
            const length = 80 + Math.random() * 350;
            const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
            
            this.strands.push({
                x: x,
                baseX: x,
                startY: startY,
                length: length,
                width: 0.4 + Math.random() * 1.8,
                color: color,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: 0.0008 + Math.random() * 0.002,
                swayAmount: 3 + Math.random() * 12,
                brightness: 0.3 + Math.random() * 0.7,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: 0.008 + Math.random() * 0.02,
                // Tip properties
                tipSize: 1 + Math.random() * 2.5,
                tipBrightness: 0.6 + Math.random() * 0.4,
            });
        }
    }

    createAmbientParticles() {
        const preset = this.activePreset;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Floating particles drifting slowly
        for (let i = 0; i < preset.ambientParticleCount; i++) {
            this.ambientParticles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.4,
                vy: -0.15 - Math.random() * 0.3,
                size: 0.8 + Math.random() * 2.5,
                color: this.starColors[Math.floor(Math.random() * this.starColors.length)],
                opacity: 0.3 + Math.random() * 0.5,
                twinklePhase: Math.random() * Math.PI * 2,
                twinkleSpeed: 0.02 + Math.random() * 0.04,
            });
        }
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

        window.addEventListener('resize', () => {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.cacheGradients();
        });
    }

    handlePieceLock() {
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.1, 0.4);

        const w = this.canvas.width;
        const h = this.canvas.height;

        // === SHOOTING STARS ===
        // Spawn 2-4 shooting stars streaking across the screen
        const shootingCount = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < shootingCount && this.shootingStars.length < this.activePreset.maxShootingStars; i++) {
            const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
            // Random direction - mostly diagonal
            const angle = Math.random() * Math.PI * 2;
            const speed = 8 + Math.random() * 12;
            
            // Start from edges or random positions
            let startX, startY;
            if (Math.random() > 0.5) {
                // Start from top/sides
                startX = Math.random() * w;
                startY = Math.random() * h * 0.4;
            } else {
                // Start from random position
                startX = Math.random() * w;
                startY = Math.random() * h * 0.6;
            }
            
            this.shootingStars.push({
                x: startX,
                y: startY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * 3,
                color: color,
                life: 1.0,
                decay: 0.025 + Math.random() * 0.015,
                trail: [], // Store trail positions
                maxTrailLength: 12 + Math.floor(Math.random() * 8),
            });
        }

        // === NOVA FLASH ===
        // Create a bright flash that illuminates nearby stars
        if (Math.random() > 0.3 && this.novaFlashes.length < this.activePreset.maxNovaFlashes) {
            const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
            this.novaFlashes.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.1 + Math.random() * h * 0.5,
                radius: 0,
                maxRadius: 80 + Math.random() * 60,
                brightness: 1.0,
                decay: 0.04 + Math.random() * 0.02,
                color: color,
            });
        }

        // === STAR RIPPLE ===
        // A wave that makes stars pulse brighter as it passes
        if (Math.random() > 0.5 && this.starRipples.length < this.activePreset.maxStarRipples) {
            this.starRipples.push({
                x: w * 0.2 + Math.random() * w * 0.6,
                y: h * 0.1 + Math.random() * h * 0.5,
                radius: 0,
                speed: 6 + Math.random() * 4,
                width: 40 + Math.random() * 30, // Width of the ripple ring
                life: 1.0,
                decay: 0.012,
            });
        }

        // Spawn some sparkles too
        const sparkleCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < sparkleCount; i++) {
            const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 2;
            
            this.sparkles.push({
                x: w * 0.3 + Math.random() * w * 0.4,
                y: h * 0.2 + Math.random() * h * 0.4,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 1.5 + Math.random() * 2,
                color: color,
                life: 1.0,
                decay: 0.02 + Math.random() * 0.015,
            });
        }
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
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.3 * lineCount, 2.0);

        // Spawn sparkle bursts from multiple points
        const burstCount = Math.min(lineCount * 3 + 2, 12);
        for (let c = 0; c < burstCount; c++) {
            const x = Math.random() * this.canvas.width;
            const y = Math.random() * this.canvas.height * 0.7;
            const sparkles = 5 + lineCount * 2;
            const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
            
            for (let i = 0; i < sparkles; i++) {
                const angle = (i / sparkles) * Math.PI * 2 + Math.random() * 0.3;
                const speed = 1.5 + Math.random() * 3;
                
                this.sparkles.push({
                    x: x + (Math.random() - 0.5) * 30,
                    y: y + (Math.random() - 0.5) * 30,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 2 + Math.random() * 2.5,
                    color: color,
                    life: 1.0,
                    decay: 0.015 + Math.random() * 0.01,
                });
            }
        }

        // Energy pulses
        const pulseCount = Math.min(lineCount, 3);
        for (let p = 0; p < pulseCount; p++) {
            if (this.energyPulses.length < this.activePreset.maxEnergyPulses) {
                const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
                this.energyPulses.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height * 0.6,
                    radius: 10,
                    maxRadius: 100 + lineCount * 40,
                    opacity: 0.5,
                    color: color,
                    growthRate: 3 + lineCount * 0.5,
                });
            }
        }
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.2, 2.5);
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.4 * comboCount, 2.0);

        // Screen shake for high combos
        if (comboCount >= 5) {
            this.screenShake.intensity = Math.min(5 + (comboCount - 5) * 1.8, 12);
            if (comboCount >= 7) {
                this.chromaticAberration = Math.min(3 + (comboCount - 7) * 1, 8);
            }
        } else if (comboCount >= 3) {
            this.screenShake.intensity = Math.min(2 + comboCount * 0.6, 5);
        }

        // Big sparkle burst for combos
        if (comboCount >= 2) {
            const burstCount = Math.min(comboCount * 4, 30);
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            
            for (let i = 0; i < burstCount; i++) {
                const angle = (i / burstCount) * Math.PI * 2;
                const speed = 2 + Math.random() * 4;
                const color = this.starColors[Math.floor(Math.random() * this.starColors.length)];
                
                this.sparkles.push({
                    x: cx + (Math.random() - 0.5) * 50,
                    y: cy + (Math.random() - 0.5) * 50,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 2 + Math.random() * 3,
                    color: color,
                    life: 1.0,
                    decay: 0.012,
                });
            }
        }
    }

    animate() {
        if (!this.isActive || !this.ctx || !this.canvas) return;

        this.animationTime += 0.016;
        this.ambientPulse = Math.sin(this.animationTime * 0.4) * 0.1 + 0.9;

        // Decay effects
        this.pulseIntensity *= 0.97;
        if (this.pulseIntensity < 0.01) this.pulseIntensity = 0;
        
        this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.005);
        
        this.screenShake.intensity *= 0.9;
        if (this.screenShake.intensity < 0.1) this.screenShake.intensity = 0;
        
        this.chromaticAberration *= 0.92;
        if (this.chromaticAberration < 0.1) this.chromaticAberration = 0;

        // Screen shake
        if (this.screenShake.intensity > 0) {
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity * 2;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity * 2;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        // Draw
        this.ctx.save();
        if (this.screenShake.intensity > 0) {
            this.ctx.translate(this.screenShake.x, this.screenShake.y);
        }

        this.drawBackground();
        this.updateStarRipples(); // Update star brightness from ripples
        this.drawStars();
        this.drawStrands();
        this.drawAmbientParticles();
        this.drawEnergyPulses();
        this.drawNovaFlashes();
        this.drawShootingStars();
        this.drawSparkles();
        this.drawVignette();

        this.ctx.restore();

        if (this.chromaticAberration > 0) {
            this.drawChromaticAberration();
        }

        this.registerAnimation(requestAnimationFrame(() => this.animate()));
    }

    drawBackground() {
        if (this.cachedGradients.background) {
            this.ctx.fillStyle = this.cachedGradients.background;
        } else {
            this.ctx.fillStyle = '#030204';
        }
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Ambient pulse glow during combos
        if (this.pulseIntensity > 0.05) {
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height * 0.4;
            const glowGrad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.canvas.width * 0.6);
            glowGrad.addColorStop(0, `rgba(255, 120, 80, ${this.pulseIntensity * 0.06})`);
            glowGrad.addColorStop(0.4, `rgba(200, 80, 150, ${this.pulseIntensity * 0.03})`);
            glowGrad.addColorStop(1, 'transparent');
            this.ctx.fillStyle = glowGrad;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    drawStars() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        this.stars.forEach((star) => {
            // Update position with slight drift
            star.x += star.driftX;
            star.y += star.driftY;
            
            // Wrap around
            if (star.x < -5) star.x = w + 5;
            if (star.x > w + 5) star.x = -5;
            if (star.y < -5) star.y = h + 5;
            if (star.y > h + 5) star.y = -5;
            
            // Twinkle
            star.twinklePhase += star.twinkleSpeed;
            const twinkle = Math.sin(star.twinklePhase) * 0.4 + 0.6;
            
            // Include ripple boost in brightness calculation
            const rippleBoost = star.rippleBoost || 0;
            const baseBrightness = star.brightness * twinkle * (1 + this.pulseIntensity * 0.4) * this.ambientPulse;
            const brightness = Math.min(baseBrightness + rippleBoost, 1.2);
            
            // Size boost from ripple
            const sizeMultiplier = 1 + rippleBoost * 0.8;
            const effectiveSize = star.size * sizeMultiplier;
            
            // Draw star
            this.ctx.fillStyle = star.color;
            this.ctx.globalAlpha = Math.min(brightness, 1);
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, effectiveSize, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Extra glow for larger stars or ripple-boosted stars
            if ((star.size > 1.5 && brightness > 0.5) || rippleBoost > 0.3) {
                this.ctx.globalAlpha = Math.min(brightness * 0.4, 0.6);
                this.ctx.beginPath();
                this.ctx.arc(star.x, star.y, effectiveSize * 2.2, 0, Math.PI * 2);
                this.ctx.fill();
                
                // White core for intense ripple effect
                if (rippleBoost > 0.5) {
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.globalAlpha = rippleBoost * 0.7;
                    this.ctx.beginPath();
                    this.ctx.arc(star.x, star.y, effectiveSize * 0.6, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.fillStyle = star.color;
                }
            }
        });
        this.ctx.globalAlpha = 1;
    }

    drawStrands() {
        this.strands.forEach((strand) => {
            // Sway animation
            strand.swayPhase += strand.swaySpeed;
            strand.pulsePhase += strand.pulseSpeed;
            
            const swayX = Math.sin(strand.swayPhase) * strand.swayAmount;
            const pulse = Math.sin(strand.pulsePhase) * 0.3 + 0.7;
            const brightness = strand.brightness * pulse * (1 + this.pulseIntensity * 0.5) * this.ambientPulse;
            
            // End position with sway
            const endX = strand.x + swayX;
            const endY = strand.startY + strand.length;
            
            // Draw strand as gradient line
            const gradient = this.ctx.createLinearGradient(
                strand.x, strand.startY,
                endX, endY
            );
            gradient.addColorStop(0, strand.color);
            gradient.addColorStop(0.6, strand.color);
            gradient.addColorStop(1, 'transparent');
            
            this.ctx.strokeStyle = gradient;
            this.ctx.globalAlpha = brightness;
            this.ctx.lineWidth = strand.width;
            this.ctx.lineCap = 'round';
            
            this.ctx.beginPath();
            this.ctx.moveTo(strand.x, strand.startY);
            
            // Curved path with multiple control points for organic feel
            const midY1 = strand.startY + strand.length * 0.33;
            const midY2 = strand.startY + strand.length * 0.66;
            const midX1 = strand.x + swayX * 0.3;
            const midX2 = strand.x + swayX * 0.7;
            
            this.ctx.bezierCurveTo(
                midX1, midY1,
                midX2, midY2,
                endX, endY
            );
            this.ctx.stroke();
            
            // Bright glowing tip
            const tipPulse = Math.sin(strand.pulsePhase * 1.5) * 0.3 + 0.7;
            const tipBright = strand.tipBrightness * tipPulse * brightness;
            
            // Outer glow
            this.ctx.fillStyle = strand.color;
            this.ctx.globalAlpha = tipBright * 0.4;
            this.ctx.beginPath();
            this.ctx.arc(endX, endY, strand.tipSize * 3, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Inner glow
            this.ctx.globalAlpha = tipBright * 0.7;
            this.ctx.beginPath();
            this.ctx.arc(endX, endY, strand.tipSize * 1.8, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Bright core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = tipBright * 0.9;
            this.ctx.beginPath();
            this.ctx.arc(endX, endY, strand.tipSize, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1;
        this.ctx.lineCap = 'butt';
    }

    drawAmbientParticles() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        this.ambientParticles.forEach((p) => {
            // Update position
            p.x += p.vx;
            p.y += p.vy;
            p.twinklePhase += p.twinkleSpeed;
            
            // Wrap around
            if (p.y < -10) {
                p.y = h + 10;
                p.x = Math.random() * w;
            }
            if (p.x < -10) p.x = w + 10;
            if (p.x > w + 10) p.x = -10;
            
            const twinkle = Math.sin(p.twinklePhase) * 0.35 + 0.65;
            const brightness = p.opacity * twinkle * (1 + this.comboMultiplier * 0.25) * this.ambientPulse;
            
            // Outer glow
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = brightness * 0.4;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Core
            this.ctx.globalAlpha = brightness;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1;
    }

    drawEnergyPulses() {
        for (let i = this.energyPulses.length - 1; i >= 0; i--) {
            const pulse = this.energyPulses[i];

            pulse.radius += pulse.growthRate;
            pulse.opacity *= 0.94;

            if (pulse.radius >= pulse.maxRadius || pulse.opacity < 0.03) {
                this.energyPulses.splice(i, 1);
                continue;
            }

            const safeRadius = Math.max(1, pulse.radius);
            
            // Outer ring
            this.ctx.strokeStyle = pulse.color;
            this.ctx.globalAlpha = pulse.opacity;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, safeRadius, 0, Math.PI * 2);
            this.ctx.stroke();
            
            // Inner ring
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.globalAlpha = pulse.opacity * 0.5;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.arc(pulse.x, pulse.y, safeRadius * 0.6, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        this.ctx.globalAlpha = 1;
    }

    drawSparkles() {
        this.ctx.globalCompositeOperation = 'screen';
        
        for (let i = this.sparkles.length - 1; i >= 0; i--) {
            const s = this.sparkles[i];
            
            // Update
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.03; // Light gravity
            s.vx *= 0.98;
            s.vy *= 0.98;
            s.life -= s.decay;

            if (s.life <= 0 || this.sparkles.length > this.activePreset.maxSparkles * 1.5) {
                this.sparkles.splice(i, 1);
                continue;
            }

            const sparkleSize = Math.max(0.5, s.size * s.life);
            const twinkle = Math.sin(this.animationTime * 18 + i) * 0.3 + 0.7;
            
            // Outer glow
            this.ctx.fillStyle = s.color;
            this.ctx.globalAlpha = s.life * twinkle * 0.5;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, sparkleSize * 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Main sparkle
            this.ctx.globalAlpha = s.life * twinkle;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, sparkleSize, 0, Math.PI * 2);
            this.ctx.fill();

            // Bright core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = s.life * twinkle * 0.9;
            this.ctx.beginPath();
            this.ctx.arc(s.x, s.y, Math.max(0.5, sparkleSize * 0.4), 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
    }

    drawShootingStars() {
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.lineCap = 'round';
        
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            
            // Store current position in trail
            star.trail.unshift({ x: star.x, y: star.y });
            if (star.trail.length > star.maxTrailLength) {
                star.trail.pop();
            }
            
            // Update position
            star.x += star.vx;
            star.y += star.vy;
            star.life -= star.decay;
            
            // Slight deceleration
            star.vx *= 0.98;
            star.vy *= 0.98;
            
            // Remove if dead or off-screen
            if (star.life <= 0 || 
                star.x < -50 || star.x > this.canvas.width + 50 ||
                star.y < -50 || star.y > this.canvas.height + 50) {
                this.shootingStars.splice(i, 1);
                continue;
            }
            
            // Draw trail
            if (star.trail.length > 1) {
                for (let t = 0; t < star.trail.length - 1; t++) {
                    const trailAlpha = (1 - t / star.trail.length) * star.life * 0.8;
                    const trailWidth = star.size * (1 - t / star.trail.length * 0.7);
                    
                    this.ctx.strokeStyle = star.color;
                    this.ctx.globalAlpha = trailAlpha;
                    this.ctx.lineWidth = trailWidth;
                    this.ctx.beginPath();
                    this.ctx.moveTo(star.trail[t].x, star.trail[t].y);
                    this.ctx.lineTo(star.trail[t + 1].x, star.trail[t + 1].y);
                    this.ctx.stroke();
                }
            }
            
            // Draw head glow
            this.ctx.fillStyle = star.color;
            this.ctx.globalAlpha = star.life * 0.6;
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw bright head
            this.ctx.globalAlpha = star.life;
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size * 1.5, 0, Math.PI * 2);
            this.ctx.fill();
            
            // White core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = star.life * 0.95;
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size * 0.7, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.ctx.lineCap = 'butt';
    }

    drawNovaFlashes() {
        this.ctx.globalCompositeOperation = 'screen';
        
        for (let i = this.novaFlashes.length - 1; i >= 0; i--) {
            const nova = this.novaFlashes[i];
            
            // Expand radius quickly at first, then slow
            nova.radius += (nova.maxRadius - nova.radius) * 0.15;
            nova.brightness -= nova.decay;
            
            if (nova.brightness <= 0) {
                this.novaFlashes.splice(i, 1);
                continue;
            }
            
            // Outer glow
            const glowGrad = this.ctx.createRadialGradient(
                nova.x, nova.y, 0,
                nova.x, nova.y, nova.radius
            );
            glowGrad.addColorStop(0, nova.color);
            glowGrad.addColorStop(0.3, nova.color);
            glowGrad.addColorStop(0.6, `${nova.color}66`);
            glowGrad.addColorStop(1, 'transparent');
            
            this.ctx.fillStyle = glowGrad;
            this.ctx.globalAlpha = nova.brightness * 0.7;
            this.ctx.beginPath();
            this.ctx.arc(nova.x, nova.y, nova.radius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Bright center
            const coreGrad = this.ctx.createRadialGradient(
                nova.x, nova.y, 0,
                nova.x, nova.y, nova.radius * 0.3
            );
            coreGrad.addColorStop(0, '#ffffff');
            coreGrad.addColorStop(0.5, nova.color);
            coreGrad.addColorStop(1, 'transparent');
            
            this.ctx.fillStyle = coreGrad;
            this.ctx.globalAlpha = nova.brightness;
            this.ctx.beginPath();
            this.ctx.arc(nova.x, nova.y, nova.radius * 0.4, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Star-like rays
            if (nova.brightness > 0.3) {
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.globalAlpha = nova.brightness * 0.6;
                this.ctx.lineWidth = 2;
                
                const rayCount = 4;
                const rayLength = nova.radius * 0.8;
                for (let r = 0; r < rayCount; r++) {
                    const angle = (r / rayCount) * Math.PI * 2 + Math.PI / 4;
                    this.ctx.beginPath();
                    this.ctx.moveTo(nova.x, nova.y);
                    this.ctx.lineTo(
                        nova.x + Math.cos(angle) * rayLength,
                        nova.y + Math.sin(angle) * rayLength
                    );
                    this.ctx.stroke();
                }
            }
        }
        
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
    }

    updateStarRipples() {
        // Process ripples and boost star brightness
        for (let i = this.starRipples.length - 1; i >= 0; i--) {
            const ripple = this.starRipples[i];
            
            ripple.radius += ripple.speed;
            ripple.life -= ripple.decay;
            
            if (ripple.life <= 0 || ripple.radius > Math.max(this.canvas.width, this.canvas.height)) {
                this.starRipples.splice(i, 1);
                continue;
            }
            
            // Boost brightness of stars within the ripple ring
            const innerRadius = ripple.radius - ripple.width / 2;
            const outerRadius = ripple.radius + ripple.width / 2;
            
            this.stars.forEach((star) => {
                const dx = star.x - ripple.x;
                const dy = star.y - ripple.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // If star is within the ripple ring
                if (dist >= innerRadius && dist <= outerRadius) {
                    // Calculate how centered the star is in the ring
                    const ringCenter = ripple.radius;
                    const distFromCenter = Math.abs(dist - ringCenter);
                    const intensity = 1 - (distFromCenter / (ripple.width / 2));
                    
                    // Temporarily boost the star's brightness
                    star.rippleBoost = Math.max(star.rippleBoost || 0, intensity * ripple.life * 1.5);
                }
            });
            
            // Draw the ripple ring itself (subtle)
            this.ctx.strokeStyle = `rgba(255, 200, 150, ${ripple.life * 0.15})`;
            this.ctx.lineWidth = ripple.width * 0.3;
            this.ctx.beginPath();
            this.ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        
        // Decay ripple boost on stars
        this.stars.forEach((star) => {
            if (star.rippleBoost > 0) {
                star.rippleBoost *= 0.92;
                if (star.rippleBoost < 0.01) star.rippleBoost = 0;
            }
        });
    }

    drawVignette() {
        if (this.cachedGradients.vignette) {
            this.ctx.fillStyle = this.cachedGradients.vignette;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    drawChromaticAberration() {
        if (this.chromaticAberration <= 0) return;

        const offset = this.chromaticAberration * 0.8;
        const intensity = Math.min(this.chromaticAberration / 10, 0.12);

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.fillStyle = `rgba(255, 80, 50, ${intensity})`;
        this.ctx.fillRect(-offset, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = `rgba(80, 50, 255, ${intensity})`;
        this.ctx.fillRect(offset, 0, this.canvas.width, this.canvas.height);

        if (this.chromaticAberration > 4) {
            this.ctx.globalCompositeOperation = 'lighten';
            this.ctx.fillStyle = `rgba(255, 255, 255, ${(this.chromaticAberration - 4) * 0.025})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.restore();
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        super.stop();
        this.animationTime = 0;
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.clearAllElements();
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.chromaticAberration = 0;
        
        // Reset any ripple boost on stars
        this.stars.forEach((star) => {
            star.rippleBoost = 0;
        });
    }

    getTetrominoConfig() {
        return GEODE_TETROMINOS;
    }
}

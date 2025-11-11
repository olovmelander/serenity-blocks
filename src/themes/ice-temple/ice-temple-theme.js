/**
 * @fileoverview Ice Temple Theme - Immersive frozen vistas with auroras, ice cracks, and drifting shards.
 */

import { BaseTheme } from '../base-theme.js';
import { iceTempleCache } from '../../utils/cache.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class IceTempleTheme extends BaseTheme {
    constructor() {
        super('ice-temple');

        // Gameplay integration
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Canvas for dynamic effects
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.animationId = null;
        this.time = 0;

        // Effect particles
        this.iceShardBurst = [];
        this.auroraWaves = [];
        this.frozenCrystals = [];
        this.comboRings = [];
        this.glacialLightning = [];
        this.iceStorm = [];

        // Dynamic state
        this.auroraIntensity = 0.85;
        this.targetAuroraIntensity = 0.85;
        this.crackGlow = 0;
        this.flashIntensity = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
    }

    async init() {
        // Theme resources are created on-demand in createScene()
        this.setupEffectsCanvas();
    }

    setupEffectsCanvas() {
        // Create or get the effects canvas
        let canvas = document.getElementById('ice-temple-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'ice-temple-effects-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '10';

            const themeContainer = document.getElementById('ice-temple-theme');
            if (themeContainer) {
                themeContainer.appendChild(canvas);
            }
        }

        this.effectsCanvas = canvas;
        this.effectsCtx = canvas.getContext('2d', { alpha: true });
        this.resizeEffectsCanvas();

        window.addEventListener('resize', () => this.resizeEffectsCanvas());
    }

    resizeEffectsCanvas() {
        if (!this.effectsCanvas) return;
        this.effectsCanvas.width = window.innerWidth;
        this.effectsCanvas.height = window.innerHeight;
    }

    async createScene() {
        this.createStars();
        this.createAurora();
        this.createIceField();
        this.createCrackNetwork();
        this.createFrostHaze();
        this.createMistLayers();
        this.createSnowfall();
        this.createRefractions();

        // Setup gameplay event listeners
        this.setupEventListeners();

        // Start animation loop
        this.startEffectsAnimation();
    }

    setupEventListeners() {
        this.teardownEventListeners();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleLineClear(data);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleCombo(data);
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    teardownEventListeners() {
        if (!this.eventUnsubscribers.length) return;

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[IceTempleTheme] Failed to remove event listener', error);
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
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        console.log(`[IceTempleTheme] Line clear: ${lineCount} lines, combo: ${comboCount}`);
        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        console.log(`[IceTempleTheme] Combo: ${comboCount}`);
    }

    onLineClear(lineCount, comboCount) {
        if (!this.effectsCanvas) return;

        // Update combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 2.5);
        this.comboDecay = 180; // 3 seconds at 60fps

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;

        // Aurora pulse effect
        this.targetAuroraIntensity = Math.min(0.85 + lineCount * 0.1 + comboCount * 0.05, 1.5);
        this.pulseAurora(lineCount, comboCount);

        // Ice shard burst
        const shardCount = lineCount * 40 + comboCount * 25;
        for (let i = 0; i < shardCount; i++) {
            this.iceShardBurst.push(this.createIceShardParticle(centerX, centerY, lineCount));
        }

        // Crack glow pulse
        this.crackGlow = Math.min(0.6 + lineCount * 0.15 + comboCount * 0.1, 1.0);

        // Flash effect
        this.flashIntensity = Math.min(0.2 + lineCount * 0.08, 0.5);

        // Frozen crystals for multi-line clears
        if (lineCount >= 2) {
            for (let i = 0; i < lineCount * 15; i++) {
                this.frozenCrystals.push(this.createFrozenCrystal(centerX, centerY));
            }
        }

        // Combo rings
        if (comboCount >= 2) {
            for (let i = 0; i < Math.min(comboCount, 5); i++) {
                this.comboRings.push(this.createComboRing(centerX, centerY, i));
            }
        }

        // Glacial lightning for big combos
        if (comboCount >= 5) {
            this.createGlacialLightning(centerX, centerY, comboCount);
        }

        // Ice storm for massive combos
        if (comboCount >= 8) {
            this.triggerIceStorm(comboCount);
        }

        // Screen shake
        if (comboCount >= 3 || lineCount >= 3) {
            this.screenShake.intensity = Math.min((comboCount + lineCount) * 1.5, 12);
        }
    }

    pulseAurora(lineCount, comboCount) {
        const intensity = 0.3 + lineCount * 0.1 + comboCount * 0.15;
        const duration = 60 + comboCount * 20;

        this.auroraWaves.push({
            intensity: intensity,
            life: 1.0,
            duration: duration,
            phase: 0,
            speed: 0.08 + comboCount * 0.02,
        });
    }

    createIceShardParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 12 + 6 + lineCount * 2;
        const size = Math.random() * 5 + 3;

        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: size,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.25,
            gravity: 0.25,
            sparkle: Math.random() * Math.PI * 2,
            color: Math.random() < 0.3 ? 'cyan' : 'white',
        };
    }

    createFrozenCrystal(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 200 + 50;

        return {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            targetX: x + Math.cos(angle) * (distance + 300),
            targetY: y + Math.sin(angle) * (distance + 300),
            size: Math.random() * 4 + 2,
            opacity: Math.random() * 0.7 + 0.5,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
            sparkle: Math.random() * Math.PI * 2,
        };
    }

    createComboRing(x, y, index) {
        return {
            x: x,
            y: y,
            radius: 20 + index * 15,
            maxRadius: 300 + index * 80,
            opacity: 0.9,
            life: 1.0,
            thickness: 3 + index,
            expansionSpeed: 4 + index * 0.5,
            pulsePhase: index * Math.PI * 0.4,
        };
    }

    createGlacialLightning(x, y, comboCount) {
        const branches = [];
        const numBranches = Math.floor(comboCount / 2) + 3;

        for (let i = 0; i < numBranches; i++) {
            const angle = (Math.PI * 2 / numBranches) * i + Math.random() * 0.4;
            const segments = [];
            let currentX = x;
            let currentY = y;

            for (let j = 0; j < 6 + Math.floor(comboCount / 3); j++) {
                const length = Math.random() * 70 + 50;
                const nextX = currentX + Math.cos(angle + (Math.random() - 0.5) * 0.7) * length;
                const nextY = currentY + Math.sin(angle + (Math.random() - 0.5) * 0.7) * length;

                segments.push({ x1: currentX, y1: currentY, x2: nextX, y2: nextY });
                currentX = nextX;
                currentY = nextY;
            }

            branches.push(segments);
        }

        this.glacialLightning.push({
            branches: branches,
            opacity: 1.0,
            life: 1.0,
            pulsePhase: 0,
        });
    }

    triggerIceStorm(comboCount) {
        const stormCount = Math.min(comboCount * 20, 200);
        for (let i = 0; i < stormCount; i++) {
            this.iceStorm.push({
                x: Math.random() * this.effectsCanvas.width,
                y: -Math.random() * 200,
                vx: (Math.random() - 0.5) * 8,
                vy: Math.random() * 6 + 4,
                size: Math.random() * 3 + 1,
                opacity: Math.random() * 0.6 + 0.4,
                life: 1.0,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.3,
            });
        }
    }

    startEffectsAnimation() {
        if (!this.isActive || !this.effectsCanvas) return;

        this.animateEffects();
    }

    animateEffects() {
        if (!this.isActive || !this.effectsCanvas) return;

        this.time += 1;

        // Decay combo multiplier
        if (this.comboDecay > 0) {
            this.comboDecay -= 1;
            if (this.comboDecay === 0) {
                this.comboMultiplier = 1.0;
            }
        }

        // Smooth aurora intensity transition
        this.auroraIntensity += (this.targetAuroraIntensity - this.auroraIntensity) * 0.05;
        if (Math.abs(this.targetAuroraIntensity - this.auroraIntensity) < 0.01) {
            this.targetAuroraIntensity = 0.85;
        }

        // Apply aurora intensity to aurora container
        const auroraContainer = this.getContainer('ice-temple-aurora');
        if (auroraContainer) {
            auroraContainer.style.opacity = this.auroraIntensity.toString();
        }

        // Decay crack glow
        if (this.crackGlow > 0) {
            this.crackGlow *= 0.95;
            const cracksContainer = this.getContainer('ice-temple-cracks');
            if (cracksContainer) {
                cracksContainer.style.filter = `brightness(${1 + this.crackGlow})`;
            }
        }

        // Decay flash
        if (this.flashIntensity > 0) {
            this.flashIntensity *= 0.88;
        }

        // Screen shake decay
        if (this.screenShake.intensity > 0) {
            this.screenShake.intensity *= 0.90;
            this.screenShake.x = (Math.random() - 0.5) * this.screenShake.intensity;
            this.screenShake.y = (Math.random() - 0.5) * this.screenShake.intensity;
        } else {
            this.screenShake.x = 0;
            this.screenShake.y = 0;
        }

        // Clear canvas
        this.effectsCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);

        // Apply screen shake
        this.effectsCtx.save();
        this.effectsCtx.translate(this.screenShake.x, this.screenShake.y);

        // Draw flash effect
        if (this.flashIntensity > 0.01) {
            this.effectsCtx.fillStyle = `rgba(180, 220, 255, ${this.flashIntensity * 0.4})`;
            this.effectsCtx.fillRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }

        // Draw and update all effects
        this.updateAuroraWaves();
        this.updateGlacialLightning();
        this.updateComboRings();
        this.updateIceShardBurst();
        this.updateFrozenCrystals();
        this.updateIceStorm();

        this.effectsCtx.restore();

        this.animationId = requestAnimationFrame(() => this.animateEffects());
    }

    updateAuroraWaves() {
        for (let i = this.auroraWaves.length - 1; i >= 0; i--) {
            const wave = this.auroraWaves[i];
            wave.phase += wave.speed;
            wave.life -= 1 / wave.duration;

            if (wave.life <= 0) {
                this.auroraWaves.splice(i, 1);
                continue;
            }

            const opacity = wave.intensity * wave.life * (0.7 + Math.sin(wave.phase) * 0.3);
            const gradient = this.effectsCtx.createRadialGradient(
                this.effectsCanvas.width / 2, this.effectsCanvas.height * 0.3, 0,
                this.effectsCanvas.width / 2, this.effectsCanvas.height * 0.3, this.effectsCanvas.width * 0.6
            );
            gradient.addColorStop(0, `rgba(116, 185, 255, ${opacity * 0.6})`);
            gradient.addColorStop(0.5, `rgba(85, 239, 196, ${opacity * 0.4})`);
            gradient.addColorStop(1, 'rgba(162, 155, 254, 0)');

            this.effectsCtx.fillStyle = gradient;
            this.effectsCtx.fillRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }
    }

    updateGlacialLightning() {
        for (let i = this.glacialLightning.length - 1; i >= 0; i--) {
            const lightning = this.glacialLightning[i];
            lightning.life -= 0.012;
            lightning.opacity = lightning.life;
            lightning.pulsePhase += 0.12;

            if (lightning.life <= 0) {
                this.glacialLightning.splice(i, 1);
                continue;
            }

            const pulseOpacity = lightning.opacity * (0.75 + Math.sin(lightning.pulsePhase) * 0.25);

            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    // Outer glow
                    this.effectsCtx.beginPath();
                    this.effectsCtx.moveTo(segment.x1, segment.y1);
                    this.effectsCtx.lineTo(segment.x2, segment.y2);
                    this.effectsCtx.strokeStyle = `rgba(116, 185, 255, ${pulseOpacity * 0.35})`;
                    this.effectsCtx.lineWidth = 10;
                    this.effectsCtx.lineCap = 'round';
                    this.effectsCtx.stroke();

                    // Middle glow
                    this.effectsCtx.beginPath();
                    this.effectsCtx.moveTo(segment.x1, segment.y1);
                    this.effectsCtx.lineTo(segment.x2, segment.y2);
                    this.effectsCtx.strokeStyle = `rgba(180, 220, 255, ${pulseOpacity * 0.65})`;
                    this.effectsCtx.lineWidth = 5;
                    this.effectsCtx.stroke();

                    // Core
                    this.effectsCtx.beginPath();
                    this.effectsCtx.moveTo(segment.x1, segment.y1);
                    this.effectsCtx.lineTo(segment.x2, segment.y2);
                    this.effectsCtx.strokeStyle = `rgba(230, 250, 255, ${pulseOpacity})`;
                    this.effectsCtx.lineWidth = 2;
                    this.effectsCtx.stroke();
                }
            }
        }
    }

    updateComboRings() {
        for (let i = this.comboRings.length - 1; i >= 0; i--) {
            const ring = this.comboRings[i];
            ring.radius += ring.expansionSpeed;
            ring.life -= 0.01;
            ring.opacity = ring.life * 0.8;
            ring.pulsePhase += 0.1;

            if (ring.life <= 0 || ring.radius > ring.maxRadius) {
                this.comboRings.splice(i, 1);
                continue;
            }

            const pulseOpacity = ring.opacity * (0.7 + Math.sin(ring.pulsePhase) * 0.3);

            // Outer ring glow
            this.effectsCtx.beginPath();
            this.effectsCtx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            this.effectsCtx.strokeStyle = `rgba(116, 185, 255, ${pulseOpacity * 0.4})`;
            this.effectsCtx.lineWidth = ring.thickness + 6;
            this.effectsCtx.stroke();

            // Main ring
            this.effectsCtx.beginPath();
            this.effectsCtx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            this.effectsCtx.strokeStyle = `rgba(200, 235, 255, ${pulseOpacity})`;
            this.effectsCtx.lineWidth = ring.thickness;
            this.effectsCtx.stroke();
        }
    }

    updateIceShardBurst() {
        for (let i = this.iceShardBurst.length - 1; i >= 0; i--) {
            const particle = this.iceShardBurst[i];

            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity;
            particle.vx *= 0.98;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.015;
            particle.opacity = particle.life * 0.85;
            particle.sparkle += 0.18;

            if (particle.life <= 0 || particle.y > this.effectsCanvas.height) {
                this.iceShardBurst.splice(i, 1);
                continue;
            }

            const sparkleIntensity = Math.sin(particle.sparkle) * 0.35 + 0.65;

            this.effectsCtx.save();
            this.effectsCtx.translate(particle.x, particle.y);
            this.effectsCtx.rotate(particle.rotation);

            // Glow
            const glowSize = particle.size * 3.5;
            const glowGradient = this.effectsCtx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
            const glowColor = particle.color === 'cyan' ? '116, 185, 255' : '200, 230, 255';
            glowGradient.addColorStop(0, `rgba(${glowColor}, ${particle.opacity * 0.7 * sparkleIntensity})`);
            glowGradient.addColorStop(0.5, `rgba(${glowColor}, ${particle.opacity * 0.4 * sparkleIntensity})`);
            glowGradient.addColorStop(1, `rgba(${glowColor}, 0)`);
            this.effectsCtx.fillStyle = glowGradient;
            this.effectsCtx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);

            // Ice shard shape (hexagon)
            this.effectsCtx.beginPath();
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 3) {
                const px = Math.cos(angle) * particle.size;
                const py = Math.sin(angle) * particle.size;
                if (angle === 0) {
                    this.effectsCtx.moveTo(px, py);
                } else {
                    this.effectsCtx.lineTo(px, py);
                }
            }
            this.effectsCtx.closePath();
            const fillColor = particle.color === 'cyan' ? `rgba(150, 215, 255, ${particle.opacity * sparkleIntensity})` : `rgba(230, 245, 255, ${particle.opacity * sparkleIntensity})`;
            this.effectsCtx.fillStyle = fillColor;
            this.effectsCtx.fill();

            // Highlight
            this.effectsCtx.beginPath();
            this.effectsCtx.arc(-particle.size * 0.2, -particle.size * 0.3, particle.size * 0.4, 0, Math.PI * 2);
            this.effectsCtx.fillStyle = `rgba(255, 255, 255, ${particle.opacity * 0.9 * sparkleIntensity})`;
            this.effectsCtx.fill();

            this.effectsCtx.restore();
        }
    }

    updateFrozenCrystals() {
        for (let i = this.frozenCrystals.length - 1; i >= 0; i--) {
            const crystal = this.frozenCrystals[i];

            crystal.x += (crystal.targetX - crystal.x) * 0.08;
            crystal.y += (crystal.targetY - crystal.y) * 0.08;
            crystal.rotation += crystal.rotationSpeed;
            crystal.life -= 0.012;
            crystal.opacity = crystal.life * 0.8;
            crystal.sparkle += 0.2;

            if (crystal.life <= 0) {
                this.frozenCrystals.splice(i, 1);
                continue;
            }

            const sparkleIntensity = Math.sin(crystal.sparkle) * 0.4 + 0.6;

            this.effectsCtx.save();
            this.effectsCtx.translate(crystal.x, crystal.y);
            this.effectsCtx.rotate(crystal.rotation);

            // Glow
            const glowSize = crystal.size * 2.5;
            const glowGradient = this.effectsCtx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
            glowGradient.addColorStop(0, `rgba(180, 220, 255, ${crystal.opacity * 0.6 * sparkleIntensity})`);
            glowGradient.addColorStop(1, 'rgba(160, 200, 240, 0)');
            this.effectsCtx.fillStyle = glowGradient;
            this.effectsCtx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);

            // Crystal
            this.effectsCtx.beginPath();
            this.effectsCtx.moveTo(0, -crystal.size);
            this.effectsCtx.lineTo(crystal.size * 0.5, 0);
            this.effectsCtx.lineTo(0, crystal.size);
            this.effectsCtx.lineTo(-crystal.size * 0.5, 0);
            this.effectsCtx.closePath();
            this.effectsCtx.fillStyle = `rgba(220, 240, 255, ${crystal.opacity * sparkleIntensity})`;
            this.effectsCtx.fill();

            this.effectsCtx.restore();
        }
    }

    updateIceStorm() {
        for (let i = this.iceStorm.length - 1; i >= 0; i--) {
            const particle = this.iceStorm[i];

            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.008;
            particle.opacity = particle.life * 0.7;

            if (particle.life <= 0 || particle.y > this.effectsCanvas.height) {
                this.iceStorm.splice(i, 1);
                continue;
            }

            this.effectsCtx.save();
            this.effectsCtx.translate(particle.x, particle.y);
            this.effectsCtx.rotate(particle.rotation);

            // Glow
            const glowGradient = this.effectsCtx.createRadialGradient(0, 0, 0, 0, 0, particle.size * 2);
            glowGradient.addColorStop(0, `rgba(200, 230, 255, ${particle.opacity * 0.5})`);
            glowGradient.addColorStop(1, 'rgba(180, 210, 240, 0)');
            this.effectsCtx.fillStyle = glowGradient;
            this.effectsCtx.fillRect(-particle.size * 2, -particle.size * 2, particle.size * 4, particle.size * 4);

            // Particle
            this.effectsCtx.beginPath();
            this.effectsCtx.arc(0, 0, particle.size, 0, Math.PI * 2);
            this.effectsCtx.fillStyle = `rgba(240, 250, 255, ${particle.opacity})`;
            this.effectsCtx.fill();

            this.effectsCtx.restore();
        }
    }

    createStars() {
        const container = this.getContainer('ice-temple-stars');
        if (!container) return;

        const width = container.clientWidth || 1920;
        const height = container.clientHeight || 1080;
        const cacheKey = `ice-temple-stars-${width}x${height}`;

        // Use canvas for static stars, only animate a few bright ones
        if (!iceTempleCache.has(cacheKey)) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: true });

            const rng = this.seededRandom(11111);
            // Draw 220 static stars on canvas
            for (let i = 0; i < 220; i++) {
                const size = rng() * 1.4 + 0.4;
                const x = rng() * width;
                const y = rng() * height;
                const opacity = 0.3 + rng() * 0.4;

                const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 0.7);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
                gradient.addColorStop(0.7, `rgba(255, 255, 255, ${opacity * 0.3})`);
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

                ctx.fillStyle = gradient;
                ctx.fillRect(x - size, y - size, size * 2, size * 2);
            }

            iceTempleCache.set(cacheKey, canvas.toDataURL('image/png'));
        }

        // Set canvas as background
        container.style.backgroundImage = `url(${iceTempleCache.get(cacheKey)})`;
        container.style.backgroundSize = 'cover';

        // Only animate 20 bright twinkling stars
        if (container.children.length) return;
        const rng = this.seededRandom(11112);
        for (let i = 0; i < 20; i++) {
            const star = document.createElement('div');
            star.className = 'ice-temple-star';
            const size = rng() * 1.6 + 0.8;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${rng() * 100}%`;
            star.style.top = `${rng() * 100}%`;
            star.style.setProperty('--min-opacity', `${0.4 + rng() * 0.3}`);
            star.style.setProperty('--max-opacity', `${0.7 + rng() * 0.3}`);
            star.style.setProperty('--twinkle-duration', `${3 + rng() * 2.5}s`);
            star.style.setProperty('--twinkle-delay', `${rng() * 4}s`);
            container.appendChild(star);
        }
    }

    createAurora() {
        const container = this.getContainer('ice-temple-aurora');
        if (!container || container.children.length) return;

        // Reduce from 4 to 3 aurora curtains for better performance
        const colors = ['#74b9ff', '#55efc4', '#a29bfe'];
        const rng = this.seededRandom(12222);
        for (let i = 0; i < 3; i++) {
            const curtain = document.createElement('div');
            curtain.className = 'ice-aurora-curtain';
            curtain.style.setProperty('--aurora-color', colors[i]);
            curtain.style.setProperty('--aurora-duration', `${24 + i * 5 + rng() * 4}s`);
            curtain.style.setProperty('--aurora-delay', `${i * 3}s`);
            curtain.style.left = `${i * 30}%`;
            curtain.style.width = `${35}%`; // Wider to maintain coverage
            if (i % 2 === 1) {
                curtain.style.animationDirection = 'alternate-reverse';
            }
            container.appendChild(curtain);
        }
    }

    createIceField() {
        const container = this.getContainer('ice-temple-icefield');
        if (!container) return;

        const width = 2200;
        const height = 900;
        const cacheKey = `ice-temple-icefield-${width}x${height}`;

        if (!iceTempleCache.has(cacheKey)) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
            baseGradient.addColorStop(0, '#0a1f35');
            baseGradient.addColorStop(0.4, '#0e3352');
            baseGradient.addColorStop(1, '#15526c');
            ctx.fillStyle = baseGradient;
            ctx.fillRect(0, 0, width, height);

            // Etch subtle ice ridges
            for (let i = 0; i < 140; i++) {
                const startX = Math.random() * width;
                const startY = height * (0.35 + Math.random() * 0.6);
                const length = 120 + Math.random() * 280;
                const slope = (Math.random() * 0.7) - 0.35;
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(startX + length, startY - length * slope);
                ctx.lineWidth = Math.random() * 1.4 + 0.2;
                ctx.strokeStyle = `rgba(220, 245, 255, ${0.015 + Math.random() * 0.05})`;
                ctx.stroke();
            }

            // Scatter crystalline facets
            for (let i = 0; i < 1100; i++) {
                const radius = Math.random() * 1.6 + 0.2;
                const alpha = 0.015 + Math.random() * 0.03;
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.beginPath();
                ctx.arc(Math.random() * width, height * (0.25 + Math.random() * 0.75), radius, 0, Math.PI * 2);
                ctx.fill();
            }

            const dataURL = `url(${canvas.toDataURL('image/png')})`;
            iceTempleCache.set(cacheKey, {
                backgroundImage: dataURL,
                backgroundSize: `${width}px ${height}px`,
            });
        }

        const cached = iceTempleCache.get(cacheKey);
        container.style.backgroundImage = cached.backgroundImage;
        container.style.backgroundSize = cached.backgroundSize;
    }

    createCrackNetwork() {
        const container = this.getContainer('ice-temple-cracks');
        if (!container || container.children.length) return;

        // Reduce crack count from 20 to 10 for better performance
        const rng = this.seededRandom(13337);
        const crackCount = 10;
        for (let i = 0; i < crackCount; i++) {
            const crack = document.createElement('div');
            crack.className = 'ice-temple-crack';
            crack.style.left = `${rng() * 100}%`;
            crack.style.top = `${55 + rng() * 40}%`;
            crack.style.setProperty('--crack-length', `${28 + rng() * 50}vh`); // Longer cracks
            crack.style.setProperty('--crack-thickness', `${0.9 + rng() * 2}px`); // Slightly thicker
            crack.style.setProperty('--crack-rotate', `${-40 + rng() * 80}deg`);
            crack.style.setProperty('--crack-delay', `${rng() * 6}s`);
            crack.style.setProperty('--crack-glow', `${0.4 + rng() * 0.4}`);
            const glintDuration = 5 + rng() * 4;
            crack.style.setProperty('--crack-glint-duration', `${glintDuration}s`);
            crack.style.setProperty('--crack-phase', `-${rng() * glintDuration}s`);
            if (rng() > 0.5) {
                crack.classList.add('branching');
                crack.style.setProperty('--branch-rotate', `${-35 + rng() * 70}deg`);
                crack.style.setProperty('--branch-length', `${15 + rng() * 25}vh`); // Longer branches
            }
            container.appendChild(crack);
        }
    }

    createFrostHaze() {
        const container = this.getContainer('ice-temple-ice-shards');
        if (!container || container.children.length) return;

        // Reduce frost haze count from 12 to 6 for better performance
        const rng = this.seededRandom(17777);
        const spriteCount = 6;
        for (let i = 0; i < spriteCount; i++) {
            const haze = document.createElement('div');
            haze.className = 'ice-temple-frost-haze';
            const size = 120 + rng() * 180; // Much larger to maintain visual density
            haze.style.width = `${size}px`;
            haze.style.height = `${size}px`;
            haze.style.left = `${rng() * 100}%`;
            haze.style.top = `${rng() * 100}%`;
            const duration = 20 + rng() * 16;
            haze.style.setProperty('--haze-duration', `${duration}s`);
            haze.style.setProperty('--haze-delay', `-${rng() * duration}s`);
            haze.style.setProperty('--haze-drift-x', `${rng() * 20 - 10}vw`);
            haze.style.setProperty('--haze-drift-y', `${rng() * 12 - 6}vh`);
            haze.style.setProperty('--haze-scale', `${0.8 + rng() * 0.8}`);
            haze.style.setProperty('--haze-opacity', `${0.18 + rng() * 0.3}`);
            container.appendChild(haze);
        }
    }

    createMistLayers() {
        const container = this.getContainer('ice-temple-mist');
        if (!container || container.children.length) return;

        // Reduce from 3 to 2 mist layers for better performance
        for (let i = 0; i < 2; i++) {
            const mist = document.createElement('div');
            mist.className = 'ice-temple-mist-layer';
            mist.style.setProperty('--mist-duration', `${26 + i * 10}s`);
            mist.style.setProperty('--mist-delay', `${i * -5}s`);
            mist.style.opacity = `${0.14 + i * 0.08}`; // Slightly more visible
            mist.dataset.layer = i === 0 ? 'back' : 'front';
            container.appendChild(mist);
        }
    }

    createSnowfall() {
        const container = this.getContainer('ice-temple-snow');
        if (!container || container.children.length) return;

        // Reduce snowflake count from 45 to 25 for better performance
        const rng = this.seededRandom(15555);
        const flakeCount = 25;
        for (let i = 0; i < flakeCount; i++) {
            const snowflake = document.createElement('div');
            snowflake.className = 'ice-temple-snowflake';
            const size = rng() * 2.6 + 1.5; // Larger to compensate for fewer flakes
            snowflake.style.width = `${size}px`;
            snowflake.style.height = `${size}px`;
            snowflake.style.left = `${rng() * 100}%`;

            const depthFactor = rng();
            const duration = 12 + depthFactor * 10;
            snowflake.style.setProperty('--fall-duration', `${duration}s`);
            snowflake.style.setProperty('--fall-delay', `-${rng() * duration}s`);
            snowflake.style.setProperty('--sway-amount', `${rng() * 60 - 30}px`);
            snowflake.style.setProperty('--snow-scale', `${0.8 + depthFactor * 1}`);
            snowflake.style.setProperty('--snow-opacity', `${0.45 + (1 - depthFactor) * 0.5}`);
            container.appendChild(snowflake);
        }
    }

    createRefractions() {
        const container = this.getContainer('ice-temple-refractions');
        if (!container || container.children.length) return;

        const colors = [
            'rgba(116, 185, 255, 0.5)',
            'rgba(255, 255, 255, 0.45)',
            'rgba(162, 155, 254, 0.4)',
            'rgba(137, 217, 255, 0.5)',
        ];
        const rng = this.seededRandom(16666);
        // Reduce from 14 to 8 rays for better performance
        for (let i = 0; i < 8; i++) {
            const ray = document.createElement('div');
            ray.className = 'ice-refraction-ray';
            ray.style.left = `${rng() * 100}%`;
            ray.style.top = `${rng() * 100}%`;
            ray.style.setProperty('--ray-color', colors[i % colors.length]);
            ray.style.setProperty('--ray-angle', `${rng() * 360}deg`);
            ray.style.setProperty('--ray-rotation-duration', `${28 + rng() * 18}s`);
            ray.style.setProperty('--ray-pulse-duration', `${2 + rng() * 2.5}s`);
            ray.style.setProperty('--ray-delay', `${rng() * 8}s`);
            container.appendChild(ray);
        }
    }

    stop() {
        // Cancel animation frame
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Teardown event listeners
        this.teardownEventListeners();
        this.pendingComboCount = 0;

        // Clean up effects canvas
        if (this.effectsCanvas) {
            this.effectsCanvas.remove();
            this.effectsCanvas = null;
            this.effectsCtx = null;
        }

        // Clear all effect arrays
        this.iceShardBurst = [];
        this.auroraWaves = [];
        this.frozenCrystals = [];
        this.comboRings = [];
        this.glacialLightning = [];
        this.iceStorm = [];

        // Reset state
        this.auroraIntensity = 0.85;
        this.targetAuroraIntensity = 0.85;
        this.crackGlow = 0;
        this.flashIntensity = 0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;

        super.stop();
    }
}

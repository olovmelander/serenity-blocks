import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class WinterTheme extends BaseTheme {
    constructor() {
        super('winter');
        this.canvas = null;
        this.ctx = null;
        this.snowParticles = [];
        this.windForce = 0;
        this.targetWindForce = 0;
        this.nextWindChange = 0;
        this.gustIntensity = 0;
        this.nextGust = 0;
        this.gustDuration = 0;
        this.time = 0;
        this.maxParticles = 1200;
        this.resizeHandler = null;
        this.vortexParticles = [];
        this.groundSnow = [];
        this.streakParticles = [];
        this.spiralSystems = [];
        this.cameraShake = { x: 0, y: 0, intensity: 0 };
        this.distortionWaves = [];
        this.flashIntensity = 0;
        this.nextFlash = 0;

        // Gameplay integration
        this.comboMultiplier = 1.0;
        this.comboDecay = 0;
        this.iceBurstParticles = [];
        this.frozenLightning = [];
        this.comboVortexes = [];
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
    }

    async createScene() {
        this.canvas = document.getElementById('winter-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', { alpha: true });

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        // Initialize snow particles across different depth layers
        this.snowParticles = [];
        for (let i = 0; i < this.maxParticles; i++) {
            this.snowParticles.push(this.createSnowParticle(true));
        }

        // Initialize ground snow accumulation
        this.groundSnow = [];
        for (let i = 0; i < 50; i++) {
            this.groundSnow.push({
                x: Math.random() * this.canvas.width,
                y: this.canvas.height - Math.random() * 100,
                size: Math.random() * 4 + 2,
                opacity: Math.random() * 0.3 + 0.1,
                drift: Math.random() * 0.5 - 0.25,
            });
        }

        this.setupEventListeners();

        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
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
        if (!this.eventUnsubscribers.length) {
            return;
        }

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[WinterTheme] Failed to remove event listener', error);
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

    // Event handlers
    handleLineClear(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        console.log(`[WinterTheme] Line clear event: ${lineCount} lines, combo: ${comboCount}`, detail);
        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }

        console.log(`[WinterTheme] Combo event: ${comboCount}`, detail);
        // Combo is already handled in line clear
    }

    // Called by game when lines are cleared
    onLineClear(lineCount, comboCount) {
        console.log(`[WinterTheme] Processing line clear: ${lineCount} lines, combo: ${comboCount}`);

        // Increase combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.comboDecay = 180; // 3 seconds at 60fps

        // Create ice burst from center of screen
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // More particles for more lines
        const burstCount = lineCount * 30 + comboCount * 20;
        for (let i = 0; i < burstCount; i++) {
            this.iceBurstParticles.push(this.createIceBurstParticle(centerX, centerY, lineCount));
        }

        // Trigger wind gust based on line count
        const gustBonus = lineCount * 2 + comboCount;
        this.targetWindForce = (Math.random() < 0.5 ? -1 : 1) * (8 + gustBonus);
        this.gustIntensity = Math.min(0.5 + lineCount * 0.15, 1.0);
        this.gustDuration = 40 + lineCount * 20;

        // Screen shake based on combo
        if (comboCount >= 3) {
            this.cameraShake.intensity = Math.min(comboCount * 2, 15);
        }

        // Create frozen lightning on big combos
        if (comboCount >= 5) {
            this.createFrozenLightning(centerX, centerY);
        }

        // Spawn combo vortexes for massive combos
        if (comboCount >= 8) {
            for (let i = 0; i < Math.floor(comboCount / 4); i++) {
                const vortex = this.createComboVortex(
                    Math.random() * this.canvas.width,
                    Math.random() * this.canvas.height * 0.5
                );
                this.comboVortexes.push(vortex);
            }
        }

        // Flash effect
        this.flashIntensity = Math.min(0.15 + lineCount * 0.05, 0.4);
    }

    createIceBurstParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 15 + 5 + lineCount * 2;
        const size = Math.random() * 4 + 2;

        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: size,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
            gravity: 0.3,
            glowIntensity: Math.random() * 0.5 + 0.5,
            sparkle: Math.random() * Math.PI * 2,
        };
    }

    createFrozenLightning(x, y) {
        const branches = [];
        const numBranches = Math.floor(Math.random() * 3) + 4;

        for (let i = 0; i < numBranches; i++) {
            const angle = (Math.PI * 2 / numBranches) * i + Math.random() * 0.5;
            const segments = [];
            let currentX = x;
            let currentY = y;

            for (let j = 0; j < 8; j++) {
                const length = Math.random() * 80 + 40;
                const nextX = currentX + Math.cos(angle + (Math.random() - 0.5) * 0.8) * length;
                const nextY = currentY + Math.sin(angle + (Math.random() - 0.5) * 0.8) * length;

                segments.push({
                    x1: currentX,
                    y1: currentY,
                    x2: nextX,
                    y2: nextY,
                });

                currentX = nextX;
                currentY = nextY;
            }

            branches.push(segments);
        }

        this.frozenLightning.push({
            branches: branches,
            opacity: 1.0,
            life: 1.0,
            pulsePhase: 0,
        });
    }

    createComboVortex(x, y) {
        return {
            x: x,
            y: y,
            particles: [],
            angle: 0,
            radius: 0,
            maxRadius: Math.random() * 200 + 150,
            spinSpeed: 0.15,
            expansionRate: 3,
            life: 1.0,
            direction: Math.random() < 0.5 ? 1 : -1,
            intensity: 1.0,
        };
    }

    createSnowParticle(isInitial) {
        const depth = Math.random(); // 0 = far, 1 = near
        const depthScale = 0.2 + depth * 0.8;

        return {
            x: isInitial ? Math.random() * this.canvas.width : Math.random() * this.canvas.width * 1.2 - this.canvas.width * 0.1,
            y: isInitial ? Math.random() * this.canvas.height : -Math.random() * 50,
            z: depth,
            size: (Math.random() * 3 + 0.5) * depthScale,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() * 2 + 0.5) * depthScale,
            opacity: (Math.random() * 0.7 + 0.3) * (0.4 + depth * 0.6),
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.08,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.03 + 0.01,
            trail: [],
            maxTrailLength: Math.floor(4 + depth * 8),
        };
    }

    createStreakParticle() {
        const side = Math.random() < 0.5 ? -100 : this.canvas.width + 100;
        const direction = side < 0 ? 1 : -1;

        return {
            x: side,
            y: Math.random() * this.canvas.height,
            vx: direction * (Math.random() * 30 + 20),
            vy: (Math.random() - 0.5) * 5,
            length: Math.random() * 150 + 100,
            size: Math.random() * 3 + 1,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
        };
    }

    createVortexParticle(x, y) {
        return {
            x: x,
            y: y,
            angle: Math.random() * Math.PI * 2,
            speed: Math.random() * 4 + 2,
            size: Math.random() * 2.5 + 1,
            opacity: Math.random() * 0.9 + 0.3,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.3,
        };
    }

    createSpiralSystem(x, y) {
        return {
            x: x,
            y: y,
            particles: [],
            angle: 0,
            radius: 0,
            maxRadius: Math.random() * 150 + 100,
            spinSpeed: (Math.random() - 0.5) * 0.1,
            expansionRate: Math.random() * 2 + 1,
            life: 1.0,
            direction: Math.random() < 0.5 ? 1 : -1,
        };
    }

    createDistortionWave() {
        return {
            x: Math.random() * this.canvas.width,
            y: 0,
            width: Math.random() * 200 + 100,
            height: this.canvas.height,
            speed: Math.random() * 3 + 2,
            opacity: Math.random() * 0.3 + 0.2,
            life: 1.0,
        };
    }

    animate() {
        if (!this.isActive) {
            return;
        }

        this.time += 1;

        // Decay combo multiplier
        if (this.comboDecay > 0) {
            this.comboDecay -= 1;
            if (this.comboDecay === 0) {
                this.comboMultiplier = 1.0;
            }
        }

        // Dynamic wind system with powerful gusts (amplified by combos)
        if (this.time >= this.nextWindChange) {
            this.targetWindForce = (Math.random() - 0.5) * 8 * this.comboMultiplier; // Affected by combo
            this.nextWindChange = this.time + Math.random() * 150 + 100;
        }

        // Wind gust system (more frequent and MORE intense with combos)
        if (this.time >= this.nextGust && this.gustDuration <= 0) {
            const gustStrength = (Math.random() * 8 + 6) * this.comboMultiplier; // Combo makes it stronger
            const gustDirection = Math.random() < 0.5 ? -1 : 1;
            this.targetWindForce = gustDirection * gustStrength;
            this.gustIntensity = 1.0;
            this.gustDuration = Math.random() * 80 + 50;
            this.nextGust = this.time + Math.random() * 250 + 150;

            // SCREEN SHAKE during powerful gusts
            if (gustStrength > 10) {
                this.cameraShake.intensity = Math.min(gustStrength * 0.8, 12);
            }

            // Spawn horizontal streak particles during strong gusts
            if (gustStrength > 8) {
                for (let i = 0; i < 30; i++) {
                    this.streakParticles.push(this.createStreakParticle());
                }
            }

            // Spawn vortex particles during strong gusts
            if (gustStrength > 7) {
                for (let i = 0; i < 30; i++) {
                    const x = Math.random() * this.canvas.width;
                    const y = Math.random() * this.canvas.height * 0.7;
                    this.vortexParticles.push(this.createVortexParticle(x, y));
                }
            }

            // Create spiral systems during extreme gusts
            if (gustStrength > 11) {
                for (let i = 0; i < 3; i++) {
                    const spiral = this.createSpiralSystem(
                        Math.random() * this.canvas.width,
                        Math.random() * this.canvas.height * 0.6
                    );
                    this.spiralSystems.push(spiral);
                }

                // Add distortion waves
                for (let i = 0; i < 5; i++) {
                    this.distortionWaves.push(this.createDistortionWave());
                }
            }
        }

        // Fade gust intensity
        if (this.gustDuration > 0) {
            this.gustDuration -= 1;
            this.gustIntensity = Math.max(0, this.gustDuration / 80);
        } else {
            this.gustIntensity = 0;
        }

        // Camera shake decay
        if (this.cameraShake.intensity > 0) {
            this.cameraShake.intensity *= 0.92;
            this.cameraShake.x = (Math.random() - 0.5) * this.cameraShake.intensity;
            this.cameraShake.y = (Math.random() - 0.5) * this.cameraShake.intensity;
        } else {
            this.cameraShake.x = 0;
            this.cameraShake.y = 0;
        }

        // Smooth wind transition
        const windTransitionSpeed = this.gustIntensity > 0 ? 0.12 : 0.03;
        this.windForce += (this.targetWindForce - this.windForce) * windTransitionSpeed;

        // Random atmospheric flashes during extreme winds
        if (this.time >= this.nextFlash && Math.abs(this.windForce) > 8) {
            this.flashIntensity = 0.15;
            this.nextFlash = this.time + Math.random() * 200 + 100;
        }
        if (this.flashIntensity > 0) {
            this.flashIntensity *= 0.85;
        }

        // Apply camera shake
        this.ctx.save();
        this.ctx.translate(this.cameraShake.x, this.cameraShake.y);

        // Dark atmospheric background with dynamic lighting (combo affects brightness)
        const comboBoost = Math.floor((this.comboMultiplier - 1) * 20);
        const flashBoost = Math.floor(this.flashIntensity * 40);
        const gustBoost = Math.floor(this.gustIntensity * 15);
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, `rgb(${5 + flashBoost + comboBoost}, ${8 + flashBoost + comboBoost}, ${15 + flashBoost + comboBoost})`);
        gradient.addColorStop(0.4, `rgb(${8 + flashBoost + gustBoost + comboBoost}, ${12 + flashBoost + gustBoost + comboBoost}, ${20 + flashBoost + gustBoost + comboBoost})`);
        gradient.addColorStop(0.7, `rgb(${12 + gustBoost}, ${16 + gustBoost}, ${24 + gustBoost})`);
        gradient.addColorStop(1, `rgb(${18 + gustBoost}, ${22 + gustBoost}, ${30 + gustBoost})`);
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Add atmospheric depth fog
        const fogGradient = this.ctx.createRadialGradient(
            this.canvas.width / 2, this.canvas.height * 0.6, 0,
            this.canvas.width / 2, this.canvas.height * 0.6, this.canvas.width * 0.8
        );
        fogGradient.addColorStop(0, `rgba(${20 + gustBoost * 2 + comboBoost}, ${25 + gustBoost * 2 + comboBoost}, ${35 + gustBoost * 2 + comboBoost}, 0.4)`);
        fogGradient.addColorStop(0.5, `rgba(${15 + gustBoost}, ${20 + gustBoost}, ${30 + gustBoost}, 0.25)`);
        fogGradient.addColorStop(1, 'rgba(10, 15, 25, 0)');
        this.ctx.fillStyle = fogGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw frozen lightning
        for (let i = this.frozenLightning.length - 1; i >= 0; i--) {
            const lightning = this.frozenLightning[i];
            lightning.life -= 0.015;
            lightning.opacity = lightning.life;
            lightning.pulsePhase += 0.1;

            if (lightning.life <= 0) {
                this.frozenLightning.splice(i, 1);
                continue;
            }

            const pulseOpacity = lightning.opacity * (0.7 + Math.sin(lightning.pulsePhase) * 0.3);

            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    // Outer glow
                    this.ctx.beginPath();
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                    this.ctx.strokeStyle = `rgba(180, 220, 255, ${pulseOpacity * 0.3})`;
                    this.ctx.lineWidth = 8;
                    this.ctx.lineCap = 'round';
                    this.ctx.stroke();

                    // Middle glow
                    this.ctx.beginPath();
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                    this.ctx.strokeStyle = `rgba(200, 235, 255, ${pulseOpacity * 0.6})`;
                    this.ctx.lineWidth = 4;
                    this.ctx.stroke();

                    // Core
                    this.ctx.beginPath();
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                    this.ctx.strokeStyle = `rgba(230, 245, 255, ${pulseOpacity})`;
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                }
            }
        }

        // Draw and update combo vortexes
        for (let i = this.comboVortexes.length - 1; i >= 0; i--) {
            const vortex = this.comboVortexes[i];

            vortex.angle += vortex.spinSpeed * vortex.direction;
            vortex.radius += vortex.expansionRate;
            vortex.life -= 0.005;
            vortex.intensity = vortex.life;

            // Spawn particles along the vortex
            if (Math.random() < 0.7 && vortex.radius < vortex.maxRadius) {
                const particleAngle = vortex.angle + Math.random() * Math.PI * 0.3;
                const particleRadius = vortex.radius + Math.random() * 40;
                vortex.particles.push({
                    x: vortex.x + Math.cos(particleAngle) * particleRadius,
                    y: vortex.y + Math.sin(particleAngle) * particleRadius,
                    size: Math.random() * 4 + 2,
                    opacity: Math.random() * 0.9 + 0.3,
                    vx: Math.cos(particleAngle) * 3,
                    vy: Math.sin(particleAngle) * 3,
                    life: 1.0,
                    sparkle: Math.random() * Math.PI * 2,
                });
            }

            // Update and draw vortex particles
            for (let j = vortex.particles.length - 1; j >= 0; j--) {
                const p = vortex.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.015;
                p.opacity = p.life * vortex.intensity;
                p.sparkle += 0.2;

                if (p.life <= 0) {
                    vortex.particles.splice(j, 1);
                    continue;
                }

                const sparkleEffect = Math.sin(p.sparkle) * 0.3 + 0.7;

                // Glow
                const glowGradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
                glowGradient.addColorStop(0, `rgba(200, 230, 255, ${p.opacity * 0.6 * sparkleEffect})`);
                glowGradient.addColorStop(1, 'rgba(180, 210, 240, 0)');
                this.ctx.fillStyle = glowGradient;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
                this.ctx.fill();

                // Core
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(240, 250, 255, ${p.opacity * sparkleEffect})`;
                this.ctx.fill();
            }

            if (vortex.life <= 0 || vortex.radius > vortex.maxRadius) {
                this.comboVortexes.splice(i, 1);
            }
        }

        // Draw and update ice burst particles
        for (let i = this.iceBurstParticles.length - 1; i >= 0; i--) {
            const particle = this.iceBurstParticles[i];

            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity;
            particle.vx *= 0.98;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.02;
            particle.opacity = particle.life * 0.9;
            particle.sparkle += 0.15;

            if (particle.life <= 0 || particle.y > this.canvas.height) {
                this.iceBurstParticles.splice(i, 1);
                continue;
            }

            const sparkleIntensity = Math.sin(particle.sparkle) * 0.4 + 0.6;

            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);

            // Glow
            const glowSize = particle.size * 3 * particle.glowIntensity;
            const glowGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
            glowGradient.addColorStop(0, `rgba(200, 230, 255, ${particle.opacity * 0.6 * sparkleIntensity})`);
            glowGradient.addColorStop(0.5, `rgba(180, 215, 245, ${particle.opacity * 0.3 * sparkleIntensity})`);
            glowGradient.addColorStop(1, 'rgba(160, 200, 235, 0)');
            this.ctx.fillStyle = glowGradient;
            this.ctx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);

            // Ice shard shape
            this.ctx.beginPath();
            this.ctx.moveTo(0, -particle.size);
            this.ctx.lineTo(particle.size * 0.5, particle.size * 0.5);
            this.ctx.lineTo(-particle.size * 0.5, particle.size * 0.5);
            this.ctx.closePath();
            this.ctx.fillStyle = `rgba(220, 240, 255, ${particle.opacity * sparkleIntensity})`;
            this.ctx.fill();

            // Highlight
            this.ctx.beginPath();
            this.ctx.arc(-particle.size * 0.2, -particle.size * 0.3, particle.size * 0.3, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 255, 255, ${particle.opacity * 0.8 * sparkleIntensity})`;
            this.ctx.fill();

            this.ctx.restore();
        }

        // Draw and update distortion waves
        for (let i = this.distortionWaves.length - 1; i >= 0; i--) {
            const wave = this.distortionWaves[i];
            wave.y += wave.speed;
            wave.life -= 0.01;

            if (wave.life <= 0 || wave.y > this.canvas.height) {
                this.distortionWaves.splice(i, 1);
                continue;
            }

            const waveGradient = this.ctx.createLinearGradient(
                wave.x - wave.width / 2, wave.y,
                wave.x + wave.width / 2, wave.y
            );
            waveGradient.addColorStop(0, 'rgba(200, 215, 235, 0)');
            waveGradient.addColorStop(0.5, `rgba(220, 230, 245, ${wave.opacity * wave.life})`);
            waveGradient.addColorStop(1, 'rgba(200, 215, 235, 0)');
            this.ctx.fillStyle = waveGradient;
            this.ctx.fillRect(wave.x - wave.width / 2, 0, wave.width, this.canvas.height);
        }

        // Draw and update ground snow
        for (let i = this.groundSnow.length - 1; i >= 0; i--) {
            const snow = this.groundSnow[i];
            snow.x += this.windForce * 0.08 + snow.drift;

            // Wrap around
            if (snow.x < -10) snow.x = this.canvas.width + 10;
            if (snow.x > this.canvas.width + 10) snow.x = -10;

            this.ctx.beginPath();
            this.ctx.arc(snow.x, snow.y, snow.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(200, 210, 225, ${snow.opacity})`;
            this.ctx.fill();
        }

        // Update and draw spiral systems
        for (let i = this.spiralSystems.length - 1; i >= 0; i--) {
            const spiral = this.spiralSystems[i];

            spiral.angle += spiral.spinSpeed * spiral.direction;
            spiral.radius += spiral.expansionRate;
            spiral.life -= 0.008;

            // Spawn particles along the spiral
            if (Math.random() < 0.5 && spiral.radius < spiral.maxRadius) {
                const particleAngle = spiral.angle + Math.random() * Math.PI * 0.2;
                const particleRadius = spiral.radius + Math.random() * 30;
                spiral.particles.push({
                    x: spiral.x + Math.cos(particleAngle) * particleRadius,
                    y: spiral.y + Math.sin(particleAngle) * particleRadius,
                    size: Math.random() * 3 + 1,
                    opacity: Math.random() * 0.8 + 0.2,
                    vx: Math.cos(particleAngle) * 2,
                    vy: Math.sin(particleAngle) * 2,
                    life: 1.0,
                });
            }

            // Update and draw spiral particles
            for (let j = spiral.particles.length - 1; j >= 0; j--) {
                const p = spiral.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                p.opacity = p.life * 0.9;

                if (p.life <= 0) {
                    spiral.particles.splice(j, 1);
                    continue;
                }

                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(230, 240, 255, ${p.opacity})`;
                this.ctx.fill();
            }

            if (spiral.life <= 0 || spiral.radius > spiral.maxRadius) {
                this.spiralSystems.splice(i, 1);
            }
        }

        // Update and draw horizontal streak particles
        for (let i = this.streakParticles.length - 1; i >= 0; i--) {
            const streak = this.streakParticles[i];

            streak.x += streak.vx;
            streak.y += streak.vy;
            streak.life -= 0.015;
            streak.opacity = streak.life * 0.9;

            if (streak.life <= 0 ||
                streak.x < -200 ||
                streak.x > this.canvas.width + 200) {
                this.streakParticles.splice(i, 1);
                continue;
            }

            // Draw long horizontal streak
            const streakGradient = this.ctx.createLinearGradient(
                streak.x, streak.y,
                streak.x - Math.sign(streak.vx) * streak.length, streak.y
            );
            streakGradient.addColorStop(0, `rgba(240, 245, 255, ${streak.opacity})`);
            streakGradient.addColorStop(0.3, `rgba(220, 230, 245, ${streak.opacity * 0.6})`);
            streakGradient.addColorStop(1, 'rgba(200, 215, 235, 0)');

            this.ctx.beginPath();
            this.ctx.moveTo(streak.x, streak.y);
            this.ctx.lineTo(streak.x - Math.sign(streak.vx) * streak.length, streak.y);
            this.ctx.strokeStyle = streakGradient;
            this.ctx.lineWidth = streak.size;
            this.ctx.lineCap = 'round';
            this.ctx.stroke();
        }

        // Update and draw vortex particles
        for (let i = this.vortexParticles.length - 1; i >= 0; i--) {
            const particle = this.vortexParticles[i];

            particle.x += Math.cos(particle.angle) * particle.speed;
            particle.y += Math.sin(particle.angle) * particle.speed * 0.5;
            particle.angle += 0.15;
            particle.rotation += particle.rotationSpeed;
            particle.life -= 0.012;
            particle.opacity = particle.life * 0.9;

            if (particle.life <= 0 || particle.y > this.canvas.height) {
                this.vortexParticles.splice(i, 1);
                continue;
            }

            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);
            this.ctx.globalAlpha = particle.opacity;
            this.ctx.fillStyle = 'rgb(225, 235, 250)';
            this.ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
            this.ctx.restore();
        }

        // Spawn new snow particles during gusts (more during combos)
        const spawnChance = (0.8 + this.gustIntensity * 0.4) * this.comboMultiplier;
        const maxParticlesWithCombo = Math.floor(this.maxParticles * this.comboMultiplier);
        if (this.snowParticles.length < maxParticlesWithCombo && Math.random() < spawnChance) {
            this.snowParticles.push(this.createSnowParticle(false));
        }

        // Draw and update snow particles (sorted by depth for proper layering)
        this.snowParticles.sort((a, b) => a.z - b.z);

        for (let i = this.snowParticles.length - 1; i >= 0; i--) {
            const particle = this.snowParticles[i];

            // Wind influence increases with gust intensity and combo
            const windInfluence = this.windForce * (0.4 + particle.z * 0.6) * (1 + this.gustIntensity * 0.8) * this.comboMultiplier;
            const gustTurbulence = this.gustIntensity * (Math.random() - 0.5) * 3;

            particle.vx += (windInfluence + gustTurbulence - particle.vx) * 0.08;
            particle.wobble += particle.wobbleSpeed;

            // Horizontal movement with wobble
            particle.x += particle.vx + Math.sin(particle.wobble) * 0.8 * (1 + this.gustIntensity * 1.5);

            // Vertical movement (faster during gusts and combos)
            particle.y += particle.vy * (1 + this.gustIntensity * 0.7) * this.comboMultiplier;

            particle.rotation += particle.rotationSpeed * (1 + this.gustIntensity);

            // Trail system for motion blur
            particle.trail.unshift({ x: particle.x, y: particle.y, opacity: particle.opacity });
            if (particle.trail.length > particle.maxTrailLength) {
                particle.trail.pop();
            }

            // Remove particles that are off screen
            if (particle.y > this.canvas.height + 50 ||
                particle.x < -100 ||
                particle.x > this.canvas.width + 100) {
                this.snowParticles.splice(i, 1);
                continue;
            }

            // Draw motion trail
            for (let j = 1; j < particle.trail.length; j++) {
                const trailPoint = particle.trail[j];
                const trailOpacity = particle.opacity * (1 - j / particle.trail.length) * 0.6;
                const trailSize = particle.size * (1 - j / particle.trail.length * 0.5);

                this.ctx.beginPath();
                this.ctx.arc(trailPoint.x, trailPoint.y, trailSize, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(180, 195, 220, ${trailOpacity})`;
                this.ctx.fill();
            }

            // Draw main particle with rotation
            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);

            // Outer glow
            const glowSize = particle.size * 3.5;
            const glowGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, glowSize);
            glowGradient.addColorStop(0, `rgba(225, 235, 250, ${particle.opacity * 0.5})`);
            glowGradient.addColorStop(0.5, `rgba(205, 220, 240, ${particle.opacity * 0.25})`);
            glowGradient.addColorStop(1, 'rgba(185, 200, 225, 0)');
            this.ctx.fillStyle = glowGradient;
            this.ctx.fillRect(-glowSize, -glowSize, glowSize * 2, glowSize * 2);

            // Main particle (elongated for wind streak effect)
            const streakLength = 1 + Math.abs(this.windForce) * 0.4 * particle.z;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, particle.size, particle.size * streakLength,
                           Math.atan2(particle.vy, particle.vx), 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(240, 245, 255, ${particle.opacity})`;
            this.ctx.fill();

            // Highlight
            this.ctx.beginPath();
            this.ctx.arc(-particle.size * 0.2, -particle.size * 0.2, particle.size * 0.5, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 255, 255, ${particle.opacity * 0.7})`;
            this.ctx.fill();

            this.ctx.restore();
        }

        // Atmospheric overlay during intense gusts
        if (this.gustIntensity > 0.4) {
            const overlayOpacity = (this.gustIntensity - 0.4) * 0.4 * this.comboMultiplier;
            const overlayGradient = this.ctx.createLinearGradient(
                0, 0, this.canvas.width * (this.windForce > 0 ? 1 : -1), this.canvas.height
            );
            overlayGradient.addColorStop(0, `rgba(210, 220, 235, ${overlayOpacity})`);
            overlayGradient.addColorStop(0.5, `rgba(190, 205, 225, ${overlayOpacity * 0.6})`);
            overlayGradient.addColorStop(1, 'rgba(170, 185, 210, 0)');
            this.ctx.fillStyle = overlayGradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Add wind direction indicators (more prominent streaks)
        if (Math.abs(this.windForce) > 4) {
            const streakCount = Math.floor(Math.abs(this.windForce) * 2 * this.comboMultiplier);
            for (let i = 0; i < streakCount; i++) {
                const x = Math.random() * this.canvas.width;
                const y = Math.random() * this.canvas.height;
                const length = Math.abs(this.windForce) * 25 * (0.5 + Math.random() * 0.5);
                const angle = Math.atan2(1, this.windForce);

                this.ctx.beginPath();
                this.ctx.moveTo(x, y);
                this.ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length * 0.3);
                this.ctx.strokeStyle = `rgba(210, 225, 240, ${Math.random() * 0.25 + 0.1})`;
                this.ctx.lineWidth = Math.random() * 2 + 0.5;
                this.ctx.stroke();
            }
        }

        // Vignette effect for depth (more intense)
        const vignetteGradient = this.ctx.createRadialGradient(
            this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.2,
            this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.8
        );
        vignetteGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignetteGradient.addColorStop(1, `rgba(0, 0, 0, ${0.5 + this.gustIntensity * 0.2})`);
        this.ctx.fillStyle = vignetteGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.restore(); // Restore from camera shake

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        this.teardownEventListeners();
        this.pendingComboCount = 0;

        super.stop();
    }
}

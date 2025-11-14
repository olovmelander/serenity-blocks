import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class BloodMoonTheme extends BaseTheme {
    constructor() {
        super('blood-moon');
        this.canvas = null;
        this.ctx = null;
        this.resizeHandler = null;
        this.time = 0;
        this.stars = [];
        this.nebulaClouds = [];
        this.moonX = 0;
        this.moonY = 0;
        this.moonRadius = 0;
        this.moonFloatOffset = { x: 0, y: 0 };
        this.moonRotation = Math.random() * Math.PI * 2; // Random starting rotation

        // Random phase offsets for unique moon paths each time
        this.moonPhaseX = Math.random() * Math.PI * 2;
        this.moonPhaseY = Math.random() * Math.PI * 2;
        this.moonPhaseX2 = Math.random() * Math.PI * 2;
        this.moonPhaseY2 = Math.random() * Math.PI * 2;

        // Performance optimizations
        this.cachedGradients = {};
        this.craterData = [];
        this.moonGlowIntensity = 1.0;
        this.glowPulse = 0;

        // Performance limits
        this.MAX_PARTICLES = 150;
        this.MAX_LIGHTNING = 3;
        this.MAX_WAVES = 6;
        this.MAX_ORBS = 15;
        this.MAX_VORTEXES = 3;

        // Gameplay effects
        this.bloodBurstParticles = [];
        this.crimsonLightning = [];
        this.bloodWaves = [];
        this.moonPulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
        this.soulOrbs = [];
        this.bloodVortexes = [];
    }

    async createScene() {
        this.canvas = document.getElementById('blood-moon-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true // Better performance
        });

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        // Initialize stars
        this.createStars();

        // Initialize nebula clouds
        this.createNebulaClouds();

        // Initialize crater data for the moon
        this.createCraterData();

        // Setup gameplay event listeners
        this.setupEventListeners();

        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Moon size
        this.moonRadius = Math.min(this.canvas.width, this.canvas.height) * 0.15;

        // Initialize moon position if not set (first time)
        if (this.moonX === 0 && this.moonY === 0) {
            this.moonX = this.canvas.width * 0.5;
            this.moonY = this.canvas.height * 0.35;
        }

        // Pre-create gradients that don't change
        this.cacheGradients();
    }

    cacheGradients() {
        // Background gradient
        this.cachedGradients.background = this.ctx.createRadialGradient(
            this.canvas.width * 0.5, this.canvas.height * 0.3,
            0,
            this.canvas.width * 0.5, this.canvas.height * 0.3,
            this.canvas.height * 0.8
        );
        this.cachedGradients.background.addColorStop(0, '#1a0510');
        this.cachedGradients.background.addColorStop(0.3, '#0d0208');
        this.cachedGradients.background.addColorStop(0.6, '#0a0306');
        this.cachedGradients.background.addColorStop(1, '#000000');
    }

    createStars() {
        const starCount = 300;
        for (let i = 0; i < starCount; i++) {
            this.stars.push({
                x: Math.random(),
                y: Math.random(),
                size: Math.random() * 1.5 + 0.3,
                brightness: Math.random() * 0.6 + 0.4,
                twinkleSpeed: Math.random() * 0.02 + 0.005,
                twinklePhase: Math.random() * Math.PI * 2,
                color: Math.random() > 0.7 ? 'red' : 'white' // Some stars have red tint
            });
        }
    }

    createNebulaClouds() {
        const cloudCount = 15; // Increased from 8
        for (let i = 0; i < cloudCount; i++) {
            this.nebulaClouds.push({
                x: Math.random(),
                y: Math.random() * 0.9 + 0.05, // Spread across more of the screen
                size: Math.random() * 300 + 150, // Larger clouds
                opacity: Math.random() * 0.18 + 0.08, // More visible (increased from 0.08)
                speed: Math.random() * 0.0003 + 0.0001, // Faster drift (3x faster)
                phase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.01 + 0.005, // Add pulsing
                pulsePhase: Math.random() * Math.PI * 2
            });
        }
    }

    createCraterData() {
        // Create realistic crater positions and sizes
        const craterCount = 25;
        for (let i = 0; i < craterCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 0.8; // Within 80% of moon radius

            this.craterData.push({
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance,
                size: Math.random() * 0.15 + 0.03,
                depth: Math.random() * 0.4 + 0.3
            });
        }
    }

    drawBackground() {
        // Draw deep space background with red tint
        this.ctx.fillStyle = this.cachedGradients.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Add enhanced red atmospheric glow across the scene
        const centerX = this.canvas.width * 0.5;
        const centerY = this.canvas.height * 0.35;
        const atmosphereGradient = this.ctx.createRadialGradient(
            centerX, centerY,
            this.canvas.height * 0.2,
            centerX, centerY,
            this.canvas.height * 0.8
        );
        atmosphereGradient.addColorStop(0, 'rgba(120, 10, 25, 0.12)'); // More intense
        atmosphereGradient.addColorStop(0.4, 'rgba(100, 5, 20, 0.08)');
        atmosphereGradient.addColorStop(0.7, 'rgba(80, 0, 15, 0.04)');
        atmosphereGradient.addColorStop(1, 'rgba(40, 0, 10, 0)');
        this.ctx.fillStyle = atmosphereGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawStars(moonX, moonY) {
        for (const star of this.stars) {
            const x = star.x * this.canvas.width;
            const y = star.y * this.canvas.height;

            // Skip stars behind the moon
            const dx = x - moonX;
            const dy = y - moonY;
            if (Math.sqrt(dx * dx + dy * dy) < this.moonRadius * 1.2) continue;

            // Twinkling effect
            star.twinklePhase += star.twinkleSpeed;
            const twinkle = Math.sin(star.twinklePhase) * 0.3 + 0.7;
            const alpha = star.brightness * twinkle;

            if (star.color === 'red') {
                this.ctx.fillStyle = `rgba(255, 150, 150, ${alpha})`;
            } else {
                this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            }

            // Draw star with subtle glow
            this.ctx.beginPath();
            this.ctx.arc(x, y, star.size, 0, Math.PI * 2);
            this.ctx.fill();

            // Add glow for brighter stars
            if (star.size > 1) {
                this.ctx.beginPath();
                this.ctx.arc(x, y, star.size * 2, 0, Math.PI * 2);
                this.ctx.fillStyle = star.color === 'red'
                    ? `rgba(255, 100, 100, ${alpha * 0.2})`
                    : `rgba(255, 255, 255, ${alpha * 0.2})`;
                this.ctx.fill();
            }
        }
    }

    drawNebulaClouds() {
        for (const cloud of this.nebulaClouds) {
            cloud.phase += cloud.speed;
            cloud.pulsePhase += cloud.pulseSpeed;

            // Add pulsing effect
            const pulse = Math.sin(cloud.pulsePhase) * 0.3 + 0.7;

            // Drift horizontally with wrapping
            cloud.x += cloud.speed * 0.05;
            if (cloud.x > 1.2) cloud.x = -0.2; // Wrap around

            const x = (cloud.x + Math.sin(cloud.phase) * 0.15) * this.canvas.width;
            const y = (cloud.y + Math.cos(cloud.phase * 0.5) * 0.05) * this.canvas.height; // Add vertical drift

            // Create multiple layers for richer nebula effect
            const baseOpacity = cloud.opacity * pulse;

            // Outer glow layer
            const outerGradient = this.ctx.createRadialGradient(
                x, y, 0,
                x, y, cloud.size * 1.2
            );
            outerGradient.addColorStop(0, `rgba(150, 30, 40, ${baseOpacity * 0.6})`);
            outerGradient.addColorStop(0.3, `rgba(120, 20, 30, ${baseOpacity * 0.4})`);
            outerGradient.addColorStop(0.6, `rgba(80, 10, 20, ${baseOpacity * 0.2})`);
            outerGradient.addColorStop(1, 'rgba(40, 5, 10, 0)');

            this.ctx.fillStyle = outerGradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, cloud.size * 1.2, 0, Math.PI * 2);
            this.ctx.fill();

            // Inner bright core
            const coreGradient = this.ctx.createRadialGradient(
                x, y, 0,
                x, y, cloud.size * 0.5
            );
            coreGradient.addColorStop(0, `rgba(200, 50, 60, ${baseOpacity * 0.8})`);
            coreGradient.addColorStop(0.5, `rgba(150, 30, 40, ${baseOpacity * 0.5})`);
            coreGradient.addColorStop(1, `rgba(100, 15, 25, ${baseOpacity * 0.2})`);

            this.ctx.fillStyle = coreGradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, cloud.size * 0.5, 0, Math.PI * 2);
            this.ctx.fill();
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

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
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

    onLineClear(lineCount, comboCount) {
        // Update combo multiplier
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);

        // Moon pulse intensity based on combo
        this.moonPulseIntensity = Math.min(0.5 + comboCount * 0.15, 1.5);

        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Blood burst particles from center - reduced for performance
        // Enforce particle limit
        if (this.bloodBurstParticles.length >= this.MAX_PARTICLES) {
            // Remove oldest particles
            this.bloodBurstParticles.splice(0, Math.floor(this.MAX_PARTICLES * 0.3));
        }

        const burstCount = Math.min(lineCount * 15 + comboCount * 10, this.MAX_PARTICLES);
        for (let i = 0; i < burstCount; i++) {
            this.bloodBurstParticles.push(this.createBloodBurstParticle(centerX, centerY, lineCount));
        }

        // Crimson lightning for big combos - limit instances
        if (comboCount >= 4 && this.crimsonLightning.length < this.MAX_LIGHTNING) {
            this.createCrimsonLightning(centerX, centerY, comboCount);
        }

        // Blood waves rippling from moon - limit waves
        if (lineCount >= 2 && this.bloodWaves.length < this.MAX_WAVES) {
            this.createBloodWaves(lineCount, comboCount);
        }

        // Soul orbs rising for combos - limit orbs
        if (comboCount >= 2 && this.soulOrbs.length < this.MAX_ORBS) {
            const orbCount = Math.min(comboCount * 2, this.MAX_ORBS - this.soulOrbs.length);
            for (let i = 0; i < orbCount; i++) {
                this.soulOrbs.push(this.createSoulOrb());
            }
        }

        // Blood vortexes for massive combos - limit vortexes
        if (comboCount >= 7 && this.bloodVortexes.length < this.MAX_VORTEXES) {
            const vortexCount = Math.min(Math.floor(comboCount / 5), this.MAX_VORTEXES - this.bloodVortexes.length);
            for (let i = 0; i < vortexCount; i++) {
                this.bloodVortexes.push(this.createBloodVortex());
            }
        }
    }

    createBloodBurstParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 12 + 6 + lineCount * 2;

        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 5 + 2,
            opacity: Math.random() * 0.9 + 0.4,
            life: 1.0,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
            color: Math.random() > 0.5 ? 'blood' : 'dark',
            sparkle: Math.random() * Math.PI * 2,
            trail: []
        };
    }

    createCrimsonLightning(x, y, comboCount) {
        const branches = [];
        const numBranches = Math.min(Math.floor(comboCount / 3) + 3, 8); // Reduced and capped

        for (let i = 0; i < numBranches; i++) {
            const angle = (Math.PI * 2 / numBranches) * i + Math.random() * 0.5;
            const segments = [];
            let currentX = x;
            let currentY = y;

            // Reduced segments from 10 to 7
            for (let j = 0; j < 7; j++) {
                const length = Math.random() * 100 + 60;
                const nextX = currentX + Math.cos(angle + (Math.random() - 0.5) * 0.9) * length;
                const nextY = currentY + Math.sin(angle + (Math.random() - 0.5) * 0.9) * length;

                segments.push({
                    x1: currentX,
                    y1: currentY,
                    x2: nextX,
                    y2: nextY
                });

                currentX = nextX;
                currentY = nextY;
            }

            branches.push(segments);
        }

        this.crimsonLightning.push({
            branches: branches,
            opacity: 1.0,
            life: 1.0,
            pulsePhase: 0
        });
    }

    createBloodWaves(lineCount, comboCount) {
        const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), this.MAX_WAVES - this.bloodWaves.length);

        for (let i = 0; i < waveCount; i++) {
            this.bloodWaves.push({
                radius: 0,
                maxRadius: 300 + comboCount * 50,
                opacity: 0.8,
                life: 1.0,
                speed: 4 + comboCount * 0.5,
                delay: i * 0.15,
                started: false
            });
        }
    }

    createSoulOrb() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height + 50,
            vx: (Math.random() - 0.5) * 2,
            vy: -(Math.random() * 3 + 2),
            size: Math.random() * 8 + 4,
            opacity: Math.random() * 0.7 + 0.4,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            glowIntensity: Math.random() * 0.5 + 0.5
        };
    }

    createBloodVortex() {
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height * 0.6,
            particles: [],
            angle: 0,
            radius: 0,
            maxRadius: Math.random() * 250 + 200,
            spinSpeed: 0.12,
            expansionRate: 3,
            life: 1.0,
            direction: Math.random() < 0.5 ? 1 : -1
        };
    }

    calculateMoonPosition() {
        // Update moon position with ultra-slow drifting motion across entire screen
        // Use very slow sine/cosine waves with different periods for natural movement
        // Movement spans the entire screen width and height
        const horizontalRange = (this.canvas.width - this.moonRadius * 2) * 0.8; // 80% of screen width
        const verticalRange = (this.canvas.height - this.moonRadius * 2) * 0.6; // 60% of screen height

        // Center positions
        const centerX = this.canvas.width * 0.5;
        const centerY = this.canvas.height * 0.4;

        // Ultra-slow, smooth movement using multiple sine waves with random phase offsets
        // Each session starts at a different point in the path
        const moonX = centerX + Math.sin(this.time * 0.00008 + this.moonPhaseX) * (horizontalRange * 0.5);
        const moonY = centerY + Math.cos(this.time * 0.00006 + this.moonPhaseY) * (verticalRange * 0.5);

        // Add secondary movement for more natural path with different random offsets
        const moonXOffset = Math.sin(this.time * 0.0001 + this.moonPhaseX2) * (horizontalRange * 0.2);
        const moonYOffset = Math.cos(this.time * 0.00012 + this.moonPhaseY2) * (verticalRange * 0.2);

        return {
            x: moonX + moonXOffset,
            y: moonY + moonYOffset
        };
    }

    drawMoon(moonPos) {
        this.moonRotation += 0.0001;

        // Decay moon pulse intensity
        if (this.moonPulseIntensity > 0) {
            this.moonPulseIntensity *= 0.95;
        }

        // Update glow pulse - stronger and more dramatic, enhanced by gameplay
        const basePulse = Math.sin(this.time * 0.002) * 0.35 + 0.85;
        this.glowPulse = basePulse * (1 + this.moonPulseIntensity * 0.5); // Increased pulse range

        this.ctx.save();
        this.ctx.translate(moonPos.x, moonPos.y);
        this.ctx.rotate(this.moonRotation);

        // Draw outer glow layers (most intense) - Enhanced for more glow
        for (let i = 8; i >= 1; i--) { // Increased from 5 to 8 layers
            const glowRadius = this.moonRadius * (1 + i * 0.2); // Increased spread
            const glowOpacity = (0.25 / i) * this.glowPulse; // Increased base opacity

            const glowGradient = this.ctx.createRadialGradient(0, 0, this.moonRadius, 0, 0, glowRadius);
            glowGradient.addColorStop(0, `rgba(220, 40, 60, ${glowOpacity * 1.2})`); // Brighter
            glowGradient.addColorStop(0.3, `rgba(200, 30, 50, ${glowOpacity * 0.8})`);
            glowGradient.addColorStop(0.6, `rgba(160, 20, 35, ${glowOpacity * 0.5})`);
            glowGradient.addColorStop(1, 'rgba(100, 10, 20, 0)');

            this.ctx.fillStyle = glowGradient;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw main moon body with gradient
        const moonGradient = this.ctx.createRadialGradient(
            -this.moonRadius * 0.2, -this.moonRadius * 0.2, this.moonRadius * 0.2,
            0, 0, this.moonRadius
        );
        moonGradient.addColorStop(0, '#cc1a2e');
        moonGradient.addColorStop(0.4, '#a01525');
        moonGradient.addColorStop(0.7, '#7a0f1a');
        moonGradient.addColorStop(1, '#4d0a0f');

        this.ctx.fillStyle = moonGradient;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.moonRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // Draw craters
        for (const crater of this.craterData) {
            const craterX = crater.x * this.moonRadius;
            const craterY = crater.y * this.moonRadius;
            const craterRadius = crater.size * this.moonRadius;

            // Crater shadow
            const craterGradient = this.ctx.createRadialGradient(
                craterX, craterY, 0,
                craterX, craterY, craterRadius
            );
            craterGradient.addColorStop(0, `rgba(20, 5, 5, ${crater.depth})`);
            craterGradient.addColorStop(0.6, `rgba(40, 10, 10, ${crater.depth * 0.5})`);
            craterGradient.addColorStop(1, 'rgba(60, 15, 15, 0)');

            this.ctx.fillStyle = craterGradient;
            this.ctx.beginPath();
            this.ctx.arc(craterX, craterY, craterRadius, 0, Math.PI * 2);
            this.ctx.fill();

            // Crater rim highlight
            this.ctx.strokeStyle = `rgba(200, 50, 60, ${crater.depth * 0.3})`;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(craterX, craterY, craterRadius * 0.9, 0, Math.PI * 2);
            this.ctx.stroke();
        }

        // Add animated texture noise and shimmer for moon surface
        for (let i = 0; i < 600; i++) { // Increased from 400 to 600
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * this.moonRadius;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;

            // Add shimmer animation
            const shimmerPhase = this.time * 0.01 + i * 0.1;
            const shimmer = Math.sin(shimmerPhase) * 0.3 + 0.7;

            // More variety in texture with increased visibility
            const isDark = Math.random() > 0.5;
            const color = isDark ? '60, 10, 15' : '140, 30, 35'; // Slightly brighter
            const baseOpacity = Math.random() * 0.45 * shimmer; // Increased from 0.3

            this.ctx.fillStyle = `rgba(${color}, ${baseOpacity})`;
            this.ctx.beginPath();
            this.ctx.arc(x, y, Math.random() * 3, 0, Math.PI * 2); // Slightly larger
            this.ctx.fill();

            // Add more bright shimmer spots
            if (Math.random() > 0.92) { // Increased from 0.95 (more spots)
                this.ctx.fillStyle = `rgba(255, 90, 110, ${Math.random() * 0.5 * shimmer})`; // Increased opacity
                this.ctx.beginPath();
                this.ctx.arc(x, y, Math.random() * 2, 0, Math.PI * 2); // Slightly larger
                this.ctx.fill();
            }
        }

        // Add animated edge highlight for 3D effect and shimmer
        const shimmerIntensity = Math.sin(this.time * 0.005) * 0.2 + 0.5;
        const edgeGradient = this.ctx.createRadialGradient(
            -this.moonRadius * 0.3, -this.moonRadius * 0.3, 0,
            0, 0, this.moonRadius
        );
        edgeGradient.addColorStop(0, `rgba(255, 120, 140, ${0.5 * shimmerIntensity})`); // More intense
        edgeGradient.addColorStop(0.4, `rgba(240, 90, 110, ${0.3 * shimmerIntensity})`);
        edgeGradient.addColorStop(0.7, `rgba(200, 60, 80, ${0.15 * shimmerIntensity})`);
        edgeGradient.addColorStop(1, 'rgba(150, 40, 60, 0)');

        this.ctx.fillStyle = edgeGradient;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.moonRadius, 0, Math.PI * 2);
        this.ctx.fill();

        // Add pulsing rim glow
        this.ctx.strokeStyle = `rgba(255, 100, 120, ${0.4 * this.glowPulse})`;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.moonRadius - 2, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.restore();

        // Draw enhanced atmospheric glow around moon - multiple layers
        // Layer 1: Extended outer atmosphere
        const outerAtmosphere = this.ctx.createRadialGradient(
            moonPos.x, moonPos.y, this.moonRadius,
            moonPos.x, moonPos.y, this.moonRadius * 2.5
        );
        outerAtmosphere.addColorStop(0, `rgba(220, 60, 80, ${0.25 * this.glowPulse})`);
        outerAtmosphere.addColorStop(0.3, `rgba(200, 40, 60, ${0.15 * this.glowPulse})`);
        outerAtmosphere.addColorStop(0.6, `rgba(150, 20, 40, ${0.08 * this.glowPulse})`);
        outerAtmosphere.addColorStop(1, 'rgba(100, 10, 20, 0)');

        this.ctx.fillStyle = outerAtmosphere;
        this.ctx.beginPath();
        this.ctx.arc(moonPos.x, moonPos.y, this.moonRadius * 2.5, 0, Math.PI * 2);
        this.ctx.fill();

        // Layer 2: Intense inner atmosphere
        const innerAtmosphere = this.ctx.createRadialGradient(
            moonPos.x, moonPos.y, this.moonRadius * 0.8,
            moonPos.x, moonPos.y, this.moonRadius * 1.4
        );
        innerAtmosphere.addColorStop(0, `rgba(255, 80, 100, ${0.35 * this.glowPulse})`);
        innerAtmosphere.addColorStop(0.5, `rgba(230, 50, 70, ${0.2 * this.glowPulse})`);
        innerAtmosphere.addColorStop(1, 'rgba(180, 30, 50, 0)');

        this.ctx.fillStyle = innerAtmosphere;
        this.ctx.beginPath();
        this.ctx.arc(moonPos.x, moonPos.y, this.moonRadius * 1.4, 0, Math.PI * 2);
        this.ctx.fill();
    }

    animate() {
        if (!this.isActive) return;

        this.time += 1;

        // Calculate moon position once per frame
        const moonPos = this.calculateMoonPosition();

        // Clear and draw
        this.drawBackground();
        this.drawNebulaClouds();
        this.drawStars(moonPos.x, moonPos.y);

        // Draw blood waves emanating from moon
        for (let i = this.bloodWaves.length - 1; i >= 0; i--) {
            const wave = this.bloodWaves[i];

            wave.delay -= 0.016;
            if (wave.delay <= 0 && !wave.started) {
                wave.started = true;
            }

            if (!wave.started) continue;

            wave.radius += wave.speed;
            wave.life -= 0.01;
            wave.opacity = wave.life * 0.6;

            if (wave.life <= 0 || wave.radius > wave.maxRadius) {
                this.bloodWaves.splice(i, 1);
                continue;
            }

            // Draw pulsing blood wave rings
            for (let j = 0; j < 3; j++) {
                const offsetRadius = wave.radius - j * 20;
                if (offsetRadius <= 0) continue;

                this.ctx.beginPath();
                this.ctx.arc(moonPos.x, moonPos.y, offsetRadius, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(200, 30, 50, ${wave.opacity * (1 - j * 0.3)})`;
                this.ctx.lineWidth = 3 + j;
                this.ctx.stroke();
            }
        }

        // Draw crimson lightning
        for (let i = this.crimsonLightning.length - 1; i >= 0; i--) {
            const lightning = this.crimsonLightning[i];
            lightning.life -= 0.02;
            lightning.opacity = lightning.life;
            lightning.pulsePhase += 0.15;

            if (lightning.life <= 0) {
                this.crimsonLightning.splice(i, 1);
                continue;
            }

            const pulseOpacity = lightning.opacity * (0.4 + Math.sin(lightning.pulsePhase) * 0.2);

            this.ctx.lineCap = 'round';

            // Outer glow
            this.ctx.strokeStyle = `rgba(200, 40, 60, ${pulseOpacity * 0.2})`;
            this.ctx.lineWidth = 8;
            this.ctx.beginPath();
            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                }
            }
            this.ctx.stroke();

            // Middle layer
            this.ctx.strokeStyle = `rgba(220, 50, 70, ${pulseOpacity * 0.4})`;
            this.ctx.lineWidth = 4;
            this.ctx.beginPath();
            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                }
            }
            this.ctx.stroke();

            // Core
            this.ctx.strokeStyle = `rgba(255, 80, 100, ${pulseOpacity * 0.7})`;
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            for (const branch of lightning.branches) {
                for (const segment of branch) {
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                }
            }
            this.ctx.stroke();
        }

        // Draw blood burst particles
        for (let i = this.bloodBurstParticles.length - 1; i >= 0; i--) {
            const p = this.bloodBurstParticles[i];

            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.2; // Gravity
            p.vx *= 0.98;
            p.rotation += p.rotationSpeed;
            p.life -= 0.015;
            p.opacity = p.life * 0.9;
            p.sparkle += 0.2;

            if (p.life <= 0 || p.y > this.canvas.height) {
                this.bloodBurstParticles.splice(i, 1);
                continue;
            }

            const sparkle = Math.sin(p.sparkle) * 0.3 + 0.7;

            this.ctx.save();
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rotation);
            this.ctx.globalAlpha = p.opacity * sparkle;

            // Blood-red particle
            if (p.color === 'blood') {
                this.ctx.fillStyle = 'rgba(200, 30, 50, 1)';
            } else {
                this.ctx.fillStyle = 'rgba(100, 15, 25, 1)';
            }

            // Draw droplet shape
            this.ctx.beginPath();
            this.ctx.moveTo(0, -p.size);
            this.ctx.bezierCurveTo(p.size * 0.5, -p.size * 0.5, p.size * 0.5, p.size * 0.5, 0, p.size);
            this.ctx.bezierCurveTo(-p.size * 0.5, p.size * 0.5, -p.size * 0.5, -p.size * 0.5, 0, -p.size);
            this.ctx.fill();

            // Highlight
            this.ctx.fillStyle = 'rgba(255, 100, 120, 0.6)';
            this.ctx.beginPath();
            this.ctx.arc(-p.size * 0.2, -p.size * 0.3, p.size * 0.3, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = 1;
            this.ctx.restore();
        }

        // Draw soul orbs
        for (let i = this.soulOrbs.length - 1; i >= 0; i--) {
            const orb = this.soulOrbs[i];

            orb.x += orb.vx;
            orb.y += orb.vy;
            orb.vx *= 0.99;
            orb.vy *= 0.98;
            orb.life -= 0.008;
            orb.opacity = orb.life * 0.8;
            orb.pulsePhase += 0.1;

            if (orb.life <= 0 || orb.y < -50) {
                this.soulOrbs.splice(i, 1);
                continue;
            }

            const pulse = Math.sin(orb.pulsePhase) * 0.3 + 0.7;

            // Outer glow
            const outerGrad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size * 2);
            outerGrad.addColorStop(0, `rgba(180, 50, 70, ${orb.opacity * pulse * 0.4})`);
            outerGrad.addColorStop(0.5, `rgba(150, 30, 50, ${orb.opacity * pulse * 0.2})`);
            outerGrad.addColorStop(1, 'rgba(100, 20, 30, 0)');

            this.ctx.fillStyle = outerGrad;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 2, 0, Math.PI * 2);
            this.ctx.fill();

            // Core
            const coreGrad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size);
            coreGrad.addColorStop(0, `rgba(255, 100, 120, ${orb.opacity * pulse})`);
            coreGrad.addColorStop(0.6, `rgba(220, 60, 80, ${orb.opacity * pulse * 0.7})`);
            coreGrad.addColorStop(1, `rgba(180, 40, 60, ${orb.opacity * pulse * 0.3})`);

            this.ctx.fillStyle = coreGrad;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw blood vortexes
        for (let i = this.bloodVortexes.length - 1; i >= 0; i--) {
            const vortex = this.bloodVortexes[i];

            vortex.angle += vortex.spinSpeed * vortex.direction;
            vortex.radius += vortex.expansionRate;
            vortex.life -= 0.006;

            // Spawn vortex particles - reduced spawn rate for performance
            if (Math.random() < 0.4 && vortex.radius < vortex.maxRadius && vortex.particles.length < 40) {
                const particleAngle = vortex.angle + Math.random() * Math.PI * 0.4;
                const particleRadius = vortex.radius + Math.random() * 50;
                vortex.particles.push({
                    x: vortex.x + Math.cos(particleAngle) * particleRadius,
                    y: vortex.y + Math.sin(particleAngle) * particleRadius,
                    size: Math.random() * 4 + 2,
                    opacity: Math.random() * 0.9 + 0.3,
                    vx: Math.cos(particleAngle) * 2,
                    vy: Math.sin(particleAngle) * 2,
                    life: 1.0
                });
            }

            // Update vortex particles
            for (let j = vortex.particles.length - 1; j >= 0; j--) {
                const p = vortex.particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.life -= 0.02;
                p.opacity = p.life * vortex.life * 0.8;

                if (p.life <= 0) {
                    vortex.particles.splice(j, 1);
                    continue;
                }

                this.ctx.globalAlpha = p.opacity;
                this.ctx.fillStyle = 'rgba(220, 50, 70, 1)';
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.globalAlpha = 1;
            }

            if (vortex.life <= 0 || vortex.radius > vortex.maxRadius) {
                this.bloodVortexes.splice(i, 1);
            }
        }

        this.drawMoon(moonPos);

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear gameplay effects
        this.bloodBurstParticles = [];
        this.crimsonLightning = [];
        this.bloodWaves = [];
        this.soulOrbs = [];
        this.bloodVortexes = [];
        this.moonPulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.pendingComboCount = 0;

        super.stop();
    }
}

import { BaseTheme } from '../base-theme.js';

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
        this.moonRotation = 0;

        // Performance optimizations
        this.cachedGradients = {};
        this.craterData = [];
        this.moonGlowIntensity = 1.0;
        this.glowPulse = 0;
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

    calculateMoonPosition() {
        // Update moon position with ultra-slow drifting motion across entire screen
        // Use very slow sine/cosine waves with different periods for natural movement
        // Movement spans the entire screen width and height
        const horizontalRange = (this.canvas.width - this.moonRadius * 2) * 0.8; // 80% of screen width
        const verticalRange = (this.canvas.height - this.moonRadius * 2) * 0.6; // 60% of screen height

        // Center positions
        const centerX = this.canvas.width * 0.5;
        const centerY = this.canvas.height * 0.4;

        // Ultra-slow, smooth movement using multiple sine waves (reduced speeds by ~60%)
        const moonX = centerX + Math.sin(this.time * 0.00008) * (horizontalRange * 0.5);
        const moonY = centerY + Math.cos(this.time * 0.00006) * (verticalRange * 0.5);

        // Add secondary movement for more natural path (also slowed down)
        const moonXOffset = Math.sin(this.time * 0.0001 + Math.PI / 3) * (horizontalRange * 0.2);
        const moonYOffset = Math.cos(this.time * 0.00012 + Math.PI / 4) * (verticalRange * 0.2);

        return {
            x: moonX + moonXOffset,
            y: moonY + moonYOffset
        };
    }

    drawMoon(moonPos) {
        this.moonRotation += 0.0001;

        // Update glow pulse - stronger and more dramatic
        this.glowPulse = Math.sin(this.time * 0.002) * 0.35 + 0.85; // Increased pulse range

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
        this.drawMoon(moonPos);

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        super.stop();
    }
}

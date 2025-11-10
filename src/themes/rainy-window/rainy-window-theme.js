import { BaseTheme } from '../base-theme.js';

export default class RainyWindowTheme extends BaseTheme {
    constructor() {
        super('rainy-window');
        this.canvas = null;
        this.ctx = null;
        this.drops = [];
        this.ripples = [];
        this.splashes = [];
        this.lightningBolts = [];
        this.mistParticles = [];
        this.resizeHandler = null;
        this.waterSurfaceY = 0;
        this.time = 0;
        this.lightningFlash = 0;
        this.nextLightning = Math.random() * 300 + 200;
        this.windForce = 0;
        this.targetWindForce = 0;
        this.nextWindChange = Math.random() * 200 + 100;
        this.maxDrops = 200;
        this.dropSpawnProbability = 0.45;
        this.currentDropCap = 70;
        this.maxRipples = 140;
        this.glowNoiseSeed = Math.random() * 1000;
        this.flashDebugCooldown = 0;
    }

    async createScene() {
        this.canvas = document.getElementById('rain-canvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        this.drops = [];
        this.ripples = [];
        this.splashes = [];
        this.mistParticles = [];

        for (let i = 0; i < Math.min(this.currentDropCap, 90); i++) {
            this.drops.push(this.createDrop(true));
        }

        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        // Water surface starts at 60% down the screen
        this.waterSurfaceY = this.canvas.height * 0.6;
    }

    createDrop(isInitial) {
        const maxY = isInitial ? this.waterSurfaceY : -50;
        const length = Math.random() * 15 + 10;
        return {
            x: Math.random() * this.canvas.width,
            y: isInitial ? Math.random() * maxY : -Math.random() * 100,
            z: Math.random(), // Depth: 0 (far) to 1 (near)
            r: Math.random() * 1.8 + 1.2,
            vy: Math.random() * 6 + 5,
            vx: Math.random() * 0.5 - 0.25,
            opacity: Math.random() * 0.5 + 0.4,
            length,
            baseLength: length,
        };
    }

    createRipple(x, y, dropSize, depth) {
        // Scale ripple size based on depth (smaller = farther away)
        const depthScale = 0.3 + depth * 0.7;
        return {
            x: x,
            y: y,
            radius: 0,
            maxRadius: (dropSize * 10 + Math.random() * 30 + 40) * depthScale,
            opacity: 1.0,
            speed: (Math.random() * 0.8 + 0.6) * depthScale,
            lineWidth: (Math.random() * 2 + 1.5) * depthScale,
            depth: depth,
            phase: 0, // For wave animation
            frequency: Math.random() * 0.1 + 0.05, // Wave oscillation
        };
    }

    createLightningBolt() {
        const startX = this.canvas.width * (0.15 + Math.random() * 0.7);
        const segments = [];
        let x = startX;
        let y = 0;
        const targetY = this.waterSurfaceY + Math.random() * 100;
        const depth = Math.random();

        // Main bolt
        while (y < targetY) {
            const nextY = y + Math.random() * 30 + 20;
            const nextX = x + (Math.random() - 0.5) * 40;
            segments.push({ x1: x, y1: y, x2: nextX, y2: nextY });

            // Random branches
            if (Math.random() > 0.7) {
                const branchLength = Math.random() * 100 + 50;
                const branchAngle = (Math.random() - 0.5) * Math.PI * 0.6;
                const bx = nextX + Math.cos(branchAngle) * branchLength;
                const by = nextY + Math.sin(branchAngle) * branchLength;
                segments.push({ x1: nextX, y1: nextY, x2: bx, y2: by, isBranch: true });
            }

            x = nextX;
            y = nextY;
        }

        return {
            segments,
            opacity: 1.0,
            life: 1.0,
            glowIntensity: 1.0,
            originX: startX,
            originY: 0,
        };
    }

    createMist(x, y, depth) {
        const particles = [];
        const count = Math.floor(Math.random() * 6) + 4;
        const depthScale = 0.3 + depth * 0.7;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 1.5 + 0.5;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed * depthScale,
                vy: -Math.random() * 2 - 1, // Upward drift
                life: 1.0,
                size: (Math.random() * 3 + 2) * depthScale,
                opacity: Math.random() * 0.3 + 0.2,
            });
        }
        return particles;
    }

    createSplash(x, y, depth) {
        const particles = [];
        const count = Math.floor(Math.random() * 4) + 3;
        const depthScale = 0.3 + depth * 0.7;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 0.8;
            const speed = (Math.random() * 3 + 2) * depthScale;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed * -1,
                life: 1.0,
                size: (Math.random() * 2 + 1) * depthScale,
            });
        }
        return particles;
    }

    // Calculate Y position on water surface based on depth
    getWaterY(depth) {
        // Creates perspective: far (depth=0) appears higher, near (depth=1) appears lower
        const perspectiveRange = this.canvas.height * 0.3;
        return this.waterSurfaceY + (depth * perspectiveRange);
    }

    drawWaterSurface() {
        const surfaceHeight = this.canvas.height - this.waterSurfaceY;

        const waterGradient = this.ctx.createLinearGradient(0, this.waterSurfaceY, 0, this.canvas.height);
        waterGradient.addColorStop(0, 'rgba(20, 24, 34, 0.9)');
        waterGradient.addColorStop(0.5, 'rgba(14, 16, 22, 0.95)');
        waterGradient.addColorStop(1, 'rgba(6, 7, 12, 1)');
        this.ctx.fillStyle = waterGradient;
        this.ctx.fillRect(0, this.waterSurfaceY, this.canvas.width, surfaceHeight);

        // Draw perspective grid lines for depth perception
        this.ctx.strokeStyle = 'rgba(60, 75, 90, 0.08)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) {
            const depth = i / 10;
            const y = this.getWaterY(depth);
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }

        // Draw subtle water surface line with animation at horizon
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.waterSurfaceY);

        for (let x = 0; x < this.canvas.width; x += 20) {
            const wave = Math.sin((x + this.time) * 0.01) * 1.5;
            this.ctx.lineTo(x, this.waterSurfaceY + wave);
        }

        this.ctx.strokeStyle = 'rgba(100, 120, 140, 0.4)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Add atmospheric perspective fog
        const fogGradient = this.ctx.createLinearGradient(0, this.waterSurfaceY, 0, this.waterSurfaceY + 150);
        fogGradient.addColorStop(0, 'rgba(40, 50, 60, 0.2)');
        fogGradient.addColorStop(1, 'rgba(40, 50, 60, 0)');
        this.ctx.fillStyle = fogGradient;
        this.ctx.fillRect(0, this.waterSurfaceY, this.canvas.width, 150);
    }

    animate() {
        if (!this.isActive) {
            return;
        }

        this.time += 1;

        // Dynamic wind system
        if (this.time >= this.nextWindChange) {
            this.targetWindForce = (Math.random() - 0.5) * 3; // Wind from -1.5 to 1.5
            this.nextWindChange = this.time + Math.random() * 200 + 150;
        }

        // Smooth wind transition
        this.windForce += (this.targetWindForce - this.windForce) * 0.02;

        if (this.flashDebugCooldown > 0) {
            this.flashDebugCooldown -= 1;
        }

        // Lightning timing
        if (this.time >= this.nextLightning) {
            const bolt = this.createLightningBolt();
            this.lightningBolts.push(bolt);
            this.lightningFlash = 1.0;
            this.nextLightning = this.time + Math.random() * 400 + 300;
        }

        // Fade lightning flash
        if (this.lightningFlash > 0) {
            this.lightningFlash -= 0.05;
        }

        const hasLivingBolt = this.lightningBolts.some((bolt) => bolt.life > 0.05);
        if (!hasLivingBolt) {
            this.lightningFlash = 0;
        }

        // Dark atmospheric background with depth and lightning flash
        const flashIntensity = hasLivingBolt ? Math.max(0, this.lightningFlash) : 0;
        const skyGradient = this.ctx.createLinearGradient(0, 0, 0, this.waterSurfaceY);
        skyGradient.addColorStop(0, 'rgb(8, 9, 14)');
        skyGradient.addColorStop(0.5, 'rgb(14, 16, 20)');
        skyGradient.addColorStop(1, 'rgb(20, 22, 28)');
        this.ctx.fillStyle = skyGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.waterSurfaceY);

        // Draw water surface
        this.drawWaterSurface();


        // Add atmospheric fog layers
        for (let i = 0; i < 3; i++) {
            const fogY = this.waterSurfaceY - (i * 100) - 50;
            const fogGradient = this.ctx.createLinearGradient(0, fogY - 40, 0, fogY + 40);
            fogGradient.addColorStop(0, 'rgba(30, 40, 50, 0)');
            fogGradient.addColorStop(0.5, `rgba(30, 40, 50, ${0.03 + i * 0.01})`);
            fogGradient.addColorStop(1, 'rgba(30, 40, 50, 0)');
            this.ctx.fillStyle = fogGradient;
            this.ctx.fillRect(0, fogY - 40, this.canvas.width, 80);
        }

        let hasVisibleBolt = false;
        // Draw and update lightning bolts
        for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this.lightningBolts[i];

            bolt.life -= 0.08;
            bolt.opacity = bolt.life;

            if (bolt.life <= 0) {
                this.lightningBolts.splice(i, 1);
                continue;
            }
            hasVisibleBolt = true;

            // Draw each segment with intense glow
            for (const seg of bolt.segments) {
                const thickness = seg.isBranch ? 1.5 : 3;

                // Outer glow (wide)
                this.ctx.beginPath();
                this.ctx.moveTo(seg.x1, seg.y1);
                this.ctx.lineTo(seg.x2, seg.y2);
                this.ctx.strokeStyle = `rgba(180, 220, 255, ${bolt.opacity * 0.3})`;
                this.ctx.lineWidth = thickness * 8;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();

                // Middle glow
                this.ctx.beginPath();
                this.ctx.moveTo(seg.x1, seg.y1);
                this.ctx.lineTo(seg.x2, seg.y2);
                this.ctx.strokeStyle = `rgba(220, 240, 255, ${bolt.opacity * 0.6})`;
                this.ctx.lineWidth = thickness * 4;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();

                // Core (bright white)
                this.ctx.beginPath();
                this.ctx.moveTo(seg.x1, seg.y1);
                this.ctx.lineTo(seg.x2, seg.y2);
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${bolt.opacity})`;
                this.ctx.lineWidth = thickness;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();
            }
        }

        // Spawn new raindrops
        this.currentDropCap += (this.maxDrops - this.currentDropCap) * 0.0025;
        const spawnChance = this.dropSpawnProbability * (0.6 + this.currentDropCap / this.maxDrops * 0.4) * (1 + Math.abs(this.windForce) * 0.12);
        if (this.drops.length < this.currentDropCap && Math.random() < spawnChance) {
            this.drops.push(this.createDrop(false));
        }

        // Draw and update ripples on water surface with depth
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const ripple = this.ripples[i];

            ripple.radius += ripple.speed;
            ripple.phase += ripple.frequency;
            ripple.opacity -= 0.006;

            if (ripple.opacity <= 0 || ripple.radius >= ripple.maxRadius) {
                this.ripples.splice(i, 1);
                continue;
            }

            // Apply depth-based effects
            const depth = ripple.depth;
            const depthAlpha = 0.4 + depth * 0.6;

            ripple.y = this.getWaterY(depth);

            // Realistic ripple wave pattern with oscillation
            const waveAmplitude = Math.sin(ripple.phase) * 0.3 + 0.7;

            // Draw primary ripple with multiple wave rings aligned to water plane
            for (let j = 0; j < 5; j++) {
                const waveOffset = j * 8 * (0.3 + depth * 0.7);
                const offsetRadius = ripple.radius - waveOffset;
                if (offsetRadius <= 0) continue;

                const waveAlpha = ripple.opacity * (1 - j * 0.15) * depthAlpha * waveAmplitude;
                const flatten = 0.3 + depth * 0.35;
                const lightningBoost = hasLivingBolt ? flashIntensity * 0.3 : 0;

                this.ctx.save();
                this.ctx.translate(ripple.x, ripple.y);
                this.ctx.scale(1, flatten);
                this.ctx.rotate(Math.sin(ripple.phase + j) * 0.02);
                this.ctx.beginPath();
                this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(${140 + lightningBoost * 100}, ${170 + lightningBoost * 100}, ${200 + lightningBoost * 100}, ${waveAlpha * 0.4})`;
                this.ctx.lineWidth = (ripple.lineWidth + 1) * (1 - j * 0.12);
                this.ctx.stroke();

                if (j < 3) {
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, offsetRadius, 0, Math.PI * 2);
                    const nearColor = [180, 210, 240];
                    const farColor = [120, 140, 160];
                    const r = farColor[0] + (nearColor[0] - farColor[0]) * depth + lightningBoost * 50;
                    const g = farColor[1] + (nearColor[1] - farColor[1]) * depth + lightningBoost * 50;
                    const b = farColor[2] + (nearColor[2] - farColor[2]) * depth + lightningBoost * 50;

                    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${waveAlpha})`;
                    this.ctx.lineWidth = ripple.lineWidth * (1 - j * 0.2);
                    this.ctx.stroke();
                }
                this.ctx.restore();
            }
        }

        // Update and draw splash particles
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const particles = this.splashes[i];
            let allDead = true;

            for (let j = particles.length - 1; j >= 0; j--) {
                const p = particles[j];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.3; // Gravity
                p.life -= 0.04;

                if (p.life > 0) {
                    allDead = false;
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    this.ctx.fillStyle = `rgba(200, 220, 240, ${p.life * 0.8})`;
                    this.ctx.fill();
                }
            }

            if (allDead) {
                this.splashes.splice(i, 1);
            }
        }

        for (let i = this.mistParticles.length - 1; i >= 0; i--) {
            const particle = this.mistParticles[i];
            particle.x += particle.vx + this.windForce * 0.05;
            particle.y += particle.vy;
            particle.vy += 0.01;
            particle.life -= 0.02;
            particle.opacity = Math.max(0, particle.opacity - 0.01);

            if (particle.life <= 0) {
                this.mistParticles.splice(i, 1);
                continue;
            }

            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(200, 220, 240, ${particle.opacity})`;
            this.ctx.fill();
        }

        // Draw and update raindrops
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];
            const windInfluence = this.windForce * (0.15 + drop.z * 0.25);
            drop.vx += (windInfluence - drop.vx) * 0.02;
            drop.y += drop.vy;
            drop.x += drop.vx;

            // Calculate water surface Y at this drop's depth
            const waterY = this.getWaterY(drop.z);

            // Scale drop based on depth for perspective
            const depthScale = 0.4 + drop.z * 0.6;
            const scaledR = drop.r * depthScale;
            const scaledLength = drop.length * depthScale * (1 + Math.abs(this.windForce) * 0.1);
            const streakSkew = this.windForce * 3;

            // Only draw if above water
            if (drop.y < waterY) {
                // Draw motion blur streak
                const gradient = this.ctx.createLinearGradient(
                    drop.x, drop.y - scaledLength,
                    drop.x, drop.y
                );
                gradient.addColorStop(0, `rgba(200, 220, 240, 0)`);
                gradient.addColorStop(0.3, `rgba(210, 230, 250, ${drop.opacity * 0.3})`);
                gradient.addColorStop(1, `rgba(220, 235, 255, ${drop.opacity * 0.7})`);

                this.ctx.beginPath();
                this.ctx.moveTo(drop.x - streakSkew, drop.y - scaledLength);
                this.ctx.lineTo(drop.x, drop.y);
                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = scaledR * 0.6;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();

                // Draw drop head with glow
                this.ctx.beginPath();
                this.ctx.arc(drop.x, drop.y, scaledR * 1.5, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(220, 235, 255, ${drop.opacity * 0.2})`;
                this.ctx.fill();

                this.ctx.beginPath();
                this.ctx.arc(drop.x, drop.y, scaledR, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(230, 240, 255, ${drop.opacity})`;
                this.ctx.fill();
            }

            // Check if drop hits water surface at its depth
            if (drop.y >= waterY) {
                if (this.ripples.length < this.maxRipples) {
                    this.ripples.push(this.createRipple(drop.x, waterY, drop.r, drop.z));
                }
                if (Math.random() > 0.5) {
                    this.splashes.push(this.createSplash(drop.x, waterY, drop.z));
                }
                if (Math.random() > 0.3) {
                    this.mistParticles.push(...this.createMist(drop.x, waterY - 3, drop.z));
                }
                this.drops.splice(i, 1);
                continue;
            }

            // Remove drops that go off screen horizontally
            if (drop.x < -50 || drop.x > this.canvas.width + 50) {
                this.drops.splice(i, 1);
            }
        }

        // Limit arrays for performance
        if (this.ripples.length > this.maxRipples) {
            this.ripples = this.ripples.slice(-this.maxRipples);
        }
        if (this.drops.length > 350) {
            this.drops = this.drops.slice(-350);
        }
        if (this.splashes.length > 50) {
            this.splashes = this.splashes.slice(-50);
        }
        if (this.mistParticles.length > 250) {
            this.mistParticles = this.mistParticles.slice(-250);
        }
        if (this.drops.length > this.maxDrops) {
            this.drops = this.drops.slice(-this.maxDrops);
        }

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

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');
        this.meteorPool = [];
        this.meteorsContainer = null;
        this.meteorAnimationFrame = null;
        this.lastMeteorFrameTime = 0;

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
    }

    async createScene() {
        // Stars
        const starsContainer = document.getElementById('neon-dusk-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const starCount = 150;
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
            starsContainer.appendChild(fragment);
            this.registerContainer(starsContainer);
        }

        // Clouds
        const cloudsContainer = document.getElementById('neon-dusk-clouds');
        if (cloudsContainer && cloudsContainer.children.length === 0) {
            const cloudCount = 8;
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
            cloudsContainer.appendChild(fragment);
            this.registerContainer(cloudsContainer);
        }

        // Meteors
        const meteorsContainer = document.getElementById('neon-dusk-meteors');
        if (meteorsContainer) {
            this.meteorsContainer = meteorsContainer;
            if (this.meteorPool.length === 0 || meteorsContainer.children.length === 0) {
                this.initializeMeteors(meteorsContainer);
            } else {
                this.resumeMeteorPool();
            }
            this.registerContainer(meteorsContainer);
        }

        // Mountain Silhouettes - Back Layer
        const mountainsBack = document.getElementById('neon-dusk-mountains-back');
        if (mountainsBack && mountainsBack.children.length === 0) {
            const mountain = document.createElement('div');
            mountain.className = 'neon-dusk-mountain-back';
            mountain.style.width = '100%';
            mountain.style.height = '100%';
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
            mountainsFront.appendChild(mountain);
            this.registerContainer(mountainsFront);
        }

        // Floating Neon Particles / Polygons
        const particlesContainer = document.getElementById('neon-dusk-particles');
        if (particlesContainer && particlesContainer.children.length === 0) {
            const particleCount = 40;
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
            particlesContainer.appendChild(fragment);
            this.registerContainer(particlesContainer);
        }

        // Setup gameplay effects
        this.setupGameplayEffects();
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

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ffff00', '#ff0088'];
        const burstCount = Math.min(lineCount * 30 + this.comboMultiplier * 25, 250);

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

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const arcCount = Math.min(comboCount, 8);
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
                segments: this.generateArcSegments(startX, startY, endX, endY, 8),
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

        const height = this.effectsCanvas.height;
        const colors = ['#00ffff', '#ff00ff', '#00ff88'];

        for (let i = 0; i < lineCount * 2; i++) {
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

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ffff00'];

        for (let i = 0; i < lineCount; i++) {
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

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const colors = ['#00ffff', '#ff00ff', '#ffff00'];

        for (let i = 0; i < Math.min(comboCount * 3, 15); i++) {
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

        const centerX = this.effectsCanvas.width / 2;
        const centerY = this.effectsCanvas.height / 2;
        const colors = ['#00ffff', '#ff00ff', '#00ff88'];

        for (let i = 0; i < Math.min(comboCount, 3); i++) {
            const color = colors[i % colors.length];
            const particles = [];
            const particleCount = 80;

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
        // Update neon burst particles
        for (let i = this.neonBurstParticles.length - 1; i >= 0; i--) {
            const p = this.neonBurstParticles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15; // Gravity
            p.life -= delta / p.maxLife;

            if (p.life <= 0) {
                this.neonBurstParticles.splice(i, 1);
            }
        }

        // Update electric arcs
        for (let i = this.electricArcs.length - 1; i >= 0; i--) {
            const arc = this.electricArcs[i];
            arc.life -= delta / arc.maxLife;

            // Regenerate segments for flickering effect
            if (Math.random() > 0.7) {
                arc.segments = this.generateArcSegments(
                    arc.startX,
                    arc.startY,
                    arc.endX,
                    arc.endY,
                    8
                );
            }

            if (arc.life <= 0) {
                this.electricArcs.splice(i, 1);
            }
        }

        // Update digital scan lines
        for (let i = this.digitalScanLines.length - 1; i >= 0; i--) {
            const line = this.digitalScanLines[i];
            line.y += line.speed * delta;
            line.life -= delta / line.maxLife;

            if (line.life <= 0) {
                this.digitalScanLines.splice(i, 1);
            }
        }

        // Update hologram rings
        for (let i = this.hologramRings.length - 1; i >= 0; i--) {
            const ring = this.hologramRings[i];
            ring.radius += (ring.maxRadius / ring.maxLife) * delta;
            ring.life -= delta / ring.maxLife;

            if (ring.life <= 0) {
                this.hologramRings.splice(i, 1);
            }
        }

        // Update glitch pulses
        for (let i = this.glitchPulses.length - 1; i >= 0; i--) {
            const pulse = this.glitchPulses[i];
            pulse.life -= delta / pulse.maxLife;
            pulse.offsetX = (Math.random() - 0.5) * 20;

            if (pulse.life <= 0) {
                this.glitchPulses.splice(i, 1);
            }
        }

        // Update cyber vortexes
        for (let i = this.cyberVortexes.length - 1; i >= 0; i--) {
            const vortex = this.cyberVortexes[i];
            vortex.life -= delta / vortex.maxLife;

            vortex.particles.forEach((p) => {
                p.angle += p.angularSpeed * delta;
                p.radius += p.radiusSpeed * delta;
            });

            if (vortex.life <= 0) {
                this.cyberVortexes.splice(i, 1);
            }
        }
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render digital scan lines
        this.digitalScanLines.forEach((line) => {
            const alpha = line.life * line.opacity;
            ctx.strokeStyle = `${line.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
            ctx.lineWidth = line.height;
            ctx.shadowBlur = 15;
            ctx.shadowColor = line.color;
            ctx.beginPath();
            ctx.moveTo(0, line.y);
            ctx.lineTo(width, line.y);
            ctx.stroke();
        });

        // Render hologram rings
        this.hologramRings.forEach((ring) => {
            const alpha = ring.life;
            ctx.strokeStyle = `${ring.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
            ctx.lineWidth = ring.width;
            ctx.shadowBlur = 20;
            ctx.shadowColor = ring.color;
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Render neon burst particles
        this.neonBurstParticles.forEach((p) => {
            const alpha = p.life;
            ctx.fillStyle = `${p.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
            ctx.shadowBlur = p.glow;
            ctx.shadowColor = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        // Render electric arcs
        this.electricArcs.forEach((arc) => {
            const alpha = arc.life;
            ctx.strokeStyle = `${arc.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
            ctx.lineWidth = arc.width;
            ctx.shadowBlur = 25;
            ctx.shadowColor = arc.color;
            ctx.beginPath();
            ctx.moveTo(arc.segments[0].x, arc.segments[0].y);
            for (let i = 1; i < arc.segments.length; i++) {
                ctx.lineTo(arc.segments[i].x, arc.segments[i].y);
            }
            ctx.stroke();
        });

        // Render glitch pulses
        this.glitchPulses.forEach((pulse) => {
            const alpha = pulse.life * 0.7;
            ctx.fillStyle = `${pulse.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
            ctx.shadowBlur = 10;
            ctx.shadowColor = pulse.color;
            ctx.fillRect(pulse.x + pulse.offsetX, pulse.y, pulse.width, pulse.height);
        });

        // Render cyber vortexes
        this.cyberVortexes.forEach((vortex) => {
            const alpha = vortex.life;
            ctx.fillStyle = `${vortex.color}${Math.floor(alpha * 200).toString(16).padStart(2, '0')}`;
            ctx.shadowBlur = 15;
            ctx.shadowColor = vortex.color;

            vortex.particles.forEach((p) => {
                const x = vortex.x + Math.cos(p.angle) * p.radius;
                const y = vortex.y + Math.sin(p.angle) * p.radius;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            });
        });

        // Reset shadow
        ctx.shadowBlur = 0;
    }

    stop() {
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

    initializeMeteors(container) {
        const meteorCount = 6;
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
}

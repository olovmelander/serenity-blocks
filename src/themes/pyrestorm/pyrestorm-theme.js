import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { PYRESTORM_TETROMINOS } from './pyrestorm-tetrominos.js';

export default class PyrestormTheme extends BaseTheme {
    constructor() {
        super('pyrestorm');

        // Canvas & Context
        this.canvas = null;
        this.ctx = null;
        this.width = 0;
        this.height = 0;

        // Animation Loop
        this.animationFrameId = null;
        this.lastTime = 0;
        this.time = 0; // Global animation time

        // Game State
        this.comboCount = 0;
        this.intensity = 0; // 0 to 1, based on game pace/combo
        this.shake = 0; // Screen shake intensity

        // Visual Elements
        this.bgMountainPoints = []; // Distant mountains
        this.mountainPoints = [];   // Foreground mountains
        this.lavaPaths = [];        // River path data

        // Particle Systems
        this.riverParticles = [];   // Floating lava chunks (fluid)
        this.particles = [];        // Standard air particles (embers, smoke)
        this.sparkles = [];         // High-priority combo sparkles
        this.geysers = [];          // Vertical lava eruptions
        this.lightningBolts = [];   // Lightning

        this.lightningTimer = 0;
        this.lightningFlash = 0;

        // Configuration
        this.config = {
            maxParticles: 1500, // Increased limit
            mountainColor: '#120202',
            skyColorTop: '#050000',
            skyColorBottom: '#2d0a0a',
            lavaColor: '#ff4500',
            emberColor: '#ffaa00',
        };

        // Bind methods
        this.handleResize = this.handleResize.bind(this);
        this.animate = this.animate.bind(this);
    }

    /**
     * Initialize the theme
     */
    async createScene() {
        // 1. Setup Container
        const container = this.getContainer('pyrestorm-theme');
        if (!container) return;

        // Clear any existing DOM elements
        container.innerHTML = '';
        container.style.background = '#000';
        container.style.overflow = 'hidden';

        // 2. Create Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '1';
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d', { alpha: false });

        // 3. Initial Resize & Setup
        this.handleResize();
        window.addEventListener('resize', this.handleResize);

        // 4. Setup Event Listeners
        this.setupEventListeners();

        // 5. Start Animation
        this.isActive = true;
        this.lastTime = performance.now();
        this.animate(this.lastTime);

        console.log('🔥 Pyrestorm: Inferno Engine 2.4 (MAX VISIBILITY) Started');
    }

    setupEventListeners() {
        // Line Clear - Bursts of fire & sparkles
        this.onLineClear = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.isActive) return;
            console.log('🔥 Pyrestorm: Line Clear Event', data);
            const count = data.lines || data.count || 1;

            // Massive explosion at center
            this.triggerExplosion(count);

            // Screen-wide sparkles
            this.triggerSparkles(count * 20);

            this.intensity = Math.min(1, this.intensity + 0.2 * count);
            this.shake += count * 8; // Stronger shake
        });

        // Combo - Increasing heat, lightning, and geysers
        this.onCombo = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.isActive) return;
            console.log('🔥 Pyrestorm: Combo Event', data);
            const count = data.combo || data.count || 0;
            this.comboCount = count;

            if (count > 0) {
                this.intensity = Math.min(1, this.intensity + 0.15 * count);
                this.shake += count * 3;

                // Combo Effects - Always trigger sparkles on combo
                this.triggerSparkles(count * 10 + 10);

                if (count > 1) {
                    this.triggerLightning(count);
                    this.triggerGeyser(count);
                }
            }
        });
    }

    handleResize() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.generateMountains();
    }

    getBezierPoints(p0, p1, p2, p3, steps = 50) {
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;

            const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
            const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;
            points.push({ x, y });
        }
        return points;
    }

    generateMountains() {
        this.bgMountainPoints = [];
        this.mountainPoints = [];
        this.lavaPaths = [];
        this.riverParticles = [];

        // --- 1. Background Mountains (Subtle) ---
        const bgPeakCount = 5;
        const bgStep = this.width / bgPeakCount;
        this.bgMountainPoints.push({ x: 0, y: this.height });
        this.bgMountainPoints.push({ x: 0, y: this.height * 0.65 });

        for (let i = 1; i <= bgPeakCount; i++) {
            const x = i * bgStep;
            const y = this.height * (0.55 + Math.random() * 0.15);
            const midX = x - bgStep / 2;
            const midY = (this.bgMountainPoints[this.bgMountainPoints.length - 1].y + y) / 2 + (Math.random() - 0.5) * 30;

            this.bgMountainPoints.push({ x: midX, y: midY });
            this.bgMountainPoints.push({ x: x, y: y });
        }
        this.bgMountainPoints.push({ x: this.width, y: this.height });


        // --- 2. Foreground Mountains ---
        const peakCount = 12;
        const step = this.width / peakCount;
        this.mountainPoints.push({ x: 0, y: this.height });
        this.mountainPoints.push({ x: 0, y: this.height * 0.65 });

        for (let i = 1; i <= peakCount; i++) {
            const x = i * step;
            const y = this.height * (0.55 + Math.random() * 0.3);

            const midX = x - step / 2;
            const midY = (this.mountainPoints[this.mountainPoints.length - 1].y + y) / 2 + (Math.random() - 0.5) * 120;

            this.mountainPoints.push({ x: midX, y: midY });
            this.mountainPoints.push({ x: x, y: y });

            // --- Magma Rivers ---
            if (Math.random() > 0.25) {
                const startX = x;
                const startY = y;
                const cp1x = x + (Math.random() - 0.5) * 80;
                const cp1y = y + (this.height - y) * 0.4;
                const cp2x = x + (Math.random() - 0.5) * 200;
                const cp2y = y + (this.height - y) * 0.8;
                const endX = x + (Math.random() - 0.5) * 400;
                const endY = this.height + 50;

                const pathPoints = this.getBezierPoints(
                    { x: startX, y: startY },
                    { x: cp1x, y: cp1y },
                    { x: cp2x, y: cp2y },
                    { x: endX, y: endY },
                    100
                );

                this.lavaPaths.push({
                    startX, startY,
                    cp1x, cp1y,
                    cp2x, cp2y,
                    endX, endY,
                    baseWidth: 4 + Math.random() * 12,
                    pathPoints: pathPoints
                });
            }
        }
        this.mountainPoints.push({ x: this.width, y: this.height });
    }

    triggerExplosion(strength) {
        // Center screen explosion
        const count = 50 * strength;
        const centerX = this.width / 2;
        const centerY = this.height * 0.5; // Center screen!

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2; // Full circle
            const speed = 5 + Math.random() * 25 + strength * 5;
            this.particles.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                decay: 0.01 + Math.random() * 0.015,
                size: 4 + Math.random() * 8, // Bigger
                color: Math.random() > 0.3 ? '#ffcc00' : '#ff4500',
                type: 'spark'
            });
        }
    }

    triggerSparkles(count) {
        for (let i = 0; i < count; i++) {
            this.sparkles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height, // Anywhere on screen
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2, // Float anywhere
                life: 1.0,
                decay: 0.005 + Math.random() * 0.015, // Last longer
                size: 3 + Math.random() * 6, // Bigger
                color: '#ffffff',
                glowColor: Math.random() > 0.5 ? '#ffd700' : '#ff4500',
                rotation: Math.random() * Math.PI,
                rotSpeed: (Math.random() - 0.5) * 0.1
            });
        }
    }

    triggerGeyser(strength) {
        const x = Math.random() * this.width;
        const height = this.height * (0.5 + Math.min(0.5, strength * 0.1));

        this.geysers.push({
            x: x,
            y: this.height,
            targetHeight: height,
            currentHeight: 0,
            width: 40 + strength * 20, // Wider
            life: 1.0,
            decay: 0.015,
            color: '#ff4500'
        });

        // Add particles at the base
        for (let i = 0; i < 30; i++) {
            this.particles.push({
                x: x + (Math.random() - 0.5) * 60,
                y: this.height,
                vx: (Math.random() - 0.5) * 8,
                vy: -15 - Math.random() * 15,
                life: 1.0,
                decay: 0.02,
                size: 5,
                color: '#ffaa00',
                type: 'spark'
            });
        }
    }

    triggerLightning(combo) {
        this.lightningFlash = 0.8 + Math.min(0.5, combo * 0.1);
        this.shake += 10 + combo * 2;

        const startX = Math.random() * this.width;
        const endX = startX + (Math.random() - 0.5) * 400;

        this.lightningBolts.push({
            startX: startX,
            startY: 0,
            endX: endX,
            endY: this.height * 0.8,
            segments: [],
            life: 1.0,
            width: 4 + combo * 2
        });

        const bolt = this.lightningBolts[this.lightningBolts.length - 1];
        let currX = bolt.startX;
        let currY = bolt.startY;
        const steps = 12;
        const dy = (bolt.endY - bolt.startY) / steps;

        bolt.segments.push({ x: currX, y: currY });
        for (let i = 0; i < steps; i++) {
            currX += (bolt.endX - bolt.startX) / steps + (Math.random() - 0.5) * 150;
            currY += dy + (Math.random() - 0.5) * 50;
            bolt.segments.push({ x: currX, y: currY });
        }
    }

    update(dt) {
        this.time += dt;
        this.intensity = Math.max(0, this.intensity - dt * 0.1); // Slower decay
        this.shake = Math.max(0, this.shake - dt * 15);
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 8);

        // --- Ambient Sparkles (Make it feel alive!) ---
        if (Math.random() < 0.1) { // 10% chance per frame to spawn a random sparkle
            this.triggerSparkles(1);
        }

        // --- Update River Particles (Fluid) ---
        this.lavaPaths.forEach((path, index) => {
            if (Math.random() < 0.3 + this.intensity * 0.4) {
                this.riverParticles.push({
                    pathIndex: index,
                    progress: 0,
                    speed: 0.2 + Math.random() * 0.3 + this.intensity * 0.2,
                    size: path.baseWidth * (0.6 + Math.random() * 0.8),
                    color: Math.random() > 0.5 ? '#ffcc00' : '#ff8800',
                    offset: (Math.random() - 0.5) * path.baseWidth * 0.6
                });
            }
        });

        for (let i = this.riverParticles.length - 1; i >= 0; i--) {
            const p = this.riverParticles[i];
            p.progress += p.speed * dt;
            if (p.progress >= 1) this.riverParticles.splice(i, 1);
        }

        // --- Update Sparkles ---
        for (let i = this.sparkles.length - 1; i >= 0; i--) {
            const s = this.sparkles[i];
            s.x += s.vx;
            s.y += s.vy;
            s.rotation += s.rotSpeed;
            s.life -= s.decay;
            if (s.life <= 0) this.sparkles.splice(i, 1);
        }

        // --- Update Geysers ---
        for (let i = this.geysers.length - 1; i >= 0; i--) {
            const g = this.geysers[i];
            g.currentHeight += (g.targetHeight - g.currentHeight) * 5 * dt;
            g.life -= g.decay;
            if (g.life <= 0) this.geysers.splice(i, 1);
        }

        // --- Update Air Particles ---
        const activeParticles = this.config.maxParticles * (1 + this.intensity);
        if (this.particles.length < activeParticles) {
            const spawnRate = 4 + Math.floor(this.intensity * 30);
            for (let i = 0; i < spawnRate; i++) {
                this.particles.push({
                    x: Math.random() * this.width,
                    y: this.height + 20,
                    vx: (Math.random() - 0.5) * 3,
                    vy: -(2 + Math.random() * 4 + this.intensity * 4),
                    life: 1.0,
                    decay: 0.003 + Math.random() * 0.01,
                    size: 2 + Math.random() * 5 + (this.intensity * 2),
                    color: Math.random() > 0.6 ? '#ffaa00' : '#ff4400',
                    type: 'ember',
                    wobble: Math.random() * Math.PI * 2
                });
            }
        }

        if (Math.random() < 0.3 + this.intensity * 0.3) {
            this.particles.push({
                x: Math.random() * this.width,
                y: this.height + 50,
                vx: (Math.random() - 0.5) * 2,
                vy: -(1 + Math.random() * 2),
                life: 1.0,
                decay: 0.0015,
                size: 30 + Math.random() * 50,
                color: '#0a0202',
                type: 'smoke'
            });
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= p.decay;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            if (p.type === 'ember') {
                p.x += p.vx + Math.sin(this.time * 3 + p.wobble) * 0.8;
                p.y += p.vy;
                if (p.life < 0.3) p.size *= 0.95;
            } else if (p.type === 'spark') {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.25;
                p.vx *= 0.96;
            } else if (p.type === 'smoke') {
                p.x += p.vx;
                p.y += p.vy;
                p.size += 0.15;
            }
        }

        // Update Lightning
        for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this.lightningBolts[i];
            bolt.life -= dt * 5;
            if (bolt.life <= 0) this.lightningBolts.splice(i, 1);
        }
    }

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const width = this.width;
        const height = this.height;

        // --- 1. Background (Sky) ---
        const pulse = Math.sin(this.time * 2) * 0.5 + 0.5;
        const fireGradient = ctx.createRadialGradient(
            width / 2, height * 1.2, 0,
            width / 2, height * 0.8, height * 1.2
        );
        fireGradient.addColorStop(0, `rgba(255, ${100 + this.intensity * 100}, 0, ${0.4 + this.intensity * 0.4})`);
        fireGradient.addColorStop(0.4, `rgba(200, 50, 0, ${0.3 + pulse * 0.1 + this.intensity * 0.3})`);
        fireGradient.addColorStop(1, '#050000');
        ctx.fillStyle = fireGradient;
        ctx.fillRect(0, 0, width, height);

        if (this.lightningFlash > 0) {
            ctx.fillStyle = `rgba(255, 220, 180, ${this.lightningFlash * 0.4})`;
            ctx.fillRect(0, 0, width, height);
        }

        // --- Screen Shake ---
        let shakeX = 0;
        let shakeY = 0;
        if (this.shake > 0) {
            shakeX = (Math.random() - 0.5) * this.shake;
            shakeY = (Math.random() - 0.5) * this.shake;
            ctx.save();
            ctx.translate(shakeX, shakeY);
        }

        // --- 2. Mountains ---
        // Background
        ctx.beginPath();
        if (this.bgMountainPoints.length > 0) {
            ctx.moveTo(this.bgMountainPoints[0].x, this.bgMountainPoints[0].y);
            for (let i = 1; i < this.bgMountainPoints.length; i++) ctx.lineTo(this.bgMountainPoints[i].x, this.bgMountainPoints[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(20, 5, 5, 0.6)';
        ctx.fill();

        // Foreground
        ctx.beginPath();
        if (this.mountainPoints.length > 0) {
            ctx.moveTo(this.mountainPoints[0].x, this.mountainPoints[0].y);
            for (let i = 1; i < this.mountainPoints.length; i++) ctx.lineTo(this.mountainPoints[i].x, this.mountainPoints[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = '#0a0202';
        ctx.fill();

        // Rim Light
        const rimWidth = 2 + this.comboCount * 1.5 + this.intensity * 5;
        const rimAlpha = 0.3 + Math.min(0.7, this.comboCount * 0.1);
        ctx.strokeStyle = `rgba(255, 80, 0, ${rimAlpha})`;
        ctx.lineWidth = rimWidth;
        ctx.shadowBlur = 10 + this.comboCount * 5;
        ctx.shadowColor = '#ff4500';
        ctx.stroke();
        ctx.shadowBlur = 0;

        // --- 3. Magma Rivers (Fluid) ---
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        this.lavaPaths.forEach(path => {
            const riverIntensity = 1 + this.intensity + (this.comboCount * 0.2);
            ctx.beginPath();
            ctx.moveTo(path.startX, path.startY);
            ctx.bezierCurveTo(path.cp1x, path.cp1y, path.cp2x, path.cp2y, path.endX, path.endY);
            ctx.lineWidth = path.baseWidth * riverIntensity * 2.0;
            ctx.strokeStyle = `rgba(150, 0, 0, ${0.3 * riverIntensity})`;
            ctx.shadowBlur = 15 * riverIntensity;
            ctx.shadowColor = '#ff0000';
            ctx.stroke();
            ctx.shadowBlur = 0;

            ctx.lineWidth = path.baseWidth * riverIntensity;
            ctx.strokeStyle = `rgba(100, 20, 0, 0.8)`;
            ctx.stroke();
        });

        this.riverParticles.forEach(p => {
            const path = this.lavaPaths[p.pathIndex];
            if (!path) return;
            const pointCount = path.pathPoints.length;
            const floatIndex = p.progress * (pointCount - 1);
            const index = Math.floor(floatIndex);
            const nextIndex = Math.min(index + 1, pointCount - 1);
            const subProgress = floatIndex - index;
            const p1 = path.pathPoints[index];
            const p2 = path.pathPoints[nextIndex];
            const x = p1.x + (p2.x - p1.x) * subProgress;
            const y = p1.y + (p2.y - p1.y) * subProgress;
            const finalX = x + p.offset;

            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(finalX, y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        // --- 4. Geysers ---
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this.geysers.forEach(g => {
            const grad = ctx.createLinearGradient(g.x, this.height, g.x, this.height - g.currentHeight);
            grad.addColorStop(0, '#ff4500');
            grad.addColorStop(1, 'rgba(255, 100, 0, 0)');

            ctx.fillStyle = grad;
            ctx.globalAlpha = g.life;
            ctx.fillRect(g.x - g.width / 2, this.height - g.currentHeight, g.width, g.currentHeight);
        });
        ctx.restore();

        // --- 5. Particles ---
        ctx.save();
        // Smoke
        this.particles.forEach(p => {
            if (p.type !== 'smoke') return;
            ctx.globalAlpha = p.life * 0.5;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        // Fire/Sparks
        ctx.globalCompositeOperation = 'lighter';
        this.particles.forEach(p => {
            if (p.type === 'smoke') return;
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            if (p.type === 'spark') {
                ctx.shadowBlur = 10;
                ctx.shadowColor = p.color;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        });

        // Sparkles (High Priority)
        this.sparkles.forEach(s => {
            ctx.globalAlpha = s.life;
            ctx.fillStyle = s.color;
            ctx.shadowBlur = 15;
            ctx.shadowColor = s.glowColor;

            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.rotation);

            // Draw star shape
            ctx.beginPath();
            const spikes = 4;
            const outerRadius = s.size * 2;
            const innerRadius = s.size * 0.5;
            for (let i = 0; i < spikes * 2; i++) {
                const r = (i % 2 === 0) ? outerRadius : innerRadius;
                const a = (Math.PI * i) / spikes;
                ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.shadowBlur = 0;
        });

        // Lightning
        this.lightningBolts.forEach(bolt => {
            ctx.globalAlpha = bolt.life;
            ctx.strokeStyle = '#fff5cc';
            ctx.lineWidth = bolt.width;
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ffaa00';
            ctx.beginPath();
            if (bolt.segments.length > 0) {
                ctx.moveTo(bolt.segments[0].x, bolt.segments[0].y);
                for (let i = 1; i < bolt.segments.length; i++) ctx.lineTo(bolt.segments[i].x, bolt.segments[i].y);
            }
            ctx.stroke();
        });

        ctx.restore();

        if (this.shake > 0) ctx.restore();
    }

    animate(timestamp) {
        if (!this.isActive) return;
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        const safeDt = Math.min(dt, 0.1);
        this.update(safeDt);
        this.draw();
        this.animationFrameId = requestAnimationFrame(this.animate);
    }

    stop() {
        this.isActive = false;
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.onLineClear) this.onLineClear();
        if (this.onCombo) this.onCombo();
        window.removeEventListener('resize', this.handleResize);
        if (this.canvas) {
            this.canvas.remove();
            this.canvas = null;
        }
        super.stop();
    }

    getTetrominoConfig() {
        return PYRESTORM_TETROMINOS;
    }
}

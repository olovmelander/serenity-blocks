import { BaseTheme } from '../base-theme.js';

export default class FallTheme extends BaseTheme {
    constructor() {
        super('fall');

        // Canvas properties
        this.canvas = null;
        this.ctx = null;

        // Ember particles (upward-floating glowing particles)
        this.embers = [];
        this.maxEmbers = 25;

        // Wind physics
        this.windForce = 0;
        this.targetWindForce = 0;
        this.nextWindChange = Math.random() * 200 + 100;
        this.time = 0;

        // Event-based effects
        this.comboCount = 0;
        this.comboHueShift = 0;
        this.lineClears = [];
        this.pieceLockEffects = [];

        // Resize handler
        this.resizeHandler = null;

        // Animation frame ID
        this.animFrameId = null;

        // DOM-driven leaf physics
        this.leafParticles = [];
        this.lastFrameTime = 0;
    }

    async createScene() {
        // Define leaf shapes and colors - more vibrant, glowing autumn palette
        const leafShapes = [
            'M15 0 C0 5, 5 25, 15 30 C25 25, 30 5, 15 0 Z', // Simple teardrop
            'M15 0 L17 10 L30 12 L18 18 L22 30 L15 25 L8 30 L12 18 L0 12 L13 10 Z', // Maple-like
            'M15 0 C 0 10, 0 20, 5 30 C 10 25, 20 25, 25 30 C 30 20, 30 10, 15 0 Z', // Oak-like
        ];

        // Brilliant, glowing autumn colors - oranges, reds, and golden yellows
        const leafColors = [
            '#ff5722', // Vibrant red-orange
            '#ff9100', // Brilliant orange
            '#ffb300', // Golden amber
            '#ff6f00', // Deep vibrant orange
            '#ff8a50', // Peachy orange
            '#ffa726', // Warm orange
            '#fb8c00', // Rich orange
            '#f4511e', // Red-orange
            '#ff7043', // Coral orange
            '#ffab40', // Light golden orange
        ];

        // Multi-layered falling leaves - optimized counts for performance
        const leafLayers = [
            {
                container: document.getElementById('fall-leaves-back'),
                count: 22,
                minSize: 15,
                maxSize: 25,
                minDuration: 15,
                maxDuration: 20,
                depthFactor: 0.3, // Back = far away
            },
            {
                container: document.getElementById('fall-leaves-mid'),
                count: 16,
                minSize: 20,
                maxSize: 35,
                minDuration: 10,
                maxDuration: 15,
                depthFactor: 0.6, // Mid depth
            },
            {
                container: document.getElementById('fall-leaves-front'),
                count: 12,
                minSize: 25,
                maxSize: 45,
                minDuration: 7,
                maxDuration: 12,
                depthFactor: 1.0, // Front = close
            },
        ];

        this.leafParticles = [];

        leafLayers.forEach((layer) => {
            if (!layer.container) {
                return;
            }

            if (layer.container.children.length === 0) {
                for (let i = 0; i < layer.count; i++) {
                    const leaf = document.createElement('div');
                    leaf.className = 'leaf';
                    const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];

                    // Depth-based color variation
                    const color = leafColors[Math.floor(Math.random() * leafColors.length)];

                    // Add occasional "hero" glowing leaf (extra bright)
                    const isHeroLeaf = Math.random() < 0.15; // 15% chance
                    if (isHeroLeaf) {
                        leaf.classList.add('hero-leaf');
                    }

                    leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                    const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                    leaf.style.width = `${size}px`;
                    leaf.style.height = `${size}px`;

                    layer.container.appendChild(leaf);
                }
                this.registerContainer(layer.container);
            }

            const leaves = Array.from(layer.container.querySelectorAll('.leaf'));
            leaves.forEach((leafEl) => {
                leafEl.style.animation = 'none';
                this.leafParticles.push(this.createLeafParticle(leafEl, layer.depthFactor));
            });
        });

        this.updateLeafParticles(0);

        // Dynamic Ground leaves - optimized count for performance
        const groundContainer = document.querySelector('.ground-leaves');
        if (groundContainer && groundContainer.children.length === 0) {
            groundContainer.style.backgroundImage = '';
            for (let i = 0; i < 70; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'ground-leaf';
                const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                const size = Math.random() * 25 + 20;
                leaf.style.width = `${size}px`;
                leaf.style.height = `${size}px`;
                leaf.style.left = `${Math.random() * 100}%`;
                leaf.style.bottom = `${Math.random() * 40 - 10}px`;
                leaf.style.opacity = Math.random() * 0.5 + 0.5;

                leaf.style.setProperty('--r1', `${Math.random() * 20 - 10}deg`);
                leaf.style.setProperty('--r2', `${Math.random() * 20 - 10}deg`);
                leaf.style.animationDuration = `${Math.random() * 5 + 5}s`;
                leaf.style.animationDelay = `-${Math.random() * 10}s`;

                groundContainer.appendChild(leaf);
            }
            this.registerContainer(groundContainer);
        }

        // Wind Particles
        const windContainer = document.getElementById('fall-wind-particles');
        if (windContainer && windContainer.children.length === 0) {
            for (let i = 0; i < 10; i++) {
                const particle = document.createElement('div');
                particle.className = 'fall-wind-particle';
                particle.style.top = `${Math.random() * 100}%`;
                const duration = Math.random() * 3 + 2;
                particle.style.animationDuration = `${duration}s`;
                particle.style.animationDelay = `-${Math.random() * duration}s`;
                windContainer.appendChild(particle);
            }
            this.registerContainer(windContainer);
        }

        // Generate procedural tree branches
        this.generateTreeBranches();

        // Initialize canvas for ember particles and effects
        this.canvas = document.getElementById('fall-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);
        this.resizeCanvas();

        // Initialize ember particles
        for (let i = 0; i < this.maxEmbers; i++) {
            this.embers.push(this.createEmber());
        }

        // Set up event listeners for game events
        this.setupEventListeners();

        // Start animation loop
        this.lastFrameTime = 0;
        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    generateTreeBranches() {
        const container = document.getElementById('fall-tree-branches');
        if (!container || container.children.length > 0) return;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.pointerEvents = 'none';

        // Generate 2-3 branch systems
        const branchSystems = [
            { x: '10%', y: '20%', size: 0.8, opacity: 0.4, angle: 30 },
            { x: '85%', y: '15%', size: 1.0, opacity: 0.5, angle: -25 },
            { x: '50%', y: '10%', size: 0.6, opacity: 0.35, angle: 10 },
        ];

        branchSystems.forEach((system) => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('transform', `translate(${system.x}, ${system.y}) rotate(${system.angle}) scale(${system.size})`);
            g.setAttribute('opacity', system.opacity);

            // Draw branches recursively
            this.drawBranch(g, 0, 0, -120 * system.size, 6, 20);
            svg.appendChild(g);
        });

        container.appendChild(svg);
    }

    drawBranch(parent, x1, y1, y2, depth, angle) {
        if (depth === 0) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const length = Math.abs(y2);
        const thickness = depth * 1.5;

        // Draw branch as path
        path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${y2}`);
        path.setAttribute('stroke', 'rgba(20, 10, 5, 0.8)');
        path.setAttribute('stroke-width', thickness);
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill', 'none');
        parent.appendChild(path);

        // Recursively draw sub-branches
        if (depth > 1) {
            const numBranches = Math.random() > 0.5 ? 2 : 3;
            for (let i = 0; i < numBranches; i++) {
                const branchAngle = (Math.random() - 0.5) * angle;
                const branchLength = length * (0.6 + Math.random() * 0.2);
                const x2 = x1 + Math.sin(branchAngle * Math.PI / 180) * branchLength;
                const y2New = y2 + Math.cos(branchAngle * Math.PI / 180) * branchLength;
                this.drawBranch(parent, x1, y2, y2New, depth - 1, angle * 0.8);
            }
        }
    }

    getViewportSize() {
        if (typeof window === 'undefined') {
            return { width: 1024, height: 768 };
        }

        const doc = typeof document !== 'undefined' ? document.documentElement : null;
        return {
            width: window.innerWidth || (doc ? doc.clientWidth : 1024) || 1024,
            height: window.innerHeight || (doc ? doc.clientHeight : 768) || 768,
        };
    }

    createLeafParticle(element, depth) {
        const { height } = this.getViewportSize();
        const depthScale = 0.6 + depth * 0.8;
        const particle = {
            element,
            depth,
            xPercent: Math.random() * 100,
            y: Math.random() * height - height * 0.2,
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: (0.35 + Math.random() * 0.8) * depthScale,
            swayAmplitudeFactor: (0.006 + Math.random() * 0.012) * (0.6 + depth),
            driftSpeedFactor: (Math.random() * 0.006 + 0.002) * (Math.random() < 0.5 ? -1 : 1) * (0.6 + depth),
            driftOffset: 0,
            baseFallSpeed: (45 + Math.random() * 35) * depthScale,
            maxFallSpeed: (80 + Math.random() * 40) * depthScale,
            gravity: (18 + Math.random() * 14) * depthScale,
            velocityY: 0,
            turbulencePhase: Math.random() * Math.PI * 2,
            turbulenceSpeed: Math.random() * 1.5 + 0.5,
            turbulenceAmount: 6 + Math.random() * 10,
            rotation: Math.random() * 360,
            rotationSpeed: (20 + Math.random() * 35) * (Math.random() < 0.5 ? -1 : 1),
        };

        particle.velocityY = particle.baseFallSpeed * (0.3 + Math.random() * 0.4);
        return particle;
    }

    resetLeafParticle(particle, viewportHeight) {
        const height = viewportHeight ?? this.getViewportSize().height;
        particle.y = -Math.random() * (height * 0.25) - 80;
        particle.xPercent = Math.random() * 100;
        particle.driftOffset = 0;
        particle.velocityY = particle.baseFallSpeed * (0.3 + Math.random() * 0.4);
        particle.swayPhase = Math.random() * Math.PI * 2;
        particle.turbulencePhase = Math.random() * Math.PI * 2;
    }

    updateLeafParticles(deltaSeconds = 0) {
        if (!this.leafParticles.length) {
            return;
        }

        const { width, height } = this.getViewportSize();
        const dt = Math.max(deltaSeconds, 0);

        this.leafParticles.forEach((leaf) => {
            const depthInfluence = 0.5 + leaf.depth;

            leaf.velocityY = Math.min(
                leaf.velocityY + leaf.gravity * dt,
                leaf.maxFallSpeed,
            );

            leaf.turbulencePhase += leaf.turbulenceSpeed * dt;
            const turbulence = Math.sin(leaf.turbulencePhase) * leaf.turbulenceAmount;
            leaf.y += (leaf.velocityY + turbulence) * dt;

            leaf.swayPhase += leaf.swaySpeed * dt;
            const sway = Math.sin(leaf.swayPhase) * (leaf.swayAmplitudeFactor * width);

            const driftSpeed = leaf.driftSpeedFactor * width;
            const windPush = this.windForce * 35 * depthInfluence;
            leaf.driftOffset += (driftSpeed + windPush) * dt;

            const maxDrift = width * 0.25 * depthInfluence;
            if (leaf.driftOffset > maxDrift) {
                leaf.driftOffset = maxDrift;
            } else if (leaf.driftOffset < -maxDrift) {
                leaf.driftOffset = -maxDrift;
            }

            const x = (leaf.xPercent / 100) * width + sway + leaf.driftOffset;
            leaf.rotation += leaf.rotationSpeed * dt;

            leaf.element.style.transform = `translate3d(${x}px, ${leaf.y}px, 0) rotate(${leaf.rotation}deg)`;

            if (leaf.y > height + 120) {
                this.resetLeafParticle(leaf, height);
            }
        });
    }

    createEmber() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height + Math.random() * 100,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -(Math.random() * 0.5 + 0.3), // Upward
            life: 1.0,
            size: Math.random() * 2 + 1.5,
            opacity: Math.random() * 0.4 + 0.6,
            twinkle: Math.random() * Math.PI * 2,
            twinkleSpeed: Math.random() * 0.03 + 0.02,
            hue: Math.random() * 30 + 10, // 10-40 (orange to yellow range)
        };
    }

    resetEmber(ember) {
        ember.x = Math.random() * this.canvas.width;
        ember.y = this.canvas.height + Math.random() * 100;
        ember.vx = (Math.random() - 0.5) * 0.3;
        ember.vy = -(Math.random() * 0.5 + 0.3);
        ember.life = 1.0;
        ember.size = Math.random() * 2 + 1.5;
        ember.opacity = Math.random() * 0.4 + 0.6;
        ember.twinkle = Math.random() * Math.PI * 2;
        ember.hue = Math.random() * 30 + 10;
    }

    setupEventListeners() {
        // Listen for game events
        window.addEventListener('LINE_CLEAR', (e) => this.onLineClear(e));
        window.addEventListener('COMBO', (e) => this.onCombo(e));
        window.addEventListener('PIECE_LOCK', (e) => this.onPieceLock(e));
    }

    onLineClear(event) {
        // Create burst effect at cleared line position
        const detail = event.detail || {};
        const y = detail.y || this.canvas.height / 2;

        // Spawn burst of embers
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const speed = Math.random() * 2 + 1;
            this.embers.push({
                x: this.canvas.width / 2,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1,
                life: 1.0,
                size: Math.random() * 3 + 2,
                opacity: 1.0,
                twinkle: 0,
                twinkleSpeed: 0.05,
                hue: Math.random() * 20 + 10,
                isBurst: true,
            });
        }

        // Keep ember count reasonable
        if (this.embers.length > this.maxEmbers * 2) {
            this.embers = this.embers.slice(-this.maxEmbers * 2);
        }
    }

    onCombo(event) {
        const detail = event.detail || {};
        this.comboCount = detail.combo || 0;

        // Progressive color shift based on combo
        const maxHueShift = 40; // Orange to red
        const maxSaturation = 75;
        const maxBrightness = 30;

        this.comboHueShift = Math.min(this.comboCount * 8, maxHueShift);
        const saturation = 100 + Math.min(this.comboCount * 12, maxSaturation);
        const brightness = 100 + Math.min(this.comboCount * 6, maxBrightness);

        const themeContainer = document.getElementById('fall-theme');
        if (themeContainer) {
            themeContainer.style.filter = `hue-rotate(${this.comboHueShift}deg) saturate(${saturation}%) brightness(${brightness}%)`;
        }
    }

    onPieceLock(event) {
        // Subtle ripple effect - just track for potential use
        const detail = event.detail || {};
        this.pieceLockEffects.push({
            x: detail.x || this.canvas.width / 2,
            y: detail.y || this.canvas.height / 2,
            life: 1.0,
        });
    }

    animate(timestamp) {
        if (!this.isActive) {
            return;
        }

        const now = typeof timestamp === 'number'
            ? timestamp
            : (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let deltaSeconds = 0;
        if (this.lastFrameTime) {
            const deltaMs = Math.min(Math.max(now - this.lastFrameTime, 0), 100);
            deltaSeconds = deltaMs / 1000;
        }
        this.lastFrameTime = now;

        this.time += 1;

        // Enhanced wind physics with smooth transitions
        if (this.time >= this.nextWindChange) {
            this.targetWindForce = (Math.random() - 0.5) * 1.5;
            this.nextWindChange = this.time + Math.random() * 300 + 200;
        }

        // Smooth wind transition
        const frameFactor = deltaSeconds ? Math.min(deltaSeconds * 60, 2) : 1;
        const windTransitionSpeed = 0.02 * frameFactor;
        this.windForce += (this.targetWindForce - this.windForce) * windTransitionSpeed;

        // Update DOM leaf particles with physics-driven motion
        this.updateLeafParticles(deltaSeconds);

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Update and draw embers
        for (let i = this.embers.length - 1; i >= 0; i--) {
            const ember = this.embers[i];

            // Update position with wind influence
            ember.x += ember.vx + this.windForce * 0.5;
            ember.y += ember.vy;
            ember.twinkle += ember.twinkleSpeed;

            // Sway motion
            ember.x += Math.sin(this.time * 0.02 + i) * 0.2;

            // Fade out
            ember.life -= ember.isBurst ? 0.015 : 0.004;

            // Reset or remove
            if (ember.life <= 0 || ember.y < -50) {
                if (ember.isBurst) {
                    this.embers.splice(i, 1);
                } else {
                    this.resetEmber(ember);
                }
                continue;
            }

            // Draw ember with multi-layer glow
            const twinkleEffect = Math.sin(ember.twinkle) * 0.3 + 0.7;
            const alpha = ember.opacity * ember.life * twinkleEffect;

            // Layer 1: Large outer glow
            this.ctx.beginPath();
            this.ctx.arc(ember.x, ember.y, ember.size * 4, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${ember.hue}, 100%, 60%, ${alpha * 0.15})`;
            this.ctx.fill();

            // Layer 2: Medium glow
            this.ctx.beginPath();
            this.ctx.arc(ember.x, ember.y, ember.size * 2, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${ember.hue}, 100%, 65%, ${alpha * 0.4})`;
            this.ctx.fill();

            // Layer 3: Bright core
            this.ctx.beginPath();
            this.ctx.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${ember.hue}, 100%, 75%, ${alpha})`;
            this.ctx.fill();
        }

        // Request next frame
        this.animFrameId = requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
        this.registerAnimation(this.animFrameId);
    }

    stop() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Remove event listeners
        window.removeEventListener('LINE_CLEAR', (e) => this.onLineClear(e));
        window.removeEventListener('COMBO', (e) => this.onCombo(e));
        window.removeEventListener('PIECE_LOCK', (e) => this.onPieceLock(e));

        // Reset combo filter
        const themeContainer = document.getElementById('fall-theme');
        if (themeContainer) {
            themeContainer.style.filter = '';
        }

        this.leafParticles = [];
        this.lastFrameTime = 0;

        super.stop();
    }
}

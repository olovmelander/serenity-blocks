import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SwedishForestTheme extends BaseTheme {
    constructor() {
        super('swedish-forest');
        this.canvas = null;
        this.ctx = null;
        this.animationTime = 0;

        // Forest elements
        this.trees = [];
        this.mistLayers = [];
        this.fireflies = [];
        this.fallingLeaves = [];
        this.godRays = [];
        this.forestSpirits = [];

        // Visual state
        this.comboMultiplier = 1.0;
        this.pulseIntensity = 0.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.magicGlow = 0;

        // Performance limits
        this.maxFireflies = 30;
        this.maxLeaves = 15;
        this.maxGodRays = 12;
        this.maxSpirits = 8;

        // Event tracking
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
    }

    async createScene() {
        const themeContainer = document.getElementById('swedish-forest-theme');
        this.canvas = document.getElementById('swedish-forest-canvas');

        if (!this.canvas && themeContainer) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'swedish-forest-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            this.canvas.style.zIndex = '1';
            themeContainer.appendChild(this.canvas);
        }

        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
        });

        // Set canvas size
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Clear all existing elements
        this.trees = [];
        this.mistLayers = [];
        this.fireflies = [];
        this.fallingLeaves = [];
        this.godRays = [];
        this.forestSpirits = [];

        // Initialize scene elements
        this.createTrees();
        this.createMist();
        this.createGodRays();
        this.createFireflies();
        this.createFallingLeaves();
        this.createForestSpirits();

        this.setupEventListeners();
        this.animate();
    }

    createTrees() {
        // Create trees in parallax layers matching original style
        const layers = [
            { count: 80, height: 150, color: 'rgba(20, 40, 50, 0.7)', spacing: 100 },
            { count: 60, height: 250, color: 'rgba(30, 55, 70, 0.8)', spacing: 120 },
            { count: 40, height: 400, color: 'rgba(40, 70, 90, 0.9)', spacing: 150 },
        ];

        layers.forEach((layer, layerIndex) => {
            for (let i = 0; i < layer.count; i++) {
                const h = layer.height * (0.6 + Math.random() * 0.4);
                const tH = h * (0.1 + Math.random() * 0.05);
                const x = i * layer.spacing + (Math.random() - 0.5) * 20;
                const y = this.canvas.height;
                const w = layer.spacing * 0.9;
                const numLayers = 5 + Math.floor(Math.random() * 3);

                this.trees.push({
                    x,
                    y,
                    height: h,
                    trunkHeight: tH,
                    width: w,
                    color: layer.color,
                    layer: layerIndex,
                    numFoliageLayers: numLayers,
                    swayPhase: Math.random() * Math.PI * 2,
                    swaySpeed: Math.random() * 0.0002 + 0.00008,
                    swayAmount: Math.random() * 0.008 + 0.003,
                    glowIntensity: 0,
                });
            }
        });
    }

    createMist() {
        const mistCount = 12;
        for (let i = 0; i < mistCount; i++) {
            this.mistLayers.push({
                x: Math.random() * this.canvas.width,
                y: this.canvas.height * 0.65 + Math.random() * this.canvas.height * 0.3,
                width: Math.random() * 500 + 300,
                height: Math.random() * 120 + 80,
                opacity: Math.random() * 0.15 + 0.08,
                driftSpeed: Math.random() * 0.08 + 0.03,
                driftPhase: Math.random() * Math.PI * 2,
                baseX: 0,
            });
        }
    }

    createGodRays() {
        for (let i = 0; i < this.maxGodRays; i++) {
            this.godRays.push({
                x: Math.random() * this.canvas.width,
                y: -50,
                width: Math.random() * 3 + 1.5,
                height: this.canvas.height * 1.2,
                opacity: Math.random() * 0.12 + 0.04,
                angle: (Math.random() - 0.5) * 0.15,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.015 + 0.005,
                rotationSpeed: (Math.random() - 0.5) * 0.0002,
                baseAngle: 0,
            });
        }
    }

    createFireflies() {
        for (let i = 0; i < this.maxFireflies; i++) {
            this.fireflies.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.7 + this.canvas.height * 0.15,
                vx: (Math.random() - 0.5) * 0.25,
                vy: (Math.random() - 0.5) * 0.25,
                size: Math.random() * 2.5 + 1.5,
                opacity: Math.random() * 0.6 + 0.3,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.03 + 0.015,
                hue: Math.random() * 15 + 55, // Soft yellow-green
            });
        }
    }

    createFallingLeaves() {
        for (let i = 0; i < this.maxLeaves; i++) {
            this.addLeaf();
        }
    }

    addLeaf() {
        this.fallingLeaves.push({
            x: Math.random() * this.canvas.width,
            y: -20,
            size: Math.random() * 8 + 4,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.05,
            vx: (Math.random() - 0.5) * 0.3,
            vy: Math.random() * 0.5 + 0.3,
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: Math.random() * 0.03 + 0.01,
            opacity: Math.random() * 0.6 + 0.3,
            hue: Math.random() * 30 + 20, // Orange-brown
        });
    }

    createForestSpirits() {
        for (let i = 0; i < this.maxSpirits; i++) {
            this.forestSpirits.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.7 + this.canvas.height * 0.1,
                targetX: 0,
                targetY: 0,
                vx: 0,
                vy: 0,
                size: Math.random() * 20 + 15, // Reduced from 30+20
                opacity: Math.random() * 0.25 + 0.12, // Slightly reduced
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                basePulseSpeed: 0, // Store original speed
                hue: Math.random() * 30 + 180, // Blue-cyan mystical colors
                trail: [],
                maxTrailLength: 4, // Reduced from 8+5 to 4 for performance
                wanderPhase: Math.random() * Math.PI * 2,
                wanderSpeed: Math.random() * 0.005 + 0.003,
                layer: Math.random() > 0.5 ? 'front' : 'back',
                life: 1.0,
                respawnTimer: 0,
            });
            // Store base pulse speed
            this.forestSpirits[i].basePulseSpeed = this.forestSpirits[i].pulseSpeed;
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

        window.addEventListener('resize', () => {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        });
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
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.15 * lineCount, 0.8);

        // Make trees glow very subtly
        this.trees.forEach((tree) => {
            tree.glowIntensity = Math.min(tree.glowIntensity + 0.2, 0.8);
        });

        // Brighten forest spirits on line clear
        this.forestSpirits.forEach((spirit) => {
            spirit.opacity = Math.min(spirit.opacity + 0.1, 0.6);
        });

        // Spawn extra fireflies sparingly
        if (this.fireflies.length < this.maxFireflies && Math.random() < 0.5) {
            for (let i = 0; i < Math.min(lineCount, 2); i++) {
                this.fireflies.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height * 0.7 + this.canvas.height * 0.15,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3,
                    size: Math.random() * 2.5 + 2,
                    opacity: 0.8,
                    pulsePhase: 0,
                    pulseSpeed: Math.random() * 0.04 + 0.02,
                    hue: Math.random() * 15 + 55,
                });
            }
        }
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.12, 1.6);
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.2 * comboCount, 1.0);

        // Subtle magic glow for combos
        if (comboCount >= 4) {
            this.magicGlow = Math.min(0.2 + comboCount * 0.05, 0.6);
        }

        // Make spirits more active during combos - but don't permanently increase their properties
        if (comboCount >= 3) {
            this.forestSpirits.forEach((spirit) => {
                // Temporarily boost instead of permanent growth
                spirit.pulseSpeed = Math.min(spirit.pulseSpeed * 1.15, 0.04);
            });
        }

        // Disable screen shake for mystical forest theme - it breaks the calm atmosphere
        // and causes performance issues
    }

    animate() {
        if (!this.isActive || !this.ctx || !this.canvas) return;

        this.animationTime += 0.016;

        // Decay effects
        if (this.pulseIntensity > 0) {
            this.pulseIntensity *= 0.98;
        }
        if (this.comboMultiplier > 1) {
            this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.008);
        }
        if (this.magicGlow > 0) {
            this.magicGlow *= 0.96;
        }

        // Decay spirit effects back to base values
        this.forestSpirits.forEach((spirit) => {
            if (spirit.pulseSpeed > spirit.basePulseSpeed) {
                spirit.pulseSpeed = Math.max(spirit.basePulseSpeed, spirit.pulseSpeed * 0.98);
            }
            if (spirit.opacity > 0.4) {
                spirit.opacity *= 0.98;
            }
        });

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw scene (back to front) - no screen shake for better performance
        this.drawGodRays();
        this.drawMist();
        this.drawForestSpirits('back');
        this.drawTrees();
        this.drawForestSpirits('front');
        this.drawFireflies();
        this.drawFallingLeaves();

        // Draw magic glow overlay
        if (this.magicGlow > 0) {
            this.drawMagicGlow();
        }

        this.registerAnimation(requestAnimationFrame(() => this.animate()));
    }

    drawGodRays() {
        this.godRays.forEach((ray) => {
            ray.pulsePhase += ray.pulseSpeed;
            ray.angle = ray.baseAngle + Math.sin(this.animationTime * ray.rotationSpeed) * 0.1;

            const pulse = Math.sin(ray.pulsePhase) * 0.3 + 0.7;
            const comboBoost = 1 + this.pulseIntensity * 0.6 + this.comboMultiplier * 0.4;
            const opacity = ray.opacity * pulse * comboBoost;

            this.ctx.save();
            this.ctx.translate(ray.x, ray.y);
            this.ctx.rotate(ray.angle);

            const gradient = this.ctx.createLinearGradient(0, 0, 0, ray.height);
            gradient.addColorStop(0, `rgba(255, 250, 220, ${opacity * 0.5})`);
            gradient.addColorStop(0.3, `rgba(255, 250, 220, ${opacity})`);
            gradient.addColorStop(0.7, `rgba(255, 240, 200, ${opacity * 0.7})`);
            gradient.addColorStop(1, 'rgba(255, 240, 200, 0)');

            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(-ray.width / 2, 0, ray.width, ray.height);

            this.ctx.restore();
        });
    }

    drawMist() {
        this.mistLayers.forEach((mist) => {
            if (!mist.baseX) mist.baseX = mist.x;

            mist.driftPhase += mist.driftSpeed * 0.001;
            mist.x = mist.baseX + Math.sin(mist.driftPhase) * 100;

            // Wrap around
            if (mist.x > this.canvas.width + mist.width) {
                mist.x = -mist.width;
                mist.baseX = mist.x;
            }

            const comboBoost = 1 + this.comboMultiplier * 0.3;
            const opacity = mist.opacity * comboBoost;

            const gradient = this.ctx.createRadialGradient(
                mist.x, mist.y, 0,
                mist.x, mist.y, mist.width / 2
            );

            const mistColor = this.magicGlow > 0
                ? `rgba(180, 220, 255, ${opacity * (1 + this.magicGlow * 0.5)})`
                : `rgba(200, 210, 220, ${opacity})`;

            gradient.addColorStop(0, mistColor);
            gradient.addColorStop(0.5, `rgba(200, 210, 220, ${opacity * 0.5})`);
            gradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = gradient;
            this.ctx.save();
            this.ctx.translate(mist.x, mist.y);
            this.ctx.scale(1, mist.height / mist.width);
            this.ctx.beginPath();
            this.ctx.arc(0, 0, mist.width / 2, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        });
    }

    drawTrees() {
        // Sort trees by layer for proper depth
        const sortedTrees = [...this.trees].sort((a, b) => a.layer - b.layer);

        sortedTrees.forEach((tree) => {
            tree.swayPhase += tree.swaySpeed;
            const sway = Math.sin(tree.swayPhase) * tree.swayAmount;

            // Decay glow
            if (tree.glowIntensity > 0) {
                tree.glowIntensity *= 0.96;
            }

            this.ctx.save();
            this.ctx.translate(tree.x, tree.y);

            // Draw trunk
            this.ctx.fillStyle = tree.color;
            this.ctx.fillRect(-5, -tree.trunkHeight, 10, tree.trunkHeight);

            // Draw foliage (classic pine tree triangular layers)
            const startY = -tree.trunkHeight;
            const layerHeight = (tree.height - tree.trunkHeight) / tree.numFoliageLayers;

            for (let j = 0; j < tree.numFoliageLayers; j++) {
                const cY = startY - j * layerHeight;
                const widthScale = (tree.numFoliageLayers - j) / tree.numFoliageLayers;
                const cW = tree.width * widthScale;
                const swayOffset = Math.sin(tree.swayPhase + j * 0.3) * sway * (tree.numFoliageLayers - j) * 3;

                this.ctx.beginPath();
                this.ctx.moveTo(swayOffset, cY - layerHeight);
                this.ctx.lineTo(-cW / 2 + swayOffset, cY);
                this.ctx.lineTo(cW / 2 + swayOffset, cY);
                this.ctx.closePath();

                this.ctx.fillStyle = tree.color;
                this.ctx.fill();

                // Subtle glow on combos - very gentle
                if (tree.glowIntensity > 0) {
                    this.ctx.shadowBlur = 15 * tree.glowIntensity;
                    this.ctx.shadowColor = `rgba(200, 230, 255, ${tree.glowIntensity * 0.4})`;
                    this.ctx.fill();
                    this.ctx.shadowBlur = 0;
                }
            }

            this.ctx.restore();
        });
    }

    drawFireflies() {
        for (let i = this.fireflies.length - 1; i >= 0; i--) {
            const firefly = this.fireflies[i];

            // Update position
            firefly.x += firefly.vx;
            firefly.y += firefly.vy;

            // Random direction changes
            if (Math.random() < 0.02) {
                firefly.vx += (Math.random() - 0.5) * 0.2;
                firefly.vy += (Math.random() - 0.5) * 0.2;
            }

            // Keep velocities reasonable
            const speed = Math.sqrt(firefly.vx ** 2 + firefly.vy ** 2);
            if (speed > 1) {
                firefly.vx *= 0.8;
                firefly.vy *= 0.8;
            }

            // Wrap around edges
            if (firefly.x < -20) firefly.x = this.canvas.width + 20;
            if (firefly.x > this.canvas.width + 20) firefly.x = -20;
            if (firefly.y < 0) firefly.y = this.canvas.height;
            if (firefly.y > this.canvas.height) firefly.y = 0;

            // Pulse effect
            firefly.pulsePhase += firefly.pulseSpeed;
            const pulse = Math.sin(firefly.pulsePhase) * 0.5 + 0.5;
            const opacity = firefly.opacity * pulse * (1 + this.comboMultiplier * 0.3);

            // Draw firefly glow
            const gradient = this.ctx.createRadialGradient(
                firefly.x, firefly.y, 0,
                firefly.x, firefly.y, firefly.size * 3
            );
            gradient.addColorStop(0, `hsla(${firefly.hue}, 100%, 70%, ${opacity})`);
            gradient.addColorStop(0.3, `hsla(${firefly.hue}, 100%, 60%, ${opacity * 0.6})`);
            gradient.addColorStop(1, 'transparent');

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(firefly.x, firefly.y, firefly.size * 3, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw firefly core
            this.ctx.fillStyle = `hsla(${firefly.hue}, 100%, 90%, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(firefly.x, firefly.y, firefly.size * 0.5, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawFallingLeaves() {
        for (let i = this.fallingLeaves.length - 1; i >= 0; i--) {
            const leaf = this.fallingLeaves[i];

            // Update position
            leaf.swayPhase += leaf.swaySpeed;
            leaf.x += leaf.vx + Math.sin(leaf.swayPhase) * 0.3;
            leaf.y += leaf.vy;
            leaf.rotation += leaf.rotationSpeed;

            // Remove if off screen and add new one
            if (leaf.y > this.canvas.height + 20) {
                this.fallingLeaves.splice(i, 1);
                if (Math.random() < 0.3) {
                    this.addLeaf();
                }
                continue;
            }

            this.ctx.save();
            this.ctx.translate(leaf.x, leaf.y);
            this.ctx.rotate(leaf.rotation);

            // Draw leaf shape (simple ellipse)
            this.ctx.fillStyle = `hsla(${leaf.hue}, 70%, 45%, ${leaf.opacity})`;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, leaf.size, leaf.size * 0.6, 0, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        }
    }

    drawForestSpirits(layer) {
        const layerSpirits = this.forestSpirits.filter(s => s.layer === layer);

        layerSpirits.forEach((spirit) => {
            // Update wander target
            spirit.wanderPhase += spirit.wanderSpeed;
            spirit.targetX = spirit.x + Math.cos(spirit.wanderPhase) * 3;
            spirit.targetY = spirit.y + Math.sin(spirit.wanderPhase * 0.7) * 2;

            // Smooth movement towards target
            spirit.vx += (spirit.targetX - spirit.x) * 0.002;
            spirit.vy += (spirit.targetY - spirit.y) * 0.002;

            // Apply friction
            spirit.vx *= 0.95;
            spirit.vy *= 0.95;

            // Update position
            spirit.x += spirit.vx;
            spirit.y += spirit.vy;

            // Wrap around edges
            if (spirit.x < -100) spirit.x = this.canvas.width + 100;
            if (spirit.x > this.canvas.width + 100) spirit.x = -100;
            if (spirit.y < -50) spirit.y = this.canvas.height + 50;
            if (spirit.y > this.canvas.height + 50) spirit.y = -50;

            // Add to trail every 2 frames to reduce trail points
            if (this.animationTime % 2 < 0.02) {
                spirit.trail.push({ x: spirit.x, y: spirit.y });
                if (spirit.trail.length > spirit.maxTrailLength) {
                    spirit.trail.shift();
                }
            }

            // Pulse effect
            spirit.pulsePhase += spirit.pulseSpeed;
            const pulse = Math.sin(spirit.pulsePhase) * 0.4 + 0.6;
            const comboBoost = this.comboMultiplier > 1 ? 1 + (this.comboMultiplier - 1) * 0.5 : 1;
            const glowBoost = this.magicGlow > 0 ? 1 + this.magicGlow * 0.8 : 1;
            const opacity = spirit.opacity * pulse * comboBoost * glowBoost * spirit.life;

            // Draw simplified trail - only draw every other point and use solid colors
            if (spirit.trail.length > 1) {
                this.ctx.save();
                this.ctx.globalAlpha = opacity * 0.3;
                this.ctx.strokeStyle = `hsl(${spirit.hue}, 80%, 70%)`;
                this.ctx.lineWidth = spirit.size * 0.4;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';

                this.ctx.beginPath();
                this.ctx.moveTo(spirit.trail[0].x, spirit.trail[0].y);
                for (let i = 1; i < spirit.trail.length; i += 2) {
                    this.ctx.lineTo(spirit.trail[i].x, spirit.trail[i].y);
                }
                this.ctx.stroke();
                this.ctx.restore();
            }

            // Draw spirit main body using shadowBlur instead of gradients
            this.ctx.save();
            this.ctx.shadowBlur = spirit.size * 1.2;
            this.ctx.shadowColor = `hsla(${spirit.hue}, 80%, 70%, ${opacity * 0.6})`;
            this.ctx.fillStyle = `hsla(${spirit.hue}, 90%, 80%, ${opacity * 0.8})`;
            this.ctx.beginPath();
            this.ctx.arc(spirit.x, spirit.y, spirit.size * 0.3, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            // Draw bright core
            this.ctx.save();
            this.ctx.shadowBlur = spirit.size * 0.5;
            this.ctx.shadowColor = `hsla(${spirit.hue}, 100%, 95%, ${opacity})`;
            this.ctx.fillStyle = `hsla(${spirit.hue}, 100%, 95%, ${opacity})`;
            this.ctx.beginPath();
            this.ctx.arc(spirit.x, spirit.y, spirit.size * 0.15, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            // Draw subtle particles around spirit during combos - reduced count
            if (this.comboMultiplier > 1.3) {
                const particleCount = 2;
                this.ctx.fillStyle = `hsla(${spirit.hue}, 100%, 90%, ${opacity * 0.4})`;
                for (let i = 0; i < particleCount; i++) {
                    const angle = (i / particleCount) * Math.PI * 2 + this.animationTime * 2;
                    const distance = spirit.size * 0.6;
                    const px = spirit.x + Math.cos(angle) * distance;
                    const py = spirit.y + Math.sin(angle) * distance;

                    this.ctx.beginPath();
                    this.ctx.arc(px, py, 1.5, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
        });
    }

    drawMagicGlow() {
        if (this.magicGlow <= 0) return;

        // Very subtle mystical blue glow
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.fillStyle = `rgba(180, 210, 240, ${this.magicGlow * 0.1})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        super.stop();
        this.animationTime = 0;
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.magicGlow = 0;

        this.trees = [];
        this.mistLayers = [];
        this.fireflies = [];
        this.fallingLeaves = [];
        this.godRays = [];
        this.forestSpirits = [];
    }
}

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SWEDISH_FOREST_TETROMINOS } from './swedish-forest-tetrominos.js';

export default class SwedishForestTheme extends BaseTheme {
    constructor() {
        super('swedish-forest');
        this.canvas = null;
        this.ctx = null;
        this.animationTime = 0;

        // Offscreen buffers for performance
        this.mistSprite = null;
        this.godRaySprite = null;

        // Forest elements
        this.trees = [];
        this.mistLayers = [];
        this.fireflies = [];
        this.fallingLeaves = [];
        this.godRays = [];
        this.godRays = [];
        this.forestSpirits = [];
        this.auroraLayers = [];
        this.spiritWinds = [];

        // Visual state
        this.comboMultiplier = 1.0;
        this.pulseIntensity = 0.0;
        this.screenShake = { x: 0, y: 0, intensity: 0 };
        this.magicGlow = 0;
        this.windSpeed = 0;

        // Performance limits - Tuned for high FPS
        this.maxFireflies = 30;
        this.maxLeaves = 20;
        this.maxGodRays = 8;
        this.maxSpirits = 10;
        this.maxSpiritWinds = 5;

        // Gradient cache
        this.gradientCache = new Map();
        this.frameCount = 0;

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
            desynchronized: true, // Hint for performance
        });

        // Set canvas size
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        // Create offscreen sprites
        this.createMistSprite();
        this.createGodRaySprite();

        // Clear all existing elements
        this.trees = [];
        this.mistLayers = [];
        this.fireflies = [];
        this.fallingLeaves = [];
        this.godRays = [];
        this.forestSpirits = [];
        this.auroraLayers = [];
        this.spiritWinds = [];

        // Initialize scene elements
        this.createTrees();
        this.createMist();
        this.createGodRays();
        this.createSpiritWinds();
        this.createFireflies();
        this.createForestSpirits();
        this.createAurora();

        this.setupEventListeners();
        this.animate();
    }

    createMistSprite() {
        this.mistSprite = document.createElement('canvas');
        this.mistSprite.width = 200;
        this.mistSprite.height = 200;
        const ctx = this.mistSprite.getContext('2d');

        const gradient = ctx.createRadialGradient(100, 100, 0, 100, 100, 100);
        gradient.addColorStop(0, 'rgba(200, 220, 230, 0.4)');
        gradient.addColorStop(1, 'rgba(200, 220, 230, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 200, 200);
    }

    createGodRaySprite() {
        this.godRaySprite = document.createElement('canvas');
        this.godRaySprite.width = 50;
        this.godRaySprite.height = 500;
        const ctx = this.godRaySprite.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, 500);
        gradient.addColorStop(0, 'rgba(200, 255, 220, 0.5)');
        gradient.addColorStop(1, 'rgba(200, 255, 220, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 50, 500);
    }

    createTrees() {
        this.trees = [];
        // Create trees in parallax layers
        const layers = [
            { count: 90, height: 180, color: '#0F1F26', spacing: 90, blur: 0 }, // Front
            { count: 70, height: 300, color: '#162A33', spacing: 110, blur: 0 }, // Mid
            { count: 50, height: 450, color: '#1C3642', spacing: 140, blur: 1 }, // Back
            { count: 30, height: 600, color: '#224250', spacing: 200, blur: 2 }, // Far Back
        ];

        layers.forEach((layer, layerIndex) => {
            for (let i = 0; i < layer.count; i++) {
                const h = layer.height * (0.7 + Math.random() * 0.5);
                const tH = h * (0.15 + Math.random() * 0.1);
                const x = i * layer.spacing + (Math.random() - 0.5) * 40;
                const y = this.canvas.height;
                const w = layer.spacing * 0.8;
                const numLayers = 6 + Math.floor(Math.random() * 4);

                const hasRune = Math.random() < 0.4 && layerIndex < 2;
                const runeType = Math.floor(Math.random() * 3);

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
                    swaySpeed: Math.random() * 0.001 + 0.0005, // Slightly faster for more "life"
                    swayAmount: Math.random() * 0.015 + 0.005, // Visible sway
                    baseSwayAmount: Math.random() * 0.015 + 0.005,
                    glowIntensity: 0,
                    hasRune,
                    runeType,
                    runeY: -tH * 0.6,
                });
            }
        });
    }

    createMist() {
        const mistCount = 8;
        for (let i = 0; i < mistCount; i++) {
            this.mistLayers.push({
                x: Math.random() * this.canvas.width,
                y: this.canvas.height - (Math.random() * 250),
                width: this.canvas.width * 0.5,
                height: 150,
                opacity: Math.random() * 0.3 + 0.1,
                speed: Math.random() * 0.3 + 0.1,
            });
        }
    }

    createAurora() {
        for (let i = 0; i < 3; i++) {
            this.auroraLayers.push({
                points: [],
                color: i === 0 ? 'rgba(50, 255, 150, 0.15)' : (i === 1 ? 'rgba(50, 200, 255, 0.1)' : 'rgba(150, 50, 255, 0.08)'),
                offset: i * 100,
                speed: 0.002 + i * 0.001,
                intensity: 0,
            });
        }
    }

    createGodRays() {
        for (let i = 0; i < this.maxGodRays; i++) {
            this.godRays.push({
                x: Math.random() * this.canvas.width,
                y: -100,
                width: Math.random() * 40 + 20,
                height: this.canvas.height * 1.5,
                opacity: Math.random() * 0.15 + 0.05,
                angle: (Math.random() - 0.5) * 0.3,
                speed: Math.random() * 0.05 + 0.02,
            });
        }
    }

    createFireflies() {
        for (let i = 0; i < this.maxFireflies; i++) {
            this.fireflies.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.8 + this.canvas.height * 0.2,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 2 + 1,
                opacity: Math.random() * 0.8 + 0.2,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.05 + 0.02,
                hue: Math.random() * 20 + 50,
            });
        }
    }

    createForestSpirits() {
        for (let i = 0; i < this.maxSpirits; i++) {
            this.forestSpirits.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.6 + this.canvas.height * 0.2,
                targetX: Math.random() * this.canvas.width,
                targetY: Math.random() * this.canvas.height * 0.5,
                vx: 0,
                vy: 0,
                size: Math.random() * 15 + 10,
                opacity: Math.random() * 0.3 + 0.1,
                pulsePhase: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.03 + 0.01,
                hue: Math.random() * 40 + 160,
                trail: [],
                maxTrailLength: 6, // Reduced trail length for performance
                wanderPhase: Math.random() * 100,
            });
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

        this.resizeHandler = () => {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.createTrees();
        };
        window.addEventListener('resize', this.resizeHandler);
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
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.2 * lineCount, 1.0);

        const leavesToSpawn = Math.min(lineCount * 2, 8);
        for (let i = 0; i < leavesToSpawn; i++) {
            if (this.fallingLeaves.length < this.maxLeaves * 2) {
                this.addLeaf();
            }
        }

        this.forestSpirits.forEach(s => {
            s.vx += (Math.random() - 0.5) * 2;
            s.vy += (Math.random() - 0.5) * 2;
            s.opacity = Math.min(s.opacity + 0.2, 0.8);
        });
    }

    onCombo(comboCount) {
        this.comboMultiplier = Math.min(1 + comboCount * 0.3, 3.0);
        this.pulseIntensity = Math.min(this.pulseIntensity + 0.3, 1.0);

        this.windSpeed = Math.min(comboCount * 0.003, 0.03); // Increased wind effect
        this.magicGlow = Math.min(comboCount * 0.15, 1.0);

        if (comboCount >= 3) {
            this.auroraLayers.forEach(layer => {
                layer.intensity = Math.min(layer.intensity + 0.2, 1.0);
            });
        }
    }

    addLeaf() {
        this.fallingLeaves.push({
            x: Math.random() * this.canvas.width,
            y: -20,
            vx: (Math.random() - 0.5) * 2 + this.windSpeed * 100,
            vy: Math.random() * 1 + 1,
            size: Math.random() * 6 + 3,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.1,
            hue: Math.random() * 40 + 30,
            opacity: 1.0,
            life: 1.0
        });
    }

    animate() {
        if (!this.isActive || !this.ctx || !this.canvas) return;

        this.animationTime += 0.016;
        this.frameCount++;

        // Decay effects
        this.pulseIntensity *= 0.97;
        this.comboMultiplier = Math.max(1, this.comboMultiplier - 0.005);
        this.magicGlow *= 0.98;
        this.windSpeed *= 0.98;

        this.auroraLayers.forEach(layer => {
            layer.intensity *= 0.99;
        });

        // Draw Background
        this.drawBackground();

        // Draw Scene - Order matters for depth
        this.drawAurora();
        this.drawGodRays();
        this.drawSpiritWinds();
        this.drawTrees();
        this.drawMist();
        this.drawForestSpirits();
        this.drawFireflies();
        this.drawFallingLeaves();

        this.registerAnimation(requestAnimationFrame(() => this.animate()));
    }

    drawBackground() {
        // Simple gradient background - very fast
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        gradient.addColorStop(0, '#051015');
        gradient.addColorStop(1, '#02080A');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawAurora() {
        const maxIntensity = Math.max(...this.auroraLayers.map(l => l.intensity));
        if (maxIntensity < 0.01) return;

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';

        // Optimized Aurora: No shadowBlur, just transparency
        this.auroraLayers.forEach((layer, i) => {
            if (layer.intensity < 0.01) return;

            this.ctx.beginPath();
            const yBase = this.canvas.height * 0.2;

            this.ctx.moveTo(0, yBase);

            // Reduced resolution for sine wave calculation
            for (let x = 0; x <= this.canvas.width; x += 100) {
                const noise = Math.sin(x * 0.005 + this.animationTime * 0.5 + layer.offset)
                    * Math.cos(x * 0.01 - this.animationTime * 0.2);
                const y = yBase + noise * 100 - (layer.intensity * 50);
                this.ctx.lineTo(x, y);
            }

            this.ctx.lineTo(this.canvas.width, 0);
            this.ctx.lineTo(0, 0);
            this.ctx.closePath();

            this.ctx.fillStyle = layer.color;
            this.ctx.globalAlpha = layer.intensity * 0.5;
            this.ctx.fill();

            // Simple stroke for definition
            this.ctx.strokeStyle = layer.color;
            this.ctx.globalAlpha = layer.intensity * 0.8;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        });

        this.ctx.restore();
    }

    drawTrees() {
        // Sort trees by layer
        const sortedTrees = [...this.trees].sort((a, b) => b.layer - a.layer);

        sortedTrees.forEach((tree) => {
            // Apply wind and sway
            const currentSwayAmount = tree.baseSwayAmount + this.windSpeed;
            tree.swayPhase += tree.swaySpeed + this.windSpeed * 0.5;
            const sway = Math.sin(tree.swayPhase) * currentSwayAmount * tree.height;

            this.ctx.save();
            this.ctx.translate(tree.x, tree.y);

            // Draw Trunk
            this.ctx.fillStyle = tree.color;
            this.ctx.beginPath();
            this.ctx.moveTo(-tree.width / 4, 0);
            this.ctx.lineTo(-tree.width / 8 + sway * 0.1, -tree.trunkHeight);
            this.ctx.lineTo(tree.width / 8 + sway * 0.1, -tree.trunkHeight);
            this.ctx.lineTo(tree.width / 4, 0);
            this.ctx.fill();

            // Draw Runes (Optimized: No shadowBlur)
            if (tree.hasRune && this.magicGlow > 0.05) {
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'screen';
                // Draw glow as thick transparent line
                this.ctx.strokeStyle = `rgba(100, 255, 255, ${this.magicGlow * 0.3})`;
                this.ctx.lineWidth = 6;
                this.ctx.lineCap = 'round';

                const ry = tree.runeY;
                this.drawRunePath(tree.runeType, ry);
                this.ctx.stroke();

                // Draw core as thin bright line
                this.ctx.strokeStyle = `rgba(200, 255, 255, ${this.magicGlow})`;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                this.ctx.restore();
            }

            // Draw Foliage
            const startY = -tree.trunkHeight;
            const layerHeight = (tree.height - tree.trunkHeight) / tree.numFoliageLayers;

            for (let j = 0; j < tree.numFoliageLayers; j++) {
                const cY = startY - j * layerHeight;
                const widthScale = (tree.numFoliageLayers - j) / tree.numFoliageLayers;
                const cW = tree.width * widthScale;
                const layerSway = sway * ((j + 1) / tree.numFoliageLayers);

                this.ctx.beginPath();
                this.ctx.moveTo(layerSway, cY - layerHeight);
                this.ctx.lineTo(-cW / 2 + layerSway * 0.8, cY);
                this.ctx.lineTo(cW / 2 + layerSway * 0.8, cY);
                this.ctx.closePath();

                this.ctx.fillStyle = tree.color;
                this.ctx.fill();
            }

            this.ctx.restore();
        });
    }

    drawRunePath(type, ry) {
        this.ctx.beginPath();
        if (type === 0) {
            this.ctx.moveTo(0, ry - 10);
            this.ctx.lineTo(0, ry + 10);
            this.ctx.moveTo(-5, ry);
            this.ctx.lineTo(5, ry);
        } else if (type === 1) {
            this.ctx.moveTo(0, ry - 8);
            this.ctx.lineTo(5, ry);
            this.ctx.lineTo(0, ry + 8);
            this.ctx.lineTo(-5, ry);
            this.ctx.closePath();
        } else {
            this.ctx.moveTo(0, ry - 10);
            this.ctx.lineTo(0, ry + 10);
            this.ctx.moveTo(0, ry - 10);
            this.ctx.lineTo(-5, ry - 5);
            this.ctx.moveTo(0, ry - 10);
            this.ctx.lineTo(5, ry - 5);
        }
    }

    drawMist() {
        if (!this.mistSprite) return;

        this.mistLayers.forEach((mist) => {
            mist.x += mist.speed;
            if (mist.x > this.canvas.width + mist.width) {
                mist.x = -mist.width;
            }

            this.ctx.save();
            this.ctx.globalAlpha = mist.opacity;
            this.ctx.translate(mist.x, mist.y);
            this.ctx.scale(mist.width / 200, mist.height / 200); // Scale sprite
            this.ctx.drawImage(this.mistSprite, 0, 0);
            this.ctx.restore();
        });
    }

    drawGodRays() {
        if (!this.godRaySprite) return;

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';

        this.godRays.forEach(ray => {
            ray.x += Math.sin(this.animationTime * 0.5) * 0.2;

            this.ctx.save();
            this.ctx.translate(ray.x, ray.y);
            this.ctx.rotate(ray.angle);
            this.ctx.globalAlpha = ray.opacity;
            // Stretch sprite to fit ray dimensions
            this.ctx.drawImage(this.godRaySprite, -ray.width / 2, 0, ray.width, ray.height);
            this.ctx.restore();
        });

        this.ctx.restore();
    }

    drawForestSpirits() {
        this.forestSpirits.forEach(spirit => {
            // Logic update
            spirit.wanderPhase += 0.01;
            spirit.targetX += Math.cos(spirit.wanderPhase) * 2;
            spirit.targetY += Math.sin(spirit.wanderPhase * 1.3) * 1;

            const dx = spirit.targetX - spirit.x;
            const dy = spirit.targetY - spirit.y;
            spirit.vx += dx * 0.001;
            spirit.vy += dy * 0.001;

            if (this.comboMultiplier > 1.5) {
                const cx = this.canvas.width / 2;
                const cy = this.canvas.height / 2;
                spirit.vx += (cx - spirit.x) * 0.0005 * this.comboMultiplier;
                spirit.vy += (cy - spirit.y) * 0.0005 * this.comboMultiplier;
            }

            spirit.vx *= 0.96;
            spirit.vy *= 0.96;
            spirit.x += spirit.vx;
            spirit.y += spirit.vy;

            if (this.frameCount % 3 === 0) {
                spirit.trail.push({ x: spirit.x, y: spirit.y });
                if (spirit.trail.length > spirit.maxTrailLength) spirit.trail.shift();
            }

            // Draw Trail
            if (spirit.trail.length > 1) {
                this.ctx.beginPath();
                this.ctx.moveTo(spirit.trail[0].x, spirit.trail[0].y);
                for (let i = 1; i < spirit.trail.length; i++) {
                    this.ctx.lineTo(spirit.trail[i].x, spirit.trail[i].y);
                }
                this.ctx.strokeStyle = `hsla(${spirit.hue}, 80%, 70%, ${spirit.opacity * 0.5})`;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }

            // Draw Spirit (Optimized: No shadowBlur)
            const pulse = Math.sin(this.animationTime * 5 + spirit.x) * 0.2 + 1;
            this.ctx.fillStyle = `hsla(${spirit.hue}, 100%, 85%, ${spirit.opacity})`;

            // Draw outer glow as a larger, transparent circle
            this.ctx.beginPath();
            this.ctx.arc(spirit.x, spirit.y, spirit.size * 0.6 * pulse, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${spirit.hue}, 100%, 70%, ${spirit.opacity * 0.3})`;
            this.ctx.fill();

            // Draw core
            this.ctx.beginPath();
            this.ctx.arc(spirit.x, spirit.y, spirit.size * 0.3 * pulse, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${spirit.hue}, 100%, 90%, ${spirit.opacity})`;
            this.ctx.fill();
        });
    }

    drawFireflies() {
        this.ctx.fillStyle = '#ccffaa';
        this.fireflies.forEach(fly => {
            fly.x += fly.vx + Math.sin(this.animationTime + fly.y * 0.01) * 0.5;
            fly.y += fly.vy;

            if (fly.x < 0) fly.x = this.canvas.width;
            if (fly.x > this.canvas.width) fly.x = 0;
            if (fly.y < 0) fly.y = this.canvas.height;
            if (fly.y > this.canvas.height) fly.y = 0;

            const opacity = Math.sin(this.animationTime * 5 + fly.x) * 0.5 + 0.5;
            this.ctx.globalAlpha = opacity * fly.opacity;
            this.ctx.beginPath();
            this.ctx.arc(fly.x, fly.y, fly.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1;
    }

    drawFallingLeaves() {
        for (let i = this.fallingLeaves.length - 1; i >= 0; i--) {
            const leaf = this.fallingLeaves[i];
            leaf.life -= 0.005;
            leaf.x += leaf.vx;
            leaf.y += leaf.vy;
            leaf.rotation += leaf.rotationSpeed;

            if (leaf.life <= 0 || leaf.y > this.canvas.height) {
                this.fallingLeaves.splice(i, 1);
                continue;
            }

            this.ctx.save();
            this.ctx.translate(leaf.x, leaf.y);
            this.ctx.rotate(leaf.rotation);
            this.ctx.fillStyle = `hsla(${leaf.hue}, 70%, 50%, ${leaf.opacity * leaf.life})`;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, leaf.size, leaf.size / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    createSpiritWinds() {
        this.spiritWinds = [];
        for (let i = 0; i < this.maxSpiritWinds; i++) {
            this.spiritWinds.push(this.createWindAgent(true));
        }
    }

    createWindAgent(randomX = false) {
        return {
            x: randomX ? Math.random() * this.canvas.width : -100 - Math.random() * 200,
            y: Math.random() * this.canvas.height * 0.6 + 100,
            speed: Math.random() * 1.0 + 1.5, // Slower for grace
            angle: (Math.random() - 0.5) * 0.5,
            trail: [],
            maxTrailLength: 40 + Math.floor(Math.random() * 20), // Longer trails
            life: 0,
            maxLife: 400 + Math.random() * 200,
            width: Math.random() * 2 + 1, // Thinner
            swirlTimer: Math.floor(Math.random() * 200),
            swirlDuration: 0,
            color: `hsla(${160 + Math.random() * 30}, 70%, 65%,` // Less bright/saturated
        };
    }

    drawSpiritWinds() {
        this.ctx.save();
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.spiritWinds.forEach((wind, index) => {
            // --- UPDATE ---
            wind.life++;

            // 1. Movement Logic

            // Base forward movement (Reduced speed for subtlety)
            const speed = (wind.speed + this.windSpeed * 60) * 0.8;
            wind.x += Math.cos(wind.angle) * speed;
            wind.y += Math.sin(wind.angle) * speed;

            // Wavy wandering motion (Layered Sine waves for organic feel)
            const t = this.animationTime * 1.5 + index * 10;
            wind.angle += Math.sin(t) * 0.02 + Math.cos(t * 2.3) * 0.01;

            // 2. Swirl/Loop Logic
            wind.swirlTimer++;
            if (wind.swirlTimer > 400) { // Less frequent loops
                wind.swirlDuration = 60; // Slower, larger loops
                wind.swirlTimer = 0;
            }

            if (wind.swirlDuration > 0) {
                // Execute loop: Gentle turn
                wind.angle += 0.12;
                wind.swirlDuration--;
            } else {
                // Return to horizontal-ish flow gently
                wind.angle = wind.angle * 0.98;
            }

            // 3. Trail Management
            wind.trail.push({ x: wind.x, y: wind.y });

            // Prune trail
            if (wind.trail.length > wind.maxTrailLength) {
                wind.trail.shift();
            }

            // Reset if dead or far off screen
            if (wind.life > wind.maxLife || wind.x > this.canvas.width + 200) {
                this.spiritWinds[index] = this.createWindAgent();
                return;
            }

            // --- DRAW ---
            if (wind.trail.length < 3) return;

            // Calculate opacity based on life (fade in/out)
            const lifeOpacity = Math.min(1, wind.life / 100) * Math.min(1, (wind.maxLife - wind.life) / 100);
            const maxOpacity = 0.35; // Much more subtle (was ~1.0 effectively)
            const finalOpacity = lifeOpacity * maxOpacity;

            // Draw Outer Glow
            this.ctx.beginPath();
            this.ctx.moveTo(wind.trail[0].x, wind.trail[0].y);

            // Smooth curve through trail points
            for (let i = 1; i < wind.trail.length - 1; i++) {
                const xc = (wind.trail[i].x + wind.trail[i + 1].x) / 2;
                const yc = (wind.trail[i].y + wind.trail[i + 1].y) / 2;
                this.ctx.quadraticCurveTo(wind.trail[i].x, wind.trail[i].y, xc, yc);
            }
            this.ctx.lineTo(wind.trail[wind.trail.length - 1].x, wind.trail[wind.trail.length - 1].y);

            this.ctx.strokeStyle = wind.color + `${finalOpacity})`;
            this.ctx.lineWidth = wind.width;
            this.ctx.shadowBlur = 20; // Softer blur
            this.ctx.shadowColor = wind.color + '0.4)';
            this.ctx.stroke();

            // Draw Inner Core (Tinted, not pure white, and more transparent)
            this.ctx.strokeStyle = `rgba(200, 240, 230, ${finalOpacity * 0.6})`; // Pale Cyan/Green
            this.ctx.lineWidth = 1; // Thinner core
            this.ctx.shadowBlur = 0;
            this.ctx.stroke();
        });

        this.ctx.restore();
    }

    stop() {
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        super.stop();
        this.animationTime = 0;
        this.trees = [];
        this.mistLayers = [];
        this.fireflies = [];
        this.fallingLeaves = [];
        this.godRays = [];
        this.forestSpirits = [];
        this.auroraLayers = [];
        this.spiritWinds = [];
        this.gradientCache.clear();
        this.mistSprite = null;
        this.godRaySprite = null;
    }

    getTetrominoConfig() {
        return SWEDISH_FOREST_TETROMINOS;
    }
}

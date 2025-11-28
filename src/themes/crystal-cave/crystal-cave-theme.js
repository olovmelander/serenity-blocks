/**
 * @fileoverview Crystal Cave Theme - Mystical cave with glowing crystals and atmospheric depth
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { CRYSTAL_CAVE_TETROMINOS } from './crystal-cave-tetrominos.js';

export default class CrystalCaveTheme extends BaseTheme {
    constructor() {
        super('crystal-cave');
        this.canvas = null;
        this.ctx = null;
        this.animationFrameId = null;
        this.time = 0;

        // Scene Configuration
        this.config = {
            crystalCount: { far: 30, mid: 20, near: 12 },
            colors: {
                bgTop: '#020104',
                bgBottom: '#0a0412',
                mist: '#1a0b2e', // Deep purple mist for depth
                ambient: 'rgba(100, 50, 180, 0.05)',
                palettes: [
                    { main: '#9b59b6', glow: '#e056fd', light: '#f8f0fc' }, // Amethyst
                    { main: '#00b894', glow: '#55efc4', light: '#e0fcf6' }, // Emerald
                    { main: '#0984e3', glow: '#74b9ff', light: '#e6f2ff' }, // Sapphire
                    { main: '#e84393', glow: '#fd79a8', light: '#fff0f5' }, // Rose
                ],
            },
        };

        // State
        this.layers = [];
        this.particles = [];
        this.particles = [];
        this.energyArcs = [];
        this.orb = {
            angle: 0,
            targetSpeed: 0.005,
            currentSpeed: 0.005,
            energy: 0,
        };
        this.resonance = 0; // 0 to 1, drives intensity
        this.targetResonance = 0;
        this.comboActive = false;

        this.eventUnsubscribers = [];
    }

    async createScene() {
        const themeContainer = document.getElementById('crystal-cave-theme');
        if (!themeContainer) return;

        // Setup Canvas
        let canvas = document.getElementById('crystal-cave-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'crystal-cave-canvas';
            Object.assign(canvas.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                zIndex: '-1',
                background: `linear-gradient(to bottom, ${this.config.colors.bgTop}, ${this.config.colors.bgBottom})`,
            });
            themeContainer.appendChild(canvas);
        }
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        this.resizeHandler = () => this.resize();
        window.addEventListener('resize', this.resizeHandler);
        this.resize();

        this.setupEventListeners();
        this.animate();
    }

    resize() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.initElements();
    }

    initElements() {
        this.layers = [];
        this.particles = [];

        // Create Layers (Far, Mid, Near) with distinct depth properties
        // Far: Small, blurred, heavy mist
        this.createLayer(this.config.crystalCount.far, 0.3, 0.4, 0.02, 0.8, 2);

        // Mid: Main focus, slight mist
        this.createLayer(this.config.crystalCount.mid, 0.7, 0.8, 0.05, 0.2, 0);

        // Near: Large, clear, no mist
        this.createLayer(this.config.crystalCount.near, 1.2, 1.0, 0.1, 0.0, 0);

        // Init Ambient Particles (Spores)
        for (let i = 0; i < 100; i++) {
            this.particles.push(this.createParticle(true));
        }
    }

    createLayer(count, scale, opacity, parallaxFactor, mistOpacity, blur) {
        const crystals = [];
        // Distribute crystals evenly across 4 sides
        const sides = ['top', 'bottom', 'left', 'right'];
        const countPerSide = Math.ceil(count / 4);

        sides.forEach((side) => {
            for (let i = 0; i < countPerSide; i++) {
                // Calculate position along the edge (0.0 to 1.0)
                const t = (i + Math.random()) / countPerSide;
                crystals.push(this.generateCrystal(scale, opacity, side, t));
            }
        });

        this.layers.push({
            crystals, parallaxFactor, zIndex: scale, mistOpacity, blur,
        });
    }

    generateCrystal(scaleBase, opacityBase, side, t) {
        const scale = scaleBase * (0.8 + Math.random() * 0.4);
        const thickness = (40 + Math.random() * 60) * scale;
        const length = (150 + Math.random() * 300) * scale;
        const palette = this.config.colors.palettes[Math.floor(Math.random() * this.config.colors.palettes.length)];

        let x; let y; let
            rotation;

        // Position based on side and 't' (0-1 position along edge)
        if (side === 'top') {
            x = this.canvas.width * t;
            y = -20 * scale; // Slight overlap
            rotation = 0;
        } else if (side === 'bottom') {
            x = this.canvas.width * t;
            y = this.canvas.height + 20 * scale;
            rotation = Math.PI;
        } else if (side === 'left') {
            x = -20 * scale;
            y = this.canvas.height * t;
            rotation = -Math.PI / 2; // Point Right
        } else { // right
            x = this.canvas.width + 20 * scale;
            y = this.canvas.height * t;
            rotation = Math.PI / 2; // Point Left
        }

        // Generate cached image for performance
        const cache = this.createCrystalCache(thickness, length, palette);

        return {
            x,
            y,
            side,
            rotation,
            thickness,
            length,
            cache, // The pre-rendered canvas
            color: palette,
            opacity: opacityBase,
            pulsePhase: Math.random() * Math.PI * 2,
            shimmerSpeed: 0.02 + Math.random() * 0.03,
        };
    }

    createCrystalCache(w, h, palette) {
        const canvas = document.createElement('canvas');
        // Increased padding for baked glow
        const pad = 30;
        canvas.width = w + pad * 2;
        canvas.height = h + pad * 2;
        const ctx = canvas.getContext('2d');

        const cx = canvas.width / 2;
        const cy = pad; // Start from top (base)

        // Define Path
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.lineTo(cx - w / 3, cy + h * 0.5);
        ctx.lineTo(cx, cy + h); // Tip
        ctx.lineTo(cx + w / 3, cy + h * 0.6);
        ctx.lineTo(cx + w / 2, cy);
        ctx.closePath();

        // 1. Baked Outer Glow (Expensive but cached)
        ctx.save();
        ctx.shadowBlur = 25;
        ctx.shadowColor = palette.glow;
        ctx.fillStyle = palette.main;
        ctx.fill();
        ctx.restore();

        // 2. Internal Light (Radial Gradient for Core)
        const grad = ctx.createRadialGradient(cx, cy + h * 0.2, 0, cx, cy + h * 0.4, h * 0.8);
        grad.addColorStop(0, palette.light); // Bright Core
        grad.addColorStop(0.4, palette.main); // Body
        grad.addColorStop(1, 'rgba(5, 2, 10, 0.9)'); // Dark Tip
        ctx.fillStyle = grad;
        ctx.fill();

        // 3. Glassy Facets
        // Left Facet (Reflection)
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx - w / 3, cy + h * 0.5);
        ctx.closePath();
        const facetGrad = ctx.createLinearGradient(cx - w / 2, cy, cx, cy + h);
        facetGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
        facetGrad.addColorStop(1, 'rgba(255,255,255,0.0)');
        ctx.fillStyle = facetGrad;
        ctx.fill();

        // Right Facet (Shadow)
        ctx.beginPath();
        ctx.moveTo(cx + w / 2, cy);
        ctx.lineTo(cx, cy + h);
        ctx.lineTo(cx + w / 3, cy + h * 0.6);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();

        // 4. Highlights & Edges
        // Center Ridge
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + h);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Rim Light
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.lineTo(cx - w / 3, cy + h * 0.5);
        ctx.lineTo(cx, cy + h);
        ctx.strokeStyle = palette.glow;
        ctx.lineWidth = 1;
        ctx.stroke();

        return canvas;
    }

    createParticle(isAmbient = false, x, y) {
        return {
            x: x || Math.random() * this.canvas.width,
            y: y || Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * (isAmbient ? 0.5 : 4),
            vy: (Math.random() - 0.5) * (isAmbient ? 0.5 : 4),
            size: Math.random() * (isAmbient ? 2 : 4),
            life: 1.0,
            decay: isAmbient ? 0.005 : 0.02,
            color: isAmbient ? '#ffffff' : this.config.colors.palettes[Math.floor(Math.random() * 4)].glow,
            isAmbient,
        };
    }

    setupEventListeners() {
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const count = data.comboCount || data.count || 1;
            this.triggerComboEffect(count);
        });
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, () => {
            this.targetResonance = Math.min(this.targetResonance + 0.3, 1.5);
        });
        this.eventUnsubscribers.push(comboUnsub, lineClearUnsub);
    }

    triggerComboEffect(count) {
        this.targetResonance = Math.min(this.targetResonance + 0.5, 3.0); // Higher max resonance
        this.comboActive = true;

        // Select random crystals from mid/near layers to "activate"
        const activeLayers = [this.layers[1], this.layers[2]];
        const candidates = activeLayers.flatMap((l) => l.crystals);

        const activationCount = Math.min(count + 2, 10);
        for (let i = 0; i < activationCount; i++) {
            if (candidates.length === 0) break;
            const idx = Math.floor(Math.random() * candidates.length);
            const crystal = candidates[idx];

            // Trigger Flare
            crystal.flare = 1.0;

            // Spin Orb
            this.orb.energy = Math.min(this.orb.energy + 0.3, 3.0); // Grow larger
            this.orb.targetSpeed = Math.min(this.orb.targetSpeed + 0.05, 0.4);

            // Create Energy Arc to center (Orb)
            // Calculate start point (tip of crystal)
            let sx = crystal.x;
            let sy = crystal.y;
            if (crystal.side === 'top') sy += crystal.length;
            else if (crystal.side === 'bottom') sy -= crystal.length;
            else if (crystal.side === 'left') sx += crystal.length;
            else sx -= crystal.length;

            this.energyArcs.push({
                sx,
                sy,
                ex: this.canvas.width / 2,
                ey: this.canvas.height / 2,
                color: crystal.color.glow,
                life: 1.0,
                width: 2 + Math.random() * 3,
            });

            // Burst particles from tip
            for (let p = 0; p < 5; p++) {
                this.particles.push(this.createParticle(false, sx, sy));
            }
        }
    }

    animate() {
        if (!this.canvas) return;

        this.time += 0.016;
        this.resonance += (this.targetResonance - this.resonance) * 0.05;
        this.targetResonance *= 0.98; // Decay target
        if (this.resonance < 0.01) this.resonance = 0;

        // Orb Physics
        this.orb.currentSpeed += (this.orb.targetSpeed - this.orb.currentSpeed) * 0.05;
        this.orb.targetSpeed = Math.max(0.005, this.orb.targetSpeed * 0.98); // Decay speed
        this.orb.angle += this.orb.currentSpeed;
        this.orb.energy *= 0.98; // Decay energy

        // Clear & Background
        const grad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        grad.addColorStop(0, this.config.colors.bgTop);
        grad.addColorStop(1, this.config.colors.bgBottom);
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw Layers
        this.layers.forEach((layer, index) => {
            this.drawLayer(layer, index);
        });

        // Draw Particles
        this.drawParticles();

        // Draw Energy Arcs
        this.drawEnergyArcs();

        // Draw Orb
        this.drawOrb();

        // Vignette / Atmosphere
        this.drawAtmosphere();

        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    drawLayer(layer, layerIndex) {
        // Calculate Layer Offset (Parallax Drift)
        const drift = Math.sin(this.time * 0.2) * 20 * layer.parallaxFactor;

        // Apply Blur for depth of field
        if (layer.blur > 0) {
            this.ctx.filter = `blur(${layer.blur}px)`;
        }

        layer.crystals.forEach((c) => {
            // Physics/Animation
            const pulse = (Math.sin(this.time * 0.8 + c.pulsePhase) + 1) / 2;
            const resonanceShake = (Math.random() - 0.5) * this.resonance * 5;

            // Glow Intensity
            const activeGlow = 1 + (this.resonance * 2) + (pulse * 0.5);

            this.ctx.save();

            // Translate to position
            let dx = c.x + resonanceShake;
            const dy = c.y;

            // Apply drift based on orientation (horizontal drift for top/bottom, vertical for left/right?)
            // Keeping it simple: drift is always horizontal for now to simulate camera movement
            dx += drift;

            this.ctx.translate(dx, dy);
            this.ctx.rotate(c.rotation);

            // Draw Cached Crystal
            // Offset by -width/2 and padding to center it
            const pad = 30;
            this.ctx.globalAlpha = c.opacity;
            this.ctx.drawImage(c.cache, -c.cache.width / 2, -pad);

            // Draw Glow Overlay (Additive) if resonance is high
            // Draw Glow Overlay (Additive)
            // Increased glow intensity
            const flare = c.flare || 0;
            if (this.resonance > 0.1 || pulse > 0.5 || flare > 0.01) {
                this.ctx.globalCompositeOperation = 'screen';
                // Base glow + Resonance boost + Flare boost
                let glowAlpha = (this.resonance * 0.6 + pulse * 0.3) * c.opacity;
                glowAlpha += flare; // Flare adds intense brightness

                this.ctx.globalAlpha = Math.min(glowAlpha, 1.0);
                this.ctx.drawImage(c.cache, -c.cache.width / 2, -pad);

                // Double glow for flare
                if (flare > 0.2) {
                    this.ctx.globalCompositeOperation = 'add';
                    this.ctx.globalAlpha = flare * 0.5;
                    this.ctx.drawImage(c.cache, -c.cache.width / 2, -pad);
                }
            }

            // Decay flare
            if (c.flare > 0) c.flare *= 0.9;

            this.ctx.restore();
        });

        // Reset Filter
        if (layer.blur > 0) {
            this.ctx.filter = 'none';
        }

        // Apply Atmospheric Mist
        if (layer.mistOpacity > 0) {
            this.ctx.fillStyle = this.config.colors.mist;
            this.ctx.globalAlpha = layer.mistOpacity;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.globalAlpha = 1.0;
        }
    }

    drawParticles() {
        this.ctx.globalCompositeOperation = 'screen';
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;

            // Wrap ambient
            if (p.isAmbient) {
                if (p.life < 0) p.life = 1; // Reset life
                if (p.x < 0) p.x = this.canvas.width;
                if (p.x > this.canvas.width) p.x = 0;
                if (p.y < 0) p.y = this.canvas.height;
                if (p.y > this.canvas.height) p.y = 0;
            } else if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            const alpha = p.life * (p.isAmbient ? 0.4 : 1.0);
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalCompositeOperation = 'source-over';
    }

    drawOrb() {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const baseSize = 40;
        // Dynamic size based on energy
        const size = baseSize + (this.orb.energy * 20) + (this.resonance * 10);

        this.ctx.save();
        this.ctx.translate(cx, cy);

        // 1. Solid Sphere Core (3D Shading)
        // Shift color based on energy: Deep Blue -> White/Cyan
        const energyRatio = Math.min(this.orb.energy / 2, 1);

        const coreGrad = this.ctx.createRadialGradient(-size * 0.3, -size * 0.3, 0, 0, 0, size);
        if (energyRatio > 0.5) {
            // High Energy: White hot center, Cyan edge
            coreGrad.addColorStop(0, '#ffffff');
            coreGrad.addColorStop(0.4, '#81ecec');
            coreGrad.addColorStop(1, '#00cec9');
        } else {
            // Low Energy: Light Blue center, Deep Blue edge
            coreGrad.addColorStop(0, '#74b9ff');
            coreGrad.addColorStop(0.5, '#0984e3');
            coreGrad.addColorStop(1, '#2d3436');
        }

        this.ctx.beginPath();
        this.ctx.arc(0, 0, size, 0, Math.PI * 2);
        this.ctx.fillStyle = coreGrad;
        this.ctx.shadowBlur = 20 * energyRatio;
        this.ctx.shadowColor = '#81ecec';
        this.ctx.fill();
        this.ctx.shadowBlur = 0; // Reset

        // Rim Highlight
        this.ctx.beginPath();
        this.ctx.arc(0, 0, size, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // 2. Thick Energy Swirls (The "Liquid" bands)
        this.ctx.rotate(this.orb.angle);
        const swirlCount = 3;

        for (let i = 0; i < swirlCount; i++) {
            this.ctx.rotate(Math.PI * 2 / swirlCount);
            this.ctx.save();

            // Animate expansion
            const breathe = 1 + Math.sin(this.time * 8 + i) * 0.05;
            this.ctx.scale(breathe, breathe);

            this.ctx.beginPath();
            // Draw a swoosh shape wrapping around
            this.ctx.moveTo(size * 0.9, -size * 0.2);
            // Outer curve
            this.ctx.bezierCurveTo(
                size * 1.6,
                size * 0.5,
                size * 0.5,
                size * 1.6,
                -size * 0.5,
                size * 1.0,
            );
            // Inner curve back to start (tapering)
            this.ctx.bezierCurveTo(
                size * 0.2,
                size * 1.2,
                size * 1.2,
                size * 0.8,
                size * 0.9,
                -size * 0.2,
            );

            this.ctx.fillStyle = energyRatio > 0.5 ? 'rgba(255, 255, 255, 0.9)' : 'rgba(129, 236, 236, 0.7)';
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = energyRatio > 0.5 ? '#ffffff' : '#00d2d3';
            this.ctx.fill();

            this.ctx.restore();
        }

        this.ctx.restore();

        // 3. Sparkles (Ignition particles)
        if (this.orb.energy > 0.2) {
            this.spawnOrbSparkles(cx, cy, size);
        }
    }

    spawnOrbSparkles(x, y, radius) {
        // Spawn rate depends on energy
        const count = Math.floor(this.orb.energy * 1.5);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            // Start slightly inside the orb
            const dist = (Math.random() * 0.5 + 0.2) * radius;
            const px = x + Math.cos(angle) * dist;
            const py = y + Math.sin(angle) * dist;

            this.particles.push({
                x: px,
                y: py,
                // Explode outwards
                vx: Math.cos(angle) * (2 + Math.random() * 4),
                vy: Math.sin(angle) * (2 + Math.random() * 4),
                size: Math.random() * 3 + 1,
                life: 1.0,
                decay: 0.03 + Math.random() * 0.03,
                color: Math.random() > 0.5 ? '#ffffff' : '#81ecec', // White or Cyan sparks
                isAmbient: false,
            });
        }
    }

    drawEnergyArcs() {
        this.ctx.globalCompositeOperation = 'screen';
        for (let i = this.energyArcs.length - 1; i >= 0; i--) {
            const arc = this.energyArcs[i];
            arc.life -= 0.05;
            if (arc.life <= 0) {
                this.energyArcs.splice(i, 1);
                continue;
            }

            this.ctx.beginPath();
            this.ctx.moveTo(arc.sx, arc.sy);

            // Jagged line to center
            const segments = 5;
            let cx = arc.sx;
            let cy = arc.sy;
            for (let j = 1; j <= segments; j++) {
                const t = j / segments;
                const tx = arc.sx + (arc.ex - arc.sx) * t;
                const ty = arc.sy + (arc.ey - arc.sy) * t;

                // Jitter
                const jitter = (Math.random() - 0.5) * 30 * arc.life;
                cx = tx + jitter;
                cy = ty + jitter;
                this.ctx.lineTo(cx, cy);
            }

            this.ctx.strokeStyle = arc.color;
            this.ctx.lineWidth = arc.width * arc.life;
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = arc.color;
            this.ctx.stroke();
            this.ctx.shadowBlur = 0;
        }
        this.ctx.globalCompositeOperation = 'source-over';
    }

    drawAtmosphere() {
        // Vignette
        const grad = this.ctx.createRadialGradient(
            this.canvas.width / 2,
            this.canvas.height / 2,
            this.canvas.width * 0.3,
            this.canvas.width / 2,
            this.canvas.height / 2,
            this.canvas.width * 0.8,
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.6)');

        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    stop() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        this.eventUnsubscribers.forEach((u) => u());
        this.eventUnsubscribers = [];
        if (this.canvas) this.canvas.remove();
        this.canvas = null;
    }

    getTetrominoConfig() {
        return CRYSTAL_CAVE_TETROMINOS;
    }
}

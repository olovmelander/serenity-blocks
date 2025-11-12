import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class BioluminescenceTheme extends BaseTheme {
    constructor() {
        super('bioluminescence');
        this.canvas = null;
        this.ctx = null;
        this.resizeHandler = null;
        this.time = 0;

        // Background elements
        this.glowingPlants = []; // Various bioluminescent plants
        this.crystalFormations = []; // Glowing crystal clusters
        this.fireflies = [];
        this.spores = [];
        this.ambientGlows = []; // Floating ambient light spots
        this.luminousVines = []; // Hanging glowing vines

        // Performance limits
        this.MAX_PARTICLES = 200;
        this.MAX_ENERGY_WAVES = 8;
        this.MAX_LIGHT_BURSTS = 5;
        this.MAX_COMBO_ORBS = 20;
        this.MAX_AURORAS = 3;

        // Gameplay effects
        this.energyWaves = [];
        this.lightBursts = [];
        this.comboOrbs = [];
        this.auroraEffects = [];
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Cached gradients
        this.cachedGradients = {};
    }

    async createScene() {
        console.log('🍄 Bioluminescence theme: createScene() called');

        // Look for canvas in the theme container
        const themeContainer = document.getElementById('bioluminescence-theme');
        this.canvas = document.getElementById('bio-canvas');

        if (!this.canvas && themeContainer) {
            // Create canvas if it doesn't exist
            console.log('🍄 Creating new canvas element');
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'bio-canvas';
            this.canvas.style.position = 'absolute';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.pointerEvents = 'none';
            themeContainer.appendChild(this.canvas);
        }

        if (!this.canvas) {
            console.error('❌ Bioluminescence: Could not create or find canvas');
            return;
        }

        console.log('✅ Bioluminescence: Canvas ready, dimensions:', this.canvas.width, 'x', this.canvas.height);

        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });

        // Set initial canvas size BEFORE creating elements
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;

        this.resizeHandler = () => this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler, false);

        // Cache gradients after setting size
        this.cacheGradients();

        // Initialize scene elements (NOW canvas has proper dimensions)
        this.createGlowingPlants();
        this.createCrystalFormations();
        this.createLuminousVines();
        this.createFireflies();
        this.createSpores();
        this.createAmbientGlows();

        // Setup gameplay event listeners
        this.setupEventListeners();

        console.log('🍄 Scene setup complete, starting animation. Plants:', this.glowingPlants.length, 'Fireflies:', this.fireflies.length);
        this.animate();
    }

    resizeCanvas() {
        if (!this.canvas || !this.ctx) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.cacheGradients();
    }

    cacheGradients() {
        if (!this.ctx || !this.canvas) return;

        // Background gradient - deep forest to bioluminescent glow
        this.cachedGradients.background = this.ctx.createRadialGradient(
            this.canvas.width * 0.5, this.canvas.height * 0.5,
            0,
            this.canvas.width * 0.5, this.canvas.height * 0.5,
            this.canvas.height * 0.9
        );
        this.cachedGradients.background.addColorStop(0, '#0a1f1f');
        this.cachedGradients.background.addColorStop(0.4, '#061518');
        this.cachedGradients.background.addColorStop(0.7, '#040d12');
        this.cachedGradients.background.addColorStop(1, '#020508');
    }

    createGlowingPlants() {
        const plantCount = 30;
        const plantTypes = ['fern', 'flower', 'grass', 'bulb', 'tendril'];

        for (let i = 0; i < plantCount; i++) {
            const type = plantTypes[Math.floor(Math.random() * plantTypes.length)];
            const x = Math.random() * this.canvas.width;
            const baseY = this.canvas.height;

            const plant = {
                type: type,
                x: x,
                y: baseY,
                height: Math.random() * 120 + 60,
                width: Math.random() * 60 + 30,
                glowIntensity: Math.random() * 0.6 + 0.4,
                pulseSpeed: Math.random() * 0.015 + 0.008,
                pulsePhase: Math.random() * Math.PI * 2,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: Math.random() * 0.01 + 0.005,
                swayAmount: Math.random() * 15 + 5,
                hue: Math.random() * 40 + 160, // Cyan to green range
                layer: Math.random()
            };

            // Type-specific properties
            if (type === 'fern') {
                plant.fronds = Math.floor(Math.random() * 5) + 4;
            } else if (type === 'flower') {
                plant.petals = Math.floor(Math.random() * 4) + 5;
                plant.centerSize = Math.random() * 8 + 6;
            } else if (type === 'bulb') {
                plant.bulbSize = Math.random() * 20 + 15;
                plant.stemHeight = plant.height * 0.7;
            } else if (type === 'tendril') {
                plant.segments = Math.floor(Math.random() * 6) + 5;
            }

            this.glowingPlants.push(plant);
        }

        // Sort by layer for depth
        this.glowingPlants.sort((a, b) => a.layer - b.layer);
    }

    createCrystalFormations() {
        const formationCount = 15;

        for (let i = 0; i < formationCount; i++) {
            const crystalCount = Math.floor(Math.random() * 4) + 3;
            const crystals = [];
            const baseX = Math.random() * this.canvas.width;
            const baseY = this.canvas.height - Math.random() * 80;

            for (let j = 0; j < crystalCount; j++) {
                crystals.push({
                    offsetX: (Math.random() - 0.5) * 40,
                    height: Math.random() * 50 + 30,
                    width: Math.random() * 15 + 10,
                    angle: (Math.random() - 0.5) * 0.3,
                    glowIntensity: Math.random() * 0.5 + 0.5
                });
            }

            this.crystalFormations.push({
                x: baseX,
                y: baseY,
                crystals: crystals,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulsePhase: Math.random() * Math.PI * 2,
                hue: Math.random() * 30 + 170, // Cyan-ish crystals
                layer: Math.random() * 0.5 // Front layer mostly
            });
        }

        this.crystalFormations.sort((a, b) => a.layer - b.layer);
    }

    createLuminousVines() {
        const vineCount = 12;

        for (let i = 0; i < vineCount; i++) {
            const segments = [];
            const segmentCount = Math.floor(Math.random() * 8) + 6;
            const startX = Math.random() * this.canvas.width;

            let currentX = startX;
            let currentY = 0;

            for (let j = 0; j < segmentCount; j++) {
                const segmentLength = Math.random() * 40 + 30;
                const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.4; // Mostly downward

                segments.push({
                    x: currentX,
                    y: currentY,
                    length: segmentLength,
                    angle: angle,
                    thickness: Math.max(2, 8 - j * 0.5), // Taper off
                    glowSize: Math.random() * 10 + 8
                });

                currentX += Math.cos(angle) * segmentLength;
                currentY += Math.sin(angle) * segmentLength;
            }

            this.luminousVines.push({
                segments: segments,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulsePhase: Math.random() * Math.PI * 2,
                swayPhase: Math.random() * Math.PI * 2,
                swaySpeed: Math.random() * 0.015 + 0.008,
                hue: Math.random() * 40 + 160
            });
        }
    }

    createFireflies() {
        const fireflyCount = 80;
        for (let i = 0; i < fireflyCount; i++) {
            this.fireflies.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                size: Math.random() * 3 + 2,
                brightness: Math.random() * 0.8 + 0.2,
                pulseSpeed: Math.random() * 0.05 + 0.02,
                pulsePhase: Math.random() * Math.PI * 2,
                color: Math.random() > 0.7 ? 'cyan' : 'green', // Mix of colors
                trail: []
            });
        }
    }

    createSpores() {
        const sporeCount = 150;
        for (let i = 0; i < sporeCount; i++) {
            this.spores.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 1.5 - 0.5, // Float upward
                size: Math.random() * 2 + 1,
                opacity: Math.random() * 0.6 + 0.2,
                driftPhase: Math.random() * Math.PI * 2,
                driftSpeed: Math.random() * 0.02 + 0.01
            });
        }
    }

    createAmbientGlows() {
        const glowCount = 40;
        for (let i = 0; i < glowCount; i++) {
            this.ambientGlows.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height * 0.8,
                size: Math.random() * 60 + 30,
                opacity: Math.random() * 0.12 + 0.04,
                pulseSpeed: Math.random() * 0.012 + 0.006,
                pulsePhase: Math.random() * Math.PI * 2,
                driftSpeed: Math.random() * 0.0003 + 0.0001,
                driftPhase: Math.random() * Math.PI * 2,
                hue: Math.random() * 50 + 155 // Cyan-green range
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

        // Pulse intensity based on combo
        this.pulseIntensity = Math.min(0.5 + comboCount * 0.15, 1.5);

        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // Energy waves from center
        if (this.energyWaves.length < this.MAX_ENERGY_WAVES) {
            const waveCount = Math.min(lineCount + Math.floor(comboCount / 2), this.MAX_ENERGY_WAVES - this.energyWaves.length);
            for (let i = 0; i < waveCount; i++) {
                this.energyWaves.push({
                    x: centerX,
                    y: centerY,
                    radius: 0,
                    maxRadius: 400 + comboCount * 60,
                    opacity: 0.9,
                    life: 1.0,
                    speed: 5 + comboCount * 0.5,
                    delay: i * 0.12,
                    started: false
                });
            }
        }

        // Light burst particles
        if (this.lightBursts.length < this.MAX_PARTICLES) {
            const burstCount = Math.min(lineCount * 20 + comboCount * 15, this.MAX_PARTICLES - this.lightBursts.length);
            for (let i = 0; i < burstCount; i++) {
                this.lightBursts.push(this.createLightBurstParticle(centerX, centerY, lineCount));
            }
        }

        // Combo orbs for medium combos
        if (comboCount >= 3 && this.comboOrbs.length < this.MAX_COMBO_ORBS) {
            const orbCount = Math.min(comboCount * 2, this.MAX_COMBO_ORBS - this.comboOrbs.length);
            for (let i = 0; i < orbCount; i++) {
                this.comboOrbs.push(this.createComboOrb());
            }
        }

        // Aurora effects for high combos
        if (comboCount >= 6 && this.auroraEffects.length < this.MAX_AURORAS) {
            const auroraCount = Math.min(Math.floor(comboCount / 4), this.MAX_AURORAS - this.auroraEffects.length);
            for (let i = 0; i < auroraCount; i++) {
                this.auroraEffects.push(this.createAurora());
            }
        }

        // Make all plants glow more intensely
        this.glowingPlants.forEach(plant => {
            plant.glowIntensity = Math.min(plant.glowIntensity + 0.4 + comboCount * 0.1, 2.5);
        });

        // Make crystals shine brighter
        this.crystalFormations.forEach(formation => {
            formation.crystals.forEach(crystal => {
                crystal.glowIntensity = Math.min(crystal.glowIntensity + 0.3, 2.0);
            });
        });

        // Spawn bioluminescent reaction particles around plants
        if (comboCount >= 2) {
            this.createBioReactionParticles(lineCount, comboCount);
        }
    }

    createLightBurstParticle(x, y, lineCount) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10 + 5 + lineCount * 2;

        return {
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 6 + 3,
            opacity: Math.random() * 0.9 + 0.5,
            life: 1.0,
            color: Math.random() > 0.5 ? 'cyan' : 'green',
            pulsePhase: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2
        };
    }

    createComboOrb() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height + 50,
            vx: (Math.random() - 0.5) * 3,
            vy: -(Math.random() * 4 + 3),
            size: Math.random() * 12 + 6,
            opacity: Math.random() * 0.8 + 0.4,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            spiralPhase: Math.random() * Math.PI * 2,
            spiralSpeed: Math.random() * 0.1 + 0.05
        };
    }

    createAurora() {
        const waveCount = Math.floor(Math.random() * 3) + 3;
        const waves = [];

        for (let i = 0; i < waveCount; i++) {
            waves.push({
                amplitude: Math.random() * 100 + 50,
                frequency: Math.random() * 0.01 + 0.005,
                phase: Math.random() * Math.PI * 2,
                speed: Math.random() * 0.02 + 0.01,
                yOffset: Math.random() * 200
            });
        }

        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height * 0.5,
            waves: waves,
            opacity: 0.7,
            life: 1.0,
            width: Math.random() * 400 + 300,
            driftSpeed: (Math.random() - 0.5) * 0.5
        };
    }

    createBioReactionParticles(lineCount, comboCount) {
        // Create glowing particles that emit from random plants
        const plantCount = Math.min(this.glowingPlants.length, 5 + comboCount);

        for (let i = 0; i < plantCount; i++) {
            const plant = this.glowingPlants[Math.floor(Math.random() * this.glowingPlants.length)];
            const particleCount = Math.floor(Math.random() * 8) + 5;

            for (let j = 0; j < particleCount; j++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 3 + 2;

                if (this.lightBursts.length < this.MAX_PARTICLES) {
                    this.lightBursts.push({
                        x: plant.x,
                        y: plant.y - plant.height * 0.5,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed - 1, // Slight upward bias
                        size: Math.random() * 4 + 2,
                        opacity: Math.random() * 0.8 + 0.4,
                        life: 1.0,
                        color: Math.random() > 0.5 ? 'cyan' : 'green',
                        pulsePhase: Math.random() * Math.PI * 2,
                        rotationSpeed: (Math.random() - 0.5) * 0.2,
                        hue: plant.hue // Use plant's color
                    });
                }
            }
        }
    }

    drawBackground() {
        if (!this.ctx || !this.canvas) return;

        // Deep forest background with bioluminescent glow
        if (this.cachedGradients.background) {
            this.ctx.fillStyle = this.cachedGradients.background;
        } else {
            // Fallback solid color if gradient failed
            this.ctx.fillStyle = '#0a1f1f';
        }
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Add ambient bioluminescent atmosphere
        const centerX = this.canvas.width * 0.5;
        const centerY = this.canvas.height * 0.6;
        const atmosphereGradient = this.ctx.createRadialGradient(
            centerX, centerY,
            this.canvas.height * 0.2,
            centerX, centerY,
            this.canvas.height * 0.9
        );
        atmosphereGradient.addColorStop(0, 'rgba(20, 255, 200, 0.08)');
        atmosphereGradient.addColorStop(0.4, 'rgba(10, 200, 150, 0.04)');
        atmosphereGradient.addColorStop(0.7, 'rgba(5, 150, 100, 0.02)');
        atmosphereGradient.addColorStop(1, 'rgba(0, 100, 80, 0)');

        this.ctx.fillStyle = atmosphereGradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawMyceliumNetwork() {
        for (const connection of this.myceliumNetwork) {
            connection.pulsePhase += connection.pulseSpeed;
            const pulse = Math.sin(connection.pulsePhase) * 0.4 + 0.6;

            this.ctx.strokeStyle = `rgba(50, 255, 180, ${0.08 * pulse})`;
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(connection.from.x, connection.from.y);
            this.ctx.lineTo(connection.to.x, connection.to.y);
            this.ctx.stroke();

            // Add glowing nodes along the connection
            const segments = 5;
            for (let i = 1; i < segments; i++) {
                const t = i / segments;
                const x = connection.from.x + (connection.to.x - connection.from.x) * t;
                const y = connection.from.y + (connection.to.y - connection.from.y) * t;

                const nodeGradient = this.ctx.createRadialGradient(x, y, 0, x, y, 8);
                nodeGradient.addColorStop(0, `rgba(100, 255, 200, ${0.4 * pulse})`);
                nodeGradient.addColorStop(0.5, `rgba(50, 255, 180, ${0.2 * pulse})`);
                nodeGradient.addColorStop(1, 'rgba(20, 200, 150, 0)');

                this.ctx.fillStyle = nodeGradient;
                this.ctx.beginPath();
                this.ctx.arc(x, y, 8, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    drawGlowOrbs() {
        for (const orb of this.glowOrbs) {
            orb.pulsePhase += orb.pulseSpeed;
            orb.driftPhase += orb.driftSpeed;

            const pulse = Math.sin(orb.pulsePhase) * 0.3 + 0.7;
            const drift = Math.sin(orb.driftPhase) * 50;

            const x = orb.x + drift;
            const y = orb.y + Math.cos(orb.driftPhase * 1.5) * 30;

            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, orb.size);
            gradient.addColorStop(0, `rgba(100, 255, 200, ${orb.opacity * pulse})`);
            gradient.addColorStop(0.4, `rgba(50, 220, 180, ${orb.opacity * pulse * 0.6})`);
            gradient.addColorStop(0.7, `rgba(20, 180, 150, ${orb.opacity * pulse * 0.3})`);
            gradient.addColorStop(1, 'rgba(0, 150, 120, 0)');

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(x, y, orb.size, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawSpores() {
        for (const spore of this.spores) {
            spore.x += spore.vx;
            spore.y += spore.vy;
            spore.driftPhase += spore.driftSpeed;

            // Add drift
            spore.x += Math.sin(spore.driftPhase) * 0.5;

            // Wrap around
            if (spore.x < 0) spore.x = this.canvas.width;
            if (spore.x > this.canvas.width) spore.x = 0;
            if (spore.y < -10) spore.y = this.canvas.height + 10;

            // Draw spore with glow
            const gradient = this.ctx.createRadialGradient(spore.x, spore.y, 0, spore.x, spore.y, spore.size * 3);
            gradient.addColorStop(0, `rgba(150, 255, 220, ${spore.opacity})`);
            gradient.addColorStop(0.5, `rgba(100, 220, 180, ${spore.opacity * 0.5})`);
            gradient.addColorStop(1, 'rgba(50, 180, 150, 0)');

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(spore.x, spore.y, spore.size * 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawFireflies() {
        for (const firefly of this.fireflies) {
            // Random wandering movement
            firefly.vx += (Math.random() - 0.5) * 0.2;
            firefly.vy += (Math.random() - 0.5) * 0.2;

            // Limit speed
            const speed = Math.sqrt(firefly.vx * firefly.vx + firefly.vy * firefly.vy);
            if (speed > 2) {
                firefly.vx = (firefly.vx / speed) * 2;
                firefly.vy = (firefly.vy / speed) * 2;
            }

            firefly.x += firefly.vx;
            firefly.y += firefly.vy;
            firefly.pulsePhase += firefly.pulseSpeed;

            // Wrap around
            if (firefly.x < 0) firefly.x = this.canvas.width;
            if (firefly.x > this.canvas.width) firefly.x = 0;
            if (firefly.y < 0) firefly.y = this.canvas.height;
            if (firefly.y > this.canvas.height) firefly.y = 0;

            const pulse = Math.sin(firefly.pulsePhase) * 0.4 + 0.6;
            const alpha = firefly.brightness * pulse;

            // Draw trail
            firefly.trail.push({ x: firefly.x, y: firefly.y });
            if (firefly.trail.length > 8) firefly.trail.shift();

            for (let i = 0; i < firefly.trail.length; i++) {
                const trailPoint = firefly.trail[i];
                const trailAlpha = (i / firefly.trail.length) * alpha * 0.3;
                const trailSize = (i / firefly.trail.length) * firefly.size;

                const trailGradient = this.ctx.createRadialGradient(
                    trailPoint.x, trailPoint.y, 0,
                    trailPoint.x, trailPoint.y, trailSize * 2
                );

                if (firefly.color === 'cyan') {
                    trailGradient.addColorStop(0, `rgba(100, 255, 255, ${trailAlpha})`);
                    trailGradient.addColorStop(1, 'rgba(50, 200, 200, 0)');
                } else {
                    trailGradient.addColorStop(0, `rgba(150, 255, 100, ${trailAlpha})`);
                    trailGradient.addColorStop(1, 'rgba(100, 200, 50, 0)');
                }

                this.ctx.fillStyle = trailGradient;
                this.ctx.beginPath();
                this.ctx.arc(trailPoint.x, trailPoint.y, trailSize * 2, 0, Math.PI * 2);
                this.ctx.fill();
            }

            // Draw main firefly glow
            const gradient = this.ctx.createRadialGradient(
                firefly.x, firefly.y, 0,
                firefly.x, firefly.y, firefly.size * 3
            );

            if (firefly.color === 'cyan') {
                gradient.addColorStop(0, `rgba(200, 255, 255, ${alpha})`);
                gradient.addColorStop(0.3, `rgba(100, 255, 255, ${alpha * 0.7})`);
                gradient.addColorStop(0.6, `rgba(50, 200, 200, ${alpha * 0.3})`);
                gradient.addColorStop(1, 'rgba(20, 150, 150, 0)');
            } else {
                gradient.addColorStop(0, `rgba(220, 255, 150, ${alpha})`);
                gradient.addColorStop(0.3, `rgba(150, 255, 100, ${alpha * 0.7})`);
                gradient.addColorStop(0.6, `rgba(100, 200, 50, ${alpha * 0.3})`);
                gradient.addColorStop(1, 'rgba(50, 150, 20, 0)');
            }

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(firefly.x, firefly.y, firefly.size * 3, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    drawMushrooms() {
        for (const mushroom of this.mushrooms) {
            mushroom.pulsePhase += mushroom.pulseSpeed;
            mushroom.floatPhase += mushroom.floatSpeed;

            const pulse = Math.sin(mushroom.pulsePhase) * 0.3 + 0.7;
            const floatOffset = Math.sin(mushroom.floatPhase) * mushroom.floatAmplitude;

            const x = mushroom.x;
            const y = mushroom.y + floatOffset;

            // Gradually decay intense glow back to normal
            if (mushroom.glowIntensity > 1) {
                mushroom.glowIntensity *= 0.98;
            }

            const glowMult = mushroom.glowIntensity * pulse * (1 + this.pulseIntensity * 0.3);

            // Draw stem with gradient
            const stemGradient = this.ctx.createLinearGradient(
                x, y,
                x, y - mushroom.stemHeight
            );
            stemGradient.addColorStop(0, `hsl(${180 + mushroom.hueShift}, 60%, 30%)`);
            stemGradient.addColorStop(1, `hsl(${180 + mushroom.hueShift}, 70%, 40%)`);

            this.ctx.fillStyle = stemGradient;
            this.ctx.beginPath();
            this.ctx.ellipse(
                x, y - mushroom.stemHeight / 2,
                mushroom.stemWidth, mushroom.stemHeight / 2,
                0, 0, Math.PI * 2
            );
            this.ctx.fill();

            // Stem glow
            const stemGlow = this.ctx.createRadialGradient(x, y - mushroom.stemHeight / 2, 0, x, y - mushroom.stemHeight / 2, mushroom.stemWidth * 2);
            stemGlow.addColorStop(0, `rgba(100, 255, 200, ${0.2 * glowMult})`);
            stemGlow.addColorStop(1, 'rgba(50, 200, 150, 0)');
            this.ctx.fillStyle = stemGlow;
            this.ctx.fillRect(x - mushroom.stemWidth * 2, y - mushroom.stemHeight, mushroom.stemWidth * 4, mushroom.stemHeight);

            // Draw mushroom cap
            const capY = y - mushroom.stemHeight;

            // Outer glow layers (multiple for intense effect)
            for (let i = 4; i >= 1; i--) {
                const glowRadius = mushroom.capRadius * (1 + i * 0.15);
                const glowOpacity = (0.15 / i) * glowMult;

                const outerGlow = this.ctx.createRadialGradient(x, capY, mushroom.capRadius * 0.5, x, capY, glowRadius);
                outerGlow.addColorStop(0, `rgba(100, 255, 220, ${glowOpacity * 0.8})`);
                outerGlow.addColorStop(0.5, `rgba(50, 220, 180, ${glowOpacity * 0.5})`);
                outerGlow.addColorStop(1, 'rgba(20, 180, 150, 0)');

                this.ctx.fillStyle = outerGlow;
                this.ctx.beginPath();
                this.ctx.arc(x, capY, glowRadius, 0, Math.PI * 2);
                this.ctx.fill();
            }

            // Main cap body
            const capGradient = this.ctx.createRadialGradient(
                x - mushroom.capRadius * 0.2, capY - mushroom.capRadius * 0.2, mushroom.capRadius * 0.2,
                x, capY, mushroom.capRadius
            );
            capGradient.addColorStop(0, `hsl(${180 + mushroom.hueShift}, 100%, ${60 + glowMult * 10}%)`);
            capGradient.addColorStop(0.5, `hsl(${180 + mushroom.hueShift}, 90%, ${45 + glowMult * 8}%)`);
            capGradient.addColorStop(1, `hsl(${180 + mushroom.hueShift}, 80%, ${30 + glowMult * 5}%)`);

            this.ctx.fillStyle = capGradient;
            this.ctx.beginPath();
            this.ctx.arc(x, capY, mushroom.capRadius, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw glowing spots
            for (const spot of mushroom.spots) {
                const spotX = x + Math.cos(spot.angle) * spot.distance * mushroom.capRadius;
                const spotY = capY - Math.sin(spot.angle) * spot.distance * mushroom.capRadius * 0.5;

                const spotGlow = this.ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spot.size);
                spotGlow.addColorStop(0, `rgba(200, 255, 240, ${0.9 * spot.intensity * glowMult})`);
                spotGlow.addColorStop(0.5, `rgba(150, 255, 220, ${0.6 * spot.intensity * glowMult})`);
                spotGlow.addColorStop(1, 'rgba(100, 220, 180, 0)');

                this.ctx.fillStyle = spotGlow;
                this.ctx.beginPath();
                this.ctx.arc(spotX, spotY, spot.size, 0, Math.PI * 2);
                this.ctx.fill();
            }

            // Add rim highlight for 3D effect
            const rimGradient = this.ctx.createRadialGradient(
                x - mushroom.capRadius * 0.3, capY - mushroom.capRadius * 0.3, 0,
                x, capY, mushroom.capRadius
            );
            rimGradient.addColorStop(0, `rgba(255, 255, 255, ${0.3 * glowMult})`);
            rimGradient.addColorStop(0.4, `rgba(200, 255, 240, ${0.15 * glowMult})`);
            rimGradient.addColorStop(1, 'rgba(150, 255, 220, 0)');

            this.ctx.fillStyle = rimGradient;
            this.ctx.beginPath();
            this.ctx.arc(x, capY, mushroom.capRadius, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    animate() {
        if (!this.isActive) {
            console.log('🍄 Animation stopped: theme not active');
            return;
        }

        if (this.time === 0) {
            console.log('🍄 First frame of animation');
        }

        this.time += 1;

        // Decay pulse intensity
        if (this.pulseIntensity > 0) {
            this.pulseIntensity *= 0.95;
        }

        // Clear and draw (back to front layering)
        this.drawBackground();
        this.drawAmbientGlows();
        this.drawLuminousVines();
        this.drawCrystalFormations();
        this.drawGlowingPlants();
        this.drawSpores();

        // Draw energy waves
        for (let i = this.energyWaves.length - 1; i >= 0; i--) {
            const wave = this.energyWaves[i];

            wave.delay -= 0.016;
            if (wave.delay <= 0 && !wave.started) {
                wave.started = true;
            }

            if (!wave.started) continue;

            wave.radius += wave.speed;
            wave.life -= 0.01;
            wave.opacity = wave.life * 0.7;

            if (wave.life <= 0 || wave.radius > wave.maxRadius) {
                this.energyWaves.splice(i, 1);
                continue;
            }

            // Draw multiple ring layers
            for (let j = 0; j < 3; j++) {
                const offsetRadius = wave.radius - j * 15;
                if (offsetRadius <= 0) continue;

                this.ctx.beginPath();
                this.ctx.arc(wave.x, wave.y, offsetRadius, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(100, 255, 220, ${wave.opacity * (1 - j * 0.3)})`;
                this.ctx.lineWidth = 4 + j;
                this.ctx.stroke();
            }
        }

        // Draw light burst particles
        for (let i = this.lightBursts.length - 1; i >= 0; i--) {
            const p = this.lightBursts[i];

            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.98;
            p.vy *= 0.98;
            p.life -= 0.012;
            p.opacity = p.life * 0.9;
            p.pulsePhase += 0.15;

            if (p.life <= 0 || p.y > this.canvas.height || p.x < 0 || p.x > this.canvas.width) {
                this.lightBursts.splice(i, 1);
                continue;
            }

            const pulse = Math.sin(p.pulsePhase) * 0.3 + 0.7;

            const gradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);

            if (p.color === 'cyan') {
                gradient.addColorStop(0, `rgba(200, 255, 255, ${p.opacity * pulse})`);
                gradient.addColorStop(0.5, `rgba(100, 255, 255, ${p.opacity * pulse * 0.6})`);
                gradient.addColorStop(1, 'rgba(50, 200, 200, 0)');
            } else {
                gradient.addColorStop(0, `rgba(220, 255, 150, ${p.opacity * pulse})`);
                gradient.addColorStop(0.5, `rgba(150, 255, 100, ${p.opacity * pulse * 0.6})`);
                gradient.addColorStop(1, 'rgba(100, 200, 50, 0)');
            }

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw combo orbs
        for (let i = this.comboOrbs.length - 1; i >= 0; i--) {
            const orb = this.comboOrbs[i];

            orb.spiralPhase += orb.spiralSpeed;
            orb.x += orb.vx + Math.cos(orb.spiralPhase) * 2;
            orb.y += orb.vy;
            orb.vx *= 0.99;
            orb.vy *= 0.98;
            orb.life -= 0.008;
            orb.opacity = orb.life * 0.8;
            orb.pulsePhase += 0.12;

            if (orb.life <= 0 || orb.y < -50) {
                this.comboOrbs.splice(i, 1);
                continue;
            }

            const pulse = Math.sin(orb.pulsePhase) * 0.4 + 0.6;

            // Outer glow
            const outerGrad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size * 2.5);
            outerGrad.addColorStop(0, `rgba(150, 255, 220, ${orb.opacity * pulse * 0.5})`);
            outerGrad.addColorStop(0.5, `rgba(100, 220, 180, ${orb.opacity * pulse * 0.3})`);
            outerGrad.addColorStop(1, 'rgba(50, 180, 150, 0)');

            this.ctx.fillStyle = outerGrad;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size * 2.5, 0, Math.PI * 2);
            this.ctx.fill();

            // Core
            const coreGrad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.size);
            coreGrad.addColorStop(0, `rgba(255, 255, 255, ${orb.opacity * pulse})`);
            coreGrad.addColorStop(0.4, `rgba(200, 255, 240, ${orb.opacity * pulse * 0.8})`);
            coreGrad.addColorStop(1, `rgba(150, 255, 220, ${orb.opacity * pulse * 0.3})`);

            this.ctx.fillStyle = coreGrad;
            this.ctx.beginPath();
            this.ctx.arc(orb.x, orb.y, orb.size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Draw aurora effects
        for (let i = this.auroraEffects.length - 1; i >= 0; i--) {
            const aurora = this.auroraEffects[i];

            aurora.x += aurora.driftSpeed;
            aurora.life -= 0.005;
            aurora.opacity = aurora.life * 0.6;

            if (aurora.life <= 0) {
                this.auroraEffects.splice(i, 1);
                continue;
            }

            // Draw each wave layer
            for (let j = 0; j < aurora.waves.length; j++) {
                const wave = aurora.waves[j];
                wave.phase += wave.speed;

                this.ctx.beginPath();
                this.ctx.moveTo(aurora.x, aurora.y + wave.yOffset);

                for (let x = 0; x <= aurora.width; x += 10) {
                    const waveX = aurora.x + x;
                    const waveY = aurora.y + wave.yOffset + Math.sin(x * wave.frequency + wave.phase) * wave.amplitude;
                    this.ctx.lineTo(waveX, waveY);
                }

                const gradient = this.ctx.createLinearGradient(aurora.x, aurora.y, aurora.x + aurora.width, aurora.y);
                gradient.addColorStop(0, 'rgba(100, 255, 220, 0)');
                gradient.addColorStop(0.2, `rgba(150, 255, 230, ${aurora.opacity * 0.5})`);
                gradient.addColorStop(0.5, `rgba(100, 255, 220, ${aurora.opacity})`);
                gradient.addColorStop(0.8, `rgba(150, 255, 230, ${aurora.opacity * 0.5})`);
                gradient.addColorStop(1, 'rgba(100, 255, 220, 0)');

                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }
        }

        this.drawFireflies();

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
        this.energyWaves = [];
        this.lightBursts = [];
        this.comboOrbs = [];
        this.auroraEffects = [];
        this.pulseIntensity = 0;
        this.comboMultiplier = 1.0;
        this.pendingComboCount = 0;

        super.stop();
    }
}

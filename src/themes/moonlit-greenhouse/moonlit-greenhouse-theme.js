/**
 * @fileoverview Moonlit Greenhouse Theme - Tranquil greenhouse with plant silhouettes, dewdrops, and moths
 */

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { MOONLIT_GREENHOUSE_TETROMINOS } from './moonlit-greenhouse-tetrominos.js';

/**
 * Moonlit Greenhouse Theme
 * Features:
 * - Plant silhouettes in parallax layers
 * - Glistening dewdrops
 * - Flying moths
 * - Combo effects: pollen bursts, fireflies, vine waves, blooming flowers
 */
export default class MoonlitGreenhouseTheme extends BaseTheme {
    constructor() {
        super('moonlit-greenhouse');

        // Canvas for combo effects
        this.canvas = null;
        this.ctx = null;
        this.resizeHandler = null;
        this.animationFrameId = null;
        this.time = 0;

        // Combo effect arrays
        this.pollenParticles = [];
        this.fireflies = [];
        this.vineWaves = [];
        this.leafSpirals = [];
        this.mossGlows = [];
        this.bloomingFlowers = [];
        this.mistWaves = [];
        this.bioluminescentRipples = [];

        // State
        this.comboIntensity = 0;
        this.ambientGlow = 0;
        this.plantSway = 0;

        // Performance limits
        this.MAX_POLLEN = 200;
        this.MAX_FIREFLIES = 30;
        this.MAX_VINE_WAVES = 0; // Disabled - vine waves removed
        this.MAX_LEAF_SPIRALS = 40;
        this.MAX_MOSS_GLOWS = 8;
        this.MAX_FLOWERS = 20; // Increased to match Extreme preset
        this.MAX_MIST_WAVES = 6;
        this.MAX_RIPPLES = 10;

        // Graphics quality presets (FPS-optimized, balanced scaling)
        this.qualityPresets = {
            Minimal: {
                // Scene elements
                plantsMid: 6,
                plantsFront: 4,
                dewdrops: 15,
                moths: 2,
                grassCount: 20,
                // Combo effects
                maxPollen: 30,
                maxFireflies: 5,
                maxVineWaves: 0, // Disabled - green lines removed
                maxLeafSpirals: 8,
                maxMossGlows: 2,
                maxFlowers: 4, // Increased from 2
                maxMistWaves: 1,
                maxRipples: 2,
                pollenBurstMultiplier: 0.2,
                fireflySpawnRate: 0.02,
                particleTrails: false,
                glowLayers: 1,
                flowerPetals: 5,
                leafDetail: 0.4,
                mistOpacity: 0.15,
                enableAmbientGlow: false,
            },
            Low: {
                // Scene elements
                plantsMid: 10,
                plantsFront: 7,
                dewdrops: 30,
                moths: 4,
                grassCount: 35,
                // Combo effects
                maxPollen: 50,
                maxFireflies: 8,
                maxVineWaves: 0, // Disabled - green lines removed
                maxLeafSpirals: 12,
                maxMossGlows: 2,
                maxFlowers: 6, // Increased from 3
                maxMistWaves: 2,
                maxRipples: 3,
                pollenBurstMultiplier: 0.3,
                fireflySpawnRate: 0.04,
                particleTrails: false,
                glowLayers: 1,
                flowerPetals: 5,
                leafDetail: 0.5,
                mistOpacity: 0.2,
                enableAmbientGlow: false,
            },
            Medium: {
                // Scene elements
                plantsMid: 14,
                plantsFront: 10,
                dewdrops: 50,
                moths: 6,
                grassCount: 55,
                // Combo effects
                maxPollen: 70,
                maxFireflies: 12,
                maxVineWaves: 0, // Disabled - green lines removed
                maxLeafSpirals: 16,
                maxMossGlows: 3,
                maxFlowers: 8, // Increased from 4
                maxMistWaves: 2,
                maxRipples: 4,
                pollenBurstMultiplier: 0.4,
                fireflySpawnRate: 0.06,
                particleTrails: false,
                glowLayers: 2,
                flowerPetals: 6,
                leafDetail: 0.65,
                mistOpacity: 0.22,
                enableAmbientGlow: true,
            },
            High: {
                // Scene elements
                plantsMid: 18,
                plantsFront: 14,
                dewdrops: 70,
                moths: 8,
                grassCount: 80,
                // Combo effects
                maxPollen: 90,
                maxFireflies: 15,
                maxVineWaves: 0, // Disabled - green lines removed
                maxLeafSpirals: 22,
                maxMossGlows: 4,
                maxFlowers: 12, // Increased from 6
                maxMistWaves: 3,
                maxRipples: 5,
                pollenBurstMultiplier: 0.5,
                fireflySpawnRate: 0.08,
                particleTrails: true,
                glowLayers: 2,
                flowerPetals: 6,
                leafDetail: 0.8,
                mistOpacity: 0.25,
                enableAmbientGlow: true,
            },
            Ultra: {
                // Scene elements
                plantsMid: 24,
                plantsFront: 18,
                dewdrops: 100,
                moths: 12,
                grassCount: 110,
                // Combo effects
                maxPollen: 110,
                maxFireflies: 18,
                maxVineWaves: 0, // Disabled - green lines removed
                maxLeafSpirals: 28,
                maxMossGlows: 5,
                maxFlowers: 16, // Increased from 7
                maxMistWaves: 4,
                maxRipples: 6,
                pollenBurstMultiplier: 0.6,
                fireflySpawnRate: 0.1,
                particleTrails: true,
                glowLayers: 3,
                flowerPetals: 6,
                leafDetail: 0.9,
                mistOpacity: 0.28,
                enableAmbientGlow: true,
            },
            Extreme: {
                // Scene elements
                plantsMid: 32,
                plantsFront: 24,
                dewdrops: 140,
                moths: 16,
                grassCount: 150,
                // Combo effects
                maxPollen: 130,
                maxFireflies: 20,
                maxVineWaves: 0, // Disabled - green lines removed
                maxLeafSpirals: 32,
                maxMossGlows: 6,
                maxFlowers: 20, // Increased from 8
                maxMistWaves: 4,
                maxRipples: 7,
                pollenBurstMultiplier: 0.7,
                fireflySpawnRate: 0.12,
                particleTrails: true,
                glowLayers: 3,
                flowerPetals: 7,
                leafDetail: 1.0,
                mistOpacity: 0.3,
                enableAmbientGlow: true,
            },
        };

        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;

        // Event handling
        this.eventUnsubscribers = [];
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    /**
     * Apply graphics quality preset
     * @param {string} quality - Quality level: 'Minimal', 'Low', 'Medium', 'High', 'Ultra', or 'Extreme'
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[Moonlit Greenhouse] Unknown quality preset: ${quality}, using High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // Update max limits based on preset
        this.MAX_POLLEN = this.activePreset.maxPollen;
        this.MAX_FIREFLIES = this.activePreset.maxFireflies;
        this.MAX_VINE_WAVES = this.activePreset.maxVineWaves;
        this.MAX_LEAF_SPIRALS = this.activePreset.maxLeafSpirals;
        this.MAX_MOSS_GLOWS = this.activePreset.maxMossGlows;
        this.MAX_FLOWERS = this.activePreset.maxFlowers;
        this.MAX_MIST_WAVES = this.activePreset.maxMistWaves;
        this.MAX_RIPPLES = this.activePreset.maxRipples;

        console.log(`🌿 [Moonlit Greenhouse] Applying ${quality} quality preset`, this.activePreset);
    }

    /**
     * Get current graphics quality from settings
     * @returns {string} Quality level
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    /**
     * Setup listener for graphics quality changes
     */
    setupQualityListener() {
        if (typeof window === 'undefined') return;

        this.qualityChangeHandler = (event) => {
            if (event.detail && event.detail.effectQuality) {
                const newQuality = event.detail.effectQuality;
                console.log(`🌿 [Moonlit Greenhouse] Quality changed to ${newQuality}`);

                // Apply new quality preset
                this.applyQualityPreset(newQuality);

                // Trim arrays to new limits
                this.pollenParticles = this.pollenParticles.slice(0, this.MAX_POLLEN);
                this.fireflies = this.fireflies.slice(0, this.MAX_FIREFLIES);
                this.vineWaves = this.vineWaves.slice(0, this.MAX_VINE_WAVES);
                this.leafSpirals = this.leafSpirals.slice(0, this.MAX_LEAF_SPIRALS);
                this.mossGlows = this.mossGlows.slice(0, this.MAX_MOSS_GLOWS);
                this.bloomingFlowers = this.bloomingFlowers.slice(0, this.MAX_FLOWERS);
                this.mistWaves = this.mistWaves.slice(0, this.MAX_MIST_WAVES);
                this.bioluminescentRipples = this.bioluminescentRipples.slice(0, this.MAX_RIPPLES);
            }
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    async createScene() {
        // Get current quality settings
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        console.log(`🌿 [Moonlit Greenhouse] Creating scene with ${quality} quality preset`);

        // 1. Create single solid ground layer at bottom
        const groundContainer = document.getElementById('greenhouse-plants-back');
        if (groundContainer) {
            this.registerContainer(groundContainer);

            // Generate solid ground canvas
            const C_WIDTH = 2048;
            const C_HEIGHT = window.innerHeight;
            const canvas = document.createElement('canvas');
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');

            // Draw solid earth ground at bottom with gentle hills
            ctx.fillStyle = '#0D1814'; // Dark earth color
            ctx.beginPath();
            ctx.moveTo(0, C_HEIGHT);
            let groundY = C_HEIGHT * 0.88; // Ground starts at 88% height
            const step = 4;
            for (let x = 0; x < C_WIDTH; x += step) {
                groundY += (Math.random() - 0.5) * 4; // Gentle terrain variation
                ctx.lineTo(x, groundY);
            }
            ctx.lineTo(C_WIDTH, C_HEIGHT);
            ctx.closePath();
            ctx.fill();

            // Add grass texture on top of ground (quality-scaled)
            const { grassCount } = this.activePreset;
            for (let i = 0; i < grassCount; i++) {
                const grassX = Math.random() * C_WIDTH;
                const grassY = C_HEIGHT * (0.88 + Math.random() * 0.02);
                const grassHeight = 12 + Math.random() * 18;

                ctx.strokeStyle = 'rgba(20, 40, 30, 0.7)';
                ctx.lineWidth = 1 + Math.random() * 1.5;
                ctx.globalAlpha = 0.5 + Math.random() * 0.3;

                // Draw grass blade
                ctx.beginPath();
                ctx.moveTo(grassX, grassY);
                ctx.quadraticCurveTo(
                    grassX + (Math.random() - 0.5) * 6,
                    grassY - grassHeight / 2,
                    grassX + (Math.random() - 0.5) * 10,
                    grassY - grassHeight,
                );
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // Apply ground to container with proper tiling
            groundContainer.style.backgroundImage = `url(${canvas.toDataURL()})`;
            groundContainer.style.backgroundSize = `${C_WIDTH}px ${C_HEIGHT}px`;
            groundContainer.style.backgroundRepeat = 'repeat-x';
            groundContainer.style.backgroundPosition = 'bottom';
        }

        // 2. Plant Silhouettes in separate layers (quality-scaled)
        const plantLayers = [
            {
                el: document.getElementById('greenhouse-plants-mid'),
                count: this.activePreset.plantsMid,
                color: 'rgba(10, 30, 25, 0.7)',
            },
            {
                el: document.getElementById('greenhouse-plants-front'),
                count: this.activePreset.plantsFront,
                color: 'rgba(15, 40, 35, 0.8)',
            },
        ];

        const plantSVGs = [
            // Large fern with detailed fronds
            'M 50 100 L 50 10 M 50 20 Q 30 15, 20 25 M 50 30 Q 70 25, 80 35 M 50 40 Q 25 35, 15 50 M 50 50 Q 75 45, 85 60 M 50 60 Q 30 55, 20 70 M 50 70 Q 70 65, 80 80 M 50 80 Q 35 78, 25 90',
            // Monstera-like leaf with holes
            'M 50 100 L 50 80 Q 30 70, 25 50 Q 25 30, 40 15 Q 50 10, 60 15 Q 75 30, 75 50 Q 70 70, 50 80 Z M 45 60 L 40 50 M 55 60 L 60 50 M 50 45 L 50 35',
            // Tall grass/reed cluster
            'M 45 100 Q 43 60, 40 20 Q 38 10, 35 5 M 50 100 Q 50 50, 50 10 Q 50 5, 48 0 M 55 100 Q 57 55, 60 25 Q 62 12, 65 8 M 48 100 Q 46 70, 43 40',
            // Broad leaf plant
            'M 50 100 L 50 40 Q 50 30, 40 25 Q 25 20, 20 30 Q 18 40, 25 50 Q 35 55, 50 52 M 50 52 Q 65 55, 75 50 Q 82 40, 80 30 Q 75 20, 60 25 Q 50 30, 50 40',
            // Bamboo-like stems
            'M 40 100 L 40 0 M 40 75 L 35 73 M 40 50 L 35 48 M 40 25 L 35 23 M 50 100 L 50 5 M 50 70 L 55 68 M 50 45 L 55 43 M 50 20 L 55 18 M 60 100 L 60 10',
        ];

        plantLayers.forEach((layer) => {
            if (layer.el) {
                this.registerContainer(layer.el);
                if (layer.el.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        const plant = document.createElement('div');
                        plant.className = 'greenhouse-plant';
                        const svg = plantSVGs[Math.floor(Math.random() * plantSVGs.length)];
                        plant.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${svg}" fill="${layer.color}" stroke="${layer.color}" stroke-width="1.5"/></svg>')`;

                        const size = Math.random() * 150 + 100;
                        plant.style.width = `${size}px`;
                        plant.style.height = `${size}px`;
                        plant.style.left = `${Math.random() * 100}%`;
                        // Position plants to stand on the ground (ground is at 88% = 12% from bottom)
                        // Add slight variation (10-14% from bottom) so plants sit naturally on/near the ground line
                        plant.style.bottom = `${Math.random() * 4 + 10}%`;
                        plant.style.transform = `rotate(${Math.random() * 15 - 7.5}deg)`;
                        plant.style.animationDelay = `-${Math.random() * 10}s`;
                        plant.style.transformOrigin = 'bottom center';
                        layer.el.appendChild(plant);
                    }
                }
            }
        });

        // 3. Dewdrops (quality-scaled)
        const dewdropContainer = this.getContainer('greenhouse-dewdrops');
        if (dewdropContainer && dewdropContainer.children.length === 0) {
            const dewdropCount = this.activePreset.dewdrops;
            for (let i = 0; i < dewdropCount; i++) {
                const dewdrop = document.createElement('div');
                dewdrop.className = 'dewdrop';
                dewdrop.style.left = `${Math.random() * 100}%`;
                dewdrop.style.top = `${Math.random() * 100}%`;
                dewdrop.style.animationDelay = `-${Math.random() * 8}s`;
                dewdropContainer.appendChild(dewdrop);
            }
        }

        // 4. Moths (quality-scaled)
        const mothContainer = this.getContainer('greenhouse-moths');
        if (mothContainer && mothContainer.children.length === 0) {
            const mothCount = this.activePreset.moths;
            for (let i = 0; i < mothCount; i++) {
                const moth = document.createElement('div');
                moth.className = 'greenhouse-moth';
                moth.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                moth.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                moth.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                moth.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                const duration = Math.random() * 15 + 10;
                moth.style.animationDuration = `${duration}s`;
                moth.style.animationDelay = `-${Math.random() * duration}s`;
                mothContainer.appendChild(moth);
            }
        }

        // 5. Setup canvas for combo effects
        // Create canvas if it doesn't exist
        this.canvas = document.getElementById('greenhouse-combo-canvas');
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'greenhouse-combo-canvas';
            // Append to body for fixed positioning above everything
            document.body.appendChild(this.canvas);
        }

        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
            this.resizeHandler = () => this.resizeCanvas();
            window.addEventListener('resize', this.resizeHandler, false);
            this.resizeCanvas();

            console.log(`🌿 [Moonlit Greenhouse] Canvas initialized: ${this.canvas.width}x${this.canvas.height}`);

            // Setup event listeners for combo effects
            this.setupEventListeners();
            this.setupQualityListener();

            // Start animation loop
            console.log('🌿 [Moonlit Greenhouse] Starting animation loop');
            this.animate();
        }
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => this.handleLineClear(data));
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => this.handleCombo(data));
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data) {
        const count = data.lineCount || 1;
        const combo = data.comboCount || 0;

        console.log(`🌿 [Greenhouse] Line clear: ${count} lines, combo: ${combo}`);

        this.comboIntensity += count * 0.15;
        this.ambientGlow = Math.min(this.ambientGlow + count * 0.1, 1.0);
        this.plantSway += count * 0.2;

        // Create random spawn points for natural distribution
        const numSpawnPoints = Math.min(count + 1, 4);
        const spawnPoints = [];
        for (let i = 0; i < numSpawnPoints; i++) {
            spawnPoints.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
            });
        }

        // 1. Pollen burst particles (depth: foreground) - reduced for FPS
        if (this.pollenParticles.length >= this.MAX_POLLEN) {
            this.pollenParticles.splice(0, Math.floor(this.MAX_POLLEN * 0.4));
        }
        const pollenCount = Math.floor(count * 8 * this.activePreset.pollenBurstMultiplier);
        spawnPoints.forEach((spawn) => {
            for (let i = 0; i < pollenCount; i++) {
                this.pollenParticles.push(this.createPollenParticle(spawn.x, spawn.y));
            }
        });

        // 2. Vine waves (depth: middleground) - DISABLED
        // if (count >= 2 && this.vineWaves.length < this.MAX_VINE_WAVES) {
        //     spawnPoints.forEach(spawn => {
        //         this.vineWaves.push(this.createVineWave(spawn.x, spawn.y, count));
        //     });
        // }

        // 3. Leaf spirals (depth: background)
        if (count >= 1 && this.leafSpirals.length < this.MAX_LEAF_SPIRALS) {
            const leafCount = Math.min(count * 3, this.MAX_LEAF_SPIRALS - this.leafSpirals.length);
            for (let i = 0; i < leafCount; i++) {
                const spawn = spawnPoints[i % spawnPoints.length];
                this.leafSpirals.push(this.createLeafSpiral(spawn.x, spawn.y));
            }
        }

        // 4. Bioluminescent ripples (depth: deep background)
        if (this.bioluminescentRipples.length < this.MAX_RIPPLES) {
            spawnPoints.forEach((spawn) => {
                this.bioluminescentRipples.push(this.createBioluminescentRipple(spawn.x, spawn.y, count));
            });
        }

        // 5. Moss glows for medium combos (depth: background)
        if (combo >= 3 && this.mossGlows.length < this.MAX_MOSS_GLOWS) {
            const glowCount = Math.min(Math.floor(combo / 2), this.MAX_MOSS_GLOWS - this.mossGlows.length);
            for (let i = 0; i < glowCount; i++) {
                this.mossGlows.push(this.createMossGlow());
            }
        }

        // 6. Blooming flowers for line clears (depth: middleground) - easier to trigger
        if (count >= 1 && this.bloomingFlowers.length < this.MAX_FLOWERS) {
            const flowerCount = Math.min(count * 2, this.MAX_FLOWERS - this.bloomingFlowers.length);
            for (let i = 0; i < flowerCount; i++) {
                const spawn = spawnPoints[i % spawnPoints.length];
                this.bloomingFlowers.push(this.createBloomingFlower(spawn.x, spawn.y));
            }
        }

        // 7. Mist waves (depth: very foreground)
        if (count >= 2 && this.mistWaves.length < this.MAX_MIST_WAVES) {
            this.mistWaves.push(this.createMistWave(count));
        }
    }

    handleCombo(data) {
        const combo = data.comboCount || 0;
        console.log(`🌿 [Greenhouse] Combo: ${combo}x`);

        this.comboIntensity += combo * 0.08;
        this.ambientGlow = Math.min(this.ambientGlow + combo * 0.05, 1.0);

        // Fireflies appear on combos (depth: foreground)
        if (combo >= 2 && this.fireflies.length < this.MAX_FIREFLIES) {
            const fireflyCount = Math.min(combo, this.MAX_FIREFLIES - this.fireflies.length);
            for (let i = 0; i < fireflyCount; i++) {
                this.fireflies.push(this.createFirefly());
            }
        }

        // Extra flowers for big combos
        if (combo >= 5 && this.bloomingFlowers.length < this.MAX_FLOWERS) {
            const x = Math.random() * this.canvas.width;
            const y = Math.random() * this.canvas.height;
            this.bloomingFlowers.push(this.createBloomingFlower(x, y));
        }
    }

    // Effect creation methods
    createPollenParticle(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 4;
        return {
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2, // Slight upward bias
            size: Math.random() * 3 + 1,
            alpha: Math.random() * 0.7 + 0.3,
            life: 1.0,
            color: Math.random() > 0.5 ? '#c8ff8c' : '#fff4a3', // Yellow-green or pale yellow
            glow: Math.random() * 0.5 + 0.5,
            trail: [],
        };
    }

    createFirefly() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height + 50,
            targetX: Math.random() * this.canvas.width,
            targetY: Math.random() * this.canvas.height * 0.7,
            vx: 0,
            vy: -2,
            size: Math.random() * 2 + 2,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            pulseSpeed: Math.random() * 0.05 + 0.03,
            glowIntensity: Math.random() * 0.5 + 0.5,
            wanderPhase: Math.random() * Math.PI * 2,
        };
    }

    createVineWave(x, y, lineCount) {
        return {
            x,
            y,
            radius: 0,
            maxRadius: 200 + lineCount * 40,
            alpha: 0.7,
            life: 1.0,
            tendrils: this.generateTendrils(8),
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.02,
        };
    }

    generateTendrils(count) {
        const tendrils = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + Math.random() * 0.3;
            tendrils.push({
                angle,
                length: Math.random() * 0.3 + 0.7,
                curve: Math.random() * 0.5 + 0.3,
            });
        }
        return tendrils;
    }

    createLeafSpiral(x, y) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2 + 1;
        return {
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            size: Math.random() * 8 + 6,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.15,
            life: 1.0,
            alpha: Math.random() * 0.5 + 0.3,
            spiralAngle: 0,
            spiralRadius: 30,
            color: Math.random() > 0.5 ? '#4a7c4e' : '#5d8f5f',
        };
    }

    createMossGlow() {
        return {
            x: Math.random() * this.canvas.width,
            y: this.canvas.height - Math.random() * 200,
            radius: Math.random() * 60 + 40,
            life: 1.0,
            pulsePhase: Math.random() * Math.PI * 2,
            intensity: Math.random() * 0.5 + 0.5,
        };
    }

    createBloomingFlower(x, y) {
        return {
            x,
            y,
            petalCount: this.activePreset.flowerPetals,
            bloomProgress: 0,
            size: Math.random() * 30 + 25,
            rotation: Math.random() * Math.PI * 2,
            life: 1.0,
            color: this.getRandomFlowerColor(),
            pulsePhase: Math.random() * Math.PI * 2,
        };
    }

    getRandomFlowerColor() {
        const colors = [
            { r: 255, g: 230, b: 180 }, // Pale yellow
            { r: 220, g: 200, b: 255 }, // Pale purple
            { r: 255, g: 200, b: 220 }, // Pale pink
            { r: 200, g: 255, b: 230 }, // Pale mint
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    createMistWave(lineCount) {
        return {
            y: this.canvas.height,
            targetY: -200,
            alpha: this.activePreset.mistOpacity,
            life: 1.0,
            speed: 1 + lineCount * 0.2,
            wavePhase: Math.random() * Math.PI * 2,
            height: Math.random() * 150 + 100,
        };
    }

    createBioluminescentRipple(x, y, lineCount) {
        return {
            x,
            y,
            radius: 0,
            maxRadius: 150 + lineCount * 30,
            alpha: 0.6,
            life: 1.0,
            color: '#8cffda', // Cyan-green bioluminescence
        };
    }

    update() {
        this.time++;

        // Decay intensity
        this.comboIntensity *= 0.98;
        this.ambientGlow *= 0.995;
        this.plantSway *= 0.96;

        // Update pollen particles
        for (let i = this.pollenParticles.length - 1; i >= 0; i--) {
            const p = this.pollenParticles[i];

            if (this.activePreset.particleTrails) {
                p.trail.unshift({ x: p.x, y: p.y, alpha: p.alpha });
                if (p.trail.length > 5) p.trail.pop();
            }

            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15; // Gravity
            p.vx *= 0.98;
            p.life -= 0.01;
            p.alpha = p.life * 0.8;

            if (p.life <= 0 || p.y > this.canvas.height) {
                this.pollenParticles.splice(i, 1);
            }
        }

        // Update fireflies with wandering behavior
        for (let i = this.fireflies.length - 1; i >= 0; i--) {
            const f = this.fireflies[i];

            // Wandering motion
            f.wanderPhase += 0.02;
            f.vx = Math.sin(f.wanderPhase) * 1.5;
            f.vy = -1 + Math.cos(f.wanderPhase * 0.7) * 0.5;

            f.x += f.vx;
            f.y += f.vy;
            f.life -= 0.003;
            f.pulsePhase += f.pulseSpeed;

            if (f.life <= 0 || f.y < -50) {
                this.fireflies.splice(i, 1);
            }
        }

        // Spawn ambient fireflies (quality-scaled)
        if (Math.random() < this.activePreset.fireflySpawnRate && this.fireflies.length < this.MAX_FIREFLIES) {
            this.fireflies.push(this.createFirefly());
        }

        // Update vine waves
        for (let i = this.vineWaves.length - 1; i >= 0; i--) {
            const wave = this.vineWaves[i];
            wave.radius += 3;
            wave.life -= 0.01;
            wave.alpha = wave.life * 0.6;
            wave.rotation += wave.rotationSpeed;

            if (wave.life <= 0 || wave.radius > wave.maxRadius) {
                this.vineWaves.splice(i, 1);
            }
        }

        // Update leaf spirals
        for (let i = this.leafSpirals.length - 1; i >= 0; i--) {
            const leaf = this.leafSpirals[i];

            leaf.spiralAngle += 0.05;
            leaf.vx = Math.cos(leaf.spiralAngle) * 2;
            leaf.vy -= 0.5;

            leaf.x += leaf.vx;
            leaf.y += leaf.vy;
            leaf.rotation += leaf.rotationSpeed;
            leaf.life -= 0.008;
            leaf.alpha = leaf.life * 0.6;

            if (leaf.life <= 0 || leaf.y < -50) {
                this.leafSpirals.splice(i, 1);
            }
        }

        // Update moss glows
        for (let i = this.mossGlows.length - 1; i >= 0; i--) {
            const moss = this.mossGlows[i];
            moss.life -= 0.005;
            moss.pulsePhase += 0.03;

            if (moss.life <= 0) {
                this.mossGlows.splice(i, 1);
            }
        }

        // Update blooming flowers
        for (let i = this.bloomingFlowers.length - 1; i >= 0; i--) {
            const flower = this.bloomingFlowers[i];

            if (flower.bloomProgress < 1.0) {
                flower.bloomProgress += 0.02;
            }
            flower.life -= 0.004;
            flower.pulsePhase += 0.05;

            if (flower.life <= 0) {
                this.bloomingFlowers.splice(i, 1);
            }
        }

        // Update mist waves
        for (let i = this.mistWaves.length - 1; i >= 0; i--) {
            const mist = this.mistWaves[i];
            mist.y -= mist.speed;
            mist.life -= 0.006;
            mist.alpha = mist.life * this.activePreset.mistOpacity;
            mist.wavePhase += 0.03;

            if (mist.life <= 0 || mist.y < mist.targetY) {
                this.mistWaves.splice(i, 1);
            }
        }

        // Update bioluminescent ripples
        for (let i = this.bioluminescentRipples.length - 1; i >= 0; i--) {
            const ripple = this.bioluminescentRipples[i];
            ripple.radius += 4;
            ripple.life -= 0.015;
            ripple.alpha = ripple.life * 0.5;

            if (ripple.life <= 0 || ripple.radius > ripple.maxRadius) {
                this.bioluminescentRipples.splice(i, 1);
            }
        }
    }

    draw() {
        if (!this.ctx) return;

        // Clear canvas with transparency
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw ambient glow (if enabled)
        if (this.activePreset.enableAmbientGlow && this.ambientGlow > 0.01) {
            const gradient = this.ctx.createRadialGradient(
                this.canvas.width / 2,
                this.canvas.height / 2,
                0,
                this.canvas.width / 2,
                this.canvas.height / 2,
                this.canvas.width * 0.6,
            );
            gradient.addColorStop(0, `rgba(140, 255, 200, ${this.ambientGlow * 0.15})`);
            gradient.addColorStop(0.5, `rgba(100, 200, 140, ${this.ambientGlow * 0.08})`);
            gradient.addColorStop(1, 'rgba(60, 150, 100, 0)');
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Layer 1: Bioluminescent ripples (deep background)
        this.ctx.globalCompositeOperation = 'screen';
        this.bioluminescentRipples.forEach((ripple) => {
            for (let i = 0; i < 3; i++) {
                const r = ripple.radius - i * 15;
                if (r <= 0) continue;

                this.ctx.beginPath();
                this.ctx.arc(ripple.x, ripple.y, r, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(140, 255, 218, ${ripple.alpha * (0.4 - i * 0.1)})`;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        });

        // Layer 2: Moss glows (background)
        this.mossGlows.forEach((moss) => {
            const pulse = Math.sin(moss.pulsePhase) * 0.3 + 0.7;
            const { glowLayers } = this.activePreset;

            for (let i = glowLayers; i > 0; i--) {
                const gradient = this.ctx.createRadialGradient(
                    moss.x,
                    moss.y,
                    0,
                    moss.x,
                    moss.y,
                    moss.radius * (1 + i * 0.3),
                );
                gradient.addColorStop(0, `rgba(120, 255, 180, ${moss.life * pulse * 0.3 / i})`);
                gradient.addColorStop(0.5, `rgba(80, 200, 130, ${moss.life * pulse * 0.15 / i})`);
                gradient.addColorStop(1, 'rgba(40, 150, 90, 0)');

                this.ctx.fillStyle = gradient;
                this.ctx.beginPath();
                this.ctx.arc(moss.x, moss.y, moss.radius * (1 + i * 0.3), 0, Math.PI * 2);
                this.ctx.fill();
            }
        });

        // Layer 3: Leaf spirals (background)
        this.ctx.globalCompositeOperation = 'source-over';
        this.leafSpirals.forEach((leaf) => {
            this.ctx.save();
            this.ctx.translate(leaf.x, leaf.y);
            this.ctx.rotate(leaf.rotation);
            this.ctx.globalAlpha = leaf.alpha * this.activePreset.leafDetail;

            // Draw leaf shape
            this.ctx.fillStyle = leaf.color;
            this.ctx.beginPath();
            this.ctx.moveTo(0, -leaf.size);
            this.ctx.quadraticCurveTo(leaf.size * 0.4, -leaf.size * 0.5, leaf.size * 0.3, 0);
            this.ctx.quadraticCurveTo(leaf.size * 0.2, leaf.size * 0.3, 0, leaf.size * 0.4);
            this.ctx.quadraticCurveTo(-leaf.size * 0.2, leaf.size * 0.3, -leaf.size * 0.3, 0);
            this.ctx.quadraticCurveTo(-leaf.size * 0.4, -leaf.size * 0.5, 0, -leaf.size);
            this.ctx.fill();

            // Leaf vein
            this.ctx.strokeStyle = `rgba(40, 80, 50, ${leaf.alpha * 0.5})`;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(0, -leaf.size * 0.8);
            this.ctx.lineTo(0, leaf.size * 0.3);
            this.ctx.stroke();

            this.ctx.restore();
        });

        // Layer 4: Vine waves (middleground) - DISABLED, skip if not used
        if (this.MAX_VINE_WAVES > 0 && this.vineWaves.length > 0) {
            this.ctx.globalCompositeOperation = 'screen';
            this.vineWaves.forEach((wave) => {
                this.ctx.save();
                this.ctx.translate(wave.x, wave.y);
                this.ctx.rotate(wave.rotation);

                wave.tendrils.forEach((tendril) => {
                    const { angle } = tendril;
                    const length = wave.radius * tendril.length;

                    this.ctx.beginPath();
                    this.ctx.moveTo(0, 0);

                    const segments = 8;
                    for (let i = 1; i <= segments; i++) {
                        const t = i / segments;
                        const r = length * t;
                        const curvature = Math.sin(t * Math.PI) * tendril.curve * 50;
                        const x = Math.cos(angle) * r + Math.sin(angle) * curvature;
                        const y = Math.sin(angle) * r - Math.cos(angle) * curvature;
                        this.ctx.lineTo(x, y);
                    }

                    this.ctx.strokeStyle = `rgba(140, 255, 140, ${wave.alpha * 0.4})`;
                    this.ctx.lineWidth = 3;
                    this.ctx.stroke();

                    // Inner glow
                    this.ctx.strokeStyle = `rgba(200, 255, 200, ${wave.alpha * 0.6})`;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                });

                this.ctx.restore();
            });
        }

        // Layer 5: Blooming flowers (middleground)
        this.bloomingFlowers.forEach((flower) => {
            const pulse = Math.sin(flower.pulsePhase) * 0.2 + 0.8;
            const bloomSize = flower.size * flower.bloomProgress;

            this.ctx.save();
            this.ctx.translate(flower.x, flower.y);
            this.ctx.rotate(flower.rotation);
            this.ctx.globalAlpha = flower.life * pulse;

            // Draw petals
            for (let i = 0; i < flower.petalCount; i++) {
                const angle = (Math.PI * 2 / flower.petalCount) * i;
                this.ctx.save();
                this.ctx.rotate(angle);

                // Petal glow
                const petalGradient = this.ctx.createRadialGradient(0, -bloomSize * 0.4, 0, 0, -bloomSize * 0.4, bloomSize * 0.5);
                petalGradient.addColorStop(0, `rgba(${flower.color.r}, ${flower.color.g}, ${flower.color.b}, 0.8)`);
                petalGradient.addColorStop(1, `rgba(${flower.color.r}, ${flower.color.g}, ${flower.color.b}, 0)`);

                this.ctx.fillStyle = petalGradient;
                this.ctx.beginPath();
                this.ctx.ellipse(0, -bloomSize * 0.4, bloomSize * 0.3, bloomSize * 0.5, 0, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.restore();
            }

            // Flower center
            const centerGradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, bloomSize * 0.2);
            centerGradient.addColorStop(0, 'rgba(255, 250, 180, 0.9)');
            centerGradient.addColorStop(1, 'rgba(255, 230, 120, 0.4)');
            this.ctx.fillStyle = centerGradient;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, bloomSize * 0.2, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        });

        // Layer 6: Mist waves (foreground)
        this.ctx.globalCompositeOperation = 'source-over';
        this.mistWaves.forEach((mist) => {
            const gradient = this.ctx.createLinearGradient(0, mist.y - mist.height, 0, mist.y);
            gradient.addColorStop(0, 'rgba(140, 200, 170, 0)');
            gradient.addColorStop(0.5, `rgba(140, 200, 170, ${mist.alpha})`);
            gradient.addColorStop(1, 'rgba(100, 160, 130, 0)');

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.moveTo(0, mist.y);

            for (let x = 0; x <= this.canvas.width; x += 20) {
                const waveY = mist.y + Math.sin(mist.wavePhase + x * 0.01) * 20;
                this.ctx.lineTo(x, waveY);
            }

            this.ctx.lineTo(this.canvas.width, mist.y - mist.height);
            this.ctx.lineTo(0, mist.y - mist.height);
            this.ctx.closePath();
            this.ctx.fill();
        });

        // Layer 7: Pollen particles (foreground)
        this.ctx.globalCompositeOperation = 'screen';
        this.pollenParticles.forEach((p) => {
            // Draw trail
            if (this.activePreset.particleTrails && p.trail.length > 1) {
                for (let i = 1; i < p.trail.length; i++) {
                    const point = p.trail[i];
                    const fade = 1 - (i / p.trail.length);
                    this.ctx.fillStyle = p.color;
                    this.ctx.globalAlpha = point.alpha * fade * 0.4;
                    this.ctx.beginPath();
                    this.ctx.arc(point.x, point.y, p.size * fade, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }

            // Draw particle with glow layers
            const { glowLayers } = this.activePreset;
            for (let i = glowLayers; i > 0; i--) {
                const glowGradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (1 + i));
                glowGradient.addColorStop(0, p.color);
                glowGradient.addColorStop(0.5, `${p.color}aa`);
                glowGradient.addColorStop(1, `${p.color}00`);

                this.ctx.fillStyle = glowGradient;
                this.ctx.globalAlpha = p.alpha * p.glow / i;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size * (1 + i), 0, Math.PI * 2);
                this.ctx.fill();
            }

            // Core particle
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = p.alpha;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Layer 8: Fireflies (top foreground)
        this.fireflies.forEach((f) => {
            const pulse = Math.sin(f.pulsePhase) * 0.5 + 0.5;
            const glowRadius = f.size * (2 + pulse * 2);

            // Outer glow
            const outerGlow = this.ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowRadius * 2);
            outerGlow.addColorStop(0, `rgba(255, 255, 180, ${f.life * pulse * 0.6})`);
            outerGlow.addColorStop(0.5, `rgba(200, 255, 150, ${f.life * pulse * 0.3})`);
            outerGlow.addColorStop(1, 'rgba(140, 255, 140, 0)');

            this.ctx.fillStyle = outerGlow;
            this.ctx.beginPath();
            this.ctx.arc(f.x, f.y, glowRadius * 2, 0, Math.PI * 2);
            this.ctx.fill();

            // Inner glow
            const innerGlow = this.ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowRadius);
            innerGlow.addColorStop(0, `rgba(255, 255, 255, ${f.life * pulse})`);
            innerGlow.addColorStop(0.6, `rgba(255, 255, 200, ${f.life * pulse * 0.7})`);
            innerGlow.addColorStop(1, `rgba(200, 255, 180, ${f.life * pulse * 0.2})`);

            this.ctx.fillStyle = innerGlow;
            this.ctx.beginPath();
            this.ctx.arc(f.x, f.y, glowRadius, 0, Math.PI * 2);
            this.ctx.fill();

            // Core
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = f.life * pulse;
            this.ctx.beginPath();
            this.ctx.arc(f.x, f.y, f.size * 0.5, 0, Math.PI * 2);
            this.ctx.fill();
        });

        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1.0;
    }

    animate() {
        if (!this.isActive) return;
        this.update();
        this.draw();
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    cleanup() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Remove resize listener
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Remove quality change listener
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Clear all effect arrays
        this.pollenParticles = [];
        this.fireflies = [];
        this.vineWaves = [];
        this.leafSpirals = [];
        this.mossGlows = [];
        this.bloomingFlowers = [];
        this.mistWaves = [];
        this.bioluminescentRipples = [];

        // Reset state
        this.comboIntensity = 0;
        this.ambientGlow = 0;
        this.plantSway = 0;
        this.time = 0;

        // Remove canvas from DOM and clear references
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;

        this.isActive = false;

        super.cleanup();
    }

    /**
     * Provide Moonlit Greenhouse themed tetromino styling (moonlit foliage palette)
     * @returns {Object} Moonlit Greenhouse tetromino configuration
     */
    getTetrominoConfig() {
        return MOONLIT_GREENHOUSE_TETROMINOS;
    }
}

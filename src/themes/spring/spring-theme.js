/**
 * @fileoverview Spring Theme - Ethereal Dawn Awakening
 * 
 * A breathtaking celebration of renewal featuring:
 * - Dreamy ethereal dawn sky with soft gradients and atmospheric effects
 * - Radiant animated sun with rotating rays
 * - Volumetric morphing clouds with parallax depth
 * - Floating magical particles / pollen motes
 * - Enchanting cherry blossom petals in parallax layers  
 * - Gentle spring rain with dewdrop splashes
 * - Dancing butterflies with realistic wing animation
 * - Glowing fireflies in the meadow
 * - Lush meadow with swaying wildflowers and growing sprouts
 * - COMBO EFFECT: A magnificent flower that grows with each combo,
 *   progressing through 5 distinct stages from seed to transcendent bloom
 */

import { BaseTheme } from '../base-theme.js';
import { SPRING_TETROMINOS } from './spring-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SpringTheme extends BaseTheme {
    constructor() {
        super('spring');
        this.eventUnsubscribers = [];
        
        // Multiple combo flowers state
        this.comboFlowers = [];
        this.currentComboCount = 0;
        this.maxFlowers = 15; // Further reduced for maximum performance
        this.maxFlowerStage = 12;
        
        // Flower variety configurations
        this.flowerVarieties = [
            { petalCount: 5, petalShape: 'round', name: 'cherry' },
            { petalCount: 6, petalShape: 'pointed', name: 'lily' },
            { petalCount: 8, petalShape: 'round', name: 'rose' },
            { petalCount: 4, petalShape: 'heart', name: 'pansy' },
            { petalCount: 12, petalShape: 'thin', name: 'daisy' },
            { petalCount: 7, petalShape: 'wavy', name: 'cosmos' },
            { petalCount: 5, petalShape: 'star', name: 'star' },
            { petalCount: 10, petalShape: 'round', name: 'sunflower' },
        ];
        
        // Effect arrays
        this.petals = [];
        this.butterflies = [];
        this.sunbeams = [];
        this.sunRays = [];
        this.particles = [];
        this.fireflies = [];
        this.clouds = [];
        this.dewdrops = [];
        this.sparkles = [];
        this.flowerParticles = [];
        
        // Canvas for combo effects
        this.canvas = null;
        this.ctx = null;
        this.resizeHandler = null;
        
        // Quality configuration
        this.qualityConfig = null;
    }

    /**
     * Get quality setting from game settings
     */
    getQualitySetting() {
        if (typeof window !== 'undefined' && window.settings) {
            const quality = window.settings.effectQuality || 'High';
            return quality.toLowerCase();
        }
        return 'high';
    }

    /**
     * Quality-specific configurations for the ethereal spring theme
     */
    getQualityConfig(quality) {
        const configs = {
            minimal: {
                clouds: 2,
                petals: 4,
                butterflies: 0,
                sunbeams: 1,
                sunRays: 4,
                particles: 5,
                fireflies: 0,
                raindrops: { back: 5, mid: 5, front: 2 },
                sprouts: 3,
                wildflowers: 3,
                comboEffects: {
                    particleMultiplier: 0.1,
                    glowIntensity: 0.3,
                    sparklesEnabled: false,
                    petalBurstEnabled: false,
                },
            },
            low: {
                clouds: 3,
                petals: 8,
                butterflies: 1,
                sunbeams: 2,
                sunRays: 6,
                particles: 10,
                fireflies: 2,
                raindrops: { back: 10, mid: 15, front: 5 },
                sprouts: 5,
                wildflowers: 5,
                comboEffects: {
                    particleMultiplier: 0.2,
                    glowIntensity: 0.4,
                    sparklesEnabled: true,
                    petalBurstEnabled: false,
                },
            },
            medium: {
                clouds: 4,
                petals: 15,
                butterflies: 2,
                sunbeams: 3,
                sunRays: 8,
                particles: 15,
                fireflies: 3,
                raindrops: { back: 15, mid: 20, front: 8 },
                sprouts: 8,
                wildflowers: 8,
                comboEffects: {
                    particleMultiplier: 0.3,
                    glowIntensity: 0.6,
                    sparklesEnabled: true,
                    petalBurstEnabled: true,
                },
            },
            high: {
                clouds: 6,
                petals: 20,
                butterflies: 3,
                sunbeams: 4,
                sunRays: 10,
                particles: 20,
                fireflies: 5,
                raindrops: { back: 20, mid: 25, front: 10 },
                sprouts: 12,
                wildflowers: 10,
                comboEffects: {
                    particleMultiplier: 0.4,
                    glowIntensity: 0.8,
                    sparklesEnabled: true,
                    petalBurstEnabled: true,
                },
            },
            ultra: {
                clouds: 8,
                petals: 30,
                butterflies: 4,
                sunbeams: 5,
                sunRays: 12,
                particles: 30,
                fireflies: 8,
                raindrops: { back: 30, mid: 35, front: 15 },
                sprouts: 15,
                wildflowers: 15,
                comboEffects: {
                    particleMultiplier: 0.6,
                    glowIntensity: 0.9,
                    sparklesEnabled: true,
                    petalBurstEnabled: true,
                },
            },
            extreme: {
                clouds: 12,
                petals: 50,
                butterflies: 6,
                sunbeams: 6,
                sunRays: 12,
                particles: 50,
                fireflies: 12,
                raindrops: { back: 40, mid: 50, front: 20 },
                sprouts: 20,
                wildflowers: 25,
                comboEffects: {
                    particleMultiplier: 0.8,
                    glowIntensity: 1.0,
                    sparklesEnabled: true,
                    petalBurstEnabled: true,
                },
            },
        };

        return configs[quality] || configs.high;
    }

    async createScene() {
        // Get quality config
        const qualitySetting = this.getQualitySetting();
        this.qualityConfig = this.getQualityConfig(qualitySetting);
        console.log('[Spring] 🌸 Creating ethereal dawn scene with quality:', qualitySetting);

        const themeContainer = document.getElementById('spring-theme');
        if (!themeContainer) return;

        // Helper to yield to main thread
        const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

        // 1. Radiant Sun with Rotating Rays
        const sunContainer = document.getElementById('spring-sun');
        if (sunContainer && sunContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            // Sun core
            const sunCore = document.createElement('div');
            sunCore.className = 'spring-sun-core';
            fragment.appendChild(sunCore);
            
            // Rotating sun rays
            for (let i = 0; i < this.qualityConfig.sunRays; i++) {
                const ray = document.createElement('div');
                ray.className = 'spring-sun-ray';
                const angle = (360 / this.qualityConfig.sunRays) * i;
                ray.style.transform = `rotate(${angle}deg)`;
                ray.style.animationDelay = `-${(30 / this.qualityConfig.sunRays) * i}s`;
                ray.style.opacity = 0.3 + Math.random() * 0.4;
                ray.style.width = `${150 + Math.random() * 100}px`;
                this.sunRays.push(ray);
                fragment.appendChild(ray);
            }
            sunContainer.appendChild(fragment);
            this.registerContainer(sunContainer);
        }
        
        await yieldFrame();

        // 2. Ethereal Sunbeams / God rays
        const sunbeamContainer = document.getElementById('spring-sunbeams');
        if (sunbeamContainer && sunbeamContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < this.qualityConfig.sunbeams; i++) {
                const beam = document.createElement('div');
                beam.className = 'spring-sunbeam';
                
                // Position beams emanating from sun area
                const baseAngle = 15 + (i * 12);
                beam.style.setProperty('--beam-angle', `${baseAngle}deg`);
                beam.style.setProperty('--beam-width', `${60 + Math.random() * 80}px`);
                beam.style.setProperty('--beam-opacity', `${0.12 + Math.random() * 0.15}`);
                beam.style.setProperty('--beam-blur', `${12 + Math.random() * 8}px`);
                beam.style.setProperty('--beam-duration', `${8 + Math.random() * 6}s`);
                beam.style.setProperty('--beam-delay', `-${Math.random() * 10}s`);
                
                this.sunbeams.push(beam);
                fragment.appendChild(beam);
            }
            sunbeamContainer.appendChild(fragment);
            this.registerContainer(sunbeamContainer);
        }

        await yieldFrame();

        // 3. Volumetric Dreamy Clouds with Parallax
        const cloudContainer = document.getElementById('spring-clouds');
        if (cloudContainer && cloudContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            const cloudLayers = [
                { count: Math.floor(this.qualityConfig.clouds * 0.3), scale: 0.6, blur: 15, opacity: 0.5, speed: 1.5, yRange: [5, 25] },
                { count: Math.floor(this.qualityConfig.clouds * 0.4), scale: 0.85, blur: 10, opacity: 0.7, speed: 1.0, yRange: [10, 35] },
                { count: Math.floor(this.qualityConfig.clouds * 0.3), scale: 1.1, blur: 6, opacity: 0.85, speed: 0.7, yRange: [15, 45] },
            ];
            
            cloudLayers.forEach((layer, layerIndex) => {
                for (let i = 0; i < layer.count; i++) {
                    const cloud = document.createElement('div');
                    cloud.className = 'spring-cloud';
                    const baseSize = 150 + Math.random() * 200;
                    const size = baseSize * layer.scale;
                    cloud.style.width = `${size}px`;
                    cloud.style.height = `${size * 0.45}px`;
                    cloud.style.top = `${layer.yRange[0] + Math.random() * (layer.yRange[1] - layer.yRange[0])}%`;
                    cloud.style.opacity = layer.opacity * (0.7 + Math.random() * 0.3);
                    cloud.style.zIndex = layerIndex + 3;
                    
                    const duration = (80 + Math.random() * 60) * layer.speed;
                    cloud.style.setProperty('--cloud-duration', `${duration}s`);
                    cloud.style.setProperty('--cloud-delay', `-${Math.random() * duration}s`);
                    cloud.style.setProperty('--cloud-blur', `${layer.blur}px`);
                    
                    this.clouds.push(cloud);
                    fragment.appendChild(cloud);
                }
            });
            cloudContainer.appendChild(fragment);
            this.registerContainer(cloudContainer);
        }

        await yieldFrame();

        // 4. Floating Magical Particles / Pollen
        const particleContainer = document.getElementById('spring-particles');
        if (particleContainer && particleContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            const particleColors = [
                'rgba(255, 248, 220, 0.9)',  // Warm golden
                'rgba(255, 223, 186, 0.85)', // Peach
                'rgba(255, 255, 200, 0.8)',  // Pale yellow
                'rgba(255, 240, 245, 0.85)', // Lavender blush
                'rgba(200, 255, 200, 0.7)',  // Light green
            ];
            
            for (let i = 0; i < this.qualityConfig.particles; i++) {
                const particle = document.createElement('div');
                particle.className = 'spring-particle';
                
                const size = 2 + Math.random() * 5;
                const color = particleColors[Math.floor(Math.random() * particleColors.length)];
                const duration = 12 + Math.random() * 15;
                const delay = Math.random() * duration;
                
                particle.style.setProperty('--particle-size', `${size}px`);
                particle.style.setProperty('--particle-color', color);
                particle.style.setProperty('--particle-opacity', `${0.4 + Math.random() * 0.5}`);
                particle.style.setProperty('--particle-blur', `${Math.random() < 0.3 ? 1 : 0}px`);
                particle.style.setProperty('--float-duration', `${duration}s`);
                particle.style.setProperty('--float-delay', `-${delay}s`);
                particle.style.setProperty('--start-x', `${Math.random() * 100}vw`);
                particle.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 50}px`);
                
                this.particles.push(particle);
                fragment.appendChild(particle);
            }
            particleContainer.appendChild(fragment);
            this.registerContainer(particleContainer);
        }

        // 5. Glowing Fireflies
        const fireflyContainer = document.getElementById('spring-fireflies');
        if (fireflyContainer && fireflyContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < this.qualityConfig.fireflies; i++) {
                const firefly = document.createElement('div');
                firefly.className = 'spring-firefly';
                
                firefly.style.left = `${10 + Math.random() * 80}%`;
                firefly.style.top = `${50 + Math.random() * 40}%`;
                
                const driftDuration = 15 + Math.random() * 20;
                firefly.style.setProperty('--drift-duration', `${driftDuration}s`);
                firefly.style.setProperty('--firefly-delay', `-${Math.random() * 5}s`);
                firefly.style.setProperty('--drift-x1', `${(Math.random() - 0.5) * 60}px`);
                firefly.style.setProperty('--drift-y1', `${(Math.random() - 0.5) * 40}px`);
                firefly.style.setProperty('--drift-x2', `${(Math.random() - 0.5) * 50}px`);
                firefly.style.setProperty('--drift-y2', `${(Math.random() - 0.5) * 35}px`);
                firefly.style.setProperty('--drift-x3', `${(Math.random() - 0.5) * 55}px`);
                firefly.style.setProperty('--drift-y3', `${(Math.random() - 0.5) * 45}px`);
                
                this.fireflies.push(firefly);
                fragment.appendChild(firefly);
            }
            fireflyContainer.appendChild(fragment);
            this.registerContainer(fireflyContainer);
        }

        await yieldFrame();

        // 8. Multi-layered Gentle Spring Rain
        const rainLayers = [
            {
                container: document.getElementById('rain-back'),
                count: this.qualityConfig.raindrops.back,
                width: '0.7px',
                height: '30px',
                duration: 0.8,
                drift: -6,
                opacity: 0.35,
            },
            {
                container: document.getElementById('rain-mid'),
                count: this.qualityConfig.raindrops.mid,
                width: '0.9px',
                height: '45px',
                duration: 0.6,
                drift: -10,
                opacity: 0.5,
            },
            {
                container: document.getElementById('rain-front'),
                count: this.qualityConfig.raindrops.front,
                width: '1.2px',
                height: '60px',
                duration: 0.45,
                drift: -15,
                opacity: 0.7,
            },
        ];

        rainLayers.forEach((layer) => {
            if (layer.container && layer.container.children.length === 0) {
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < layer.count; i++) {
                    const drop = document.createElement('div');
                    drop.className = 'spring-raindrop';
                    drop.style.left = `${Math.random() * 105}%`;
                    drop.style.width = layer.width;
                    drop.style.height = layer.height;
                    drop.style.opacity = layer.opacity * (0.7 + Math.random() * 0.3);
                    const animDuration = Math.random() * 0.3 + layer.duration;
                    drop.style.animationDuration = `${animDuration}s`;
                    drop.style.animationDelay = `-${Math.random() * animDuration * 6}s`;
                    drop.style.setProperty('--x-drift', `${layer.drift}px`);
                    fragment.appendChild(drop);
                }
                layer.container.appendChild(fragment);
                this.registerContainer(layer.container);
            }
        });

        await yieldFrame();

        // 6. Enchanting Cherry Blossom Petals (parallax layers)
        const petalContainer = document.getElementById('spring-petals');
        if (petalContainer && petalContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            const petalColorSets = [
                { main: '#FFB7C5', mid: '#FFC8D4', light: '#FFE4EC' },
                { main: '#FFDEE2', mid: '#FFE8EC', light: '#FFF5F7' },
                { main: '#FFC0CB', mid: '#FFD1DC', light: '#FFECF0' },
                { main: '#FFE4E9', mid: '#FFECF0', light: '#FFF8FA' },
                { main: '#F8BBD0', mid: '#FBCEE0', light: '#FEE8F0' },
            ];
            
            const petalLayers = [
                { count: Math.floor(this.qualityConfig.petals * 0.25), scale: 0.45, blur: 2.5, opacity: 0.45, speed: 1.6, zIndex: 5 },
                { count: Math.floor(this.qualityConfig.petals * 0.35), scale: 0.7, blur: 1.2, opacity: 0.65, speed: 1.2, zIndex: 7 },
                { count: Math.floor(this.qualityConfig.petals * 0.25), scale: 0.9, blur: 0.5, opacity: 0.8, speed: 0.9, zIndex: 9 },
                { count: Math.floor(this.qualityConfig.petals * 0.15), scale: 1.1, blur: 0, opacity: 0.95, speed: 0.7, zIndex: 11 },
            ];

            petalLayers.forEach((layer) => {
                for (let i = 0; i < layer.count; i++) {
                    const petal = document.createElement('div');
                    petal.className = 'spring-petal';
                    const colorSet = petalColorSets[Math.floor(Math.random() * petalColorSets.length)];
                    
                    const size = 10 + Math.random() * 8;
                    petal.style.setProperty('--petal-size', `${size * layer.scale}px`);
                    petal.style.setProperty('--petal-color', colorSet.main);
                    petal.style.setProperty('--petal-color-mid', colorSet.mid);
                    petal.style.setProperty('--petal-color-light', colorSet.light);
                    petal.style.setProperty('--petal-scale', layer.scale);
                    petal.style.setProperty('--petal-blur', `${layer.blur}px`);
                    petal.style.setProperty('--petal-opacity', layer.opacity);
                    petal.style.zIndex = layer.zIndex;
                    
                    const xStart = Math.random() * 120 - 10;
                    const xDrift = (Math.random() - 0.5) * 50;
                    petal.style.setProperty('--x-start', `${xStart}vw`);
                    petal.style.setProperty('--x-end', `${xStart + xDrift}vw`);
                    petal.style.setProperty('--rotate-start', `${Math.random() * 360}deg`);
                    petal.style.setProperty('--rotate-end', `${Math.random() * 720 - 360}deg`);
                    
                    const duration = (8 + Math.random() * 10) * layer.speed;
                    petal.style.setProperty('--fall-duration', `${duration}s`);
                    petal.style.setProperty('--fall-delay', `-${Math.random() * duration}s`);
                    
                    this.petals.push(petal);
                    fragment.appendChild(petal);
                }
            });
            petalContainer.appendChild(fragment);
            this.registerContainer(petalContainer);
        }

        await yieldFrame();

        // 7. Enchanted Dancing Butterflies
        const butterflyContainer = document.getElementById('spring-butterflies');
        if (butterflyContainer && butterflyContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            const butterflyColorSets = [
                { main: '#FFD700', light: '#FFF8DC' },  // Golden
                { main: '#FF69B4', light: '#FFB6C1' },  // Hot pink
                { main: '#87CEEB', light: '#E0F4FF' },  // Sky blue
                { main: '#DDA0DD', light: '#E8D0E8' },  // Plum
                { main: '#98FB98', light: '#C8FFC8' },  // Pale green
                { main: '#FFA500', light: '#FFD280' },  // Orange
                { main: '#FF6B6B', light: '#FFB3B3' },  // Coral
            ];
            
            for (let i = 0; i < this.qualityConfig.butterflies; i++) {
                const butterfly = document.createElement('div');
                butterfly.className = 'spring-butterfly';
                const colorSet = butterflyColorSets[Math.floor(Math.random() * butterflyColorSets.length)];
                butterfly.style.setProperty('--butterfly-color', colorSet.main);
                butterfly.style.setProperty('--butterfly-color-light', colorSet.light);
                
                const pathVariant = Math.floor(Math.random() * 3) + 1;
                butterfly.classList.add(`path-${pathVariant}`);
                
                butterfly.style.setProperty('--start-x', `${Math.random() * 90}vw`);
                butterfly.style.setProperty('--start-y', `${25 + Math.random() * 45}vh`);
                
                const pathDuration = 25 + Math.random() * 20;
                butterfly.style.setProperty('--path-duration', `${pathDuration}s`);
                butterfly.style.animationDuration = `${pathDuration}s, 0.25s`;
                butterfly.style.animationDelay = `-${Math.random() * pathDuration}s, 0s`;
                
                this.butterflies.push(butterfly);
                fragment.appendChild(butterfly);
            }
            butterflyContainer.appendChild(fragment);
            this.registerContainer(butterflyContainer);
        }

        // 9. Enchanted Meadow with Swaying Wildflowers
        const meadowContainer = document.getElementById('spring-meadow');
        if (meadowContainer && meadowContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            const flowerTypes = [
                { emoji: '🌸', size: 18, height: 35 },
                { emoji: '🌼', size: 16, height: 30 },
                { emoji: '🌺', size: 17, height: 32 },
                { emoji: '💐', size: 20, height: 38 },
                { emoji: '🌷', size: 16, height: 34 },
                { emoji: '🪻', size: 15, height: 33 },
                { emoji: '🌻', size: 19, height: 40 },
            ];
            
            for (let i = 0; i < this.qualityConfig.wildflowers; i++) {
                const flower = document.createElement('div');
                flower.className = 'spring-wildflower';
                const type = flowerTypes[Math.floor(Math.random() * flowerTypes.length)];
                flower.textContent = type.emoji;
                const sizeVariation = type.size + Math.random() * 10;
                flower.style.fontSize = `${sizeVariation}px`;
                flower.style.left = `${2 + Math.random() * 96}%`;
                flower.style.bottom = `${Math.random() * 10}%`;
                flower.style.setProperty('--sway-duration', `${2.5 + Math.random() * 3}s`);
                flower.style.animationDelay = `-${Math.random() * 4}s`;
                flower.style.zIndex = Math.floor(sizeVariation);
                fragment.appendChild(flower);
            }
            meadowContainer.appendChild(fragment);
            this.registerContainer(meadowContainer);
        }

        // 10. Growing Sprouts with Life Cycle
        const sproutsContainer = document.getElementById('sprouts-container');
        if (sproutsContainer && sproutsContainer.children.length === 0) {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < this.qualityConfig.sprouts; i++) {
                const sprout = document.createElement('div');
                sprout.className = 'sprout';
                sprout.style.left = `${2 + Math.random() * 96}%`;
                sprout.style.animationDelay = `-${Math.random() * 28}s`;

                const leftLeaf = document.createElement('div');
                leftLeaf.className = 'left';
                const rightLeaf = document.createElement('div');
                rightLeaf.className = 'right';

                const swayDuration = 3.5 + Math.random() * 2.5;
                leftLeaf.style.animationDuration = `${swayDuration}s`;
                rightLeaf.style.animationDuration = `${swayDuration}s`;

                sprout.appendChild(leftLeaf);
                sprout.appendChild(rightLeaf);
                fragment.appendChild(sprout);
            }
            sproutsContainer.appendChild(fragment);
            this.registerContainer(sproutsContainer);
        }

        // 11. Create the Magical Combo Flower Garden
        const comboFlowerContainer = document.getElementById('spring-combo-flower');
        if (comboFlowerContainer) {
            comboFlowerContainer.innerHTML = '';
            this.comboFlowers = [];
            this.registerContainer(comboFlowerContainer);
        }

        // 12. Setup canvas for advanced particle effects
        this.canvas = document.getElementById('spring-combo-canvas');
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'spring-combo-canvas';
            document.body.appendChild(this.canvas);
        }

        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d', { alpha: true, desynchronized: true });
            this.resizeHandler = () => this.resizeCanvas();
            window.addEventListener('resize', this.resizeHandler, false);
            this.resizeCanvas();
        }

        // Setup event listeners
        this.setupEventListeners();

        console.log('[Spring] 🌸 Scene creation complete - Ethereal dawn awaits!');
    }

    /**
     * Create a new unique flower at a random position
     */
    createComboFlower(container) {
        // Don't exceed max flowers
        if (this.comboFlowers.length >= this.maxFlowers) return null;
        
        // Pick a random variety
        const variety = this.flowerVarieties[Math.floor(Math.random() * this.flowerVarieties.length)];
        
        // Generate unique flower ID
        const flowerId = `combo-flower-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Random position (spread across the entire bottom area)
        // Using 1% to 99% to ensure full coverage across the screen width
        const posX = 1 + Math.random() * 98; 
        const posY = Math.random() * 8; // 0% to 8% from bottom - keep them closer to the ground
        
        // Random scale variation (0.2 to 0.55) - much smaller and varied
        const baseScale = 0.2 + Math.random() * 0.35;
        
        // Random rotation for natural look
        const rotation = (Math.random() - 0.5) * 20; // -10 to +10 degrees
        
        // Random color hue shift
        const hueShift = Math.floor(Math.random() * 60) - 30; // -30 to +30 degrees
        
        // Growth speed multiplier (very slow: 0.3 to 0.7)
        const growthSpeed = 0.3 + Math.random() * 0.4;
        
        // Main flower wrapper
        const flowerWrapper = document.createElement('div');
        flowerWrapper.className = `combo-flower-wrapper variety-${variety.name} shape-${variety.petalShape}`;
        flowerWrapper.id = flowerId;
        
        // Position the flower
        flowerWrapper.style.left = `${posX}%`;
        flowerWrapper.style.bottom = `${posY}%`;
        flowerWrapper.style.setProperty('--flower-scale', baseScale);
        flowerWrapper.style.setProperty('--flower-rotation', `${rotation}deg`);
        flowerWrapper.style.setProperty('--hue-shift', `${hueShift}deg`);
        flowerWrapper.style.setProperty('--growth-speed', growthSpeed);
        flowerWrapper.style.zIndex = Math.floor(posY + baseScale * 10);
        
        // Stem with life energy
        const stem = document.createElement('div');
        stem.className = 'combo-flower-stem';
        
        // Stem height variation (shorter stems for smaller flowers)
        const stemHeight = 40 + Math.random() * 50;
        stem.style.setProperty('--stem-height', `${stemHeight}px`);
        
        // Flower head container
        const flowerHead = document.createElement('div');
        flowerHead.className = 'combo-flower-head';
        
        // Radiant center of flower
        const center = document.createElement('div');
        center.className = 'combo-flower-center';
        
        // Center size variation
        const centerSize = 8 + Math.random() * 8;
        center.style.setProperty('--center-size', `${centerSize}px`);
        
        // Create petals based on variety
        const petalCount = variety.petalCount;
        const angleStep = 360 / petalCount;
        
        for (let i = 0; i < petalCount; i++) {
            const petal = document.createElement('div');
            petal.className = `combo-flower-petal petal-${variety.petalShape}`;
            petal.style.setProperty('--petal-index', i);
            petal.style.setProperty('--petal-angle', `${i * angleStep}deg`);
            petal.style.setProperty('--petal-count', petalCount);
            
            // Slight random variation per petal
            const petalScale = 0.9 + Math.random() * 0.2;
            petal.style.setProperty('--petal-scale', petalScale);
            
            flowerHead.appendChild(petal);
        }
        
        flowerHead.appendChild(center);
        
        // Simplified: Removed expensive glow and aura elements
        
        // Enchanted leaves on stem (reduced to max 1 leaf for performance)
        if (Math.random() > 0.5) {
            const leafSide = Math.random() > 0.5 ? 'left' : 'right';
            const leaf = document.createElement('div');
            leaf.className = `combo-flower-leaf ${leafSide}`;
            leaf.style.setProperty('--leaf-position', `${30 + Math.random() * 40}%`);
            flowerWrapper.appendChild(leaf);
        }
        
        // Particle emitter container
        const particles = document.createElement('div');
        particles.className = 'combo-flower-particles';
        
        // Assemble the flower
        flowerWrapper.appendChild(stem);
        // Removed aura and glow
        flowerWrapper.appendChild(flowerHead);
        flowerWrapper.appendChild(particles);
        
        container.appendChild(flowerWrapper);
        
        // Create flower state object
        const flowerState = {
            id: flowerId,
            element: flowerWrapper,
            variety: variety,
            scale: baseScale,
            stage: 0,
            posX: posX,
            posY: posY,
            growthSpeed: growthSpeed,
            maxStage: this.maxFlowerStage
        };
        
        this.comboFlowers.push(flowerState);
        this.updateFlowerStage(flowerState, 0);
        
        return flowerState;
    }
    
    /**
     * Spawn a new flower when combo happens
     */
    spawnNewFlower() {
        const container = document.getElementById('spring-combo-flower');
        if (!container) return null;
        
        return this.createComboFlower(container);
    }
    
    /**
     * Grow all existing flowers
     */
    growAllFlowers(amount = 1) {
        this.comboFlowers.forEach(flower => {
            if (flower.stage < flower.maxStage) {
                // Apply growth speed multiplier for very slow growth
                const actualGrowth = amount * flower.growthSpeed;
                const newStage = Math.min(flower.stage + actualGrowth, flower.maxStage);
                this.updateFlowerStage(flower, newStage);
            }
        });
    }
    
    /**
     * Get a random existing flower
     */
    getRandomFlower() {
        if (this.comboFlowers.length === 0) return null;
        return this.comboFlowers[Math.floor(Math.random() * this.comboFlowers.length)];
    }

    /**
     * Update an individual flower's growth stage
     */
    updateFlowerStage(flower, stage) {
        if (!flower || !flower.element) return;
        
        flower.stage = Math.min(stage, flower.maxStage);
        
        // Update CSS variables for growth animation
        const growthProgress = flower.stage / flower.maxStage;
        flower.element.style.setProperty('--growth-stage', flower.stage);
        flower.element.style.setProperty('--growth-progress', growthProgress);
        
        // Add/remove stage classes
        flower.element.classList.remove('stage-dormant', 'stage-sprouting', 'stage-budding', 'stage-blooming', 'stage-radiant', 'stage-transcendent');
        
        if (flower.stage === 0) {
            flower.element.classList.add('stage-dormant');
        } else if (flower.stage <= 2) {
            flower.element.classList.add('stage-sprouting');
        } else if (flower.stage <= 4) {
            flower.element.classList.add('stage-budding');
        } else if (flower.stage <= 7) {
            flower.element.classList.add('stage-blooming');
        } else if (flower.stage <= 10) {
            flower.element.classList.add('stage-radiant');
        } else {
            flower.element.classList.add('stage-transcendent');
        }
        
        // Trigger growth animation (very slow transition via CSS)
        // Performance Optimization: Removed forced reflow logic
        // The CSS transition on CSS variables is sufficient and much more performant
        // flower.element.classList.remove('growing');
        // void flower.element.offsetWidth; // Force reflow
        // flower.element.classList.add('growing');
    }

    /**
     * Spawn growth particles around a specific flower
     */
    spawnGrowthParticles(flower, count) {
        if (!this.qualityConfig?.comboEffects?.sparklesEnabled) return;
        if (!flower || !flower.element) return;
        
        const particleContainer = flower.element.querySelector('.combo-flower-particles');
        if (!particleContainer) return;
        
        const colors = ['#FFD700', '#FF69B4', '#98FB98', '#FFB7C5', '#87CEEB', '#FFF8DC'];
        
        // Create a document fragment for batch appending
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'combo-growth-particle';
            particle.style.setProperty('--particle-color', colors[Math.floor(Math.random() * colors.length)]);
            particle.style.setProperty('--particle-angle', `${Math.random() * 360}deg`);
            particle.style.setProperty('--particle-distance', `${30 + Math.random() * 50}px`);
            particle.style.setProperty('--particle-size', `${2 + Math.random() * 4}px`);
            
            // Stagger animations using CSS delay instead of JS timeouts
            particle.style.animationDelay = `${i * 60}ms`;
            
            // Self-cleanup using animation events
            particle.addEventListener('animationend', () => {
                particle.remove();
            }, { once: true });
            
            fragment.appendChild(particle);
        }
        
        requestAnimationFrame(() => {
            particleContainer.appendChild(fragment);
        });
    }

    /**
     * Create petal burst effect
     */
    createPetalBurst(count) {
        if (!this.qualityConfig?.comboEffects?.petalBurstEnabled) return;
        
        const theme = document.getElementById('spring-theme');
        if (!theme) return;
        
        const colors = ['#FFB7C5', '#FFDEE2', '#FFC0CB', '#FFE4E9'];
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < count; i++) {
            const petal = document.createElement('div');
            petal.className = 'spring-burst-petal';
            petal.style.setProperty('--petal-color', colors[Math.floor(Math.random() * colors.length)]);
            petal.style.setProperty('--burst-angle', `${Math.random() * 360}deg`);
            petal.style.setProperty('--burst-distance', `${100 + Math.random() * 150}px`);
            petal.style.left = '50%';
            petal.style.bottom = '15%';
            
            // Stagger with CSS delay
            petal.style.animationDelay = `${i * 30}ms`;
            
            petal.addEventListener('animationend', () => {
                petal.remove();
            }, { once: true });
            
            fragment.appendChild(petal);
        }
        
        requestAnimationFrame(() => {
            theme.appendChild(fragment);
        });
    }

    resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setupEventListeners() {
        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount, data.comboCount);
            }
        });

        // Listen for piece lock events (for subtle effects)
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                // Reset flower if combo breaks (combo count goes to 0)
                // This is handled in onCombo
            }
        });

        this.eventUnsubscribers.push(comboUnsub, lineClearUnsub, pieceLockUnsub);
    }

    /**
     * Handle combo event - grow flowers and spawn new ones!
     */
    onCombo(comboCount) {
        console.log(`🌸 [Spring] Combo! Count: ${comboCount}`);
        
        this.currentComboCount = comboCount;
        
        // Spawn a new flower on every combo (if below max)
        if (this.comboFlowers.length < this.maxFlowers) {
            const newFlower = this.spawnNewFlower();
            if (newFlower) {
                // Give the new flower a small initial growth
                setTimeout(() => {
                    this.updateFlowerStage(newFlower, 0.5);
                }, 100);
            }
        }
        
        // Grow ALL existing flowers very slowly
        // Each combo adds a small amount of growth to all flowers
        const growthAmount = 0.5; // Very slow growth per combo
        this.growAllFlowers(growthAmount);
        
        // Spawn growth particles on random flowers
        const particleCount = Math.ceil(comboCount * 2 * (this.qualityConfig?.comboEffects?.particleMultiplier || 1));
        const flowersToSparkle = Math.min(3, this.comboFlowers.length);
        
        for (let i = 0; i < flowersToSparkle; i++) {
            const randomFlower = this.getRandomFlower();
            if (randomFlower) {
                this.spawnGrowthParticles(randomFlower, Math.ceil(particleCount / flowersToSparkle));
            }
        }
        
        // Create petal burst for bigger combos
        if (comboCount >= 3) {
            this.createPetalBurst(Math.ceil(comboCount * 2));
        }
        
        // Screen glow effect for big combos
        if (comboCount >= 5) {
            this.triggerScreenGlow(comboCount);
        }
    }

    /**
     * Handle line clear - affects background atmosphere
     */
    onLineClear(lineCount, comboCount = 0) {
        console.log(`🌸 [Spring] Line clear! Lines: ${lineCount}, Combo: ${comboCount}`);
        
        // Add ambient light pulse
        this.triggerLightPulse(lineCount);
        
        // Spawn extra petals
        this.spawnExtraPetals(lineCount * 3);
        
        // If combo breaks (lineCount but no combo), start slow decay
        if (comboCount === 0 && this.comboFlowers.some(f => f.stage > 0)) {
            // Gradually decay all flowers
            setTimeout(() => {
                if (this.currentComboCount === 0) {
                    this.decayFlowers();
                }
            }, 3000); // Longer delay before decay starts
        }
    }

    /**
     * Decay all flowers when combo ends (very slow decay)
     */
    decayFlowers() {
        let hasActiveFlowers = false;
        
        this.comboFlowers.forEach(flower => {
            if (flower.stage > 0) {
                hasActiveFlowers = true;
                // Very slow decay (0.1 per tick)
                const newStage = Math.max(0, flower.stage - 0.1 * flower.growthSpeed);
                this.updateFlowerStage(flower, newStage);
            }
        });
        
        // Continue decaying very slowly
        if (hasActiveFlowers) {
            setTimeout(() => {
                if (this.currentComboCount === 0) {
                    this.decayFlowers();
                }
            }, 1500); // Slow decay interval
        }
    }
    
    /**
     * Remove a flower completely (when it decays to 0)
     */
    removeFlower(flower) {
        const index = this.comboFlowers.indexOf(flower);
        if (index > -1) {
            this.comboFlowers.splice(index, 1);
            if (flower.element && flower.element.parentNode) {
                flower.element.classList.add('withering');
                setTimeout(() => {
                    if (flower.element.parentNode) {
                        flower.element.parentNode.removeChild(flower.element);
                    }
                }, 2000);
            }
        }
    }

    /**
     * Trigger a screen glow effect
     */
    triggerScreenGlow(intensity) {
        const theme = document.getElementById('spring-theme');
        if (!theme) return;
        
        const glow = document.createElement('div');
        glow.className = 'spring-screen-glow';
        glow.style.setProperty('--glow-intensity', Math.min(intensity * 0.08, 0.4));
        
        theme.appendChild(glow);
        
        setTimeout(() => {
            if (glow.parentNode) {
                glow.parentNode.removeChild(glow);
            }
        }, 1000);
    }

    /**
     * Trigger ambient light pulse
     */
    triggerLightPulse(intensity) {
        const theme = document.getElementById('spring-theme');
        if (!theme) return;
        
        theme.classList.add('light-pulse');
        theme.style.setProperty('--pulse-intensity', Math.min(intensity * 0.05, 0.15));
        
        setTimeout(() => {
            theme.classList.remove('light-pulse');
        }, 600);
    }

    /**
     * Spawn extra falling petals
     */
    spawnExtraPetals(count) {
        const petalContainer = document.getElementById('spring-petals');
        if (!petalContainer) return;
        
        const petalColors = ['#FFB7C5', '#FFDEE2', '#FFC0CB', '#FFE4E9', '#F8BBD0'];
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < count; i++) {
            const petal = document.createElement('div');
            petal.className = 'spring-petal extra';
            const color = petalColors[Math.floor(Math.random() * petalColors.length)];
            petal.style.setProperty('--petal-color', color);
            petal.style.setProperty('--petal-scale', 0.8 + Math.random() * 0.4);
            
            const xStart = Math.random() * 100;
            petal.style.setProperty('--x-start', `${xStart}vw`);
            petal.style.setProperty('--x-end', `${xStart + (Math.random() - 0.5) * 30}vw`);
            petal.style.setProperty('--rotate-start', `${Math.random() * 360}deg`);
            petal.style.setProperty('--rotate-end', `${Math.random() * 720}deg`);
            
            petal.style.animationDuration = `${4 + Math.random() * 4}s`;
            // Stagger
            petal.style.animationDelay = `${i * 100}ms`;
            
            petal.addEventListener('animationend', () => {
                petal.remove();
            }, { once: true });
            
            fragment.appendChild(petal);
        }
        
        requestAnimationFrame(() => {
            petalContainer.appendChild(fragment);
        });
    }

    animate() {
        // Animation loop removed for performance - using CSS animations only
    }

    stop() {
        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Remove resize handler
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Reset flower state
        this.currentComboCount = 0;
        this.comboFlowers.forEach(flower => {
            if (flower.element && flower.element.parentNode) {
                flower.element.parentNode.removeChild(flower.element);
            }
        });
        this.comboFlowers = [];

        // Clear all effect arrays
        this.petals = [];
        this.butterflies = [];
        this.sunbeams = [];
        this.sunRays = [];
        this.particles = [];
        this.fireflies = [];
        this.clouds = [];
        this.dewdrops = [];
        this.sparkles = [];
        this.flowerParticles = [];

        super.stop();
    }

    cleanup() {
        this.stop();
        
        // Remove canvas
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
        
        this.comboFlowers = [];
        
        super.cleanup();
    }

    /**
     * Provide Spring themed tetrominos (pastel bloom palette)
     * @returns {Object} Spring tetromino configuration
     */
    getTetrominoConfig() {
        return SPRING_TETROMINOS;
    }
}

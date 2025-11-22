import { BaseTheme } from '../base-theme.js';
import { SUMMER_TETROMINOS } from './summer-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class SummerTheme extends BaseTheme {
    constructor() {
        super('summer');
        this.themeContainerRef = null;
        this.butterflies = [];
        this.comboLevel = 0;
        this.dynamicElements = new Set();
        this.sunPosition = { x: 50, y: 25 }; // Sun in upper sky
        this.comboUnsubscribe = null; // Store unsubscribe function
    }

    stop() {
        this.destroyDynamicSystems();
        super.stop();
    }

    cleanup() {
        super.cleanup();
    }

    destroyDynamicSystems() {
        // Unsubscribe from combo events
        if (this.comboUnsubscribe) {
            this.comboUnsubscribe();
            this.comboUnsubscribe = null;
        }

        this.dynamicElements.forEach((node) => {
            if (node?.parentNode) node.parentNode.removeChild(node);
        });
        this.dynamicElements.clear();
        this.butterflies = [];
        this.themeContainerRef = null;
    }

    async createScene() {
        const themeContainer = document.getElementById('summer-theme');
        if (!themeContainer) return;

        this.themeContainerRef = themeContainer;

        // Subscribe to combo events
        if (!this.comboUnsubscribe) {
            this.comboUnsubscribe = eventBus.on(EVENTS.COMBO, ({ comboCount }) => {
                console.log(`[SummerTheme] Received combo event: ${comboCount}`);
                this.onComboUpdate(comboCount);
            });
        }

        // Build all summer elements
        this.buildSun();
        this.buildGodRays();
        this.buildSunFlares();
        this.buildClouds();
        this.buildPollen();
        this.buildButterflies();
        this.buildWildflowers();
        this.buildDandelionSeeds();
        this.buildGrass();

        // Start ambient animations
        this.startAmbientAnimations();
    }

    buildSun() {
        const sunElement = this.themeContainerRef?.querySelector('.summer-sun');
        if (!sunElement) return;

        // Position the sun
        sunElement.style.left = `${this.sunPosition.x}%`;
        sunElement.style.top = `${this.sunPosition.y}%`;

        // Add sun core with glow
        if (!sunElement.querySelector('.summer-sun-core')) {
            const core = document.createElement('div');
            core.className = 'summer-sun-core';
            sunElement.appendChild(core);
            this.dynamicElements.add(core);

            // Add lens effects container
            const lensStack = document.createElement('div');
            lensStack.className = 'summer-lens-stack';

            const halo = document.createElement('div');
            halo.className = 'summer-lens-halo';
            const hex = document.createElement('div');
            hex.className = 'summer-lens-hex';
            const bokeh = document.createElement('div');
            bokeh.className = 'summer-lens-bokeh';
            const spikes = document.createElement('div');
            spikes.className = 'summer-lens-spikes';

            lensStack.append(halo, hex, bokeh, spikes);
            sunElement.appendChild(lensStack);
            this.dynamicElements.add(lensStack);
        }
    }

    buildGodRays() {
        const godRayContainer = this.themeContainerRef?.querySelector('.summer-god-rays');
        if (!godRayContainer || godRayContainer.children.length > 0) return;

        const rayCount = 24;
        const angleStep = 360 / rayCount;

        for (let i = 0; i < rayCount; i++) {
            const ray = document.createElement('div');
            ray.className = 'summer-god-ray';
            const angle = i * angleStep + (Math.random() * 8 - 4);
            const length = this.random(300, 450);
            const width = this.random(3, 6);

            ray.style.setProperty('--ray-angle', `${angle}deg`);
            ray.style.setProperty('--ray-length', `${length}px`);
            ray.style.setProperty('--ray-width', `${width}px`);
            ray.style.willChange = 'transform, opacity';

            godRayContainer.appendChild(ray);
        }
        this.registerContainer(godRayContainer);
    }

    buildSunFlares() {
        const sunflareContainer = document.getElementById('summer-sunflares');
        if (!sunflareContainer || sunflareContainer.children.length > 0) return;

        // Create 4 layered sun flares for intense radiance
        for (let i = 0; i < 4; i++) {
            const flare = document.createElement('div');
            flare.className = 'summer-sunflare';

            const size = 150 + i * 80;
            flare.style.width = `${size}px`;
            flare.style.height = `${size}px`;

            if (i === 0) {
                flare.style.background = 'radial-gradient(circle, rgba(255, 255, 255, 0.5) 0%, rgba(255, 240, 180, 0.3) 40%, transparent 70%)';
            } else if (i === 1) {
                flare.style.background = 'radial-gradient(circle, rgba(255, 250, 200, 0.4) 0%, rgba(255, 220, 120, 0.2) 50%, transparent 65%)';
            } else if (i === 2) {
                flare.style.background = 'radial-gradient(circle, rgba(255, 235, 160, 0.3) 0%, rgba(255, 200, 100, 0.15) 50%, transparent 70%)';
            } else {
                flare.style.background = 'radial-gradient(circle, rgba(255, 220, 140, 0.25) 0%, transparent 60%)';
            }

            sunflareContainer.appendChild(flare);
        }
        this.registerContainer(sunflareContainer);
    }

    buildClouds() {
        const cloudContainer = document.getElementById('summer-clouds');
        if (!cloudContainer || cloudContainer.children.length > 0) return;

        // Create 5-8 wispy clouds
        const cloudCount = this.random(5, 8);
        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'summer-cloud';

            const width = this.random(120, 250);
            const height = this.random(40, 80);
            cloud.style.width = `${width}px`;
            cloud.style.height = `${height}px`;
            cloud.style.left = `${Math.random() * 120 - 10}%`;
            cloud.style.top = `${Math.random() * 40}%`;
            cloud.style.animationDuration = `${this.random(80, 150)}s`;
            cloud.style.animationDelay = `-${Math.random() * 100}s`;

            cloudContainer.appendChild(cloud);
        }
        this.registerContainer(cloudContainer);
    }

    buildPollen() {
        const pollenContainer = document.getElementById('summer-pollen-layer');
        if (!pollenContainer || pollenContainer.children.length > 0) return;

        // Create 80 floating pollen particles
        for (let i = 0; i < 80; i++) {
            const pollen = document.createElement('div');
            pollen.className = 'summer-pollen';

            const size = Math.random() * 3 + 1;
            pollen.style.width = `${size}px`;
            pollen.style.height = `${size}px`;

            const xStart = Math.random() * 100;
            const yStart = Math.random() * 120 - 10;
            const xEnd = xStart + (Math.random() - 0.5) * 40;
            const yEnd = yStart + this.random(30, 70);

            pollen.style.setProperty('--x-start', `${xStart}%`);
            pollen.style.setProperty('--y-start', `${yStart}%`);
            pollen.style.setProperty('--x-end', `${xEnd}%`);
            pollen.style.setProperty('--y-end', `${yEnd}%`);
            pollen.style.animationDuration = `${this.random(8, 15)}s`;
            pollen.style.animationDelay = `-${Math.random() * 15}s`;

            pollenContainer.appendChild(pollen);
        }
        this.registerContainer(pollenContainer);
    }

    buildButterflies() {
        const butterflyContainer = document.getElementById('summer-butterflies');
        if (!butterflyContainer || butterflyContainer.children.length > 0) return;

        // Create 8-12 butterflies with varied colors
        const butterflyCount = this.random(8, 12);
        const colors = [
            ['#FF6B35', '#F7931E'], // Orange Monarch
            ['#FFD700', '#FFA500'], // Yellow Swallowtail
            ['#FF69B4', '#FF1493'], // Pink
            ['#FFFFFF', '#F0F0F0'], // White Cabbage
            ['#9370DB', '#8A2BE2'], // Purple
        ];

        for (let i = 0; i < butterflyCount; i++) {
            const butterfly = document.createElement('div');
            butterfly.className = 'summer-butterfly';

            const colorPair = colors[Math.floor(Math.random() * colors.length)];
            butterfly.style.setProperty('--butterfly-color-1', colorPair[0]);
            butterfly.style.setProperty('--butterfly-color-2', colorPair[1]);

            // Create wing structure
            const leftWing = document.createElement('div');
            leftWing.className = 'butterfly-wing butterfly-wing-left';
            const rightWing = document.createElement('div');
            rightWing.className = 'butterfly-wing butterfly-wing-right';
            const body = document.createElement('div');
            body.className = 'butterfly-body';

            butterfly.append(leftWing, rightWing, body);

            // Random flight path
            const xStart = Math.random() * 100;
            const yStart = Math.random() * 80 + 10;
            const xMid1 = this.random(20, 80);
            const yMid1 = this.random(20, 70);
            const xMid2 = this.random(20, 80);
            const yMid2 = this.random(30, 80);
            const xEnd = Math.random() * 100;
            const yEnd = Math.random() * 80 + 10;

            butterfly.style.setProperty('--x-start', `${xStart}%`);
            butterfly.style.setProperty('--y-start', `${yStart}%`);
            butterfly.style.setProperty('--x-mid-1', `${xMid1}%`);
            butterfly.style.setProperty('--y-mid-1', `${yMid1}%`);
            butterfly.style.setProperty('--x-mid-2', `${xMid2}%`);
            butterfly.style.setProperty('--y-mid-2', `${yMid2}%`);
            butterfly.style.setProperty('--x-end', `${xEnd}%`);
            butterfly.style.setProperty('--y-end', `${yEnd}%`);

            butterfly.style.animationDuration = `${this.random(15, 30)}s`;
            butterfly.style.animationDelay = `-${Math.random() * 30}s`;

            butterflyContainer.appendChild(butterfly);
            this.butterflies.push(butterfly);
        }
        this.registerContainer(butterflyContainer);
    }

    buildWildflowers() {
        // Build flowers in three layers for depth
        ['back', 'mid', 'front'].forEach((layer, layerIndex) => {
            const container = document.getElementById(`summer-wildflowers-${layer}`);
            if (!container || container.children.length > 0) return;

            const flowerCount = layerIndex === 0 ? 15 : layerIndex === 1 ? 20 : 25;
            const flowerTypes = ['sunflower', 'poppy', 'daisy', 'lavender', 'wildflower'];

            for (let i = 0; i < flowerCount; i++) {
                const flower = document.createElement('div');
                const type = flowerTypes[Math.floor(Math.random() * flowerTypes.length)];
                flower.className = `summer-flower summer-flower-${type}`;
                flower.dataset.type = type;

                const scale = layerIndex === 0 ? this.random(0.5, 0.8) : layerIndex === 1 ? this.random(0.8, 1.2) : this.random(1.2, 1.8);
                flower.style.left = `${Math.random() * 100}%`;
                flower.style.bottom = `${Math.random() * 20 - 5}%`;
                flower.style.transform = `scale(${scale})`;
                flower.style.animationDelay = `-${Math.random() * 10}s`;

                // Apply blur to background flowers for depth of field
                if (layerIndex === 0) {
                    flower.style.filter = 'blur(2px)';
                    flower.style.opacity = '0.7';
                }

                container.appendChild(flower);
            }
            this.registerContainer(container);
        });
    }

    buildDandelionSeeds() {
        const seedContainer = document.getElementById('dandelion-seeds');
        if (!seedContainer || seedContainer.children.length > 0) return;

        for (let i = 0; i < 60; i++) {
            const seed = document.createElement('div');
            seed.className = 'dandelion-seed';
            const xStart = Math.random() * 100;
            const yStart = 100 + Math.random() * 20;
            const xEnd = Math.random() * 100;
            const yEnd = -20 + Math.random() * -20;
            seed.style.setProperty('--x-start', `${xStart}vw`);
            seed.style.setProperty('--y-start', `${yStart}vh`);
            seed.style.setProperty('--x-mid', `${xStart + (Math.random() - 0.5) * 40}vw`);
            seed.style.setProperty('--y-mid', `${(yStart + yEnd) / 2}vh`);
            seed.style.setProperty('--x-end', `${xEnd}vw`);
            seed.style.setProperty('--y-end', `${yEnd}vh`);
            seed.style.animationDuration = `${Math.random() * 10 + 15}s`;
            seed.style.animationDelay = `-${Math.random() * 25}s`;
            seedContainer.appendChild(seed);
        }
        this.registerContainer(seedContainer);
    }

    buildGrass() {
        const grassContainer = this.themeContainerRef?.querySelector('.summer-grass');
        if (!grassContainer || grassContainer.children.length > 0) return;

        // Create 150 grass blades with varied heights
        for (let i = 0; i < 150; i++) {
            const blade = document.createElement('div');
            blade.className = 'summer-grass-blade';
            blade.style.left = `${Math.random() * 100}%`;

            // Varied heights for realism
            const height = Math.random() * 50 + 25;
            blade.style.height = `${height}px`;
            blade.style.animationDelay = `-${Math.random() * 7}s`;
            blade.style.filter = `brightness(${Math.random() * 0.4 + 0.7})`;

            // Some grass taller in foreground
            if (Math.random() > 0.7) {
                blade.style.height = `${height * 1.5}px`;
                blade.style.filter = `brightness(${Math.random() * 0.3 + 0.8})`;
            }

            grassContainer.appendChild(blade);
        }
        this.registerContainer(grassContainer);
    }

    startAmbientAnimations() {
        // Gentle sun pulse
        if (this.themeContainerRef) {
            const sunCore = this.themeContainerRef.querySelector('.summer-sun-core');
            if (sunCore) {
                let pulsePhase = 0;
                const pulseSun = () => {
                    if (!this.themeContainerRef) return;
                    pulsePhase += 0.01;
                    const intensity = 0.95 + Math.sin(pulsePhase) * 0.05;
                    sunCore.style.opacity = intensity;
                    requestAnimationFrame(pulseSun);
                };
                pulseSun();
            }
        }
    }

    // Combo effect system - Summer themed!
    onComboUpdate(comboCount) {
        this.comboLevel = comboCount;

        if (comboCount >= 1 && comboCount < 2) {
            this.triggerFireflies();
        } else if (comboCount >= 2 && comboCount < 3) {
            this.triggerFlowerPetalBurst();
        } else if (comboCount >= 3 && comboCount < 5) {
            this.triggerRainbow();
        } else if (comboCount >= 5 && comboCount < 6) {
            this.triggerBeeSwarm();
        } else if (comboCount >= 6 && comboCount < 8) {
            this.triggerDewdropSparkles();
        } else if (comboCount >= 8 && comboCount < 10) {
            this.triggerButterflyVortex();
        } else if (comboCount >= 10) {
            this.triggerGoldenHourMagic();
        }
    }

    // COMBO 5-10: Fireflies appear and glow
    triggerFireflies() {
        const fireflyContainer = document.getElementById('summer-fireflies');
        if (!fireflyContainer) {
            const container = document.createElement('div');
            container.id = 'summer-fireflies';
            container.className = 'summer-firefly-container';
            this.themeContainerRef?.appendChild(container);
            this.dynamicElements.add(container);
        }

        const container = document.getElementById('summer-fireflies');
        if (!container) return;

        // Spawn 5-8 fireflies
        const fireflyCount = this.random(5, 8);
        for (let i = 0; i < fireflyCount; i++) {
            setTimeout(() => {
                const firefly = document.createElement('div');
                firefly.className = 'summer-firefly';
                firefly.style.left = `${Math.random() * 100}%`;
                firefly.style.top = `${Math.random() * 80 + 10}%`;
                firefly.style.animationDelay = `-${Math.random() * 4}s`;
                container.appendChild(firefly);

                // Remove after animation
                setTimeout(() => {
                    if (firefly.parentNode) firefly.parentNode.removeChild(firefly);
                }, 6000);
            }, i * 200);
        }
    }

    // COMBO 10-15: Flower petals burst from cleared lines
    triggerFlowerPetalBurst() {
        const petalContainer = document.getElementById('summer-petals');
        if (!petalContainer) {
            const container = document.createElement('div');
            container.id = 'summer-petals';
            container.className = 'summer-petal-container';
            this.themeContainerRef?.appendChild(container);
            this.dynamicElements.add(container);
        }

        const container = document.getElementById('summer-petals');
        if (!container) return;

        // Create 20 flower petals
        const colors = ['#FF69B4', '#FFB6C1', '#FFA500', '#FFD700', '#FF6B35', '#FFFFFF'];
        for (let i = 0; i < 20; i++) {
            setTimeout(() => {
                const petal = document.createElement('div');
                petal.className = 'summer-petal';
                petal.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                petal.style.left = `${40 + Math.random() * 20}%`;
                petal.style.top = `${40 + Math.random() * 20}%`;
                petal.style.setProperty('--petal-drift-x', `${(Math.random() - 0.5) * 200}px`);
                petal.style.setProperty('--petal-drift-y', `${Math.random() * 400 + 200}px`);
                petal.style.animationDelay = `${Math.random() * 0.5}s`;
                container.appendChild(petal);

                setTimeout(() => {
                    if (petal.parentNode) petal.parentNode.removeChild(petal);
                }, 4000);
            }, i * 50);
        }
    }

    // COMBO 15-20: Rainbow arc appears in sky
    triggerRainbow() {
        const rainbowEl = document.getElementById('summer-rainbow');
        if (!rainbowEl) {
            const rainbow = document.createElement('div');
            rainbow.id = 'summer-rainbow';
            rainbow.className = 'summer-rainbow';
            this.themeContainerRef?.appendChild(rainbow);
            this.dynamicElements.add(rainbow);
        }

        const rainbow = document.getElementById('summer-rainbow');
        if (rainbow) {
            rainbow.classList.add('summer-rainbow-active');
            setTimeout(() => {
                rainbow.classList.remove('summer-rainbow-active');
            }, 5000);
        }
    }

    // COMBO 20-25: Bees buzz around the flowers
    triggerBeeSwarm() {
        const beeContainer = document.getElementById('summer-bees');
        if (!beeContainer) {
            const container = document.createElement('div');
            container.id = 'summer-bees';
            container.className = 'summer-bee-container';
            this.themeContainerRef?.appendChild(container);
            this.dynamicElements.add(container);
        }

        const container = document.getElementById('summer-bees');
        if (!container) return;

        // Spawn 6-10 bees
        const beeCount = this.random(6, 10);
        for (let i = 0; i < beeCount; i++) {
            setTimeout(() => {
                const bee = document.createElement('div');
                bee.className = 'summer-bee';

                // Bees fly from left to right at bottom
                const startY = 60 + Math.random() * 30;
                bee.style.setProperty('--bee-start-y', `${startY}%`);
                bee.style.setProperty('--bee-mid-y', `${startY + (Math.random() - 0.5) * 20}%`);
                bee.style.setProperty('--bee-end-y', `${startY + (Math.random() - 0.5) * 15}%`);
                bee.style.animationDuration = `${this.random(3, 5)}s`;
                bee.style.animationDelay = `${Math.random() * 0.5}s`;

                container.appendChild(bee);

                setTimeout(() => {
                    if (bee.parentNode) bee.parentNode.removeChild(bee);
                }, 6000);
            }, i * 100);
        }
    }

    // COMBO 25-30: Dewdrop sparkles across the scene
    triggerDewdropSparkles() {
        const sparkleContainer = document.getElementById('summer-dewdrops');
        if (!sparkleContainer) {
            const container = document.createElement('div');
            container.id = 'summer-dewdrops';
            container.className = 'summer-dewdrop-container';
            this.themeContainerRef?.appendChild(container);
            this.dynamicElements.add(container);
        }

        const container = document.getElementById('summer-dewdrops');
        if (!container) return;

        // Create 30 sparkling dewdrops
        for (let i = 0; i < 30; i++) {
            setTimeout(() => {
                const dewdrop = document.createElement('div');
                dewdrop.className = 'summer-dewdrop';
                dewdrop.style.left = `${Math.random() * 100}%`;
                dewdrop.style.top = `${Math.random() * 100}%`;
                dewdrop.style.animationDelay = `${Math.random() * 2}s`;
                container.appendChild(dewdrop);

                setTimeout(() => {
                    if (dewdrop.parentNode) dewdrop.parentNode.removeChild(dewdrop);
                }, 3000);
            }, i * 30);
        }
    }

    // COMBO 30-40: Butterfly vortex - all butterflies spiral together
    triggerButterflyVortex() {
        if (!this.themeContainerRef) return;

        this.themeContainerRef.classList.add('summer-butterfly-vortex');

        // Enhanced butterfly activity
        this.butterflies.forEach((butterfly, index) => {
            setTimeout(() => {
                butterfly.style.animationDuration = '5s';
                butterfly.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 100, 1))';
            }, index * 100);
        });

        setTimeout(() => {
            this.themeContainerRef?.classList.remove('summer-butterfly-vortex');
            this.butterflies.forEach((butterfly) => {
                butterfly.style.animationDuration = `${this.random(15, 30)}s`;
                butterfly.style.filter = '';
            });
        }, 6000);
    }

    // COMBO 40+: Golden Hour Magic - Everything becomes magical golden hour
    triggerGoldenHourMagic() {
        if (!this.themeContainerRef) return;

        this.themeContainerRef.classList.add('summer-golden-hour');

        // Trigger multiple effects simultaneously
        this.triggerRainbow();
        this.triggerFireflies();
        this.triggerFlowerPetalBurst();

        // Intense sun pulse
        const sunCore = this.themeContainerRef.querySelector('.summer-sun-core');
        if (sunCore) {
            sunCore.classList.add('summer-sun-golden-burst');
        }

        setTimeout(() => {
            this.themeContainerRef?.classList.remove('summer-golden-hour');
            if (sunCore) {
                sunCore.classList.remove('summer-sun-golden-burst');
            }
        }, 8000);
    }

    /**
     * Provide Summer themed tetrominos (sunny seaside palette)
     * @returns {Object} Summer tetromino configuration
     */
    getTetrominoConfig() {
        return SUMMER_TETROMINOS;
    }
}

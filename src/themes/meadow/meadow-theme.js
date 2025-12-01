import { BaseTheme } from '../base-theme.js';
import { MEADOW_TETROMINOS } from './meadow-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Meadow Theme - An idyllic sun-dappled meadow experience
 * 
 * Features:
 * - Warm golden sun with animated rays and lens flare
 * - Drifting clouds with parallax depth
 * - Swaying grass with wind gusts
 * - Colorful wildflowers that bloom and sway
 * - Dancing butterflies with varied flight paths
 * - Floating pollen and dandelion seeds
 * - Magical fireflies that glow at dusk
 * - Buzzing bees visiting flowers
 * - Theme-integrated combo effects:
 *   - Flower bloom bursts for line clears
 *   - Butterfly swarms for combos
 *   - Pollen storms on high combos
 *   - Rainbow arcs for epic moments
 *   - Firefly sparkle showers
 * 
 * Quality Presets: Minimal, Low, Medium, High, Ultra, Extreme
 */
export default class MeadowTheme extends BaseTheme {
    constructor() {
        super('meadow');
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.lastTime = 0;
        this.visibilityHandler = null;
        this.effectPool = new Map(); // Pool for reusing effect elements
        
        // Graphics quality presets
        this.qualityChangeHandler = null;
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                // Sky elements
                cloudCount: 1,
                cloudAnimationEnabled: false,
                
                // Ground elements
                grassBladeCount: 15,
                flowerCount: 2,
                simplifiedFlowers: true,
                
                // Creatures
                butterflyCount: 1,
                beeCount: 1,
                fireflyCount: 0,
                
                // Particles
                pollenCount: 4,
                dandelionSeedCount: 0,
                
                // Effects
                enableComboEffects: false,
                bloomBurstParticles: 0,
                butterflySwarmCount: 0,
                pollenStormMultiplier: 0,
                rainbowEnabled: false,
                fireflyShowerCount: 0,
                
                // Performance
                animationFrameSkip: 8,
                useSimpleAnimations: true,
            },
            Low: {
                // Sky elements
                cloudCount: 1,
                cloudAnimationEnabled: true,
                
                // Ground elements
                grassBladeCount: 22,
                flowerCount: 3,
                simplifiedFlowers: true,
                
                // Creatures
                butterflyCount: 1,
                beeCount: 1,
                fireflyCount: 2,
                
                // Particles
                pollenCount: 8,
                dandelionSeedCount: 1,
                
                // Effects
                enableComboEffects: true,
                bloomBurstParticles: 2,
                butterflySwarmCount: 1,
                pollenStormMultiplier: 0.1,
                rainbowEnabled: false,
                fireflyShowerCount: 2,
                
                // Performance
                animationFrameSkip: 5,
                useSimpleAnimations: true,
            },
            Medium: {
                // Sky elements
                cloudCount: 1,
                cloudAnimationEnabled: true,
                
                // Ground elements
                grassBladeCount: 32,
                flowerCount: 5,
                simplifiedFlowers: true,
                
                // Creatures
                butterflyCount: 2,
                beeCount: 1,
                fireflyCount: 3,
                
                // Particles
                pollenCount: 14,
                dandelionSeedCount: 2,
                
                // Effects
                enableComboEffects: true,
                bloomBurstParticles: 4,
                butterflySwarmCount: 2,
                pollenStormMultiplier: 0.2,
                rainbowEnabled: true,
                fireflyShowerCount: 3,
                
                // Performance
                animationFrameSkip: 4,
                useSimpleAnimations: true,
            },
            High: {
                // Sky elements
                cloudCount: 2,
                cloudAnimationEnabled: true,
                
                // Ground elements
                grassBladeCount: 45,
                flowerCount: 8,
                simplifiedFlowers: true,
                
                // Creatures
                butterflyCount: 3,
                beeCount: 1,
                fireflyCount: 4,
                
                // Particles
                pollenCount: 22,
                dandelionSeedCount: 4,
                
                // Effects
                enableComboEffects: true,
                bloomBurstParticles: 6,
                butterflySwarmCount: 3,
                pollenStormMultiplier: 0.35,
                rainbowEnabled: true,
                fireflyShowerCount: 6,
                
                // Performance
                animationFrameSkip: 3,
                useSimpleAnimations: false,
            },
            Ultra: {
                // Sky elements
                cloudCount: 2,
                cloudAnimationEnabled: true,
                
                // Ground elements
                grassBladeCount: 60,
                flowerCount: 12,
                simplifiedFlowers: false,
                
                // Creatures
                butterflyCount: 4,
                beeCount: 1,
                fireflyCount: 5,
                
                // Particles
                pollenCount: 32,
                dandelionSeedCount: 6,
                
                // Effects
                enableComboEffects: true,
                bloomBurstParticles: 10,
                butterflySwarmCount: 4,
                pollenStormMultiplier: 0.5,
                rainbowEnabled: true,
                fireflyShowerCount: 10,
                
                // Performance
                animationFrameSkip: 2,
                useSimpleAnimations: false,
            },
            Extreme: {
                // Sky elements
                cloudCount: 3,
                cloudAnimationEnabled: true,
                
                // Ground elements
                grassBladeCount: 80,
                flowerCount: 14,
                simplifiedFlowers: false,
                
                // Creatures
                butterflyCount: 5,
                beeCount: 2,
                fireflyCount: 7,
                
                // Particles
                pollenCount: 48,
                dandelionSeedCount: 10,
                
                // Effects
                enableComboEffects: true,
                bloomBurstParticles: 14,
                butterflySwarmCount: 5,
                pollenStormMultiplier: 0.8,
                rainbowEnabled: true,
                fireflyShowerCount: 14,
                
                // Performance
                animationFrameSkip: 1,
                useSimpleAnimations: false,
            },
        };
        
        // Active preset reference
        this.activePreset = this.qualityPresets.High;
    }

    /**
     * Get current graphics quality from settings
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    /**
     * Apply a graphics quality preset
     * @param {string} quality - Quality level (Minimal, Low, Medium, High, Ultra, Extreme)
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[MeadowTheme] Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // If scene is active, refresh quality-dependent elements
        if (this.isActive) {
            this.refreshQualityDependentElements();
        }

        console.log(`🌸 [MeadowTheme] Applied ${quality} quality preset`);
    }

    /**
     * Refresh elements that depend on quality settings
     */
    refreshQualityDependentElements() {
        // Clear and recreate grass
        const grassContainer = document.querySelector('.meadow-grass');
        if (grassContainer) {
            grassContainer.innerHTML = '';
            this.createGrass();
        }

        // Clear and recreate flowers
        const flowerContainer = document.getElementById('meadow-flowers');
        if (flowerContainer) {
            flowerContainer.innerHTML = '';
            this.createFlowers();
        }

        // Clear and recreate butterflies
        const butterflyContainer = document.getElementById('meadow-butterflies');
        if (butterflyContainer) {
            butterflyContainer.innerHTML = '';
            this.createButterflies();
        }

        // Clear and recreate pollen
        const pollenContainer = document.getElementById('meadow-pollen');
        if (pollenContainer) {
            pollenContainer.innerHTML = '';
            this.createPollen();
        }

        // Refresh clouds
        const cloudsContainer = document.getElementById('meadow-clouds');
        if (cloudsContainer) {
            cloudsContainer.innerHTML = '';
            this.createClouds();
        }

        // Refresh fireflies
        const fireflyContainer = document.getElementById('meadow-fireflies');
        if (fireflyContainer) {
            fireflyContainer.innerHTML = '';
            this.createFireflies();
        }

        // Refresh bees
        const beeContainer = document.getElementById('meadow-bees');
        if (beeContainer) {
            beeContainer.innerHTML = '';
            this.createBees();
        }

        // Refresh dandelion seeds
        const dandelionContainer = document.getElementById('meadow-dandelion-seeds');
        if (dandelionContainer) {
            dandelionContainer.innerHTML = '';
            this.createDandelionSeeds();
        }
    }

    /**
     * Setup listener for quality setting changes
     */
    setupQualityListener() {
        this.teardownQualityListener();

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    /**
     * Remove quality listener
     */
    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    /**
     * Setup visibility listener to pause animations when tab is hidden
     * This significantly reduces CPU/GPU usage when user is not viewing the page
     */
    setupVisibilityListener() {
        this.teardownVisibilityListener();
        
        this.visibilityHandler = () => {
            const themeContainer = document.getElementById('meadow-theme');
            if (!themeContainer) return;
            
            if (document.hidden) {
                // Pause all animations when tab is hidden
                themeContainer.style.animationPlayState = 'paused';
                themeContainer.classList.add('animations-paused');
            } else {
                // Resume animations when tab is visible
                themeContainer.style.animationPlayState = 'running';
                themeContainer.classList.remove('animations-paused');
            }
        };
        
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    /**
     * Remove visibility listener
     */
    teardownVisibilityListener() {
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    /**
     * Initialize effect pool for reusing DOM elements in combo effects
     * Reduces garbage collection and DOM creation overhead
     */
    initEffectPool() {
        const poolSizes = {
            'bloom-petal': 20,
            'swarm-butterfly': 10,
            'storm-pollen': 30,
            'scatter-petal': 8,
            'shower-firefly': 15,
        };

        for (const [type, size] of Object.entries(poolSizes)) {
            const pool = [];
            for (let i = 0; i < size; i++) {
                const el = document.createElement('div');
                el.className = type;
                el.style.display = 'none';
                pool.push(el);
            }
            this.effectPool.set(type, { elements: pool, index: 0 });
        }
    }

    /**
     * Get an element from the pool (or create new if pool exhausted)
     */
    getPooledElement(type) {
        const pool = this.effectPool.get(type);
        if (!pool) {
            const el = document.createElement('div');
            el.className = type;
            return el;
        }

        const el = pool.elements[pool.index];
        pool.index = (pool.index + 1) % pool.elements.length;
        el.style.display = '';
        return el;
    }

    /**
     * Return element to pool (hide it)
     */
    returnToPool(el) {
        el.style.display = 'none';
        // Reset any inline styles that were set
        el.style.left = '';
        el.style.top = '';
        el.style.transform = '';
    }

    async createScene() {
        // Apply quality preset at scene creation
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();
        this.setupVisibilityListener();

        // Create atmospheric elements
        this.createSun();
        this.createClouds();
        
        // Create ground elements
        this.createGrass();
        this.createFlowers();
        
        // Create creatures
        this.createButterflies();
        this.createBees();
        this.createFireflies();
        
        // Create particles
        this.createPollen();
        this.createDandelionSeeds();
        
        // Pre-populate effect pool for combo effects
        this.initEffectPool();
        
        // Setup event listeners for combo effects
        this.setupEventListeners();
        
        // Start animation loop
        this.startAnimation();
    }

    /**
     * Create the warm sun with glow (no rays)
     */
    createSun() {
        const sunContainer = document.getElementById('meadow-sun');
        if (!sunContainer) return;
        
        // Clear existing content
        sunContainer.innerHTML = '';
        
        // Sun core
        const sunCore = document.createElement('div');
        sunCore.className = 'sun-core';
        sunContainer.appendChild(sunCore);
        
        // Sun glow layers
        const sunGlow1 = document.createElement('div');
        sunGlow1.className = 'sun-glow sun-glow-1';
        sunContainer.appendChild(sunGlow1);
        
        const sunGlow2 = document.createElement('div');
        sunGlow2.className = 'sun-glow sun-glow-2';
        sunContainer.appendChild(sunGlow2);
        
        this.registerContainer(sunContainer);
    }

    /**
     * Create drifting clouds
     */
    createClouds() {
        const container = document.getElementById('meadow-clouds');
        if (!container) return;

        const preset = this.activePreset;
        const cloudCount = preset.cloudCount;
        
        if (cloudCount === 0) return;
        
        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'meadow-cloud';
            
            // Varied cloud sizes and shapes
            const scale = 0.5 + Math.random() * 1.2;
            const top = 5 + Math.random() * 25;
            const opacity = 0.4 + Math.random() * 0.4;
            const duration = 80 + Math.random() * 60;
            
            cloud.style.setProperty('--cloud-scale', scale);
            cloud.style.top = `${top}%`;
            cloud.style.opacity = opacity;
            cloud.style.animationDuration = `${duration}s`;
            cloud.style.animationDelay = `-${Math.random() * duration}s`;
            
            if (!preset.cloudAnimationEnabled) {
                cloud.style.animation = 'none';
                cloud.style.left = `${Math.random() * 100}%`;
            }
            
            // Create cloud puffs
            const puffCount = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < puffCount; j++) {
                const puff = document.createElement('div');
                puff.className = 'cloud-puff';
                puff.style.setProperty('--puff-index', j);
                cloud.appendChild(puff);
            }
            
            container.appendChild(cloud);
        }
        
        this.registerContainer(container);
    }

    /**
     * Create swaying grass blades (optimized with batching and CSS classes)
     */
    createGrass() {
        const grassContainer = document.querySelector('.meadow-grass');
        if (!grassContainer) return;

        const preset = this.activePreset;
        const bladeCount = preset.grassBladeCount;
        
        // Use DocumentFragment for batch DOM insertion
        const fragment = document.createDocumentFragment();
        
        // Pre-define grass color variants (reduces style recalculations)
        const grassColors = [
            'linear-gradient(to top, hsl(95, 45%, 28%), hsl(105, 50%, 45%))',
            'linear-gradient(to top, hsl(100, 45%, 30%), hsl(110, 50%, 48%))',
            'linear-gradient(to top, hsl(90, 45%, 32%), hsl(100, 50%, 50%))',
            'linear-gradient(to top, hsl(105, 45%, 26%), hsl(115, 50%, 42%))',
            'linear-gradient(to top, hsl(92, 48%, 25%), hsl(102, 52%, 40%))',
            'linear-gradient(to top, hsl(98, 42%, 33%), hsl(108, 48%, 52%))',
        ];
        
        // Height classes with more variety (6 height tiers)
        const heightClasses = ['grass-xs', 'grass-sm', 'grass-md', 'grass-lg', 'grass-xl', 'grass-xxl'];
        
        // Pre-define animation delay groups (12 groups for organic wave effect)
        const delayGroups = 12;
        
        for (let i = 0; i < bladeCount; i++) {
            const blade = document.createElement('div');
            blade.className = 'grass-blade';
            
            // Random positioning with slight clustering
            blade.style.left = `${Math.random() * 100}%`;
            
            // Varied heights using 6 classes (weighted toward medium heights)
            const heightRoll = Math.random();
            let heightIndex;
            if (heightRoll < 0.1) heightIndex = 0;        // 10% very short
            else if (heightRoll < 0.25) heightIndex = 1;  // 15% short
            else if (heightRoll < 0.5) heightIndex = 2;   // 25% medium-short
            else if (heightRoll < 0.75) heightIndex = 3;  // 25% medium-tall
            else if (heightRoll < 0.9) heightIndex = 4;   // 15% tall
            else heightIndex = 5;                          // 10% very tall
            
            blade.classList.add(heightClasses[heightIndex]);
            
            // Use pre-defined colors (6 variants)
            blade.style.background = grassColors[i % grassColors.length];
            
            // Group animation delays for wave-like swaying effect
            const delayGroup = i % delayGroups;
            blade.style.animationDelay = `-${delayGroup * 0.5}s`;
            
            fragment.appendChild(blade);
        }
        
        grassContainer.appendChild(fragment);
        this.registerContainer(grassContainer);
    }

    /**
     * Create colorful wildflowers (optimized for quality presets)
     */
    createFlowers() {
        const flowerContainer = document.getElementById('meadow-flowers');
        if (!flowerContainer) return;

        const preset = this.activePreset;
        const flowerCount = preset.flowerCount;
        const simplified = preset.simplifiedFlowers;
        
        // Simplified flower types for low quality (fewer petals)
        const simpleFlowerTypes = [
            { name: 'poppy', colors: ['#e53935', '#ff5252'], petalCount: 3 },
            { name: 'daisy', colors: ['#fff'], petalCount: 6, center: '#fdd835' },
            { name: 'buttercup', colors: ['#fdd835', '#ffeb3b'], petalCount: 4 },
        ];
        
        const fullFlowerTypes = [
            { name: 'poppy', colors: ['#e53935', '#ff5252', '#d32f2f'], petalCount: 4 },
            { name: 'daisy', colors: ['#fff', '#fafafa'], petalCount: 12, center: '#fdd835' },
            { name: 'lavender', colors: ['#9c27b0', '#ab47bc', '#8e24aa'], petalCount: 6 },
            { name: 'buttercup', colors: ['#fdd835', '#ffeb3b', '#fbc02d'], petalCount: 5 },
            { name: 'cornflower', colors: ['#1976d2', '#2196f3', '#1565c0'], petalCount: 8 },
            { name: 'clover', colors: ['#ff8a80', '#ff5252', '#ff1744'], petalCount: 3 },
        ];
        
        const flowerTypes = simplified ? simpleFlowerTypes : fullFlowerTypes;
        
        // Use DocumentFragment for batch DOM insertion (performance)
        const fragment = document.createDocumentFragment();
        
        for (let i = 0; i < flowerCount; i++) {
            const flower = document.createElement('div');
            flower.className = 'meadow-flower';
            
            const type = flowerTypes[Math.floor(Math.random() * flowerTypes.length)];
            flower.classList.add(`flower-${type.name}`);
            
            // Create flower head
            const head = document.createElement('div');
            head.className = 'flower-head';
            
            // Create petals
            for (let p = 0; p < type.petalCount; p++) {
                const petal = document.createElement('div');
                petal.className = 'flower-petal';
                const angle = (p / type.petalCount) * 360;
                const color = type.colors[Math.floor(Math.random() * type.colors.length)];
                petal.style.setProperty('--petal-angle', `${angle}deg`);
                petal.style.setProperty('--petal-color', color);
                head.appendChild(petal);
            }
            
            // Create center
            const center = document.createElement('div');
            center.className = 'flower-center';
            if (type.center) {
                center.style.background = type.center;
            }
            head.appendChild(center);
            
            // Create stem
            const stem = document.createElement('div');
            stem.className = 'flower-stem';
            
            flower.appendChild(head);
            flower.appendChild(stem);
            
            // Position
            flower.style.left = `${5 + Math.random() * 90}%`;
            flower.style.bottom = `${Math.random() * 15}%`;
            
            // Size variation
            const scale = 0.6 + Math.random() * 0.8;
            flower.style.setProperty('--flower-scale', scale);
            
            // Animation (slower for low quality to reduce repaints)
            const bobDuration = simplified ? (10 + Math.random() * 8) : (6 + Math.random() * 6);
            flower.style.animationDuration = `${bobDuration}s`;
            flower.style.animationDelay = `-${Math.random() * bobDuration}s`;
            
            fragment.appendChild(flower);
        }
        
        flowerContainer.appendChild(fragment);
        this.registerContainer(flowerContainer);
    }

    /**
     * Create dancing butterflies with varied colors
     */
    createButterflies() {
        const butterflyContainer = document.getElementById('meadow-butterflies');
        if (!butterflyContainer) return;

        const preset = this.activePreset;
        const butterflyCount = preset.butterflyCount;
        
        // Diverse butterfly wing patterns inspired by real species
        const wingPatterns = [
            // Monarch - orange and black
            { primary: '#ff8c00', secondary: '#ffa500', accent: '#1a1a1a' },
            // Swallowtail - yellow and black
            { primary: '#ffd700', secondary: '#ffec8b', accent: '#2f2f2f' },
            // Blue Morpho - iridescent blue
            { primary: '#1e90ff', secondary: '#00bfff', accent: '#191970' },
            // Painted Lady - salmon and brown
            { primary: '#fa8072', secondary: '#ffc0cb', accent: '#8b4513' },
            // Red Admiral - red and black
            { primary: '#dc143c', secondary: '#ff6347', accent: '#2d2d2d' },
            // Peacock - deep purple with eyespots
            { primary: '#9932cc', secondary: '#da70d6', accent: '#4b0082' },
            // Cabbage White - pale cream
            { primary: '#fffaf0', secondary: '#fff8dc', accent: '#808080' },
            // Clouded Yellow - bright yellow
            { primary: '#ffd900', secondary: '#fff44f', accent: '#cc7000' },
            // Common Blue - soft blue
            { primary: '#6495ed', secondary: '#87ceeb', accent: '#483d8b' },
            // Comma - orange-brown with ragged edges
            { primary: '#d2691e', secondary: '#f4a460', accent: '#5c4033' },
            // Purple Emperor - royal purple
            { primary: '#663399', secondary: '#9370db', accent: '#301934' },
            // Small Tortoiseshell - fiery orange
            { primary: '#ff4500', secondary: '#ff7f50', accent: '#1c1c1c' },
            // Brimstone - lemon yellow
            { primary: '#fffacd', secondary: '#f0e68c', accent: '#9acd32' },
            // Holly Blue - silvery blue
            { primary: '#b0c4de', secondary: '#add8e6', accent: '#4169e1' },
            // Meadow Brown - earthy brown
            { primary: '#a0522d', secondary: '#cd853f', accent: '#3e2723' },
        ];
        
        for (let i = 0; i < butterflyCount; i++) {
            const butterfly = document.createElement('div');
            butterfly.className = 'butterfly';
            
            // Each butterfly gets a unique random pattern
            const pattern = wingPatterns[Math.floor(Math.random() * wingPatterns.length)];
            
            // Create wings
            const wingLeft = document.createElement('div');
            wingLeft.className = 'butterfly-wing left';
            wingLeft.style.setProperty('--wing-primary', pattern.primary);
            wingLeft.style.setProperty('--wing-secondary', pattern.secondary);
            wingLeft.style.setProperty('--wing-accent', pattern.accent);
            
            const wingRight = document.createElement('div');
            wingRight.className = 'butterfly-wing right';
            wingRight.style.setProperty('--wing-primary', pattern.primary);
            wingRight.style.setProperty('--wing-secondary', pattern.secondary);
            wingRight.style.setProperty('--wing-accent', pattern.accent);
            
            // Create body
            const body = document.createElement('div');
            body.className = 'butterfly-body';
            
            butterfly.appendChild(wingLeft);
            butterfly.appendChild(body);
            butterfly.appendChild(wingRight);
            
            // Flight path waypoints
            for (let j = 1; j <= 8; j++) {
                butterfly.style.setProperty(`--x${j}`, `${Math.random() * 90}vw`);
                butterfly.style.setProperty(`--y${j}`, `${10 + Math.random() * 60}vh`);
            }
            
            // Animation timing
            const duration = 15 + Math.random() * 15;
            butterfly.style.animationDuration = `${duration}s`;
            butterfly.style.animationDelay = `-${Math.random() * duration}s`;
            
            // Wing flap speed
            const flapSpeed = 0.2 + Math.random() * 0.3;
            wingLeft.style.animationDuration = `${flapSpeed}s`;
            wingRight.style.animationDuration = `${flapSpeed}s`;
            
            // Size variation
            const scale = 0.7 + Math.random() * 0.6;
            butterfly.style.setProperty('--butterfly-scale', scale);
            
            butterflyContainer.appendChild(butterfly);
        }
        
        this.registerContainer(butterflyContainer);
    }

    /**
     * Create buzzing bees
     */
    createBees() {
        const container = document.getElementById('meadow-bees');
        if (!container) return;

        const preset = this.activePreset;
        const beeCount = preset.beeCount;
        
        if (beeCount === 0) return;
        
        for (let i = 0; i < beeCount; i++) {
            const bee = document.createElement('div');
            bee.className = 'meadow-bee';
            
            // Create bee body parts
            const body = document.createElement('div');
            body.className = 'bee-body';
            
            const wingLeft = document.createElement('div');
            wingLeft.className = 'bee-wing left';
            
            const wingRight = document.createElement('div');
            wingRight.className = 'bee-wing right';
            
            bee.appendChild(wingLeft);
            bee.appendChild(body);
            bee.appendChild(wingRight);
            
            // Flight path (zig-zag pattern)
            for (let j = 1; j <= 6; j++) {
                bee.style.setProperty(`--bx${j}`, `${Math.random() * 80 + 10}vw`);
                bee.style.setProperty(`--by${j}`, `${20 + Math.random() * 50}vh`);
            }
            
            // Animation
            const duration = 20 + Math.random() * 15;
            bee.style.animationDuration = `${duration}s`;
            bee.style.animationDelay = `-${Math.random() * duration}s`;
            
            container.appendChild(bee);
        }
        
        this.registerContainer(container);
    }

    /**
     * Create magical fireflies
     */
    createFireflies() {
        const container = document.getElementById('meadow-fireflies');
        if (!container) return;

        const preset = this.activePreset;
        const fireflyCount = preset.fireflyCount;
        
        if (fireflyCount === 0) return;
        
        for (let i = 0; i < fireflyCount; i++) {
            const firefly = document.createElement('div');
            firefly.className = 'meadow-firefly';
            
            // Position
            firefly.style.left = `${Math.random() * 100}%`;
            firefly.style.top = `${20 + Math.random() * 60}%`;
            
            // Glow color variation
            const hue = 50 + Math.random() * 30; // Yellow to green
            firefly.style.setProperty('--firefly-hue', hue);
            
            // Animation timing
            const glowDuration = 2 + Math.random() * 3;
            const driftDuration = 15 + Math.random() * 20;
            firefly.style.setProperty('--glow-duration', `${glowDuration}s`);
            firefly.style.setProperty('--drift-duration', `${driftDuration}s`);
            firefly.style.animationDelay = `-${Math.random() * glowDuration}s`;
            
            // Drift path
            firefly.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 100}px`);
            firefly.style.setProperty('--drift-y', `${(Math.random() - 0.5) * 80}px`);
            
            container.appendChild(firefly);
        }
        
        this.registerContainer(container);
    }

    /**
     * Create floating pollen particles (optimized with batching)
     */
    createPollen() {
        const pollenContainer = document.getElementById('meadow-pollen');
        if (!pollenContainer) return;

        const preset = this.activePreset;
        const pollenCount = preset.pollenCount;
        
        // Use DocumentFragment for batch DOM insertion
        const fragment = document.createDocumentFragment();
        
        // Pre-define pollen path variants (reduces unique CSS variable assignments)
        const pathVariants = 6;
        const sizeClasses = ['pollen-small', 'pollen-medium', 'pollen-large'];
        
        for (let i = 0; i < pollenCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'pollen-particle';
            
            // Use path variant groups instead of unique paths per particle
            const variant = i % pathVariants;
            particle.classList.add(`pollen-path-${variant}`);
            
            // Size class instead of inline size
            particle.classList.add(sizeClasses[i % 3]);
            
            // Stagger start positions across screen width
            particle.style.setProperty('--x-start', `${(i / pollenCount) * 100}vw`);
            
            // Group animation delays (10 groups)
            const delayGroup = i % 10;
            particle.style.animationDelay = `-${delayGroup * 1.2}s`;
            
            fragment.appendChild(particle);
        }
        
        pollenContainer.appendChild(fragment);
        this.registerContainer(pollenContainer);
    }

    /**
     * Create floating dandelion seeds
     */
    createDandelionSeeds() {
        const container = document.getElementById('meadow-dandelion-seeds');
        if (!container) return;

        const preset = this.activePreset;
        const seedCount = preset.dandelionSeedCount;
        
        if (seedCount === 0) return;
        
        for (let i = 0; i < seedCount; i++) {
            const seed = document.createElement('div');
            seed.className = 'dandelion-seed';
            
            // Create seed structure
            const tuft = document.createElement('div');
            tuft.className = 'seed-tuft';
            
            const stem = document.createElement('div');
            stem.className = 'seed-stem';
            
            seed.appendChild(tuft);
            seed.appendChild(stem);
            
            // Position and path
            seed.style.left = `${Math.random() * 100}%`;
            seed.style.top = `${70 + Math.random() * 30}%`;
            
            // Float path
            seed.style.setProperty('--float-x', `${(Math.random() - 0.5) * 200}px`);
            seed.style.setProperty('--float-y', `${-100 - Math.random() * 200}px`);
            seed.style.setProperty('--rotate', `${Math.random() * 360}deg`);
            
            // Animation
            const duration = 20 + Math.random() * 20;
            seed.style.animationDuration = `${duration}s`;
            seed.style.animationDelay = `-${Math.random() * duration}s`;
            
            container.appendChild(seed);
        }
        
        this.registerContainer(container);
    }

    /**
     * Setup game event listeners for combo effects
     */
    setupEventListeners() {
        // Line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        // Combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        // Piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    /**
     * Handle line clear with meadow effects
     */
    onLineClear(lineCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (lineCount >= 4) {
            // Tetris! Epic rainbow and flower explosion
            this.triggerRainbow();
            this.triggerFlowerBloom(8);
            this.triggerButterflySwarm(12);
            this.pulseGrass(1.5);
            this.triggerPollenBurst();
        } else if (lineCount >= 2) {
            // Multi-line: flower burst
            this.triggerFlowerBloom(lineCount * 2);
            this.triggerButterflySwarm(lineCount * 3);
            this.pulseGrass(1.2);
        } else {
            // Single line: subtle petal scatter
            this.triggerPetalScatter();
            this.pulseGrass(1.05);
        }
    }

    /**
     * Handle combo with escalating effects
     */
    onCombo(comboCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (comboCount >= 8) {
            // Epic combo: Full meadow celebration
            this.triggerRainbow();
            this.triggerPollenStorm();
            this.triggerFireflyShower();
            this.triggerButterflySwarm(16);
        } else if (comboCount >= 5) {
            // High combo: Pollen storm + butterflies
            this.triggerPollenStorm();
            this.triggerButterflySwarm(comboCount);
            this.triggerFlowerBloom(4);
        } else if (comboCount >= 3) {
            // Medium combo: Firefly shower
            this.triggerFireflyShower();
            this.triggerFlowerBloom(2);
            this.pulseGrass(1.3);
        } else {
            // Low combo: Gentle effects
            this.triggerPetalScatter();
            this.pulseGrass(1.1);
        }
    }

    /**
     * Handle piece lock with subtle meadow effects
     */
    onPieceLock() {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;
        
        // Subtle grass sway
        this.pulseGrass(1.02);
        
        // Small chance for extra visual feedback
        const roll = Math.random();
        if (roll < 0.3) {
            // 30% chance: tiny sparkle
            this.triggerPieceLockSparkle();
        } else if (roll < 0.45) {
            // 15% chance: single petal float
            this.triggerSinglePetal();
        }
    }

    /**
     * Get a position in the edges of the screen (avoiding center)
     */
    getEdgePosition(zone = 'any') {
        const regions = {
            topLeft: { xMin: 0, xMax: 25, yMin: 0, yMax: 30 },
            topRight: { xMin: 75, xMax: 100, yMin: 0, yMax: 30 },
            bottomLeft: { xMin: 0, xMax: 25, yMin: 70, yMax: 95 },
            bottomRight: { xMin: 75, xMax: 100, yMin: 70, yMax: 95 },
            leftSide: { xMin: 0, xMax: 20, yMin: 20, yMax: 80 },
            rightSide: { xMin: 80, xMax: 100, yMin: 20, yMax: 80 },
            topEdge: { xMin: 20, xMax: 80, yMin: 0, yMax: 15 },
            bottomEdge: { xMin: 20, xMax: 80, yMin: 85, yMax: 100 },
        };

        let availableRegions;
        
        switch (zone) {
            case 'corner':
                availableRegions = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
                break;
            case 'edge':
                availableRegions = ['topEdge', 'bottomEdge'];
                break;
            case 'side':
                availableRegions = ['leftSide', 'rightSide'];
                break;
            case 'bottom':
                availableRegions = ['bottomLeft', 'bottomRight', 'bottomEdge'];
                break;
            default:
                availableRegions = Object.keys(regions);
        }

        const regionName = availableRegions[Math.floor(Math.random() * availableRegions.length)];
        const region = regions[regionName];

        return {
            x: region.xMin + Math.random() * (region.xMax - region.xMin),
            y: region.yMin + Math.random() * (region.yMax - region.yMin),
        };
    }

    /**
     * Trigger a flower bloom burst effect
     */
    triggerFlowerBloom(count = 4) {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.bloomBurstParticles === 0) return;

        const actualCount = Math.min(count, Math.ceil(preset.bloomBurstParticles / 2));
        const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#9d4edd', '#ff8fab'];
        
        for (let i = 0; i < actualCount; i++) {
            setTimeout(() => {
                const bloom = document.createElement('div');
                bloom.className = 'flower-bloom-burst';
                
                const pos = this.getEdgePosition('bottom');
                bloom.style.left = `${pos.x}%`;
                bloom.style.top = `${pos.y}%`;
                
                // Create petals
                const petalCount = 5 + Math.floor(Math.random() * 4);
                const color = colors[Math.floor(Math.random() * colors.length)];
                
                for (let p = 0; p < petalCount; p++) {
                    const petal = document.createElement('div');
                    petal.className = 'bloom-petal';
                    const angle = (p / petalCount) * Math.PI * 2;
                    petal.style.setProperty('--petal-angle', `${angle}rad`);
                    petal.style.setProperty('--petal-distance', `${50 + Math.random() * 80}px`);
                    petal.style.setProperty('--petal-color', color);
                    petal.style.animationDelay = `${Math.random() * 100}ms`;
                    bloom.appendChild(petal);
                }
                
                // Center burst
                const center = document.createElement('div');
                center.className = 'bloom-center';
                center.style.background = color;
                bloom.appendChild(center);
                
                effectsContainer.appendChild(bloom);
                setTimeout(() => bloom.remove(), 1500);
            }, i * 100);
        }
    }

    /**
     * Trigger butterfly swarm effect
     */
    triggerButterflySwarm(count = 5) {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.butterflySwarmCount === 0) return;

        const actualCount = Math.min(count, preset.butterflySwarmCount);
        
        for (let i = 0; i < actualCount; i++) {
            setTimeout(() => {
                const butterfly = document.createElement('div');
                butterfly.className = 'swarm-butterfly';
                
                // Start from bottom corners
                const startX = Math.random() > 0.5 ? 5 + Math.random() * 20 : 75 + Math.random() * 20;
                const startY = 80 + Math.random() * 15;
                
                butterfly.style.left = `${startX}%`;
                butterfly.style.top = `${startY}%`;
                
                // Flight direction
                const endX = 30 + Math.random() * 40;
                const endY = -10 - Math.random() * 20;
                butterfly.style.setProperty('--fly-x', `${endX - startX}vw`);
                butterfly.style.setProperty('--fly-y', `${endY}vh`);
                
                // Color
                const hues = [30, 280, 200, 120, 340];
                const hue = hues[Math.floor(Math.random() * hues.length)];
                butterfly.style.setProperty('--wing-hue', hue);
                
                effectsContainer.appendChild(butterfly);
                setTimeout(() => butterfly.remove(), 2500);
            }, i * 80);
        }
    }

    /**
     * Trigger pollen storm effect
     */
    triggerPollenStorm() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.pollenStormMultiplier === 0) return;

        const stormContainer = document.createElement('div');
        stormContainer.className = 'pollen-storm';
        effectsContainer.appendChild(stormContainer);

        const particleCount = Math.floor(40 * preset.pollenStormMultiplier);
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'storm-pollen';
            
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
            particle.style.setProperty('--storm-x', `${(Math.random() - 0.5) * 100}px`);
            particle.style.setProperty('--storm-y', `${(Math.random() - 0.5) * 100}px`);
            particle.style.animationDelay = `${Math.random() * 300}ms`;
            
            stormContainer.appendChild(particle);
        }
        
        setTimeout(() => stormContainer.remove(), 2000);
    }

    /**
     * Trigger rainbow arc effect
     */
    triggerRainbow() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (!preset.rainbowEnabled) return;

        const rainbow = document.createElement('div');
        rainbow.className = 'meadow-rainbow';
        
        effectsContainer.appendChild(rainbow);
        setTimeout(() => rainbow.remove(), 3000);
    }

    /**
     * Trigger firefly shower effect
     */
    triggerFireflyShower() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.fireflyShowerCount === 0) return;

        const count = preset.fireflyShowerCount;
        
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const firefly = document.createElement('div');
                firefly.className = 'shower-firefly';
                
                const pos = this.getEdgePosition('any');
                firefly.style.left = `${pos.x}%`;
                firefly.style.top = `${pos.y}%`;
                
                firefly.style.setProperty('--glow-hue', 50 + Math.random() * 30);
                
                effectsContainer.appendChild(firefly);
                setTimeout(() => firefly.remove(), 2000);
            }, i * 50);
        }
    }

    /**
     * Trigger petal scatter effect
     */
    triggerPetalScatter() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const petalCount = 5;
        const colors = ['#ffb6c1', '#ffc0cb', '#ff69b4', '#fff0f5', '#ffebee'];
        
        for (let i = 0; i < petalCount; i++) {
            const petal = document.createElement('div');
            petal.className = 'scatter-petal';
            
            const pos = this.getEdgePosition('bottom');
            petal.style.left = `${pos.x}%`;
            petal.style.top = `${pos.y}%`;
            
            petal.style.setProperty('--scatter-x', `${(Math.random() - 0.5) * 150}px`);
            petal.style.setProperty('--scatter-y', `${-50 - Math.random() * 100}px`);
            petal.style.setProperty('--scatter-rotate', `${Math.random() * 720}deg`);
            petal.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            petal.style.animationDelay = `${i * 50}ms`;
            
            effectsContainer.appendChild(petal);
            setTimeout(() => petal.remove(), 1500);
        }
    }

    /**
     * Trigger pollen burst effect
     */
    triggerPollenBurst() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const burstCount = 3;
        
        for (let i = 0; i < burstCount; i++) {
            const burst = document.createElement('div');
            burst.className = 'pollen-burst';
            
            const pos = this.getEdgePosition('any');
            burst.style.left = `${pos.x}%`;
            burst.style.top = `${pos.y}%`;
            
            for (let j = 0; j < 12; j++) {
                const particle = document.createElement('div');
                particle.className = 'burst-particle';
                const angle = (j / 12) * Math.PI * 2;
                particle.style.setProperty('--burst-angle', `${angle}rad`);
                particle.style.setProperty('--burst-distance', `${40 + Math.random() * 60}px`);
                burst.appendChild(particle);
            }
            
            effectsContainer.appendChild(burst);
            setTimeout(() => burst.remove(), 1000);
        }
    }

    /**
     * Trigger piece lock sparkle
     */
    triggerPieceLockSparkle() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const sparkle = document.createElement('div');
        sparkle.className = 'lock-sparkle';
        
        const pos = this.getEdgePosition('any');
        sparkle.style.left = `${pos.x}%`;
        sparkle.style.top = `${pos.y}%`;
        
        effectsContainer.appendChild(sparkle);
        setTimeout(() => sparkle.remove(), 600);
    }

    /**
     * Trigger single petal float
     */
    triggerSinglePetal() {
        const effectsContainer = document.getElementById('meadow-effects');
        if (!effectsContainer) return;

        const petal = document.createElement('div');
        petal.className = 'single-petal';
        
        petal.style.left = `${10 + Math.random() * 80}%`;
        petal.style.top = `${60 + Math.random() * 30}%`;
        petal.style.setProperty('--float-x', `${(Math.random() - 0.5) * 80}px`);
        petal.style.setProperty('--float-y', `-${60 + Math.random() * 80}px`);
        
        const colors = ['#ffb6c1', '#fff0f5', '#ffe4e1'];
        petal.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        
        effectsContainer.appendChild(petal);
        setTimeout(() => petal.remove(), 2000);
    }

    /**
     * Pulse the grass
     */
    pulseGrass(intensity = 1.1) {
        const grassContainer = document.querySelector('.meadow-grass');
        if (!grassContainer) return;
        
        grassContainer.style.transition = 'transform 200ms ease-out';
        grassContainer.style.transform = `scaleY(${intensity})`;
        
        setTimeout(() => {
            grassContainer.style.transition = 'transform 600ms ease-in';
            grassContainer.style.transform = '';
        }, 200);
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        let frameCount = 0;
        
        const animate = (currentTime) => {
            if (!this.isActive) return;

            frameCount++;
            const preset = this.activePreset;
            
            // Frame skipping for performance
            if (preset.animationFrameSkip > 0 && frameCount % (preset.animationFrameSkip + 1) !== 0) {
                this.animationFrameId = requestAnimationFrame(animate);
                this.registerAnimation(this.animationFrameId);
                return;
            }

            if (this.lastTime === 0) {
                this.lastTime = currentTime;
            }

            const deltaTime = (currentTime - this.lastTime) / 1000;
            this.lastTime = currentTime;

            this.update(deltaTime);

            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);
        };

        this.lastTime = 0;
        this.animationFrameId = requestAnimationFrame(animate);
        this.registerAnimation(this.animationFrameId);
    }

    /**
     * Update method called each frame
     */
    update(deltaTime) {
        // Placeholder for any per-frame updates
    }

    /**
     * Provide Meadow themed tetromino styling
     * @returns {Object} Meadow tetromino configuration
     */
    getTetrominoConfig() {
        return MEADOW_TETROMINOS;
    }

    /**
     * Stop the theme
     */
    stop() {
        if (!this.isActive) return;

        // Unsubscribe from events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Remove quality listener
        this.teardownQualityListener();
        
        // Remove visibility listener
        this.teardownVisibilityListener();

        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        super.stop();
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.stop();
        
        // Clear effect pool
        this.effectPool.clear();
        
        super.cleanup();
    }
}

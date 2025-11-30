import { BaseTheme } from '../base-theme.js';
import { DESERT_OASIS_TETROMINOS } from './desert-oasis-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Desert Oasis Theme - Enchanted Desert Night
 * 
 * A breathtaking desert scene at twilight featuring:
 * - Deep purple-blue sky with aurora-like lights
 * - Luminous crescent moon with ethereal glow
 * - Distant mountain silhouettes
 * - Elegant SVG palm tree silhouettes
 * - Shimmering oasis water pool
 * - Floating paper lanterns
 * - Oasis vegetation (reeds, grasses)
 * - Gentle sand particle drift
 * 
 * Theme-integrated combo effects:
 * - Sand swirl vortexes
 * - Water ripple reflections  
 * - Lantern bursts
 * - Moonbeam rays
 * - Desert wind gusts
 */
export default class DesertOasisTheme extends BaseTheme {
    constructor() {
        super('desert-oasis');
        this.eventUnsubscribers = [];
        this.shootingStarTimeout = null;
        
        // Performance tracking
        this.activeEffectCount = 0;
        this.maxActiveEffects = 15;
        this.lastEffectTime = 0;
        this.effectCooldown = 100;
        
        // Quality presets
        this.qualityChangeHandler = null;
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                starCount: 50,
                sandParticleCount: 8,
                lanternCount: 2,
                palmCount: 3,
                reedCount: 0,
                enableComboEffects: false,
                sandSwirlCount: 0,
                waterRippleCount: 0,
                lanternBurstCount: 0,
                moonbeamCount: 0,
                maxActiveEffects: 5,
            },
            Low: {
                starCount: 70,
                sandParticleCount: 12,
                lanternCount: 4,
                palmCount: 4,
                reedCount: 8,
                enableComboEffects: true,
                sandSwirlCount: 2,
                waterRippleCount: 2,
                lanternBurstCount: 3,
                moonbeamCount: 1,
                maxActiveEffects: 8,
            },
            Medium: {
                starCount: 90,
                sandParticleCount: 20,
                lanternCount: 6,
                palmCount: 5,
                reedCount: 12,
                enableComboEffects: true,
                sandSwirlCount: 3,
                waterRippleCount: 3,
                lanternBurstCount: 5,
                moonbeamCount: 2,
                maxActiveEffects: 12,
            },
            High: {
                starCount: 120,
                sandParticleCount: 30,
                lanternCount: 8,
                palmCount: 6,
                reedCount: 18,
                enableComboEffects: true,
                sandSwirlCount: 4,
                waterRippleCount: 4,
                lanternBurstCount: 7,
                moonbeamCount: 3,
                maxActiveEffects: 15,
            },
            Ultra: {
                starCount: 150,
                sandParticleCount: 40,
                lanternCount: 12,
                palmCount: 7,
                reedCount: 25,
                enableComboEffects: true,
                sandSwirlCount: 5,
                waterRippleCount: 5,
                lanternBurstCount: 10,
                moonbeamCount: 4,
                maxActiveEffects: 20,
            },
            Extreme: {
                starCount: 200,
                sandParticleCount: 50,
                lanternCount: 16,
                palmCount: 8,
                reedCount: 35,
                enableComboEffects: true,
                sandSwirlCount: 6,
                waterRippleCount: 6,
                lanternBurstCount: 14,
                moonbeamCount: 5,
                maxActiveEffects: 25,
            },
        };
        
        this.activePreset = this.qualityPresets.High;
        this.lanternElements = [];
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            quality = 'High';
        }
        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        this.maxActiveEffects = this.activePreset.maxActiveEffects;

        if (this.isActive) {
            this.refreshQualityDependentElements();
        }
        console.log(`🏜️ [DesertOasisTheme] Applied ${quality} quality preset`);
    }

    refreshQualityDependentElements() {
        // Recreate stars
        const starsContainer = document.getElementById('desert-stars');
        if (starsContainer) {
            starsContainer.innerHTML = '';
            this.createStars();
        }

        // Recreate sand particles
        const sandContainer = document.getElementById('desert-sand-particles');
        if (sandContainer) {
            sandContainer.innerHTML = '';
            this.createSandParticles();
        }

        // Recreate lanterns
        const lanternContainer = document.getElementById('desert-lanterns');
        if (lanternContainer) {
            lanternContainer.innerHTML = '';
            this.lanternElements = [];
            this.createLanterns();
        }

        // Recreate palms
        const palmContainer = document.getElementById('desert-palms');
        if (palmContainer) {
            palmContainer.innerHTML = '';
            this.createPalmTrees();
        }

        // Recreate vegetation
        const vegContainer = document.getElementById('desert-vegetation');
        if (vegContainer) {
            vegContainer.innerHTML = '';
            this.createVegetation();
        }
    }

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;
            this.applyQualityPreset(newQuality);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        this.createStars();
        this.createMoon();
        this.createSandParticles();
        this.createPalmTrees();
        this.createLanterns();
        this.createVegetation();
        this.createOasisWater();
        this.startShootingStars();
        this.setupEventListeners();
    }

    createStars() {
        const starsContainer = document.getElementById('desert-stars');
        if (!starsContainer) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < preset.starCount; i++) {
            const star = document.createElement('div');
            star.className = 'oasis-star';
            
            const size = Math.random() * 2.5 + 0.5;
            const isColoredStar = Math.random() < 0.12;
            
            star.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 50}%;
                --twinkle-delay: ${Math.random() * 5}s;
                --twinkle-duration: ${2.5 + Math.random() * 3}s;
            `;
            
            if (isColoredStar) {
                const colors = ['#ffecd0', '#d0e8ff', '#ffe8cc', '#e0d0ff'];
                star.style.setProperty('--star-color', colors[Math.floor(Math.random() * colors.length)]);
                star.classList.add('colored-star');
            }
            
            fragment.appendChild(star);
        }

        starsContainer.appendChild(fragment);
        this.registerContainer(starsContainer);
    }

    createMoon() {
        const moonContainer = document.getElementById('desert-moon');
        if (!moonContainer || moonContainer.children.length > 0) return;

        const moon = document.createElement('div');
        moon.className = 'oasis-moon';
        
        const innerGlow = document.createElement('div');
        innerGlow.className = 'moon-inner-glow';
        
        const outerGlow = document.createElement('div');
        outerGlow.className = 'moon-outer-glow';
        
        moonContainer.appendChild(outerGlow);
        moonContainer.appendChild(innerGlow);
        moonContainer.appendChild(moon);
        
        this.registerContainer(moonContainer);
    }

    createSandParticles() {
        const sandContainer = document.getElementById('desert-sand-particles');
        if (!sandContainer) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < preset.sandParticleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'oasis-sand-particle';
            
            const size = Math.random() * 2 + 1;
            particle.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                --start-x: ${Math.random() * 100}vw;
                --start-y: ${40 + Math.random() * 55}vh;
                --drift-x: ${20 + Math.random() * 40}vw;
                --drift-y: ${(Math.random() - 0.5) * 20}vh;
                --duration: ${18 + Math.random() * 15}s;
                animation-delay: -${Math.random() * 20}s;
            `;
            
            fragment.appendChild(particle);
        }

        sandContainer.appendChild(fragment);
        this.registerContainer(sandContainer);
    }

    createPalmTrees() {
        const container = document.getElementById('desert-palms');
        if (!container) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();

        // Strategic palm positions for a natural look
        const positions = [
            { x: 8, bottom: 18, width: 70, height: 140, scaleX: 1, sway: 1.2, delay: 0 },
            { x: 18, bottom: 20, width: 90, height: 170, scaleX: -1, sway: 1.5, delay: 1 },
            { x: 75, bottom: 19, width: 85, height: 160, scaleX: 1, sway: 1.3, delay: 2 },
            { x: 88, bottom: 17, width: 65, height: 130, scaleX: -1, sway: 1.0, delay: 3 },
            { x: 28, bottom: 16, width: 55, height: 110, scaleX: 1, sway: 1.8, delay: 1.5 },
            { x: 65, bottom: 21, width: 100, height: 190, scaleX: 1, sway: 1.4, delay: 0.5 },
            { x: 45, bottom: 15, width: 50, height: 100, scaleX: -1, sway: 2.0, delay: 2.5 },
            { x: 55, bottom: 18, width: 75, height: 145, scaleX: 1, sway: 1.6, delay: 1.2 },
        ];

        const palmsToCreate = Math.min(preset.palmCount, positions.length);

        for (let i = 0; i < palmsToCreate; i++) {
            const pos = positions[i];
            const palm = document.createElement('div');
            palm.className = 'oasis-palm';
            
            palm.style.cssText = `
                left: ${pos.x}%;
                --palm-bottom: ${pos.bottom}%;
                --palm-width: ${pos.width}px;
                --palm-height: ${pos.height}px;
                --scale-x: ${pos.scaleX};
                --sway-amount: ${pos.sway}deg;
                --sway-duration: ${8 + Math.random() * 4}s;
                animation-delay: -${pos.delay}s;
            `;
            
            fragment.appendChild(palm);
        }

        container.appendChild(fragment);
        this.registerContainer(container);
    }

    createLanterns() {
        const container = document.getElementById('desert-lanterns');
        if (!container) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();
        this.lanternElements = [];

        for (let i = 0; i < preset.lanternCount; i++) {
            const lantern = document.createElement('div');
            lantern.className = 'oasis-lantern';
            
            // Position lanterns around the oasis area
            const xPos = 20 + Math.random() * 60;
            const yPos = 25 + Math.random() * 45;
            
            lantern.style.cssText = `
                left: ${xPos}%;
                top: ${yPos}%;
                --drift-x: ${(Math.random() - 0.5) * 30}px;
                --drift-y: ${-15 - Math.random() * 25}px;
                --glow-duration: ${2 + Math.random() * 2}s;
                --float-duration: ${12 + Math.random() * 10}s;
                animation-delay: -${Math.random() * 15}s;
            `;
            
            fragment.appendChild(lantern);
            this.lanternElements.push(lantern);
        }

        container.appendChild(fragment);
        this.registerContainer(container);
    }

    createVegetation() {
        const container = document.getElementById('desert-vegetation');
        if (!container) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();

        // Create reeds around the oasis
        for (let i = 0; i < preset.reedCount; i++) {
            const reed = document.createElement('div');
            reed.className = 'oasis-reed';
            
            // Position near oasis (center-ish of screen)
            const xPos = 30 + Math.random() * 40;
            const height = 25 + Math.random() * 35;
            
            reed.style.cssText = `
                left: ${xPos}%;
                --reed-bottom: ${10 + Math.random() * 8}%;
                --reed-height: ${height}px;
                --sway-amount: ${3 + Math.random() * 5}deg;
                --sway-duration: ${3 + Math.random() * 3}s;
                animation-delay: -${Math.random() * 4}s;
            `;
            
            fragment.appendChild(reed);
        }

        container.appendChild(fragment);
        this.registerContainer(container);
    }

    createOasisWater() {
        const container = document.getElementById('desert-oasis-water');
        if (!container || container.children.length > 0) return;

        const water = document.createElement('div');
        water.className = 'oasis-water-pool';
        
        const shimmer = document.createElement('div');
        shimmer.className = 'oasis-water-shimmer';
        
        const reflection = document.createElement('div');
        reflection.className = 'oasis-water-reflection';
        
        container.appendChild(water);
        container.appendChild(shimmer);
        container.appendChild(reflection);
        
        this.registerContainer(container);
    }

    startShootingStars() {
        const createShootingStar = () => {
            if (!this.isActive) return;
            
            const starsContainer = document.getElementById('desert-stars');
            if (!starsContainer) return;
            
            const star = document.createElement('div');
            star.className = 'oasis-shooting-star';
            star.style.left = `${Math.random() * 50 + 10}%`;
            star.style.top = `${Math.random() * 25 + 5}%`;
            star.style.setProperty('--angle', `${30 + Math.random() * 25}deg`);
            
            starsContainer.appendChild(star);
            
            setTimeout(() => star.remove(), 2000);
            
            this.shootingStarTimeout = setTimeout(
                createShootingStar,
                25000 + Math.random() * 35000
            );
        };
        
        this.shootingStarTimeout = setTimeout(createShootingStar, 8000);
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // Performance helpers
    canSpawnEffect() {
        const now = performance.now();
        if (now - this.lastEffectTime < this.effectCooldown) return false;
        if (this.activeEffectCount >= this.maxActiveEffects) return false;
        this.lastEffectTime = now;
        return true;
    }

    trackEffect(element, duration) {
        this.activeEffectCount++;
        setTimeout(() => {
            element.remove();
            this.activeEffectCount = Math.max(0, this.activeEffectCount - 1);
        }, duration);
    }

    getEdgePosition(zone = 'any') {
        const regions = {
            topLeft: { xMin: 0, xMax: 25, yMin: 0, yMax: 30 },
            topRight: { xMin: 75, xMax: 100, yMin: 0, yMax: 30 },
            bottomLeft: { xMin: 0, xMax: 25, yMin: 70, yMax: 100 },
            bottomRight: { xMin: 75, xMax: 100, yMin: 70, yMax: 100 },
            leftSide: { xMin: 0, xMax: 20, yMin: 20, yMax: 80 },
            rightSide: { xMin: 80, xMax: 100, yMin: 20, yMax: 80 },
            oasisArea: { xMin: 30, xMax: 70, yMin: 55, yMax: 90 },
            skyArea: { xMin: 10, xMax: 90, yMin: 5, yMax: 35 },
        };

        let availableRegions;
        switch (zone) {
            case 'oasis': availableRegions = ['oasisArea', 'bottomLeft', 'bottomRight']; break;
            case 'sky': availableRegions = ['skyArea', 'topLeft', 'topRight']; break;
            case 'side': availableRegions = ['leftSide', 'rightSide']; break;
            default: availableRegions = Object.keys(regions);
        }

        const regionName = availableRegions[Math.floor(Math.random() * availableRegions.length)];
        const region = regions[regionName];
        return {
            x: region.xMin + Math.random() * (region.xMax - region.xMin),
            y: region.yMin + Math.random() * (region.yMax - region.yMin),
        };
    }

    // ===== COMBO EFFECT HANDLERS =====

    onLineClear(lineCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (lineCount >= 4) {
            // Tetris! Desert miracle
            this.triggerSandSwirl(4);
            this.triggerWaterRipple(3);
            this.triggerLanternBurst(8);
            this.triggerMoonbeam(3);
            this.pulseOasis(1.4);
        } else if (lineCount >= 2) {
            this.triggerSandSwirl(lineCount);
            this.triggerWaterRipple(2);
            this.triggerLanternBurst(lineCount * 2);
            this.pulseOasis(1.2);
        } else {
            this.triggerLanternBurst(3);
            this.triggerWaterRipple(1);
            this.pulseOasis(1.05);
        }
    }

    onCombo(comboCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (comboCount >= 8) {
            this.triggerSandSwirl(5);
            this.triggerWaterRipple(4);
            this.triggerLanternBurst(12);
            this.triggerMoonbeam(4);
        } else if (comboCount >= 5) {
            this.triggerSandSwirl(3);
            this.triggerWaterRipple(3);
            this.triggerLanternBurst(7);
            this.triggerMoonbeam(2);
        } else if (comboCount >= 3) {
            this.triggerSandSwirl(2);
            this.triggerLanternBurst(4);
            this.triggerWaterRipple(2);
            this.pulseOasis(1.2);
        } else {
            this.triggerLanternBurst(3);
            this.triggerWaterRipple(1);
        }
    }

    onPieceLock() {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (Math.random() < 0.2) {
            this.triggerSandPuff();
        } else if (Math.random() < 0.25) {
            this.triggerLanternGlow();
        }
    }

    // ===== COMBO EFFECTS =====

    triggerSandSwirl(count = 2) {
        const container = document.getElementById('desert-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.sandSwirlCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;
            
            setTimeout(() => {
                if (!this.isActive) return;
                
                const swirl = document.createElement('div');
                swirl.className = 'sand-swirl';
                
                const pos = this.getEdgePosition('side');
                swirl.style.left = `${pos.x}%`;
                swirl.style.top = `${pos.y}%`;
                
                container.appendChild(swirl);
                this.trackEffect(swirl, 1400);
            }, i * 120);
        }
    }

    triggerWaterRipple(count = 2) {
        const container = document.getElementById('desert-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.waterRippleCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;
            
            setTimeout(() => {
                if (!this.isActive) return;
                
                const ripple = document.createElement('div');
                ripple.className = 'oasis-ripple';
                
                const pos = this.getEdgePosition('oasis');
                ripple.style.left = `${pos.x}%`;
                ripple.style.top = `${pos.y}%`;
                
                container.appendChild(ripple);
                this.trackEffect(ripple, 1100);
            }, i * 150);
        }
    }

    triggerLanternBurst(count = 5) {
        const container = document.getElementById('desert-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.lanternBurstCount);
        const colors = ['#ffe0a0', '#ffc870', '#fff0c0', '#ffb050'];

        const fragment = document.createDocumentFragment();
        const particles = [];

        for (let i = 0; i < actualCount; i++) {
            const spark = document.createElement('div');
            spark.className = 'lantern-spark';
            
            const pos = this.getEdgePosition('any');
            spark.style.cssText = `
                left: ${pos.x}%;
                top: ${pos.y}%;
                --burst-x: ${(Math.random() - 0.5) * 70}px;
                --burst-y: ${(Math.random() - 0.5) * 70}px;
                --glow-color: ${colors[Math.floor(Math.random() * colors.length)]};
                animation-delay: ${i * 35}ms;
            `;
            
            fragment.appendChild(spark);
            particles.push(spark);
            this.activeEffectCount++;
        }
        
        container.appendChild(fragment);
        
        setTimeout(() => {
            particles.forEach(p => p.remove());
            this.activeEffectCount = Math.max(0, this.activeEffectCount - particles.length);
        }, 900);
    }

    triggerMoonbeam(count = 2) {
        const container = document.getElementById('desert-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.moonbeamCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;
            
            setTimeout(() => {
                if (!this.isActive) return;
                
                const beam = document.createElement('div');
                beam.className = 'moonbeam';
                
                beam.style.left = `${65 + Math.random() * 25}%`;
                beam.style.top = '0';
                beam.style.setProperty('--beam-angle', `${12 + Math.random() * 18}deg`);
                
                container.appendChild(beam);
                this.trackEffect(beam, 1600);
            }, i * 180);
        }
    }

    pulseOasis(intensity = 1.1) {
        const water = document.querySelector('.oasis-water-pool');
        const shimmer = document.querySelector('.oasis-water-shimmer');
        
        if (water) {
            water.style.setProperty('--pulse-intensity', intensity);
            water.classList.add('oasis-pulse');
            setTimeout(() => water.classList.remove('oasis-pulse'), 500);
        }
        
        if (shimmer) {
            shimmer.classList.add('shimmer-pulse');
            setTimeout(() => shimmer.classList.remove('shimmer-pulse'), 500);
        }
    }

    triggerSandPuff() {
        const container = document.getElementById('desert-effects');
        if (!container || !this.canSpawnEffect()) return;

        const puff = document.createElement('div');
        puff.className = 'sand-puff';
        
        const pos = this.getEdgePosition('side');
        puff.style.left = `${pos.x}%`;
        puff.style.top = `${pos.y}%`;
        
        container.appendChild(puff);
        this.trackEffect(puff, 550);
    }

    triggerLanternGlow() {
        if (this.lanternElements.length === 0) return;
        
        const randomLantern = this.lanternElements[Math.floor(Math.random() * this.lanternElements.length)];
        randomLantern.classList.add('lantern-flash');
        setTimeout(() => randomLantern.classList.remove('lantern-flash'), 350);
    }

    getTetrominoConfig() {
        return DESERT_OASIS_TETROMINOS;
    }

    stop() {
        if (!this.isActive) return;
        
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();
        
        if (this.shootingStarTimeout) {
            clearTimeout(this.shootingStarTimeout);
            this.shootingStarTimeout = null;
        }
        
        const container = document.getElementById('desert-effects');
        if (container) container.innerHTML = '';
        this.activeEffectCount = 0;
        this.lanternElements = [];
        
        super.stop();
    }

    cleanup() {
        this.stop();
        super.cleanup();
    }
}

import { BaseTheme } from '../base-theme.js';
import { GALAXY_TETROMINOS } from './galaxy-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Galaxy Theme - An immersive cosmic experience
 * 
 * Features:
 * - Multi-layered nebula with depth and rotation
 * - Dynamic starfield with varying intensities
 * - Cosmic dust particles drifting through space
 * - Distant spiral galaxies
 * - Theme-integrated combo effects:
 *   - Supernova bursts for high combos
 *   - Cosmic ripple waves on line clears
 *   - Shooting star showers
 *   - Warp speed streaks for epic combos
 * 
 * Quality Presets: Minimal, Low, Medium, High, Ultra, Extreme
 */
export default class GalaxyTheme extends BaseTheme {
    constructor() {
        super('galaxy');
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.cosmicDustParticles = [];
        this.shootingStars = [];
        this.activeEffects = [];
        this.lastTime = 0;
        
        // Graphics quality presets
        this.qualityChangeHandler = null;
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                // Starfield
                starCount: 80,
                coloredStarChance: 0.03,
                twinkleDurationRange: [15, 20],
                
                // Cosmic dust
                dustCount: 0,
                
                // Distant galaxies
                galaxyCount: 0,
                
                // Nebula
                nebulaBlur: 60,
                nebulaAnimationEnabled: false,
                additionalNebulaLayers: false,
                
                // Effects
                enableComboEffects: false,
                supernovaParticles: 0,
                supernovaRings: 0,
                shootingStarMultiplier: 0,
                constellationStars: 0,
                constellationLines: false,
                warpStreaks: 0,
                cosmicRippleCount: 0,
                
                // Performance
                animationFrameSkip: 3,
            },
            Low: {
                // Starfield
                starCount: 120,
                coloredStarChance: 0.05,
                twinkleDurationRange: [12, 18],
                
                // Cosmic dust
                dustCount: 10,
                
                // Distant galaxies
                galaxyCount: 1,
                
                // Nebula
                nebulaBlur: 55,
                nebulaAnimationEnabled: true,
                additionalNebulaLayers: false,
                
                // Effects
                enableComboEffects: true,
                supernovaParticles: 8,
                supernovaRings: 1,
                shootingStarMultiplier: 0.3,
                constellationStars: 4,
                constellationLines: false,
                warpStreaks: 15,
                cosmicRippleCount: 1,
                
                // Performance
                animationFrameSkip: 2,
            },
            Medium: {
                // Starfield
                starCount: 180,
                coloredStarChance: 0.08,
                twinkleDurationRange: [10, 16],
                
                // Cosmic dust
                dustCount: 20,
                
                // Distant galaxies
                galaxyCount: 2,
                
                // Nebula
                nebulaBlur: 50,
                nebulaAnimationEnabled: true,
                additionalNebulaLayers: true,
                
                // Effects
                enableComboEffects: true,
                supernovaParticles: 12,
                supernovaRings: 2,
                shootingStarMultiplier: 0.5,
                constellationStars: 6,
                constellationLines: true,
                warpStreaks: 30,
                cosmicRippleCount: 2,
                
                // Performance
                animationFrameSkip: 1,
            },
            High: {
                // Starfield
                starCount: 250,
                coloredStarChance: 0.1,
                twinkleDurationRange: [8, 14],
                
                // Cosmic dust
                dustCount: 30,
                
                // Distant galaxies
                galaxyCount: 2,
                
                // Nebula
                nebulaBlur: 45,
                nebulaAnimationEnabled: true,
                additionalNebulaLayers: true,
                
                // Effects
                enableComboEffects: true,
                supernovaParticles: 16,
                supernovaRings: 2,
                shootingStarMultiplier: 0.7,
                constellationStars: 8,
                constellationLines: true,
                warpStreaks: 45,
                cosmicRippleCount: 3,
                
                // Performance
                animationFrameSkip: 0,
            },
            Ultra: {
                // Starfield
                starCount: 350,
                coloredStarChance: 0.12,
                twinkleDurationRange: [8, 12],
                
                // Cosmic dust
                dustCount: 45,
                
                // Distant galaxies
                galaxyCount: 3,
                
                // Nebula
                nebulaBlur: 40,
                nebulaAnimationEnabled: true,
                additionalNebulaLayers: true,
                
                // Effects
                enableComboEffects: true,
                supernovaParticles: 24,
                supernovaRings: 3,
                shootingStarMultiplier: 0.9,
                constellationStars: 10,
                constellationLines: true,
                warpStreaks: 60,
                cosmicRippleCount: 4,
                
                // Performance
                animationFrameSkip: 0,
            },
            Extreme: {
                // Starfield
                starCount: 500,
                coloredStarChance: 0.15,
                twinkleDurationRange: [6, 12],
                
                // Cosmic dust
                dustCount: 60,
                
                // Distant galaxies
                galaxyCount: 4,
                
                // Nebula
                nebulaBlur: 35,
                nebulaAnimationEnabled: true,
                additionalNebulaLayers: true,
                
                // Effects
                enableComboEffects: true,
                supernovaParticles: 32,
                supernovaRings: 4,
                shootingStarMultiplier: 1.0,
                constellationStars: 14,
                constellationLines: true,
                warpStreaks: 80,
                cosmicRippleCount: 5,
                
                // Performance
                animationFrameSkip: 0,
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
            console.warn(`[GalaxyTheme] Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        // If scene is active, refresh quality-dependent elements
        if (this.isActive) {
            this.refreshQualityDependentElements();
        }

        console.log(`🌌 [GalaxyTheme] Applied ${quality} quality preset`);
    }

    /**
     * Refresh elements that depend on quality settings
     */
    refreshQualityDependentElements() {
        // Clear and recreate starfield with new count
        const starsContainer = document.getElementById('galaxy-stars-bg');
        if (starsContainer) {
            starsContainer.innerHTML = '';
            this.createStarfield();
        }

        // Clear and recreate cosmic dust
        const dustContainer = document.getElementById('galaxy-cosmic-dust');
        if (dustContainer) {
            dustContainer.innerHTML = '';
            this.cosmicDustParticles = [];
            this.createCosmicDust();
        }

        // Clear and recreate distant galaxies
        const galaxyContainer = document.getElementById('galaxy-distant');
        if (galaxyContainer) {
            galaxyContainer.innerHTML = '';
            this.createDistantGalaxies();
        }

        // Update nebula settings
        this.updateNebulaSettings();
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

    async createScene() {
        // Apply quality preset at scene creation
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();

        // Create background stars with varying sizes and intensities
        this.createStarfield();
        
        // Create cosmic dust particles
        this.createCosmicDust();
        
        // Create distant galaxies
        this.createDistantGalaxies();
        
        // Update nebula based on quality
        this.updateNebulaSettings();
        
        // Setup event listeners for combo effects
        this.setupEventListeners();
        
        // Start animation loop
        this.startAnimation();
    }

    /**
     * Create multi-layered starfield with depth
     */
    createStarfield() {
        const starsContainer = document.getElementById('galaxy-stars-bg');
        if (!starsContainer) return;
        
        // Clear existing stars
        if (starsContainer.children.length > 0) {
            starsContainer.innerHTML = '';
        }

        const preset = this.activePreset;
        const starCount = preset.starCount;
        const coloredStarChance = preset.coloredStarChance;
        const [minDuration, maxDuration] = preset.twinkleDurationRange;
        
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'galaxy-star-bg';
            
            // Varied star sizes - mostly tiny with some larger bright ones
            const sizeRoll = Math.random();
            let size;
            if (sizeRoll < 0.6) {
                size = Math.random() * 1 + 0.3; // Tiny stars
            } else if (sizeRoll < 0.9) {
                size = Math.random() * 1.5 + 1; // Medium stars
            } else {
                size = Math.random() * 2 + 2; // Bright stars
            }
            
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 100}%`;
            
            // Varied animation delays and durations for organic twinkling
            star.style.animationDelay = `${Math.random() * 15}s`;
            const duration = minDuration + Math.random() * (maxDuration - minDuration);
            star.style.animationDuration = `${duration}s`;
            
            // Some stars are brighter/colored
            if (sizeRoll > (1 - coloredStarChance)) {
                const colors = ['#4fcfff', '#ff5ed1', '#ffe26b', '#5bffd5', '#d050ff'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                star.style.backgroundColor = color;
                star.style.boxShadow = `0 0 ${size * 3}px ${color}`;
            }
            
            starsContainer.appendChild(star);
        }
        
        this.registerContainer(starsContainer);
    }

    /**
     * Create floating cosmic dust particles
     */
    createCosmicDust() {
        const container = document.getElementById('galaxy-cosmic-dust');
        if (!container) return;

        const preset = this.activePreset;
        const dustCount = preset.dustCount;
        
        if (dustCount === 0) return;
        
        for (let i = 0; i < dustCount; i++) {
            const dust = document.createElement('div');
            dust.className = 'cosmic-dust-particle';
            
            const size = Math.random() * 3 + 1;
            dust.style.width = `${size}px`;
            dust.style.height = `${size}px`;
            dust.style.left = `${Math.random() * 100}%`;
            dust.style.top = `${Math.random() * 100}%`;
            dust.style.animationDelay = `${Math.random() * 30}s`;
            dust.style.animationDuration = `${40 + Math.random() * 40}s`;
            
            // Subtle color variations
            const hue = 220 + Math.random() * 60; // Blue to purple range
            dust.style.backgroundColor = `hsla(${hue}, 70%, 70%, ${0.2 + Math.random() * 0.3})`;
            
            container.appendChild(dust);
            this.cosmicDustParticles.push(dust);
        }
        
        this.registerContainer(container);
    }

    /**
     * Create distant spiral galaxies in the background
     */
    createDistantGalaxies() {
        const container = document.getElementById('galaxy-distant');
        if (!container) return;

        const preset = this.activePreset;
        const galaxyCount = preset.galaxyCount;
        
        if (galaxyCount === 0) return;
        
        for (let i = 0; i < galaxyCount; i++) {
            const galaxy = document.createElement('div');
            galaxy.className = 'distant-galaxy';
            
            const size = 60 + Math.random() * 100;
            galaxy.style.width = `${size}px`;
            galaxy.style.height = `${size}px`;
            galaxy.style.left = `${15 + Math.random() * 70}%`;
            galaxy.style.top = `${15 + Math.random() * 70}%`;
            galaxy.style.animationDelay = `${Math.random() * 60}s`;
            galaxy.style.transform = `rotate(${Math.random() * 360}deg)`;
            galaxy.style.opacity = 0.15 + Math.random() * 0.15;
            
            container.appendChild(galaxy);
        }
        
        this.registerContainer(container);
    }

    /**
     * Update nebula visual settings based on quality
     */
    updateNebulaSettings() {
        const preset = this.activePreset;
        const nebulas = document.querySelectorAll('.nebula');
        
        nebulas.forEach((nebula) => {
            nebula.style.filter = `blur(${preset.nebulaBlur}px)`;
            
            if (!preset.nebulaAnimationEnabled) {
                nebula.style.animation = 'none';
            }
        });
        
        // Show/hide 4th nebula layer based on quality
        const nebula4 = document.getElementById('nebula-layer-4');
        if (nebula4) {
            nebula4.style.display = preset.additionalNebulaLayers ? 'block' : 'none';
        }
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
     * Handle line clear with cosmic effects
     */
    onLineClear(lineCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (lineCount >= 4) {
            // Tetris! Epic supernova explosion
            this.triggerSupernova();
            this.triggerShootingStarShower(12);
            this.pulseNebula(1.5);
        } else if (lineCount >= 2) {
            // Multi-line: cosmic ripple
            this.triggerCosmicRipple(lineCount);
            this.triggerShootingStarShower(lineCount * 2);
            this.pulseNebula(1.2);
        } else {
            // Single line: subtle star burst
            this.triggerStarBurst();
            this.pulseNebula(1.05);
        }
    }

    /**
     * Handle combo with escalating effects
     */
    onCombo(comboCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (comboCount >= 8) {
            // Epic combo: Warp speed effect + supernova
            this.triggerWarpSpeed();
            this.triggerSupernova();
            this.triggerConstellationBurst(comboCount);
        } else if (comboCount >= 5) {
            // High combo: Supernova burst
            this.triggerSupernova();
            this.triggerShootingStarShower(comboCount);
        } else if (comboCount >= 3) {
            // Medium combo: Constellation burst
            this.triggerConstellationBurst(comboCount);
            this.pulseNebula(1.3);
        } else {
            // Low combo: Star shimmer
            this.triggerStarShimmer();
            this.pulseNebula(1.1);
        }
    }

    /**
     * Handle piece lock with subtle pulse
     */
    onPieceLock() {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;
        
        // Subtle nebula pulse on piece lock
        this.pulseNebula(1.02);
    }

    /**
     * Get a random position avoiding the center of the screen (where the game board is)
     * Returns positions in the edges and corners of the screen
     * @param {string} zone - Optional: 'corner', 'edge', 'side', or 'any' (default)
     * @returns {{x: number, y: number}} Position as percentages
     */
    getEdgePosition(zone = 'any') {
        // Define screen regions that avoid the center game board area
        // Center is roughly 30-70% horizontally and 15-85% vertically
        const regions = {
            // Corners (safest - always visible)
            topLeft: { xMin: 0, xMax: 25, yMin: 0, yMax: 30 },
            topRight: { xMin: 75, xMax: 100, yMin: 0, yMax: 30 },
            bottomLeft: { xMin: 0, xMax: 25, yMin: 70, yMax: 100 },
            bottomRight: { xMin: 75, xMax: 100, yMin: 70, yMax: 100 },
            // Sides (left and right of game board)
            leftSide: { xMin: 0, xMax: 20, yMin: 20, yMax: 80 },
            rightSide: { xMin: 80, xMax: 100, yMin: 20, yMax: 80 },
            // Top and bottom edges
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
     * Trigger a supernova explosion effect
     */
    triggerSupernova() {
        const effectsContainer = document.getElementById('galaxy-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.supernovaParticles === 0 && preset.supernovaRings === 0) return;

        // Create multiple supernovas across the screen
        const supernovaCount = Math.ceil(preset.supernovaRings / 2) + 1;
        
        for (let s = 0; s < supernovaCount; s++) {
            setTimeout(() => {
                const supernova = document.createElement('div');
                supernova.className = 'supernova-burst';
                
                // Position in corners and edges, avoiding center
                const pos = this.getEdgePosition('any');
                supernova.style.left = `${pos.x}%`;
                supernova.style.top = `${pos.y}%`;
                
                effectsContainer.appendChild(supernova);
                
                // Create rings based on preset (distributed across supernovas)
                const ringsPerSupernova = Math.ceil(preset.supernovaRings / supernovaCount);
                for (let i = 0; i < ringsPerSupernova; i++) {
                    const ring = document.createElement('div');
                    ring.className = 'supernova-ring';
                    ring.style.animationDelay = `${i * 100}ms`;
                    supernova.appendChild(ring);
                }
                
                // Create particle burst based on preset (distributed across supernovas)
                const particlesPerSupernova = Math.ceil(preset.supernovaParticles / supernovaCount);
                for (let i = 0; i < particlesPerSupernova; i++) {
                    const particle = document.createElement('div');
                    particle.className = 'supernova-particle';
                    const angle = (i / particlesPerSupernova) * Math.PI * 2;
                    particle.style.setProperty('--angle', `${angle}rad`);
                    particle.style.setProperty('--distance', `${100 + Math.random() * 150}px`);
                    particle.style.animationDelay = `${Math.random() * 100}ms`;
                    supernova.appendChild(particle);
                }
                
                // Cleanup after animation
                setTimeout(() => supernova.remove(), 2000);
            }, s * 150);
        }
    }

    /**
     * Trigger cosmic ripple waves
     */
    triggerCosmicRipple(intensity = 1) {
        const effectsContainer = document.getElementById('galaxy-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        const rippleCount = Math.min(intensity + 1, preset.cosmicRippleCount);
        
        if (rippleCount === 0) return;
        
        // Spawn ripples from different corners/edges
        for (let i = 0; i < rippleCount; i++) {
            setTimeout(() => {
                const ripple = document.createElement('div');
                ripple.className = 'cosmic-ripple';
                
                // Position ripples in corners for better visibility
                const pos = this.getEdgePosition('corner');
                ripple.style.left = `${pos.x}%`;
                ripple.style.top = `${pos.y}%`;
                
                effectsContainer.appendChild(ripple);
                
                setTimeout(() => ripple.remove(), 1500);
            }, i * 150);
        }
    }

    /**
     * Trigger a shooting star shower
     */
    triggerShootingStarShower(count = 5) {
        const starsContainer = document.getElementById('galaxy-shooting-stars');
        if (!starsContainer) return;

        const preset = this.activePreset;
        if (preset.shootingStarMultiplier === 0) return;

        const actualCount = Math.floor(count * preset.shootingStarMultiplier);
        
        for (let i = 0; i < actualCount; i++) {
            setTimeout(() => {
                const star = document.createElement('div');
                star.className = 'shooting-star-effect';
                
                // Varied starting positions from all edges
                const edge = Math.floor(Math.random() * 4);
                
                switch (edge) {
                    case 0: // Top edge
                        star.style.left = `${Math.random() * 100}%`;
                        star.style.top = '-5%';
                        break;
                    case 1: // Right edge
                        star.style.left = '105%';
                        star.style.top = `${Math.random() * 100}%`;
                        break;
                    case 2: // Left edge (shooting right)
                        star.style.left = '-5%';
                        star.style.top = `${Math.random() * 50}%`;
                        break;
                    case 3: // Bottom corners shooting up
                        star.style.left = `${Math.random() > 0.5 ? Math.random() * 20 : 80 + Math.random() * 20}%`;
                        star.style.top = '105%';
                        break;
                }
                
                // Angle based on starting edge for natural trajectory
                let angle;
                switch (edge) {
                    case 0: angle = -60 - Math.random() * 60; break; // Down-left or down-right
                    case 1: angle = -150 - Math.random() * 60; break; // Left
                    case 2: angle = -30 + Math.random() * 60; break; // Right
                    case 3: angle = -120 + Math.random() * 60; break; // Up
                }
                
                const length = 100 + Math.random() * 150;
                star.style.setProperty('--angle', `${angle}deg`);
                star.style.setProperty('--length', `${length}px`);
                star.style.animationDuration = `${0.6 + Math.random() * 0.4}s`;
                
                starsContainer.appendChild(star);
                
                setTimeout(() => star.remove(), 1500);
            }, i * (80 + Math.random() * 150));
        }
    }

    /**
     * Trigger a constellation burst pattern
     */
    triggerConstellationBurst(count = 3) {
        const effectsContainer = document.getElementById('galaxy-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.constellationStars === 0) return;

        // Create multiple constellations in different screen areas
        const constellationCount = Math.min(count, 4);
        
        for (let c = 0; c < constellationCount; c++) {
            setTimeout(() => {
                const constellation = document.createElement('div');
                constellation.className = 'constellation-burst';
                
                // Position in corners and sides
                const pos = this.getEdgePosition(c < 2 ? 'corner' : 'side');
                constellation.style.left = `${pos.x}%`;
                constellation.style.top = `${pos.y}%`;
                
                effectsContainer.appendChild(constellation);

                // Create connected star points based on preset (distributed)
                const starsPerConstellation = Math.ceil(preset.constellationStars / constellationCount);
                const starCount = Math.min(count + 3, starsPerConstellation);
                const stars = [];
                
                for (let i = 0; i < starCount; i++) {
                    const star = document.createElement('div');
                    star.className = 'constellation-star';
                    
                    const angle = (i / starCount) * Math.PI * 2;
                    const distance = 40 + Math.random() * 80;
                    const x = Math.cos(angle) * distance;
                    const y = Math.sin(angle) * distance;
                    
                    star.style.setProperty('--x', `${x}px`);
                    star.style.setProperty('--y', `${y}px`);
                    star.style.animationDelay = `${i * 50}ms`;
                    
                    constellation.appendChild(star);
                    stars.push({ x, y });
                }

                // Create connecting lines if enabled
                if (preset.constellationLines && stars.length > 1) {
                    for (let i = 0; i < stars.length; i++) {
                        const line = document.createElement('div');
                        line.className = 'constellation-line';
                        
                        const nextI = (i + 1) % stars.length;
                        const dx = stars[nextI].x - stars[i].x;
                        const dy = stars[nextI].y - stars[i].y;
                        const length = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);
                        
                        line.style.width = `${length}px`;
                        line.style.left = `calc(50% + ${stars[i].x}px)`;
                        line.style.top = `calc(50% + ${stars[i].y}px)`;
                        line.style.transform = `rotate(${angle}rad)`;
                        line.style.animationDelay = `${i * 50 + 200}ms`;
                        
                        constellation.appendChild(line);
                    }
                }
                
                setTimeout(() => constellation.remove(), 2000);
            }, c * 200);
        }
    }

    /**
     * Trigger warp speed streaks effect
     */
    triggerWarpSpeed() {
        const effectsContainer = document.getElementById('galaxy-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (preset.warpStreaks === 0) return;

        const warpContainer = document.createElement('div');
        warpContainer.className = 'warp-speed-container';
        effectsContainer.appendChild(warpContainer);

        const streakCount = preset.warpStreaks;
        
        for (let i = 0; i < streakCount; i++) {
            const streak = document.createElement('div');
            streak.className = 'warp-streak';
            
            // Radiate from multiple points across the screen (not just center)
            // Choose a random origin point biased toward edges
            const originPoints = [
                { x: 10, y: 10 },   // Top-left
                { x: 90, y: 10 },   // Top-right
                { x: 10, y: 90 },   // Bottom-left
                { x: 90, y: 90 },   // Bottom-right
                { x: 50, y: 5 },    // Top center
                { x: 50, y: 95 },   // Bottom center
                { x: 5, y: 50 },    // Left center
                { x: 95, y: 50 },   // Right center
            ];
            
            const origin = originPoints[Math.floor(Math.random() * originPoints.length)];
            
            const angle = Math.random() * Math.PI * 2;
            const startDistance = 2 + Math.random() * 5;
            const x = Math.cos(angle) * startDistance;
            const y = Math.sin(angle) * startDistance;
            
            streak.style.left = `calc(${origin.x}% + ${x}vw)`;
            streak.style.top = `calc(${origin.y}% + ${y}vh)`;
            streak.style.setProperty('--angle', `${angle}rad`);
            streak.style.animationDelay = `${Math.random() * 200}ms`;
            
            warpContainer.appendChild(streak);
        }
        
        setTimeout(() => warpContainer.remove(), 1500);
    }

    /**
     * Trigger a simple star burst
     */
    triggerStarBurst() {
        const effectsContainer = document.getElementById('galaxy-effects');
        if (!effectsContainer) return;

        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        // Create multiple star bursts across screen edges
        const burstCount = 3;
        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const burst = document.createElement('div');
                burst.className = 'star-burst-effect';
                
                const pos = this.getEdgePosition('any');
                burst.style.left = `${pos.x}%`;
                burst.style.top = `${pos.y}%`;
                effectsContainer.appendChild(burst);
                
                setTimeout(() => burst.remove(), 800);
            }, i * 100);
        }
    }

    /**
     * Trigger star shimmer across the field
     */
    triggerStarShimmer() {
        const starsContainer = document.getElementById('galaxy-stars-bg');
        if (!starsContainer) return;

        starsContainer.classList.add('star-shimmer-active');
        setTimeout(() => {
            starsContainer.classList.remove('star-shimmer-active');
        }, 600);
    }

    /**
     * Pulse the nebula layers
     */
    pulseNebula(intensity = 1.1) {
        const nebulas = document.querySelectorAll('.nebula');
        const preset = this.activePreset;
        
        nebulas.forEach((nebula, index) => {
            nebula.style.transition = 'transform 300ms ease-out, filter 300ms ease-out';
            nebula.style.transform = `${nebula.style.transform || ''} scale(${intensity})`;
            nebula.style.filter = `blur(${preset.nebulaBlur}px) brightness(${1 + (intensity - 1) * 2})`;
            
            setTimeout(() => {
                nebula.style.transition = 'transform 800ms ease-in, filter 800ms ease-in';
                nebula.style.transform = '';
                nebula.style.filter = `blur(${preset.nebulaBlur}px)`;
            }, 300 + index * 50);
        });
    }

    /**
     * Start animation loop for continuous effects
     */
    startAnimation() {
        let frameCount = 0;
        
        const animate = (currentTime) => {
            if (!this.isActive) return;

            frameCount++;
            const preset = this.activePreset;
            
            // Frame skipping for performance on lower quality
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

            // Update any active effects here if needed
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
        // Currently the CSS handles most animations
    }

    /**
     * Provide Galaxy themed tetromino styling
     * @returns {Object} Galaxy tetromino configuration
     */
    getTetrominoConfig() {
        return GALAXY_TETROMINOS;
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
        
        // Clear particle arrays
        this.cosmicDustParticles = [];
        this.shootingStars = [];
        this.activeEffects = [];
        
        super.cleanup();
    }
}

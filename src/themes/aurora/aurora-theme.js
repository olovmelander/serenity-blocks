import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { AURORA_TETROMINOS } from './aurora-tetrominos.js';

// Cache buster v2024-10-12-23:05
export default class AuroraTheme extends BaseTheme {
    constructor() {
        super('aurora');
        this.debugLogging = false;
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.stars = [];
        this.themeContainer = null;
        this.starsContainer = null;
        this.veilContainer = null;
        this.shimmerContainer = null;
        this.cachedCurtains = [];
        this.wavePool = [];
        this.shootingStarPool = [];
        this.maxWavePoolSize = 8;
        this.maxShootingStarPoolSize = 5;
        this.activeWaveElements = new Set();
        this.activeShootingStarElements = new Set();
        this.activeTimeouts = new Set();
        // Perf tuning: limit bursts and schedule glow tweaks
        this.maxConcurrentWaves = 4;
        this.maxConcurrentShootingStars = 3;
        this.waveCooldownMs = 160;
        this.shootingStarCooldownMs = 260;
        this.waveStaggerMs = 160;
        this.lastWaveSpawn = 0;
        this.lastShootingStarTime = 0;
        this.starTwinkleCooldownMs = 140;
        this.lastStarTwinkle = 0;
        this.starTwinkleChance = 0.18;
        this.baseQualitySettings = {
            maxConcurrentWaves: this.maxConcurrentWaves,
            maxConcurrentShootingStars: this.maxConcurrentShootingStars,
            waveCooldownMs: this.waveCooldownMs,
            waveStaggerMs: this.waveStaggerMs,
            shootingStarCooldownMs: this.shootingStarCooldownMs,
            starTwinkleChance: this.starTwinkleChance,
            starTwinkleCooldownMs: this.starTwinkleCooldownMs,
        };
        this.graphicsQualityPresets = {
            Low: {
                starCount: 80,
                starOpacityMultiplier: 0.75,
                starTwinkleChance: 0.08,
                starTwinkleCooldownMs: 240,
                maxConcurrentWaves: 1,
                waveCooldownMs: 260,
                waveStaggerMs: 220,
                maxConcurrentShootingStars: 1,
                shootingStarCooldownMs: 520,
                curtainLayers: 3,
                curtainOpacityMultiplier: 0.7,
                enableShimmers: false,
            },
            Medium: {
                starCount: 110,
                starOpacityMultiplier: 0.9,
                starTwinkleChance: 0.12,
                starTwinkleCooldownMs: 190,
                maxConcurrentWaves: 2,
                waveCooldownMs: 210,
                waveStaggerMs: 190,
                maxConcurrentShootingStars: 2,
                shootingStarCooldownMs: 400,
                curtainLayers: 4,
                curtainOpacityMultiplier: 0.85,
                enableShimmers: true,
            },
            High: {
                starCount: 140,
                starOpacityMultiplier: 1,
                starTwinkleChance: 0.16,
                starTwinkleCooldownMs: 160,
                maxConcurrentWaves: 3,
                waveCooldownMs: 180,
                waveStaggerMs: 170,
                maxConcurrentShootingStars: 2,
                shootingStarCooldownMs: 320,
                curtainLayers: 5,
                curtainOpacityMultiplier: 1,
                enableShimmers: true,
            },
            Ultra: {
                starCount: 150,
                starOpacityMultiplier: 1.1,
                starTwinkleChance: 0.18,
                starTwinkleCooldownMs: 140,
                maxConcurrentWaves: 4,
                waveCooldownMs: 160,
                waveStaggerMs: 160,
                maxConcurrentShootingStars: 3,
                shootingStarCooldownMs: 260,
                curtainLayers: 5,
                curtainOpacityMultiplier: 1.08,
                enableShimmers: true,
            },
        };
        this.currentQuality = null;
        this.activePreset = null;
        this.qualityChangeHandler = null;
    }

    async createScene() {
        this.debugLog('[Aurora] createScene() called!');
        
        try {
            const initialQuality = this.getGraphicsQuality();
            const initialStarCount =
                this.graphicsQualityPresets?.[initialQuality]?.starCount ??
                this.graphicsQualityPresets?.Ultra?.starCount ??
                150;
            this.themeContainer = this.getContainer('aurora-theme');
            this.starsContainer = this.getContainer('aurora-stars');
            this.veilContainer = this.getContainer('aurora-veil-container');
            this.shimmerContainer = this.getContainer('aurora-shimmers');
            // NOTE: This is a simplified version of the aurora theme
            // The original implementation is highly complex with dynamic keyframes and color cycling
            // For full functionality, additional work may be needed to port all dynamic animations

            const starsContainer = this.starsContainer;
            this.debugLog('[Aurora] Stars container found:', !!starsContainer);
            if (starsContainer && starsContainer.children.length === 0) {
                const fragment = document.createDocumentFragment();
                for (let i = 0; i < initialStarCount; i++) {
                    const star = this.createStarElement();
                    fragment.appendChild(star);
                    this.stars.push(star);
                }
                starsContainer.appendChild(fragment);
                this.registerContainer(starsContainer);
            }

            this.generateAuroraCurtains();
            this.generateAuroraShimmers();
            this.cacheAuroraCurtains();
            
            // Setup event listeners for reactive effects
            this.debugLog('[Aurora] About to setup event listeners...');
            this.setupEventListeners();
            this.debugLog('[Aurora] Event listeners setup complete!');

            this.applyGraphicsPreset(initialQuality);
            this.setupQualityListener();
            
            this.debugLog('[Aurora] createScene() completed successfully!');
        } catch (error) {
            console.error('[Aurora] ERROR in createScene():', error);
            throw error;
        }
    }

    createStarElement() {
        const star = document.createElement('div');
        star.className = 'aurora-star';

        const starType = Math.random();
        let size;
        let opacity;
        let twinkleSpeed;

        if (starType < 0.6) {
            size = this.random(0.8, 1.4);
            opacity = this.random(0.2, 0.5);
            twinkleSpeed = this.random(6, 10);
        } else if (starType < 0.9) {
            size = this.random(1.4, 2);
            opacity = this.random(0.4, 0.7);
            twinkleSpeed = this.random(5, 8);
        } else {
            size = this.random(2, 3);
            opacity = this.random(0.6, 0.9);
            twinkleSpeed = this.random(4, 7);
        }

        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.left = `${this.random(0, 100)}%`;
        star.style.top = `${this.random(0, 70)}%`;
        star.style.setProperty('--base-opacity', opacity.toFixed(2));
        star.style.opacity = opacity.toFixed(2);
        star.style.animationDuration = `${twinkleSpeed}s`;
        star.style.animationDelay = `${this.random(0, twinkleSpeed)}s`;
        star.dataset.initialOpacity = opacity.toFixed(2);

        return star;
    }
    
    setupEventListeners() {
        this.debugLog('[Aurora] Setting up event listeners');
        
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            this.debugLog('[Aurora] LINE_CLEAR event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });
        
        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            this.debugLog('[Aurora] COMBO event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });
        
        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            this.debugLog('[Aurora] PIECE_LOCK event received, isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });
        
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        this.debugLog('[Aurora] Event listeners set up successfully');
    }
    
    /**
     * React to line clears with aurora waves
     */
    onLineClear(lineCount) {
        this.debugLog('[Aurora] onLineClear called with lineCount:', lineCount);
        
        // Create aurora waves
        this.createAuroraWaves(lineCount);
        
        // Brighten stars
        this.brightenStars(lineCount);
        
        // Pulse the curtains
        this.pulseCurtains(lineCount);
    }
    
    /**
     * React to combos with intense aurora effects
     */
    onCombo(comboCount) {
        this.debugLog('[Aurora] onCombo called with comboCount:', comboCount);
        this.currentComboLevel = comboCount;
        
        // Intensify aurora colors
        this.intensifyAurora(comboCount);
        
        // Create shooting stars for big combos
        if (comboCount >= 3) {
            this.createShootingStar(comboCount);
        }
        
        // Add color shift effect
        this.shiftAuroraColors(comboCount);
    }
    
    /**
     * React to piece locks with subtle shimmers
     */
    onPieceLock(piece) {
        // Subtle star twinkle on piece lock with throttled chance
        const now = this.getTimestamp();
        if (now - this.lastStarTwinkle < this.starTwinkleCooldownMs) {
            return;
        }
        if (Math.random() < this.starTwinkleChance) {
            this.lastStarTwinkle = now;
            this.twinkleStar();
        }
    }
    
    /**
     * Create aurora wave effects
     */
    createAuroraWaves(intensity) {
        const veilContainer = this.veilContainer || this.getContainer('aurora-veil-container');
        this.veilContainer = veilContainer;
        if (!veilContainer) {
            console.warn('[Aurora] Veil container not found!');
            return;
        }
        
        const availableSlots = Math.max(this.maxConcurrentWaves - this.activeWaveElements.size, 0);
        if (availableSlots <= 0) {
            return;
        }

        const now = this.getTimestamp();
        if (now - this.lastWaveSpawn < this.waveCooldownMs) {
            return;
        }
        this.lastWaveSpawn = now;

        const waveCount = Math.min(intensity, Math.min(4, availableSlots));
        this.debugLog('[Aurora] Creating', waveCount, 'aurora waves');
        
        for (let i = 0; i < waveCount; i++) {
            this.runTimeout(() => {
                const wave = this.acquireWaveElement();
                
                const hue = 120 + Math.random() * 60; // Green to purple range
                const duration = 2 + Math.random();
                const width = 60 + intensity * 10;
                
                wave.style.setProperty('--wave-hue', hue);
                wave.style.animationDuration = `${duration}s`;
                wave.style.width = `${width}%`;
                wave.style.left = `${Math.random() * 40 - 20}%`;
                this.restartAnimation(wave);
                
                veilContainer.appendChild(wave);
                this.activeWaveElements.add(wave);
            }, i * this.waveStaggerMs);
        }
    }
    
    /**
     * Brighten stars on line clears
     */
    brightenStars(intensity) {
        const starsToBrighten = Math.min(Math.floor(intensity * 5), this.stars.length);
        
        for (let i = 0; i < starsToBrighten; i++) {
            const star = this.stars[Math.floor(Math.random() * this.stars.length)];
            if (star) {
                const originalOpacity = star.style.opacity;
                star.style.transition = 'opacity 0.3s ease-out';
                star.style.opacity = '1';
                
                this.runTimeout(() => {
                    star.style.opacity = originalOpacity;
                }, 300 + Math.random() * 200);
            }
        }
    }
    
    /**
     * Pulse aurora curtains
     */
    pulseCurtains(intensity) {
        const curtains = this.getCurtains();
        if (curtains.length === 0) {
            return;
        }

        curtains.forEach((curtain, index) => {
            this.runTimeout(() => {
                curtain.style.transition = 'filter 0.4s ease-out';
                curtain.style.filter = `brightness(${1 + intensity * 0.3}) blur(${15 + intensity * 2}px)`;
                
                this.runTimeout(() => {
                    curtain.style.filter = '';
                }, 400);
            }, index * 100);
        });
    }
    
    /**
     * Intensify aurora on combos
     */
    intensifyAurora(comboCount) {
        const theme = this.themeContainer || this.getContainer('aurora-theme');
        this.themeContainer = theme;
        if (!theme) return;
        
        const saturation = 100 + Math.min(comboCount * 15, 75);
        const brightness = 100 + Math.min(comboCount * 10, 40);
        const hueShift = Math.min(comboCount * 10, 60);
        
        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%) hue-rotate(${hueShift}deg)`;
        
        this.runTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }
    
    /**
     * Create shooting star effect
     */
    createShootingStar(comboCount) {
        const starsContainer = this.starsContainer || this.getContainer('aurora-stars');
        this.starsContainer = starsContainer;
        if (!starsContainer) return;
        
        const availableSlots = Math.max(this.maxConcurrentShootingStars - this.activeShootingStarElements.size, 0);
        if (availableSlots <= 0) {
            return;
        }

        const now = this.getTimestamp();
        if (now - this.lastShootingStarTime < this.shootingStarCooldownMs) {
            return;
        }
        this.lastShootingStarTime = now;

        const shootingStarCount = Math.min(comboCount - 2, Math.min(3, availableSlots));
        
        for (let i = 0; i < shootingStarCount; i++) {
            this.runTimeout(() => {
                const shootingStar = this.acquireShootingStarElement();
                
                const startX = Math.random() * 100;
                const startY = Math.random() * 50;
                
                shootingStar.style.left = `${startX}%`;
                shootingStar.style.top = `${startY}%`;
                shootingStar.style.setProperty('--shooting-angle', `${-30 + Math.random() * 20}deg`);
                shootingStar.style.animationDuration = `${0.8 + Math.random() * 0.4}s`;
                this.restartAnimation(shootingStar);
                
                starsContainer.appendChild(shootingStar);
                this.activeShootingStarElements.add(shootingStar);
            }, i * 300);
        }
    }
    
    /**
     * Shift aurora colors based on combo
     */
    shiftAuroraColors(comboCount) {
        const curtains = this.getCurtains();
        if (curtains.length === 0) {
            return;
        }

        curtains.forEach((curtain) => {
            const currentHue = parseFloat(curtain.style.getPropertyValue('--aurora-hue')) || 130;
            const hueShift = comboCount * 15;
            const newHue = (currentHue + hueShift) % 360;
            
            curtain.style.transition = `--aurora-hue ${comboCount * 0.2}s ease-out`;
            curtain.style.setProperty('--aurora-hue', newHue);
            
            this.runTimeout(() => {
                curtain.style.transition = '';
            }, comboCount * 200);
        });
    }
    
    /**
     * Twinkle a random star
     */
    twinkleStar() {
        if (this.stars.length === 0) return;
        
        const star = this.stars[Math.floor(Math.random() * this.stars.length)];
        if (star) {
            const originalOpacity = star.style.opacity;
            star.style.transition = 'opacity 0.2s ease-in-out';
            star.style.opacity = '1';
            
            this.runTimeout(() => {
                star.style.opacity = originalOpacity;
            }, 200);
        }
    }
    
    stop() {
        this.clearActiveTimeouts();
        this.releaseAllTransientElements();
        this.resetCurtainStates();
        this.resetStarStates();
        this.teardownQualityListener();
        this.currentQuality = null;
        this.activePreset = null;

        // Unsubscribe from all events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
        
        // Reset combo level
        this.currentComboLevel = 0;
        
        // Clear any active effects
        const theme = this.themeContainer || this.getContainer('aurora-theme');
        if (theme) {
            theme.style.filter = '';
        }
        
        super.stop();
    }

    generateAuroraCurtains() {
        const veilContainer = this.veilContainer || this.getContainer('aurora-veil-container');
        this.veilContainer = veilContainer;
        if (!veilContainer || veilContainer.children.length > 0) {
            this.cacheAuroraCurtains();
            return;
        }

        // ENHANCED: More layers for depth and complexity
        const layerCount = 5;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < layerCount; i++) {
            const veil = document.createElement('div');
            veil.className = 'aurora-veil';

            // ENHANCED: Varied hues for color variety (green to purple range)
            const hue = this.random(110, 170); // Wider range: green -> cyan -> blue -> purple

            // ENHANCED: Slower, more organic movement
            const duration = this.random(25, 40); // Slower than before
            const glow = this.random(10, 15); // Slower glow pulse

            // ALIGNED: More horizontal curtains for natural aurora feel, with occasional gentle diagonal
            const orientationType = Math.random();
            let orientation, height, width, top, left, right;

            if (orientationType < 0.85) {
                // Horizontal curtains (85%) - primary aurora curtains flow across screen
                orientation = 'horizontal';
                // SUBTLE: Smaller heights for less screen coverage
                height = this.random(25 + i * 3, 40 + i * 3);
                top = 20 + i * 6; // Adjusted vertical spacing
                left = this.random(-20, -12);
                right = this.random(-20, -12);

                // Subtle diagonal tilt for natural variation (±15° max)
                veil.style.setProperty('--aurora-base-rotation', `${this.random(-8, 8)}deg`);
            } else {
                // Gentle diagonal curtains (15%) - adds variety without chaos
                orientation = 'diagonal';
                width = this.random(35, 55);
                height = this.random(25, 40);
                left = this.random(15, 45);
                top = this.random(20, 45);

                // Gentle rotation for diagonal appearance (±25° max)
                veil.style.setProperty('--aurora-base-rotation', `${this.random(-20, 20)}deg`);
            }

            // ALIGNED: Coordinated movement patterns for fluid, cohesive flow
            // Alternate flow direction by layer for visual rhythm
            const flowDirection = i % 2 === 0 ? 1 : -1;
            const shift = this.random(15, 22) * flowDirection;
            // Layers rise together with subtle variation
            const rise = this.random(-12, -8);
            const riseVariation = this.random(-5, 5);
            // Gentler tilt synchronized with flow direction
            const tilt = this.random(6, 10) * flowDirection;
            const drift = this.random(-8, 8);

            // FLUID: Very subtle scale variation for seamless flow
            const scaleStart = this.random(0.92, 1.05);
            const scaleEnd = this.random(0.95, 1.08);
            const scaleMid = this.random(1.0, 1.12);

            // ORGANIC: More varied ellipse shapes for natural aurora forms
            const ellipseX = this.random(90, 160);
            const ellipseY = this.random(85, 125);

            // ORGANIC: Unique border-radius for each curtain's organic shape
            const shape1 = this.random(38, 62);
            const shape2 = 100 - shape1;
            const shape3 = this.random(42, 58);
            const shape4 = 100 - shape3;
            const shape5 = this.random(40, 60);
            const shape6 = 100 - shape5;
            const shape7 = this.random(38, 62);
            const shape8 = 100 - shape7;
            const organicShape = `${shape1}% ${shape2}% ${shape3}% ${shape4}% / ${shape5}% ${shape6}% ${shape7}% ${shape8}%`;

            // SUBTLE: Reduced opacity for softer, more ethereal aurora
            const baseOpacity = 0.12 + (i * 0.04);
            const opacity = this.random(baseOpacity, baseOpacity + 0.1);

            veil.style.setProperty('--aurora-hue', hue.toFixed(1));
            veil.style.setProperty('--aurora-duration', `${duration.toFixed(2)}s`);
            veil.style.setProperty('--aurora-glow', `${glow.toFixed(2)}s`);
            veil.style.setProperty('--aurora-offset', `${shift.toFixed(2)}%`);
            veil.style.setProperty('--aurora-rise', `${rise.toFixed(2)}%`);
            veil.style.setProperty('--aurora-rise-var', `${riseVariation.toFixed(2)}%`);
            veil.style.setProperty('--aurora-tilt', `${tilt.toFixed(2)}deg`);
            veil.style.setProperty('--aurora-drift', `${drift.toFixed(2)}%`);
            veil.style.setProperty('--aurora-opacity', opacity.toFixed(2));
            veil.style.setProperty('--aurora-scale-start', scaleStart.toFixed(2));
            veil.style.setProperty('--aurora-scale-end', scaleEnd.toFixed(2));
            veil.style.setProperty('--aurora-scale-mid', scaleMid.toFixed(2));
            veil.style.setProperty('--aurora-ellipse-x', `${ellipseX.toFixed(0)}%`);
            veil.style.setProperty('--aurora-ellipse-y', `${ellipseY.toFixed(0)}%`);
            veil.style.setProperty('--aurora-shape', organicShape);
            veil.dataset.initialOpacity = opacity.toFixed(2);

            // ALIGNED: Position based on orientation type
            if (orientation === 'horizontal') {
                veil.style.top = `${top}%`;
                veil.style.left = `${left}%`;
                veil.style.right = `${right}%`;
                veil.style.height = `${height}vh`;
                veil.style.width = 'auto';
            } else {
                // Diagonal curtains
                veil.style.left = `${left}%`;
                veil.style.top = `${top}%`;
                veil.style.width = `${width}vw`;
                veil.style.height = `${height}vh`;
            }

            veil.style.zIndex = `${2 + i}`;
            // SMOOTH: Staggered fade-in for each layer, with animations starting mid-cycle
            const fadeDelay = i * 0.3; // 0s, 0.3s, 0.6s, 0.9s, 1.2s for smooth cascade
            // Start animations mid-cycle with negative delays to prevent synchronized start
            const waveDelay = -this.random(0, duration);
            const glowDelay = -this.random(0, glow);
            const rippleDelay = -this.random(0, duration * 0.7);
            const morphDelay = -this.random(0, duration * 1.3);

            veil.style.animationDelay = `${fadeDelay}s, ${waveDelay.toFixed(2)}s, ${glowDelay.toFixed(2)}s, ${rippleDelay.toFixed(2)}s, ${morphDelay.toFixed(2)}s`;

            fragment.appendChild(veil);
        }

        veilContainer.appendChild(fragment);
        this.cacheAuroraCurtains();
    }

    generateAuroraShimmers() {
        const shimmerContainer = this.shimmerContainer || this.getContainer('aurora-shimmers');
        this.shimmerContainer = shimmerContainer;
        if (shimmerContainer) {
            shimmerContainer.innerHTML = '';
        }
    }

    cacheAuroraCurtains() {
        const container = this.veilContainer || this.getContainer('aurora-veil-container');
        this.veilContainer = container;
        this.cachedCurtains = container ? Array.from(container.getElementsByClassName('aurora-veil')) : [];
        return this.cachedCurtains;
    }

    getCurtains() {
        if (!this.cachedCurtains || this.cachedCurtains.length === 0) {
            return this.cacheAuroraCurtains() ?? [];
        }
        return this.cachedCurtains;
    }

    acquireWaveElement() {
        if (this.wavePool.length > 0) {
            const waveFromPool = this.wavePool.pop();
            if (waveFromPool) {
                waveFromPool.__auroraInPool = false;
            }
            return waveFromPool;
        }
        const wave = document.createElement('div');
        wave.className = 'aurora-wave';
        wave.__auroraInPool = false;
        wave.__auroraWaveHandler = (event) => {
            if (event.target !== wave) {
                return;
            }
            if (event.type === 'animationend' || event.type === 'animationcancel') {
                this.releaseWaveElement(wave);
            }
        };
        wave.addEventListener('animationend', wave.__auroraWaveHandler);
        wave.addEventListener('animationcancel', wave.__auroraWaveHandler);
        return wave;
    }

    releaseWaveElement(wave) {
        if (!wave) {
            return;
        }
        if (wave.__auroraInPool) {
            return;
        }

        this.activeWaveElements.delete(wave);
        wave.__auroraInPool = true;
        wave.style.animationDuration = '';
        wave.style.width = '';
        wave.style.left = '';
        wave.style.removeProperty('--wave-hue');
        if (wave.parentNode) {
            wave.parentNode.removeChild(wave);
        }
        if (this.wavePool.length < this.maxWavePoolSize) {
            this.wavePool.push(wave);
        }
    }

    acquireShootingStarElement() {
        if (this.shootingStarPool.length > 0) {
            const starFromPool = this.shootingStarPool.pop();
            if (starFromPool) {
                starFromPool.__auroraInPool = false;
            }
            return starFromPool;
        }
        const star = document.createElement('div');
        star.className = 'shooting-star';
        star.__auroraInPool = false;
        star.__auroraStarHandler = (event) => {
            if (event.target !== star) {
                return;
            }
            if (event.type === 'animationend' || event.type === 'animationcancel') {
                this.releaseShootingStarElement(star);
            }
        };
        star.addEventListener('animationend', star.__auroraStarHandler);
        star.addEventListener('animationcancel', star.__auroraStarHandler);
        return star;
    }

    releaseShootingStarElement(star) {
        if (!star) {
            return;
        }
        if (star.__auroraInPool) {
            return;
        }

        this.activeShootingStarElements.delete(star);
        star.__auroraInPool = true;
        star.style.left = '';
        star.style.top = '';
        star.style.removeProperty('--shooting-angle');
        star.style.animationDuration = '';
        if (star.parentNode) {
            star.parentNode.removeChild(star);
        }
        if (this.shootingStarPool.length < this.maxShootingStarPoolSize) {
            this.shootingStarPool.push(star);
        }
    }

    releaseAllTransientElements() {
        [...this.activeWaveElements].forEach((wave) => this.releaseWaveElement(wave));
        [...this.activeShootingStarElements].forEach((star) => this.releaseShootingStarElement(star));
        this.activeWaveElements.clear();
        this.activeShootingStarElements.clear();
    }

    resetCurtainStates() {
        const curtains = this.getCurtains();
        curtains.forEach((curtain) => {
            curtain.style.filter = '';
            curtain.style.transition = '';
        });
    }

    resetStarStates() {
        this.stars.forEach((star) => {
            if (!star) return;
            const baseOpacity = star.style.getPropertyValue('--base-opacity') || star.style.opacity || '0.6';
            star.style.transition = '';
            star.style.opacity = baseOpacity;
        });
    }

    runTimeout(callback, delay) {
        const id = setTimeout(() => {
            this.activeTimeouts.delete(id);
            callback();
        }, delay);
        this.activeTimeouts.add(id);
        return id;
    }

    clearActiveTimeouts() {
        this.activeTimeouts.forEach((id) => clearTimeout(id));
        this.activeTimeouts.clear();
    }

    getTimestamp() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyGraphicsPreset(quality) {
        if (!this.graphicsQualityPresets) {
            return;
        }

        const preset =
            this.graphicsQualityPresets[quality] ||
            this.graphicsQualityPresets.High ||
            this.graphicsQualityPresets.Ultra;

        if (!preset) {
            return;
        }

        const defaults = this.baseQualitySettings || {};
        this.currentQuality = quality;
        this.activePreset = preset;

        this.maxConcurrentWaves = preset.maxConcurrentWaves ?? defaults.maxConcurrentWaves ?? this.maxConcurrentWaves;
        this.waveCooldownMs = preset.waveCooldownMs ?? defaults.waveCooldownMs ?? this.waveCooldownMs;
        this.waveStaggerMs = preset.waveStaggerMs ?? defaults.waveStaggerMs ?? this.waveStaggerMs;
        this.maxConcurrentShootingStars =
            preset.maxConcurrentShootingStars ?? defaults.maxConcurrentShootingStars ?? this.maxConcurrentShootingStars;
        this.shootingStarCooldownMs =
            preset.shootingStarCooldownMs ?? defaults.shootingStarCooldownMs ?? this.shootingStarCooldownMs;
        this.starTwinkleChance = preset.starTwinkleChance ?? defaults.starTwinkleChance ?? this.starTwinkleChance;
        this.starTwinkleCooldownMs =
            preset.starTwinkleCooldownMs ?? defaults.starTwinkleCooldownMs ?? this.starTwinkleCooldownMs;

        this.syncStarField(preset);
        this.updateCurtainSettings(preset);
        this.updateShimmerSettings(preset);
    }

    syncStarField(preset) {
        const container = this.starsContainer;
        if (!container) return;

        const targetCount = preset.starCount ?? this.stars.length;
        while (this.stars.length > targetCount) {
            const star = this.stars.pop();
            if (star && star.parentNode) {
                star.parentNode.removeChild(star);
            }
        }

        while (this.stars.length < targetCount) {
            const newStar = this.createStarElement();
            container.appendChild(newStar);
            this.stars.push(newStar);
        }

        const opacityMultiplier = preset.starOpacityMultiplier ?? 1;
        this.stars.forEach((star) => {
            if (!star) return;
            const base =
                parseFloat(star.dataset.initialOpacity) ||
                parseFloat(star.style.getPropertyValue('--base-opacity')) ||
                0.6;
            const adjusted = Math.min(base * opacityMultiplier, 1);
            star.style.setProperty('--base-opacity', adjusted.toFixed(2));
            star.style.opacity = adjusted.toFixed(2);
        });
    }

    updateCurtainSettings(preset) {
        const curtains = this.getCurtains();
        if (!curtains || curtains.length === 0) return;

        const visibleLayers = Math.min(preset.curtainLayers ?? curtains.length, curtains.length);
        const opacityMultiplier = preset.curtainOpacityMultiplier ?? 1;

        curtains.forEach((curtain, index) => {
            if (!curtain) return;
            curtain.style.display = index < visibleLayers ? '' : 'none';
            const baseOpacity =
                parseFloat(curtain.dataset.initialOpacity) ||
                parseFloat(curtain.style.getPropertyValue('--aurora-opacity')) ||
                0.3;
            const adjusted = Math.min(baseOpacity * opacityMultiplier, 1.1);
            curtain.style.setProperty('--aurora-opacity', adjusted.toFixed(2));
        });
    }

    updateShimmerSettings(preset) {
        if (!this.shimmerContainer) return;
        this.shimmerContainer.style.display = preset.enableShimmers === false ? 'none' : '';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event?.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) {
                return;
            }
            this.applyGraphicsPreset(newQuality);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    restartAnimation(element) {
        if (!element) return;
        element.style.animation = 'none';
        void element.offsetHeight;
        element.style.animation = '';
    }

    debugLog(...args) {
        if (this.debugLogging) {
            console.log(...args);
        }
    }

    /**
     * Provide Aurora themed tetromino styling (matching aurora ribbons)
     * @returns {Object} Aurora tetromino configuration
     */
    getTetrominoConfig() {
        return AURORA_TETROMINOS;
    }
}

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

// Cache buster v2024-10-12-23:05
export default class AuroraTheme extends BaseTheme {
    constructor() {
        super('aurora');
        console.log('[Aurora] Constructor called!');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.stars = [];
        console.log('[Aurora] Constructor complete!');
    }

    async createScene() {
        console.log('[Aurora] createScene() called!');
        
        try {
            // NOTE: This is a simplified version of the aurora theme
            // The original implementation is highly complex with dynamic keyframes and color cycling
            // For full functionality, additional work may be needed to port all dynamic animations

            const starsContainer = document.getElementById('aurora-stars');
            console.log('[Aurora] Stars container found:', !!starsContainer);
            if (starsContainer && starsContainer.children.length === 0) {
                const fragment = document.createDocumentFragment();
                // ENHANCED: More stars for richer starfield
                const starCount = 150;
                for (let i = 0; i < starCount; i++) {
                    const star = document.createElement('div');
                    star.className = 'aurora-star';

                    // ENHANCED: Varied star sizes for depth perception
                    const starType = Math.random();
                    let size, opacity, twinkleSpeed;

                    if (starType < 0.6) {
                        // Distant stars (60%) - small and dim
                        size = this.random(0.8, 1.4);
                        opacity = this.random(0.2, 0.5);
                        twinkleSpeed = this.random(6, 10);
                    } else if (starType < 0.9) {
                        // Mid-distance stars (30%) - medium
                        size = this.random(1.4, 2);
                        opacity = this.random(0.4, 0.7);
                        twinkleSpeed = this.random(5, 8);
                    } else {
                        // Close bright stars (10%) - large and bright
                        size = this.random(2, 3);
                        opacity = this.random(0.6, 0.9);
                        twinkleSpeed = this.random(4, 7);
                    }

                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${this.random(0, 100)}%`;
                    star.style.top = `${this.random(0, 70)}%`; // ENHANCED: Stars mostly in upper 70%
                    star.style.setProperty('--base-opacity', opacity.toFixed(2));
                    star.style.opacity = opacity.toFixed(2);
                    star.style.animationDuration = `${twinkleSpeed}s`;
                    star.style.animationDelay = `${this.random(0, twinkleSpeed)}s`;

                    fragment.appendChild(star);
                    this.stars.push(star);
                }
                starsContainer.appendChild(fragment);
                this.registerContainer(starsContainer);
            }

            this.generateAuroraCurtains();
            this.generateAuroraShimmers();
            
            // Setup event listeners for reactive effects
            console.log('[Aurora] About to setup event listeners...');
            this.setupEventListeners();
            console.log('[Aurora] Event listeners setup complete!');
            
            console.log('[Aurora] createScene() completed successfully!');
        } catch (error) {
            console.error('[Aurora] ERROR in createScene():', error);
            throw error;
        }
    }
    
    setupEventListeners() {
        console.log('[Aurora] Setting up event listeners');
        
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            console.log('[Aurora] LINE_CLEAR event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });
        
        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            console.log('[Aurora] COMBO event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });
        
        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            console.log('[Aurora] PIECE_LOCK event received, isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });
        
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[Aurora] Event listeners set up successfully');
    }
    
    /**
     * React to line clears with aurora waves
     */
    onLineClear(lineCount) {
        console.log('[Aurora] onLineClear called with lineCount:', lineCount);
        
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
        console.log('[Aurora] onCombo called with comboCount:', comboCount);
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
        // Subtle star twinkle on piece lock (30% chance)
        if (Math.random() < 0.3) {
            this.twinkleStar();
        }
    }
    
    /**
     * Create aurora wave effects
     */
    createAuroraWaves(intensity) {
        const veilContainer = document.getElementById('aurora-veil-container');
        if (!veilContainer) {
            console.warn('[Aurora] Veil container not found!');
            return;
        }
        
        const waveCount = Math.min(intensity, 4);
        console.log('[Aurora] Creating', waveCount, 'aurora waves');
        
        for (let i = 0; i < waveCount; i++) {
            setTimeout(() => {
                const wave = document.createElement('div');
                wave.className = 'aurora-wave';
                
                const hue = 120 + Math.random() * 60; // Green to purple range
                const duration = 2 + Math.random();
                const width = 60 + intensity * 10;
                
                wave.style.setProperty('--wave-hue', hue);
                wave.style.animationDuration = `${duration}s`;
                wave.style.width = `${width}%`;
                wave.style.left = `${Math.random() * 40 - 20}%`;
                
                veilContainer.appendChild(wave);
                
                setTimeout(() => {
                    if (wave.parentNode) {
                        wave.parentNode.removeChild(wave);
                    }
                }, duration * 1000);
            }, i * 200);
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
                
                setTimeout(() => {
                    star.style.opacity = originalOpacity;
                }, 300 + Math.random() * 200);
            }
        }
    }
    
    /**
     * Pulse aurora curtains
     */
    pulseCurtains(intensity) {
        const curtains = document.querySelectorAll('.aurora-veil');
        curtains.forEach((curtain, index) => {
            setTimeout(() => {
                curtain.style.transition = 'filter 0.4s ease-out';
                curtain.style.filter = `brightness(${1 + intensity * 0.3}) blur(${15 + intensity * 2}px)`;
                
                setTimeout(() => {
                    curtain.style.filter = '';
                }, 400);
            }, index * 100);
        });
    }
    
    /**
     * Intensify aurora on combos
     */
    intensifyAurora(comboCount) {
        const theme = document.getElementById('aurora-theme');
        if (!theme) return;
        
        const saturation = 100 + Math.min(comboCount * 15, 75);
        const brightness = 100 + Math.min(comboCount * 10, 40);
        const hueShift = Math.min(comboCount * 10, 60);
        
        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%) hue-rotate(${hueShift}deg)`;
        
        setTimeout(() => {
            theme.style.filter = '';
        }, 1000 + comboCount * 100);
    }
    
    /**
     * Create shooting star effect
     */
    createShootingStar(comboCount) {
        const starsContainer = document.getElementById('aurora-stars');
        if (!starsContainer) return;
        
        const shootingStarCount = Math.min(comboCount - 2, 3);
        
        for (let i = 0; i < shootingStarCount; i++) {
            setTimeout(() => {
                const shootingStar = document.createElement('div');
                shootingStar.className = 'shooting-star';
                
                const startX = Math.random() * 100;
                const startY = Math.random() * 50;
                
                shootingStar.style.left = `${startX}%`;
                shootingStar.style.top = `${startY}%`;
                shootingStar.style.setProperty('--shooting-angle', `${-30 + Math.random() * 20}deg`);
                shootingStar.style.animationDuration = `${0.8 + Math.random() * 0.4}s`;
                
                starsContainer.appendChild(shootingStar);
                
                setTimeout(() => {
                    if (shootingStar.parentNode) {
                        shootingStar.parentNode.removeChild(shootingStar);
                    }
                }, 1500);
            }, i * 300);
        }
    }
    
    /**
     * Shift aurora colors based on combo
     */
    shiftAuroraColors(comboCount) {
        const curtains = document.querySelectorAll('.aurora-veil');
        curtains.forEach((curtain) => {
            const currentHue = parseFloat(curtain.style.getPropertyValue('--aurora-hue')) || 130;
            const hueShift = comboCount * 15;
            const newHue = (currentHue + hueShift) % 360;
            
            curtain.style.transition = `--aurora-hue ${comboCount * 0.2}s ease-out`;
            curtain.style.setProperty('--aurora-hue', newHue);
            
            setTimeout(() => {
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
            
            setTimeout(() => {
                star.style.opacity = originalOpacity;
            }, 200);
        }
    }
    
    stop() {
        // Unsubscribe from all events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
        
        // Reset combo level
        this.currentComboLevel = 0;
        
        // Clear any active effects
        const theme = document.getElementById('aurora-theme');
        if (theme) {
            theme.style.filter = '';
        }
        
        super.stop();
    }

    generateAuroraCurtains() {
        const veilContainer = this.getContainer('aurora-veil-container');
        if (!veilContainer || veilContainer.children.length > 0) return;

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
    }

    generateAuroraShimmers() {
        const shimmerContainer = this.getContainer('aurora-shimmers');
        if (shimmerContainer) {
            shimmerContainer.innerHTML = '';
        }
    }
}

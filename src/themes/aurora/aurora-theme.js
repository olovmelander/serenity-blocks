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
                const starCount = 48;
                for (let i = 0; i < starCount; i++) {
                    const star = document.createElement('div');
                    star.className = 'aurora-star';
                    const size = this.random(0.6, 1.2);
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${this.random(0, 100)}%`;
                    star.style.top = `${this.random(0, 100)}%`;
                    star.style.opacity = `${this.random(0.3, 0.8).toFixed(2)}`;
                    star.style.animationDelay = `${this.random(0, 8)}s`;
                    fragment.appendChild(star);
                    this.stars.push(star); // Store reference for reactive effects
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
            if (this.isActive) {
                this.onLineClear(data.lineCount);
            }
        });
        
        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            console.log('[Aurora] COMBO event received:', data, 'isActive:', this.isActive);
            if (this.isActive) {
                this.onCombo(data.comboCount);
            }
        });
        
        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            console.log('[Aurora] PIECE_LOCK event received, isActive:', this.isActive);
            if (this.isActive) {
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

        const layerCount = 2;
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < layerCount; i++) {
            const veil = document.createElement('div');
            veil.className = 'aurora-veil';

            const hue = this.random(120, 140);
            const duration = this.random(18, 24);
            const glow = this.random(7, 9);
            const shift = this.random(3, 8);
            const rise = this.random(-6, -3);
            const tilt = this.random(-3, 3);
            const opacity = this.random(0.25, 0.38);
            const height = this.random(40, 48);
            const top = this.random(22, 32);
            const leftOffset = this.random(-4, 4);

            veil.style.setProperty('--aurora-hue', hue.toFixed(1));
            veil.style.setProperty('--aurora-duration', `${duration.toFixed(2)}s`);
            veil.style.setProperty('--aurora-glow', `${glow.toFixed(2)}s`);
            veil.style.setProperty('--aurora-offset', `${shift.toFixed(2)}%`);
            veil.style.setProperty('--aurora-rise', `${rise.toFixed(2)}%`);
            veil.style.setProperty('--aurora-tilt', `${tilt.toFixed(2)}deg`);
            veil.style.setProperty('--aurora-opacity', opacity.toFixed(2));
            veil.style.setProperty('--aurora-height', `${height.toFixed(2)}vh`);
            const insetTop = top.toFixed(2);
            const insetLeft = (-15 + leftOffset).toFixed(2);
            veil.style.setProperty(
                '--aurora-inset',
                `${insetTop}% ${insetLeft}% auto ${insetLeft}%`,
            );
            veil.style.zIndex = `${2 + i}`;
            veil.style.animationDelay = `${this.random(0, 4).toFixed(2)}s`;

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

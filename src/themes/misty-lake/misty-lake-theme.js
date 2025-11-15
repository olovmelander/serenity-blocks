import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { MISTY_LAKE_TETROMINOS } from './misty-lake-tetrominos.js';

// Cache buster v2024-10-12-23:00
export default class MistyLakeTheme extends BaseTheme {
    constructor() {
        super('misty-lake');
        console.log('[MistyLake] Constructor called!');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        console.log('[MistyLake] Constructor complete!');
    }

    async createScene() {
        console.log('[MistyLake] createScene() called!');
        console.log('[MistyLake] isActive:', this.isActive);
        
        try {
            // NOTE: Simplified version - see script.js lines 6303-6456 for full implementation

            // Drifting clouds
            const cloudsContainer = document.getElementById('misty-clouds');
            console.log('[MistyLake] Clouds container found:', !!cloudsContainer);
            if (cloudsContainer && cloudsContainer.children.length === 0) {
                for (let i = 0; i < 6; i++) {
                    const cloud = document.createElement('div');
                    cloud.className = 'misty-cloud';
                    cloud.style.left = `${Math.random() * 120 - 20}%`;
                    cloud.style.top = `${Math.random() * 30 + 5}%`;
                    cloud.style.setProperty('--cloud-drift', `${Math.random() * 30 + 20}vw`);
                    const size = Math.random() * 150 + 100;
                    cloud.style.width = `${size}px`;
                    cloud.style.height = `${size * 0.4}px`;
                    const duration = Math.random() * 200 + 300;
                    cloud.style.animationDuration = `${duration}s`;
                    cloud.style.animationDelay = `-${Math.random() * duration}s`;
                    cloudsContainer.appendChild(cloud);
                }
                this.registerContainer(cloudsContainer);
            }

            // Setup event listeners for reactive effects
            console.log('[MistyLake] About to setup event listeners...');
            this.setupEventListeners();
            console.log('[MistyLake] Event listeners setup complete!');
            
            // Initialize mist container
            console.log('[MistyLake] About to initialize mist container...');
            this.initializeMistContainer();
            console.log('[MistyLake] Mist container initialized!');
            
            console.log('[MistyLake] createScene() completed successfully!');
        } catch (error) {
            console.error('[MistyLake] ERROR in createScene():', error);
            throw error;
        }
    }
    
    setupEventListeners() {
        console.log('[MistyLake] Setting up event listeners');
        
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            console.log('[MistyLake] LINE_CLEAR event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });
        
        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            console.log('[MistyLake] COMBO event received:', data, 'isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });
        
        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            console.log('[MistyLake] PIECE_LOCK event received, isActive:', this.isActive);
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });
        
        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[MistyLake] Event listeners set up successfully');
    }
    
    initializeMistContainer() {
        const mistContainer = document.getElementById('misty-mist');
        if (mistContainer) {
            this.mistContainer = mistContainer;
            this.registerContainer(mistContainer);
        }
    }
    
    /**
     * React to line clears with water ripples
     */
    onLineClear(lineCount) {
        console.log('[MistyLake] onLineClear called with lineCount:', lineCount);
        
        // Create water ripples on the lake surface
        this.createWaterRipples(lineCount);
        
        // Flash the sky/water based on line count
        this.flashWater(lineCount);
        
        // Maybe spawn a fish for big clears
        if (lineCount >= 3) {
            console.log('[MistyLake] Spawning fish (lineCount >= 3)');
            this.spawnFish();
        }
    }
    
    /**
     * React to combos with mist bursts and color shifts
     */
    onCombo(comboCount) {
        this.currentComboLevel = comboCount;
        
        // Create mist bursts
        this.createMistBurst(comboCount);
        
        // Intensify atmosphere colors
        this.intensifyAtmosphere(comboCount);
        
        // Big combo? Make birds fly
        if (comboCount >= 3) {
            this.spawnBirds(comboCount);
        }
    }
    
    /**
     * React to piece locks with subtle ripples
     */
    onPieceLock(piece) {
        // Small ripple on piece lock
        if (Math.random() < 0.3) { // 30% chance
            this.createSmallRipple();
        }
    }
    
    /**
     * Create expanding water ripples on the lake
     */
    createWaterRipples(intensity = 1) {
        const ripplesContainer = document.getElementById('misty-lake-ripples');
        console.log('[MistyLake] createWaterRipples - container found:', !!ripplesContainer, 'intensity:', intensity);
        if (!ripplesContainer) {
            console.warn('[MistyLake] Ripples container not found!');
            return;
        }
        
        const rippleCount = Math.min(intensity * 2, 8);
        console.log('[MistyLake] Creating', rippleCount, 'ripples');
        
        for (let i = 0; i < rippleCount; i++) {
            setTimeout(() => {
                const ripple = document.createElement('div');
                ripple.className = 'water-ripple';
                
                // Random position across the lake
                const x = 20 + Math.random() * 60; // 20-80% across
                const y = 55 + Math.random() * 20; // In the water area
                
                ripple.style.left = `${x}%`;
                ripple.style.top = `${y}%`;
                const baseWidth = 140 + intensity * 60;
                const baseHeight = baseWidth * 0.45;
                ripple.style.setProperty('--ripple-width', `${baseWidth}px`);
                ripple.style.setProperty('--ripple-height', `${baseHeight}px`);
                ripple.style.setProperty('--ripple-size', `${baseWidth}px`);
                ripple.style.animationDuration = `${1.5 + Math.random()}s`;
                
                ripplesContainer.appendChild(ripple);
                
                // Remove after animation
                setTimeout(() => {
                    if (ripple.parentNode) {
                        ripple.parentNode.removeChild(ripple);
                    }
                }, 2000);
            }, i * 150); // Stagger ripples
        }
    }
    
    /**
     * Create a small ripple effect
     */
    createSmallRipple() {
        const ripplesContainer = document.getElementById('misty-lake-ripples');
        if (!ripplesContainer) return;
        
        const ripple = document.createElement('div');
        ripple.className = 'water-ripple small';
        
        const x = 30 + Math.random() * 40;
        const y = 60 + Math.random() * 15;
        
        ripple.style.left = `${x}%`;
        ripple.style.top = `${y}%`;
        ripple.style.setProperty('--ripple-width', '70px');
        ripple.style.setProperty('--ripple-height', '30px');
        ripple.style.setProperty('--ripple-size', '50px');
        ripple.style.opacity = '0.3';
        
        ripplesContainer.appendChild(ripple);
        
        setTimeout(() => {
            if (ripple.parentNode) {
                ripple.parentNode.removeChild(ripple);
            }
        }, 1500);
    }
    
    /**
     * Flash the water/sky on line clears
     */
    flashWater(intensity) {
        const lakeElement = document.querySelector('.misty-lake');
        if (!lakeElement) return;
        
        const flashIntensity = Math.min(intensity / 4, 1);
        lakeElement.style.filter = `brightness(${1 + flashIntensity * 0.3})`;
        
        setTimeout(() => {
            lakeElement.style.filter = '';
        }, 200);
    }
    
    /**
     * Create rising mist bursts for combos
     */
    createMistBurst(comboCount) {
        if (!this.mistContainer) return;
        
        const burstCount = Math.min(comboCount, 5);
        
        for (let i = 0; i < burstCount; i++) {
            setTimeout(() => {
                const mistColumn = document.createElement('div');
                mistColumn.className = 'mist-column burst';
                
                const x = 10 + Math.random() * 80;
                mistColumn.style.left = `${x}%`;
                mistColumn.style.setProperty('--mist-width', `${8 + comboCount * 2}vw`);
                mistColumn.style.animationDuration = `${1.5 - comboCount * 0.1}s`;
                mistColumn.style.opacity = `${0.4 + comboCount * 0.1}`;
                
                this.mistContainer.appendChild(mistColumn);
                
                setTimeout(() => {
                    if (mistColumn.parentNode) {
                        mistColumn.parentNode.removeChild(mistColumn);
                    }
                }, 2000);
            }, i * 200);
        }
    }
    
    /**
     * Intensify atmosphere colors based on combo
     */
    intensifyAtmosphere(comboCount) {
        const theme = document.getElementById('misty-lake-theme');
        if (!theme) return;
        
        // Calculate color intensification
        const hueShift = Math.min(comboCount * 5, 30);
        const saturation = 100 + Math.min(comboCount * 10, 50);
        const brightness = 100 + Math.min(comboCount * 5, 25);
        
        theme.style.filter = `hue-rotate(${hueShift}deg) saturate(${saturation}%) brightness(${brightness}%)`;
        
        // Fade back to normal
        setTimeout(() => {
            theme.style.filter = '';
        }, 800 + comboCount * 100);
    }
    
    /**
     * Spawn a fish jumping out of water
     */
    spawnFish() {
        const fishContainer = document.getElementById('misty-fish');
        if (!fishContainer) return;
        
        const fish = document.createElement('div');
        fish.className = 'lake-fish';
        
        const x = 20 + Math.random() * 60;
        fish.style.left = `${x}%`;
        fish.style.animationDuration = `${2 + Math.random()}s`;
        
        fishContainer.appendChild(fish);
        
        setTimeout(() => {
            if (fish.parentNode) {
                fish.parentNode.removeChild(fish);
            }
        }, 3000);
    }
    
    /**
     * Spawn birds flying across
     */
    spawnBirds(comboCount) {
        const birdsContainer = document.getElementById('misty-birds');
        if (!birdsContainer) return;
        
        const birdCount = Math.min(comboCount, 4);
        
        for (let i = 0; i < birdCount; i++) {
            setTimeout(() => {
                const bird = document.createElement('div');
                bird.className = 'misty-bird';
                
                const y = 10 + Math.random() * 30;
                bird.style.top = `${y}%`;
                bird.style.animationDuration = `${3 + Math.random() * 2}s`;
                bird.style.animationDelay = '0s';
                
                birdsContainer.appendChild(bird);
                
                setTimeout(() => {
                    if (bird.parentNode) {
                        bird.parentNode.removeChild(bird);
                    }
                }, 6000);
            }, i * 400);
        }
    }
    
    stop() {
        // Unsubscribe from all events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
        
        // Reset combo level
        this.currentComboLevel = 0;
        
        // Clear any active effects
        const theme = document.getElementById('misty-lake-theme');
        if (theme) {
            theme.style.filter = '';
        }
        
        super.stop();
    }

    /**
     * Provide Misty Lake themed tetromino styling (tranquil moonlit palette)
     * @returns {Object} Misty Lake tetromino configuration
     */
    getTetrominoConfig() {
        return MISTY_LAKE_TETROMINOS;
    }
}

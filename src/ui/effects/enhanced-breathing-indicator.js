/**
 * Enhanced Breathing Indicator - The most beautiful breathing guide ever created
 *
 * Features:
 * - Multiple concentric circles with independent animations
 * - Dynamic color transitions (blue → purple → pink → gold)
 * - Particle effects that sync with breathing rhythm
 * - Glow effects and ethereal shadows
 * - Smooth easing with perfect timing
 * - Multiple breathing techniques with descriptions
 */

import { ThreeJSBreathingRenderer } from './threejs-breathing-renderer.js';

export class EnhancedBreathingIndicator {
    constructor(container) {
        this.container = container;
        this.isActive = false;
        this.animationFrame = null;
        this.currentPhase = 'inhale';
        this.phaseStartTime = 0;
        this.showText = true;
        this.particles = [];
        this.maxParticles = 50; // More particles for stunning effect
        this.selectorVisible = false;
        this.selectorTimeout = null;

        // Breathing techniques with detailed info
        this.techniques = {
            'deep-relaxation': {
                name: 'Aurora Dreams',
                pattern: [5, 2, 7, 2], // Long exhale for parasympathetic activation
                description: 'Northern lights flow through you • Deep peace',
                color: { r: 80, g: 200, b: 255 }, // Aurora cyan
                secondaryColor: { r: 180, g: 100, b: 255 }, // Aurora purple
                tertiaryColor: { r: 100, g: 255, b: 180 }, // Aurora green
            },
            'box-breathing': {
                name: 'Sacred Geometry',
                pattern: [4, 4, 4, 4], // Equal timing for focus
                description: 'Ancient patterns align your mind • Perfect balance',
                color: { r: 200, g: 150, b: 255 }, // Mystical purple
                secondaryColor: { r: 255, g: 200, b: 100 }, // Golden
                tertiaryColor: { r: 100, g: 200, b: 255 }, // Sky blue
            },
            'calm-sleep': {
                name: 'Moonlit Waters',
                pattern: [4, 7, 8, 0], // Dr. Weil's technique
                description: 'Drift on silver waves under starlight • Deep sleep',
                color: { r: 150, g: 180, b: 255 }, // Moonlight blue
                secondaryColor: { r: 255, g: 255, b: 220 }, // Soft white
                tertiaryColor: { r: 100, g: 120, b: 200 }, // Deep night
            },
            energizing: {
                name: 'Solar Flare',
                pattern: [3, 1, 3, 1], // Faster for energy
                description: 'Channel the sun\'s explosive power • Pure energy',
                color: { r: 255, g: 180, b: 50 }, // Solar orange
                secondaryColor: { r: 255, g: 255, b: 150 }, // Bright yellow
                tertiaryColor: { r: 255, g: 100, b: 50 }, // Deep orange
            },
            coherence: {
                name: 'Heart Glow',
                pattern: [5, 0, 5, 0], // 6 breaths per minute
                description: 'Your heart radiates healing light • Love flows',
                color: { r: 255, g: 100, b: 150 }, // Heart pink
                secondaryColor: { r: 255, g: 180, b: 200 }, // Soft rose
                tertiaryColor: { r: 200, g: 50, b: 100 }, // Deep rose
            },
            triangle: {
                name: 'Crystal Prism',
                pattern: [4, 0, 4, 4], // Three-sided pattern
                description: 'Light refracts through your being • Clarity',
                color: { r: 150, g: 255, b: 255 }, // Crystal cyan
                secondaryColor: { r: 255, g: 150, b: 255 }, // Crystal pink
                tertiaryColor: { r: 255, g: 255, b: 150 }, // Crystal yellow
            },
            'wim-hof': {
                name: 'Volcanic Fire',
                pattern: [2, 0, 1, 0], // Short, powerful breathing
                description: 'Molten power surges through you • Unstoppable',
                color: { r: 255, g: 80, b: 30 }, // Lava orange
                secondaryColor: { r: 255, g: 200, b: 50 }, // Bright flame
                tertiaryColor: { r: 200, g: 30, b: 30 }, // Deep ember
            },
            'ocean-breath': {
                name: 'Ocean Tide',
                pattern: [4, 0, 4, 0], // Ujjayi-inspired
                description: 'Waves crash and recede within you • Infinite calm',
                color: { r: 30, g: 150, b: 200 }, // Ocean blue
                secondaryColor: { r: 100, g: 220, b: 255 }, // Seafoam
                tertiaryColor: { r: 20, g: 80, b: 120 }, // Deep ocean
            },
            'zen-garden': {
                name: 'Zen Garden',
                pattern: [6, 3, 6, 3], // Slow, meditative
                description: 'Ripples spread across still water • Pure presence',
                color: { r: 180, g: 200, b: 180 }, // Sage green
                secondaryColor: { r: 220, g: 220, b: 200 }, // Sand
                tertiaryColor: { r: 100, g: 120, b: 100 }, // Stone
            },
            'cosmic-breath': {
                name: 'Cosmic Nebula',
                pattern: [5, 3, 5, 3], // Expansive
                description: 'Stars are born within your breath • Infinite',
                color: { r: 150, g: 50, b: 200 }, // Nebula purple
                secondaryColor: { r: 255, g: 100, b: 150 }, // Nebula pink
                tertiaryColor: { r: 50, g: 150, b: 255 }, // Nebula blue
            },
            'forest-breath': {
                name: 'Ancient Forest',
                pattern: [4, 2, 6, 2], // Grounding
                description: 'Breathe with thousand-year trees • Rooted strength',
                color: { r: 50, g: 180, b: 100 }, // Forest green
                secondaryColor: { r: 150, g: 100, b: 50 }, // Bark brown
                tertiaryColor: { r: 200, g: 255, b: 150 }, // Sunlit leaves
            },
            'electric-storm': {
                name: 'Electric Storm',
                pattern: [3, 2, 4, 1], // Dynamic, energetic
                description: 'Channel lightning through your veins • Raw power',
                color: { r: 100, g: 150, b: 255 }, // Electric blue
                secondaryColor: { r: 200, g: 100, b: 255 }, // Purple lightning
                tertiaryColor: { r: 255, g: 255, b: 200 }, // Lightning white
            },
        };

        this.currentTechnique = 'deep-relaxation';
        this.technique = this.techniques[this.currentTechnique];
        this.pattern = this.technique.pattern;

        // Create UI elements
        this._createElements();
        this._createParticles();
        this._preloadWebGL();
    }

    /**
     * Create DOM elements for breathing indicator
     * @private
     */
    _createElements() {
        // Backdrop for visibility
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'breathing-backdrop';
        this.backdrop.style.display = 'none';

        // Main container
        this.indicator = document.createElement('div');
        this.indicator.id = 'enhanced-breathing-indicator';
        this.indicator.className = 'enhanced-breathing-indicator';
        this.indicator.style.display = 'none';

        // Content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'breathing-content-wrapper';

        // Visual container for all breathing elements
        const visualContainer = document.createElement('div');
        visualContainer.className = 'breathing-visual-container';

        // Particle canvas (now WebGL)
        this.particleCanvas = document.createElement('canvas');
        this.particleCanvas.className = 'breathing-particles';
        this.particleCanvas.width = 700;
        this.particleCanvas.height = 700;

        // Initialize Three.js Renderer (replaces old WebGL 2D renderer)
        this.threeRenderer = new ThreeJSBreathingRenderer(visualContainer);

        // Outer glow ring (slowest)
        this.outerRing = document.createElement('div');
        this.outerRing.className = 'breathing-ring breathing-ring-outer';

        // Middle ring (medium speed)
        this.middleRing = document.createElement('div');
        this.middleRing.className = 'breathing-ring breathing-ring-middle';

        // Inner ring (fastest)
        this.innerRing = document.createElement('div');
        this.innerRing.className = 'breathing-ring breathing-ring-inner';

        // Core circle (main focus point)
        this.coreCircle = document.createElement('div');
        this.coreCircle.className = 'breathing-core';

        // Text prompt (now absolutely positioned in center)
        this.textPrompt = document.createElement('div');
        this.textPrompt.className = 'breathing-text-enhanced';
        this.textPrompt.textContent = 'Breathe';

        // Floating text for session guidance (main prompt)
        this.floatingText = document.createElement('div');
        this.floatingText.className = 'breathing-floating-text';
        this.floatingText.style.opacity = '0';
        this.floatingText.textContent = '';

        // Sub-floating text for secondary guidance
        this.subFloatingText = document.createElement('div');
        this.subFloatingText.className = 'breathing-floating-subtext';
        this.subFloatingText.style.opacity = '0';
        this.subFloatingText.textContent = '';

        // Assemble visual elements
        visualContainer.appendChild(this.particleCanvas);
        visualContainer.appendChild(this.outerRing);
        visualContainer.appendChild(this.middleRing);
        visualContainer.appendChild(this.innerRing);
        visualContainer.appendChild(this.coreCircle);
        visualContainer.appendChild(this.textPrompt);
        // visualContainer.appendChild(this.floatingText); // Moved to main indicator for better positioning

        // Technique name display (top)
        this.techniqueName = document.createElement('div');
        this.techniqueName.className = 'breathing-technique-name';
        this.techniqueName.textContent = this.technique.name;

        // Add hover event to show description
        this.techniqueName.addEventListener('mouseenter', () => {
            this._showTechniqueInfo(5000);
        });

        // Technique description (bottom)
        this.techniqueDesc = document.createElement('div');
        this.techniqueDesc.className = 'breathing-technique-desc';
        this.techniqueDesc.textContent = this.technique.description;

        // Technique selector
        this.techniqueSelector = this._createTechniqueSelector();

        // Assemble content wrapper
        contentWrapper.appendChild(this.techniqueName);
        contentWrapper.appendChild(visualContainer);
        contentWrapper.appendChild(this.techniqueDesc);
        contentWrapper.appendChild(this.techniqueSelector);

        // Create hover area for bottom of screen
        this.hoverArea = document.createElement('div');
        this.hoverArea.className = 'breathing-hover-area';
        this.hoverArea.style.display = 'none';

        // Assemble main indicator
        this.indicator.appendChild(this.hoverArea);
        this.indicator.appendChild(contentWrapper);
        this.indicator.appendChild(this.floatingText); // Append directly to indicator for screen-relative positioning
        this.indicator.appendChild(this.subFloatingText); // Sub-prompt below main floating text

        // Add to DOM
        this.container.appendChild(this.backdrop);
        this.container.appendChild(this.indicator);

        // === SESSION PROGRESS UI ===
        this._createProgressUI();

        console.log('[EnhancedBreathingIndicator] Elements created with stunning design');
    }

    /**
     * Create technique selector UI
     * @private
     */
    _createTechniqueSelector() {
        const selector = document.createElement('div');
        selector.className = 'breathing-technique-selector';

        const techniqueKeys = Object.keys(this.techniques);
        techniqueKeys.forEach((key) => {
            const button = document.createElement('button');
            button.className = 'technique-button';
            button.dataset.technique = key;
            button.textContent = this.techniques[key].name;

            if (key === this.currentTechnique) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                this.setTechnique(key);
                this._updateSelectorButtons();
            });

            selector.appendChild(button);
        });

        return selector;
    }

    /**
     * Update technique selector button states
     * @private
     */
    _updateSelectorButtons() {
        const buttons = this.techniqueSelector.querySelectorAll('.technique-button');
        buttons.forEach((button) => {
            if (button.dataset.technique === this.currentTechnique) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    /**
     * Create particle system
     * @private
     */
    _createParticles() {
        this.particles = [];
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                angle: (Math.PI * 2 * i) / this.maxParticles,
                distance: 0,
                speed: 0.02 + Math.random() * 0.03,
                size: 2 + Math.random() * 3,
                alpha: 0,
                rotationSpeed: (Math.random() - 0.5) * 0.02,
            });
        }
    }

    /**
     * Preload WebGL context and shaders asynchronously
     * @private
     */
    _preloadWebGL() {
        const preload = () => {
            console.log('[EnhancedBreathingIndicator] Preloading Three.js resources...');
            if (this.threeRenderer) {
                this.threeRenderer.init();
            }
        };

        // Run preload during idle time when available to reduce long-task warnings.
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(preload, { timeout: 2500 });
            return;
        }

        // Delay initialization locally to avoid blocking main thread during app startup
        setTimeout(preload, 1000);
    }

    /**
     * Start the breathing indicator animation
     */
    start() {
        if (this.isActive) {
            console.log('[EnhancedBreathingIndicator] Already active');
            return;
        }

        console.log('[EnhancedBreathingIndicator] Starting with technique:', this.currentTechnique);
        this.isActive = true;

        // Initialize Three.js if needed
        if (this.threeRenderer) {
            this.threeRenderer.init();
            this.threeRenderer.setTechnique(this.currentTechnique, this.technique);
            this.threeRenderer.start();
        }

        // Show backdrop, indicator, and hover area
        this.backdrop.style.display = 'block';
        this.indicator.style.display = 'block';
        this.hoverArea.style.display = 'block';

        // Setup keyboard listener for info display
        this._setupKeyboardListener();

        // Show technique info briefly at start (selector is now in Serenity Hub)
        this._showTechniqueInfo(3000);

        this.phaseStartTime = performance.now();
        this.currentPhase = 'inhale';

        this._animate();
    }

    /**
     * Stop the breathing indicator animation
     */
    stop() {
        if (!this.isActive) return;

        this.isActive = false;

        // Hide backdrop, indicator, and hover area
        this.backdrop.style.display = 'none';
        this.indicator.style.display = 'none';
        this.hoverArea.style.display = 'none';

        // Clean up keyboard listener
        this._removeKeyboardListener();

        // Clear selector timeout
        if (this.selectorTimeout) {
            clearTimeout(this.selectorTimeout);
            this.selectorTimeout = null;
        }

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Stop Three.js renderer
        if (this.threeRenderer) {
            this.threeRenderer.stop();
        }
    }

    /**
     * Toggle visibility
     */
    toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    }

    /**
     * Set breathing technique
     * @param {string} techniqueName - Key from techniques object
     * @param {boolean} showInfo - Whether to show the technique info (default: true)
     */
    setTechnique(techniqueName, showInfo = true) {
        if (this.techniques[techniqueName]) {
            this.currentTechnique = techniqueName;
            this.technique = this.techniques[techniqueName];
            this.pattern = this.technique.pattern;

            // Update UI
            this.techniqueName.textContent = this.technique.name;
            this.techniqueDesc.textContent = this.technique.description;
            this._updateSelectorButtons();

            // Update Three.js Renderer
            if (this.threeRenderer) {
                this.threeRenderer.setTechnique(this.currentTechnique, this.technique);
            }

            // Show technique info briefly (selector is now in Serenity Hub)
            if (showInfo) {
                this._showTechniqueInfo(3000);
            }

            // Restart animation with new pattern
            if (this.isActive) {
                this.phaseStartTime = performance.now();
                this.currentPhase = 'inhale';
            }

            console.log('[EnhancedBreathingIndicator] Technique changed to:', this.technique.name);
        }
    }

    /**
     * Cycle to next or previous breathing technique
     * @param {number} direction - 1 for next, -1 for previous
     */
    cycleTechnique(direction = 1) {
        const techniqueKeys = Object.keys(this.techniques);
        const currentIndex = techniqueKeys.indexOf(this.currentTechnique);
        let newIndex = currentIndex + direction;

        // Wrap around
        if (newIndex < 0) newIndex = techniqueKeys.length - 1;
        if (newIndex >= techniqueKeys.length) newIndex = 0;

        this.setTechnique(techniqueKeys[newIndex], true);
    }

    /**
     * Set whether to show text prompts
     * @param {boolean} show
     */
    setShowText(show) {
        this.showText = show;
        this.textPrompt.style.display = show ? 'block' : 'none';
    }

    /**
     * Enable or disable external control
     * @param {boolean} enabled
     */
    setExternalControl(enabled) {
        this.isExternallyControlled = enabled;
        if (enabled) {
            // Hide technique selector when externally controlled
            this.techniqueSelector.style.display = 'none';
            this.techniqueName.style.display = 'none';
            this.techniqueDesc.style.display = 'none';
        } else {
            this.techniqueSelector.style.display = 'flex';
            this.techniqueName.style.display = 'block';
            this.techniqueDesc.style.display = 'block';
            // Restore current technique pattern
            this.pattern = this.technique.pattern;
        }
    }

    /**
     * Override breathing pattern dynamically
     * @param {number[]} newPattern - [inhale, hold1, exhale, hold2]
     */
    overridePattern(newPattern) {
        this.pattern = newPattern;
        // Restart phase to sync with new pattern
        this.phaseStartTime = performance.now();
        this.currentPhase = 'inhale';
    }

    /**
     * Reset the breathing cycle to the start of the pattern (Inhale)
     * Used to sync visual breathing with audio cues
     */
    resetCycle() {
        if (!this.isActive) return;
        this.phaseStartTime = performance.now();
        this.currentPhase = 'inhale';
        console.log('[EnhancedBreathingIndicator] Cycle reset manually to Inhale');
    }

    /**
     * Set custom text prompt (Floating text) with optional sub-prompt
     * @param {string} text - Main prompt text
     * @param {string} subText - Optional secondary guidance text
     */
    setPrompt(text, subText = '') {
        this.customPrompt = text;
        this.floatingText.textContent = text;

        // Animate in/out if text changes
        if (text) {
            this.floatingText.style.opacity = '1';
            this.floatingText.style.transform = 'translate(-50%, 0)'; // Reset transform
        } else {
            this.floatingText.style.opacity = '0';
        }

        // Handle sub-prompt
        if (this.subFloatingText) {
            this.subFloatingText.textContent = subText;
            this.subFloatingText.style.opacity = subText ? '0.8' : '0';
        }
    }

    /**
 * Set session-specific color theme
 * @param {string} sessionType - 'BASE', 'ELIXIR', 'REST', or 'FLOW'
 */
    setSessionTheme(sessionType) {
        // Clear all session classes first
        this.indicator.classList.remove('session-base', 'session-elixir', 'session-rest', 'session-flow');

        if (sessionType === 'BASE') {
            this.sessionColor = { r: 100, g: 200, b: 255 }; // Calm blue
            this.sessionGlow = 'rgba(100, 200, 255, 0.4)';
            this.indicator.classList.add('session-base');
        } else if (sessionType === 'ELIXIR') {
            this.sessionColor = { r: 255, g: 100, b: 100 }; // Energetic red
            this.sessionGlow = 'rgba(255, 100, 100, 0.4)';
            this.indicator.classList.add('session-elixir');
        } else if (sessionType === 'REST') {
            this.sessionColor = { r: 150, g: 130, b: 200 }; // Soft purple
            this.sessionGlow = 'rgba(150, 130, 200, 0.4)';
            this.indicator.classList.add('session-rest');
        } else if (sessionType === 'FLOW') {
            this.sessionColor = { r: 100, g: 220, b: 180 }; // Balanced teal
            this.sessionGlow = 'rgba(100, 220, 180, 0.4)';
            this.indicator.classList.add('session-flow');
        } else {
            // Clear session theme
            this.sessionColor = null;
            this.sessionGlow = null;
        }
    }

    /**
     * Main animation loop
     * @private
     */
    _animate() {
        if (!this.isActive) return;

        const now = performance.now();
        const elapsed = (now - this.phaseStartTime) / 1000;

        // Get current phase duration
        const [inhale, hold1, exhale, hold2] = this.pattern;
        let phaseDuration;
        let nextPhase;
        let phaseText;

        // Determine current phase
        if (this.currentPhase === 'inhale') {
            phaseDuration = inhale;
            nextPhase = hold1 > 0 ? 'hold1' : 'exhale';
            phaseText = 'Breathe In';
        } else if (this.currentPhase === 'hold1') {
            phaseDuration = hold1;
            nextPhase = 'exhale';
            phaseText = 'Hold';
        } else if (this.currentPhase === 'exhale') {
            phaseDuration = exhale;
            nextPhase = hold2 > 0 ? 'hold2' : 'inhale';
            phaseText = 'Breathe Out';
        } else { // hold2
            phaseDuration = hold2;
            nextPhase = 'inhale';
            phaseText = 'Hold';
        }

        // Check if phase is complete
        if (elapsed >= phaseDuration) {
            const previousPhase = this.currentPhase;
            this.currentPhase = nextPhase;
            this.phaseStartTime = now;

            // Fire phase change callback if registered
            if (this.onPhaseChangeCallback) {
                this.onPhaseChangeCallback(nextPhase, previousPhase);
            }

            this.animationFrame = requestAnimationFrame(() => this._animate());
            return;
        }

        // Calculate progress through current phase (0 to 1)
        const progress = elapsed / phaseDuration;

        // Calculate intensity
        const intensity = this._calculateIntensity(progress, 0.3);

        // Update Three.js Renderer
        if (this.threeRenderer) {
            this.threeRenderer.updateIntensity(intensity, this.currentPhase);
        }

        // Update DOM rings (keep these for UI consistency)
        this._updateRings(intensity);
        this._updateColors(progress);

        // Update text if enabled
        // Update text if enabled
        if (this.showText) {
            // Center text ALWAYS shows phase text (Breathe In/Out/Hold)
            this.textPrompt.textContent = phaseText;

            // Floating text shows custom prompt (handled in setPrompt)
            // No drift animation needed for fixed position
            if (this.customPrompt) {
                // Optional: Add subtle pulse or glow if desired
            }
        }

        // Continue animation
        this.animationFrame = requestAnimationFrame(() => this._animate());
    }

    /**
     * Calculate intensity based on phase for seamless transitions
     * @param {number} progress - Current phase progress (0 to 1)
     * @param {number} restingIntensity - Intensity during empty hold (default: 0.3)
     * @returns {number} - Calculated intensity
     * @private
     */
    _calculateIntensity(progress, restingIntensity = 0.3) {
        if (this.currentPhase === 'inhale') {
            return restingIntensity + (1 - restingIntensity) * this._easeInOutQuart(progress);
        } if (this.currentPhase === 'hold1') {
            return 1;
        } if (this.currentPhase === 'exhale') {
            return 1 - (1 - restingIntensity) * this._easeInOutQuart(progress);
        } // hold2
        return restingIntensity;
    }

    /**
     * Update DOM rings based on intensity
     * @private
     */
    _updateRings(intensity) {
        const scale = 0.3 + intensity * 0.7;

        // Apply transforms
        this.outerRing.style.transform = `translate(-50%, -50%) scale(${scale * 1.3})`;
        this.outerRing.style.opacity = intensity * 0.3;

        this.middleRing.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.middleRing.style.opacity = intensity * 0.5;

        this.innerRing.style.transform = `translate(-50%, -50%) scale(${scale * 0.7})`;
        this.innerRing.style.opacity = intensity * 0.7;

        this.coreCircle.style.transform = `translate(-50%, -50%) scale(${scale * 0.5})`;
        this.coreCircle.style.opacity = intensity;
    }

    /**
     * Route to technique-specific animation
     * @private
     */
    _animateTechniqueSpecific(progress) {
        // Technique-specific animations are handled by ThreeJSBreathingRenderer
    }

    /**
     * Update colors based on phase
     * @private
     */
    _updateColors(progress) {
        const { color } = this.technique;
        const baseColor = `${color.r}, ${color.g}, ${color.b}`;

        // Update CSS custom properties for dynamic colors
        this.indicator.style.setProperty('--breath-color-r', color.r);
        this.indicator.style.setProperty('--breath-color-g', color.g);
        this.indicator.style.setProperty('--breath-color-b', color.b);

        // Adjust brightness based on phase
        let brightness = 1.0;
        if (this.currentPhase === 'inhale') {
            brightness = 0.7 + progress * 0.3;
        } else if (this.currentPhase === 'exhale') {
            brightness = 1.0 - progress * 0.3;
        }

        this.indicator.style.setProperty('--breath-brightness', brightness);
    }

    /**
     * Ease in-out quartic function for ultra-smooth animation
     * @param {number} t - Progress (0 to 1)
     * @returns {number} - Eased value (0 to 1)
     * @private
     */
    _easeInOutQuart(t) {
        return t < 0.5
            ? 8 * t * t * t * t
            : 1 - (-2 * t + 2) ** 4 / 2;
    }

    /**
     * Setup keyboard listener for selector toggle
     * @private
     */
    _setupKeyboardListener() {
        this._handleKeyPress = (event) => {
            if (event.key.toLowerCase() === 's') {
                this.toggleSelector();
                event.preventDefault();
            } else if (event.key.toLowerCase() === 'i') {
                // Show technique info (description)
                this._showTechniqueInfo(5000);
                event.preventDefault();
            }
        };
        document.addEventListener('keydown', this._handleKeyPress);
    }

    /**
     * Remove keyboard listener
     * @private
     */
    _removeKeyboardListener() {
        if (this._handleKeyPress) {
            document.removeEventListener('keydown', this._handleKeyPress);
            this._handleKeyPress = null;
        }
    }

    /**
     * Toggle selector visibility
     */
    toggleSelector() {
        this.selectorVisible = !this.selectorVisible;

        if (this.selectorVisible) {
            this.techniqueSelector.classList.add('visible');

            // Clear any pending auto-hide
            if (this.selectorTimeout) {
                clearTimeout(this.selectorTimeout);
                this.selectorTimeout = null;
            }
        } else {
            this.techniqueSelector.classList.remove('visible');
        }
    }

    /**
     * Show selector temporarily, then hide
     * @param {number} duration - How long to show in milliseconds
     * @private
     */
    _showSelectorTemporarily(duration = 3000) {
        // Clear any existing timeout
        if (this.selectorTimeout) {
            clearTimeout(this.selectorTimeout);
        }

        // Show selector AND description
        this.techniqueSelector.classList.add('visible');
        this.techniqueDesc.classList.add('visible');
        this.selectorVisible = true;

        // Auto-hide after duration
        this.selectorTimeout = setTimeout(() => {
            this.techniqueSelector.classList.remove('visible');
            this.techniqueDesc.classList.remove('visible');
            this.selectorVisible = false;
            this.selectorTimeout = null;
        }, duration);
    }

    /**
     * Show technique name and description (without selector)
     * @param {number} duration - How long to show in milliseconds
     * @private
     */
    _showTechniqueInfo(duration = 3000) {
        // Clear any existing timeout
        if (this.selectorTimeout) {
            clearTimeout(this.selectorTimeout);
        }

        // Show only description, name is already visible
        this.techniqueDesc.classList.add('visible');
        this.techniqueName.classList.add('visible-temp');

        // Auto-hide after duration
        this.selectorTimeout = setTimeout(() => {
            this.techniqueDesc.classList.remove('visible');
            this.techniqueName.classList.remove('visible-temp');
            this.selectorTimeout = null;
        }, duration);
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stop();

        // Remove backdrop
        if (this.backdrop && this.backdrop.parentElement) {
            this.backdrop.parentElement.removeChild(this.backdrop);
        }

        // Remove indicator
        if (this.indicator && this.indicator.parentElement) {
            this.indicator.parentElement.removeChild(this.indicator);
        }
    }

    // =============================================
    // SESSION PROGRESS UI METHODS
    // =============================================

    /**
     * Create session progress UI elements
     * @private
     */
    _createProgressUI() {
        // Progress container (positioned at very bottom of screen)
        this.progressContainer = document.createElement('div');
        this.progressContainer.className = 'session-progress-container';
        this.progressContainer.style.cssText = `
            position: fixed;
            bottom: 15px;
            left: 50%;
            transform: translateX(-50%);
            display: none;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            z-index: 10001;
            pointer-events: none;
        `;

        // Compact round indicator (smaller, less prominent)
        this.roundIndicator = document.createElement('div');
        this.roundIndicator.className = 'session-round-indicator';
        this.roundIndicator.style.cssText = `
            font-family: 'Inter', 'Segoe UI', sans-serif;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 1.5px;
            color: rgba(255, 255, 255, 0.6);
            text-transform: uppercase;
        `;
        this.roundIndicator.textContent = '';

        // Breath dots container (compact)
        this.breathDotsContainer = document.createElement('div');
        this.breathDotsContainer.className = 'session-breath-dots';
        this.breathDotsContainer.style.cssText = `
            display: flex;
            gap: 3px;
            justify-content: center;
            flex-wrap: wrap;
            max-width: 250px;
        `;

        // Progress bar container (thin and subtle)
        this.progressBarContainer = document.createElement('div');
        this.progressBarContainer.className = 'session-progress-bar-container';
        this.progressBarContainer.style.cssText = `
            width: 180px;
            height: 3px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 2px;
            overflow: hidden;
        `;

        // Progress bar fill
        this.progressBarFill = document.createElement('div');
        this.progressBarFill.className = 'session-progress-bar-fill';
        this.progressBarFill.style.cssText = `
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #00d4ff, #7c3aed);
            border-radius: 2px;
            transition: width 0.3s ease;
        `;
        this.progressBarContainer.appendChild(this.progressBarFill);

        // Assemble progress container (simplified - no phase badge to avoid duplication)
        this.progressContainer.appendChild(this.roundIndicator);
        this.progressContainer.appendChild(this.breathDotsContainer);
        this.progressContainer.appendChild(this.progressBarContainer);

        // Add to DOM
        this.container.appendChild(this.progressContainer);

        // Initialize state
        this._progressState = {
            visible: false,
            totalBreaths: 0,
            currentBreath: 0,
        };
    }

    /**
     * Show/hide session progress UI
     * @param {boolean} show
     */
    showProgress(show) {
        if (this.progressContainer) {
            this.progressContainer.style.display = show ? 'flex' : 'none';
            this._progressState.visible = show;
        }
    }

    /**
     * Update session progress display
     * @param {object} data - Progress data from session manager
     * @param {string} data.phase - Current phase type (grounding, active, retention, recovery, integration)
     * @param {number} data.round - Current round number
     * @param {number} data.totalRounds - Total rounds in session
     * @param {number} data.breathCount - Current breath count in phase
     * @param {number} data.totalBreaths - Total breaths in current phase
     * @param {number} data.sessionProgress - Overall session progress (0-1)
     * @param {object} data.sessionColor - Session theme color {r, g, b}
     */
    updateProgress(data) {
        if (!this.progressContainer) return;

        // Update round indicator
        if (data.round !== undefined && data.totalRounds !== undefined) {
            if (data.round === 0) {
                // Don't show text for round 0 phases (grounding/integration) - existing floating text handles it
                this.roundIndicator.textContent = '';
            } else {
                this.roundIndicator.textContent = `ROUND ${data.round}/${data.totalRounds}`;
            }
        }

        // Update breath dots
        if (data.totalBreaths !== undefined && data.totalBreaths !== this._progressState.totalBreaths) {
            this._createBreathDots(data.totalBreaths);
            this._progressState.totalBreaths = data.totalBreaths;
        }
        if (data.breathCount !== undefined) {
            this._updateBreathDots(data.breathCount);
            this._progressState.currentBreath = data.breathCount;
        }

        // Update progress bar
        if (data.sessionProgress !== undefined) {
            this.progressBarFill.style.width = `${Math.min(100, data.sessionProgress * 100)}%`;
        }

        // Update progress bar color to match session theme
        if (data.sessionColor) {
            const { r, g, b } = data.sessionColor;
            this.progressBarFill.style.background = `linear-gradient(90deg, rgb(${r}, ${g}, ${b}), rgba(${r}, ${g}, ${b}, 0.6))`;
        }
    }

    /**
     * Create breath dots for current phase
     * @param {number} count - Total number of breaths
     * @private
     */
    _createBreathDots(count) {
        if (!this.breathDotsContainer) return;
        this.breathDotsContainer.innerHTML = '';

        // Limit visible dots for high breath counts
        const maxDots = 20;
        const displayCount = Math.min(count, maxDots);
        const groupSize = count > maxDots ? Math.ceil(count / maxDots) : 1;

        for (let i = 0; i < displayCount; i++) {
            const dot = document.createElement('div');
            dot.className = 'breath-dot';
            dot.dataset.index = i;
            dot.dataset.group = groupSize;
            dot.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                transition: background 0.3s ease, transform 0.2s ease;
            `;
            this.breathDotsContainer.appendChild(dot);
        }
    }

    /**
     * Update breath dots to reflect current count
     * @param {number} currentBreath - Current breath number
     * @private
     */
    _updateBreathDots(currentBreath) {
        if (!this.breathDotsContainer) return;

        const dots = this.breathDotsContainer.querySelectorAll('.breath-dot');
        const groupSize = parseInt(dots[0]?.dataset.group) || 1;

        dots.forEach((dot, index) => {
            const dotThreshold = (index + 1) * groupSize;
            const isComplete = currentBreath >= dotThreshold;
            const isActive = currentBreath >= index * groupSize && currentBreath < dotThreshold;

            if (isComplete) {
                dot.style.background = 'rgba(255, 255, 255, 0.9)';
                dot.style.transform = 'scale(1)';
                dot.style.boxShadow = '0 0 8px rgba(255, 255, 255, 0.5)';
            } else if (isActive) {
                dot.style.background = 'rgba(255, 255, 255, 0.5)';
                dot.style.transform = 'scale(1.2)';
                dot.style.boxShadow = '0 0 12px rgba(255, 255, 255, 0.7)';
            } else {
                dot.style.background = 'rgba(255, 255, 255, 0.2)';
                dot.style.transform = 'scale(1)';
                dot.style.boxShadow = 'none';
            }
        });
    }
}

// Export singleton instance
let enhancedBreathingIndicatorInstance = null;

/**
 * Get or create enhanced breathing indicator instance
 * @returns {EnhancedBreathingIndicator}
 */
export function getEnhancedBreathingIndicator() {
    if (!enhancedBreathingIndicatorInstance) {
        enhancedBreathingIndicatorInstance = new EnhancedBreathingIndicator(document.body);
    }
    return enhancedBreathingIndicatorInstance;
}

/**
 * Initialize enhanced breathing indicator (called from main.js)
 */
export function initEnhancedBreathingIndicator() {
    return getEnhancedBreathingIndicator();
}

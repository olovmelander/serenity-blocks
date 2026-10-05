/**
 * Breath timing, accessible phase cues and a lazily loaded visual world.
 * The CSS shapes keep essential guidance available without WebGL.
 */
import { BREATHING_GUIDANCE } from './breathing-guidance.js';

// APP BOOT (2026-08-21): the three.js breathing renderer is the ONLY static path from main.js
// to 'three' — keep it out of the menu boot closure because nothing draws it
// until the indicator starts. Loaded only on deliberate first use.
let rendererModulePromise = null;
function loadBreathingRendererModule() {
    if (!rendererModulePromise) {
        rendererModulePromise = import('./threejs-breathing-renderer.js');
    }
    return rendererModulePromise;
}

export class EnhancedBreathingIndicator {
    constructor(container) {
        this.container = container;
        this.isActive = false;
        this.animationFrame = null;
        this.currentPhase = 'inhale';
        this.phaseStartTime = 0;
        this.showText = true;
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
        this._isPaused = false;
        this._visibilityHandler = () => {
            if (!this.isActive || this._isPaused) return;
            if (document.hidden) {
                this._hiddenAt = performance.now();
                if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            } else if (this._hiddenAt !== null && this._hiddenAt !== undefined) {
                if (!this.isExternallyControlled) this.phaseStartTime += performance.now() - this._hiddenAt;
                this._hiddenAt = null;
                this._animate();
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
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
        this.indicator.dataset.technique = this.currentTechnique;

        // Content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'breathing-content-wrapper';

        // Visual container for all breathing elements
        const visualContainer = document.createElement('div');
        visualContainer.className = 'breathing-visual-container';

        // Three.js Renderer is created lazily on first start() (SB-07);
        // keep the container reference it needs.
        this.visualContainer = visualContainer;
        this.threeRenderer = null;

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
        this.textPrompt.textContent = 'Breathe in';
        this.textPrompt.setAttribute('role', 'status');
        this.textPrompt.setAttribute('aria-live', 'polite');
        this.textPrompt.setAttribute('aria-atomic', 'true');

        this.phaseCountdown = document.createElement('div');
        this.phaseCountdown.className = 'breathing-phase-countdown';
        this.phaseCountdown.setAttribute('aria-hidden', 'true');
        this.phaseDetail = document.createElement('div');
        this.phaseDetail.className = 'breathing-phase-detail';
        this.phaseDetail.textContent = BREATHING_GUIDANCE[this.currentTechnique][0];
        this.phaseDetail.setAttribute('aria-hidden', 'true');

        const ns = 'http://www.w3.org/2000/svg';
        this.phaseTrack = document.createElementNS(ns, 'svg');
        this.phaseTrack.classList.add('breathing-phase-track');
        this.phaseTrack.setAttribute('viewBox', '0 0 100 2');
        this.phaseTrack.setAttribute('aria-hidden', 'true');
        const track = document.createElementNS(ns, 'line');
        track.setAttribute('x1', '2'); track.setAttribute('y1', '1');
        track.setAttribute('x2', '98'); track.setAttribute('y2', '1');
        track.classList.add('breathing-phase-track-base');
        this.phaseArc = track.cloneNode();
        this.phaseArc.classList.remove('breathing-phase-track-base');
        this.phaseArc.classList.add('breathing-phase-track-fill');
        this.phaseArc.setAttribute('pathLength', '1');
        this.phaseTrack.append(track, this.phaseArc);

        this.phaseSteps = document.createElement('div');
        this.phaseSteps.className = 'breathing-phase-steps';
        this.phaseStepNodes = ['inhale', 'hold1', 'exhale', 'hold2'].map((phase, i) => {
            const node = document.createElement('span');
            node.className = 'breathing-phase-step';
            node.dataset.phase = phase;
            node.textContent = ['Inhale', 'Hold', 'Exhale', 'Rest'][i];
            this.phaseSteps.appendChild(node);
            return node;
        });
        this.sessionPhaseLabel = document.createElement('div');
        this.sessionPhaseLabel.className = 'breathing-session-phase';

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
        visualContainer.appendChild(this.outerRing);
        visualContainer.appendChild(this.middleRing);
        visualContainer.appendChild(this.innerRing);
        visualContainer.appendChild(this.coreCircle);
        visualContainer.append(this.phaseTrack, this.textPrompt, this.phaseCountdown, this.phaseDetail);
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
        contentWrapper.append(this.phaseSteps, this.sessionPhaseLabel);
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
     * Start the breathing indicator animation
     */
    start() {
        if (this.isActive) {
            console.log('[EnhancedBreathingIndicator] Already active');
            return;
        }

        console.log('[EnhancedBreathingIndicator] Starting with technique:', this.currentTechnique);
        if (this._destroyed) return;
        this.isActive = true;
        this._isPaused = false;
        this._hiddenAt = null;
        this.backdrop.style.display = 'block';
        this.indicator.style.display = 'block';
        this.indicator.classList.remove('breathing-renderer-ready', 'breathing-paused');
        this._updateColors(0);

        // Lazily create the Three.js renderer on first use (SB-07) — from a lazily LOADED
        // module: the first start() attaches it when the chunk resolves.
        if (this.threeRenderer) {
            try {
                this.threeRenderer.init();
                this.threeRenderer.setTechnique(this.currentTechnique, this.technique);
                this.threeRenderer.setSessionPhase(this.sessionPhase);
                this.threeRenderer.start();
                this.indicator.classList.toggle('breathing-renderer-ready', !this.threeRenderer.contextLost);
            } catch (error) {
                this._handleRendererFailure(error);
            }
        } else {
            this._rendererStartToken = (this._rendererStartToken || 0) + 1;
            const startToken = this._rendererStartToken;
            loadBreathingRendererModule().then(({ ThreeJSBreathingRenderer }) => {
                if (this._destroyed || !this.isActive || startToken !== this._rendererStartToken) return; // stopped meanwhile
                if (!this.threeRenderer) this.threeRenderer = new ThreeJSBreathingRenderer(this.visualContainer);
                this.threeRenderer.init();
                this.threeRenderer.setTechnique(this.currentTechnique, this.technique);
                this.threeRenderer.setSessionPhase(this.sessionPhase);
                if (!this._isPaused) this.threeRenderer.start();
                this.indicator.classList.toggle('breathing-renderer-ready', !this.threeRenderer.contextLost);
            }).catch((error) => this._handleRendererFailure(error));
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

    _handleRendererFailure(error) {
        this.indicator.classList.remove('breathing-renderer-ready');
        const renderer = this.threeRenderer;
        this.threeRenderer = null;
        try { renderer?.dispose(); } catch { /* A partially initialized context may already be lost. */ }
        console.warn('[EnhancedBreathingIndicator] Three.js renderer unavailable:', error?.message || error);
    }

    /**
     * Stop the breathing indicator animation
     */
    stop() {
        if (!this.isActive) return;

        this.isActive = false;
        this._isPaused = false;
        this._rendererStartToken = (this._rendererStartToken || 0) + 1;
        this._hiddenAt = null;
        this.indicator.classList.remove('breathing-paused');

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
            this.indicator.dataset.technique = techniqueName;
            this._updateColors(0);

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
        if (this.isExternallyControlled) return;
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
        this.phaseCountdown.style.display = show ? 'block' : 'none';
        this.phaseDetail.style.display = show ? 'block' : 'none';
    }

    /**
     * Enable or disable external control
     * @param {boolean} enabled
     */
    setExternalControl(enabled) {
        this.isExternallyControlled = enabled;
        this.indicator.classList.toggle('breathing-guided-session', enabled);
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
        if (!Array.isArray(newPattern) || newPattern.length !== 4
            || newPattern.some((duration) => !Number.isFinite(duration) || duration < 0)
            || !newPattern.some((duration) => duration > 0)) return;
        this.pattern = [...newPattern];
        this.phaseStartTime = performance.now();
        this.currentPhase = ['inhale', 'hold1', 'exhale', 'hold2'][newPattern.findIndex((duration) => duration > 0)];
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

    pause() {
        if (!this.isActive || this._isPaused) return;
        this._isPaused = true;
        this._pausedAt = this._hiddenAt ?? performance.now();
        if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
        this.threeRenderer?.stop();
        this.indicator.classList.add('breathing-paused');
    }

    resume() {
        if (!this.isActive || !this._isPaused) return;
        this.phaseStartTime += performance.now() - this._pausedAt;
        this._isPaused = false;
        this._hiddenAt = document.hidden ? performance.now() : null;
        this.indicator.classList.remove('breathing-paused');
        this.threeRenderer?.start();
        if (!document.hidden) this._animate();
    }

    setSessionPhase(type, progress = 0) {
        this.sessionPhase = type;
        this.indicator.dataset.sessionPhase = type || '';
        this._writeText(this.sessionPhaseLabel, {
            grounding: 'Arrive · Grounding',
            active: 'Find your rhythm',
            retention: 'Stillness · Retention',
            recovery: 'Return · Recovery',
            integration: 'Rest · Integration',
        }[type] || '');
        this._writeStyle(this.indicator, '--session-phase-progress', Math.max(0, Math.min(1, progress)));
        this.threeRenderer?.setSessionPhase(type);
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
        if (!this.isActive || this._isPaused || document.hidden) return;
        const now = performance.now();
        const phases = ['inhale', 'hold1', 'exhale', 'hold2'];
        const previousPhase = this.currentPhase;
        let index = phases.indexOf(this.currentPhase);
        if (index < 0) index = 0;
        let elapsed = Math.max(0, (now - this.phaseStartTime) / 1000);
        const cycle = this.pattern.reduce((sum, duration) => sum + duration, 0);
        if (elapsed > cycle * 2) {
            // Skip whole missed cycles after a long suspension; don't replay stale voice cues.
            const missedCycles = Math.floor(elapsed / cycle) - 1;
            this.phaseStartTime += missedCycles * cycle * 1000;
            elapsed -= missedCycles * cycle;
        }
        // Keep fractional overshoot and skip empty phases in this frame. Resolve all
        // missed boundaries before notifying audio so a resumed tab never replays
        // old inhale/exhale instructions during its current hold.
        let crossings = 0;
        while (elapsed >= this.pattern[index] && crossings < 16) {
            const duration = this.pattern[index];
            elapsed -= duration;
            this.phaseStartTime += duration * 1000;
            do { index = (index + 1) % 4; } while (this.pattern[index] === 0);
            this.currentPhase = phases[index];
            crossings += 1;
        }
        if (crossings > 0) this.onPhaseChangeCallback?.(this.currentPhase, previousPhase);
        const duration = this.pattern[index];
        const progress = Math.min(1, elapsed / duration);
        const intensity = this._calculateIntensity(progress, 0.3);
        this.threeRenderer?.updateIntensity(intensity, this.currentPhase, progress);
        this._updateRings(intensity);
        this._updateColors(progress);
        const labels = {
            inhale: 'Breathe in', hold1: 'Hold gently', exhale: 'Breathe out', hold2: 'Rest gently',
        };
        const phaseLabel = this.currentPhase === 'hold2' && this.sessionPhase === 'retention'
            ? 'Hold gently' : labels[this.currentPhase];
        this._writeText(this.textPrompt, phaseLabel);
        this._writeText(this.phaseCountdown, `${Math.ceil(Math.max(0, duration - elapsed))}`);
        const guidance = BREATHING_GUIDANCE[this.currentTechnique] || BREATHING_GUIDANCE['deep-relaxation'];
        this._writeText(this.phaseDetail, {
            inhale: guidance[0],
            hold1: 'Let the light settle',
            exhale: guidance[1],
            hold2: this.sessionPhase === 'retention' ? 'A quiet moment within' : 'A quiet moment between breaths',
        }[this.currentPhase]);
        this._writeStyle(this.phaseArc, 'strokeDasharray', `${progress.toFixed(4)} 1`);
        this.phaseStepNodes.forEach((node, i) => {
            this._writeText(node, ['Inhale', 'Hold', 'Exhale', this.sessionPhase === 'retention' ? 'Hold' : 'Rest'][i]);
            node.hidden = this.pattern[i] === 0;
            node.classList.toggle('active', i === index);
        });
        this.indicator.dataset.breathPhase = this.currentPhase;
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
        const scale = 0.68 + intensity * 0.32;
        this._writeStyle(this.outerRing, 'transform', `translate(-50%, -50%) scale(${scale.toFixed(4)})`);
        this._writeStyle(this.middleRing, 'transform', `translate(-50%, -50%) scale(${(scale * 0.84).toFixed(4)})`);
        this._writeStyle(this.innerRing, 'transform', `translate(-50%, -50%) scale(${(scale * 0.64).toFixed(4)})`);
        this._writeStyle(this.coreCircle, 'transform', `translate(-50%, -50%) scale(${scale.toFixed(4)})`);
        this._writeStyle(this.indicator, '--breath-intensity', intensity.toFixed(4));
    }

    _presentationFor(node) {
        if (!this._presentationCache) this._presentationCache = new WeakMap();
        let values = this._presentationCache.get(node);
        if (!values) {
            values = Object.create(null);
            this._presentationCache.set(node, values);
        }
        return values;
    }

    _writeStyle(node, property, value) {
        const values = this._presentationFor(node);
        const text = String(value);
        if (values[property] === text) return;
        if (property.startsWith('--')) node.style.setProperty(property, text);
        else node.style[property] = text;
        values[property] = text;
    }

    _writeText(node, text) {
        const values = this._presentationFor(node);
        if (values.text === text) return;
        node.textContent = text;
        values.text = text;
    }

    /**
     * Update colors based on phase
     * @private
     */
    _updateColors(progress) {
        const color = this.sessionColor || this.technique.color;
        const secondary = this.technique.secondaryColor || color;
        this._writeStyle(this.indicator, '--breath-secondary', `${secondary.r}, ${secondary.g}, ${secondary.b}`);
        // Update CSS custom properties for dynamic colors
        this._writeStyle(this.indicator, '--breath-color-r', color.r);
        this._writeStyle(this.indicator, '--breath-color-g', color.g);
        this._writeStyle(this.indicator, '--breath-color-b', color.b);

        // Adjust brightness based on phase
        let brightness = this.currentPhase === 'hold2' ? 0.7 : 1.0;
        if (this.currentPhase === 'inhale') {
            brightness = 0.7 + progress * 0.3;
        } else if (this.currentPhase === 'exhale') {
            brightness = 1.0 - progress * 0.3;
        }

        this._writeStyle(this.indicator, '--breath-brightness', brightness);
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
            if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')
                || event.ctrlKey || event.metaKey || event.altKey || this.isExternallyControlled) return;
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
        this._destroyed = true;
        this._rendererStartToken = (this._rendererStartToken || 0) + 1;
        this.stop();
        document.removeEventListener('visibilitychange', this._visibilityHandler);
        this.progressContainer?.remove();

        // Release the Three.js renderer and its GL context (SB-07)
        this.threeRenderer?.dispose();
        this.threeRenderer = null;

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
            width: 100%;
            transform: scaleX(0);
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
            this._writeStyle(this.progressContainer, 'display', show ? 'flex' : 'none');
            this._progressState.visible = show;
            if (show && this._latestProgress) this._renderProgress(this._latestProgress);
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
        this._latestProgress = { ...this._latestProgress, ...data };
        if (this._progressState.visible === false) return;
        this._renderProgress(this._latestProgress);
    }

    _renderProgress(data) {
        // Update round indicator
        if (data.round !== undefined && data.totalRounds !== undefined) {
            if (data.round === 0) {
                // Don't show text for round 0 phases (grounding/integration) - existing floating text handles it
                this._writeText(this.roundIndicator, '');
            } else {
                this._writeText(this.roundIndicator, `ROUND ${data.round}/${data.totalRounds}`);
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
            this._writeStyle(this.progressBarFill, 'transform', `scaleX(${Math.max(0, Math.min(1, data.sessionProgress))})`);
        }

        // Update progress bar color to match session theme
        if (data.sessionColor) {
            const { r, g, b } = data.sessionColor;
            this._writeStyle(
                this.progressBarFill,
                'background',
                `linear-gradient(90deg, rgb(${r}, ${g}, ${b}), rgba(${r}, ${g}, ${b}, 0.6))`,
            );
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
        this._breathDots = [];
        this._renderedBreathCount = undefined;

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
            this._breathDots.push(dot);
        }
    }

    /**
     * Update breath dots to reflect current count
     * @param {number} currentBreath - Current breath number
     * @private
     */
    _updateBreathDots(currentBreath) {
        if (!this.breathDotsContainer) return;
        if (this._renderedBreathCount === currentBreath) return;
        const dots = this._breathDots
            || (this._breathDots = Array.from(this.breathDotsContainer.querySelectorAll('.breath-dot')));
        const groupSize = parseInt(dots[0]?.dataset.group, 10) || 1;

        dots.forEach((dot, index) => {
            const dotThreshold = (index + 1) * groupSize;
            const isComplete = currentBreath >= dotThreshold;
            const isActive = currentBreath >= index * groupSize && currentBreath < dotThreshold;

            if (isComplete) {
                this._writeStyle(dot, 'background', 'rgba(255, 255, 255, 0.9)');
                this._writeStyle(dot, 'transform', 'scale(1)');
                this._writeStyle(dot, 'boxShadow', '0 0 8px rgba(255, 255, 255, 0.5)');
            } else if (isActive) {
                this._writeStyle(dot, 'background', 'rgba(255, 255, 255, 0.5)');
                this._writeStyle(dot, 'transform', 'scale(1.2)');
                this._writeStyle(dot, 'boxShadow', '0 0 12px rgba(255, 255, 255, 0.7)');
            } else {
                this._writeStyle(dot, 'background', 'rgba(255, 255, 255, 0.2)');
                this._writeStyle(dot, 'transform', 'scale(1)');
                this._writeStyle(dot, 'boxShadow', 'none');
            }
        });
        this._renderedBreathCount = currentBreath;
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

/**
 * Breathing Indicator - A visual guide for breathing exercises during Serenity Mode
 *
 * Features:
 * - Smooth pulsing circle animation
 * - Configurable breathing patterns (4-2-6-2, 4-4-4-4, 4-7-8-0)
 * - Optional text prompts ("Breathe In", "Hold", "Breathe Out")
 * - Minimal, non-intrusive design
 */

export class BreathingIndicator {
    constructor(container) {
        this.container = container;
        this.isActive = false;
        this.animationFrame = null;
        this.currentPhase = 'inhale';
        this.phaseStartTime = 0;
        this.showText = true;

        // Breathing patterns (in seconds): [inhale, hold1, exhale, hold2]
        this.patterns = {
            relaxation: [4, 2, 6, 2], // Default: promotes relaxation
            box: [4, 4, 4, 4], // Box breathing: focus and stress relief
            calm: [4, 7, 8, 0], // 4-7-8 breathing: sleep and anxiety
        };

        this.currentPattern = 'relaxation';
        this.pattern = this.patterns[this.currentPattern];

        // Create UI elements
        this._createElements();
    }

    /**
     * Create DOM elements for breathing indicator
     * @private
     */
    _createElements() {
        // Main container
        this.indicator = document.createElement('div');
        this.indicator.id = 'breathing-indicator';
        this.indicator.className = 'breathing-indicator';
        this.indicator.style.display = 'none';

        // Breathing circle
        this.circle = document.createElement('div');
        this.circle.className = 'breathing-circle';

        // Text prompt
        this.textPrompt = document.createElement('div');
        this.textPrompt.className = 'breathing-text';
        this.textPrompt.textContent = 'Breathe';

        // Assemble
        this.indicator.appendChild(this.circle);
        this.indicator.appendChild(this.textPrompt);
        this.container.appendChild(this.indicator);

        console.log('[BreathingIndicator] Elements created and appended to:', this.container);
    }

    /**
     * Start the breathing indicator animation
     */
    start() {
        if (this.isActive) {
            console.log('[BreathingIndicator] Already active, skipping start');
            return;
        }

        console.log('[BreathingIndicator] Starting breathing indicator');
        this.isActive = true;
        this.indicator.style.display = 'flex';
        this.phaseStartTime = performance.now();
        this.currentPhase = 'inhale';

        console.log('[BreathingIndicator] Display set to flex, starting animation');
        this._animate();
    }

    /**
     * Stop the breathing indicator animation
     */
    stop() {
        if (!this.isActive) return;

        this.isActive = false;
        this.indicator.style.display = 'none';

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
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
     * Set breathing pattern
     * @param {string} patternName - 'relaxation', 'box', or 'calm'
     */
    setPattern(patternName) {
        if (this.patterns[patternName]) {
            this.currentPattern = patternName;
            this.pattern = this.patterns[patternName];

            // Restart animation with new pattern
            if (this.isActive) {
                this.phaseStartTime = performance.now();
                this.currentPhase = 'inhale';
            }
        }
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
     * Main animation loop
     * @private
     */
    _animate() {
        if (!this.isActive) return;

        const now = performance.now();
        const elapsed = (now - this.phaseStartTime) / 1000; // Convert to seconds

        // Get current phase duration
        const [inhale, hold1, exhale, hold2] = this.pattern;
        let phaseDuration;
        let nextPhase;
        let phaseText;
        let targetScale;

        // Determine current phase
        if (this.currentPhase === 'inhale') {
            phaseDuration = inhale;
            nextPhase = hold1 > 0 ? 'hold1' : 'exhale';
            phaseText = 'Breathe In';
            targetScale = 1.5; // Expand
        } else if (this.currentPhase === 'hold1') {
            phaseDuration = hold1;
            nextPhase = 'exhale';
            phaseText = 'Hold';
            targetScale = 1.5; // Stay expanded
        } else if (this.currentPhase === 'exhale') {
            phaseDuration = exhale;
            nextPhase = hold2 > 0 ? 'hold2' : 'inhale';
            phaseText = 'Breathe Out';
            targetScale = 0.5; // Contract
        } else { // hold2
            phaseDuration = hold2;
            nextPhase = 'inhale';
            phaseText = 'Hold';
            targetScale = 0.5; // Stay contracted
        }

        // Check if phase is complete
        if (elapsed >= phaseDuration) {
            this.currentPhase = nextPhase;
            this.phaseStartTime = now;
            this.animationFrame = requestAnimationFrame(() => this._animate());
            return;
        }

        // Calculate progress through current phase (0 to 1)
        const progress = elapsed / phaseDuration;

        // Apply animation
        let scale;
        if (this.currentPhase === 'inhale') {
            // Ease in-out: 0.5 → 1.5
            scale = 0.5 + this._easeInOutCubic(progress) * 1.0;
        } else if (this.currentPhase === 'exhale') {
            // Ease in-out: 1.5 → 0.5
            scale = 1.5 - this._easeInOutCubic(progress) * 1.0;
        } else {
            // Hold phases: maintain current scale
            scale = targetScale;
        }

        this.circle.style.transform = `scale(${scale})`;

        // Update text if enabled
        if (this.showText) {
            this.textPrompt.textContent = phaseText;
        }

        // Continue animation
        this.animationFrame = requestAnimationFrame(() => this._animate());
    }

    /**
     * Ease in-out cubic function for smooth animation
     * @param {number} t - Progress (0 to 1)
     * @returns {number} - Eased value (0 to 1)
     * @private
     */
    _easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stop();
        if (this.indicator && this.indicator.parentElement) {
            this.indicator.parentElement.removeChild(this.indicator);
        }
    }
}

// Export singleton instance
let breathingIndicatorInstance = null;

/**
 * Get or create breathing indicator instance
 * @returns {BreathingIndicator}
 */
export function getBreathingIndicator() {
    if (!breathingIndicatorInstance) {
        breathingIndicatorInstance = new BreathingIndicator(document.body);
    }
    return breathingIndicatorInstance;
}

/**
 * Initialize breathing indicator (called from main.js)
 */
export function initBreathingIndicator() {
    return getBreathingIndicator();
}

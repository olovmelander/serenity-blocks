/**
 * BreathworkSessionManager - Manages multi-phase breathwork journeys
 * Inspired by Hale Center's "Base" and "Elixir" classes.
 */

export class BreathworkSessionManager {
    constructor(breathingIndicator) {
        this.indicator = breathingIndicator;
        this.activeSession = null;
        this.currentPhaseIndex = 0;
        this.currentRound = 0;
        this.isPaused = false;
        this.timer = null;
        this.startTime = 0;
        this.onProgressCallback = null;
        this.onCompleteCallback = null;

        // Theme Pools for Randomized Selection
        // Ensures all 12 themes are utilized across appropriate phases
        this.THEME_POOLS = {
            grounding: ['forest-breath', 'zen-garden', 'ocean-breath', 'calm-sleep'],
            active: ['energizing', 'electric-storm', 'wim-hof'],
            retention: ['box-breathing', 'triangle', 'coherence', 'cosmic-breath'],
            recovery: ['coherence', 'deep-relaxation'],
            integration: ['deep-relaxation', 'calm-sleep', 'ocean-breath', 'zen-garden']
        };

        this.lastTheme = null;

        // Session Definitions
        this.SESSIONS = {
            BASE: {
                id: 'hale-base',
                name: 'Hale Base',
                description: 'A foundational session to regulate stress and build CO2 tolerance. Focus on nose breathing.',
                duration: '20 min',
                intensity: 'Moderate',
                color: { r: 100, g: 200, b: 255 }, // Calming Blue
                phases: [
                    { type: 'grounding', duration: 180, prompt: 'Grounding: Scan your body. Release tension.' },
                    // Round 1
                    { type: 'active', breaths: 30, pattern: [4, 0, 4, 0], prompt: 'Round 1: Rhythmic breathing. In... Out...' },
                    { type: 'retention', duration: 60, prompt: 'Stop. Hold your breath (Empty lungs).' },
                    { type: 'recovery', duration: 15, prompt: 'Deep breath in. Hold and squeeze.' },
                    // Round 2
                    { type: 'active', breaths: 40, pattern: [3.5, 0, 3.5, 0], prompt: 'Round 2: Go deeper. Belly, then chest.' },
                    { type: 'retention', duration: 90, prompt: 'Exhale and hold. Be the observer.' },
                    { type: 'recovery', duration: 15, prompt: 'Deep breath in. Hold and squeeze.' },
                    // Round 3
                    { type: 'active', breaths: 40, pattern: [3, 0, 3, 0], prompt: 'Round 3: Peak intensity. Fully in, let go.' },
                    { type: 'retention', duration: 120, prompt: 'Exhale and hold. Find the stillness.' },
                    { type: 'recovery', duration: 15, prompt: 'Deep breath in. Hold and squeeze.' },
                    // Integration
                    { type: 'integration', duration: 300, prompt: 'Integration. Return to normal breathing. Do nothing.' }
                ]
            },
            ELIXIR: {
                id: 'hale-elixir',
                name: 'Hale Elixir',
                description: 'High-intensity activation. Use mouth breathing to alkalize the blood and clear the mind.',
                duration: '25 min',
                intensity: 'High',
                color: { r: 255, g: 100, b: 100 }, // Energetic Red
                phases: [
                    { type: 'grounding', duration: 180, prompt: 'Grounding: Set your intention. Energy or release?' },
                    // Round 1
                    { type: 'active', breaths: 40, pattern: [3, 0, 1, 0], prompt: 'Round 1: Mouth breathing. Powerful and rhythmic.' },
                    { type: 'retention', duration: 60, prompt: 'Stop. Hold (Empty).' },
                    { type: 'recovery', duration: 15, prompt: 'Big inhale. Squeeze to the head.' },
                    // Round 2
                    { type: 'active', breaths: 50, pattern: [2.5, 0, 1, 0], prompt: 'Round 2: Faster. Keep the loop connected.' },
                    { type: 'retention', duration: 90, prompt: 'Exhale and hold. Deep silence.' },
                    { type: 'recovery', duration: 15, prompt: 'Big inhale. Squeeze.' },
                    // Round 3
                    { type: 'active', breaths: 60, pattern: [2, 0, 1, 0], prompt: 'Round 3: Maximum capacity! Push through.' },
                    { type: 'retention', duration: 120, prompt: 'Exhale and hold. Surrender.' },
                    { type: 'recovery', duration: 15, prompt: 'Big inhale. Squeeze and release.' },
                    // Integration
                    { type: 'integration', duration: 600, prompt: 'Integration. Drift into deep restoration.' }
                ]
            }
        };
    }

    /**
     * Start a specific session
     * @param {string} sessionId - 'BASE' or 'ELIXIR'
     * @param {function} onProgress - Callback for UI updates
     * @param {function} onComplete - Callback when session ends
     */
    startSession(sessionId, onProgress, onComplete) {
        const session = this.SESSIONS[sessionId];
        if (!session) {
            console.error('Invalid session ID:', sessionId);
            return;
        }

        this.activeSession = session;
        this.currentPhaseIndex = 0;
        this.onProgressCallback = onProgress;
        this.onCompleteCallback = onComplete;
        this.isPaused = false;

        console.log(`[BreathworkSessionManager] Starting session: ${session.name}`);

        // Take control of the indicator
        if (this.indicator) {
            this.indicator.setExternalControl(true);
            this.indicator.start();
        }

        this._runPhase();
    }

    /**
     * Stop the current session
     */
    stopSession() {
        if (!this.activeSession) return;

        console.log('[BreathworkSessionManager] Stopping session');
        clearTimeout(this.timer);
        this.activeSession = null;

        // Release indicator control
        if (this.indicator) {
            this.indicator.setExternalControl(false);
            this.indicator.stop();
        }
    }

    /**
     * Run the current phase
     * @private
     */
    _runPhase() {
        if (!this.activeSession) return;

        const phase = this.activeSession.phases[this.currentPhaseIndex];

        // Update UI/Indicator
        if (this.indicator) {
            this.indicator.setPrompt(phase.prompt);

            // Select random theme from appropriate pool
            const pool = this.THEME_POOLS[phase.type] || this.THEME_POOLS['grounding'];
            let theme = pool[Math.floor(Math.random() * pool.length)];

            // Try to avoid repeating the same theme consecutively if possible
            if (this.lastTheme === theme && pool.length > 1) {
                const filteredPool = pool.filter(t => t !== theme);
                theme = filteredPool[Math.floor(Math.random() * filteredPool.length)];
            }

            this.lastTheme = theme;
            this.indicator.setTechnique(theme, false); // false = no info popup

            // Set breathing pattern based on phase type
            if (phase.type === 'active') {
                this.indicator.overridePattern(phase.pattern);
            } else if (phase.type === 'retention') {
                this.indicator.overridePattern([0, phase.duration, 0, 0]); // Long hold
            } else if (phase.type === 'recovery') {
                this.indicator.overridePattern([2, phase.duration, 2, 0]); // Inhale, hold, exhale
            } else {
                // Grounding/Integration - slow, gentle
                this.indicator.overridePattern([5, 2, 5, 2]);
            }
        }

        // Notify UI
        if (this.onProgressCallback) {
            this.onProgressCallback({
                phase: phase.type,
                prompt: phase.prompt,
                totalPhases: this.activeSession.phases.length,
                currentPhase: this.currentPhaseIndex + 1
            });
        }

        // Handle timing
        if (phase.type === 'active') {
            // For active breathing, we count breaths
            // Calculate total duration based on pattern sum * breath count
            const breathDuration = phase.pattern.reduce((a, b) => a + b, 0);
            const totalDuration = breathDuration * phase.breaths * 1000; // ms

            this.timer = setTimeout(() => this._nextPhase(), totalDuration);
        } else {
            // For fixed duration phases
            this.timer = setTimeout(() => this._nextPhase(), phase.duration * 1000);
        }
    }

    /**
     * Advance to next phase
     * @private
     */
    _nextPhase() {
        this.currentPhaseIndex++;

        if (this.currentPhaseIndex >= this.activeSession.phases.length) {
            this._completeSession();
        } else {
            this._runPhase();
        }
    }

    /**
     * Complete the session
     * @private
     */
    _completeSession() {
        console.log('[BreathworkSessionManager] Session complete');
        if (this.onCompleteCallback) {
            this.onCompleteCallback();
        }
        this.stopSession();
    }
}

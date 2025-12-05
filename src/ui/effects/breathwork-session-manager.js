/**
 * BreathworkSessionManager - Manages multi-phase breathwork journeys
 * Inspired by Hale Center's "Base" and "Elixir" classes.
 * 
 * Enhanced with:
 * - Rich progress tracking (round, breath count, timers)
 * - Atmospheric guidance prompts with sub-prompts
 * - Session-specific theming
 * - Smooth phase transitions
 */

export class BreathworkSessionManager {
    constructor(breathingIndicator) {
        this.indicator = breathingIndicator;
        this.activeSession = null;
        this.currentPhaseIndex = 0;
        this.currentRound = 0;
        this.isPaused = false;
        this.timer = null;
        this.breathTimer = null;
        this.phaseStartTime = 0;
        this.currentBreathCount = 0;
        this.onProgressCallback = null;
        this.onCompleteCallback = null;
        this.onPhaseChangeCallback = null;

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

        // Enhanced Session Definitions with atmospheric prompts
        this.SESSIONS = {
            BASE: {
                id: 'hale-base',
                name: 'Hale Base',
                description: 'A foundational session to regulate stress and build CO2 tolerance. Focus on nose breathing.',
                duration: '20 min',
                intensity: 'Moderate',
                totalRounds: 3,
                color: { r: 100, g: 200, b: 255 }, // Calming Blue
                phases: [
                    // Grounding
                    {
                        type: 'grounding',
                        duration: 180,
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Close your eyes. Scan your body from head to toe. Release tension with each exhale.'
                    },
                    // Round 1
                    {
                        type: 'active',
                        breaths: 30,
                        pattern: [4, 0, 4, 0],
                        round: 1,
                        prompt: 'Round 1 • Rhythmic Breathing',
                        subPrompt: 'Breathe in through the nose. Full belly, then chest. Let go completely.'
                    },
                    {
                        type: 'retention',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty Lungs',
                        subPrompt: 'Exhale fully. Relax into the stillness. You are safe here.'
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Deep inhale. Hold at the top. Squeeze gently to the crown.'
                    },
                    // Round 2
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3.5, 0, 3.5, 0],
                        round: 2,
                        prompt: 'Round 2 • Go Deeper',
                        subPrompt: 'Increase the rhythm. Belly rises, chest expands, then release.'
                    },
                    {
                        type: 'retention',
                        duration: 90,
                        round: 2,
                        prompt: 'Extended Hold • Empty',
                        subPrompt: 'Relax completely. Be the observer of this moment.'
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Big inhale. Hold. Squeeze energy upward.'
                    },
                    // Round 3
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3, 0, 3, 0],
                        round: 3,
                        prompt: 'Round 3 • Peak Intensity',
                        subPrompt: 'Full commitment. In... Out... You are limitless.'
                    },
                    {
                        type: 'retention',
                        duration: 120,
                        round: 3,
                        prompt: 'Deep Hold • Find Stillness',
                        subPrompt: 'Empty. Silent. Observe the space between thoughts.'
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Recovery',
                        subPrompt: 'One full breath. Hold. Gentle squeeze. Release.'
                    },
                    // Integration
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Integration',
                        subPrompt: 'Return to natural breath. There is nothing to do. Simply be.'
                    }
                ]
            },
            ELIXIR: {
                id: 'hale-elixir',
                name: 'Hale Elixir',
                description: 'High-intensity activation. Use mouth breathing to alkalize the blood and clear the mind.',
                duration: '25 min',
                intensity: 'High',
                totalRounds: 3,
                color: { r: 255, g: 100, b: 100 }, // Energetic Red
                phases: [
                    // Grounding
                    {
                        type: 'grounding',
                        duration: 180,
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Set your intention. What do you seek? Energy or release?'
                    },
                    // Round 1
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3, 0, 1, 0],
                        round: 1,
                        prompt: 'Round 1 • Activate',
                        subPrompt: 'Mouth breathing. Powerful inhale. Sharp exhale. Keep the loop.'
                    },
                    {
                        type: 'retention',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty',
                        subPrompt: 'Let go completely. Surrender to the silence.'
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Power Breath',
                        subPrompt: 'Big inhale. Squeeze energy to the crown.'
                    },
                    // Round 2
                    {
                        type: 'active',
                        breaths: 50,
                        pattern: [2.5, 0, 1, 0],
                        round: 2,
                        prompt: 'Round 2 • Intensify',
                        subPrompt: 'Faster rhythm. In-out-in-out. Connected breathing.'
                    },
                    {
                        type: 'retention',
                        duration: 90,
                        round: 2,
                        prompt: 'Extended Hold',
                        subPrompt: 'Deep silence. Observe sensations without judgment.'
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Power Breath',
                        subPrompt: 'Inhale fully. Compress. Release.'
                    },
                    // Round 3
                    {
                        type: 'active',
                        breaths: 60,
                        pattern: [2, 0, 1, 0],
                        round: 3,
                        prompt: 'Round 3 • Maximum Capacity',
                        subPrompt: 'Push through. You are unstoppable. Breathe like fire.'
                    },
                    {
                        type: 'retention',
                        duration: 120,
                        round: 3,
                        prompt: 'Deep Surrender',
                        subPrompt: 'Complete release. Trust the process. You are held.'
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Power Breath',
                        subPrompt: 'One massive inhale. Squeeze. Let everything go.'
                    },
                    // Integration
                    {
                        type: 'integration',
                        duration: 600,
                        round: 0,
                        prompt: 'Deep Integration',
                        subPrompt: 'Drift into restoration. Allow whatever arises. You are complete.'
                    }
                ]
            }
        };
    }

    /**
     * Calculate total session duration in seconds
     * @param {string} sessionId - 'BASE' or 'ELIXIR'
     * @returns {number} Total duration in seconds
     */
    _calculateTotalDuration(sessionId) {
        const session = this.SESSIONS[sessionId];
        if (!session) return 0;

        return session.phases.reduce((total, phase) => {
            if (phase.type === 'active') {
                const breathDuration = phase.pattern.reduce((a, b) => a + b, 0);
                return total + (breathDuration * phase.breaths);
            }
            return total + phase.duration;
        }, 0);
    }

    /**
     * Start a specific session
     * @param {string} sessionId - 'BASE' or 'ELIXIR'
     * @param {function} onProgress - Callback for UI updates
     * @param {function} onComplete - Callback when session ends
     * @param {function} onPhaseChange - Optional callback for phase transitions
     */
    startSession(sessionId, onProgress, onComplete, onPhaseChange = null) {
        const session = this.SESSIONS[sessionId];
        if (!session) {
            console.error('Invalid session ID:', sessionId);
            return;
        }

        this.activeSession = session;
        this.sessionId = sessionId;
        this.currentPhaseIndex = 0;
        this.currentRound = 0;
        this.currentBreathCount = 0;
        this.sessionStartTime = Date.now();
        this.totalSessionDuration = this._calculateTotalDuration(sessionId);
        this.onProgressCallback = onProgress;
        this.onCompleteCallback = onComplete;
        this.onPhaseChangeCallback = onPhaseChange;
        this.isPaused = false;

        console.log(`[BreathworkSessionManager] Starting session: ${session.name}`);

        // Take control of the indicator
        if (this.indicator) {
            this.indicator.setExternalControl(true);
            // Set session theme color
            if (this.indicator.setSessionTheme) {
                this.indicator.setSessionTheme(sessionId);
            }
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
        clearInterval(this.breathTimer);
        this.activeSession = null;

        // Release indicator control
        if (this.indicator) {
            this.indicator.setExternalControl(false);
            this.indicator.stop();
        }
    }

    /**
     * Get label for phase type
     * @private
     */
    _getPhaseLabel(type) {
        const labels = {
            grounding: 'Grounding',
            active: 'Breathe',
            retention: 'Hold',
            recovery: 'Recovery',
            integration: 'Integration'
        };
        return labels[type] || type;
    }

    /**
     * Run the current phase
     * @private
     */
    _runPhase() {
        if (!this.activeSession) return;

        const phase = this.activeSession.phases[this.currentPhaseIndex];
        this.phaseStartTime = Date.now();
        this.currentBreathCount = 0;

        // Track current round
        if (phase.round > 0) {
            this.currentRound = phase.round;
        }

        // Calculate phase duration
        let phaseDuration;
        if (phase.type === 'active') {
            const breathCycle = phase.pattern.reduce((a, b) => a + b, 0);
            phaseDuration = breathCycle * phase.breaths;
        } else {
            phaseDuration = phase.duration;
        }

        // Update UI/Indicator
        if (this.indicator) {
            // Set prompt with sub-prompt support
            if (this.indicator.setPrompt) {
                this.indicator.setPrompt(phase.prompt, phase.subPrompt);
            } else {
                this.indicator.setPrompt(phase.prompt);
            }

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

        // Notify phase change
        if (this.onPhaseChangeCallback) {
            this.onPhaseChangeCallback({
                phaseType: phase.type,
                phaseLabel: this._getPhaseLabel(phase.type),
                round: phase.round,
                totalRounds: this.activeSession.totalRounds,
                prompt: phase.prompt,
                subPrompt: phase.subPrompt
            });
        }

        // Start progress updates
        this._startProgressUpdates(phase, phaseDuration);

        // Handle timing
        if (phase.type === 'active') {
            // For active breathing, count breaths
            const breathCycle = phase.pattern.reduce((a, b) => a + b, 0);
            const totalDuration = breathCycle * phase.breaths * 1000; // ms

            // Start breath counter
            this._startBreathCounter(phase.pattern, phase.breaths);

            this.timer = setTimeout(() => this._nextPhase(), totalDuration);
        } else {
            // For fixed duration phases
            this.timer = setTimeout(() => this._nextPhase(), phase.duration * 1000);
        }
    }

    /**
     * Start breath counter for active phases
     * @private
     */
    _startBreathCounter(pattern, totalBreaths) {
        clearInterval(this.breathTimer);

        const breathCycle = pattern.reduce((a, b) => a + b, 0) * 1000; // ms
        this.currentBreathCount = 0;

        // Count a breath each cycle
        this.breathTimer = setInterval(() => {
            this.currentBreathCount++;
            if (this.currentBreathCount >= totalBreaths) {
                clearInterval(this.breathTimer);
            }
        }, breathCycle);
    }

    /**
     * Start continuous progress updates
     * @private
     */
    _startProgressUpdates(phase, phaseDuration) {
        // Clear any existing update timer
        if (this.progressUpdateTimer) {
            clearInterval(this.progressUpdateTimer);
        }

        const updateProgress = () => {
            if (!this.activeSession) return;

            const elapsed = (Date.now() - this.phaseStartTime) / 1000;
            const remaining = Math.max(0, phaseDuration - elapsed);
            const phaseProgress = Math.min(1, elapsed / phaseDuration);

            // Calculate session progress
            let elapsedSessionTime = 0;
            for (let i = 0; i < this.currentPhaseIndex; i++) {
                const p = this.activeSession.phases[i];
                if (p.type === 'active') {
                    const cycle = p.pattern.reduce((a, b) => a + b, 0);
                    elapsedSessionTime += cycle * p.breaths;
                } else {
                    elapsedSessionTime += p.duration;
                }
            }
            elapsedSessionTime += elapsed;
            const sessionProgress = Math.min(1, elapsedSessionTime / this.totalSessionDuration);

            // Build rich progress object
            const progressData = {
                // Phase info
                phase: phase.type,
                phaseLabel: this._getPhaseLabel(phase.type),
                phaseIndex: this.currentPhaseIndex + 1,
                totalPhases: this.activeSession.phases.length,

                // Round info
                round: phase.round || this.currentRound,
                totalRounds: this.activeSession.totalRounds,

                // Breath tracking (for active phases)
                breathCount: this.currentBreathCount,
                totalBreaths: phase.breaths || 0,
                isActivePhase: phase.type === 'active',

                // Time tracking
                remainingTime: Math.ceil(remaining),
                phaseDuration: phaseDuration,
                phaseProgress: phaseProgress,

                // Session progress
                sessionProgress: sessionProgress,

                // Content
                prompt: phase.prompt,
                subPrompt: phase.subPrompt || '',
                sessionName: this.activeSession.name,
                sessionId: this.sessionId,

                // Hold phase indicator
                isHoldPhase: phase.type === 'retention'
            };

            if (this.onProgressCallback) {
                this.onProgressCallback(progressData);
            }
        };

        // Update immediately
        updateProgress();

        // Then update every 100ms for smooth progress
        this.progressUpdateTimer = setInterval(updateProgress, 100);
    }

    /**
     * Advance to next phase
     * @private
     */
    _nextPhase() {
        clearInterval(this.breathTimer);
        clearInterval(this.progressUpdateTimer);

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

        clearInterval(this.progressUpdateTimer);

        // Calculate session stats
        const sessionStats = {
            sessionName: this.activeSession.name,
            totalDuration: Math.round((Date.now() - this.sessionStartTime) / 1000),
            rounds: this.activeSession.totalRounds,
            completed: true
        };

        if (this.onCompleteCallback) {
            this.onCompleteCallback(sessionStats);
        }

        this.stopSession();
    }

    /**
     * Pause the current session
     */
    pauseSession() {
        if (!this.activeSession || this.isPaused) return;

        this.isPaused = true;
        this.pauseTime = Date.now();
        clearTimeout(this.timer);
        clearInterval(this.breathTimer);
        clearInterval(this.progressUpdateTimer);

        console.log('[BreathworkSessionManager] Session paused');
    }

    /**
     * Resume the current session
     */
    resumeSession() {
        if (!this.activeSession || !this.isPaused) return;

        this.isPaused = false;
        const pauseDuration = Date.now() - this.pauseTime;
        this.phaseStartTime += pauseDuration;
        this.sessionStartTime += pauseDuration;

        // Resume phase (simplified - restarts current phase)
        this._runPhase();

        console.log('[BreathworkSessionManager] Session resumed');
    }

    /**
     * Get current session info
     */
    getSessionInfo() {
        if (!this.activeSession) return null;

        return {
            name: this.activeSession.name,
            id: this.sessionId,
            currentPhase: this.currentPhaseIndex + 1,
            totalPhases: this.activeSession.phases.length,
            currentRound: this.currentRound,
            totalRounds: this.activeSession.totalRounds,
            isPaused: this.isPaused
        };
    }
}

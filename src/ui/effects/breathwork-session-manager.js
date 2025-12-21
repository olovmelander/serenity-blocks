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

import { BreathworkAudioManager } from './breathwork-audio-manager.js';

export class BreathworkSessionManager {
    constructor(breathingIndicator) {
        this.indicator = breathingIndicator;
        this.audioManager = new BreathworkAudioManager(); // New Audio Manager
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
                        pattern: [5, 2, 5, 2], // Slow grounding breath
                        breaths: 13, // ~180s / 14s per cycle
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Close your eyes. Scan your body from head to toe. Release tension with each exhale.',
                        audio: {
                            sessionIntro: 'session_intros/base_intro.wav',
                            voice: 'base/grounding_intro.wav',
                            cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' },
                            intentions: ['intentions/base_calm.wav', 'intentions/base_focus.wav', 'intentions/base_ground.wav', 'intentions/base_breathe.wav', 'intentions/universal_gratitude.wav', 'intentions/flow_presence.wav', 'intentions/universal_strength.wav']
                        }
                    },
                    // Round 1
                    {
                        type: 'active',
                        breaths: 30,
                        pattern: [4, 0, 4, 0],
                        round: 1,
                        prompt: 'Round 1 • Rhythmic Breathing',
                        subPrompt: 'Breathe in through the nose. Full belly, then chest. Let go completely.',
                        audio: {
                            voice: 'base/r1_active.wav',
                            transition: 'transitions/round1_start.wav',
                            cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' }
                        }
                    },
                    {
                        type: 'retention',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty Lungs',
                        subPrompt: 'Exhale fully. Relax into the stillness. You are safe here.',
                        audio: {
                            voice: 'base/r1_hold.wav',
                            transition: 'transitions/hold_start.wav'
                        }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Deep inhale. Hold at the top. Squeeze gently to the crown.',
                        audio: {
                            voice: 'base/r1_recovery.wav'
                        }
                    },
                    // Round 2
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3.5, 0, 3.5, 0],
                        round: 2,
                        prompt: 'Round 2 • Go Deeper',
                        subPrompt: 'Increase the rhythm. Belly rises, chest expands, then release.',
                        audio: { voice: 'base/r2_active.wav', transition: 'transitions/round2_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 90,
                        round: 2,
                        prompt: 'Extended Hold • Empty',
                        subPrompt: 'Relax completely. Be the observer of this moment.',
                        audio: { voice: 'base/r2_hold.wav', transition: 'transitions/hold_start.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Big inhale. Hold. Squeeze energy upward.',
                        audio: { voice: 'base/r2_recovery.wav' }
                    },
                    // Round 3
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3, 0, 3, 0],
                        round: 3,
                        prompt: 'Round 3 • Peak Intensity',
                        subPrompt: 'Full commitment. In... Out... You are limitless.',
                        audio: { voice: 'base/r3_active.wav', transition: 'transitions/round3_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 120,
                        round: 3,
                        prompt: 'Deep Hold • Find Stillness',
                        subPrompt: 'Empty. Silent. Observe the space between thoughts.',
                        audio: { voice: 'base/r3_hold.wav', transition: 'transitions/hold_start.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Recovery',
                        subPrompt: 'One full breath. Hold. Gentle squeeze. Release.',
                        audio: { voice: 'base/r3_recovery.wav' }
                    },
                    // Integration
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Integration',
                        subPrompt: 'Return to natural breath. There is nothing to do. Simply be.',
                        audio: {
                            voice: 'base/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/floating_vibrating.wav', 'fillers/observer_deep.wav', 'fillers/stay_here.wav', 'fillers/body_scan.wav', 'fillers/complete_whole.wav']
                        }
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
                        pattern: [4, 1, 4, 1], // Slightly faster for Elixir
                        breaths: 18, // ~180s / 10s per cycle
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Set your intention. What do you seek? Energy or release?',
                        audio: {
                            sessionIntro: 'session_intros/elixir_intro.wav',
                            voice: 'elixir/grounding_intro.wav',
                            cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' },
                            intentions: ['intentions/elixir_energy.wav', 'intentions/elixir_release.wav', 'intentions/elixir_transform.wav', 'intentions/elixir_power.wav', 'intentions/universal_strength.wav', 'intentions/universal_clarity.wav']
                        }
                    },
                    // Round 1
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3, 0, 1, 0],
                        round: 1,
                        prompt: 'Round 1 • Activate',
                        subPrompt: 'Mouth breathing. Powerful inhale. Sharp exhale. Keep the loop.',
                        audio: {
                            voice: 'elixir/r1_active.wav',
                            transition: 'transitions/round1_start.wav',
                            cues: { in: 'voices/cues/in_quick.wav', out: 'voices/cues/out_quick.wav' }
                        }
                    },
                    {
                        type: 'retention',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty',
                        subPrompt: 'Let go completely. Surrender to the silence.',
                        audio: { voice: 'elixir/r1_hold.wav', transition: 'transitions/hold_start.wav', cue: 'voices/cues/hold.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Power Breath',
                        subPrompt: 'Big inhale. Squeeze energy to the crown.',
                        audio: { voice: 'elixir/r1_recovery.wav', cue: 'voices/cues/release.wav' }
                    },
                    // Round 2
                    {
                        type: 'active',
                        breaths: 50,
                        pattern: [2.5, 0, 1, 0],
                        round: 2,
                        prompt: 'Round 2 • Intensify',
                        subPrompt: 'Faster rhythm. In-out-in-out. Connected breathing.',
                        audio: {
                            voice: 'elixir/r2_active.wav',
                            transition: 'transitions/round2_start.wav',
                            cues: { in: 'voices/cues/in_quick.wav', out: 'voices/cues/out_quick.wav' }
                        }
                    },
                    {
                        type: 'retention',
                        duration: 90,
                        round: 2,
                        prompt: 'Extended Hold',
                        subPrompt: 'Deep silence. Observe sensations without judgment.',
                        audio: { voice: 'elixir/r2_hold.wav', transition: 'transitions/hold_start.wav', cue: 'voices/cues/hold.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Power Breath',
                        subPrompt: 'Inhale fully. Compress. Release.',
                        audio: { voice: 'elixir/r2_recovery.wav', cue: 'voices/cues/release.wav' }
                    },
                    // Round 3
                    {
                        type: 'active',
                        breaths: 60,
                        pattern: [2, 0, 1, 0],
                        round: 3,
                        prompt: 'Round 3 • Maximum Capacity',
                        subPrompt: 'Push through. You are unstoppable. Breathe like fire.',
                        audio: {
                            voice: 'elixir/r3_active.wav',
                            transition: 'transitions/round3_start.wav',
                            cues: { in: 'voices/cues/in_quick.wav', out: 'voices/cues/out_quick.wav' }
                        }
                    },
                    {
                        type: 'retention',
                        duration: 120,
                        round: 3,
                        prompt: 'Deep Surrender',
                        subPrompt: 'Complete release. Trust the process. You are held.',
                        audio: { voice: 'elixir/r3_hold.wav', transition: 'transitions/hold_start.wav', cue: 'voices/cues/hold.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Power Breath',
                        subPrompt: 'One massive inhale. Squeeze. Let everything go.',
                        audio: { voice: 'elixir/r3_recovery.wav', cue: 'voices/cues/release.wav' }
                    },
                    // Integration
                    {
                        type: 'integration',
                        duration: 300, // 5 minutes
                        round: 0,
                        prompt: 'Deep Integration',
                        subPrompt: 'Drift into restoration. Allow whatever arises. You are complete.',
                        audio: {
                            voice: 'elixir/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/floating_vibrating.wav', 'fillers/observer_deep.wav', 'fillers/you_are_safe.wav', 'fillers/nothing_to_do.wav', 'fillers/trust_process.wav', 'fillers/inner_light.wav']
                        }
                    }
                ]
            },
            REST: {
                id: 'hale-rest',
                name: 'Hale Rest',
                description: 'A soothing practice with extended exhales to activate deep relaxation and prepare for sleep.',
                duration: '15 min',
                intensity: 'Gentle',
                totalRounds: 3,
                color: { r: 150, g: 130, b: 200 }, // Soft Purple
                phases: [
                    // Grounding
                    {
                        type: 'grounding',
                        duration: 120,
                        round: 0,
                        prompt: 'Settling In',
                        subPrompt: 'Let your body sink into wherever you are. Release the weight of the day.',
                        audio: {
                            sessionIntro: 'session_intros/rest_intro.wav',
                            voice: 'rest/grounding_intro.wav',
                            cues: { in: 'voices/cues/deep_inhale.wav', out: 'voices/cues/slow_exhale.wav' },
                            intentions: ['intentions/rest_sleep.wav', 'intentions/rest_peace.wav', 'intentions/rest_unwind.wav', 'intentions/rest_restore.wav', 'intentions/universal_heal.wav']
                        }
                    },
                    // Round 1
                    {
                        type: 'active',
                        breaths: 10,
                        pattern: [4, 0, 8, 2],
                        round: 1,
                        prompt: 'Round 1 • Extended Exhale',
                        subPrompt: 'Gentle inhale through the nose. Slow, long exhale. Let go with each breath.',
                        audio: { voice: 'rest/r1_active.wav', transition: 'transitions/round1_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 20,
                        round: 1,
                        prompt: 'Gentle Pause',
                        subPrompt: 'Rest in the stillness. No effort required.',
                        audio: { voice: 'rest/r1_hold.wav', transition: 'transitions/hold_start.wav' }
                    },
                    // Round 2
                    {
                        type: 'active',
                        breaths: 12,
                        pattern: [4, 0, 8, 3],
                        round: 2,
                        prompt: 'Round 2 • Deeper Relaxation',
                        subPrompt: 'Each exhale softens your muscles. Each pause deepens your calm.',
                        audio: { voice: 'rest/r2_active.wav', transition: 'transitions/round2_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 25,
                        round: 2,
                        prompt: 'Restful Pause',
                        subPrompt: 'Float in the quiet space. You are safe here.',
                        audio: { voice: 'rest/r2_hold.wav', transition: 'transitions/hold_start.wav' }
                    },
                    // Round 3
                    {
                        type: 'active',
                        breaths: 15,
                        pattern: [4, 0, 8, 4],
                        round: 3,
                        prompt: 'Round 3 • Surrender',
                        subPrompt: 'Breath becomes effortless. Body becomes light. Mind becomes still.',
                        audio: { voice: 'rest/r3_active.wav', transition: 'transitions/round3_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 30,
                        round: 3,
                        prompt: 'Deep Rest',
                        subPrompt: 'Drift into stillness. There is nowhere to go, nothing to do.',
                        audio: { voice: 'rest/r3_hold.wav', transition: 'transitions/hold_start.wav' }
                    },
                    // Integration
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Sleep Integration',
                        subPrompt: 'Natural breath now. Allow yourself to drift. Sweet dreams await.',
                        audio: {
                            voice: 'rest/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/nothing_to_do.wav', 'fillers/you_are_safe.wav', 'fillers/waves_ocean.wav', 'fillers/let_go.wav']
                        }
                    }
                ]
            },
            FLOW: {
                id: 'hale-flow',
                name: 'Hale Flow',
                description: 'A balanced box breathing practice that creates equilibrium and cultivates rhythmic awareness.',
                duration: '18 min',
                intensity: 'Moderate',
                totalRounds: 3,
                color: { r: 100, g: 220, b: 180 }, // Balanced Teal
                phases: [
                    // Grounding
                    {
                        type: 'grounding',
                        duration: 120,
                        round: 0,
                        prompt: 'Finding Center',
                        subPrompt: 'Notice your heartbeat. Let it guide you to presence.',
                        audio: {
                            sessionIntro: 'session_intros/flow_intro.wav',
                            voice: 'flow/grounding_intro.wav',
                            cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/let_it_flow.wav' },
                            intentions: ['intentions/flow_balance.wav', 'intentions/flow_presence.wav', 'intentions/flow_clarity.wav', 'intentions/flow_rhythm.wav', 'intentions/universal_clarity.wav']
                        }
                    },
                    // Round 1
                    {
                        type: 'active',
                        breaths: 12,
                        pattern: [4, 4, 4, 4],
                        round: 1,
                        prompt: 'Round 1 • Box Breathing',
                        subPrompt: 'Inhale 4. Hold 4. Exhale 4. Hold 4. Find your rhythm.',
                        audio: { voice: 'flow/r1_active.wav', transition: 'transitions/round1_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 30,
                        round: 1,
                        prompt: 'Flow State',
                        subPrompt: 'Let the rhythm continue in your body. Natural, effortless.',
                        audio: { voice: 'flow/r1_hold.wav', transition: 'transitions/hold_start.wav', cue: 'voices/cues/hold.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Reset',
                        subPrompt: 'One deep breath. Feel the balance.',
                        audio: { voice: 'flow/r1_recovery.wav', cue: 'voices/cues/release.wav' }
                    },
                    // Round 2
                    {
                        type: 'active',
                        breaths: 15,
                        pattern: [5, 5, 5, 5],
                        round: 2,
                        prompt: 'Round 2 • Expand the Box',
                        subPrompt: 'Longer counts now. Inhale 5. Hold 5. Exhale 5. Hold 5.',
                        audio: { voice: 'flow/r2_active.wav', transition: 'transitions/round2_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 40,
                        round: 2,
                        prompt: 'Deeper Flow',
                        subPrompt: 'You are the breath. The breath is you. Unity.',
                        audio: { voice: 'flow/r2_hold.wav', transition: 'transitions/hold_start.wav', cue: 'voices/cues/hold.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recenter',
                        subPrompt: 'One cleansing breath. Fully present.',
                        audio: { voice: 'flow/r2_recovery.wav', cue: 'voices/cues/release.wav' }
                    },
                    // Round 3
                    {
                        type: 'active',
                        breaths: 18,
                        pattern: [6, 6, 6, 6],
                        round: 3,
                        prompt: 'Round 3 • Master Box',
                        subPrompt: 'Full expansion. Inhale 6. Hold 6. Exhale 6. Hold 6. Perfect balance.',
                        audio: { voice: 'flow/r3_active.wav', transition: 'transitions/round3_start.wav', cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' } }
                    },
                    {
                        type: 'retention',
                        duration: 60,
                        round: 3,
                        prompt: 'Peak Flow',
                        subPrompt: 'Complete equilibrium. Mind clear as still water.',
                        audio: { voice: 'flow/r3_hold.wav', transition: 'transitions/hold_start.wav', cue: 'voices/cues/hold.wav' }
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Balance',
                        subPrompt: 'One conscious breath. Carry this balance with you.',
                        audio: { voice: 'flow/r3_recovery.wav', cue: 'voices/cues/release.wav' }
                    },
                    // Integration
                    {
                        type: 'integration',
                        duration: 240,
                        round: 0,
                        prompt: 'Flow Integration',
                        subPrompt: 'Return to natural rhythm. You are balanced. You are present.',
                        audio: {
                            voice: 'flow/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/floating_vibrating.wav', 'fillers/stay_here.wav', 'fillers/inner_light.wav', 'fillers/complete_whole.wav']
                        }
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

        // Preload audio for this session
        if (this.audioManager) {
            this.audioManager.preloadSession(sessionId, session);
        }

        // Take control of the indicator
        if (this.indicator) {
            this.indicator.setExternalControl(true);
            // Set session theme color
            if (this.indicator.setSessionTheme) {
                this.indicator.setSessionTheme(sessionId);
            }

            // Register callback to sync audio with visual phase changes
            this.indicator.onPhaseChangeCallback = (newPhase, prevPhase) => {
                this._onBreathPhaseChange(newPhase, prevPhase);
            };

            this.indicator.start();

            // Show session progress UI
            if (this.indicator.showProgress) {
                this.indicator.showProgress(true);
            }
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
        clearInterval(this.audioTimer);
        this.activeSession = null;


        // Release indicator control
        if (this.indicator) {
            this.indicator.setExternalControl(false);
            this.indicator.stop();

            // Hide session progress UI
            if (this.indicator.showProgress) {
                this.indicator.showProgress(false);
            }
        }

        // Stop Audio
        if (this.audioManager) {
            this.audioManager.stopAll();
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

        // Reset guidance state for new phase
        this.waitForNextInhale = false;
        this.currentCycleIsGuidance = false;
        this.forcedGuidanceRemaining = 0; // Reset repeat counter
        this.wasVoicePlaying = false; // Reset voice state tracking

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


        // TRIGGER AUDIO
        if (this.audioManager && phase.audio) {
            // Block cues during phase setup - voice is about to play
            this.audioManager.isVoicePending = true;

            // Play session intro first for grounding phases (if exists)
            const hasSessionIntro = phase.audio.sessionIntro && phase.type === 'grounding';
            const sessionIntroDelay = hasSessionIntro ? 8000 : 0; // 8s for session intro

            if (hasSessionIntro) {
                this.audioManager.playVoice(phase.audio.sessionIntro);
            }

            // Play transition audio (if exists), then main voice
            const hasTransition = phase.audio.transition;
            const transitionDelay = sessionIntroDelay + (hasTransition ? 3000 : 0); // 3s for transition to finish

            if (hasTransition) {
                setTimeout(() => {
                    if (this.activeSession && this.currentPhaseIndex === this.activeSession.phases.indexOf(phase)) {
                        this.audioManager.playVoice(phase.audio.transition);
                    }
                }, sessionIntroDelay);
            }

            // Play main voice after transition
            const voiceDelay = transitionDelay + 1000;
            if (phase.audio.voice) {
                setTimeout(() => {
                    if (this.activeSession && this.currentPhaseIndex === this.activeSession.phases.indexOf(phase)) {
                        this.audioManager.playVoice(phase.audio.voice);
                    }
                }, voiceDelay);
            }

            // Breathing cues are now synced via indicator.onPhaseChangeCallback
            // (registered in startSession) - no separate timing needed here

            // Single cue (for holds/recovery) - play immediately
            if (phase.audio.cue) {
                this.audioManager.playCue(phase.audio.cue);
            }

            // Schedule filler audio for integration phases
            if (phase.audio.fillers && phase.audio.fillers.length > 0) {
                this._scheduleFillersAudio(phase.audio.fillers, voiceDelay + 10000, phase);
            }

            // Schedule intention for grounding phases
            if (phase.audio.intentions && phase.audio.intentions.length > 0) {
                this._scheduleIntention(phase.audio.intentions, voiceDelay + 18000, phase);
            }
        }
    }

    /**
     * Schedule filler audio clips during integration phase
     * @private
     */
    _scheduleFillersAudio(fillers, startDelay, phase) {
        let currentDelay = startDelay;
        const fillerInterval = 30000; // 30 seconds between fillers

        fillers.forEach((filler, index) => {
            setTimeout(() => {
                // Check if still in same phase
                if (this.activeSession && this.currentPhaseIndex === this.activeSession.phases.indexOf(phase)) {
                    console.log(`[SessionManager] Playing filler: ${filler}`);
                    this.audioManager.playVoice(filler);
                }
            }, currentDelay);
            currentDelay += fillerInterval;
        });
    }

    /**
     * Schedule intention audio clip
     * @private
     */
    _scheduleIntention(intentions, delay, phase) {
        setTimeout(() => {
            // Only play intention if still in same grounding phase (not during active breathing)
            const currentPhase = this.activeSession?.phases[this.currentPhaseIndex];
            if (this.activeSession &&
                this.currentPhaseIndex === this.activeSession.phases.indexOf(phase) &&
                currentPhase?.type === 'grounding') {
                // Pick random intention
                const intention = intentions[Math.floor(Math.random() * intentions.length)];
                console.log(`[SessionManager] Playing intention: ${intention}`);
                this.audioManager.playVoice(intention);
            } else {
                console.log(`[SessionManager] Skipping intention (no longer in grounding phase)`);
            }
        }, delay);
    }

    /**
     * Handle breath phase change from the visual indicator
     * Plays audio cues synced with the visual breathing guide
     * @param {string} newPhase - 'inhale', 'hold1', 'exhale', or 'hold2'
     * @param {string} prevPhase - Previous phase
     * @private
     */
    _onBreathPhaseChange(newPhase, prevPhase) {
        if (!this.activeSession || this.isPaused) return;

        const phase = this.activeSession.phases[this.currentPhaseIndex];
        if (!phase || !phase.audio || !phase.audio.cues) return;

        // --- 1. Check Voice State ---
        // If voice is currently playing, we must respect silence
        if (this.audioManager.isVoicePlaying) {
            this.wasVoicePlaying = true;
            this.waitForNextInhale = false; // Reset guidance wait
            this.currentCycleIsGuidance = false; // Stop any current guidance
            console.log(`[SessionManager] Voice playing, silencing cues. Phase: ${newPhase}`);
            return;
        }

        // --- 2. Detect Voice Finish (Rising Edge of Silence) ---
        // If voice WAS playing but stopped, we now arm the "Wait for Next Inhale" trigger
        if (this.wasVoicePlaying) {
            console.log(`[SessionManager] Voice finished. Waiting for next inhale to start guidance.`);
            this.wasVoicePlaying = false;
            this.waitForNextInhale = true;
        }

        // --- 3. Determine if this cycle should have guidance ---
        // We only change the "Guidance Mode" at the start of a breath cycle (INHALE)
        if (newPhase === 'inhale') {
            // Increment cycle count
            this.breathCycleCount = (this.breathCycleCount || 0) + 1;

            // Condition A: Voice just finished, trigger 3 cycles of forced guidance
            if (this.waitForNextInhale) {
                console.log(`[SessionManager] Starting FORCED guidance (3 cycles) after voice`);
                this.waitForNextInhale = false; // Consumed trigger
                this.forcedGuidanceRemaining = 3; // Set counter for 3 cycles
            }

            // Decrement forced guidance counter if active
            const isForcedGuidance = (this.forcedGuidanceRemaining > 0);
            if (isForcedGuidance) {
                this.forcedGuidanceRemaining--;
                console.log(`[SessionManager] FORCED guidance cycle (Remaining: ${this.forcedGuidanceRemaining})`);
                this.currentCycleIsGuidance = true;
            }
            // Condition B: Regular periodic guidance (every 5th cycle)
            else if (this.breathCycleCount % 5 === 0) {
                console.log(`[SessionManager] Starting PERIODIC guidance cycle (Cycle ${this.breathCycleCount})`);
                this.currentCycleIsGuidance = true;
            } else {
                this.currentCycleIsGuidance = false;
            }
        }

        // --- 4. Play Cues if in Guidance Mode ---
        if (this.currentCycleIsGuidance) {
            if (newPhase === 'inhale' && phase.audio.cues.in) {
                console.log(`[SessionManager] Playing inhale cue`);
                this.audioManager.playCue(phase.audio.cues.in);
            } else if (newPhase === 'exhale' && phase.audio.cues.out) {
                console.log(`[SessionManager] Playing exhale cue`);
                this.audioManager.playCue(phase.audio.cues.out);
            }
        }
    }

    /**
     * Start rhythmic audio cues
     * @private
     */
    _startRhythmicAudio(pattern, cues, totalBreaths) {
        clearInterval(this.audioTimer);
        let breathCount = 0;
        const [inhale, hold1, exhale, hold2] = pattern;
        const cycleDuration = (inhale + hold1 + exhale + hold2) * 1000;

        // Only play cues every N breaths as guidance (not every breath)
        const cueInterval = 5; // Play cue every 5th breath

        const playCycle = () => {
            if (this.isPaused) return;
            if (breathCount >= totalBreaths) {
                clearInterval(this.audioTimer);
                return;
            }

            // Only play audio cue every N breaths for guidance
            const shouldPlayCue = (breathCount % cueInterval === 0);

            if (shouldPlayCue) {
                // Inhale cue
                if (cues.in) this.audioManager.playCue(cues.in);

                // Exhale cue
                if (cues.out) {
                    setTimeout(() => {
                        if (!this.isPaused) this.audioManager.playCue(cues.out);
                    }, (inhale + hold1) * 1000);
                }
            }

            breathCount++;
        };

        // Start immediately
        playCycle();
        // Repeat
        this.audioTimer = setInterval(playCycle, cycleDuration);
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

            // Update breathing indicator's progress UI
            if (this.indicator && this.indicator.updateProgress) {
                this.indicator.updateProgress({
                    phase: progressData.phase,
                    round: progressData.round,
                    totalRounds: progressData.totalRounds,
                    breathCount: progressData.breathCount,
                    totalBreaths: progressData.totalBreaths,
                    sessionProgress: progressData.sessionProgress,
                    sessionColor: this.activeSession.color
                });
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
        clearInterval(this.audioTimer);

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

        if (this.audioManager) {
            this.audioManager.stopAll();
        }
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

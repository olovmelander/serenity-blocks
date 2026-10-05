/**
 * BreathworkSessionManager - runs the four Hale sessions.
 *
 * A session is a journey of stages (arrive, three rounds of breathing / stillness / recovery,
 * rest). The manager owns its clock, its voice and its bells; the breathing guide follows it:
 * each stage hands the guide a rhythm, a world, what to say and how to guide (counted breaths,
 * a hold you end yourself, a rhythm you keep on your own, or your natural breath).
 *
 * Every piece of stage work is scheduled through _schedulePhase, so a pause can freeze the
 * session exactly where it is and a resume continues from the same moment. The session is
 * paused for you while the Hub is over it, while you confirm ending it, and when the page is
 * hidden (timers there are throttled; a session must never run on without you).
 *
 * What you actually did is measured: breaths, rounds, and how long you held each breath.
 */

import { BreathworkAudioManager } from './breathwork-audio-manager.js';
import { BreathworkChimes } from './breathwork-chimes.js';

/**
 * The world each stage is set in. One journey per session, the same every time: the scenery is
 * part of the practice, not decoration to shuffle. An array is indexed by round.
 */
export const SESSION_WORLDS = Object.freeze({
    BASE: {
        grounding: 'forest-breath', active: 'ocean-breath', retention: 'cosmic-breath', recovery: 'coherence', integration: 'calm-sleep',
    },
    ELIXIR: {
        grounding: 'zen-garden', active: ['wim-hof', 'energizing', 'electric-storm'], retention: 'cosmic-breath', recovery: 'coherence', integration: 'deep-relaxation',
    },
    REST: {
        grounding: 'ocean-breath', active: 'calm-sleep', retention: 'zen-garden', recovery: 'coherence', integration: 'deep-relaxation',
    },
    FLOW: {
        grounding: 'zen-garden', active: 'box-breathing', carry: 'triangle', recovery: 'coherence', integration: 'ocean-breath',
    },
});

/** The picture for a stage breathed at your own pace: slow, and never counted. */
export const NATURAL_PATTERN = Object.freeze([4, 1, 6, 1]);
/** Longest an open hold may run before the voice brings you back: four minutes. */
export const MAX_OPEN_HOLD_SECONDS = 240;
/** An open hold cannot end in its first moment (a tap meant for the stage before). */
const MIN_OPEN_HOLD_MS = 1500;
/** The closing words appear this long before the session ends. */
const CLOSING_SECONDS = 14;
/** The last spoken line in the rest lands this long before the end, leaving the close quiet. */
const FILLER_TAIL_SECONDS = 26;
const FILLER_MIN_GAP_MS = 20000;
/** After a bell, the voice waits for its strike to bloom. */
const BELL_LEAD_MS = 1400;

const DEFAULT_OPTIONS = Object.freeze({
    /** { id, label, clip } chosen on the preparation screen, or null. */
    intention: null,
    /** Base and Elixir holds end when you breathe in; false gives them their suggested length. */
    openHolds: true,
    sounds: true,
    vibration: true,
    onPhaseChange: null,
});

const RELEASE = 'voices/cues/release.wav';
const RELEASE_SOFT = 'voices/cues/release_soft.wav';
const CUES = { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/breathe_out.wav' };

export class BreathworkSessionManager {
    constructor(breathingIndicator) {
        this.indicator = breathingIndicator;
        this.audioManager = new BreathworkAudioManager();
        this.chimes = new BreathworkChimes();
        this.activeSession = null;
        this.sessionId = null;
        this.currentPhaseIndex = 0;
        this.currentRound = 0;
        this.isPaused = false;
        this.progressUpdateTimer = null;
        this.phaseTimeouts = new Set();
        this.phaseToken = 0;
        this.destroyed = false;
        this.indicatorPhaseHandler = null;
        this.phaseDurationOffsets = [];
        this.phaseStartTime = 0;
        this.currentBreathCount = 0;
        this.breathCycleCount = 0;
        this.onProgressCallback = null;
        this.onCompleteCallback = null;
        this.onPhaseChangeCallback = null;
        /** Set by the Sessions surface: called when the guide's own End control is confirmed. */
        this.onEndRequested = null;
        this.currentPhaseDuration = 0;
        this.options = { ...DEFAULT_OPTIONS };
        /** Breaths, rounds and holds as they really happened. */
        this.measure = null;
        /** The open hold in progress: { suggested, cap, ready, endedBy }. */
        this.holdState = null;
        /** Why the session is paused without you asking ('hub', 'confirm', 'hidden'). */
        this.suspensions = new Set();
        this.pausedBySuspension = false;
        this.wakeLock = null;
        this.wakeToken = 0;
        this._onVisibility = () => this._handleVisibility();

        // Every stage: what it asks (prompt, subPrompt), how long, and what is said. A retention's
        // `hold` is 'open' when you choose when to breathe again, 'timed' when it is part of a
        // gentle rhythm. Flow's quiet stretches are 'carry' stages: the box goes on, uncounted.
        this.SESSIONS = {
            BASE: {
                id: 'hale-base',
                name: 'Hale Base',
                description: 'A foundational session to regulate stress and build CO2 tolerance. Focus on nose breathing.',
                intensity: 'Moderate',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 180,
                        pattern: [5, 2, 5, 2],
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Close your eyes. Scan your body from head to toe. Release tension with each exhale.',
                        audio: { sessionIntro: 'session_intros/base_intro.wav', voice: 'base/grounding_intro.wav', cues: CUES },
                    },
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
                            cues: CUES,
                            encourage: { clip: 'encouragement/doing_well.wav', at: 0.55 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty Lungs',
                        subPrompt: 'Exhale fully. Relax into the stillness. You are safe here.',
                        audio: { voice: 'base/r1_hold.wav', transition: 'transitions/hold_start.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Deep inhale. Hold at the top. Squeeze gently to the crown.',
                        audio: { voice: 'base/r1_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3.5, 0, 3.5, 0],
                        round: 2,
                        prompt: 'Round 2 • Go Deeper',
                        subPrompt: 'Increase the rhythm. Belly rises, chest expands, then release.',
                        audio: {
                            voice: 'base/r2_active.wav',
                            transition: 'transitions/round2_start.wav',
                            cues: CUES,
                            encourage: { clip: 'encouragement/halfway.wav', at: 0.5 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 90,
                        round: 2,
                        prompt: 'Extended Hold • Empty',
                        subPrompt: 'Relax completely. Be the observer of this moment.',
                        audio: { voice: 'base/r2_hold.wav', transition: 'transitions/hold_start.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Big inhale. Hold. Squeeze energy upward.',
                        audio: { voice: 'base/r2_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3, 0, 3, 0],
                        round: 3,
                        prompt: 'Round 3 • Peak Intensity',
                        subPrompt: 'Full commitment. In... Out... You are limitless.',
                        audio: { voice: 'base/r3_active.wav', transition: 'transitions/round3_start.wav', cues: CUES },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 120,
                        round: 3,
                        prompt: 'Deep Hold • Find Stillness',
                        subPrompt: 'Empty. Silent. Observe the space between thoughts.',
                        audio: { voice: 'base/r3_hold.wav', transition: 'transitions/hold_start.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Recovery',
                        subPrompt: 'One full breath. Hold. Gentle squeeze. Release.',
                        audio: { voice: 'base/r3_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Integration',
                        subPrompt: 'Return to natural breath. There is nothing to do. Simply be.',
                        audio: {
                            voice: 'base/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/floating_vibrating.wav', 'fillers/observer_deep.wav', 'fillers/stay_here.wav', 'fillers/body_scan.wav', 'fillers/complete_whole.wav', 'encouragement/proud.wav'],
                        },
                    },
                ],
            },
            ELIXIR: {
                id: 'hale-elixir',
                name: 'Hale Elixir',
                description: 'High-intensity activation. Use mouth breathing to energise the body and clear the mind.',
                intensity: 'High',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 180,
                        pattern: [4, 1, 4, 1],
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Set your intention. What do you seek? Energy or release?',
                        audio: { sessionIntro: 'session_intros/elixir_intro.wav', voice: 'elixir/grounding_intro.wav', cues: CUES },
                    },
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
                            cues: { in: 'voices/cues/in_quick.wav', out: 'voices/cues/out_quick.wav' },
                            encourage: { clip: 'encouragement/doing_well.wav', at: 0.55 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty',
                        subPrompt: 'Let go completely. Surrender to the silence.',
                        audio: { voice: 'elixir/r1_hold.wav', transition: 'transitions/hold_start.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Power Breath',
                        subPrompt: 'Big inhale. Squeeze energy to the crown.',
                        audio: { voice: 'elixir/r1_recovery.wav', release: RELEASE },
                    },
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
                            cues: { in: 'voices/cues/in_quick.wav', out: 'voices/cues/out_quick.wav' },
                            encourage: { clip: 'encouragement/halfway.wav', at: 0.5 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 90,
                        round: 2,
                        prompt: 'Extended Hold',
                        subPrompt: 'Deep silence. Observe sensations without judgment.',
                        audio: { voice: 'elixir/r2_hold.wav', transition: 'transitions/hold_start.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Power Breath',
                        subPrompt: 'Inhale fully. Compress. Release.',
                        audio: { voice: 'elixir/r2_recovery.wav', release: RELEASE },
                    },
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
                            cues: { in: 'voices/cues/in_quick.wav', out: 'voices/cues/out_quick.wav' },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 120,
                        round: 3,
                        prompt: 'Deep Surrender',
                        subPrompt: 'Complete release. Trust the process. You are held.',
                        audio: { voice: 'elixir/r3_hold.wav', transition: 'transitions/hold_start.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Power Breath',
                        subPrompt: 'One massive inhale. Squeeze. Let everything go.',
                        audio: { voice: 'elixir/r3_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Deep Integration',
                        subPrompt: 'Drift into restoration. Allow whatever arises. You are complete.',
                        audio: {
                            voice: 'elixir/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/floating_vibrating.wav', 'fillers/observer_deep.wav', 'fillers/you_are_safe.wav', 'fillers/nothing_to_do.wav', 'fillers/trust_process.wav', 'fillers/inner_light.wav', 'encouragement/proud.wav'],
                        },
                    },
                ],
            },
            REST: {
                id: 'hale-rest',
                name: 'Hale Rest',
                description: 'A soothing practice with extended exhales to activate deep relaxation and prepare for sleep.',
                intensity: 'Gentle',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 120,
                        pattern: [4, 1, 7, 2],
                        round: 0,
                        prompt: 'Settling In',
                        subPrompt: 'Let your body sink into wherever you are. Release the weight of the day.',
                        audio: {
                            sessionIntro: 'session_intros/rest_intro.wav',
                            voice: 'rest/grounding_intro.wav',
                            cues: { in: 'voices/cues/deep_inhale.wav', out: 'voices/cues/slow_exhale.wav' },
                        },
                    },
                    {
                        type: 'active',
                        breaths: 10,
                        pattern: [4, 0, 8, 2],
                        round: 1,
                        prompt: 'Round 1 • Extended Exhale',
                        subPrompt: 'Gentle inhale through the nose. Slow, long exhale. Let go with each breath.',
                        audio: { voice: 'rest/r1_active.wav', transition: 'transitions/round1_start.wav', cues: { in: 'voices/cues/breathe_in_soft.wav', out: 'voices/cues/breathe_out_soft.wav' } },
                    },
                    {
                        type: 'retention',
                        hold: 'timed',
                        duration: 20,
                        round: 1,
                        prompt: 'Gentle Pause',
                        subPrompt: 'Rest in the stillness. No effort required.',
                        audio: { voice: 'rest/r1_hold.wav', transition: 'cues/hold_soft.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Gentle Recovery',
                        subPrompt: 'A gentle breath in. Hold softly. And release.',
                        audio: { voice: 'rest/r1_recovery.wav', release: RELEASE_SOFT },
                    },
                    {
                        type: 'active',
                        breaths: 12,
                        pattern: [4, 0, 8, 3],
                        round: 2,
                        prompt: 'Round 2 • Deeper Relaxation',
                        subPrompt: 'Each exhale softens your muscles. Each pause deepens your calm.',
                        audio: {
                            voice: 'rest/r2_active.wav',
                            transition: 'transitions/round2_start.wav',
                            cues: { in: 'voices/cues/breathe_in_soft.wav', out: 'voices/cues/breathe_out_soft.wav' },
                            encourage: { clip: 'encouragement/halfway.wav', at: 0.5 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'timed',
                        duration: 25,
                        round: 2,
                        prompt: 'Restful Pause',
                        subPrompt: 'Float in the quiet space. You are safe here.',
                        audio: { voice: 'rest/r2_hold.wav', transition: 'cues/hold_soft.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Calming Recovery',
                        subPrompt: 'One calming breath. Embrace the stillness.',
                        audio: { voice: 'rest/r2_recovery.wav', release: RELEASE_SOFT },
                    },
                    {
                        type: 'active',
                        breaths: 15,
                        pattern: [4, 0, 8, 4],
                        round: 3,
                        prompt: 'Round 3 • Surrender',
                        subPrompt: 'Breath becomes effortless. Body becomes light. Mind becomes still.',
                        // "Final round... give everything" is wrong for a session made for sleep.
                        audio: { voice: 'rest/r3_active.wav', transition: 'encouragement/almost_done.wav', cues: { in: 'voices/cues/breathe_in_soft.wav', out: 'voices/cues/breathe_out_soft.wav' } },
                    },
                    {
                        type: 'retention',
                        hold: 'timed',
                        duration: 30,
                        round: 3,
                        prompt: 'Deep Rest',
                        subPrompt: 'Drift into stillness. There is nowhere to go, nothing to do.',
                        audio: { voice: 'rest/r3_hold.wav', transition: 'cues/hold_soft.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Peace',
                        subPrompt: 'Final breath. Complete peace. You are ready.',
                        audio: { voice: 'rest/r3_recovery.wav', release: RELEASE_SOFT },
                    },
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Sleep Integration',
                        subPrompt: 'Natural breath now. Allow yourself to drift. Sweet dreams await.',
                        audio: {
                            voice: 'rest/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/nothing_to_do.wav', 'fillers/you_are_safe.wav', 'fillers/waves_ocean.wav', 'fillers/let_go.wav', 'encouragement/thank_yourself.wav'],
                        },
                    },
                ],
            },
            FLOW: {
                id: 'hale-flow',
                name: 'Hale Flow',
                description: 'A balanced box breathing practice that creates equilibrium and cultivates rhythmic awareness.',
                intensity: 'Moderate',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 120,
                        pattern: [5, 2, 5, 2],
                        round: 0,
                        prompt: 'Finding Center',
                        subPrompt: 'Notice your heartbeat. Let it guide you to presence.',
                        audio: {
                            sessionIntro: 'session_intros/flow_intro.wav',
                            voice: 'flow/grounding_intro.wav',
                            cues: { in: 'voices/cues/breathe_in.wav', out: 'voices/cues/let_it_flow.wav' },
                        },
                    },
                    {
                        type: 'active',
                        breaths: 12,
                        pattern: [4, 4, 4, 4],
                        round: 1,
                        prompt: 'Round 1 • Box Breathing',
                        subPrompt: 'Inhale 4. Hold 4. Exhale 4. Hold 4. Find your rhythm.',
                        audio: { voice: 'flow/r1_active.wav', transition: 'transitions/round1_start.wav', cues: CUES },
                    },
                    {
                        type: 'carry',
                        duration: 30,
                        pattern: [4, 4, 4, 4],
                        round: 1,
                        prompt: 'Flow State',
                        subPrompt: 'Let the rhythm continue in your body. Natural, effortless.',
                        audio: { voice: 'flow/r1_hold.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Reset',
                        subPrompt: 'One deep breath. Feel the balance.',
                        audio: { voice: 'flow/r1_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'active',
                        breaths: 15,
                        pattern: [5, 5, 5, 5],
                        round: 2,
                        prompt: 'Round 2 • Expand the Box',
                        subPrompt: 'Longer counts now. Inhale 5. Hold 5. Exhale 5. Hold 5.',
                        audio: {
                            voice: 'flow/r2_active.wav',
                            transition: 'transitions/round2_start.wav',
                            cues: CUES,
                            encourage: { clip: 'encouragement/halfway.wav', at: 0.5 },
                        },
                    },
                    {
                        type: 'carry',
                        duration: 40,
                        pattern: [5, 5, 5, 5],
                        round: 2,
                        prompt: 'Deeper Flow',
                        subPrompt: 'You are the breath. The breath is you. Unity.',
                        audio: { voice: 'flow/r2_hold.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recenter',
                        subPrompt: 'One cleansing breath. Fully present.',
                        audio: { voice: 'flow/r2_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'active',
                        breaths: 18,
                        pattern: [6, 6, 6, 6],
                        round: 3,
                        prompt: 'Round 3 • Master Box',
                        subPrompt: 'Full expansion. Inhale 6. Hold 6. Exhale 6. Hold 6. Perfect balance.',
                        audio: { voice: 'flow/r3_active.wav', transition: 'encouragement/almost_done.wav', cues: CUES },
                    },
                    {
                        type: 'carry',
                        duration: 60,
                        pattern: [6, 6, 6, 6],
                        round: 3,
                        prompt: 'Peak Flow',
                        subPrompt: 'Complete equilibrium. Mind clear as still water.',
                        audio: { voice: 'flow/r3_hold.wav' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Balance',
                        subPrompt: 'One conscious breath. Carry this balance with you.',
                        audio: { voice: 'flow/r3_recovery.wav', release: RELEASE },
                    },
                    {
                        type: 'integration',
                        duration: 240,
                        round: 0,
                        prompt: 'Flow Integration',
                        subPrompt: 'Return to natural rhythm. You are balanced. You are present.',
                        audio: {
                            voice: 'flow/integration.wav',
                            transition: 'transitions/integration_start.wav',
                            fillers: ['fillers/floating_vibrating.wav', 'fillers/stay_here.wav', 'fillers/inner_light.wav', 'fillers/complete_whole.wav', 'encouragement/proud.wav'],
                        },
                    },
                ],
            },
        };
    }

    /** Planned length of a session in seconds (open holds counted at their suggestion). */
    _calculateTotalDuration(sessionId) {
        const session = this.SESSIONS[sessionId];
        if (!session) return 0;
        return session.phases.reduce((total, phase) => total + this._phaseSeconds(phase), 0);
    }

    /** How long a stage lasts: counted breaths for the active rounds, a fixed time otherwise. */
    _phaseSeconds(phase) {
        if (phase.type === 'active') return phase.pattern.reduce((a, b) => a + b, 0) * phase.breaths;
        return phase.duration;
    }

    /** The world a stage is set in (see SESSION_WORLDS). */
    _worldFor(phase) {
        const worlds = SESSION_WORLDS[this.sessionId] || SESSION_WORLDS.BASE;
        const choice = worlds[phase.type] || worlds.grounding;
        return Array.isArray(choice) ? choice[Math.max(0, (phase.round || 1) - 1) % choice.length] : choice;
    }

    /** A hold you end yourself: Base and Elixir, unless you asked for timed holds. */
    _isOpenHold(phase) {
        return phase?.type === 'retention' && phase.hold === 'open' && this.options.openHolds !== false;
    }

    /** An open hold's safety limit: twice its suggestion, at least 30 s over, at most four minutes. */
    _holdCap(phase) {
        return Math.min(MAX_OPEN_HOLD_SECONDS, Math.max(phase.duration + 30, phase.duration * 2));
    }

    /** How the guide guides this stage. */
    _guidanceFor(phase) {
        if (phase.type === 'retention') {
            const open = this._isOpenHold(phase);
            return {
                mode: open ? 'open-hold' : 'timed-hold',
                suggested: phase.duration,
                cap: open ? this._holdCap(phase) : phase.duration,
            };
        }
        if (phase.type === 'carry') return { mode: 'carry', seconds: phase.duration };
        if (phase.type === 'integration') return { mode: 'natural', seconds: phase.duration };
        return { mode: 'paced' };
    }

    /** Paced stages are the ones with counted breaths (and so breath tones). */
    _isPaced(phase) {
        return phase.type === 'grounding' || phase.type === 'active';
    }

    _onIndicatorControl(action) {
        if (action === 'pause') {
            this.pausedBySuspension = false;
            this.pauseSession();
        } else if (action === 'resume') {
            // You chose to continue: whatever held the session for you is over.
            this.suspensions.clear();
            this.pausedBySuspension = false;
            this.resumeSession();
        } else if (action === 'breathe') {
            this.breathe();
        } else if (action === 'suspend') {
            this.suspend('confirm');
        } else if (action === 'unsuspend') {
            this.unsuspend('confirm');
        } else if (action === 'end') {
            if (this.onEndRequested) this.onEndRequested();
            else this.stopSession();
        }
    }

    /**
     * Start a session.
     * @param {string} sessionId 'BASE', 'ELIXIR', 'REST' or 'FLOW'
     * @param {function} [onProgress] receives a progress report ten times a second
     * @param {function} [onComplete] receives what was measured when the session ends naturally
     * @param {object|function} [options] see DEFAULT_OPTIONS (a function is taken as onPhaseChange)
     */
    startSession(sessionId, onProgress, onComplete, options = {}) {
        if (this.destroyed) return;
        const session = this.SESSIONS[sessionId];
        if (!session) {
            console.error('Invalid session ID:', sessionId);
            return;
        }
        const chosen = typeof options === 'function' ? { onPhaseChange: options } : (options || {});

        this.stopSession();
        this.activeSession = session;
        this.sessionId = sessionId;
        this.options = { ...DEFAULT_OPTIONS, ...chosen };
        this.chimes.setEnabled(this.options.sounds !== false);
        this.chimes.setVibration(this.options.vibration !== false);
        this.currentPhaseIndex = 0;
        this.currentRound = 0;
        this.currentBreathCount = 0;
        this.breathCycleCount = 0;
        this.sessionStartTime = Date.now();
        this.totalSessionDuration = this._calculateTotalDuration(sessionId);
        let elapsed = 0;
        this.phaseDurationOffsets = session.phases.map((phase) => {
            const offset = elapsed;
            elapsed += this._phaseSeconds(phase);
            return offset;
        });
        this.measure = { breaths: 0, rounds: 0, holds: [] };
        this.onProgressCallback = onProgress;
        this.onCompleteCallback = onComplete;
        this.onPhaseChangeCallback = this.options.onPhaseChange;
        this.isPaused = false;

        this.audioManager?.preloadSession(sessionId, session, [this.options.intention?.clip].filter(Boolean));

        if (this.indicator) {
            this.indicator.setExternalControl(true);
            this.indicator.setSessionTheme?.(sessionId);
            this.indicator.setJourney?.(session.phases.map((phase) => ({
                type: phase.type, round: phase.round || 0, seconds: this._phaseSeconds(phase),
            })));
            this.indicator.setIntention?.(this.options.intention?.label || null);
            // The guide's own Pause, End and Breathe controls act on this session.
            this.indicator.onControl = (action) => this._onIndicatorControl(action);
            this.indicatorPhaseHandler = (newPhase, prevPhase) => this._onBreathPhaseChange(newPhase, prevPhase);
            this.indicator.onPhaseChangeCallback = this.indicatorPhaseHandler;
            this.indicator.start();
            this.indicator.showProgress?.(true);
        }
        globalThis.document?.addEventListener?.('visibilitychange', this._onVisibility);
        this._keepAwake(true);
        this.bellRang = this.chimes.bell('start');

        this._runPhase();
    }

    /** Stop the current session (nothing is reported; the caller decides what to keep). */
    stopSession() {
        const hadSession = Boolean(this.activeSession);
        this._clearPhaseTimers();
        this.activeSession = null;
        this.isPaused = false;
        this.holdState = null;
        this.suspensions.clear();
        this.pausedBySuspension = false;
        this.onProgressCallback = null;
        this.onCompleteCallback = null;
        this.onPhaseChangeCallback = null;
        globalThis.document?.removeEventListener?.('visibilitychange', this._onVisibility);
        this._keepAwake(false);

        if (this.indicator && hadSession) {
            if (this.indicator.onPhaseChangeCallback === this.indicatorPhaseHandler) {
                this.indicator.onPhaseChangeCallback = null;
            }
            this.indicatorPhaseHandler = null;
            this.indicator.setExternalControl(false);
            this.indicator.setSessionPhase?.(null, 0);
            this.indicator.setGuidance?.(null);
            this.indicator.setIntention?.(null);
            this.indicator.setSessionTheme?.(null);
            this.indicator.setPrompt?.('');
            this.indicator.stop();
            this.indicator.showProgress?.(false);
        }

        this.audioManager?.stopAll();
        if (hadSession) this.chimes.silence();
    }

    _clearPhaseTimers() {
        this.phaseToken += 1;
        clearInterval(this.progressUpdateTimer);
        this.progressUpdateTimer = null;
        for (const entry of this.phaseTimeouts) clearTimeout(entry.timer);
        this.phaseTimeouts.clear();
    }

    /**
     * Run `callback` after `delay` ms of session time. A pause holds every pending entry at
     * its remaining time; a resume re-arms them, so nothing is lost and nothing fires early.
     */
    _schedulePhase(callback, delay) {
        const { phaseToken } = this;
        const entry = {
            timer: null, due: 0, remaining: delay, arm: null,
        };
        entry.arm = (ms) => {
            entry.due = Date.now() + ms;
            entry.timer = setTimeout(() => {
                this.phaseTimeouts.delete(entry);
                if (this.activeSession && !this.isPaused && phaseToken === this.phaseToken) callback();
            }, ms);
        };
        this.phaseTimeouts.add(entry);
        entry.arm(delay);
        return entry;
    }

    destroy() {
        if (this.destroyed) return;
        this.stopSession();
        this.destroyed = true;
        this.audioManager?.destroy();
        this.chimes.silence();
        this.indicator = null;
    }

    /** Keep the visual cycle inside the phase's existing timing budget. */
    _getVisualPattern(phase) {
        if (phase.type === 'retention') {
            // Retention follows the release: hold the visual at its empty state.
            return [0, 0, 0, phase.duration];
        }
        if (phase.type === 'recovery') {
            // Reserve time for both the recovery inhale and its final release.
            const breathDuration = Math.min(2, phase.duration / 2);
            return [breathDuration, phase.duration - breathDuration * 2, breathDuration, 0];
        }
        if (phase.type === 'integration') return phase.pattern || [...NATURAL_PATTERN];
        return phase.pattern || [5, 2, 5, 2];
    }

    /** Run the current phase. @private */
    _runPhase() {
        if (!this.activeSession || this.isPaused) return;
        this._clearPhaseTimers();
        const { phaseToken } = this;

        const phase = this.activeSession.phases[this.currentPhaseIndex];
        this.phaseStartTime = Date.now();
        this.currentBreathCount = 0;
        this.waitForNextInhale = false;
        this.currentCycleIsGuidance = false;
        this.forcedGuidanceRemaining = 0;
        this.wasVoicePlaying = false;
        this.intentionScheduled = false;
        if (phase.round > 0) this.currentRound = phase.round;

        const phaseDuration = this._phaseSeconds(phase);
        this.currentPhaseDuration = phaseDuration;
        const openHold = this._isOpenHold(phase);
        this.holdState = openHold ? {
            suggested: phase.duration, cap: this._holdCap(phase), ready: false, endedBy: null,
        } : null;

        if (this.indicator) {
            this.indicator.setPrompt?.(phase.prompt, phase.subPrompt);
            this.indicator.setTechnique(this._worldFor(phase), false);
            this.indicator.overridePattern(this._getVisualPattern(phase));
            this.indicator.setSessionPhase?.(phase.type, 0);
            this.indicator.setGuidance?.(this._guidanceFor(phase));
            this._presentStage(phase);
        }

        this.onPhaseChangeCallback?.({
            phaseType: phase.type,
            round: phase.round,
            totalRounds: this.activeSession.totalRounds,
            prompt: phase.prompt,
            subPrompt: phase.subPrompt,
        });
        if (phaseToken !== this.phaseToken || !this.activeSession) return;

        this._startProgressUpdates(phase, phaseDuration);
        if (phaseToken !== this.phaseToken || !this.activeSession) return;

        // An open hold ends when you breathe in, or at its safety limit; every other stage on
        // the session clock. Breaths are counted from the same clock.
        if (openHold) {
            this._schedulePhase(() => this._holdReady(), phase.duration * 1000);
            this._schedulePhase(() => this._endHold('limit'), this.holdState.cap * 1000);
        } else {
            this._schedulePhase(() => this._nextPhase(), phaseDuration * 1000);
        }

        // A round opens with a bell; a hold with a pulse you can feel with your eyes closed.
        let bell = this.currentPhaseIndex === 0 && this.bellRang;
        if (phase.type === 'active' && phase.round > 0) {
            bell = this.chimes.bell('round');
            this.chimes.pulse('round');
        } else if (phase.type === 'retention') {
            this.chimes.pulse('hold');
        }
        if (phase.audio?.encourage && phaseDuration > 0) {
            this._schedulePhase(() => this._encourage(phase), phaseDuration * phase.audio.encourage.at * 1000);
        }
        if (phase.type === 'integration' && phaseDuration > CLOSING_SECONDS * 2) {
            this._schedulePhase(() => this._closing(), (phaseDuration - CLOSING_SECONDS) * 1000);
        }

        if (this.audioManager && phase.audio) {
            // Cues wait while the stage's voice is about to speak.
            this.audioManager.isVoicePending = true;
            const voiceChain = [];
            // A bell first, then the voice once its strike has bloomed.
            if (bell) voiceChain.push({ delay: BELL_LEAD_MS });
            if (phase.audio.sessionIntro && phase.type === 'grounding') {
                voiceChain.push(phase.audio.sessionIntro, { delay: 2000 });
            }
            if (phase.audio.transition) voiceChain.push(phase.audio.transition);
            if (phase.audio.voice) voiceChain.push(phase.audio.voice);
            this._playVoiceChain(voiceChain, phase);
        }
    }

    /** The round card, the line read to a screen reader, and the intention as you arrive. */
    _presentStage(phase) {
        const { indicator } = this;
        const total = this.activeSession.totalRounds;
        const title = String(phase.prompt || '').split('•').pop().trim();
        if (phase.type === 'active' && phase.round > 0) {
            indicator.showChapter?.({ eyebrow: `Round ${phase.round} of ${total}`, title, note: `${phase.breaths} breaths` });
        } else if (phase.type === 'grounding' && this.currentPhaseIndex === 0) {
            const label = this.options.intention?.label;
            indicator.showChapter?.({ eyebrow: this.activeSession.name, title: 'Arrive', note: label ? `Your intention · ${label}` : 'Nothing to achieve. Just be here.' });
        } else if (phase.type === 'integration') {
            indicator.showChapter?.({ eyebrow: 'Rest', title, note: 'Let the breath find its own way' });
        }
        indicator.announce?.(this._stageAnnouncement(phase, title));
    }

    _stageAnnouncement(phase, title) {
        const total = this.activeSession.totalRounds;
        if (phase.type === 'active') return `Round ${phase.round} of ${total}. ${title}. ${phase.breaths} breaths.`;
        if (phase.type === 'retention') {
            return this._isOpenHold(phase)
                ? 'Hold on empty lungs. Breathe in whenever you need to: press Space or tap.'
                : `Rest in the pause for ${phase.duration} seconds.`;
        }
        if (phase.type === 'carry') return `Keep the rhythm on your own for ${phase.duration} seconds.`;
        if (phase.type === 'recovery') return `${title}. Breathe in deeply and hold.`;
        if (phase.type === 'integration') return `Rest. ${title}. Breathe naturally.`;
        return `${title}. ${phase.subPrompt || ''}`.trim();
    }

    /** The open hold reached its suggestion: a small bell, and the choice is yours. */
    _holdReady() {
        if (!this.holdState || this.holdState.ready) return;
        this.holdState.ready = true;
        this.chimes.bell('hold');
        this.chimes.pulse('ready');
        this.indicator?.announce?.('Breathe in whenever you are ready.');
    }

    /**
     * You breathe in: end the open hold now and go to its recovery breath.
     * @returns {boolean} whether a hold ended
     */
    breathe() {
        if (!this.activeSession || this.isPaused || !this.holdState) return false;
        if (Date.now() - this.phaseStartTime < MIN_OPEN_HOLD_MS) return false;
        this._endHold('you');
        return true;
    }

    _endHold(reason) {
        if (!this.activeSession || !this.holdState) return;
        this.holdState.endedBy = reason;
        this._nextPhase();
    }

    _encourage(phase) {
        const clip = phase.audio?.encourage?.clip;
        const audio = this.audioManager;
        // Never over the voice: a missed encouragement is better than a crowded one.
        if (!clip || !audio || audio.isVoicePlaying || audio.isVoicePending) return;
        audio.playVoice(clip);
    }

    /** The last moments of the rest: the words turn to coming back. */
    _closing() {
        this.indicator?.setPrompt?.('Coming back', 'Let the breath deepen a little. Move your fingers and toes. Open your eyes when you are ready.');
        this.indicator?.setGuidance?.({ mode: 'closing' });
        this.indicator?.announce?.('The session is ending. Come back gently.');
    }

    /**
     * Play a chain of voice files sequentially, waiting for each to complete
     * @param {Array<string|{delay: number}>} voiceChain voice paths and pauses, in order
     * @param {object} phase the stage the chain belongs to
     * @private
     */
    _playVoiceChain(voiceChain, phase) {
        if (!voiceChain || voiceChain.length === 0) {
            this.audioManager.isVoicePending = false;
            return;
        }

        let currentIndex = 0;
        const { phaseToken } = this;

        const playNext = () => {
            if (!this.activeSession || this.isPaused || phaseToken !== this.phaseToken
                || this.activeSession.phases[this.currentPhaseIndex] !== phase) {
                return;
            }
            if (currentIndex >= voiceChain.length) {
                if (phase.audio?.fillers?.length) this._scheduleFillersAudio(phase.audio.fillers, 10000, phase);
                return;
            }
            const item = voiceChain[currentIndex];
            currentIndex++;
            if (typeof item === 'object' && item.delay) {
                this._schedulePhase(playNext, item.delay);
                return;
            }
            this.audioManager.playVoiceWithCallback(item, playNext);
        };

        playNext();
    }

    /**
     * Spread the rest's spoken lines over the stage so the last one lands well before the end,
     * leaving the close quiet. @private
     */
    _scheduleFillersAudio(fillers, startDelay, phase) {
        const stageMs = this._phaseSeconds(phase) * 1000;
        const elapsedMs = Math.max(0, Date.now() - this.phaseStartTime);
        const span = Math.max(0, stageMs - FILLER_TAIL_SECONDS * 1000 - elapsedMs - startDelay);
        const gap = fillers.length > 1 ? Math.max(FILLER_MIN_GAP_MS, span / (fillers.length - 1)) : 0;
        fillers.forEach((filler, index) => {
            const delay = startDelay + gap * index;
            // Nothing may speak over the closing words.
            if (index > 0 && elapsedMs + delay > stageMs - (CLOSING_SECONDS + 4) * 1000) return;
            this._schedulePhase(() => {
                if (this.activeSession?.phases[this.currentPhaseIndex] === phase) this.audioManager.playVoice(filler);
            }, delay);
        });
    }

    /**
     * The guide crossed into a new part of the breath. Speak a cue on guided cycles, play a
     * breath tone on the others, and let a recovery breath go with its "release".
     * @param {string} newPhase 'inhale', 'hold1', 'exhale' or 'hold2'
     * @private
     */
    _onBreathPhaseChange(newPhase) {
        if (!this.activeSession || this.isPaused) return;
        const phase = this.activeSession.phases[this.currentPhaseIndex];
        if (!phase) return;
        const audio = this.audioManager;
        if (phase.type === 'recovery') {
            if (newPhase === 'exhale' && phase.audio?.release) audio.playCue(phase.audio.release);
            return;
        }
        const spoke = this._speakCue(phase, newPhase);
        if (!spoke && this._isPaced(phase) && (newPhase === 'inhale' || newPhase === 'exhale')
            && !audio.isVoicePlaying && !audio.isVoicePending) {
            const seconds = this.indicator?.pattern?.[newPhase === 'inhale' ? 0 : 2];
            this.chimes.tone(newPhase === 'inhale' ? 'in' : 'out', seconds);
        }
    }

    /**
     * Spoken cues: three guided breaths after the voice falls silent, then every fifth breath.
     * @returns {boolean} whether a cue was spoken on this boundary
     */
    _speakCue(phase, newPhase) {
        const cues = phase.audio?.cues;
        if (!cues) return false;
        const audio = this.audioManager;
        if (audio.isVoicePlaying) {
            this.wasVoicePlaying = true;
            this.waitForNextInhale = false;
            this.currentCycleIsGuidance = false;
            return false;
        }
        if (this.wasVoicePlaying) {
            this.wasVoicePlaying = false;
            this.waitForNextInhale = true;
        }
        if (newPhase === 'inhale') {
            this.breathCycleCount += 1;
            if (this.waitForNextInhale) {
                this.waitForNextInhale = false;
                this.forcedGuidanceRemaining = 3;
            }
            if (this.forcedGuidanceRemaining > 0) {
                this.forcedGuidanceRemaining -= 1;
                this.currentCycleIsGuidance = true;
            } else {
                this.currentCycleIsGuidance = this.breathCycleCount % 5 === 0;
            }
        }
        if (!this.currentCycleIsGuidance || audio.isVoicePending) return false;
        if (newPhase === 'inhale' && cues.in) {
            audio.playCue(cues.in);
            return true;
        }
        if (newPhase === 'exhale' && cues.out) {
            audio.playCue(cues.out);
            // The intention you chose is spoken once, a little after your first guided breath.
            const clip = this.options.intention?.clip;
            if (clip && phase.type === 'grounding' && !this.intentionScheduled) {
                this.intentionScheduled = true;
                this._schedulePhase(() => {
                    if (this.activeSession?.phases[this.currentPhaseIndex] === phase) audio.playVoice(clip);
                }, 10000);
            }
            return true;
        }
        return false;
    }

    /** Start continuous progress updates. @private */
    _startProgressUpdates(phase, phaseDuration) {
        if (this.progressUpdateTimer) clearInterval(this.progressUpdateTimer);

        const { phaseToken } = this;
        const elapsedBeforePhase = this.phaseDurationOffsets[this.currentPhaseIndex] || 0;
        const breathCycle = phase.type === 'active' ? phase.pattern.reduce((a, b) => a + b, 0) : 0;
        const hold = this.holdState;
        const updateProgress = () => {
            if (!this.activeSession || this.isPaused || phaseToken !== this.phaseToken) return;

            const elapsed = (Date.now() - this.phaseStartTime) / 1000;
            const remaining = Math.max(0, phaseDuration - elapsed);
            const phaseProgress = Math.min(1, elapsed / phaseDuration);
            this.currentBreathCount = breathCycle > 0
                ? Math.min(phase.breaths, Math.floor(elapsed / breathCycle)) : 0;
            // The journey is laid out by plan; a hold held past its suggestion waits at its end.
            const elapsedSessionTime = elapsedBeforePhase + Math.min(elapsed, phaseDuration);
            const sessionProgress = Math.min(1, elapsedSessionTime / this.totalSessionDuration);

            const progressData = {
                phase: phase.type,
                phaseIndex: this.currentPhaseIndex + 1,
                totalPhases: this.activeSession.phases.length,
                round: phase.round || this.currentRound,
                totalRounds: this.activeSession.totalRounds,
                breathCount: this.currentBreathCount,
                totalBreaths: phase.breaths || 0,
                isActivePhase: phase.type === 'active',
                remainingTime: Math.ceil(remaining),
                phaseDuration,
                phaseProgress,
                sessionProgress,
                sessionRemaining: Math.max(0, this.totalSessionDuration - elapsedSessionTime),
                prompt: phase.prompt,
                sessionName: this.activeSession.name,
                sessionId: this.sessionId,
                holdElapsed: hold ? elapsed : null,
                holdSuggested: hold ? hold.suggested : null,
                holdReady: hold ? hold.ready : false,
            };

            this.onProgressCallback?.(progressData);
            if (!this.activeSession || phaseToken !== this.phaseToken) return;

            this.indicator?.setSessionPhase?.(phase.type, phaseProgress);
            this.indicator?.updateProgress?.({
                sessionName: progressData.sessionName,
                phase: progressData.phase,
                phaseIndex: progressData.phaseIndex,
                phaseProgress,
                round: phase.round || 0,
                totalRounds: progressData.totalRounds,
                breathCount: progressData.breathCount,
                totalBreaths: progressData.totalBreaths,
                remainingTime: progressData.remainingTime,
                sessionProgress,
                sessionRemaining: progressData.sessionRemaining,
                holdElapsed: progressData.holdElapsed,
                holdSuggested: progressData.holdSuggested,
                holdReady: progressData.holdReady,
            });
        };

        updateProgress();
        if (this.activeSession && !this.isPaused && phaseToken === this.phaseToken) {
            this.progressUpdateTimer = setInterval(updateProgress, 100);
        }
    }

    /** Note what the stage you are leaving actually held. */
    _recordStage() {
        const phase = this.activeSession?.phases[this.currentPhaseIndex];
        if (!phase || !this.measure) return;
        const elapsed = Math.max(0, (Date.now() - this.phaseStartTime) / 1000);
        const planned = this._phaseSeconds(phase);
        const finished = elapsed >= planned - 0.05;
        if (phase.type === 'active') {
            const cycle = phase.pattern.reduce((a, b) => a + b, 0);
            this.measure.breaths += finished ? phase.breaths : Math.min(phase.breaths, Math.floor(elapsed / cycle));
        } else if (phase.type === 'retention') {
            this.measure.holds.push({
                round: phase.round || 0,
                seconds: Math.round(elapsed),
                suggested: phase.duration,
                mode: this.holdState ? 'open' : 'timed',
                endedBy: this.holdState?.endedBy || 'timer',
            });
        } else if (phase.type === 'recovery' && finished) {
            this.measure.rounds += 1;
        }
    }

    /** Advance to the next phase. @private */
    _nextPhase() {
        if (!this.activeSession || this.isPaused) return;
        this._recordStage();
        this._clearPhaseTimers();
        this.holdState = null;
        this.currentPhaseIndex++;
        if (this.currentPhaseIndex >= this.activeSession.phases.length) {
            this._completeSession();
        } else {
            this._runPhase();
        }
    }

    _sessionSeconds(now = Date.now()) {
        const pausedFor = this.isPaused && this.pauseTime ? now - this.pauseTime : 0;
        return Math.max(0, Math.round((now - this.sessionStartTime - pausedFor) / 1000));
    }

    _report(measure) {
        const holds = measure.holds.map((hold) => ({ ...hold }));
        return {
            sessionId: this.sessionId,
            sessionName: this.activeSession.name,
            totalDuration: this._sessionSeconds(),
            rounds: measure.rounds,
            totalRounds: this.activeSession.totalRounds,
            breaths: measure.breaths,
            holds,
            longestHold: holds.reduce((best, hold) => Math.max(best, hold.seconds), 0),
            intention: this.options.intention?.label || null,
        };
    }

    /**
     * What has been practised so far, including the stage in progress (for an ended session).
     * @returns {object|null}
     */
    snapshot() {
        if (!this.activeSession || !this.measure) return null;
        const measure = { ...this.measure, holds: [...this.measure.holds] };
        const phase = this.activeSession.phases[this.currentPhaseIndex];
        if (phase) {
            const until = this.isPaused && this.pauseTime ? this.pauseTime : Date.now();
            const elapsed = Math.max(0, (until - this.phaseStartTime) / 1000);
            if (phase.type === 'active') {
                const cycle = phase.pattern.reduce((a, b) => a + b, 0);
                measure.breaths += Math.min(phase.breaths, Math.floor(elapsed / cycle));
            } else if (phase.type === 'retention' && elapsed >= 5) {
                measure.holds.push({
                    round: phase.round || 0,
                    seconds: Math.round(elapsed),
                    suggested: phase.duration,
                    mode: this.holdState ? 'open' : 'timed',
                    endedBy: 'ended',
                });
            }
        }
        return { ...this._report(measure), completed: false };
    }

    /** Complete the session. @private */
    _completeSession() {
        clearInterval(this.progressUpdateTimer);
        const stats = { ...this._report(this.measure), completed: true };
        const onComplete = this.onCompleteCallback;
        this.stopSession();
        // The closing bell rings out over the result.
        this.chimes.bell('end');
        this.chimes.pulse('end');
        if (onComplete) onComplete(stats);
    }

    /** Pause the current session. */
    pauseSession() {
        if (!this.activeSession || this.isPaused) return;

        this.isPaused = true;
        this.pauseTime = Date.now();
        clearInterval(this.progressUpdateTimer);
        this.progressUpdateTimer = null;
        // Hold every pending piece of stage work at the time it still had to run.
        for (const entry of this.phaseTimeouts) {
            clearTimeout(entry.timer);
            entry.timer = null;
            entry.remaining = Math.max(0, entry.due - this.pauseTime);
        }
        this.indicator?.pause?.();
        this.audioManager?.pauseAll();
        this._keepAwake(false);
    }

    /** Resume the current session. */
    resumeSession() {
        if (!this.activeSession || !this.isPaused) return;

        this.isPaused = false;
        const pauseDuration = Date.now() - this.pauseTime;
        this.phaseStartTime += pauseDuration;
        this.sessionStartTime += pauseDuration;

        // Continue from the same moment: re-arm the held work and pick the voice back up.
        for (const entry of this.phaseTimeouts) entry.arm(entry.remaining);
        this.indicator?.resume?.();
        this.audioManager?.resumeAll();
        this._keepAwake(true);
        const phase = this.activeSession.phases[this.currentPhaseIndex];
        if (phase) this._startProgressUpdates(phase, this.currentPhaseDuration);
    }

    /** Hold the session for a reason that is not you (the Hub over it, an end confirmation). */
    suspend(reason) {
        if (!this.activeSession) return;
        this.suspensions.add(reason);
        if (!this.isPaused) {
            this.pauseSession();
            this.pausedBySuspension = true;
        }
    }

    /** That reason has passed: continue, unless something else holds it or you paused it. */
    unsuspend(reason) {
        if (!this.suspensions.delete(reason)) return;
        if (!this.suspensions.size && this.pausedBySuspension) {
            this.pausedBySuspension = false;
            this.resumeSession();
        }
    }

    /** Hidden pages throttle timers: hold the session, and wait for you when you come back. */
    _handleVisibility() {
        if (!this.activeSession) return;
        if (globalThis.document?.hidden) {
            this.suspend('hidden');
        } else if (this.suspensions.delete('hidden') && !this.suspensions.size) {
            // Coming back you find it paused where you left it; you choose when to go on.
            this.pausedBySuspension = false;
        }
    }

    /** Ask the screen to stay on while a session runs (phones dim after a minute or two). */
    _keepAwake(on) {
        if (!on) {
            this.wakeToken += 1;
            const lock = this.wakeLock;
            this.wakeLock = null;
            Promise.resolve(lock?.release?.()).catch(() => {});
            return;
        }
        const request = globalThis.navigator?.wakeLock?.request;
        if (this.wakeLock || typeof request !== 'function' || globalThis.document?.hidden) return;
        const token = ++this.wakeToken;
        Promise.resolve(request.call(globalThis.navigator.wakeLock, 'screen')).then((lock) => {
            if (token !== this.wakeToken || !this.activeSession || this.isPaused) {
                Promise.resolve(lock?.release?.()).catch(() => {});
                return;
            }
            this.wakeLock = lock;
        }).catch(() => { /* not allowed here (no gesture, or unsupported): the screen may dim */ });
    }
}

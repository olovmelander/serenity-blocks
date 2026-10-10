/**
 * BreathworkSessionManager - runs the Hale sessions.
 *
 * A session is a journey of stages (arrive, rounds of breathing, with stillness and recovery in
 * the longer practices, then rest). The manager owns its clock, its voice and its bells; the
 * breathing guide follows it: each stage hands the guide a rhythm, a world, what to say and how
 * to guide (counted breaths, a hold you end yourself, a rhythm you keep on your own, or your
 * natural breath).
 *
 * Every piece of stage work is scheduled through _schedulePhase, so a pause can freeze the
 * session exactly where it is and a resume continues from the same moment. The session is
 * paused for you while the Hub is over it, while you confirm ending it, and when the page is
 * hidden (timers there are throttled; a session must never run on without you).
 *
 * What you actually did is measured: breaths, rounds, and how long you held each breath.
 */

import { BreathworkAudioManager } from './breathwork-audio-manager.js';
import { recordedVoiceFile, recordedVoiceSeconds } from './breathwork-recorded-voices.js';
import { BreathworkChimes } from './breathwork-chimes.js';
import { SESSION_WORLDS } from './breathing/session-worlds.js';
import { SESSION_CUES } from './breathing/session-cues.js';
import { worldCuePairs, worldPauseCues } from './breathing/breath-catalogue.js';
import { MIN_CUE_SECONDS, createCueDraw, drawTake } from './breathing/cue-variety.js';

export { SESSION_WORLDS } from './breathing/session-worlds.js';

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

// Voice lines are ids in scripts/tts-script.json ('<group>/<line>'); the recorded index says
// which file plays and how long it is, and a line not recorded yet is shown, never requested.
// Each session has its own breath cues (session-cues.js), each cue a pool of takes: a guided
// run opens on its plain words, then draws from all of them, so no two breaths sound alike.
const C = SESSION_CUES;
/** Guided breaths after the voice falls silent, in plain words first. */
const GUIDED_RUN = 3;
/** The four parts of a breath, in the order of a pattern: the cue each one takes. */
const CUE_PARTS = Object.freeze({
    inhale: ['in', 0], hold1: ['hold', 1], exhale: ['out', 2], hold2: ['rest', 3],
});
/** Spoken as an open hold reaches its suggestion. */
export const HOLD_READY_LINE = 'transitions/breathe_when_ready';
/**
 * How a session ends, fourteen seconds before its last moment: coming back, or (for the evening
 * sessions) drifting into sleep, with no bell to wake you.
 */
export const CLOSINGS = Object.freeze({
    wake: Object.freeze({
        line: 'closings/wake',
        title: 'Coming Back',
        text: 'Let the breath deepen a little. Move your fingers and toes, and open your eyes when you\'re ready.',
        phase: 'Come back gently',
        hint: 'Open your eyes when you are ready',
        announce: 'The session is ending. Come back gently.',
        bell: true,
    }),
    sleep: Object.freeze({
        line: 'closings/sleep',
        title: 'Drifting Off',
        text: 'Stay just as you are. There\'s nothing more to do. Let sleep come.',
        phase: 'Let sleep come',
        hint: 'Stay as long as you like',
        announce: 'The session is ending. Stay as you are, and let sleep come.',
        bell: false,
    }),
});
export const CLOSING_LINE = CLOSINGS.wake.line;

export class BreathworkSessionManager {
    constructor(breathingIndicator) {
        this.indicator = breathingIndicator;
        // Lines written but not yet recorded are shown on screen, never requested.
        this.audioManager = new BreathworkAudioManager({
            resolveClip: recordedVoiceFile, clipSeconds: recordedVoiceSeconds,
        });
        /** Picks each cue's take, so no two breaths in a row sound alike. */
        this.cueDraw = createCueDraw();
        /** The world couplet this breath speaks: { world, in, out, words }. */
        this.worldCouplet = null;
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

        // Every stage: what it asks (prompt, subPrompt), how long, and what is said. The spoken
        // line of a stage says the same words as its subPrompt (scripts/tts-script.json holds the
        // spoken form, with its pauses). A retention's `hold` is 'open' when you choose when to
        // breathe again; a 'carry' stage keeps the round's rhythm on your own, uncounted. An
        // arrival without a pattern is breathed at your own pace. The order is the path through
        // them: the short sessions first, then the longer practices.
        this.SESSIONS = {
            FIRST: {
                id: 'hale-first-breath',
                name: 'Hale First Breath',
                description: 'A first taste of the starter worlds: Heart Glow, a gentle square, Moonlit Waters, then rest.',
                intensity: 'Gentle',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 45,
                        round: 0,
                        prompt: 'Arrive',
                        subPrompt: 'Sit comfortably. Let your shoulders drop, and breathe through your nose at whatever '
                            + 'pace feels easy.',
                        audio: { sessionIntro: 'session_intros/first_intro', voice: 'first/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 6,
                        pattern: [5, 0, 5, 0],
                        round: 1,
                        prompt: 'Round 1 • Heart Glow',
                        subPrompt: 'This is the Heart Glow rhythm: five in and five out, as the lotus opens and folds.',
                        audio: { voice: 'first/r1_active', transition: 'transitions/round1_start', cues: C.FIRST.main },
                    },
                    {
                        type: 'active',
                        breaths: 4,
                        pattern: [4, 2, 4, 2],
                        round: 2,
                        prompt: 'Round 2 • A Gentle Square',
                        subPrompt: 'Now a gentle square: in for four, a soft pause, out for four, and a soft pause.',
                        audio: {
                            voice: 'first/r2_active',
                            transition: 'transitions/round2_start',
                            cues: C.FIRST.main,
                            encourage: { clip: 'encouragement/doing_well', at: 0.7 },
                        },
                    },
                    {
                        type: 'active',
                        breaths: 4,
                        pattern: [4, 0, 8, 0],
                        round: 3,
                        prompt: 'Round 3 • The Long Breath Out',
                        subPrompt: 'And now in for four, and a long, slow breath out as the moon-path narrows.',
                        audio: { voice: 'first/r3_active', transition: 'transitions/last_round', cues: C.FIRST.main },
                    },
                    {
                        type: 'integration',
                        duration: 60,
                        round: 0,
                        prompt: 'Rest',
                        subPrompt: 'Breathe however you like, and notice how you feel.',
                        audio: {
                            voice: 'first/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['encouragement/thank_yourself'],
                        },
                    },
                ],
            },
            TIDE: {
                id: 'hale-tide',
                name: 'Hale Tide',
                description: 'Even breaths with the tide, a stretch on your own, then a longer ebb.',
                intensity: 'Gentle',
                totalRounds: 2,
                phases: [
                    {
                        type: 'grounding',
                        duration: 45,
                        round: 0,
                        prompt: 'Arrive',
                        subPrompt: 'Listen to the water. Let your breath find the tide. There\'s no need to count yet.',
                        audio: { sessionIntro: 'session_intros/tide_intro', voice: 'tide/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 10,
                        pattern: [4, 0, 4, 0],
                        round: 1,
                        prompt: 'Round 1 • With the Tide',
                        subPrompt: 'In as the wave runs up the sand, out as it slides back. Even and easy.',
                        audio: {
                            voice: 'tide/r1_active',
                            transition: 'transitions/round1_start',
                            cues: C.TIDE.main,
                            encourage: { clip: 'encouragement/doing_well', at: 0.6 },
                        },
                    },
                    {
                        type: 'carry',
                        duration: 32,
                        pattern: [4, 0, 4, 0],
                        round: 1,
                        prompt: 'On Your Own',
                        subPrompt: 'Now keep the rhythm on your own. Let the waves do the counting.',
                        audio: { voice: 'tide/r1_carry' },
                    },
                    {
                        type: 'active',
                        breaths: 8,
                        pattern: [4, 0, 6, 0],
                        round: 2,
                        prompt: 'Round 2 • The Long Ebb',
                        subPrompt: 'Let each breath out run a little longer, like water drawing back from the shore.',
                        audio: { voice: 'tide/r2_active', transition: 'transitions/last_round', cues: C.TIDE.main },
                    },
                    {
                        type: 'integration',
                        duration: 60,
                        round: 0,
                        prompt: 'Rest',
                        subPrompt: 'Let the breath come and go on its own, like the tide.',
                        audio: {
                            voice: 'tide/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['fillers/waves_ocean'],
                        },
                    },
                ],
            },
            ROOTS: {
                id: 'hale-roots',
                name: 'Hale Roots',
                description: 'A rest at the top of each breath and a long breath out, building to the forest\'s own rhythm.',
                intensity: 'Gentle',
                totalRounds: 2,
                phases: [
                    {
                        type: 'grounding',
                        duration: 45,
                        round: 0,
                        prompt: 'Arrive',
                        subPrompt: 'Feel where your body meets the ground, and let it hold you.',
                        audio: { sessionIntro: 'session_intros/roots_intro', voice: 'roots/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 7,
                        pattern: [4, 1, 6, 0],
                        round: 1,
                        prompt: 'Round 1 • Settle',
                        subPrompt: 'Breathe in, rest a moment at the top, then one long breath out.',
                        audio: {
                            voice: 'roots/r1_active',
                            transition: 'transitions/round1_start',
                            cues: C.ROOTS.main,
                            encourage: { clip: 'encouragement/doing_well', at: 0.6 },
                        },
                    },
                    {
                        type: 'carry',
                        duration: 22,
                        pattern: [4, 1, 6, 0],
                        round: 1,
                        prompt: 'On Your Own',
                        subPrompt: 'Keep breathing this way on your own, and let your body grow a little heavier.',
                        audio: { voice: 'roots/r1_carry' },
                    },
                    {
                        type: 'active',
                        breaths: 6,
                        pattern: [4, 2, 6, 2],
                        round: 2,
                        prompt: 'Round 2 • Take Root',
                        subPrompt: 'This is the forest\'s own rhythm: in for four, rest, out for six, and rest again. '
                            + 'Roots going down.',
                        audio: { voice: 'roots/r2_active', transition: 'transitions/last_round', cues: C.ROOTS.main },
                    },
                    {
                        type: 'integration',
                        duration: 60,
                        round: 0,
                        prompt: 'Rest',
                        subPrompt: 'Breathe naturally. Steady, and supported.',
                        audio: {
                            voice: 'roots/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['fillers/body_scan'],
                        },
                    },
                ],
            },
            UNWIND: {
                id: 'hale-unwind',
                name: 'Hale Unwind',
                description: 'Out-breaths that grow longer until you breathe the aurora\'s rhythm, then a rest that leads to sleep.',
                intensity: 'Gentle',
                totalRounds: 2,
                phases: [
                    {
                        type: 'grounding',
                        duration: 45,
                        round: 0,
                        prompt: 'Arrive',
                        subPrompt: 'Let your jaw soften. Let your hands rest. Nothing needs doing now.',
                        audio: { sessionIntro: 'session_intros/unwind_intro', voice: 'unwind/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 8,
                        pattern: [4, 1, 6, 1],
                        round: 1,
                        prompt: 'Round 1 • Longer Out',
                        subPrompt: 'Breathe in gently, and let a longer breath out, like a quiet sigh.',
                        audio: {
                            voice: 'unwind/r1_active',
                            transition: 'transitions/round1_start',
                            cues: C.UNWIND.main,
                            encourage: { clip: 'encouragement/doing_well', at: 0.6 },
                        },
                    },
                    {
                        type: 'active',
                        breaths: 6,
                        pattern: [5, 2, 7, 2],
                        round: 2,
                        prompt: 'Round 2 • Under the Aurora',
                        subPrompt: 'This is the aurora\'s rhythm: in for five, rest, a long breath out for seven, and '
                            + 'rest. Let the lights fall with you.',
                        audio: { voice: 'unwind/r2_active', transition: 'transitions/last_round', cues: C.UNWIND.main },
                    },
                    {
                        type: 'integration',
                        duration: 60,
                        round: 0,
                        prompt: 'Rest',
                        subPrompt: 'Let the breath slow down on its own. There\'s nowhere you need to be.',
                        closing: 'sleep',
                        audio: {
                            voice: 'unwind/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['fillers/let_go'],
                        },
                    },
                ],
            },
            SUNRISE: {
                id: 'hale-sunrise',
                name: 'Hale Sunrise',
                description: 'The Solar Flare\'s brisk rhythm, then quicker and lighter, then a steady close.',
                intensity: 'Gentle',
                totalRounds: 2,
                phases: [
                    {
                        type: 'grounding',
                        duration: 45,
                        round: 0,
                        prompt: 'Arrive',
                        subPrompt: 'Sit tall. Let your shoulders open, and let the light find you.',
                        audio: { sessionIntro: 'session_intros/sunrise_intro', voice: 'sunrise/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 10,
                        pattern: [3, 1, 3, 1],
                        round: 1,
                        prompt: 'Round 1 • Kindle',
                        subPrompt: 'This is the Solar Flare rhythm: in for three, a short pause, out for three. Brisk and '
                            + 'even.',
                        audio: {
                            voice: 'sunrise/r1_active',
                            transition: 'transitions/round1_start',
                            cues: C.SUNRISE.main,
                            encourage: { clip: 'encouragement/doing_well', at: 0.6 },
                        },
                    },
                    {
                        type: 'active',
                        breaths: 15,
                        pattern: [2, 0, 2, 0],
                        round: 2,
                        prompt: 'Round 2 • Rising Light',
                        subPrompt: 'Quicker now, light breaths through the nose. If you feel light-headed, simply breathe '
                            + 'normally.',
                        audio: {
                            voice: 'sunrise/r2_active', transition: 'transitions/last_round', cues: C.SUNRISE.main,
                        },
                    },
                    {
                        type: 'integration',
                        duration: 55,
                        round: 0,
                        prompt: 'Steady',
                        subPrompt: 'Breathe however feels good, and notice the warmth, how awake you feel.',
                        audio: {
                            voice: 'sunrise/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['fillers/inner_light'],
                        },
                    },
                ],
            },
            REST: {
                id: 'hale-rest',
                name: 'Hale Rest',
                description: 'The four-seven-eight breath learned step by step, drifting among the stars between rounds, '
                    + 'and a rest that leads into sleep.',
                intensity: 'Gentle',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 120,
                        round: 0,
                        prompt: 'Settling In',
                        subPrompt: 'Let your body grow heavy. Let the day soften. There\'s nothing left to do tonight.',
                        audio: { sessionIntro: 'session_intros/rest_intro', voice: 'rest/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 10,
                        pattern: [4, 0, 8, 0],
                        round: 1,
                        prompt: 'Round 1 • The Long Breath Out',
                        subPrompt: 'In through the nose for four, and out, slowly, for eight. Let the moon-path narrow '
                            + 'with you.',
                        audio: { voice: 'rest/r1_active', transition: 'transitions/round1_start', cues: C.REST.main },
                    },
                    {
                        type: 'carry',
                        duration: 36,
                        pattern: [4, 0, 8, 0],
                        round: 1,
                        prompt: 'Drift',
                        subPrompt: 'No counting now. Just float, and keep the breath long and slow.',
                        audio: { voice: 'rest/r1_carry' },
                    },
                    {
                        type: 'active',
                        breaths: 9,
                        pattern: [4, 4, 8, 0],
                        round: 2,
                        prompt: 'Round 2 • A Soft Hold',
                        subPrompt: 'Now rest at the top: in for four, hold softly for four, and out for eight.',
                        audio: {
                            voice: 'rest/r2_active',
                            transition: 'transitions/round2_start',
                            cues: C.REST.main,
                            encourage: { clip: 'encouragement/halfway', at: 0.5 },
                        },
                    },
                    {
                        type: 'carry',
                        duration: 32,
                        pattern: [4, 4, 8, 0],
                        round: 2,
                        prompt: 'Drift',
                        subPrompt: 'Float again, on your own. There\'s no hurry.',
                        audio: { voice: 'rest/r2_carry' },
                    },
                    {
                        type: 'active',
                        breaths: 8,
                        pattern: [4, 7, 8, 0],
                        round: 3,
                        prompt: 'Round 3 • Four, Seven, Eight',
                        subPrompt: 'This is the Moonlit Waters rhythm: in for four, hold for seven, out for eight. If the '
                            + 'hold feels long, breathe whenever you need.',
                        audio: { voice: 'rest/r3_active', transition: 'transitions/last_round', cues: C.REST.main },
                    },
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Drift Off',
                        subPrompt: 'Let the breath find its own way, and drift.',
                        closing: 'sleep',
                        audio: {
                            voice: 'rest/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['fillers/nothing_to_do', 'fillers/you_are_safe', 'fillers/drift', 'fillers/let_go'],
                        },
                    },
                ],
            },
            FLOW: {
                id: 'hale-flow',
                name: 'Hale Flow',
                description: 'The geometry of breath: a square, a triangle and a wider square, each kept on your own '
                    + 'after the count.',
                intensity: 'Moderate',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 90,
                        round: 0,
                        prompt: 'Finding Center',
                        subPrompt: 'Notice your heartbeat, and let it bring you here.',
                        audio: { sessionIntro: 'session_intros/flow_intro', voice: 'flow/grounding_intro' },
                    },
                    {
                        type: 'active',
                        breaths: 10,
                        pattern: [4, 4, 4, 4],
                        round: 1,
                        prompt: 'Round 1 • The Square',
                        subPrompt: 'Four equal sides: in for four, hold for four, out for four, hold for four.',
                        audio: { voice: 'flow/r1_active', transition: 'transitions/round1_start', cues: C.FLOW.main },
                    },
                    {
                        type: 'carry',
                        duration: 32,
                        pattern: [4, 4, 4, 4],
                        round: 1,
                        prompt: 'Keep the Square',
                        subPrompt: 'Keep the square going on your own. Let the light draw it.',
                        audio: { voice: 'flow/r1_carry' },
                    },
                    {
                        type: 'active',
                        breaths: 12,
                        pattern: [4, 0, 4, 4],
                        round: 2,
                        prompt: 'Round 2 • The Triangle',
                        subPrompt: 'Now three sides: in for four, out for four, and rest for four, as the light fans into '
                            + 'colour and gathers.',
                        audio: {
                            voice: 'flow/r2_active',
                            transition: 'transitions/round2_start',
                            cues: C.FLOW.main,
                            encourage: { clip: 'encouragement/halfway', at: 0.5 },
                        },
                    },
                    {
                        type: 'carry',
                        duration: 36,
                        pattern: [4, 0, 4, 4],
                        round: 2,
                        prompt: 'Keep the Triangle',
                        subPrompt: 'On your own now: in, out, and rest.',
                        audio: { voice: 'flow/r2_carry' },
                    },
                    {
                        type: 'active',
                        breaths: 9,
                        pattern: [5, 5, 5, 5],
                        round: 3,
                        prompt: 'Round 3 • The Wide Square',
                        subPrompt: 'Widen the square: five in, hold for five, five out, hold for five. Slow and even.',
                        audio: { voice: 'flow/r3_active', transition: 'transitions/last_round', cues: C.FLOW.main },
                    },
                    {
                        type: 'carry',
                        duration: 40,
                        pattern: [5, 5, 5, 5],
                        round: 3,
                        prompt: 'Keep the Wide Square',
                        subPrompt: 'Keep it going on your own, steady and balanced.',
                        audio: { voice: 'flow/r3_carry' },
                    },
                    {
                        type: 'integration',
                        duration: 240,
                        round: 0,
                        prompt: 'Rest',
                        subPrompt: 'Let the shape dissolve, and breathe however you like.',
                        audio: {
                            voice: 'flow/integration',
                            transition: 'transitions/integration_start',
                            fillers: ['fillers/stay_here', 'fillers/inner_light', 'fillers/complete_whole', 'encouragement/proud'],
                        },
                    },
                ],
            },
            BASE: {
                id: 'hale-base',
                name: 'Hale Base',
                description: 'Three rounds of steady breathing through the nose that charge the storm, each ending in a '
                    + 'stillness you hold for as long as it feels good.',
                intensity: 'Moderate',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 150,
                        pattern: [5, 2, 5, 2],
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Close your eyes. Scan your body from head to toe, and let each breath out soften what '
                            + 'you find.',
                        audio: { sessionIntro: 'session_intros/base_intro', voice: 'base/grounding_intro', cues: C.BASE.settle },
                    },
                    {
                        type: 'active',
                        breaths: 30,
                        pattern: [4, 0, 4, 0],
                        round: 1,
                        prompt: 'Round 1 • Steady Charge',
                        subPrompt: 'Breathe in through the nose, belly then chest, and let it go. A steady rhythm, full, '
                            + 'never forced.',
                        audio: {
                            voice: 'base/r1_active',
                            transition: 'transitions/round1_start',
                            cues: C.BASE.round,
                            encourage: { clip: 'encouragement/doing_well', at: 0.55 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty Lungs',
                        subPrompt: 'Stay here. Nothing to do. When you need to breathe, breathe in.',
                        audio: { voice: 'base/r1_hold', transition: 'transitions/hold_start' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Breathe all the way in, and hold it. Let the breath fill you.',
                        audio: { voice: 'base/r1_recovery', release: C.BASE.release.out },
                    },
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3.5, 0, 3.5, 0],
                        round: 2,
                        prompt: 'Round 2 • Building',
                        subPrompt: 'A little quicker now. Belly rises, chest opens, and let it go.',
                        audio: {
                            voice: 'base/r2_active',
                            transition: 'transitions/round2_start',
                            cues: C.BASE.round,
                            encourage: { clip: 'encouragement/halfway', at: 0.5 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 90,
                        round: 2,
                        prompt: 'Hold • Stillness',
                        subPrompt: 'Rest in the stillness, and simply watch.',
                        audio: { voice: 'base/r2_hold', transition: 'transitions/hold_start' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Breathe in fully, and hold. Let the breath reach every part of you.',
                        audio: { voice: 'base/r2_recovery', release: C.BASE.release.out },
                    },
                    {
                        type: 'active',
                        breaths: 40,
                        pattern: [3, 0, 3, 0],
                        round: 3,
                        prompt: 'Round 3 • Full Charge',
                        subPrompt: 'Quicker still. Full breaths, never forced. Tingling is normal; ease off if you need to.',
                        audio: { voice: 'base/r3_active', transition: 'transitions/last_round', cues: C.BASE.round },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 120,
                        round: 3,
                        prompt: 'Hold • The Space Between',
                        subPrompt: 'Silent, and still. Notice the space between your thoughts.',
                        audio: { voice: 'base/r3_hold', transition: 'transitions/hold_start' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Recovery',
                        subPrompt: 'One full breath in, and hold it gently at the top.',
                        audio: { voice: 'base/r3_recovery', release: C.BASE.release.out },
                    },
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Integration',
                        subPrompt: 'Return to your natural breath. There\'s nothing to do. Simply be.',
                        audio: {
                            voice: 'base/integration',
                            transition: 'transitions/integration_start',
                            fillers: [
                                'fillers/floating_vibrating', 'fillers/observer_deep', 'fillers/stay_here',
                                'fillers/body_scan', 'fillers/complete_whole', 'encouragement/proud',
                            ],
                        },
                    },
                ],
            },
            ELIXIR: {
                id: 'hale-elixir',
                name: 'Hale Elixir',
                description: 'Strong, connected breathing through the mouth that feeds the fire, each round ending in a '
                    + 'deep hold you end yourself.',
                intensity: 'High',
                totalRounds: 3,
                phases: [
                    {
                        type: 'grounding',
                        duration: 150,
                        pattern: [4, 1, 4, 1],
                        round: 0,
                        prompt: 'Grounding',
                        subPrompt: 'Breathe through your nose for now, slow and easy, and let your body settle before we '
                            + 'begin.',
                        audio: {
                            sessionIntro: 'session_intros/elixir_intro',
                            voice: 'elixir/grounding_intro',
                            cues: C.ELIXIR.settle,
                        },
                    },
                    {
                        type: 'active',
                        breaths: 30,
                        pattern: [3, 0, 2, 0],
                        round: 1,
                        prompt: 'Round 1 • Kindle the Fire',
                        subPrompt: 'Through the mouth now: fully in, and let it go. In and out, a steady loop.',
                        audio: {
                            voice: 'elixir/r1_active',
                            transition: 'transitions/round1_start',
                            cues: C.ELIXIR.round,
                            encourage: { clip: 'encouragement/doing_well', at: 0.55 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 60,
                        round: 1,
                        prompt: 'Hold • Empty',
                        subPrompt: 'Rest here, in the silence. When you need to breathe, breathe in.',
                        audio: { voice: 'elixir/r1_hold', transition: 'transitions/hold_start' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 1,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Breathe all the way in, and hold it at the top.',
                        audio: { voice: 'elixir/r1_recovery', release: C.ELIXIR.release.out },
                    },
                    {
                        type: 'active',
                        breaths: 30,
                        pattern: [3, 0, 2, 0],
                        round: 2,
                        prompt: 'Round 2 • Stoke the Fire',
                        subPrompt: 'The same steady loop. In and out, connected breaths, with no pause between them.',
                        audio: {
                            voice: 'elixir/r2_active',
                            transition: 'transitions/round2_start',
                            cues: C.ELIXIR.round,
                            encourage: { clip: 'encouragement/halfway', at: 0.5 },
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 90,
                        round: 2,
                        prompt: 'Hold • Deep Silence',
                        subPrompt: 'Deep silence. Notice what you feel, without judging it.',
                        audio: { voice: 'elixir/r2_hold', transition: 'transitions/hold_start' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 2,
                        prompt: 'Recovery Breath',
                        subPrompt: 'Breathe in fully, and hold. Squeeze gently at the top.',
                        audio: { voice: 'elixir/r2_recovery', release: C.ELIXIR.release.out },
                    },
                    {
                        type: 'active',
                        breaths: 30,
                        pattern: [3, 0, 2, 0],
                        round: 3,
                        prompt: 'Round 3 • Full Fire',
                        subPrompt: 'Full and free. Tingling is normal; if you feel dizzy, slow down.',
                        audio: {
                            voice: 'elixir/r3_active', transition: 'transitions/last_round', cues: C.ELIXIR.round,
                        },
                    },
                    {
                        type: 'retention',
                        hold: 'open',
                        duration: 120,
                        round: 3,
                        prompt: 'Hold • Surrender',
                        subPrompt: 'Complete release. You are held. Breathe in whenever you need.',
                        audio: { voice: 'elixir/r3_hold', transition: 'transitions/hold_start' },
                    },
                    {
                        type: 'recovery',
                        duration: 15,
                        round: 3,
                        prompt: 'Final Recovery',
                        subPrompt: 'One deep breath in, and hold. Let the energy rise.',
                        audio: { voice: 'elixir/r3_recovery', release: C.ELIXIR.release.out },
                    },
                    {
                        type: 'integration',
                        duration: 300,
                        round: 0,
                        prompt: 'Deep Integration',
                        subPrompt: 'Let the breath settle on its own. Allow whatever arises. You are complete.',
                        audio: {
                            voice: 'elixir/integration',
                            transition: 'transitions/integration_start',
                            fillers: [
                                'fillers/floating_vibrating', 'fillers/observer_deep', 'fillers/you_are_safe',
                                'fillers/nothing_to_do', 'fillers/trust_process', 'fillers/inner_light',
                                'encouragement/proud',
                            ],
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

    /** Lines a session may speak beyond its stages': the intention, the hold bell's, the
     * closing, and the cue words of the worlds its rounds are set in. */
    _extraLines(session, sessionId = this.sessionId) {
        const worlds = new Set(session.phases.filter((phase) => phase.type === 'active')
            .map((phase) => this._worldFor(phase, sessionId)));
        const holds = session.phases.some((phase) => this._isOpenHold(phase));
        return [
            this.options.intention?.clip,
            holds && HOLD_READY_LINE,
            this._closingFor(session.phases.find((phase) => phase.type === 'integration')).line,
            ...[...worlds].flatMap((world) => [
                ...worldCuePairs(world).flatMap((pair) => [pair.in, pair.out]),
                ...Object.values(worldPauseCues(world)).flat().map((take) => take.id),
            ]),
        ].filter(Boolean);
    }

    /** The world a stage is set in (see SESSION_WORLDS). */
    _worldFor(phase, sessionId = this.sessionId) {
        const worlds = SESSION_WORLDS[sessionId] || SESSION_WORLDS.BASE;
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
        if (phase.type === 'carry') {
            // The rhythm in its own words: a hold of three seconds or more is named, a soft
            // pause is part of the breath ("in, out" for the tide, "in, hold, out" for the moon).
            const [, full = 0, , empty = 0] = phase.pattern || [];
            const steps = ['in', full > 2 && 'hold', 'out', empty > 2 && (full > 2 ? 'hold' : 'rest')].filter(Boolean);
            return {
                mode: 'carry',
                seconds: phase.duration,
                hint: steps.length > 2 ? `On your own now: ${steps.join(', ')}` : 'On your own now: the same easy rhythm',
            };
        }
        if (phase.type === 'integration' || this._isOwnPace(phase)) return { mode: 'natural', seconds: phase.duration };
        return { mode: 'paced' };
    }

    /** An arrival without a rhythm of its own is breathed at your own pace, uncounted. */
    _isOwnPace(phase) {
        return phase.type === 'grounding' && !phase.pattern;
    }

    /** Paced stages are the ones with counted breaths (and so breath tones). */
    _isPaced(phase) {
        return (phase.type === 'grounding' && !this._isOwnPace(phase)) || phase.type === 'active';
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
     * @param {string} sessionId a key of SESSIONS, e.g. 'FIRST' or 'BASE'
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

        this.audioManager?.preloadSession(sessionId, session, this._extraLines(session, sessionId));

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
        if (phase.type === 'integration' || this._isOwnPace(phase)) return phase.pattern || [...NATURAL_PATTERN];
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
        // After the bell, the voice says it too (once the line is recorded).
        this._schedulePhase(() => this._sayIfQuiet(HOLD_READY_LINE), BELL_LEAD_MS);
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
        this._sayIfQuiet(phase.audio?.encourage?.clip);
    }

    /** Never over the voice: a missed line is better than a crowded one. */
    _sayIfQuiet(clip) {
        const audio = this.audioManager;
        if (!clip || !audio || audio.isVoicePlaying || audio.isVoicePending) return;
        audio.playVoice(clip);
    }

    /** How this session ends: coming back, or, for the evening sessions, drifting into sleep. */
    _closingFor(phase = this.activeSession?.phases[this.currentPhaseIndex]) {
        const integration = phase?.type === 'integration'
            ? phase : this.activeSession?.phases.find((stage) => stage.type === 'integration');
        return CLOSINGS[integration?.closing] || CLOSINGS.wake;
    }

    /** The last moments of the rest: the words turn to coming back, or to sleep. */
    _closing() {
        const closing = this._closingFor();
        this.indicator?.setPrompt?.(closing.title, closing.text);
        this.indicator?.setGuidance?.({ mode: 'closing', phase: closing.phase, hint: closing.hint });
        this.indicator?.announce?.(closing.announce);
        this._sayIfQuiet(closing.line);
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
                // The stage's words are done (or none were recorded): cues may speak again.
                this.audioManager.isVoicePending = false;
                if (phase.audio?.fillers?.length) this._scheduleFillersAudio(phase.audio.fillers, 10000, phase);
                if (phase.type === 'grounding') this._scheduleIntention(phase);
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
            if (newPhase !== 'exhale') return;
            const release = drawTake(this.cueDraw, phase.audio?.release, (id) => audio.isRecorded(id));
            if (release) audio.playCue(release.id);
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
     * Spoken cues, on all four parts of a breath (in, the hold with the lungs full, out, the
     * rest with them empty): three guided breaths after the voice falls silent, in the session's
     * own words, opening on plain ones ("breathe in") and then varied ("let the breath arrive");
     * then every fifth breath, in the words of the world you are in ("let the petals open") once
     * you have the rhythm. A take is only said on a breath long enough to hold it, never the same
     * take twice running, and the guide shows the words spoken. A breath too quick for words
     * keeps its light and tone.
     * @returns {boolean} whether a cue was spoken on this boundary
     */
    _speakCue(phase, newPhase) {
        if (!phase.audio?.cues) return false;
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
                this.forcedGuidanceRemaining = GUIDED_RUN;
            }
            this.cycleIsTeaching = this.forcedGuidanceRemaining > 0;
            this.cycleOpensRun = this.forcedGuidanceRemaining === GUIDED_RUN;
            if (this.forcedGuidanceRemaining > 0) {
                this.forcedGuidanceRemaining -= 1;
                this.currentCycleIsGuidance = true;
            } else {
                this.currentCycleIsGuidance = this.breathCycleCount % 5 === 0;
            }
        }
        if (!this.currentCycleIsGuidance || audio.isVoicePending) return false;
        const [part, index] = CUE_PARTS[newPhase] || [];
        const seconds = (this.indicator?.pattern || phase.pattern || [])[index] || 0;
        if (!part || seconds < MIN_CUE_SECONDS) return false;
        const take = this._cueFor(phase, part, seconds);
        if (!take) return false;
        audio.playCue(take.id);
        // The screen says what the voice says; plain words ("Breathe in") are already there.
        this.indicator?.setCueWords?.({ [part]: take.plain ? null : take.words });
        return true;
    }

    /**
     * The take to say on one part of this breath: the world's words on a fifth breath, else the
     * session's own (the plain ones as a guided run opens); a pause the session has no words
     * for borrows the world's.
     * @param {string} part 'in', 'hold', 'out' or 'rest'
     * @param {number} seconds how long that part lasts
     * @returns {{id: string, words: string, plain?: boolean}|null}
     */
    _cueFor(phase, part, seconds) {
        const fits = (id) => this.audioManager.fits(id, seconds);
        const pause = part === 'hold' || part === 'rest';
        const world = phase.type === 'active' ? this._worldFor(phase) : null;
        const worldPause = () => drawTake(this.cueDraw, worldPauseCues(world)[part], fits);
        if (world && !this.cycleIsTeaching) {
            const take = pause ? worldPause() : this._coupletTake(world, part, fits);
            if (take) return take;
        }
        const own = drawTake(this.cueDraw, phase.audio.cues[part], fits, { plain: this.cycleOpensRun });
        return own || (world && pause ? worldPause() : null);
    }

    /**
     * One side of the world couplet this breath speaks. A breath keeps one couplet: its
     * out-breath answers its in-breath.
     */
    _coupletTake(world, part, fits) {
        const current = this.worldCouplet;
        if (!current || current.world !== world || current.breath !== this.breathCycleCount) {
            const pairs = worldCuePairs(world).filter((pair) => fits(pair[part]));
            const id = this.cueDraw(`worlds/${world}`, pairs.map((pair) => pair.in));
            const pair = pairs.find((candidate) => candidate.in === id);
            this.worldCouplet = pair ? { world, breath: this.breathCycleCount, ...pair } : null;
        }
        const couplet = this.worldCouplet;
        if (!couplet || !fits(couplet[part])) return null;
        return { id: couplet[part], words: couplet.words[part === 'in' ? 0 : 1] };
    }

    /** The intention you chose is spoken once, a few seconds after the arrival's own words. */
    _scheduleIntention(phase) {
        const clip = this.options.intention?.clip;
        if (!clip || this.intentionScheduled) return;
        this.intentionScheduled = true;
        this._schedulePhase(() => {
            if (this.activeSession?.phases[this.currentPhaseIndex] === phase) this._sayIfQuiet(clip);
        }, 4000);
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
        const { bell } = this._closingFor();
        this.stopSession();
        // The closing bell rings out over the result; a session that ends in sleep ends quietly.
        if (bell) {
            this.chimes.bell('end');
            this.chimes.pulse('end');
        }
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

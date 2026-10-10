import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathworkSessionManager, MAX_OPEN_HOLD_SECONDS } from '../../src/ui/effects/breathwork-session-manager.js';
import { worldCuePairs } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { createCueDraw } from '../../src/ui/effects/breathing/cue-variety.js';

let manager;
let indicator;
let hidden;
let docListeners;

const RETENTION = 2;
const RECOVERY = 3;
/** A repeatable stand-in for Math.random. */
const seeded = (seed = 7) => {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
};
/** One breath phase begins: the cue the voice speaks on it. */
const cueOn = (part) => {
    manager._onBreathPhaseChange(part);
    return manager.audioManager.playCue.mock.lastCall[0];
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    hidden = false;
    docListeners = new Map();
    vi.stubGlobal('document', {
        get hidden() { return hidden; },
        addEventListener: (type, handler) => docListeners.set(type, handler),
        removeEventListener: (type) => docListeners.delete(type),
    });
    vi.stubGlobal('Audio', class {
        constructor() {
            this.pause = vi.fn();
            this.play = vi.fn().mockResolvedValue();
            this.load = vi.fn();
            this.removeAttribute = vi.fn();
        }
    });
    indicator = Object.fromEntries([
        'setExternalControl', 'setSessionTheme', 'setSessionPhase', 'setPrompt', 'setTechnique',
        'overridePattern', 'start', 'stop', 'pause', 'resume', 'showProgress', 'updateProgress',
        'setJourney', 'setGuidance', 'setIntention', 'showChapter', 'announce', 'setCueWords',
    ].map((name) => [name, vi.fn()]));
    indicator.pattern = [4, 0, 4, 0];
    manager = new BreathworkSessionManager(indicator);
    // The first take of every cue, unless a test asks for variety; every line recorded, and of
    // unknown length (so it fits any breath), unless a test says otherwise.
    manager.cueDraw = createCueDraw(() => 0);
    manager.audioManager.resolveClip = (id) => `voices/${id}.mp3`;
    manager.audioManager.clipSeconds = () => null;
    manager.audioManager.preloadSession = vi.fn().mockResolvedValue();
    manager.audioManager.playVoiceWithCallback = vi.fn();
    manager.audioManager.playVoice = vi.fn();
    manager.audioManager.playCue = vi.fn();
});

afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** Start a session and jump to one of its stages. */
function at(sessionId, index, options) {
    manager.startSession(sessionId, vi.fn(), vi.fn(), options);
    manager.currentPhaseIndex = index;
    manager._runPhase();
}

describe('open holds', () => {
    it('lets you end a Base hold when you breathe in, and measures it', async () => {
        at('BASE', RETENTION);
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'open-hold', suggested: 60, cap: 120 });
        expect(indicator.announce).toHaveBeenLastCalledWith('Hold on empty lungs. Breathe in whenever you need to: press Space or tap.');
        // A tap meant for the stage before cannot end the hold in its first moment.
        expect(manager.breathe()).toBe(false);
        await vi.advanceTimersByTimeAsync(60000);
        expect(manager.holdState.ready).toBe(true);
        expect(indicator.announce).toHaveBeenLastCalledWith('Breathe in whenever you are ready.');
        expect(manager.currentPhaseIndex).toBe(RETENTION);
        await vi.advanceTimersByTimeAsync(12000);
        indicator.onControl('breathe');
        expect(manager.currentPhaseIndex).toBe(RECOVERY);
        expect(manager.measure.holds).toEqual([{
            round: 1, seconds: 72, suggested: 60, mode: 'open', endedBy: 'you',
        }]);
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'paced' });
    });

    it('brings you back at the safety limit', async () => {
        at('ELIXIR', RETENTION + 3);
        expect(manager.holdState.cap).toBe(180);
        await vi.advanceTimersByTimeAsync(179000);
        expect(manager.currentPhaseIndex).toBe(RETENTION + 3);
        await vi.advanceTimersByTimeAsync(1000);
        expect(manager.currentPhaseIndex).toBe(RECOVERY + 3);
        expect(manager.measure.holds[0]).toMatchObject({ seconds: 180, endedBy: 'limit' });
        expect(MAX_OPEN_HOLD_SECONDS).toBe(240);
        expect(manager._holdCap({ duration: 120 })).toBe(240);
    });

    it('keeps the hold paused when you pause, then measures only the time you held', async () => {
        at('BASE', RETENTION);
        await vi.advanceTimersByTimeAsync(30000);
        manager.pauseSession();
        expect(manager.breathe()).toBe(false);
        await vi.advanceTimersByTimeAsync(600000);
        manager.resumeSession();
        await vi.advanceTimersByTimeAsync(10000);
        manager.breathe();
        expect(manager.measure.holds[0].seconds).toBe(40);
    });

    it('gives each hold its suggested length when you asked for timed holds', async () => {
        at('BASE', RETENTION, { openHolds: false });
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'timed-hold', suggested: 60, cap: 60 });
        expect(manager.breathe()).toBe(false);
        await vi.advanceTimersByTimeAsync(60000);
        expect(manager.currentPhaseIndex).toBe(RECOVERY);
        expect(manager.measure.holds[0]).toMatchObject({ seconds: 60, mode: 'timed', endedBy: 'timer' });
    });
});

describe('what each stage says', () => {
    it('teaches Rest\'s four-seven-eight step by step, with a drift between rounds and its holds named', () => {
        expect(manager.SESSIONS.REST.phases.map((phase) => phase.pattern?.join('-') || phase.type)).toEqual([
            'grounding', '4-0-8-0', '4-0-8-0', '4-4-8-0', '4-4-8-0', '4-7-8-0', 'integration',
        ]);
        at('REST', 3);
        indicator.pattern = [4, 4, 8, 0];
        manager.audioManager.isVoicePending = false;
        manager.forcedGuidanceRemaining = 3;
        manager._onBreathPhaseChange('inhale');
        expect(manager.audioManager.playCue).toHaveBeenLastCalledWith('cues_rest/in');
        manager._onBreathPhaseChange('hold1');
        expect(manager.audioManager.playCue).toHaveBeenLastCalledWith('cues_rest/hold');
        manager._onBreathPhaseChange('exhale');
        expect(manager.audioManager.playCue).toHaveBeenLastCalledWith('cues_rest/out');
        at('REST', 4);
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'carry', seconds: 32, hint: 'On your own now: in, hold, out' });
    });

    it('speaks a world\'s own cue words once the plain words have taught the rhythm', () => {
        at('FIRST', 1);
        indicator.pattern = [5, 0, 5, 0];
        manager.audioManager.isVoicePending = false;
        manager.cycleIsTeaching = false;
        manager.currentCycleIsGuidance = true;
        manager.forcedGuidanceRemaining = 0;
        manager.breathCycleCount = 4;
        manager._onBreathPhaseChange('inhale');
        expect(manager.audioManager.playCue).toHaveBeenLastCalledWith('worlds/coherence_in');
        manager._onBreathPhaseChange('exhale');
        expect(manager.audioManager.playCue).toHaveBeenLastCalledWith('worlds/coherence_out');
        manager.forcedGuidanceRemaining = 3;
        manager._onBreathPhaseChange('inhale');
        expect(manager.audioManager.playCue).toHaveBeenLastCalledWith('cues_first/in');
    });

    it('opens a guided run with the plain words, then varies them, never the same take twice running', () => {
        at('FIRST', 1);
        manager.cueDraw = createCueDraw(seeded());
        indicator.pattern = [5, 0, 5, 0];
        manager.audioManager.isVoicePending = false;
        const spoken = { inhale: [], exhale: [] };
        const RUNS = 10;
        for (let run = 0; run < RUNS; run += 1) {
            manager.forcedGuidanceRemaining = 3;
            for (let breath = 0; breath < 3; breath += 1) {
                spoken.inhale.push(cueOn('inhale'));
                spoken.exhale.push(cueOn('exhale'));
            }
        }
        for (let run = 0; run < RUNS; run += 1) {
            expect(['cues_first/in', 'cues_first/in_2']).toContain(spoken.inhale[run * 3]);
            expect(['cues_first/out', 'cues_first/out_2']).toContain(spoken.exhale[run * 3]);
        }
        Object.values(spoken).forEach((list) => {
            list.forEach((id, index) => { if (index) expect(id, `breath ${index}`).not.toBe(list[index - 1]); });
            // All six of First Breath's takes, and no other session's.
            expect(new Set(list).size).toBe(6);
            list.forEach((id) => expect(id).toMatch(/^cues_first\//));
        });
    });

    it('keeps a world\'s couplet together, shows the guide the words spoken, and moves on to another', () => {
        at('FIRST', 1);
        manager.cueDraw = createCueDraw(seeded());
        indicator.pattern = [5, 0, 5, 0];
        manager.audioManager.isVoicePending = false;
        manager.forcedGuidanceRemaining = 0;
        const couplets = new Map(worldCuePairs('coherence').map((pair) => [pair.in, pair]));
        const heard = [];
        for (let breath = 0; breath < 6; breath += 1) {
            manager.breathCycleCount = 4 + breath * 5; // the next breath is a fifth one
            const couplet = couplets.get(cueOn('inhale'));
            expect(couplet).toBeTruthy();
            expect(indicator.setCueWords).toHaveBeenLastCalledWith({ in: couplet.words[0] });
            expect(cueOn('exhale')).toBe(couplet.out);
            expect(indicator.setCueWords).toHaveBeenLastCalledWith({ out: couplet.words[1] });
            heard.push(couplet.in);
        }
        heard.forEach((id, index) => { if (index) expect(id).not.toBe(heard[index - 1]); });
        expect(new Set(heard).size).toBe(couplets.size);
    });

    it('leaves a breath too quick for words to its light and tone', () => {
        at('ELIXIR', 1);
        indicator.pattern = [3, 0, 1, 0];
        manager.audioManager.isVoicePending = false;
        manager.forcedGuidanceRemaining = 3;
        manager._onBreathPhaseChange('inhale');
        expect(manager.audioManager.playCue).toHaveBeenCalledExactlyOnceWith('cues_elixir/round_in');
        manager._onBreathPhaseChange('exhale');
        expect(manager.audioManager.playCue).toHaveBeenCalledTimes(1);
    });

    it('names the hold and the rest in the session\'s own words, then in the world\'s, and shows them', () => {
        at('FLOW', 1); // The Square, in Sacred Geometry
        indicator.pattern = [4, 4, 4, 4];
        manager.audioManager.isVoicePending = false;
        manager.forcedGuidanceRemaining = 3;
        expect(cueOn('inhale')).toBe('cues_flow/in');
        // Plain words are already on screen: the hint returns to the world's own.
        expect(indicator.setCueWords).toHaveBeenLastCalledWith({ in: null });
        expect(cueOn('hold1')).toBe('cues_flow/hold');
        expect(indicator.setCueWords).toHaveBeenLastCalledWith({ hold: 'Hold' });
        expect(cueOn('exhale')).toBe('cues_flow/out');
        expect(cueOn('hold2')).toBe('cues_flow/rest');
        expect(indicator.setCueWords).toHaveBeenLastCalledWith({ rest: 'Rest' });
        // A fifth breath, once the rhythm is learned: the world's words for all four parts.
        manager.forcedGuidanceRemaining = 0;
        manager.breathCycleCount = 4;
        expect(cueOn('inhale')).toBe('worlds/box-breathing_in');
        expect(cueOn('hold1')).toBe('worlds/box-breathing_hold');
        expect(indicator.setCueWords).toHaveBeenLastCalledWith({ hold: 'Across the top' });
        expect(cueOn('exhale')).toBe('worlds/box-breathing_out');
        expect(cueOn('hold2')).toBe('worlds/box-breathing_rest');
        expect(indicator.setCueWords).toHaveBeenLastCalledWith({ rest: 'Along the base' });
    });

    it('says only a take the breath has room for, and leaves a breath with none to its tone', () => {
        at('FIRST', 1);
        indicator.pattern = [5, 0, 5, 0];
        manager.audioManager.isVoicePending = false;
        // One of First Breath's in-takes is short enough for this breath; no out-take is.
        manager.audioManager.clipSeconds = (id) => (id === 'cues_first/in_4' ? 2 : 9);
        manager.forcedGuidanceRemaining = 3;
        expect(cueOn('inhale')).toBe('cues_first/in_4');
        expect(indicator.setCueWords).toHaveBeenLastCalledWith({ in: 'Let the breath arrive' });
        manager.audioManager.playCue.mockClear();
        manager.chimes.tone = vi.fn();
        manager._onBreathPhaseChange('exhale');
        expect(manager.audioManager.playCue).not.toHaveBeenCalled();
        expect(manager.chimes.tone).toHaveBeenCalledWith('out', 5);
    });

    it('keeps one session\'s words out of another', () => {
        const heard = (sessionId, index, pattern) => {
            at(sessionId, index);
            indicator.pattern = pattern;
            manager.audioManager.isVoicePending = false;
            manager.forcedGuidanceRemaining = 3;
            const said = [cueOn('inhale'), cueOn('exhale')];
            manager.stopSession();
            return said;
        };
        expect(heard('TIDE', 1, [4, 0, 4, 0])).toEqual(['cues_tide/in', 'cues_tide/out']);
        expect(heard('ROOTS', 1, [4, 1, 6, 0])).toEqual(['cues_roots/in', 'cues_roots/out']);
        expect(heard('BASE', 0, [5, 2, 5, 2])).toEqual(['cues_base/settle_in', 'cues_base/settle_out']);
        expect(heard('BASE', 1, [4, 0, 4, 0])).toEqual(['cues_base/round_in', 'cues_base/round_out']);
    });

    it('lets a recovery breath go with its "release" on the out-breath', () => {
        at('BASE', RECOVERY);
        manager._onBreathPhaseChange('inhale');
        expect(manager.audioManager.playCue).not.toHaveBeenCalled();
        manager._onBreathPhaseChange('exhale');
        expect(manager.audioManager.playCue).toHaveBeenCalledExactlyOnceWith('cues_base/release_out');
    });

    it('speaks the intention you chose once the arrival\'s words are done, and none when you chose none', async () => {
        manager.audioManager.playVoiceWithCallback.mockImplementation((id, done) => done());
        const intention = { id: 'calm', label: 'Find calm', clip: 'intentions/base_calm' };
        at('BASE', 0, { intention });
        expect(indicator.setIntention).toHaveBeenCalledWith('Find calm');
        await vi.advanceTimersByTimeAsync(7000);
        expect(manager.audioManager.playVoice).toHaveBeenCalledExactlyOnceWith('intentions/base_calm');

        manager.audioManager.playVoice.mockClear();
        at('BASE', 0);
        await vi.advanceTimersByTimeAsync(20000);
        expect(manager.audioManager.playVoice).not.toHaveBeenCalled();
    });

    it('lets the breath cues speak once a stage\'s words are done, even when none are recorded', () => {
        manager.audioManager.playVoiceWithCallback.mockImplementation((id, done) => done());
        at('FIRST', 1);
        expect(manager.audioManager.isVoicePending).toBe(false);
    });

    it('turns the last moments of the rest into coming back, with the spoken lines kept clear of it', async () => {
        at('BASE', 10);
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'natural', seconds: 300 });
        expect(indicator.overridePattern).toHaveBeenLastCalledWith([4, 1, 6, 1]);
        const phase = manager.SESSIONS.BASE.phases[10];
        manager._scheduleFillersAudio(phase.audio.fillers, 10000, phase);
        await vi.advanceTimersByTimeAsync(286000);
        expect(manager.audioManager.playVoice).toHaveBeenCalledTimes(6);
        expect(manager.audioManager.playVoice).toHaveBeenLastCalledWith('encouragement/proud');
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({
            mode: 'closing', phase: 'Come back gently', hint: 'Open your eyes when you are ready',
        });
        expect(indicator.setPrompt).toHaveBeenLastCalledWith('Coming Back', expect.stringContaining('open your eyes'));
    });

    it('ends the evening sessions into sleep, with no bell to wake you', async () => {
        const ring = vi.spyOn(manager.chimes, 'bell');
        at('REST', 6);
        manager._closing();
        expect(indicator.setPrompt).toHaveBeenLastCalledWith('Drifting Off', expect.stringContaining('Let sleep come'));
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'closing', phase: 'Let sleep come', hint: 'Stay as long as you like' });
        ring.mockClear();
        manager._completeSession();
        expect(ring).not.toHaveBeenCalledWith('end');
        at('BASE', 10);
        ring.mockClear();
        manager._completeSession();
        expect(ring).toHaveBeenCalledWith('end');
    });

    it('shows each round\'s card as it begins', () => {
        at('ELIXIR', 4);
        expect(indicator.showChapter).toHaveBeenLastCalledWith({ eyebrow: 'Round 2 of 3', title: 'Stoke the Fire', note: '50 breaths' });
        expect(indicator.announce).toHaveBeenLastCalledWith('Round 2 of 3. Stoke the Fire. 50 breaths.');
    });
});

describe('what you practised', () => {
    it('reports breaths, rounds and holds as they happened', async () => {
        manager.SESSIONS.TEST = {
            name: 'Test',
            totalRounds: 1,
            phases: [
                {
                    type: 'active', breaths: 5, pattern: [1, 0, 1, 0], round: 1,
                },
                {
                    type: 'retention', hold: 'open', duration: 10, round: 1,
                },
                { type: 'recovery', duration: 4, round: 1 },
            ],
        };
        const done = vi.fn();
        manager.startSession('TEST', vi.fn(), done);
        await vi.advanceTimersByTimeAsync(10000 + 14000);
        manager.breathe();
        await vi.advanceTimersByTimeAsync(4000);
        expect(done).toHaveBeenCalledOnce();
        expect(done.mock.calls[0][0]).toMatchObject({
            sessionId: 'TEST',
            completed: true,
            rounds: 1,
            breaths: 5,
            longestHold: 14,
            totalDuration: 28,
            holds: [{
                round: 1, seconds: 14, suggested: 10, mode: 'open', endedBy: 'you',
            }],
        });
    });

    it('can tell an ended session what it held so far', async () => {
        at('BASE', 1);
        await vi.advanceTimersByTimeAsync(81000);
        const snapshot = manager.snapshot();
        expect(snapshot).toMatchObject({ sessionId: 'BASE', completed: false, breaths: 10 });
        manager.stopSession();
        expect(manager.snapshot()).toBeNull();
    });
});

describe('a session waits for you', () => {
    it('holds while the Hub or an end question is over it, and goes on when they leave', () => {
        at('BASE', 1);
        manager.suspend('hub');
        expect(manager.isPaused).toBe(true);
        manager.suspend('confirm');
        manager.unsuspend('hub');
        expect(manager.isPaused).toBe(true);
        manager.unsuspend('confirm');
        expect(manager.isPaused).toBe(false);
        // A pause you chose is yours: the Hub closing does not undo it.
        indicator.onControl('pause');
        manager.suspend('hub');
        manager.unsuspend('hub');
        expect(manager.isPaused).toBe(true);
    });

    it('pauses when the page is hidden and waits for you to resume', () => {
        at('BASE', 1);
        hidden = true;
        docListeners.get('visibilitychange')();
        expect(manager.isPaused).toBe(true);
        hidden = false;
        docListeners.get('visibilitychange')();
        expect(manager.isPaused).toBe(true);
        manager.unsuspend('hub');
        expect(manager.isPaused).toBe(true);
        indicator.onControl('resume');
        expect(manager.isPaused).toBe(false);
        manager.stopSession();
        expect(docListeners.has('visibilitychange')).toBe(false);
    });

    it('keeps the screen awake while a session runs, and lets it sleep when paused or done', async () => {
        const release = vi.fn().mockResolvedValue();
        const request = vi.fn().mockResolvedValue({ release });
        vi.stubGlobal('navigator', { wakeLock: { request } });
        at('BASE', 1);
        await Promise.resolve();
        await Promise.resolve();
        expect(request).toHaveBeenCalledWith('screen');
        manager.pauseSession();
        expect(release).toHaveBeenCalledOnce();
        manager.resumeSession();
        await Promise.resolve();
        await Promise.resolve();
        expect(request).toHaveBeenCalledTimes(2);
        manager.stopSession();
        expect(release).toHaveBeenCalledTimes(2);
    });
});

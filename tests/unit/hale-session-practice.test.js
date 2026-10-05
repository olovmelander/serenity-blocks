import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathworkSessionManager, MAX_OPEN_HOLD_SECONDS } from '../../src/ui/effects/breathwork-session-manager.js';

let manager;
let indicator;
let hidden;
let docListeners;

const RETENTION = 2;
const RECOVERY = 3;

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
        'setJourney', 'setGuidance', 'setIntention', 'showChapter', 'announce',
    ].map((name) => [name, vi.fn()]));
    indicator.pattern = [4, 0, 4, 0];
    manager = new BreathworkSessionManager(indicator);
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
    it('opens Rest\'s soft pauses with "rest in the pause", never "empty, and hold"', () => {
        at('REST', RETENTION);
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'timed-hold', suggested: 20, cap: 20 });
        expect(manager.audioManager.playVoiceWithCallback.mock.calls.at(-1)[0]).toBe('cues/hold_soft.wav');
    });

    it('lets a recovery breath go with its "release" on the out-breath', () => {
        at('BASE', RECOVERY);
        manager._onBreathPhaseChange('inhale');
        expect(manager.audioManager.playCue).not.toHaveBeenCalled();
        manager._onBreathPhaseChange('exhale');
        expect(manager.audioManager.playCue).toHaveBeenCalledExactlyOnceWith('voices/cues/release.wav');
    });

    it('speaks the intention you chose once you are breathing, and none when you chose none', async () => {
        const intention = { id: 'calm', label: 'Find calm', clip: 'intentions/base_calm.wav' };
        at('BASE', 0, { intention });
        expect(indicator.setIntention).toHaveBeenCalledWith('Find calm');
        manager._onBreathPhaseChange('inhale');
        manager.forcedGuidanceRemaining = 1;
        manager.currentCycleIsGuidance = true;
        manager.audioManager.isVoicePending = false;
        manager._onBreathPhaseChange('exhale');
        await vi.advanceTimersByTimeAsync(10000);
        expect(manager.audioManager.playVoice).toHaveBeenCalledExactlyOnceWith('intentions/base_calm.wav');

        manager.audioManager.playVoice.mockClear();
        at('BASE', 0);
        manager.currentCycleIsGuidance = true;
        manager.audioManager.isVoicePending = false;
        manager._onBreathPhaseChange('exhale');
        await vi.advanceTimersByTimeAsync(20000);
        expect(manager.audioManager.playVoice).not.toHaveBeenCalled();
    });

    it('turns the last moments of the rest into coming back, with the spoken lines kept clear of it', async () => {
        at('BASE', 10);
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'natural', seconds: 300 });
        expect(indicator.overridePattern).toHaveBeenLastCalledWith([4, 1, 6, 1]);
        const phase = manager.SESSIONS.BASE.phases[10];
        manager._scheduleFillersAudio(phase.audio.fillers, 10000, phase);
        await vi.advanceTimersByTimeAsync(286000);
        expect(manager.audioManager.playVoice).toHaveBeenCalledTimes(6);
        expect(manager.audioManager.playVoice).toHaveBeenLastCalledWith('encouragement/proud.wav');
        expect(indicator.setGuidance).toHaveBeenLastCalledWith({ mode: 'closing' });
        expect(indicator.setPrompt).toHaveBeenLastCalledWith('Coming back', expect.stringContaining('Open your eyes'));
    });

    it('shows each round\'s card as it begins', () => {
        at('ELIXIR', 4);
        expect(indicator.showChapter).toHaveBeenLastCalledWith({ eyebrow: 'Round 2 of 3', title: 'Intensify', note: '50 breaths' });
        expect(indicator.announce).toHaveBeenLastCalledWith('Round 2 of 3. Intensify. 50 breaths.');
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

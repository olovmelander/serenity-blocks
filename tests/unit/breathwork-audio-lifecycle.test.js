import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathworkAudioManager } from '../../src/ui/effects/breathwork-audio-manager.js';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';

let media;
async function flushMicrotasks() {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    media = [];
    vi.stubGlobal('Audio', class {
        constructor() {
            this.src = '';
            this.currentTime = 0;
            this.play = vi.fn().mockResolvedValue();
            this.pause = vi.fn();
            this.load = vi.fn();
            this.removeAttribute = vi.fn(() => { this.src = ''; });
            media.push(this);
        }
    });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('BreathworkAudioManager ownership', () => {
    it('bounds concurrent media preloads to four even for overlapping session requests', async () => {
        const manager = new BreathworkAudioManager();
        const session = (prefix) => ({
            phases: Array.from({ length: 8 }, (_, i) => ({ audio: { voice: `${prefix}${i}.wav` } })),
        });
        const first = manager.preloadSession('first', session('a'));
        const second = manager.preloadSession('second', session('b'));
        expect(manager.activePreloadCount).toBe(4);
        expect(media).toHaveLength(6); // Two playback elements, four preloads.
        let peak = manager.activePreloadCount;
        for (let i = 0; i < 8; i += 1) {
            const active = [...manager.preloadLoads.values()].filter(entry => entry.audio);
            active.forEach(entry => entry.audio.oncanplaythrough?.());
            await flushMicrotasks();
            peak = Math.max(peak, manager.activePreloadCount);
            if (!manager.preloadLoads.size) break;
        }
        await Promise.all([first, second]);
        expect(peak).toBe(4);
        expect(manager.audioCache.size).toBe(16);
        expect(manager.preloadLoads.size).toBe(0);
        expect(manager.activePreloadCount).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        for (const audio of media.slice(2)) {
            expect(audio.src).toBe('');
            expect(audio.oncanplaythrough).toBeNull();
            expect(audio.pause).toHaveBeenCalledOnce();
        }
        manager.destroy();
    });

    it('duplicate cold preloads share one owner and warm entries do not create new elements', async () => {
        const manager = new BreathworkAudioManager();
        const first = manager._loadAudio('voices/a.wav');
        const second = manager._loadAudio('voices/a.wav');
        expect(first).toBe(second);
        expect(media).toHaveLength(3);
        media[2].oncanplaythrough();
        await Promise.all([first, second]);
        await manager._loadAudio('voices/a.wav');
        expect(media).toHaveLength(3);
        expect(manager.preloadLoads.size).toBe(0);
        manager.destroy();
    });

    it('stopping settles pending preload workers without loading the queued remainder or retaining late results', async () => {
        const manager = new BreathworkAudioManager();
        const loading = manager.preloadSession('all', {
            phases: Array.from({ length: 30 }, (_, i) => ({ audio: { voice: `${i}.wav` } })),
        });
        const staleReady = media[2].oncanplaythrough;
        manager.stopAll();
        await loading;
        staleReady();
        expect(media).toHaveLength(6);
        expect(manager.preloadLoads.size).toBe(0);
        expect(manager.activePreloadCount).toBe(0);
        expect(manager.audioCache.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        manager.destroy();
        manager.destroy();
    });

    it('a hung media preload has a bounded lifetime and a missing file remains retryable', async () => {
        const manager = new BreathworkAudioManager();
        const hung = manager._loadAudio('voices/hung.wav');
        await vi.advanceTimersByTimeAsync(20000);
        await hung;
        expect(manager.preloadLoads.size).toBe(0);
        expect(manager.audioCache.size).toBe(0);
        const retry = manager._loadAudio('voices/hung.wav');
        media.at(-1).oncanplaythrough();
        await retry;
        expect(manager.audioCache.size).toBe(1);
        manager.destroy();
    });

    it('replaced voice rejection and completion cannot finish the new voice or advance the old chain', async () => {
        const manager = new BreathworkAudioManager();
        let failOld;
        manager.voiceAudio.play.mockImplementationOnce(() => new Promise((resolve, reject) => { failOld = reject; }));
        const oldComplete = vi.fn();
        manager.playVoiceWithCallback('old.wav', oldComplete);
        const oldEnded = manager.voiceAudio.onended;
        manager.playVoice('new.wav');
        failOld(new Error('old playback interrupted'));
        oldEnded();
        await flushMicrotasks();
        expect(oldComplete).not.toHaveBeenCalled();
        expect(manager.isVoicePlaying).toBe(true);
        expect(manager.currentVoicePath).toBe('new.wav');
        manager.stopAll();
        expect(manager.voiceAudio.onended).toBeNull();
        manager.destroy();
    });

    it.each(['failure-first', 'ended-first'])('settles a current voice once when completion events overlap (%s)', async (order) => {
        const manager = new BreathworkAudioManager();
        let failPlayback;
        manager.voiceAudio.play.mockImplementationOnce(() => new Promise((resolve, reject) => { failPlayback = reject; }));
        const complete = vi.fn();
        manager.playVoiceWithCallback('current.wav', complete);
        const ended = manager.voiceAudio.onended;
        if (order === 'ended-first') ended();
        failPlayback(new Error('playback interrupted'));
        await flushMicrotasks();
        ended();
        ended();
        expect(complete).toHaveBeenCalledOnce();
        expect(manager.isVoicePlaying).toBe(false);
        expect(manager.voiceAudio.onended).toBeNull();
        manager.destroy();
    });

    it('scheduled voice replacement has one timer and stop/disposal removes it', async () => {
        const manager = new BreathworkAudioManager();
        manager.scheduleVoice('old.wav', 100);
        manager.scheduleVoice('new.wav', 200);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(100);
        expect(manager.voiceAudio.play).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        expect(manager.currentVoicePath).toBe('new.wav');
        manager.scheduleVoice('never.wav', 100);
        manager.destroy();
        await vi.advanceTimersByTimeAsync(500);
        manager.playVoice('after.wav');
        manager.playCue('after.wav');
        expect(manager.voiceAudio).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

function createSessionManager() {
    const indicator = {
        setExternalControl: vi.fn(), setSessionTheme: vi.fn(), start: vi.fn(), stop: vi.fn(),
        showProgress: vi.fn(), setPrompt: vi.fn(), setTechnique: vi.fn(), overridePattern: vi.fn(),
        updateProgress: vi.fn(), resetCycle: vi.fn(),
    };
    const manager = new BreathworkSessionManager(indicator);
    manager.SESSIONS.TEST = {
        id: 'test', name: 'Test', totalRounds: 1,
        phases: [{ type: 'grounding', duration: 60, prompt: 'Ground', round: 0 }],
    };
    return { manager, indicator };
}

describe('BreathworkSessionManager phase work ownership', () => {
    it('repeated voice completion cannot bypass a delay in the current phase chain', async () => {
        const { manager } = createSessionManager();
        manager.startSession('TEST', vi.fn(), vi.fn());
        const phase = manager.SESSIONS.TEST.phases[0];
        phase.audio = {};
        manager._playVoiceChain(['first.wav', { delay: 1000 }, 'second.wav'], phase);
        const ended = manager.audioManager.voiceAudio.onended;
        ended();
        ended();
        expect(manager.audioManager.voiceAudio.play).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(999);
        expect(manager.audioManager.currentVoicePath).toBe('first.wav');
        await vi.advanceTimersByTimeAsync(1);
        expect(manager.audioManager.currentVoicePath).toBe('second.wav');
        expect(manager.audioManager.voiceAudio.play).toHaveBeenCalledTimes(2);
        manager.destroy();
    });

    it('keeps active progress running and retires all 100 ms work immediately on stop/restart', async () => {
        const { manager, indicator } = createSessionManager();
        const progress = vi.fn();
        manager.startSession('TEST', progress, vi.fn());
        await vi.advanceTimersByTimeAsync(1000);
        expect(progress).toHaveBeenCalledTimes(11);
        expect(indicator.updateProgress).toHaveBeenCalledTimes(11);
        manager.stopSession();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(1000);
        expect(progress).toHaveBeenCalledTimes(11);
        expect(indicator.onPhaseChangeCallback).toBeNull();
        manager.startSession('TEST', progress, vi.fn());
        expect(vi.getTimerCount()).toBe(2);
        manager.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('replacement of the same session/phase cancels old filler and voice-chain delays', async () => {
        const { manager } = createSessionManager();
        const phase = manager.SESSIONS.TEST.phases[0];
        phase.audio = { fillers: ['old-filler.wav'], intentions: ['old-intention.wav'] };
        manager.audioManager.preloadSession = vi.fn().mockResolvedValue();
        const voice = vi.spyOn(manager.audioManager, 'playVoice').mockImplementation(() => {});
        const chain = vi.spyOn(manager.audioManager, 'playVoiceWithCallback').mockImplementation(() => {});
        manager.startSession('TEST', vi.fn(), vi.fn());
        manager._scheduleFillersAudio(phase.audio.fillers, 100, phase);
        manager._playVoiceChain([{ delay: 100 }, 'old-chain.wav'], phase);
        manager.startSession('TEST', vi.fn(), vi.fn());
        await vi.advanceTimersByTimeAsync(200);
        expect(voice).not.toHaveBeenCalled();
        expect(chain).not.toHaveBeenCalled();
        manager.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stale voice completion is rejected by phase ownership when the same session restarts', () => {
        const { manager } = createSessionManager();
        const phase = manager.SESSIONS.TEST.phases[0];
        phase.audio = { voice: 'intro.wav', fillers: ['filler.wav'] };
        manager.audioManager.preloadSession = vi.fn().mockResolvedValue();
        const completions = [];
        manager.audioManager.playVoiceWithCallback = vi.fn((path, callback) => completions.push(callback));
        manager.startSession('TEST', vi.fn(), vi.fn());
        const staleCompletion = completions[0];
        manager.startSession('TEST', vi.fn(), vi.fn());
        staleCompletion();
        expect(manager.phaseTimeouts.size).toBe(1); // Only the new phase completion.
        manager.destroy();
    });

    it('pause holds every timer and the voice, and resume re-arms each of them once', async () => {
        const { manager } = createSessionManager();
        manager.startSession('TEST', vi.fn(), vi.fn());
        const voice = manager.audioManager.voiceAudio;
        const finished = vi.fn();
        manager.audioManager.playVoiceWithCallback('guide.wav', finished);
        const later = vi.fn();
        manager._schedulePhase(later, 5000);
        expect(vi.getTimerCount()).toBe(3); // stage end, progress, the scheduled work
        await vi.advanceTimersByTimeAsync(2000);
        manager.pauseSession();
        expect(vi.getTimerCount()).toBe(0);
        expect(manager.audioManager.isVoicePlaying).toBe(true);
        await vi.advanceTimersByTimeAsync(20000);
        expect(later).not.toHaveBeenCalled();
        manager.resumeSession();
        expect(vi.getTimerCount()).toBe(3);
        expect(voice.play).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2900);
        expect(later).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(200);
        expect(later).toHaveBeenCalledOnce();
        // The held voice still completes its chain exactly once.
        voice.onended();
        expect(finished).toHaveBeenCalledOnce();
        manager.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('a voice that cannot restart after a pause settles its chain instead of stalling it', async () => {
        const manager = new BreathworkAudioManager();
        const finished = vi.fn();
        manager.playVoiceWithCallback('guide.wav', finished);
        await flushMicrotasks();
        manager.pauseAll();
        manager.voiceAudio.play.mockRejectedValueOnce(new Error('blocked'));
        manager.resumeAll();
        await flushMicrotasks();
        expect(finished).toHaveBeenCalledOnce();
        expect(manager.isVoicePlaying).toBe(false);
        manager.resumeAll();
        expect(manager.voiceAudio.play).toHaveBeenCalledTimes(2);
        manager.destroy();
    });

    it('phase advancement cancels obsolete phase audio while preserving progress for the next phase', async () => {
        const { manager } = createSessionManager();
        manager.SESSIONS.TEST.phases.push({ type: 'retention', duration: 30, prompt: 'Hold', round: 1 });
        manager.startSession('TEST', vi.fn(), vi.fn());
        const delayed = vi.fn();
        manager._schedulePhase(delayed, 10000);
        manager._nextPhase();
        await vi.advanceTimersByTimeAsync(10000);
        expect(delayed).not.toHaveBeenCalled();
        expect(manager.currentPhaseIndex).toBe(1);
        manager.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('progress percentages preserve phase sums while prior-phase reductions leave the 100 ms path', async () => {
        const { manager } = createSessionManager();
        const pattern = [1, 0, 1, 0];
        const reduce = vi.spyOn(pattern, 'reduce');
        manager.SESSIONS.TEST.phases = [
            { type: 'active', pattern, breaths: 5, prompt: 'Breathe', round: 1 },
            { type: 'grounding', duration: 20, prompt: 'Ground', round: 1 },
        ];
        const progress = vi.fn();
        manager.startSession('TEST', progress, vi.fn());
        manager._nextPhase();
        reduce.mockClear();
        await vi.advanceTimersByTimeAsync(1000);
        expect(reduce).not.toHaveBeenCalled();
        expect(progress.mock.calls.at(-1)[0].sessionProgress).toBeCloseTo(11 / 30);
        manager.destroy();
    });

    it('a progress callback can stop the session synchronously without leaving newly installed timers', () => {
        const { manager } = createSessionManager();
        manager.startSession('TEST', () => manager.stopSession(), vi.fn());
        expect(manager.activeSession).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        manager.destroy();
    });

    it('completion callbacks may start a replacement session that retains its own active timers', () => {
        const { manager } = createSessionManager();
        manager.startSession('TEST', vi.fn(), () => manager.startSession('TEST', vi.fn(), vi.fn()));
        manager._completeSession();
        expect(manager.activeSession).toBe(manager.SESSIONS.TEST);
        expect(vi.getTimerCount()).toBe(2);
        manager.destroy();
    });
});

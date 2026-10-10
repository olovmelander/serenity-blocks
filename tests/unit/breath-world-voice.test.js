import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    CUE_EVERY, GUIDED_BREATHS, INTRO_DELAY_MS, startWorldVoice,
} from '../../src/ui/effects/breathing/world-voice.js';

let target;
let guide;
let voice;
let switchOn;
let phaseListeners;
let introDone;

const announce = (type, detail = {}) => target.dispatchEvent(Object.assign(new Event(type), { detail }));
const breathe = (phase) => phaseListeners.forEach((listener) => listener(phase, 'rest'));
/** One whole breath: in, and out. */
const breath = () => {
    breathe('inhale');
    breathe('exhale');
};
const settle = () => vi.advanceTimersByTimeAsync(INTRO_DELAY_MS);

function start(options = {}) {
    return startWorldVoice({
        guide, isOn: () => switchOn, createVoice: () => voice, target, ...options,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    switchOn = true;
    phaseListeners = new Set();
    introDone = null;
    guide = {
        isActive: false,
        isExternallyControlled: false,
        currentTechnique: 'ocean-breath',
        pattern: [4, 0, 4, 0],
        onPhase: vi.fn((listener) => {
            phaseListeners.add(listener);
            return () => phaseListeners.delete(listener);
        }),
    };
    voice = {
        setEnabled: vi.fn(),
        stopAll: vi.fn(),
        destroy: vi.fn(),
        playCue: vi.fn(),
        playVoiceWithCallback: vi.fn((id, done) => { introDone = done; }),
    };
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('The voice of a practice on your own', () => {
    it('introduces the world once it has appeared, then says its words on the first breaths only', async () => {
        const worldVoice = start();
        guide.isActive = true;
        announce('breathingGuideChange');
        await vi.advanceTimersByTimeAsync(INTRO_DELAY_MS - 1);
        expect(voice.playVoiceWithCallback).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(voice.playVoiceWithCallback).toHaveBeenCalledWith('worlds/ocean-breath_intro', expect.any(Function));
        // While the introduction plays, the breath goes on without words.
        breath();
        expect(voice.playCue).not.toHaveBeenCalled();
        introDone();
        for (let index = 0; index < GUIDED_BREATHS; index += 1) breath();
        expect(voice.playCue.mock.calls.map(([id]) => id)).toEqual(
            Array.from({ length: GUIDED_BREATHS }, () => ['worlds/ocean-breath_in', 'worlds/ocean-breath_out']).flat(),
        );
        voice.playCue.mockClear();
        for (let index = GUIDED_BREATHS + 1; index < CUE_EVERY; index += 1) breath();
        expect(voice.playCue).not.toHaveBeenCalled();
        // Now and then, a word again.
        breath();
        expect(voice.playCue).toHaveBeenCalledTimes(2);
        worldVoice.stop();
    });

    it('has no words for a phase too short to say them in', async () => {
        guide.currentTechnique = 'wim-hof';
        guide.pattern = [2, 0, 1, 0];
        guide.isActive = true;
        start();
        await settle();
        introDone();
        breath();
        expect(voice.playCue).not.toHaveBeenCalled();
    });

    it('introduces a new world when you change world, and stops the old one first', async () => {
        guide.isActive = true;
        start();
        await settle();
        introDone();
        guide.currentTechnique = 'zen-garden';
        announce('breathingTechniqueChange', { id: 'zen-garden' });
        expect(voice.stopAll).toHaveBeenCalled();
        // The old world's words are not said in the new one.
        breath();
        expect(voice.playCue).not.toHaveBeenCalled();
        await settle();
        expect(voice.playVoiceWithCallback).toHaveBeenLastCalledWith('worlds/zen-garden_intro', expect.any(Function));
    });

    it('is silent with the switch off, and falls silent the moment it is turned off', async () => {
        switchOn = false;
        guide.isActive = true;
        start();
        await settle();
        expect(voice.playVoiceWithCallback).not.toHaveBeenCalled();
        switchOn = true;
        announce('settingsChanged', { breathingVoice: true });
        await settle();
        expect(voice.playVoiceWithCallback).toHaveBeenCalledOnce();
        introDone();
        switchOn = false;
        announce('settingsChanged', { breathingVoice: false });
        expect(voice.stopAll).toHaveBeenCalled();
        breath();
        expect(voice.playCue).not.toHaveBeenCalled();
        // Other settings do not restart anything.
        announce('settingsChanged', { breathingText: false });
        await settle();
        expect(voice.playVoiceWithCallback).toHaveBeenCalledOnce();
    });

    it('leaves a Hale session to its own voice, even one that takes over a practice', async () => {
        guide.isActive = true;
        guide.isExternallyControlled = true;
        start();
        await settle();
        expect(voice.playVoiceWithCallback).not.toHaveBeenCalled();
        guide.isExternallyControlled = false;
        announce('breathingGuideChange');
        await settle();
        introDone();
        guide.isExternallyControlled = true;
        voice.stopAll.mockClear();
        breathe('inhale');
        expect(voice.stopAll).toHaveBeenCalled();
        expect(voice.playCue).not.toHaveBeenCalled();
    });

    it('stops with the practice, and lets go of everything when stopped', async () => {
        guide.isActive = true;
        const worldVoice = start();
        await settle();
        guide.isActive = false;
        announce('breathingGuideChange');
        expect(voice.stopAll).toHaveBeenCalled();
        worldVoice.stop();
        expect(voice.destroy).toHaveBeenCalledOnce();
        expect(phaseListeners.size).toBe(0);
        guide.isActive = true;
        announce('breathingGuideChange');
        await settle();
        expect(voice.playVoiceWithCallback).toHaveBeenCalledOnce();
    });

    it('never begins speaking for a practice that ended before its introduction', async () => {
        guide.isActive = true;
        start();
        await vi.advanceTimersByTimeAsync(INTRO_DELAY_MS / 2);
        guide.isActive = false;
        announce('breathingGuideChange');
        await settle();
        expect(voice.playVoiceWithCallback).not.toHaveBeenCalled();
    });

    it('carries on without a voice when the audio cannot load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        guide.isActive = true;
        start({ createVoice: () => Promise.reject(new Error('offline')) });
        await settle();
        expect(warn).toHaveBeenCalled();
        expect(() => breath()).not.toThrow();
    });
});

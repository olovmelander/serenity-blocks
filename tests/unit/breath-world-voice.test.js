import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    CUE_EVERY, GUIDED_BREATHS, INTRO_DELAY_MS, MIN_TONE_SECONDS, startWorldVoice,
} from '../../src/ui/effects/breathing/world-voice.js';
import { worldCuePairs } from '../../src/ui/effects/breathing/breath-catalogue.js';

let target;
let guide;
let voice;
let switchOn;
let tonesSwitch;
let chimes;
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
        guide,
        isOn: () => switchOn,
        tonesOn: () => tonesSwitch,
        createVoice: () => voice,
        createChimes: () => chimes,
        target,
        ...options,
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    switchOn = true;
    tonesSwitch = false;
    chimes = { tone: vi.fn(), silence: vi.fn() };
    phaseListeners = new Set();
    introDone = null;
    guide = {
        isActive: false,
        isExternallyControlled: false,
        currentTechnique: 'ocean-breath',
        pattern: [4, 0, 4, 0],
        setCueWords: vi.fn(),
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
        const spoken = voice.playCue.mock.calls.map(([id]) => id);
        expect(spoken).toHaveLength(GUIDED_BREATHS * 2);
        // The first breath says the world's own words; each breath after says another couplet,
        // its out-breath answering its in-breath, and the guide shows the words spoken.
        expect(spoken.slice(0, 2)).toEqual(['worlds/ocean-breath_in', 'worlds/ocean-breath_out']);
        const couplets = worldCuePairs('ocean-breath');
        for (let index = 0; index < spoken.length; index += 2) {
            const couplet = couplets.find((pair) => pair.in === spoken[index]);
            expect(couplet, spoken[index]).toBeTruthy();
            expect(spoken[index + 1]).toBe(couplet.out);
            expect(guide.setCueWords).toHaveBeenNthCalledWith(index + 1, { in: couplet.words[0] });
            expect(guide.setCueWords).toHaveBeenNthCalledWith(index + 2, { out: couplet.words[1] });
            if (index) expect(spoken[index]).not.toBe(spoken[index - 2]);
        }
        expect(new Set(spoken).size).toBe(GUIDED_BREATHS * 2);
        voice.playCue.mockClear();
        for (let index = GUIDED_BREATHS + 1; index < CUE_EVERY; index += 1) breath();
        expect(voice.playCue).not.toHaveBeenCalled();
        // Now and then, a word again.
        breath();
        expect(voice.playCue).toHaveBeenCalledTimes(2);
        worldVoice.stop();
    });

    it('answers the fire breath\'s one-second out-breath, and has no words for a part too short for them', async () => {
        guide.currentTechnique = 'wim-hof';
        guide.pattern = [2, 0, 1, 0];
        guide.isActive = true;
        start();
        await settle();
        introDone();
        breath();
        // Two seconds in: "Feed the fire". One second out: room for its quick answer, "Release".
        expect(voice.playCue.mock.calls).toEqual([['worlds/wim-hof_in'], ['worlds/wim-hof_out']]);
        // Half a second out has room for nothing.
        voice.playCue.mockClear();
        guide.pattern = [2, 0, 0.5, 0];
        breath();
        expect(voice.playCue.mock.calls).toEqual([[expect.stringMatching(/^worlds\/wim-hof_in/)]]);
        // And a take longer than the breath is never said.
        voice.playCue.mockClear();
        voice.fits = vi.fn(() => false);
        breath();
        expect(voice.playCue).not.toHaveBeenCalled();
        expect(voice.fits).toHaveBeenCalledWith(expect.stringMatching(/^worlds\/wim-hof_in/), 2);
    });

    it('names a world\'s hold and its rest in the world\'s own words, and varies them', async () => {
        guide.currentTechnique = 'zen-garden';
        guide.pattern = [6, 3, 6, 3];
        guide.isActive = true;
        start({ random: () => 0 });
        await settle();
        introDone();
        const wholeBreath = () => ['inhale', 'hold1', 'exhale', 'hold2'].forEach((part) => breathe(part));
        wholeBreath();
        expect(voice.playCue.mock.calls.map(([id]) => id)).toEqual([
            'worlds/zen-garden_in', 'worlds/zen-garden_hold', 'worlds/zen-garden_out', 'worlds/zen-garden_rest',
        ]);
        expect(guide.setCueWords).toHaveBeenCalledWith({ hold: 'Rest at the far edge' });
        expect(guide.setCueWords).toHaveBeenCalledWith({ rest: 'Rest at the centre' });
        voice.playCue.mockClear();
        wholeBreath();
        const next = voice.playCue.mock.calls.map(([id]) => id);
        expect(next[0]).toMatch(/^worlds\/zen-garden_in_\d$/);
        expect(next[1]).toMatch(/^worlds\/zen-garden_hold_\d$/);
        expect(next[2]).toBe(next[0].replace('_in', '_out'));
        expect(next[3]).toMatch(/^worlds\/zen-garden_rest_\d$/);
    });

    it('has no words for a pause a world does not have', async () => {
        guide.isActive = true;
        guide.pattern = [4, 3, 4, 3]; // Ocean Tide has no pauses of its own, so no words for them
        start();
        await settle();
        introDone();
        breathe('inhale');
        voice.playCue.mockClear();
        breathe('hold1');
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

describe('The breath tones of a practice on your own', () => {
    const TONE = { minSeconds: MIN_TONE_SECONDS };

    it('mark every breath in and out when the voice is off, and leave the pauses quiet', async () => {
        switchOn = false;
        tonesSwitch = true;
        guide.isActive = true;
        start();
        await settle();
        breath();
        expect(chimes.tone.mock.calls).toEqual([['in', 4, TONE], ['out', 4, TONE]]);
        expect(voice.playCue).not.toHaveBeenCalled();
        chimes.tone.mockClear();
        breathe('hold1');
        breathe('hold2');
        expect(chimes.tone).not.toHaveBeenCalled();
    });

    it('wait for the world\'s introduction, and leave a breath the voice speaks on to the voice', async () => {
        tonesSwitch = true;
        guide.isActive = true;
        start();
        await settle();
        breath();
        expect(chimes.tone).not.toHaveBeenCalled();
        introDone();
        for (let index = 0; index < GUIDED_BREATHS; index += 1) breath();
        expect(voice.playCue).toHaveBeenCalledTimes(GUIDED_BREATHS * 2);
        expect(chimes.tone).not.toHaveBeenCalled();
        // The voice has stepped back: the tones carry the rhythm.
        breath();
        expect(chimes.tone.mock.calls).toEqual([['in', 4, TONE], ['out', 4, TONE]]);
    });

    it('sound in a quick world too, on the part of the breath the voice leaves quiet', async () => {
        tonesSwitch = true;
        guide.currentTechnique = 'wim-hof';
        guide.pattern = [2, 0, 1, 0];
        guide.isActive = true;
        // Its out-words not recorded yet (or longer than the second they get): the tone carries it.
        voice.fits = vi.fn((id) => !id.includes('_out'));
        start();
        await settle();
        introDone();
        breath();
        expect(voice.playCue.mock.calls).toEqual([['worlds/wim-hof_in']]);
        expect(chimes.tone.mock.calls).toEqual([['out', 1, TONE]]);
    });

    it('are silent with their switch off, in a Hale session, and once the practice stops', async () => {
        switchOn = false;
        guide.isActive = true;
        const worldVoice = start();
        await settle();
        breath();
        expect(chimes.tone).not.toHaveBeenCalled();
        tonesSwitch = true;
        breath();
        // Loaded on the first breath that wants them, heard from the next.
        await settle();
        breath();
        expect(chimes.tone).toHaveBeenCalledTimes(2);
        chimes.tone.mockClear();
        guide.isExternallyControlled = true;
        breath();
        expect(chimes.tone).not.toHaveBeenCalled();
        guide.isExternallyControlled = false;
        tonesSwitch = false;
        announce('settingsChanged', { breathingTones: false });
        expect(chimes.silence).toHaveBeenCalled();
        breath();
        expect(chimes.tone).not.toHaveBeenCalled();
        tonesSwitch = true;
        worldVoice.stop();
        breath();
        expect(chimes.tone).not.toHaveBeenCalled();
    });

    it('carry on without tones when they cannot load', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        switchOn = false;
        tonesSwitch = true;
        guide.isActive = true;
        start({ createChimes: () => Promise.reject(new Error('no audio')) });
        await settle();
        expect(warn).toHaveBeenCalled();
        expect(() => breath()).not.toThrow();
    });
});

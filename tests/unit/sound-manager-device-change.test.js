/**
 * Once the music element feeds Web Audio, the analyser chain is its only way to the
 * speakers. An audio device change while the music was paused tore that chain down and
 * nothing rebuilt it on resume, so the music stayed silent until the next track
 * (audit AUDIO-01).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';
import { THEME_MUSIC_CATALOG, DEFAULT_MUSIC_TRACK } from '../../src/core/progression/theme-music-catalog.js';

class MusicElement {
    constructor() {
        this.src = '';
        this.paused = true;
        this.ended = false;
        this.currentTime = 0;
        this.volume = 1;
        this.load = vi.fn();
        this.addEventListener = vi.fn();
        this.removeEventListener = vi.fn();
        this.play = vi.fn(async () => { this.paused = false; this.ended = false; });
    }

    get currentSrc() { return this.src; }

    pause() { this.paused = true; }
}

function graphNode(extra = {}) {
    const outputs = new Set();
    return {
        outputs,
        connect: (target) => { outputs.add(target); return target; },
        disconnect: (target) => (target ? outputs.delete(target) : outputs.clear()),
        ...extra,
    };
}

function fakeGainNode() {
    const param = {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn((value) => { param.value = value; }),
        linearRampToValueAtTime: vi.fn((value) => { param.value = value; }),
        setTargetAtTime: vi.fn((value) => { param.value = value; }),
    };
    return graphNode({ gain: param });
}

function fakeAudioContext() {
    return {
        state: 'running',
        currentTime: 0,
        sampleRate: 48000,
        destination: graphNode(),
        resume: vi.fn(async () => {}),
        createAnalyser: () => graphNode({
            fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, getByteFrequencyData: () => {},
        }),
        createMediaElementSource: () => graphNode(),
    };
}

function reachesSpeakers(node, destination, seen = new Set()) {
    if (node === destination) return true;
    if (!node || seen.has(node)) return false;
    seen.add(node);
    return [...node.outputs].some((next) => reachesSpeakers(next, destination, seen));
}

function createManager() {
    const manager = new SoundManager();
    manager.songsData = THEME_MUSIC_CATALOG.map((song) => ({ ...song }));
    manager.trackNames = manager.songsData.map((song) => song.trackKey);
    manager.settingsManager = { update: vi.fn(), save: vi.fn(), get: () => ({}) };
    manager.trackFadeOutMs = 0;
    manager.trackFadeInMs = 0;
    manager.setThemeCollection({ isUnlocked: (themeId) => themeId === 'forest', subscribe: () => () => {} });
    manager.audioContext = fakeAudioContext();
    manager.musicGainNode = fakeGainNode();
    return manager;
}

beforeEach(() => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), {
        location: { href: 'https://example.test/game/index.html' },
    }));
    vi.stubGlobal('document', { getElementById: () => null });
    vi.stubGlobal('Audio', MusicElement);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('music after an audio device change', () => {
    it('reaches the speakers again when paused music resumes', async () => {
        const manager = createManager();
        manager.setTrack(DEFAULT_MUSIC_TRACK);
        await manager.trackSwitchPromise;
        const source = manager.audioAnalyzer.mediaSourceNode;
        const speakers = manager.audioContext.destination;
        expect(reachesSpeakers(source, speakers)).toBe(true);

        manager.audioElement.pause();
        manager.handleAudioDeviceChange(); // say, headphones unplugged during the pause
        expect(reachesSpeakers(source, speakers)).toBe(false);

        expect(await manager.resumeBackgroundMusic()).toBe(true);
        expect(reachesSpeakers(source, speakers)).toBe(true);
    });

    it('still rebuilds at once when the change happens during playback', async () => {
        const manager = createManager();
        manager.setTrack(DEFAULT_MUSIC_TRACK);
        await manager.trackSwitchPromise;
        const source = manager.audioAnalyzer.mediaSourceNode;
        manager.handleAudioDeviceChange();
        expect(reachesSpeakers(source, manager.audioContext.destination)).toBe(true);
    });
});

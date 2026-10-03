import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';
import { AudioAnalyzer } from '../../src/audio/audio-analyzer.js';

function createAudioContext() {
    const nodes = [];
    const sources = [];
    const parameter = () => ({
        value: 1,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    });
    const node = () => {
        const created = { connect: vi.fn(), disconnect: vi.fn() };
        nodes.push(created);
        return created;
    };
    const source = () => {
        const created = {
            ...node(), frequency: parameter(), start: vi.fn(), stop: vi.fn(), onended: null,
        };
        sources.push(created);
        return created;
    };
    const context = {
        currentTime: 0,
        sampleRate: 48000,
        state: 'running',
        destination: {},
        close: vi.fn().mockResolvedValue(),
        createGain: vi.fn(() => ({ ...node(), gain: parameter() })),
        createOscillator: vi.fn(source),
        createBufferSource: vi.fn(source),
        createBiquadFilter: vi.fn(() => ({ ...node(), Q: {}, frequency: parameter() })),
        createBuffer: vi.fn((channels, length, sampleRate) => {
            const data = new Float32Array(length);
            return {
                length, numberOfChannels: channels, duration: length / sampleRate, sampleRate,
                getChannelData: () => data,
            };
        }),
    };
    context.decodeAudioData = vi.fn(async () => context.createBuffer(1, 480, context.sampleRate));
    return { context, nodes, sources };
}

function createManager({ gainWired = true } = {}) {
    const audio = createAudioContext();
    const manager = new SoundManager();
    manager.audioContext = audio.context;
    manager.musicGainNode = audio.context.createGain();
    manager.musicGainWired = gainWired;
    manager.getToneDestination = () => audio.context.destination;
    manager.resumeAudioContext = vi.fn();
    manager.ensureAudioAnalysisReady = vi.fn();
    return { manager, ...audio };
}

function createMusicElement(src = 'https://example.test/a.mp3') {
    return {
        src,
        get currentSrc() { return this.src; },
        volume: 1,
        paused: false,
        ended: false,
        currentTime: 10,
        pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); },
        load: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
}

async function flushMicrotasks() {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('audio cancellation, cache ownership and transient graphs', () => {
    let requests;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('window', { location: { href: 'https://example.test/index.html', search: '' } });
        vi.stubGlobal('requestAnimationFrame', callback => setTimeout(() => callback(performance.now()), 16));
        vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id));
        vi.stubGlobal('Audio', class {
            constructor() { Object.assign(this, createMusicElement('')); }
        });
        requests = [];
        vi.stubGlobal('XMLHttpRequest', class {
            constructor() {
                this.status = 200;
                this.response = new ArrayBuffer(12);
                this.abort = vi.fn(() => this.onabort?.());
                requests.push(this);
            }

            open() {}

            send() {}
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([true, false])('settles cancelled fades for WebAudio=%s without orphan scheduler work', async (gainWired) => {
        const { manager } = createManager({ gainWired });
        manager.audioElement = createMusicElement();
        const finished = vi.fn();
        const fade = manager.fadeMusicVolume(0, 2500).then(finished);
        manager.cancelMusicVolumeFade();
        await fade;
        expect(finished).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(manager.volumeFadeResolve).toBeNull();
    });

    it('replacement fade settles the old caller and allows the replacement to finish', async () => {
        const { manager } = createManager();
        manager.audioElement = createMusicElement();
        const oldFinished = vi.fn();
        const old = manager.fadeMusicVolume(0, 2500).then(oldFinished);
        const next = manager.fadeMusicVolume(0.4, 500);
        await old;
        expect(oldFinished).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(550);
        await next;
        expect(manager.musicGainNode.gain.value).toBe(0.4);
        expect(manager.volumeFadeFrame).toBeNull();
        expect(manager.volumeFadeResolve).toBeNull();
    });

    it('an immediate replacement settles the old fade and cannot be overwritten by its old completion', async () => {
        const { manager } = createManager();
        manager.audioElement = createMusicElement();
        const old = manager.fadeMusicVolume(0, 2500);
        await manager.fadeMusicVolume(0.6, 0);
        await old;
        await vi.advanceTimersByTimeAsync(3000);
        expect(manager.musicGainNode.gain.value).toBe(0.6);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['mute', 'stop', 'cleanup'])('%s during fade releases the music queue and obsolete preloader', async (action) => {
        const { manager } = createManager();
        manager.audioElement = createMusicElement();
        const preloaders = [];
        vi.stubGlobal('Audio', class {
            constructor() {
                Object.assign(this, createMusicElement(''));
                preloaders.push(this);
            }
        });
        const first = manager.playAudioFile('https://example.test/b.mp3', { trackKey: 'B', fadeInMs: 0 });
        await flushMicrotasks();
        expect(manager.volumeFadeFrame).not.toBeNull();
        if (action === 'mute') manager.toggleMute();
        else if (action === 'stop') manager.stopBackgroundMusic();
        else manager.cleanup();
        await first;
        expect(preloaders[0].src).toBe('');
        expect(vi.getTimerCount()).toBe(0);

        if (action !== 'cleanup') {
            manager.isMuted = false;
            await manager.playAudioFile('https://example.test/c.mp3', { trackKey: 'C', fadeInMs: 0 });
            expect(manager.audioElement.src).toBe('https://example.test/c.mp3');
            expect(manager.pendingTrackKey).toBeNull();
        } else {
            expect(manager.audioElement).toBeNull();
        }
    });

    it('pending play completion after cleanup does not dereference a destroyed audio element', async () => {
        const { manager } = createManager();
        manager.audioElement = createMusicElement();
        let finish;
        manager.playPromise = new Promise((resolve) => { finish = resolve; });
        const pending = manager.playPromise;
        manager.cleanup();
        finish();
        await pending;
        await flushMicrotasks();
        expect(manager.audioElement).toBeNull();
    });

    it('a newer track request cancels the obsolete fade and applies without its remaining delay', async () => {
        const { manager } = createManager();
        manager.audioElement = createMusicElement();
        const old = manager.playAudioFile('https://example.test/b.mp3', { trackKey: 'B' });
        await flushMicrotasks();
        expect(manager.volumeFadeFrame).not.toBeNull();
        const latest = manager.playAudioFile('https://example.test/c.mp3', {
            trackKey: 'C', fadeOutMs: 0, fadeInMs: 0,
        });
        await Promise.all([old, latest]);
        expect(manager.audioElement.src).toBe('https://example.test/c.mp3');
        expect(manager.pendingTrackKey).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('concurrent cold one-shots share fetch/decode but retain independent playback sources', async () => {
        const { manager, context, sources } = createManager();
        const first = manager.playOneShotFile('clip.ogg');
        const second = manager.playOneShotFile('clip.ogg');
        expect(requests).toHaveLength(1);
        requests[0].onload();
        await Promise.all([first, second]);
        expect(context.decodeAudioData).toHaveBeenCalledOnce();
        expect(sources).toHaveLength(2);
        expect(sources[0]).not.toBe(sources[1]);
        expect(sources[0].buffer).toBe(sources[1].buffer);
        await manager.playOneShotFile('clip.ogg');
        expect(requests).toHaveLength(1);
        expect(context.decodeAudioData).toHaveBeenCalledOnce();
        expect(manager.oneShotLoads.size).toBe(0);
        const finish = sources[0].onended;
        finish();
        expect(manager.activeAudioVoices.size).toBe(2);
        expect(sources[0].disconnect).toHaveBeenCalled();
        manager.cleanup();
        expect(manager.oneShotBuffers.size).toBe(0);
        expect(manager.activeAudioVoices.size).toBe(0);
        expect(sources[1].stop).toHaveBeenCalled();
    });

    it('teardown aborts pending shared fetches and settles every waiter', async () => {
        const { manager, context, sources } = createManager();
        const first = manager.playOneShotFile('clip.ogg');
        const second = manager.playOneShotFile('clip.ogg');
        manager.cleanup();
        await Promise.all([first, second]);
        expect(requests[0].abort).toHaveBeenCalledOnce();
        expect(context.decodeAudioData).not.toHaveBeenCalled();
        expect(sources).toHaveLength(0);
        expect(manager.oneShotLoads.size).toBe(0);
        expect(manager.oneShotBuffers.size).toBe(0);
    });

    it('a late decode cannot refill caches or play through a replacement context after cleanup', async () => {
        const { manager, context, sources } = createManager();
        let completeDecode;
        context.decodeAudioData.mockImplementation(() => new Promise((resolve) => { completeDecode = resolve; }));
        const playing = manager.playOneShotFile('clip.ogg');
        requests[0].onload();
        await flushMicrotasks();
        manager.cleanup();
        const replacement = createAudioContext().context;
        manager.audioContext = replacement;
        completeDecode(context.createBuffer(1, 480, 48000));
        await playing;
        expect(manager.oneShotBuffers.size).toBe(0);
        expect(sources).toHaveLength(0);
        expect(replacement.createBufferSource).not.toHaveBeenCalled();
    });

    it('a failed cold load is evicted so a later retry can succeed', async () => {
        const { manager, context } = createManager();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const failed = manager.playOneShotFile('clip.ogg');
        requests[0].onerror();
        await failed;
        expect(manager.oneShotLoads.size).toBe(0);
        const retry = manager.playOneShotFile('clip.ogg');
        expect(requests).toHaveLength(2);
        requests[1].onload();
        await retry;
        expect(context.decodeAudioData).toHaveBeenCalledOnce();
    });

    it('reuses noise PCM with fresh sources/offsets and disconnects the complete rich-voice graph', () => {
        const { manager, context, sources } = createManager();
        const rich = {
            noise: { type: 'pink', gain: 0.1 }, duration: 0.2,
            envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
            filter: { frequency: 1000 },
            oscillators: [{ freq: 220, type: 'sine' }],
        };
        manager.createRichTone(rich);
        manager.createRichTone(rich);
        expect(context.createBuffer).toHaveBeenCalledOnce();
        const noiseSources = sources.filter(source => source.buffer);
        expect(noiseSources).toHaveLength(2);
        expect(noiseSources[0].buffer).toBe(noiseSources[1].buffer);
        expect(noiseSources[0].start.mock.calls[0][1]).toBeGreaterThanOrEqual(0);
        expect(noiseSources[0].start.mock.calls[0][1]).toBeLessThanOrEqual(noiseSources[0].buffer.duration - 0.3);
        expect(noiseSources[0].stop).toHaveBeenCalledWith(0.30000000000000004);
        expect(manager.activeAudioVoices.size).toBe(2);
        sources[0].onended();
        expect(manager.activeAudioVoices.size).toBe(2);
        sources[1].onended();
        expect(manager.activeAudioVoices.size).toBe(1);
        expect(sources[0].disconnect).toHaveBeenCalled();
        expect(sources[1].disconnect).toHaveBeenCalled();
        manager.cleanup();
        expect(manager.noiseBuffers.size).toBe(0);
        expect(manager.activeAudioVoices.size).toBe(0);
    });

    it('noise cache eviction respects both the entry and PCM memory limits', () => {
        const { manager, context } = createManager();
        for (let i = 0; i < 24; i += 1) {
            context.sampleRate = 48000 + i;
            manager.getNoiseBuffer('white', 0.001);
        }
        expect(manager.noiseBuffers.size).toBeLessThanOrEqual(16);
        context.sampleRate = 48000;
        for (const duration of [4, 8, 16]) manager.getNoiseBuffer('pink', duration);
        let bytes = 0;
        for (const buffer of manager.noiseBuffers.values()) bytes += buffer.length * 4;
        expect(bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    });

    it('simple tones disconnect owned nodes before invoking their completion callback', () => {
        const { manager, context, sources } = createManager();
        const finished = vi.fn();
        manager.createTone(440, 0.1, 'sine', 0.2, finished);
        const gain = context.createGain.mock.results.at(-1).value;
        sources[0].onended();
        expect(gain.disconnect).toHaveBeenCalled();
        expect(sources[0].disconnect).toHaveBeenCalled();
        expect(manager.activeAudioVoices.size).toBe(0);
        expect(finished).toHaveBeenCalledOnce();
    });

    it('cleanup cancels deferred analyser startup so it cannot recreate a context later', () => {
        const { manager } = createManager();
        manager.audioContext = null;
        window.requestIdleCallback = vi.fn(() => 42);
        window.cancelIdleCallback = vi.fn();
        manager.scheduleDeferredAudioAnalysis();
        manager.cleanup();
        expect(window.cancelIdleCallback).toHaveBeenCalledWith(42);
        expect(manager._deferredAnalysisHandle).toBeNull();
    });
});

describe('AudioAnalyzer energy sampling', () => {
    it('retains frequency energy/envelope extraction without copying an unused waveform', () => {
        const analyserNode = {
            frequencyBinCount: 1024,
            connect: vi.fn(), disconnect: vi.fn(),
            getByteFrequencyData: vi.fn(data => data.fill(128)),
            getByteTimeDomainData: vi.fn(),
        };
        const context = {
            sampleRate: 48000,
            destination: {},
            createAnalyser: () => analyserNode,
            createMediaElementSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
        };
        const analyser = new AudioAnalyzer(context, { paused: false, ended: false });
        const frequencyData = analyser.frequencyData;
        const snapshot = analyser.update(1 / 60);
        const expected = (128 / 255) * (1 - Math.exp(-14 / 60));
        expect(snapshot.bassEnergy).toBeCloseTo(expected);
        expect(snapshot.overallEnergy).toBeCloseTo(expected);
        analyser.update(1 / 60);
        expect(analyser.frequencyData).toBe(frequencyData);
        expect(analyserNode.getByteFrequencyData).toHaveBeenCalledTimes(2);
        expect(analyserNode.getByteTimeDomainData).not.toHaveBeenCalled();
        analyser.dispose();
    });
});

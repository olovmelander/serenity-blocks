/**
 * App boot (2026-08-21): the menu's first track switch used to create the AudioContext
 * synchronously before play() — 346 ms on the boot path under Electron (audio-service start
 * contending with the GPU process). The analyser is for music-reactive visuals only, so the FIRST
 * context now attaches at idle after the music is already playing; later switches (context
 * exists) keep the synchronous attach.
 */

import {
    describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';

describe('SoundManager.scheduleDeferredAudioAnalysis', () => {
    let idle;
    beforeEach(() => {
        idle = [];
        vi.stubGlobal('window', {
            location: { search: '' },
            requestIdleCallback: vi.fn((cb, opts) => { idle.push({ cb, opts }); return idle.length; }),
            AudioContext: class { constructor() { this.state = 'running'; } createGain() { return { gain: { value: 1 }, connect() {} }; } createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }; } get destination() { return {}; } resume() {} },
        });
        vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('defers the first analyser attach to idle instead of creating the AudioContext now', () => {
        const sm = new SoundManager();
        sm.audioElement = { play() {}, addEventListener() {} };
        const ensure = vi.spyOn(sm, 'ensureAudioAnalysisReady').mockImplementation(() => null);
        sm.scheduleDeferredAudioAnalysis();
        expect(ensure).not.toHaveBeenCalled(); // nothing on the boot path
        expect(idle.length).toBe(1);
        expect(idle[0].opts).toEqual({ timeout: 2500 }); // bounded: never later than 2.5 s
        sm.scheduleDeferredAudioAnalysis();
        expect(idle.length).toBe(1); // idempotent while pending
        idle[0].cb();
        expect(ensure).toHaveBeenCalledWith({ force: true });
        expect(sm._deferredAnalysisHandle).toBeNull();
    });

    it('is a no-op once a context exists, and ?audioAnalysisSync=1 restores the synchronous attach', () => {
        const sm = new SoundManager();
        sm.audioElement = { play() {}, addEventListener() {} };
        const ensure = vi.spyOn(sm, 'ensureAudioAnalysisReady').mockImplementation(() => null);
        sm.audioContext = {};
        sm.scheduleDeferredAudioAnalysis();
        expect(idle.length).toBe(0);
        expect(ensure).not.toHaveBeenCalled();
        sm.audioContext = null;
        window.location.search = '?audioAnalysisSync=1';
        sm.scheduleDeferredAudioAnalysis();
        expect(ensure).toHaveBeenCalledWith({ force: true });
        expect(idle.length).toBe(0);
    });
});

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { SoundManager } from '../../src/audio/sound-manager.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('audio context resume failures', () => {
    it('contains a rejected resume when visibility or user gestures resume audio', async () => {
        const manager = new SoundManager();
        const error = new Error('audio device unavailable');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        manager.audioContext = { state: 'suspended', resume: vi.fn().mockRejectedValue(error) };
        manager.bindRuntimeAudioHooks = vi.fn();

        manager.resumeAudioContext();
        await Promise.resolve();
        expect(warn).toHaveBeenCalledWith('[SoundManager] Unable to resume audio context:', error);
    });

    it('can retry after the device becomes available', async () => {
        const manager = new SoundManager();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const resume = vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue(undefined);
        manager.audioContext = { state: 'suspended', resume };
        manager.bindRuntimeAudioHooks = vi.fn();

        manager.resumeAudioContext();
        await Promise.resolve();
        manager.resumeAudioContext();
        await Promise.resolve();
        expect(resume).toHaveBeenCalledTimes(2);
    });
});

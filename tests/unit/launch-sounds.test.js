import { describe, expect, it } from 'vitest';
import { LAUNCH_SOUND_NAMES, renderLaunchSound } from '../../src/audio/launch-sounds.js';

const RATE = 22050;

/** RMS of each 50 ms window of the left channel. */
function envelope(channel, rate) {
    const win = Math.round(0.05 * rate);
    const out = [];
    for (let start = 0; start + win <= channel.length; start += win) {
        let sum = 0;
        for (let i = start; i < start + win; i++) sum += channel[i] * channel[i];
        out.push(Math.sqrt(sum / win));
    }
    return out;
}

describe('launch sounds (src/audio/launch-sounds.js)', () => {
    it('renders both sounds in stereo, at their lengths, the same every time', () => {
        expect(LAUNCH_SOUND_NAMES).toEqual(['begin', 'warp']);
        const begin = renderLaunchSound('begin', RATE);
        const warp = renderLaunchSound('warp', RATE);
        expect(begin.channels).toHaveLength(2);
        expect(begin.channels[0].length).toBe(Math.round(2.6 * RATE));
        expect(warp.channels[0].length).toBe(6 * RATE);
        expect(renderLaunchSound('warp', RATE).channels[1]).toEqual(warp.channels[1]);
        // Left and right differ a little (seeded noise and detune give it width).
        expect(warp.channels[0]).not.toEqual(warp.channels[1]);
    });

    it('stays under full scale, with no non-finite samples, and ends in silence', () => {
        for (const name of LAUNCH_SOUND_NAMES) {
            const { channels } = renderLaunchSound(name, RATE);
            for (const data of channels) {
                expect(data.every((sample) => Number.isFinite(sample)), name).toBe(true);
                const peak = data.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);
                expect(peak, name).toBeGreaterThan(0.5);
                expect(peak, name).toBeLessThan(0.95);
                expect(Math.abs(data[data.length - 1]), name).toBeLessThan(1e-3);
            }
        }
    });

    it('puts the warp at its loudest on the flare, 0.4 s in, and the begin pulse at its start', () => {
        const warp = envelope(renderLaunchSound('warp', RATE).channels[0], RATE);
        const warpPeakAt = warp.indexOf(Math.max(...warp)) * 0.05;
        expect(warpPeakAt).toBeGreaterThanOrEqual(0.25);
        expect(warpPeakAt).toBeLessThanOrEqual(0.55);
        const begin = envelope(renderLaunchSound('begin', RATE).channels[0], RATE);
        expect(begin.indexOf(Math.max(...begin)) * 0.05).toBeLessThan(0.3);
    });

    it('knows only its own sounds', () => {
        expect(renderLaunchSound('nope', RATE)).toBeNull();
        expect(renderLaunchSound('warp', 0)).toBeNull();
    });
});

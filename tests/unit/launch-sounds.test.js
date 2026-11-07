import { describe, expect, it } from 'vitest';
import { LAUNCH_SOUND_NAMES, LAUNCH_SOUND_SECONDS, renderLaunchSound } from '../../src/audio/launch-sounds.js';

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

/** Share of a channel's energy left after two one-pole high-passes at `cutoff` Hz. */
function highShare(channel, rate, cutoff) {
    const k = Math.exp((-2 * Math.PI * cutoff) / rate);
    let low1 = 0;
    let low2 = 0;
    let high = 0;
    let all = 0;
    for (const sample of channel) {
        low1 = k * low1 + (1 - k) * sample;
        const once = sample - low1;
        low2 = k * low2 + (1 - k) * once;
        high += (once - low2) ** 2;
        all += sample * sample;
    }
    return high / all;
}

describe('launch sounds (src/audio/launch-sounds.js)', () => {
    it('renders both sounds in stereo, at their lengths, the same every time', () => {
        expect(LAUNCH_SOUND_NAMES).toEqual(['begin', 'warp']);
        expect(LAUNCH_SOUND_SECONDS).toEqual({ begin: 3.2, warp: 6 });
        for (const name of LAUNCH_SOUND_NAMES) {
            const { channels } = renderLaunchSound(name, RATE);
            expect(channels, name).toHaveLength(2);
            expect(channels[0].length, name).toBe(Math.round(LAUNCH_SOUND_SECONDS[name] * RATE));
            expect(renderLaunchSound(name, RATE).channels[1], name).toEqual(channels[1]);
            // Left and right differ (the drone's upper tones and the room give it width).
            expect(channels[0], name).not.toEqual(channels[1]);
        }
    });

    it('stays under full scale, with no non-finite samples, and ends in silence', () => {
        for (const name of LAUNCH_SOUND_NAMES) {
            const { channels } = renderLaunchSound(name, RATE);
            for (const data of channels) {
                expect(data.every((sample) => Number.isFinite(sample)), name).toBe(true);
                const peak = data.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);
                expect(peak, name).toBeGreaterThan(0.3);
                expect(peak, name).toBeLessThan(0.95);
                expect(Math.abs(data[data.length - 1]), name).toBeLessThan(1e-3);
            }
        }
    });

    it('swells the warp in to meet the flare (0.4 s in) and blooms the begin on the press', () => {
        const dB = (env, at) => 20 * Math.log10(env[Math.round(at / 0.05)] / Math.max(...env));
        const warp = envelope(renderLaunchSound('warp', RATE).channels[0], RATE);
        // Smooth: well under its crest at the reveal, full by the flare, no hit anywhere.
        expect(dB(warp, 0.05)).toBeLessThan(-12);
        expect(dB(warp, 0.5)).toBeGreaterThan(-2);
        const begin = envelope(renderLaunchSound('begin', RATE).channels[0], RATE);
        expect(begin.indexOf(Math.max(...begin)) * 0.05).toBeLessThan(0.4);
        for (const env of [warp, begin]) {
            // No window jumps by half the crest over the one before (a strike or a thump would).
            // Counted from the silence before the sound, so an onset hit is caught too.
            const crest = Math.max(...env);
            env.forEach((value, i) => expect(value - (env[i - 1] ?? 0)).toBeLessThan(0.5 * crest));
        }
    });

    it('stays deep: no noise rush (the old warp\'s swoosh) and nothing bright', () => {
        // The old warp's rush and shimmer left about 5 % of its energy above 2 kHz; these hold
        // low tones in a dark room.
        for (const name of LAUNCH_SOUND_NAMES) {
            for (const channel of renderLaunchSound(name, RATE).channels) {
                expect(highShare(channel, RATE, 2000), name).toBeLessThan(0.002);
            }
        }
    });

    it('knows only its own sounds', () => {
        expect(renderLaunchSound('nope', RATE)).toBeNull();
        expect(renderLaunchSound('warp', 0)).toBeNull();
    });
});

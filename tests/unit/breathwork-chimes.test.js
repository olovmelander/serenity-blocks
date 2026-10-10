import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { BreathworkChimes, PULSES } from '../../src/ui/effects/breathwork-chimes.js';

function fakeContext() {
    const param = () => ({
        value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
    });
    const node = (extra = {}) => ({
        connect: vi.fn(), disconnect: vi.fn(), ...extra,
    });
    const ctx = {
        currentTime: 10,
        state: 'running',
        destination: node(),
        oscillators: [],
        createGain: () => node({ gain: param() }),
        createBiquadFilter: () => node({ frequency: param(), Q: param(), type: '' }),
        createOscillator() {
            const osc = node({
                frequency: param(), type: '', start: vi.fn(), stop: vi.fn(), onended: null,
            });
            ctx.oscillators.push(osc);
            return osc;
        },
    };
    return ctx;
}

const soundManager = (overrides = {}) => {
    const bus = { connect: vi.fn() };
    return {
        audioContext: fakeContext(),
        isMuted: false,
        getSfxVolume: () => 0.8,
        getToneDestination: () => bus,
        resumeAudioContext: vi.fn(),
        bus,
        ...overrides,
    };
};

afterEach(() => vi.restoreAllMocks());

describe('Hale session bells', () => {
    it('strikes a singing bowl on the game\'s effects bus, and lets every partial go when it ends', () => {
        const sound = soundManager();
        const chimes = new BreathworkChimes({ getSound: () => sound, getNavigator: () => null });
        expect(chimes.bell('start')).toBe(true);
        const { oscillators } = sound.audioContext;
        // Four partials, each a slowly beating pair.
        expect(oscillators).toHaveLength(8);
        expect(oscillators.every((osc) => osc.start.mock.calls.length === 1)).toBe(true);
        expect(chimes.voices.size).toBe(1);
        oscillators.forEach((osc) => osc.onended());
        expect(chimes.voices.size).toBe(0);
    });

    it('stays silent when the game is muted, its effects volume is down, or sounds are off', () => {
        expect(new BreathworkChimes({ getSound: () => null }).bell()).toBe(false);
        expect(new BreathworkChimes({ getSound: () => soundManager({ isMuted: true }) }).bell()).toBe(false);
        expect(new BreathworkChimes({ getSound: () => soundManager({ getSfxVolume: () => 0 }) }).bell()).toBe(false);
        const chimes = new BreathworkChimes({ getSound: () => soundManager() });
        chimes.setEnabled(false);
        expect(chimes.bell('end')).toBe(false);
        expect(chimes.tone('in', 4)).toBe(false);
    });

    it('plays breath tones only for breaths slow enough to follow', () => {
        const sound = soundManager();
        const chimes = new BreathworkChimes({ getSound: () => sound });
        expect(chimes.tone('in', 1)).toBe(false);
        expect(chimes.tone('out', undefined)).toBe(false);
        expect(chimes.tone('in', 4)).toBe(true);
        expect(sound.audioContext.oscillators).toHaveLength(2);
    });

    it('gives a practice on your own its tones on quicker breaths too, shorter and quieter', () => {
        const sound = soundManager();
        const gains = [];
        const { createGain } = sound.audioContext;
        sound.audioContext.createGain = () => {
            const node = createGain();
            gains.push(node);
            return node;
        };
        const chimes = new BreathworkChimes({ getSound: () => sound });
        expect(chimes.tone('out', 0.5, { minSeconds: 1 })).toBe(false);
        expect(chimes.tone('out', 1, { minSeconds: 1 })).toBe(true);
        const quick = gains[0].gain.value;
        const [{ stop }] = sound.audioContext.oscillators;
        // Seven tenths of the breath, and done before the next one begins.
        expect(stop.mock.calls[0][0]).toBeCloseTo(10.02 + 0.7 + 0.05);
        gains.length = 0;
        expect(chimes.tone('in', 4, { minSeconds: 1 })).toBe(true);
        expect(quick).toBeCloseTo(gains[0].gain.value * 0.4);
    });

    it('stops every strike at once when the session ends', () => {
        const sound = soundManager();
        const vibrate = vi.fn(() => true);
        const chimes = new BreathworkChimes({ getSound: () => sound, getNavigator: () => ({ vibrate }) });
        chimes.bell('round');
        chimes.silence();
        expect(sound.audioContext.oscillators.every((osc) => osc.stop.mock.calls.length > 1)).toBe(true);
        expect(chimes.voices.size).toBe(0);
        expect(vibrate).toHaveBeenLastCalledWith(0);
    });

    it('pulses where a device can vibrate, and only if you allow it', () => {
        const vibrate = vi.fn(() => true);
        const chimes = new BreathworkChimes({ getSound: () => null, getNavigator: () => ({ vibrate }) });
        expect(chimes.canVibrate).toBe(true);
        expect(chimes.pulse('hold')).toBe(true);
        expect(vibrate).toHaveBeenLastCalledWith(PULSES.hold);
        chimes.setVibration(false);
        expect(chimes.pulse('end')).toBe(false);
        expect(new BreathworkChimes({ getNavigator: () => ({}) }).pulse('hold')).toBe(false);
    });

    it('wakes the game\'s audio from the click that begins a session', () => {
        const sound = soundManager();
        new BreathworkChimes({ getSound: () => sound }).prime();
        expect(sound.resumeAudioContext).toHaveBeenCalledOnce();
    });
});

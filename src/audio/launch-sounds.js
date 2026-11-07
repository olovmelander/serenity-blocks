/**
 * The two launch sounds, synthesised by the game (no sample files, no generated audio). Both are
 * smooth deep-space transitions: one soft swell of low tones in a vast, dark room. No noise or
 * sweeps (the owner disliked the old warp's rushing swoosh, 2026-11-07), no hits or strikes (a
 * richer pass with a struck bowl, a thump and pitch glides was "a bit too much"), no bright chimes.
 *
 *   warp   the boot warp (src/ui/boot-warp-startup.js starts it at the reveal; the scene's flare
 *          peaks 0.4 s later, src/ui/boot-warp-transition-scene.js). A drone of fifths over a felt
 *          sub swells in to crest on the flare, its upper tones opening with the light, then
 *          darkens and thins through the flight and fades into the room's tail. About 6 s.
 *   begin  the title screen's confirm, as the title rises to the menu: the same drone blooms
 *          quickly and gently, opening upward, and fades into the room. About 3.2 s.
 *
 * Pure functions of the sample rate (tests render them in Node). src/audio/sound-manager.js
 * renders them off the page's thread before they are needed, at a low rate (nothing here reaches
 * far above 1 kHz), and plays them through the SFX bus like every other effect.
 */

const TAU = Math.PI * 2;

const D1 = 36.71;
const D2 = 73.42;

const WARP_SECONDS = 6;
const BEGIN_SECONDS = 3.2;
// Peak levels: a little quieter than the sounds they replaced (measured integrated loudness, warp
// about -15.4 LUFS against the old -12.6, begin -16.8 against -14.7).
const WARP_PEAK = 0.42;
const BEGIN_PEAK = 0.5;

// One sine cycle, read with linear interpolation (error near -130 dB): far cheaper than Math.sin
// for the thirty-odd tones these sounds run at once.
const SINE_SIZE = 4096;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((TAU * i) / SINE_SIZE);

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
/** exp(-(t - t0) / tau) after t0, 1 before it. */
const decayAfter = (t0, tau, t) => (t > t0 ? Math.exp(-(t - t0) / tau) : 1);

/** A sine oscillator whose frequency may change every sample; `phase` in cycles. */
function createOsc(phase = 0) {
    let p = phase - Math.floor(phase);
    return (hz, sampleRate) => {
        p += hz / sampleRate;
        if (p >= 1) p -= 1;
        const x = p * SINE_SIZE;
        const i = x | 0;
        return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
    };
}

/** One-pole high-pass. */
function createHighPass(sampleRate, cutoffHz) {
    const a = 1 - Math.exp((-TAU * cutoffHz) / sampleRate);
    let low = 0;
    return (x) => {
        low += a * (x - low);
        return x - low;
    };
}

// The drone's tones on its root, [ratio, level, cents, breath, upper]: open fifths and octaves.
// Each tone is two voices `cents` apart, the second softer, so they beat slowly without ever
// cancelling; `breath` is the tone's own slow swell (Hz); `upper` is how long it waits for the
// drone to open (0: always sounding, 1: only when fully open).
const DRONE_TONES = [
    [1, 1, 3, 0.07, 0],
    [1.5, 0.6, 4, 0.11, 0.2],
    [2, 0.45, 5, 0.09, 0.4],
    [3, 0.24, 6, 0.13, 0.7],
    [4, 0.12, 7, 0.17, 1],
];
// Tones below this sound the same on both sides (a low tone that differs left to right cancels
// on mono speakers); above it each side is detuned its own way, which gives the drone its width.
const WIDE_FROM_HZ = 150;

/**
 * A drone on `root` Hz. Returns `(open, out)`: `open` (0..1) brings the upper tones in, tone by
 * tone, like light into a filter; writes [left, right] to `out`.
 */
function createDrone(sampleRate, root, seed) {
    const rand = mulberry32(seed);
    const pair = (cents) => ({ a: createOsc(rand()), b: createOsc(rand()), spread: 2 ** (cents / 2400) });
    const tones = DRONE_TONES.map(([ratio, level, cents, breath, upper]) => ({
        ratio,
        level,
        breath,
        upper,
        wide: root * ratio >= WIDE_FROM_HZ,
        left: pair(cents),
        right: pair(cents * 1.4),
        lfo: createOsc(rand()),
    }));
    const voice = (v, hz) => v.a(hz * v.spread, sampleRate) + 0.55 * v.b(hz / v.spread, sampleRate);
    return (open, out) => {
        let l = 0;
        let r = 0;
        for (const tone of tones) {
            const gate = 1 - tone.upper * (1 - open);
            const gain = tone.level * gate * gate * (0.8 + 0.2 * tone.lfo(tone.breath, sampleRate));
            const hz = root * tone.ratio;
            const sideL = voice(tone.left, hz) * gain;
            l += sideL;
            r += tone.wide ? voice(tone.right, hz) * gain : sideL;
        }
        out[0] = l / 1.55;
        out[1] = r / 1.55;
    };
}

/**
 * One swell: the drone (and a felt sub an octave under its root) at `level`, opened by `open`, in
 * a dark room. `envelope(t, shape)` sets shape.level and shape.open for a time in seconds.
 */
function renderSwell(sampleRate, seconds, { seed, room: roomShape, envelope }) {
    const length = Math.round(seconds * sampleRate);
    const channels = [new Float32Array(length), new Float32Array(length)];
    const [left, right] = channels;
    const sub = createOsc();
    const drone = createDrone(sampleRate, D2, seed);
    const room = createRoom(sampleRate, roomShape);
    const send = createHighPass(sampleRate, 70);
    const tones = [0, 0];
    const shape = { level: 0, open: 0 };
    for (let i = 0; i < length; i++) {
        envelope(i / sampleRate, shape);
        const { level } = shape;
        drone(shape.open, tones);
        const felt = 0.4 * level * sub(D1, sampleRate);
        const wet = room(send(0.3 * level * (tones[0] + tones[1])));
        left[i] = felt + 0.4 * level * tones[0] + 0.6 * wet[0];
        right[i] = felt + 0.4 * level * tones[1] + 0.6 * wet[1];
    }
    fadeOut(channels, sampleRate, seconds - 0.5, seconds);
    return channels;
}

// The room: an 8-line feedback delay network (Householder mixing) behind a pre-delay and four
// diffusing all-passes. Lines of 31-92 ms make a large space; each pass through a line loses some
// highs (`darkHz`), so the tail darkens as it fades, over `seconds` (to -60 dB). The two sides
// read the lines with orthogonal signs, so they are decorrelated: the room's width.
const ROOM_LINES_48K = [1499, 1889, 2381, 2833, 3209, 3593, 4027, 4441];
const ROOM_DIFFUSERS_48K = [142, 107, 379, 277];
const ROOM_LEFT = [1, -1, 1, -1, 1, -1, 1, -1];
const ROOM_RIGHT = [1, 1, -1, -1, 1, 1, -1, -1];

/** Returns `(x) => [left, right]` (the same array each call). */
function createRoom(sampleRate, { seconds, darkHz, preDelay }) {
    const size = (samplesAt48k) => Math.max(1, Math.round((samplesAt48k * sampleRate) / 48000));
    const lines = ROOM_LINES_48K.map((n) => new Float32Array(size(n)));
    const count = lines.length;
    const at = new Int32Array(count);
    const gains = lines.map((line) => 10 ** ((-3 * line.length) / (seconds * sampleRate)));
    const damp = 1 - Math.exp((-TAU * darkHz) / sampleRate);
    const lows = new Float64Array(count);
    const taps = new Float64Array(count);
    const diffusers = ROOM_DIFFUSERS_48K.map((n) => ({ buffer: new Float32Array(size(n)), at: 0 }));
    const pre = new Float32Array(size(preDelay * 48000));
    let preAt = 0;
    const out = [0, 0];
    return (x) => {
        let v = pre[preAt];
        pre[preAt] = x;
        if (++preAt === pre.length) preAt = 0;
        for (const d of diffusers) {
            const delayed = d.buffer[d.at];
            const w = v + 0.6 * delayed;
            d.buffer[d.at] = w;
            if (++d.at === d.buffer.length) d.at = 0;
            v = delayed - 0.6 * w;
        }
        let sum = 0;
        for (let k = 0; k < count; k++) {
            lows[k] += damp * (lines[k][at[k]] - lows[k]);
            taps[k] = lows[k] * gains[k];
            sum += taps[k];
        }
        const mix = (2 / count) * sum;
        let l = 0;
        let r = 0;
        for (let k = 0; k < count; k++) {
            const y = taps[k];
            lines[k][at[k]] = y - mix + v;
            if (++at[k] === lines[k].length) at[k] = 0;
            l += ROOM_LEFT[k] * y;
            r += ROOM_RIGHT[k] * y;
        }
        out[0] = l * 0.35;
        out[1] = r * 0.35;
        return out;
    };
}

function fadeOut(channels, sampleRate, from, to) {
    for (const data of channels) {
        for (let i = 0; i < data.length; i++) data[i] *= 1 - smoothstep(from, to, i / sampleRate);
    }
}

function finish(channels, peakTarget) {
    let peak = 0;
    for (const data of channels) for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const gain = peak > 0 ? peakTarget / peak : 1;
    for (const data of channels) {
        for (let i = 0; i < data.length; i++) data[i] = Math.tanh(data[i] * gain * 1.1) / Math.tanh(1.1);
    }
    return channels;
}

// The scene's flare, after the reveal the warp starts on.
const FLARE = 0.4;

function renderWarp(sampleRate) {
    return finish(renderSwell(sampleRate, WARP_SECONDS, {
        seed: 0xd2a4,
        room: { seconds: 4.5, darkHz: 1600, preDelay: 0.035 },
        // Swells in to crest just after the flare, its upper tones opening with the light; then
        // darkens and thins through the flight, and has passed into the room by about 5.4 s.
        envelope: (t, shape) => {
            shape.level = smoothstep(0, FLARE + 0.1, t)
                * (1 - 0.5 * smoothstep(FLARE + 0.1, 3.9, t))
                * (1 - smoothstep(3.9, 5.4, t));
            shape.open = smoothstep(0, FLARE, t) * (1 - 0.65 * smoothstep(FLARE, 3.9, t));
        },
    }), WARP_PEAK);
}

function renderBegin(sampleRate) {
    return finish(renderSwell(sampleRate, BEGIN_SECONDS, {
        seed: 0x5eed,
        room: { seconds: 3.5, darkHz: 1600, preDelay: 0.03 },
        // Blooms quickly but softly on the press, opening upward as the title rises, then fades.
        envelope: (t, shape) => {
            shape.level = smoothstep(0, 0.25, t) * decayAfter(0.25, 0.9, t);
            shape.open = smoothstep(0, 0.6, t);
        },
    }), BEGIN_PEAK);
}

const RENDERERS = Object.freeze({ begin: renderBegin, warp: renderWarp });
export const LAUNCH_SOUND_NAMES = Object.freeze(Object.keys(RENDERERS));
/** Each sound's length in seconds. */
export const LAUNCH_SOUND_SECONDS = Object.freeze({ begin: BEGIN_SECONDS, warp: WARP_SECONDS });

/**
 * Render a launch sound.
 * @param {string} name  'begin' | 'warp'
 * @param {number} sampleRate
 * @returns {{ sampleRate: number, channels: Float32Array[] } | null}
 */
export function renderLaunchSound(name, sampleRate) {
    const render = RENDERERS[name];
    if (!render || !(sampleRate > 0)) return null;
    return { sampleRate, channels: render(sampleRate) };
}

/**
 * The two launch sounds, synthesised by the game (no sample files, no generated audio):
 *
 *   begin  the title screen's confirm: a dark pulse. A low sine that drops in pitch, a breath of
 *          filtered air and a soft, dark fifth, about 2.6 s.
 *   warp   the boot warp (src/ui/boot-warp-startup.js starts it at the reveal; the scene's flare
 *          peaks 0.4 s later, src/ui/boot-warp-transition-scene.js): a sub swell and a filtered
 *          rush that peak at 0.4 s, a faint shimmer over the flight, a smaller low thump at the
 *          drop-out (~3.9 s) and a long settle, about 6 s.
 *
 * Pure functions of the sample rate with seeded noise: the same samples every run (tests render
 * them in Node). src/audio/sound-manager.js turns them into AudioBuffers and plays them through
 * the SFX bus, like every other effect. In keeping with the soundtrack: dark, felt more than
 * heard, few bright sounds.
 */

const TAU = Math.PI * 2;

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
/** Exponential glide from `from` to `to` (Hz) over [t0, t1]. */
const glide = (from, to, t0, t1, t) => from * (to / from) ** clamp01((t - t0) / (t1 - t0));

/**
 * State-variable filter (Chamberlin), one channel. `process(x, cutoffHz)` returns
 * { low, band }. Damping 1/Q.
 */
function createSvf(sampleRate, damping) {
    let low = 0;
    let band = 0;
    return (x, cutoff) => {
        const f = 2 * Math.sin((Math.PI * Math.min(cutoff, sampleRate / 6)) / sampleRate);
        low += f * band;
        const high = x - low - damping * band;
        band += f * high;
        return { low, band };
    };
}

/** A sine oscillator whose frequency may change every sample. */
function createOsc() {
    let phase = 0;
    return (hz, sampleRate) => {
        phase += (TAU * hz) / sampleRate;
        if (phase > TAU) phase -= TAU;
        return Math.sin(phase);
    };
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

function renderBegin(sampleRate) {
    const length = Math.round(2.6 * sampleRate);
    const channels = [new Float32Array(length), new Float32Array(length)];
    channels.forEach((out, side) => {
        const noise = mulberry32(0x5eed + side * 7919);
        const air = createSvf(sampleRate, 0.9);
        const sub = createOsc();
        const toneLow = createOsc();
        const toneHigh = createOsc();
        const detune = side ? 0.35 : -0.35;
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const attack = smoothstep(0, 0.008, t);
            // The pulse: 70 Hz falling to 42 Hz, felt more than heard.
            const pulse = sub(glide(70, 42, 0, 0.25, t), sampleRate) * attack * Math.exp(-t / 0.55);
            // A breath of air, darkening as it goes.
            const breath = air(noise() * 2 - 1, glide(900, 280, 0, 0.6, t)).low
                * smoothstep(0, 0.03, t) * Math.exp(-t / 0.35);
            // A soft, dark fifth (G3 and D4) under it all.
            const fifth = (toneLow(196 + detune, sampleRate) + 0.8 * toneHigh(293.66 - detune, sampleRate))
                * smoothstep(0, 0.05, t) * Math.exp(-t / 0.9);
            out[i] = 0.7 * pulse + 0.5 * breath + 0.12 * fifth;
        }
        // Close cleanly.
        for (let i = 0; i < length; i++) out[i] *= 1 - smoothstep(2.3, 2.6, i / sampleRate);
    });
    return finish(channels, 0.8);
}

function renderWarp(sampleRate) {
    const length = Math.round(6 * sampleRate);
    const channels = [new Float32Array(length), new Float32Array(length)];
    const PEAK = 0.4;
    const DROP = 3.9;
    channels.forEach((out, side) => {
        const noise = mulberry32(0xa11ce + side * 104729);
        const rush = createSvf(sampleRate, 0.8);
        const sub = createOsc();
        const thump = createOsc();
        const shimmer = [createOsc(), createOsc(), createOsc()];
        const detune = side ? 0.6 : -0.6;
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            // Sub swell: rises to the flare, then sinks slowly through the flight.
            const swellIn = (clamp01(t / PEAK)) ** 2;
            const swellOut = t < PEAK ? 1 : Math.exp(-(t - PEAK) / 1.6);
            const subHz = 38 + 34 * smoothstep(0, PEAK, t) - 30 * smoothstep(PEAK, 6, t);
            const swell = sub(subHz, sampleRate) * swellIn * swellOut;
            // The rush: noise through a band that opens up to the flare, then closes as the
            // streaks relax.
            const cutoff = t < 0.45 ? glide(250, 2400, 0, 0.45, t) : glide(2400, 520, 0.45, 3.6, t);
            const rushAmp = (t < PEAK ? smoothstep(0, PEAK, t) : Math.exp(-(t - PEAK) / 1.1))
                + 0.18 * smoothstep(PEAK, 1.2, t) * Math.exp(-(t - 1.2) / 2.2);
            const whoosh = rush(noise() * 2 - 1, cutoff).band * rushAmp;
            // A faint shimmer over the flight (A5, E6, A6).
            const shimmerAmp = smoothstep(0.5, 1.5, t) * (1 - smoothstep(2.5, 5.5, t));
            const sparkle = shimmerAmp * (shimmer[0](880 + detune, sampleRate)
                + 0.7 * shimmer[1](1318.5 - detune, sampleRate) + 0.5 * shimmer[2](1760 + detune, sampleRate));
            // The drop-out: a smaller low thump.
            const td = t - DROP;
            const drop = td > 0 ? thump(glide(55, 40, DROP, DROP + 0.3, t), sampleRate)
                * smoothstep(0, 0.01, td) * Math.exp(-td / 0.6) : 0;
            out[i] = 0.55 * swell + 0.6 * whoosh + 0.05 * sparkle + 0.35 * drop;
        }
        for (let i = 0; i < length; i++) out[i] *= 1 - smoothstep(5.6, 6, i / sampleRate);
    });
    return finish(channels, 0.8);
}

const RENDERERS = Object.freeze({ begin: renderBegin, warp: renderWarp });
export const LAUNCH_SOUND_NAMES = Object.freeze(Object.keys(RENDERERS));

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

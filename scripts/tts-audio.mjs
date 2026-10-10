import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Shape a recorded voice line for the game: trim the silence around the words, bring every line
 * to the same loudness, fade the edges, and write it as WAV or MP3.
 *
 * Takes from a text-to-speech service vary in level and in the silence they carry: one cue lands
 * late because of a second of leading air, a soft line sits 6 dB under the next. Every take goes
 * through here, so the whole voice plays as one speaker at one level.
 *
 * Loudness is ITU-R BS.1770-4 / EBU R128 integrated loudness (K-weighted, gated), the measure
 * ffmpeg's ebur128 filter reports. Samples are mono floats in [-1, 1].
 */

/** 16-bit little-endian mono PCM (what the services stream as pcm_*) to floats. */
export function floatsFromPcm16(buffer) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const samples = new Float32Array(Math.floor(bytes.length / 2));
    for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readInt16LE(i * 2) / 32768;
    return samples;
}

export function pcm16FromFloats(samples) {
    const out = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        out.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), i * 2);
    }
    return out;
}

/** A mono 16-bit PCM WAV file. */
export function wavFromFloats(samples, sampleRate) {
    const data = pcm16FromFloats(samples);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/** Read a PCM WAV file (16-bit, any channel count; channels are averaged to mono). */
export function floatsFromWav(buffer) {
    let offset = 12;
    let channels = 1;
    let sampleRate = 0;
    let bits = 16;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        if (id === 'fmt ') {
            channels = buffer.readUInt16LE(offset + 10);
            sampleRate = buffer.readUInt32LE(offset + 12);
            bits = buffer.readUInt16LE(offset + 22);
        }
        if (id === 'data') {
            if (bits !== 16) throw new Error(`Only 16-bit WAV is supported (got ${bits}-bit)`);
            const end = Math.min(buffer.length, offset + 8 + size);
            const frames = Math.floor((end - offset - 8) / (2 * channels));
            const samples = new Float32Array(frames);
            for (let frame = 0; frame < frames; frame += 1) {
                let sum = 0;
                for (let channel = 0; channel < channels; channel += 1) {
                    sum += buffer.readInt16LE(offset + 8 + (frame * channels + channel) * 2) / 32768;
                }
                samples[frame] = sum / channels;
            }
            return { samples, sampleRate };
        }
        offset += 8 + size + (size % 2);
    }
    throw new Error('No audio data in WAV file');
}

/** One biquad section, direct form I. */
function biquad(input, [b0, b1, b2, a1, a2]) {
    const out = new Float64Array(input.length);
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < input.length; i += 1) {
        const x = input[i];
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[i] = y;
    }
    return out;
}

/** The K-weighting pre-filter of BS.1770 for any sample rate (coefficients as in libebur128). */
function kWeight(samples, sampleRate) {
    // Stage 1: a high shelf (the head's acoustic effect).
    let f0 = 1681.974450955533;
    const gain = 3.999843853973347;
    let q = 0.7071752369554196;
    let k = Math.tan((Math.PI * f0) / sampleRate);
    const vh = 10 ** (gain / 20);
    const vb = vh ** 0.4996667741545416;
    let a0 = 1 + k / q + k * k;
    const shelf = [
        (vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0,
        (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0,
    ];
    // Stage 2: a high pass (RLB weighting).
    f0 = 38.13547087602444;
    q = 0.5003270373238773;
    k = Math.tan((Math.PI * f0) / sampleRate);
    a0 = 1 + k / q + k * k;
    const highPass = [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
    return biquad(biquad(samples, shelf), highPass);
}

/**
 * Integrated loudness in LUFS (BS.1770-4: 400 ms blocks, 75% overlap, absolute gate -70 LUFS,
 * relative gate -10 LU). A line shorter than one block is measured as a single block.
 */
export function integratedLoudness(samples, sampleRate) {
    const weighted = kWeight(samples, sampleRate);
    const block = Math.round(sampleRate * 0.4);
    const hop = Math.round(sampleRate * 0.1);
    const powers = [];
    const measure = (start, length) => {
        let sum = 0;
        for (let i = start; i < start + length; i += 1) sum += weighted[i] * weighted[i];
        powers.push(sum / length);
    };
    if (weighted.length < block) measure(0, weighted.length || 1);
    for (let start = 0; start + block <= weighted.length; start += hop) measure(start, block);
    const lufs = (power) => -0.691 + 10 * Math.log10(power);
    const absolute = powers.filter((power) => power > 0 && lufs(power) > -70);
    if (!absolute.length) return -Infinity;
    const mean = (list) => list.reduce((sum, power) => sum + power, 0) / list.length;
    const relativeGate = lufs(mean(absolute)) - 10;
    const gated = absolute.filter((power) => lufs(power) > relativeGate);
    return lufs(mean(gated.length ? gated : absolute));
}

/** Sample peak in dBFS. */
export function peakDb(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Cut the silence before the first word and after the last, keeping a little air: a cue then
 * starts on its breath, and a chain of lines keeps its own rhythm. The threshold follows the
 * line's own peak, so a whispered line is trimmed as cleanly as a full one.
 */
export function trimSilence(samples, sampleRate, { thresholdDb = -42, floorDb = -60, headMs = 90, tailMs = 280 } = {}) {
    const window = Math.max(1, Math.round(sampleRate * 0.01));
    const level = Math.max(10 ** (floorDb / 20), 10 ** ((peakDb(samples) + thresholdDb) / 20));
    let first = -1;
    let last = -1;
    for (let start = 0; start < samples.length; start += window) {
        let sum = 0;
        const end = Math.min(samples.length, start + window);
        for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
        if (Math.sqrt(sum / (end - start)) >= level) {
            if (first < 0) first = start;
            last = end;
        }
    }
    if (first < 0) return samples.slice(0, 0);
    const from = Math.max(0, first - Math.round((sampleRate * headMs) / 1000));
    const to = Math.min(samples.length, last + Math.round((sampleRate * tailMs) / 1000));
    return samples.slice(from, to);
}

/** Raised-cosine fades, so a trimmed edge never clicks. */
export function fadeEdges(samples, sampleRate, { inMs = 10, outMs = 90 } = {}) {
    const out = Float32Array.from(samples);
    const fadeIn = Math.min(out.length, Math.round((sampleRate * inMs) / 1000));
    const fadeOut = Math.min(out.length, Math.round((sampleRate * outMs) / 1000));
    for (let i = 0; i < fadeIn; i += 1) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
    for (let i = 0; i < fadeOut; i += 1) out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
    return out;
}

/**
 * Bring a line to the target loudness, never past the peak ceiling (a peaky line ends a little
 * quieter rather than distorted). Returns the samples and what was measured and applied.
 */
export function normalizeLoudness(samples, sampleRate, { targetLufs = -20, ceilingDb = -1.5 } = {}) {
    const measured = integratedLoudness(samples, sampleRate);
    if (!Number.isFinite(measured)) return { samples, measured, gainDb: 0 };
    const peak = peakDb(samples);
    const gainDb = Math.min(targetLufs - measured, ceilingDb - peak);
    const gain = 10 ** (gainDb / 20);
    return { samples: samples.map((value) => value * gain), measured, gainDb };
}

/**
 * The whole shaping pass: trim, normalise, fade. `loudness` is the target for this kind of line
 * (quieter lines for the stillness of a hold or the rest are part of the direction).
 */
export function shapeVoiceLine(samples, sampleRate, { targetLufs = -20, ceilingDb = -1.5, trim = {}, fade = {} } = {}) {
    const trimmed = trimSilence(samples, sampleRate, trim);
    const { samples: level, measured, gainDb } = normalizeLoudness(trimmed, sampleRate, { targetLufs, ceilingDb });
    const shaped = fadeEdges(level, sampleRate, fade);
    return {
        samples: shaped,
        seconds: shaped.length / sampleRate,
        measuredLufs: measured,
        gainDb,
        lufs: integratedLoudness(shaped, sampleRate),
        peakDb: peakDb(shaped),
    };
}

/** Encode mono floats as MP3 (constant bitrate), the format the game ships its voice in. */
export function encodeMp3(samples, sampleRate, kbps = 96) {
    const encoder = new Mp3Encoder(1, sampleRate, kbps);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = Math.round(value < 0 ? value * 32768 : value * 32767);
    }
    const chunks = [];
    for (let i = 0; i < pcm.length; i += 1152) {
        const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
        if (chunk.length) chunks.push(Buffer.from(chunk));
    }
    const end = encoder.flush();
    if (end.length) chunks.push(Buffer.from(end));
    return Buffer.concat(chunks);
}

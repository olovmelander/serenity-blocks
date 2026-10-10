/**
 * The Hale sessions' own sounds, made in code: a singing-bowl bell that opens and closes a
 * session and each round, a small chime when a hold reaches its suggested length, and quiet
 * breath tones for slow rhythms, so you can practise with your eyes closed even when the voice is
 * silent. On phones that can, a light pulse marks the same moments.
 *
 * Nothing is loaded and nothing is licensed: every strike is a handful of sine partials on the
 * game's own AudioContext, through its effects bus, so the game's mute and effects volume apply.
 */

/** A singing bowl: inharmonic partials (ratio, level, decay seconds), each a slowly beating pair. */
const BOWL = [
    [1, 1, 7.5],
    [2.76, 0.42, 4.6],
    [5.4, 0.2, 2.8],
    [8.93, 0.09, 1.7],
];
/** Pitch in Hz, level, and how long the bowl rings relative to BOWL's decays. */
export const BELLS = Object.freeze({
    start: { pitch: 196, level: 0.5, length: 1 },
    round: { pitch: 261.63, level: 0.3, length: 0.7 },
    end: { pitch: 174.61, level: 0.55, length: 1.15 },
    hold: { pitch: 392, level: 0.16, length: 0.42 },
});
/** Vibration patterns (ms) for the same moments. */
export const PULSES = Object.freeze({
    inhale: 16,
    exhale: [8, 60, 8],
    hold: [20, 70, 20],
    ready: 45,
    round: [30, 90, 30],
    end: [60, 90, 140],
});
const BEAT_HZ = 0.35;
const MIN_TONE_SECONDS = 2.5;

export class BreathworkChimes {
    /**
     * @param {{getSound?: () => any, getNavigator?: () => any}} [deps]
     */
    constructor({
        getSound = () => globalThis.window?.__serenitySoundManager ?? null,
        getNavigator = () => globalThis.navigator ?? null,
    } = {}) {
        this.getSound = getSound;
        this.getNavigator = getNavigator;
        this.enabled = true;
        this.vibration = true;
        this.voices = new Set();
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.enabled) this.silence();
    }

    setVibration(enabled) { this.vibration = Boolean(enabled); }

    /** True where the browser can vibrate at all (Android; not iOS or desktop). */
    get canVibrate() { return typeof this.getNavigator()?.vibrate === 'function'; }

    /** Called from a click (Begin): make sure the game's audio context exists and runs. */
    prime() {
        try {
            this.getSound()?.resumeAudioContext?.();
        } catch { /* audio unavailable: the session stays silent but runs */ }
    }

    _output() {
        const sound = this.getSound();
        if (!this.enabled || !sound || sound.isMuted) return null;
        const ctx = sound.audioContext;
        const volume = Number(sound.getSfxVolume?.() ?? 1);
        if (!ctx || !(volume > 0)) return null;
        if (ctx.state === 'suspended') Promise.resolve(ctx.resume?.()).catch(() => {});
        return { ctx, destination: sound.getToneDestination?.(false) || ctx.destination, volume };
    }

    /** One strike. Nodes are released when its last partial ends; silence() stops it early. */
    _voice(ctx, destination, gain) {
        const master = ctx.createGain();
        master.gain.value = gain;
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 4200;
        tone.Q.value = 0.4;
        tone.connect(master);
        master.connect(destination);
        const voice = { oscillators: new Set(), nodes: [master, tone], input: tone };
        voice.release = () => {
            if (!this.voices.delete(voice)) return;
            voice.oscillators.forEach((osc) => {
                osc.onended = null;
                try { osc.stop(); } catch { /* already stopped */ }
                try { osc.disconnect(); } catch { /* already disconnected */ }
            });
            voice.nodes.forEach((node) => {
                try { node.disconnect(); } catch { /* already disconnected */ }
            });
        };
        this.voices.add(voice);
        return voice;
    }

    _partial(ctx, voice, {
        frequency, endFrequency = frequency, level, start, attack, length,
    }) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, start);
        if (endFrequency !== frequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + Math.min(length, 0.9));
        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), start + attack);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
        osc.connect(envelope);
        envelope.connect(voice.input);
        voice.oscillators.add(osc);
        voice.nodes.push(envelope);
        osc.onended = () => {
            voice.oscillators.delete(osc);
            if (!voice.oscillators.size) voice.release();
        };
        osc.start(start);
        osc.stop(start + length + 0.05);
    }

    /** Strike the bowl: 'start', 'round', 'end' or 'hold'. Returns false when silent. */
    bell(kind = 'start') {
        const output = this._output();
        if (!output) return false;
        const spec = BELLS[kind] || BELLS.start;
        const { ctx, destination, volume } = output;
        try {
            const start = ctx.currentTime + 0.02;
            const voice = this._voice(ctx, destination, spec.level * volume * 0.55);
            BOWL.forEach(([ratio, level, decay]) => {
                // Two partials a fraction of a hertz apart beat slowly: the bowl's shimmer.
                [-BEAT_HZ, BEAT_HZ].forEach((beat) => this._partial(ctx, voice, {
                    frequency: spec.pitch * ratio + beat * ratio,
                    level: level * 0.5,
                    start,
                    attack: 0.012,
                    length: decay * spec.length,
                }));
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * A breath tone: a soft rising glide on the in-breath, falling on the out-breath. In a
     * session, fast rhythms get none (a tone every second among the voice would be noise, not
     * guidance); a practice on your own may ask for them down to `minSeconds`, and a quick
     * breath's tone is shorter and quieter.
     * @param {'in'|'out'} direction @param {number} seconds how long the phase lasts
     * @param {{minSeconds?: number}} [options]
     */
    tone(direction, seconds, { minSeconds = MIN_TONE_SECONDS } = {}) {
        if (!(seconds >= minSeconds)) return false;
        const output = this._output();
        if (!output) return false;
        const { ctx, destination, volume } = output;
        const low = 293.66;
        const high = 349.23;
        const [from, to] = direction === 'in' ? [low, high] : [high, low];
        try {
            const start = ctx.currentTime + 0.02;
            const length = Math.min(2.2, seconds * 0.7);
            const quick = Math.min(1, seconds / MIN_TONE_SECONDS);
            const voice = this._voice(ctx, destination, volume * 0.12 * quick);
            const swell = [Math.min(0.28, length * 0.4), Math.min(0.35, length * 0.5)];
            this._partial(ctx, voice, {
                frequency: from, endFrequency: to, level: 0.4, start, attack: swell[0], length,
            });
            this._partial(ctx, voice, {
                frequency: from / 2, endFrequency: to / 2, level: 0.25, start, attack: swell[1], length,
            });
            return true;
        } catch {
            return false;
        }
    }

    /** A light vibration where the device has one and you allowed it. */
    pulse(name) {
        const pattern = PULSES[name];
        if (!this.vibration || pattern === undefined) return false;
        const nav = this.getNavigator();
        if (typeof nav?.vibrate !== 'function') return false;
        try {
            return Boolean(nav.vibrate(pattern));
        } catch {
            return false;
        }
    }

    /** Stop every strike at once (the session ended, or sounds were switched off). */
    silence() {
        [...this.voices].forEach((voice) => voice.release());
        try {
            this.getNavigator()?.vibrate?.(0);
        } catch { /* no vibration to cancel */ }
    }
}

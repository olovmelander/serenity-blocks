// @ts-check

/**
 * The ascent's sounds. The music muffles when the view lifts off and opens again when it lands;
 * air rises with the speed; a soft tick every ten rows climbs in pitch with the height; a bell
 * at each milestone (brighter for the ones reached, lower and shorter for the ones still above);
 * a bump at the floor; a shimmer when the view rises past the summit; a click when it docks at
 * home. Everything is synthesized in Web Audio on the sound manager's effects bus, so it follows
 * the player's effects volume and mute. Nothing is loaded.
 */

/** Ticks closer together than this merge (a fast flight past many rows stays a patter). */
const TICK_GAP_MS = 55;
/** The wind's quiet floor and its level at full speed (before the effects volume). */
const WIND_FLOOR = 0.004;
const WIND_PEAK = 0.065;

/**
 * The tick's pitch for a height: 520 Hz at the floor, two octaves up by 640 rows.
 * @param {number} height rows
 */
export function tickPitch(height) {
    const h = Math.min(640, Math.max(0, Number.isFinite(height) ? height : 0));
    return 520 * 2 ** (h / 320);
}

export class AscentAudio {
    /**
     * @param {any} soundManager the app's SoundManager (audioContext, getToneDestination,
     *   getSfxVolume, canPlaySoundEffect, getNoiseBuffer, setMusicMuffle)
     */
    constructor(soundManager) {
        this.sm = soundManager || null;
        /** @type {null|{source: AudioBufferSourceNode, filter: BiquadFilterNode, gain: GainNode}} */
        this.wind = null;
        this.lastTickAt = -Infinity;
        this.muffled = false;
    }

    /** @returns {AudioContext|null} */
    get ctx() {
        return this.sm?.audioContext || null;
    }

    _ready() {
        return Boolean(this.ctx) && this.ctx.state !== 'closed' && this.sm.canPlaySoundEffect?.() !== false;
    }

    _out() {
        return this.sm.getToneDestination?.(false) || this.ctx.destination;
    }

    /** @param {number} level */
    _level(level) {
        const volume = Number(this.sm?.getSfxVolume?.());
        return level * (Number.isFinite(volume) ? volume : 1);
    }

    // ─── Moments ─────────────────────────────────────────────────────────────

    /** The pull gave way: a soft low breath out, the music closes, the air begins. */
    liftOff() {
        this._muffle(1, 0.7);
        if (!this._ready()) return;
        this._tone({
            freq: 120, glideTo: 68, gain: 0.1, attack: 0.012, decay: 0.34,
        });
        this._noise({
            freq: 760, q: 0.8, gain: 0.045, attack: 0.09, decay: 0.5,
        });
        this._startWind();
    }

    /** Home: a soft touchdown, the music opens, the air settles. */
    land() {
        this._muffle(0, 1.1);
        this._stopWind(0.35);
        if (!this._ready()) return;
        this._tone({
            freq: 96, glideTo: 60, gain: 0.085, attack: 0.006, decay: 0.24,
        });
        this._tone({
            freq: 1320, type: 'triangle', gain: 0.022, attack: 0.002, decay: 0.07, at: 0.012,
        });
        this._noise({
            freq: 480, type: 'lowpass', gain: 0.03, attack: 0.004, decay: 0.18,
        });
    }

    /** The exploration ended without a landing (a game key, a menu): open up quickly. */
    release() {
        this._muffle(0, 0.4);
        this._stopWind(0.22);
    }

    /** @param {number} height rows from the floor */
    tick(height) {
        if (!this._ready()) return;
        const now = this.ctx.currentTime * 1000;
        if (now - this.lastTickAt < TICK_GAP_MS) return;
        this.lastTickAt = now;
        const f = tickPitch(height);
        this._tone({
            freq: f, type: 'triangle', gain: 0.028, attack: 0.002, decay: 0.075,
        });
        this._tone({
            freq: f * 2, gain: 0.007, attack: 0.002, decay: 0.05,
        });
    }

    /**
     * A milestone's line: a bell. @param {boolean} reached a milestone already built past
     */
    chime(reached) {
        if (!this._ready()) return;
        const f0 = reached ? 784 : 523.25;
        const decay = reached ? 1.7 : 0.95;
        const partials = [[1, 0.05], [2, 0.018], [2.76, 0.014], [5.4, 0.005]];
        partials.forEach(([ratio, gain], i) => this._tone({
            freq: f0 * ratio, gain: reached ? gain : gain * 0.6, attack: 0.003, decay: decay / (1 + i * 0.6),
        }));
    }

    /** Pushed into the floor. @param {number} strength 0..1 */
    bump(strength = 0.5) {
        if (!this._ready()) return;
        const s = Math.min(1, Math.max(0.15, strength));
        this._tone({
            freq: 64, glideTo: 46, gain: 0.12 * s, attack: 0.004, decay: 0.2,
        });
        this._noise({
            freq: 300, type: 'lowpass', gain: 0.06 * s, attack: 0.002, decay: 0.12,
        });
    }

    /** Rising past the summit into the open sky. */
    shimmer() {
        if (!this._ready()) return;
        [1567.98, 2093, 2637.02].forEach((freq, i) => this._tone({
            freq, gain: 0.016, attack: 0.01, decay: 0.95, at: i * 0.045,
        }));
    }

    /** The view docked at home. */
    dock() {
        if (!this._ready()) return;
        this._tone({
            freq: 880, gain: 0.03, attack: 0.002, decay: 0.05,
        });
        this._tone({
            freq: 1318.5, gain: 0.018, attack: 0.002, decay: 0.045, at: 0.028,
        });
    }

    /**
     * Every frame while looking. @param {number} speed 0..1 how fast the view moves
     * @param {number} sky 0..1 how high above the summit (the air thins and brightens)
     */
    motion(speed, sky) {
        const { wind } = this;
        if (!wind || !this.ctx) return;
        const s = Math.min(1, Math.max(0, Number.isFinite(speed) ? speed : 0));
        const thin = Math.min(1, Math.max(0, Number.isFinite(sky) ? sky : 0));
        const level = this._ready() ? this._level(WIND_FLOOR + WIND_PEAK * s ** 1.4) : 0;
        const now = this.ctx.currentTime;
        wind.gain.gain.setTargetAtTime(level, now, 0.08);
        wind.filter.frequency.setTargetAtTime(360 + 1700 * s + 900 * thin, now, 0.1);
    }

    dispose() {
        this._stopWind(0.05);
        this._muffle(0, 0.2);
    }

    // ─── Voices ──────────────────────────────────────────────────────────────

    /** @param {number} amount @param {number} seconds */
    _muffle(amount, seconds) {
        const wanted = amount > 0;
        if (wanted && this.muffled) return;
        try {
            const filtered = this.sm?.setMusicMuffle?.(amount, seconds) === true;
            this.muffled = wanted && filtered;
        } catch (error) {
            console.warn('[AscentAudio] music muffle failed:', error);
        }
    }

    _startWind() {
        if (this.wind || !this._ready() || typeof this.sm.getNoiseBuffer !== 'function') return;
        const { ctx } = this;
        try {
            const source = ctx.createBufferSource();
            source.buffer = this.sm.getNoiseBuffer('pink', 3);
            source.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 380;
            filter.Q.value = 0.7;
            const gain = ctx.createGain();
            gain.gain.value = 0.0001;
            source.connect(filter);
            filter.connect(gain);
            gain.connect(this._out());
            source.start(ctx.currentTime, Math.random() * 2);
            this.wind = { source, filter, gain };
        } catch (error) {
            console.warn('[AscentAudio] wind failed:', error);
            this.wind = null;
        }
    }

    /** @param {number} fadeSeconds */
    _stopWind(fadeSeconds) {
        const { wind } = this;
        this.wind = null;
        if (!wind || !this.ctx) return;
        const now = this.ctx.currentTime;
        try {
            wind.gain.gain.cancelScheduledValues(now);
            wind.gain.gain.setValueAtTime(Math.max(0.0001, wind.gain.gain.value), now);
            wind.gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, fadeSeconds));
            wind.source.stop(now + Math.max(0.02, fadeSeconds) + 0.05);
            wind.source.onended = () => {
                wind.source.disconnect();
                wind.filter.disconnect();
                wind.gain.disconnect();
            };
        } catch {
            /* the context is closing */
        }
    }

    /**
     * @param {{freq: number, type?: OscillatorType, gain: number, attack: number, decay: number,
     *   at?: number, glideTo?: number}} voice
     */
    _tone({
        freq, type = 'sine', gain, attack, decay, at = 0, glideTo,
    }) {
        const { ctx } = this;
        const level = this._level(gain);
        if (!(level > 0)) return;
        const t = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        osc.connect(env);
        env.connect(this._out());
        osc.start(t);
        osc.stop(t + attack + decay + 0.05);
        osc.onended = () => {
            osc.disconnect();
            env.disconnect();
        };
    }

    /**
     * @param {{freq: number, type?: BiquadFilterType, q?: number, gain: number, attack: number,
     *   decay: number, at?: number}} voice
     */
    _noise({
        freq, type = 'bandpass', q = 1, gain, attack, decay, at = 0,
    }) {
        if (typeof this.sm.getNoiseBuffer !== 'function') return;
        const { ctx } = this;
        const level = this._level(gain);
        if (!(level > 0)) return;
        const t = ctx.currentTime + at;
        const source = ctx.createBufferSource();
        source.buffer = this.sm.getNoiseBuffer('pink', attack + decay + 0.1);
        const filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        source.connect(filter);
        filter.connect(env);
        env.connect(this._out());
        source.start(t);
        source.stop(t + attack + decay + 0.05);
        source.onended = () => {
            source.disconnect();
            filter.disconnect();
            env.disconnect();
        };
    }
}

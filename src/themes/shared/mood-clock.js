// @ts-check

/**
 * Mood clock — a theme's moods (its hours, palettes, seasons, weathers) turn by the world's clock
 * in every mode, and a level is one step on top.
 *
 * Only a single-player run and the Odyssey level up. Infinity never does, a match keeps one level
 * unless the host turns levelling on, and Serenity has no play at all: a theme whose light turned
 * only with a level stood in one light forever there. Most themes already turn by the clock as
 * well (Sunset's day, Winter's hours, Geode's minerals, the hour wheels), each with its own copy
 * of the same few lines; this is those lines once, for the themes that had none:
 *
 *     phase = levelStep (eased the short way round) + moodDrift(time)
 *
 * The clock rests on a mood for a share of its period and then melts into the next (smoothstep),
 * so every mood is seen pure for a while. It is a function of the time alone, so a seek, a replay
 * and a rebuild that carries the clock all land on the same light. The level's step keeps the
 * level-up a moment of its own: the theme's burst plays and the light moves on a whole mood.
 *
 * meltPalettes() mixes two palettes the short way round the colour wheel while saturation and
 * brightness cross over (a straight mix of violet and amber is a grey mauve); on a whole phase
 * it is the palette itself, exactly.
 */

/** Seconds a mood lasts when only the clock is turning it (the house pace: 80-150 s a look). */
export const MOOD_SECONDS = 100;
/** The share of that time a mood rests, pure, before it starts to melt into the next. */
export const MOOD_HOLD = 0.35;

/** @param {number} x */
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * How far the clock alone has turned the moods by `time` (seconds): the whole part counts the
 * moods passed, the fraction is the melt into the next one (0 through the hold, then eased).
 * Never runs backward and never jumps.
 * @param {number} time
 * @param {number} [seconds] the period of one mood
 * @param {number} [hold] the share of the period a mood rests before it melts (0..1)
 */
export function moodDrift(time, seconds = MOOD_SECONDS, hold = MOOD_HOLD) {
    const turns = Math.max(0, Number(time) || 0) / Math.max(1e-6, seconds);
    const whole = Math.floor(turns);
    const rest = clamp01(hold);
    const melt = rest >= 1 ? 0 : clamp01((turns - whole - rest) / (1 - rest));
    return whole + melt * melt * (3 - 2 * melt);
}

/**
 * The count of steps nearest `from` that shows the same mood as `step` on a wheel of `count`:
 * the light turns to a new level's mood the short way round.
 * @param {number} from
 * @param {number} step
 * @param {number} count
 */
export function nearestStep(from, step, count) {
    return count > 0 ? step + count * Math.round((from - step) / count) : step;
}

/**
 * Ease a level's step: `current` moves toward `step` by `k` (1 snaps) the short way round a
 * wheel of `count`, and lands on it exactly once it is close.
 * @param {number} current
 * @param {number} step
 * @param {number} k
 * @param {number} count
 */
export function easeStep(current, step, k, count) {
    const goal = nearestStep(current, step, count);
    if (k >= 1 || !Number.isFinite(current)) return goal;
    const next = current + (goal - current) * Math.max(0, k);
    return Math.abs(goal - next) < 1e-4 ? goal : next;
}

/**
 * Where `phase` stands on a wheel of `count` moods: the mood it is leaving (`a`), the one it is
 * melting into (`b`) and how far (`melt`, 0..1).
 * @param {number} phase
 * @param {number} count
 * @param {{ a: number, b: number, melt: number }} [out]
 */
export function wheelAt(phase, count, out = { a: 0, b: 0, melt: 0 }) {
    const p = Number.isFinite(phase) ? phase : 0;
    const whole = Math.floor(p);
    const n = Math.max(1, count | 0);
    out.a = ((whole % n) + n) % n;
    out.b = (out.a + 1) % n;
    out.melt = p - whole;
    return out;
}

/**
 * A walk there and back: 0 at whole even numbers, 1 at odd ones, straight between. For a mood
 * that is one axis (golden hour to deep dusk) rather than a wheel.
 * @param {number} x
 */
export function pingPong(x) {
    const p = (((Number.isFinite(x) ? x : 0) % 2) + 2) % 2;
    return p <= 1 ? p : 2 - p;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number[]} out [hue 0..1 (NaN for a grey), saturation, value]
 */
function toHsv(r, g, b, out) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    out[2] = max;
    out[1] = max > 0 ? d / max : 0;
    if (d <= 1e-9) {
        out[0] = Number.NaN;
        return out;
    }
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    out[0] = h / 6;
    return out;
}

/**
 * @param {number} h
 * @param {number} s
 * @param {number} v
 * @param {number} n 5 for red, 3 for green, 1 for blue
 */
function hsvChannel(h, s, v, n) {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
}

const FROM = [0, 0, 0];
const TO = [0, 0, 0];

/**
 * Mix two colours `melt` of the way, the short way round the colour wheel (a grey takes the hue
 * of the colour it is melting into, or out of). Writes and returns `out`.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {number} melt
 * @param {number[]} out
 */
export function meltColour(a, b, melt, out) {
    if (melt <= 0 || melt >= 1) {
        const pure = melt >= 1 ? b : a;
        out[0] = pure[0];
        out[1] = pure[1];
        out[2] = pure[2];
        return out;
    }
    toHsv(a[0], a[1], a[2], FROM);
    toHsv(b[0], b[1], b[2], TO);
    let h0 = FROM[0];
    let h1 = TO[0];
    if (Number.isNaN(h0)) h0 = Number.isNaN(h1) ? 0 : h1;
    if (Number.isNaN(h1)) h1 = h0;
    let turn = h1 - h0;
    if (turn > 0.5) turn -= 1;
    else if (turn < -0.5) turn += 1;
    const hue = (((h0 + turn * melt) % 1) + 1) % 1;
    const s = FROM[1] + (TO[1] - FROM[1]) * melt;
    const v = FROM[2] + (TO[2] - FROM[2]) * melt;
    out[0] = hsvChannel(hue, s, v, 5);
    out[1] = hsvChannel(hue, s, v, 3);
    out[2] = hsvChannel(hue, s, v, 1);
    return out;
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The palette at `phase` round a wheel of `palettes` (each `{ [key]: [r, g, b] }`), written into
 * `out[key]` for every key in `keys` (arrays are made as needed). On a whole phase it is that
 * palette exactly; between, each colour melts with meltColour(). Returns `out`.
 * @template {Record<string, any>} P
 * @param {ReadonlyArray<P>} palettes
 * @param {ReadonlyArray<string>} keys
 * @param {number} phase
 * @param {Record<string, number[]>} [out]
 */
export function meltPalettes(palettes, keys, phase, out = {}) {
    wheelAt(phase, palettes.length, AT);
    const a = palettes[AT.a];
    const b = palettes[AT.b];
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const rgb = out[key] || (out[key] = [0, 0, 0]);
        meltColour(a[key], b[key], AT.melt, rgb);
    }
    return out;
}

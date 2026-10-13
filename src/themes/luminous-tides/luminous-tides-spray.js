/**
 * Luminous Tides — the spray off a breaking lip (CPU only, three-free).
 *
 * When a crest reaches its break line the lip throws a curtain of water forward, and every drop of
 * it carries the sea's fire. The shore is cut into strips along its length; for each strip and each
 * crest the moment that crest reaches its break line there is solved in closed form (the surf's
 * phase is monotonic in time), so the droplets are a pure function of the clock: a seek replays
 * them exactly. A crest throws spray only along the sections where it breaks hard.
 *
 * The board's waves of light throw theirs too, along the peel: the further a strip is from where
 * the wave was thrown, the later its lip comes over.
 */
import {
    DEG, SHORE_FRAME, SURF, TAU, breakLine, clamp01, crestHeight, fract, fromShore, surfPhase, surfTime,
} from './luminous-tides-core.js';

/**
 * The spray's plan:
 *   from, to, cell   the strips along the shore (metres of a) that throw spray
 *   drops            droplets a strip throws per crest (the board's waves throw more)
 *   life             seconds a droplet flies
 *   speed, lift      how fast it is thrown shoreward and up (m/s, scaled by the crest's height)
 */
export const SPRAY = Object.freeze({
    from: -14, to: 90, cell: 2.0, drops: 7, life: 1.05, speed: 2.4, lift: 2.2,
});

const G = 9.81;
const WOBBLE = SURF.wobble * SURF.period;
const LEAN = Math.sin(SURF.oblique * DEG);

/** d(surfPhase)/d(surf time) at a surf time (crests per second). */
function phaseRate(tr) {
    return (1
        + WOBBLE * 0.55 * ((TAU / 23.3) * Math.cos((tr * TAU) / 23.3))
        + WOBBLE * 0.35 * ((TAU / 41.9) * Math.cos((tr * TAU) / 41.9 + 1.7))) / SURF.period;
}

/** The surf time at which the phase stands on crest `k` (inverse of surfPhase; it is monotonic). */
export function crestTime(k) {
    let tr = k * SURF.period;
    for (let i = 0; i < 4; i += 1) tr -= (surfPhase(tr) - k) / Math.max(1e-3, phaseRate(tr));
    return tr;
}

/** The world time crest `k` reaches its break line at `a` along the shore, and where that line is. */
export function breakMoment(k, a, out = { t: 0, s: 0, H: 0 }) {
    const H = crestHeight(k);
    const s = breakLine(H, a);
    // surfTime is the world time less a lag that does not depend on time.
    const lag = 0 - surfTime(a, s, 0);
    out.t = crestTime(k) + lag;
    out.s = s;
    out.H = H;
    return out;
}

const hash = (n) => fract(Math.sin(n * 12.9898 + 78.233) * 43758.5453);

/** Whether crest `k` breaks hard at strip `j` (its sections; about two strips in three). */
export function breaksHard(k, j) {
    return hash(k * 7.13 + Math.floor(j / 3) * 1.71) > 0.32;
}

const moment = { t: 0, s: 0, H: 0 };
const at = { x: 0, z: 0 };

/**
 * Write the spray alive at `clock` into `push(x, y, z, r, R, G, B, vx, vy, vz)`.
 * `glow` is the sea's light (rgb), `power` its strength; `waves` the board's waves of light
 * ({ a0, s0, t0, strength, H, speed, sBreak, peel }); `limit` the most droplets to write.
 * Returns how many were written.
 */
export function writeSpray(clock, glow, power, waves, limit, push) {
    let n = 0;
    const { along, out } = SHORE_FRAME;
    // Shoreward and a little along the crest's lean: where a lip is thrown.
    const fx = -out.x - along.x * LEAN * 0.5;
    const fz = -out.z - along.z * LEAN * 0.5;
    const cells = Math.floor((SPRAY.to - SPRAY.from) / SPRAY.cell);
    for (let j = 0; j < cells && n < limit; j += 1) {
        const a = SPRAY.from + (j + 0.5) * SPRAY.cell;
        // The crest that last crossed its break line here, and the one before it.
        const sNow = breakLine(SURF.height, a);
        const k0 = Math.floor(surfPhase(surfTime(a, sNow, clock)));
        for (let dk = -1; dk <= 1 && n < limit; dk += 1) {
            const k = k0 + dk;
            if (!breaksHard(k, j)) continue;
            breakMoment(k, a, moment);
            const age = clock - moment.t;
            if (age < 0 || age > SPRAY.life) continue;
            const scale = moment.H / SURF.height;
            for (let i = 0; i < SPRAY.drops && n < limit; i += 1) {
                const seed = k * 131.7 + j * 17.31 + i * 3.7;
                const ja = (hash(seed) - 0.5) * SPRAY.cell;
                const delay = hash(seed + 1.3) * 0.18;
                const t = age - delay;
                if (t < 0) continue;
                fromShore(a + ja, moment.s - 0.6, at);
                const v = SPRAY.speed * (0.6 + 0.8 * hash(seed + 2.9)) * Math.sqrt(scale);
                const up = SPRAY.lift * (0.5 + 0.7 * hash(seed + 4.1)) * Math.sqrt(scale);
                const side = (hash(seed + 5.7) - 0.5) * 0.8;
                const vx = fx * v + along.x * side;
                const vz = fz * v + along.z * side;
                const y0 = moment.H * 0.7;
                const y = y0 + up * t - 0.5 * G * t * t;
                if (y < -0.05) continue;
                const fade = (1 - clamp01((t - SPRAY.life * 0.4) / (SPRAY.life * 0.6))) * Math.exp(-t * 1.5);
                const c = power * 0.9 * fade * Math.min(1.6, scale);
                push(at.x + vx * t, y, at.z + vz * t, 0.014, glow[0] * c, glow[1] * c, glow[2] * c, vx, up - G * t, vz);
                n += 1;
            }
        }
    }
    // The board's waves: a curtain of spray along the peel.
    for (let w = 0; w < waves.length && n < limit; w += 1) {
        const wave = waves[w];
        const breakAt = wave.t0 + (wave.s0 - wave.sBreak) / wave.speed;
        const scale = wave.H / SURF.height;
        for (let j = 0; j < cells && n < limit; j += 1) {
            const a = SPRAY.from + (j + 0.5) * SPRAY.cell;
            const off = Math.abs(a - wave.a0);
            const age = clock - (breakAt + off / Math.max(1, wave.peel));
            if (age < 0 || age > SPRAY.life * 1.3) continue;
            const drops = SPRAY.drops * 2;
            for (let i = 0; i < drops && n < limit; i += 1) {
                const seed = wave.t0 * 37.1 + j * 17.31 + i * 3.7;
                const delay = hash(seed + 1.3) * 0.22;
                const t = age - delay;
                if (t < 0) continue;
                fromShore(a + (hash(seed) - 0.5) * SPRAY.cell, wave.sBreak - 0.8, at);
                const v = SPRAY.speed * (0.7 + 0.9 * hash(seed + 2.9)) * Math.sqrt(scale);
                const up = SPRAY.lift * (0.6 + 0.8 * hash(seed + 4.1)) * Math.sqrt(scale);
                const side = (hash(seed + 5.7) - 0.5) * 1.2;
                const vx = fx * v + along.x * side;
                const vz = fz * v + along.z * side;
                const y = wave.H * 0.75 + up * t - 0.5 * G * t * t;
                if (y < -0.05) continue;
                const fade = (1 - clamp01((t - SPRAY.life * 0.5) / (SPRAY.life * 0.8))) * Math.exp(-t * 1.2);
                const c = power * 1.1 * fade * wave.strength;
                push(at.x + vx * t, y, at.z + vz * t, 0.016, glow[0] * c, glow[1] * c, glow[2] * c, vx, up - G * t, vz);
                n += 1;
            }
        }
    }
    return n;
}

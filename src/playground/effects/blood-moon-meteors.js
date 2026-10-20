/**
 * Meteors over the salt flat: now and then a quiet one, a few seconds apart at most once in a
 * slot of the clock, and a bright fireball on the game's big clears. Each is a stretch of a great
 * circle drawn analytically in the world shader (blood-moon-world.js), so the water mirrors it.
 *
 * The quiet ones are a pure function of time (a slot of METEOR.slot seconds holds at most one, at
 * a hashed moment, on a hashed path), so a seek or a fixed-time capture lands on the same sky. A
 * cued fireball takes the stage for its own duration. No three.js; nothing allocates per frame.
 */

export const METEOR = Object.freeze({
    /** Seconds per slot of the clock; a quiet meteor falls in about two slots of three. */
    slot: 21,
    share: 0.68,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};

/** A unit direction from an azimuth (right of the rest view) and an elevation, radians. */
function direction(az, el, out) {
    out[0] = Math.cos(el) * Math.sin(az);
    out[1] = Math.sin(el);
    out[2] = -Math.cos(el) * Math.cos(az);
    return out;
}

/**
 * Fill `out` with a path: start direction a, its side s (a turned toward the end), the normal n of
 * their great circle, and the path's length in radians.
 */
function path(r0, r1, r2, r3, out, spread, avoid, fireball = false) {
    // In the frame (it spans about 27° up from the horizon) and beside the board, not behind it.
    // A fireball takes the open sky away from the moon; a quiet one that would start on the moon
    // (or its ember ring) starts on the other side instead.
    let side = r0 < 0.5 ? -1 : 1;
    if (fireball && avoid) side = avoid.az > 0 ? -1 : 1;
    // `spread` is the bearing of the frame's side edge: paths start and end inside it.
    let az = side * spread * (0.3 + ((r0 * 2) % 1) * 0.3);
    const el = 0.12 + r1 * 0.24;
    if (avoid && !fireball && Math.hypot((az - avoid.az) * Math.cos(el), el - avoid.el) < avoid.radius) {
        side = -side;
        az = -az;
    }
    // Outward, away from the board; a fireball crosses a longer stretch of sky.
    const turn = side * spread * (fireball ? 0.3 + r2 * 0.12 : 0.12 + r2 * 0.18);
    const fall = fireball ? 0.08 + r3 * 0.08 : 0.05 + r3 * 0.1;
    const a = direction(az, el, out.a);
    const b = direction(az + turn, el - fall, out.s);
    const cosL = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // n = a × b, s = n × a (b = a cos L + s sin L). b lives in out.s until s replaces it.
    const { n } = out;
    n[0] = a[1] * b[2] - a[2] * b[1];
    n[1] = a[2] * b[0] - a[0] * b[2];
    n[2] = a[0] * b[1] - a[1] * b[0];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const { s } = out;
    s[0] = n[1] * a[2] - n[2] * a[1];
    s[1] = n[2] * a[0] - n[0] * a[2];
    s[2] = n[0] * a[1] - n[1] * a[0];
    out.length = Math.atan2(nl, cosL);
    return out;
}

export class BloodMoonMeteors {
    constructor() {
        this.cued = null;
        /** The bearing of the frame's side edge (radians); the owner sets it on resize. */
        this.spread = 0.6;
        /** Where the moon stands ({ az, el, radius } in radians) so paths keep clear of it. */
        this.avoid = null;
        this.cuePath = {
            a: [0, 0, 0], s: [0, 0, 0], n: [0, 0, 0], length: 0,
        };
        this.state = {
            a: [0, 0, 0], s: [0, 0, 0], n: [0, 0, 0], length: 0, head: 0, trail: 0, glow: 0, fireball: 0,
        };
    }

    /** A fireball for a big clear, starting at `time`. */
    cue(time, strength = 1, random = Math.random) {
        if (!Number.isFinite(time) || !(strength > 0)) return;
        path(random(), random(), random(), random(), this.cuePath, this.spread, this.avoid, true);
        this.cued = {
            start: time, duration: 1.5 + random() * 0.4, strength: clamp(strength, 0, 2),
        };
    }

    reset() { this.cued = null; }

    /** The meteor in the sky at `time` (glow 0 when none). */
    sample(time) {
        const out = this.state;
        out.glow = 0;
        out.fireball = 0;
        const t = Number.isFinite(time) ? time : 0;
        let progress = -1;
        let strength = 0;
        let source = null;
        if (this.cued) {
            const local = (t - this.cued.start) / this.cued.duration;
            if (local >= 0 && local < 1) {
                progress = local;
                ({ strength } = this.cued);
                source = this.cuePath;
                out.fireball = 1;
            } else if (local >= 1) this.cued = null;
        }
        if (!source) {
            const slot = Math.floor(t / METEOR.slot);
            if (hash(slot * 7.13) < METEOR.share) {
                const duration = 0.55 + hash(slot * 3.7 + 1) * 0.5;
                const begin = slot * METEOR.slot + hash(slot * 5.1 + 2) * (METEOR.slot - duration);
                const local = (t - begin) / duration;
                if (local >= 0 && local < 1) {
                    progress = local;
                    strength = 0.45 + hash(slot * 9.7 + 3) * 0.5;
                    const r0 = hash(slot + 0.1);
                    const r1 = hash(slot + 0.2);
                    const r2 = hash(slot + 0.3);
                    const r3 = hash(slot + 0.4);
                    source = path(r0, r1, r2, r3, out, this.spread, this.avoid);
                }
            }
        }
        if (!source) return out;
        if (source !== out) {
            for (let i = 0; i < 3; i++) {
                out.a[i] = source.a[i]; out.s[i] = source.s[i]; out.n[i] = source.n[i];
            }
            out.length = source.length;
        }
        // It burns brightest a little past the middle of its fall and leaves a short, fading trail.
        out.head = progress * out.length;
        out.trail = Math.min(out.head, out.length * (out.fireball ? 0.5 : 0.32));
        out.glow = strength * Math.sin(Math.PI * progress) ** 0.6;
        return out;
    }
}

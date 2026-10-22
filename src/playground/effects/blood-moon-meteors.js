/**
 * Meteors over the salt flat: now and then a quiet one, a few seconds apart at most once in a
 * slot of the clock, and a bright fireball on the game's big clears. Each is a stretch of a great
 * circle drawn analytically in the world shader (blood-moon-world.js), so the water mirrors it.
 *
 * The quiet ones are a pure function of time (a slot of METEOR.slot seconds holds at most one, at
 * a hashed moment, on a hashed path), so a seek or a fixed-time capture lands on the same sky. A
 * cued fireball takes the stage for its own duration. A second cue never cuts it off: while it is
 * still climbing it flares into a bolide; past its best, the next one follows it. Hot play opens a
 * storm (advanceStorm): meteors from one radiant above the open sky, one after another, as fast as
 * the game asks. The shader draws one meteor at a time: fireball, then storm, then quiet.
 * No three.js; nothing allocates per frame.
 */
import { Swell } from '../../themes/shared/gameplay-surge.js';

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

/**
 * A storm meteor's path: it starts near one radiant high over the open sky (the side away from
 * the moon) and falls away from it, fanned downward, staying clear of the moon.
 */
function radiantPath(r0, r1, r2, out, spread, avoid) {
    const side = avoid && avoid.az > 0 ? -1 : 1;
    const radiantAz = side * spread * 0.45;
    const radiantEl = 0.5;
    // Fanned below the radiant: straight down at 0, out to about 70 degrees either side.
    let angle = (r0 - 0.5) * 2.4;
    const start = 0.05 + r1 * 0.12;
    let az = radiantAz + Math.sin(angle) * start;
    let el = radiantEl - Math.cos(angle) * start;
    if (avoid && Math.hypot((az - avoid.az) * Math.cos(el), el - avoid.el) < avoid.radius) {
        angle = -angle;
        az = radiantAz + Math.sin(angle) * start;
        el = radiantEl - Math.cos(angle) * start;
    }
    const reach = 0.08 + r2 * 0.1;
    const endAz = clamp(az + Math.sin(angle) * reach, -spread * 0.95, spread * 0.95);
    const endEl = Math.max(0.05, el - Math.cos(angle) * reach);
    const a = direction(az, el, out.a);
    const b = direction(endAz, endEl, out.s);
    const cosL = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
        /** A fireball cued while one is past its best: it follows when that one has gone. */
        this.next = null;
        /** The bolide's burst: a fireball cued again while it climbs flares instead of restarting. */
        this.flare = new Swell({
            attack: 0.05, release: 0.38, ceiling: 1.6, knee: 1.1,
        });
        /** The storm: a clock that ticks once per meteor, and the one in flight. */
        this.stormClock = 0;
        this.stormCount = 0;
        this.storm = null;
        this.stormMeteor = { start: 0, duration: 1, strength: 0 };
        /** The bearing of the frame's side edge (radians); the owner sets it on resize. */
        this.spread = 0.6;
        /** Where the moon stands ({ az, el, radius } in radians) so paths keep clear of it. */
        this.avoid = null;
        this.cuePath = {
            a: [0, 0, 0], s: [0, 0, 0], n: [0, 0, 0], length: 0,
        };
        this.nextPath = {
            a: [0, 0, 0], s: [0, 0, 0], n: [0, 0, 0], length: 0,
        };
        this.stormPath = {
            a: [0, 0, 0], s: [0, 0, 0], n: [0, 0, 0], length: 0,
        };
        this.state = {
            a: [0, 0, 0], s: [0, 0, 0], n: [0, 0, 0], length: 0, head: 0, trail: 0, glow: 0, fireball: 0,
        };
    }

    /** A fireball for a big clear, starting at `time`; it never cuts one already in the sky. */
    cue(time, strength = 1, random = Math.random) {
        if (!Number.isFinite(time) || !(strength > 0)) return;
        const bright = clamp(strength, 0, 2);
        const live = this.cued;
        const local = live ? (time - live.start) / live.duration : -1;
        if (live && local >= 0 && local < 0.62) {
            // Still climbing: it bursts into a bolide.
            live.strength = Math.max(live.strength, bright);
            this.flare.hit(bright * 0.7, time);
            return;
        }
        if (live && local >= 0 && local < 1) {
            // Past its best: the next follows it across the sky.
            if (this.next) {
                this.next.strength = Math.max(this.next.strength, bright);
                return;
            }
            path(random(), random(), random(), random(), this.nextPath, this.spread, this.avoid, true);
            this.next = {
                start: live.start + live.duration, duration: 1.5 + random() * 0.4, strength: bright,
            };
            return;
        }
        path(random(), random(), random(), random(), this.cuePath, this.spread, this.avoid, true);
        this.cued = {
            start: time, duration: 1.5 + random() * 0.4, strength: bright,
        };
    }

    /**
     * The storm, once a frame: `rate` meteors a second (0: none). Each falls from one radiant
     * high over the open sky; a meteor waits for the one before it to burn out.
     */
    advanceStorm(time, dt, rate) {
        if (!(rate > 0)) {
            this.stormClock = Math.min(this.stormClock, 0.6);
            return;
        }
        if (!Number.isFinite(time) || !(dt > 0)) return;
        this.stormClock = Math.min(1.5, this.stormClock + dt * rate);
        const flying = this.storm && time < this.storm.start + this.storm.duration;
        if (this.stormClock < 1 || flying) return;
        this.stormClock -= 1;
        this.stormCount += 1;
        const k = this.stormCount * 1.618;
        radiantPath(hash(k + 0.11), hash(k + 0.23), hash(k + 0.37), this.stormPath, this.spread, this.avoid);
        const meteor = this.stormMeteor;
        meteor.start = time;
        meteor.duration = 0.42 + hash(k + 0.51) * 0.38;
        meteor.strength = 0.55 + hash(k + 0.67) * 0.45 + Math.min(0.3, rate * 0.08);
        this.storm = meteor;
    }

    reset() {
        this.cued = null;
        this.next = null;
        this.flare.reset();
        this.stormClock = 0;
        this.stormCount = 0;
        this.storm = null;
    }

    /** The meteor in the sky at `time` (glow 0 when none). */
    sample(time) {
        const out = this.state;
        out.glow = 0;
        out.fireball = 0;
        const t = Number.isFinite(time) ? time : 0;
        let progress = -1;
        let strength = 0;
        let source = null;
        let trail = 0.32;
        if (this.cued && this.next && (t - this.cued.start) / this.cued.duration >= 1) {
            // The one that waited takes the sky.
            this.cued = this.next;
            this.next = null;
            const from = this.nextPath;
            for (let i = 0; i < 3; i++) {
                this.cuePath.a[i] = from.a[i]; this.cuePath.s[i] = from.s[i]; this.cuePath.n[i] = from.n[i];
            }
            this.cuePath.length = from.length;
        }
        if (this.cued) {
            const local = (t - this.cued.start) / this.cued.duration;
            if (local >= 0 && local < 1) {
                progress = local;
                strength = this.cued.strength + this.flare.valueAt(t) * 0.8;
                source = this.cuePath;
                trail = 0.5;
                out.fireball = 1;
            } else if (local >= 1) this.cued = null;
        }
        if (!source && this.storm) {
            const local = (t - this.storm.start) / this.storm.duration;
            if (local >= 0 && local < 1) {
                progress = local;
                ({ strength } = this.storm);
                source = this.stormPath;
                trail = 0.42;
            } else if (local >= 1) this.storm = null;
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
        out.trail = Math.min(out.head, out.length * trail);
        out.glow = strength * Math.sin(Math.PI * progress) ** 0.6;
        return out;
    }
}

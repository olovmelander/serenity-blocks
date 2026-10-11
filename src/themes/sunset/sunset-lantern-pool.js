/**
 * Sunset — the lanterns' lives (CPU only, three-free).
 *
 * A locked piece sends a light of its own colour from the card's edge down to the sea, where it
 * becomes a paper lantern afloat: it rides the swell (seaHeight / seaSlope) and drifts slowly out
 * from the eye. A clear sends lanterns UP: the oldest on the water lift off one after another and
 * the evening wind carries them away toward the place the sun goes down, climbing, until they
 * are sparks over the horizon. When the water holds as many as the pool allows, the oldest one
 * lifts by itself to make room.
 *
 * Everything is a closed-form function of the world's clock and a few numbers per lantern, so a
 * capture time is reproducible and nothing accumulates frame by frame.
 */
import {
    clamp01, mulberry32, seaHeight, seaSlope, smooth,
} from './sunset-core.js';

/** Seconds a light takes from the card's edge to the water. */
export const MOTE_SECONDS = 0.62;
/** A lantern sets out on its own after this long on the water. */
export const WATER_LIFE = 150;
/** Seconds a lantern is seen in the air before it is gone over the horizon. */
export const AIR_LIFE = 150;
/** How fast a lantern climbs once it is going (m/s), and how long it takes to get going (s). */
export const RISE_SPEED = 1.25;
export const RISE_LAG = 1.7;
/** How fast the wind carries it away (m/s), and how long the wind takes to take it. */
export const WIND_SPEED = 3.6;
export const WIND_LAG = 6;
/** How fast a lantern drifts out on the water (m/s). */
export const WATER_DRIFT = 0.11;
/** A lantern's paper is this tall (metres). */
export const LANTERN_HEIGHT = 0.62;

const lagged = (s, lag) => s - lag * (1 - Math.exp(-s / lag));

function createRecord() {
    return {
        alive: false,
        id: 0,
        /** Where the light set out from (world), and when. */
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        sent: -100,
        /** Where it lands on the water, and when (sent + MOTE_SECONDS). */
        x0: 0,
        z0: 0,
        t0: -100,
        rgb: [1, 0.72, 0.36],
        seed: 0,
        hard: false,
        /** When it lifts off the water (Infinity while it floats), and from where. */
        tr: Infinity,
        xr: 0,
        yr: 0,
        zr: 0,
        /** The wind's direction (unit, xz) and a turn of its own. */
        windX: 0,
        windZ: -1,
        spiral: 0,
        drift: [0, 0],
    };
}

export class LanternPool {
    /**
     * @param {object} p
     * @param {number} p.capacity
     * @param {number} [p.seed]
     */
    constructor({ capacity = 48, seed = 11 } = {}) {
        this.capacity = Math.max(4, capacity | 0);
        this.records = Array.from({ length: this.capacity }, createRecord);
        this.rand = mulberry32(seed);
        this.serial = 0;
        this._slope = { x: 0, z: 0 };
    }

    reset() {
        this.records.forEach((r) => {
            r.alive = false;
            r.tr = Infinity;
        });
    }

    /** How many lanterns are afloat (landed and not lifted) at `clock`. */
    floating(clock) {
        let n = 0;
        for (let i = 0; i < this.records.length; i += 1) {
            const r = this.records[i];
            if (r.alive && r.t0 <= clock && clock < r.tr) n += 1;
        }
        return n;
    }

    /** How many are in the air at `clock`. */
    flying(clock) {
        let n = 0;
        for (let i = 0; i < this.records.length; i += 1) {
            const r = this.records[i];
            if (r.alive && clock >= r.tr) n += 1;
        }
        return n;
    }

    /**
     * Send a lantern: its light leaves `from` (a world point) at `clock` and lands on the water at
     * (x, z). `windAzimuth` (radians, 0 = straight away from the eye, + to its right) is where the
     * wind will carry it once it lifts.
     */
    send(clock, from, x, z, rgb, { hard = false, windAzimuth = 0 } = {}) {
        let slot = null;
        for (let i = 0; i < this.records.length && !slot; i += 1) {
            if (!this.records[i].alive) slot = this.records[i];
        }
        if (!slot) {
            // The pool is full: the one that has been gone longest makes room.
            let oldest = null;
            for (let i = 0; i < this.records.length; i += 1) {
                const r = this.records[i];
                const age = r.tr < Infinity ? clock - r.tr + 1e6 : clock - r.t0;
                if (!oldest || age > oldest.age) oldest = { r, age };
            }
            slot = oldest.r;
        }
        const r = slot;
        const { rand } = this;
        this.serial += 1;
        r.alive = true;
        r.id = this.serial;
        r.fromX = from.x;
        r.fromY = from.y;
        r.fromZ = from.z;
        r.sent = clock;
        r.x0 = x;
        r.z0 = z;
        r.t0 = clock + MOTE_SECONDS;
        r.rgb[0] = rgb[0];
        r.rgb[1] = rgb[1];
        r.rgb[2] = rgb[2];
        r.seed = rand();
        r.hard = hard;
        r.tr = Infinity;
        r.spiral = 0;
        // It drifts out from the eye, a little to one side.
        const len = Math.hypot(x, z) || 1;
        const side = (rand() - 0.5) * 0.6;
        r.drift[0] = (x / len + side * (-z / len)) * WATER_DRIFT;
        r.drift[1] = (z / len + side * (x / len)) * WATER_DRIFT;
        const wind = windAzimuth + (rand() - 0.5) * 0.22;
        r.windX = Math.sin(wind);
        r.windZ = -Math.cos(wind);
        // Too many afloat: the oldest one sets out to make room.
        const afloat = this.floating(r.t0) + 1;
        const room = Math.ceil(this.capacity * 0.55);
        if (afloat > room) this.lift(clock, 1);
        return r;
    }

    /**
     * Lift `count` lanterns off the water, the oldest first, `gap` seconds apart, starting at
     * `clock`. `spiral` (radians a second) turns them round where they rose (a T-spin).
     * Returns how many went.
     */
    lift(clock, count, { gap = 0.28, spiral = 0, out = null } = {}) {
        const afloat = [];
        for (let i = 0; i < this.records.length; i += 1) {
            const r = this.records[i];
            if (r.alive && r.tr === Infinity && r.t0 <= clock + 0.05) afloat.push(r);
        }
        afloat.sort((a, b) => a.t0 - b.t0);
        const n = Math.min(count, afloat.length);
        for (let i = 0; i < n; i += 1) {
            const r = afloat[i];
            const at = clock + i * gap;
            const p = this.waterPoint(r, at);
            r.tr = at;
            r.xr = p.x;
            r.yr = p.y;
            r.zr = p.z;
            r.spiral = spiral * (r.seed < 0.5 ? -1 : 1);
            out?.push(r);
        }
        return n;
    }

    /** Where a floating lantern is at `clock` (on the swell). */
    waterPoint(r, clock, out = { x: 0, y: 0, z: 0 }) {
        const s = Math.max(0, clock - r.t0);
        out.x = r.x0 + r.drift[0] * s;
        out.z = r.z0 + r.drift[1] * s;
        out.y = seaHeight(out.x, out.z, clock);
        return out;
    }

    /**
     * A lantern's state at `clock`:
     *   phase   'mote' (its light in flight), 'water', 'air', or null (gone / not yet)
     *   x, y, z the lantern's foot (the float on the water; the open mouth in the air)
     *   tiltX, tiltZ   the slope it leans on (water) or its sway (air)
     *   glow    how bright its flame burns (0..1.3: lighting, flickering, guttering far away)
     *   scale   0..1 as it appears
     *   mote    (phase 'mote') how far the light has come, 0..1
     */
    stateOf(r, clock, out = {}) {
        out.phase = null;
        if (!r.alive || clock < r.sent) return out;
        const flicker = 0.9 + 0.07 * Math.sin(clock * 9.1 + r.seed * 40) + 0.05 * Math.sin(clock * 15.3 + r.seed * 17);
        if (clock < r.t0) {
            out.phase = 'mote';
            out.mote = (clock - r.sent) / MOTE_SECONDS;
            return out;
        }
        if (clock < r.tr) {
            const s = clock - r.t0;
            if (s > WATER_LIFE + 30) return out;
            this.waterPoint(r, clock, out);
            seaSlope(out.x, out.z, clock, this._slope);
            out.phase = 'water';
            out.tiltX = this._slope.x;
            out.tiltZ = this._slope.z;
            out.scale = 0.35 + 0.65 * smooth(0, 0.45, s);
            // It lights with a flare as the light reaches it, then settles to its flame.
            out.glow = flicker * (1 + 0.9 * Math.exp(-s * 3.2)) * (1 - smooth(WATER_LIFE, WATER_LIFE + 30, s));
            return out;
        }
        const s = clock - r.tr;
        if (s > AIR_LIFE) return out;
        const up = RISE_SPEED * lagged(s, RISE_LAG);
        const away = WIND_SPEED * lagged(s, WIND_LAG);
        const sway = 0.35 * Math.sin(s * 0.7 + r.seed * 9) * smooth(0, 6, s);
        // A T-spin's lanterns go up turning round where they rose, then the wind takes them.
        const turn = r.spiral * Math.min(s, 9);
        const radius = r.spiral ? 1.4 * smooth(0, 1.5, s) * (1 - smooth(6, 12, s)) : 0;
        out.phase = 'air';
        out.x = r.xr + r.windX * away - r.windZ * sway + Math.cos(turn + r.seed * 6) * radius;
        out.z = r.zr + r.windZ * away + r.windX * sway + Math.sin(turn + r.seed * 6) * radius;
        out.y = r.yr + up;
        out.tiltX = 0.05 * Math.sin(s * 1.1 + r.seed * 5);
        out.tiltZ = 0.05 * Math.cos(s * 0.9 + r.seed * 3);
        out.scale = 1;
        // It flares as it lifts; the flame gutters as it goes, and goes out at the horizon.
        out.glow = flicker * (1.05 - 0.25 * smooth(0, AIR_LIFE, s) + 0.75 * Math.exp(-s * 0.9))
            * (1 - smooth(AIR_LIFE - 25, AIR_LIFE, s));
        return out;
    }

    /** Free the lanterns that are gone. */
    sweep(clock) {
        for (let i = 0; i < this.records.length; i += 1) {
            const r = this.records[i];
            if (!r.alive) continue;
            const gone = r.tr < Infinity ? clock - r.tr > AIR_LIFE : clock - r.t0 > WATER_LIFE + 30;
            if (gone) r.alive = false;
        }
    }
}

/** A point on the light's arc from the card's edge (`from`) to the water (`to`), s in 0..1. */
export function moteAt(from, to, s, out = { x: 0, y: 0, z: 0 }) {
    const t = clamp01(s);
    const e = t * t * (3 - 2 * t);
    const lift = 1.4 + 0.08 * Math.hypot(to.x - from.x, to.z - from.z);
    const mx = (from.x + to.x) / 2;
    const my = Math.max(from.y, to.y) + lift;
    const mz = (from.z + to.z) / 2;
    const a = (1 - e) * (1 - e);
    const b = 2 * (1 - e) * e;
    const c = e * e;
    out.x = a * from.x + b * mx + c * to.x;
    out.y = a * from.y + b * my + c * to.y;
    out.z = a * from.z + b * mz + c * to.z;
    return out;
}

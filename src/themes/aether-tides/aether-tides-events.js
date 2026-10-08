/**
 * Aether Tides — the fluid's event table (CPU only, three-free).
 *
 * Nothing is created when gameplay happens: an event writes numbers into a preallocated slot, and
 * the solver's passes and the picture's shaders evaluate every slot in closed form from the
 * simulation clock. The whole table travels as ONE array of vec4 rows (one uniform buffer):
 *
 *   splat  r0 (ax, ay, bx, by)        from → to (tide space); it moves a → b over its life
 *          r1 (t0, duration, radius, kind)
 *          r2 (r, g, b, dust)         what it pours, per second
 *          r3 (fx, fy, heat, swirl)   the push it gives, per second; heat; a twist round itself
 *          r4 (bend, ease, 0, 0)      how far its path bows sideways (a fraction of its length),
 *                                     and whether it eases in and out (1) or runs evenly (0)
 *   ring   r0 (cx, cy, t0, reach)     a blast front: radius = reach · (1 − e^(−age/τ))
 *          r1 (push, width, heat, rough)
 *   well   r0 (cx, cy, flow, radius)  flow < 0 draws the gas in, flow > 0 wells it up
 *          r1 (swirl, drain, heat, swirlRadius)
 *   star   r0 (x, y, born, dies)      a star the board lit; it goes nova at `dies`
 *          r1 (r, g, b, flux)
 *          r2 (fromX, fromY, left, bend)  its spark leaves the board at `left` and arrives at `born`
 *   gyre   r0 (cx, cy, strength, radius)
 *
 * Splats and rings are packed live-first each step so the shaders loop only over what is in
 * flight; wells, stars and gyres keep their slots (their indices are addresses).
 */

import {
    EVENT_ROWS,
    GYRE_SLOTS,
    NOVA_LIFE,
    RING_LIFE,
    RING_ROWS,
    RING_SLOTS,
    ROW_GYRE,
    ROW_RING,
    ROW_SPLAT,
    ROW_STAR,
    ROW_WELL,
    SPLAT_ROUND,
    SPLAT_ROWS,
    SPLAT_SLOTS,
    STAR_ROWS,
    STAR_SLOTS,
    WELL_ROWS,
    WELL_SLOTS,
} from './aether-tides-core.js';

const NEVER = -1e6;
const FOREVER = 1e9;

function createSplat() {
    return {
        ax: 0,
        ay: 0,
        bx: 0,
        by: 0,
        t0: NEVER,
        duration: 0,
        radius: 0.05,
        kind: SPLAT_ROUND,
        r: 0,
        g: 0,
        b: 0,
        dust: 0,
        fx: 0,
        fy: 0,
        heat: 0,
        swirl: 0,
        bend: 0,
        ease: 0,
    };
}

function createRing() {
    return {
        x: 0, y: 0, t0: NEVER, reach: 1, push: 0, width: 0.06, heat: 0, rough: 0,
    };
}

function createWell() {
    return {
        x: 0, y: 0, flow: 0, radius: 0.1, swirl: 0, drain: 0, heat: 0, swirlRadius: 0.3,
    };
}

function createStar() {
    return {
        x: 0, y: 0, born: NEVER, dies: NEVER, r: 0, g: 0, b: 0, flux: 0, fromX: 0, fromY: 0, left: NEVER, bend: 0,
    };
}

function createGyre() {
    return {
        x: 0, y: 0, strength: 0, radius: 1,
    };
}

const SPLAT_KEYS = Object.keys(createSplat());
const RING_KEYS = Object.keys(createRing());
const WELL_KEYS = Object.keys(createWell());
const GYRE_KEYS = Object.keys(createGyre());

function assignKnown(target, keys, spec) {
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const value = spec[key];
        if (Number.isFinite(value)) target[key] = value;
    }
}

export class TideEvents {
    constructor() {
        /** EVENT_ROWS × 4 floats, rewritten by pack(). */
        this.data = new Float32Array(EVENT_ROWS * 4);
        this.splats = Array.from({ length: SPLAT_SLOTS }, createSplat);
        this.rings = Array.from({ length: RING_SLOTS }, createRing);
        this.wells = Array.from({ length: WELL_SLOTS }, createWell);
        this.stars = Array.from({ length: STAR_SLOTS }, createStar);
        this.gyres = Array.from({ length: GYRE_SLOTS }, createGyre);
        /** Rows the shaders loop over, set by pack(). */
        this.splatCount = 0;
        this.ringCount = 0;
        /** Events that found every slot busy and took the oldest one. */
        this.stolen = 0;
        this.starCursor = 0;
        this.pack(0);
    }

    /** A moving source of dye, momentum and heat. Takes a spent slot, else the one nearest its end. */
    addSplat(spec, now) {
        const { splats } = this;
        let pick = -1;
        let soonest = Infinity;
        for (let i = 0; i < splats.length; i += 1) {
            const end = splats[i].t0 + splats[i].duration;
            if (end <= now) {
                pick = i;
                soonest = -Infinity;
                break;
            }
            if (end < soonest) {
                soonest = end;
                pick = i;
            }
        }
        if (soonest !== -Infinity) this.stolen += 1;
        const slot = splats[pick];
        Object.assign(slot, createSplat());
        assignKnown(slot, SPLAT_KEYS, spec);
        if (!Number.isFinite(spec.bx)) slot.bx = slot.ax;
        if (!Number.isFinite(spec.by)) slot.by = slot.ay;
        return slot;
    }

    /** A blast front. Takes a spent slot, else the oldest. */
    addRing(spec, now) {
        const { rings } = this;
        let pick = 0;
        let oldest = Infinity;
        for (let i = 0; i < rings.length; i += 1) {
            if (rings[i].t0 + RING_LIFE <= now) {
                pick = i;
                oldest = -Infinity;
                break;
            }
            if (rings[i].t0 < oldest) {
                oldest = rings[i].t0;
                pick = i;
            }
        }
        if (oldest !== -Infinity) this.stolen += 1;
        const slot = rings[pick];
        Object.assign(slot, createRing());
        assignKnown(slot, RING_KEYS, spec);
        return slot;
    }

    /** Wells keep their slots: the caller owns the index and rewrites it every frame. */
    setWell(index, spec) {
        const slot = this.wells[index];
        if (!slot) return null;
        assignKnown(slot, WELL_KEYS, spec);
        return slot;
    }

    setGyre(index, spec) {
        const slot = this.gyres[index];
        if (!slot) return null;
        assignKnown(slot, GYRE_KEYS, spec);
        return slot;
    }

    /**
     * Light a star. Slots are handed out round-robin, so the oldest star gives way first.
     * @returns {number} the star's slot
     */
    addStar(spec) {
        const index = this.starCursor;
        this.starCursor = (this.starCursor + 1) % STAR_SLOTS;
        const slot = this.stars[index];
        slot.x = spec.x;
        slot.y = spec.y;
        slot.born = spec.born;
        slot.dies = Number.isFinite(spec.dies) ? spec.dies : FOREVER;
        slot.r = spec.r;
        slot.g = spec.g;
        slot.b = spec.b;
        slot.flux = Number.isFinite(spec.flux) ? spec.flux : 1;
        slot.fromX = Number.isFinite(spec.fromX) ? spec.fromX : spec.x;
        slot.fromY = Number.isFinite(spec.fromY) ? spec.fromY : spec.y;
        slot.left = Number.isFinite(spec.left) ? spec.left : spec.born;
        slot.bend = Number.isFinite(spec.bend) ? spec.bend : 0;
        return index;
    }

    /** True while the star in this slot is burning (born, and its nova not yet over). */
    starAlive(index, now) {
        const s = this.stars[index];
        return s.born <= now && now < s.dies + NOVA_LIFE && s.born > NEVER;
    }

    /** Write the table. Splats and rings in flight at `now` (or still to start) come first. */
    pack(now) {
        const { data } = this;
        let row = ROW_SPLAT;
        let count = 0;
        for (let i = 0; i < this.splats.length; i += 1) {
            const s = this.splats[i];
            if (s.t0 + s.duration <= now || s.duration <= 0) continue;
            const o = (ROW_SPLAT + count * SPLAT_ROWS) * 4;
            data[o] = s.ax;
            data[o + 1] = s.ay;
            data[o + 2] = s.bx;
            data[o + 3] = s.by;
            data[o + 4] = s.t0;
            data[o + 5] = s.duration;
            data[o + 6] = s.radius;
            data[o + 7] = s.kind;
            data[o + 8] = s.r;
            data[o + 9] = s.g;
            data[o + 10] = s.b;
            data[o + 11] = s.dust;
            data[o + 12] = s.fx;
            data[o + 13] = s.fy;
            data[o + 14] = s.heat;
            data[o + 15] = s.swirl;
            data[o + 16] = s.bend;
            data[o + 17] = s.ease;
            data[o + 18] = 0;
            data[o + 19] = 0;
            count += 1;
        }
        this.splatCount = count;

        count = 0;
        for (let i = 0; i < this.rings.length; i += 1) {
            const r = this.rings[i];
            if (r.t0 + RING_LIFE <= now) continue;
            const o = (ROW_RING + count * RING_ROWS) * 4;
            data[o] = r.x;
            data[o + 1] = r.y;
            data[o + 2] = r.t0;
            data[o + 3] = r.reach;
            data[o + 4] = r.push;
            data[o + 5] = r.width;
            data[o + 6] = r.heat;
            data[o + 7] = r.rough;
            count += 1;
        }
        this.ringCount = count;

        row = ROW_WELL;
        for (let i = 0; i < this.wells.length; i += 1, row += WELL_ROWS) {
            const w = this.wells[i];
            const o = row * 4;
            data[o] = w.x;
            data[o + 1] = w.y;
            data[o + 2] = w.flow;
            data[o + 3] = w.radius;
            data[o + 4] = w.swirl;
            data[o + 5] = w.drain;
            data[o + 6] = w.heat;
            data[o + 7] = w.swirlRadius;
        }

        row = ROW_STAR;
        for (let i = 0; i < this.stars.length; i += 1, row += STAR_ROWS) {
            const s = this.stars[i];
            const o = row * 4;
            data[o] = s.x;
            data[o + 1] = s.y;
            data[o + 2] = s.born;
            data[o + 3] = s.dies;
            data[o + 4] = s.r;
            data[o + 5] = s.g;
            data[o + 6] = s.b;
            data[o + 7] = s.flux;
            data[o + 8] = s.fromX;
            data[o + 9] = s.fromY;
            data[o + 10] = s.left;
            data[o + 11] = s.bend;
        }

        row = ROW_GYRE;
        for (let i = 0; i < this.gyres.length; i += 1, row += 1) {
            const g = this.gyres[i];
            const o = row * 4;
            data[o] = g.x;
            data[o + 1] = g.y;
            data[o + 2] = g.strength;
            data[o + 3] = g.radius;
        }
        return data;
    }

    /** Forget everything in flight (a new run, a seek). */
    reset() {
        for (let i = 0; i < this.splats.length; i += 1) Object.assign(this.splats[i], createSplat());
        for (let i = 0; i < this.rings.length; i += 1) Object.assign(this.rings[i], createRing());
        for (let i = 0; i < this.wells.length; i += 1) Object.assign(this.wells[i], createWell());
        for (let i = 0; i < this.stars.length; i += 1) Object.assign(this.stars[i], createStar());
        this.starCursor = 0;
        this.stolen = 0;
        this.pack(0);
    }
}

/**
 * Sunbraid — pulses of light in the crust (three-free).
 *
 * The plain is a floor of salt tiles, and play is written on it: a lock lights a ripple of tiles
 * beside the board in the piece's colour, a clear sends a ring per line out from under the board
 * across the plain, a perfect clear sends great rings that split into the three suns' colours, and
 * the front that brings the colour back after four lines rides the floor as a ring of its own.
 *
 * A pulse is a ring on the ground: where it was struck, a radius that grows in closed form from
 * the moment it was struck (`radius + speed·age + gather·age²`), a width, a colour and how far that
 * colour splits into the suns' three, and whether it lights the tiles' faces or their ridges
 * alone (`ridge`). Its light rises over `rise` and falls away over the rest of its `life`. Nothing is allocated per pulse or per frame: a fixed table of slots, and `write()`
 * packs the live ones at the front of the rows the land's shader loops over (sunbraid-tsl.js
 * crustPulses). A pulse may be struck a little ahead of the clock (rings a beat apart); it joins
 * the rows when its time comes.
 */
import { clamp, smooth } from './sunbraid-core.js';

const blank = () => ({
    live: false,
    at: 0,
    x: 0,
    z: 0,
    radius: 0,
    speed: 0,
    gather: 0,
    width: 12,
    widen: 0,
    life: 1,
    rise: 0.06,
    r: 1,
    g: 1,
    b: 1,
    gain: 1,
    split: 0,
    ridge: false,
});

/** Where a pulse stands `age` seconds after it was struck: its radius, width and strength. */
export function pulseAt(pulse, age, out = { radius: 0, width: 1, level: 0 }) {
    const a = Math.max(0, age);
    out.radius = pulse.radius + pulse.speed * a + pulse.gather * a * a;
    out.width = Math.max(1, pulse.width + pulse.widen * a);
    const t = pulse.life > 0 ? a / pulse.life : 1;
    out.level = age < 0 || t >= 1
        ? 0
        : pulse.gain * smooth(0, Math.max(1e-3, pulse.rise), a) * (1 - smooth(0.45, 1, t));
    return out;
}

export class PulseTable {
    constructor(count) {
        this.slots = Array.from({ length: Math.max(1, count) }, blank);
        this._at = { radius: 0, width: 1, level: 0 };
        this.struck = 0;
        /** How many rows the last write() filled. */
        this.written = 0;
    }

    reset() {
        for (const slot of this.slots) slot.live = false;
    }

    /** How much of its life the slot has left at clock `time` (a slot not yet due has all of it). */
    left(slot, time) {
        if (!slot.live) return 0;
        return clamp(1 - (time - slot.at) / Math.max(1e-3, slot.life), 0, 1);
    }

    /**
     * Strike a pulse. `at` is the clock it starts on (it may lie a little ahead); `colour` is a
     * linear RGB triple. When every slot is busy the one with the least life left makes room.
     */
    add({
        at, x, z, radius = 0, speed = 60, gather = 0, width = 12, widen = 0, life = 1, rise = 0.06,
        colour = null, gain = 1, split = 0, ridge = false,
    }) {
        if (![at, x, z].every(Number.isFinite) || !(life > 0) || !(gain > 0)) return null;
        let slot = this.slots.find((s) => !s.live);
        if (!slot) slot = this.slots.reduce((a, c) => (this.left(a, at) <= this.left(c, at) ? a : c));
        slot.live = true;
        slot.at = at;
        slot.x = x;
        slot.z = z;
        slot.radius = radius;
        slot.speed = speed;
        slot.gather = gather;
        slot.width = width;
        slot.widen = widen;
        slot.life = life;
        slot.rise = rise;
        slot.r = colour ? colour[0] : 1;
        slot.g = colour ? colour[1] : 1;
        slot.b = colour ? colour[2] : 1;
        slot.gain = gain;
        slot.split = clamp(split, 0, 1);
        slot.ridge = ridge === true;
        this.struck += 1;
        return slot;
    }

    /**
     * Pack the pulses that show at clock `time` at the front of `rows` (two vectors a pulse:
     * x, z, radius, width; then r, g, b times its level, and its split). Spent pulses leave the
     * table. Returns how many were written.
     */
    write(rows, time) {
        let n = 0;
        const most = Math.floor(rows.length / 2);
        for (const slot of this.slots) {
            if (!slot.live) continue;
            const age = time - slot.at;
            if (age >= slot.life) {
                slot.live = false;
                continue;
            }
            if (age < 0 || n >= most) continue;
            const p = pulseAt(slot, age, this._at);
            if (!(p.level > 1e-4)) continue;
            // (A negative width: this pulse lights the crust's ridges alone.)
            rows[n * 2].set(slot.x, slot.z, p.radius, slot.ridge ? -p.width : p.width);
            rows[n * 2 + 1].set(slot.r * p.level, slot.g * p.level, slot.b * p.level, slot.split);
            n += 1;
        }
        // The rows past the live ones go back to rest (a row is never left holding a spent pulse).
        for (let k = n; k < this.written; k++) {
            rows[k * 2].set(0, 0, -1e5, 1);
            rows[k * 2 + 1].set(0, 0, 0, 0);
        }
        this.written = n;
        return n;
    }

    /** Pulses struck and not yet spent (those waiting for their time among them). */
    get live() {
        let n = 0;
        for (const slot of this.slots) if (slot.live) n += 1;
        return n;
    }
}

/**
 * EARTH CORE'S CLOCK — what the chapter is doing at a moment (masterpiece pass, 2026-11-17).
 *
 * The chapter moved (the lava drifted, the sparks rose) but nothing in it HAPPENED: the same orb
 * showed the same picture on every visit. This is the schedule of what happens, as pure functions
 * of one clock, so the lake, the shaft, the falls and the sparks all read the same moment and a
 * test can ask for any second of it without a renderer:
 *
 *   - a MOOD (`activity`): the lake banks down and rouses again over minutes, never on a loop the
 *     eye can learn (three incommensurate periods);
 *   - a DOME FOUNTAIN at one of the lake's vents, a different one each time;
 *   - a CRUST PLATE that breaks up over a reach of the lake and re-forms;
 *   - a ROCK FALL from the shaft's wall, glowing chunks dropping past the climb;
 *   - an EMBER GUST up the shaft;
 *   - a PULSE of the sea vent at the shaft's top (bubbles, the pillows' cracks).
 *
 * Every event lives in a slot of its own period; a hash of the slot's number picks where, when
 * inside the slot, how long and how strong. An event's envelope is zero at both ends of its slot,
 * so the place can change between slots without a pop: everything here is continuous in time.
 * Flashes are scaled where they are written (the chapter multiplies the light by `flashScale`).
 */

const TAU = Math.PI * 2;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth01 = (x) => {
    const t = clamp01(x);
    return t * t * (3 - (2 * t));
};

/** A hash of (slot number, salt) in [0, 1). Exact for the integers a session can reach. */
export function earthCoreSlotHash(slot, salt = 0) {
    const s = Math.sin((slot * 127.1) + (salt * 311.7) + 0.5) * 43758.5453123;
    return s - Math.floor(s);
}

/**
 * Where the lake's fountains stand, in the chapter group's local XZ (the lake plane is local
 * y = -10). Scored through the real camera at orb 1's station (tests/unit/helpers/
 * odyssey-camera-rig.js): all of them lie in the lower third of that frame, left of the orb card,
 * 40 to 115 u from the eye, so a fountain is seen whole and none stands under the UI.
 */
export const EARTH_CORE_FOUNTAIN_SITES = Object.freeze([
    Object.freeze({ x: 35, z: 19 }),
    Object.freeze({ x: 41, z: 48 }),
    Object.freeze({ x: 24, z: 7 }),
    Object.freeze({ x: 63, z: 27 }),
    Object.freeze({ x: 52, z: 78 }),
    Object.freeze({ x: 15, z: 40 }),
    Object.freeze({ x: 76, z: 58 }),
]);

/** Reaches of the lake whose crust breaks up (local XZ and radius). */
export const EARTH_CORE_PLATE_SITES = Object.freeze([
    Object.freeze({ x: 44, z: 30, r: 34 }),
    Object.freeze({ x: 20, z: 24, r: 26 }),
    Object.freeze({ x: 66, z: 62, r: 40 }),
    Object.freeze({ x: 30, z: 58, r: 30 }),
]);

export const EARTH_CORE_CLOCK = Object.freeze({
    /** Slot lengths, seconds. Pairwise incommensurate, so the events never fall into step. */
    FOUNTAIN_SLOT: 23,
    PLATE_SLOT: 67,
    ROCKFALL_SLOT: 37,
    GUST_SLOT: 29,
    VENT_SLOT: 17,
    /** The mood's three periods, seconds. */
    MOOD_PERIODS: Object.freeze([173, 71, 31]),
});

/**
 * The lake's mood, 0 (banked: darker, more crust, quiet) .. 1 (roused: brighter, open melt).
 * @param {number} t seconds
 * @returns {number}
 */
export function earthCoreActivity(t) {
    const [a, b, c] = EARTH_CORE_CLOCK.MOOD_PERIODS;
    const v = 0.5
        + (0.27 * Math.sin(((TAU * t) / a) + 0.7))
        + (0.17 * Math.sin(((TAU * t) / b) + 2.1))
        + (0.10 * Math.sin(((TAU * t) / c) + 4.4));
    return clamp01(v);
}

/** An envelope that rises over `attack`, holds, and falls over `release`; 0 outside [0, length]. */
function envelope(age, length, attack, release) {
    if (!(age > 0) || !(age < length)) return 0;
    return smooth01(age / attack) * smooth01((length - age) / release);
}

/**
 * One slotted event at time t.
 * @returns {{ slot: number, age: number, length: number, h: (salt: number) => number }}
 *   `age` is seconds since the event began (negative before it has), `length` how long it runs.
 */
function slotted(t, period, salt, minLength, maxLength) {
    const slot = Math.floor(t / period);
    const h = (n) => earthCoreSlotHash(slot, salt + n);
    const length = minLength + ((maxLength - minLength) * h(1));
    // The event starts somewhere in the slot's first part and always ends inside the slot.
    const start = (period - length) * 0.92 * h(2);
    return {
        slot, age: t - (slot * period) - start, length, h,
    };
}

/**
 * Everything the chapter is doing at `t`.
 * @param {number} t seconds on the chapter's clock
 * @param {object} [out] reused result object
 * @returns {{
 *   activity: number,
 *   fountain: { x: number, z: number, radius: number, power: number, slot: number, age: number,
 *     height: number, seed: number },
 *   plate: { x: number, z: number, radius: number, amount: number },
 *   rockfall: { azimuth: number, height: number, slot: number, age: number, length: number,
 *     power: number, seed: number },
 *   gust: number,
 *   vent: number,
 *   flare: number,
 * }}
 */
export function sampleEarthCoreClock(t, out = {}) {
    const time = Number.isFinite(t) ? Math.max(0, t) : 0;
    const C = EARTH_CORE_CLOCK;
    const activity = earthCoreActivity(time);
    const result = out;
    result.activity = activity;

    // ── The dome fountain: swells, plays (pulsing with the lake's own breath), and sinks. ──
    {
        const e = slotted(time, C.FOUNTAIN_SLOT, 11, 9, 15);
        const site = EARTH_CORE_FOUNTAIN_SITES[Math.floor(e.h(3) * EARTH_CORE_FOUNTAIN_SITES.length)
            % EARTH_CORE_FOUNTAIN_SITES.length];
        // Some slots are a great fountain, some only a dome that glows and settles; a roused lake
        // throws them higher (the mood as the slot opened: the fountain's size is its own for
        // the whole of its play, or its gobbets would change flight in mid-air).
        const size = 0.35 + (0.65 * e.h(4) * e.h(4))
            + (0.25 * earthCoreActivity(e.slot * C.FOUNTAIN_SLOT));
        const env = envelope(e.age, e.length, 1.6, 3.2);
        const play = 0.82 + (0.18 * Math.sin((e.age * 2.3) + (e.h(5) * TAU)));
        const f = result.fountain || (result.fountain = {});
        f.x = site.x;
        f.z = site.z;
        f.radius = 5.5 + (4.5 * size);
        f.height = 7 + (15 * size);
        f.power = clamp01(env * play * Math.min(1, size + 0.2));
        f.slot = e.slot;
        f.age = e.age;
        f.seed = e.h(6);
    }

    // ── The crust plate: cracks open over a reach of the lake, glows, and skins over again. ──
    {
        const e = slotted(time, C.PLATE_SLOT, 23, 38, 52);
        const site = EARTH_CORE_PLATE_SITES[Math.floor(e.h(3) * EARTH_CORE_PLATE_SITES.length)
            % EARTH_CORE_PLATE_SITES.length];
        const p = result.plate || (result.plate = {});
        p.x = site.x;
        p.z = site.z;
        p.radius = site.r;
        p.amount = envelope(e.age, e.length, 9, 24) * (0.6 + (0.4 * activity));
    }

    // ── The rock fall: a ledge of the shaft lets go; the chunks take ~6 s to reach the lake. ──
    {
        const e = slotted(time, C.ROCKFALL_SLOT, 37, 7, 9);
        const r = result.rockfall || (result.rockfall = {});
        // Round the shaft's far side: the cave mouth (|azimuth| < 74 deg) is open toward the lake,
        // and the climb's frame holds the wall's sides and top (|azimuth| 90..180 deg).
        r.azimuth = (Math.PI * (0.5 + (0.5 * e.h(3)))) * (e.h(4) < 0.5 ? 1 : -1);
        // 0..1: how high above the watcher the ledge is (the chapter turns it into a height).
        r.height = e.h(5);
        r.slot = e.slot;
        r.age = e.age;
        r.length = e.length;
        // About two slots in three: a wall that fell every 37 s would be a clock.
        r.power = e.h(6) < 0.68 ? envelope(e.age, e.length, 0.25, 2.5) : 0;
        r.seed = e.h(7);
    }

    // ── The ember gust: the updraft takes a breath. ──
    {
        const e = slotted(time, C.GUST_SLOT, 51, 5, 8);
        result.gust = envelope(e.age, e.length, 1.4, 3.0) * (0.45 + (0.55 * e.h(3)));
    }

    // ── The sea vent's pulse: a burst of gas up the throat. ──
    {
        const e = slotted(time, C.VENT_SLOT, 67, 4, 7);
        result.vent = envelope(e.age, e.length, 0.8, 3.0) * (0.4 + (0.6 * e.h(3)));
    }

    // The light the events throw up the shaft (the chapter scales it by flashScale): the fountain
    // most of all, the open melt of a broken plate a little.
    result.flare = clamp01((result.fountain.power * (0.55 + (0.45 * (result.fountain.height / 22))))
        + (result.plate.amount * 0.3));
    return result;
}

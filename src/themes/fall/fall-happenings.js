/**
 * Fall — the grove's happenings: what comes by, unasked.
 *
 * Beside the lights (fall-moods.js) and the airs (fall-airs.js) the grove has visitors. About every
 * three quarters of a minute one thing happens, a different one each time:
 *
 *   geese    a skein in a V, high over the grove, crossing the strip of sky above the board from
 *            one side of the picture to the other
 *   jays     a jay comes down out of a great crown, low past the perch on its side of the board
 *            and away, a second after it
 *   acorns   the near crown on one side drops a handful of acorns into the litter close to the
 *            eye: they fall, bounce, roll a little and lie
 *   shaft    a cloud crosses the sun and a gap in it sends one shaft wandering over the floor
 *
 * A function of the clock alone (no state): `fallHappeningAt(time)` says what is happening at any
 * second, so a seek and a session lived through agree. The order is dealt like cards: every kind
 * once, then a fresh shuffle, and never the same kind twice running across a deal. Each occurrence
 * carries a number of its own (`roll`) that the drawing reads its choices from (which way the skein
 * flies, which tree drops its acorns).
 *
 * Plain numbers and no three.js. What each looks like is fall-visitors.js.
 */

export const FALL_HAPPENINGS = Object.freeze(['geese', 'jays', 'acorns', 'shaft']);
/** Seconds from the start of one happening to the start of the next (less its own jitter). */
export const FALL_HAPPENING_SECONDS = 46;
/** Seconds of a session before the first one. */
export const FALL_HAPPENING_FIRST = 14;
/** How late in its slot a happening may start (s): the beat is not a metronome. */
export const FALL_HAPPENING_JITTER = 9;
/**
 * How long each kind lasts (s); all end before the next slot can begin. The skein's crossing is slow
 * (it is in the open sky above the board about a sixth of it); a pair of jays is over in a few seconds.
 */
export const FALL_HAPPENING_LENGTH = Object.freeze({
    geese: 34, jays: 5.5, acorns: 7, shaft: 24,
});

/** A number in [0, 1) from two integers. */
function hash01(a, b) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The order of one deal: every kind once (indices into FALL_HAPPENINGS), shuffled by the deal's number. */
function deal(number, seed) {
    const order = FALL_HAPPENINGS.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(hash01(seed ^ (number * 7919), i * 31 + 5) * (i + 1));
        const kept = order[i];
        order[i] = order[j];
        order[j] = kept;
    }
    return order;
}

/**
 * The kind of the `slot`-th happening of a session (0 the first).
 * @param {number} slot
 * @param {number} [seed]
 */
export function fallHappeningKind(slot, seed = 0) {
    const n = FALL_HAPPENINGS.length;
    const number = Math.floor(slot / n);
    const order = deal(number, seed);
    // Never the same kind twice running across two deals: the new deal's first gives way to its
    // second (which leaves every deal's last where the shuffle put it).
    if (number > 0 && order[0] === deal(number - 1, seed)[n - 1]) {
        const kept = order[0];
        order[0] = order[1];
        order[1] = kept;
    }
    return FALL_HAPPENINGS[order[slot % n]];
}

/** When the `slot`-th happening starts (seconds of the session). */
export function fallHappeningStart(slot, seed = 0) {
    return FALL_HAPPENING_FIRST + slot * FALL_HAPPENING_SECONDS + hash01(seed ^ 0x51ed, slot) * FALL_HAPPENING_JITTER;
}

/** Somewhere to put a happening: a place a caller keeps and fills again. */
export function createFallHappening() {
    return {
        kind: null, slot: -1, age: 0, length: 0, u: 0, roll: 0,
    };
}

/**
 * What is happening at `time` (seconds of the session). `out.kind` is null between happenings;
 * otherwise `age` is the seconds since it began, `length` how long it lasts, `u` its share run
 * (0..1) and `roll` the occurrence's own number in [0, 1).
 * @param {number} time
 * @param {number} [seed]
 * @param {ReturnType<typeof createFallHappening>} [out]
 */
export function fallHappeningAt(time, seed = 0, out = createFallHappening()) {
    /* eslint-disable no-param-reassign */
    out.kind = null;
    out.slot = -1;
    out.age = 0;
    out.length = 0;
    out.u = 0;
    out.roll = 0;
    if (!Number.isFinite(time) || time < FALL_HAPPENING_FIRST) return out;
    const slot = Math.floor((time - FALL_HAPPENING_FIRST) / FALL_HAPPENING_SECONDS);
    const start = fallHappeningStart(slot, seed);
    const kind = fallHappeningKind(slot, seed);
    const length = FALL_HAPPENING_LENGTH[kind];
    const age = time - start;
    if (age < 0 || age >= length) return out;
    out.kind = kind;
    out.slot = slot;
    out.age = age;
    out.length = length;
    out.u = age / length;
    out.roll = hash01(seed ^ 0x7011, slot);
    /* eslint-enable no-param-reassign */
    return out;
}

/**
 * One happening held for a capture or the playground: `kind` as if it had begun at `at` seconds.
 * @param {string} kind
 * @param {number} at
 * @param {number} time
 * @param {number} [roll]
 * @param {ReturnType<typeof createFallHappening>} [out]
 */
export function fallHappeningHeld(kind, at, time, roll = 0.37, out = createFallHappening()) {
    /* eslint-disable no-param-reassign */
    const length = FALL_HAPPENING_LENGTH[kind];
    const age = time - at;
    const live = Number.isFinite(length) && Number.isFinite(age) && age >= 0 && age < length;
    out.kind = live ? kind : null;
    out.slot = live ? 0 : -1;
    out.age = live ? age : 0;
    out.length = live ? length : 0;
    out.u = live ? age / length : 0;
    out.roll = live ? roll : 0;
    /* eslint-enable no-param-reassign */
    return out;
}

const bell = (u) => {
    const x = Math.max(0, Math.min(1, u));
    return Math.sin(Math.PI * x) ** 2;
};

/**
 * The wandering shaft at share `u` of its happening: where its axis meets the floor (x, z), its
 * radius (m), its strength, and how far the cloud dims the sun meanwhile. The cloud comes first and
 * goes last; the gap crosses the grove on the wind (toward +x) while it is over.
 * @param {number} u
 * @param {number} roll
 * @param {{ x: number, z: number, radius: number, strength: number, cloud: number }} [out]
 */
export function fallShaftAt(u, roll, out = {
    x: 0, z: 0, radius: 5, strength: 0, cloud: 0,
}) {
    /* eslint-disable no-param-reassign */
    const x = Math.max(0, Math.min(1, u));
    const gap = Math.max(0, Math.min(1, (x - 0.14) / 0.72));
    out.x = -26 + 54 * gap + (roll - 0.5) * 6;
    out.z = -3 + 6 * Math.sin(gap * Math.PI * 1.3 + roll * 6.283);
    out.radius = 5.2 + 1.4 * Math.sin(gap * Math.PI);
    // The cloud takes nearly half the sun; in the gap it is whole again, and a little more beside the shade.
    const shade = Math.min(1, bell(x) * 1.5);
    out.cloud = 0.46 * shade;
    out.strength = 1.15 * Math.min(1, bell(gap) * 1.6) * (shade > 0 ? 1 : 0);
    /* eslint-enable no-param-reassign */
    return out;
}

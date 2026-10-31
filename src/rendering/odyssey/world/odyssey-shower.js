/**
 * THE SHOWER (round three, 2026-10-31) — a line of rain under real clouds, and the bow in it.
 *
 * Olov, on a first cut that painted the rain cloud on the sky dome: "the rain cloud feels too
 * different compared to the other fluffy clouds, and when we transition into the next space
 * chapter it fades away, we do not move above it like the other clouds ... redesign the raincloud
 * and the rainbow ... like it is a part of this world." So nothing here is painted on the dome:
 *
 *   - THE CLOUD is a row of masses in the cloud field itself (the same sculptor and the same
 *     Witness paint as every other cloud, a touch heavier: the field material's storm term, keyed
 *     on a mass being over the shower line), standing just over the bow's crown, so the climb
 *     leaves it below like the rest.
 *   - THE RAIN is a volume along the line, from the sea up into the cloud base, and it is NOT
 *     drawn: it carries the bow, so the arc stands where the rain would be while the sky stays
 *     clear. (Visible rain was tried twice: flat strips of streaks, "dark noisy and bad", then soft
 *     columns under each mass, "it makes the sky too grey, I just want a beautiful rainbow".)
 *   - THE BOW is drawn IN the rain, at the true angle round the antisolar point, so it stands only
 *     where rain falls, is cut off by the cloud base above it, and from high on the climb its leg
 *     runs down through the rain below the eye — where a real one is.
 *
 * WHERE, measured on the real rail: opposite the sun (the bow's 42° circle stands round a point
 * 15° under the horizon, so near the horizon its legs are ~40° either side of the antisolar
 * bearing), so the rain is a LINE across that bearing, not a column: ~1350 u out from the
 * meadows' eye over the coastal strip and the first of the sea, reaching ~1300 u either side.
 * From the meadow (eye ~360 u) the bow then lands on rain from the horizon to ~24° up on both legs,
 * only its crown lost in the cloud base; from the climb (eye 650-1000 u) the right leg runs down
 * through the rain below.
 *
 * Three-free: the layout is unit-tested in Node.
 */
import { ODYSSEY_SEA_LEVEL } from './odyssey-world-height.js';

export const ODYSSEY_SHOWER = Object.freeze({
    /** The line's middle (world x, z) and its direction across the antisolar bearing (unit x, z). */
    centre: Object.freeze({ x: 1050, z: -890 }),
    across: Object.freeze([0.423, 0.906]),
    /** How far the rain reaches either side of the middle (u). */
    halfLength: 1300,
    /**
     * The cloud base (y), and how far into it the rain reaches (u). 1150 (was 960) so the clouds
     * stand just over the bow's crown from the meadows (27° up at ~1350 u) and the whole arc
     * stands under them.
     */
    base: 1150,
    tuck: 30,
    /** The storm masses over it: how many, their size (u). */
    masses: 4,
    massW: 880,
    massH: 440,
    /**
     * THE BOW'S RAIN (round three, last cut): one long, soft volume along the whole line, its
     * half-length past the line's ends (x halfLength) and its half-depth across it (u). It is not
     * drawn: it only carries the bow, so the arc is continuous and the sky stays clear. (Olov, on
     * visible rain veils: "It feels like it makes the sky to grey, I just want a beautiful rainbow".)
     */
    bowVolume: Object.freeze({ reach: 1.25, depth: 380 }),
});

const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
};

/** The point at `t` (-1..1) along the shower line. */
export function showerLineAt(t, spec = ODYSSEY_SHOWER) {
    return {
        x: spec.centre.x + (spec.across[0] * spec.halfLength * t),
        z: spec.centre.z + (spec.across[1] * spec.halfLength * t),
    };
}

/**
 * The rain cloud: storm masses for the cloud field, evenly along the line (a little staggered),
 * their bases at the shower's base.
 * @returns {object[]} cloud-field specs (role 'shower')
 */
export function showerCloudSpecs(spec = ODYSSEY_SHOWER) {
    const out = [];
    for (let i = 0; i < spec.masses; i += 1) {
        const t = ((i + 0.5) / spec.masses) * 2 - 1;
        const p = showerLineAt(t * 0.92, spec);
        const k = 0.88 + (hash(i + 3.1) * 0.24);
        out.push(Object.freeze({
            id: `R${i + 1}-shower`,
            role: 'shower',
            lod: 'near',
            x: Math.round(p.x + ((hash(i + 7.7) - 0.5) * 160)),
            base: spec.base,
            z: Math.round(p.z + ((hash(i + 9.3) - 0.5) * 160)),
            w: Math.round(spec.massW * k),
            h: Math.round(spec.massH * k),
            yaw: Math.atan2(spec.across[1], spec.across[0]) + ((hash(i + 1.9) - 0.5) * 0.5),
            seed: 1201.3 + (i * 17.7),
        }));
    }
    return out;
}

/**
 * Whether the line from `eye` along `dir` (unit) passes through the bow's rain: through the
 * volume's ellipse (sheared by any lean) between the sea and the cloud base. For the layout's test.
 */
export function rayMeetsShower(eye, dir, spec = ODYSSEY_SHOWER) {
    return [showerBowVolume(spec)].some((c) => {
        const H = c.top - c.bottom;
        // Sheared frame: the column's centre at height y is its top centre + lean * (top - y) / H.
        const ax = (eye.x - c.x) - ((c.leanX * (c.top - eye.y)) / H);
        const az = (eye.z - c.z) - ((c.leanZ * (c.top - eye.y)) / H);
        const bx = dir.x + ((c.leanX * dir.y) / H);
        const bz = dir.z + ((c.leanZ * dir.y) / H);
        const A = [((ax * c.cos) + (az * c.sin)) / c.rx, ((-ax * c.sin) + (az * c.cos)) / c.rz];
        const B = [((bx * c.cos) + (bz * c.sin)) / c.rx, ((-bx * c.sin) + (bz * c.cos)) / c.rz];
        const bb = (B[0] * B[0]) + (B[1] * B[1]);
        if (bb < 1e-12) return false;
        const ab = (A[0] * B[0]) + (A[1] * B[1]);
        const disc = (ab * ab) - (bb * (((A[0] * A[0]) + (A[1] * A[1])) - 1));
        if (disc <= 0) return false;
        const t = -ab / bb;
        if (t <= 0) return false;
        const y = eye.y + (dir.y * t);
        return y > c.bottom && y < spec.base;
    });
}

/**
 * The bow's rain: one volume along the whole shower line (see `bowVolume`), in the same shape the
 * columns use ({ x, z, top, bottom, rx, rz, cos, sin, leanX, leanZ, seed }), from the sea up into
 * the cloud base.
 */
export function showerBowVolume(spec = ODYSSEY_SHOWER) {
    const yaw = Math.atan2(spec.across[1], spec.across[0]);
    return {
        x: spec.centre.x,
        z: spec.centre.z,
        top: spec.base + spec.tuck,
        bottom: ODYSSEY_SEA_LEVEL - 6,
        rx: spec.halfLength * spec.bowVolume.reach,
        rz: spec.bowVolume.depth,
        cos: Math.cos(yaw),
        sin: Math.sin(yaw),
        leanX: 0,
        leanZ: 0,
        seed: 0.5,
    };
}

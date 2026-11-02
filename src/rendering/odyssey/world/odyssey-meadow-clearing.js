// @ts-check
/**
 * THE HORSES' MEADOW, KEPT OPEN (2026-11-02). The wild horses (composition/odyssey-horse-band.js)
 * graze and gallop on the grass east of the rail between the chapter-3 glade and the tarn. That
 * ground was a glade under scattered trees, and from the rail (60-170 m up, looking across) the
 * crowns in front hid the band. The forest scatter now leaves it open, the way it leaves the
 * tarn's meadow open (`ODYSSEY_TARN.clearing`): no tree in the core, a thinning, ragged treeline
 * at the rim (scattered edge trees), and a few lone trees left standing on the grass.
 *
 * The outline is a few overlapping ellipses whose edge is pushed in and out by a low noise, so it
 * reads as a meadow's edge, not a cut circle. Pure maths (no three.js): the scatter, the tests and
 * the probes all call the same function.
 */

export const ODYSSEY_MEADOW_CLEARING = Object.freeze({
    /** The clearing's lobes (world x, z and radii, u). */
    lobes: Object.freeze([
        // The open band the horses graze (both places) and canter back along.
        Object.freeze({
            x: -72, z: -328, rx: 92, rz: 34,
        }),
        // The south corridor and the copse the long run goes round.
        Object.freeze({
            x: -50, z: -400, rx: 92, rz: 46,
        }),
        // The rise between the band and the rail's view (the crowns that hid it from L15-L18).
        Object.freeze({
            x: -62, z: -284, rx: 58, rz: 32,
        }),
        // The long run's way up the east side of the copse.
        Object.freeze({
            x: 30, z: -362, rx: 22, rz: 38,
        }),
    ]),
    /** How far (share of the lobe radius) the ragged edge moves in and out. */
    ragged: 0.22,
    /** The noise's scale (u) for the ragged edge. */
    raggedCell: 46,
    /** Inside this normalized distance nothing stands but the lone trees; out to 1 the edge thins. */
    core: 0.72,
    /** The share of sites in the core that keep a lone tree. */
    lone: 0.035,
});

/** A smooth value noise in [0, 1] (its own lattice, deterministic). */
function valueNoise(u, v) {
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    let fu = u - iu;
    let fv = v - iv;
    fu = fu * fu * (3 - (2 * fu));
    fv = fv * fv * (3 - (2 * fv));
    const h = (a, b) => {
        const s = Math.sin((a * 127.1) + (b * 311.7)) * 43758.5453;
        return s - Math.floor(s);
    };
    const top = h(iu, iv) + ((h(iu + 1, iv) - h(iu, iv)) * fu);
    const bot = h(iu, iv + 1) + ((h(iu + 1, iv + 1) - h(iu, iv + 1)) * fu);
    return top + ((bot - top) * fv);
}

/**
 * Normalized distance into the clearing at (x, z), the ragged edge included: < 1 inside.
 * @param {number} x
 * @param {number} z
 */
export function odysseyMeadowClearingRn(x, z) {
    const C = ODYSSEY_MEADOW_CLEARING;
    let best = Infinity;
    for (let i = 0; i < C.lobes.length; i += 1) {
        const lb = C.lobes[i];
        const lx = (x - lb.x) / lb.rx;
        const lz = (z - lb.z) / lb.rz;
        best = Math.min(best, Math.sqrt((lx * lx) + (lz * lz)));
    }
    if (best > 1 + C.ragged) return best;
    const n = (valueNoise((x / C.raggedCell) + 7.3, (z / C.raggedCell) - 2.9) * 0.7)
        + (valueNoise((x / (C.raggedCell * 0.4)) - 11.1, (z / (C.raggedCell * 0.4)) + 5.7) * 0.3);
    return best + ((n - 0.5) * 2 * C.ragged);
}

/**
 * How open the meadow keeps the ground at (x, z): 1 in the core (no tree), falling to 0 across
 * the rim (the share of trees the edge removes), 0 outside.
 * @param {number} x
 * @param {number} z
 */
export function odysseyMeadowOpenness(x, z) {
    const C = ODYSSEY_MEADOW_CLEARING;
    const rn = odysseyMeadowClearingRn(x, z);
    if (rn >= 1) return 0;
    if (rn <= C.core) return 1;
    const t = (1 - rn) / (1 - C.core);
    return t * t * (3 - (2 * t));
}

/**
 * Forest — where the eagle owl sits, as plain numbers.
 *
 * It lives on dead limbs of the two elders: a long one out of the elder spruce toward the moon (its
 * home: from the eye it sits there beside the moon's lower limb, dark against the lit mist) and a
 * stout one below it, a broken stub out of the elder pine over the knoll, another below that and one
 * high in the pine's bare stretch. The limbs are grown into the trees by the trees' own generator
 * (scripts/blender/forest_night/owl_limbs.py) and placed in the world by
 * scripts/forest/pack-owl-limbs.mjs (forest-owl-limbs.js): a centreline with the height of the bark's
 * top along it, and the seats on it. A long limb has several seats, and the owl sidles between them.
 * Off the trees it sits on the fallen spruce, at either end of its ridge, and on the stump.
 *
 * No three.js here: the mind, the tests and the theme share it.
 */

import { FOREST_OWL_LIMB_DATA } from './forest-owl-limbs.js';

/** The eye (forest-plan.js FOREST_EYE): every perch faces it as well as its branch lets it. */
const EYE = Object.freeze({ x: 0, z: 13 });

/** Every limb the owl uses (grown into the elders; see forest-owl-limbs.js). */
export const FOREST_OWL_LIMBS = FOREST_OWL_LIMB_DATA;

/** A limb by id. */
export function forestOwlLimb(id) {
    return FOREST_OWL_LIMBS.find((limb) => limb.id === id);
}

/**
 * The limb at u (a share of its length, its stations equally spaced): the centre, the top of the bark,
 * the radius, and the way it runs there (radians about y: 0 runs toward +z).
 */
export function limbAt(limb, u, out = {}) {
    const { stations } = limb;
    const n = stations.length - 1;
    const f = Math.max(0, Math.min(1, u)) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const a = stations[i];
    const b = stations[i + 1];
    out.x = a[0] + (b[0] - a[0]) * t;
    out.y = a[1] + (b[1] - a[1]) * t;
    out.z = a[2] + (b[2] - a[2]) * t;
    out.top = a[3] + (b[3] - a[3]) * t;
    out.radius = a[4] + (b[4] - a[4]) * t;
    // The run over a few stations either side (one station's step is too short to trust).
    const lo = stations[Math.max(0, i - 2)];
    const hi = stations[Math.min(n, i + 3)];
    out.run = Math.atan2(hi[0] - lo[0], hi[2] - lo[2]);
    return out;
}

/** Of a branch's two crosswise headings, the one that faces the eye best. */
export function acrossFacing(x, z, run) {
    const toEye = Math.atan2(EYE.x - x, EYE.z - z);
    const a = run - Math.PI / 2;
    const b = run + Math.PI / 2;
    const off = (h) => Math.abs(Math.atan2(Math.sin(h - toEye), Math.cos(h - toEye)));
    return off(a) <= off(b) ? a : b;
}

const facingEye = (x, z) => Math.atan2(EYE.x - x, EYE.z - z);

/** A limb's length along its centreline, metres. */
export function limbLength(limb) {
    const { stations } = limb;
    let total = 0;
    for (let i = 1; i < stations.length; i += 1) {
        const a = stations[i - 1];
        const b = stations[i];
        total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return total;
}

function seat(limb, id, u) {
    const p = limbAt(limb, u);
    return Object.freeze({
        id,
        x: p.x,
        y: p.top,
        z: p.z,
        heading: acrossFacing(p.x, p.z, p.run),
        radius: p.radius,
        kind: 'branch',
        run: p.run,
        limb: limb.id,
        u,
        tree: limb.tree,
        // How far out from the trunk's bark it sits (a wing spread across the limb reaches about 0.75 m).
        clear: (u - limb.surface) * limbLength(limb),
    });
}

/**
 * Every perch. `x, y, z` is the top of the bark (or the stump's cut) under the owl's feet,
 * `heading` the way it faces (radians about y: 0 faces +z), `radius` the branch's (its toes close
 * round it; a flat top is a wide one), `kind` how it stands, `limb` and `u` where it is on a limb it
 * can sidle along, `clear` how far it is out from the trunk's bark, `run` the way its limb runs out
 * from the trunk. The log's ridge and the stump's cut are measured from forest-props.glb where
 * forest-understory.js lays them.
 */
export const FOREST_OWL_PERCHES = Object.freeze([
    ...FOREST_OWL_LIMBS.flatMap((limb) => limb.seats.map(([id, u]) => seat(limb, id, u))),
    Object.freeze({
        id: 'log', x: 11.285, y: 1.655, z: -13.785, heading: -0.45, radius: 0.12, kind: 'branch', run: 1.12,
    }),
    Object.freeze({
        id: 'logEnd', x: 9.934, y: 1.774, z: -14.457, heading: -0.45, radius: 0.12, kind: 'branch', run: 1.12,
    }),
    Object.freeze({
        id: 'stump', x: 15.51, y: 1.73, z: -11.26, heading: facingEye(15.51, -11.26), radius: 0.3, kind: 'top', run: 0,
    }),
]);

/** A perch by id (undefined when there is none). */
export function forestOwlPerch(id) {
    return FOREST_OWL_PERCHES.find((perch) => perch.id === id);
}

export const FOREST_OWL_HOME = forestOwlPerch('limb');

/** The other seats on the same limb as `perch` (the places it can sidle to), nearest first. */
export function forestOwlNeighbours(perch) {
    if (!perch?.limb) return [];
    return FOREST_OWL_PERCHES.filter((p) => p.limb === perch.limb && p !== perch)
        .sort((a, b) => Math.abs(a.u - perch.u) - Math.abs(b.u - perch.u));
}

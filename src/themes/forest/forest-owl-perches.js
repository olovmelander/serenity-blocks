/**
 * Forest — where the eagle owl sits, as plain numbers.
 *
 * Its home is a dead limb of its own on the elder spruce, reaching out of the trunk toward the moon:
 * from the eye the owl sits on it beside the moon's lower limb, dark against the lit mist. The limb's
 * line is a Catmull-Rom curve through `FOREST_OWL_LIMB.points` (the same curve the theme lays its mesh
 * on, `createLimbGeometry` in forest-owl.js), and a perch on it is the top of the limb at a place on
 * that curve. No three.js here: the mind, the tests and the theme share it.
 */

/** The eye (forest-plan.js FOREST_EYE): every perch faces it as well as its branch lets it. */
const EYE = Object.freeze({ x: 0, z: 13 });

/**
 * A dead limb out of a trunk: `trunk` its centre at the limb's height, `out` the way it leaves it,
 * `stations` [metres out, lift] along that way, `radius` at the trunk and the tip, `twigs` broken off it.
 */
function deadLimb(trunk, out, stations, radius, twigs) {
    const l = Math.hypot(...out);
    const d = out.map((c) => c / l);
    const along = ([sOut, lift]) => [trunk.x + d[0] * sOut, trunk.y + d[1] * sOut + lift, trunk.z + d[2] * sOut];
    return Object.freeze({
        points: Object.freeze(stations.map(along)), radius: Object.freeze(radius), twigs: Object.freeze(twigs),
    });
}

/**
 * The owl's limb on the elder spruce (its trunk measured from spruce-elder.glb at the elder's place):
 * its curve (world metres), its radius at the trunk and at the tip, and two broken twigs.
 */
export const FOREST_OWL_LIMB = deadLimb(
    { x: -5.344, y: 4.66, z: 5.6 },
    [0.955, -0.035, -0.285],
    [[0.15, -0.02], [0.6, 0.05], [1.1, 0.06], [1.6, -0.01], [2.05, -0.12]],
    [0.088, 0.022],
    [
        Object.freeze({
            at: 0.42, dir: [0.25, 0.9, -0.3], length: 0.34, radius: 0.019,
        }),
        Object.freeze({
            at: 0.8, dir: [0.45, -0.25, 0.65], length: 0.24, radius: 0.013,
        }),
    ],
);

/** A dead stub on the elder pine's bare trunk, out to the left of it over the knoll (pine-elder.glb). */
export const FOREST_OWL_PINE_LIMB = deadLimb(
    { x: 11.203, y: 5.7, z: -2.734 },
    [-0.99, -0.02, -0.125],
    [[0.1, -0.02], [0.5, 0.04], [0.95, 0.04], [1.35, -0.03], [1.7, -0.11]],
    [0.074, 0.02],
    [
        Object.freeze({
            at: 0.55, dir: [-0.2, 0.85, 0.35], length: 0.26, radius: 0.015,
        }),
    ],
);

/** Every limb the theme lays a mesh on. */
export const FOREST_OWL_LIMBS = Object.freeze([FOREST_OWL_LIMB, FOREST_OWL_PINE_LIMB]);

/** A point on a uniform Catmull-Rom curve through `points` (the ends held), at u in 0..1. */
export function catmullRom(points, u, out = [0, 0, 0]) {
    const n = points.length - 1;
    const f = Math.max(0, Math.min(1, u)) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    for (let k = 0; k < 3; k += 1) {
        out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
            + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
}

/** The limb's radius at u along it (it tapers evenly from the trunk to the tip). */
export function limbRadius(u, limb = FOREST_OWL_LIMB) {
    return limb.radius[0] + (limb.radius[1] - limb.radius[0]) * Math.max(0, Math.min(1, u));
}

/** The top of the limb at u, and the way the limb runs there (unit, horizontal). */
function limbPerch(u, limb = FOREST_OWL_LIMB) {
    const c = catmullRom(limb.points, u);
    const a = catmullRom(limb.points, Math.max(0, u - 0.02));
    const b = catmullRom(limb.points, Math.min(1, u + 0.02));
    const run = Math.atan2(b[0] - a[0], b[2] - a[2]);
    return {
        x: c[0], y: c[1] + limbRadius(u, limb), z: c[2], run, radius: limbRadius(u, limb),
    };
}

/** Of a branch's two crosswise headings, the one that faces the eye best. */
function acrossFacing(x, z, run) {
    const toEye = Math.atan2(EYE.x - x, EYE.z - z);
    const a = run - Math.PI / 2;
    const b = run + Math.PI / 2;
    const off = (h) => Math.abs(Math.atan2(Math.sin(h - toEye), Math.cos(h - toEye)));
    return off(a) <= off(b) ? a : b;
}

const facingEye = (x, z) => Math.atan2(EYE.x - x, EYE.z - z);

const onLimb = (id, limb, u) => {
    const p = limbPerch(u, limb);
    return Object.freeze({
        id, ...p, heading: acrossFacing(p.x, p.z, p.run), kind: 'branch',
    });
};

/**
 * Every perch. `x, y, z` is the top of the branch (or the stump) under the owl's feet,
 * `heading` the way it faces (radians about y: 0 faces +z), `radius` the branch's (its toes close
 * round it; a flat top is a wide one), `kind` how it stands. The log's ridge and the stump's cut are
 * measured from forest-props.glb where forest-understory.js lays them.
 */
export const FOREST_OWL_PERCHES = Object.freeze([
    onLimb('limb', FOREST_OWL_LIMB, 0.62),
    onLimb('pine', FOREST_OWL_PINE_LIMB, 0.6),
    Object.freeze({
        id: 'log', x: 11.285, y: 1.655, z: -13.785, heading: -0.45, radius: 0.12, kind: 'branch', run: 1.12,
    }),
    Object.freeze({
        id: 'stump', x: 15.51, y: 1.73, z: -11.26, heading: facingEye(15.51, -11.26), radius: 0.3, kind: 'top', run: 0,
    }),
]);

export const FOREST_OWL_HOME = FOREST_OWL_PERCHES[0];

/** A perch by id (undefined when there is none). */
export function forestOwlPerch(id) {
    return FOREST_OWL_PERCHES.find((perch) => perch.id === id);
}

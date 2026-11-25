/**
 * Fall — the limbs the squirrel runs on, and the flat places it sits on.
 *
 * Besides the two great trunks (fall-squirrel-stage.js) the squirrel has limbs: close to the eye a
 * windfall with two dead limbs standing up from it, and a broken stump with a dead bough leaning
 * over it (fall-composition.js places them; scripts/blender/fall_grove/perches.py grows them); and
 * the one bough of the great trees the eye sees past their leaves, the oak's rising one. A limb is known
 * here as the bark is meshed round it: its centre line and radius, written from the same seeded
 * recipes the GLBs were grown from (assets/squirrel-perches.json), so a squirrel on a bough stands on
 * the bark the eye sees.
 *
 * A place on a limb is (metres along it, angle round it), as a place on a trunk is (height, angle),
 * and it gives the same frame: the point the paws stand on, the outward normal, the way along the
 * limb (its `up`) and the way round it. The angle is measured from the limb's top (a lying limb) or
 * from the side that faces the eye (a standing one). A flat place (a `pad`: the stump's top, the
 * snapped end of a dead limb) is part of the floor: the floor's height is the pad's there.
 *
 * The boughs of the great trees move a little in the wind and these do not: the squirrel keeps to
 * their inner, thick half, where the bark moves a centimetre or two in a gale.
 *
 * Three-free: plain arrays in and out.
 */
import perches from './assets/squirrel-perches.json';
import { cross, normalize } from './fall-squirrel-stage.js';

/** Which great tree's side of the grove each perch asset belongs to (the squirrel's two homes). */
export const PERCH_HOMES = Object.freeze({
    'maple-hero': 'maple', 'oak-hero': 'oak', 'old-windfall': 'oak', 'old-stump': 'maple',
});
/** The short name each asset's limbs go by: `<tree>.<limb>`. */
export const PERCH_NAMES = Object.freeze({
    'maple-hero': 'maple', 'oak-hero': 'oak', 'old-windfall': 'windfall', 'old-stump': 'stump',
});
/**
 * The part of a limb the game's frame holds, where it is not all of it (metres along it): the
 * windfall's root end lies out of the frame to the right.
 */
export const LIMB_SPANS = Object.freeze({ 'windfall.trunk': Object.freeze({ low: 3.25 }) });
/** A snapped end this far above the floor (metres) is a perch; one lying on it is not. */
const TIP_CLEAR = 0.9;
/** How near its ends a limb is walked (metres): clear of the junction, and of the thin or snapped end. */
const LIMB_MARGIN = Object.freeze({ low: 0.3, high: 0.22 });

const catmull = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
    + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

/**
 * One limb as a surface: a tube round its centre line.
 */
export class LimbSurface {
    /**
     * @param {object} o
     * @param {string} o.name
     * @param {number[][]} o.rows   [x, y, z, radius] along the centre line, in the world
     * @param {string} o.home       the great tree whose side of the grove it is on
     * @param {number[]} o.eye      where the game's eye stands
     * @param {boolean} [o.dead]    a dead limb with a snapped end (it carries a pad on its tip)
     */
    constructor({
        name, rows, home, eye, dead = false,
    }) {
        this.name = name;
        this.home = home;
        this.dead = dead;
        this.rows = rows;
        const n = rows.length;
        this.arc = new Float64Array(n);
        for (let i = 1; i < n; i++) {
            this.arc[i] = this.arc[i - 1] + Math.hypot(
                rows[i][0] - rows[i - 1][0],
                rows[i][1] - rows[i - 1][1],
                rows[i][2] - rows[i - 1][2],
            );
        }
        this.length = this.arc[n - 1];
        const span = LIMB_SPANS[name] || {};
        this.low = Math.max(span.low ?? 0, Math.min(LIMB_MARGIN.low, this.length * 0.2));
        this.high = Math.min(span.high ?? Infinity, this.length - Math.min(LIMB_MARGIN.high, this.length * 0.15));
        // A standing limb is gone round like a trunk (its angle from the side that faces the eye); a
        // lying one is walked along its top.
        const rise = (rows[n - 1][1] - rows[0][1]) / Math.max(this.length, 1e-6);
        this.standing = Math.abs(rise) > 0.72;
        const mid = rows[Math.floor(n / 2)];
        this.reference = this.standing
            ? normalize([eye[0] - mid[0], 0, eye[2] - mid[2]])
            : [0, 1, 0];
        this.scratch = {
            point: [0, 0, 0], normal: [0, 1, 0], up: [0, 0, 1], side: [1, 0, 0],
        };
    }

    /** The centre line and radius `s` metres along: {p, r} (Catmull-Rom between the rows). */
    sample(s, out = { p: [0, 0, 0], r: 0 }) {
        const { rows, arc } = this;
        const n = rows.length;
        const at = Math.max(0, Math.min(this.length, s));
        let k = 0;
        while (k < n - 2 && arc[k + 1] < at) k++;
        const span = arc[k + 1] - arc[k];
        const t = span > 1e-9 ? (at - arc[k]) / span : 0;
        const row = (i) => rows[Math.max(0, Math.min(n - 1, i))];
        const a = row(k - 1);
        const b = row(k);
        const c = row(k + 1);
        const d = row(k + 2);
        for (let i = 0; i < 3; i++) out.p[i] = catmull(a[i], b[i], c[i], d[i], t);
        // eslint-disable-next-line no-param-reassign
        out.r = Math.max(0.01, catmull(a[3], b[3], c[3], d[3], t));
        // Past either end the line goes straight on.
        if (s !== at) {
            const e = s < 0 ? [rows[0], rows[1]] : [rows[n - 2], rows[n - 1]];
            const dir = normalize([e[1][0] - e[0][0], e[1][1] - e[0][1], e[1][2] - e[0][2]]);
            for (let i = 0; i < 3; i++) out.p[i] += dir[i] * (s - at);
        }
        return out;
    }

    /** The way along the limb at `s` (taken over about the squirrel's own length). */
    tangent(s) {
        const h = 0.14;
        const a = this.sample(Math.max(0, s - h));
        const b = this.sample(Math.min(this.length, s + h));
        return normalize([b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]]);
    }

    /** The bark's radius `s` metres along (the angle is not used: a limb is round). */
    radius(s) {
        return this.sample(s).r;
    }

    /** The frame at (s, angle): the point on the bark, its normal, the way along and the way round. */
    frame(s, angle, out = this.scratch) {
        const clamped = Math.max(this.low, Math.min(this.high, s));
        const { p, r } = this.sample(clamped);
        const t = this.tangent(clamped);
        const { reference } = this;
        const d = reference[0] * t[0] + reference[1] * t[1] + reference[2] * t[2];
        const top = normalize([reference[0] - t[0] * d, reference[1] - t[1] * d, reference[2] - t[2] * d]);
        // (normal = up x side: the angle runs from the top toward top x tangent.)
        const round = cross(top, t);
        const c = Math.cos(angle);
        const sn = Math.sin(angle);
        for (let i = 0; i < 3; i++) {
            out.normal[i] = top[i] * c + round[i] * sn;
            out.side[i] = -top[i] * sn + round[i] * c;
            out.up[i] = t[i];
            out.point[i] = p[i] + out.normal[i] * r + t[i] * (s - clamped);
        }
        return out;
    }

    /** The snapped end of a dead limb: its middle and half-width. */
    tip() {
        const { rows } = this;
        const end = rows[rows.length - 1];
        // (The last rows are the rounded cap: the limb's own width is a little before them.)
        const before = rows[Math.max(0, rows.length - 8)];
        return { centre: [end[0], end[1], end[2]], radius: before[3] };
    }
}

/**
 * Every limb and pad of the grove's perches, in the world.
 * @param {object} o
 * @param {Array<{asset:string,x:number,z:number,yaw:number,scale:number}>} o.placements  the hand-placed trees
 * @param {(x: number, z: number) => number} o.groundHeight
 * @param {number[]} o.eye
 * @param {object} [o.data]  the perches' document (assets/squirrel-perches.json)
 * @returns {{ limbs: Record<string, LimbSurface>, pads: Array<{name:string,home:string,centre:number[],radius:number}> }}
 */
export function createPerches({
    placements, groundHeight, eye, data = perches,
}) {
    const limbs = {};
    const pads = [];
    for (const tree of placements) {
        const entry = data.assets?.[tree.asset];
        const short = PERCH_NAMES[tree.asset];
        if (!entry || !short) continue;
        const scale = tree.scale || 1;
        const y0 = groundHeight(tree.x, tree.z);
        const c = Math.cos(tree.yaw || 0);
        const s = Math.sin(tree.yaw || 0);
        const place = (x, y, z) => [
            tree.x + (x * c + z * s) * scale, y0 + y * scale, tree.z + (-x * s + z * c) * scale,
        ];
        const home = PERCH_HOMES[tree.asset];
        const dead = tree.asset.startsWith('old-');
        for (const [name, rows] of Object.entries(entry.limbs || {})) {
            const world = rows.map(([x, y, z, r]) => [...place(x, y, z), r * scale]);
            const limb = new LimbSurface({
                name: `${short}.${name}`, rows: world, home, eye, dead,
            });
            limbs[limb.name] = limb;
            // The snapped end of a dead limb that stands clear of the floor is a place to sit.
            const tip = dead ? limb.tip() : null;
            if (tip && tip.centre[1] - groundHeight(tip.centre[0], tip.centre[2]) > TIP_CLEAR) {
                pads.push({
                    name: `${limb.name}.tip`,
                    home,
                    centre: tip.centre,
                    radius: Math.max(0.1, tip.radius),
                    limb: limb.name,
                });
            }
        }
        for (const pad of entry.pads || []) {
            pads.push({
                name: `${short}.${pad.name}`,
                home,
                centre: place(pad.centre[0], pad.centre[1], pad.centre[2]),
                radius: pad.radius * scale,
            });
        }
    }
    return { limbs, pads };
}

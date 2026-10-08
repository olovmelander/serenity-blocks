/**
 * Halcyon Apex — the sanctuary's plan (CPU only, three-free, seeded and deterministic).
 *
 * Everything built of stone is listed here as flat-shaded triangles with their own occlusion:
 * the terraced pyramid, its stair, the heart gate, the obelisks, the causeway and the ring of
 * standing stones. So are the ley lines inlaid in that stone (strips that know how far along
 * their line they lie) and every crystal (where it floats, which line it is on, when a chain of
 * clears lifts it).
 *
 * Two frames are used. The SITE frame is the pyramid's (x′ right, z′ out along the causeway;
 * see halcyon-apex-core.js). The DIAL frame is the stone ring's own: its centre at the origin,
 * +z toward the viewer; the world places it under the Halcyon.
 */

import {
    APEX_Y,
    LEY_A,
    LEY_B,
    PYRAMID_TOP,
    SITE,
    STAIR,
    TAU,
    leyAAtDeck,
    leyBAtStone,
    mulberry32,
    stairPoint,
    tierHalf,
} from './halcyon-apex-core.js';

/** Stone kinds (the material tints and patterns by these). */
export const STONE = Object.freeze({
    wall: 0, paving: 1, trim: 2, gold: 3, footing: 4, monolith: 5,
});

/** Crystal kinds. */
export const GEM = Object.freeze({
    shard: 0, apex: 1, halcyon: 2, dial: 3, obelisk: 4, apexOrbit: 5, halcyonOrbit: 6,
});

/** How far (metres) a surface looks for what shades it, and how dark a corner gets. */
const AO_REACH = 7.5;
const AO_FLOOR = 0.3;
/** How far a ley strip floats over the stone it is inlaid in. */
const LEY_PROUD = 0.07;

const frameAt = (ox, oz, angle) => ({
    ox, oz, ax: [Math.cos(angle), -Math.sin(angle)], az: [Math.sin(angle), Math.cos(angle)],
});

/** Collects boxes and strips, then emits flat-shaded triangles with baked occlusion. */
class StoneBuilder {
    constructor() {
        this.quads = [];
        this.occluders = [];
        this.id = 0;
    }

    /** A local point of `frame` in the builder's space. */
    static place(frame, x, y, z) {
        return [frame.ox + x * frame.ax[0] + z * frame.az[0], y, frame.oz + x * frame.ax[1] + z * frame.az[1]];
    }

    /**
     * A six-sided solid from eight local points: the bottom four (front-left, front-right,
     * back-right, back-left; front = +z) and the top four in the same order.
     * `faces` picks from f(ront) r(ight) b(ack) l(eft) t(op); `hole` = [hx, hz] leaves the middle
     * of the top face open (it is covered by what stands on it).
     */
    hexa(frame, pts, {
        kind = STONE.wall, cell = 6, faces = 'frblt', hole = null, occlude = true, cellV = null,
    } = {}) {
        const id = ++this.id;
        const w = pts.map((p) => StoneBuilder.place(frame, p[0], p[1], p[2]));
        const sides = {
            f: [0, 1, 5, 4], r: [1, 2, 6, 5], b: [2, 3, 7, 6], l: [3, 0, 4, 7],
        };
        Object.keys(sides).forEach((key) => {
            if (!faces.includes(key)) return;
            const [a, b, c, d] = sides[key];
            this.quads.push({
                id, kind, cell, cellV: cellV ?? Math.min(cell, 3), corners: [w[a], w[b], w[c], w[d]],
            });
        });
        if (faces.includes('t')) {
            const topKind = kind === STONE.wall ? STONE.paving : kind;
            if (hole) {
                // Four strips round the opening.
                const x0 = pts[4][0];
                const x1 = pts[5][0];
                const z0 = pts[7][2];
                const z1 = pts[4][2];
                const y = pts[4][1];
                const [hx, hz] = hole;
                const cx = (x0 + x1) / 2;
                const cz = (z0 + z1) / 2;
                const strip = (ax, az, bx, bz) => {
                    if (bx - ax < 0.02 || az - bz < 0.02) return;
                    const q = [[ax, y, az], [bx, y, az], [bx, y, bz], [ax, y, bz]].map((p) => StoneBuilder.place(frame, p[0], p[1], p[2]));
                    this.quads.push({
                        id, kind: topKind, cell, cellV: Math.min(cell, 2.4), corners: q,
                    });
                };
                strip(x0, z1, x1, cz + hz); // front
                strip(x0, cz - hz, x1, z0); // back
                strip(x0, cz + hz, cx - hx, cz - hz); // left
                strip(cx + hx, cz + hz, x1, cz - hz); // right
            } else {
                this.quads.push({
                    id, kind: topKind, cell, cellV: cell, corners: [w[4], w[5], w[6], w[7]],
                });
            }
        }
        if (occlude) {
            let x0 = Infinity;
            let x1 = -Infinity;
            let y0 = Infinity;
            let y1 = -Infinity;
            let z0 = Infinity;
            let z1 = -Infinity;
            pts.forEach((p) => {
                x0 = Math.min(x0, p[0]);
                x1 = Math.max(x1, p[0]);
                y0 = Math.min(y0, p[1]);
                y1 = Math.max(y1, p[1]);
                z0 = Math.min(z0, p[2]);
                z1 = Math.max(z1, p[2]);
            });
            const centre = StoneBuilder.place(frame, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
            this.occluders.push({
                id,
                frame,
                min: [x0, y0, z0],
                max: [x1, y1, z1],
                centre,
                radius: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2,
            });
        }
        return id;
    }

    /** A box whose walls may lean: half-extents (hx0, hz0) at y0 and (hx1, hz1) at y1. */
    box(frame, cx, cz, y0, y1, hx0, hz0, hx1 = hx0, hz1 = hz0, opts = {}) {
        return this.hexa(frame, [
            [cx - hx0, y0, cz + hz0], [cx + hx0, y0, cz + hz0], [cx + hx0, y0, cz - hz0], [cx - hx0, y0, cz - hz0],
            [cx - hx1, y1, cz + hz1], [cx + hx1, y1, cz + hz1], [cx + hx1, y1, cz - hz1], [cx - hx1, y1, cz - hz1],
        ], opts);
    }

    /** How much of the sky the stone round point `p` (normal `n`) hides from it: 0 dark … 1 open. */
    occlusion(p, n, self) {
        let occ = 0;
        const { occluders } = this;
        for (let i = 0; i < occluders.length; i++) {
            const o = occluders[i];
            if (o.id === self) continue;
            const dx = p[0] - o.centre[0];
            const dy = p[1] - o.centre[1];
            const dz = p[2] - o.centre[2];
            const lim = o.radius + AO_REACH;
            if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
            const f = o.frame;
            const rx = p[0] - f.ox;
            const rz = p[2] - f.oz;
            // Into the occluder's frame (its axes are orthonormal).
            const lx = rx * f.ax[0] + rz * f.ax[1];
            const lz = rx * f.az[0] + rz * f.az[1];
            const ly = p[1];
            const nx = n[0] * f.ax[0] + n[2] * f.ax[1];
            const nz = n[0] * f.az[0] + n[2] * f.az[1];
            const ny = n[1];
            // A surface that lies inside another solid is shaded by it elsewhere, not here.
            if (lx > o.min[0] + 0.02 && lx < o.max[0] - 0.02 && ly > o.min[1] + 0.02 && ly < o.max[1] - 0.02
                && lz > o.min[2] + 0.02 && lz < o.max[2] - 0.02) continue;
            // The point of the solid nearest to a point lifted off the surface.
            const qx = lx + nx * 1.2;
            const qy = ly + ny * 1.2;
            const qz = lz + nz * 1.2;
            const vx = Math.max(o.min[0], Math.min(o.max[0], qx)) - lx;
            const vy = Math.max(o.min[1], Math.min(o.max[1], qy)) - ly;
            const vz = Math.max(o.min[2], Math.min(o.max[2], qz)) - lz;
            const d = Math.hypot(vx, vy, vz);
            if (d < 1e-4 || d > AO_REACH) continue;
            const facing = (vx * nx + vy * ny + vz * nz) / d;
            if (facing <= 0) continue;
            const near = 1 - d / AO_REACH;
            occ += facing * near * near;
        }
        return Math.max(AO_FLOOR, 1 - occ * 0.9);
    }

    /** Emit every quad as flat triangles: positions, normals, uvs (metres) and (ao, kind, hash, _). */
    finish(seed = 1) {
        const rand = mulberry32(seed);
        let cells = 0;
        const grids = this.quads.map((q) => {
            const [a, b, , d] = q.corners;
            const lu = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            const lv = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
            const nu = Math.max(1, Math.min(48, Math.round(lu / q.cell)));
            const nv = Math.max(1, Math.min(48, Math.round(lv / q.cellV)));
            cells += nu * nv;
            return {
                nu, nv, lu, lv,
            };
        });
        const count = cells * 6;
        const positions = new Float32Array(count * 3);
        const normals = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        const data = new Float32Array(count * 4);
        let v = 0;
        const put = (pt, n, kind, hash) => {
            positions.set(pt.p, v * 3);
            normals.set(n, v * 3);
            uvs.set([pt.u, pt.v], v * 2);
            data.set([pt.ao, kind, hash, 0], v * 4);
            v += 1;
        };
        for (let qi = 0; qi < this.quads.length; qi++) {
            const q = this.quads[qi];
            const {
                nu, nv, lu, lv,
            } = grids[qi];
            const [a, b, c, d] = q.corners;
            const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
            let nx = e1[1] * e2[2] - e1[2] * e2[1];
            let ny = e1[2] * e2[0] - e1[0] * e2[2];
            let nz = e1[0] * e2[1] - e1[1] * e2[0];
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl;
            ny /= nl;
            nz /= nl;
            const n = [nx, ny, nz];
            const uOff = Math.floor(rand() * 40);
            const vOff = Math.floor(rand() * 40);
            const hash = rand();
            // The grid's points, their occlusion and their place on the face.
            const pts = new Array((nu + 1) * (nv + 1));
            for (let j = 0; j <= nv; j++) {
                const t = j / nv;
                for (let i = 0; i <= nu; i++) {
                    const s = i / nu;
                    const p = [0, 0, 0];
                    for (let k = 0; k < 3; k++) {
                        const bottom = a[k] + (b[k] - a[k]) * s;
                        const top = d[k] + (c[k] - d[k]) * s;
                        p[k] = bottom + (top - bottom) * t;
                    }
                    pts[j * (nu + 1) + i] = {
                        p, ao: this.occlusion(p, n, q.id), u: s * lu + uOff, v: t * lv + vOff,
                    };
                }
            }
            for (let j = 0; j < nv; j++) {
                for (let i = 0; i < nu; i++) {
                    const p00 = pts[j * (nu + 1) + i];
                    const p10 = pts[j * (nu + 1) + i + 1];
                    const p01 = pts[(j + 1) * (nu + 1) + i];
                    const p11 = pts[(j + 1) * (nu + 1) + i + 1];
                    put(p00, n, q.kind, hash);
                    put(p10, n, q.kind, hash);
                    put(p11, n, q.kind, hash);
                    put(p00, n, q.kind, hash);
                    put(p11, n, q.kind, hash);
                    put(p01, n, q.kind, hash);
                }
            }
        }
        return {
            positions, normals, uvs, data, count,
        };
    }
}

/** Collects ley strips: quads that carry (arc length at each end, line, kind). */
function createLeyBuilder() {
    const positions = [];
    const uvs = [];
    const ley = [];
    return {
        /**
         * A strip from `p0` to `p1` (frame-local points), `width` wide across `side` (a unit
         * local vector), lifted along `up`. `s0`/`s1` = arc length at its ends; `kind` 0 = a
         * line, 1 = the heart gate's veil, 2 = a rune (lit only as a pulse passes).
         */
        strip(frame, p0, p1, side, up, width, s0, s1, line, kind = 0) {
            const h = width / 2;
            const lift = (p, sign) => StoneBuilder.place(
                frame,
                p[0] + side[0] * h * sign + up[0] * LEY_PROUD,
                p[1] + side[1] * h * sign + up[1] * LEY_PROUD,
                p[2] + side[2] * h * sign + up[2] * LEY_PROUD,
            );
            const a = lift(p0, -1);
            const b = lift(p0, 1);
            const c = lift(p1, 1);
            const d = lift(p1, -1);
            const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
            const put = (p, across, along, s) => {
                positions.push(p[0], p[1], p[2]);
                uvs.push(across, along);
                ley.push(s, line, kind, length);
            };
            put(a, 0, 0, s0);
            put(b, 1, 0, s0);
            put(c, 1, 1, s1);
            put(a, 0, 0, s0);
            put(c, 1, 1, s1);
            put(d, 0, 1, s1);
        },
        finish() {
            return {
                positions: new Float32Array(positions),
                uvs: new Float32Array(uvs),
                ley: new Float32Array(ley),
                count: positions.length / 3,
            };
        },
    };
}

function buildSite(stone, ley, gems, rand) {
    const p = SITE.pyramid;
    const c = SITE.causeway;
    const site = frameAt(p.x, p.z, Math.atan2(SITE.front[0], SITE.front[1]));

    // ── The plinth and the landing at the stair's foot ──
    stone.box(site, 0, 0, -3.5, p.plinth, p.half + 4.2, p.half + 4.2, p.half + 3.2, p.half + 3.2, {
        kind: STONE.footing, cell: 9, hole: [tierHalf(0).foot - 0.2, tierHalf(0).foot - 0.2],
    });
    stone.box(site, 0, (p.half + 3 + c.near) / 2, -3.5, p.plinth, 13.5, (c.near - p.half - 3) / 2 + 0.4, 13, (c.near - p.half - 3) / 2, {
        kind: STONE.footing, cell: 4,
    });

    // ── The tiers, each with its cornice ──
    for (let i = 0; i < p.tiers; i++) {
        const { foot, top } = tierHalf(i);
        const y0 = p.plinth + i * p.tierHeight;
        const y1 = y0 + p.tierHeight;
        const next = i < p.tiers - 1 ? tierHalf(i + 1).foot - 0.25 : 0;
        const cell = Math.max(3.2, foot / 9);
        stone.box(site, 0, 0, y0, y1, foot, foot, top, top, {
            kind: STONE.wall, cell, cellV: 2.7, hole: next ? [next, next] : null,
        });
        stone.box(site, 0, 0, y1 - 0.62, y1 + 0.14, top + 0.42, top + 0.42, top + 0.5, top + 0.5, {
            kind: STONE.trim, cell: cell * 1.6, cellV: 1, hole: next ? [top - 0.4, top - 0.4] : [top - 1.2, top - 1.2],
        });
    }

    // ── The stair: a hundred and forty steps between two balustrades ──
    const steps = Math.round(STAIR.rise / 0.6);
    const tread = STAIR.run / steps;
    const riser = STAIR.rise / steps;
    for (let i = 0; i < steps; i++) {
        const y1 = p.plinth + (i + 1) * riser;
        const zc = STAIR.zFoot - (i + 0.5) * tread;
        stone.box(site, 0, zc, y1 - 1.5, y1, p.stairHalf, tread / 2 + 0.01, p.stairHalf, tread / 2 + 0.01, {
            kind: STONE.paving, cell: 20, faces: 'ft', occlude: false,
        });
    }
    const railWidth = 1.7;
    const railProud = 1.25;
    [-1, 1].forEach((side) => {
        const x0 = side < 0 ? -(p.stairHalf + railWidth) : p.stairHalf;
        const x1 = x0 + railWidth;
        const [zf, yf] = stairPoint(-0.012);
        const [zt, yt] = stairPoint(1);
        stone.hexa(site, [
            [x0, yf - 1.6, zf], [x1, yf - 1.6, zf], [x1, yt - 1.6, zt], [x0, yt - 1.6, zt],
            [x0, yf + railProud, zf], [x1, yf + railProud, zf], [x1, yt + railProud, zt], [x0, yt + railProud, zt],
        ], {
            kind: STONE.trim, cell: 5, cellV: 5, occlude: false,
        });
        // A newel at the foot of each.
        stone.box(site, (x0 + x1) / 2, STAIR.zFoot + 1.5, -1, p.plinth + 3.4, 1.35, 1.35, 1.15, 1.15, { kind: STONE.trim, cell: 3 });
        // The ley line climbs each balustrade.
        const cx = (x0 + x1) / 2;
        const [za, ya] = stairPoint(0.004);
        const [zb, yb] = stairPoint(0.992);
        const along = Math.hypot(zb - za, yb - ya);
        const up = [0, (za - zb) / along, (yb - ya) / along];
        ley.strip(site, [cx, ya + railProud, za], [cx, yb + railProud, zb], [1, 0, 0], up, 0.5, LEY_A.foot, LEY_A.foot + LEY_A.stair, 0);
    });

    // ── The heart gate: a pylon astride the stair, and the veil of light in its doorway ──
    const gateT = ((p.gateTier + 0.62) * p.tierHeight) / STAIR.rise;
    const [gz, gy] = stairPoint(gateT);
    const gateTop = gy + 15.5;
    const jamb = p.stairHalf + 3.1;
    [-1, 1].forEach((side) => {
        stone.box(site, side * jamb, gz, gy - 7, gateTop, 3.0, 3.6, 2.5, 3.1, { kind: STONE.wall, cell: 3, cellV: 2.6 });
    });
    stone.box(site, 0, gz, gateTop, gateTop + 3.6, jamb + 2.9, 3.5, jamb + 3.2, 3.8, { kind: STONE.wall, cell: 3.5, cellV: 2 });
    stone.box(site, 0, gz, gateTop + 3.6, gateTop + 4.3, jamb + 3.6, 4.2, jamb + 3.7, 4.3, { kind: STONE.trim, cell: 5, cellV: 1 });
    ley.strip(
        site,
        [0, gy - 1.2, gz - 1.6],
        [0, gateTop, gz - 1.6],
        [1, 0, 0],
        [0, 0, 1],
        (p.stairHalf + 0.25) * 2,
        LEY_A.foot + LEY_A.stair * gateT,
        LEY_A.foot + LEY_A.stair * gateT,
        0,
        1,
    );

    // ── The top platform: a dais between four pylons, under the Apex ──
    const topHalf = tierHalf(p.tiers - 1).top;
    stone.box(site, 0, 0, PYRAMID_TOP, PYRAMID_TOP + 1.3, 5.4, 5.4, 4.8, 4.8, { kind: STONE.trim, cell: 4 });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const px = sx * (topHalf - 2.4);
        const pz = sz * (topHalf - 2.4);
        stone.box(site, px, pz, PYRAMID_TOP, PYRAMID_TOP + 8.6, 1.5, 1.5, 1.0, 1.0, { kind: STONE.wall, cell: 3 });
        stone.box(site, px, pz, PYRAMID_TOP + 8.6, PYRAMID_TOP + 11.2, 1.0, 1.0, 0.02, 0.02, { kind: STONE.gold, cell: 3, faces: 'frbl' });
    });

    // ── Obelisks: a tall pair at the stair's foot, a shorter pair further out ──
    const obelisk = (x, z, height, half, index) => {
        stone.box(site, x, z, -3.5, 2.3, half * 1.7, half * 1.7, half * 1.5, half * 1.5, { kind: STONE.footing, cell: 3 });
        stone.box(site, x, z, 2.3, height, half, half, half * 0.68, half * 0.68, { kind: STONE.wall, cell: 3, cellV: 3.4 });
        const cap = half * 0.68 * 2.3;
        stone.box(site, x, z, height, height + cap, half * 0.68, half * 0.68, 0.02, 0.02, { kind: STONE.gold, cell: 3, faces: 'frbl' });
        const top = StoneBuilder.place(site, x, height + cap + 3.4, z);
        gems.push({
            kind: GEM.obelisk, x: top[0], y: top[1], z: top[2], half: 2.1, girth: 0.86, yaw: rand() * TAU, s: LEY_A.foot * 0.95, line: 0, index, hash: rand(),
        });
    };
    obelisk(-19.5, c.near - 6, 31, 2.1, 0);
    obelisk(19.5, c.near - 6, 31, 2.1, 1);
    obelisk(-41, c.near - 3, 23, 1.75, 2);
    obelisk(41, c.near - 3, 23, 1.75, 3);

    // ── The causeway: a deck on piers, a pair of ley shards at every pier ──
    const deckLen = c.far - c.near;
    stone.box(site, 0, c.near + deckLen / 2, c.deck - 0.62, c.deck, c.half, deckLen / 2, c.half, deckLen / 2, { kind: STONE.paving, cell: 4.6, cellV: 0.6 });
    [-1, 1].forEach((side) => {
        stone.box(site, side * (c.half - 0.3), c.near + deckLen / 2, c.deck, c.deck + 0.34, 0.3, deckLen / 2, 0.26, deckLen / 2, { kind: STONE.trim, cell: 9, cellV: 0.4 });
    });
    const pairs = Math.floor((LEY_A.head - c.near - 4) / c.pitch) + 1;
    for (let k = -1; k < pairs; k++) {
        const z = LEY_A.head - k * c.pitch;
        stone.box(site, 0, z, -3.5, c.deck - 0.62, c.half + 1.7, 1.25, c.half + 1.5, 1.1, { kind: STONE.footing, cell: 4 });
        stone.box(site, 0, z, c.deck - 0.62, c.deck - 0.1, c.half + 2.1, 1.6, c.half + 2.1, 1.6, { kind: STONE.trim, cell: 5, cellV: 0.5 });
        if (k < 0) continue;
        [-1, 1].forEach((side) => {
            stone.box(site, side * c.shardAt, z, c.deck - 0.1, c.deck + 0.72, 0.78, 0.78, 0.56, 0.56, { kind: STONE.trim, cell: 2 });
            const at = StoneBuilder.place(site, side * c.shardAt, c.deck + 0.72 + 1.75, z);
            gems.push({
                kind: GEM.shard, x: at[0], y: at[1], z: at[2], half: 1.5 + rand() * 0.25, girth: 0.5 + rand() * 0.07, yaw: rand() * TAU, s: leyAAtDeck(z), line: 0, index: k, hash: rand(),
            });
        });
        // A rune across the deck from shard to shard: lit as a pulse passes.
        ley.strip(site, [-c.shardAt + 0.9, c.deck, z], [c.shardAt - 0.9, c.deck, z], [0, 0, 1], [0, 1, 0], 0.26, leyAAtDeck(z), leyAAtDeck(z), 0, 2);
    }
    // The line itself: down the middle of the deck and across the landing to the stair.
    ley.strip(site, [0, c.deck, LEY_A.head + 9], [0, c.deck, c.near], [1, 0, 0], [0, 1, 0], 0.62, -9, leyAAtDeck(c.near), 0);
    ley.strip(site, [0, p.plinth, c.near], [0, p.plinth, STAIR.zFoot + 0.3], [1, 0, 0], [0, 1, 0], 0.62, leyAAtDeck(c.near), LEY_A.foot, 0);

    // ── The Apex and what circles it ──
    const apex = StoneBuilder.place(site, 0, APEX_Y, 0);
    gems.push({
        kind: GEM.apex, x: apex[0], y: apex[1], z: apex[2], half: SITE.apex.half, girth: SITE.apex.girth, yaw: 0.4, s: LEY_A.length, line: 0, index: 0, hash: 0.5,
    });
    for (let i = 0; i < 12; i++) {
        gems.push({
            kind: GEM.apexOrbit,
            // (orbit radius, height over the Apex's centre, phase) ride in x, y, z.
            x: 9.5 + rand() * 6.5,
            y: (rand() - 0.5) * 17,
            z: rand() * TAU,
            half: 0.7 + rand() * 0.9,
            girth: 0.3 + rand() * 0.22,
            yaw: rand() * TAU,
            s: LEY_A.length,
            line: 0,
            index: i,
            hash: rand(),
        });
    }
    /** The heart gate: where its light stands, and how far along line A. */
    const gateAt = StoneBuilder.place(site, 0, gy + 6.5, gz + 2.5);
    const gate = [gateAt[0], gateAt[1], gateAt[2], LEY_A.foot + LEY_A.stair * gateT];
    return {
        site, apex, pairs, gate,
    };
}

function buildDial(stone, ley, gems, rand) {
    const d = SITE.dial;
    const root = frameAt(0, 0, 0);
    for (let k = 0; k < d.stones; k++) {
        // Stone 0 stands nearest the viewer (+z); the rest go round both ways from it.
        const angle = (k / d.stones) * TAU;
        const x = Math.sin(angle) * d.radius;
        const z = Math.cos(angle) * d.radius;
        const f = frameAt(x, z, angle);
        const lean = 0.84 + rand() * 0.06;
        const height = d.stoneHeight * (0.9 + rand() * 0.2);
        stone.box(f, 0, 0, -3.5, 0.55, 2.5, 1.7, 2.2, 1.45, { kind: STONE.footing, cell: 2.5 });
        stone.box(f, 0, 0, 0.55, height, 1.55, 0.78, 1.55 * lean, 0.6, { kind: STONE.monolith, cell: 1.6, cellV: 1.9 });
        const s = leyBAtStone(k);
        // A line of light up both broad faces.
        ley.strip(f, [0, 1.3, 0.72], [0, height - 0.7, 0.62], [1, 0, 0], [0, 0.03, 1], 0.4, s, s, 1, 0);
        ley.strip(f, [0, 1.3, -0.72], [0, height - 0.7, -0.62], [-1, 0, 0], [0, 0.03, -1], 0.4, s, s, 1, 0);
        gems.push({
            kind: GEM.dial, x, y: height + 1.9, z, half: 1.15, girth: 0.5, yaw: rand() * TAU, s, line: 1, index: Math.min(k, d.stones - k), hash: rand(),
        });
        // The rim between this stone and the next, awash at the waterline.
        const next = ((k + 1) / d.stones) * TAU;
        const mid = (angle + next) / 2;
        const chord = d.radius * Math.sin(Math.PI / d.stones);
        const rf = frameAt(Math.sin(mid) * d.radius * Math.cos(Math.PI / d.stones), Math.cos(mid) * d.radius * Math.cos(Math.PI / d.stones), mid);
        stone.box(rf, 0, 0, -3.5, 0.3, chord - 1.9, 0.75, chord - 1.9, 0.62, { kind: STONE.footing, cell: 4, cellV: 1 });
        ley.strip(rf, [-(chord - 2.2), 0.3, 0], [chord - 2.2, 0.3, 0], [0, 0, 1], [0, 1, 0], 0.3, s, leyBAtStone(k + 1), 1, 0);
    }
    for (let i = 0; i < 16; i++) {
        gems.push({
            kind: GEM.halcyonOrbit,
            x: SITE.halcyon.girth + 5 + rand() * 11,
            y: (rand() - 0.5) * 30,
            z: rand() * TAU,
            half: 0.9 + rand() * 1.5,
            girth: 0.36 + rand() * 0.34,
            yaw: rand() * TAU,
            s: LEY_B.length,
            line: 1,
            index: i,
            hash: rand(),
        });
    }
    gems.push({
        kind: GEM.halcyon, x: 0, y: 0, z: 0, half: SITE.halcyon.half, girth: SITE.halcyon.girth, yaw: 0.2, s: LEY_B.length, line: 1, index: 0, hash: 0.5,
    });
    return root;
}

/**
 * Build the sanctuary.
 * @param {number} [seed]
 */
export function buildPlan(seed = 0x4a1c) {
    const rand = mulberry32(seed);
    const gems = [];
    const stone = new StoneBuilder();
    const ley = createLeyBuilder();
    const { apex, pairs, gate } = buildSite(stone, ley, gems, rand);
    const dialStone = new StoneBuilder();
    const dialLey = createLeyBuilder();
    buildDial(dialStone, dialLey, gems, rand);
    const shards = gems.filter((g) => g.kind === GEM.shard);
    return {
        seed,
        stone: stone.finish(seed + 11),
        ley: ley.finish(),
        dialStone: dialStone.finish(seed + 23),
        dialLey: dialLey.finish(),
        gems,
        /** World position of the Apex's centre. */
        apex,
        /** The heart gate: [x, y, z, arc length on line A]. */
        gate,
        /** Pairs of ley shards along the causeway (index 0 = nearest the viewer). */
        pairs,
        /** The ley shards, nearest pair first: a lock's wisp flies to one of these. */
        shards,
    };
}

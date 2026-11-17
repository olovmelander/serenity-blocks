/**
 * High Coast — the hamlet's buildings: red cottages, boathouses, huts and rowing boats.
 *
 * A fishing hamlet of the High Coast as the eye meets it from half a kilometre: Falu-red cottages
 * of board and batten with white corner boards, white-cased windows with glazing bars, a door
 * under a small gabled porch on white posts, a tiled or felted roof that overhangs its walls
 * behind white bargeboards, and a plastered chimney on the ridge; red boathouses (sjöbodar) that
 * turn their gable and its tarred double doors to the water, a plank slip running down from them;
 * a hut or two behind the cottages; rowing boats drawn up on the shingle.
 *
 * Everything is one mesh and one material. A vertex carries `aLocal` (metres along its face,
 * metres up it, the part, the building's seed) and `aWall` (the face's width, the wall's height
 * to the eaves, what the wall is): the boards, the openings and the trim are drawn in the face's
 * own metres. Walls stand in their roof's shade where the eaves cast it (worked out from the
 * overhang and the sun), windows carry the sky and, when the sun is low, lamplight (some rooms
 * stay dark).
 *
 * The buildings also shade the grass: `houseShadows` lays the land's own mesh over the yard again
 * and multiplies the sun out of it where a ray to the sun meets a house (each house a convex
 * solid: its walls under its roof), with the darkening where a wall meets the ground. Without it
 * the houses float.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    reflect,
    smoothstep,
    step,
    texture,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG, EYE } from './high-coast-core.js';
import { groundHeight } from './high-coast-field.js';
import { FAN } from './high-coast-land.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';
import { flatVarying } from '../shared/flat-varying.js';

/** Parts of a building's surface (aLocal.z). A roof is 2 (felt) or 2.5 (tiles). */
export const PART = Object.freeze({
    wall: 0, trim: 1, roof: 2, plinth: 3, chimney: 4, wood: 5, boat: 6,
});
/** What a wall is (aWall.z): where its openings are drawn. */
export const WALL = Object.freeze({
    front: 0, back: 1, gable: 2, doors: 3, blank: 4, hut: 5, blankGable: 6,
});
/** Roof shapes (metres): the eaves' and the gables' overhang, the roof's thickness, its rise over half its span. */
export const ROOF = Object.freeze({
    eaves: 0.5, gable: 0.42, thick: 0.13, pitch: 0.84,
});

// ── Geometry ──────────────────────────────────────────────────────────────────────

/** A building's frame: its own x (along the ridge), y up, z (its front) in the world. */
function frameOf(x, z, yaw) {
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);
    return {
        x,
        z,
        yaw,
        point: (lx, ly, lz) => [x + ca * lx + sa * lz, ly, z - sa * lx + ca * lz],
        dir: (nx, ny, nz) => [ca * nx + sa * nz, ny, -sa * nx + ca * nz],
    };
}

/** One triangle: three local points, a local normal, the part, the face coordinates, the seed, the wall. */
function tri(out, f, points, n, part, coords, seed, wall = [0, 0, WALL.blank, 0]) {
    const normal = f.dir(n[0], n[1], n[2]);
    for (let i = 0; i < 3; i++) {
        out.pos.push(...f.point(points[i][0], points[i][1], points[i][2]));
        out.nrm.push(...normal);
        out.local.push(coords[i][0], coords[i][1], part, seed);
        out.wall.push(...wall);
    }
}

/** A quad p0 p1 p2 p3 (counter-clockwise from its lower left), `uw` wide and `vh` tall in its own metres. */
function quad(out, f, p0, p1, p2, p3, n, part, uw, vh, seed, wall) {
    tri(out, f, [p0, p1, p2], n, part, [[0, 0], [uw, 0], [uw, vh]], seed, wall);
    tri(out, f, [p0, p2, p3], n, part, [[0, 0], [uw, vh], [0, vh]], seed, wall);
}

/** The four sides of a box and its top (`lid`), each face in its own metres. */
function box(out, f, [x0, x1], [y0, y1], [z0, z1], part, seed, { lid = true, wall } = {}) {
    const h = y1 - y0;
    quad(out, f, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], part, x1 - x0, h, seed, wall);
    quad(out, f, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], part, x1 - x0, h, seed, wall);
    quad(out, f, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], part, z1 - z0, h, seed, wall);
    quad(out, f, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], part, z1 - z0, h, seed, wall);
    if (lid) quad(out, f, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], part, x1 - x0, z1 - z0, seed, wall);
}

/** The ground under a footprint: its lowest point and the floor the building stands on. */
function footing(f, halfX, halfZ, ground) {
    const centre = ground(f.x, f.z);
    let low = centre;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = f.point(sx * halfX, 0, sz * halfZ);
        low = Math.min(low, ground(p[0], p[2]));
    }
    return { low, floor: Math.max(centre, low) + 0.55 };
}

/**
 * The shell every building shares: a stone plinth, four walls (the long ones `front` and `back`
 * at ±z, the gables at ±x with their triangle up to the ridge), a roof of two slopes that
 * overhangs them, white fascia boards along the eaves and bargeboards up the gables.
 * `walls`: what the front, the back, the +x gable and the −x gable are. Returns the heights the
 * rest of a building is hung on, and the solid its shadow is cast by.
 */
function addShell(out, f, {
    along, span, height, roof, seed, walls, eaves = ROOF.eaves, gable = ROOF.gable,
}, ground) {
    const x1 = along / 2;
    const x0 = -x1;
    const z1 = span / 2;
    const z0 = -z1;
    const { low, floor } = footing(f, x1, z1, ground);
    const yb = floor;
    const yt = yb + height;
    const rise = z1 * ROOF.pitch;
    const ridge = yt + rise;
    box(out, f, [x0, x1], [low - 1.2, yb], [z0, z1], PART.plinth, seed, { lid: false });
    quad(
        out,
        f,
        [x0, yb, z1],
        [x1, yb, z1],
        [x1, yt, z1],
        [x0, yt, z1],
        [0, 0, 1],
        PART.wall,
        along,
        height,
        seed,
        [along, height, walls[0], 0],
    );
    quad(
        out,
        f,
        [x1, yb, z0],
        [x0, yb, z0],
        [x0, yt, z0],
        [x1, yt, z0],
        [0, 0, -1],
        PART.wall,
        along,
        height,
        seed,
        [along, height, walls[1], 0],
    );
    for (const side of [1, -1]) {
        const xs = side > 0 ? x1 : x0;
        const za = side > 0 ? z1 : z0;
        const zb = side > 0 ? z0 : z1;
        const wall = [span, height, walls[side > 0 ? 2 : 3], 0];
        quad(out, f, [xs, yb, za], [xs, yb, zb], [xs, yt, zb], [xs, yt, za], [side, 0, 0], PART.wall, span, height, seed, wall);
        tri(
            out,
            f,
            [[xs, yt, za], [xs, yt, zb], [xs, ridge, 0]],
            [side, 0, 0],
            PART.wall,
            [[0, height], [span, height], [span / 2, height + rise]],
            seed,
            wall,
        );
    }
    // The roof's upper face runs ROOF.thick over the walls' tops and on down past them to the eaves.
    const top = ridge + ROOF.thick;
    const edge = z1 + eaves;
    const eaveY = top - ROOF.pitch * edge;
    const run = Math.hypot(edge, top - eaveY);
    const ny = edge / run;
    const nz = (top - eaveY) / run;
    const part = PART.roof + roof * 0.5;
    const xa = x0 - gable;
    const xb = x1 + gable;
    quad(out, f, [xa, eaveY, edge], [xb, eaveY, edge], [xb, top, 0], [xa, top, 0], [0, ny, nz], part, xb - xa, run, seed);
    quad(out, f, [xb, eaveY, -edge], [xa, eaveY, -edge], [xa, top, 0], [xb, top, 0], [0, ny, -nz], part, xb - xa, run, seed);
    // Fascia boards under the eaves' edges, bargeboards up the gables' rakes.
    const board = 0.2;
    quad(
        out,
        f,
        [xa, eaveY - board, edge],
        [xb, eaveY - board, edge],
        [xb, eaveY, edge],
        [xa, eaveY, edge],
        [0, 0, 1],
        PART.trim,
        xb - xa,
        board,
        seed,
    );
    quad(
        out,
        f,
        [xb, eaveY - board, -edge],
        [xa, eaveY - board, -edge],
        [xa, eaveY, -edge],
        [xb, eaveY, -edge],
        [0, 0, -1],
        PART.trim,
        xb - xa,
        board,
        seed,
    );
    for (const side of [1, -1]) {
        const xs = side > 0 ? xb : xa;
        for (const face of [1, -1]) {
            const ze = face * edge;
            const a = [xs, eaveY - board, ze];
            const b = [xs, top - board, 0];
            const c = [xs, top, 0];
            const d = [xs, eaveY, ze];
            // Counter-clockwise seen from outside the gable.
            if (side * face > 0) quad(out, f, a, b, c, d, [side, 0, 0], PART.trim, run, board, seed);
            else quad(out, f, b, a, d, c, [side, 0, 0], PART.trim, run, board, seed);
        }
    }
    return {
        x0,
        x1,
        z0,
        z1,
        low,
        yb,
        yt,
        ridge,
        rise,
        top,
        eaveY,
        solid: {
            x: f.x, z: f.z, yaw: f.yaw, halfX: x1, halfZ: z1, floor: low - 3, eaves: yt, ridge, pitch: ROOF.pitch,
        },
    };
}

/** A cottage: the shell, a chimney on the ridge and a porch over the front door. */
function addCottage(out, b, ground) {
    const f = frameOf(b.x, b.z, b.yaw);
    const s = addShell(out, f, {
        along: b.w, span: b.d, height: b.h, roof: b.roof, seed: b.seed, walls: [WALL.front, WALL.back, WALL.gable, WALL.gable],
    }, ground);
    // The chimney: plastered, a dark cap; off the middle of the ridge.
    const cx = (b.seed < 0.5 ? -1 : 1) * b.w * 0.2;
    box(out, f, [cx - 0.36, cx + 0.36], [s.ridge - 0.5, s.ridge + 0.95], [-0.3, 0.3], PART.chimney, b.seed);
    // The porch: a deck, a block of steps, two posts, a small gabled roof and its white pediment.
    const z = s.z1;
    const deck = s.yb - 0.04;
    box(out, f, [-1.15, 1.15], [s.yb - 0.24, deck], [z, z + 1.5], PART.wood, b.seed);
    // The steps down from it: each a tread lower and further out, the last one on the ground.
    for (let k = 0; k < 4; k++) {
        const tread = s.yb - 0.26 - k * 0.21;
        if (tread < s.low - 0.1 && k > 0) break;
        box(out, f, [-0.7, 0.7], [s.low - 0.3, tread], [z + 1.5 + k * 0.3, z + 1.8 + k * 0.3], PART.wood, b.seed);
    }
    for (const side of [-1, 1]) {
        box(out, f, [side * 1.05 - 0.06, side * 1.05 + 0.06], [deck, s.yb + 2.16], [z + 1.3, z + 1.42], PART.trim, b.seed);
    }
    const eave = s.yb + 2.16;
    const peak = s.yb + 2.74;
    const half = 1.32;
    const out2 = z + 1.66;
    const slope = Math.hypot(half, peak - eave);
    const nx = (peak - eave) / slope;
    const ny = half / slope;
    const part = PART.roof + b.roof * 0.5;
    quad(out, f, [-half, eave, z], [-half, eave, out2], [0, peak, out2], [0, peak, z], [-nx, ny, 0], part, out2 - z, slope, b.seed);
    quad(out, f, [half, eave, out2], [half, eave, z], [0, peak, z], [0, peak, out2], [nx, ny, 0], part, out2 - z, slope, b.seed);
    tri(
        out,
        f,
        [[-half + 0.12, eave + 0.02, out2 - 0.06], [half - 0.12, eave + 0.02, out2 - 0.06], [0, peak - 0.06, out2 - 0.06]],
        [0, 0, 1],
        PART.trim,
        [[0, 0], [2.4, 0], [1.2, 0.56]],
        b.seed,
    );
    return s.solid;
}

/**
 * A boathouse: the shell turned so a gable and its double doors face the water (the site's
 * yaw points down the shore), with a plank slip from the doors down to the shingle.
 */
function addBoathouse(out, b, ground) {
    const f = frameOf(b.x, b.z, b.yaw - Math.PI / 2);
    const s = addShell(out, f, {
        along: b.d,
        span: b.w,
        height: b.h,
        roof: b.roof,
        seed: b.seed,
        walls: [WALL.blank, WALL.blank, WALL.doors, WALL.blankGable],
        eaves: 0.32,
        gable: 0.34,
    }, ground);
    const reach = 3.4;
    const end = f.point(s.x1 + reach, 0, 0);
    const foot = ground(end[0], end[2]) + 0.06;
    const top = s.yb - 0.05;
    const run = Math.hypot(reach, top - foot);
    quad(
        out,
        f,
        [s.x1, top, 1.15],
        [s.x1 + reach, foot, 1.15],
        [s.x1 + reach, foot, -1.15],
        [s.x1, top, -1.15],
        [(top - foot) / run, reach / run, 0],
        PART.wood,
        run,
        2.3,
        b.seed,
    );
    return s.solid;
}

/** A hut behind a cottage (a privy, a store): the shell, a door on its front. */
function addHut(out, b, ground) {
    const f = frameOf(b.x, b.z, b.yaw);
    return addShell(out, f, {
        along: b.w,
        span: b.d,
        height: b.h,
        roof: 0,
        seed: b.seed,
        walls: [WALL.hut, WALL.blank, WALL.blankGable, WALL.blankGable],
        eaves: 0.26,
        gable: 0.24,
    }, ground).solid;
}

/** Stations of a rowing boat's hull, transom (0) to stem (1): half its beam, its gunwale, its keel. */
const BOAT = Object.freeze({
    length: 4.4, beam: 1.5, depth: 0.52, stations: 8,
});
const HULL = [[-1, 1], [-0.74, 0.3], [0, 0], [0.74, 0.3], [1, 1]];

/** A rowing boat drawn up on the shingle, heeled a little onto its bilge. */
function addBoat(out, b, ground) {
    const f = frameOf(b.x, b.z, b.yaw);
    const base = ground(b.x, b.z) + 0.04;
    const heel = (b.seed < 0.5 ? -1 : 1) * 0.16;
    const at = (i, j) => {
        const s = i / BOAT.stations;
        const half = (BOAT.beam / 2) * Math.sin(Math.PI * (0.18 + 0.82 * s)) ** 0.7;
        const bow = 2 * s - 1;
        const gunwale = BOAT.depth * (1 + 0.22 * bow * bow + 0.16 * Math.max(0, bow));
        const keel = BOAT.depth * 0.14 * bow * bow;
        const [kx, ky] = HULL[j];
        const lz = kx * half;
        return [(s - 0.5) * BOAT.length, base + keel + (gunwale - keel) * ky + lz * heel, lz];
    };
    for (let i = 0; i < BOAT.stations; i++) {
        for (let j = 0; j < HULL.length - 1; j++) {
            const p0 = at(i, j);
            const p1 = at(i + 1, j);
            const p2 = at(i + 1, j + 1);
            const p3 = at(i, j + 1);
            // The plank's own normal, turned to face out of the hull.
            const ux = p1[0] - p0[0];
            const uy = p1[1] - p0[1];
            const uz = p1[2] - p0[2];
            const vx = p3[0] - p0[0];
            const vy = p3[1] - p0[1];
            const vz = p3[2] - p0[2];
            let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
            const len = Math.hypot(...n) || 1;
            n = n.map((v) => v / len);
            if (n[1] > 0) n = n.map((v) => -v);
            const lo = HULL[j][1];
            const hi = HULL[j + 1][1];
            const u0 = (i / BOAT.stations) * BOAT.length;
            const u1 = ((i + 1) / BOAT.stations) * BOAT.length;
            tri(out, f, [p0, p1, p2], n, PART.boat, [[u0, lo], [u1, lo], [u1, hi]], b.seed);
            tri(out, f, [p0, p2, p3], n, PART.boat, [[u0, lo], [u1, hi], [u0, hi]], b.seed);
        }
    }
    // The transom, and two thwarts.
    const t = HULL.map((_, j) => at(0, j));
    for (let j = 1; j < HULL.length - 2; j++) {
        tri(out, f, [t[0], t[j], t[j + 1]], [-1, 0, 0], PART.boat, [[0, 1], [0, 0.3], [0, 0.3]], b.seed);
    }
    tri(out, f, [t[0], t[HULL.length - 2], t[HULL.length - 1]], [-1, 0, 0], PART.boat, [[0, 1], [0, 0.3], [0, 1]], b.seed);
    for (const s of [0.34, 0.64]) {
        const i = Math.round(s * BOAT.stations);
        const port = at(i, 0);
        const star = at(i, HULL.length - 1);
        const y = (port[1] + star[1]) / 2 - BOAT.depth * 0.3;
        const x = port[0];
        quad(
            out,
            f,
            [x - 0.12, y + port[2] * heel * 0.6, port[2] * 0.9],
            [x + 0.12, y + port[2] * heel * 0.6, port[2] * 0.9],
            [x + 0.12, y + star[2] * heel * 0.6, star[2] * 0.9],
            [x - 0.12, y + star[2] * heel * 0.6, star[2] * 0.9],
            [0, 1, 0],
            PART.wood,
            0.24,
            BOAT.beam,
            b.seed,
        );
    }
}

/**
 * The hamlet's buildings as one geometry (`aLocal`, `aWall`), and the solids their shadows are
 * cast by. `sites` from hamletSites.
 */
export function buildCottages(sites, ground) {
    const out = {
        pos: [], nrm: [], local: [], wall: [],
    };
    const solids = [];
    for (const b of sites.cottages) solids.push(addCottage(out, b, ground));
    for (const b of sites.sheds) solids.push(addBoathouse(out, b, ground));
    for (const b of sites.huts || []) solids.push(addHut(out, b, ground));
    for (const b of sites.boats || []) addBoat(out, b, ground);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
    geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(out.local, 4));
    geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(out.wall, 4));
    geometry.computeBoundingSphere();
    return { geometry, solids };
}

// ── The material ──────────────────────────────────────────────────────────────────

export function cottageMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastHamlet';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const local = attribute('aLocal', 'vec4');
    const wall = attribute('aWall', 'vec4');
    // The part and the wall's kind, flat: a felt roof is 2.0, and read interpolated as 1.9999999
    // its fract made it tiles.
    const partOf = flatVarying(local.z, 'vHamletPart');
    const kindOf = flatVarying(wall.z, 'vHamletWall');
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld).toVar();
        const lu = local.x.toVar();
        const lv = local.y.toVar();
        const W = wall.x.toVar();
        const H = wall.y.toVar();
        const part = partOf.toVar();
        const kind = kindOf.toVar();
        const seed = fract(local.w).toVar();
        const is = (value, k) => step(k - 0.25, value).mul(step(value, k + 0.25));
        const front = is(kind, WALL.front);
        const back = is(kind, WALL.back);
        const gable = is(kind, WALL.gable);
        const doors = is(kind, WALL.doors);
        const hut = is(kind, WALL.hut);
        const peaked = max(max(gable, doors), is(kind, WALL.blankGable)).toVar();
        const rect = (cx, cy, hw, hh) => step(lu.sub(cx).abs(), hw).mul(step(lv.sub(cy).abs(), hh));

        // ── Walls: Falu red, board and batten, stained a little by the weather, darker at the foot ──
        const strip = fract(lu.div(0.19));
        const boards = smoothstep(0.0, 0.1, strip).mul(smoothstep(1.0, 0.9, strip)).mul(0.14).add(0.86);
        const stain = texture(t.noise, vec2(lu.mul(0.13).add(seed.mul(7.0)), lv.mul(0.09).add(seed))).g;
        const falu = vec3(0.27, 0.03, 0.015).mul(boards).mul(seed.mul(0.22).add(0.88)).mul(stain.mul(0.3).add(0.84))
            .mul(smoothstep(-0.1, 0.6, lv).mul(0.2).add(0.8));
        // Windows: two on a long wall, one in a gable and a small one in its peak (a boathouse's
        // peak has a hatch there).
        const place = mix(float(0.2), float(0.27), back);
        const long = max(front, back);
        const pane = (cx, cy, hw, hh, on) => {
            const glass = rect(cx, cy, hw, hh);
            const bars = max(step(lu.sub(cx).abs(), 0.03), step(lv.sub(cy.add(hh * 0.22)).abs(), 0.03));
            return vec2(rect(cx, cy, hw + 0.11, hh + 0.11).sub(glass).add(glass.mul(bars)), glass.mul(float(1.0).sub(bars))).mul(on);
        };
        const w1 = pane(W.mul(place), float(1.62), 0.5, 0.62, long);
        const w2 = pane(W.mul(float(1.0).sub(place)), float(1.62), 0.5, 0.62, long);
        const w3 = pane(W.mul(0.5), float(1.62), 0.5, 0.62, gable);
        const w4 = pane(W.mul(0.5), H.add(0.62), 0.3, 0.32, max(gable, doors));
        const casing = max(max(w1.x, w2.x), max(w3.x, w4.x));
        const glass = max(max(w1.y, w2.y), max(w3.y, w4.y)).toVar();
        // Which window this is (0…3), for the lamps: some rooms stay dark.
        const which = w2.y.add(w3.y.mul(2.0)).add(w4.y.mul(3.0));
        // The door: a cottage's under its porch, a hut's, a boathouse's tarred double doors.
        const doorHalf = mix(mix(float(0.48), float(0.4), hut), float(1.15), doors);
        const doorTop = mix(mix(float(2.02), float(1.8), hut), float(2.1), doors);
        const hasDoor = max(max(front, hut), doors);
        const leaf = step(lu.sub(W.mul(0.5)).abs(), doorHalf).mul(step(lv, doorTop)).mul(hasDoor).toVar();
        const doorCase = step(lu.sub(W.mul(0.5)).abs(), doorHalf.add(0.1)).mul(step(lv, doorTop.add(0.1))).mul(hasDoor).sub(leaf);
        const plank = fract(lu.sub(W.mul(0.5)).div(0.16));
        const planks = smoothstep(0.0, 0.14, plank).mul(0.25).add(0.75);
        const painted = mix(mix(vec3(0.66, 0.65, 0.61), vec3(0.04, 0.1, 0.06), step(0.4, seed)), vec3(0.045, 0.085, 0.15), step(0.72, seed));
        const tarred = vec3(0.05, 0.036, 0.026).mul(planks).mul(step(0.02, lu.sub(W.mul(0.5)).abs()).mul(0.5).add(0.5));
        const door = mix(mix(painted.mul(planks.mul(0.3).add(0.7)), falu.mul(0.8), hut), tarred, doors);
        // White trim: the corner boards, the casings.
        const corner = float(1.0).sub(step(0.2, lu.min(W.sub(lu))));
        const white = vec3(0.78, 0.77, 0.73);
        const trimmed = clamp(max(max(corner, casing), doorCase), 0.0, 1.0);
        // A boathouse's hatch is a dark board, not a pane.
        const pane3 = glass.mul(float(1.0).sub(doors));
        const walls = mix(mix(mix(falu, white, trimmed), door, leaf), vec3(0.02, 0.026, 0.032), glass).toVar();

        // ── The other parts ──
        // Roofs: felt with its seams, or clay tiles in courses, each tile its own red.
        const tiles = step(0.25, fract(part));
        const seam = float(1.0).sub(smoothstep(0.0, 0.05, fract(lu.div(0.62)).sub(0.5).abs())).mul(0.5);
        const felt = vec3(0.045, 0.046, 0.052).mul(seam.add(1.0));
        const course = fract(lv.div(0.36));
        const tileId = texture(t.noise, vec2(lu.div(0.24).floor().mul(0.37).add(seed), lv.div(0.36).floor().mul(0.61))).a;
        const clay = mix(vec3(0.26, 0.07, 0.035), vec3(0.4, 0.13, 0.06), tileId)
            .mul(smoothstep(0.0, 0.3, course).mul(0.4).add(0.6)).mul(smoothstep(0.0, 0.12, fract(lu.div(0.24))).mul(0.2).add(0.8));
        const roofing = mix(felt, clay, tiles);
        // The plinth: grey fieldstone in courses.
        const stone = texture(t.noise, P.xz.mul(1.3).add(P.y)).a;
        const joint = smoothstep(0.0, 0.07, fract(P.y.div(0.42)).min(fract(lu.div(0.7).add(P.y.div(0.42).floor().mul(0.5))))).mul(0.4).add(0.6);
        const plinth = mix(vec3(0.2, 0.19, 0.18), vec3(0.34, 0.32, 0.3), stone).mul(joint);
        // The chimney: lime plaster, sooted toward a dark cap.
        const chimney = mix(vec3(0.56, 0.54, 0.5), vec3(0.05, 0.047, 0.044), smoothstep(1.16, 1.22, lv))
            .mul(smoothstep(1.3, 0.5, lv).mul(0.25).add(0.75));
        // Bare wood (the porch, the slip, the thwarts): silvered planks.
        const deal = vec3(0.24, 0.22, 0.19).mul(smoothstep(0.0, 0.1, fract(lu.div(0.14))).mul(0.3).add(0.7))
            .mul(texture(t.noise, vec2(lu.mul(0.9), lv.mul(3.0)).add(seed)).a.mul(0.3).add(0.8));
        // The boats: tarred or painted white, the gunwale strake bare.
        const hull = mix(vec3(0.07, 0.045, 0.03), vec3(0.6, 0.59, 0.55), step(0.5, seed));
        const boat = mix(hull, vec3(0.3, 0.24, 0.17), smoothstep(0.8, 0.86, lv));
        const albedo = walls.toVar();
        albedo.assign(mix(albedo, white, is(part, PART.trim)));
        albedo.assign(mix(albedo, roofing, step(PART.roof - 0.25, part).mul(step(part, PART.roof + 0.75))));
        albedo.assign(mix(albedo, plinth, is(part, PART.plinth)));
        albedo.assign(mix(albedo, chimney, is(part, PART.chimney)));
        albedo.assign(mix(albedo, deal, is(part, PART.wood)));
        albedo.assign(mix(albedo, boat, is(part, PART.boat)));
        const isWall = is(part, PART.wall);

        // ── Light ──
        const L = u.sunDir;
        const facing = dot(n, L);
        const ndl = clamp(facing, 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        // The roof's shade on its own walls: a ray from the wall to the sun climbs
        // overhang · L.y / (n·L) before it clears the eaves (the rake, on a gable).
        const overhang = mix(float(ROOF.eaves), float(ROOF.gable), peaked);
        const climb = overhang.mul(max(L.y, 0.0)).div(max(facing, 0.06));
        const roofLine = H.add(peaked.mul(lu.min(W.sub(lu)).mul(ROOF.pitch))).sub(float(1.0).sub(peaked).mul(0.3));
        const eaves = mix(float(1.0), smoothstep(climb.sub(0.08), climb.add(0.08), roofLine.sub(lv)), isWall);
        // Where a wall meets the ground and under the eaves it sees less of the sky.
        const nook = mix(float(1.0), smoothstep(-0.2, 0.7, lv).mul(0.3).add(0.7)
            .mul(smoothstep(0.0, 0.9, roofLine.sub(lv)).mul(0.25).add(0.75)), isWall);
        const direct = u.sun.mul(ndl).mul(shadow).mul(u.sunUp).mul(eaves);
        const sky = u.fill.mul(n.y.mul(0.3).add(0.7)).mul(nook);
        // The meadow throws the sun back up under the eaves and onto the walls.
        const bounce = u.bounce.mul(float(1.0).sub(n.y).mul(0.3).add(0.4)).mul(nook);
        const lit = albedo.mul(direct.add(sky).add(bounce)).toVar();
        // Glass carries the sky, and the sun where it mirrors it.
        const view = normalize(P.sub(u.eye));
        const graze = float(1.0).sub(abs(dot(n, view)));
        const mirror = clamp(dot(reflect(view, n), L), 0.0, 1.0);
        const m2 = mirror.mul(mirror);
        const m8 = m2.mul(m2).mul(m2).mul(m2);
        lit.addAssign(u.fill.mul(graze.mul(graze).mul(0.5).add(0.12)).add(u.sun.mul(u.sunUp).mul(shadow).mul(m8.mul(m8).mul(m8)).mul(0.5))
            .mul(pane3).mul(isWall));
        // The windows glow when the sun is low: most rooms, not all.
        const room = step(0.3, fract(seed.mul(7.31).add(which.mul(0.37))));
        lit.addAssign(vec3(1.8, 1.05, 0.45).mul(pane3).mul(isWall).mul(u.lamps)
            .mul(room)
            .mul(seed.mul(0.5).add(0.6)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

// ── The buildings' shadows on the yard ───────────────────────────────────────────

/** Rows of the shadow's table per solid, and how many solids it holds. */
const SOLID_ROWS = 3;
export const HOUSE_SHADOWS = Object.freeze({ solids: 12, margin: 26, soft: 0.8 });

/** The posts of the land's own mesh (high-coast-land.js fanPositionSteps) that lie over a disc. */
export function yardPatch(fields, cols, rows, centre, radius) {
    const half = FAN.halfAngle * DEG;
    const lnNear = Math.log(FAN.near);
    const lnFar = Math.log(FAN.far);
    const away = Math.hypot(centre.x - EYE.x, centre.z - EYE.z);
    const bearing = Math.atan2(centre.x - EYE.x, -(centre.z - EYE.z));
    const spread = Math.asin(Math.min(1, radius / away));
    const rowOf = (d) => ((Math.log(d) - lnNear) / (lnFar - lnNear)) * (rows - 1);
    const colOf = (a) => ((a + half) / (2 * half)) * (cols - 1);
    const r0 = Math.max(0, Math.floor(rowOf(Math.max(FAN.near, away - radius))));
    const r1 = Math.min(rows - 1, Math.ceil(rowOf(away + radius)));
    const c0 = Math.max(0, Math.floor(colOf(bearing - spread)));
    const c1 = Math.min(cols - 1, Math.ceil(colOf(bearing + spread)));
    const nr = r1 - r0 + 1;
    const nc = c1 - c0 + 1;
    if (nr < 2 || nc < 2) return null;
    const positions = new Float32Array(nr * nc * 3);
    for (let r = r0; r <= r1; r++) {
        // The same arithmetic as the land's mesh, so the patch lies in its triangles.
        const dist = Math.exp(lnNear + (lnFar - lnNear) * (r / (rows - 1)));
        for (let c = c0; c <= c1; c++) {
            const a = -half + (2 * half * c) / (cols - 1);
            const x = EYE.x + Math.sin(a) * dist;
            const z = EYE.z - Math.cos(a) * dist;
            const o = ((r - r0) * nc + (c - c0)) * 3;
            positions[o] = x;
            positions[o + 1] = groundHeight(fields, x, z, dist < 3000);
            positions[o + 2] = z;
        }
    }
    const index = new Uint32Array((nr - 1) * (nc - 1) * 6);
    let k = 0;
    for (let r = 0; r < nr - 1; r++) {
        for (let c = 0; c < nc - 1; c++) {
            const a = r * nc + c;
            const b = a + 1;
            const d = a + nc;
            const e = d + 1;
            index[k++] = a;
            index[k++] = b;
            index[k++] = d;
            index[k++] = b;
            index[k++] = e;
            index[k++] = d;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return {
        geometry, rows: [r0, r1], cols: [c0, c1],
    };
}

/**
 * The buildings' shadows: the land's mesh over the yard, multiplied into the land under it. A
 * ray from the ground to the sun is clipped by each solid's seven planes (four walls, the floor,
 * the roof's two slopes); how far it runs inside is how deep the ground lies in that shadow.
 */
export function houseShadows(u, t, fields, tier, solids) {
    const list = solids.slice(0, HOUSE_SHADOWS.solids);
    if (!list.length) return null;
    let cx = 0;
    let cz = 0;
    for (const s of list) {
        cx += s.x / list.length;
        cz += s.z / list.length;
    }
    let radius = 0;
    for (const s of list) radius = Math.max(radius, Math.hypot(s.x - cx, s.z - cz) + Math.hypot(s.halfX, s.halfZ));
    const patch = yardPatch(fields, tier.fanCols, tier.fanRows, { x: cx, z: cz }, radius + HOUSE_SHADOWS.margin);
    if (!patch) return null;
    const table = [];
    for (const s of list) {
        table.push(new THREE.Vector4(s.x, s.floor, s.z, Math.cos(s.yaw)));
        table.push(new THREE.Vector4(Math.sin(s.yaw), s.halfX, s.halfZ, s.eaves));
        table.push(new THREE.Vector4(s.ridge, s.pitch, 0, 0));
    }
    const rows = uniformArray(table, 'vec4');
    const count = list.length;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastHamletShadow';
    material.fog = false;
    material.transparent = true;
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.ZeroFactor;
    material.blendDst = THREE.SrcColorFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.fragmentNode = Fn(() => {
        const P = positionWorld.toVar();
        const L = u.sunDir.toVar();
        const lit = float(1.0).toVar();
        const nook = float(1.0).toVar();
        Loop({
            start: int(0), end: int(count), type: 'int', condition: '<', name: 'hi',
        }, ({ hi }) => {
            const a = rows.element(hi.mul(SOLID_ROWS)).toVar();
            const b = rows.element(hi.mul(SOLID_ROWS).add(1)).toVar();
            const c = rows.element(hi.mul(SOLID_ROWS).add(2)).toVar();
            // The ground point and the sun's way in the solid's own frame.
            const dx = P.x.sub(a.x);
            const dz = P.z.sub(a.z);
            const p = vec3(a.w.mul(dx).sub(b.x.mul(dz)), P.y, b.x.mul(dx).add(a.w.mul(dz))).toVar();
            const d = vec3(a.w.mul(L.x).sub(b.x.mul(L.z)), L.y, b.x.mul(L.x).add(a.w.mul(L.z))).toVar();
            const enter = float(0.0).toVar();
            const leave = float(1e4).toVar();
            // One plane n·x ≤ k: the ray is inside it from `enter` or until `leave`.
            const clip = (nd, room) => {
                const safe = max(nd.abs(), 1e-5).mul(step(0.0, nd).mul(2.0).sub(1.0));
                const at = room.div(safe);
                enter.assign(max(enter, mix(at, float(-1e4), step(0.0, nd))));
                leave.assign(min(leave, mix(float(1e4), at, step(0.0, nd))));
            };
            clip(d.x, b.y.sub(p.x));
            clip(d.x.negate(), b.y.add(p.x));
            clip(d.z, b.z.sub(p.z));
            clip(d.z.negate(), b.z.add(p.z));
            clip(d.y.negate(), p.y.sub(a.y));
            // The roof's slopes: y + pitch · |z| ≤ ridge.
            clip(d.y.add(c.y.mul(d.z)), c.x.sub(p.y).sub(c.y.mul(p.z)));
            clip(d.y.sub(c.y.mul(d.z)), c.x.sub(p.y).add(c.y.mul(p.z)));
            lit.mulAssign(float(1.0).sub(smoothstep(0.0, HOUSE_SHADOWS.soft, leave.sub(enter))));
            // Round the walls' feet the grass sees less sky.
            const out = length(max(vec2(p.x.abs().sub(b.y), p.z.abs().sub(b.z)), vec2(0.0)));
            nook.mulAssign(float(1.0).sub(exp(out.mul(-0.9)).mul(0.26)));
        });
        const sunShare = u.sunUp.mul(0.66).mul(shadowAt(t.shadow, P.xz)).mul(smoothstep(0.0, 0.05, L.y));
        const f = float(1.0).sub(float(1.0).sub(lit).mul(sunShare)).mul(nook);
        return vec4(f, f, f, 1.0);
    })();
    const mesh = new THREE.Mesh(patch.geometry, material);
    mesh.name = 'HighCoastHamletShadow';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return {
        mesh, geometry: patch.geometry, material, count,
    };
}

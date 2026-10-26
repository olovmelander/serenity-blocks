/**
 * Neon District — the people in the shops.
 *
 * A cast of cyberpunk characters (a fixer in a long coat, a hooded netrunner, a punk with a chrome
 * arm, a street cook, runners, gamers, a courier, a monk...) baked in Blender by
 * scripts/blender/neon_district_people.py into a sprite sheet of DATA, not colour: per texel the
 * view-space normal, an occlusion and coverage, and weights for seven surface classes (skin, hair,
 * the upper and lower garment, gear, chrome and glow). Every clip is drawn from three or five views.
 *
 * In the shop shader a person stands on a card turned to face the camera at their place in the
 * room. The view nearest the camera's bearing on them is read (mirrored for the other side), the
 * frame comes from the clock (or from the distance walked, so the feet stay planted, or from the
 * breath), and the person is coloured from their own seed and lit by the room: the lamps
 * overhead, the back wall behind them, the street's neon through the glass. Glow is light of its
 * own, in each person's neon colour; chrome mirrors the room.
 *
 * Roles by trade (SHOP_ARCHETYPES order): up to two people at the back of the room (behind the
 * counter, its top hiding their legs) and two in front of it.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    atan,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    max,
    min,
    mix,
    mod,
    pow,
    select,
    smoothstep,
    sqrt,
    step,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';

import { PEOPLE_CLIPS, PEOPLE_SHEET, PEOPLE_VIEWS } from './neon-district-people-atlas.js';

/** What a figure slot does. */
export const ROLE = Object.freeze({
    none: 0,
    staff: 1, // works the counter (the cook, the bartender, the clerk): sidesteps along it
    player: 2, // at an arcade cabinet, back to the street
    runner: 3, // on a treadmill, facing the street
    monk: 4, // seated, breathing with the game's breath
    diner: 5, // on a stool at the counter, eating, back to the street
    patron: 6, // leaning on the bar, a glass now and then
    shopper: 7, // at the shelves, reaching up, reading a label
    lifter: 8, // dumbbell curls by the window
    waiting: 9, // standing on their phone
    looker: 10, // standing, looking round the room
    walker: 11, // crossing the room and back
});

/** Per archetype (SHOP_ARCHETYPES order): [back0, back1] and [front0, front1]. */
export const ARCH_ROLES = Object.freeze({
    back: Object.freeze([
        [ROLE.staff, ROLE.staff], // diner
        [ROLE.none, ROLE.none], // laundry
        [ROLE.none, ROLE.none], // mart
        [ROLE.player, ROLE.player], // arcade
        [ROLE.none, ROLE.none], // boutique
        [ROLE.staff, ROLE.none], // bar
        [ROLE.runner, ROLE.runner], // studio (the gym)
        [ROLE.staff, ROLE.none], // office
        [ROLE.monk, ROLE.none], // calm
    ]),
    front: Object.freeze([
        [ROLE.diner, ROLE.walker],
        [ROLE.waiting, ROLE.walker],
        [ROLE.shopper, ROLE.walker],
        [ROLE.looker, ROLE.none],
        [ROLE.shopper, ROLE.walker],
        [ROLE.patron, ROLE.walker],
        [ROLE.lifter, ROLE.none],
        [ROLE.waiting, ROLE.walker],
        [ROLE.none, ROLE.none],
    ]),
});

/** The clip each role plays (a walker plays walkA or walkB by its seed). */
const ROLE_CLIP = Object.freeze({
    [ROLE.staff]: 'work',
    [ROLE.player]: 'arcade',
    [ROLE.runner]: 'run',
    [ROLE.monk]: 'lotus',
    [ROLE.diner]: 'sitEat',
    [ROLE.patron]: 'lean',
    [ROLE.shopper]: 'browse',
    [ROLE.lifter]: 'lift',
    [ROLE.waiting]: 'idleB',
    [ROLE.looker]: 'idleA',
    [ROLE.walker]: 'walkA',
});

/** Depth into the room (share of its depth) a role stands at; the counter is at 0.42. */
const ROLE_DEPTH = Object.freeze({
    [ROLE.staff]: 0.6,
    [ROLE.player]: 0.86,
    [ROLE.runner]: 0.45,
    [ROLE.monk]: 0.7,
    [ROLE.diner]: 0.36,
    [ROLE.patron]: 0.35,
    [ROLE.shopper]: 0.33,
    [ROLE.lifter]: 0.24,
    [ROLE.waiting]: 0.28,
    [ROLE.looker]: 0.3,
    [ROLE.walker]: 0.2,
});

/** Roles that face the back wall (their clips are drawn from behind). */
const FACES_BACK = new Set([ROLE.player, ROLE.diner, ROLE.patron, ROLE.shopper]);

/** Where across the room a role stands (see the shop shader's candidates). */
export const SPOT = Object.freeze({
    spread: 0, counter: 1, cabinet: 2, treadmill: 3, centre: 4, aisle: 5, path: 6,
});
const ROLE_SPOT = Object.freeze({
    [ROLE.staff]: SPOT.counter,
    [ROLE.player]: SPOT.cabinet,
    [ROLE.runner]: SPOT.treadmill,
    [ROLE.monk]: SPOT.centre,
    [ROLE.shopper]: SPOT.aisle,
    [ROLE.walker]: SPOT.path,
});

const CLIP_NAMES = Object.keys(PEOPLE_CLIPS);
const clipIndex = (name) => CLIP_NAMES.indexOf(name);
const ROLE_COUNT = Object.keys(ROLE).length;

// Linear colours. Skin across the human range; hair natural or dyed in the street's neon; clothes
// mostly dark with a bright piece now and then; glow in the district's tube colours.
const PALETTES = Object.freeze({
    skin: [[0.62, 0.42, 0.33], [0.48, 0.3, 0.21], [0.33, 0.2, 0.13], [0.2, 0.12, 0.08], [0.72, 0.53, 0.43],
        [0.55, 0.38, 0.27], [0.4, 0.26, 0.17]],
    hair: [[0.012, 0.01, 0.01], [0.02, 0.016, 0.014], [0.04, 0.025, 0.018], [0.06, 0.035, 0.02],
        [0.1, 0.06, 0.035], [0.18, 0.07, 0.035], [0.55, 0.5, 0.46], [0.75, 0.06, 0.38], [0.04, 0.55, 0.75],
        [0.32, 0.07, 0.65]],
    top: [[0.012, 0.012, 0.014], [0.03, 0.03, 0.034], [0.018, 0.025, 0.06], [0.11, 0.018, 0.028],
        [0.05, 0.06, 0.028], [0.55, 0.55, 0.53], [0.62, 0.42, 0.03], [0.45, 0.025, 0.025], [0.02, 0.18, 0.2],
        [0.13, 0.035, 0.22], [0.2, 0.2, 0.21], [0.02, 0.02, 0.022]],
    bottom: [[0.012, 0.012, 0.014], [0.03, 0.03, 0.033], [0.025, 0.04, 0.085], [0.17, 0.13, 0.07],
        [0.1, 0.1, 0.105], [0.02, 0.02, 0.024]],
    glow: [[0.1, 0.9, 1.0], [1.0, 0.1, 0.62], [1.0, 0.72, 0.1], [0.2, 1.0, 0.35], [1.0, 0.12, 0.08],
        [0.55, 0.2, 1.0], [0.7, 0.85, 1.0]],
});

/**
 * Everything the shader looks up, as rows of one table (one uniform array, read by index):
 * per archetype its four roles; per role its clip, depth, whether it faces the back wall and where
 * it stands; per clip its first cell, frames, views and timing; the colour palettes.
 */
function buildTable() {
    const rows = [];
    const at = {};
    const push = (x, y = 0, z = 0, w = 0) => rows.push([x, y, z, w]);
    at.arch = rows.length;
    ARCH_ROLES.back.forEach((back, i) => push(back[0], back[1], ARCH_ROLES.front[i][0], ARCH_ROLES.front[i][1]));
    at.role = rows.length;
    for (let r = 0; r < ROLE_COUNT; r++) {
        const clip = ROLE_CLIP[r] ? clipIndex(ROLE_CLIP[r]) : 0;
        push(clip, ROLE_DEPTH[r] || 0.3, FACES_BACK.has(r) ? 1 : 0, ROLE_SPOT[r] ?? SPOT.spread);
    }
    at.clip = rows.length;
    CLIP_NAMES.forEach((name) => {
        const clip = PEOPLE_CLIPS[name];
        const views = PEOPLE_VIEWS[clip.views];
        push(clip.base, clip.frames, views.start, views.count);
        // Walking and running read their nearest frame (crisp at 15 frames a second); the slow
        // clips cross-fade between frames.
        const blend = clip.timing === 'distance' || name === 'run' ? 0 : 1;
        push(clip.seconds || 1, clip.metres || 1, blend, clip.timing === 'level' ? 1 : 0);
    });
    at.palette = {};
    Object.entries(PALETTES).forEach(([key, colours]) => {
        at.palette[key] = { base: rows.length, count: colours.length };
        colours.forEach((c) => push(c[0], c[1], c[2]));
    });
    return { rows, at };
}

export const PEOPLE_TABLE = buildTable();
export const WALK_B = clipIndex('walkB');

/** The table as a uniform array for one material: `row(i)` reads row i (a float or int node). */
export function createPeopleTable() {
    const node = uniformArray(PEOPLE_TABLE.rows.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w)), 'vec4');
    return {
        node,
        at: PEOPLE_TABLE.at,
        row: (i) => node.element(int(floor(i.add(0.5)))),
    };
}

export const PEOPLE_VIEW_STEP = PEOPLE_VIEWS.front.step;

/** One person's colours from their seed (three hashes 0..1); staff wear their trade's. */
export function personLook(table, h3, isStaff) {
    const colour = (key, h) => {
        const { base, count } = table.at.palette[key];
        return table.row(floor(h.mul(count - 0.001)).add(base)).xyz;
    };
    // A cook's white, a bartender's or a clerk's black.
    const staffTop = select(h3.x.lessThan(0.55), vec3(0.6, 0.6, 0.58), vec3(0.014, 0.014, 0.016));
    return {
        skin: colour('skin', fract(h3.x.mul(7.13).add(h3.y))),
        hair: colour('hair', fract(h3.y.mul(5.71).add(h3.z.mul(0.3)))),
        top: select(isStaff, staffTop, colour('top', fract(h3.z.mul(3.37).add(h3.x.mul(0.61))))),
        bottom: colour('bottom', fract(h3.x.mul(2.91).add(h3.z.mul(1.7)))),
        gear: mix(vec3(0.014, 0.014, 0.016), vec3(0.05, 0.045, 0.04), fract(h3.y.mul(9.1))),
        glow: colour('glow', fract(h3.z.mul(11.3).add(h3.y.mul(0.4)))),
    };
}

// ── The sheet ────────────────────────────────────────────────────────────────────────────────
const COLS = PEOPLE_SHEET.columns;
const ROWS = PEOPLE_SHEET.rows;
const CELL_W = PEOPLE_SHEET.cellMetres[0];
const CELL_H = PEOPLE_SHEET.cellMetres[1];

/** The sheet coordinate of a point (cu, cv) in cell `cell` (v up; images load flipped). */
function cellUV(cell, cu, cv) {
    const row = floor(cell.div(COLS).add(0.001));
    const col = cell.sub(row.mul(COLS));
    return vec2(col.add(cu).div(COLS), float(1.0).sub(row.add(1.0).sub(cv).div(ROWS)));
}

/**
 * Read a person from the sheets (`sheets.sheet`, `sheets.masks`: TextureNodes whose value is
 * swapped when the images arrive). `cells` = { a, b, blend, near } (two frames to cross-fade and
 * the nearer one for the masks); (cu, cv) the point in the cell; `foot` metres a pixel covers.
 * Returns coverage, view-space normal (x toward the image's right), occlusion and class weights.
 */
export function readPerson(sheets, cells, cu, cv, foot) {
    const du = min(foot.div(CELL_W * COLS), 4.0 / (COLS * PEOPLE_SHEET.cellPixels[0]));
    const dv = min(foot.div(CELL_H * ROWS), 4.0 / (ROWS * PEOPLE_SHEET.cellPixels[1]));
    const gx = vec2(du, 0.0);
    const gy = vec2(0.0, dv);
    const sa = sheets.sheet.sample(cellUV(cells.a, cu, cv)).grad(gx, gy);
    const sb = sheets.sheet.sample(cellUV(cells.b, cu, cv)).grad(gx, gy);
    const s = mix(sa, sb, cells.blend).toVar();
    const mUV = cellUV(cells.near, cu, cv);
    const gxm = gx.mul(0.5);
    const left = sheets.masks.sample(vec2(mUV.x.mul(0.5), mUV.y)).grad(gxm, gy).toVar();
    const right = sheets.masks.sample(vec2(mUV.x.mul(0.5).add(0.5), mUV.y)).grad(gxm, gy).toVar();
    const nxy = s.rg.mul(2.0).sub(1.0);
    const nz = sqrt(max(float(1.0).sub(dot(nxy, nxy)), 0.0));
    const bottom = float(1.0).sub(left.a).mul(2.0);
    const sum = left.r.add(left.g).add(left.b).add(bottom)
        .add(right.r)
        .add(right.g);
    return {
        cov: s.b,
        n: vec3(nxy, nz),
        ao: s.a.sub(0.5).mul(2.0),
        skin: left.r,
        hair: left.g,
        top: left.b,
        bottom,
        chrome: right.r,
        glow: right.g,
        gear: max(float(1.0).sub(sum), 0.0),
    };
}

/**
 * Light a person read by `readPerson`. `n` is the normal in the room's frame (x along the wall,
 * y up, z into the room), `view` the direction the camera looks at them along (room frame).
 * `light`: L the room's light, accent the shop's colour (lighting a person from behind), street the
 * neon outside the glass, glowLevel how bright the glowing trims burn.
 */
export function shadePerson(r, n, view, look, light) {
    const {
        L, accent, street, glowLevel,
    } = light;
    // The lamps hang overhead along the room; the back wall glows behind; the street spills in.
    const top = clamp(dot(n, vec3(0.0000, 0.9578, -0.2873)).mul(0.6).add(0.4), 0.0, 1.0);
    const back = clamp(dot(n, vec3(0.0000, 0.2425, 0.9701)), 0.0, 1.0);
    const front = clamp(dot(n, vec3(0.0000, 0.0995, -0.9950)), 0.0, 1.0);
    const ao = r.ao.mul(0.7).add(0.3);
    const lit = L.mul(top.mul(0.62).add(0.12)).mul(ao)
        .add(L.mul(back.mul(back)).mul(0.55))
        .add(street.mul(front).mul(0.18).mul(ao));
    // Skin takes a little of the light through it (a warm wrap); cloth takes it as it falls.
    const skinLit = lit.add(L.mul(vec3(0.16, 0.06, 0.03)).mul(top));
    const albedo = look.top.mul(r.top).add(look.bottom.mul(r.bottom)).add(look.hair.mul(r.hair))
        .add(look.gear.mul(r.gear));
    let col = albedo.mul(lit).add(look.skin.mul(r.skin).mul(skinLit));
    // Chrome: the room mirrored, the lamps a bright band above, the street at the horizon.
    const refl = view.sub(n.mul(dot(view, n).mul(2.0)));
    const fres = pow(float(1.0).sub(clamp(dot(view.negate(), n), 0.0, 1.0)), 3.0).mul(0.6).add(0.4);
    const env = mix(L.mul(0.08), L.mul(1.6), smoothstep(0.1, 0.7, refl.y))
        .add(accent.mul(exp(abs(refl.y).mul(-9.0))).mul(0.9))
        .add(street.mul(smoothstep(0.2, -0.6, refl.z)).mul(0.4));
    col = col.add(env.mul(vec3(0.78, 0.8, 0.84)).mul(fres).mul(r.chrome));
    // Glow: light of its own, a little of it falling back on the surface round it.
    col = col.add(look.glow.mul(r.glow).mul(glowLevel));
    return col;
}

// ── Timing and placement ─────────────────────────────────────────────────────────────────────

/**
 * The cells to read for a clip (its two table rows) at `phase` (0..1 through the loop; for a
 * breath-driven clip the breath), seen from `angle` degrees round the person from their face.
 */
export function clipCells(clipA, clipB, phase, angle) {
    const base = clipA.x;
    const frames = clipA.y;
    const vStart = clipA.z;
    const vCount = clipA.w;
    const blendOn = clipB.z;
    const isLevel = clipB.w.greaterThan(0.5);
    const view = clamp(floor(angle.sub(vStart).div(PEOPLE_VIEW_STEP).add(0.5)), 0.0, vCount.sub(1.0));
    // Looping clips wrap; the breath runs from the first frame to the last.
    const pos = select(isLevel, clamp(phase, 0.0, 1.0).mul(frames.sub(1.0)), fract(phase).mul(frames)).toVar();
    const f0 = select(isLevel, min(floor(pos), frames.sub(2.0)), floor(pos)).toVar();
    const w = clamp(pos.sub(f0), 0.0, 1.0).mul(blendOn).toVar();
    const f1 = select(isLevel, f0.add(1.0), mod(f0.add(1.0), frames));
    const fNear = select(blendOn.lessThan(0.5), mod(floor(pos.add(0.5)), frames), select(w.lessThan(0.5), f0, f1));
    const row = base.add(view.mul(frames)).toVar();
    return {
        a: row.add(f0), b: row.add(f1), near: row.add(fNear), blend: w,
    };
}

/**
 * A walker crossing the room and back: walks to one end, turns on the spot toward the street,
 * walks back. Returns x (metres from the room's left), facing (radians, 0 = the street, +pi/2 =
 * walking toward +x) and the clip phase (by distance walked, so the feet stay planted).
 */
export function walkerPath(time, roomW, seed, metres, speed) {
    const x0 = float(0.45);
    const len = max(roomW.sub(0.9), 0.6);
    const leg = len.div(speed);
    const turnT = float(0.9);
    // Steps taken on the spot while turning, so a whole loop is a whole number of strides.
    const loopLen = len.mul(2.0).add(speed.mul(turnT));
    const strides = max(floor(loopLen.div(metres).add(0.5)), 1.0);
    const turnDist = strides.mul(metres).sub(len.mul(2.0)).mul(0.5);
    const period = leg.add(turnT).mul(2.0);
    const tau = mod(time.add(seed.mul(97.0)), period);
    const s1 = leg;
    const s2 = leg.add(turnT);
    const s3 = leg.mul(2.0).add(turnT);
    const inA = step(tau, s1);
    const inTurn1 = step(s1, tau).mul(step(tau, s2));
    const inB = step(s2, tau).mul(step(tau, s3));
    const inTurn2 = step(s3, tau);
    const uT1 = clamp(tau.sub(s1).div(turnT), 0.0, 1.0);
    const uT2 = clamp(tau.sub(s3).div(turnT), 0.0, 1.0);
    const x = x0.add(speed.mul(tau).mul(inA))
        .add(len.mul(inTurn1))
        .add(len.sub(speed.mul(tau.sub(s2))).mul(inB));
    const ease = (u) => u.mul(u).mul(float(3.0).sub(u.mul(2.0)));
    const half = Math.PI / 2;
    const facing = float(half).mul(inA)
        .add(float(half).sub(ease(uT1).mul(Math.PI)).mul(inTurn1))
        .add(float(-half).mul(inB))
        .add(float(-half).add(ease(uT2).mul(Math.PI)).mul(inTurn2));
    const walked = speed.mul(tau).mul(inA)
        .add(len.add(turnDist.mul(uT1)).mul(inTurn1))
        .add(len.add(turnDist).add(speed.mul(tau.sub(s2))).mul(inB))
        .add(len.mul(2.0).add(turnDist).add(turnDist.mul(uT2)).mul(inTurn2));
    return { x, facing, phase: walked.div(metres) };
}

/** The bearing (radians) of the camera seen from a person, 0 = straight out of the window. */
export const cameraBearing = (dir) => atan(dir.x.negate(), dir.y);

/** Degrees round the person from their face to the camera, and whether to mirror the sprite. */
export function viewAngle(bearing, facing) {
    const rel = bearing.sub(facing);
    const wrapped = rel.sub(floor(rel.div(Math.PI * 2).add(0.5)).mul(Math.PI * 2));
    return { angle: abs(wrapped).mul(180 / Math.PI), mirror: wrapped.lessThan(0.0) };
}

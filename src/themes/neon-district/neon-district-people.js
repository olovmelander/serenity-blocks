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
    float,
    floor,
    fract,
    int,
    max,
    min,
    mix,
    mod,
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
    // Pauldrons, mechanical arms, goggle rims: steel, gunmetal, brass, gold, copper, black chrome.
    metal: [[0.72, 0.74, 0.78], [0.3, 0.32, 0.36], [0.82, 0.58, 0.24], [0.95, 0.74, 0.3], [0.78, 0.4, 0.26],
        [0.16, 0.16, 0.18]],
    // Boots, belts, straps, bags: dark leather, black leather, oxblood, olive canvas, tan.
    gear: [[0.07, 0.04, 0.022], [0.016, 0.015, 0.016], [0.12, 0.025, 0.02], [0.06, 0.06, 0.03],
        [0.2, 0.11, 0.05]],
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
export const STAND_A = clipIndex('standA');
export const STAND_B = clipIndex('standB');
export const WORK_STEP = clipIndex('workStep');

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
        gear: colour('gear', fract(h3.y.mul(9.1).add(h3.z.mul(0.2)))),
        metal: colour('metal', fract(h3.x.mul(4.37).add(h3.y.mul(0.9)))),
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
    // Shade: 0 on the ink lines, 0.55 + 0.45 * occlusion elsewhere (the bake's `ink`).
    const shade = s.a.sub(0.5).mul(2.0);
    return {
        cov: s.b,
        n: vec3(nxy, nz),
        ink: smoothstep(0.42, 0.18, shade),
        ao: clamp(shade.sub(0.55).div(0.45), 0.0, 1.0),
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
 * Light a person read by `readPerson`, cel-shaded as a comic inks and flats a character. `n` is the
 * normal in the room's frame (x along the wall, y up, z into the room), `view` the direction the
 * camera looks at them along (room frame). `light`: L the room's light, accent the shop's colour
 * (lighting a person from behind), street the neon outside the glass, glowLevel how bright the
 * glowing trims burn.
 *
 * Two flat tones a surface: lit by the lamps overhead and in front, or in a cool shadow (also
 * where the bake's occlusion says a crease is closed); a hard rim where a surface turns to the
 * back wall; a small highlight on hair and skin; metal posterised into a dark, a mid and a bright
 * band of the room mirrored in it; glow flat; the ink over everything.
 */
export function shadePerson(r, n, view, look, light) {
    const {
        L, accent, street, glowLevel,
    } = light;
    const key = dot(n, vec3(0.0, 0.7894, -0.6139));
    const lit = smoothstep(0.06, 0.14, key).mul(smoothstep(0.28, 0.42, r.ao)).toVar();
    const rim = smoothstep(0.4, 0.5, dot(n, vec3(0.0, 0.2425, 0.9701)));
    const lightTone = L.mul(0.9).add(street.mul(0.1));
    const shadowTone = L.mul(vec3(0.21, 0.24, 0.34)).add(street.mul(0.08));
    const tone = mix(shadowTone, lightTone, lit);
    const albedo = look.top.mul(r.top).add(look.bottom.mul(r.bottom)).add(look.hair.mul(r.hair))
        .add(look.gear.mul(r.gear))
        .add(look.skin.mul(r.skin));
    let col = albedo.mul(tone);
    // A highlight band on hair (and a little on skin) where the lamps catch it.
    const half = smoothstep(0.9, 0.93, dot(n, vec3(0.0, 0.5547, -0.8321))).mul(lit);
    col = col.add(L.mul(half).mul(r.hair.mul(0.3).add(r.skin.mul(0.1))));
    // The back wall's light round the edges turned away from us.
    col = col.add(L.mul(0.35).add(accent.mul(0.5)).mul(rim).mul(float(1.0).sub(r.glow)));
    // Metal: the room mirrored in three bands, in the person's own metal.
    const refl = view.sub(n.mul(dot(view, n).mul(2.0)));
    const band = select(refl.y.lessThan(-0.15), float(0.12), select(refl.y.lessThan(0.45), float(0.5), float(1.5)));
    const metal = look.metal.mul(L.mul(band).add(street.mul(0.15))).add(accent.mul(rim).mul(0.6));
    col = col.add(metal.mul(r.chrome));
    // Glow: light of its own.
    col = col.add(look.glow.mul(r.glow).mul(glowLevel));
    // The ink: near black, a breath of the room's light in it.
    return mix(col, L.mul(0.012).add(0.003), r.ink.mul(float(1.0).sub(r.glow)));
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
 * A walker crossing the room and back: sets off, walks, slows to a stop at the end, stands there
 * for `rest` seconds turning to face the street and on round, and walks back. Returns x (metres
 * from the room's left), facing (radians, 0 = the street, +pi/2 = walking toward +x), the clip
 * phase while walking (by distance walked from the leg's start, so the feet stay planted) and
 * whether they are walking.
 */
export function walkerPath(time, roomW, seed, metres, speed, rest) {
    const x0 = float(0.45);
    const len = max(roomW.sub(0.9), 0.6).toVar();
    const ease = float(0.55);
    const leg = len.div(speed).add(ease).toVar();
    const half = leg.add(rest).toVar();
    const tau = mod(time.add(seed.mul(97.0)), half.mul(2.0));
    const back = step(half, tau).toVar();
    const t = tau.sub(back.mul(half)).toVar();
    const walking = step(t, leg);
    const tl = min(t, leg);
    const tr = leg.sub(tl);
    // Speeding up over `ease` seconds, slowing down over the last `ease`.
    const dStart = speed.mul(tl).mul(tl).div(ease.mul(2.0));
    const dEnd = len.sub(speed.mul(tr).mul(tr).div(ease.mul(2.0)));
    const dCruise = speed.mul(ease).mul(0.5).add(speed.mul(tl.sub(ease)));
    const d = select(tl.lessThan(ease), dStart, select(tr.lessThan(ease), dEnd, dCruise)).toVar();
    const dir = float(1.0).sub(back.mul(2.0));
    const x = select(back.greaterThan(0.5), x0.add(len).sub(d), x0.add(d));
    const into = max(t.sub(leg), 0.0);
    const turnIn = smoothstep(0.0, 0.6, into);
    const turnOut = smoothstep(rest.sub(0.6), rest, into);
    const side = dir.mul(Math.PI / 2);
    const facing = select(walking.greaterThan(0.5), side, side.mul(float(1.0).sub(turnIn)).sub(side.mul(turnOut)));
    return {
        x, facing, phase: d.div(metres), walking,
    };
}

/** The bearing (radians) of the camera seen from a person, 0 = straight out of the window. */
export const cameraBearing = (dir) => atan(dir.x.negate(), dir.y);

/** Degrees round the person from their face to the camera, and whether to mirror the sprite. */
export function viewAngle(bearing, facing) {
    const rel = bearing.sub(facing);
    const wrapped = rel.sub(floor(rel.div(Math.PI * 2).add(0.5)).mul(Math.PI * 2));
    return { angle: abs(wrapped).mul(180 / Math.PI), mirror: wrapped.lessThan(0.0) };
}

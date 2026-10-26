/**
 * Neon District — the people in the shops.
 *
 * A cast of cyberpunk characters (six kinds of walker: a fixer in a long coat, a hooded
 * netrunner, a chrome-armed brute, a punk, a helmeted rider, a nomad under a wide hat; cooks,
 * bartenders and clerks, runners, gamers, couriers, a monk...) baked in Blender by
 * scripts/blender/neon_district_people.py into a sprite sheet of DATA, not colour: per texel the
 * view-space normal, an occlusion and coverage, and weights for seven surface classes (skin, hair,
 * the upper and lower garment, gear, chrome and glow). Every clip is drawn from three or four views.
 *
 * In the shop shader a person stands on a card turned to face the camera at their place in the
 * room. The two views either side of the camera's bearing on them are read and cross-fade as the
 * bearing passes between them; the two frames either side of the clock (or of the distance
 * walked, so the feet stay planted, or of the breath) cross-fade too, so nothing ticks or pops.
 * Each person is coloured from their own seed and lit by the room: the lamps overhead, the back
 * wall behind them, the street's neon through the glass. Glow is light of its own, in each
 * person's neon colour; chrome mirrors the room.
 *
 * A walker crosses the room, brakes to a stop on a short step at the far end, turns to the
 * street (the head first, then the shoulders, then the hips, the feet stepping round), stands a
 * while looking about, turns on round and sets off back: one baked turn clip that the walk runs
 * straight into and out of (the shader moves them by the same braking and starting law the bake
 * used, so the feet stay put). The cook cross-fades between working the stove and stepping along
 * the counter.
 *
 * Roles by trade (SHOP_ARCHETYPES order): up to two people at the back of the room (behind the
 * counter, its top hiding their legs) and two in front of it; most roles have more than one
 * character, picked by the person's seed.
 */

import * as THREE from 'three/webgpu';
import {
    If,
    Loop,
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
    vec4,
} from 'three/tsl';

import { PEOPLE_CLIPS, PEOPLE_SHEET, PEOPLE_VIEWS } from './neon-district-people-atlas.js';

/** What a figure slot does. */
export const ROLE = Object.freeze({
    none: 0,
    staff: 1, // the cook: works the stove, sidesteps along the counter
    player: 2, // at an arcade cabinet, back to the street
    runner: 3, // on a treadmill, facing the street
    monk: 4, // seated, breathing with the game's breath
    diner: 5, // on a stool at the counter, eating, back to the street
    patron: 6, // leaning on the bar, a glass now and then
    shopper: 7, // at the shelves, reaching up, reading a label
    lifter: 8, // dumbbell curls by the window
    waiting: 9, // standing about: on their phone, or reading a forearm screen
    looker: 10, // standing, looking round the room
    walker: 11, // crossing the room and back
    tender: 12, // behind the bar, polishing glasses
    clerk: 13, // behind the office counter at a terminal
});

/** Per archetype (SHOP_ARCHETYPES order): [back0, back1] and [front0, front1]. */
export const ARCH_ROLES = Object.freeze({
    back: Object.freeze([
        [ROLE.staff, ROLE.staff], // diner
        [ROLE.none, ROLE.none], // laundry
        [ROLE.none, ROLE.none], // mart
        [ROLE.player, ROLE.player], // arcade
        [ROLE.none, ROLE.none], // boutique
        [ROLE.tender, ROLE.none], // bar
        [ROLE.runner, ROLE.runner], // studio (the gym)
        [ROLE.clerk, ROLE.none], // office
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

const CLIP_NAMES = Object.keys(PEOPLE_CLIPS);
const clipIndex = (name) => CLIP_NAMES.indexOf(name);

/**
 * The characters each role can be (one picked per person by seed). A walker is a pair of clips,
 * the walk and its turn, so its alternatives step by two.
 */
export const ROLE_CLIPS = Object.freeze({
    [ROLE.staff]: ['work'],
    [ROLE.player]: ['arcade', 'arcadeB'],
    [ROLE.runner]: ['run'],
    [ROLE.monk]: ['lotus'],
    [ROLE.diner]: ['sitEat', 'sitEatB'],
    [ROLE.patron]: ['lean', 'leanC'],
    [ROLE.shopper]: ['browse', 'browseA'],
    [ROLE.lifter]: ['lift'],
    [ROLE.waiting]: ['idleB', 'idleC'],
    [ROLE.looker]: ['idleA', 'idleD'],
    [ROLE.walker]: CLIP_NAMES.filter((name) => PEOPLE_CLIPS[name].timing === 'distance' && name.startsWith('walk')),
    [ROLE.tender]: ['tend'],
    [ROLE.clerk]: ['terminal'],
});

/** Depth into the room (share of its depth) a role stands at; the counter is at 0.42. */
const ROLE_DEPTH = Object.freeze({
    [ROLE.staff]: 0.6,
    [ROLE.tender]: 0.6,
    [ROLE.clerk]: 0.6,
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

/** Roles that work the counter in their trade's colours. */
export const STAFF_ROLES = Object.freeze([ROLE.staff, ROLE.tender, ROLE.clerk]);

/** Where across the room a role stands (see the shop shader's candidates). */
export const SPOT = Object.freeze({
    spread: 0, counter: 1, cabinet: 2, treadmill: 3, centre: 4, aisle: 5, path: 6,
});
const ROLE_SPOT = Object.freeze({
    [ROLE.staff]: SPOT.counter,
    [ROLE.tender]: SPOT.counter,
    [ROLE.clerk]: SPOT.counter,
    [ROLE.player]: SPOT.cabinet,
    [ROLE.runner]: SPOT.treadmill,
    [ROLE.monk]: SPOT.centre,
    [ROLE.shopper]: SPOT.aisle,
    [ROLE.walker]: SPOT.path,
});

const ROLE_COUNT = Object.keys(ROLE).length;
const VIEW_NAMES = Object.keys(PEOPLE_VIEWS);
const TIMING = Object.freeze({
    loop: 0, distance: 1, level: 2, turn: 3,
});
/** The most views a set can have (the table keeps five angles a set). */
const MAX_VIEWS = 5;

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
    // Pauldrons, mechanical arms, helmets, goggle rims: steel, gunmetal, brass, gold, copper,
    // black chrome.
    metal: [[0.72, 0.74, 0.78], [0.3, 0.32, 0.36], [0.82, 0.58, 0.24], [0.95, 0.74, 0.3], [0.78, 0.4, 0.26],
        [0.16, 0.16, 0.18]],
    // Boots, belts, straps, bags, hats: dark leather, black leather, oxblood, olive canvas, tan.
    gear: [[0.07, 0.04, 0.022], [0.016, 0.015, 0.016], [0.12, 0.025, 0.02], [0.06, 0.06, 0.03],
        [0.2, 0.11, 0.05]],
});

/** A role's characters as (first clip, how many, the step between them); throws if scattered. */
function roleClips(role) {
    const names = ROLE_CLIPS[role];
    if (!names || !names.length) return { first: 0, count: 0, stride: 1 };
    const indices = names.map((name) => {
        const index = clipIndex(name);
        if (index < 0) throw new Error(`neon people: role ${role} names a missing clip ${name}`);
        return index;
    });
    const stride = indices.length > 1 ? indices[1] - indices[0] : 1;
    indices.forEach((index, k) => {
        if (index !== indices[0] + k * stride) throw new Error(`neon people: role ${role}'s clips are not evenly spaced`);
    });
    return { first: indices[0], count: indices.length, stride };
}

/**
 * Everything the shader looks up, as rows of one table (one uniform array, read by index):
 * per archetype its four roles; per role (two rows) its first clip, depth, whether it faces the
 * back wall and where it stands, then how many characters it has and the step between them, and
 * whether it is staff; per view set (two rows) its angles, count and whether it is signed; per
 * clip (three rows) its first cell, frames, view set and timing, then its seconds and metres and
 * a turn's frames and times; the colour palettes.
 */
function buildTable() {
    const rows = [];
    const at = {};
    const push = (x, y = 0, z = 0, w = 0) => rows.push([x, y, z, w]);
    at.arch = rows.length;
    ARCH_ROLES.back.forEach((back, i) => push(back[0], back[1], ARCH_ROLES.front[i][0], ARCH_ROLES.front[i][1]));
    at.role = rows.length;
    for (let r = 0; r < ROLE_COUNT; r++) {
        const { first, count, stride } = roleClips(r);
        push(first, ROLE_DEPTH[r] || 0.3, FACES_BACK.has(r) ? 1 : 0, ROLE_SPOT[r] ?? SPOT.spread);
        push(count, stride, STAFF_ROLES.includes(r) ? 1 : 0, 0);
    }
    at.views = rows.length;
    VIEW_NAMES.forEach((name) => {
        const { angles, signed } = PEOPLE_VIEWS[name];
        if (angles.length > MAX_VIEWS) throw new Error(`neon people: view set ${name} has too many views`);
        const a = [...angles];
        while (a.length < MAX_VIEWS) a.push(a[a.length - 1]);
        push(a[0], a[1], a[2], a[3]);
        push(a[4], angles.length, signed ? 1 : 0, 0);
    });
    at.clip = rows.length;
    CLIP_NAMES.forEach((name) => {
        const clip = PEOPLE_CLIPS[name];
        const turn = clip.turn || {};
        push(clip.base, clip.frames, VIEW_NAMES.indexOf(clip.views), TIMING[clip.timing]);
        push(clip.seconds || 1, clip.metres || 1, turn.nIn || 0, turn.nHold || 0);
        push(turn.nOut || 0, turn.tIn || 0, turn.tOut || 0, turn.tBrake || 0);
    });
    at.palette = {};
    Object.entries(PALETTES).forEach(([key, colours]) => {
        at.palette[key] = { base: rows.length, count: colours.length };
        colours.forEach((c) => push(c[0], c[1], c[2]));
    });
    return { rows, at };
}

export const PEOPLE_TABLE = buildTable();
export const WORK_STEP = clipIndex('workStep');
export { TIMING as PEOPLE_TIMING };

/** The table as a uniform array for one material: `row(i)` reads row i (a float or int node). */
export function createPeopleTable() {
    const node = uniformArray(PEOPLE_TABLE.rows.map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w)), 'vec4');
    return {
        node,
        at: PEOPLE_TABLE.at,
        row: (i) => node.element(int(floor(i.add(0.5)))),
    };
}

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

/** A clip's table rows, by name. */
export function clipInfo(table, clip) {
    const r0 = table.row(clip.mul(3.0).add(table.at.clip)).toVar();
    const r1 = table.row(clip.mul(3.0).add(table.at.clip + 1)).toVar();
    const r2 = table.row(clip.mul(3.0).add(table.at.clip + 2)).toVar();
    return {
        base: r0.x,
        frames: r0.y,
        set: r0.z,
        kind: r0.w,
        seconds: r1.x,
        metres: r1.y,
        nIn: r1.z,
        nHold: r1.w,
        nOut: r2.x,
        tIn: r2.y,
        tOut: r2.z,
        tBrake: r2.w,
    };
}

/**
 * The two frames either side of `pos` (a frame position; looping clips wrap, the others stop at
 * their ends) and how far between them.
 */
export function framePick(frames, pos, wrap) {
    const f0Wrap = mod(floor(pos), frames);
    const f0Stop = clamp(floor(pos), 0.0, frames.sub(2.0));
    const f0 = select(wrap, f0Wrap, f0Stop).toVar();
    const wf = select(wrap, fract(pos), clamp(pos.sub(f0Stop), 0.0, 1.0)).toVar();
    const f1 = select(wrap, mod(f0.add(1.0), frames), f0.add(1.0));
    return {
        f0, f1, wf, near: select(wf.lessThan(0.5), f0, f1),
    };
}

/** Views cross-fade over this share of the gap between two, round its middle. */
const VIEW_BLEND = 0.34;

/**
 * The two views of a set either side of `rel` (degrees round the person from their face to the
 * camera, signed) and how far between them. An unsigned set is mirrored when the camera is on
 * the person's right; a signed set (a walker's turn) is mirrored by `endMirror` (the room's left
 * end), its angle turned over with it.
 */
export function viewPick(table, set, rel, endMirror) {
    const a = table.row(set.mul(2.0).add(table.at.views)).toVar();
    const b = table.row(set.mul(2.0).add(table.at.views + 1)).toVar();
    const count = b.y;
    const signed = b.z.greaterThan(0.5);
    const mirror = select(signed, endMirror, rel.lessThan(0.0));
    const angle = select(signed, select(endMirror, rel.negate(), rel), abs(rel)).toVar();
    const angles = [a.x, a.y, a.z, a.w, b.x];
    // A continuous view index: the share of each gap the angle has passed.
    let index = float(0.0);
    for (let k = 0; k < MAX_VIEWS - 1; k++) {
        const gap = max(angles[k + 1].sub(angles[k]), 1.0);
        const share = clamp(angle.sub(angles[k]).div(gap), 0.0, 1.0).mul(step(k + 1.5, count));
        index = index.add(share);
    }
    const v0 = min(floor(index), count.sub(1.0)).toVar();
    const wv = smoothstep(0.5 - VIEW_BLEND * 0.5, 0.5 + VIEW_BLEND * 0.5, index.sub(v0)).toVar();
    const v1 = min(v0.add(1.0), count.sub(1.0));
    return {
        v0, v1, wv, mirror, near: select(wv.lessThan(0.5), v0, v1),
    };
}

/**
 * Read a person from the sheets (`sheets.sheet`, `sheets.masks`: TextureNodes whose value is
 * swapped when the images arrive): up to four cells of their clip `X` (two frames by two views,
 * `X` = { base, frames, f0, f1, wf, v0, v1, wv }) cross-faded, and one cell `Y` = { cell, w }
 * faded over them (the cook stepping between working and walking). (cu, cv) the point in the
 * cell; `foot` metres a pixel covers. Returns coverage, view-space normal (x toward the image's
 * right), ink, occlusion and class weights.
 */
export function readPerson(sheets, X, Y, cu, cv, foot) {
    const du = min(foot.div(CELL_W * COLS), 4.0 / (COLS * PEOPLE_SHEET.cellPixels[0]));
    const dv = min(foot.div(CELL_H * ROWS), 4.0 / (ROWS * PEOPLE_SHEET.cellPixels[1]));
    const gx = vec2(du, 0.0);
    const gy = vec2(0.0, dv);
    const gxm = gx.mul(0.5);
    const s = vec4(0.0).toVar();
    const left = vec4(0.0).toVar();
    const right = vec4(0.0).toVar();
    const total = float(0.0).toVar();
    Loop(5, ({ i }) => {
        const k = float(i);
        const fb = mod(k, 2.0);
        const vb = step(1.5, k);
        const cellX = X.base.add(mix(X.v0, X.v1, vb).mul(X.frames)).add(mix(X.f0, X.f1, fb));
        const wX = mix(float(1.0).sub(X.wf), X.wf, fb).mul(mix(float(1.0).sub(X.wv), X.wv, vb))
            .mul(float(1.0).sub(Y.w));
        const isY = k.greaterThan(3.5);
        const cell = select(isY, Y.cell, cellX);
        const w = select(isY, Y.w, wX);
        If(w.greaterThan(0.003), () => {
            s.addAssign(sheets.sheet.sample(cellUV(cell, cu, cv)).grad(gx, gy).mul(w));
            const mUV = cellUV(cell, cu, cv);
            left.addAssign(sheets.masks.sample(vec2(mUV.x.mul(0.5), mUV.y)).grad(gxm, gy).mul(w));
            right.addAssign(sheets.masks.sample(vec2(mUV.x.mul(0.5).add(0.5), mUV.y)).grad(gxm, gy).mul(w));
            total.addAssign(w);
        });
    });
    const inv = float(1.0).div(max(total, 1e-4));
    s.mulAssign(inv);
    left.mulAssign(inv);
    right.mulAssign(inv);
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
 * A walker crossing the room and back. Each way: the turn out of the stand at one end (a quarter
 * turn, then the first step, speeding up over half a step), the walk, the turn in at the other
 * end (the last step braking over half a step, then a quarter turn to the street) and the hold
 * there for `pause` seconds. The path is a whole number of strides long and centred in the room,
 * so the walk leaves the turn on the stride's first frame and arrives on its middle one, which is
 * where the turn clip takes over (it is mirrored at the left end, the walk walking left the other
 * way round).
 *
 * `metres` is a stride, `v` the walk's speed, `turn` the turn clip's rows (`clipInfo`). Returns x
 * (metres from the room's left), whether they are walking, the walk's phase, the turn clip's
 * frame position, whether the turn is drawn mirrored and the way they walk (+1 toward +x).
 */
export function walkerState(time, roomW, seed, metres, v, pause, turn) {
    const {
        nIn, nHold, nOut, tIn, tOut, tBrake,
    } = turn;
    const D = metres.mul(0.25);
    const loops = max(floor(max(roomW.sub(0.8), metres).div(metres)), 1.0);
    const L = loops.mul(metres).toVar();
    const x0 = roomW.sub(L).mul(0.5);
    const cruise = L.sub(D.mul(2.0)).toVar();
    const tC = cruise.div(v).toVar();
    const half = tOut.add(tC).add(tIn).add(pause).toVar();
    const tau = mod(time.add(seed.mul(97.0)), half.mul(2.0));
    const back = step(half, tau).toVar();
    const t = tau.sub(back.mul(half)).toVar();
    const dir = float(1.0).sub(back.mul(2.0));
    const from = x0.add(back.mul(L));
    const t1 = t.sub(tOut).toVar();
    const t2 = t1.sub(tC).toVar();
    const t3 = t2.sub(tIn);
    const inOut = t.lessThan(tOut);
    const inCruise = t1.lessThan(tC);
    const inIn = t2.lessThan(tIn);
    // Distance from where this way started: speeding up, walking, braking, stood.
    const ta = max(t.sub(tOut.sub(tBrake)), 0.0);
    const sOut = v.mul(ta).mul(ta).div(tBrake.mul(2.0));
    const sCruise = D.add(v.mul(t1));
    const tb = clamp(t2, 0.0, tBrake);
    const sIn = D.add(cruise).add(v.mul(tb)).sub(v.mul(tb).mul(tb).div(tBrake.mul(2.0)));
    const s = select(inOut, sOut, select(inCruise, sCruise, select(inIn, sIn, L)));
    const outPos = nIn.add(nHold).add(t.div(tOut).mul(nOut.sub(1.0)));
    const inPos = t2.div(tIn).mul(nIn);
    const holdPos = nIn.add(clamp(t3.div(pause), 0.0, 1.0).mul(nHold));
    // The turn clip is drawn at the room's right end (mirrored at the left): the turn out is where
    // this way began, the turn in and the hold where it ends.
    const atRight = select(inOut, back, float(1.0).sub(back));
    return {
        x: from.add(dir.mul(s)),
        walking: inOut.not().and(inCruise),
        walkPhase: v.mul(t1).div(metres),
        turnPos: select(inOut, outPos, select(inIn, inPos, holdPos)),
        endMirror: atRight.lessThan(0.5),
        dir,
    };
}

/** The bearing (radians) of the camera seen from a person, 0 = straight out of the window. */
export const cameraBearing = (dir) => atan(dir.x.negate(), dir.y);

/** Degrees round a person facing `facing` (radians) to the camera at `bearing`, in -180..180. */
export function relAngle(bearing, facing) {
    const rel = bearing.sub(facing);
    return rel.sub(floor(rel.div(Math.PI * 2).add(0.5)).mul(Math.PI * 2)).mul(180 / Math.PI);
}

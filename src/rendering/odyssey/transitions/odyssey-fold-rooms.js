/**
 * THE FOLD'S ROOMS — chapter 7's other dimension (2026-10-26; eight places since the masterpiece
 * pass, 2026-11-17, nine and a room per orb since the fold grew longer the same day;
 * docs/ODYSSEY_CH7_FOLD_2026-10.md). Every orb inside the hole sits in a room of
 * the fold that is a PLACE of its own (chapter-environments/odyssey-fold-places.tsl.js), borrowing
 * its theme's mood, and travelling between orbs is watching the next room open through this one.
 * One pure function of path progress: which place the eye is in, which is next and how far it
 * has opened, anchored on where the orbs really park; and how the room is held in the world while
 * the eye turns in it.
 */
import { getLevelRegistry } from '../../../core/odyssey/LevelRegistry.js';
import { resolveOrbParkProgress } from '../odyssey-chapter-arrival.js';
import { foldStretchMeasure } from './odyssey-fold-stretch.js';

/** The places the fold is made of (the shader's branch values: odyssey-fold-places.tsl.js). */
export const CH7_FOLD_PLACE_IDS = Object.freeze({
    tide: 0,
    lattice: 1,
    nave: 2,
    flock: 3,
    stairs: 4,
    jewel: 5,
    paint: 6,
    hall: 7,
    cradle: 8,
});

/**
 * The rooms, in orb order. `place`: what the room is. `door`: where it opens from as the eye
 * comes in from the room before (tangents of the view angle: right, up), never the same spot
 * twice. `cage`: the light of the hypercube round its orbs. A room with no orbs is anchored at
 * `exitAt` of the chapter instead: the way out.
 *
 * Every orb has a room of its own (2026-11-17: the fold is longer and its orbs far apart; orb 50
 * used to share orb 49's park and its tide, and has the star cradle now).
 */
export const CH7_FOLD_ROOMS = Object.freeze([
    Object.freeze({
        orbs: [49], theme: 'Fluid Dreams', place: 'tide', door: [0, 0], cage: [0.50, 0.95, 0.92],
    }),
    Object.freeze({
        orbs: [50], theme: 'Nebula Flow', place: 'cradle', door: [0.24, -0.16], cage: [0.98, 0.66, 0.84],
    }),
    Object.freeze({
        orbs: [51], theme: 'Chiral Gold', place: 'lattice', door: [-0.30, 0.16], cage: [1.0, 0.74, 0.30],
    }),
    Object.freeze({
        orbs: [52], theme: 'Voltage Storm', place: 'nave', door: [0.30, 0.10], cage: [0.60, 0.80, 1.0],
    }),
    Object.freeze({
        orbs: [53], theme: 'Murmuration', place: 'flock', door: [-0.20, -0.22], cage: [0.92, 0.86, 1.0],
    }),
    Object.freeze({
        orbs: [54], theme: 'Serenity Warp', place: 'stairs', door: [0.26, 0.20], cage: [0.74, 0.62, 1.0],
    }),
    Object.freeze({
        orbs: [55], theme: 'Kaleidosonic', place: 'jewel', door: [-0.30, -0.10], cage: [1.0, 0.92, 0.86],
    }),
    Object.freeze({
        orbs: [56], theme: 'Chromatic Impasto', place: 'paint', door: [0.20, -0.20], cage: [1.0, 0.82, 0.60],
    }),
    // THE WAY OUT: no orb of its own; past orb 56, as the mouth opens onto the city, a hall opens
    // from where the mouth will be and straightens into the city's neon grid.
    Object.freeze({
        orbs: [], exitAt: 0.907, theme: 'The way out', place: 'hall', door: [0, 0], cage: [1.0, 0.40, 0.80],
    }),
]);

/** Across the stretch between two rooms' orbs, the next room opens over [lead, 1 - lead] of it
 * (measured in the world: the fold's rail is longer than its share of progress). */
export const CH7_FOLD_ROOM_MORPH = Object.freeze({ lead: 0.2 });

/** The hall straightens (a round tube into walls, floor and roof) over this stretch of the chapter (local). */
export const CH7_FOLD_STRAIGHTEN = Object.freeze({ from: 0.868, to: 0.93 });

let cached = null;

/**
 * Where each room's first orb parks (path progress), from the live presentation layout.
 * @param {number[]} chapterPositions
 * @param {object} [layout] a presentation layout (`levelPositionsById`); the registry's by default
 * @returns {number[]|null}
 */
export function resolveFoldRoomAnchors(chapterPositions, layout = null) {
    const source = layout ?? getLevelRegistry().getPresentationLayout?.();
    const byId = source?.levelPositionsById;
    if (!byId || !Array.isArray(chapterPositions)) return null;
    const key = `${chapterPositions.join(',')}|${CH7_FOLD_ROOMS.map((r) => byId[r.orbs[0]]).join(',')}`;
    if (!layout && cached?.key === key) return cached.anchors;
    const anchors = CH7_FOLD_ROOMS.map((room) => {
        if (!room.orbs.length) {
            return chapterPositions[6] + ((chapterPositions[7] - chapterPositions[6]) * room.exitAt);
        }
        const parks = room.orbs.map((id) => resolveOrbParkProgress(7, Number(byId[id]), chapterPositions));
        return Math.min(...parks);
    });
    if (anchors.some((a) => !Number.isFinite(a))) return null;
    if (!layout) cached = { key, anchors };
    return anchors;
}

const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/**
 * The fold's room at path progress `p`: the place the eye is in, the next one and how far it has
 * opened through this one (`morph`), where it opens from (`door`), how far the room is the way
 * out (`exit`) and how far the hall has straightened (`straight`). Before the first room's orb it
 * is the first room; past the last, the last.
 * @param {number} p path progress
 * @param {number[]|null} anchors resolveFoldRoomAnchors
 * @param {number[]|null} [chapterPositions] for the hall's straightening (none: straight)
 * @returns {{ index: number, placeA: number, placeB: number, morph: number, door: number[],
 *   exit: number, straight: number }}
 */
export function resolveFoldRoom(p, anchors, chapterPositions = null) {
    const rooms = CH7_FOLD_ROOMS;
    let i = 0;
    let w = 0;
    if (Array.isArray(anchors) && anchors.length === rooms.length && Number.isFinite(p)) {
        while (i < rooms.length - 1 && p >= anchors[i + 1]) i += 1;
        if (i < rooms.length - 1 && p > anchors[i]) {
            // (In the world: on the fold's longer rail a unit of progress covers more of it.)
            const m = (x) => foldStretchMeasure(x, chapterPositions);
            const u = (m(p) - m(anchors[i])) / Math.max(1e-9, m(anchors[i + 1]) - m(anchors[i]));
            const { lead } = CH7_FOLD_ROOM_MORPH;
            w = smooth((u - lead) / (1 - (2 * lead)));
        }
    }
    const a = rooms[i];
    const b = rooms[Math.min(rooms.length - 1, i + 1)];
    const { hall } = CH7_FOLD_PLACE_IDS;
    const isHall = (room) => (CH7_FOLD_PLACE_IDS[room.place] === hall ? 1 : 0);
    let straight = 1;
    const ch7 = chapterPositions?.[6];
    const ch8 = chapterPositions?.[7];
    if (Number.isFinite(ch7) && Number.isFinite(ch8) && ch8 > ch7 && Number.isFinite(p)) {
        const local = (p - ch7) / (ch8 - ch7);
        straight = smooth((local - CH7_FOLD_STRAIGHTEN.from) / (CH7_FOLD_STRAIGHTEN.to - CH7_FOLD_STRAIGHTEN.from));
    }
    return {
        index: i + w,
        placeA: CH7_FOLD_PLACE_IDS[a.place],
        placeB: CH7_FOLD_PLACE_IDS[b.place],
        morph: w,
        door: b.door,
        exit: isHall(a) + ((isHall(b) - isHall(a)) * w),
        straight,
    };
}

/**
 * A ROOM OPENS IN TIME WITH THE EYE. What is SHOWN follows where the eye is (`resolveFoldRoom`),
 * never faster than `rate` rooms a second, easing in (`ease` seconds): on a ride along the rail
 * (every trip between the fold's orbs is one) the next room opens through this one as the eye
 * travels toward its orb; where the progress jumps instead (a jump on the map, a return from a
 * game) the room opens on its own over about a second. A jump of more than a room does not run
 * through the rooms between: the eye's room opens straight through the one shown, over `seconds`
 * (and `hurry` times as fast when the eye moves on again before it is done). The way out alone,
 * from the last orb's room on, opens exactly as far as the eye has travelled toward the mouth.
 */
export const CH7_FOLD_OPENING = Object.freeze({
    rate: 1.1,
    ease: 0.22,
    seconds: 1.4,
    hurry: 3,
    /** A jump past this many rooms opens straight through. */
    far: 1.25,
});

/** What is shown, to begin with: nothing yet (the first frame takes the eye's room whole). */
export function createFoldShow() {
    return {
        live: false, at: 0, jump: null, from: 0, to: 0, morph: 0, door: [0, 0], exit: 0,
    };
}

const placeOf = (room) => {
    const index = Math.min(CH7_FOLD_ROOMS.length - 1, Math.max(0, room));
    return CH7_FOLD_PLACE_IDS[CH7_FOLD_ROOMS[index].place];
};

/** Write what a room position (`at`: room index plus how far the next has opened) shows. */
function showAt(show, at) {
    const last = CH7_FOLD_ROOMS.length - 1;
    const i = Math.min(last, Math.max(0, Math.floor(at + 1e-9)));
    const w = Math.min(1, Math.max(0, at - i));
    show.from = placeOf(i);
    show.to = w > 1e-4 ? placeOf(i + 1) : show.from;
    show.morph = show.from === show.to ? 0 : w;
    show.door = CH7_FOLD_ROOMS[Math.min(last, i + 1)].door;
}

/**
 * Advance what is shown one frame toward where the eye is.
 * @param {ReturnType<typeof createFoldShow>} show the state (mutated and returned)
 * @param {{ index: number }} target resolveFoldRoom at the eye's progress
 * @param {number} dt seconds
 * @param {{ snap?: boolean }} [opts] `snap`: take the eye's room whole (the first frame inside,
 *   a jump in from outside the hole)
 * @returns {typeof show} `from`, `to`: the places (ids); `morph` 0..1: how far `to` has opened
 *   through `from` (0 with from === to: settled); `door`: where it opens from; `exit`: how far
 *   what is shown is the way out
 */
export function advanceFoldShow(show, target, dt, { snap = false } = {}) {
    const O = CH7_FOLD_OPENING;
    const last = CH7_FOLD_ROOMS.length - 1;
    const goal = Number.isFinite(target?.index) ? Math.min(last, Math.max(0, target.index)) : show.at;
    const step = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const { hall } = CH7_FOLD_PLACE_IDS;
    if (!show.live || snap) {
        show.live = true;
        show.at = goal;
        show.jump = null;
    } else if (show.jump) {
        // Opening straight through after a long jump.
        const J = show.jump;
        const hurried = Math.abs(goal - J.at) > 0.5 ? O.hurry : 1;
        J.clock = Math.min(1, J.clock + ((step / O.seconds) * hurried));
        if (J.clock >= 1) {
            show.at = J.at;
            show.jump = null;
        }
    } else if (goal >= last - 1 && show.at >= last - 1 - 1e-6) {
        // THE WAY OUT, in step with the rail (as before): from the last orb's room on, the hall
        // has opened exactly as far as the eye has travelled toward it.
        show.at = goal;
    } else if (Math.abs(goal - show.at) > O.far) {
        // The eye's nearest room opens straight through the one shown.
        const shownRoom = Math.round(show.at);
        const at = Math.round(goal);
        show.jump = {
            from: placeOf(shownRoom), to: placeOf(at), at, clock: 0, door: CH7_FOLD_ROOMS[at].door,
        };
    } else {
        // In time with the eye: eased, and no faster than `rate`.
        const want = (goal - show.at) * (1 - Math.exp(-step / O.ease));
        const most = O.rate * step;
        show.at += Math.max(-most, Math.min(most, want));
        if (Math.abs(goal - show.at) < 1e-5) show.at = goal;
    }
    if (show.jump) {
        const J = show.jump;
        show.from = J.from;
        show.to = J.to;
        show.morph = J.from === J.to ? 0 : smooth(J.clock);
        show.door = J.door;
    } else {
        showAt(show, show.at);
    }
    show.exit = ((show.from === hall ? 1 : 0) * (1 - show.morph)) + ((show.to === hall ? 1 : 0) * show.morph);
    return show;
}

/**
 * THE ROOM IS HELD IN THE WORLD. The fold is drawn from the view ray, so it used to follow the
 * gaze exactly: when the eye turned (the rail bending on a glide, the look-around, the orb
 * close-up swinging in) the room turned with it, like a picture pasted on the lens. The room now
 * has an orientation of its own in the world. It lets the eye turn freely within `free` degrees
 * of it, follows more and more firmly out to `firm`, and is never left more than `most` behind:
 * so the eye looks about IN the room, a glide swings the room past, and where the room comes to
 * rest depends on how the eye came in (no two visits quite alike). Reduced motion locks it to the
 * view, as it was.
 */
export const CH7_FOLD_HOLD = Object.freeze({
    free: 5,
    firm: 22,
    most: 30,
    /** How fast it follows once firm (1 / s). */
    rate: 3.2,
});

/**
 * Advance the room's hold one frame: the angle (degrees) the room is left behind the view by.
 * Pure: `lag` in, `lag` out, for an eye that has just turned so that the room is `lag` behind.
 * @param {number} lag degrees the room is behind the view after this frame's turn of the eye
 * @param {number} dt seconds
 * @returns {number} the degrees it is left behind once the room has followed
 */
export function followFoldRoom(lag, dt) {
    const H = CH7_FOLD_HOLD;
    if (!(lag > 0) || !Number.isFinite(lag)) return 0;
    const step = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const firmness = smooth((lag - H.free) / (H.firm - H.free));
    const followed = lag * Math.exp(-H.rate * firmness * step);
    return Math.min(H.most, followed);
}

/** The hypercube round each orb (step 4): its size (half-width at rest; the orb's glass is ~2.1
 * across), and how it fades near the eye (so a cage never sweeps through the lens) and far off. */
export const CH7_FOLD_CAGE = Object.freeze({
    size: 3.4,
    nearFrom: 10,
    nearTo: 28,
    farFrom: 260,
    farTo: 420,
    /** ...and they are gone as the mouth opens onto the city (local chapter-7 progress). */
    outFrom: 0.86,
    outTo: 0.95,
});

/**
 * The hypercube cages round the orbs inside the hole: for each orb of every room, its centre,
 * size, presence (the fold, eased near the eye and far off) and its room's light.
 * @param {number} fold the fall's fold (0..1)
 * @param {{x:number,y:number,z:number}} eye camera position
 * @param {(id: number) => ({x:number,y:number,z:number}|null)} positionOf an orb's world position
 * @param {number} [local] chapter 7's local progress (the cages leave as the mouth opens)
 * @returns {Array<{ id: number, position: *, size: number, presence: number, phase: number,
 *   colour: { r: number, g: number, b: number } }>}
 */
export function foldHypercubeCages(fold, eye, positionOf, local = 0) {
    const C = CH7_FOLD_CAGE;
    const cages = [];
    const out = 1 - smooth(((Number.isFinite(local) ? local : 0) - C.outFrom) / (C.outTo - C.outFrom));
    if (!(fold > 0) || !(out > 0) || !eye || typeof positionOf !== 'function') return cages;
    CH7_FOLD_ROOMS.forEach((room) => {
        const [r, g, b] = room.cage;
        room.orbs.forEach((id) => {
            const position = positionOf(id);
            if (!position) return;
            const d = Math.hypot(position.x - eye.x, position.y - eye.y, position.z - eye.z);
            const near = smooth((d - C.nearFrom) / (C.nearTo - C.nearFrom));
            const far = 1 - smooth((d - C.farFrom) / (C.farTo - C.farFrom));
            const presence = fold * out * near * far;
            if (presence <= 0.001) return;
            cages.push({
                id, position, size: C.size, presence, phase: id * 1.37, colour: { r, g, b },
            });
        });
    });
    return cages;
}

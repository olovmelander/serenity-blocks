/**
 * THE FOLD'S ROOMS — chapter 7's other dimension, step 3 (2026-10-26;
 * docs/ODYSSEY_CH7_FOLD_2026-10.md). Every orb inside the hole sits in a room of the fold that
 * borrows its theme's mood, and travelling between orbs is watching the space morph from one room
 * into the next. One pure function of path progress: the crystals' shape (two shapes and the
 * morph between them), the palette and the depths, anchored on where the orbs really park.
 */
import { getLevelRegistry } from '../../../core/odyssey/LevelRegistry.js';
import { resolveOrbParkProgress } from '../odyssey-chapter-arrival.js';

/** The crystals the fold can be made of (the shader's shape ids). */
export const CH7_FOLD_SHAPES = Object.freeze({
    tesseract: 0,
    diamond: 1,
    tetromino: 2,
    orbs: 3,
    swarm: 4,
});

/**
 * The rooms, in orb order. `shape`: the crystals. `hue`, `spread`: the film's base hue and its
 * step from one ring of crystals to the next (turns). `tint`, `tintMix`: a colour the film is
 * pulled toward. `nebula`, `nebulaHue`: the depths' strength (x the base) and hue. `crackle`:
 * how far the gates break into crawling arcs of light (Voltage Storm). `grid`: how far the walls'
 * hexagonal panes have straightened into a square neon grid (the way out). A room with no orbs is
 * anchored at `exitAt` of the chapter instead.
 */
export const CH7_FOLD_ROOMS = Object.freeze([
    Object.freeze({
        orbs: [49, 50],
        theme: 'Fluid Dreams, Nebula Flow',
        shape: 'orbs',
        hue: 0.52,
        spread: 0.07,
        tint: [0.6, 0.9, 1.0],
        tintMix: 0.0,
        nebula: 1.6,
        nebulaHue: 0.62,
        crackle: 0,
        grid: 0,
    }),
    Object.freeze({
        orbs: [51],
        theme: 'Chiral Gold',
        shape: 'diamond',
        hue: 0.08,
        spread: 0.02,
        tint: [1.0, 0.70, 0.28],
        tintMix: 0.7,
        nebula: 0.55,
        nebulaHue: 0.08,
        crackle: 0,
        grid: 0,
    }),
    Object.freeze({
        orbs: [52],
        theme: 'Voltage Storm',
        shape: 'tesseract',
        hue: 0.62,
        spread: 0.03,
        tint: [0.55, 0.78, 1.0],
        tintMix: 0.55,
        nebula: 1.0,
        nebulaHue: 0.64,
        crackle: 1,
        grid: 0,
    }),
    Object.freeze({
        orbs: [53],
        theme: 'Murmuration',
        shape: 'swarm',
        hue: 0.74,
        spread: 0.04,
        tint: [0.88, 0.86, 1.0],
        tintMix: 0.5,
        nebula: 1.3,
        nebulaHue: 0.78,
        crackle: 0,
        grid: 0,
    }),
    Object.freeze({
        orbs: [54],
        theme: 'Serenity Warp',
        shape: 'tetromino',
        hue: 0.66,
        spread: 0.11,
        tint: [0.7, 0.6, 1.0],
        tintMix: 0.0,
        nebula: 1.0,
        nebulaHue: 0.7,
        crackle: 0,
        grid: 0,
    }),
    Object.freeze({
        orbs: [55],
        theme: 'Kaleidosonic',
        shape: 'tesseract',
        hue: 0.0,
        spread: 0.17,
        tint: [1, 1, 1],
        tintMix: 0.0,
        nebula: 1.2,
        nebulaHue: 0.9,
        crackle: 0,
        grid: 0,
    }),
    Object.freeze({
        orbs: [56],
        theme: 'Chromatic Impasto',
        shape: 'orbs',
        hue: -0.03,
        spread: 0.23,
        tint: [1, 1, 1],
        tintMix: 0.0,
        nebula: 1.8,
        nebulaHue: 0.02,
        crackle: 0,
        grid: 0,
    }),
    // THE WAY OUT (step 5): no orb of its own; past orb 56, as the mouth opens onto the city, the
    // walls' panes straighten into the city's square neon grid and the light turns synthwave.
    Object.freeze({
        orbs: [],
        exitAt: 0.907,
        theme: 'The way out',
        shape: 'tesseract',
        hue: 0.88,
        spread: 0.02,
        tint: [1.0, 0.32, 0.78],
        tintMix: 0.6,
        nebula: 0.25,
        nebulaHue: 0.85,
        crackle: 0,
        grid: 1,
    }),
]);

/** Across the stretch between two rooms' orbs, the morph runs over [lead, 1 - lead] of it. */
export const CH7_FOLD_ROOM_MORPH = Object.freeze({ lead: 0.2 });

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

const lerp = (a, b, t) => a + ((b - a) * t);

/**
 * The fold's room at path progress `p`: the two shapes and the morph between them, and the room's
 * palette and depths, blended. Before the first room's orb it is the first room; past the last,
 * the last.
 * @param {number} p path progress
 * @param {number[]|null} anchors resolveFoldRoomAnchors
 * @returns {{ index: number, shapeA: number, shapeB: number, morph: number, hue: number,
 *   spread: number, tint: number[], tintMix: number, nebula: number, nebulaHue: number,
 *   crackle: number, grid: number }}
 */
export function resolveFoldRoom(p, anchors) {
    const rooms = CH7_FOLD_ROOMS;
    let i = 0;
    let w = 0;
    if (Array.isArray(anchors) && anchors.length === rooms.length && Number.isFinite(p)) {
        while (i < rooms.length - 1 && p >= anchors[i + 1]) i += 1;
        if (i < rooms.length - 1 && p > anchors[i]) {
            const u = (p - anchors[i]) / Math.max(1e-6, anchors[i + 1] - anchors[i]);
            const { lead } = CH7_FOLD_ROOM_MORPH;
            w = smooth((u - lead) / (1 - (2 * lead)));
        }
    }
    const a = rooms[i];
    const b = rooms[Math.min(rooms.length - 1, i + 1)];
    return {
        index: i + w,
        shapeA: CH7_FOLD_SHAPES[a.shape],
        shapeB: CH7_FOLD_SHAPES[b.shape],
        morph: w,
        hue: lerp(a.hue, b.hue, w),
        spread: lerp(a.spread, b.spread, w),
        tint: a.tint.map((c, k) => lerp(c, b.tint[k], w)),
        tintMix: lerp(a.tintMix, b.tintMix, w),
        nebula: lerp(a.nebula, b.nebula, w),
        nebulaHue: lerp(a.nebulaHue, b.nebulaHue, w),
        crackle: lerp(a.crackle, b.crackle, w),
        grid: lerp(a.grid, b.grid, w),
    };
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

const film = (t) => [0, 0.27, 0.58].map((o) => 0.55 + (0.45 * Math.cos(2 * Math.PI * (t + o))));

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
        const [r, g, b] = room.tintMix > 0.3
            ? room.tint
            : film(room.hue + 0.33);
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

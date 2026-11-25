/**
 * THE ISLAND'S UNDERWATER FLANK (Odyssey masterpiece pass, 2026-11-17) — a landscape to rise past.
 *
 * The audit: "There is no seabed, no landmark, no landscape: only water and animals." The bed IS
 * there (the island's flank climbs at 45 degrees from the 190 u plain under the column to the
 * shore 200 u away), but it was bare rippled sand, and every orb's close-up looks straight at it.
 * This plants it, as meshes of their own standing on the drawn bed (the height field is not
 * touched):
 *
 *   THE KELP TOWER  one seamount off the flank, straight ahead of every close-up: rock from the
 *                   slope up to ~44 u under the surface, a kelp forest on its crown reaching for
 *                   the light and laying its canopy under the surface. Orbs 7 to 10 look at it
 *                   from four heights (its foot, its wall, its crown, its forest).
 *   PINNACLES       sea stacks up the flank, layered by the water into plates.
 *   BOULDERS        the scree at the slope's foot and between the stacks.
 *   CORAL           heads, tables, fans and staghorn on the tower's shoulders, the stacks' tops
 *                   and the shelf under the shore: the colour near the top.
 *   KELP            the tower's forest and groves on the shelf.
 *
 * WHERE. Placed against the real cameras (tests/unit/helpers/odyssey-camera-rig.js and the orb
 * close-ups' poses): the close-ups look along -z, a little down, from x ~ -3; the flank between
 * z -70 and -180 lies 90-200 u ahead of them and fills their frames, each orb a different band of
 * it. Nothing stands where an animal swims: every site is tested against the roaming routes
 * (odyssey-ocean-roam.js) and the fish rings with their bodies' sizes, at the depths they keep,
 * and against the rail's corridor. Deterministic (seeded) and pure; the materials are the
 * renderer's (odyssey-ocean-scenery.js).
 */

import * as THREE from 'three/webgpu';
import { OCEAN_COLUMN, OCEAN_ROAM, roamAt } from '../composition/odyssey-ocean-roam.js';
import { CORAL_FORMS, makeLifeSink } from './odyssey-ocean-coral.js';
import { DOLPHIN_POD, dolphinLoopPoints } from '../composition/odyssey-dolphin-pod.js';

export const OCEAN_REEF = Object.freeze({
    /** The hero seamount. */
    tower: Object.freeze({
        x: -12, z: -86, topDepth: 44, topRadius: 11, baseRadius: 31, stipes: 34, kelpRadius: 8.5,
    }),
    /** The flank the reef is planted on (world xz), and the wedge the close-ups see of it. */
    flank: Object.freeze({
        x: [-105, 85], z: [-178, -72],
    }),
    pinnacles: 11,
    boulders: 34,
    /**
     * THE DEEP GARDEN: colonies of cold, glowing life on rock outcrops at the slope's foot, each
     * a hero piece with smaller ones round it and bare sand between (world xz, hero form). Placed
     * in the first three orbs' close-ups: orb 6 looks at the foot of the slope, orb 7 up it,
     * orb 8 at the tower's wall.
     */
    deepColonies: Object.freeze([
        Object.freeze([26, -25, 'tree']), Object.freeze([52, -46, 'fan']), Object.freeze([-31, -66, 'tubes']),
        Object.freeze([9, -57, 'anemone']), Object.freeze([35, -73, 'pen']), Object.freeze([-58, -50, 'fan']),
        Object.freeze([64, -18, 'tubes']), Object.freeze([-34, -36, 'pen']), Object.freeze([-14, -60, 'tree']),
        Object.freeze([-64, -82, 'anemone']), Object.freeze([44, -98, 'tree']),
    ]),
    /**
     * THE NEEDLE (2026-11-25): a slim stack on the slope between the column and the tower, its
     * crown 104 u down. The close-ups of orbs 7 to 9 look along -z, and everything of the reef
     * stood 90-180 u from them, where the water has taken its colour: a frame of far, dim shapes
     * and no subject. The needle stands 70-80 u off, on the free side of each frame (screen left
     * of the orb): its foot and wall behind orb 7, its crown garden beside orb 8, its crown from
     * above under orb 9, with the tower a plate behind it and the stacks a plate behind that.
     * Its crown stays under the cruising school's ring (which swims the water above y 190 there).
     */
    needle: Object.freeze({
        x: -42,
        z: -48,
        topDepth: 104,
        topRadius: 5.2,
        baseRadius: 13.5,
        leanX: 0.07,
        leanZ: 0.09,
        seed: 77,
        /** The radius (u) of the patch of light the shaft over it lays on its crown. */
        spot: 9.5,
    }),
    /**
     * THE ARCH: a low rock arch at the slope's foot, beside orb 6's close-up (which sees only the
     * bed, 40-65 u off), with a lit garden under it. Its feet (world xz), its rise over the
     * higher foot and its thickness (u).
     */
    arch: Object.freeze({
        feet: Object.freeze([Object.freeze([-30, -27]), Object.freeze([-16, -33])]), rise: 10.5, thick: 2.2, seed: 41,
    }),
    /** Small growth on the sand between the arch and orb 6's eye: world xz, size (u), form. */
    archTrail: Object.freeze([
        Object.freeze([-31, -17, 2.4, 'pen']), Object.freeze([-23, -15, 1.9, 'anemone']),
        Object.freeze([-19, -9, 1.8, 'pen']), Object.freeze([-12, -13, 1.6, 'anemone']),
    ]),
    /** Pieces on the tower's wall facing the close-ups, and warm colonies in the light. */
    towerGarden: 9,
    shelfColonies: 7,
    groves: 9,
    stipesPerGrove: [7, 12],
    /** Nothing nearer than this to the submerged rail (u, horizontally), rocks' own radius added. */
    corridor: 30,
    /** How far under the surface the tallest kelp stops (the canopy lies there). */
    canopyDepth: 3.4,
    /** The current the canopy lies along (unit xz). */
    current: Object.freeze([0.8, 0.6]),
    /** The low tier keeps this share of the small things (the tower and the stacks stay). */
    lowShare: 0.5,
});

/** The animals that roam, with half their breadth and the reach of their bodies in depth (u). */
const ROAMERS = Object.freeze([
    Object.freeze({ route: OCEAN_ROAM.whaleShark, half: 7, up: 6 }),
    Object.freeze({ route: OCEAN_ROAM.manta, half: 13, up: 4 }),
    // The mother, and the calf's lane beside her (nearer the column, a little above).
    Object.freeze({ route: OCEAN_ROAM.whales, half: 16, up: 12 }),
]);

/** The fish rings round the rail (odyssey-fish.js FISH_SCHOOLS, the numbers that place them). */
const FISH_RINGS = Object.freeze([
    Object.freeze({
        f: 0.30, dy: 55, rx: 26, rz: 22, across: 5.6, reach: 9,
    }),
    Object.freeze({
        f: 0.55, dy: 50, rx: 30, rz: 24, across: 7.0, reach: 12,
    }),
    Object.freeze({
        f: 0.84, dy: 14, rx: 34, rz: 42, across: 7.0, reach: 9,
    }),
    Object.freeze({
        f: 0.40, dy: 30, rx: 62, rz: 52, across: 22, reach: 30,
    }),
]);

/** How far a colony's mound departs from a smooth swell (its noise, +-). */
const MOUND_ROUGH = 0.12;

/** A sea stack's crown and wall (the pinnacles'; the tower passes its own): how high the crown's dome
 * rises over its top (x its top radius), how far a ring swells or pinches, how rough the crown is. */
const STACK_FORM = Object.freeze({ dome: 0.55, pinch: 0.5, rough: 0.3 });

/** mulberry32. */
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const hash3 = (x, y, z) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t) => t * t * (3 - (2 * t));

/** Smooth value noise in 3-D, 0..1 (the rocks' displacement). */
export function reefNoise(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = fade(x - xi);
    const fy = fade(y - yi);
    const fz = fade(z - zi);
    const at = (i, j, k) => hash3(xi + i, yi + j, zi + k);
    const lerp = (a, b, t) => a + ((b - a) * t);
    return lerp(
        lerp(lerp(at(0, 0, 0), at(1, 0, 0), fx), lerp(at(0, 1, 0), at(1, 1, 0), fx), fy),
        lerp(lerp(at(0, 0, 1), at(1, 0, 1), fx), lerp(at(0, 1, 1), at(1, 1, 1), fx), fy),
        fz,
    );
}

/**
 * What a site must keep clear of: `blocked(x, z, radius, topDepth)` is true where something
 * `radius` wide whose top stands `topDepth` under the surface would be swum into, or would stand
 * in the rail's corridor.
 * @param {{ rail: {x:number,y:number,z:number}[], seaLevel: number }} options
 */
export function reefKeepOut({ rail, seaLevel }) {
    const paths = ROAMERS.map((a) => {
        const pts = [];
        const p = { x: 0, y: 0, z: 0 };
        // Long enough for the pace and the breathing to have walked the whole envelope.
        for (let t = 0; t < 2400; t += 0.75) {
            roamAt(a.route, t, p);
            pts.push(p.x, seaLevel - p.y, p.z);
        }
        return { ...a, pts };
    });
    const rings = FISH_RINGS.map((r) => {
        const anchor = rail[Math.min(rail.length - 1, Math.floor(r.f * rail.length))];
        const cy = Math.min(anchor.y + r.dy, seaLevel - 8 - r.reach);
        return {
            ...r, cx: anchor.x, cz: anchor.z, top: seaLevel - cy - r.reach - 3,
        };
    });
    // `y` (optional): a low thing on the bed is measured against the rail in space, not in plan
    // (the upper rail runs 150 u over the slope's foot; what grows down there is not in its way).
    // The dolphins' loop: they porpoise in the top of the water all the way round it.
    const dolphinWay = [...dolphinLoopPoints(5), ...dolphinLoopPoints(5, DOLPHIN_POD.scouts)];
    const dolphinSide = Math.max(...DOLPHIN_POD.dolphins.map((d) => Math.abs(d.side))) + 3;
    const dolphinDeep = Math.max(...DOLPHIN_POD.dolphins.map((d) => (d.height * (1 - DOLPHIN_POD.leap)) / DOLPHIN_POD.leap)) + 6;
    const blockedBy = (x, z, radius, topDepth, y = null) => {
        for (let i = 0; i < rail.length; i += 1) {
            const up = y === null ? 0 : rail[i].y - y;
            if (Math.hypot(rail[i].x - x, rail[i].z - z, up) < OCEAN_REEF.corridor + radius) return 'rail';
        }
        for (let a = 0; a < paths.length; a += 1) {
            const { pts, half, up } = paths[a];
            const reach = radius + half + 2;
            for (let i = 0; i < pts.length; i += 3) {
                if (pts[i + 1] + up + 2 > topDepth && Math.hypot(pts[i] - x, pts[i + 2] - z) < reach) return 'roamer';
            }
        }
        if (topDepth < dolphinDeep) {
            for (let i = 0; i < dolphinWay.length; i += 1) {
                if (Math.hypot(dolphinWay[i].x - x, dolphinWay[i].z - z) < radius + dolphinSide) return 'dolphins';
            }
        }
        for (let i = 0; i < rings.length; i += 1) {
            const r = rings[i];
            const meanR = (r.rx + r.rz) / 2;
            const rho = Math.hypot((x - r.cx) / r.rx, (z - r.cz) / r.rz) * meanR;
            // A ring is open below its fish: a site is in it only where it reaches up into them.
            if (Math.abs(rho - meanR) < r.across + radius + 3 && topDepth < r.top + (2 * r.reach) + 6) return 'fish';
        }
        return null;
    };
    return { blocked: (x, z, radius, topDepth, y = null) => blockedBy(x, z, radius, topDepth, y) !== null, blockedBy };
}

/**
 * Where everything stands.
 * @param {{ heightAt: (x: number, z: number) => number, rail: {x:number,y:number,z:number}[],
 *   seaLevel: number, quality?: string, seed?: number }} options
 */
export function planOceanReef({
    heightAt, rail, seaLevel, quality = 'high', seed = 1117,
}) {
    const plan = {
        tower: null,
        needle: null,
        arch: null,
        pinnacles: [],
        boulders: [],
        mounds: [],
        corals: [],
        stipes: [],
        lights: [],
        spots: [],
    };
    if (!rail?.length || typeof heightAt !== 'function') return plan;
    const rnd = makeRng(seed);
    const share = quality === 'low' ? OCEAN_REEF.lowShare : 1;
    const keep = reefKeepOut({ rail, seaLevel });
    const R = OCEAN_REEF;
    const depthAt = (x, z) => seaLevel - heightAt(x, z);
    // The lowest of the bed under a footprint (its centre and a ring at `r`): a rock or a mound set by its
    // centre alone hung its downhill side over open water on the flank's 45 degrees, and from above, the
    // bed behind it lost in the haze, it read as floating (the chapter's audit, 2026-11-25).
    const bedUnder = (x, z, r) => {
        let low = heightAt(x, z);
        for (let k = 0; k < 8; k += 1) {
            const a = (k / 8) * Math.PI * 2;
            low = Math.min(low, heightAt(x + (Math.cos(a) * r), z + (Math.sin(a) * r)));
        }
        return low;
    };
    const flankPoint = () => ({
        x: R.flank.x[0] + (rnd() * (R.flank.x[1] - R.flank.x[0])),
        z: R.flank.z[0] + (rnd() * (R.flank.z[1] - R.flank.z[0])),
    });

    // ── the kelp tower ──
    const T = R.tower;
    const towerBed = heightAt(T.x, T.z);
    plan.tower = {
        x: T.x,
        z: T.z,
        baseY: towerBed - 14,
        topY: seaLevel - T.topDepth,
        baseR: T.baseRadius,
        topR: T.topRadius,
        seed: 31,
    };
    const rocks = [{ x: T.x, z: T.z, r: T.baseRadius }];
    const apart = (x, z, r, gap = 1.25) => rocks.every((o) => Math.hypot(o.x - x, o.z - z) > (o.r + r) * gap);

    // ── pinnacles up the flank ──
    for (let tries = 0; plan.pinnacles.length < R.pinnacles && tries < R.pinnacles * 80; tries += 1) {
        const { x, z } = flankPoint();
        const depth = depthAt(x, z);
        if (!(depth > 46 && depth < 150)) continue;
        const baseR = 9 + (rnd() * 12);
        // Tall where the bed is deep; the tops stop in the light but under the animals.
        const topDepth = Math.max(16, depth * (0.30 + (rnd() * 0.30)));
        if (depth - topDepth < 18) continue;
        if (!apart(x, z, baseR) || keep.blocked(x, z, baseR * 0.8, topDepth)) continue;
        plan.pinnacles.push({
            x,
            z,
            baseY: heightAt(x, z) - (baseR * 0.6),
            topY: seaLevel - topDepth,
            baseR,
            topR: baseR * (0.22 + (rnd() * 0.2)),
            seed: 100 + plan.pinnacles.length,
            leanX: (rnd() - 0.5) * 0.22,
            leanZ: (rnd() - 0.5) * 0.22,
        });
        rocks.push({ x, z, r: baseR });
    }

    // ── boulders: the scree at the slope's foot and between the stacks ──
    const boulderTarget = Math.round(R.boulders * share);
    for (let tries = 0; plan.boulders.length < boulderTarget && tries < boulderTarget * 60; tries += 1) {
        const foot = rnd() < 0.4;
        const x = R.flank.x[0] + (rnd() * (R.flank.x[1] - R.flank.x[0]));
        const z = foot ? -68 + (rnd() * 58) : R.flank.z[0] + (rnd() * (R.flank.z[1] - R.flank.z[0]));
        const depth = depthAt(x, z);
        if (!(depth > 14)) continue;
        const r = 3 + (rnd() * rnd() * 9);
        const topDepth = depth - (r * 1.1);
        if (topDepth < 6 || !apart(x, z, r, 0.8) || keep.blocked(x, z, r, topDepth)) continue;
        plan.boulders.push({
            x, y: bedUnder(x, z, r * 0.85) - (r * 0.2), z, r, squash: 0.55 + (rnd() * 0.45), seed: 300 + plan.boulders.length,
        });
        rocks.push({ x, z, r: r * 0.6 });
    }

    // ── coral and deep-sea life: colonies on rock, bare sand between ──
    const WARM = [
        [[0.95, 0.36, 0.46], [1.0, 0.72, 0.62]], [[1.0, 0.52, 0.20], [1.0, 0.82, 0.42]],
        [[0.62, 0.38, 0.92], [0.86, 0.70, 1.0]], [[0.96, 0.80, 0.28], [1.0, 0.95, 0.66]],
        [[0.24, 0.74, 0.66], [0.62, 0.98, 0.86]], [[0.98, 0.42, 0.72], [1.0, 0.76, 0.88]],
    ];
    // The cold lights of the deep: each colony takes one pair, so it reads as one growth.
    const COLD = [
        [[0.08, 0.72, 0.95], [0.60, 1.0, 1.0]], [[0.42, 0.28, 1.0], [0.80, 0.66, 1.0]],
        [[0.10, 0.92, 0.58], [0.66, 1.0, 0.80]], [[0.16, 0.48, 1.0], [0.60, 0.86, 1.0]],
        [[0.92, 0.24, 0.78], [1.0, 0.66, 0.92]],
    ];
    // ...and its warm ones (2026-11-25): amber and rose among the cold lights, so a garden in the dark is
    // not blue on blue. A colony still takes one pair.
    const EMBER = [
        [[1.5, 0.62, 0.17], [1.5, 1.12, 0.55]], [[1.45, 0.30, 0.52], [1.45, 0.92, 0.98]],
    ];
    const DEEP = [...COLD, ...EMBER];
    // A garden's light: its own colour, a little toward its accent (the water takes the red on
    // the way to the eye, so a pale warm light arrives green).
    const lightOf = (pair) => pair[0].map((v, c) => v + ((pair[1][c] - v) * 0.3));
    const pieceAt = (x, y, z, size, kind, pair, deep, yaw = rnd() * Math.PI * 2) => {
        plan.corals.push({
            x, y, z, size, kind, colour: pair[0], accent: pair[1], yaw, deep, depth: seaLevel - y, seed: plan.corals.length,
        });
    };
    const SMALL_DEEP = ['fan', 'tubes', 'anemone', 'pen', 'tree', 'dome'];
    const SMALL_WARM = ['dome', 'table', 'tree', 'fan', 'anemone', 'dome'];
    /** A colony: a low outcrop, its hero piece, and smaller pieces falling away round it. */
    const colonyAt = (cx, cz, hero, palette, deep, heroSize) => {
        const moundR = 7 + (rnd() * 3.5);
        const bed = heightAt(cx, cz);
        const depth = seaLevel - bed;
        // (the mound itself stands on its footprint's lowest bed, so its downhill rim meets the slope)
        const bedLow = bedUnder(cx, cz, moundR * 0.9);
        if (!apart(cx, cz, moundR, 0.9) || keep.blocked(cx, cz, moundR, depth - (heroSize * 1.3), bed + heroSize)) return false;
        const pair = palette[Math.floor(rnd() * palette.length)];
        const second = palette[Math.floor(rnd() * palette.length)];
        // The outcrop: a low, wide rise half sunk in the sand (a dusted swell, not a stone on it).
        // A rise of its own height (a golden-ratio step, not a draw: the plan's draws stay as they were),
        // sunk to its waist and more, so it meets the sand as a swell and never shows an underside.
        const squash = 0.30 + (0.16 * (((plan.mounds.length * 0.618034) + 0.31) % 1));
        const moundY = Math.min(bed - (moundR * squash * 0.45), bedLow - (moundR * squash * 0.1));
        plan.mounds.push({
            x: cx, y: moundY, z: cz, r: moundR, squash, seed: 500 + plan.mounds.length, dusted: true, rough: MOUND_ROUGH,
        });
        // Its top at `d` from its centre, at the low end of its noise (a piece sinks a little, never floats).
        const onMound = (d, x = cx, z = cz) => Math.max(
            heightAt(x, z) - 0.3,
            moundY + (moundR * squash * (1 - MOUND_ROUGH) * Math.sqrt(Math.max(0, 1 - ((d / moundR) ** 2)))),
        );
        pieceAt(cx, onMound(0), cz, heroSize, hero, pair, deep);
        // What a garden in the dark gives off lights the rock and the sand round it (`plan.lights`).
        if (deep) {
            plan.lights.push({
                x: cx,
                y: onMound(0) + (heroSize * 0.5),
                z: cz,
                r: moundR * 2.7,
                colour: lightOf(pair),
                gain: 0.26,
                pool: true,
            });
        }
        const small = Math.round((deep ? 5 : 3) * share) + 1;
        const kinds = deep ? SMALL_DEEP : SMALL_WARM;
        for (let i = 0; i < small; i += 1) {
            const a = ((i / small) * Math.PI * 2) + (rnd() * 0.9);
            const d = moundR * (0.42 + (rnd() * 0.72));
            const x = cx + (Math.cos(a) * d);
            const z = cz + (Math.sin(a) * d);
            // Smaller the further from the hero, so the colony has a middle.
            const size = heroSize * (0.5 - (0.26 * (d / (moundR * 1.14)))) * (0.8 + (rnd() * 0.4));
            const y = d < moundR ? onMound(d, x, z) : heightAt(x, z);
            pieceAt(x, y - 0.15, z, size, kinds[Math.floor(rnd() * kinds.length)], rnd() < 0.7 ? pair : second, deep);
        }
        return true;
    };
    R.deepColonies.forEach(([cx, cz, hero]) => {
        if (seaLevel - heightAt(cx, cz) > 92) colonyAt(cx, cz, hero, DEEP, true, 9 + (rnd() * 4));
    });
    // The tower's wall, on the side the close-ups see: fans and trees standing out from its ledges.
    for (let i = 0; i < R.towerGarden; i += 1) {
        const a = (0.22 + (0.56 * ((i + (rnd() * 0.6)) / R.towerGarden))) * Math.PI;
        const down = 9 + (((i * 7) % R.towerGarden) / R.towerGarden) * 58;
        const y = plan.tower.topY - down;
        const rr = towerRadiusAt(plan.tower, y) * 0.9;
        const deep = T.topDepth + down > 70;
        pieceAt(
            T.x + (Math.cos(a) * rr),
            y,
            T.z + (Math.sin(a) * rr),
            3.6 + (rnd() * 3.4),
            ['fan', 'tree', 'tubes'][i % 3],
            (deep ? DEEP : WARM)[Math.floor(rnd() * (deep ? DEEP : WARM).length)],
            deep,
            a + (Math.PI / 2),
        );
    }
    // The crown's rim and the stacks' tops: warm heads and tables in the light.
    for (let i = 0; i < 7; i += 1) {
        const a = ((i / 7) * Math.PI * 2) + (rnd() * 0.5);
        const rr = T.topRadius * (0.62 + (rnd() * 0.3));
        pieceAt(T.x + (Math.cos(a) * rr), plan.tower.topY - 0.3, T.z + (Math.sin(a) * rr), 2.2 + (rnd() * 2.4), SMALL_WARM[i % 4], WARM[i % WARM.length], false);
    }
    plan.pinnacles.forEach((pin, k) => {
        const n = 2 + (k % 2);
        for (let i = 0; i < n; i += 1) {
            const a = rnd() * Math.PI * 2;
            const on = stackCrownAt(pin, a, rnd() * 0.7);
            pieceAt(on.x, on.y - 0.3, on.z, 2.0 + (rnd() * 2.6), SMALL_WARM[(i + k) % 4], WARM[(i + k) % WARM.length], false);
        }
    });
    // The shelf under the shore: warm colonies in the shallows.
    const shelfTarget = Math.round(R.shelfColonies * share);
    for (let n = 0, tries = 0; n < shelfTarget && tries < shelfTarget * 60; tries += 1) {
        const x = R.flank.x[0] + (rnd() * (R.flank.x[1] - R.flank.x[0]));
        const z = -188 + (rnd() * 56);
        const depth = depthAt(x, z);
        if (!(depth > 9 && depth < 50) || !apart(x, z, 9, 1)) continue;
        if (colonyAt(x, z, SMALL_WARM[n % SMALL_WARM.length], WARM, false, Math.min(depth * 0.4, 4.5 + (rnd() * 3)))) {
            rocks.push({ x, z, r: 8 });
            n += 1;
        }
    }

    // ── kelp: the tower's forest, and groves on the shelf ──
    const stipeAt = (x, baseY, z, groveYaw) => {
        // Each floats its canopy at its own depth (a little under the shallowest), so the forest's
        // top is a ragged layer and not a ruled line.
        const room = (seaLevel - R.canopyDepth - (rnd() * rnd() * 4.5)) - baseY;
        if (room < 8) return;
        // About half reach the surface and lie along it; the rest stop short, so the forest has a profile.
        const reaches = rnd() < 0.52;
        const length = reaches ? room + 4 + (rnd() * 11) : room * (0.55 + (rnd() * 0.4));
        plan.stipes.push({
            x, y: baseY, z, length, room, yaw: groveYaw + ((rnd() - 0.5) * 2.6), phase: rnd() * Math.PI * 2, seed: plan.stipes.length,
        });
    };
    const currentYaw = Math.atan2(R.current[1], R.current[0]);
    const towerStipes = Math.round(T.stipes * (quality === 'low' ? 0.6 : 1));
    for (let i = 0; i < towerStipes; i += 1) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * T.kelpRadius;
        stipeAt(T.x + (Math.cos(a) * rr), plan.tower.topY - 0.6, T.z + (Math.sin(a) * rr), currentYaw);
    }
    const groveTarget = Math.round(R.groves * share);
    let groves = 0;
    for (let tries = 0; groves < groveTarget && tries < groveTarget * 80; tries += 1) {
        const x = R.flank.x[0] + (rnd() * (R.flank.x[1] - R.flank.x[0]));
        const z = -182 + (rnd() * 46);
        const depth = depthAt(x, z);
        if (!(depth > 16 && depth < 50)) continue;
        if (!apart(x, z, 7, 1) || keep.blocked(x, z, 9, R.canopyDepth)) continue;
        groves += 1;
        const [lo, hi] = R.stipesPerGrove;
        const n = lo + Math.floor(rnd() * (hi - lo + 1));
        for (let i = 0; i < n; i += 1) {
            const a = rnd() * Math.PI * 2;
            const rr = Math.sqrt(rnd()) * 7;
            const sx = x + (Math.cos(a) * rr);
            const sz = z + (Math.sin(a) * rr);
            stipeAt(sx, heightAt(sx, sz) - 0.5, sz, currentYaw);
        }
    }

    // ── THE NEEDLE AND THE ARCH (2026-11-25): the places beside the first orbs' close-ups ──
    // Planted last and from draws of their own, so everything above stands where it stood.
    const own = makeRng(seed + 4099);
    const lifeAt = (x, y, z, size, kind, pair, yaw) => {
        plan.corals.push({
            x,
            y,
            z,
            size,
            kind,
            colour: pair[0],
            accent: pair[1],
            yaw,
            deep: true,
            depth: seaLevel - y,
            seed: plan.corals.length,
        });
    };
    const N = R.needle;
    const needle = {
        x: N.x,
        z: N.z,
        baseY: bedUnder(N.x, N.z, N.baseRadius) - 4,
        topY: seaLevel - N.topDepth,
        baseR: N.baseRadius,
        topR: N.topRadius,
        seed: N.seed,
        leanX: N.leanX,
        leanZ: N.leanZ,
    };
    plan.needle = needle;
    // Its crown garden: a hero in the middle, smaller growth out to the rim, warm lights and cold.
    const crownKinds = ['tree', 'anemone', 'dome', 'fan', 'tubes', 'pen', 'anemone'];
    const crownPairs = [EMBER[0], COLD[0], EMBER[1], COLD[2], EMBER[0], COLD[1], EMBER[1]];
    const crownCount = quality === 'low' ? 4 : crownKinds.length;
    for (let i = 0; i < crownCount; i += 1) {
        const a = ((i / crownCount) * Math.PI * 2) + (own() * 0.7);
        const k = i === 0 ? 0 : 0.42 + (own() * 0.4);
        const on = stackCrownAt(needle, a, k);
        const size = i === 0 ? 5.2 : 2.3 + (own() * 1.6);
        lifeAt(on.x, on.y - 0.25, on.z, size, crownKinds[i], crownPairs[i], a + (Math.PI / 2));
    }
    const crownTop = stackCrownAt(needle, 0, 0);
    // THE SHAFT THAT FINDS THE NEEDLE: one soft shaft of the surface's light let down on its crown,
    // so the garden there is a lit thing in the frames of orbs 8 and 9 and not one more dim shape.
    plan.spots.push({
        x: crownTop.x, y: crownTop.y + 1.2, z: crownTop.z, r: R.needle.spot, width: R.needle.spot * 1.5,
    });
    plan.lights.push({
        x: crownTop.x, y: crownTop.y + 3.2, z: crownTop.z, r: 15, colour: lightOf(EMBER[0]), gain: 0.9, pool: false,
    });
    // Its wall, on the side the close-ups see (they stand toward +x +z of it): fans and trees out
    // from its ledges, big enough to read from the orbs.
    const wallKinds = ['fan', 'tree', 'fan', 'tubes', 'fan', 'tree'];
    const wallPairs = [COLD[0], EMBER[1], COLD[4], COLD[2], EMBER[0], COLD[3]];
    const wallCount = quality === 'low' ? 3 : wallKinds.length;
    const needleHeight = needle.topY - needle.baseY;
    for (let i = 0; i < wallCount; i += 1) {
        const a = (0.10 + (0.52 * ((i + (own() * 0.5)) / wallCount))) * Math.PI;
        const h = 0.36 + (0.52 * (((i * 5) % wallCount) / wallCount)) + (own() * 0.05);
        const wall = stackWallAt(needle, a, h, STACK_FORM.pinch);
        const lean = h * h * needleHeight;
        lifeAt(
            needle.x + (Math.cos(a) * wall.r * 0.9) + (needle.leanX * lean),
            wall.y,
            needle.z + (Math.sin(a) * wall.r * 0.9) + (needle.leanZ * lean),
            5.6 + (own() * 3.0),
            wallKinds[i],
            wallPairs[i],
            a + (Math.PI / 2),
        );
    }
    // The arch: two feet on the bed, sunk; a garden under its span and a little growth on its back.
    const A = R.arch;
    const footOf = ([x, z]) => ({ x, y: bedUnder(x, z, A.thick * 1.6) - 2.2, z });
    const footA = footOf(A.feet[0]);
    const footB = footOf(A.feet[1]);
    plan.arch = {
        a: footA, b: footB, rise: A.rise, thick: A.thick, seed: A.seed,
    };
    const midX = (footA.x + footB.x) / 2;
    const midZ = (footA.z + footB.z) / 2;
    const spanX = footB.x - footA.x;
    const spanZ = footB.z - footA.z;
    const span = Math.hypot(spanX, spanZ);
    // (its normal in plan, toward the slope: the garden stands a little behind the span, so the
    // arch is drawn against its light)
    const backX = spanZ / span;
    const backZ = -spanX / span;
    const bedPiece = (x, z, size, kind, pair) => {
        lifeAt(x, heightAt(x, z) - 0.3, z, size, kind, pair, own() * Math.PI * 2);
    };
    // (A sea pen for its hero: a feather of light reads from 50 u where a branching coral is twigs.)
    bedPiece(midX + (backX * 0.8), midZ + (backZ * 0.8), 8.4, 'anemone', EMBER[0]);
    bedPiece(midX + (backX * 4.4) - (spanX * 0.16), midZ + (backZ * 4.4) - (spanZ * 0.16), 9.6, 'pen', EMBER[1]);
    const underKinds = ['anemone', 'tubes', 'pen', 'tree', 'anemone'];
    const underPairs = [COLD[0], EMBER[0], COLD[2], EMBER[1], COLD[1]];
    const underSizes = [4.2, 3.4, 4.6, 4.0, 3.2];
    const underCount = quality === 'low' ? 3 : underKinds.length;
    for (let i = 0; i < underCount; i += 1) {
        const along = ((i + 0.5) / underCount) - 0.5;
        const off = (i % 2 === 0 ? -1 : 1) * (1.8 + (own() * 2.6));
        bedPiece(
            midX + (spanX * along * 0.74) + (backX * off),
            midZ + (spanZ * along * 0.74) + (backZ * off),
            underSizes[i] * (0.9 + (own() * 0.2)),
            underKinds[i],
            underPairs[i],
        );
    }
    // ...and a few small lights straggling down the sand toward the eye, so the garden has a way in.
    R.archTrail.slice(0, quality === 'low' ? 2 : R.archTrail.length).forEach(([x, z, size, kind], i) => {
        bedPiece(x, z, size, kind, i % 2 === 0 ? COLD[0] : EMBER[1]);
    });
    const archTop = Math.max(footA.y, footB.y) + 2.2 + A.rise;
    lifeAt(midX - (spanX * 0.12), archTop + (A.thick * 0.7), midZ - (spanZ * 0.12), 1.9, 'anemone', COLD[0], 0);
    plan.lights.push({
        x: midX + (backX * 1.4),
        y: heightAt(midX, midZ) + 3.4,
        z: midZ + (backZ * 1.4),
        r: 19,
        colour: lightOf(EMBER[0]),
        gain: 1.6,
        pool: true,
    });
    return plan;
}

/** A stack's radius at world height `y` (its lathe profile without the noise). */
export function towerRadiusAt(stack, y) {
    const h = Math.max(0, Math.min(1, (y - stack.baseY) / (stack.topY - stack.baseY)));
    return stack.topR + ((stack.baseR - stack.topR) * ((1 - h) ** 1.7));
}

// ── geometry ─────────────────────────────────────────────────────────────────────

/** Rock by height band (linear, authored bright for the grade): dark basalt, paler toward the light. */
const ROCK_DARK = [0.085, 0.095, 0.105];
const ROCK_LIGHT = [0.25, 0.25, 0.235];
/** A grid of points' smooth normals (rows may wrap round in i): from its own two tangents. */
function gridNormals(grid, wrap, outward) {
    const rows = grid.length;
    return grid.map((row, j) => row.map((pt, i) => {
        const n = row.length;
        const a = row[wrap ? (i + n - 1) % n : Math.max(0, i - 1)];
        const b = row[wrap ? (i + 1) % n : Math.min(n - 1, i + 1)];
        const c = grid[Math.max(0, j - 1)][i];
        const d = grid[Math.min(rows - 1, j + 1)][i];
        const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const dv = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        let nx = (dv[1] * du[2]) - (dv[2] * du[1]);
        let ny = (dv[2] * du[0]) - (dv[0] * du[2]);
        let nz = (dv[0] * du[1]) - (dv[1] * du[0]);
        const o = outward(pt, j, i);
        if ((nx * o[0]) + (ny * o[1]) + (nz * o[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz);
        return l > 1e-9 ? [nx / l, ny / l, nz / l] : o;
    }));
}

/** Emit a wrapped grid as triangles with normals `keep` smooth and the rest the face's own. */
function emitGrid(sink, grid, normals, tints, keep) {
    const face = (a, b, c) => {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [(u[1] * v[2]) - (u[2] * v[1]), (u[2] * v[0]) - (u[0] * v[2]), (u[0] * v[1]) - (u[1] * v[0])];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        return [n[0] / l, n[1] / l, n[2] / l];
    };
    const blend = (smooth, flat) => {
        const n = [
            (smooth[0] * keep) + (flat[0] * (1 - keep)),
            (smooth[1] * keep) + (flat[1] * (1 - keep)),
            (smooth[2] * keep) + (flat[2] * (1 - keep)),
        ];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        return [n[0] / l, n[1] / l, n[2] / l];
    };
    const tri = (j0, i0, j1, i1, j2, i2) => {
        const f = face(grid[j0][i0], grid[j1][i1], grid[j2][i2]);
        const v = (j, i) => ({ p: grid[j][i], n: blend(normals[j][i], f), c: tints[j][i] });
        sink.tri(v(j0, i0), v(j1, i1), v(j2, i2));
    };
    for (let j = 0; j < grid.length - 1; j += 1) {
        const n = grid[j].length;
        for (let i = 0; i < n; i += 1) {
            const i1 = (i + 1) % n;
            tri(j, i, j + 1, i, j, i1);
            tri(j, i1, j + 1, i, j + 1, i1);
        }
    }
}

/** A stack's wall radius at bearing `a` and height fraction `h` (its lathe with its lobes and noise). */
function stackWallAt(s, a, h, pinch) {
    const yWall = s.baseY + ((s.topY - s.baseY) * h);
    const base = s.topR + ((s.baseR - s.topR) * ((1 - h) ** 1.7));
    // Undercuts and bulges: the whole ring swells or pinches by the stack's own slow noise.
    const swell = (reefNoise(s.seed * 0.37, yWall * 0.075, -s.seed * 0.21) - 0.5) * pinch;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const big = reefNoise((ca * 1.3) + s.seed, (yWall * 0.035) + s.seed, (sa * 1.3) - s.seed);
    const fine = reefNoise((ca * 3.1) - s.seed, yWall * 0.11, (sa * 3.1) + s.seed);
    // Buttresses: the plan is lobed, not round, and the lobes turn with height.
    const lobes = (0.20 * Math.sin((a * 3) + (s.seed * 1.3) + (h * 1.9)))
        + (0.11 * Math.sin((a * 5) - (s.seed * 0.7) - (h * 3.1)));
    return {
        r: base * (0.62 + (big * 0.66) + ((fine - 0.5) * 0.30) + lobes + swell), big, fine, y: yWall,
    };
}

/**
 * Where a pinnacle's crown stands at bearing `a`, `k` of the way out to its rim (0..1): the point
 * things that grow on its top seat on (2026-11-25: the stacks were cut flat, and with coral on their
 * tops they read as stumps; their crowns are worn domes now). The crown's knobs may lift it a little.
 * @returns {{ x: number, y: number, z: number }}
 */
export function stackCrownAt(stack, a, k) {
    const rim = stackWallAt(stack, a, 1, STACK_FORM.pinch).r;
    const kk = Math.min(1, Math.max(0, k));
    const lean = stack.topY - stack.baseY;
    return {
        x: stack.x + (Math.cos(a) * rim * kk) + ((stack.leanX || 0) * lean),
        y: stack.topY + (stack.topR * STACK_FORM.dome * Math.sqrt(Math.max(0, 1 - (kk * kk))))
            - (0.25 * stack.topR * STACK_FORM.rough * 0.5),
        z: stack.z + (Math.sin(a) * rim * kk) + ((stack.leanZ || 0) * lean),
    };
}

/**
 * A lathe of rock with noise: a sea stack standing from baseY to topY, its crown a worn dome.
 * (2026-11-25: no terraces and no bands of colour by height: the wall stepped in at a fixed count
 * of ledges and carried stripes every few units, and a stack read as a turned post. Its profile
 * now swells and pinches by its own noise, so it has undercuts and a waist.)
 */
function addStack(sink, s, {
    sides, rings, crownRows = 4, dome = STACK_FORM.dome, pinch = STACK_FORM.pinch, rough = STACK_FORM.rough,
}) {
    const height = s.topY - s.baseY;
    const grid = [];
    const tints = [];
    /** @type {number[]} the wall's radius round its top ring, which the crown closes over */
    const rimR = [];
    for (let j = 0; j <= rings + crownRows; j += 1) {
        const onCrown = j > rings;
        const f = onCrown ? (j - rings) / crownRows : 0;
        const h = Math.min(1, j / rings);
        const lean = h * h * height;
        const row = [];
        const rowTint = [];
        for (let i = 0; i < sides; i += 1) {
            const a = (i / sides) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const wall = stackWallAt(s, a, h, pinch);
            let { r, y } = wall;
            if (!onCrown) {
                if (j === rings) rimR[i] = r;
            } else {
                // The crown: closing over the rim's own outline, rising to its dome, broken by
                // knobs and gutters (more at the shoulder than on the very top).
                const knob = (reefNoise((ca * 2.2) + s.seed, (f * 2.6) - s.seed, (sa * 2.2) + (s.seed * 0.5)) - 0.5)
                    * rough * s.topR * (1 - (0.5 * f));
                r = Math.max(0.02, rimR[i] * Math.cos(f * (Math.PI / 2)));
                y = s.topY + (s.topR * dome * Math.sin(f * (Math.PI / 2))) + Math.max(-0.25 * s.topR * rough, knob);
            }
            row.push([
                s.x + (ca * r) + ((s.leanX || 0) * lean),
                y,
                s.z + (sa * r) + ((s.leanZ || 0) * lean),
            ]);
            // Paler toward the light, in patches (the noise), not in bands.
            const t = onCrown ? 0.9 + (0.1 * f)
                : Math.min(1, Math.max(0, (h * 0.72) + ((wall.big - 0.5) * 0.4) + ((wall.fine - 0.5) * 0.3)));
            rowTint.push([
                ROCK_DARK[0] + ((ROCK_LIGHT[0] - ROCK_DARK[0]) * t),
                ROCK_DARK[1] + ((ROCK_LIGHT[1] - ROCK_DARK[1]) * t),
                ROCK_DARK[2] + ((ROCK_LIGHT[2] - ROCK_DARK[2]) * t),
            ]);
        }
        grid.push(row);
        tints.push(rowTint);
    }
    const axis = (pt, j) => {
        const lean = (Math.min(1, j / rings) ** 2) * height;
        const up = j > rings ? 0.15 + (2 * ((j - rings) / crownRows)) : 0.15;
        const o = [pt[0] - (s.x + ((s.leanX || 0) * lean)), up, pt[2] - (s.z + ((s.leanZ || 0) * lean))];
        const l = Math.hypot(o[0], o[1], o[2]) || 1;
        return [o[0] / l, o[1] / l, o[2] / l];
    };
    // Carved rock keeps some of its planes: half the smooth normal, half the face's own.
    emitGrid(sink, grid, gridNormals(grid, true, axis), tints, 0.55);
}

/** A boulder or an outcrop: a noisy squashed ball, smooth-shaded (worn rock, not a cut gem). */
function addLump(sink, {
    x, y, z, r, squash = 0.7, seed = 0, dusted = false, rough = 0.26,
}) {
    const sides = 11;
    const rows = 5;
    const grid = [];
    const tints = [];
    for (let j = -rows; j <= rows; j += 1) {
        const lat = (j / rows) * (Math.PI / 2);
        const row = [];
        const rowTint = [];
        for (let i = 0; i < sides; i += 1) {
            const a = (i / sides) * Math.PI * 2;
            const n = (1 - rough) + (reefNoise((Math.cos(a) * 1.5) + seed, (j * 0.5) + seed, (Math.sin(a) * 1.5) - seed) * 2 * rough);
            const rr = Math.max(0.01, r * Math.cos(lat) * n);
            row.push([x + (Math.cos(a) * rr), y + (Math.sin(lat) * r * squash * n), z + (Math.sin(a) * rr)]);
            // A dusted outcrop is pale where the sand settles on it, over its top, and the rock's own
            // at its sunk skirt (2026-11-25: it was palest round its waist, a rim that drew a saucer).
            // (0.55 + 0.75 -> 0.25 + 0.42, 2026-11-25: the bed keeps less light with depth now, and
            // a mound paler than the sand it is dusted with stood out as a lump of blue clay.)
            const t = dusted ? 0.25 + (0.42 * Math.max(0, j / rows)) : ((j + rows) / (2 * rows)) * 0.8;
            rowTint.push([
                ROCK_DARK[0] + ((ROCK_LIGHT[0] - ROCK_DARK[0]) * t),
                ROCK_DARK[1] + ((ROCK_LIGHT[1] - ROCK_DARK[1]) * t),
                ROCK_DARK[2] + ((ROCK_LIGHT[2] - ROCK_DARK[2]) * t),
            ]);
        }
        grid.push(row);
        tints.push(rowTint);
    }
    const out = (pt) => {
        const o = [pt[0] - x, (pt[1] - y) / (squash * squash), pt[2] - z];
        const l = Math.hypot(o[0], o[1], o[2]) || 1;
        return [o[0] / l, o[1] / l, o[2] / l];
    };
    emitGrid(sink, grid, gridNormals(grid, true, out), tints, 1);
}

/**
 * A rock arch from foot `a` to foot `b` (both sunk in the bed): a bent, tapering limb, thick at
 * its legs and worn thin over its span, wandering a little out of its own plane.
 */
function addArch(sink, {
    a, b, rise, thick, seed,
}) {
    const sides = 14;
    const rows = 38;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = Math.hypot(dx, dz) || 1;
    // The arch's plane: along the feet, and up. `out` is the plane's normal (horizontal).
    const out = [dz / span, 0, -dx / span];
    const top = Math.max(a.y, b.y) + rise;
    const centre = (t) => {
        // An ellipse's half: theta runs a little past both feet, down into the bed.
        const th = -0.22 + (t * (Math.PI + 0.44));
        // (Its crown stands off centre, toward one foot: worn rock, not a drawn curve.)
        const u = ((1 - Math.cos(th)) / 2) + (0.07 * Math.sin(th) * Math.sin(th));
        const lift = Math.sin(th) * (1 + (0.16 * Math.sin((th * 2) + 0.6)));
        const footY = a.y + ((b.y - a.y) * u);
        const wander = (reefNoise((t * 3.1) + seed, seed * 0.7, 1.3) - 0.5) * 3.4 * Math.max(0, lift);
        return [
            a.x + (dx * u) + (out[0] * wander),
            footY + ((top - footY) * Math.max(lift, -0.6)),
            a.z + (dz * u) + (out[2] * wander),
        ];
    };
    const grid = [];
    const tints = [];
    const axis = [];
    for (let j = 0; j <= rows; j += 1) {
        const t = j / rows;
        const c = centre(t);
        const c0 = centre(Math.max(0, t - 0.01));
        const c1 = centre(Math.min(1, t + 0.01));
        const tan = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
        const tl = Math.hypot(tan[0], tan[1], tan[2]) || 1;
        tan[0] /= tl; tan[1] /= tl; tan[2] /= tl;
        // The ring's frame: the plane's normal, and the in-plane normal of the limb.
        const m = [
            (tan[1] * out[2]) - (tan[2] * out[1]),
            (tan[2] * out[0]) - (tan[0] * out[2]),
            (tan[0] * out[1]) - (tan[1] * out[0]),
        ];
        const lift = Math.sin(-0.22 + (t * (Math.PI + 0.44)));
        // Thick legs, a thin worn span: and the span a slab, broader across than it is deep.
        const up01 = Math.min(1, Math.max(0, lift));
        const girth = thick * (2.5 - (1.55 * (up01 ** 0.8)));
        const broad = 1.15 + (0.75 * up01);
        const deepN = 1 - (0.2 * up01);
        const row = [];
        const rowTint = [];
        for (let i = 0; i < sides; i += 1) {
            const ang = (i / sides) * Math.PI * 2;
            const ca = Math.cos(ang);
            const sa = Math.sin(ang);
            const big = reefNoise((ca * 1.4) + seed, (t * 5.5) + seed, (sa * 1.4) - seed);
            const fine = reefNoise((ca * 3.3) - seed, t * 13, (sa * 3.3) + seed);
            const knob = reefNoise((ca * 5.6) + (seed * 2), t * 24, (sa * 5.6) - (seed * 3));
            const r = girth * (0.50 + (big * 0.92) + ((fine - 0.5) * 0.46) + ((knob - 0.5) * 0.30));
            row.push([
                c[0] + (((out[0] * ca * broad) + (m[0] * sa * deepN)) * r),
                c[1] + (((out[1] * ca * broad) + (m[1] * sa * deepN)) * r),
                c[2] + (((out[2] * ca * broad) + (m[2] * sa * deepN)) * r),
            ]);
            const shade = Math.min(1, Math.max(0, 0.35 + ((big - 0.5) * 0.7) + (0.25 * Math.max(0, lift))));
            rowTint.push([
                ROCK_DARK[0] + ((ROCK_LIGHT[0] - ROCK_DARK[0]) * shade),
                ROCK_DARK[1] + ((ROCK_LIGHT[1] - ROCK_DARK[1]) * shade),
                ROCK_DARK[2] + ((ROCK_LIGHT[2] - ROCK_DARK[2]) * shade),
            ]);
        }
        grid.push(row);
        tints.push(rowTint);
        axis.push(c);
    }
    const outward = (pt, j) => {
        const c = axis[j];
        const o = [pt[0] - c[0], pt[1] - c[1], pt[2] - c[2]];
        const l = Math.hypot(o[0], o[1], o[2]) || 1;
        return [o[0] / l, o[1] / l, o[2] / l];
    };
    emitGrid(sink, grid, gridNormals(grid, true, outward), tints, 0.92);
}

/** How a garden's light is baked into what stands round it (`aLight`): how far round a form it wraps, its ceiling. */
const LIGHT_BAKE = Object.freeze({ wrap: 0.4, max: 1 });

/**
 * The light the gardens of the deep throw on what stands near them, baked per vertex
 * (`plan.lights`: place, reach, colour): a smooth falloff to nothing at its reach, more on faces
 * turned toward it. rgb in 0..255 (a normalised attribute).
 * @returns {Uint8Array} 4 per vertex
 */
function bakeGardenLight(positions, normals, lights, spots = [], toLight = [0, 1, 0]) {
    const count = positions.length / 3;
    const out = new Uint8Array(count * 4);
    if (!lights.length && !spots.length) return out;
    for (let i = 0; i < count; i += 1) {
        const px = positions[i * 3];
        const py = positions[(i * 3) + 1];
        const pz = positions[(i * 3) + 2];
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = 0; k < lights.length; k += 1) {
            const L = lights[k];
            const lx = L.x - px;
            const ly = L.y - py;
            const lz = L.z - pz;
            const d2 = (lx * lx) + (ly * ly) + (lz * lz);
            if (d2 >= L.r * L.r) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const fall = (1 - (d2 / (L.r * L.r))) ** 2;
            const facing = ((normals[i * 3] * lx) + (normals[(i * 3) + 1] * ly) + (normals[(i * 3) + 2] * lz)) / d;
            const w = fall * Math.min(1, Math.max(0, (facing + LIGHT_BAKE.wrap) / (1 + LIGHT_BAKE.wrap))) * L.gain;
            r += L.colour[0] * w;
            g += L.colour[1] * w;
            b += L.colour[2] * w;
        }
        out[i * 4] = Math.round(Math.min(LIGHT_BAKE.max, r) * 255);
        out[(i * 4) + 1] = Math.round(Math.min(LIGHT_BAKE.max, g) * 255);
        out[(i * 4) + 2] = Math.round(Math.min(LIGHT_BAKE.max, b) * 255);
        // w: the shafts' light (`plan.spots`): how near the vertex lies to a shaft's axis (a line
        // through the spot toward the light), on faces turned to it, a little way up and down it.
        let spot = 0;
        for (let k = 0; k < spots.length; k += 1) {
            const S = spots[k];
            const sx = px - S.x;
            const sy = py - S.y;
            const sz = pz - S.z;
            const along = (sx * toLight[0]) + (sy * toLight[1]) + (sz * toLight[2]);
            if (along < -S.r * 2.4 || along > S.r * 1.6) continue;
            const ox = sx - (toLight[0] * along);
            const oy = sy - (toLight[1] * along);
            const oz = sz - (toLight[2] * along);
            const d2 = ((ox * ox) + (oy * oy) + (oz * oz)) / (S.r * S.r);
            if (d2 >= 1) continue;
            const facing = (normals[i * 3] * toLight[0]) + (normals[(i * 3) + 1] * toLight[1])
                + (normals[(i * 3) + 2] * toLight[2]);
            const down = along < 0 ? 1 - ((-along / (S.r * 2.4)) ** 2) : 1;
            spot = Math.max(spot, ((1 - d2) ** 2) * Math.min(1, Math.max(0, (facing * 0.75) + 0.25)) * down);
        }
        out[(i * 4) + 3] = Math.round(Math.min(1, spot) * 255);
    }
    return out;
}

/**
 * The reef's rock and its life as ONE static mesh in world space: smooth-shaded, coloured per
 * vertex, with `aLife` = (how much of its own light a vertex carries, how far it may sway, 1 on
 * living things and 0 on rock) and `aLight` = the gardens' light that falls on it (rgb) and the
 * shafts' (w).
 * @param {ReturnType<typeof planOceanReef>} plan
 * @param {number[]} [toLight] unit vector up the shafts, toward the light (default: straight up)
 * @returns {THREE.BufferGeometry} position, normal, color, aLife, aLight
 */
export function buildReefRockGeometry(plan, toLight = [0, 1, 0]) {
    const sink = makeLifeSink();
    // The tower's crown stays low and whole (its kelp forest and its rim's coral stand on it).
    if (plan.tower) {
        addStack(sink, plan.tower, {
            sides: 30, rings: 34, crownRows: 1, dome: 0.12, pinch: 0, rough: 0,
        });
    }
    plan.pinnacles.forEach((p) => addStack(sink, p, { sides: 19, rings: 20 }));
    if (plan.needle) addStack(sink, plan.needle, { sides: 22, rings: 28 });
    if (plan.arch) addArch(sink, plan.arch);
    plan.boulders.forEach((b) => addLump(sink, b));
    plan.mounds.forEach((m) => addLump(sink, m));
    const rockVerts = sink.positions.length / 3;
    plan.corals.forEach((c) => CORAL_FORMS[c.kind](sink, c, makeRng(7000 + (c.seed * 13))));
    const count = sink.positions.length / 3;
    const life = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        life[i * 3] = sink.life[i * 2];
        life[(i * 3) + 1] = sink.life[(i * 2) + 1];
        life[(i * 3) + 2] = i < rockVerts ? 0 : 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colours, 3));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(life, 3));
    const baked = bakeGardenLight(sink.positions, sink.normals, plan.lights || [], plan.spots || [], toLight);
    geometry.setAttribute('aLight', new THREE.BufferAttribute(baked, 4, true));
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 4;
    return geometry;
}

/** The pools of light on the bed: each disc's rings and spokes, its lift off the bed (u), its reach (x the light's). */
export const REEF_POOLS = Object.freeze({
    rings: 6, spokes: 20, lift: 0.45, reach: 1.15,
});

/**
 * THE GARDENS' LIGHT ON THE SAND: one disc per light that asks for a pool, laid on the drawn bed
 * (each vertex seated by the bed's CPU mirror, so it follows the slope), brightest under its
 * garden and gone at its rim. One static mesh; `color` = the light's colour, `aPool` = (0 at the
 * centre .. 1 at the rim, the light's gain, its phase).
 * @param {ReturnType<typeof planOceanReef>} plan
 * @param {(x: number, z: number) => number} heightAt
 * @returns {THREE.BufferGeometry} position, color, aPool (indexed)
 */
export function buildReefPoolGeometry(plan, heightAt) {
    const P = REEF_POOLS;
    const positions = [];
    const colours = [];
    const pool = [];
    const index = [];
    (plan.lights || []).filter((L) => L.pool).forEach((L, n) => {
        const base = positions.length / 3;
        const reach = L.r * P.reach;
        const put = (x, z, rr) => {
            positions.push(x, heightAt(x, z) + P.lift, z);
            colours.push(L.colour[0], L.colour[1], L.colour[2]);
            pool.push(rr, L.gain, (n * 2.399) % (Math.PI * 2));
        };
        put(L.x, L.z, 0);
        for (let j = 1; j <= P.rings; j += 1) {
            const rr = j / P.rings;
            for (let i = 0; i < P.spokes; i += 1) {
                const a = (i / P.spokes) * Math.PI * 2;
                put(L.x + (Math.cos(a) * reach * rr), L.z + (Math.sin(a) * reach * rr), rr);
            }
        }
        for (let i = 0; i < P.spokes; i += 1) index.push(base, base + 1 + ((i + 1) % P.spokes), base + 1 + i);
        for (let j = 1; j < P.rings; j += 1) {
            const r0 = base + 1 + ((j - 1) * P.spokes);
            const r1 = r0 + P.spokes;
            for (let i = 0; i < P.spokes; i += 1) {
                const i1 = (i + 1) % P.spokes;
                index.push(r0 + i, r0 + i1, r1 + i, r0 + i1, r1 + i1, r1 + i);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('aPool', new THREE.Float32BufferAttribute(pool, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 2;
    return geometry;
}

/** The kelp's blade spacing along a stipe and its sizes (u). */
export const REEF_KELP = Object.freeze({
    row: 1.7, bladeEvery: 1.25, bladeLength: [2.2, 4.2], bladeWidth: 0.85, stipeWidth: 0.34, bend: 3.2,
});

/**
 * Where a stipe's axis is at arc length `s` from its foot: straight up to the canopy's depth, a
 * quarter turn, then along the current just under the surface.
 * @returns {{ x: number, y: number, z: number, tx: number, ty: number, tz: number }} point, tangent
 */
export function kelpAxisAt(stipe, s, out = {}) {
    const B = REEF_KELP.bend;
    const up = Math.max(0, stipe.room - B);
    const dx = Math.cos(stipe.yaw);
    const dz = Math.sin(stipe.yaw);
    const o = out;
    if (s <= up) {
        o.x = stipe.x; o.y = stipe.y + s; o.z = stipe.z; o.tx = 0; o.ty = 1; o.tz = 0;
        return o;
    }
    const arc = (Math.PI / 2) * B;
    if (s <= up + arc) {
        const a = (s - up) / B;
        const run = B * (1 - Math.cos(a));
        o.x = stipe.x + (dx * run); o.y = stipe.y + up + (B * Math.sin(a)); o.z = stipe.z + (dz * run);
        o.tx = dx * Math.sin(a); o.ty = Math.cos(a); o.tz = dz * Math.sin(a);
        return o;
    }
    const run = B + (s - up - arc);
    o.x = stipe.x + (dx * run); o.y = stipe.y + up + B; o.z = stipe.z + (dz * run);
    o.tx = dx; o.ty = 0; o.tz = dz;
    return o;
}

/**
 * The kelp as one mesh: per stipe a ribbon along its axis and blades off it, alternating sides.
 * `aKelp` = (arc length from the foot, phase, distance out along the blade, 1 on the canopy run).
 * @param {ReturnType<typeof planOceanReef>} plan
 * @returns {THREE.BufferGeometry} position, color, aKelp
 */
export function buildReefKelpGeometry(plan) {
    const positions = [];
    const colours = [];
    const kelp = [];
    const K = REEF_KELP;
    const a0 = {};
    const a1 = {};
    const push = (p, c, s, phase, blade, canopy) => {
        positions.push(p[0], p[1], p[2]);
        colours.push(c[0], c[1], c[2]);
        kelp.push(s, phase, blade, canopy);
    };
    const quad = (p0, p1, p2, p3, c0, c1, s0, s1, phase, b0, b1, canopy) => {
        push(p0, c0, s0, phase, b0, canopy); push(p1, c0, s0, phase, b0, canopy); push(p2, c1, s1, phase, b1, canopy);
        push(p1, c0, s0, phase, b0, canopy); push(p3, c1, s1, phase, b1, canopy); push(p2, c1, s1, phase, b1, canopy);
    };
    plan.stipes.forEach((st) => {
        const rnd = makeRng(9001 + st.seed);
        // Each stipe's own olive to gold; the blades a little brighter than the stalk.
        const warm = rnd();
        const stalk = [0.10 + (warm * 0.05), 0.13 + (warm * 0.04), 0.045];
        const leaf = [0.26 + (warm * 0.18), 0.32 + (warm * 0.10), 0.07 + (warm * 0.02)];
        const rows = Math.max(3, Math.round(st.length / K.row));
        const side = [Math.cos(st.yaw + 1.5708) * K.stipeWidth * 0.5, Math.sin(st.yaw + 1.5708) * K.stipeWidth * 0.5];
        const upCanopy = Math.max(0, st.room - K.bend);
        for (let j = 0; j < rows; j += 1) {
            const s0 = (j / rows) * st.length;
            const s1 = ((j + 1) / rows) * st.length;
            kelpAxisAt(st, s0, a0);
            kelpAxisAt(st, s1, a1);
            const taper0 = 1 - (0.55 * (s0 / st.length));
            const taper1 = 1 - (0.55 * (s1 / st.length));
            quad(
                [a0.x - (side[0] * taper0), a0.y, a0.z - (side[1] * taper0)],
                [a0.x + (side[0] * taper0), a0.y, a0.z + (side[1] * taper0)],
                [a1.x - (side[0] * taper1), a1.y, a1.z - (side[1] * taper1)],
                [a1.x + (side[0] * taper1), a1.y, a1.z + (side[1] * taper1)],
                stalk,
                stalk,
                s0,
                s1,
                st.phase,
                0,
                0,
                s0 > upCanopy ? 1 : 0,
            );
        }
        // Blades: from a third of the way up, denser toward the light.
        for (let s = Math.max(2.5, st.length * 0.18), k = 0; s < st.length - 0.6; s += K.bladeEvery * (0.7 + (rnd() * 0.6)), k += 1) {
            kelpAxisAt(st, s, a0);
            const canopy = s > upCanopy ? 1 : 0;
            const len = K.bladeLength[0] + (rnd() * (K.bladeLength[1] - K.bladeLength[0]));
            const yaw = st.yaw + ((k % 2 === 0 ? 1 : -1) * (1.1 + (rnd() * 0.9))) + ((rnd() - 0.5) * 0.6);
            // On the stalk a blade stands out and droops; on the canopy it hangs down from it.
            const ox = canopy ? Math.cos(yaw) * 0.45 : Math.cos(yaw);
            const oz = canopy ? Math.sin(yaw) * 0.45 : Math.sin(yaw);
            const oy = canopy ? -0.9 : -0.28;
            const norm = Math.hypot(ox, oy, oz);
            const dir = [ox / norm, oy / norm, oz / norm];
            const wide = [-dir[2], 0, dir[0]];
            const wn = Math.hypot(wide[0], wide[2]) || 1;
            const w = (K.bladeWidth * (0.7 + (rnd() * 0.6))) / wn;
            const mid = [a0.x + (dir[0] * len * 0.5), a0.y + (dir[1] * len * 0.5), a0.z + (dir[2] * len * 0.5)];
            const tip = [a0.x + (dir[0] * len), a0.y + (dir[1] * len) - (len * 0.12), a0.z + (dir[2] * len)];
            const root = [a0.x, a0.y, a0.z];
            const m0 = [mid[0] - (wide[0] * w * 0.5), mid[1], mid[2] - (wide[2] * w * 0.5)];
            const m1 = [mid[0] + (wide[0] * w * 0.5), mid[1], mid[2] + (wide[2] * w * 0.5)];
            const tint = leaf.map((v) => v * (0.8 + (rnd() * 0.4)));
            const tipTint = tint.map((v) => v * 1.25);
            // root -> mid (a triangle), mid -> tip (a triangle): a pointed leaf.
            push(root, tint, s, st.phase, 0, canopy); push(m0, tint, s, st.phase, len * 0.5, canopy); push(m1, tint, s, st.phase, len * 0.5, canopy);
            push(m0, tint, s, st.phase, len * 0.5, canopy); push(tip, tipTint, s, st.phase, len, canopy); push(m1, tint, s, st.phase, len * 0.5, canopy);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('aKelp', new THREE.Float32BufferAttribute(kelp, 4));
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 8;
    return geometry;
}

/** The column the reef is planted round (re-exported for the tests that score it). */
export { OCEAN_COLUMN };

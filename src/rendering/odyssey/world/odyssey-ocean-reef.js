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
    corals: 110,
    /** The cold, glowing garden at the slope's foot (the abyss orbs' view). */
    deepCorals: 78,
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
    const blockedBy = (x, z, radius, topDepth) => {
        for (let i = 0; i < rail.length; i += 1) {
            if (Math.hypot(rail[i].x - x, rail[i].z - z) < OCEAN_REEF.corridor + radius) return 'rail';
        }
        for (let a = 0; a < paths.length; a += 1) {
            const { pts, half, up } = paths[a];
            const reach = radius + half + 2;
            for (let i = 0; i < pts.length; i += 3) {
                if (pts[i + 1] + up + 2 > topDepth && Math.hypot(pts[i] - x, pts[i + 2] - z) < reach) return 'roamer';
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
    return { blocked: (x, z, radius, topDepth) => blockedBy(x, z, radius, topDepth) !== null, blockedBy };
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
        tower: null, pinnacles: [], boulders: [], corals: [], stipes: [],
    };
    if (!rail?.length || typeof heightAt !== 'function') return plan;
    const rnd = makeRng(seed);
    const share = quality === 'low' ? OCEAN_REEF.lowShare : 1;
    const keep = reefKeepOut({ rail, seaLevel });
    const R = OCEAN_REEF;
    const depthAt = (x, z) => seaLevel - heightAt(x, z);
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
            x, y: heightAt(x, z) - (r * 0.35), z, r, squash: 0.55 + (rnd() * 0.45), seed: 300 + plan.boulders.length,
        });
        rocks.push({ x, z, r: r * 0.6 });
    }

    // ── coral: on the tower's shoulders, the stacks' crowns, and the shelf under the shore ──
    const KINDS = ['head', 'head', 'table', 'fan', 'staghorn'];
    // The deep garden is branching and fan-shaped (cold-water coral), with few heads.
    const DEEP_KINDS = ['fan', 'staghorn', 'fan', 'staghorn', 'table', 'head'];
    const coralAt = (x, y, z, size, depth, deep = false) => {
        const kinds = deep ? DEEP_KINDS : KINDS;
        plan.corals.push({
            x, y, z, size, kind: kinds[Math.floor(rnd() * kinds.length)], hue: rnd(), yaw: rnd() * Math.PI * 2, depth, deep,
        });
    };
    const coralTarget = Math.round(R.corals * share);
    const onTower = Math.round(coralTarget * 0.24);
    for (let i = 0; i < onTower; i += 1) {
        // The crown's rim and the shoulder just under it.
        const a = rnd() * Math.PI * 2;
        const down = rnd() * rnd() * 34;
        const rr = towerRadiusAt(plan.tower, plan.tower.topY - down) * (down < 1 ? 0.55 + (rnd() * 0.4) : 0.93);
        coralAt(T.x + (Math.cos(a) * rr), plan.tower.topY - down - 0.4, T.z + (Math.sin(a) * rr), 2.0 + (rnd() * 3.2), T.topDepth + down);
    }
    plan.pinnacles.forEach((p) => {
        const n = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i += 1) {
            const a = rnd() * Math.PI * 2;
            const rr = p.topR * rnd() * 0.8;
            coralAt(p.x + (Math.cos(a) * rr), p.topY - 0.5, p.z + (Math.sin(a) * rr), 1.8 + (rnd() * 2.8), seaLevel - p.topY);
        }
    });
    for (let tries = 0; plan.corals.length < coralTarget && tries < coralTarget * 40; tries += 1) {
        const x = R.flank.x[0] + (rnd() * (R.flank.x[1] - R.flank.x[0]));
        const z = -190 + (rnd() * 62);
        const depth = depthAt(x, z);
        if (!(depth > 5 && depth < 52)) continue;
        const size = 2 + (rnd() * rnd() * 5.5);
        if (depth - size < 3 || keep.blocked(x, z, size, depth - size)) continue;
        coralAt(x, heightAt(x, z) - 0.5, z, size, depth);
    }

    // THE DEEP GARDEN: at the slope's foot, where the first orbs look, the coral is the cold kind
    // that carries its own light (the renderer lets it glow in the dark).
    const deepTarget = Math.round(R.deepCorals * share);
    for (let n = 0, tries = 0; n < deepTarget && tries < deepTarget * 50; tries += 1) {
        // It grows round the rocks (two in three) and thinly over the open bed.
        let x = -85 + (rnd() * 160);
        let z = -112 + (rnd() * 104);
        const pick = rnd();
        if (pick < 0.3) {
            // The first orbs' window on the slope's foot.
            x = -48 + (rnd() * 104);
            z = -66 + (rnd() * 42);
        } else if (pick < 0.8) {
            const rock = rocks[Math.floor(rnd() * rocks.length)];
            const a = rnd() * Math.PI * 2;
            const rr = rock.r * (0.75 + (rnd() * 0.9));
            x = rock.x + (Math.cos(a) * rr);
            z = rock.z + (Math.sin(a) * rr);
        }
        const depth = depthAt(x, z);
        if (!(depth > 100)) continue;
        const size = 1.8 + (rnd() * rnd() * 3.6);
        if (keep.blocked(x, z, size, depth - (size * 1.6))) continue;
        coralAt(x, heightAt(x, z) - 0.5, z, size, depth, true);
        n += 1;
    }

    // ── kelp: the tower's forest, and groves on the shelf ──
    const stipeAt = (x, baseY, z, groveYaw) => {
        const room = (seaLevel - R.canopyDepth) - baseY;
        if (room < 8) return;
        // Most reach the surface and lie along it; the rest stop short, so the forest has a profile.
        const reaches = rnd() < 0.62;
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
/** Coral pigments (linear): the water takes the red out of them with distance, as it does. */
const CORAL_PIGMENTS = [
    [0.95, 0.36, 0.46], [1.0, 0.52, 0.20], [0.62, 0.38, 0.92], [0.96, 0.80, 0.28],
    [0.24, 0.74, 0.66], [0.92, 0.84, 0.70], [0.98, 0.42, 0.72],
];
/** The deep garden's: cold lights (cyan, violet, sea green, a rare magenta). */
const DEEP_PIGMENTS = [
    [0.10, 0.80, 0.95], [0.45, 0.30, 1.0], [0.12, 0.95, 0.60], [0.20, 0.55, 1.0], [0.95, 0.25, 0.80],
];

function makeSink() {
    const positions = [];
    const colours = [];
    return {
        positions,
        colours,
        tri(a, b, c, ca, cb = ca, cc = ca) {
            positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
            colours.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
        },
    };
}

/** A lathe of rock with terraces and noise: a sea stack standing from baseY to topY. */
function addStack(sink, s, { sides, rings }) {
    const height = s.topY - s.baseY;
    const terraces = 4 + (s.seed % 3);
    const ring = [];
    const tint = [];
    for (let j = 0; j <= rings; j += 1) {
        const h = j / rings;
        const y = s.baseY + (height * h);
        // Terraces: the profile holds, then steps in, so the wall has ledges.
        const step = (Math.floor(h * terraces) + fade(Math.min(1, ((h * terraces) % 1) * 1.8))) / terraces;
        const hh = (h * 0.68) + (step * 0.32);
        const base = s.topR + ((s.baseR - s.topR) * ((1 - hh) ** 1.7));
        const row = [];
        const rowTint = [];
        for (let i = 0; i < sides; i += 1) {
            const a = (i / sides) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const big = reefNoise((ca * 1.3) + s.seed, (y * 0.035) + s.seed, (sa * 1.3) - s.seed);
            const fine = reefNoise((ca * 3.1) - s.seed, y * 0.11, (sa * 3.1) + s.seed);
            // Buttresses: the plan is lobed, not round, and the lobes turn with height.
            const lobes = (0.20 * Math.sin((a * 3) + (s.seed * 1.3) + (h * 1.9)))
                + (0.11 * Math.sin((a * 5) - (s.seed * 0.7) - (h * 3.1)));
            const r = base * (0.62 + (big * 0.66) + ((fine - 0.5) * 0.30) + lobes);
            const lean = h * h * height;
            row.push([s.x + (ca * r) + ((s.leanX || 0) * lean), y, s.z + (sa * r) + ((s.leanZ || 0) * lean)]);
            // Strata: bands of colour by height, broken by the noise.
            const band = 0.5 + (0.5 * Math.sin((y * 0.21) + (big * 4)));
            const t = Math.min(1, Math.max(0, (h * 0.75) + (band * 0.25) + ((fine - 0.5) * 0.3)));
            rowTint.push([
                ROCK_DARK[0] + ((ROCK_LIGHT[0] - ROCK_DARK[0]) * t),
                ROCK_DARK[1] + ((ROCK_LIGHT[1] - ROCK_DARK[1]) * t),
                ROCK_DARK[2] + ((ROCK_LIGHT[2] - ROCK_DARK[2]) * t),
            ]);
        }
        ring.push(row);
        tint.push(rowTint);
    }
    for (let j = 0; j < rings; j += 1) {
        for (let i = 0; i < sides; i += 1) {
            const i1 = (i + 1) % sides;
            const a = ring[j][i];
            const b = ring[j][i1];
            const c = ring[j + 1][i];
            const d = ring[j + 1][i1];
            sink.tri(a, c, b, tint[j][i]);
            sink.tri(b, c, d, tint[j + 1][i1]);
        }
    }
    // The crown: a low dome, so it reads as a place something can grow.
    const lean = height;
    const apex = [s.x + ((s.leanX || 0) * lean), s.topY + (s.topR * 0.12), s.z + ((s.leanZ || 0) * lean)];
    for (let i = 0; i < sides; i += 1) {
        sink.tri(ring[rings][i], apex, ring[rings][(i + 1) % sides], tint[rings][i]);
    }
}

/** A lump: a noisy squashed ball (a boulder), or the same in a pigment (a coral head). */
function addLump(sink, {
    x, y, z, r, squash = 0.7, seed = 0, colour = null, sides = 8, rows = 4, dome = false,
}) {
    const ring = [];
    const y0 = dome ? 0 : -rows;
    for (let j = y0; j <= rows; j += 1) {
        const lat = (j / rows) * (Math.PI / 2);
        const row = [];
        for (let i = 0; i < sides; i += 1) {
            const a = (i / sides) * Math.PI * 2;
            const n = 0.72 + (reefNoise((Math.cos(a) * 1.7) + seed, (j * 0.6) + seed, (Math.sin(a) * 1.7) - seed) * 0.56);
            const rr = r * Math.cos(lat) * n;
            row.push([x + (Math.cos(a) * rr), y + (Math.sin(lat) * r * squash * n), z + (Math.sin(a) * rr)]);
        }
        ring.push(row);
    }
    const shade = (j) => {
        const t = (j - y0) / (rows - y0);
        if (colour) return [colour[0] * (0.55 + (0.45 * t)), colour[1] * (0.55 + (0.45 * t)), colour[2] * (0.55 + (0.45 * t))];
        return [
            ROCK_DARK[0] + ((ROCK_LIGHT[0] - ROCK_DARK[0]) * t * 0.8),
            ROCK_DARK[1] + ((ROCK_LIGHT[1] - ROCK_DARK[1]) * t * 0.8),
            ROCK_DARK[2] + ((ROCK_LIGHT[2] - ROCK_DARK[2]) * t * 0.8),
        ];
    };
    for (let j = 0; j < ring.length - 1; j += 1) {
        for (let i = 0; i < sides; i += 1) {
            const i1 = (i + 1) % sides;
            sink.tri(ring[j][i], ring[j + 1][i], ring[j][i1], shade(j + y0));
            sink.tri(ring[j][i1], ring[j + 1][i], ring[j + 1][i1], shade(j + y0 + 1));
        }
    }
}

/** A table coral: a short stalk under a wide thin plate. */
function addTable(sink, c, colour) {
    const sides = 9;
    const plateY = c.y + (c.size * 0.55);
    const rim = [];
    const neck = [];
    const foot = [];
    for (let i = 0; i < sides; i += 1) {
        const a = c.yaw + ((i / sides) * Math.PI * 2);
        const wob = 0.82 + (reefNoise(i * 1.3, c.hue * 31, 2) * 0.36);
        rim.push([c.x + (Math.cos(a) * c.size * wob), plateY + ((wob - 1) * 0.3), c.z + (Math.sin(a) * c.size * wob)]);
        neck.push([c.x + (Math.cos(a) * c.size * 0.16), plateY - (c.size * 0.14), c.z + (Math.sin(a) * c.size * 0.16)]);
        foot.push([c.x + (Math.cos(a) * c.size * 0.24), c.y - 0.6, c.z + (Math.sin(a) * c.size * 0.24)]);
    }
    const top = [c.x, plateY + (c.size * 0.05), c.z];
    const dark = colour.map((v) => v * 0.5);
    for (let i = 0; i < sides; i += 1) {
        const i1 = (i + 1) % sides;
        sink.tri(rim[i], top, rim[i1], colour);
        sink.tri(rim[i], rim[i1], neck[i], dark);
        sink.tri(rim[i1], neck[i1], neck[i], dark);
        sink.tri(neck[i], neck[i1], foot[i], dark);
        sink.tri(neck[i1], foot[i1], foot[i], dark);
    }
}

/** A sea fan: a flat lobed fan standing across the current, drawn from both sides. */
function addFan(sink, c, colour) {
    const segs = 9;
    const ax = Math.cos(c.yaw);
    const az = Math.sin(c.yaw);
    const base = [c.x, c.y - 0.4, c.z];
    const pts = [];
    for (let i = 0; i <= segs; i += 1) {
        const a = (-0.42 + ((i / segs) * 0.84)) * Math.PI;
        const lobe = 0.72 + (0.28 * Math.abs(Math.sin(i * 1.9 + (c.hue * 9))));
        const r = c.size * 1.5 * lobe;
        pts.push([c.x + (Math.sin(a) * r * ax), c.y + (Math.cos(a) * r), c.z + (Math.sin(a) * r * az)]);
    }
    const dark = colour.map((v) => v * 0.6);
    for (let i = 0; i < segs; i += 1) {
        sink.tri(base, pts[i], pts[i + 1], dark, colour, colour);
        sink.tri(base, pts[i + 1], pts[i], dark, colour, colour);
    }
}

/** Staghorn: a handful of thin branches from one foot. */
function addStaghorn(sink, c, colour) {
    const n = 6;
    for (let k = 0; k < n; k += 1) {
        const a = c.yaw + ((k / n) * Math.PI * 2);
        const out = 0.25 + (reefNoise(k * 2.1, c.hue * 17, 5) * 0.75);
        const tip = [
            c.x + (Math.cos(a) * c.size * out), c.y + (c.size * (0.9 + (0.5 * (1 - out)))), c.z + (Math.sin(a) * c.size * out),
        ];
        const w = c.size * 0.13;
        const b0 = [c.x + (Math.cos(a + 1.6) * w), c.y - 0.3, c.z + (Math.sin(a + 1.6) * w)];
        const b1 = [c.x + (Math.cos(a - 1.6) * w), c.y - 0.3, c.z + (Math.sin(a - 1.6) * w)];
        const b2 = [c.x + (Math.cos(a) * w), c.y - 0.3, c.z + (Math.sin(a) * w)];
        const dark = colour.map((v) => v * 0.55);
        sink.tri(b0, tip, b1, dark, colour, dark);
        sink.tri(b1, tip, b2, dark, colour, dark);
        sink.tri(b2, tip, b0, dark, colour, dark);
    }
}

/**
 * The reef's rock and coral as ONE static mesh in world space: flat-shaded (each triangle its own
 * normal), coloured per vertex.
 * @param {ReturnType<typeof planOceanReef>} plan
 * @returns {THREE.BufferGeometry} position, normal, color
 */
export function buildReefRockGeometry(plan) {
    const sink = makeSink();
    if (plan.tower) addStack(sink, plan.tower, { sides: 30, rings: 34 });
    plan.pinnacles.forEach((p) => addStack(sink, p, { sides: 17, rings: 16 }));
    plan.boulders.forEach((b) => addLump(sink, b));
    plan.corals.forEach((c) => {
        const pigments = c.deep ? DEEP_PIGMENTS : CORAL_PIGMENTS;
        const colour = pigments[Math.floor(c.hue * pigments.length) % pigments.length];
        if (c.kind === 'table') addTable(sink, c, colour);
        else if (c.kind === 'fan') addFan(sink, c, colour);
        else if (c.kind === 'staghorn') addStaghorn(sink, c, colour);
        else {
            addLump(sink, {
                x: c.x, y: c.y, z: c.z, r: c.size, squash: 0.75, seed: c.hue * 97, colour, sides: 7, rows: 3, dome: true,
            });
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(sink.colours, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
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

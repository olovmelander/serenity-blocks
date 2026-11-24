import { hash2, patchNoise, smooth } from './odyssey-forest-composition.js';
import { FOREST_SHADE_PLATE } from './odyssey-forest-shade.js';

/**
 * THE FOREST'S FLOOR (2026-11-24): where the ground is a wood's and not the meadow's, and whose wood it is.
 *
 * The plate is a small picture over the shade plate's square, baked with the scatter in the worker:
 *   R  how closed the wood over it is (0 open grass or a lone tree's shade .. 1 the floor of a wood)
 *   G  the share of it that is needle trees (rust duff and moss)
 *   B  ... that is blossom (petals on the grass)
 *   A  ... that is the gold side's (its leaves as they fell)
 * The ground's shader paints the floor from it (the renderer's FLOOR) and the scatter plants its ferns and
 * bracken by it, so both follow the trees that stand there, not the plan they were planted from.
 *
 * Pure arithmetic, no three.js: the bake worker runs it.
 */
export const FOREST_FLOOR_PLATE = Object.freeze({
    x: FOREST_SHADE_PLATE.x, z: FOREST_SHADE_PLATE.z, extent: FOREST_SHADE_PLATE.extent, res: 512,
});

/** How far a tree's leaves lie from its trunk, u, and between which shares of closed ground the floor begins. */
const REACH = 24;
const CLOSED = Object.freeze([0.46, 0.78]);
/** The floor's outline is pushed in and out by this much, at this scale (u). */
const RAGGED = 0.26;
const RAGGED_CELL = 15;

const NEEDLES = new Set(['spruce', 'fir', 'larch', 'scots-pine', 'bent-pine', 'dwarf-pine', 'stone-pine', 'cypress', 'juniper']);
const BLOSSOM = new Set(['cherry']);
const GOLD = new Set(['aspen', 'maple']);
/** Who lays no floor: what is low, and what is dead. */
const NO_FLOOR = new Set(['shrub', 'floor']);

/**
 * The wood over every place of the plate: the crowns' ground a square unit, spread over `REACH` u.
 * @param {ReadonlyArray<{x:number,z:number,crownR:number,speciesId:string,role:string}>} placements
 * @returns {{res:number, closed:Float32Array, needles:Float32Array, blossom:Float32Array, gold:Float32Array,
 *   at:(x:number,z:number)=>number}} `closed` 0 (no tree near) .. about 1 (a shut wood), and the kinds' parts of it
 */
export function forestClosure(placements, { res = FOREST_FLOOR_PLATE.res } = {}) {
    const P = FOREST_FLOOR_PLATE;
    const texel = P.extent / res;
    const x0 = P.x - (P.extent / 2);
    const z0 = P.z - (P.extent / 2);
    const closed = new Float32Array(res * res);
    const needles = new Float32Array(res * res);
    const blossom = new Float32Array(res * res);
    const gold = new Float32Array(res * res);
    const r2 = REACH * REACH;
    for (let n = 0; n < placements.length; n += 1) {
        const p = placements[n];
        if (NO_FLOOR.has(p.role) || p.speciesId === 'snag') continue;
        // The kernel (1 - d²/R²)² holds a third of its disc.
        const amp = (p.crownR * p.crownR * 0.85 * 3) / r2;
        let part = null;
        if (NEEDLES.has(p.speciesId)) part = needles;
        else if (BLOSSOM.has(p.speciesId)) part = blossom;
        else if (GOLD.has(p.speciesId)) part = gold;
        const i0 = Math.max(0, Math.ceil(((p.x - REACH - x0) / texel) - 0.5));
        const i1 = Math.min(res - 1, Math.floor(((p.x + REACH - x0) / texel) - 0.5));
        const j0 = Math.max(0, Math.ceil(((p.z - REACH - z0) / texel) - 0.5));
        const j1 = Math.min(res - 1, Math.floor(((p.z + REACH - z0) / texel) - 0.5));
        for (let j = j0; j <= j1; j += 1) {
            const dz = (z0 + ((j + 0.5) * texel)) - p.z;
            for (let i = i0; i <= i1; i += 1) {
                const dx = (x0 + ((i + 0.5) * texel)) - p.x;
                const q = 1 - (((dx * dx) + (dz * dz)) / r2);
                if (q <= 0) continue;
                const w = amp * q * q;
                const k = (j * res) + i;
                closed[k] += w;
                if (part) part[k] += w;
            }
        }
    }
    const read = (field) => (x, z) => {
        const gx = Math.max(0, Math.min(res - 1.001, ((x - x0) / texel) - 0.5));
        const gz = Math.max(0, Math.min(res - 1.001, ((z - z0) / texel) - 0.5));
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        const u = gx - i;
        const v = gz - j;
        const k = (j * res) + i;
        return (((field[k] * (1 - u)) + (field[k + 1] * u)) * (1 - v)) + (((field[k + res] * (1 - u)) + (field[k + res + 1] * u)) * v);
    };
    return {
        res, closed, needles, blossom, gold, at: read(closed), needlesAt: read(needles), blossomAt: read(blossom), goldAt: read(gold),
    };
}

/** How much of a wood's floor lies where the wood is this closed. */
export function floorShare(closed, x, z) {
    return smooth(CLOSED[0], CLOSED[1], closed + ((patchNoise(x, z, RAGGED_CELL, 741) - 0.5) * RAGGED * Math.min(1, closed * 2)));
}

/**
 * The plate's bytes.
 * @param {ReturnType<typeof forestClosure>} wood
 * @returns {{data: Uint8Array, res: number, extent: number, x: number, z: number}} RGBA8, row j = +z
 */
export function bakeForestFloorData(wood) {
    const P = FOREST_FLOOR_PLATE;
    const { res } = wood;
    const texel = P.extent / res;
    const x0 = P.x - (P.extent / 2);
    const z0 = P.z - (P.extent / 2);
    const data = new Uint8Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const k = (j * res) + i;
            const c = wood.closed[k];
            if (c <= 0.01) continue;
            const x = x0 + ((i + 0.5) * texel);
            const z = z0 + ((j + 0.5) * texel);
            data[k * 4] = Math.round(floorShare(c, x, z) * 255);
            data[(k * 4) + 1] = Math.round(Math.min(1, wood.needles[k] / c) * 255);
            data[(k * 4) + 2] = Math.round(Math.min(1, wood.blossom[k] / c) * 255);
            data[(k * 4) + 3] = Math.round(Math.min(1, wood.gold[k] / c) * 255);
        }
    }
    return {
        data, res, extent: P.extent, x: P.x, z: P.z,
    };
}

/**
 * What grows on the floor. `reach`: none is drawn further than this from the eye that rides the rail (a fern
 * is three pixels there). `near`: up to here, u, the ground holds the most candidates.
 */
export const FOREST_FLOOR = Object.freeze({ reach: 330, near: 150 });

/**
 * The floor's plants: ferns where the wood is shut, in drifts and not everywhere; bracken along its edge,
 * where the light comes in; a fallen trunk or a stump here and there. None under the blossom (its floor is
 * petals), few under needles (theirs is duff and moss).
 *
 * @param {ReturnType<typeof forestClosure>} wood
 * @param {(x:number,z:number)=>number} eyeAt how near the eye ever comes
 * @returns {Array<{x:number,z:number,dEye:number,kind:'fern'|'bracken'|'log',id:string,scale:number,tall:number,keep:number,hue:number,
 *   rot:number,fleck:boolean,needles:number}>} `keep` is a site's place in the thinning of a lower tier
 */
export function forestFloorSites(wood, eyeAt) {
    const P = FOREST_FLOOR_PLATE;
    const { res } = wood;
    const texel = P.extent / res;
    const x0 = P.x - (P.extent / 2);
    const z0 = P.z - (P.extent / 2);
    const out = [];
    for (let j = 1; j < res - 1; j += 1) {
        for (let i = 1; i < res - 1; i += 1) {
            if (wood.closed[(j * res) + i] < 0.16) continue;
            const d = eyeAt(x0 + ((i + 0.5) * texel), z0 + ((j + 0.5) * texel));
            if (d > FOREST_FLOOR.reach) continue;
            let count = 3;
            if (d < FOREST_FLOOR.near) count = 5;
            else if (d < 230) count = 4;
            for (let n = 0; n < count; n += 1) {
                const salt = 760 + (n * 12);
                const x = x0 + ((i + hash2(i, j, salt)) * texel);
                const z = z0 + ((j + hash2(i, j, salt + 1)) * texel);
                const c = wood.at(x, z);
                if (c < 0.16) continue;
                const needles = wood.needlesAt(x, z) / c;
                const blossom = wood.blossomAt(x, z) / c;
                const gold = wood.goldAt(x, z) / c;
                if (blossom > 0.5) continue;
                const roll = hash2(i, j, salt + 2);
                const pickRoll = hash2(i, j, salt + 3);
                const size = hash2(i, j, salt + 4);
                const patch = (patchNoise(x, z, 27, 751) * 0.62) + (patchNoise(x, z, 9.5, 752) * 0.38);
                const site = {
                    x,
                    z,
                    dEye: eyeAt(x, z),
                    rot: hash2(i, j, salt + 5) * Math.PI * 2,
                    tall: hash2(i, j, salt + 7),
                    keep: hash2(i, j, salt + 8),
                    fleck: patchNoise(x, z, 8, 755) > 0.70,
                    needles,
                };
                if (c > 0.60 && roll < 0.016) {
                    let id = 'stump-mossy';
                    if (pickRoll < 0.42) id = 'log-short';
                    else if (pickRoll < 0.76) id = 'log-mossy';
                    out.push({
                        ...site, kind: 'log', id, scale: 0.9 + (0.45 * size), hue: hash2(i, j, salt + 6),
                    });
                    continue;
                }
                // Bracken stands where the light comes in under the wood's edge.
                const edge = smooth(0.18, 0.36, c) * smooth(0.86, 0.58, c);
                const stand = smooth(0.46, 0.60, patchNoise(x, z, 36, 753));
                if (roll < edge * stand * (needles > 0.6 ? 0.35 : 0.85)) {
                    // Green in the green west, copper here and there, and all of it on the gold side.
                    const turned = smooth(0.50, 0.78, patchNoise(x, z, 22, 754));
                    const hue = Math.min(1, (0.24 * turned) + (0.14 * hash2(i, j, salt + 6)) + (0.8 * gold));
                    out.push({
                        ...site, kind: 'bracken', id: pickRoll < 0.42 ? 'bracken-drift' : 'bracken-a', scale: 0.95 + (0.5 * size), hue,
                    });
                    continue;
                }
                const inside = smooth(0.40, 0.62, c) * smooth(0.33, 0.50, patch);
                if (roll < inside * (needles > 0.6 ? 0.40 : 0.92) * (1 - blossom)) {
                    let id = 'fern-b';
                    if (pickRoll < (d < FOREST_FLOOR.near ? 0.46 : 0.70)) id = 'fern-drift';
                    else if (pickRoll < 0.86) id = 'fern-a';
                    out.push({
                        ...site,
                        kind: 'fern',
                        id,
                        scale: 1.05 + (0.65 * size),
                        hue: Math.min(1, (0.55 * patchNoise(x, z, 40, 756)) + (0.45 * hash2(i, j, salt + 6)) + (0.3 * needles)),
                    });
                }
            }
        }
    }
    return out;
}

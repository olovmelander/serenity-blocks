// @ts-check
import { ODYSSEY_FOREST_MODELS } from './odyssey-forest-models.js';

/**
 * THE FOREST'S TREES, decoded (2026-11-24). scripts/blender/odyssey/odyssey_forest.py grows every
 * specimen in Blender and writes it here at two tiers: `hero` (near the rail) and `mid` (the middle
 * distance). A third tier is a photograph (assets/forest/far.png), whose frames are in `far`.
 *
 * A tier is
 *   cards  the foliage: one card a spray (hero) or a bough (mid). A card is its centre, its half
 *          length along the way the twig grows and half width, that growth axis, the normal of the
 *          foliage mass it belongs to, where it sits in the crown (-1..1 on each axis, 1 the crown's
 *          skin), the sky it sees through the other cards, its atlas tile and a random of its own.
 *          They are ordered so that any first part of them covers the whole crown evenly.
 *   bark   the wood, as triangles.
 * in the specimen's own metres: x across, y up, z across, its foot at the origin.
 *
 * THE PULL TEXTURE. A grove mixes every specimen in one draw, so the vertex shader does not read a
 * tree's shape from vertex attributes: it pulls it out of one small texture, at the place its instance
 * names. Four texels a card, two a bark vertex (three bark vertices a triangle):
 *   card  (centre xyz, half length) (axis xyz, half width) (mass normal xyz, tile + random * 0.5)
 *         (crown direction xyz, sky)
 *   bark  (position xyz, sky) (normal xyz, round + up * 32: where on its bark tile, 0..31 each)
 */

/** @typedef {{id: string, species: string, stage: string, bark: number, height: number, reach: number, trunkR: number, shade: number[][], fam: string, hero: any, mid: any}} ForestSpecimen */

export const FOREST_ATLAS = Object.freeze(ODYSSEY_FOREST_MODELS.atlas);
export const FOREST_BARKS = Object.freeze(ODYSSEY_FOREST_MODELS.barks);
/** The atlas tile a specimen's bark wears. @param {ForestSpecimen} spec */
export function forestBarkTile(spec) {
    return /** @type {any} */ (ODYSSEY_FOREST_MODELS.barkTiles)[FOREST_BARKS[spec.bark]];
}
/** @type {any} */
export const FOREST_FAR = ODYSSEY_FOREST_MODELS.far ? Object.freeze(ODYSSEY_FOREST_MODELS.far) : null;
/** @type {ReadonlyArray<ForestSpecimen>} */
export const FOREST_SPECIMENS = Object.freeze(/** @type {any} */ (ODYSSEY_FOREST_MODELS.specimens));

const byId = new Map(FOREST_SPECIMENS.map((s, i) => [s.id, i]));
/** The specimen's index, or -1. @param {string} id */
export function forestSpecimenIndex(id) {
    return byId.get(id) ?? -1;
}

const farById = new Map((FOREST_FAR?.specimens ?? []).map((/** @type {any} */ s, /** @type {number} */ i) => [s.name, i]));
/** The specimen's place among the far views, or -1 when it has none. @param {string} id */
export function forestFarIndex(id) {
    return farById.get(id) ?? -1;
}

/** @type {Uint8Array | null} */
let bytes = null;
function blob() {
    if (bytes) return bytes;
    const binary = atob(ODYSSEY_FOREST_MODELS.data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * One tier of one specimen as plain arrays (the tests and the pull texture read this).
 * @param {number} index the specimen's place in FOREST_SPECIMENS
 * @param {'hero'|'mid'} lod
 */
export function decodeForestTier(index, lod) {
    const tier = FOREST_SPECIMENS[index][lod];
    const b = blob();
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const { quant: q, cardBytes, barkBytes } = ODYSSEY_FOREST_MODELS;
    const n = tier.cards;
    const cards = {
        count: n,
        centre: new Float32Array(n * 3),
        half: new Float32Array(n * 2),
        axis: new Float32Array(n * 3),
        normal: new Float32Array(n * 3),
        dir: new Float32Array(n * 3),
        sky: new Float32Array(n),
        tile: new Uint8Array(n),
        random: new Float32Array(n),
    };
    for (let i = 0; i < n; i += 1) {
        const at = tier.cardAt + (i * cardBytes);
        for (let k = 0; k < 3; k += 1) {
            cards.centre[(i * 3) + k] = view.getInt16(at + (k * 2), true) * q;
            cards.axis[(i * 3) + k] = view.getInt8(at + 10 + k) / 127;
            cards.normal[(i * 3) + k] = view.getInt8(at + 13 + k) / 127;
            cards.dir[(i * 3) + k] = view.getInt8(at + 16 + k) / 127;
        }
        cards.half[i * 2] = view.getInt16(at + 6, true) * q;
        cards.half[(i * 2) + 1] = view.getInt16(at + 8, true) * q;
        cards.sky[i] = b[at + 19] / 255;
        cards.tile[i] = b[at + 20];
        cards.random[i] = b[at + 21] / 255;
    }
    const v = tier.barkVerts;
    const bark = {
        verts: v,
        position: new Float32Array(v * 3),
        normal: new Float32Array(v * 3),
        sky: new Float32Array(v),
        uv: new Uint8Array(v * 2),
        index: new Uint16Array(tier.barkIndices),
    };
    for (let i = 0; i < v; i += 1) {
        const at = tier.barkAt + (i * barkBytes);
        for (let k = 0; k < 3; k += 1) {
            bark.position[(i * 3) + k] = view.getInt16(at + (k * 2), true) * q;
            bark.normal[(i * 3) + k] = view.getInt8(at + 6 + k) / 127;
        }
        bark.sky[i] = b[at + 9] / 255;
        bark.uv[i * 2] = b[at + 10];
        bark.uv[(i * 2) + 1] = b[at + 11];
    }
    for (let i = 0; i < tier.barkIndices; i += 1) bark.index[i] = view.getUint16(tier.indexAt + (i * 2), true);
    return { cards, bark };
}

/** @type {number[]} */
const skirts = [];
/**
 * How far from the trunk a specimen's foliage or wood stands below a deer's back (2.2 m), in its own
 * metres: what walks past a tree keeps out of this, whatever its crown does overhead.
 * @param {number} index
 */
export function forestSkirt(index) {
    if (skirts[index] !== undefined) return skirts[index];
    const { cards } = decodeForestTier(index, 'hero');
    let r = FOREST_SPECIMENS[index].trunkR * 1.5;
    for (let i = 0; i < cards.count; i += 1) {
        const y = cards.centre[(i * 3) + 1];
        const reach = Math.max(cards.half[i * 2], cards.half[(i * 2) + 1]);
        if (y - (reach * 0.7) < 2.2) {
            r = Math.max(r, Math.hypot(cards.centre[i * 3], cards.centre[(i * 3) + 2]) + (reach * 0.35));
        }
    }
    skirts[index] = r;
    return r;
}

export const FOREST_PULL_WIDTH = 512;

/** @type {any} */
let pull = null;
/**
 * Every tier of every specimen laid out for the vertex shader (see the header), once.
 * @returns {{data: Float32Array, width: number, height: number,
 *   ranges: {hero: Array<{cardAt: number, cards: number, barkAt: number, barkVerts: number}>,
 *            mid: Array<{cardAt: number, cards: number, barkAt: number, barkVerts: number}>}}}
 *   `ranges` in texels (bark in vertices of the unindexed wood)
 */
export function buildForestPull() {
    if (pull) return pull;
    /** @type {any} */
    const ranges = { hero: [], mid: [] };
    /** @type {Array<{index: number, lod: 'hero'|'mid', at: number}>} */
    const tiers = [];
    let texels = 0;
    FOREST_SPECIMENS.forEach((spec, index) => {
        (/** @type {Array<'hero'|'mid'>} */ (['hero', 'mid'])).forEach((lod) => {
            const { cards, barkIndices } = spec[lod];
            ranges[lod].push({
                cardAt: texels, cards, barkAt: texels + (cards * 4), barkVerts: barkIndices,
            });
            tiers.push({ index, lod, at: texels });
            texels += (cards * 4) + (barkIndices * 2);
        });
    });
    const width = FOREST_PULL_WIDTH;
    const height = Math.ceil(texels / width);
    const data = new Float32Array(width * height * 4);
    tiers.forEach(({ index, lod, at }) => {
        const { cards, bark } = decodeForestTier(index, lod);
        let o = at * 4;
        for (let i = 0; i < cards.count; i += 1) {
            data[o] = cards.centre[i * 3];
            data[o + 1] = cards.centre[(i * 3) + 1];
            data[o + 2] = cards.centre[(i * 3) + 2];
            data[o + 3] = cards.half[i * 2];
            data[o + 4] = cards.axis[i * 3];
            data[o + 5] = cards.axis[(i * 3) + 1];
            data[o + 6] = cards.axis[(i * 3) + 2];
            data[o + 7] = cards.half[(i * 2) + 1];
            data[o + 8] = cards.normal[i * 3];
            data[o + 9] = cards.normal[(i * 3) + 1];
            data[o + 10] = cards.normal[(i * 3) + 2];
            // The tile whole, the card's random in the fraction's lower half (a half float holds both).
            data[o + 11] = cards.tile[i] + (Math.round(cards.random[i] * 7) / 16);
            data[o + 12] = cards.dir[i * 3];
            data[o + 13] = cards.dir[(i * 3) + 1];
            data[o + 14] = cards.dir[(i * 3) + 2];
            data[o + 15] = cards.sky[i];
            o += 16;
        }
        for (let i = 0; i < bark.index.length; i += 1) {
            const v = bark.index[i];
            data[o] = bark.position[v * 3];
            data[o + 1] = bark.position[(v * 3) + 1];
            data[o + 2] = bark.position[(v * 3) + 2];
            data[o + 3] = bark.sky[v];
            data[o + 4] = bark.normal[v * 3];
            data[o + 5] = bark.normal[(v * 3) + 1];
            data[o + 6] = bark.normal[(v * 3) + 2];
            data[o + 7] = bark.uv[v * 2] + (bark.uv[(v * 2) + 1] * 32);
            o += 8;
        }
    });
    pull = {
        data, width, height, ranges,
    };
    return pull;
}

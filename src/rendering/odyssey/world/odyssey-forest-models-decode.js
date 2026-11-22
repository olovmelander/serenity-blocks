// @ts-check
import { ODYSSEY_FOREST_MODELS } from './odyssey-forest-models.js';

/**
 * THE GROWN BROADLEAVES (2026-11-22), decoded. scripts/blender/odyssey/odyssey_trees.py grows three
 * specimens of each broadleaf species in Blender (a trunk that leans, scaffold limbs that fork, the
 * foliage gathered where the branches end) and writes them, tier by tier, into
 * odyssey-forest-models.js. This turns one tier of one specimen back into the record the forest
 * builder hands to `buildForestTreeGeometry`: the forest's own vertex contract (FOREST_LEAF_CARD),
 * leaf cards first, six vertices a card at its centre, then the bark, three vertices a triangle.
 *
 * `aVert` per vertex, as the procedural crown writes it:
 *   card  (depth in the crown, height in crown, flag + size / sizeMax, height / total height)
 *   bark  (the sky the wood sees, 0, 0, height / total height)
 * with the last lane 0 on the far tier (distant trees do not shimmer).
 *
 * A growth stage is a proportion change (the species table's `h` and `w`), so a stage scales the
 * specimen: x and z by `w`, y by `h`, normals by the inverse, a card's radius by `w`.
 */

function decodeBase64(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/** Whether `speciesId` has grown specimens. */
export function hasGrownForestModel(speciesId) {
    return Boolean(ODYSSEY_FOREST_MODELS.species[speciesId]);
}

/** How many specimens a species has (the world uses three variants a bucket). */
export function grownForestVariantCount(speciesId) {
    return ODYSSEY_FOREST_MODELS.species[speciesId]?.length ?? 0;
}

const raw = new Map();

/** One tier of one specimen, decoded once to plain typed arrays in the specimen's own units. */
function rawTier(speciesId, lod, variant) {
    const key = `${speciesId}|${lod}|${variant}`;
    const hit = raw.get(key);
    if (hit) return hit;
    const specimens = ODYSSEY_FOREST_MODELS.species[speciesId];
    if (!specimens) throw new Error(`[OdysseyForest] no grown model for "${speciesId}"`);
    const tier = specimens[variant % specimens.length][lod];
    if (!tier) throw new Error(`[OdysseyForest] no "${lod}" tier for "${speciesId}"`);
    const { quant } = ODYSSEY_FOREST_MODELS;
    const decoded = {
        tier,
        cardPositions: Float32Array.from(decodeBase64(tier.cardPositions, Int16Array), (v) => v * quant),
        cardNormals: Float32Array.from(decodeBase64(tier.cardNormals, Int8Array), (v) => v / 127),
        cardData: decodeBase64(tier.cardData, Uint8Array),
        barkPositions: Float32Array.from(decodeBase64(tier.barkPositions, Int16Array), (v) => v * quant),
        barkNormals: Float32Array.from(decodeBase64(tier.barkNormals, Int8Array), (v) => v / 127),
        barkAo: decodeBase64(tier.barkAo, Uint8Array),
        barkIndex: decodeBase64(tier.barkIndex, Uint16Array),
    };
    raw.set(key, decoded);
    return decoded;
}

const unit = (x, y, z) => {
    const l = Math.hypot(x, y, z);
    return l > 1e-9 ? [x / l, y / l, z / l] : [0, 1, 0];
};

/**
 * The builder's record for one tier of one grown specimen at one growth stage.
 * @param {string} speciesId
 * @param {{h: number, w: number}} stage
 * @param {'hero'|'mid'|'far'} lod
 * @param {number} variant which specimen (taken modulo the species' count)
 * @param {{flag: number, sizeMax: number}} card FOREST_LEAF_CARD's flag and size range
 */
export function decodeGrownForestTier(speciesId, stage, lod, variant, card) {
    const r = rawTier(speciesId, lod, Math.abs(Math.trunc(variant)));
    const sw = stage?.w ?? 1;
    const sh = stage?.h ?? 1;
    const totalH = r.tier.totalH * sh;
    const far = lod === 'far';
    const cards = r.tier.cardCount;
    // The bark is stored indexed; the forest draws it unindexed (three vertices a triangle).
    const barkVerts = r.tier.barkIndices;
    const count = (cards * 6) + barkVerts;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const vert = new Float32Array(count * 4);
    let o = 0;
    for (let c = 0; c < cards; c += 1) {
        const x = r.cardPositions[c * 3] * sw;
        const y = r.cardPositions[(c * 3) + 1] * sh;
        const z = r.cardPositions[(c * 3) + 2] * sw;
        const [nx, ny, nz] = unit(
            r.cardNormals[c * 3] / sw,
            r.cardNormals[(c * 3) + 1] / sh,
            r.cardNormals[(c * 3) + 2] / sw,
        );
        const depth = r.cardData[c * 3] / 255;
        const along = r.cardData[(c * 3) + 1] / 255;
        const size = Math.min((r.cardData[(c * 3) + 2] / 255) * ODYSSEY_FOREST_MODELS.sizeMax * sw, card.sizeMax * 0.999);
        const kind = card.flag + (Math.max(size, 0.06) / card.sizeMax);
        const wind = far ? 0 : Math.max(0, Math.min(1, y / (totalH || 1)));
        for (let k = 0; k < 6; k += 1) {
            positions[o * 3] = x; positions[(o * 3) + 1] = y; positions[(o * 3) + 2] = z;
            normals[o * 3] = nx; normals[(o * 3) + 1] = ny; normals[(o * 3) + 2] = nz;
            vert[o * 4] = depth; vert[(o * 4) + 1] = along; vert[(o * 4) + 2] = kind; vert[(o * 4) + 3] = wind;
            o += 1;
        }
    }
    for (let i = 0; i < barkVerts; i += 1) {
        const v = r.barkIndex[i];
        const x = r.barkPositions[v * 3] * sw;
        const y = Math.max(0, r.barkPositions[(v * 3) + 1] * sh);
        const z = r.barkPositions[(v * 3) + 2] * sw;
        const [nx, ny, nz] = unit(
            r.barkNormals[v * 3] / sw,
            r.barkNormals[(v * 3) + 1] / sh,
            r.barkNormals[(v * 3) + 2] / sw,
        );
        positions[o * 3] = x; positions[(o * 3) + 1] = y; positions[(o * 3) + 2] = z;
        normals[o * 3] = nx; normals[(o * 3) + 1] = ny; normals[(o * 3) + 2] = nz;
        vert[o * 4] = r.barkAo[v] / 255;
        vert[(o * 4) + 1] = 0;
        vert[(o * 4) + 2] = 0;
        vert[(o * 4) + 3] = far ? 0 : Math.max(0, Math.min(1, y / (totalH || 1)));
        o += 1;
    }
    return {
        positions,
        normals,
        vert,
        totalH,
        crownW: r.tier.crownW * sw,
        centreY: r.tier.centreY * sh,
        hullTriangles: cards * 2,
        cards: true,
        grown: true,
    };
}

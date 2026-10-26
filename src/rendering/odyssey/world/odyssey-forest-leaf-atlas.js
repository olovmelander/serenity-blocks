/**
 * THE LEAF ATLAS (the leafy crowns, 2026-10-26) — the texture every broadleaf leaf card draws.
 *
 * Four leaf clumps in a 2 x 2 atlas, generated here at load: no imported asset (the world's
 * charter). Each clump is a rosette of pointed leaves, broad ones round the middle and a fringe
 * whose tips reach the rim at uneven lengths, so a card's outline is leafy and the gaps between
 * fringe leaves let the sky through.
 *
 *   r  coverage as a signed distance: 0.5 on a leaf's edge, rising inside, `sdfRange` texels to
 *      either side. A distance (not a 0/1 mask) keeps the outline crisp through every mip, which
 *      a mask would blur into a grey halo.
 *   g  the leaf's own tone (one value a leaf, a little lighter toward its tip): neighbouring
 *      leaves separate by value, like painted dabs.
 *   b  distance from the clump's centre (0 middle, 1 rim): the clump's inner shade and its edge.
 *   a  255
 *
 * Pure arithmetic, no three.js: the renderer wraps `data` in a texture, and a test reads it.
 */
export const FOREST_LEAF_ATLAS = Object.freeze({
    res: 256,
    tiles: 2,
    sdfRange: 8,
});

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One clump's leaves, in the tile's unit disc (centre 0, rim 1).
 * @returns {Array<{bx:number,by:number,cx:number,sy:number,len:number,half:number,tone:number}>}
 */
function clumpLeaves(seed) {
    const rnd = mulberry32(seed);
    const leaves = [];
    const add = (baseR, baseA, dirA, len, half) => {
        const bx = Math.cos(baseA) * baseR;
        const by = Math.sin(baseA) * baseR;
        leaves.push({
            bx, by, cx: Math.cos(dirA), sy: Math.sin(dirA), len, half, tone: rnd(),
        });
    };
    // Leaves scattered over the whole disc, denser toward the middle, each turned loosely
    // outward (a foliage clump, not a flower: no shared centre for them to radiate from).
    const count = 72 + Math.floor(rnd() * 10);
    for (let i = 0; i < count; i += 1) {
        const a = rnd() * Math.PI * 2;
        const baseR = 0.82 * Math.sqrt(rnd()) * (0.55 + (0.45 * rnd()));
        // Inner leaves lie any way (they make the body); outer ones lean outward (the fringe).
        const spread = baseR < 0.3 ? Math.PI * 2 : 2.2;
        const turn = a + ((rnd() - 0.5) * spread);
        // Tips may reach the rim but never past it (the card's own edge).
        const len = 0.18 + (rnd() * 0.13);
        const bx = Math.cos(a) * baseR;
        const by = Math.sin(a) * baseR;
        const tip = Math.hypot(bx + (Math.cos(turn) * len), by + (Math.sin(turn) * len));
        const fit = tip > 0.97 ? len - (tip - 0.97) : len;
        if (fit > 0.08) add(baseR, a, turn, fit, 0.065 + (rnd() * 0.035));
    }
    return leaves;
}

/**
 * A pointed leaf's signed distance (negative inside), roughly: |y| against the leaf's half width,
 * which swells from the base and comes to a point at the tip; past either end, the distance to
 * that end.
 */
function leafDistance(px, py, leaf) {
    const dx = px - leaf.bx;
    const dy = py - leaf.by;
    const x = (dx * leaf.cx) + (dy * leaf.sy);
    const y = (-dx * leaf.sy) + (dy * leaf.cx);
    if (x < 0) return Math.hypot(x, y);
    if (x > leaf.len) return Math.hypot(x - leaf.len, y);
    const t = x / leaf.len;
    const width = leaf.half * Math.sin(Math.PI * Math.min(1, (t * 0.85) + 0.08)) ** 0.8;
    return Math.abs(y) - width;
}

/**
 * Bake the atlas.
 * @param {number} [seed]
 * @returns {{data: Uint8Array, res: number, tiles: number}}
 */
export function bakeForestLeafAtlas(seed = 7177) {
    const { res, tiles, sdfRange } = FOREST_LEAF_ATLAS;
    const tile = res / tiles;
    const data = new Uint8Array(res * res * 4);
    for (let ty = 0; ty < tiles; ty += 1) {
        for (let tx = 0; tx < tiles; tx += 1) {
            const leaves = clumpLeaves(seed + (((ty * tiles) + tx) * 7919));
            for (let j = 0; j < tile; j += 1) {
                for (let i = 0; i < tile; i += 1) {
                    const px = (((i + 0.5) / tile) * 2) - 1;
                    const py = (((j + 0.5) / tile) * 2) - 1;
                    let best = Infinity;
                    let bestLeaf = null;
                    let along = 0;
                    for (let k = 0; k < leaves.length; k += 1) {
                        const d = leafDistance(px, py, leaves[k]);
                        if (d < best) {
                            best = d;
                            bestLeaf = leaves[k];
                        }
                    }
                    if (bestLeaf) {
                        const x = ((px - bestLeaf.bx) * bestLeaf.cx) + ((py - bestLeaf.by) * bestLeaf.sy);
                        along = Math.min(1, Math.max(0, x / bestLeaf.len));
                    }
                    // In texels of this tile: the disc's radius is tile / 2 texels.
                    const dTexels = best * (tile / 2);
                    const r = Math.min(1, Math.max(0, 0.5 - (dTexels / (2 * sdfRange))));
                    const tone = bestLeaf ? Math.min(1, (bestLeaf.tone * 0.85) + (along * 0.15)) : 0;
                    const o = ((((ty * tile) + j) * res) + (tx * tile) + i) * 4;
                    data[o] = Math.round(r * 255);
                    data[o + 1] = Math.round(tone * 255);
                    data[o + 2] = Math.round(Math.min(1, Math.hypot(px, py)) * 255);
                    data[o + 3] = 255;
                }
            }
        }
    }
    return { data, res, tiles };
}

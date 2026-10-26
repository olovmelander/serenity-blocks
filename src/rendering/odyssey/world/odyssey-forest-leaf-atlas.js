/**
 * THE LEAF ATLAS (the leafy crowns, 2026-10-26) — the texture every leaf card draws.
 *
 * Generated here at load: no imported asset (the world's charter). Two rows of four tiles:
 *
 *   row 0  LEAF CLUMPS (broadleaf): rosettes of pointed leaves scattered over a disc, a solid body
 *          and a fringe whose tips reach the rim at uneven lengths, so a card's outline is leafy
 *          and the gaps between fringe leaves let the sky through.
 *   row 1  NEEDLE SPRAYS (conifers): a branch arched across the tile, ends drooping, hung with
 *          needles (a few standing up from it), so a ring of them reads as a drooping tier.
 *
 * Channels:
 *   r  coverage as a signed distance: 0.5 on an edge, rising inside, `sdfRange` texels to either
 *      side. A distance (not a 0/1 mask) keeps the outline crisp through every mip, which a mask
 *      would blur into a grey halo.
 *   g  the leaf's or needle's own tone (one value each, a little lighter toward its tip), so
 *      neighbours separate by value, like painted dabs.
 *   b  inner shade, 0 open .. 1 deep: a clump's middle, or a spray's hanging underside.
 *   a  255
 *
 * Pure arithmetic, no three.js: the renderer wraps `data` in a texture, and a test reads it.
 */
export const FOREST_LEAF_ATLAS = Object.freeze({
    tile: 128,
    tilesX: 4,
    tilesY: 2,
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

/** The arch a spray's branch follows, across the tile: high in the middle, the ends drooping. */
const sprayArch = (x) => 0.34 - (0.46 * x * x);

/**
 * One spray's needles (thin leaves) along its branch, plus the branch itself.
 */
function sprayNeedles(seed) {
    const rnd = mulberry32(seed);
    const needles = [];
    const add = (bx, by, dirA, len, half) => {
        needles.push({
            bx, by, cx: Math.cos(dirA), sy: Math.sin(dirA), len, half, tone: rnd(),
        });
    };
    // The branch, as a chain of short stout segments along the arch.
    for (let k = 0; k < 8; k += 1) {
        const x0 = -0.82 + (k * (1.64 / 8));
        const x1 = x0 + (1.64 / 8);
        const y0 = sprayArch(x0);
        const y1 = sprayArch(x1);
        add(x0, y0, Math.atan2(y1 - y0, x1 - x0), Math.hypot(x1 - x0, y1 - y0), 0.03);
    }
    const count = 230 + Math.floor(rnd() * 30);
    for (let i = 0; i < count; i += 1) {
        const s = ((rnd() * 2) - 1) * 0.84;
        const by = sprayArch(s);
        // Most hang down and out from the branch; a quarter stand up off it, shorter.
        const up = rnd() < 0.25;
        const out = Math.sign(s || 1) * 0.35;
        const dirA = up
            ? (Math.PI / 2) + ((rnd() - 0.5) * 1.3) - out
            : (-Math.PI / 2) + ((rnd() - 0.5) * 1.6) + out;
        let len = up ? 0.12 + (rnd() * 0.14) : 0.24 + (rnd() * 0.30);
        // Shorter toward the drooping ends, so the spray tapers.
        len *= 1 - (0.45 * Math.abs(s));
        const tx = s + (Math.cos(dirA) * len);
        const ty = by + (Math.sin(dirA) * len);
        // Tips clear the rim by the needle's own width.
        const over = Math.hypot(tx, ty) - 0.93;
        if (over > 0) len -= over;
        if (len > 0.05) add(s, by, dirA, len, 0.016 + (rnd() * 0.008));
    }
    return needles;
}

/**
 * A pointed leaf's (or needle's) signed distance (negative inside), roughly: |y| against the
 * half width, which swells from the base and comes to a point at the tip; past either end, the
 * distance to that end.
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
 * Bake the atlas. Each shape writes only the texels round its own bounds (its distance reaches
 * `sdfRange` texels past its edge and no further), not every texel of the tile: ~10x faster than
 * testing every shape at every texel, which cost ~350 ms of the world's main-thread build. Baked
 * once and kept (the data never changes); the renderer wraps it in a texture per world.
 * @param {number} [seed]
 * @returns {{data: Uint8Array, width: number, height: number, tile: number, tilesX: number,
 *   tilesY: number}}
 */
const baked = new Map();
export function bakeForestLeafAtlas(seed = 7177) {
    if (baked.has(seed)) return baked.get(seed);
    const {
        tile, tilesX, tilesY, sdfRange,
    } = FOREST_LEAF_ATLAS;
    const width = tile * tilesX;
    const height = tile * tilesY;
    const data = new Uint8Array(width * height * 4);
    const toUnit = (k) => (((k + 0.5) / tile) * 2) - 1;
    const margin = (2 * sdfRange) / tile;
    const dist = new Float32Array(tile * tile);
    const owner = new Int32Array(tile * tile);
    for (let ty = 0; ty < tilesY; ty += 1) {
        for (let tx = 0; tx < tilesX; tx += 1) {
            const tileSeed = seed + (((ty * tilesX) + tx) * 7919);
            const spray = ty === 1;
            const shapes = spray ? sprayNeedles(tileSeed) : clumpLeaves(tileSeed);
            dist.fill(Infinity);
            owner.fill(-1);
            shapes.forEach((sh, si) => {
                const ex = sh.bx + (sh.cx * sh.len);
                const ey = sh.by + (sh.sy * sh.len);
                const pad = sh.half + margin;
                const i0 = Math.max(0, Math.floor((((Math.min(sh.bx, ex) - pad) + 1) / 2) * tile));
                const i1 = Math.min(tile - 1, Math.ceil((((Math.max(sh.bx, ex) + pad) + 1) / 2) * tile));
                const j0 = Math.max(0, Math.floor((((Math.min(sh.by, ey) - pad) + 1) / 2) * tile));
                const j1 = Math.min(tile - 1, Math.ceil((((Math.max(sh.by, ey) + pad) + 1) / 2) * tile));
                for (let j = j0; j <= j1; j += 1) {
                    for (let i = i0; i <= i1; i += 1) {
                        const d = leafDistance(toUnit(i), toUnit(j), sh);
                        const k = (j * tile) + i;
                        if (d < dist[k]) {
                            dist[k] = d;
                            owner[k] = si;
                        }
                    }
                }
            });
            for (let j = 0; j < tile; j += 1) {
                for (let i = 0; i < tile; i += 1) {
                    const px = toUnit(i);
                    const py = toUnit(j);
                    const k = (j * tile) + i;
                    const sh = owner[k] >= 0 ? shapes[owner[k]] : null;
                    let along = 0;
                    if (sh) {
                        const x = ((px - sh.bx) * sh.cx) + ((py - sh.by) * sh.sy);
                        along = Math.min(1, Math.max(0, x / sh.len));
                    }
                    // In texels of this tile: the disc's radius is tile / 2 texels. Untouched
                    // texels are past every shape's reach: no coverage.
                    const dTexels = sh ? dist[k] * (tile / 2) : Infinity;
                    const r = Math.min(1, Math.max(0, 0.5 - (dTexels / (2 * sdfRange))));
                    // Past every shape a neutral tone (no threshold shift), so a mip blending the
                    // sky round a leaf into it does not darken its edge.
                    const tone = sh ? Math.min(1, (sh.tone * 0.85) + (along * 0.15)) : 0.5;
                    const inner = spray
                        ? Math.min(1, Math.max(0, (sprayArch(px) - py + 0.05) / 0.4))
                        : Math.min(1, Math.max(0, 1 - Math.hypot(px, py)));
                    const o = ((((ty * tile) + j) * width) + (tx * tile) + i) * 4;
                    data[o] = Math.round(r * 255);
                    data[o + 1] = Math.round(tone * 255);
                    data[o + 2] = Math.round(inner * 255);
                    data[o + 3] = 255;
                }
            }
        }
    }
    const out = {
        data, width, height, tile, tilesX, tilesY,
    };
    baked.set(seed, out);
    return out;
}

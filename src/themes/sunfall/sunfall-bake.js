/**
 * Sunfall — deterministic CPU bakes.
 *
 * - `lattice` (256² RGBA8, repeat, no mips): white noise read as 3D value noise in one fetch
 *   (two z-slices side by side: G is R shifted one slice, A is B), after Void Ember.
 * - `fbm` (256² RGBA8, repeat, mipped): four independent tileable fBm fields, base period
 *   4 cells (so a feature is about a quarter of the tile): cloud deck, leaf mass, detail.
 * - `oculus` (256 × 64 RG8, repeat in u, mipped): the skylight in polar coordinates round its
 *   centre (u = angle / 2π, v = radius / 1.4 in oculus radii). R is the rock rim: open inside
 *   a ragged edge of several scales, with a few great trunks and boulders leaning over it.
 *   G is the vine fringe: hanging lianas and roots in the outer band, lengthwise slits of
 *   light between them. The shader rotates G alone (the Turning) so the hole never moves.
 * - `canopy` (512² R16F): the height of the canopy's top over the chamber floor, rasterised
 *   from the authored crown plan over the floor grid; the crowns' sun shadows march it.
 */
import * as THREE from 'three/webgpu';
import {
    SUNFALL_SEED, clamp01, mulberry32, smooth,
} from './sunfall-core.js';

export const LATTICE_SIZE = 256;
export const LATTICE_SLICE = Object.freeze([37, 17]);
export const FBM_SIZE = 256;
export const OCULUS_TEX = Object.freeze({ width: 256, height: 64, reach: 1.4 });
export const CANOPY_TEX_SIZE = 512;

export function bakeLattice(seed = SUNFALL_SEED, size = LATTICE_SIZE) {
    const rand = mulberry32(seed ^ 0x1a77);
    const r = new Uint8Array(size * size);
    const b = new Uint8Array(size * size);
    for (let i = 0; i < r.length; i += 1) {
        r[i] = Math.floor(rand() * 256);
        b[i] = Math.floor(rand() * 256);
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const i = y * size + x;
            const j = ((y + LATTICE_SLICE[1]) % size) * size + ((x + LATTICE_SLICE[0]) % size);
            data[i * 4] = r[i];
            data[i * 4 + 1] = r[j];
            data[i * 4 + 2] = b[i];
            data[i * 4 + 3] = b[j];
        }
    }
    return data;
}

function makeTileHash(seed) {
    const rng = mulberry32(seed);
    const table = new Float32Array(4096);
    for (let i = 0; i < table.length; i += 1) table[i] = rng();
    return (ix, iy, period) => {
        const px = ((ix % period) + period) % period;
        const py = ((iy % period) + period) % period;
        const h = Math.imul(px, 374761393) + Math.imul(py, 668265263) + Math.imul(period, 2246822519);
        return table[((h ^ (h >>> 13)) >>> 0) & 4095];
    };
}

function tileNoise(u, v, period, hash) {
    const x = u * period;
    const y = v * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash(ix, iy, period);
    const b = hash(ix + 1, iy, period);
    const c = hash(ix, iy + 1, period);
    const d = hash(ix + 1, iy + 1, period);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function tileFbm(u, v, base, octaves, hash) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let p = base;
    for (let o = 0; o < octaves; o += 1) {
        sum += tileNoise(u, v, p, hash) * amp;
        norm += amp;
        amp *= 0.5;
        p *= 2;
    }
    return sum / norm;
}

/** Four independent tileable fBm fields (RGBA), each with a base period of four cells. */
export function bakeFbm(seed = SUNFALL_SEED, size = FBM_SIZE) {
    const hashes = [0x101, 0x202, 0x303, 0x404].map((k) => makeTileHash(seed ^ k));
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        const v = y / size;
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const i = (y * size + x) * 4;
            for (let c = 0; c < 4; c += 1) {
                // Stretch the contrast round the mean: fBm piles up near 0.5.
                const n = tileFbm(u, v, 4, 5, hashes[c]);
                data[i + c] = Math.round(clamp01((n - 0.5) * 1.9 + 0.5) * 255);
            }
        }
    }
    return data;
}

/**
 * The skylight in polar coordinates. R: the rock rim (1 open, 0 rock). G: the vine fringe
 * (1 clear, lower where lianas and roots hang across the light).
 */
export function bakeOculus(seed = SUNFALL_SEED, { width, height, reach } = OCULUS_TEX) {
    const rng = mulberry32(seed ^ 0x0c01);
    const h1 = makeTileHash(seed ^ 0x0c02);
    const h2 = makeTileHash(seed ^ 0x0c03);
    // A few great occluders over the rim: leaning trunks and boulders (angle, reach, width).
    const leaners = Array.from({ length: 7 }, () => ({
        a: rng(), depth: 0.12 + rng() * 0.22, w: 0.006 + rng() * 0.014,
    }));
    // The lianas: thin vertical strands at random angles, reaching into the opening.
    const vines = Array.from({ length: 120 }, () => ({
        a: rng(), reach: 0.10 + rng() * 0.48, w: 0.0018 + rng() * 0.006, density: 0.6 + rng() * 0.4,
    }));
    // The rim forest's boughs leaning out over the opening: leafy tongues, widest at the rim and
    // tapering to a tip, dappled with gaps. They comb the column into separate shafts with dark
    // lanes between them (a ring of vines alone left its middle one even tube of light).
    const boughs = Array.from({ length: 7 }, (_, k) => ({
        a: (k + 0.2 + rng() * 0.6) / 7,
        depth: 0.24 + rng() * 0.30,
        w: 0.018 + rng() * 0.022,
        bend: (rng() - 0.5) * 0.05,
    }));
    const h3 = makeTileHash(seed ^ 0x0c04);
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        const r = ((y + 0.5) / height) * reach;
        for (let x = 0; x < width; x += 1) {
            const u = (x + 0.5) / width;
            // The rim: ragged at three scales (bays, blocks, crumbs), about r = 1.
            const rag = (tileFbm(u, 0.37, 5, 4, h1) - 0.5) * 0.30
                + (tileNoise(u, 0.81, 23, h2) - 0.5) * 0.07;
            const edge = 1.0 + rag;
            let open = 1 - smooth(edge - 0.035, edge + 0.035, r);
            for (const l of leaners) {
                let d = Math.abs(u - l.a);
                d = Math.min(d, 1 - d);
                const inBand = smooth(edge - l.depth - 0.02, edge - l.depth + 0.04, r);
                open *= 1 - (1 - smooth(l.w * 0.6, l.w, d)) * inBand;
            }
            let clear = 1;
            for (const vn of vines) {
                let d = Math.abs(u - vn.a);
                d = Math.min(d, 1 - d);
                const inBand = smooth(edge - vn.reach - 0.03, edge - vn.reach + 0.03, r);
                clear *= 1 - (1 - smooth(vn.w * 0.5, vn.w, d)) * inBand * vn.density;
            }
            let bough = 0;
            for (const b of boughs) {
                const tip = edge - b.depth;
                const toRim = clamp01((r - tip) / b.depth);
                // The tongue bends a little along its length, and its edge is leafy.
                let d = Math.abs(u - b.a - b.bend * (1 - toRim));
                d = Math.min(d, 1 - d);
                const lobe = 0.75 + 0.5 * tileNoise(u, r / reach, 32, h3);
                const half = b.w * (0.3 + 0.7 * Math.sqrt(toRim)) * lobe;
                const across = 1 - smooth(half * 0.55, half, d);
                bough = Math.max(bough, across * smooth(tip - 0.01, tip + 0.07, r));
            }
            // Leaf gaps: sun flecks through the bough (fine) and holes between its sprays (coarser).
            const gaps = 0.55 * tileNoise(u, r / reach, 64, h3) + 0.45 * tileNoise(u, r / reach, 16, h2);
            clear *= 1 - bough * (0.92 - 0.6 * smooth(0.55, 0.78, gaps));
            const i = (y * width + x) * 4;
            data[i] = Math.round(clamp01(open) * 255);
            data[i + 1] = Math.round(clamp01(clear) * 255);
            data[i + 2] = 0;
            data[i + 3] = 255;
        }
    }
    return data;
}

/**
 * The canopy's top height (metres) on a regular grid over the floor grid's extent: the floor
 * where no crown stands, a dome per crown (its top at the authored height, falling as d²).
 */
export function bakeCanopyHeight(plan, floorGrid, crownScale = [0.92, 0.26], size = CANOPY_TEX_SIZE) {
    const [x0, x1] = floorGrid.x;
    const [z0, z1] = floorGrid.z;
    const [gw, gh] = floorGrid.size;
    const { heights } = floorGrid;
    const out = new Float32Array(size * size);
    const sx = (x1 - x0) / (size - 1);
    const sz = (z1 - z0) / (size - 1);
    for (let j = 0; j < size; j += 1) {
        const fz = (j / (size - 1)) * (gh - 1);
        const jz = Math.min(gh - 2, Math.floor(fz));
        const tz = fz - jz;
        for (let i = 0; i < size; i += 1) {
            const fx = (i / (size - 1)) * (gw - 1);
            const ix = Math.min(gw - 2, Math.floor(fx));
            const tx = fx - ix;
            const a = heights[jz * gw + ix];
            const b = heights[jz * gw + ix + 1];
            const c = heights[(jz + 1) * gw + ix];
            const d = heights[(jz + 1) * gw + ix + 1];
            out[j * size + i] = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
        }
    }
    const { position, crown, count } = plan;
    for (let k = 0; k < count; k += 1) {
        const cx = position[k * 3];
        const top = position[k * 3 + 1];
        const cz = position[k * 3 + 2];
        const radius = crown[k * 4];
        const tone = crown[k * 4 + 2] - Math.floor(crown[k * 4 + 2]);
        const vs = radius * (crownScale[0] + crownScale[1] * tone);
        const reach = radius * 1.05;
        const i0 = Math.max(0, Math.floor((cx - reach - x0) / sx));
        const i1 = Math.min(size - 1, Math.ceil((cx + reach - x0) / sx));
        const j0 = Math.max(0, Math.floor((cz - reach - z0) / sz));
        const j1 = Math.min(size - 1, Math.ceil((cz + reach - z0) / sz));
        for (let j = j0; j <= j1; j += 1) {
            const pz = z0 + j * sz;
            for (let i = i0; i <= i1; i += 1) {
                const px = x0 + i * sx;
                const d = Math.hypot(px - cx, pz - cz) / radius;
                if (d < 1.05) {
                    const h = top - vs * 0.85 * d * d;
                    const at = j * size + i;
                    if (h > out[at]) out[at] = h;
                }
            }
        }
    }
    return out;
}

function repeatTexture(data, width, height, { mips = true, name = '' } = {}) {
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.generateMipmaps = mips;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

/**
 * The understory: one continuous layer of dark foliage about 20 m over the floor, under the
 * crowns, so a gap in the canopy shows deep leaves and never bare floor. A `size`² grid over
 * the floor grid's bounds: `position` (x, y, z per vertex), `mask` (1 where crowns stand
 * round it within about 14 m, 0 where the layer is cut away, so it never meets the walls)
 * and 16-bit `index`.
 */
export function bakeUnderstoryGrid(floorGrid, canopyHeights, { size = 160, texSize = CANOPY_TEX_SIZE } = {}) {
    const [x0, x1] = floorGrid.x;
    const [z0, z1] = floorGrid.z;
    const [gw, gh] = floorGrid.size;
    const fh = floorGrid.heights;
    const floorAt = (x, z) => {
        const fx = clamp01((x - x0) / (x1 - x0)) * (gw - 1);
        const fz = clamp01((z - z0) / (z1 - z0)) * (gh - 1);
        const ix = Math.min(gw - 2, Math.floor(fx));
        const iz = Math.min(gh - 2, Math.floor(fz));
        const tx = fx - ix;
        const tz = fz - iz;
        const a = fh[iz * gw + ix];
        const b = fh[iz * gw + ix + 1];
        const c = fh[(iz + 1) * gw + ix];
        const d = fh[(iz + 1) * gw + ix + 1];
        return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    };
    // Where the canopy stands (its top more than 6 m over the floor), as a summed-area table.
    const T = texSize;
    const sat = new Float32Array((T + 1) * (T + 1));
    for (let j = 0; j < T; j += 1) {
        let run = 0;
        const z = z0 + (j / (T - 1)) * (z1 - z0);
        for (let i = 0; i < T; i += 1) {
            const x = x0 + (i / (T - 1)) * (x1 - x0);
            run += canopyHeights[j * T + i] - floorAt(x, z) > 6 ? 1 : 0;
            sat[(j + 1) * (T + 1) + i + 1] = sat[j * (T + 1) + i + 1] + run;
        }
    }
    const texel = (x1 - x0) / (T - 1);
    const coverAt = (ti, tj, metres) => {
        const reach = Math.max(1, Math.round(metres / texel));
        const a0 = Math.max(0, ti - reach);
        const a1 = Math.min(T, ti + reach + 1);
        const b0 = Math.max(0, tj - reach);
        const b1 = Math.min(T, tj + reach + 1);
        const sum = sat[b1 * (T + 1) + a1] - sat[b0 * (T + 1) + a1] - sat[b1 * (T + 1) + a0] + sat[b0 * (T + 1) + a0];
        return sum / Math.max(1, (a1 - a0) * (b1 - b0));
    };
    const position = new Float32Array(size * size * 3);
    const mask = new Float32Array(size * size);
    for (let gj = 0; gj < size; gj += 1) {
        const v = gj / (size - 1);
        const z = z0 + v * (z1 - z0);
        for (let gi = 0; gi < size; gi += 1) {
            const s = gi / (size - 1);
            const x = x0 + s * (x1 - x0);
            const k = gj * size + gi;
            const ti = Math.round(s * (T - 1));
            const tj = Math.round(v * (T - 1));
            // Among crowns the layer stands about 20 m up; in a clearing it sinks to shrubs.
            const near = smooth(0.15, 0.6, coverAt(ti, tj, 14));
            const swell = Math.sin(x * 0.071 + 1.3) * Math.sin(z * 0.063 + 0.4) * 3.5
                + Math.sin(x * 0.19 - z * 0.17) * 1.5;
            position[k * 3] = x;
            position[k * 3 + 1] = floorAt(x, z) + 5 + (15 + swell) * near;
            position[k * 3 + 2] = z;
            // Cut away only past the forest's edge (no crowns within about 45 m).
            mask[k] = smooth(0.12, 0.3, coverAt(ti, tj, 45));
        }
    }
    const index = new Uint16Array((size - 1) * (size - 1) * 6);
    let n = 0;
    for (let gj = 0; gj < size - 1; gj += 1) {
        for (let gi = 0; gi < size - 1; gi += 1) {
            const a = gj * size + gi;
            const c = a + size;
            index.set([a, c, a + 1, a + 1, c, c + 1], n);
            n += 6;
        }
    }
    return { position, mask, index };
}

export function createCanopyTexture(heights, size = CANOPY_TEX_SIZE) {
    const half = new Uint16Array(heights.length);
    for (let i = 0; i < heights.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    const tex = new THREE.DataTexture(half, size, size, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'sunfall-canopy-height';
    tex.needsUpdate = true;
    return tex;
}

/**
 * Every texture the theme draws with. `assets` (the parsed authored assets) supplies the
 * canopy plan and the floor grid; without them the canopy map is the floor alone.
 */
export function bakeAllSunfallTextures(seed = SUNFALL_SEED, assets = null) {
    const lattice = repeatTexture(bakeLattice(seed), LATTICE_SIZE, LATTICE_SIZE, {
        mips: false, name: 'sunfall-lattice',
    });
    const fbm = repeatTexture(bakeFbm(seed), FBM_SIZE, FBM_SIZE, { name: 'sunfall-fbm' });
    const oculus = repeatTexture(bakeOculus(seed), OCULUS_TEX.width, OCULUS_TEX.height, { name: 'sunfall-oculus' });
    oculus.wrapT = THREE.ClampToEdgeWrapping;
    // The column's march averages the mask along each step (explicit gradients, anisotropic).
    oculus.anisotropy = 16;
    const manifest = assets?.manifest;
    const plan = assets?.plan || { count: 0, position: new Float32Array(0), crown: new Float32Array(0) };
    const floorGrid = manifest?.floorGrid || {
        x: [-440, 380], z: [-960, -20], size: [2, 2], heights: [-150, -150, -150, -150],
    };
    const heights = bakeCanopyHeight(plan, floorGrid, manifest?.crownVerticalScale);
    const canopy = createCanopyTexture(heights);
    return {
        lattice,
        fbm,
        oculus,
        canopy,
        canopyBounds: { x: floorGrid.x, z: floorGrid.z },
        canopyHeights: heights,
        dispose() {
            lattice.dispose();
            fbm.dispose();
            oculus.dispose();
            canopy.dispose();
        },
    };
}

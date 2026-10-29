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
import { SUNFALL_SEED, clamp01, smooth } from './sunfall-core.js';
import {
    CANOPY_TEX_SIZE, FBM_SIZE, LATTICE_SIZE, OCULUS_TEX, bakeCanopyHeight, bakeFbm, bakeLattice, bakeOculus,
    fbmKey, latticeKey, oculusKey,
} from './sunfall-bake-data.js';
import { bakeOnce } from '../shared/bake-cache.js';

export {
    CANOPY_TEX_SIZE, FBM_SIZE, LATTICE_SIZE, LATTICE_SLICE, OCULUS_TEX, bakeCanopyHeight, bakeFbm, bakeLattice,
    bakeOculus,
} from './sunfall-bake-data.js';

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

/** The canopy's heights, kept per authored plan (the session keeps its assets, so its plan). */
const canopyKept = new WeakMap();
function canopyHeightsFor(plan, floorGrid, crownScale) {
    const kept = canopyKept.get(plan);
    if (kept && kept.floorGrid === floorGrid && kept.crownScale === crownScale) return kept.heights;
    const heights = bakeCanopyHeight(plan, floorGrid, crownScale);
    canopyKept.set(plan, { floorGrid, crownScale, heights });
    return heights;
}

/**
 * Every texture the theme draws with. `assets` (the parsed authored assets) supplies the
 * canopy plan and the floor grid; without them the canopy map is the floor alone.
 */
export function bakeAllSunfallTextures(seed = SUNFALL_SEED, assets = null) {
    // Baked once a session (on a first visit in the bake worker: sunfall-bakes.js); the textures
    // only read them. They were baked again on every visit: ~60 ms, up to 90 cold.
    const latticeData = bakeOnce(latticeKey(seed, LATTICE_SIZE), () => bakeLattice(seed));
    const lattice = repeatTexture(latticeData, LATTICE_SIZE, LATTICE_SIZE, {
        mips: false, name: 'sunfall-lattice',
    });
    const fbm = repeatTexture(bakeOnce(fbmKey(seed, FBM_SIZE), () => bakeFbm(seed)), FBM_SIZE, FBM_SIZE, {
        name: 'sunfall-fbm',
    });
    const oculusData = bakeOnce(oculusKey(seed, OCULUS_TEX), () => bakeOculus(seed));
    const oculus = repeatTexture(oculusData, OCULUS_TEX.width, OCULUS_TEX.height, { name: 'sunfall-oculus' });
    oculus.wrapT = THREE.ClampToEdgeWrapping;
    // The column's march averages the mask along each step (explicit gradients, anisotropic).
    oculus.anisotropy = 16;
    const manifest = assets?.manifest;
    const plan = assets?.plan || { count: 0, position: new Float32Array(0), crown: new Float32Array(0) };
    const floorGrid = manifest?.floorGrid || {
        x: [-440, 380], z: [-960, -20], size: [2, 2], heights: [-150, -150, -150, -150],
    };
    const heights = canopyHeightsFor(plan, floorGrid, manifest?.crownVerticalScale);
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

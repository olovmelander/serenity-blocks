/**
 * Sunfall Theme — Deterministic CPU DataTexture Bakes
 *
 * Pre-bakes organic multi-octave FBM + Worley cellular textures at scene init:
 * 1. `rockTex` (128×128 RGBA, Repeat): organic karst limestone strata, cellular
 *    solution pockets, damp seepage streaks, and crevice ambient occlusion (zero
 *    sinusoidal grid artifacts).
 * 2. `fringeTex` (128×128 RGBA, Repeat, mipmapped): oculus rim vine & aerial-root
 *    transmission comb (`R` = fine comb teeth, `G` = curtain clumps, `B` = leaf
 *    garlands, `A` = wind phase). Sampled with `.level(0)` inside the volumetric
 *    beam march and rotated by `u.fringeAngle` on every T-Spin ("The Turning").
 * 3. `cloudTex` (128×128 RGBA, Repeat, mipmapped): subterranean cave-cloud billow
 *    field for the inversion-layer cloud deck and Combo Exhale ring.
 * 4. `foliageTex` (64×64 RGBA, Clamp): Pinnate tree-fern / banana frond silhouette,
 *    midrib, lateral pinnae/veins, and backlit translucency thickness.
 */

import * as THREE from 'three/webgpu';
import {
    SUNFALL_SEED, clamp01, mulberry32, smooth,
} from './sunfall-core.js';

function makeTileHash(seed = SUNFALL_SEED) {
    const rng = mulberry32(seed);
    const table = new Float32Array(512);
    for (let i = 0; i < 512; i += 1) {
        table[i] = rng();
    }
    return (ix, iy, period = 16) => {
        const px = ((ix % period) + period) % period;
        const py = ((iy % period) + period) % period;
        const h = Math.imul(px, 374761393) + Math.imul(py, 668265263) + (seed ^ 0x5bf03635);
        const idx = ((h ^ (h >>> 13)) >>> 0) & 0x1ff;
        return table[idx];
    };
}

function tileNoise2D(u, v, period, hashFn) {
    const x = u * period;
    const y = v * period;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

    const n00 = hashFn(ix, iy, period);
    const n10 = hashFn(ix + 1, iy, period);
    const n01 = hashFn(ix, iy + 1, period);
    const n11 = hashFn(ix + 1, iy + 1, period);

    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;
    return nx0 + (nx1 - nx0) * sy;
}

function fbmTile2D(u, v, basePeriod, hashFn) {
    let sum = 0;
    let amp = 0.52;
    let p = basePeriod;
    for (let oct = 0; oct < 4; oct += 1) {
        sum += tileNoise2D(u, v, p, hashFn) * amp;
        p *= 2;
        amp *= 0.5;
    }
    return clamp01(sum / 0.96);
}

function configureRepeatTexture(tex) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Bake the 128×128 tileable karst limestone & travertine texture (`rockTex`).
 * Domain-warped FBM produces natural horizontal sedimentary ledges, diagonal
 * fracture lines, damp vertical seepage, and deep crevice AO without any grid pattern.
 */
export function bakeRockTex(size = 128, seed = SUNFALL_SEED) {
    const h1 = makeTileHash(seed ^ 0x101);
    const h2 = makeTileHash(seed ^ 0x202);
    const h3 = makeTileHash(seed ^ 0x303);
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y += 1) {
        const v = y / size;
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const warpX = fbmTile2D(u, v, 4, h1) - 0.5;
            const warpY = fbmTile2D(u + 0.37, v + 0.61, 4, h2) - 0.5;

            const wu = u + warpX * 0.18;
            const wv = v + warpY * 0.14;

            // Warped horizontal sedimentary bedding ledges
            const ledgeNoise = fbmTile2D(wu * 0.5, wv * 2.0, 6, h1);
            const rawTerrace = ((wv * 5.0 + ledgeNoise * 0.85) % 1) + 1;
            const terrace = Math.abs((rawTerrace % 1) - 0.5) * 2.0;
            const strata = clamp01(terrace * 0.55 + ledgeNoise * 0.45);

            // Fine travertine & pocket relief
            const grain = fbmTile2D(wu, wv, 10, h2);

            // Damp vertical water-seepage streaks down karst walls
            const seep = fbmTile2D(u + warpX * 0.06, v * 0.25, 8, h3);

            // Deep crevice AO (dark in fracture seams, bright on protruding ledges)
            const ridge = 1.0 - Math.abs(fbmTile2D(wu, wv, 8, h3) * 2.0 - 1.0);
            const cavity = clamp01(smooth(0.18, 0.88, strata * 0.5 + ridge * 0.5));

            const idx = (y * size + x) * 4;
            data[idx] = Math.round(strata * 255);
            data[idx + 1] = Math.round(grain * 255);
            data[idx + 2] = Math.round(seep * 255);
            data[idx + 3] = Math.round(cavity * 255);
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    return configureRepeatTexture(tex);
}

/**
 * Bake the 128×128 oculus vine-fringe stencil (`fringeTex`).
 * `u` wraps around the oculus perimeter; `R` carries the vine-gap comb that
 * slices the sunbeam into lengthwise bright/dark fingers.
 */
export function bakeFringeTex(size = 128, seed = SUNFALL_SEED) {
    const h1 = makeTileHash(seed ^ 0x404);
    const h2 = makeTileHash(seed ^ 0x505);
    const h3 = makeTileHash(seed ^ 0x606);
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y += 1) {
        const v = y / size;
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const nClump = fbmTile2D(u, v * 0.35, 6, h1);
            const nComb = tileNoise2D(u, v * 0.15, 18, h2);
            const nFine = tileNoise2D(u, v, 32, h3);

            const waveA = 0.5 + 0.5 * Math.sin((u * 14 + nClump * 0.75) * Math.PI * 2);
            const waveB = 0.5 + 0.5 * Math.sin((u * 29 - nComb * 0.55) * Math.PI * 2);
            const comb = smooth(0.20, 0.80, waveA * 0.60 + waveB * 0.40);

            const clump = smooth(0.25, 0.82, nClump * 0.65 + waveA * 0.35);
            const leafMask = smooth(0.32, 0.78, nComb * 0.55 + nFine * 0.45);

            const idx = (y * size + x) * 4;
            data[idx] = Math.round(clamp01(0.26 + comb * 0.74) * 255);
            data[idx + 1] = Math.round(clump * 255);
            data[idx + 2] = Math.round(leafMask * 255);
            data[idx + 3] = Math.round(nFine * 255);
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    return configureRepeatTexture(tex);
}

/**
 * Bake the 128×128 subterranean cave-cloud texture (`cloudTex`).
 */
export function bakeCloudTex(size = 128, seed = SUNFALL_SEED) {
    const h1 = makeTileHash(seed ^ 0x707);
    const h2 = makeTileHash(seed ^ 0x808);
    const h3 = makeTileHash(seed ^ 0x909);
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y += 1) {
        const v = y / size;
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const b1 = fbmTile2D(u, v, 4, h1);
            const b2 = fbmTile2D(u + 0.23, v + 0.41, 8, h2);
            const b3 = tileNoise2D(u, v, 20, h3);

            const billow = clamp01(b1 * 0.62 + b2 * 0.28 + b3 * 0.10);
            const wisp = clamp01(b2 * 0.65 + b3 * 0.35);
            const rimBreakup = smooth(0.24, 0.82, b1 * 0.50 + b3 * 0.50);
            const thickness = smooth(0.22, 0.84, billow);

            const idx = (y * size + x) * 4;
            data[idx] = Math.round(billow * 255);
            data[idx + 1] = Math.round(wisp * 255);
            data[idx + 2] = Math.round(rimBreakup * 255);
            data[idx + 3] = Math.round(thickness * 255);
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    return configureRepeatTexture(tex);
}

/**
 * Bake the 64×64 tropical fern/banana frond lamina texture (`foliageTex`).
 * Features serrated pinnate fern/palm notches along the blade margin so
 * instanced fronds read as delicate tropical foliage rather than solid spears.
 */
export function bakeFoliageTex(size = 64, seed = SUNFALL_SEED) {
    const h1 = makeTileHash(seed ^ 0xa0a);
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y += 1) {
        const v = y / (size - 1); // 0 = stem base, 1 = frond tip
        for (let x = 0; x < size; x += 1) {
            const u = (x / (size - 1)) * 2 - 1; // -1..1 across frond width
            const absU = Math.abs(u);

            // Broad tropical frond envelope with pinnate fern/banana notches
            const envelope = Math.sin(clamp01(v ** 0.78) * Math.PI) * 0.92 + 0.08 * (1 - v);
            const pinnaWave = 0.5 + 0.5 * Math.cos((v * 11.5 - absU * 2.2) * Math.PI * 2);
            const notchDepth = smooth(0.28, 0.85, absU) * (1 - pinnaWave) * 0.28;
            const edgeDist = (envelope - notchDepth) - absU;
            const alpha = smooth(-0.03, 0.09, edgeDist);

            // Central rachis/midrib and lateral pinna veins
            const midrib = 1 - smooth(0.0, 0.075, absU);
            const veins = clamp01(midrib * 0.65 + pinnaWave * 0.35);

            // High backlit translucency across the thin lamina between veins
            const translucency = clamp01(
                (1 - midrib * 0.6) * smooth(0.0, 0.4, alpha) * (0.55 + 0.45 * pinnaWave),
            );
            const micro = tileNoise2D((u + 1) * 0.5, v, 10, h1);

            const idx = (y * size + x) * 4;
            data[idx] = Math.round(veins * 255);
            data[idx + 1] = Math.round(clamp01(0.38 + micro * 0.62) * 255);
            data[idx + 2] = Math.round(translucency * 255);
            data[idx + 3] = Math.round(alpha * 255);
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

export function bakeAllSunfallTextures(seed = SUNFALL_SEED) {
    const rockTex = bakeRockTex(128, seed);
    const fringeTex = bakeFringeTex(128, seed);
    const cloudTex = bakeCloudTex(128, seed);
    const foliageTex = bakeFoliageTex(64, seed);

    return {
        rockTex,
        fringeTex,
        cloudTex,
        foliageTex,
        dispose() {
            rockTex.dispose();
            fringeTex.dispose();
            cloudTex.dispose();
            foliageTex.dispose();
        },
    };
}

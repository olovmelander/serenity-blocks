/**
 * @fileoverview Ch6 baked cosmic backdrop — the Wave 2 dome swap
 * (docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5 Wave 2).
 *
 * WHY A BAKE. Wave 0 measured the incumbent FBM void dome at **13.37 ms of the
 * station's 17.04 ms Lane B frame (78%)** — and it owns the frame tail too (p95
 * 26.35 → 3.80 with the dome removed). The dome evaluates ~15 value-noise fields per
 * fragment, full-screen, every frame, for a backdrop that changes glacially
 * (time*0.01 drift). This is the Act I backdrop-dome whale in a different chapter,
 * and it gets the same cure: terrain-shaped math the CPU can express belongs in a
 * BAKE, never in the per-frame graph (the One World codegen-bomb rule).
 *
 * WHAT IS BAKED. A seeded equirect field texture (512x256 RGBA8) holding the
 * POSTERIZED painted cosmos — the Wave 0 probe's band language applied to the
 * incumbent's deep-space palette: near-black indigo floor (never RGB-zero — the
 * 8-bit floor is asserted by test), warm indigo/magenta pockets, a separate cool
 * cobalt/teal body, and rust filaments concentrated along the galactic lane. Star
 * tiers are NOT baked: the instanced quad tiers measured 0.00 ms in Wave 0 and keep
 * their own earlier reveal window (stars ignite before the dome), so baking them
 * would cost the staging and save nothing.
 *
 * Longitude wraps seamlessly BY CONSTRUCTION (the field is a function of the 3D
 * direction, not of uv), and the texture uses RepeatWrapping in S so bilinear
 * filtering also blends across the seam texel pair — the Act II bake-tiling trap
 * (texel 255 must meet texel 0, not a phantom 256) is asserted by test.
 *
 * The per-frame material cost after the swap is one texture fetch plus the energy
 * multiply — the drift that used to ride the noise lattice is now a slow seamless
 * uv scroll.
 */

import * as THREE from 'three/webgpu';
import {
    dot, float, mix, texture as textureNode, uniform, uv, vec2, vec3,
} from 'three/tsl';

export const COSMIC_BACKDROP_DEFAULTS = Object.freeze({
    // 1024×512 (~260 ms CPU, once, at chapter creation inside the warmup path): at
    // 512×256 one texel spanned ~4.7° of longitude and the dome rendered as giant
    // soft blobs — the "blurry wash" the owner flagged. The world bake's 400 ms
    // budget class is the precedent; this is a look-critical one-time cost.
    width: 1024,
    height: 512,
    seed: 61.7,
    // Base floor gradient, bottom → top. ⚠️ Floors are chosen to survive 8-bit
    // quantisation (≥ 1/255 per authored channel): "nothing in a Ghibli frame is
    // ever pure black" fails silently if the lift rounds to zero.
    floorBottom: [0.004, 0.004, 0.012],
    floorTop: [0.010, 0.007, 0.030],
    // Galactic lane axis — the incumbent's tilted dust plane, verbatim.
    bandAxis: [0.4, 0.18, 1.0],
});

// ── Seeded integer-bit-mix value noise (CPU) ─────────────────────────────────────
// sin-based hashes cost ~3x on startup paths (measured, One World Wave 1); this is
// the integer-mix form. Deterministic for a given seed — the bake is reproducible,
// which is what makes its tests meaningful.

function hash3(ix, iy, iz, seed) {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b9) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const sstep = (lo, hi, x) => {
    const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};

function valueNoise3(x, y, z, seed) {
    const ix = Math.floor(x); const iy = Math.floor(y); const iz = Math.floor(z);
    const fx = x - ix; const fy = y - iy; const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const c000 = hash3(ix, iy, iz, seed); const c100 = hash3(ix + 1, iy, iz, seed);
    const c010 = hash3(ix, iy + 1, iz, seed); const c110 = hash3(ix + 1, iy + 1, iz, seed);
    const c001 = hash3(ix, iy, iz + 1, seed); const c101 = hash3(ix + 1, iy, iz + 1, seed);
    const c011 = hash3(ix, iy + 1, iz + 1, seed); const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
}

function fbm3(x, y, z, octaves, seed) {
    let sum = 0; let amp = 0.5; let norm = 0; let f = 1;
    for (let o = 0; o < octaves; o += 1) {
        sum += amp * valueNoise3(x * f, y * f, z * f, seed + o * 101);
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / norm;
}

function ridged3(x, y, z, octaves, seed) {
    let sum = 0; let amp = 0.5; let norm = 0; let f = 1;
    for (let o = 0; o < octaves; o += 1) {
        const n = valueNoise3(x * f, y * f, z * f, seed + o * 173);
        sum += amp * (1 - Math.abs(2 * n - 1));
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / norm;
}

/**
 * Bake the painted-cosmos field into an equirect RGBA8 DataTexture.
 *
 * @returns {{ texture: THREE.DataTexture, data: Uint8Array, width: number,
 *             height: number, bakeMs: number }}
 */
export function bakeCosmicBackdropTexture(options = {}) {
    const {
        width, height, seed, floorBottom, floorTop, bandAxis,
    } = { ...COSMIC_BACKDROP_DEFAULTS, ...options };
    const t0 = performance.now();
    const iSeed = Math.floor(seed * 8191) | 0;
    const data = new Uint8Array(width * height * 4);

    const bl = Math.hypot(bandAxis[0], bandAxis[1], bandAxis[2]);
    const bx = bandAxis[0] / bl; const by = bandAxis[1] / bl; const bz = bandAxis[2] / bl;

    for (let iy = 0; iy < height; iy += 1) {
        // DataTexture row 0 is v=0; SphereGeometry has uv.y=1 at +Y, so v maps
        // bottom (−Y) → top (+Y) as the polar angle runs π → 0.
        const v = (iy + 0.5) / height;
        const dirY = -Math.cos(Math.PI * v);
        const sinTheta = Math.sin(Math.PI * v);
        const h01 = v;
        const hCurve = h01 ** 1.4;
        for (let ix = 0; ix < width; ix += 1) {
            const u = (ix + 0.5) / width;
            const phi = 2 * Math.PI * u;
            const dx = sinTheta * Math.cos(phi);
            const dz = sinTheta * Math.sin(phi);

            // Floor gradient — the void is never RGB-zero.
            let r = floorBottom[0] + (floorTop[0] - floorBottom[0]) * hCurve;
            let g = floorBottom[1] + (floorTop[1] - floorBottom[1]) * hCurve;
            let b = floorBottom[2] + (floorTop[2] - floorBottom[2]) * hCurve;

            // ── MASTERPIECE PASS (2026-10): a SOFT sky, one value band below the gas ──────
            // The Wave 2 bake posterized three saturated families (magenta pockets, cobalt
            // bodies, rust lane filaments) with 0.03-0.05-wide thresholds. Magnified 4-6x
            // on screen those read in-game as hard-edged purple blobs and a flat red smear
            // full of black holes — the loudest thing in every ch6 frame, louder than the
            // nebulae it was meant to sit behind. The sky is now what a deep-space sky is:
            // near-black, one soft galactic band with star clouds and dark dust rifts, and a
            // faint, low-chroma nebulosity — all wide ramps, nothing posterized.
            const bandDot = dx * bx + dirY * by + dz * bz;
            const lat2 = bandDot * bandDot;
            const bandWide = Math.exp(-14 * lat2);
            const bandCore = Math.exp(-70 * lat2);
            // Star clouds: lumpy brightness ALONG the band.
            const clump = sstep(0.38, 0.78, fbm3(dx * 3.4 + 5, dirY * 3.4, dz * 3.4, 3, iSeed ^ 0x2545));
            // Dark rifts: ridged crests, strongest in the band's spine (the Great Rift idea).
            const rift = sstep(0.50, 0.80, ridged3(dx * 4.6 + 13, dirY * 4.6, dz * 4.6, 2, iSeed ^ 0x27d4));
            const riftCut = 1 - 0.82 * rift * Math.min(1, bandWide * 1.3);
            const band = (bandWide * 0.10 + bandCore * (0.14 + 0.32 * clump)) * riftCut;
            // Warm cream spine, cool blue wings — chroma stays LOW (the masses own colour).
            const warmT = Math.min(1, bandCore * 1.2);
            r += band * (0.50 + 0.38 * warmT);
            g += band * (0.52 + 0.26 * warmT);
            b += band * (0.78 - 0.10 * warmT);

            // Faint nebulosity off the band: two soft families on separate seeds, gated by a
            // low-frequency macro so whole regions of the sky stay empty.
            const macro = sstep(0.48, 0.74, valueNoise3(dx * 1.1 + 7, dirY * 1.1 + 2, dz * 1.1, iSeed ^ 0x5bd1));
            const rose = sstep(0.50, 0.80, fbm3(dx * 2.2, dirY * 2.2, dz * 2.2, 3, iSeed)) * macro;
            const tealGate = valueNoise3(dx * 0.9 + 31, dirY * 0.9 + 17, dz * 0.9, iSeed ^ 0x9e37);
            const tealMacro = sstep(0.50, 0.76, tealGate);
            const tealField = fbm3(dx * 2.0 + 23, dirY * 2.0, dz * 2.0 + 11, 3, iSeed ^ 0x2545);
            const teal = sstep(0.50, 0.80, tealField) * tealMacro;
            r += 0.10 * rose + 0.020 * teal;
            g += 0.035 * rose + 0.075 * teal;
            b += 0.085 * rose + 0.110 * teal;

            const o = (iy * width + ix) * 4;
            data[o] = Math.min(255, Math.round(r * 255));
            data[o + 1] = Math.min(255, Math.round(g * 255));
            data[o + 2] = Math.min(255, Math.round(b * 255));
            data[o + 3] = 255;
        }
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    // RepeatWrapping in S so bilinear filtering blends the longitude seam's texel
    // pair (255 ↔ 0) instead of clamping — the Act II bake-tiling lesson.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    return {
        texture, data, width, height, bakeMs: performance.now() - t0,
    };
}

/**
 * The baked void dome — same contract as the retired FBM dome (BackSide sphere 2400,
 * renderOrder −100, depthWrite off, opacity driven by uVoidSkyOpacity, energy
 * breathing) with the field read from the bake and a slow seamless uv drift standing
 * in for the old lattice drift.
 */
export function createBakedVoidSkyTSL(uTime, uEnergy, uOpacity = uniform(1), bakeOptions = {}) {
    const time = uTime ?? uniform(0);
    const energy = uEnergy ?? uniform(0.3);
    const bake = bakeCosmicBackdropTexture(bakeOptions);

    const material = new THREE.MeshBasicNodeMaterial();
    const drift = uv().add(vec2(time.mul(0.0004), 0));
    // §3b rule 4 (three grayscale value bands): the dome must sit ONE BAND BELOW the
    // sculpted masses or depth collapses. RE-TUNED 2026-08-16 against a GROUND-TRUTH
    // capture (real board, real grade): 0.62 alone was measured too hot — the game's
    // post stack lifts saturation twice over a black crush, so the baked pockets came
    // back as vivid magenta competing with the masses in both value AND chroma, which
    // the flat NoToneMapping rig cannot show. Now dimmer AND desaturated toward its
    // own luma, so the backdrop reads as depth rather than as a rival subject.
    const baked = textureNode(bake.texture, drift).rgb.mul(energy.mul(0.5).add(0.7));
    const bakedLuma = dot(baked, vec3(0.2126, 0.7152, 0.0722));
    material.colorNode = mix(baked, vec3(bakedLuma), float(0.34)).mul(0.45);
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;

    const geometry = new THREE.SphereGeometry(2400, 64, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'void-sky-baked';
    mesh.renderOrder = -100;
    mesh.userData.bakeMs = bake.bakeMs;
    return {
        mesh, material, geometry, texture: bake.texture, bakeMs: bake.bakeMs,
    };
}

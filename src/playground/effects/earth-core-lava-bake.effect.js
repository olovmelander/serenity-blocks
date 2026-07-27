/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview A/B playground for BAKING earth-core's moltenRockField noise.
 *
 * Left boulder  = PROCEDURAL moltenRockField (snoise3 = mx_noise_float, ~21 noise calls).
 * Right boulder = BAKED moltenRockField (snoise3 = a tileable 3D Perlin-noise TEXTURE
 *                 lookup — 1 texture fetch each) — the compile-cost bake candidate.
 *
 * Goal: prove the baked field is visually equivalent (organic molten character; the
 * glowing crack/vein signature preserved) before porting the texture-noise swap into
 * earth-core.tsl.js. `?variant=proc|baked|split` (default split = both side by side).
 *
 * The field code is copied verbatim from earth-core.tsl.js moltenRockField (L121-190)
 * with the single change that snoise3 is a parameter, so the A/B is apples-to-apples.
 */

import * as THREE from 'three/webgpu';
import {
    abs, clamp, float, mix, oneMinus, sin, smoothstep, uniform, vec3,
    positionLocal, normalLocal, normalize, varying, transformNormalToView,
    mx_noise_float as mxNoiseFloat, texture3D, fract,
} from 'three/tsl';

export const meta = {
    id: 'earth-core-lava-bake',
    title: 'Earth-Core Lava Bake A/B',
    description: 'Procedural vs baked-3D-noise-texture moltenRockField, side by side',
};

// ── Tileable 3D Perlin (gradient) noise baked into a Data3DTexture ────────────────
// Gradient noise (like mx_noise_float) so the value DISTRIBUTION matches — the field's
// smoothstep thresholds are tuned to mx_noise's ~centred [-1,1], so a uniform value
// noise would shift molten coverage. Periodic gradients => the texture tiles seamlessly.
function buildTileableNoise3D(res = 96, grid = 20, period = 10, seed = 1337) {
    // Perlin's classic 12 edge-midpoint gradients — well-distributed / isotropic (an
    // ad-hoc random set produces directional filaments once fed through the vein ridge).
    const grads = [
        [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
        [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
        [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    ];
    // Periodic hash: lattice point -> gradient index (wrapped by `grid`).
    const hash = (x, y, z) => {
        const xi = ((x % grid) + grid) % grid;
        const yi = ((y % grid) + grid) % grid;
        const zi = ((z % grid) + grid) % grid;
        let h = (xi * 374761393 + yi * 668265263 + zi * 2147483647 + seed * 40503);
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) % 12;
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const dotg = (gi, dx, dy, dz) => grads[gi][0] * dx + grads[gi][1] * dy + grads[gi][2] * dz;
    const perlin = (x, y, z) => {
        const X = Math.floor(x); const Y = Math.floor(y); const Z = Math.floor(z);
        const fx = x - X; const fy = y - Y; const fz = z - Z;
        const u = fade(fx); const v = fade(fy); const w = fade(fz);
        const g = (ox, oy, oz) => dotg(hash(X + ox, Y + oy, Z + oz), fx - ox, fy - oy, fz - oz);
        const lerp = (a, b, t) => a + (b - a) * t;
        const x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
        const x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
        const x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
        const x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
        const y0 = lerp(x00, x10, v);
        const y1 = lerp(x01, x11, v);
        return lerp(y0, y1, w); // classic gradients (|g|=√2) land in ~[-1,1] already
    };

    // RGBA Float32 (no 8-bit quantization — Uint8's 256 levels create contour banding
    // that the vein smoothstep amplifies into thin cracks). R/G/B carry three
    // DECORRELATED noise fields (different seeds) so layers can pull independent
    // channels and avoid the "all layers self-similar" tiling tell.
    const data = new Float32Array(res * res * res * 4);
    const seeds = [seed, seed + 9173, seed + 51001];
    let off = 0;
    for (let z = 0; z < res; z += 1) {
        for (let y = 0; y < res; y += 1) {
            for (let x = 0; x < res; x += 1) {
                for (let c = 0; c < 3; c += 1) {
                    const s = seeds[c];
                    const nx = (x / res) * grid; // grid cells across the texture
                    const ny = (y / res) * grid;
                    const nz = (z / res) * grid;
                    const ox = (s % 7); const oy = (s % 13); const oz = (s % 5);
                    const n = perlin(nx + ox, ny + oy, nz + oz);
                    data[off + c] = n * 0.5 + 0.5; // store [0,1], shader restores [-1,1]
                }
                data[off + 3] = 1.0;
                off += 4;
            }
        }
    }
    const tex = new THREE.Data3DTexture(data, res, res, res);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.FloatType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    tex.userData.gridPeriodUnits = period; // p-units per full texture period (tiling)
    // features/unit = grid/period (matched to mx_noise's ~2/unit here)
    return tex;
}

// ── moltenRockField (verbatim from earth-core.tsl.js, snoise3 parameterised) ──────
function moltenRockField(pos, uTime, uPulseIntensity, heatBias, pool, snoise3, snoise3Vein = snoise3) {
    // Local fbm identical to earth-core's (3 base octaves, 4th gated — we only use 3).
    // `sn` selects the noise source: baked-texture for the forgiving low-freq bulk,
    // analytic for the sharp high-freq VEIN ridge (trilinear texture creasing would
    // otherwise show up as extra filaments once run through 1-abs()).
    const fbm = (pInput, octaves, sn) => {
        const p0 = vec3(pInput);
        const p1 = p0.mul(2.01);
        const p2 = p1.mul(2.02);
        let f = sn(p0).mul(0.5)
            .add(sn(p1).mul(0.25))
            .add(sn(p2).mul(0.125));
        if (octaves >= 4) {
            const p3 = p2.mul(2.03);
            f = f.add(sn(p3).mul(0.0625));
        }
        return f;
    };

    const uCrust = vec3(0.07, 0.03, 0.012);
    const uRiverDark = vec3(0.34, 0.055, 0.012);
    const uRiverBright = vec3(0.92, 0.28, 0.035);
    const uVein = vec3(0.95, 0.32, 0.04);

    const ftime = uTime.mul(0.12);

    const warp = vec3(
        fbm(pos.mul(0.5).add(vec3(ftime, 0.0, 0.0)), 3, snoise3),
        fbm(pos.mul(0.5).add(vec3(0.0, ftime.mul(0.7), 5.0)), 3, snoise3),
        fbm(pos.mul(0.5).add(vec3(7.0, 0.0, ftime.mul(0.5))), 3, snoise3),
    ).mul(0.9);
    const warped = pos.add(warp);

    const river1 = fbm(warped.mul(0.7).add(vec3(0.0, ftime.mul(1.3), 0.0)), 3, snoise3);
    const river2 = fbm(warped.mul(1.4).add(vec3(ftime.mul(-0.6), 0.0, ftime.mul(0.4))), 3, snoise3);
    const riverField = river1.mul(0.6).add(river2.mul(0.4)).add(0.5);

    const riverIntensity = smoothstep(
        float(0.62).sub(heatBias).sub(pool.mul(0.12)),
        float(0.82).sub(heatBias.mul(0.5)),
        riverField,
    );

    // crust is mid-high freq (×2.6) → also kept analytic (texture creasing shows here too);
    // only the low-freq warp + rivers are baked.
    const crustMap = fbm(warped.mul(2.6).add(vec3(ftime.mul(0.4), 0.0, 0.0)), 3, snoise3Vein).add(0.5);
    const crustFactor = smoothstep(0.34, 0.78, crustMap);

    let color = mix(uRiverDark, uRiverBright, riverIntensity);
    color = mix(color, uCrust, crustFactor.mul(0.55));
    color = mix(uCrust, color, riverIntensity.mul(0.7).add(0.3));

    const veinRidge = oneMinus(abs(fbm(warped.mul(3.2).add(vec3(0.0, ftime.mul(0.8), 0.0)), 3, snoise3Vein)));
    const veins = smoothstep(0.72, 0.93, veinRidge);
    const crackHeat = clamp(veins.add(riverIntensity.mul(0.5)), 0.0, 1.0);
    color = color.add(uVein.mul(veins).mul(0.46));

    const breathe = sin(uTime.mul(1.6).add(pos.x.mul(0.15)).add(pos.z.mul(0.12)))
        .mul(0.5).add(0.5);
    const heatGlow = riverIntensity.mul(breathe.mul(0.35).add(0.65));
    color = color.add(uRiverBright.mul(heatGlow).mul(0.18));
    color = color.add(uRiverBright.mul(uPulseIntensity).mul(riverIntensity).mul(0.16));

    const aoDepth = crustFactor.mul(oneMinus(riverIntensity.mul(0.6)));
    color = color.mul(mix(float(1.0), float(0.65), aoDepth));
    color = color.max(vec3(0.05, 0.02, 0.01));

    return { color, glow: heatGlow.add(veins.mul(0.6)), crackHeat };
}

// Build the rock-cluster-style lit material for one boulder, given a snoise3 impl.
function buildBoulderMaterial(uTime, uPulse, snoise3, snoise3Vein = snoise3) {
    const uColorSecondary = vec3(0.165, 0.031, 0.016); // 0x2a0804 deep near-black rock
    const uColorPrimary = vec3(0.612, 0.180, 0.024); // 0x9c2e06 crack glow
    const uHot = vec3(0.914, 0.294, 0.039); // 0xe94b0a hottest vein core

    const posL = positionLocal;
    const nrm = normalize(normalLocal);
    const vPos = varying(posL);
    const vNormal = varying(nrm);

    const pool = clamp(oneMinus(vNormal.y).mul(0.6).add(0.2), 0.0, 1.0);
    const bias = float(-0.18);
    const fp = vPos.mul(0.9);
    const { color: field, glow, crackHeat } = moltenRockField(fp, uTime, uPulse, bias, pool, snoise3, snoise3Vein);
    let color = mix(field, uColorSecondary, 0.35);
    const deepCrack = smoothstep(0.7, 0.92, crackHeat);
    color = color.add(vec3(0.03, 0.07, 0.10).mul(deepCrack).mul(0.22));
    const warmRim = uColorPrimary.mul(glow.mul(0.5).add(0.25));
    color = color.add(warmRim.mul(0.15));
    color = color.min(vec3(0.62, 0.34, 0.18));

    const mat = new THREE.MeshStandardNodeMaterial();
    mat.normalNode = transformNormalToView(nrm);
    mat.colorNode = color;
    mat.emissiveNode = uHot.mul(crackHeat.pow(3.0)).mul(0.28).add(uColorPrimary.mul(glow).mul(0.08));
    mat.roughness = 0.85;
    mat.metalness = 0.05;
    return mat;
}

export function create({ scene, params }) {
    const variant = params?.get('variant') || 'split';
    const uTime = uniform(0);
    const uPulse = uniform(0.2);

    const noiseTex = buildTileableNoise3D(96, 20, 10, 1337);
    const period = noiseTex.userData.gridPeriodUnits; // p-units per texture period
    const invP = 1 / period;

    // Baked snoise3: sample the tileable 3D noise texture. Channel R = primary field.
    // fract() wrap keeps the lookup in [0,1); *2-1 restores the [-1,1] range.
    const snoise3Baked = (p) => texture3D(noiseTex, fract(vec3(p).mul(invP))).r.mul(2.0).sub(1.0);
    const snoise3Proc = (p) => mxNoiseFloat(vec3(p));

    const geo = new THREE.IcosahedronGeometry(3, 24);
    const meshes = [];
    const disposables = [noiseTex, geo];

    const addBoulder = (x, snoise3, label, snoise3Vein = snoise3) => {
        const mat = buildBoulderMaterial(uTime, uPulse, snoise3, snoise3Vein);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = x;
        mesh.userData.label = label;
        scene.add(mesh);
        meshes.push(mesh);
        disposables.push(mat);
    };

    // Hybrid bake: low-freq bulk (warp/rivers/crust) from the baked texture; the sharp
    // VEIN ridge stays analytic (snoise3Proc) so the signature crack look is exact.
    if (variant === 'proc') {
        addBoulder(0, snoise3Proc, 'proc');
    } else if (variant === 'baked') {
        addBoulder(0, snoise3Baked, 'baked', snoise3Proc);
    } else {
        addBoulder(-3.6, snoise3Proc, 'proc');
        addBoulder(3.6, snoise3Baked, 'baked', snoise3Proc);
    }

    // Warm key light + cool fill so the lit dark-rock body reads (the emissive veins
    // self-light regardless). Low ambient keeps it near-black like the real chapter.
    const key = new THREE.DirectionalLight(0xffb890, 2.4);
    key.position.set(4, 6, 6);
    const fill = new THREE.DirectionalLight(0x3355aa, 0.5);
    fill.position.set(-5, -2, 3);
    const amb = new THREE.AmbientLight(0x201008, 0.6);
    scene.add(key, fill, amb);

    scene.background = new THREE.Color(0x05020a);

    return {
        cameraRadius: variant === 'split' ? 11 : 7,
        update(time) { uTime.value = time; },
        camera(time, camera) {
            // Static, deterministic framing (no orbit drift between A/B shots).
            camera.position.set(0, 0.5, variant === 'split' ? 11 : 7);
            camera.lookAt(0, 0, 0);
        },
        dispose() {
            meshes.forEach((m) => scene.remove(m));
            scene.remove(key); scene.remove(fill); scene.remove(amb);
            disposables.forEach((d) => d.dispose?.());
        },
    };
}

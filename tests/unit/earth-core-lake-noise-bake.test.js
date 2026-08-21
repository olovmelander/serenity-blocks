/**
 * Earth Core lake noise bake — the proof that "same statistics as the shipped primitive" is true
 * (docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md §2.5, Session 0).
 *
 * Tolerances follow the design: std ±1.5 %, p50–p99.9 ±2 %, P(v>0.6) ±10 %, P(v>0.7) ±15 % for the
 * sampled-after-map distribution (≈1,200 tail events at 10⁶ samples → ~3 % sampling error; we use
 * fewer samples here and widen nothing, because the bake's own fit uses the same twin).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { context, vec3, positionLocal } from 'three/tsl';
import {
    LAKE_BAKE_K, LAKE_BAKE_RES, QUANTILE_KNOTS,
    snoise3Calibrated, snoise3CalibratedPeriodic, lakeNoisePeriod, simplex3Raw,
    bakeRawTexels, fitQuantileMap, applyMap, sampleTrilinear, makeRng,
    toHalf, fromHalf, crc32, bakeLakeNoise,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-lake-noise-math.js';
import {
    buildLakeNoise3D, makeLakeNoiseSampler,
} from '../../src/rendering/odyssey/chapter-environments/shared/odyssey-lake-noise-bake.js';

const within = (value, target, relTol) => Math.abs(value - target) <= Math.abs(target) * relTol;

function sampleStats(fn, n, seed, span = 300) {
    const rng = makeRng(seed);
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i += 1) vals[i] = fn(rng() * span, rng() * span, rng() * span);
    vals.sort();
    let s = 0;
    let s2 = 0;
    for (const v of vals) { s += v; s2 += v * v; }
    const q = (p) => vals[Math.min(n - 1, Math.floor(p * n))];
    const frac = (t) => { let c = 0; for (const v of vals) if (v > t) c += 1; return c / n; };
    return {
        std: Math.sqrt(s2 / n - (s / n) ** 2), p50: q(0.5), p99: q(0.99), p999: q(0.999), p9999: q(0.9999), gt06: frac(0.6), gt07: frac(0.7),
    };
}

describe('the CPU port of od_snoise3', () => {
    it('reproduces the calibration table of shared/odyssey-tsl-noise.js', () => {
        // Table in odyssey-tsl-noise.js: std 0.2656; P(v>0.6) 0.0073; P(v>0.7) 0.0012; p99.99 ≈ 0.82.
        const s = sampleStats(snoise3Calibrated, 200_000, 11);
        expect(within(s.std, 0.2656, 0.01), `std ${s.std}`).toBe(true);
        expect(within(s.gt06, 0.0073, 0.15), `P>0.6 ${s.gt06}`).toBe(true);
        expect(within(s.gt07, 0.0012, 0.3), `P>0.7 ${s.gt07}`).toBe(true);
        expect(within(s.p9999, 0.82, 0.05), `p99.99 ${s.p9999}`).toBe(true);
        // And the raw (uncalibrated) simplex: std 0.3732 as measured for the calibration.
        const raw = sampleStats((x, y, z) => simplex3Raw(x, y, z, 0), 200_000, 12);
        expect(within(raw.std, 0.3732, 0.01), `raw std ${raw.std}`).toBe(true);
    });

    it('the periodic twin keeps the marginal and is exactly periodic on all three axes', () => {
        const L = lakeNoisePeriod(LAKE_BAKE_K);
        expect(L).toBeCloseTo(12 / 0.664, 6);
        const s = sampleStats((x, y, z) => snoise3CalibratedPeriodic(x, y, z, LAKE_BAKE_K), 200_000, 13, 100);
        expect(within(s.std, 0.2656, 0.015), `periodic std ${s.std}`).toBe(true);
        expect(within(s.gt06, 0.0073, 0.15), `periodic P>0.6 ${s.gt06}`).toBe(true);
        const rng = makeRng(99);
        let maxErr = 0;
        for (let i = 0; i < 20_000; i += 1) {
            const x = rng() * 200; const y = rng() * 200; const z = rng() * 200;
            const v = snoise3CalibratedPeriodic(x, y, z, LAKE_BAKE_K);
            maxErr = Math.max(
                maxErr,
                Math.abs(v - snoise3CalibratedPeriodic(x + L, y, z, LAKE_BAKE_K)),
                Math.abs(v - snoise3CalibratedPeriodic(x, y + L, z, LAKE_BAKE_K)),
                Math.abs(v - snoise3CalibratedPeriodic(x, y, z + L, LAKE_BAKE_K)),
                Math.abs(v - snoise3CalibratedPeriodic(x - 2 * L, y + 3 * L, z - L, LAKE_BAKE_K)),
            );
        }
        expect(maxErr).toBeLessThan(1e-9);
    });

    it('is NOT periodic without the lattice wrap (so the wrap is doing the work)', () => {
        const L = lakeNoisePeriod(LAKE_BAKE_K);
        let maxErr = 0;
        const rng = makeRng(5);
        for (let i = 0; i < 2_000; i += 1) {
            const x = rng() * 50; const y = rng() * 50; const z = rng() * 50;
            maxErr = Math.max(maxErr, Math.abs(snoise3Calibrated(x, y, z) - snoise3Calibrated(x + L, y, z)));
        }
        expect(maxErr).toBeGreaterThan(0.1);
    });
});

describe('half floats', () => {
    it('fromHalf decodes exactly like three (what the GPU reads); toHalf rounds to nearest-even', () => {
        // three's DataUtils.toHalfFloat TRUNCATES the mantissa; the bake rounds to nearest-even, half
        // an ULP more accurate. The twin only has to DECODE stored bits the way the GPU does, so decode
        // parity with three is asserted bit for bit; the encoder is asserted by accuracy.
        const rng = makeRng(3);
        for (let i = 0; i < 20_000; i += 1) {
            const v = (rng() * 2 - 1) * (i % 7 === 0 ? 1e-3 : 1); // include subnormal-range values
            const h = toHalf(v);
            expect(fromHalf(h)).toBe(THREE.DataUtils.fromHalfFloat(h));
            const back = fromHalf(h);
            const ulp = Math.abs(v) >= 2 ** -14 ? 2 ** (Math.floor(Math.log2(Math.abs(v))) - 10) : 2 ** -24;
            // + the float32 cast that precedes the half conversion (a double input is rounded twice)
            expect(Math.abs(back - v)).toBeLessThanOrEqual(ulp / 2 + Math.abs(v) * 2 ** -23 + 1e-12);
            const threeBack = THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(v));
            expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.abs(threeBack - v) + 1e-12); // never worse
        }
        expect(toHalf(0)).toBe(0);
        expect(fromHalf(toHalf(0.5))).toBe(0.5);
        expect(crc32(new Uint16Array([1, 2, 3]))).toBe(crc32(new Uint16Array([1, 2, 3])));
        expect(applyMap(new Float64Array([-1, 0, 1]), 0.5)).toBeCloseTo(0.5, 12);
    });
});

describe('the bake', () => {
    it('texel centres reproduce the analytic periodic field exactly under the sampler twin (before the map)', () => {
        const res = 32;
        const raw = bakeRawTexels(res, LAKE_BAKE_K);
        const L = 3 * LAKE_BAKE_K;
        // Sampling exactly at a texel centre returns that texel.
        const x = 5; const y = 17; const z = 9;
        const v = sampleTrilinear(raw, res, (x + 0.5) / res, (y + 0.5) / res, (z + 0.5) / res);
        expect(v).toBeCloseTo(raw[x + y * res + z * res * res], 12);
        // And that texel is the analytic periodic field at that point (in p-units).
        const toP = (i) => (((i + 0.5) / res) * L) / 0.664;
        expect(raw[x + y * res + z * res * res]).toBeCloseTo(snoise3CalibratedPeriodic(toP(x), toP(y), toP(z), LAKE_BAKE_K), 12);
    });

    it('the post-interpolation quantile map restores the analytic distribution after half-float + trilinear', () => {
        const res = 64; // 128³ is the shipped size; 64³ has the same mechanism and a harsher filter
        const raw = bakeRawTexels(res, LAKE_BAKE_K);
        const { knots, stats } = fitQuantileMap(raw, res, { iterations: 4, samples: 200_000 });
        expect(knots.length).toBe(QUANTILE_KNOTS);
        for (let i = 1; i < knots.length; i += 1) expect(knots[i]).toBeGreaterThanOrEqual(knots[i - 1]);
        expect(within(stats.std.sampled, stats.std.target, 0.015), `std ${JSON.stringify(stats.std)}`).toBe(true);
        for (const key of ['p50', 'p90', 'p99', 'p999']) {
            const { target, sampled } = stats[key];
            // p50 sits at ~0 where a relative tolerance is meaningless → absolute 0.01 there.
            const ok = Math.abs(target) < 0.05 ? Math.abs(sampled - target) < 0.01 : within(sampled, target, 0.02);
            expect(ok, `${key} ${JSON.stringify(stats[key])}`).toBe(true);
        }
        expect(within(stats.pGt06.sampled, stats.pGt06.target, 0.10), `P>0.6 ${JSON.stringify(stats.pGt06)}`).toBe(true);
        expect(within(stats.pGt07.sampled, stats.pGt07.target, 0.15), `P>0.7 ${JSON.stringify(stats.pGt07)}`).toBe(true);
        // The un-mapped bake really does lose the tail (this is why the map exists).
        const { stats: identityStats } = fitQuantileMap(raw, res, { iterations: 1, samples: 200_000 });
        expect(identityStats.pGt07.sampled).toBeLessThan(identityStats.pGt07.target * 0.85);
    });

    it('a 3-octave fbm of the periodic primitive has the std the lake thresholds were tuned on', () => {
        // earth-core.tsl.js fbm(): 0.5·n(p) + 0.25·n(2.01p) + 0.125·n(2.01·2.02p)
        const fbm = (x, y, z) => 0.5 * snoise3CalibratedPeriodic(x, y, z)
            + 0.25 * snoise3CalibratedPeriodic(x * 2.01, y * 2.01, z * 2.01)
            + 0.125 * snoise3CalibratedPeriodic(x * 2.01 * 2.02, y * 2.01 * 2.02, z * 2.01 * 2.02);
        const s = sampleStats(fbm, 100_000, 21, 100);
        // 0.2656 · sqrt(0.25 + 0.0625 + 0.015625) = 0.152
        expect(within(s.std, 0.152, 0.03), `fbm std ${s.std}`).toBe(true);
    });

    it('is deterministic and pinned: the shipped 128³ bake has a fixed CRC-32', () => {
        const bake = bakeLakeNoise(); // defaults: res 128, k 4
        expect(bake.res).toBe(LAKE_BAKE_RES);
        expect(bake.data).toBeInstanceOf(Uint16Array);
        expect(bake.data.length).toBe(LAKE_BAKE_RES ** 3);
        expect(bake.periodP).toBeCloseTo(lakeNoisePeriod(), 9);
        expect(within(bake.stats.pGt07.sampled, bake.stats.pGt07.target, 0.15)).toBe(true);
        // PIN. A change here means the primitive, the wrap, the map or the half-float rounding moved —
        // every capture and gate in the lake design assumes this exact texture.
        expect(bake.crc32.toString(16)).toBe('7503dec8');
    }, 30_000);
});

describe('the three side', () => {
    it('builds an R16F, linear, repeat-on-all-axes, mip-less Data3DTexture', () => {
        const res = 8;
        const tex = buildLakeNoise3D(new Uint16Array(res ** 3), res, lakeNoisePeriod());
        expect(tex.isData3DTexture).toBe(true);
        expect(tex.format).toBe(THREE.RedFormat);
        expect(tex.type).toBe(THREE.HalfFloatType);
        expect([tex.wrapS, tex.wrapT, tex.wrapR]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping, THREE.RepeatWrapping]);
        expect(tex.minFilter).toBe(THREE.LinearFilter);
        expect(tex.magFilter).toBe(THREE.LinearFilter);
        expect(tex.generateMipmaps).toBe(false);
        expect(tex.userData.periodP).toBeCloseTo(18.072, 2);
    });

    it('the sampler emits texture fetches and no simplex body through the WGSL builder', () => {
        const res = 8;
        const tex = buildLakeNoise3D(new Uint16Array(res ** 3), res, lakeNoisePeriod());
        const sn = makeLakeNoiseSampler(tex);
        // The lake's fbm shape: three octaves through the sampler, six fields ≈ 19 evaluations.
        const fbm = (p) => sn(p).mul(0.5).add(sn(p.mul(2.01)).mul(0.25)).add(sn(p.mul(2.01 * 2.02)).mul(0.125));
        let acc = fbm(positionLocal.mul(0.035));
        for (let i = 1; i < 6; i += 1) acc = acc.add(fbm(positionLocal.mul(0.06 * i).add(vec3(i))));
        acc = acc.add(sn(positionLocal.mul(0.18)));
        const material = new THREE.MeshBasicNodeMaterial();
        material.colorNode = vec3(acc);
        material.fog = false;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        const renderer = {
            contextNode: context(),
            lighting: { enabled: false },
            backend: {
                device: null,
                capabilities: { getUniformBufferLimit: () => 65536 },
                utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
                isWebGPUBackend: true,
            },
            getRenderTarget: () => null,
            getMRT: () => null,
            shadowMap: { enabled: false, type: 0 },
            capabilities: {},
            library: { fromMaterial: (m) => m },
            nodes: {},
            getOutputRenderTarget: () => null,
            currentColorSpace: 'srgb',
            outputColorSpace: 'srgb',
            toneMapping: 0,
            xr: { enabled: false },
            debug: { checkShaderErrors: false },
            getUniformBufferLimit: () => 65536,
            hasFeature: () => true,
            isOutputTarget: false,
            logarithmicDepthBuffer: false,
            reverseDepth: false,
            highPrecision: false,
        };
        const builder = new THREE.WGSLNodeBuilder(mesh, renderer);
        builder.scene = new THREE.Scene();
        builder.camera = new THREE.PerspectiveCamera();
        builder.context.material = material;
        builder.material = material;
        builder.build();
        const wgsl = builder.fragmentShader;
        expect(wgsl).not.toMatch(/od_simplex3|od_snoise3|mx_perlin/);
        const fetches = (wgsl.match(/textureSample\w*\(/g) || []).length;
        expect(fetches).toBeGreaterThanOrEqual(19);
        expect(wgsl).toMatch(/texture_3d<f32>/);
        expect((wgsl.match(/texture_3d<f32>/g) || []).length).toBe(1); // one binding for 19 fetches
    });
});

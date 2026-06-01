/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — 3D Ridge Terrain (the WOW core)
 *
 * A real displaced heightfield: a wide ground plane whose vertices ride a
 * ridged-multifractal noise field, with the peak amplitude growing toward the
 * back so distant ranges tower over the valley — the classic "looking up a
 * Himalayan amphitheatre" composition.
 *
 * Shading (all custom, no scene lights):
 *   - slope + altitude snow accumulation; rock shows on the steep, wind-scoured faces
 *   - sun Lambert + cool sky ambient
 *   - ★ alpenglow rim-light: warm grazing glow on sun-facing snow edges, driven by
 *     the AltitudeDirector's warmth/ignite (this IS the day→alpenglow look)
 *   - aerial perspective: color fades toward the SHARED sky-horizon fog color with
 *     distance, so far ranges desaturate and blue/gold out (real depth)
 *
 * Heightfield + analytic normal are computed in the VERTEX stage (via a varying)
 * so the per-pixel cost stays low even at 4K.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.1.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    smoothstep,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { ridged2, fbm2, valueNoise2 } from '../himalayan-noise.js';

// World layout: plane spans X∈[-W/2,W/2], Z translated so it runs from ~+200
// (valley, near camera) to ~-1800 (far range).
const PLANE_W = 2600;
const PLANE_D = 2200;
const Z_NEAR = 240; // world Z of the near edge
const NOISE_SCALE = 0.0017; // larger = smaller features
const NORMAL_EPS = 3.0; // finite-diff step (world units) for the analytic normal

// Heightfield: ridged-multifractal with a distance-driven amplitude ramp.
// `p` is world XZ (vec2). Returns world Y.
const heightField = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    // Distance gain: 0 at the near valley edge → 1 at the far range.
    const distGain = smoothstep(float(Z_NEAR), float(-1300.0), p.y).toVar();
    const np = p.mul(NOISE_SCALE).toVar();
    // Cheap domain warp (two value-noise lobes) — breaks grid, sweeps ridgelines.
    const warp = vec2(
        valueNoise2(np.add(vec2(11.2, 3.7))),
        valueNoise2(np.add(vec2(5.1, 9.3))),
    ).sub(0.5).mul(0.65);
    const h = ridged2(np.add(warp)).toVar();
    // Foothills near, towering peaks far.
    const amp = float(30.0).add(distGain.mul(350.0));
    return h.mul(amp);
});

/**
 * @param {object} u  shared uniforms from the orchestrator:
 *   uSunDir(vec3), uSunColor(Color), uSkyHorizon(Color), uFogColor(Color),
 *   uRimColor(Color), uWarmth(float), uIgnite(float), uCameraPos(vec3)
 * @param {object} opts { segments }
 */
export function createRidgeTerrain(u, opts = {}) {
    const segX = Math.max(32, opts.segments ?? 224);
    const segZ = Math.max(32, Math.floor((opts.segments ?? 224) * (PLANE_D / PLANE_W)));

    const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_D, segX, segZ);
    geometry.rotateX(-Math.PI / 2); // lie in XZ, Y up
    geometry.translate(0, 0, Z_NEAR - PLANE_D / 2); // near edge at Z_NEAR

    // ── Analytic normal, computed in the vertex stage and interpolated. ──
    const terrainNormal = varying(
        Fn(() => {
            const p = vec2(positionLocal.x, positionLocal.z).toVar();
            const e = float(NORMAL_EPS);
            const hC = heightField(p);
            const hX = heightField(p.add(vec2(NORMAL_EPS, 0.0)));
            const hZ = heightField(p.add(vec2(0.0, NORMAL_EPS)));
            // Height-field normal: normalize(-dH/dx, 1, -dH/dz), scaled by e.
            return normalize(vec3(hC.sub(hX), e, hC.sub(hZ)));
        })(),
        'vTerrainNormal',
    );

    // ── Vertex displacement. ──
    const material = new MeshBasicNodeMaterial({ fog: false });
    material.positionNode = Fn(() => {
        const p = vec2(positionLocal.x, positionLocal.z);
        return vec3(positionLocal.x, heightField(p), positionLocal.z);
    })();

    // ── Shared shading terms (factored so color + emissive agree). ──
    // Plain JS helper that INLINES nodes (not an Fn — it returns a JS struct of
    // nodes, which Fn cannot compile into a GPU function).
    const shade = () => {
        const N = normalize(terrainNormal).toVar();
        const worldPos = positionWorld.toVar();
        const worldY = worldPos.y;
        const slope = float(1.0).sub(N.y).toVar();
        const sunDir = normalize(u.uSunDir).toVar();
        const viewDir = normalize(u.uCameraPos.sub(worldPos)).toVar();

        // Snow accumulation: altitude × (not-too-steep) × patchy edges.
        const snowAlt = smoothstep(float(50.0), float(175.0), worldY);
        const patch = fbm2(worldPos.xz.mul(0.018));
        const snowMask = clamp(
            snowAlt
                .mul(float(1.0).sub(smoothstep(float(0.5), float(0.8), slope)))
                .mul(float(0.58).add(patch.mul(0.5))),
            float(0.0),
            float(1.0),
        ).toVar();

        // Rock (cheap detail; greys → warm schist).
        const rockDetail = fbm2(worldPos.xz.mul(0.05));
        const rockCol = mix(vec3(0.085, 0.085, 0.105), vec3(0.26, 0.205, 0.17), rockDetail);
        const snowCol = vec3(0.90, 0.94, 1.02);
        const albedo = mix(rockCol, snowCol, snowMask).toVar();

        // Lighting: sun Lambert + cool sky ambient (up-facing catches more sky).
        const diffuse = max(dot(N, sunDir), float(0.0));
        const ambient = u.uSkyHorizon.mul(float(0.20).add(N.y.mul(0.20)));
        const lit = albedo.mul(ambient.add(u.uSunColor.mul(diffuse.mul(0.95)))).toVar();

        // ★ Alpenglow rim: warm grazing glow on sun-facing snow edges.
        const facing = clamp(float(1.0).sub(max(dot(N, viewDir), float(0.0))), float(0.0), float(1.0));
        const rimFres = pow(facing, float(2.6));
        const sunFacing = max(dot(N, sunDir), float(0.0));
        const alpen = rimFres.mul(sunFacing)
            .mul(snowMask.mul(0.55).add(0.45))
            .mul(u.uWarmth.mul(0.85).add(u.uIgnite.mul(1.0)).add(0.04))
            .toVar();

        // Aerial perspective: distance haze toward the shared sky/fog color.
        const dist = length(u.uCameraPos.sub(worldPos));
        const fog = clamp(float(1.0).sub(exp(dist.mul(-0.00058))), float(0.0), float(1.0)).toVar();

        return { lit, alpen, fog };
    };

    material.colorNode = Fn(() => {
        const s = shade();
        const withRim = s.lit.add(u.uRimColor.mul(s.alpen).mul(1.5));
        return mix(withRim, u.uFogColor, s.fog.mul(0.92));
    })();

    // Only the alpenglow rim is bloom-eligible (reduced by distance haze).
    material.emissiveNode = Fn(() => {
        const s = shade();
        const reduce = float(1.0).sub(s.fog.mul(0.7));
        return u.uRimColor.mul(s.alpen).mul(1.25).mul(reduce);
    })();
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // big plane, always in view
    mesh.renderOrder = 0;

    return {
        mesh,
        heightField, // exported so the snow-plume can anchor to the cornice later
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}

/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Painterly Valley Terrain materials (GPU displaced)
 *
 * Re-skins the ground (and its cliff skirt) with the shared painterly lighting
 * lib so it harmonizes with the sunset sky. Replaces CPU heightfield vertex walk
 * with a WebGPU vertex displacement shader + analytical normal computed via varying.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §4 + §3.3.
 */
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    exp,
    float,
    length,
    mix,
    normalize,
    normalWorld,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { valueNoise2 } from '../sky-children-noise.js';
import {
    wrappedDiffuse, coloredShadowBlend, fresnelRim, glitter,
} from '../sky-children-lighting.js';

// Configuration constants matching the CPU terrainField configuration
const size = 640.0;
const minHeight = -70.0;
const maxHeight = 74.0; // cap peaks low so islands stay gentle, not a wall of green
const pathWidth = 96.0;
const pathDepth = 2.4;
const shoulderLift = 1.2;
const pathCenterOffset = -18.0;
const pathNearSoftening = 0.8;
const nearSofteningStart = 52.0;
const nearSofteningEnd = 236.0;
const valleyStrength = 4.5;

// TSL unrolled FBM helper generator
const fbm2dTsl = (octaves, lacunarity = 2.03, gain = 0.52) => Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const total = float(0.0).toVar();
    const normalizer = float(0.0).toVar();
    const amp = float(0.5).toVar();
    const freq = float(1.0).toVar();

    for (let i = 0; i < octaves; i++) {
        total.addAssign(valueNoise2(p.mul(freq)).mul(amp));
        normalizer.addAssign(amp);
        amp.mulAssign(gain);
        freq.mulAssign(lacunarity);
    }
    return total.div(normalizer);
});

const fbmWarp = fbm2dTsl(3, 2.0, 0.55);
const fbmMacro = fbm2dTsl(5, 2.01, 0.52);
const fbmRolling = fbm2dTsl(4, 2.03, 0.54);
const fbmRidge = fbm2dTsl(3, 2.08, 0.56);
const fbmBank = fbm2dTsl(3, 2.1, 0.55);

const samplePathCenterTSL = Fn(([x]) => sin(x.add(68.0).mul(0.0049)).mul(86.0)
    .add(sin(x.sub(190.0).mul(0.0038)).mul(48.0))
    .add(float(pathCenterOffset)));

const samplePathSignedDistanceTSL = Fn(([x, z]) => z.sub(samplePathCenterTSL(x)));

const samplePathMaskTSL = Fn(([x, z]) => {
    const distance = abs(samplePathSignedDistanceTSL(x, z));
    const widthScale = float(1.0)
        .add(sin(x.add(96.0).mul(0.0039)).mul(0.08))
        .add(sin(x.sub(42.0).mul(0.0062)).mul(0.05));
    const currentPathWidth = float(pathWidth).mul(widthScale);
    const inner = smoothstep(currentPathWidth.mul(1.12), currentPathWidth.mul(0.34), distance);
    const outer = smoothstep(currentPathWidth.mul(2.06), currentPathWidth.mul(0.92), distance);
    return clamp(inner.mul(0.75).add(outer.mul(0.35)), 0.0, 1.0);
});

const sampleValleyMaskTSL = Fn(([x, z]) => {
    const pathMask = samplePathMaskTSL(x, z);
    const offCenterA = abs(z.add(64.0).sub(sin(x.add(20.0).mul(0.0043)).mul(52.0)));
    const offCenterB = abs(z.sub(128.0).sub(sin(x.sub(170.0).mul(0.0032)).mul(38.0)));
    const carveA = smoothstep(138.0, 24.0, offCenterA);
    const carveB = smoothstep(162.0, 36.0, offCenterB);
    return clamp(pathMask.mul(0.72).add(carveA.mul(0.34)).add(carveB.mul(0.26)), 0.0, 1.0);
});

// The master GPU heightfield algorithm (exact 1:1 match with CPU terrainField).
// Exported so flowers/bushes/props anchor to the EXACT rendered terrain surface
// (no CPU/GPU height divergence). The field is time-independent (static terrain).
export const heightFieldTSL = Fn(([pInput]) => {
    const p = vec2(pInput).toVar();
    const { x } = p;
    const z = p.y;

    const nx = x.mul(0.0042);
    const nz = z.mul(0.0042);

    const warpX = fbmWarp(vec2(nx.mul(0.74).add(13.7), nz.mul(0.74).sub(7.9)));
    const warpZ = fbmWarp(vec2(nx.mul(0.76).sub(9.4), nz.mul(0.76).add(10.8)));
    const wx = nx.add(warpX.mul(0.54));
    const wz = nz.add(warpZ.mul(0.54));

    const macro = fbmMacro(vec2(wx.mul(0.64), wz.mul(0.64)));
    const rolling = fbmRolling(vec2(wx.mul(1.14).add(6.9), wz.mul(1.14).sub(4.6)));
    const ridgeBase = fbmRidge(vec2(wx.mul(2.08).sub(2.4), wz.mul(2.08).add(5.5)));
    const ridges = clamp(float(1.0).sub(abs(ridgeBase)), 0.0, 1.0).pow(2.0);

    const pathMask = samplePathMaskTSL(x, z);
    const valleyMask = sampleValleyMaskTSL(x, z);

    const detailAttenuation = clamp(float(1.0).sub(pathMask.mul(0.54)).sub(valleyMask.mul(0.24)), 0.35, 1.0);
    // Low, gentle base swells → most of the ground sits UNDER the cloud sea; the
    // dedicated island mounds (below) provide the green pokes.
    const hBase = macro.mul(20.0).add(rolling.mul(7.0)).add(ridges.mul(3.0).mul(detailAttenuation)).toVar();

    const meander = sin(x.add(84.0).mul(0.0034)).mul(6.4);
    const lateral = sin(z.sub(36.0).mul(0.0062)).mul(2.6);
    hBase.addAssign(meander.add(lateral));

    const foregroundSoftening = smoothstep(
        float(nearSofteningStart),
        float(nearSofteningEnd),
        z,
    ).mul(pathNearSoftening);
    const carveScale = float(1.0).sub(foregroundSoftening);
    const pathCarve = pathMask.mul(pathDepth).mul(carveScale);
    const shoulder = smoothstep(0.24, 0.74, pathMask).mul(shoulderLift);
    const valleyCarve = valleyMask.mul(valleyStrength).mul(float(0.78).add(carveScale.mul(0.22)));

    const heroHill = exp(x.sub(74.0).pow(2).add(z.add(82.0).pow(2)).div(-42000.0)).mul(8.8);
    const leftHill = exp(x.add(176.0).pow(2).add(z.add(22.0).pow(2)).div(-52000.0)).mul(7.6);
    const rightHill = exp(x.sub(202.0).pow(2).add(z.add(138.0).pow(2)).div(-54000.0)).mul(7.2);
    const centerBasin = exp(x.pow(2).add(z.add(34.0).pow(2)).div(-56000.0)).mul(1.9);

    // ── Dedicated grass-island mounds ──────────────────────────────────────────
    // Tall rounded bumps scattered across the (currently cloud-only) LEFT + CENTRE
    // midground so green islands poke up through the cloud sea as a balanced
    // archipelago (the right side is already green from the macro swell). Heights
    // (~64-74) clear the cloud-deck top (~46) where the base terrain is low.
    const islandLeft = exp(x.add(170.0).pow(2).add(z.add(160.0).pow(2)).div(-15000.0)).mul(33.0);
    const islandCenter = exp(x.add(30.0).pow(2).add(z.add(238.0).pow(2)).div(-14000.0)).mul(28.0);
    const islandNear = exp(x.sub(64.0).pow(2).add(z.add(118.0).pow(2)).div(-12500.0)).mul(26.0);
    const islandFarRight = exp(x.sub(196.0).pow(2).add(z.add(252.0).pow(2)).div(-13500.0)).mul(31.0);

    const bankNoise = fbmBank(vec2(nx.mul(1.42).add(3.2), nz.mul(1.42).sub(1.4)));
    const leftBank = exp(x.add(size * 0.35).pow(2).div(-32000.0)).mul(float(4.4).add(bankNoise.mul(1.2)));
    const rightBank = exp(x.sub(size * 0.35).pow(2).div(-32000.0)).mul(float(4.2).add(bankNoise.mul(1.1)));
    const edgeLift = smoothstep(size * 0.24, size * 0.5, abs(x)).mul(2.8);

    hBase.addAssign(heroHill.add(leftHill).add(rightHill).add(leftBank).add(rightBank)
        .add(shoulder)
        .add(edgeLift));
    hBase.addAssign(islandLeft.add(islandCenter).add(islandNear).add(islandFarRight));
    hBase.subAssign(pathCarve.add(valleyCarve).add(centerBasin));

    return clamp(hBase, float(minHeight), float(maxHeight));
});

// Island regions (world XZ + scatter radius) matching the dedicated mound centres
// in heightFieldTSL (+ the macro-driven right swell). Props anchor here so flowers,
// bushes, arches land ON the green islands that poke above the cloud sea.
export const ISLAND_REGIONS = Object.freeze([
    { x: -170, z: -160, r: 92 },
    { x: -30, z: -238, r: 84 },
    { x: 64, z: -118, r: 80 },
    { x: 196, z: -252, r: 86 },
    { x: 178, z: -150, r: 128 }, // the macro-swell right island
]);

// Meadow albedo by elevation — deeper, more saturated greens (the bright-day
// post + sun glow were washing them pale).
const COL_LOW = vec3(0.16, 0.40, 0.15); // deep shadow green
const COL_MID = vec3(0.32, 0.60, 0.20); // rich grass green
const COL_HIGH = vec3(0.52, 0.72, 0.28); // sunlit lime green
const COL_ROCK = vec3(0.24, 0.32, 0.28); // soft green-grey rock

// Plain-JS helper that INLINES nodes.
// reads displacedNormal (varying) instead of normalWorld.
function shadeGround(u, displacedNormal) {
    const N = normalize(displacedNormal).toVar();
    const worldP = positionWorld.toVar();
    const sunDir = normalize(u.uSunDir).toVar();
    const viewDir = normalize(u.uCameraPos.sub(worldP)).toVar();
    const slope = clamp(float(1.0).sub(N.y), float(0.0), float(1.0));

    // Smooth elevation albedo (no hard contour bands) + gentle patchiness.
    const tLow = smoothstep(float(-60.0), float(30.0), worldP.y);
    const tHigh = smoothstep(float(40.0), float(130.0), worldP.y);
    const patch = fbmMacro(worldP.xz.mul(0.02));
    const albedoA = mix(COL_LOW, COL_MID, tLow);
    const albedoB = mix(albedoA, COL_HIGH, tHigh);
    const albedoC = albedoB.mul(float(0.86).add(patch.mul(0.26)));
    const albedo = mix(albedoC, COL_ROCK, smoothstep(float(0.46), float(0.82), slope)).toVar();

    // Soft wrapped diffuse + colored-shadow blend (cool-violet shadow, anchor #1/#2).
    const diffuse = wrappedDiffuse(N, sunDir, 0.6).toVar();
    const litColor = albedo.mul(u.uSunColor);
    const shadowColor = albedo.mul(u.uShadowTint).mul(0.8);
    const lit = coloredShadowBlend(diffuse, litColor, shadowColor, 0.25);
    // Cool sky ambient on up-facing ground.
    const ambient = albedo.mul(u.uSkyHorizon).mul(float(0.12).mul(float(0.5).add(N.y.mul(0.5))));

    // Warm grazing rim on slopes (anchor #3).
    const rim = u.uRimColor.mul(fresnelRim(N, viewDir, 3.0, 0.5)).mul(diffuse).toVar();

    // Subtle, STABLE dew glints on sunlit ground (anchor #5).
    const glints = glitter(worldP, N, sunDir, viewDir, mix(float(0.987), float(0.96), u.uSparkle), 1.2)
        .mul(diffuse);
    const glintCol = vec3(1.0, 0.96, 0.86).mul(glints).toVar();

    const base = lit.add(ambient).add(rim).add(glintCol);

    // Aerial perspective toward the shared fog/sky-horizon color — light touch so
    // the lush green meadow stays crisp and saturated into the mid-distance.
    const dist = length(u.uCameraPos.sub(worldP));
    const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0008))), float(0.0), float(1.0)).toVar();
    const color = mix(base, u.uFogColor, fog.mul(0.4));
    const emissive = rim.add(glintCol).mul(float(1.0).sub(fog.mul(0.7)));
    return { color, emissive };
}

export function createValleyTerrainMaterial(u) {
    const material = new MeshBasicNodeMaterial({ fog: false });

    // Displace vertex positions on the GPU in the vertex stage
    material.positionNode = Fn(() => {
        const p = vec2(positionLocal.x, positionLocal.z);
        return vec3(positionLocal.x, heightFieldTSL(p), positionLocal.z);
    })();

    // Compute analytic normals via finite differences in the vertex stage
    const displacedNormal = varying(
        Fn(() => {
            const p = vec2(positionLocal.x, positionLocal.z).toVar();
            const e = float(3.0); // NORMAL_EPS
            const hC = heightFieldTSL(p);
            const hX = heightFieldTSL(p.add(vec2(e, 0.0)));
            const hZ = heightFieldTSL(p.add(vec2(0.0, e)));
            return normalize(vec3(hC.sub(hX), e, hC.sub(hZ)));
        })(),
        'vTerrainNormal',
    );

    // Shading using displaced normal varying
    material.colorNode = Fn(() => shadeGround(u, displacedNormal).color)();
    material.emissiveNode = Fn(() => shadeGround(u, displacedNormal).emissive)();
    material.userData.emitsBloom = true;
    return material;
}

export function createValleyCliffMaterial(u) {
    // The skirt/drop below the terrain: darker, simpler, fogged so it reads as a
    // shadowed cliff face that melts into the haze. It has CPU-mapped positions,
    // so it uses the normalWorld.
    const material = new MeshBasicNodeMaterial({ fog: false });
    const shade = () => {
        const N = normalize(normalWorld).toVar();
        const worldP = positionWorld.toVar();
        const sunDir = normalize(u.uSunDir);
        const diffuse = wrappedDiffuse(N, sunDir, 0.7);
        const albedo = vec3(0.20, 0.24, 0.20);
        const litColor = albedo.mul(u.uSunColor).mul(0.7);
        const shadowColor = albedo.mul(u.uShadowTint).mul(0.7);
        const base = coloredShadowBlend(diffuse, litColor, shadowColor, 0.2).toVar();
        const dist = length(u.uCameraPos.sub(worldP));
        const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0018))), float(0.0), float(1.0));
        return mix(base, u.uFogColor, fog.mul(0.92));
    };
    material.colorNode = Fn(() => shade())();
    material.emissiveNode = vec3(0.0, 0.0, 0.0);
    material.userData.emitsBloom = true;
    return material;
}

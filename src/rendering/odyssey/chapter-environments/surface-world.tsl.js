/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Surface World (Chapter 3) — TSL/WebGPU conversion (P3, final batch).
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — board off WebGLRenderer). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md. Faithful TSL ports of surface-world.js's
 * GLSL ShaderMaterials — the graded sky-sphere backstop, the Gerstner-wave paradise
 * ocean (vertex-displaced + caustics + fresnel), the CPU-baked tropical-island
 * landscape, the CPU-baked foothill bridge, the wind-swaying instanced fluffy grass,
 * the additive golden sun-rays, the soft procedural clouds, the FBM-displaced distant
 * mountains (CPU-baked silhouette + GPU snow/rock/fog shading) and the foothill valley
 * mist — rebuilt as NodeMaterials so they run on the WebGPURenderer and its automatic
 * WebGL2 fallback backend (one codebase, both backends).
 *
 * The chapter's private inline Ashima `snoise` maps to `snoise3` (built-in MaterialX
 * gradient noise) in the shared TSL noise lib — scales/frequencies preserved so the
 * GLSL→TSL look carries over. The CPU heightfields (getTerrainHeight for the landscape
 * + grass anchoring, the foothill-bridge walk, the per-mountain cone/FBM bake) are kept
 * byte-for-byte on the CPU exactly as the GLSL version did (same geometry shape, same
 * `computeVertexNormals`); only the per-pixel shading moves to the GPU as TSL nodes.
 *
 * Bloom: only the additive golden sun-rays are tagged `userData.emitsBloom = true`
 * (emissiveNode lands with the TSL post graph; kept off here so the standalone pilot
 * harness, which has no MRT bloom, does not double-brighten). The sky/ocean/terrain/
 * cloud/mist surfaces are atmosphere/terrain backstops — NONE bloom.
 *
 * This is ADDITIVE: the live surface-world.js (raw GLSL ShaderMaterial on the
 * WebGLRenderer) is untouched and keeps working; mountain-aurora.js is out of scope.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    cos,
    dot,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    normalView,
    oneMinus,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { snoise3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import {
    MOUNTAIN_SKIRT_MEADOW,
    mountainColorNode,
    mountainCpuDisplacement,
    mountainSkirtColorNode,
    resolveMountainTreatment,
} from './shared/mountain-language.js';
import { createWaterSurfaceTSL as createDeepOceanWaterSurfaceTSL } from './deep-ocean.tsl.js';

const SURFACE_WORLD_TERRAIN_DEPTH_OFFSET = 8;

// ── Batch B5 composition anchors (shared by terrain carve + hero placement) ──────
// The river/lake winds along this X (carved into getTerrainHeight); the lake and the
// waterfall feeding it sit on the same axis so the water reads as one connected system.
const SURFACE_RIVER_CENTER_X = -20;
// HERO: a great ancient tree on a knoll off the LEFT of the path (per the plan), anchored
// in Z down-corridor so it reads against the sky. Y resolves to getTerrainHeight at build.
const SURFACE_GREAT_TREE_POS = { x: 40, z: -260 };
// Second beat: a tiered cliff waterfall feeding the lake further down-corridor.
const SURFACE_WATERFALL_POS = { x: -64, z: -480 };

export const CH3_WATER_READABILITY_SETTINGS = Object.freeze({
    sourceChapter: 2,
    sourceBuilder: 'createWaterSurfaceTSL',
    ch2SurfaceDepth: 1,
    deepColor: 0x062a55,
    shallowColor: 0x0a9bb8,
    skyReflectionColor: 0x55efff,
    sunPathColor: 0x55efff,
    sunPathGain: 0.16,
    crestColor: [0.55, 0.95, 1.0],
    maxColor: [0.55, 0.95, 1.0],
    corridorWidth: 270,
    corridorDepth: 720,
    corridorCenterZ: 34,
    corridorScaleX: 0.72,
    corridorScaleZ: 0.62,
    seaWidth: 1320,
    seaDepth: 1140,
    seaCenterX: -30,
    seaCenterZ: 128,
    seaScaleX: 4.2,
    seaScaleZ: 0.82,
    seaYOffset: 3.0,
    seaRenderOrder: -7,
    riverRenderOrder: -6,
    waterShelfFadeMin: -5.5,
    waterShelfFadeMax: 1.5,
    wetShoreColor: [0.018, 0.22, 0.55],
    wetShoreBlend: 0.96,
});

export const CH3_TREE_VALUE_SETTINGS = Object.freeze({
    deciduousShadow: [0.018, 0.15, 0.055],
    deciduousSunlit: [0.18, 0.52, 0.13],
    spruceShadow: [0.014, 0.105, 0.052],
    spruceSunlit: [0.08, 0.30, 0.13],
    greatTreeShadow: [0.02, 0.18, 0.07],
    greatTreeSunlit: [0.16, 0.44, 0.12],
    treeLineShadow: [0.045, 0.22, 0.11],
    treeLineSunlit: [0.13, 0.38, 0.17],
    cc0Candidates: Object.freeze([
        Object.freeze({
            name: 'Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/qZtx0AHhcy',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine Trees',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/oYtDty0fR6',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/igSu0cPoBz',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/79gmlLnweB',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Pine',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/699sFuLCN2',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Trees',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/jUzojhHoYR',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/t9KbsfYdXz',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Twisted Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/edSPJNECM7',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Twisted Tree',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/9aWlx82xUf',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Bush with Flowers',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/m/U1ymDy8tbY',
            license: 'Public Domain (CC0)',
        }),
        Object.freeze({
            name: 'Stylized Nature MegaKit',
            author: 'Quaternius',
            sourceUrl: 'https://poly.pizza/bundle/Stylized-Nature-MegaKit-T34GZFA0fm',
            license: 'Public Domain (CC0)',
        }),
    ]),
});

export const CH3_BIRD_SILHOUETTE_SETTINGS = Object.freeze({
    flockCount: 8,
    crosserCount: 3,
    vertexCount: 45,
    cc0Candidate: Object.freeze({
        name: 'Bird',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/gYYC0gYMnw',
        license: 'Public Domain (CC0)',
    }),
    animatedCc0Candidate: Object.freeze({
        name: 'Pigeon',
        author: 'Quaternius',
        sourceUrl: 'https://poly.pizza/m/9NGlBTpDEr',
        license: 'Public Domain (CC0)',
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// CPU-side helpers (mirror surface-world.js exactly — terrain + grass anchoring)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU smoothstep — matches surface-world.js's private smoothstep().
function smoothstepCPU(min0, max0, value) {
    const x = Math.max(0, Math.min(1, (value - min0) / (max0 - min0)));
    return x * x * (3 - 2 * x);
}

// Terrain heightfield — drives BOTH the landscape bake AND every prop's anchoring
// (grass tufts, vegetation, reeds) so set-dressing lines up with the rendered ground.
// Phase B gave the rolling hills REAL volume: the original two thin sine ripples read as
// a near-flat card, so a couple of broader, higher-amplitude rolling waves were layered
// in (still gated by the same smoothstep so the shoreline/water stays put). The grass
// land gate (h >= 4.0) and the h < -2 -> -15 water clamp are preserved exactly.
//
// Batch B5 (Surface enrichment): the act-in read THIN — no silhouette/scale. Two
// composition fixes are baked HERE so the landscape mesh, every prop, the river channel
// and the lake all line up:
//   • a broad valley SWELL + a far RIDGELINE band (gated to the distance) so the chapter
//     gains a left/right hill silhouette that reads at the forward angle;
//   • a carved RIVER CHANNEL — a smooth low corridor along x ≈ RIVER_CENTER_X bending
//     gently along -Z — so the relocated lake/river reads as water winding INTO the frame
//     (the camera looks down its length). The channel sits below the water clamp so it
//     fills with water and the shoreline reeds (h in 2..7) hug its banks for free.
export function getTerrainHeight(x, z) {
    const d = Math.sqrt(x * x + z * z);

    // Layered rolling hills — broad swells + the original fine ripples for real volume.
    let noise = Math.sin(x * 0.018) * Math.cos(z * 0.021) * 11; // broad rolling swells
    noise += Math.sin(x * 0.05) * Math.sin(z * 0.05) * 5; // original mid ripple
    noise += Math.sin(x * 0.1 + z * 0.2) * 2; // original fine ripple
    noise += Math.cos(x * 0.034 - z * 0.028) * 4; // cross-roll for non-repeating hills

    // Broad valley swell + a far RIDGELINE band (gated by distance so it only rises on the
    // horizon, leaving the near valley readable). Gives the chapter a real hill silhouette.
    noise += Math.sin(x * 0.012) * Math.cos(z * 0.009) * 7; // broad valley swell
    const ridgeline = Math.sin(x * 0.009) * Math.cos(z * 0.006) * 22;
    noise += ridgeline * smoothstepCPU(120, 260, d);

    const viewDist = 180.0;
    let distFactor = Math.min(d / viewDist, 1.0);
    distFactor **= 2.0;

    const baseH = -30.0 + (distFactor * 50.0);

    let h = baseH + (noise * smoothstepCPU(50, 100, d));

    // Carve a winding river channel into the valley floor: a smooth low corridor whose
    // center bends gently along -Z. The carve depth tapers in with distance so the near
    // foreground shore reads first, then the channel opens INTO the frame toward the lake.
    const riverCenter = SURFACE_RIVER_CENTER_X + Math.sin(z * 0.012) * 26;
    const channel = 1 - smoothstepCPU(0, 46, Math.abs(x - riverCenter));
    const channelDepth = channel * (16 + smoothstepCPU(-40, -360, z) * 10);
    h -= channelDepth;

    if (h < -2.0) {
        h = -15.0;
    }

    return h;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Sky Background (graded sky-sphere backstop; -100, must NOT bloom)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Golden-hour daytime sky dome. PRIORITY FIX (Phase B): the live sky read as a blown
 * pale-white upper frame — a near-white horizon color plus a broad white sun-glow bleed
 * that ACES could not pull back. This is a real three-band golden-hour gradient:
 *   deep saturated zenith blue  →  clear mid azure  →  warm peach horizon
 * with every band's VALUE kept moderate (peak channel ≲ 0.78) so the dome never washes
 * to white under the post ACES+exposure pass, and a SOFT, CONTAINED warm sun disc (a
 * small bright core + a tight falloff halo) instead of the old wide bleed. The sun sits
 * toward the warm horizon so the warm band reads as the light source, not a haze.
 *
 * `vWorldPosition` → positionWorld (on a backside sphere, the normalized world direction
 * drives both the vertical gradient and the sun angle).
 * @param {object} uTime shared time uniform (uniform(0)) — unused by the shader but
 *   shared for parity with the live material's uniform set.
 */
// Shared season gates (creative plan Ch3 item 6): one uSeason scalar (0 at the breach →
// 1 at the Mountains seam) scripts the chapter's spring→autumn→winter arc THROUGH LIGHT —
// the sky bands, the sun, the key light, and the particle stories all ride it.
function seasonAutumnT(uSeason) {
    return smoothstep(0.38, 0.6, uSeason).mul(oneMinus(smoothstep(0.72, 0.92, uSeason)));
}
function seasonWinterT(uSeason) {
    return smoothstep(0.68, 0.92, uSeason);
}

// Chapter 3 HERO SUN direction — ONE source of truth shared by the sky-dome glow,
// the billboard disc, and the god-ray fan. Low + LEFT so the visible sun sits just
// above the mountain ridge on the sun-rake side. This UNIFIES the light source with
// the terrain key light (normalize(-0.62,0.34,-0.71)) and with the god-ray fan (which
// already biases left); previously the disc/dome sat front-RIGHT (0.40,0.16,-0.90),
// contradicting both, so the god-rays fanned from an empty patch of sky.
export const SURFACE_SUN_DIR = new THREE.Vector3(-0.48, 0.18, -0.86).normalize();

export function createSkyBackgroundTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    // VISUAL POLISH (de-wash): the live sky read as a flat grey-blue band because the
    // mid-azure swallowed the whole near-horizontal frame and every value sat low-sat.
    // Re-graded as a REAL blue golden-hour dome (richer, more saturated bands pulled up
    // into the frame) sitting over a warm horizon, with a readable golden SUN disc + halo
    // toward that horizon. Reference look: sky-children-v2 sun (core/corona/halo) + the
    // himalayan/sakura warm-horizon palettes. Values capped (peak channel ≲ 0.78) so the
    // ACES+exposure pass keeps the hue and never washes to white.
    const uZenith = uniform(new THREE.Color(0x1452b8)); // Deep saturated zenith blue
    const uMid = uniform(new THREE.Color(0x2f86d8)); // Clear, SATURATED mid azure (was washed)
    const uHorizon = uniform(new THREE.Color(0xf0b878)); // Warm golden-hour horizon
    const uHaze = uniform(new THREE.Color(0xf2d49e)); // Warm ground-haze band (waterline)
    const uSunCore = uniform(new THREE.Color(0xffe6a8)); // Soft warm sun core (not pure white)
    const uSunGlow = uniform(new THREE.Color(0xffc26a)); // Golden halo around the sun
    const uOpacity = uniform(1);
    // uTime is part of the live uniform set; reference it so the shared tick stays valid.
    const t0 = uTime.mul(0.0);

    // Normalized view direction over the dome; y in ~[-1, 1].
    const dir = normalize(positionWorld);
    const h = max(dir.y, 0.0);

    // Season-scripted bands (plan item 6): autumn warms and deepens the horizon; winter
    // cools every band toward the #B4BBDD lavender pole and dims the golden read — the
    // season must arrive as a LIGHT change, never a prop swap.
    const autumnT = seasonAutumnT(uSeason);
    const winterT = seasonWinterT(uSeason);
    const horizonCol = mix(
        mix(uHorizon, vec3(0.94, 0.63, 0.33), autumnT.mul(0.45)),
        vec3(0.706, 0.733, 0.867), // #B4BBDD lavender (himalayan dawn pole)
        winterT.mul(0.85),
    );
    const midCol = mix(uMid, vec3(0.55, 0.61, 0.78), winterT.mul(0.7));
    const zenithCol = mix(uZenith, vec3(0.2, 0.27, 0.48), winterT.mul(0.6));

    // Two-stage vertical grade: warm horizon -> SATURATED mid azure (fast, low band) then
    // mid -> deep zenith (pulled up harder so the upper frame reads as real BLUE, not a
    // pale grey wash). The lower pow exponent lifts saturated blue earlier up the dome.
    const horizonBand = smoothstep(0.0, 0.16, h); // warm hugs the horizon line
    const zenithBand = pow(h, float(0.5)); // pull saturated blue up into the dome
    let sky = mix(horizonCol, midCol, horizonBand);
    sky = mix(sky, zenithCol, zenithBand);

    // Warm ground-haze band hugging the horizon line (very low, soft): warms the waterline
    // so the act-in vista reads golden-hour, not a cold flat stripe.
    const groundHaze = oneMinus(smoothstep(0.0, 0.085, h));
    sky = mix(sky, mix(uHaze, vec3(0.78, 0.8, 0.88), winterT.mul(0.8)), groundHaze.mul(0.34));

    // Readable golden SUN toward the warm horizon (low + LEFT, on the rake side). A tight
    // bright core + a wider golden halo (sky-children sun discipline) so the sun READS as the
    // light source. Both terms are additive but capped well below white so ACES rolls them
    // off — the core peaks at ~0.9*coreColor, never a clipped white hole.
    const sunDir = vec3(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.y, SURFACE_SUN_DIR.z);
    const sunDot = dot(dir, sunDir);
    const sunCore = pow(smoothstep(0.9955, 1.0, sunDot), float(1.6)).mul(0.9);
    const sunHalo = pow(smoothstep(0.80, 1.0, sunDot), float(2.4)).mul(0.40);
    // Winter cools and dims the in-dome sun (the pale #DCE8FF disc of the snow line).
    const domeSunCore = mix(uSunCore, vec3(0.863, 0.91, 1.0), winterT.mul(0.8));
    const domeSunGlow = mix(uSunGlow, vec3(0.74, 0.82, 0.94), winterT.mul(0.8));
    sky = mix(sky, domeSunCore, sunCore.mul(oneMinus(winterT.mul(0.3))));
    sky = sky.add(domeSunGlow.mul(sunHalo).mul(oneMinus(winterT.mul(0.4)))).add(t0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = sky;
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;

    const geometry = new THREE.SphereGeometry(2500, 64, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Ocean Surface (Gerstner waves + caustics + fresnel; transparent, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

function configureChapter2WaterSurface(part, {
    name,
    x = 0,
    z = 0,
    scaleX = 1,
    scaleZ = 1,
    renderOrder = CH3_WATER_READABILITY_SETTINGS.seaRenderOrder,
}) {
    const { mesh, material } = part;
    mesh.name = name;
    mesh.position.x = x;
    mesh.position.z = z;
    mesh.scale.set(scaleX, 1, scaleZ);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.userData.readability = CH3_WATER_READABILITY_SETTINGS;
    mesh.userData.sourceChapter = CH3_WATER_READABILITY_SETTINGS.sourceChapter;
    mesh.userData.sourceBuilder = CH3_WATER_READABILITY_SETTINGS.sourceBuilder;
    material.userData.readability = CH3_WATER_READABILITY_SETTINGS;
    return mesh;
}

// Chapter 3 now uses the EXACT Chapter 2 water surface builder. The earlier Surface pass
// tried to approximate the breach water with a custom river/sea shader, but after the
// 2→3 seam faded, it read brown-green/flat. Reusing `createWaterSurfaceTSL` keeps the same
// Gerstner displacement, cyan/deep-blue palette, sharp caustic veins, additive blending
// and bloom tagging as Chapter 2; only transform/scale change so the surface-world terrain
// has enough coverage after the breach. The water renders behind the terrain so the
// additive Chapter 2 material cannot flood the green land.
export function createOceanSurfaceTSL(uTime = uniform(0), surfaceOffsetY = -15) {
    const uOpacity = uniform(1);
    const uDepth = uniform(CH3_WATER_READABILITY_SETTINGS.ch2SurfaceDepth);
    const deepWaterOptions = { uDepth, uOpacity };

    const seaPart = createDeepOceanWaterSurfaceTSL(
        uTime,
        surfaceOffsetY + CH3_WATER_READABILITY_SETTINGS.seaYOffset,
        deepWaterOptions,
    );
    const sea = configureChapter2WaterSurface(seaPart, {
        name: 'surface-chapter-02-water-foreground',
        x: CH3_WATER_READABILITY_SETTINGS.seaCenterX,
        z: CH3_WATER_READABILITY_SETTINGS.seaCenterZ,
        scaleX: CH3_WATER_READABILITY_SETTINGS.seaScaleX,
        scaleZ: CH3_WATER_READABILITY_SETTINGS.seaScaleZ,
    });

    // ZERO-VISUAL pipeline/draw share: the river is the EXACT same water as the sea —
    // createDeepOceanWaterSurfaceTSL was previously called a 2nd time here with IDENTICAL
    // args (same uTime, same { uDepth, uOpacity }); only the mesh transform differed (the
    // shader displaces in positionLocal and the +0.4 Y was applied to mesh.position.y, never
    // baked into the material). Reusing seaPart.material + seaPart.geometry collapses a
    // duplicate NodeMaterial pipeline compile and a duplicate geometry upload while rendering
    // the same pixels — the per-mesh difference is transform/renderOrder/name only, and the
    // shared uOpacity node already drives both (no per-instance material mutation in update()).
    const riverPart = {
        mesh: new THREE.Mesh(seaPart.geometry, seaPart.material),
        material: seaPart.material,
        geometry: seaPart.geometry,
    };
    const river = configureChapter2WaterSurface(riverPart, {
        name: 'surface-chapter-02-water-river',
        x: SURFACE_RIVER_CENTER_X - 8,
        z: CH3_WATER_READABILITY_SETTINGS.corridorCenterZ,
        scaleX: CH3_WATER_READABILITY_SETTINGS.corridorScaleX,
        scaleZ: CH3_WATER_READABILITY_SETTINGS.corridorScaleZ,
        renderOrder: CH3_WATER_READABILITY_SETTINGS.riverRenderOrder,
    });
    // Match the second-builder's mesh Y exactly: the original river sat 0.4u above the sea
    // (surfaceOffsetY + seaYOffset + 0.4). configureChapter2WaterSurface only sets x/z, so set
    // Y here to keep the river plane in the identical world position it had before.
    river.position.y = surfaceOffsetY + CH3_WATER_READABILITY_SETTINGS.seaYOffset + 0.4;

    const group = new THREE.Group();
    group.name = 'surface-ocean-tsl';
    group.add(sea);
    group.add(river);
    group.userData.readability = CH3_WATER_READABILITY_SETTINGS;
    group.userData.sea = sea;
    group.userData.river = river;
    group.userData.sourceChapter = CH3_WATER_READABILITY_SETTINGS.sourceChapter;
    group.userData.sourceBuilder = CH3_WATER_READABILITY_SETTINGS.sourceBuilder;
    return {
        mesh: group,
        material: seaPart.material,
        geometry: seaPart.geometry,
        sea,
        seaMaterial: seaPart.material,
        seaGeometry: seaPart.geometry,
        river,
        riverMaterial: riverPart.material,
        riverGeometry: riverPart.geometry,
        uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Landscape (CPU-baked tropical-island terrain; GPU shading only, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — identical to surface-world.js createLandscape geometry walk.
function buildLandscapeGeometry() {
    const geometry = new THREE.PlaneGeometry(400, 400, 96, 96);
    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, getTerrainHeight(x, z));
    }
    geometry.computeVertexNormals();
    return geometry;
}

// Value noise in ~[0,1] — TSL twin of the landscape fragment's inline rand/noise.
// rand(p) = fract(sin(dot(p, (127.1, 311.7))) * 43758.5453); snoise3 is the gradient
// stand-in so the snow-patch pattern carries over (remapped to ~[0,1]).
function landscapeNoise(p) {
    return snoise3(vec3(p.x, p.y, 0.0)).mul(0.5).add(0.5);
}

export function createLandscapeTSL(uTime = uniform(0), waterLevel = 60.0) {
    const uWaterLevel = uniform(waterLevel);
    const uSnowBlend = uniform(0);
    const uSnowColor = uniform(new THREE.Color(0xf2f7ff));
    const uSnowShadow = uniform(new THREE.Color(0x9fb0c2));
    const uOpacity = uniform(1);
    // The live landscape shader is time-independent; uTime stays in the signature for
    // pilot/harness uniformity and is referenced as a no-op so the look is unchanged.
    const t0 = uTime.mul(0.0);

    // vNormal → normalView, vPosition/vWorldPosition → positionWorld (model==world here
    // for shading purposes; the live shader used the model-space transformed position).
    const vNormal = normalView;
    const vPosition = positionWorld;

    // Height based gradient — relative to water level.
    const relHeight = vPosition.y.sub(uWaterLevel).add(t0);
    const sandAmount = smoothstep(1.0, 6.0, relHeight);

    const sandColor = vec3(0.36, 0.46, 0.42); // Cool muted shore, below water in value
    // VISUAL POLISH (de-wash): pull the grass into RICH saturated greens (swedish-forest /
    // sakura-twilight palette discipline) — a vivid lit spring green low, a deep forest green
    // high — so the hills read green rather than the old pale wash. A subtle blue-green
    // variation by ground noise breaks the plastic uniformity.
    const grassColorLow = vec3(0.14, 0.48, 0.12); // Rich lit spring green
    // Creative plan Ch3 item 1: shaded pole pulled toward #0D3A16 so tree silhouettes
    // separate from the ground in grayscale (the collapsed-value fix).
    const grassColorHigh = vec3(0.025, 0.14, 0.055); // Deep shaded forest green
    const grassColor = mix(grassColorLow, grassColorHigh, smoothstep(5.0, 30.0, relHeight));

    let color = mix(sandColor, grassColor, sandAmount);

    // Creative plan Ch3 item 3: a dark WET-SAND band in the 1–2 height units above the
    // water clamp, so every shoreline reads as a crisp dark line between land and water.
    const wetBand = oneMinus(smoothstep(1.0, 2.8, relHeight));
    color = mix(
        color,
        vec3(...CH3_WATER_READABILITY_SETTINGS.wetShoreColor),
        wetBand.mul(CH3_WATER_READABILITY_SETTINGS.wetShoreBlend),
    );

    // Subtle ground noise to break up the plastic look + add green tonal variation.
    const groundNoise = fract(
        sin(dot(vPosition.xz.mul(0.1), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    color = mix(color, color.mul(vec3(0.82, 1.10, 0.78)), groundNoise.mul(0.26));

    // Golden-hour raking key (Batch B5): a LOW warm sun rakes the hills, a cool sky fill
    // lifts the shadows, a warm rim gilds slope edges, and a fake long-shadow gradient
    // bands the terrain along the sun azimuth so the relief reads at the forward angle.
    // De-wash: the cool fill is pulled DOWN + warmed toward neutral so it stops graying the
    // greens, and the overall exposure is lifted so the saturated base survives the shading
    // (peak channel still capped well below white).
    const lightDir = normalize(vec3(-0.62, 0.34, -0.71)); // low, warm, raking from the left
    const diff = max(dot(vNormal, lightDir), 0.0);
    // Warm direct key + softer, warmer fill (keeps midtones saturated, never grays the green).
    const warmKey = vec3(0.98, 0.82, 0.48).mul(diff.mul(0.58));
    const coolFill = vec3(0.45, 0.56, 0.60).mul(0.42);
    color = color.mul(warmKey.add(coolFill));
    // Warm rim/backlight on grazing slope edges (pow falloff, tinted amber, capped).
    const rimFactor = pow(oneMinus(max(dot(vNormal, normalize(cameraPosition.sub(vPosition))), 0.0)), 2.0);
    color = color.add(vec3(0.92, 0.70, 0.36).mul(rimFactor).mul(0.11));
    // Fake long-shadow banding: project worldXZ onto the sun azimuth and band it so the
    // raking light reads as long cast shadows across the valley (subtle, value-only).
    const sunAz = vec2(-0.62, -0.71);
    const shadowPhase = dot(vPosition.xz, sunAz).mul(0.045);
    const longShadow = sin(shadowPhase).mul(0.5).add(0.5);
    // Strengthened banding amplitude (0.12 → 0.2, plan item 1) — the raking light must
    // carve readable value structure into the valley, not a faint shimmer.
    color = color.mul(longShadow.mul(0.28).add(0.72));

    // Distance fog (pushed back AND thinned so distant terrain keeps its color instead
    // of dissolving into white). Fog tint is a real SATURATED sky blue, not a pale wash, and
    // thinned further so the far green hills keep their hue (atmospheric, not milky).
    const dist = length(vPosition.xz);
    const fog = smoothstep(250.0, 420.0, dist);
    // Golden-hour haze (was cool sky-blue 0x2d70b3): distant terrain now dissolves into warm
    // amber scatter that belongs to the low sun + warm horizon, not a cool veil that fought it.
    color = mix(color, vec3(0.74, 0.62, 0.44), fog.mul(0.20));

    // Snow blend (winter transition).
    const snowNoise = landscapeNoise(vPosition.xz.mul(0.06));
    const snowHeight = smoothstep(6.0, 20.0, relHeight);
    const snowPatch = smoothstep(0.35, 0.75, snowNoise);

    const farSnowNoise = oneMinus(smoothstep(-260.0, -140.0, vPosition.z.add(snowNoise.mul(60.0))));

    let snowMask = max(snowPatch.mul(snowHeight), farSnowNoise);
    snowMask = snowMask.mul(uSnowBlend);

    const snowTint = mix(uSnowShadow, uSnowColor, snowNoise.mul(0.35).add(0.65));
    color = mix(color, snowTint, snowMask);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    // The CPU terrain clamps underwater basins to a flat low shelf. Let that submerged
    // shelf become transparent so the reused Chapter 2 water surface is visible BETWEEN
    // the camera and the islands, while green land remains opaque.
    const landAlpha = smoothstep(
        CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMin,
        CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMax,
        relHeight,
    );
    // As winter approaches, dissolve the far square edge of the Surface terrain into the
    // foothill skirt / mountain range with a noisy depth fade. This keeps the Ch3 meadow from
    // ending as a straight green card against the Ch4 sky.
    const edgeNoise = landscapeNoise(vPosition.xz.mul(0.035)).sub(0.5).mul(42.0);
    const farLandFade = oneMinus(smoothstep(84.0, 190.0, vPosition.z.negate().add(edgeNoise)));
    const sideNoise = landscapeNoise(vPosition.xz.mul(0.041).add(vec2(7.1, 2.4))).sub(0.5).mul(32.0);
    const sideLandFade = oneMinus(smoothstep(128.0, 198.0, abs(vPosition.x).add(sideNoise)));
    const frontNoise = landscapeNoise(vPosition.xz.mul(0.047).add(vec2(3.8, 11.2))).sub(0.5).mul(44.0);
    const frontLandFade = smoothstep(-64.0, 72.0, vPosition.z.negate().add(frontNoise));
    const edgeBlend = smoothstep(0.28, 0.84, uSnowBlend);
    const edgeFade = farLandFade.mul(sideLandFade).mul(frontLandFade);
    material.opacityNode = uOpacity.mul(landAlpha).mul(mix(float(1.0), edgeFade, edgeBlend));
    material.transparent = true;
    material.depthWrite = false;
    material.userData.waterShelfFade = {
        min: CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMin,
        max: CH3_WATER_READABILITY_SETTINGS.waterShelfFadeMax,
    };
    // FrontSide only — never show the flat "cardboard" underside of the terrain plane.
    material.side = THREE.FrontSide;

    const geometry = buildLandscapeGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = -15; // Base level
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Foothill Bridge (CPU-baked terrain bridge into Chapter 4; GPU shading, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — identical to surface-world.js createFoothillBridge walk.
// Foothill-bridge surface height at (x, worldZ). EXPORTED so the snow-conifer tree-line can
// seat itself on the exact bridge surface as it climbs across the Ch3→Ch4 seam. The bridge
// mesh sits at (0, terrainOffsetY, -500) with local z built so worldZ == the vertex group-z,
// so a prop at group (x, foothillBridgeHeight(x, gz), gz) lands on the bridge.
export function foothillBridgeHeight(x, worldZ) {
    const clamp01 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const smoothstep01 = (edge0, edge1, v) => {
        const t = clamp01((v - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    };
    const frontZ = -180;
    const backZ = -820;
    const climb = clamp01((-worldZ - 180) / Math.abs(backZ - frontZ), 0, 1);
    const easedClimb = climb * climb * (3 - (2 * climb));
    const centerShelf = 1 - clamp01(Math.abs(x) / 170, 0, 1);
    const pathCorridor = 1 - clamp01(Math.abs(x + 18) / 140, 0, 1);
    const shoulderMask = smoothstep01(70, 360, Math.abs(x));
    const noise = (
        Math.sin(x * 0.022) * Math.cos(worldZ * 0.013) * 0.55
        + Math.sin((x + worldZ) * 0.009) * 0.3
        + Math.cos((x * 0.018) - (worldZ * 0.01)) * 0.22
    );
    const base = -18 + (easedClimb * 26);
    const centerLift = centerShelf * (4.5 + (easedClimb * 6.5));
    const shoulderLift = shoulderMask * ((6 + (easedClimb * 22)) * 0.75);
    const ridgeLift = noise * (4 + (easedClimb * 6));
    const backRise = smoothstep01(0.55, 1.0, easedClimb) * 11.5;
    const corridorCarve = pathCorridor * (10 + (easedClimb * 8));
    const frontFeather = (1 - smoothstep01(0.0, 0.12, easedClimb)) * 2.5;
    return base + centerLift + shoulderLift + ridgeLift + backRise - corridorCarve - frontFeather;
}

function buildFoothillBridgeGeometry() {
    const bridgeWidth = 920;
    const bridgeDepth = 680;
    const bridgeCenterZ = -500;
    const geometry = new THREE.PlaneGeometry(bridgeWidth, bridgeDepth, 104, 112);
    geometry.rotateX(-Math.PI / 2);

    const positionAttribute = geometry.attributes.position;
    for (let i = 0; i < positionAttribute.count; i += 1) {
        const x = positionAttribute.getX(i);
        const worldZ = positionAttribute.getZ(i) + bridgeCenterZ;
        positionAttribute.setY(i, foothillBridgeHeight(x, worldZ));
    }

    geometry.computeVertexNormals();
    return { geometry, bridgeCenterZ };
}

// Value noise in ~[0,1] — TSL twin of the foothill-bridge fragment's inline hash/noise.
function bridgeNoise(p) {
    return snoise3(vec3(p.x, p.y, 0.0)).mul(0.5).add(0.5);
}

export function createFoothillBridgeTSL(uTime = uniform(0)) {
    // The foothill bridge is now a continuous low-amplitude FBM terrain SKIRT that
    // height-blends Surface meadow-green at its base UP into canonical mountain rock at
    // its top — a RAMP, not a hard faceted-grey wedge with a seam. Snow caps the very top
    // as the live winter blend climbs. One language: shared meadow + canonical rock/snow/
    // shadow/fog from mountain-language.js (rock/snow/fog ride the neutral grey-blue pole
    // so the skirt hands off cleanly to the distant range above it).
    const treatment = resolveMountainTreatment({ coolTemp: 0.2 });
    const uMeadow = uniform(new THREE.Color(MOUNTAIN_SKIRT_MEADOW));
    const uRock = uniform(new THREE.Color(treatment.rock));
    const uSnow = uniform(new THREE.Color(treatment.snow));
    const uShadow = uniform(new THREE.Color(treatment.shadow));
    const uFog = uniform(new THREE.Color(treatment.fog));
    const uSnowBlend = uniform(0);
    const uOpacity = uniform(1);
    // The skirt shading is time-independent; uTime stays in the signature for
    // pilot/harness uniformity and is referenced as a no-op so the look is unchanged.
    const t0 = uTime.mul(0.0);

    // vNormal → normalView, vWorldPosition → positionWorld, vLocalPosition → positionLocal.
    const vNormal = normalView;
    const vWorldPosition = positionWorld.add(t0);
    const vLocalPosition = positionLocal;

    const terrainNoise = bridgeNoise(vWorldPosition.xz.mul(0.018));

    // ONE skirt ramp treatment (shared/mountain-language.js): meadow base -> rock top,
    // snow cap, canonical lighting + atmospheric fog.
    const color = mountainSkirtColorNode({
        uMeadow,
        uRock,
        uSnow,
        uShadow,
        uFog,
        uSnowBlend,
        vNormal,
        vWorldPosition,
        vLocalHeight: vLocalPosition.y,
        noise: terrainNoise,
        rockStartY: 26.0,
        snowStartY: 18.0,
    });

    // Far-depth opacity fade so the skirt's back edge dissolves into the distant range
    // instead of ending on a hard line (only once winter blend lifts the snow up the ramp).
    const snowBlendRamp = smoothstep(0.36, 0.78, uSnowBlend);
    const depth = vWorldPosition.z.negate();
    const farFade = oneMinus(smoothstep(250.0, 650.0, depth.sub(terrainNoise.mul(80.0))));
    const sideNoise = bridgeNoise(vWorldPosition.xz.mul(0.012).add(vec2(4.3, 8.9))).sub(0.5).mul(70.0);
    const sideFade = oneMinus(smoothstep(285.0, 450.0, abs(vWorldPosition.x).add(sideNoise)));
    const frontNoise = bridgeNoise(vWorldPosition.xz.mul(0.016).add(vec2(9.7, 1.8))).sub(0.5).mul(90.0);
    const frontFade = smoothstep(230.0, 420.0, depth.add(frontNoise));
    const seamFade = mix(float(1.0), farFade.mul(sideFade).mul(frontFade), snowBlendRamp);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity.mul(seamFade);
    material.transparent = true;
    material.depthWrite = true;
    material.depthTest = true;
    material.side = THREE.FrontSide;

    const { geometry, bridgeCenterZ } = buildFoothillBridgeGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, bridgeCenterZ);
    mesh.renderOrder = -2;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Fluffy Grass (the chapter's only InstancedMesh material; wind sway, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// Procedural grass-blade billboard texture — identical to surface-world.js.
function createGrassTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 512, 512);
    const drawBlade = (x, height, width, lean, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - width / 2, 512);
        ctx.quadraticCurveTo(x + lean, 512 - height / 2, x + lean * 2, 512 - height);
        ctx.quadraticCurveTo(x + lean + width / 2, 512 - height / 2, x + width / 2, 512);
        ctx.fill();
    };
    for (let i = 0; i < 150; i += 1) {
        const x = Math.random() * 512;
        const h = 200 + Math.random() * 300;
        const w = 15 + Math.random() * 20;
        const l = (Math.random() - 0.5) * 100;
        const lightness = 24 + Math.random() * 24;
        const color = `hsl(108, 58%, ${lightness}%)`;
        drawBlade(x, h, w, l, color);
    }
    return new THREE.CanvasTexture(canvas);
}

export function createFluffyGrassTSL(uTime = uniform(0), count = 1000) {
    const uColorBottom = uniform(new THREE.Color(0x1b4a22));
    const uColorTop = uniform(new THREE.Color(0x6eb846));

    const grassTexture = createGrassTexture();

    const planeGeo = new THREE.PlaneGeometry(8, 8);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = planeGeo.index;
    geometry.attributes = planeGeo.attributes;

    const vUv = uv();

    // Wind sway in the vertex stage — pos.x/pos.z displaced by uv.y^2 weighted wind.
    // (Per-instance world placement comes from instanceMatrix; the GLSL used object-space
    //  pos.x/pos.z in the wind phase, which we mirror with positionLocal.)
    const posL = positionLocal;
    const wind = sin(uTime.mul(0.5).add(posL.x.mul(0.1)).add(posL.z.mul(0.1))).mul(0.2);
    const wind2 = cos(uTime.mul(0.7).add(posL.z.mul(0.2))).mul(0.1);
    const sway = vUv.y.mul(vUv.y).mul(2.0);
    const displaced = vec3(
        posL.x.add(wind.mul(sway)),
        posL.y,
        posL.z.add(wind2.mul(sway)),
    );

    // Fragment: tinted grass texture, alpha-test discard (texColor.a < 0.5 → discard).
    const texColor = grassTexture
        ? texture(grassTexture, vUv)
        : vec3(1.0, 1.0, 1.0);
    const tint = mix(uColorBottom, uColorTop, vUv.y);
    const color = grassTexture ? tint.mul(texColor.rgb) : tint;
    const alpha = grassTexture ? texColor.a : float(1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    material.colorNode = color;
    material.opacityNode = alpha;
    // Hard alpha cutout, matching `if (texColor.a < 0.5) discard;`.
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.depthWrite = false;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();

    let instanceCount = 0;
    for (let i = 0; i < count; i += 1) {
        const x = (Math.random() - 0.5) * 350;
        const z = (Math.random() - 0.5) * 350;
        const h = getTerrainHeight(x, z);

        // Only on "land" (h > 4.0) — distant hills.
        if (h >= 4.0) {
            const dummyScale = 0.5 + Math.random() * 0.5;
            dummy.position.set(x, h + 1.5, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(dummyScale, dummyScale, dummyScale);
            dummy.updateMatrix();
            mesh.setMatrixAt(instanceCount, dummy.matrix);
            instanceCount += 1;
        }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = instanceCount;
    mesh.position.y = -15; // Match landscape group offset.

    return {
        mesh, material, geometry, texture: grassTexture,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5b. Living Landscapes vegetation (instanced low-poly props — "Living Landscapes")
// ═══════════════════════════════════════════════════════════════════════════════
//
// Phase B set-dressing: the chapter read as bare rolling hills. This adds INSTANCED,
// CAPPED, low-poly vegetation anchored to the same getTerrainHeight() as the terrain so
// it sits ON the ground (no floating): grass tufts (closed cones — real volume, no flat
// cardboard underside), a few trees (merged trunk+canopy), and water-edge reeds. A
// shared wind-sway node bends each prop by its world-space phase. All MeshBasicNodeMaterial
// (FrontSide solid, no bloom). Anchoring matches the live grass: land props gate on
// h >= 4.0; reeds hug the shoreline band.

// Merge an array of {geo, offset:[x,y,z]} into one BufferGeometry (no external dep).
function mergeOffsetGeometries(parts) {
    const merged = new THREE.BufferGeometry();
    let vertexCount = 0;
    let indexCount = 0;
    parts.forEach(({ geo }) => {
        vertexCount += geo.attributes.position.count;
        indexCount += geo.index ? geo.index.count : geo.attributes.position.count;
    });

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);

    let vOff = 0;
    let iOff = 0;
    parts.forEach(({ geo, offset }) => {
        const [ox, oy, oz] = offset || [0, 0, 0];
        const pos = geo.attributes.position;
        const nrm = geo.attributes.normal;
        for (let i = 0; i < pos.count; i += 1) {
            positions[(vOff + i) * 3] = pos.getX(i) + ox;
            positions[(vOff + i) * 3 + 1] = pos.getY(i) + oy;
            positions[(vOff + i) * 3 + 2] = pos.getZ(i) + oz;
            normals[(vOff + i) * 3] = nrm ? nrm.getX(i) : 0;
            normals[(vOff + i) * 3 + 1] = nrm ? nrm.getY(i) : 1;
            normals[(vOff + i) * 3 + 2] = nrm ? nrm.getZ(i) : 0;
        }
        if (geo.index) {
            for (let i = 0; i < geo.index.count; i += 1) {
                indices[iOff + i] = geo.index.getX(i) + vOff;
            }
            iOff += geo.index.count;
        } else {
            for (let i = 0; i < pos.count; i += 1) {
                indices[iOff + i] = vOff + i;
            }
            iOff += pos.count;
        }
        vOff += pos.count;
        geo.dispose();
    });

    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    return merged;
}

// Shared wind-sway position node: bends the prop's UPPER half along x/z by a per-world
// phase, so taller props sway more at the tip and stay rooted at the base.
function vegetationSwayNode(uTime, strength = 1.0) {
    const posL = positionLocal;
    // Sway weight rises with local height (base ~0, tip ~1); square for a rooted bend.
    const heightW = smoothstep(0.0, 6.0, posL.y);
    const w = heightW.mul(heightW).mul(strength);
    const phase = uTime.mul(0.9).add(positionWorld.x.mul(0.06)).add(positionWorld.z.mul(0.05));
    const swayX = sin(phase).mul(0.55).mul(w);
    const swayZ = cos(phase.mul(0.8).add(1.3)).mul(0.35).mul(w);
    return vec3(posL.x.add(swayX), posL.y, posL.z.add(swayZ));
}

// Per-instance green-tint attribute: a small multiplicative RGB jitter so a field of
// instanced props reads as VARIED foliage (some bluer, some more yellow-green, some darker)
// instead of one flat plastic green — the "varied, better-coloured" the brief asks for.
// Cheap (3 floats/instance, no per-frame work). Returns the Float32Array to attach as aTint.
function buildTintArray(maxCount, spread = 0.18) {
    const tints = new Float32Array(maxCount * 3);
    for (let i = 0; i < maxCount; i += 1) {
        // Bias the jitter toward green: R/B vary more than G so hue shifts, value stays put.
        const warm = (Math.random() - 0.5) * spread; // +warm/-cool on R
        const cool = (Math.random() - 0.5) * spread; // +cool/-warm on B
        const val = 1.0 + (Math.random() - 0.5) * spread * 0.7; // gentle value jitter
        tints[i * 3] = val + warm;
        tints[i * 3 + 1] = val;
        tints[i * 3 + 2] = val + cool;
    }
    return tints;
}

// Low-poly grass tuft: a tight fan of 3 closed cones — volume, no flat underside.
export function createGrassTuftsTSL(uTime = uniform(0), count = 760) {
    const blade = () => new THREE.ConeGeometry(0.55, 3.2, 5, 1, false);
    const geometry = mergeOffsetGeometries([
        { geo: blade(), offset: [0, 1.6, 0] },
        { geo: blade(), offset: [0.7, 1.4, 0.2] },
        { geo: blade(), offset: [-0.6, 1.4, -0.3] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.22), 3));

    // VISUAL POLISH (de-wash): richer saturated tuft greens + per-instance tint variation.
    const colorNode = mix(
        vec3(0.055, 0.27, 0.065), // shaded base green
        vec3(0.28, 0.62, 0.14), // saturated sunlit blade green
        smoothstep(0.0, 3.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 1.0);
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < count; i += 1) {
        const x = (Math.random() - 0.5) * 340;
        const z = (Math.random() - 0.5) * 340;
        const h = getTerrainHeight(x, z);
        if (h >= 4.0) {
            const s = 0.6 + Math.random() * 0.8;
            dummy.position.set(x, h - 0.2, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15; // Match landscape offset.
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Wildflower meadow (sky-children-v2 meadow-flowers grammar, ported to the Odyssey chapter):
// thousands of small CROSS-CARD flowers anchored to the terrain, colored in coherent
// painterly drifts (yellow/pink/white/purple/blue), with a stem→petal gradient, a petal-shape
// alpha, and a gentle wind sway. This REPLACES the old grass tufts.
const FLOWER_FAMILIES = [
    [1.0, 0.80, 0.16], // yellow
    [0.98, 0.40, 0.62], // pink
    [0.98, 0.96, 0.90], // white
    [0.64, 0.38, 0.92], // purple
    [0.36, 0.58, 0.96], // blue
];
const FLOWER_STEM = [0.34, 0.52, 0.27];

export function createMeadowFlowersTSL(uTime = uniform(0), count = 3600) {
    const positions = [];
    const colors = [];
    const phases = [];
    const uvy = [];
    const uvx = [];
    const indices = [];

    // One card (4 verts, 2 tris); `rot` swaps X/Z so each flower is a cross of two cards
    // (visible from any angle). Base xz/y is baked from getTerrainHeight (CPU-anchored).
    const pushQuad = (bx, by, bz, w, h, col, phase, rot) => {
        const base = positions.length / 3;
        const corners = [
            [-w, 0, 0, -1, 0], [w, 0, 0, 1, 0], [w, h, 0, 1, 1], [-w, h, 0, -1, 1],
        ];
        for (let c = 0; c < 4; c += 1) {
            const [cx, cy, cz, ux, uy] = corners[c];
            let lx = cx; let lz = cz;
            if (rot) { const t = lx; lx = lz; lz = t; }
            positions.push(bx + lx, by + cy, bz + lz);
            colors.push(col[0], col[1], col[2]);
            phases.push(phase);
            uvx.push(ux);
            uvy.push(uy);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    // Coherent color drifts: ~45-unit patches share a family (painterly bands, not noise).
    const familyAt = (x, z) => {
        const s = Math.sin(Math.floor(x / 45) * 127.1 + Math.floor(z / 45) * 311.7) * 43758.5453;
        const f = s - Math.floor(s);
        return FLOWER_FAMILIES[Math.floor(f * FLOWER_FAMILIES.length) % FLOWER_FAMILIES.length];
    };

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 8) {
        guard += 1;
        const x = (Math.random() - 0.5) * 460;
        const z = (Math.random() - 0.5) * 460 - 60;
        const groundH = getTerrainHeight(x, z);
        if (groundH < 4.0) continue; // grass only — above the waterline
        const src = familyAt(x, z);
        const shade = 0.84 + Math.random() * 0.3;
        const col = [
            Math.min(1, src[0] * shade), Math.min(1, src[1] * shade), Math.min(1, src[2] * shade),
        ];
        const h = 2.4 + Math.random() * 1.9;
        const w = h * (0.18 + Math.random() * 0.09);
        const phase = Math.random() * 6.2831;
        pushQuad(x, groundH - 0.2, z, w, h, col, phase, 0);
        pushQuad(x, groundH - 0.2, z, w, h, col, phase, 1);
        placed += 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.setAttribute('aUvy', new THREE.Float32BufferAttribute(uvy, 1));
    geometry.setAttribute('aUvx', new THREE.Float32BufferAttribute(uvx, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals(); // silence "normal not found" on MeshBasicNodeMaterial
    geometry.frustumCulled = false;

    const aColor = attribute('aColor', 'vec3');
    const aPhase = attribute('aPhase', 'float');
    const aUvy = attribute('aUvy', 'float');
    const aUvx = attribute('aUvx', 'float');

    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.alphaTest = 0.42;
    material.toneMapped = false; // keep the family colors vivid (matches the chapter's props)

    // Gentle wind sway — the top (aUvy→1) sways, the base stays planted.
    const sway = sin(uTime.mul(1.4).add(aPhase)).mul(aUvy).mul(0.5);
    material.positionNode = positionLocal.add(vec3(sway.mul(0.9), 0.0, sway.mul(0.4)));

    // Stem→petal gradient (green base into the saturated family color), tiny warm top bias.
    const stem = vec3(FLOWER_STEM[0], FLOWER_STEM[1], FLOWER_STEM[2]);
    const head = aColor.mul(vec3(1.06, 1.02, 0.98));
    material.colorNode = mix(stem, head, smoothstep(0.30, 0.66, aUvy));

    // Petal shape: taper the card to a soft teardrop point (driven through alphaTest).
    material.opacityNode = oneMinus(smoothstep(0.45, 1.0, aUvx.abs().mul(aUvy)));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.position.y = -15; // overwritten by the env's terrainOffsetY like the other vegetation
    return { mesh, material, geometry };
}

// A few low-poly trees: merged trunk (cylinder) + two stacked canopy cones. Denser + more
// varied than before, with richer greens, per-instance tint and a warm golden-hour rim.
// Shared clustered-placement helper (creative plan item 5): trees grow in STANDS, never
// uniform stamping. Picks a handful of land cluster hearts, then scatters instances
// around them — rejection-sampled against the same land gate as before.
function pickTreeClusters(clusterCount, landGate) {
    const clusters = [];
    let guard = 0;
    while (clusters.length < clusterCount && guard < clusterCount * 60) {
        guard += 1;
        const x = (Math.random() - 0.5) * 300;
        const z = (Math.random() - 0.5) * 300;
        if (landGate(x, z)) clusters.push({ x, z });
    }
    return clusters;
}

export function createTreesTSL(uTime = uniform(0), count = 40, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const trunk = new THREE.CylinderGeometry(0.55, 0.9, 7, 6, 1);
    const canopyLow = new THREE.ConeGeometry(4.2, 6.5, 7, 1);
    const canopyHigh = new THREE.ConeGeometry(2.9, 5.5, 7, 1);
    const canopySideA = new THREE.ConeGeometry(2.8, 4.8, 7, 1);
    const canopySideB = new THREE.ConeGeometry(2.5, 4.4, 7, 1);
    const branchA = new THREE.CylinderGeometry(0.18, 0.32, 5.4, 5, 1);
    branchA.rotateZ(Math.PI / 2.9);
    branchA.rotateY(0.45);
    const branchB = new THREE.CylinderGeometry(0.14, 0.28, 4.6, 5, 1);
    branchB.rotateZ(-Math.PI / 3.2);
    branchB.rotateY(-0.7);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 3.5, 0] },
        { geo: branchA, offset: [1.6, 7.1, 0.2] },
        { geo: branchB, offset: [-1.3, 8.8, -0.4] },
        { geo: canopyLow, offset: [0, 9.5, 0] },
        { geo: canopySideA, offset: [2.6, 10.2, 1.0] },
        { geo: canopySideB, offset: [-2.1, 11.2, -1.2] },
        { geo: canopyHigh, offset: [0, 13.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.26), 3));
    geometry.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;

    // Crown gradient (plan item 5, sakura discipline): a darker shadow underbelly so each
    // tree has a glowing top and a dark belly that separates from the ground in grayscale.
    const isTrunk = oneMinus(smoothstep(6.0, 7.2, positionLocal.y));
    const tint = attribute('aTint', 'vec3');
    const crownGrade = smoothstep(7.0, 16.0, positionLocal.y);
    let foliage = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.deciduousShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.deciduousSunlit),
        crownGrade,
    );
    // Autumn recolor (plan item 6): deciduous foliage ages rust→gold with the season.
    const autumnFoliage = mix(vec3(0.55, 0.27, 0.1), vec3(0.91, 0.69, 0.29), crownGrade);
    foliage = mix(foliage, autumnFoliage, seasonAutumnT(uSeason)).mul(tint);
    const bark = vec3(0.34, 0.22, 0.12);
    // Snow toward the seam: the crown whitens as uSnowBlend rises, so the deciduous trees join
    // the winter tree-line gradient instead of staying summer-green up to the snow line.
    const uSnowBlend = options.uSnowBlend ?? uniform(0);
    const snowCap = crownGrade.mul(uSnowBlend).mul(oneMinus(isTrunk));
    const colorNode = mix(mix(foliage, bark, isTrunk), vec3(0.93, 0.96, 1.0), snowCap.mul(0.6));
    // Warm golden-hour rim on the grazing canopy edge — applied as EMISSIVE below so it
    // reads as a light-independent glow on the lit canopy (foliage only, capped, never white).
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);

    // LIT material (was unlit MeshBasic): the merged cone/trunk geometry is real 3D, but
    // an unlit material left it reading as flat cardboard. Lambert lets the directional sun
    // reveal the conical form (volumetric, sakura-discipline). The crown gradient + tint
    // become the ALBEDO; lighting does the form; the warm rim stays as an emissive accent.
    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.4); // gentle whole-tree sway
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.82, 0.60, 0.30).mul(rim).mul(0.06).mul(oneMinus(isTrunk));
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    const landGate = (x, z) => getTerrainHeight(x, z) >= 6.0 && Math.abs(x) > 14;
    const clusters = pickTreeClusters(8, landGate);
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 16) {
        guard += 1;
        // Clustered placement: jitter around a stand heart, fall back to open scatter.
        const heart = clusters.length ? clusters[guard % clusters.length] : null;
        const x = heart ? heart.x + (Math.random() - 0.5) * 64 : (Math.random() - 0.5) * 300;
        const z = heart ? heart.z + (Math.random() - 0.5) * 64 : (Math.random() - 0.5) * 300;
        const h = getTerrainHeight(x, z);
        // Trees only on solid higher ground, away from the immediate path center.
        if (h >= 6.0 && Math.abs(x) > 14) {
            // ≥2.5× scale spread (plan item 5): saplings through old growth.
            const s = 0.55 + Math.random() * 1.45;
            dummy.position.set(x, h - 0.5, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s * (0.85 + Math.random() * 0.5), s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    mesh.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend },
    };
}

// Spruce stands (creative plan item 5): the second species — five overlapping canopy
// cones on a short trunk (the swedish-forest merged-spruce grammar), darker and spikier
// than the deciduous rounds so mixed stands read as forest, not uniform stamping.
// Evergreen: no autumn recolor (the conifers hold their green into the snow).
export function createSpruceTreesTSL(uTime = uniform(0), count = 22, options = {}) {
    const trunk = new THREE.CylinderGeometry(0.4, 0.7, 4.5, 6, 1);
    const tier = (r, hgt) => new THREE.ConeGeometry(r, hgt, 7, 1);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 2.2, 0] },
        { geo: tier(4.6, 5.5), offset: [0, 6.5, 0] },
        { geo: tier(3.9, 5.2), offset: [0, 9.3, 0] },
        { geo: tier(3.1, 4.8), offset: [0, 12.0, 0] },
        { geo: tier(2.2, 4.2), offset: [0, 14.6, 0] },
        { geo: tier(1.3, 3.6), offset: [0, 17.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.2), 3));

    const isTrunk = oneMinus(smoothstep(3.8, 4.8, positionLocal.y));
    const spruceGreen = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.spruceShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.spruceSunlit),
        smoothstep(5.0, 18.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));
    const bark = vec3(0.28, 0.18, 0.11);
    // Snow toward the seam: spruces are the conifer bridge to the snow-tree-line, so they take
    // the heaviest snow cap (whole crown whitens as uSnowBlend rises).
    const uSnowBlend = options.uSnowBlend ?? uniform(0);
    const snowCap = smoothstep(4.5, 18.0, positionLocal.y).mul(uSnowBlend).mul(oneMinus(isTrunk));
    const colorNode = mix(mix(spruceGreen, bark, isTrunk), vec3(0.93, 0.96, 1.0), snowCap.mul(0.7));
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);

    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.25);
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.78, 0.58, 0.28).mul(rim).mul(0.05).mul(oneMinus(isTrunk));
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    const landGate = (x, z) => getTerrainHeight(x, z) >= 7.0 && Math.abs(x) > 18;
    const clusters = pickTreeClusters(5, landGate);
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 16) {
        guard += 1;
        const heart = clusters.length ? clusters[guard % clusters.length] : null;
        const x = heart ? heart.x + (Math.random() - 0.5) * 52 : (Math.random() - 0.5) * 300;
        const z = heart ? heart.z + (Math.random() - 0.5) * 52 : (Math.random() - 0.5) * 300;
        const h = getTerrainHeight(x, z);
        if (h >= 7.0 && Math.abs(x) > 18) {
            const s = 0.6 + Math.random() * 1.3;
            dummy.position.set(x, h - 0.4, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s * (0.9 + Math.random() * 0.45), s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend },
    };
}

// Water-edge reeds: tall thin tapered cones clustered along the shoreline band.
export function createReedsTSL(uTime = uniform(0), count = 220) {
    // 7-sided (was 4): a 4-sided cone seen edge-on collapses to a thin triangular shard —
    // the green "slivers" in capture. 7 sides + DoubleSide give a readable reed from any angle.
    const geometry = new THREE.ConeGeometry(0.28, 8.5, 6, 1, false);

    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.2), 3));
    const colorNode = mix(
        vec3(0.34, 0.48, 0.14), // richer olive base
        vec3(0.74, 0.82, 0.34), // warm dry tip
        smoothstep(0.0, 8.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 1.6); // reeds sway the most
    material.colorNode = colorNode;
    material.side = THREE.DoubleSide; // readable from both sides (no thin-shard edge-on)

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 16) {
        guard += 1;
        const x = (Math.random() - 0.5) * 260;
        const z = (Math.random() - 0.5) * 260;
        const h = getTerrainHeight(x, z);
        // Shoreline band: just above the water clamp, where land meets water. Keep reeds OFF
        // the PLAYER CORRIDOR (carved at x≈-18, matching the foothill bridge) so they line the
        // side shores instead of clustering on the emergence beam (a thicket of slivers there).
        if (h >= 2.0 && h <= 7.0 && Math.abs(x + 18) > 34) {
            const s = 0.7 + Math.random() * 0.7;
            dummy.position.set(x, h + 3.2 * s, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s * (0.8 + Math.random() * 0.7), s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5c. HERO landmarks (Batch B5): Great Tree, mid-distance tree LINE, cliff waterfall
// ═══════════════════════════════════════════════════════════════════════════════
//
// The chapter had no single hero the eye returns to. These add the two beats the plan
// asks for — a great ancient tree on a knoll off the left of the path (the ever-present
// landmark) and a tiered cliff waterfall feeding the lake further down-corridor — plus a
// mid-distance tree LINE so the silhouette layers in depth. All anchored to the same
// getTerrainHeight() bake so they sit on the rendered ground.

// Resolve the world Y of the Great Tree's knoll (so surface-world.js can sample it too).
export function getSurfaceGreatTreeAnchor() {
    return {
        x: SURFACE_GREAT_TREE_POS.x,
        y: getTerrainHeight(SURFACE_GREAT_TREE_POS.x, SURFACE_GREAT_TREE_POS.z),
        z: SURFACE_GREAT_TREE_POS.z,
    };
}

// HERO: one large merged low-poly tree (~3–4× the scattered trees). Tapered cylinder
// trunk + 5 stacked, offset cone canopy lobes, anchored via getTerrainHeight off the left
// of the path. A warm rim term gilds the canopy edge (golden-hour backlight) with a green
// height grade. FrontSide solid, no bloom; a gentle whole-tree sway shares uTime.
export function createGreatTreeTSL(uTime = uniform(0)) {
    // Tapered trunk + 5 canopy lobes (offset for an organic, asymmetric crown).
    const trunk = new THREE.CylinderGeometry(1.4, 2.6, 26, 8, 1);
    const lobe = (r, hgt, seg) => new THREE.ConeGeometry(r, hgt, seg, 1);
    const branch = (r0, r1, len, rz, ry) => {
        const geo = new THREE.CylinderGeometry(r0, r1, len, 6, 1);
        geo.rotateZ(rz);
        geo.rotateY(ry);
        return geo;
    };
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 13, 0] },
        { geo: branch(0.38, 0.8, 18, Math.PI / 2.9, 0.5), offset: [5.6, 23, 1.0] },
        { geo: branch(0.32, 0.68, 15, -Math.PI / 3.2, -0.85), offset: [-5.0, 27, -1.2] },
        { geo: branch(0.26, 0.58, 13, Math.PI / 3.5, -0.35), offset: [3.2, 32, -2.8] },
        { geo: lobe(13, 18, 9), offset: [0, 30, 0] },
        { geo: lobe(11, 16, 9), offset: [4.5, 37, 2.0] },
        { geo: lobe(10.5, 15, 9), offset: [-4.0, 38, -1.5] },
        { geo: lobe(8.5, 14, 8), offset: [1.5, 44, -3.0] },
        { geo: lobe(6.5, 12, 8), offset: [-1.0, 50, 1.5] },
    ]);
    geometry.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;

    const isTrunk = oneMinus(smoothstep(24.0, 27.0, positionLocal.y));
    const foliage = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.greatTreeShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.greatTreeSunlit),
        smoothstep(28.0, 56.0, positionLocal.y),
    );
    const bark = vec3(0.30, 0.20, 0.12);
    const colorNode = mix(foliage, bark, isTrunk);
    // Warm golden-hour rim on the grazing canopy edge (capped, never white) — emissive accent
    // over the lit canopy so the hero crown gets a glowing sun-side edge.
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);

    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.22); // slow, heavy whole-tree sway
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.84, 0.60, 0.26).mul(rim).mul(0.07).mul(oneMinus(isTrunk));
    material.side = THREE.FrontSide;

    const mesh = new THREE.Mesh(geometry, material);
    const anchor = getSurfaceGreatTreeAnchor();
    // anchor.y is sampled from getTerrainHeight; the env lifts by terrainOffsetY so the trunk
    // foot seats on the rendered ground. No -15 (that legacy offset sank the hero ~15u under).
    mesh.position.set(anchor.x, anchor.y, anchor.z);
    // Creative plan asset 1: the hero must TRIPLE its visual presence — crown upscaled
    // ~1.45× (base stays rooted; the scale origin is the trunk foot).
    mesh.scale.set(1.45, 1.4, 1.45);
    mesh.frustumCulled = false;
    mesh.userData.cc0Candidates = CH3_TREE_VALUE_SETTINGS.cc0Candidates;
    return { mesh, material, geometry };
}

// Falling-leaf billboards: a near-tree halo PLUS a corridor-wide autumn story (creative
// plan item 4). Every leaf is a SHAPED, feathered, TUMBLING teardrop alpha — never the
// old crisp orange rectangle/disc — and the corridor-wide half is gated by uSeason so
// leaves are the autumn act's particle story.
export function createFallingLeavesTSL(uTime = uniform(0), count = 120, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const corridorPlacements = options.corridorPlacements ?? [];
    const anchor = getSurfaceGreatTreeAnchor();
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const corridorFlags = new Float32Array(count);
    const palette = [
        new THREE.Color(0xe8b04a), // warm gold
        new THREE.Color(0xcf7a3a), // amber
        new THREE.Color(0xb0502e), // rust
        new THREE.Color(0x7fae3a), // green-gold
    ];
    const nearTreeCount = Math.min(count, Math.floor(count / 2));
    for (let i = 0; i < count; i += 1) {
        const corridorIdx = i - nearTreeCount;
        if (i < nearTreeCount || corridorPlacements.length === 0) {
            // Near-tree halo (denser than before — the hero's leaf-fall signature).
            bases[i * 3] = anchor.x + (Math.random() - 0.5) * 34;
            bases[i * 3 + 1] = anchor.y + 20 + Math.random() * 32;
            bases[i * 3 + 2] = anchor.z + (Math.random() - 0.5) * 30;
            corridorFlags[i] = 0;
        } else {
            // Corridor-wide autumn leaves, strung along the rail (placements sampled
            // from the spline in surface-world.js).
            const seat = corridorPlacements[corridorIdx % corridorPlacements.length];
            bases[i * 3] = seat.x + (Math.random() - 0.5) * 10;
            bases[i * 3 + 1] = seat.y + 4 + Math.random() * 12;
            bases[i * 3 + 2] = seat.z + (Math.random() - 0.5) * 10;
            corridorFlags[i] = 1;
        }
        randoms[i] = Math.random();
        sizes[i] = 0.7 + Math.random() * 0.8;
        const col = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
        aCorridor: { array: corridorFlags, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const aCorridor = attribute('aCorridor', 'float');

    // Slow falling drift wrapping over a ~40-unit band, with a gentle lateral flutter.
    const fall = fract(uTime.mul(0.03).mul(aRandom.add(0.5)).add(aRandom)).mul(40.0);
    const py = aBase.y.sub(fall);
    const px = aBase.x.add(sin(uTime.mul(0.7).add(aRandom.mul(11.0))).mul(3.5));
    const pz = aBase.z.add(cos(uTime.mul(0.5).add(aRandom.mul(7.0))).mul(2.5));
    const positionNode = billboardWorld(vec3(px, py, pz), aSize);

    // TUMBLING LEAF alpha (the squares-killer): rotate the quad uv over time, then mask
    // a teardrop — an ellipse whose width tapers toward the tip — feathered to zero well
    // inside the quad edge (sakura petal technique).
    const spin = uTime.mul(aRandom.mul(1.6).add(0.7)).add(aRandom.mul(21.0));
    const cs = cos(spin);
    const sn = sin(spin);
    const p0 = uv().sub(0.5);
    const p = vec2(p0.x.mul(cs).sub(p0.y.mul(sn)), p0.x.mul(sn).add(p0.y.mul(cs)));
    const widthTaper = max(float(0.3).mul(oneMinus(p.y.mul(1.1))), 0.06);
    const leafR = length(vec2(p.x.div(widthTaper), p.y.div(0.46)));
    const leaf = oneMinus(smoothstep(0.62, 1.0, leafR));

    // Season gate: the near-tree halo always sheds a little; the corridor-wide story
    // belongs to autumn only (one particle story at a time).
    const autumnGate = smoothstep(0.36, 0.52, uSeason).mul(oneMinus(smoothstep(0.8, 0.93, uSeason)));
    const gate = mix(max(autumnGate, float(0.55)), autumnGate, aCorridor);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    material.opacityNode = leaf.mul(0.9).mul(gate);
    material.alphaTest = 0.15;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Mid-distance tree LINE: a 2nd instanced pass of smaller trees clustered in the
// 120<d<220 band so the hill silhouette layers in depth (foreground props + this far
// line + the distant range = a 3-tier depth read). Reuses the trunk+canopy merge.
export function createTreeLineTSL(uTime = uniform(0), count = 64) {
    const trunk = new THREE.CylinderGeometry(0.4, 0.7, 5.5, 5, 1);
    const canopy = new THREE.ConeGeometry(3.2, 7.0, 6, 1);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 2.75, 0] },
        { geo: canopy, offset: [0, 8.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.18), 3));

    // Cooler/hazier than the near trees (atmospheric perspective on the silhouette) but no
    // longer washed — richer greens + per-instance tint so the far line still reads as forest.
    const colorNode = mix(
        vec3(...CH3_TREE_VALUE_SETTINGS.treeLineShadow),
        vec3(...CH3_TREE_VALUE_SETTINGS.treeLineSunlit),
        smoothstep(4.0, 11.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshLambertNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.3);
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 24) {
        guard += 1;
        const x = (Math.random() - 0.5) * 360;
        const z = -(120 + Math.random() * 100); // far band, into the frame
        const d = Math.sqrt(x * x + z * z);
        const h = getTerrainHeight(x, z);
        if (h >= 5.0 && d >= 120 && d <= 240) {
            const s = 0.8 + Math.random() * 0.7;
            dummy.position.set(x, h - 0.5, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            mesh.setMatrixAt(n, dummy.matrix);
            n += 1;
        }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    mesh.position.y = -15;
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Second beat: a tiered cliff WATERFALL — 2–3 thin scrolling emissive plane ribbons
// (downward FBM streaks, side-feathered) feeding a glowing splash pool at the lake. The
// ribbons are additive-soft + capped (peak channel ≤ ~0.8) so they bloom gently, never
// blow white. Anchored at SURFACE_WATERFALL_POS over the river axis.
export function createWaterfallTSL(uTime = uniform(0)) {
    const group = new THREE.Group();
    group.name = 'surface-waterfall-tsl';
    const uOpacity = uniform(1);

    // One shared ribbon material: bright cool-white water graded warmer at the lit top,
    // with a vertical scrolling FBM streak and a side feather to 0 before the plane edge.
    const vUv = uv();
    const scroll = uTime.mul(0.5);
    const streak = snoise3(vec3(vUv.x.mul(5.0), vUv.y.mul(7.0).add(scroll), scroll.mul(0.4)))
        .mul(0.5).add(0.5);
    const streak2 = snoise3(vec3(vUv.x.mul(11.0), vUv.y.mul(15.0).add(scroll.mul(1.6)), 0.0))
        .mul(0.5).add(0.5);
    const flow = streak.mul(0.7).add(streak2.mul(0.3));
    const sideFeather = oneMinus(smoothstep(0.32, 0.5, abs(vUv.x.sub(0.5))));
    const topFade = smoothstep(0.0, 0.12, vUv.y);
    const bottomFade = oneMinus(smoothstep(0.86, 1.0, vUv.y));
    // Warm-lit crest -> cool water body. Crests brightened toward #E8E2D0 (creative plan
    // asset 2) so the falls bloom gently and read from 200 units down the corridor.
    const ribbonColor = mix(vec3(0.62, 0.74, 0.80), vec3(0.91, 0.89, 0.82), smoothstep(0.55, 1.0, vUv.y));
    const ribbonAlpha = flow.mul(sideFeather).mul(topFade).mul(bottomFade)
        .mul(0.58)
        .mul(uOpacity);

    const ribbonMat = new THREE.MeshBasicNodeMaterial();
    ribbonMat.colorNode = ribbonColor;
    ribbonMat.opacityNode = ribbonAlpha;
    ribbonMat.transparent = true;
    ribbonMat.depthWrite = false;
    ribbonMat.side = THREE.DoubleSide;
    ribbonMat.blending = THREE.AdditiveBlending;
    ribbonMat.userData.emitsBloom = true;

    const ribbonGeo = new THREE.PlaneGeometry(14, 60);
    // Three tiers stepping down toward the lake (each lower + slightly forward).
    const tiers = [
        { x: 0, y: 56, z: 0 },
        { x: 3, y: 26, z: 6 },
        { x: -2, y: 0, z: 12 },
    ];
    // ZERO-VISUAL draw share: the three ribbon tiers already share ribbonMat + ribbonGeo and
    // differ ONLY by position. The ribbon shader is uv()+uTime-driven (no positionWorld) and the
    // only per-frame write touches the shared uOpacity node (waterfallOpacityUniformTargets) +
    // group.visible — never a single tier — so the three identical Mesh draws collapse into ONE
    // InstancedMesh draw whose instanceMatrix carries each tier's offset. Pixels unchanged.
    const ribbonMesh = new THREE.InstancedMesh(ribbonGeo, ribbonMat, tiers.length);
    ribbonMesh.frustumCulled = false;
    const ribbonDummy = new THREE.Object3D();
    tiers.forEach((tier, i) => {
        ribbonDummy.position.set(tier.x, tier.y, tier.z);
        ribbonDummy.updateMatrix();
        ribbonMesh.setMatrixAt(i, ribbonDummy.matrix);
    });
    ribbonMesh.instanceMatrix.needsUpdate = true;
    group.add(ribbonMesh);

    // Glowing splash pool at the base — a soft radial additive disc on the lake surface.
    const poolUv = uv().sub(0.5).length().mul(2.0);
    const poolGlow = oneMinus(smoothstep(0.2, 1.0, poolUv));
    const poolMat = new THREE.MeshBasicNodeMaterial();
    poolMat.colorNode = vec3(0.70, 0.78, 0.74);
    poolMat.opacityNode = poolGlow.mul(0.4).mul(uOpacity);
    poolMat.transparent = true;
    poolMat.depthWrite = false;
    poolMat.side = THREE.DoubleSide;
    poolMat.blending = THREE.AdditiveBlending;
    poolMat.userData.emitsBloom = true;
    const poolGeo = new THREE.PlaneGeometry(40, 40);
    poolGeo.rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(-2, -12, 16);
    group.add(pool);

    const anchor = getTerrainHeight(SURFACE_WATERFALL_POS.x, SURFACE_WATERFALL_POS.z);
    group.position.set(SURFACE_WATERFALL_POS.x, anchor - 15, SURFACE_WATERFALL_POS.z);
    return {
        group, material: ribbonMat, geometry: ribbonGeo, uniforms: { uOpacity },
    };
}

// Warm-amber pollen motes — instanced billboard quads with a radial alpha feather to 0
// before the quad edge (additive, capped). These are the "warm-amber pollen" the brief
// asks to keep, drifting in the golden-hour light.
export function createPollenTSL(uTime = uniform(0), count = 260, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 140;
        bases[i * 3 + 1] = Math.random() * 50;
        bases[i * 3 + 2] = (Math.random() - 0.5) * 90;
        randoms[i] = Math.random();
        sizes[i] = 0.5 + Math.random() * 0.9;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
    });

    const uOpacity = uniform(1);
    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');

    // Slow buoyant drift: gentle bob + lateral sway, wrapped over a tall band.
    const driftY = fract(uTime.mul(0.02).mul(aRandom.add(0.4)).add(aRandom)).mul(56.0);
    const py = aBase.y.add(driftY).sub(8.0);
    const px = aBase.x.add(sin(uTime.mul(0.4).add(aRandom.mul(9.0))).mul(3.0));
    const pz = aBase.z.add(cos(uTime.mul(0.3).add(aRandom.mul(6.0))).mul(2.2));
    const center = vec3(px, py, pz);

    const positionNode = billboardWorld(center, aSize);

    // Radial feather to 0 BEFORE the quad edge (soft round mote, no hard square).
    const r = uv().sub(0.5).length().mul(2.0);
    const feather = oneMinus(smoothstep(0.25, 1.0, r));

    // Summer's particle story (one story at a time): pollen fades in after the petals
    // and hands off to the autumn leaves.
    const summerGate = smoothstep(0.16, 0.3, uSeason).mul(oneMinus(smoothstep(0.5, 0.66, uSeason)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(1.0, 0.80, 0.42); // warm amber pollen (#FFAA44 firefly family)
    material.opacityNode = feather.mul(0.55).mul(summerGate.mul(0.7).add(0.3)).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// Slow winter snow motes (creative plan asset 9): the snow line's particle story — soft
// white flecks gated to the chapter's final act so the world hushes as the key cools.
export function createSnowMotesTSL(uTime = uniform(0), count = 220, options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 160;
        bases[i * 3 + 1] = 10 + Math.random() * 50;
        bases[i * 3 + 2] = (Math.random() - 0.5) * 140 - 60;
        randoms[i] = Math.random();
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');

    const fall = fract(uTime.mul(0.025).mul(aRandom.add(0.5)).add(aRandom)).mul(52.0);
    const py = aBase.y.sub(fall).add(26.0);
    const px = aBase.x.add(sin(uTime.mul(0.5).add(aRandom.mul(13.0))).mul(2.6));
    const pz = aBase.z.add(cos(uTime.mul(0.4).add(aRandom.mul(8.0))).mul(2.0));
    const positionNode = billboardWorld(vec3(px, py, pz), aRandom.mul(0.4).add(0.35));

    const r = uv().sub(0.5).length().mul(2.0);
    const feather = oneMinus(smoothstep(0.2, 1.0, r));
    const winterGate = smoothstep(0.7, 0.88, uSeason);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(0.95, 0.97, 1.0); // #F2F7FF snow
    material.opacityNode = feather.mul(0.6).mul(winterGate).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// Drifting bird silhouettes — adapted from swedish-forest-birds' swept-wing shape. Each
// bird is a small body triangle (tail -> beak -> shoulder) plus two SWEPT wings (root ->
// tip -> trailing edge) so the silhouette reads as a real bird, not a flat V. The wing tips
// carry Y extent, so the update loop's scale.y flap actually beats the wings up/down. Dark
// warm-grey silhouette with a faint distance haze lift (matches the swedish-forest birds).
// Animated in updateSurfaceWorldEnvironment via group.userData.birds (API unchanged).
export function createBirdsTSL(count = 7) {
    const group = new THREE.Group();
    group.name = 'surface-birds-tsl';

    // Swept-wing bird geometry, scaled up for Chapter 3's world units. Body forward is +Z;
    // the update faces it to heading. Built as triangle panels so the silhouette has mass:
    // body, head/beak, tail fan, inner/outer wing panels and primary tips.
    const wingGeo = new THREE.BufferGeometry();
    const s = 2.25;
    const verts = [];
    const tri = (...coords) => {
        coords.forEach((coord) => verts.push(coord * s));
    };

    tri(0.00, -0.07, -1.34, 0.00, 0.08, 1.42, -0.26, 0.08, 0.04);
    tri(0.00, -0.07, -1.34, 0.26, 0.08, 0.04, 0.00, 0.08, 1.42);
    tri(-0.17, 0.09, 1.16, 0.00, 0.21, 1.74, 0.17, 0.09, 1.16);
    tri(-0.34, -0.04, -1.30, 0.00, -0.20, -2.02, 0.00, -0.04, -1.22);
    tri(0.34, -0.04, -1.30, 0.00, -0.04, -1.22, 0.00, -0.20, -2.02);

    tri(-0.12, 0.07, 0.20, -0.88, 0.22, 0.08, -0.34, -0.03, -0.30);
    tri(-0.88, 0.22, 0.08, -2.08, 0.50, -0.22, -0.66, -0.09, -0.56);
    tri(-0.66, -0.09, -0.56, -2.08, 0.50, -0.22, -1.76, 0.08, -0.86);
    tri(-2.08, 0.50, -0.22, -2.74, 0.28, -0.56, -1.76, 0.08, -0.86);
    tri(-1.76, 0.08, -0.86, -2.74, 0.28, -0.56, -2.10, -0.08, -1.10);

    tri(0.12, 0.07, 0.20, 0.34, -0.03, -0.30, 0.88, 0.22, 0.08);
    tri(0.88, 0.22, 0.08, 0.66, -0.09, -0.56, 2.08, 0.50, -0.22);
    tri(0.66, -0.09, -0.56, 1.76, 0.08, -0.86, 2.08, 0.50, -0.22);
    tri(2.08, 0.50, -0.22, 1.76, 0.08, -0.86, 2.74, 0.28, -0.56);
    tri(1.76, 0.08, -0.86, 2.10, -0.08, -1.10, 2.74, 0.28, -0.56);

    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    wingGeo.computeVertexNormals();
    wingGeo.userData.silhouette = CH3_BIRD_SILHOUETTE_SETTINGS;

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec3(0.055, 0.065, 0.075); // dark, readable sky silhouette
    material.side = THREE.DoubleSide;

    for (let i = 0; i < count; i += 1) {
        const bird = new THREE.Mesh(wingGeo, material);
        bird.userData = {
            speed: 0.2 + Math.random() * 0.35,
            radius: 38 + Math.random() * 60,
            height: 28 + Math.random() * 34,
            offset: Math.random() * Math.PI * 2,
            flap: 4 + Math.random() * 3,
        };
        group.add(bird);
    }
    group.userData.silhouette = CH3_BIRD_SILHOUETTE_SETTINGS;
    group.userData.cc0Candidate = CH3_BIRD_SILHOUETTE_SETTINGS.cc0Candidate;
    return { group, material, geometry: wingGeo };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5e. SUN disc + soft halo (golden-hour; additive, capped, bloom-eligible)
// ═══════════════════════════════════════════════════════════════════════════════
//
// VISUAL POLISH (user note "maybe a SUN"): a visible warm golden sun — a soft bright core,
// a turbulent corona ring and a wide soft halo — adapted from sky-children-v2's
// createSunNodeMaterial (core/corona/halo radial smoothsteps + faint noise turbulence),
// re-implemented as a single camera-facing billboard quad. Placed far down-corridor toward
// the sky's sun direction (vec3(0.40, 0.16, -0.90)) so the disc sits where the sky's warm
// band + sun glow are. Additive but every term is CAPPED below 1.0 so ACES/bloom roll it
// off into a glow rather than a clipped white hole (peak channel ≈ 0.85). One quad, no
// per-frame allocation; uOpacity tagged so the surface fade collector drives it.
export function createSunDiscTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const winterT = seasonWinterT(uSeason);
    // Winter cools the disc toward #DCE8FF (the season arrives as light, not props).
    const uCore = mix(uniform(new THREE.Color(0xffeec0)), vec3(0.863, 0.91, 1.0), winterT.mul(0.85));
    const uCorona = mix(uniform(new THREE.Color(0xffc66a)), vec3(0.72, 0.8, 0.93), winterT.mul(0.85));
    const uHalo = mix(uniform(new THREE.Color(0xff9e44)), vec3(0.6, 0.7, 0.88), winterT.mul(0.85));

    const centered = uv().sub(0.5);
    const dist = length(centered);

    // Faint turbulence so the disc edge shimmers organically (no hard plastic circle).
    const turb = snoise3(vec3(centered.x.mul(7.0), centered.y.mul(7.0), uTime.mul(0.05)))
        .mul(0.06).sub(0.03);

    // Radial core / corona / halo (sky-children sun discipline). Soft edges via smoothstep.
    const core = oneMinus(smoothstep(0.0, float(0.16).add(turb), dist));
    const corona = oneMinus(smoothstep(0.10, float(0.34).add(turb), dist));
    const halo = oneMinus(smoothstep(0.20, 0.5, dist));

    // Build the colour: warm core blends to golden corona by radius, plus a wide amber halo.
    const surface = mix(uCore, uCorona, smoothstep(0.0, 0.34, dist));
    let color = surface.mul(core.mul(0.85).add(corona.mul(0.4)));
    color = color.add(uHalo.mul(pow(halo, 2.0)).mul(0.28));
    // Gentle breathing pulse (very subtle).
    const pulse = sin(uTime.mul(0.5)).mul(0.04).add(1.0);
    color = color.mul(pulse);

    // Alpha: bright at the core, fading through the halo to 0 well before the quad edge.
    const alpha = oneMinus(smoothstep(0.06, 0.5, dist)).mul(0.96).mul(uOpacity);

    // A single camera-facing billboard quad far down-corridor along the sky's sun direction,
    // so the disc always reads as a round distant sun regardless of camera yaw. Far + large
    // so perspective renders it as a distant sun low toward the horizon.
    const sunDir = SURFACE_SUN_DIR;
    const center = vec3(sunDir.x * 900, sunDir.y * 900, sunDir.z * 900);
    const positionNode = billboardWorld(center, float(186.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false; // sit in the sky behind everything, never z-fight terrain
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -90; // just in front of the sky sphere (-100), behind terrain
    mesh.frustumCulled = false;

    const group = new THREE.Group();
    group.name = 'surface-sun-tsl';
    group.add(mesh);
    return {
        group, mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Sun Rays (additive golden volumetric beams; bloom-eligible)
// ═══════════════════════════════════════════════════════════════════════════════

export function createSunRaysTSL(uTime = uniform(0), options = {}) {
    const uSeason = options.uSeason ?? uniform(0);
    const uOpacity = uniform(1);
    const vUv = uv();

    const edgeFade = oneMinus(pow(abs(vUv.x.sub(0.5)).mul(2.5), 2.0));
    const bottomFade = smoothstep(0.0, 0.3, vUv.y);
    const topFade = oneMinus(smoothstep(0.8, 1.0, vUv.y));
    const shimmer = sin(vUv.y.mul(10.0).sub(uTime.mul(0.5))).mul(0.1).add(0.9);
    const beam = smoothstep(0.3, 0.7, sin(vUv.x.mul(20.0).add(uTime.mul(0.2))).mul(0.5).add(0.5));

    const alpha = edgeFade.mul(bottomFade).mul(topFade).mul(shimmer)
        .mul(beam.mul(0.1).add(0.1))
        // Dimmed: additive white rays were part of the blown upper frame. Pulled back so
        // the god-rays accent the warm sky rather than veiling it white. Winter thins
        // the shafts further (plan item 6: the snow line is hushed, not golden).
        .mul(0.26)
        .mul(oneMinus(seasonWinterT(uSeason).mul(0.45)))
        .mul(uOpacity);

    // Warm golden god-ray tint (matches the golden-hour sun, no neutral-white additive).
    const color = vec3(1.0, 0.86, 0.56);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(30, 120);

    const group = new THREE.Group();
    group.name = 'sun-rays-tsl';
    // Batch B5: 5 → 7 beams, clustered toward the lower-left where the raking sun sits, so
    // the god-rays fan FROM the light source (densest in the hero-tree beat shafts).
    // ZERO-VISUAL draw share: every beam was already the SAME material + geometry differing
    // ONLY by transform (position + rotation.z), and the shader animates GPU-side via uv()+uTime
    // (no per-mesh mutation in update() — only the shared uOpacity node and group.visible). Seven
    // identical Mesh draws collapse into ONE InstancedMesh draw (instanceMatrix carries each
    // beam's transform); the random spread is generated identically, so the pixels are unchanged.
    const beamCount = 7;
    const mesh = new THREE.InstancedMesh(geometry, material, beamCount);
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < beamCount; i += 1) {
        // Bias the fan to the left (sun-side) with a tight spread around it.
        dummy.position.set(
            -40 + (Math.random() - 0.5) * 70,
            20,
            -30 - Math.random() * 50,
        );
        dummy.rotation.set(0, 0, 0.18 + (Math.random() - 0.5) * 0.4); // lean toward the sun
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return {
        group, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Clouds (soft procedural noise puffs; NormalBlending transparent, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

export function createCloudsTSL(uTime = uniform(0)) {
    const uOpacity = uniform(1);
    const vUv = uv();

    // Golden-hour-lit cloud strata: a warm sun-lit top and a cooler shaded base, with the
    // structure coming from layered FBM rather than a flat white puff. Keeps the upper
    // frame from washing white — the cloud body sits at a moderate value and reads as form.
    const t = uTime.mul(0.045);

    // Stretched coords give horizontal STRATA (wide, layered banks) not round blobs.
    const sx = vUv.x.mul(2.4);
    const sy = vUv.y.mul(4.6);
    const n1 = snoise3(vec3(sx.add(t), sy, t));
    const n2 = snoise3(vec3(sx.mul(2.1).sub(t), sy.mul(2.1), t.mul(1.4))).mul(0.5);
    const n3 = snoise3(vec3(sx.mul(4.3).add(t.mul(0.6)), sy.mul(4.3), t.mul(0.8))).mul(0.25);
    const body = n1.add(n2).add(n3);

    // Soft elliptical mask (wider than tall) so banks fade at the edges, not as a disc.
    const ex = vUv.x.sub(0.5).mul(1.7);
    const ey = vUv.y.sub(0.5).mul(2.6);
    const dist = length(vec2(ex, ey));
    const mask = oneMinus(smoothstep(0.35, 1.0, dist));

    const density = smoothstep(0.15, 0.78, body.add(0.5)).mul(mask);

    // Light from above-and-warm: top of each puff catches warm sun, base stays cool/dim.
    const litTop = uv().y; // 0 at base, 1 at top of the plane
    const sunlit = vec3(0.96, 0.84, 0.66); // Warm golden-lit cloud top
    const shaded = vec3(0.58, 0.66, 0.80); // Cool blue-grey shaded base
    const color = mix(shaded, sunlit, smoothstep(0.25, 0.95, litTop.add(body.mul(0.12))));

    const alpha = density.mul(0.10).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;

    // Wide, low-profile planes read as horizontal cloud banks/strata.
    const geometry = new THREE.PlaneGeometry(90, 26);

    const group = new THREE.Group();
    group.name = 'clouds-tsl';
    // Batch B5: fill the empty act-in sky. 7 → 12 banks spanning z -60..-220, with the
    // LOWEST bank dropped to y≈14 so the strata sit nearer the horizon line (not floating
    // high), plus 3 large soft horizon cumulus pushed far back for a layered sky read.
    // ZERO-VISUAL draw share: every bank already shares this material + geometry, differing
    // ONLY by transform (position + non-uniform scale). The shader is purely uv()/uTime-driven
    // (no positionWorld, no per-mesh mutation in update() — only the shared uOpacity node and
    // group.visible), so the 15 identical Mesh draws collapse into ONE InstancedMesh draw whose
    // instanceMatrix carries each bank's transform. The Math.random() draws run in the same order,
    // so every bank lands at the identical transform it had before — pixels unchanged.
    const cloudCount = 12;
    const horizonCount = 3;
    const mesh = new THREE.InstancedMesh(geometry, material, cloudCount + horizonCount);
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cloudCount; i += 1) {
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(
            (Math.random() - 0.5) * 200,
            // Lift the banks well above the mountain mid-section so they read as high sky strata,
            // not a grey haze veiling the peaks (the old y≈30 banks smeared across the range).
            58 + (i * 5.0) + Math.random() * 6,
            -60 - Math.random() * 160, // widened z spread (-60..-220)
        );
        dummy.scale.set(1.0 + Math.random() * 0.7, 0.8 + Math.random() * 0.5, 1.0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    // 3 large soft horizon cumulus far back + low, wide — the warm golden-hour backdrop.
    for (let i = 0; i < horizonCount; i += 1) {
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(
            (i - 1) * 130 + (Math.random() - 0.5) * 50,
            42 + Math.random() * 10,
            -240 - Math.random() * 90,
        );
        dummy.scale.set(2.6 + Math.random() * 1.1, 1.4 + Math.random() * 0.6, 1.0);
        dummy.updateMatrix();
        mesh.setMatrixAt(cloudCount + i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return {
        group, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Distant Mountains (CPU-baked cone/FBM silhouette + GPU snow/rock/fog shading)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — ONE displacement language (shared/mountain-language.js), so a
// peak on Surface's horizon is the SAME mountain shape the Mountains chapter shows close.
function buildDistantMountainGeometry(config) {
    const segments = 128;
    const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const posAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const heights = [];
    const seed = config.seed || 0;

    for (let i = 0; i < posAttribute.count; i += 1) {
        vertex.fromBufferAttribute(posAttribute, i);
        const h = mountainCpuDisplacement(vertex.x, vertex.z, {
            size: config.size,
            height: config.height,
            seed,
        });
        posAttribute.setY(i, h);
        heights.push(h);
    }

    geometry.computeVertexNormals();

    const heightAttr = new Float32Array(posAttribute.count);
    for (let i = 0; i < posAttribute.count; i += 1) {
        heightAttr[i] = heights[i] / config.height;
    }
    geometry.setAttribute('aHeight', new THREE.BufferAttribute(heightAttr, 1));

    return geometry;
}

export function createDistantMountainTSL(config = {}) {
    const {
        size = 800,
        height = 300,
        seed = 0,
        position = new THREE.Vector3(0, 0, 0),
    } = config;

    // Surface's distant range rides the NEUTRAL end of the temperature ramp (grey-blue,
    // farther + hazier + cooler than the Mountains chapter heroes) but uses the SAME
    // canonical palette + snow-line + alpenglow + fog treatment, so it reads as the same
    // mountains seen from a distance. A low coolTemp + a low snow line (distant peaks are
    // mostly capped) does the work; per-instance variation = distance/fog + coolTemp only.
    const treatment = resolveMountainTreatment({ coolTemp: 0.28, snowLine: 0.38 });

    const uSnow = uniform(new THREE.Color(treatment.snow));
    const uRock = uniform(new THREE.Color(treatment.rock));
    const uShadow = uniform(new THREE.Color(treatment.shadow));
    const uFog = uniform(new THREE.Color(treatment.fog));
    const uAlpen = uniform(new THREE.Color(treatment.alpenglow));
    const uRim = uniform(new THREE.Color(treatment.rim));
    const uSnowLine = uniform(treatment.snowLine);
    const uSnowBlend = uniform(0);
    const uOpacity = uniform(1);

    // vNormal → normalView, vWorldPosition → positionWorld, vHeight → aHeight.
    const vNormal = normalView;
    const vWorldPosition = positionWorld;
    const vHeight = attribute('aHeight', 'float');

    // ONE shading treatment — distance fog onset pulled nearer so the far range hazes off
    // into the sky (atmospheric perspective is the dominant per-instance cue here).
    const color = mountainColorNode({
        uSnow,
        uRock,
        uShadow,
        uFog,
        uAlpen,
        uRim,
        uSnowLine,
        uSnowBlend,
        vNormal,
        vWorldPosition,
        vHeight,
        fogNear: 380.0,
        fogFar: 1400.0,
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.transparent = true;
    material.depthWrite = false;

    const geometry = buildDistantMountainGeometry({ size, height, seed });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.renderOrder = -2;
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

export function createDistantMountainsTSL(uTime = uniform(0)) {
    const group = new THREE.Group();
    group.name = 'distant-mountains-tsl';
    const parts = [];

    const left = createDistantMountainTSL({
        size: 780,
        height: 300,
        position: new THREE.Vector3(-280, -8, -460),
        seed: 12.34,
    });
    const center = createDistantMountainTSL({
        size: 1100,
        height: 480,
        position: new THREE.Vector3(0, -28, -650),
        seed: 89.12,
    });
    const right = createDistantMountainTSL({
        size: 780,
        height: 290,
        position: new THREE.Vector3(280, -12, -500),
        seed: 45.67,
    });
    group.add(left.mesh, center.mesh, right.mesh);
    parts.push(left, center, right);

    const mist = createMountainMistTSL(uTime);
    group.add(mist.group);
    parts.push(mist);

    return {
        group, parts, mist, uniforms: { uTime },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Mountain Mist (foothill valley mist; NormalBlending transparent, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// Value noise (squared) in ~[0,1] — TSL twin of the mist fragment's inline rand/noise.
function mistNoise(p) {
    const n = snoise3(vec3(p.x, p.y, 0.0)).mul(0.5).add(0.5);
    return n.mul(n);
}

export function createMountainMistTSL(uTime = uniform(0)) {
    const uColor = uniform(new THREE.Color(0xc4d6e6)); // Cool blue-grey haze (was near-white)
    const uOpacity = uniform(1);

    const vUv = uv();
    const vWorldPosition = positionWorld;

    const center = vUv.sub(0.5);
    const dist = length(center);
    let alpha = oneMinus(smoothstep(0.08, 0.62, dist));
    alpha = alpha.mul(smoothstep(0.02, 0.28, vUv.y));
    alpha = alpha.mul(oneMinus(smoothstep(0.74, 1.0, vUv.y)));
    const n = mistNoise(vWorldPosition.xz.mul(0.02).add(vec2(0.0, uTime.mul(0.04))));
    alpha = alpha.mul(n.mul(0.35).add(0.65));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor;
    material.opacityNode = alpha.mul(0.18).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.depthTest = true;
    material.blending = THREE.NormalBlending;

    const geometry = new THREE.PlaneGeometry(520, 240);

    const group = new THREE.Group();
    group.name = 'foothill-valley-mist-tsl';

    const positions = [
        {
            x: -190, y: 34, z: -380, scale: 1.12, rotY: 0.14,
        },
        {
            x: 35, y: 40, z: -520, scale: 1.26, rotY: -0.1,
        },
        {
            x: 225, y: 46, z: -680, scale: 1.18, rotY: 0.08,
        },
        {
            x: -50, y: 52, z: -810, scale: 1.38, rotY: -0.06,
        },
    ];

    // ZERO-VISUAL draw share: the four mist banks already share this material + geometry,
    // differing ONLY by transform (position/rotation/uniform scale) and a uniform renderOrder
    // (-1). The shader is uv()+positionWorld.xz+uTime-driven — InstancedMesh feeds each bank's
    // own world XZ through positionWorld, so the noise samples identically — and update() never
    // mutates these meshes (only the shared uOpacity node + group.visible). Four identical Mesh
    // draws collapse into ONE InstancedMesh draw whose instanceMatrix carries each transform.
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    const dummy = new THREE.Object3D();
    positions.forEach((pos, i) => {
        dummy.position.set(pos.x, pos.y, pos.z);
        dummy.rotation.set(-0.08, pos.rotY, 0);
        dummy.scale.setScalar(pos.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);

    return {
        group, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Falu-red cabin + foreground pass-by layer (creative plan assets 3 + 7)
// ═══════════════════════════════════════════════════════════════════════════════

// The cabin is the chapter's human-scale cue: falu red #8B2F26 walls, white #F3EFE4
// gable trim, a dark pyramid roof and one smoke wisp — promoted from hazed speck to
// landmark at the treeline right of the path, mid-corridor.
const SURFACE_CABIN_POS = { x: 56, z: -310 };

function findCabinAnchor() {
    // Search outward from the desired seat until the terrain offers solid land (h>=6),
    // so layout edits never strand the cabin in the river.
    for (let ring = 0; ring < 8; ring += 1) {
        const x = SURFACE_CABIN_POS.x + ring * 9;
        const z = SURFACE_CABIN_POS.z + ring * 6;
        const h = getTerrainHeight(x, z);
        if (h >= 6.0) return { x, y: h, z };
    }
    return {
        x: SURFACE_CABIN_POS.x,
        y: Math.max(getTerrainHeight(SURFACE_CABIN_POS.x, SURFACE_CABIN_POS.z), 6),
        z: SURFACE_CABIN_POS.z,
    };
}

export function createCabinTSL(uTime = uniform(0)) {
    const uOpacity = uniform(1);
    const group = new THREE.Group();
    group.name = 'falu-cabin';

    // Merged body: walls + pyramid roof + chimney (one draw call).
    const walls = new THREE.BoxGeometry(7, 4.5, 5.5);
    const roof = new THREE.ConeGeometry(5.6, 3.4, 4, 1);
    roof.rotateY(Math.PI / 4);
    const chimney = new THREE.BoxGeometry(0.9, 2.4, 0.9);
    const geometry = mergeOffsetGeometries([
        { geo: walls, offset: [0, 2.25, 0] },
        { geo: roof, offset: [0, 6.1, 0] },
        { geo: chimney, offset: [1.8, 6.6, 0.8] },
    ]);

    // Color by height bands: falu walls, white gable trim, dark shingle roof/chimney.
    const py = positionLocal.y;
    const falu = vec3(0.545, 0.184, 0.149); // #8B2F26
    const trim = vec3(0.953, 0.937, 0.894); // #F3EFE4
    const roofDark = vec3(0.2, 0.14, 0.11);
    const trimBand = smoothstep(3.85, 4.05, py).mul(oneMinus(smoothstep(4.35, 4.55, py)));
    let color = mix(falu, roofDark, smoothstep(4.45, 4.8, py));
    color = mix(color, trim, trimBand);
    // The same raking key the landscape uses, so the cabin sits in the scene's light.
    const lightDir = normalize(vec3(-0.62, 0.34, -0.71));
    const diff = max(dot(normalView, lightDir), 0.0);
    color = color.mul(diff.mul(0.5).add(vec3(0.62, 0.68, 0.74).mul(0.5)));

    const bodyMaterial = new THREE.MeshBasicNodeMaterial();
    bodyMaterial.colorNode = color;
    bodyMaterial.opacityNode = uOpacity;
    bodyMaterial.transparent = true;
    bodyMaterial.side = THREE.FrontSide;
    const body = new THREE.Mesh(geometry, bodyMaterial);
    group.add(body);

    // One smoke wisp: a vertical billboard streamer rising off the chimney.
    const wispUv = uv();
    const wispNoise = snoise3(vec3(wispUv.x.mul(3.0), wispUv.y.mul(5.0).sub(uTime.mul(0.35)), uTime.mul(0.08)))
        .mul(0.5).add(0.5);
    const wispStrand = oneMinus(smoothstep(0.0, 0.3, abs(wispUv.x.sub(0.5).add(
        sin(wispUv.y.mul(5.0).add(uTime.mul(0.6))).mul(0.12).mul(wispUv.y),
    ))));
    const wispAlpha = wispStrand.mul(wispNoise)
        .mul(smoothstep(0.0, 0.15, wispUv.y))
        .mul(oneMinus(smoothstep(0.6, 1.0, wispUv.y)))
        .mul(0.4)
        .mul(uOpacity);
    const wispMaterial = new THREE.MeshBasicNodeMaterial();
    wispMaterial.colorNode = vec3(0.82, 0.82, 0.84);
    wispMaterial.opacityNode = wispAlpha;
    wispMaterial.transparent = true;
    wispMaterial.depthWrite = false;
    wispMaterial.side = THREE.DoubleSide;
    const wisp = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9), wispMaterial);
    wisp.position.set(1.8, 11.5, 0.8);
    group.add(wisp);

    const anchor = findCabinAnchor();
    group.position.set(anchor.x, anchor.y - 15, anchor.z);
    group.traverse((child) => { child.frustumCulled = false; });
    return {
        group, material: bodyMaterial, geometry, uniforms: { uOpacity },
    };
}

// Foreground PASS-BY layer (creative plan asset 7 — "currently absent, build it"):
// dark near-silhouette grass heads, reed plumes, and branch sweeps flanking the spline
// 2–8 units off the rail for the whole chapter, sitting at the darkest value in frame
// (#0E1F12) — the dark anchor the pastels need, and the speed cue for the rail ride.
// Placements (chapter-local, sampled from the spline) come from surface-world.js.
export function createForegroundPassByTSL(uTime = uniform(0), placements = [], options = {}) {
    const count = Math.max(placements.length, 1);
    const uOpacity = options.uOpacity ?? uniform(1);
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const shapes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        const seat = placements[i] ?? { x: 0, y: 0, z: -10 };
        bases[i * 3] = seat.x;
        bases[i * 3 + 1] = seat.y;
        bases[i * 3 + 2] = seat.z;
        seeds[i] = Math.random();
        sizes[i] = 2.6 + Math.random() * 3.2;
        shapes[i] = i % 3; // 0 grass head, 1 reed plume, 2 branch sweep
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aShape: { array: shapes, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');
    const aSize = attribute('aSize', 'float');
    const aShape = attribute('aShape', 'float');

    const positionNode = billboardWorld(aBase, aSize);

    // Mask-space breeze: shear the sampled u by height² so the silhouettes sway rooted.
    const coord = uv();
    const vv = coord.y;
    const sway = sin(uTime.mul(1.1).add(aSeed.mul(9.0))).mul(0.06).mul(vv.mul(vv));
    const u = coord.x.add(sway);

    // Shape 0 — grass head: three thin blades fanning up from the base.
    const blade = (cu, lean) => {
        const bu = u.sub(cu).add(vv.mul(lean));
        const w = mix(float(0.045), float(0.012), vv);
        return oneMinus(smoothstep(0.0, 1.0, abs(bu).div(w)))
            .mul(smoothstep(0.0, 0.06, vv))
            .mul(oneMinus(smoothstep(0.8, 1.0, vv)));
    };
    const grassHead = max(
        max(blade(float(0.36), float(0.1)), blade(float(0.5), float(-0.05))),
        blade(float(0.64), float(0.13)),
    );

    // Shape 1 — reed plume: one stem + an elongated plume head near the top.
    const stem = oneMinus(smoothstep(0.0, 0.02, abs(u.sub(0.5).add(vv.mul(0.06)))))
        .mul(smoothstep(0.0, 0.05, vv))
        .mul(oneMinus(smoothstep(0.66, 0.74, vv)));
    const plumeR = length(vec2(u.sub(0.5).add(vv.mul(0.06)).div(0.085), vv.sub(0.76).div(0.16)));
    const plume = oneMinus(smoothstep(0.6, 1.0, plumeR));
    const reed = max(stem, plume);

    // Shape 2 — branch sweep: a diagonal limb with two leaf lobes.
    const limbT = abs(vv.sub(u.mul(0.85).add(0.05)));
    const limb = oneMinus(smoothstep(0.0, 0.035, limbT)).mul(smoothstep(0.04, 0.2, u));
    const lobeA = oneMinus(smoothstep(0.5, 1.0, length(vec2(u.sub(0.42).div(0.16), vv.sub(0.46).div(0.1)))));
    const lobeB = oneMinus(smoothstep(0.5, 1.0, length(vec2(u.sub(0.72).div(0.14), vv.sub(0.72).div(0.09)))));
    const branch = max(max(limb, lobeA), lobeB);

    const isGrass = oneMinus(smoothstep(0.5, 0.51, aShape));
    const isReed = smoothstep(0.5, 0.51, aShape).mul(oneMinus(smoothstep(1.5, 1.51, aShape)));
    const isBranch = smoothstep(1.5, 1.51, aShape);
    const mask = grassHead.mul(isGrass).add(reed.mul(isReed)).add(branch.mul(isBranch));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    // The darkest value in frame (#0E1F12), faintly lifted at the tips so it reads as
    // backlit silhouette, not a hole.
    material.colorNode = vec3(0.055, 0.122, 0.071).mul(vv.mul(0.35).add(0.75));
    material.opacityNode = mask.mul(uOpacity);
    material.alphaTest = 0.3;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'foreground-pass-by';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pilot assembler — mirrors createDeepOceanPilotTSL.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assemble the converted Surface World materials on their original geometries into one
 * group + the shared uTime uniform the caller ticks each frame. Used by the standalone
 * WebGPU pilot validation page. Reproduces the original geometry types/sizes and mesh
 * placement (relative offsets) faithfully. The petals (THREE.Points) and butterflies
 * (MeshBasicMaterial) of the live chapter are out of scope for the material conversion.
 */
export function createSurfaceWorldPilotTSL({
    surfaceOffsetY = -15,
    waterLevel = 60.0,
    grassCount = 1000,
} = {}) {
    const uTime = uniform(0);
    const group = new THREE.Group();
    group.name = 'surface-world-pilot-tsl';

    const terrainOffsetY = surfaceOffsetY + (15 - SURFACE_WORLD_TERRAIN_DEPTH_OFFSET);

    const sky = createSkyBackgroundTSL(uTime);
    const ocean = createOceanSurfaceTSL(uTime, surfaceOffsetY);
    const landscape = createLandscapeTSL(uTime, waterLevel);
    landscape.mesh.position.y += terrainOffsetY;
    const bridge = createFoothillBridgeTSL(uTime);
    bridge.mesh.position.y += terrainOffsetY;
    const grass = createFluffyGrassTSL(uTime, grassCount);
    const grassTufts = createGrassTuftsTSL(uTime, 700);
    grassTufts.mesh.position.y += terrainOffsetY;
    const trees = createTreesTSL(uTime, 26);
    trees.mesh.position.y += terrainOffsetY;
    const reeds = createReedsTSL(uTime, 220);
    reeds.mesh.position.y += terrainOffsetY;
    const pollen = createPollenTSL(uTime, 260);
    const birds = createBirdsTSL(7);
    const sun = createSunDiscTSL(uTime);
    const rays = createSunRaysTSL(uTime);
    const clouds = createCloudsTSL(uTime);
    const mountains = createDistantMountainsTSL(uTime);

    // Batch B5 hero landmarks (anchored to getTerrainHeight with -15 baked in, same as the
    // prop instancers; add terrainOffsetY for the pilot's relative offset like the props).
    const treeLine = createTreeLineTSL(uTime, 44);
    treeLine.mesh.position.y += terrainOffsetY;
    const greatTree = createGreatTreeTSL(uTime);
    greatTree.mesh.position.y += terrainOffsetY;
    const leaves = createFallingLeavesTSL(uTime, 60);
    const waterfall = createWaterfallTSL(uTime);
    waterfall.group.position.y += terrainOffsetY;

    group.add(
        sky.mesh,
        ocean.mesh,
        landscape.mesh,
        bridge.mesh,
        grass.mesh,
        grassTufts.mesh,
        trees.mesh,
        treeLine.mesh,
        reeds.mesh,
        greatTree.mesh,
        leaves.mesh,
        waterfall.group,
        pollen.mesh,
        birds.group,
        sun.group,
        rays.group,
        clouds.group,
        mountains.group,
    );

    const parts = [
        sky, ocean, landscape, bridge, grass,
        grassTufts, trees, treeLine, reeds, greatTree, leaves, waterfall,
        pollen, birds, sun,
        rays, clouds,
        ...mountains.parts,
    ];

    return {
        group,
        uniforms: { uTime },
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
                part.texture?.dispose?.();
            });
        },
    };
}

export default createSurfaceWorldPilotTSL;

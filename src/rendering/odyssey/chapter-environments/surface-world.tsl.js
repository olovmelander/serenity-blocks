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
    varying,
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
function getTerrainHeight(x, z) {
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
export function createSkyBackgroundTSL(uTime = uniform(0)) {
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

    // Two-stage vertical grade: warm horizon -> SATURATED mid azure (fast, low band) then
    // mid -> deep zenith (pulled up harder so the upper frame reads as real BLUE, not a
    // pale grey wash). The lower pow exponent lifts saturated blue earlier up the dome.
    const horizonBand = smoothstep(0.0, 0.16, h); // warm hugs the horizon line
    const zenithBand = pow(h, float(0.5)); // pull saturated blue up into the dome
    let sky = mix(uHorizon, uMid, horizonBand);
    sky = mix(sky, uZenith, zenithBand);

    // Warm ground-haze band hugging the horizon line (very low, soft): warms the waterline
    // so the act-in vista reads golden-hour, not a cold flat stripe.
    const groundHaze = oneMinus(smoothstep(0.0, 0.085, h));
    sky = mix(sky, uHaze, groundHaze.mul(0.34));

    // Readable golden SUN toward the warm horizon (low + slightly right of forward). A tight
    // bright core + a wider golden halo (sky-children sun discipline) so the sun READS as the
    // light source. Both terms are additive but capped well below white so ACES rolls them
    // off — the core peaks at ~0.9*coreColor, never a clipped white hole.
    const sunDir = normalize(vec3(0.40, 0.16, -0.90));
    const sunDot = dot(dir, sunDir);
    const sunCore = pow(smoothstep(0.9955, 1.0, sunDot), float(1.6)).mul(0.9);
    const sunHalo = pow(smoothstep(0.80, 1.0, sunDot), float(2.4)).mul(0.40);
    sky = mix(sky, uSunCore, sunCore);
    sky = sky.add(uSunGlow.mul(sunHalo)).add(t0);

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

// Gerstner wave — direct port of the GLSL gerstnerWave().
function gerstnerWave(dir, steep, wlen, p, t) {
    const k = float(6.28318).div(wlen);
    const c = float(9.8).div(k).sqrt();
    const d = normalize(dir);
    const f = k.mul(dot(d, p.xz).sub(c.mul(t)));
    const a = float(steep).div(k);
    return vec3(d.x.mul(a).mul(cos(f)), a.mul(sin(f)), d.y.mul(a).mul(cos(f)));
}

// Batch B5: the old 300×300 "ocean" plane caught only a pale sliver at the forward
// grazing angle (waves/fresnel/caustics never read). Reworked into a WINDING RIVER/LAKE:
// a smaller (~160 long × 90 wide) plane bent along -Z and dropped into the carved valley
// channel (SURFACE_RIVER_CENTER_X), so the camera looks DOWN its length and the water
// reads. A warm golden-hour sky reflection term is mixed in so the river picks up the sun
// (per the plan's "river picks up a warm sky reflection"). Public signature unchanged.
export function createOceanSurfaceTSL(uTime = uniform(0), surfaceOffsetY = -15) {
    // VISUAL POLISH (de-wash): the live river read GREY because the cool-white caustics +
    // cool-white Fresnel desaturated a thin teal base. Reworked along the SwedishForestWater
    // technique: a DEPTH-graded saturated base (richer teal toe -> bright aqua toward the
    // far bank), a low Fresnel base with a strong rim that picks up a WARM golden sky, plus a
    // bright SUN-PATH sparkle column running toward the sun (the SwedishForestWater "sun path"
    // with shimmer). Caustics tinted toward aqua, not white, so the water stays a real colour.
    const uDeep = uniform(new THREE.Color(0x0e7a96)); // Deep saturated river teal (near/toe)
    const uShallow = uniform(new THREE.Color(0x46d8c8)); // Bright clear aqua (far/shallow)
    const uSkyWarm = uniform(new THREE.Color(0xffd9a0)); // Warm golden-hour sky reflection
    const uSunPath = uniform(new THREE.Color(0xffd27a)); // Warm sun-path column colour
    const uOpacity = uniform(1);

    const posL = positionLocal;
    const time = uTime.mul(0.5);

    // Gerstner waves — calmer for paradise water.
    const wave = gerstnerWave(vec2(1.0, 0.3), 0.08, 35.0, posL, time.mul(0.7))
        .add(gerstnerWave(vec2(0.7, 0.7), 0.05, 28.0, posL, time.mul(0.8)));

    // Perlin noise detail — reduced for calmer water.
    const noise = snoise3(vec3(posL.x.mul(0.05), posL.z.mul(0.05), time.mul(0.2))).mul(0.8);

    const displacement = wave.y.add(noise);
    const displaced = vec3(posL.x.add(wave.x), posL.y.add(displacement), posL.z.add(wave.z));

    const vPosition = varying(displaced);
    const vElevation = varying(displacement);
    const vUv = uv();

    // Caustics pattern — tinted toward aqua/teal (NOT white) so it sparkles without washing.
    const causticsUV = vPosition.xz.mul(0.15);
    const c1 = snoise3(vec3(causticsUV.x, causticsUV.y, uTime.mul(0.2)));
    const c2 = snoise3(vec3(causticsUV.x.mul(1.4), causticsUV.y.mul(1.4), uTime.mul(-0.15)));
    const caustics = pow(c1.add(c2).mul(0.5).add(0.5), 3.0);

    // DEPTH gradient (SwedishForestWater): near water reads the deep saturated teal toe, the
    // far bank lifts to bright aqua — uv.y runs along the river length so it reads as winding
    // into brighter shallows. Elevation adds a touch of crest brightening.
    const depthT = smoothstep(0.15, 0.9, vUv.y).add(vElevation.mul(0.05));
    let color = mix(uDeep, uShallow, depthT);
    color = color.add(vec3(0.32, 0.74, 0.78).mul(caustics).mul(0.32));

    // Fresnel: low base + strong rim (SwedishForestWater rf0~0.1, pow 6). The grazing angle
    // picks up a WARM golden sky reflection (not cool white) so the river catches the low sun.
    const viewDir = normalize(cameraPosition.sub(vPosition));
    const fresnel = pow(oneMinus(max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0)), 5.0);
    const skyReflect = mix(vec3(0.30, 0.62, 0.80), uSkyWarm, smoothstep(0.15, 0.8, fresnel));
    color = color.add(skyReflect.mul(fresnel).mul(0.40));

    // SUN-PATH sparkle column (SwedishForestWater): a warm bright band running down the
    // river center toward the sun, sharpened toward the far bank, with animated shimmer.
    const sunPathX = abs(vUv.x.sub(0.5)).mul(2.6);
    let sunPath = oneMinus(smoothstep(0.0, 0.55, sunPathX));
    sunPath = sunPath.mul(sunPath).mul(smoothstep(0.2, 0.95, vUv.y));
    const sparkle = sin(vPosition.z.mul(0.7).add(uTime.mul(1.6))).mul(0.5).add(0.5)
        .mul(sin(vPosition.x.mul(0.4).add(uTime.mul(1.1))).mul(0.5).add(0.5));
    sunPath = sunPath.mul(sparkle.mul(0.6).add(0.5));
    color = color.add(uSunPath.mul(sunPath).mul(0.55));

    // Edge fade — softer/longer so the river banks dissolve into the carved channel
    // instead of ending on a hard rectangular lip.
    const dist = length(vUv.sub(0.5)).mul(2.0);
    const alpha = oneMinus(smoothstep(0.62, 1.0, dist)).mul(0.94).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;

    // Long thin lake/river: long axis along -Z (after the flat rotate, geometry depth maps
    // to world Z), narrower across X. Bend is carried by the carved channel + the gentle
    // displacement, so the water reads winding INTO the frame at the forward angle.
    const geometry = new THREE.PlaneGeometry(90, 160, 48, 80);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    // Sit on the river axis, dropped into the carved valley channel (well below the old
    // sliver-line) and pushed down-corridor so its length runs into the frame.
    mesh.position.set(SURFACE_RIVER_CENTER_X, surfaceOffsetY - 4, -150);
    mesh.renderOrder = -3;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Landscape (CPU-baked tropical-island terrain; GPU shading only, no bloom)
// ═══════════════════════════════════════════════════════════════════════════════

// CPU heightfield bake — identical to surface-world.js createLandscape geometry walk.
function buildLandscapeGeometry() {
    const geometry = new THREE.PlaneGeometry(400, 400, 128, 128);
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

    const sandColor = vec3(0.92, 0.84, 0.56); // Warm beach sand (slightly richer)
    // VISUAL POLISH (de-wash): pull the grass into RICH saturated greens (swedish-forest /
    // sakura-twilight palette discipline) — a vivid lit spring green low, a deep forest green
    // high — so the hills read green rather than the old pale wash. A subtle blue-green
    // variation by ground noise breaks the plastic uniformity.
    const grassColorLow = vec3(0.26, 0.78, 0.16); // Vivid lit spring green
    const grassColorHigh = vec3(0.05, 0.42, 0.14); // Deep saturated forest green
    const grassColor = mix(grassColorLow, grassColorHigh, smoothstep(5.0, 30.0, relHeight));

    let color = mix(sandColor, grassColor, sandAmount);

    // Subtle ground noise to break up the plastic look + add green tonal variation.
    const groundNoise = fract(
        sin(dot(vPosition.xz.mul(0.1), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    color = mix(color, color.mul(vec3(0.86, 1.04, 0.82)), groundNoise.mul(0.22));

    // Golden-hour raking key (Batch B5): a LOW warm sun rakes the hills, a cool sky fill
    // lifts the shadows, a warm rim gilds slope edges, and a fake long-shadow gradient
    // bands the terrain along the sun azimuth so the relief reads at the forward angle.
    // De-wash: the cool fill is pulled DOWN + warmed toward neutral so it stops graying the
    // greens, and the overall exposure is lifted so the saturated base survives the shading
    // (peak channel still capped well below white).
    const lightDir = normalize(vec3(-0.62, 0.34, -0.71)); // low, warm, raking from the left
    const diff = max(dot(vNormal, lightDir), 0.0);
    // Warm direct key + softer, warmer fill (keeps midtones saturated, never grays the green).
    const warmKey = vec3(1.0, 0.86, 0.58).mul(diff.mul(0.5));
    const coolFill = vec3(0.66, 0.74, 0.82).mul(0.5);
    color = color.mul(warmKey.add(coolFill));
    // Warm rim/backlight on grazing slope edges (pow falloff, tinted amber, capped).
    const rimFactor = pow(oneMinus(max(dot(vNormal, normalize(cameraPosition.sub(vPosition))), 0.0)), 2.0);
    color = color.add(vec3(1.0, 0.82, 0.54).mul(rimFactor).mul(0.18));
    // Fake long-shadow banding: project worldXZ onto the sun azimuth and band it so the
    // raking light reads as long cast shadows across the valley (subtle, value-only).
    const sunAz = vec2(-0.62, -0.71);
    const shadowPhase = dot(vPosition.xz, sunAz).mul(0.045);
    const longShadow = sin(shadowPhase).mul(0.5).add(0.5);
    color = color.mul(longShadow.mul(0.12).add(0.88));

    // Distance fog (pushed back AND thinned so distant terrain keeps its color instead
    // of dissolving into white). Fog tint is a real SATURATED sky blue, not a pale wash, and
    // thinned further so the far green hills keep their hue (atmospheric, not milky).
    const dist = length(vPosition.xz);
    const fog = smoothstep(250.0, 420.0, dist);
    color = mix(color, vec3(0.24, 0.56, 0.92), fog.mul(0.38));

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
    material.opacityNode = uOpacity;
    material.transparent = true;
    material.depthWrite = false;
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
function buildFoothillBridgeGeometry() {
    const bridgeWidth = 920;
    const bridgeDepth = 680;
    const bridgeCenterZ = -500;
    const frontZ = -180;
    const backZ = -820;
    const geometry = new THREE.PlaneGeometry(bridgeWidth, bridgeDepth, 104, 112);
    geometry.rotateX(-Math.PI / 2);

    const clamp01 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const smoothstep01 = (edge0, edge1, v) => {
        const x = clamp01((v - edge0) / (edge1 - edge0), 0, 1);
        return x * x * (3 - 2 * x);
    };

    const positionAttribute = geometry.attributes.position;
    for (let i = 0; i < positionAttribute.count; i += 1) {
        const x = positionAttribute.getX(i);
        const worldZ = positionAttribute.getZ(i) + bridgeCenterZ;
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
        const height = base
            + centerLift
            + shoulderLift
            + ridgeLift
            + backRise
            - corridorCarve
            - frontFeather;

        positionAttribute.setY(i, height);
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
    const snowBlendRamp = smoothstep(0.45, 1.0, uSnowBlend);
    const depth = vWorldPosition.z.negate();
    const farFade = oneMinus(smoothstep(360.0, 780.0, depth.sub(terrainNoise.mul(80.0))));
    const seamFade = mix(float(1.0), farFade, snowBlendRamp);

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
        const lightness = 30 + Math.random() * 40;
        const color = `hsl(100, 50%, ${lightness}%)`;
        drawBlade(x, h, w, l, color);
    }
    return new THREE.CanvasTexture(canvas);
}

export function createFluffyGrassTSL(uTime = uniform(0), count = 1000) {
    const uColorBottom = uniform(new THREE.Color(0x2d5a27));
    const uColorTop = uniform(new THREE.Color(0xaaffaa));

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
        vec3(0.13, 0.46, 0.08), // shaded base green
        vec3(0.46, 0.86, 0.20), // vivid sunlit blade green
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

// A few low-poly trees: merged trunk (cylinder) + two stacked canopy cones. Denser + more
// varied than before, with richer greens, per-instance tint and a warm golden-hour rim.
export function createTreesTSL(uTime = uniform(0), count = 40) {
    const trunk = new THREE.CylinderGeometry(0.55, 0.9, 7, 6, 1);
    const canopyLow = new THREE.ConeGeometry(4.2, 6.5, 7, 1);
    const canopyHigh = new THREE.ConeGeometry(2.9, 5.5, 7, 1);
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 3.5, 0] },
        { geo: canopyLow, offset: [0, 9.5, 0] },
        { geo: canopyHigh, offset: [0, 13.0, 0] },
    ]);
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.26), 3));

    // VISUAL POLISH (de-wash): trunk brown below, RICH saturated foliage green above (lush,
    // not the old pale flat triangle), height-graded + per-instance tint. A warm rim gilds
    // the grazing canopy edge (golden-hour backlight) so the trees pop against the sky.
    const isTrunk = oneMinus(smoothstep(6.0, 7.2, positionLocal.y));
    const tint = attribute('aTint', 'vec3');
    const foliage = mix(
        vec3(0.05, 0.34, 0.11), // shaded inner foliage
        vec3(0.32, 0.72, 0.22), // vivid sunlit canopy
        smoothstep(7.0, 16.0, positionLocal.y),
    ).mul(tint);
    const bark = vec3(0.34, 0.22, 0.12);
    let colorNode = mix(foliage, bark, isTrunk);
    // Warm golden-hour rim on the grazing canopy edge (capped, foliage only, never white).
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);
    colorNode = colorNode.add(vec3(1.0, 0.80, 0.46).mul(rim).mul(0.20).mul(oneMinus(isTrunk)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.4); // gentle whole-tree sway
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 12) {
        guard += 1;
        const x = (Math.random() - 0.5) * 300;
        const z = (Math.random() - 0.5) * 300;
        const h = getTerrainHeight(x, z);
        // Trees only on solid higher ground, away from the immediate path center.
        if (h >= 6.0 && Math.abs(x) > 14) {
            const s = 0.8 + Math.random() * 1.0;
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
    return { mesh, material, geometry };
}

// Water-edge reeds: tall thin tapered cones clustered along the shoreline band.
export function createReedsTSL(uTime = uniform(0), count = 220) {
    const geometry = new THREE.ConeGeometry(0.28, 8.5, 4, 1, false);

    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(buildTintArray(count, 0.2), 3));
    const colorNode = mix(
        vec3(0.34, 0.48, 0.14), // richer olive base
        vec3(0.74, 0.82, 0.34), // warm dry tip
        smoothstep(0.0, 8.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 1.6); // reeds sway the most
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 16) {
        guard += 1;
        const x = (Math.random() - 0.5) * 260;
        const z = (Math.random() - 0.5) * 260;
        const h = getTerrainHeight(x, z);
        // Shoreline band: just above the water clamp, where land meets water.
        if (h >= 2.0 && h <= 7.0) {
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
    const geometry = mergeOffsetGeometries([
        { geo: trunk, offset: [0, 13, 0] },
        { geo: lobe(13, 18, 9), offset: [0, 30, 0] },
        { geo: lobe(11, 16, 9), offset: [4.5, 37, 2.0] },
        { geo: lobe(10.5, 15, 9), offset: [-4.0, 38, -1.5] },
        { geo: lobe(8.5, 14, 8), offset: [1.5, 44, -3.0] },
        { geo: lobe(6.5, 12, 8), offset: [-1.0, 50, 1.5] },
    ]);

    const isTrunk = oneMinus(smoothstep(24.0, 27.0, positionLocal.y));
    const foliage = mix(
        vec3(0.05, 0.30, 0.12), // shaded inner foliage
        vec3(0.30, 0.60, 0.20), // sunlit canopy
        smoothstep(28.0, 56.0, positionLocal.y),
    );
    const bark = vec3(0.30, 0.20, 0.12);
    let colorNode = mix(foliage, bark, isTrunk);
    // Warm golden-hour rim on the grazing canopy edge (capped, never white).
    const rim = pow(oneMinus(max(dot(normalView, normalize(cameraPosition.sub(positionWorld))), 0.0)), 2.0);
    colorNode = colorNode.add(vec3(1.0, 0.78, 0.42).mul(rim).mul(0.28).mul(oneMinus(isTrunk)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vegetationSwayNode(uTime, 0.22); // slow, heavy whole-tree sway
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;

    const mesh = new THREE.Mesh(geometry, material);
    const anchor = getSurfaceGreatTreeAnchor();
    // The shared vegetation offset (props groups sit at terrainOffsetY then -15 baked in);
    // place the tree relative to the same -15 base the prop instancers use.
    mesh.position.set(anchor.x, anchor.y - 15, anchor.z);
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// Falling-leaf billboards drifting off the Great Tree canopy (warm autumnal flecks).
export function createFallingLeavesTSL(uTime = uniform(0), count = 60) {
    const anchor = getSurfaceGreatTreeAnchor();
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = [
        new THREE.Color(0xe8b04a), // warm gold
        new THREE.Color(0xcf7a3a), // amber
        new THREE.Color(0x7fae3a), // green-gold
    ];
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = anchor.x + (Math.random() - 0.5) * 28;
        bases[i * 3 + 1] = anchor.y + 20 + Math.random() * 28;
        bases[i * 3 + 2] = anchor.z + (Math.random() - 0.5) * 24;
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
    });

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');

    // Slow falling drift wrapping over a ~40-unit band, with a gentle lateral flutter.
    const fall = fract(uTime.mul(0.03).mul(aRandom.add(0.5)).add(aRandom)).mul(40.0);
    const py = aBase.y.sub(fall);
    const px = aBase.x.add(sin(uTime.mul(0.7).add(aRandom.mul(11.0))).mul(3.5));
    const pz = aBase.z.add(cos(uTime.mul(0.5).add(aRandom.mul(7.0))).mul(2.5));
    const positionNode = billboardWorld(vec3(px, py, pz), aSize);

    const r = uv().sub(0.5).length().mul(2.0);
    const disc = oneMinus(smoothstep(0.55, 1.0, r));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    material.opacityNode = disc.mul(0.85);
    material.alphaTest = 0.2;
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
        vec3(0.09, 0.34, 0.18), // shaded
        vec3(0.24, 0.56, 0.30), // lit
        smoothstep(4.0, 11.0, positionLocal.y),
    ).mul(attribute('aTint', 'vec3'));

    const material = new THREE.MeshBasicNodeMaterial();
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
    // Warm-lit crest -> cool water body (caps below white).
    const ribbonColor = mix(vec3(0.62, 0.74, 0.80), vec3(0.78, 0.74, 0.62), smoothstep(0.6, 1.0, vUv.y));
    const ribbonAlpha = flow.mul(sideFeather).mul(topFade).mul(bottomFade)
        .mul(0.5)
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
    tiers.forEach((tier) => {
        const mesh = new THREE.Mesh(ribbonGeo, ribbonMat);
        mesh.position.set(tier.x, tier.y, tier.z);
        group.add(mesh);
    });

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
export function createPollenTSL(uTime = uniform(0), count = 260) {
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

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(1.0, 0.80, 0.42); // warm amber pollen
    material.opacityNode = feather.mul(0.55).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

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

    // Swept-wing bird geometry (mirrors swedish-forest createBirdBaseGeometry, scaled up for
    // the Surface chapter's world units). Body forward is +Z; the update faces it to heading.
    const wingGeo = new THREE.BufferGeometry();
    const s = 1.8; // overall bird scale
    const verts = new Float32Array([
        // Body triangle (tail -> beak -> shoulder).
        0.00, -0.05, -1.30, 0.00, 0.02, 1.50, -0.22, 0.10, 0.14,
        // Left wing (swept silhouette: root -> tip -> trailing edge).
        -0.14, 0.06, 0.18, -2.30, 0.40, -0.10, -0.42, -0.05, -0.42,
        // Right wing (mirrored).
        0.14, 0.06, 0.18, 0.42, -0.05, -0.42, 2.30, 0.40, -0.10,
    ]);
    for (let i = 0; i < verts.length; i += 1) verts[i] *= s;
    wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    wingGeo.computeVertexNormals();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec3(0.12, 0.13, 0.16); // dark warm-grey silhouette
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
export function createSunDiscTSL(uTime = uniform(0)) {
    const uOpacity = uniform(1);
    const uCore = uniform(new THREE.Color(0xffeec0)); // warm soft core (not pure white)
    const uCorona = uniform(new THREE.Color(0xffc66a)); // golden corona
    const uHalo = uniform(new THREE.Color(0xff9e44)); // amber outer halo

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
    const alpha = oneMinus(smoothstep(0.06, 0.5, dist)).mul(0.9).mul(uOpacity);

    // A single camera-facing billboard quad far down-corridor along the sky's sun direction,
    // so the disc always reads as a round distant sun regardless of camera yaw. Far + large
    // so perspective renders it as a distant sun low toward the horizon.
    const sunDir = new THREE.Vector3(0.40, 0.16, -0.90).normalize();
    const center = vec3(sunDir.x * 900, sunDir.y * 900, sunDir.z * 900);
    const positionNode = billboardWorld(center, float(150.0));

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

export function createSunRaysTSL(uTime = uniform(0)) {
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
        // the god-rays accent the warm sky rather than veiling it white.
        .mul(0.26)
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
    for (let i = 0; i < 7; i += 1) {
        const mesh = new THREE.Mesh(geometry, material);
        // Bias the fan to the left (sun-side) with a tight spread around it.
        mesh.position.x = -40 + (Math.random() - 0.5) * 70;
        mesh.position.y = 20;
        mesh.position.z = -30 - Math.random() * 50;
        mesh.rotation.z = 0.18 + (Math.random() - 0.5) * 0.4; // lean toward the sun
        group.add(mesh);
    }
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

    const alpha = density.mul(0.30).mul(uOpacity);

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
    const cloudCount = 12;
    for (let i = 0; i < cloudCount; i += 1) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = (Math.random() - 0.5) * 200;
        // Layer the banks from a low ~14 up the dome for a real strata read.
        mesh.position.y = 14 + (i * 4.5) + Math.random() * 5;
        mesh.position.z = -60 - Math.random() * 160; // widened z spread (-60..-220)
        mesh.scale.set(1.0 + Math.random() * 0.7, 0.8 + Math.random() * 0.5, 1.0);
        group.add(mesh);
    }
    // 3 large soft horizon cumulus far back + low, wide — the warm golden-hour backdrop.
    for (let i = 0; i < 3; i += 1) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = (i - 1) * 130 + (Math.random() - 0.5) * 50;
        mesh.position.y = 22 + Math.random() * 10;
        mesh.position.z = -240 - Math.random() * 90;
        mesh.scale.set(2.6 + Math.random() * 1.1, 1.4 + Math.random() * 0.6, 1.0);
        group.add(mesh);
    }
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
    return {
        mesh, material, geometry, uniforms: { uSnowBlend, uOpacity },
    };
}

/**
 * Three distant peaks on the horizon + a base mist — mirrors createDistantMountains.
 */
export function createDistantMountainsTSL(uTime = uniform(0)) {
    const group = new THREE.Group();
    group.name = 'distant-mountains-tsl';
    const parts = [];

    const left = createDistantMountainTSL({
        size: 800,
        height: 300,
        position: new THREE.Vector3(-250, -10, -650),
        seed: 12.34,
    });
    const center = createDistantMountainTSL({
        size: 1200,
        height: 500,
        position: new THREE.Vector3(0, -30, -900),
        seed: 89.12,
    });
    const right = createDistantMountainTSL({
        size: 800,
        height: 280,
        position: new THREE.Vector3(250, -20, -700),
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
    let alpha = smoothstep(0.62, 0.08, dist);
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

    positions.forEach((pos) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.rotation.x = -0.08;
        mesh.rotation.y = pos.rotY;
        mesh.scale.setScalar(pos.scale);
        mesh.renderOrder = -1;
        group.add(mesh);
    });

    return {
        group, material, geometry, uniforms: { uOpacity },
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

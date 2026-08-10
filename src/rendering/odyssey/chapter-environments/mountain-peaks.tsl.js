/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Mountain Peaks (Chapter 4) — TSL/WebGPU pilot conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — board off WebGLRenderer). See
 * docs/ODYSSEY_AAA_MASTER_PLAN.md §3. Faithful TSL ports of mountain-peaks.js's three
 * GLSL ShaderMaterials — the graded sky-sphere backstop, the FBM-displaced snow peaks
 * (vertex-displaced via a CPU-baked heightfield + analytic snow/rock/fog shading), and
 * the radial snow-floor apron — rebuilt as NodeMaterials so they run on the
 * WebGPURenderer and its WebGL2 fallback.
 *
 * The peak silhouette is baked into the PlaneGeometry on the CPU exactly as the GLSL
 * version did (same cone falloff + value-noise FBM detail + `computeVertexNormals`), so
 * the mesh shape is byte-for-byte identical; the per-pixel snow/rock/fog/rim lighting is
 * the part that moves to the GPU as a TSL `colorNode`/`opacityNode`. The geometry's baked
 * `vNormal`/`vWorldPosition`/`aHeight` map to TSL `normalView` / `positionWorld` /
 * `attribute('aHeight','float')`.
 *
 * The chapter's private inline value-noise (`hash`/`noise`/`fbm`) maps to a `snoise3`
 * (built-in MaterialX gradient noise) FBM remapped to ~[0,1], matching octave count and
 * frequencies. Stars and falling snow are THREE.Points (canvas-texture particles) and the
 * ambient/moon lights stay unchanged — they render on WebGPURenderer as-is.
 *
 * Sky-dome, peaks and floor are atmosphere/terrain backstops — NONE are tagged
 * `userData.emitsBloom` (no additive glows in this chapter).
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    normalView,
    oneMinus,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { snoise3 } from './shared/odyssey-tsl-noise.js';
import {
    billboardWorld,
    makeQuadInstancedGeometry,
} from './shared/odyssey-tsl-billboard.js';
import {
    MOUNTAIN_SHADING,
    mountainColorNode,
    mountainCpuDisplacement,
    resolveMountainTreatment,
} from './shared/mountain-language.js';

// ── Canonical mountain treatments (ONE language; see shared/mountain-language.js) ──
// Heroes ride the cool pole (saturated cool blue); the lower foothill apron pulls the
// temperature back toward neutral grey-blue and raises its snow line. Both come from the
// single resolver so Surface's distant range and these peaks read as the same mountains.
const MAIN_PEAK_TREATMENT = resolveMountainTreatment({ coolTemp: 1.0 });
const FOOTHILL_APRON_TREATMENT = resolveMountainTreatment({
    coolTemp: 0.72,
    snowLine: MOUNTAIN_SHADING.snowLineFoothill,
});

// On-screen sun / alpenglow direction for the Mountains chapter. The shader keyDir is
// aligned to this so lit faces face the sun and the alpenglow fires where the disc is.
// (Matches the plan's profile lightDir (0.7,0.25,0.4); B7 owns the profile entry itself.)
export const MOUNTAIN_LIGHT_DIR = Object.freeze([0.7, 0.25, 0.4]);
// Real alpenglow (plan ch4 §Lighting): stronger + lower than Surface's shared defaults.
const ALPEN_STRENGTH = 0.6; // 0.42 → 0.6
const ALPEN_HEIGHT_LO = 0.48; // 0.55 → 0.48

// Base-mist + base-fade are per-instance (hero vs. foothill) so the feet of each peak
// recede correctly; these are not part of the colour language.
const MAIN_PEAK_BASE = Object.freeze({
    baseMistStrength: 0.32, baseFadeStart: 0.02, baseFadeEnd: 0.1,
});
const FOOTHILL_APRON_BASE = Object.freeze({
    baseMistStrength: 0.18, baseFadeStart: 0.08, baseFadeEnd: 0.22,
});

// ── Value-noise FBM in ~[0,1] (TSL twin of the chapter's private inline `fbm`) ────
// The GLSL `fbm` is 4 octaves of smooth value noise (×2 per octave, amplitude ×0.5),
// returning ~[0,1]. snoise3 is ~[-1,1]; remap to ~[0,1] to keep the snow-pattern look.

function fbmValue2(p, octaves = 4) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = vec2(p);
    for (let i = 0; i < octaves; i += 1) {
        const n = snoise3(vec3(coord.x, coord.y, 0.0)).mul(0.5).add(0.5);
        value = value.add(n.mul(amplitude));
        coord = coord.mul(2.0);
        amplitude = amplitude.mul(0.5);
    }
    return value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPU heightfield bake (identical to mountain-peaks.js createFBMMountain)
// ═══════════════════════════════════════════════════════════════════════════════

export function buildMountainGeometry(config) {
    // LOD (perf §3b): the displaced peak silhouette barely changes between 128 and 64
    // segments (the FBM cone falloff is low-frequency at this on-screen size), but 64×64
    // sheds ~75% of the verts per peak — ~116k → ~28k across the 7 hero+ridge planes.
    // computeVertexNormals + the baked aHeight stay identical in form.
    const segments = 64;
    const geometry = new THREE.PlaneGeometry(config.size, config.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const posAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    const heights = [];
    const seed = config.seed || 0;

    // ONE displacement language (shared/mountain-language.js): cone falloff + FBM detail,
    // identical to the Surface distant range so a peak here is the same mountain shape.
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

// ═══════════════════════════════════════════════════════════════════════════════
// Graded sky-sphere backstop (-100; must NOT bloom)
// ═══════════════════════════════════════════════════════════════════════════════

export function createMountainSkyTSL(uTransition) {
    // BANDED STRATOSPHERIC SKY (plan ch4 §Atmosphere): a 4-band vertical ramp on
    // h = normalize(worldPos).y replaces the flat 2-stop wash that read as one pale
    // blue-grey in every frame. Warm gilt horizon → silver-cyan → alpine cyan → deep
    // indigo zenith, smoothstep-crossfaded, plus an aerosol-thinning term that darkens
    // the upper bands toward near-space so the dome has real altitude orientation.
    // De-washed alpine sky (the user's "less washed" note): the horizon keeps its warm gilt,
    // but the silver band is pulled a touch deeper/cleaner and the alpine + zenith bands go
    // markedly richer + darker so the dome reads as a high, clear stratospheric blue with real
    // top-to-bottom contrast — not the flat pale blue-grey wash the captures showed.
    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave B): Ch4 rebright from moonlit-dusk to the shared
    // BRIGHT DAYLIGHT anchor so it climbs under the SAME vivid blue sky as Ch3 (deep azure zenith →
    // light cyan horizon). Was warm-gilt horizon over an indigo near-space zenith (a dusk dome).
    const uGilt = uniform(new THREE.Color(0xbfe4f2)); // light cyan-blue horizon (was warm gilt) — matches Ch3
    const uSilver = uniform(new THREE.Color(0x8fc0e8)); // light azure (0.05–0.3)
    const uAlpine = uniform(new THREE.Color(0x3f8fe0)); // clear azure (0.3–0.6) — matches Ch3 mid
    const uZenith = uniform(new THREE.Color(0x2360c8)); // vivid daylight azure zenith — matches Ch3
    // Night targets (driven by uTransition) — the whole dome falls to near-black so the
    // 4→5 exit and the chapter's night lerp still read.
    const uGiltNight = uniform(new THREE.Color(0x0a0a14));
    const uSilverNight = uniform(new THREE.Color(0x070710));
    const uAlpineNight = uniform(new THREE.Color(0x05060e));
    const uZenithNight = uniform(new THREE.Color(0x000000));
    const uOffset = uniform(33);
    const uTrans = uTransition ?? uniform(0);

    // h = normalize(worldPos + offset).y  → on a sphere, local dir matches the gradient.
    const h = normalize(positionWorld.add(uOffset)).y;
    const hClamped = max(h, 0.0);

    const gilt = mix(uGilt, uGiltNight, uTrans);
    const silver = mix(uSilver, uSilverNight, uTrans);
    const alpine = mix(uAlpine, uAlpineNight, uTrans);
    const zenith = mix(uZenith, uZenithNight, uTrans);

    // Four bands crossfaded: gilt→silver across 0.0–0.12, silver→alpine across 0.12–0.34,
    // alpine→zenith across 0.34–0.72 (overlapping smoothsteps keep it continuous).
    let color = mix(gilt, silver, smoothstep(0.0, 0.12, hClamped));
    color = mix(color, alpine, smoothstep(0.12, 0.34, hClamped));
    color = mix(color, zenith, smoothstep(0.34, 0.72, hClamped));

    // Aerosol-thinning cut right back (0.12 → 0.02): at 0.12 it dragged the upper dome toward
    // space-dark (part of the old dusk read). A bright daylight sky keeps a luminous blue zenith.
    const aerosol = oneMinus(pow(hClamped, 0.6)).mul(0.02);
    color = color.sub(aerosol).max(0.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;
    // CRITICAL (Wave B): un-fog the sky dome — same bug Ch3 had. This is a radius-6000 BackSide dome,
    // so the scene FogExp2 fogged it to ~100% and replaced the whole gradient with the flat fog
    // colour. A backdrop-at-infinity must never be fogged; fog=false lets the azure gradient read.
    material.fog = false;

    const geometry = new THREE.SphereGeometry(6000, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return {
        mesh, material, geometry, uniforms: { uTransition: uTrans },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cloud-SEA deck (new): a vast horizontal billow just below the lane — the sea the
// camera breaks UP through. depthWrite:false, renderOrder between sky (-100) and peaks.
// ═══════════════════════════════════════════════════════════════════════════════

export function createCloudSeaDeckTSL({
    uTime,
    radius = 2600,
    y = -55,
    uTransition,
    // 3→4 ENTRY hook: drives the whole deck UP from below the frame so the camera rises
    // THROUGH the cloud ceiling. 1 = full deck, 0 = sunk/faded (handoff to B7 corridor ramp).
    uReveal,
} = {}) {
    const time = uTime ?? uniform(0);
    const uTrans = uTransition ?? uniform(0);
    const reveal = uReveal ?? uniform(1);
    const uTopWarm = uniform(new THREE.Color(0xf2e3cf)); // white-gold sunlit billow tops
    const uTrough = uniform(new THREE.Color(0x9fb3cc)); // cool shaded troughs
    const uFogEdge = uniform(new THREE.Color(0xb9cee2)); // distance fog-edge (matches silver band)
    const uLightDir = uniform(new THREE.Vector3(0.7, 0.25, 0.4).normalize());
    const uOpacity = uniform(0.92); // capped < 1.0 (no white blowout, soft additive-free top)

    // 3-octave value-FBM billow scrolling slowly over world XZ (NO per-frame alloc).
    const flow = positionWorld.xz.mul(0.012).add(time.mul(0.01));
    const billow = fbmValue2(flow, 3);

    // Upward-normal + sun term lights the billow tops warm; troughs stay cool.
    const n = normalize(normalView);
    const up = clamp(dot(n, uLightDir).mul(0.5).add(0.5), 0.0, 1.0);
    const litTop = clamp(billow.mul(0.8).add(up.mul(0.4)), 0.0, 1.0);
    let color = mix(uTrough, uTopWarm, litTop);

    // Soft distance fog-edge fade toward the silver horizon band. This is a COLOUR haze
    // (camera-relative is fine — it just tints the far billows) and does NOT create an edge.
    const dist = length(positionWorld.xz.sub(cameraPosition.xz));
    const edge = smoothstep(radius * 0.45, radius * 0.95, dist);
    color = mix(color, uFogEdge, edge);
    // Cool the whole deck toward night with the chapter transition.
    color = mix(color, uTrough.mul(0.35), uTrans.mul(0.7));

    // Alpha rim: feather to 0 relative to the disc CENTRE (positionLocal.xz — the geometry is
    // centred + rotated flat), NOT the camera. Keying the rim to camera distance let the disc's
    // finite geometry edge show as a HARD STRAIGHT LINE whenever the camera sat inside ~radius
    // of the rim (the 3→4 "square/hard bottom" the review flagged). Centre-relative always
    // completes the fade INSIDE the geometry rim regardless of where the camera is.
    const rimDist = length(positionLocal.xz);
    const bodyAlpha = oneMinus(smoothstep(radius * 0.8, radius * 0.985, rimDist));
    const alpha = bodyAlpha.mul(uOpacity).mul(reveal);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.depthWrite = false;

    // LOD (perf §3b): the cloud-sea is a flat radial disc shaded entirely in the fragment
    // stage (billow FBM + fog edge), so its silhouette is a circle — 48 segments are
    // visually indistinguishable from 128 here while cutting the disc's vert/triangle cost.
    const geometry = new THREE.CircleGeometry(radius, 48);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, y, -400);
    mesh.renderOrder = -50; // between sky (-100) and peaks (default 0)
    mesh.frustumCulled = false;

    return {
        mesh,
        material,
        geometry,
        uniforms: {
            uTime: time, uTransition: uTrans, uReveal: reveal, uOpacity,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FBM-displaced snow peak (CPU-baked silhouette + GPU snow/rock/fog shading)
// ═══════════════════════════════════════════════════════════════════════════════

export function createFBMMountainTSL(config = {}) {
    const {
        size = 800,
        height = 300,
        seed = 0,
        position = new THREE.Vector3(0, 0, 0),
        // `treatment` is the canonical resolveMountainTreatment() result; `base` carries the
        // per-instance base-mist/base-fade. Defaults are the hero peak.
        treatment = MAIN_PEAK_TREATMENT,
        base = MAIN_PEAK_BASE,
        transition,
        // uSummitGlow (0..1, shared across the hero peaks) PEAKS at chapter end to ignite
        // the highest snow rose-gold — the graded climax that replaces the white bloom halo.
        summitGlow,
        // Whether this instance fires the on-screen sun alpenglow + summit ignite (hero
        // peaks). Foothills/aprons stay cool so the read isn't muddied.
        isHero = true,
        // CONSOLIDATION (remake plan #4): a pre-built material to REUSE across peaks that share
        // treatment/base/isHero — their node graph is byte-identical, and the per-peak silhouette
        // comes entirely from geometry (aHeight) + world position, so one compiled pipeline serves
        // them all. When null (every existing caller), the material + uniforms are built below,
        // exactly as before. Backward-compatible.
        material: providedMaterial = null,
    } = config;

    const geometry = buildMountainGeometry({ size, height, seed });

    // Fast path: reuse the shared material (only build this peak's geometry + mesh). Its live
    // uniforms are stashed on userData so the caller still gets them for its opacity/snow-blend
    // collectors.
    if (providedMaterial) {
        const sharedUniforms = providedMaterial.userData?.odysseyMountainUniforms ?? null;
        const sharedMesh = new THREE.Mesh(geometry, providedMaterial);
        sharedMesh.position.copy(position);
        if (isHero) sharedMesh.userData.emitsBloom = true;
        return {
            mesh: sharedMesh, material: providedMaterial, geometry, uniforms: sharedUniforms,
        };
    }

    // One canonical palette (snow / shadowed-snow / rock / shadow / fog / alpenglow / rim) —
    // driven by the instance's coolTemp via the shared resolver. The ice-blue shadowed-snow
    // uniform gives the caps their three-zone alpine modelling (sunlit / shadowed / rock).
    const uSnow = uniform(new THREE.Color(treatment.snow));
    const uSnowShadow = uniform(new THREE.Color(treatment.snowShadow));
    const uRock = uniform(new THREE.Color(treatment.rock));
    const uShadow = uniform(new THREE.Color(treatment.shadow));
    const uFog = uniform(new THREE.Color(treatment.fog));
    const uAlpen = uniform(new THREE.Color(treatment.alpenglow));
    const uRim = uniform(new THREE.Color(treatment.rim));
    const uSnowLine = uniform(treatment.snowLine);
    const uSnowBlend = uniform(0);
    const uBaseMistStrength = uniform(base.baseMistStrength);
    const uBaseFadeStart = uniform(base.baseFadeStart);
    const uBaseFadeEnd = uniform(base.baseFadeEnd);
    const uTransition = transition ?? uniform(0);
    const uOpacity = uniform(1);
    const uSummitGlow = summitGlow ?? uniform(0);
    // Rose-gold the summit ignites toward at climax (warm, but capped so it blooms soft).
    const uSummit = uniform(new THREE.Color(0xffc59a));

    // Stage values: vNormal → normalView, vWorldPosition → positionWorld, vHeight → aHeight.
    const vNormal = normalView;
    const vWorldPosition = positionWorld;
    const vHeight = attribute('aHeight', 'float');

    // CRISP SNOW MICRO-DETAIL (plan ch4 §Theme; adapted from himalayan-peak's patchy snow):
    // a low-freq patch term breaks up the snow line so it reads as drifted alpine snow, and a
    // tighter high-freq sample makes a granular sparkle. Soft-capped so it never clips white.
    const snowNoise = fbmValue2(vWorldPosition.xz.mul(0.05));
    // Tighter sparkle threshold = sparse, crisp glints (snow micro-facets) rather than a
    // broad frosted wash.
    const sparkleFbm = fbmValue2(vWorldPosition.xz.mul(0.26), 3);
    const sparkle = smoothstep(0.7, 0.95, sparkleFbm);
    // Wind streaks: a directional sine ridge along the slope — static (peaks are statics) so
    // it reads as wind-scoured snow texture combed across the cap.
    const windStreak = sin(vWorldPosition.x.mul(0.22).add(vWorldPosition.z.mul(0.06)))
        .mul(0.5).add(0.5);
    const snowSparkle = isHero ? sparkle.mul(0.78).add(windStreak.mul(0.22)) : null;

    // ONE shading treatment (shared/mountain-language.js): snow-line + alpenglow + rim +
    // atmospheric fog. Hero peaks align keyDir to the on-screen sun + fire the stronger,
    // lower real alpenglow; foothills keep the Surface-shared defaults (cool read).
    let color = mountainColorNode({
        uSnow,
        uSnowShadow,
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
        snowNoise,
        // uTransition drives the chapter to night — fade the warm alpenglow as it does.
        alpenScale: oneMinus(uTransition),
        ...(isHero ? {
            keyDir: MOUNTAIN_LIGHT_DIR,
            alpenStrength: ALPEN_STRENGTH,
            alpenHeightLo: ALPEN_HEIGHT_LO,
            snowSparkle,
        } : {}),
    });

    // SUMMIT-GLOW CLIMAX (plan ch4 §Cinematic): as uSummitGlow → 1 near chapter end, the
    // highest snow on the hero peaks ignites rose-gold and the peak crests INTO the light.
    // Lit by ndl toward the sun so only the sun-facing crown blazes; capped + soft-feathered
    // so it blooms controlled (NOT the old white node halo) and rolls off via ACES.
    if (isHero) {
        const heroN = normalize(vNormal);
        const [hx, hy, hz] = MOUNTAIN_LIGHT_DIR;
        const sunNdl = max(0.0, dot(heroN, normalize(vec3(hx, hy, hz))));
        const crown = smoothstep(0.7, 0.97, vHeight);
        const ignite = crown.mul(pow(sunNdl, 1.4)).mul(uSummitGlow)
            .mul(oneMinus(uTransition));
        // Clamp the added energy well below clip; bloom threshold gilds the crown.
        color = color.add(uSummit.mul(min(ignite.mul(0.75), 0.7)));
    }

    // Base mist at the very feet of each peak (per-instance; not part of the colour language).
    const dist = length(vWorldPosition.sub(cameraPosition));
    const fogFactor = smoothstep(MOUNTAIN_SHADING.fogNear, MOUNTAIN_SHADING.fogFar, dist)
        .mul(MOUNTAIN_SHADING.fogMax);
    const baseMist = smoothstep(0.15, 0.0, vHeight).mul(uBaseMistStrength);
    color = mix(color, uFog, max(baseMist.sub(fogFactor), 0.0));

    // Base fade — hide the hard plane edge at low heights.
    const baseFade = smoothstep(uBaseFadeStart, uBaseFadeEnd, vHeight);
    const mountainUv = uv();
    const uvEdgeNoise = fbmValue2(vWorldPosition.xz.mul(0.013), 3).sub(0.5).mul(0.035);
    const noisyUvX = mountainUv.x.add(uvEdgeNoise);
    const noisyUvY = mountainUv.y.add(uvEdgeNoise.mul(0.55));
    const sideFade = smoothstep(0.0, 0.16, noisyUvX)
        .mul(oneMinus(smoothstep(0.84, 1.0, noisyUvX)))
        .mul(smoothstep(0.0, 0.1, noisyUvY))
        .mul(oneMinus(smoothstep(0.9, 1.0, noisyUvY)));
    const alpha = uOpacity.mul(baseFade).mul(sideFade);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    // Stash the live uniforms so a shared-material reuse (remake plan #4, providedMaterial path
    // above) can hand the same uniform set back to the caller's collectors.
    const uniforms = {
        uTransition, uOpacity, uSnowBlend, uSummitGlow,
    };
    material.userData.odysseyMountainUniforms = uniforms;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (isHero) mesh.userData.emitsBloom = true; // summit ignite gilds via threshold bloom
    return {
        mesh, material, geometry, uniforms,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Radial snow-floor apron (FrontSide; must NOT bloom)
// ═══════════════════════════════════════════════════════════════════════════════

function buildSnowFloorGeometry() {
    const radius = 3000;
    // LOD (perf §3b): the floor's low-amplitude sine displacement (±~11 units over a
    // 3000-radius disc) reads the same at 48 radial segments as at 128; cut the apron's
    // vert count. computeVertexNormals still runs on the coarser grid.
    const segments = 48;
    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.rotateX(-Math.PI / 2);

    const positionAttr = geometry.attributes.position;
    const noise = (x, z, scale) => Math.sin(x * scale) * Math.cos(z * scale * 0.8) * 0.5
        + Math.sin(x * scale * 2.3) * Math.cos(z * scale * 1.7) * 0.25;

    for (let i = 0; i < positionAttr.count; i += 1) {
        const x = positionAttr.getX(i);
        const z = positionAttr.getZ(i);
        const height = noise(x, z, 0.01) * 8 + noise(x, z, 0.025) * 3;
        positionAttr.setY(i, height);
    }
    geometry.computeVertexNormals();
    return geometry;
}

export function createSnowFloorTSL(uTime, offsetY = -123.75) {
    // Brighter lit snow vs. a deeper cool shadow widens the floor's contrast so it reads
    // as crisp snow rather than a flat grey sheet.
    const uSnowColor = uniform(new THREE.Color(0xe6edf3));
    const uShadowColor = uniform(new THREE.Color(0x5f7184));
    const uLightDir = uniform(new THREE.Vector3(0.3, 0.8, 0.5).normalize());
    const uOpacity = uniform(1);
    const time = uTime ?? uniform(0);

    // vPosition = local position (model space) in the GLSL twin.
    const vPosition = positionLocal;
    const vNormal = normalView;

    // Soft lighting with ambient lift.
    const NdotL = dot(vNormal, uLightDir);
    const lightTerm = NdotL.mul(0.4).add(0.6);

    let color = mix(uShadowColor, uSnowColor, lightTerm);

    // Distance fade toward sky/atmosphere color.
    const dist = length(vPosition.xz);
    const distFactor = oneMinus(smoothstep(600.0, 1400.0, dist).mul(0.3));
    color = color.mul(distFactor);

    const atmColor = vec3(0.07, 0.11, 0.18);
    color = mix(color, atmColor, smoothstep(1000.0, 1800.0, dist));

    // Sparkle from scrolling value noise (snoise3 → [0,1]).
    const sparkleSample = vPosition.xz.mul(0.2).add(time.mul(0.02));
    const sparkleNoise = snoise3(vec3(sparkleSample.x, sparkleSample.y, 0.0)).mul(0.5).add(0.5);
    const sparkle = smoothstep(0.9, 1.0, sparkleNoise);
    color = color.add(sparkle.mul(0.1));

    // Organic radial edge fade.
    const distFromCenter = length(vPosition.xz);
    const edgeSample = vPosition.xz.mul(0.005);
    const edgeNoise = snoise3(vec3(edgeSample.x, edgeSample.y, 0.0)).mul(0.5).add(0.5)
        .mul(400.0);
    const adjustedDist = distFromCenter.add(edgeNoise);
    const alpha = oneMinus(smoothstep(2000.0, 2800.0, adjustedDist)).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.side = THREE.FrontSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.transparent = true;

    const geometry = buildSnowFloorGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, offsetY, -900);
    mesh.renderOrder = -1;

    const group = new THREE.Group();
    group.name = 'snow-floor-tsl';
    group.add(mesh);

    return {
        group, mesh, material, geometry, uniforms: { uTime: time },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Foothill apron — three low FBM mountains using the apron material profile.
// ═══════════════════════════════════════════════════════════════════════════════

export function createFoothillApronTSL(uTransition, baseY = 0) {
    const group = new THREE.Group();
    group.name = 'foothill-apron-tsl';
    const parts = [];

    [
        {
            size: 1100, height: 72, position: new THREE.Vector3(-330, baseY - 12, -600), seed: 21.17,
        },
        {
            size: 1250, height: 92, position: new THREE.Vector3(30, baseY - 20, -860), seed: 33.71,
        },
        {
            size: 1100, height: 78, position: new THREE.Vector3(330, baseY - 10, -710), seed: 58.42,
        },
    ].forEach((cfg) => {
        const part = createFBMMountainTSL({
            ...cfg,
            treatment: FOOTHILL_APRON_TREATMENT,
            base: FOOTHILL_APRON_BASE,
            transition: uTransition,
            isHero: false,
        });
        part.mesh.renderOrder = -2;
        group.add(part.mesh);
        parts.push(part);
    });

    return { group, parts };
}

// ═══════════════════════════════════════════════════════════════════════════════
// On-screen SUN disc + bloom-halo + a thin warm volumetric ray fan (additive, capped).
// Replaces the white climax blowout: a controlled-bloom sun low on the gilt band along
// lightDir; the ray fan widens as uSummitGlow peaks so the summit crests INTO the light.
// ═══════════════════════════════════════════════════════════════════════════════

export function createMountainSunTSL({
    uTransition,
    summitGlow,
    // World placement: low on the gilt horizon band, biased toward lightDir, off dead-centre.
    distance = 2400,
    discSize = 360,
    rayCount = 5,
} = {}) {
    const uTrans = uTransition ?? uniform(0);
    const uSummitGlow = summitGlow ?? uniform(0);
    const group = new THREE.Group();
    group.name = 'mountain-sun-tsl';

    // Place the sun far down lightDir, low on the gilt band (slightly above horizon).
    const [lx, ly, lz] = MOUNTAIN_LIGHT_DIR;
    const dir = new THREE.Vector3(lx, ly, lz).normalize();
    const center = new THREE.Vector3(dir.x, Math.max(dir.y, 0.12), dir.z)
        .normalize().multiplyScalar(distance);
    center.y = Math.max(center.y, 140); // keep it low but above the cloud-sea/peak feet

    // Core disc + soft bloom halo as ONE billboard quad (radial falloff; capped < 1.0).
    const discGeo = makeQuadInstancedGeometry(1, {
        aBase: { array: new Float32Array([center.x, center.y, center.z]), itemSize: 3 },
    });
    const discMat = new THREE.MeshBasicNodeMaterial();
    discMat.positionNode = billboardWorld(attribute('aBase', 'vec3'), float(discSize));
    const d = length(uv().sub(0.5)).mul(2.0);
    const core = oneMinus(smoothstep(0.0, 0.16, d)); // tight bright core
    const halo = pow(oneMinus(clamp(d, 0.0, 1.0)), 2.4).mul(0.55); // wide soft bloom-halo
    const uCore = uniform(new THREE.Color(0xffe3b0));
    const uHalo = uniform(new THREE.Color(0xffb27a));
    discMat.colorNode = mix(uHalo, uCore, core);
    // Feather alpha to 0 before the quad edge; cap so ACES rolls it off, never clips white.
    discMat.opacityNode = clamp(core.mul(0.85).add(halo), 0.0, 0.9)
        .mul(oneMinus(uTrans));
    discMat.transparent = true;
    discMat.depthWrite = false;
    discMat.depthTest = false;
    discMat.side = THREE.DoubleSide;
    discMat.blending = THREE.AdditiveBlending;
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.name = 'mountain-sun-disc';
    disc.frustumCulled = false;
    disc.renderOrder = -40;
    disc.userData.emitsBloom = true;
    group.add(disc);

    // Thin warm volumetric ray fan radiating from the sun — widens/brightens with summit
    // glow so the climax reads as light tearing past the summit (not a white halo).
    const rayBases = new Float32Array(rayCount * 3);
    const rayAngle = new Float32Array(rayCount);
    for (let i = 0; i < rayCount; i += 1) {
        rayBases[i * 3] = center.x;
        rayBases[i * 3 + 1] = center.y;
        rayBases[i * 3 + 2] = center.z;
        // Fan biased downward/outward from the sun (toward the summit below it).
        rayAngle[i] = (-0.6 + (i / Math.max(rayCount - 1, 1)) * 1.2);
    }
    const rayGeo = makeQuadInstancedGeometry(rayCount, {
        aBase: { array: rayBases, itemSize: 3 },
        aAngle: { array: rayAngle, itemSize: 1 },
    });
    const rayMat = new THREE.MeshBasicNodeMaterial();
    // Long thin billboards (tall, narrow) rotated by aAngle around the view axis.
    const ang = attribute('aAngle', 'float');
    const corner = positionLocal.xy;
    // Per-ray rotation in quad space, then stretch into a thin shaft.
    const ca = cos(ang);
    const sa = sin(ang);
    const rx = corner.x.mul(ca).sub(corner.y.mul(sa)).mul(60.0);
    const ry = corner.x.mul(sa).add(corner.y.mul(ca)).mul(900.0);
    const toCam = normalize(cameraPosition.sub(attribute('aBase', 'vec3')));
    const rright = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const rup = cross(toCam, rright);
    rayMat.positionNode = attribute('aBase', 'vec3')
        .add(rright.mul(rx)).add(rup.mul(ry));
    const ruv = uv();
    const acrossRay = abs(ruv.x.sub(0.5)).mul(2.0);
    const alongRay = ruv.y; // 0 at sun, 1 at far tip
    const rayShape = oneMinus(smoothstep(0.0, 0.5, acrossRay)) // thin across
        .mul(oneMinus(smoothstep(0.0, 1.0, alongRay))); // fade with length
    rayMat.colorNode = vec3(1.0, 0.84, 0.6);
    rayMat.opacityNode = clamp(rayShape.mul(uSummitGlow).mul(0.4), 0.0, 0.5)
        .mul(oneMinus(uTrans));
    rayMat.transparent = true;
    rayMat.depthWrite = false;
    rayMat.depthTest = false;
    rayMat.side = THREE.DoubleSide;
    rayMat.blending = THREE.AdditiveBlending;
    const rays = new THREE.Mesh(rayGeo, rayMat);
    rays.name = 'mountain-sun-rays';
    rays.frustumCulled = false;
    rays.renderOrder = -41;
    rays.userData.emitsBloom = true;
    group.add(rays);

    return {
        group,
        disc,
        rays,
        uniforms: {
            uTransition: uTrans, uSummitGlow, uCore, uHalo,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pilot assembler — mirrors createDeepOceanPilotTSL.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assemble the converted Mountain Peaks materials into one group + the shared uTime /
 * uTransition uniforms the caller ticks each frame. Used by the standalone WebGPU pilot
 * validation page. Reproduces the original geometry types/sizes and mesh placement.
 */
export function createMountainPeaksPilotTSL({ foothillBaseY = -74 } = {}) {
    const uTime = uniform(0);
    const uTransition = uniform(0);
    // Shared climax uniform: peaks at chapter end (B7 drives it from progress). Ignites the
    // hero summit + widens the sun ray fan together so the climax reads as one event.
    const uSummitGlow = uniform(0);
    const group = new THREE.Group();
    group.name = 'mountain-peaks-pilot-tsl';

    const sky = createMountainSkyTSL(uTransition);
    const floor = createSnowFloorTSL(uTime);
    // Cloud-SEA deck just below the lane — the sea the camera breaks UP through.
    const cloudSea = createCloudSeaDeckTSL({ uTime, uTransition, y: foothillBaseY + 20 });
    const apron = createFoothillApronTSL(uTransition, foothillBaseY);
    // On-screen sun + bloom-halo + ray fan (climax) along lightDir.
    const sun = createMountainSunTSL({ uTransition, summitGlow: uSummitGlow });

    // Main peaks — same sizes/seeds/placement as mountain-peaks.js (relative offsets).
    // `treatment`/`base` default to the canonical hero peak (MAIN_PEAK_TREATMENT). Heroes are
    // bigger + nearer than the original pilot (user §Scale: get closer, hero peaks bigger).
    const mountain1 = createFBMMountainTSL({
        size: 920,
        height: 360,
        position: new THREE.Vector3(-230, -10, -540),
        seed: 12.34,
        transition: uTransition,
        summitGlow: uSummitGlow,
    });
    const mountain2 = createFBMMountainTSL({
        size: 900,
        height: 340,
        position: new THREE.Vector3(230, -20, -590),
        seed: 45.67,
        transition: uTransition,
        summitGlow: uSummitGlow,
    });
    // Center HERO — taller (height 600→720, size 1200→1340) and pulled closer (z -820→-680)
    // so the snow-capped summit dominates the frame at the climax (user §Scale).
    const mountain3 = createFBMMountainTSL({
        size: 1340,
        height: 720,
        position: new THREE.Vector3(0, -30, -680),
        seed: 89.12,
        transition: uTransition,
        summitGlow: uSummitGlow,
    });
    // ONE near foreground ridge-shoulder, lower-left, mostly below frame so only its sunlit
    // snowy upper edge enters — the near depth tier (plan ch4 §Scale).
    const foreground = createFBMMountainTSL({
        size: 720,
        height: 220,
        position: new THREE.Vector3(-360, foothillBaseY - 30, -220),
        seed: 71.5,
        transition: uTransition,
        summitGlow: uSummitGlow,
    });

    group.add(
        sky.mesh,
        cloudSea.mesh,
        floor.group,
        apron.group,
        sun.group,
        foreground.mesh,
        mountain1.mesh,
        mountain2.mesh,
        mountain3.mesh,
    );

    const peaks = [mountain1, mountain2, mountain3, foreground];
    const parts = [sky, cloudSea, floor, ...apron.parts, ...peaks];

    return {
        group,
        uniforms: {
            uTime, uTransition, uSummitGlow,
        },
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
            sun.disc?.geometry?.dispose?.();
            sun.disc?.material?.dispose?.();
            sun.rays?.geometry?.dispose?.();
            sun.rays?.material?.dispose?.();
        },
    };
}

export default createMountainPeaksPilotTSL;

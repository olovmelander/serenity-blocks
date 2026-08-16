/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Sky Drift (Chapter 5) — TSL/WebGPU conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — board → WebGPURenderer). See
 * docs/ODYSSEY_CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN.md §3 (Chapter 5). The chapter
 * identity is "drifting THROUGH a luminous cloud cathedral toward a warm low sun" —
 * the bright, hazy, sun-anchored counterpoint to Space's vacuum. There are STRICTLY
 * NO stars / planets / galaxy / dark space objects here (those read as dark "bruise"
 * blobs against the bright sky and break the no-space identity). The former cosmic
 * point-sprite systems (spiral-galaxy arms, eclipse corona, banded planets, FBM
 * nebula veils, starfield) have been DELETED; the warm glow they used to carry is
 * repurposed into an on-camera SUN-glow sprite stack coincident with the baked dome
 * sun (createSunGlowTSL).
 *
 * The builders here are the hero set for the bright daytime dome:
 *   - createSkyGradientTSL  — the structured vertical Rayleigh/Mie gradient backstop
 *     (warm hazy horizon → periwinkle mid → warm-violet zenith) with a BOOSTED baked
 *     on-camera Mie sun (halo + disc + aureole). NOT bloom-eligible.
 *   - createSunGlowTSL      — an additive on-camera warm sun sprite stack coincident
 *     with the baked dome sun (the repurposed warm glow). Bloom-eligible.
 *   - createCloudSheetTSL / createCloudStrataTSL — 6 feathered FBM cloud sheets
 *     threaded through the travel volume; radial smoothstep feather (no card edge),
 *     silver-lining rim + per-sheet sun back-scatter. NOT bloom-eligible. (Trimmed from
 *     ~10 to 6 fewer-bigger-richer sheets for overdraw; tighter radial feather too.)
 *   - createCloudBreakShaftTSL — god-ray FANS anchored at the on-camera sun.
 *     Bloom-eligible.
 *   - createAuroraRibbonTSL / createAuroraRibbonsTSL — the arching cool teal→violet
 *     HERO aurora curtain. Bloom-eligible.
 *   - createSkyWispTSL — fast near-foreground cloud wisps for speed/altitude.
 *     Bloom-eligible.
 *
 * The live chapter imports ODYSSEY_NOISE_GLSL (od_* value noise); the cloud FBM maps
 * to `fbm2` from the shared TSL noise lib (same rot matrix, octaves and 2.02
 * lacunarity) so the look is preserved.
 *
 * Additive glows (sun glow, cloud-break god-ray shaft, aurora, wisps) are tagged
 * `userData.emitsBloom = true` for the MRT selective-bloom pass. All additive
 * sources are capped well below 1.0 and soft-feathered so the stack never clips to
 * white (ACES + threshold bloom downstream). The sky gradient is NOT bloom-eligible
 * (backstop).
 *
 * PARTICLE FIX: on the WebGPU backend THREE.Points renders as true 1px GPU points
 * (gl_PointSize is ignored and the geometry has no `uv`, so `uv()` warns "uv not
 * found"). The additive sprite systems (sun glow, wisps) are therefore built as
 * INSTANCED BILLBOARD QUADS via the shared makeQuadInstancedGeometry + billboardWorld
 * helper: the `gl_PointCoord` round mask becomes a `uv()` disc. Materials are
 * MeshBasicNodeMaterial on a plain THREE.Mesh (NOT PointsNodeMaterial / THREE.Points).
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    clamp,
    dot,
    float,
    length,
    max,
    min,
    mix,
    mod,
    normalize,
    oneMinus,
    positionLocal,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { fbm2 } from './shared/odyssey-tsl-noise.js';
import { ODYSSEY_SUN } from './shared/chapter-profile.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

/**
 * THE APPROACH DIM (Act II -> Space, Wave 2).
 *
 * Chapter 5 hands over to deep space at ~198 luma against space's ~26. Fitting the measured
 * seam gives `luma ~= 26 + 356 * w5`, and from that a per-0.01p step under the 45-luma budget
 * needs chapter 5's ecotone weight to move at most 0.126 per sample — while a monotonic
 * 1 -> 0 ramp across the seam's 0.060 width AVERAGES 0.167. So no crossfade curve can carry
 * that handover; the endpoint gap itself has to close. This is that.
 *
 * ⚠️ IT IS NARROW ON PURPOSE. `uDusk` is capped at 0.1 by an explicit earlier decision —
 * "Ch5 is now the sunlit cloud-sea payoff, not a night sky" — and this does NOT re-open it.
 * The dusk script, the aurora staging and the palette are all untouched. This only pulls the
 * OUTPUT down over the last stretch of the chapter, where the rail is climbing out of the
 * atmosphere and the sky physically should be losing its top end. Multiply-by-1 everywhere
 * else, so 80% of the chapter is bit-for-bit unchanged.
 */
const uApproachDim = uniform(1);

/** @param {number} v 1 = full daylight, lower = the sky draining toward space. */
export function setSkyDriftApproachDim(v) {
    uApproachDim.value = Math.min(Math.max(Number.isFinite(v) ? v : 1, 0), 1);
}

// Shared forward-aim sun direction. Ch5 has no on-screen space objects, so the sun is
// the single on-camera hero/anchor/light source: it reads on the DEFAULT forward aim
// (B7 adds a CHAPTER_LOOK biasing the aim up-and-right so the disc sits upper-right).
// Exposed so the gradient, sun-glow sprite and god-ray fans all share ONE direction.
export const SKY_DRIFT_SUN_DIR = new THREE.Vector3(...ODYSSEY_SUN).normalize();

// ── Daytime warm-violet sky dome (-100 backstop; must NOT bloom) ─────────────────

/**
 * Chapter 5 is "Atmospheric Drift" — a luminous DAYTIME sky, NOT space. The old
 * near-black space gradient + corridor haze read as a flat pale wash on screen, so
 * this is a proper Rayleigh/Mie atmosphere: a structured vertical gradient (deep
 * warm-violet zenith → brighter periwinkle mid → warm hazy horizon band) with a
 * baked soft SUN (Mie forward-scatter halo + a small disc) toward the upper frame.
 * The sun core is capped well below 1.0 so the additive cloud/aurora stack on top
 * never clips to white (ACES can't rescue an over-bright source — keep the source
 * sane). The sun direction drives a faint god-ray hint via the cloud strata, not
 * here. No stars — that is the Space chapter's identity.
 */
export function createSkyGradientTSL(options = {}) {
    const uOpacity = uniform(1.0);
    // duskProgress (creative plan ch5): ONE scalar scripts the whole chapter as a
    // continuous dusk — Act I "Summit Exhale" (warm, sun low), Act II "Aurora
    // Ascendancy" (indigo, the dark backstop the aurora needs), Act III "Edge of Air"
    // (near-black zenith, noctilucent blue). The capture proved additive curtains over
    // a bright lavender field wash to white — the dome itself must darken.
    const uDusk = options.uDusk ?? uniform(0);
    // The sun reads on the DEFAULT forward aim so it is the on-camera hero (no off-
    // screen space objects to anchor against). Shared with the sun-glow sprite + the
    // god-ray fans via SKY_DRIFT_SUN_DIR so the lighting is coherent.
    const uSunDir = uniform(SKY_DRIFT_SUN_DIR.clone());

    const dir = normalize(positionLocal);
    // t in [0,1] from horizon (0) to zenith (1).
    const t = dir.y.mul(0.5).add(0.5);

    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): Ch5 is now a BRIGHT sunlit cloud-sea payoff, not
    // a dusk→night aurora canvas. The scripted dusk darkening is removed — the dome stays vivid
    // daylight azure the whole chapter, matching Ch3/Ch4. (uDusk kept referenced as a no-op below.)
    const duskRef = uDusk.mul(0.0);
    const zenith = vec3(0.11, 0.34, 0.72); // vivid daylight azure zenith (matches Ch3/Ch4)
    const midSky = vec3(0.36, 0.62, 0.90); // clear azure mid
    const horizon = vec3(0.80, 0.90, 0.97); // light cyan-white horizon

    // Two steepened stops (0→0.30, 0.30→1.0) give a crisp horizon band + a real
    // value run from horizon to zenith.
    const lowBand = mix(horizon, midSky, smoothstep(0.0, 0.30, t));
    let color = mix(lowBand, zenith, smoothstep(0.30, 1.0, t));

    // Painterly FBM break (sky-children sky-dome discipline) so the gradient never reads as a
    // clean ramp — a faint cloudy mottle riding the dome. 3 octaves (was the default 5): this is
    // a near-invisible 0.035-amplitude tint on a fullscreen backstop dome, so the fine octaves
    // are imperceptible while their per-pixel cost over the whole frame is not.
    const domeBreak = fbm2(vec2(dir.x.mul(3.2).add(dir.z.mul(1.7)), dir.y.mul(4.1)), 3);
    color = color.add(vec3(0.035, 0.032, 0.05).mul(domeBreak));

    // Mie sun — stays ALIVE the whole chapter (was gone by ~55% dusk); a bright warm-white daylight
    // disc + halo, matching the Ch3/Ch4 sun.
    const sunAlive = float(1.0);
    const cosTheta = clamp(dot(dir, uSunDir), -1.0, 1.0);
    const mu = max(cosTheta, 0.0);
    const halo = pow(mu, float(5.0)).mul(0.6); // broad warm bloom
    const aureole = pow(mu, float(2.0)).mul(0.16); // wide soft aureole
    const disc = smoothstep(0.985, 0.9995, cosTheta).mul(0.9); // bright core (capped)
    const sunCore = vec3(1.0, 0.93, 0.78); // warm-white daylight sun
    color = color.add(sunCore.mul(halo.add(aureole).add(disc)).mul(sunAlive));

    // Gentle warm horizon haze toward the sun azimuth (no longer dies with a setting sun).
    const horizonLift = smoothstep(0.35, 0.0, abs(dir.y)).mul(mu).mul(0.10);
    color = color.add(vec3(0.92, 0.90, 0.84).mul(horizonLift));

    // Soft bright ceiling so the additive sun never clips to pure white — the dusk-darkening
    // ceilings + waveVDarkBackstop are GONE (they made the whole dome fall to ink). uDusk no-op.
    color = color.min(vec3(0.96, 0.97, 1.0)).add(duskRef);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = (color).mul(uApproachDim);
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;
    // CRITICAL (Wave C): un-fog the sky dome (same bug Ch3/Ch4 had) — a radius-2500 BackSide dome is
    // ~100% fogged by the scene FogExp2, replacing the azure gradient with the flat fog colour.
    material.fog = false;

    const geometry = new THREE.SphereGeometry(2500, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return {
        mesh, material, geometry, uniforms: { uOpacity, uSunDir, uDusk },
    };
}

// ── On-camera sun glow sprite (additive warm hero; bloom-eligible) ────────────────

/**
 * The repurposed warm glow from the deleted solar-eclipse: an additive sun-glow
 * sprite stack coincident with the baked dome sun. Built as instanced billboard quads
 * (one per glow ring) so it always faces the camera and reads as a soft warm bloom
 * around the on-camera sun direction. Capped well below white (soft radial feather) so
 * it gilds via bloom rather than clipping. The sprite world centers are placed along
 * the shared sun direction at a fixed mid-distance so the glow sits where the baked
 * Mie sun is brightest; the live chapter parents this near the dome center.
 *
 * @param {*} uTime uniform(0) time node (drives a gentle breathing pulse)
 */
export function createSunGlowTSL(uTime = uniform(0)) {
    // Four concentric glow rings (core → wide warm halo), placed coincident at the
    // sun anchor; per-instance size + tint give the layered soft-sun look.
    const rings = [
        { size: 26, tint: new THREE.Color(0xfff0cc), alpha: 0.42 },
        { size: 52, tint: new THREE.Color(0xffd591), alpha: 0.30 },
        { size: 96, tint: new THREE.Color(0xffb866), alpha: 0.20 },
        { size: 150, tint: new THREE.Color(0xff9a4a), alpha: 0.12 },
    ];
    const count = rings.length;
    // All rings share the sun-anchor world center (the live chapter offsets the group
    // along SKY_DRIFT_SUN_DIR); local center is the origin of the glow group.
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const tints = new Float32Array(count * 3);
    const alphas = new Float32Array(count);
    rings.forEach((r, i) => {
        sizes[i] = r.size;
        tints[i * 3] = r.tint.r;
        tints[i * 3 + 1] = r.tint.g;
        tints[i * 3 + 2] = r.tint.b;
        alphas[i] = r.alpha;
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTint = attribute('aTint', 'vec3');
    const aAlpha = attribute('aAlpha', 'float');

    // Gentle breathing so the sun feels alive (subtle — never pumps to white).
    const breathe = sin(uTime.mul(0.4)).mul(0.06).add(1.0);
    const size = aSize.mul(breathe);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, size);
    material.colorNode = (aTint).mul(uApproachDim);
    // Soft radial falloff feathered to 0 well before the quad edge (no card edge).
    const dist = length(uv().sub(0.5));
    const glow = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.8);
    material.opacityNode = glow.mul(aAlpha).mul(breathe);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTint: { array: tints, itemSize: 3 },
        aAlpha: { array: alphas, itemSize: 1 },
    });
    // Concentric rings at the group origin (max size ~150, breathing ~1.06); give the
    // instanced geometry a real bounding sphere so it can be frustum-culled — it is a
    // bounded set-piece (parented at the fixed sun anchor), NOT camera-locked.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 170);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-drift-sun-glow';
    mesh.frustumCulled = true;
    return { mesh, material, geometry };
}

// ── Volumetric cloud strata (feathered FBM sheets; NO bloom) ─────────────────────

/**
 * A single soft cloud sheet: a large plane whose alpha is driven by drifting FBM so
 * it reads as a wispy volumetric stratum rather than a flat card. The path threads
 * THROUGH a stack of these (staggered depth/height in createCloudStrataTSL), which
 * is what kills the empty washed-pale field. Sun-side brightening gives a soft
 * god-ray / silver-lining hint. NOT additive (alpha-blended) and capped well under
 * white so layering many sheets never blows out the frame; not bloom-eligible.
 *
 * @param {*} uTime uniform(0) time node
 * @param {number} tintHex base cloud tint (warm/cool varies per stratum)
 * @param {number} litHex sun-lit highlight tint
 * @param {number} coverage 0..1 — higher = denser sheet (lower threshold)
 * @param {number} scale FBM frequency
 */
export function createCloudSheetTSL(uTime, {
    tintHex = 0xcfd0ee,
    litHex = 0xfff1dc,
    coverage = 0.5,
    scale = 2.3,
    drift = 0.012,
    backScatter = 0.0,
    dusk = null,
} = {}) {
    const uDusk = dusk ?? uniform(0);
    // duskProgress shifts the strata to MOONLIT: silver-blue tops over ink-shadowed
    // undersides (#8FA3C8 / #1A2238) so the sheets nearest the path carry the dark
    // value anchor Act II needs — the marble can never go light-on-light again.
    const duskT = smoothstep(0.14, 0.52, uDusk);
    const uTint = mix(uniform(new THREE.Color(tintHex)), vec3(0.12, 0.16, 0.28), duskT.mul(0.9));
    const uLit = mix(uniform(new THREE.Color(litHex)), vec3(0.36, 0.46, 0.64), duskT.mul(0.82));
    // Per-sheet sun back-scatter (0..1): how much this stratum faces the sun, computed
    // CPU-side from the sheet world normal · sun dir. Brightens the sun-facing
    // underside warm so the strata read as lit volume, not flat cards.
    const uBackScatter = uniform(THREE.MathUtils.clamp(backScatter, 0, 1));

    const vUv = uv();
    // Two-scale FBM, drifting in opposite directions → billowing, evolving cloud.
    const p = vUv.mul(scale);
    const t = uTime.mul(drift);
    // Octaves trimmed 4→3 (base) and 5→3 (detail): the `field` feeds a coverage threshold +
    // feather below, which clips the octave-4/5 high-frequency wiggle almost entirely, so the
    // puffy cloud shape is ~unchanged while each of the 6 co-visible sheets drops from ~9 to ~6
    // FBM octaves — a direct cut to this chapter's dominant per-fragment scroll-fill cost.
    const base = fbm2(p.add(vec2(t, t.mul(0.4))), 3);
    const detail = fbm2(p.mul(2.1).sub(vec2(t.mul(0.7), 0.0)), 3);
    const field = base.mul(0.65).add(detail.mul(0.45));

    // Coverage threshold → puffy clumps with feathered edges. Higher coverage lowers
    // the threshold (more cloud). `coverage` is a plain JS number resolved here.
    const lo = Math.max(0.05, 0.92 - coverage);
    const density = smoothstep(lo, lo + 0.34, field);

    // PURE RADIAL feather (no rectangular/elliptical card edge): alpha falls to 0 well
    // before the quad rim so an oblique view never reveals a straight plane edge. This
    // is the fix for the "hard rectangular CARD edge at oblique angles" failure.
    // PERF (overdraw batch): tightened the feather radius 0.52 → 0.42 so each sheet's
    // shaded footprint shrinks ~35% in area (fewer pixels touched per layer) — with 6
    // bigger/denser sheets the field still reads as a mass while overdraw drops.
    // Tightened further (0.42 → 0.38) for the frames 22–23 card corners.
    const centered = vUv.sub(0.5);
    const edge = smoothstep(0.30, 0.0, length(centered));

    // Silver-lining rim: a thin bright band along the dense cloud edges toward the lit
    // tint (the cloud's sunlit fringe). Built from the gradient of the density mask
    // approximated as the band where density is mid-valued.
    const rim = smoothstep(0.15, 0.5, density).mul(smoothstep(0.95, 0.55, density));

    // Sun-lit response: brighten the denser cores + the silver-lining rim toward the
    // warm highlight tint. The per-sheet back-scatter lifts the sun-facing undersides.
    const litCore = smoothstep(0.35, 0.85, vUv.y).mul(density);
    const lit = clamp(litCore.mul(0.38).add(rim.mul(0.46)).add(uBackScatter.mul(density).mul(0.24)), 0.0, 1.0);
    const color = mix(uTint, uLit, lit);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = (color).mul(uApproachDim);
    // Capped opacity — these are atmosphere veils, not foreground panels.
    material.opacityNode = density.mul(edge).mul(mix(float(0.08), float(0.16), duskT));
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // NOTE: additive here contradicts the "NOT additive / dark value anchor" doc above — a known
    // discrepancy. Investigated via the ch5-cloud-sheets playground A/B (2026-07-05): at the
    // shipping opacities (0.08→0.16 × density × edge ≈ 4%) the strata are a whisper-faint layer
    // either way, and against the REAL dark dusk sky the dark ink tint under normal blend goes
    // dark-on-dark (sheets vanish) while additive keeps faint lit-rim structure — so flipping to
    // normal is not a clear win and can read worse. Left as additive; revisit only if the strata
    // opacity is ever raised enough for the dark-anchor to actually register.
    material.blending = THREE.AdditiveBlending;

    const geometry = new THREE.PlaneGeometry(620, 360, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    return {
        mesh, material, geometry, uniforms: { uTint, uLit, uBackScatter },
    };
}

/**
 * Approximate a cloud sheet's sun back-scatter from its rotation. Each sheet starts
 * near-horizontal (normal ≈ +Y) and is tilted by its euler rotation; the dot of the
 * rotated normal with the shared sun direction gives how strongly its underside faces
 * the sun. Plain JS so it resolves to a uniform at build time (no per-frame work).
 * @param {number[]} rot [x,y,z] euler radians
 * @returns {number} back-scatter in [0,1]
 */
function sheetBackScatter(rot) {
    const e = new THREE.Euler(rot[0], rot[1], rot[2]);
    const n = new THREE.Vector3(0, 1, 0).applyEuler(e);
    return THREE.MathUtils.clamp(n.dot(SKY_DRIFT_SUN_DIR) * 0.5 + 0.5, 0, 1);
}

/**
 * 6 staggered cloud strata threaded through the camera travel volume so the dolly
 * passes BETWEEN layered cloud rather than across an empty pale field. Depths span the
 * near/mid corridor (z -90..-680); heights alternate ±40 and lateral offsets swing
 * left/right so the path threads between them. Near sheets are large and partly
 * off-frame for parallax. Tints alternate warm/cool for the warm-violet identity; each
 * sheet's per-sheet sun back-scatter is derived from its tilt so sun-facing strata
 * glow warmer. Each is tilted toward horizontal so the camera threads between them.
 *
 * PERF (overdraw batch): trimmed 10 → 6 sheets — one richer-bigger layer beats many
 * faint overlapping ones, so coverage/scale are nudged up to keep the same volumetric
 * read while ~40% fewer near-fullscreen alpha planes are shaded each frame. Depths still
 * span the full travel volume so the dolly never sees an empty pale gap. The radial
 * feather (createCloudSheetTSL) is also tightened so each sheet covers fewer pixels.
 */
// CONSOLIDATION (remake plan): ONE shared cloud material for all 6 strata sheets. The identical
// FBM/feather/lit graph reads every per-sheet variation (tint, lit, back-scatter, scale, drift,
// coverage) from constant per-mesh geometry attributes instead of baked-in JS constants, so the 6
// co-visible sheets compile a SINGLE pipeline instead of 6. All values are preserved exactly, so
// the strata are byte-identical to the per-sheet build (createCloudSheetTSL, kept for the A/B).
function createSharedCloudMaterialTSL(uTime, uDusk, uFade = null) {
    const duskT = smoothstep(0.14, 0.52, uDusk);
    const aTint = attribute('aTint', 'vec3');
    const aLit = attribute('aLit', 'vec3');
    // Pack (scale, drift, coverage, back-scatter) into ONE vec4: 3 built-in vertex buffers
    // (position/normal/uv) + 3 custom (aTint/aLit/aParams) stays under WebGPU's 8-buffer limit
    // (6 separate custom float attributes overflowed it → 9 buffers).
    const aParams = attribute('aParams', 'vec4');
    const aScale = aParams.x;
    const aDrift = aParams.y;
    const aCoverage = aParams.z;
    const aBackScatter = aParams.w;
    const uTint = mix(aTint, vec3(0.12, 0.16, 0.28), duskT.mul(0.9));
    const uLit = mix(aLit, vec3(0.36, 0.46, 0.64), duskT.mul(0.82));

    const vUv = uv();
    const p = vUv.mul(aScale);
    const t = uTime.mul(aDrift);
    const base = fbm2(p.add(vec2(t, t.mul(0.4))), 3);
    const detail = fbm2(p.mul(2.1).sub(vec2(t.mul(0.7), 0.0)), 3);
    const field = base.mul(0.65).add(detail.mul(0.45));
    const lo = max(float(0.05), float(0.92).sub(aCoverage));
    const density = smoothstep(lo, lo.add(0.34), field);
    const centered = vUv.sub(0.5);
    const edge = smoothstep(0.30, 0.0, length(centered));
    const rim = smoothstep(0.15, 0.5, density).mul(smoothstep(0.95, 0.55, density));
    const litCore = smoothstep(0.35, 0.85, vUv.y).mul(density);
    const lit = clamp(
        litCore.mul(0.38).add(rim.mul(0.46)).add(aBackScatter.mul(density).mul(0.24)),
        0.0,
        1.0,
    );
    const color = mix(uTint, uLit, lit);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = (color).mul(uApproachDim);
    // PAINTERLY-ASCENT REPALETTE (Wave C): opacity up (0.08–0.16 → 0.38–0.5) and NormalBlending
    // (was Additive) so the whitened strata read as soft solid white cloud wisps occluding the blue
    // sky, not faint additive violet haze.
    // .mul(fade): the manager crossfade can't reach a NodeMaterial opacityNode, so without this the
    // bright white strata POPPED in at the 4→5 seam when group.visible flipped. uFade = chapterOpacity.
    const fade = uFade ?? uniform(1);
    material.opacityNode = density.mul(edge).mul(mix(float(0.38), float(0.5), duskT)).mul(fade);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    return material;
}

function bakeCloudSheetAttributes(geometry, {
    tintHex, litHex, backScatter, scale, drift, coverage,
}) {
    const n = geometry.attributes.position.count;
    const tint = new THREE.Color(tintHex);
    const litC = new THREE.Color(litHex);
    const bs = THREE.MathUtils.clamp(backScatter, 0, 1);
    const cov = THREE.MathUtils.clamp(coverage, 0, 1);
    const aTint = new Float32Array(n * 3);
    const aLit = new Float32Array(n * 3);
    const aParams = new Float32Array(n * 4); // (scale, drift, coverage, back-scatter)
    for (let i = 0; i < n; i += 1) {
        aTint[i * 3] = tint.r; aTint[i * 3 + 1] = tint.g; aTint[i * 3 + 2] = tint.b;
        aLit[i * 3] = litC.r; aLit[i * 3 + 1] = litC.g; aLit[i * 3 + 2] = litC.b;
        aParams[i * 4] = scale;
        aParams[i * 4 + 1] = drift;
        aParams[i * 4 + 2] = cov;
        aParams[i * 4 + 3] = bs;
    }
    geometry.setAttribute('aTint', new THREE.BufferAttribute(aTint, 3));
    geometry.setAttribute('aLit', new THREE.BufferAttribute(aLit, 3));
    geometry.setAttribute('aParams', new THREE.BufferAttribute(aParams, 4));
}

export function createCloudStrataTSL(uTime, options = {}) {
    const group = new THREE.Group();
    group.name = 'cloud-strata';
    // [posX, posY, posZ, rotX, rotY, rotZ, scale, tintHex, litHex, coverage, fbmScale]
    // 6 sheets redistributed across the full z -90..-680 span (was 10); each merges the
    // role of ~1.7 of the old sheets, so coverage/scale are bumped for a richer single
    // layer in place of the thinner pairs it replaces.
    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave C): tints whitened from lavender → soft blue-grey
    // underside (0xcbdaea) + bright white lit top (0xfafdff) so the strata read as sunlit white
    // cloud wisps, not violet night veils. (The horizontal cloud-SEA deck below the camera — the
    // Europa "drift above the sea" floor — is added separately.)
    const strata = [
        [-150, 84, -210, -0.92, 0.08, 0.18, 0.52, 0xcbdaea, 0xfafdff, 0.42, 2.0],
        [150, 56, -330, -0.98, 0.16, -0.14, 0.62, 0xcbdaea, 0xfafdff, 0.46, 2.3],
        [-118, 92, -450, -0.88, -0.10, 0.18, 0.78, 0xcbdaea, 0xfafdff, 0.42, 1.8],
        [136, 70, -570, -0.98, 0.16, -0.16, 0.86, 0xcbdaea, 0xfafdff, 0.48, 2.5],
        [-126, 74, -700, -0.92, -0.12, 0.16, 0.98, 0xcbdaea, 0xfafdff, 0.4, 1.8],
        [112, 104, -840, -0.96, 0.06, -0.10, 1.08, 0xcbdaea, 0xfafdff, 0.44, 2.1],
    ];
    const uDusk = options.uDusk ?? uniform(0);
    const material = createSharedCloudMaterialTSL(uTime, uDusk, options.uChapterFade);
    const parts = [];
    strata.forEach((cfg, i) => {
        const rot = [cfg[3], cfg[4], cfg[5]];
        const geometry = new THREE.PlaneGeometry(620, 360, 1, 1);
        bakeCloudSheetAttributes(geometry, {
            tintHex: cfg[7],
            litHex: cfg[8],
            backScatter: sheetBackScatter(rot),
            scale: cfg[10],
            drift: 0.009 + i * 0.0012,
            coverage: cfg[9],
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(cfg[0], cfg[1], cfg[2]);
        mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.scale.setScalar(cfg[6]);
        mesh.renderOrder = -55 + i; // behind heroes, in front of dome
        group.add(mesh);
        parts.push({ mesh, material, geometry });
    });
    return { group, parts };
}

// ── God-ray fans anchored at the on-camera sun (additive; bloom-eligible) ─────────

/**
 * A single god-ray fan plane: a tall narrow shaft of animated warm-to-transparent
 * stripes, radially masked so it reads as a directed sun shaft (no card edge). The
 * stripes rake along the shaft length. Capped low so the additive stack never clips.
 *
 * @param {*} uTime uniform(0) time node
 * @param {number} stripeFreq stripe count along width (varies per shaft for variety)
 * @param {number} phase animation phase offset
 */
// CONSOLIDATION (remake plan): shared god-ray fan material. Per-fan stripe freq + phase move from
// baked build params to a per-mesh aFanParams (vec2) attribute, so a fan splay compiles ONE
// pipeline instead of one-per-fan. Values preserved exactly → byte-identical shafts.
function createGodRayFanMaterial(uTime, uDusk) {
    const vUv = uv();
    const centered = vUv.sub(0.5);
    const aFanParams = attribute('aFanParams', 'vec2'); // (stripeFreq, phase)
    // Tight radial mask → a contained shaft, feathered to 0 before the quad edge.
    const radial = smoothstep(0.40, 0.0, length(centered.mul(vec2(0.62, 1.0))));
    // Animated bright stripes raking along the shaft (the volumetric god-ray look).
    const stripes = pow(
        max(0.0, sin(vUv.x.mul(aFanParams.x).add(uTime.mul(0.2)).add(aFanParams.y))),
        3.0,
    ).mul(0.22);
    // Warm sun colour fading toward the far (top) end of the shaft.
    const color = mix(vec3(1.0, 0.85, 0.6), vec3(0.85, 0.66, 0.42), vUv.y);
    // Length falloff: brightest near the sun (shaft base), fading toward the viewer.
    const lengthFade = smoothstep(1.0, 0.1, vUv.y).mul(0.6).add(0.4);

    const material = new THREE.MeshBasicNodeMaterial();
    // Low additive floor (0.16) keeps the shaft visible without a bright core. The
    // fans belong to the Act I sun: they die with it as the dusk deepens.
    const fanAlive = oneMinus(smoothstep(0.3, 0.55, uDusk));
    material.colorNode = (color.mul(stripes.add(0.16))).mul(uApproachDim);
    material.opacityNode = radial.mul(lengthFade).mul(0.1).mul(fanAlive);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    return material;
}

export function createGodRayFanTSL(uTime = uniform(0), stripeFreq = 22, phase = 0, options = {}) {
    const uDusk = options.uDusk ?? uniform(0);
    const material = options.material ?? createGodRayFanMaterial(uTime, uDusk);
    const geometry = new THREE.PlaneGeometry(150, 460, 1, 1);
    const n = geometry.attributes.position.count;
    const params = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
        params[i * 2] = stripeFreq;
        params[i * 2 + 1] = phase;
    }
    geometry.setAttribute('aFanParams', new THREE.BufferAttribute(params, 2));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-drift-god-ray-fan';
    return { mesh, material, geometry };
}

/**
 * 3 god-ray FANS radiating FROM the on-camera sun position, oriented along sun→camera
 * so they rake down-and-toward the viewer between the cloud strata. The fans are
 * placed/oriented around the shared sun direction (SKY_DRIFT_SUN_DIR) at a near-mid
 * distance; the live chapter parents this group at the sun anchor. Replaces the lone
 * far-behind shaft. Returns { mesh: group, group, parts } so the caller can tick.
 */
export function createCloudBreakShaftTSL(uTime = uniform(0), options = {}) {
    const group = new THREE.Group();
    group.name = 'cloud-break-light-shaft';

    // Fan splay around the sun: slightly different yaw/roll per shaft so they form a
    // FAN rather than one column. Anchored toward the sun azimuth (up-and-right), the
    // shafts slant back down toward the camera through the cloud gaps.
    const fans = [
        {
            pos: [10, 70, -260], rot: [-0.12, 0.0, 0.30], s: 1.0, freq: 22, phase: 0.0,
        },
        {
            pos: [46, 86, -300], rot: [-0.06, 0.05, 0.18], s: 1.12, freq: 17, phase: 1.7,
        },
        {
            pos: [78, 64, -250], rot: [-0.18, -0.04, 0.42], s: 0.92, freq: 27, phase: 3.1,
        },
    ];
    const parts = [];
    // ONE shared material across the 3 fans (per-fan freq/phase ride the aFanParams attribute).
    const uDusk = options.uDusk ?? uniform(0);
    const material = createGodRayFanMaterial(uTime, uDusk);
    fans.forEach((cfg) => {
        const fan = createGodRayFanTSL(uTime, cfg.freq, cfg.phase, { ...options, material });
        fan.mesh.position.set(...cfg.pos);
        fan.mesh.rotation.set(...cfg.rot);
        fan.mesh.scale.setScalar(cfg.s);
        fan.mesh.renderOrder = -10;
        group.add(fan.mesh);
        parts.push(fan);
    });
    // .mesh aliases the group so existing `const { mesh } = ...` callers still work.
    return { mesh: group, group, parts };
}

// ── Aurora ribbons (additive, bloom-eligible) ────────────────────────────────────

/**
 * One HERO aurora curtain. Built as a wide, arced plane whose additive glow is a
 * multi-colour vertical-banded curtain with animated shimmer. The colour runs teal→
 * green→violet→magenta ACROSS the curtain (colorA→colorMid→colorB) AND shifts toward
 * magenta near the curtain top (the real aurora green-low / magenta-high banding), so a
 * single ribbon already shows the teal/green/violet/magenta interplay the chapter wants.
 *
 * Strictly COOL-dominant (the complementary counterpoint to the warm sun); the hue
 * banding never crosses into warm. Additive but hard-capped < 0.95 so the stack never
 * clips to white (ACES + bloom downstream). Soft top/bottom + radial-edge feather so the
 * curtain has no card edge.
 *
 * @param {*} uTime uniform(0) time node
 * @param {number} colorA  left/low hue (teal)
 * @param {number} colorB  right hue (violet)
 * @param {Object} opts width/height/segments/bow/colorMid/colorHi/intensity
 */
// NOTE: the legacy positional colorA/colorB args (and options colorMid/colorHi) are
// accepted for signature compatibility but SUPERSEDED by the physically-ordered stack
// below — real aurora curtains wear pink at the hem and crimson at the crown, never a
// randomized hue run (creative plan ch5 art direction).
// eslint-disable-next-line no-unused-vars
export function createAuroraRibbonTSL(uTime, colorA = 0x2effd6, colorB = 0x9a4cff, {
    width = 520, height = 120, segments = 64, bow = 0.0,
    intensity = 1.0,
    // SEAM 5->6: a shared 0..1 fade the curtains multiply into their alpha so the aurora can
    // recede gracefully across the Sky→Space hand-off (defaults to a private full-on uniform
    // when the caller supplies none, so standalone/pilot use is unchanged).
    opacity = null,
    // duskProgress: stages the aurora (faint arc ~10%, hero ~35%, corona spike ~80%).
    dusk = null,
} = {}) {
    const uOpacity = opacity ?? uniform(1);
    const uDusk = dusk ?? uniform(0.5);
    // PHYSICALLY-ORDERED color stack (creative plan: never randomize the vertical
    // order): magenta-pink nitrogen hem at the BASE, yellow-green foot, green oxygen
    // body, crimson high-oxygen caps fading at the TOP. The legacy colorA/colorB
    // arguments are kept for signature compatibility but the stack below owns the look.
    // 2026-07-05 (playground-verified): the curtains are viewed nearly EDGE-ON (camera aims at the
    // peak horizon), which compresses this vertical stack into a horizontal band — so the physically
    // "correct" crimson high-oxygen cap read as a GARISH red/orange rainbow band (ch5 audit weak
    // point), fighting the doc's own "strictly cool-dominant" intent. Re-graded cool-dominant: the
    // caps are now violet (the classic pink/purple upper aurora), the foot is a softer teal-green
    // instead of hot lime, and the hem is a gentler magenta — a cohesive green→teal→violet curtain.
    const uHem = uniform(new THREE.Color(0xe060c6)); // nitrogen hem (base) — softer magenta
    const uFoot = uniform(new THREE.Color(0x6dff9c)); // teal-green foot (was hot lime 0x9cff57)
    const uBody = uniform(new THREE.Color(0x3dff8e)); // oxygen green body
    const uBodyDim = uniform(new THREE.Color(0x1e9e64)); // dim body wash
    const uCap = uniform(new THREE.Color(0x9a5cff)); // violet cap (was crimson red 0xc71f37)
    const uCapFade = uniform(new THREE.Color(0x3a1f66)); // cap fade-out — deep violet
    const uAccent = uniform(new THREE.Color(0x5b3bff)); // blue-violet edge accent

    // Vertex wobble + a gentle ARC bow across the upper frame (the hero curtain
    // arches rather than hanging flat). bow lifts the ribbon ends down/up parabolically.
    const posL = positionLocal;
    const arcX = posL.x.div(width); // ~[-0.5, 0.5]
    const arc = arcX.mul(arcX).mul(-bow); // parabolic dip toward the edges
    const wobble = sin(posL.x.mul(0.014).add(uTime.mul(0.42))).mul(10.0)
        .add(sin(posL.x.mul(0.033).sub(uTime.mul(0.26))).mul(5.0))
        .add(sin(posL.x.mul(0.006).add(uTime.mul(0.18))).mul(7.0));
    const displaced = vec3(posL.x, posL.y.add(wobble).add(arc), posL.z);

    const vUv = uv();
    // Substorm signature (creative plan): the drapery FOLDS race along the arc ~10×
    // faster than the arc itself drifts — fold frequencies ride fast time terms while
    // the hue/arc drift stays slow.
    const c1 = sin(vUv.x.mul(48.0).add(uTime.mul(1.5))).mul(0.5).add(0.5);
    const c2 = sin(vUv.x.mul(91.0).sub(uTime.mul(1.1))).mul(0.5).add(0.5);
    const c3 = sin(vUv.x.mul(23.0).add(uTime.mul(0.66))).mul(0.5).add(0.5);
    const curtain = c1.mul(0.5).add(c2.mul(0.32)).add(c3.mul(0.28));
    // Soft four-sided feather so the wide ribbons read as flowing curtains rather
    // than rectangular cards. The base stays denser (aurora foot) while both ends and
    // the upper crown dissolve before the geometry edge.
    const vertical = smoothstep(0.0, 0.30, vUv.y)
        .mul(oneMinus(smoothstep(0.82, 1.0, vUv.y)));
    const horizontal = smoothstep(0.0, 0.16, vUv.x)
        .mul(oneMinus(smoothstep(0.84, 1.0, vUv.x)));
    const cornerDissolve = oneMinus(smoothstep(0.12, 0.66, length(vUv.sub(0.5).mul(vec2(0.42, 1.0)))));
    const curtainMask = vertical.mul(horizontal).mul(cornerDissolve);
    const strands = pow(curtain, 2.0).mul(0.7).add(0.3);

    // The vertical color stack (fixed order, never randomized): hem → foot → body →
    // crimson caps. Horizontal strand brightness washes between the dim and bright
    // body greens so the curtain reads as rippling light, not a flat gradient.
    const bodyWash = mix(uBodyDim, uBody, strands);
    let color = mix(uHem, uFoot, smoothstep(0.04, 0.2, vUv.y));
    color = mix(color, bodyWash, smoothstep(0.18, 0.4, vUv.y));
    color = mix(color, uCap, smoothstep(0.62, 0.84, vUv.y));
    color = mix(color, uCapFade, smoothstep(0.84, 1.0, vUv.y));
    // Blue-violet accent only on the sharpest, most energetic lower edges.
    const hemBand = smoothstep(0.16, 0.02, vUv.y);
    color = color.add(uAccent.mul(pow(curtain, 4.0)).mul(hemBand).mul(0.4));

    // STAGED intensity: the aurora is the chapter HERO and must read across the WHOLE
    // journey (composition overhaul), so it opens already clearly present (base 0.6 even
    // against the brighter entry sky) and climbs to full as the dusk deepens, instead of
    // the old faint 0.28 open that left the entry sky empty.
    const stage = smoothstep(0.0, 0.26, uDusk).mul(0.32).add(0.72);
    const corona = smoothstep(0.7, 0.8, uDusk).mul(oneMinus(smoothstep(0.86, 0.96, uDusk)));
    const staged = stage.add(corona.mul(0.5));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    // Hard-capped at 0.95 so ribbons never blow white even where they overlap
    // (additive). `intensity` scales the foreground hero up, depth curtains down.
    material.colorNode = min(
        color.mul(strands.add(0.55)).mul(float(1.55).mul(intensity)).mul(staged),
        vec3(0.95),
    ).mul(uApproachDim);
    const opacityNode = curtainMask.mul(strands.mul(0.7).add(0.22))
        .mul(float(0.72).mul(intensity))
        .mul(staged)
        .mul(uOpacity);
    material.opacityNode = min(opacityNode, float(0.86));
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(width, height, segments, 1);
    const mesh = new THREE.Mesh(geometry, material);
    return {
        mesh,
        material,
        geometry,
        uniforms: {
            uHem, uFoot, uBody, uCap, uAccent, uOpacity, uDusk,
        },
    };
}

/**
 * HERO aurora curtains — the bold, ever-present cool counterpoint to the warm sun.
 *
 * The old set was three small curtains anchored high (y 48..138) and shallow (z -160..
 * -260): they sat at/above the top frame edge and the dolly passed them within the first
 * beat, so the aurora read faint + late. This rebuild:
 *   - LOWERS the curtains (y 36..96) so they ARCH ACROSS the upper frame the camera
 *     actually sees (lookUp is only ~3°), not above it,
 *   - SPREADS them across the FULL travel depth (z -90 .. -640, like the cloud strata)
 *     so there is always a wide curtain ahead/overhead from chapter ENTRY through the
 *     whole chapter — never a brief mid-beat,
 *   - WIDENS them (520..680) so they sweep edge-to-edge of the upper frame,
 *   - uses the teal/green/violet/magenta palette (per-ribbon multi-hue), strictly cool-
 *     dominant, with one warm-GROUNDED base echo near the sun side.
 * Additive but each ribbon is hard-capped < 0.95 and the foreground hero/back curtains
 * carry different `intensity` so overlap never blows to white.
 */
export function createAuroraRibbonsTSL(uTime, options = {}) {
    const group = new THREE.Group();
    group.name = 'aurora-ribbons';
    // SEAM 5->6: ONE shared fade uniform across all curtains so the whole aurora can recede
    // gracefully across the Sky→Space hand-off (instead of blinking out when the group hides).
    const uOpacity = uniform(1);
    // duskProgress (shared with the dome): stages every curtain together — faint arc by
    // ~10%, hero by ~35%, corona spike ~80% (staged in createAuroraRibbonTSL).
    const uDusk = options.uDusk ?? uniform(0.5);
    // [x, y, z, colorA, colorB, rotX, rotZ, scale, width, height, bow, colorMid, colorHi, intensity]
    //
    // COMPOSITION OVERHAUL (2026-06-15): the camera now levels the horizon (worldUp) and
    // drops the aim to the peak HORIZON, so the curtains were re-tiered into an ARC that
    // climbs with depth (y 215 near → 610 far) and OVER the inherited summit chain — the
    // aurora reads as the bold hero sweeping the upper frame BEHIND the peaks across the
    // whole chapter, not a faint band above the top edge. Widened + taller + brighter.
    // Placements calibrated against the live NDC projection in the playground harness.
    const configs = [
        // NEAR hero arc — present from the chapter's first frames, low-and-wide overhead.
        [-40, 215, -160, 0x2effd6, 0x9a4cff, -0.16, 0.04, 1.25, 700, 200, 100,
            0x44ff8c, 0xd24cff, 1.12],
        // MID HERO — the widest, brightest sweep arching directly over the rail + peaks.
        [10, 330, -300, 0x3cffe0, 0x8a4cff, -0.14, -0.04, 1.5, 820, 220, 120,
            0x52ff96, 0xc24cff, 1.2],
        // LEFT depth curtain (sweeps off the left edge for an edge-to-edge dome).
        [-280, 300, -250, 0x5cf0ff, 0x6a5cff, -0.12, 0.07, 1.15, 660, 180, 84,
            0x4ce0ff, 0xb05cff, 0.86],
        // RIGHT depth curtain.
        [240, 360, -330, 0x2cffd0, 0xa24cff, -0.12, -0.05, 1.15, 680, 180, 96,
            0x40ff8c, 0xcc4cff, 0.92],
        // DEEP hero — a bold curtain arching high through the back half of the chapter.
        [-20, 480, -460, 0x2cffd0, 0xa24cff, -0.10, -0.04, 1.5, 780, 210, 112,
            0x40ff8c, 0xcc4cff, 1.06],
        // FAR veil — a softer, highest dome deep in the corridor for parallax depth.
        [-50, 610, -620, 0x66f0ff, 0x7a5cff, -0.08, 0.05, 1.4, 740, 180, 80,
            0x58e8ff, 0xb868ff, 0.74],
    ];
    const parts = [];
    configs.forEach((cfg) => {
        const ribbon = createAuroraRibbonTSL(uTime, cfg[3], cfg[4], {
            width: cfg[8],
            height: cfg[9],
            bow: cfg[10],
            colorMid: cfg[11],
            colorHi: cfg[12],
            intensity: cfg[13],
            opacity: uOpacity,
            dusk: uDusk,
        });
        ribbon.mesh.position.set(cfg[0], cfg[1], cfg[2]);
        ribbon.mesh.rotation.set(cfg[5], 0, cfg[6]);
        ribbon.mesh.scale.setScalar(cfg[7]);
        ribbon.mesh.renderOrder = -8;
        group.add(ribbon.mesh);
        parts.push(ribbon);
    });
    // Expose the shared fade uniform on the group so the chapter update can drive the 5->6 recede.
    group.userData.auroraOpacityUniform = uOpacity;
    return { group, parts, uniforms: { uOpacity, uDusk } };
}

// ── Near-foreground cloud wisps (additive speed/altitude streaks; bloom-eligible) ──

/**
 * Fast near-cloud wisps that streak PAST the camera for a sense of speed/altitude and
 * to fill the dead mid/right frame regions. Built as instanced billboard quads (warm/
 * light tint, additive-soft, radial feather). The per-instance world centers live in
 * the `aBase` instanced attribute, which the live update loop streaks toward the camera
 * (same pattern the old rain veil used). Capped count, soft, sub-white.
 *
 * PERF (Batch5): the forward streak + recycle that used to run as a CPU loop rewriting
 * the `aBase` Float32Array every frame (sky-drift.js) is now driven entirely on the GPU
 * from `uTime` + the per-instance `aSpeed`/`aSeed` attributes via a sawtooth in the
 * positionNode — no per-frame attribute re-upload. `aBase.z` is the seed/origin only;
 * the live z is `mod(base + uTime*speed + seed*span, span) - WISP_NEAR` so each wisp
 * rushes toward the camera (+Z) and wraps back to the far edge of the near band.
 *
 * @param {*} uTime uniform(0) time node
 * @param {number} count instance count (capped ~300–420 by the caller)
 */
// Near-band geometry of the wisp recycle (env-local space). The wisps rush from
// WISP_FAR toward the camera at WISP_NEAR; WISP_SPAN is the recycle length. Kept in
// sync with the bounding sphere below so frustum culling never wrongly rejects the band.
const WISP_FAR = -200;
const WISP_NEAR = 30;
const WISP_SPAN = WISP_NEAR - WISP_FAR; // 230

export function createSkyWispTSL(uTime = uniform(0), count = 280) {
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        const idx = i * 3;
        bases[idx] = (Math.random() - 0.5) * 320;
        bases[idx + 1] = (Math.random() - 0.5) * 180 + 20;
        bases[idx + 2] = -40 - Math.random() * 160; // near z -40..-200 (origin seed)
        sizes[i] = 14 + Math.random() * 30; // wide streaking wisps
        speeds[i] = 0.5 + Math.random() * 1.0;
        seeds[i] = Math.random() * Math.PI * 2;
    }

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aSpeed = attribute('aSpeed', 'float');
    const aSeed = attribute('aSeed', 'float');

    // Gentle per-wisp twinkle so they shimmer as they pass.
    const twinkle = sin(uTime.mul(1.2).add(aSeed)).mul(0.25).add(0.6);
    // Stretch the quad vertically a touch for a streaking read (wider than tall here
    // is handled by the quad uv mask below).
    const size = aSize.mul(twinkle.mul(0.4).add(0.8));

    // GPU-side forward streak + recycle (replaces the CPU loop). Velocity ≈ aSpeed*60
    // units/sec ≈ the old `aSpeed*2.4`/frame @60fps; the +aSeed*span spreads the wraps
    // so the wisps don't all reset on the same frame. A bounded sin sway replaces the
    // old unbounded per-frame x accumulation.
    const travel = mod(
        aBase.z.add(WISP_SPAN).add(uTime.mul(aSpeed).mul(60.0)).add(aSeed.mul(float(WISP_SPAN))),
        float(WISP_SPAN),
    );
    const driftZ = travel.add(WISP_FAR); // [-200, 30]
    const driftX = aBase.x.add(sin(uTime.mul(0.45).add(aSeed)).mul(6.0));
    const center = vec3(driftX, aBase.y, driftZ);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, size);
    // Warm-light wisp tint (matches the sun-lit cloud highlight, not pure white).
    material.colorNode = (vec3(0.66, 0.72, 0.9)).mul(uApproachDim);
    // Soft radial feather → no card edge; capped low (additive-soft).
    const dist = length(uv().sub(0.5));
    const glow = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.6);
    material.opacityNode = glow.mul(twinkle).mul(0.075);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aSpeed: { array: speeds, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });
    // The instanced geometry's auto bounding sphere only covers the unit quad at the
    // origin, so give it one covering the whole recycle band — then the wisps can be
    // frustum-culled (they are bounded env-local content, NOT camera-locked).
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 20, (WISP_FAR + WISP_NEAR) / 2),
        320,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-drift-wisps';
    mesh.frustumCulled = true;
    return { mesh, material, geometry };
}

// ── Lenticular landmark cloud (Act II stationary scale object; NO bloom) ──────────
//
// Creative plan asset 5: one stacked-disc lens cloud mid-right of the path around
// 45–55% — the stationary landmark that kills the 14–18 dead stretch. Smooth stacked
// ellipse discs, moonlit silver tops over shadowed bases; classic standing-wave cloud.
export function createLenticularCloudTSL(uTime = uniform(0), options = {}) {
    const uDusk = options.uDusk ?? uniform(0.5);
    const group = new THREE.Group();
    group.name = 'lenticular-landmark';

    const vUv = uv();
    const centered = vUv.sub(0.5);
    // Smooth lens profile: a wide flat ellipse, alpha densest at the core. A slow FBM
    // breath keeps the edge organic while the cloud itself STAYS STILL (its stillness
    // against the streaming wisps is the landmark read).
    const lens = smoothstep(0.5, 0.12, length(centered.mul(vec2(1.0, 2.6))));
    const breath = fbm2(vUv.mul(3.0).add(uTime.mul(0.006)), 4).mul(0.25).add(0.85);
    // Moonlit silver top over a shadowed base; deepens with dusk.
    const duskT = smoothstep(0.2, 0.7, uDusk);
    const top = mix(vec3(0.78, 0.74, 0.7), vec3(0.56, 0.64, 0.78), duskT);
    const base = mix(vec3(0.42, 0.42, 0.56), vec3(0.1, 0.13, 0.22), duskT);
    const color = mix(base, top, smoothstep(0.25, 0.8, vUv.y));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = (color).mul(uApproachDim);
    material.opacityNode = lens.mul(breath).mul(0.62);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;

    // Three stacked discs, shrinking upward — the classic lenticular "pile of plates".
    const geometry = new THREE.PlaneGeometry(190, 60, 1, 1);
    [
        { y: 0, s: 1.0 },
        { y: 16, s: 0.74 },
        { y: 29, s: 0.5 },
    ].forEach((tier) => {
        const disc = new THREE.Mesh(geometry, material);
        disc.position.y = tier.y;
        disc.scale.setScalar(tier.s);
        disc.renderOrder = -12;
        group.add(disc);
    });
    group.traverse((child) => { child.frustumCulled = false; });
    return { group, material, geometry };
}

// ── Noctilucent veil (Act III "last clouds"; additive, bloom-eligible) ─────────────
//
// Creative plan asset 7: electric blue-white herringbone filaments high overhead in
// the last ~15% of the dusk — sunlit while the world below is dark, so they read as
// self-luminous threads: the threshold to space.
export function createNoctilucentVeilTSL(uTime = uniform(0), options = {}) {
    const uDusk = options.uDusk ?? uniform(1);
    const vUv = uv();

    // Herringbone/cross-hatch wave pattern: two interfering diagonal wave trains,
    // FBM-broken so the filaments read organic.
    const waveA = sin(vUv.x.mul(40.0).add(vUv.y.mul(26.0)).add(uTime.mul(0.18)));
    const waveB = sin(vUv.x.mul(34.0).sub(vUv.y.mul(30.0)).sub(uTime.mul(0.14)));
    const herring = pow(clamp(waveA.mul(waveB), 0.0, 1.0), 1.6);
    const breakup = fbm2(vUv.mul(5.0).add(uTime.mul(0.01)), 4).mul(0.5).add(0.5);
    const filaments = herring.mul(smoothstep(0.3, 0.75, breakup));

    const centered = vUv.sub(0.5);
    const radialEdge = oneMinus(smoothstep(0.11, 0.46, length(centered.mul(vec2(0.74, 1.0)))));
    const sideEdge = smoothstep(0.0, 0.12, vUv.x)
        .mul(oneMinus(smoothstep(0.88, 1.0, vUv.x)))
        .mul(smoothstep(0.0, 0.1, vUv.y))
        .mul(oneMinus(smoothstep(0.9, 1.0, vUv.y)));
    const edge = radialEdge.mul(sideEdge);
    // Only exists across the final act (the "last clouds" before vacuum).
    const reveal = smoothstep(0.8, 0.94, uDusk);

    const material = new THREE.MeshBasicNodeMaterial();
    // #9FD8FF→#BFE8FF
    material.colorNode = mix(vec3(0.62, 0.85, 1.0), vec3(0.75, 0.91, 1.0), herring).mul(uApproachDim);
    material.opacityNode = filaments.mul(edge).mul(reveal).mul(0.5);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(900, 520, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'noctilucent-veil';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// ── Ice spindrift crystals (near-camera altitude streaks; additive) ────────────────
//
// Creative plan asset 6: instanced ice-crystal quads streaking past the camera, tinted
// by the act (warm sun-catch early, aurora-cool late). Same GPU recycle as the wisps.
export function createIceCrystalsTSL(uTime = uniform(0), count = 160, options = {}) {
    const uDusk = options.uDusk ?? uniform(0.5);
    const bases = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 200;
        bases[i * 3 + 1] = (Math.random() - 0.5) * 120 + 10;
        bases[i * 3 + 2] = -30 - Math.random() * 170;
        speeds[i] = 0.9 + Math.random() * 1.4;
        seeds[i] = Math.random() * Math.PI * 2;
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSpeed: { array: speeds, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSpeed = attribute('aSpeed', 'float');
    const aSeed = attribute('aSeed', 'float');

    const travel = mod(
        aBase.z.add(WISP_SPAN).add(uTime.mul(aSpeed).mul(80.0)).add(aSeed.mul(float(WISP_SPAN))),
        float(WISP_SPAN),
    );
    const center = vec3(
        aBase.x.add(sin(uTime.mul(0.7).add(aSeed)).mul(3.0)),
        aBase.y,
        travel.add(WISP_FAR),
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, 0.7);
    // Crystals catch the act's light: warm sun-glint early, aurora green-cool late.
    const crystalTint = mix(vec3(1.0, 0.88, 0.7), vec3(0.55, 0.95, 0.8), smoothstep(0.3, 0.6, uDusk));
    material.colorNode = (crystalTint).mul(uApproachDim);
    const dist = length(uv().sub(0.5));
    const sparkle = pow(oneMinus(dist.mul(2.0)).max(0.0), 3.0);
    const twinkle = sin(uTime.mul(2.4).add(aSeed.mul(7.0))).mul(0.4).add(0.6);
    material.opacityNode = sparkle.mul(twinkle).mul(0.5);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 10, (WISP_FAR + WISP_NEAR) / 2),
        320,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-drift-ice-crystals';
    mesh.frustumCulled = true;
    return { mesh, material, geometry };
}

// ── Dark foreground wisps (the near-field VALUE anchor; NO bloom) ───────────────────
//
// Creative plan asset 8: a handful of SHADOWED cloud shreds crossing the lower frame —
// the near-black ingredient the lavender wash never had. NormalBlending so they truly
// darken the frame.
export function createDarkWispsTSL(uTime = uniform(0), count = 10) {
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 320;
        bases[i * 3 + 1] = -24 - Math.random() * 44; // the lower/mid frame band
        bases[i * 3 + 2] = -30 - Math.random() * 210;
        sizes[i] = 58 + Math.random() * 66;
        seeds[i] = Math.random() * Math.PI * 2;
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aSeed = attribute('aSeed', 'float');

    const drift = sin(uTime.mul(0.06).add(aSeed)).mul(14.0);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(vec3(aBase.x.add(drift), aBase.y, aBase.z), aSize);
    // ink-shadow shred, visibly below the rail
    material.colorNode = vec3(0.035, 0.048, 0.095).mul(uApproachDim);
    const dist = length(uv().sub(0.5));
    const shred = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.4);
    const breakup = fbm2(uv().mul(3.4).add(aSeed), 4).mul(0.5).add(0.5);
    material.opacityNode = shred.mul(smoothstep(0.24, 0.68, breakup)).mul(0.68);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sky-drift-dark-wisps';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

/**
 * Assemble the rebuilt Sky Drift materials into one group + a single uTime uniform the
 * caller ticks each frame. Mirrors createDeepOceanPilotTSL. The chapter is now STRICTLY
 * no-space: the bright dome + boosted on-camera sun, the on-camera sun-glow sprite, the
 * threaded cloud strata, the sun-anchored god-ray fans, the arching aurora hero curtain
 * and the near-foreground wisps. No galaxy / corona / planets / nebula / stars.
 */
export function createSkyDriftPilotTSL() {
    const uTime = uniform(0);
    const uEnergy = uniform(0.4);
    const group = new THREE.Group();
    group.name = 'sky-drift-pilot-tsl';

    const gradient = createSkyGradientTSL();
    const strata = createCloudStrataTSL(uTime);
    const shaft = createCloudBreakShaftTSL(uTime);
    const aurora = createAuroraRibbonsTSL(uTime);
    const wisps = createSkyWispTSL(uTime);

    // On-camera sun-glow sprite stack, offset along the shared sun direction so the warm
    // glow sits where the baked Mie sun is brightest.
    const sunGlow = createSunGlowTSL(uTime);
    sunGlow.mesh.position.copy(SKY_DRIFT_SUN_DIR.clone().multiplyScalar(360));

    group.add(
        gradient.mesh,
        strata.group,
        shaft.group,
        aurora.group,
        wisps.mesh,
        sunGlow.mesh,
    );

    return {
        group,
        uniforms: { uTime, uEnergy },
        materials: {
            gradient: gradient.material,
            sunGlow: sunGlow.material,
            shaft: shaft.parts.map((p) => p.material),
            wisps: wisps.material,
            strata: strata.parts.map((p) => p.material),
            aurora: aurora.parts.map((p) => p.material),
        },
        dispose() {
            const parts = [
                gradient, sunGlow, wisps,
                ...shaft.parts, ...strata.parts, ...aurora.parts,
            ];
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createSkyDriftPilotTSL;

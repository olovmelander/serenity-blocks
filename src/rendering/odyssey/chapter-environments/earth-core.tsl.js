/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Earth Core (Chapter 1) — TSL/WebGPU pilot conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3). See docs/ODYSSEY_AAA_MASTER_PLAN.md
 * and docs/ODYSSEY_CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN.md (Chapter 1).
 *
 * THE MOLTEN CATHEDRAL. The chapter is a grand near-black charred-rock vault the
 * camera falls THROUGH: a calm mirror-bright opaque LAVA LAKE far below that the
 * camera looks ACROSS (not the old shard-y additive floor seen edge-on), a distant
 * LAVA-FALL hero pouring into it, ember-storm rising through god-ray shafts, framed
 * by deep near-black charred rock. Value target ~70% near-black rock / ~30% molten.
 *
 * Materials are NodeMaterials (run on WebGPURenderer + its WebGL2 fallback). The
 * chapter's private inline Ashima `snoise` maps to `snoise3` (three's built-in
 * MaterialX gradient noise) in the shared TSL noise lib; the GLSL `fbm` helper is
 * reproduced here (4 octaves) so the look is preserved exactly.
 *
 * Emissives are tagged `userData.emitsBloom = true` for the selective-bloom pass and
 * are soft-feathered + capped below 1.0 display so the downstream ACES + threshold
 * bloom + master grade gild them rather than clip to white.
 *
 * A shared `uDescent` uniform (0 at the vault top → 1 at the lake) is exposed by the
 * material builders that want it (lava lake emission, lava-fall) so earth-core.js can
 * drive descent drama from camera progress without any per-frame allocation.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    normalLocal,
    normalView,
    oneMinus,
    pow,
    positionLocal,
    positionViewDirection,
    positionWorld,
    sin,
    smoothstep,
    step,
    fract,
    texture3D,
    transformNormalToView,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3, ridged3, snoise3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld } from './shared/odyssey-tsl-billboard.js';
import { buildTileableNoise3D } from './shared/odyssey-baked-noise.js';

// Lake surface Y (mirrors LAVA_LAKE_Y in earth-core.js). Used for the emissive
// BLEED on prop bases near the lake line and the lake-distance grounding gradient.
const LAVA_LAKE_Y = -10;
// Lake centre (world XZ) the grounding distance gradient measures from. The chapter
// group is anchored at the path centre, so props use world position for the falloff.
const LAKE_CENTER_X = 0;
const LAKE_CENTER_Z = 0;

/**
 * View-correct Fresnel rim (§4.3): pow(1 - |dot(normalView, viewDir)|, k). Works as
 * the camera dollies (no fixed +Z reference), so the silhouette is carved out of the
 * haze consistently rather than banding into crack-like stripes. `nView` lets callers
 * pass an analytically-recomputed view normal; defaults to the built-in normalView.
 */
function viewFresnel(k = 3.0, nView = normalView) {
    return pow(oneMinus(abs(dot(normalize(nView), positionViewDirection))), k);
}

// ── Shared fbm (mirrors earth-core.js noiseGLSL `fbm`, 4 octaves) ────────────────

/**
 * 4-octave fbm over the simplex stand-in, matching the chapter's inline GLSL `fbm`:
 * f += 0.5*snoise(p); p*=2.01; f += 0.25*snoise(p); p*=2.02; f += 0.125*snoise(p);
 * p*=2.03; f += 0.0625*snoise(p).
 */
function fbm(pInput, octaves = 4, sn = snoise3) {
    // octaves is a JS build-time count. The lake, canopy, clouds AND the shared moltenRockField
    // bodies pass 3: the 4th octave (amp 0.0625, ~8x freq) is sub-pixel detail eaten by haze/ACES
    // or the density smoothstep. Cutting it off the rock saved ~1.47s of earth-core's cold compile
    // (4211->2737ms, RTX 5080) with no visible change (screenshot A/B) — see compile-cost scoping.
    // `sn` selects the noise source: analytic snoise3 by default; the baked 3D-noise texture for
    // the forgiving low/mid-freq bulk under the ?earthCoreBakeNoise flag (see moltenRockField).
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
}

// ── Bake lever (DEFAULT-ON) ──────────────────────────────────────────────────────
// Swaps the LOW/MID-freq bulk of moltenRockField (warp/rivers/crust, ~18 of its 21 snoise3)
// from analytic mx_noise to a single baked 3D-noise texture fetch each — trims earth-core's
// COLD WebGPU compile by ~900 ms (measured; warm-cache launches already compile fast, so this
// helps first launch / after a Dawn-cache evict). The sharp high-freq VEIN stays analytic
// (trilinear texture creasing would show as extra filaments there). In-scene A/B'd as
// imperceptible (docs §6b/§6c). Escape hatch: `?earthCoreBakeNoise=0` (dev URL) or
// `localStorage.serenity.earthCoreBakeNoise='0'` (packaged Electron) to force analytic.
function _readEarthCoreBakeFlag() {
    if (typeof window === 'undefined') return false;
    try {
        const url = new URLSearchParams(window.location.search).get('earthCoreBakeNoise');
        if (url === '0') return false;
        if (url === '1') return true;
        const ls = window.localStorage && window.localStorage.getItem('serenity.earthCoreBakeNoise');
        if (ls === '0') return false;
        if (ls === '1') return true;
    } catch { /* URL/localStorage unavailable — fall through to default */ }
    return true; // default ON
}
const EARTH_CORE_BAKE_NOISE = _readEarthCoreBakeFlag();
const BAKED_NOISE_PERIOD = 10; // world units per texture tile (features/unit = grid/period = 2)
let _bakedNoiseTex = null;
function _getBakedNoiseSampler() {
    if (!_bakedNoiseTex) _bakedNoiseTex = buildTileableNoise3D(96, 20, BAKED_NOISE_PERIOD, 1337);
    const invP = 1 / BAKED_NOISE_PERIOD;
    // Match snoise3's ~[-1,1]: sample R, wrap into [0,1), restore range.
    return (p) => texture3D(_bakedNoiseTex, fract(vec3(p).mul(invP))).r.mul(2.0).sub(1.0);
}

// ── Shared molten-rock field (adapts pyrestorm's lava-river MOUNTAIN shader) ──────
//
// The old rock/column/pocket materials painted a flat near-black body with ONE
// ridge-noise crack band, which read as a tiled "cracked decal." This helper builds a
// proper glowing-magma field the way pyrestorm's MOUNTAIN_FRAGMENT_SHADER does:
//   1. a DOMAIN-WARPED fbm "flow" field (warp the lookup by a slow second fbm) so the
//      molten meanders in rivers instead of tiling;
//   2. a separate higher-frequency "crust" map that drops dark CHARRED CHUNKS floating
//      in the stream (pyrestorm's crustFactor) — this is what kills the repetition;
//   3. thin bright ridged VEINS/cracks of hot molten over the crust;
//   4. a slow emissive PULSE so the magma breathes.
// Returns { color, glow, crackHeat } in display space (callers add fresnel/baked bounce
// and cap). `pos` is the sample coordinate (object space), `heatBias` shifts how molten
// the body reads (0 = mostly charred rock, up to ~0.35 = a hot magma boulder), and
// `pool` (0..1) biases molten into recesses/downward faces so it pools like real lava.
function moltenRockField(pos, uTime, uPulseIntensity, heatBias, pool) {
    // §4.1 — lift the crust floor so "crust" is dark warm ROCK, never near-black voids
    // (the holey-mesh root cause). 0.045/0.018/0.008 → 0.07/0.03/0.012.
    // WAVE 3a — THIS FIELD OWNS THE CHAPTER'S PIXELS, so it owns its value structure.
    // Captures at four stations agree: the rock silhouette renders as saturated mid-red from
    // base to crown, which is what put 65 % of the frame in the luma 32-96 band while the
    // blacks and the fire were both fine. The Wave 1 study reached its structure the opposite
    // way — a near-black charred base, warmth re-admitted ONLY as a bounce from below and a
    // fresnel rim, both of which this material already has downstream.
    //
    // So the CRUST goes charred (it is rock that has cooled, not rock that is glowing) and the
    // cooling-molten river darkens. The bright river stop is untouched: the fire must stay
    // fire, or emptying the mid band just makes a grey cave.
    const uCrust = vec3(0.022, 0.010, 0.006); // charred rock — dark, still warm-hued
    const uRiverDark = vec3(0.16, 0.028, 0.008); // cooling molten (deep ember)
    const uRiverBright = vec3(0.92, 0.28, 0.035); // hot flowing magma, below yellow-white
    const uVein = vec3(0.95, 0.32, 0.04); // hottest crack core (warm-orange instead of gold-white)

    const ftime = uTime.mul(0.12);

    // Bulk noise source: baked 3D-texture fetch under ?earthCoreBakeNoise, else analytic.
    // The VEIN (below) always stays analytic — trilinear texture creasing shows there.
    const snBulk = EARTH_CORE_BAKE_NOISE ? _getBakedNoiseSampler() : snoise3;

    // 1. Domain warp: offset the river lookup by a slow low-freq fbm so the molten
    //    flows in meandering channels (no axis-aligned tiling).
    const warp = vec3(
        fbm(pos.mul(0.5).add(vec3(ftime, 0.0, 0.0)), 3, snBulk),
        fbm(pos.mul(0.5).add(vec3(0.0, ftime.mul(0.7), 5.0)), 3, snBulk),
        fbm(pos.mul(0.5).add(vec3(7.0, 0.0, ftime.mul(0.5))), 3, snBulk),
    ).mul(0.9);
    const warped = pos.add(warp);

    // River field: two octaves flowing at different rates → living molten rivers.
    const river1 = fbm(warped.mul(0.7).add(vec3(0.0, ftime.mul(1.3), 0.0)), 3, snBulk);
    const river2 = fbm(warped.mul(1.4).add(vec3(ftime.mul(-0.6), 0.0, ftime.mul(0.4))), 3, snBulk);
    const riverField = river1.mul(0.6).add(river2.mul(0.4)).add(0.5);

    // Pool the molten into recesses / down-facing crevices + the chosen heat bias.
    const riverIntensity = smoothstep(
        float(0.62).sub(heatBias).sub(pool.mul(0.12)),
        float(0.82).sub(heatBias.mul(0.5)),
        riverField,
    );

    // 2. Crust chunks: high-freq map that drops dark CHARRED islands into the stream
    //    (this is the variation that defeats the repetitive decal look).
    const crustMap = fbm(warped.mul(2.6).add(vec3(ftime.mul(0.4), 0.0, 0.0)), 3, snBulk).add(0.5);
    const crustFactor = smoothstep(0.34, 0.78, crustMap);

    // 3. Base gradient (river core is hotter), then float crust chunks over it.
    //    §4.1 — crust now MOTTLES rather than punching to near-black: mix strength
    //    0.72 → 0.55, and keep more base color in the fall-back mix (0.85/0.15 →
    //    0.7/0.3) so the body never collapses below the lit haze behind it.
    let color = mix(uRiverDark, uRiverBright, riverIntensity);
    color = mix(color, uCrust, crustFactor.mul(0.55));
    // Outside the rivers the body falls back to dark crust (but keeps 30% base).
    color = mix(uCrust, color, riverIntensity.mul(0.7).add(0.3));

    // 4. Thin bright veins (ridged crack threads) of hot molten over everything.
    const veinRidge = oneMinus(abs(fbm(warped.mul(3.2).add(vec3(0.0, ftime.mul(0.8), 0.0)), 3)));
    const veins = smoothstep(0.72, 0.93, veinRidge);
    const crackHeat = clamp(veins.add(riverIntensity.mul(0.5)), 0.0, 1.0);
    color = color.add(uVein.mul(veins).mul(0.46));

    // 5. Emissive pulse: the magma breathes (sin pulse biased to the molten zones).
    const breathe = sin(uTime.mul(1.6).add(pos.x.mul(0.15)).add(pos.z.mul(0.12)))
        .mul(0.5).add(0.5);
    const heatGlow = riverIntensity.mul(breathe.mul(0.35).add(0.65));
    color = color.add(uRiverBright.mul(heatGlow).mul(0.18));
    color = color.add(uRiverBright.mul(uPulseIntensity).mul(riverIntensity).mul(0.16));

    // §4.1 — FAKE AO instead of voids: where the crust map is DEEPEST, multiply the
    // body DOWN so dark reads as recessed/shadowed rock, not absence. Spared on the
    // molten veins (riverIntensity) so cracks still glow out of the crevices.
    const aoDepth = crustFactor.mul(oneMinus(riverIntensity.mul(0.6)));
    color = color.mul(mix(float(1.0), float(0.65), aoDepth));

    // §4.1 — clamp a minimum luminance floor so the darkest crust is still warm ROCK
    // (above the lit haze), never a see-through near-black hole.
    // Floor lowered with the crust: the old 0.05 floor was itself a mid-band generator,
    // holding every shadowed face above true black no matter how little light reached it.
    color = max(color, vec3(0.012, 0.005, 0.003));

    return { color, glow: heatGlow.add(veins.mul(0.6)), crackHeat };
}

// ── Opaque molten LAVA LAKE (the camera looks ACROSS it) ─────────────────────────
//
// THE #1 FIX. The old additive vertex-displaced PlaneGeometry seen edge-on read as a
// "wall of orange glass triangles." This is now a WIDE (360x360), LIFTED (y=-10),
// LOW-displacement, OPAQUE, NormalBlending, FrontSide, depthWrite lava LAKE: a calm
// mirror the camera looks across, ~70% dark charred crust / ~30% molten, with a
// fresnel grazing-angle reflection toward the cool obsidian toe and a thin bright
// horizon rim. `uDescent` lifts the lake emission as the camera drops toward it.
//
// Exported as `createLavaFloorTSL` (the public API name the plan + earth-core.js use)
// with a `createLavaLakeTSL` alias below for readability at call sites.
export function createLavaFloorTSL(uTime, uPulseIntensity = uniform(0), uDescent = uniform(0), options = {}) {
    const uColorHot = uniform(new THREE.Color(0xff8a24)); // Warm molten orange (hottest veins)
    const uColorMid = uniform(new THREE.Color(0xb83208)); // Deep molten orange
    const uColorCool = uniform(new THREE.Color(0x050206)); // Near-black charred crust
    const uColorReflect = uniform(new THREE.Color(0x091022)); // Complementary cool obsidian sheen (<10%)
    const uLegacyHot = uniform(new THREE.Color(0xffffaa)); // Legacy-floor yellow-white vein cores
    const uQuenchSilver = uniform(new THREE.Color(0x9fc2d4)); // silvery-blue pahoehoe sheen (seam)
    const uQuenchTeal = uniform(new THREE.Color(0x2a9eaa)); // teal quench end-state (seam)
    const uSeam = options.uSeam ?? uniform(0);

    // MOLTEN BASINS (plan: legacy-floor revival). Designated pools along the rail where
    // the legacy additive floor's character returns at full energy — taller swells,
    // yellow-white veins, pulsing hot spots — while the dark-crust value structure owns
    // everything outside them. Centers/radii are baked at build from chapter-local
    // path samples (see createLavaFloor in earth-core.js).
    const basinList = Array.isArray(options.basins) ? options.basins : [];
    const basinMaskAt = (px, pz) => {
        let mask = float(0.0);
        basinList.forEach((b) => {
            const d = length(vec2(px.sub(b.x), pz.sub(b.z)));
            mask = max(mask, smoothstep(float(b.r), float(b.r * 0.4), d));
        });
        return clamp(mask, 0.0, 1.0);
    };

    // ── Vertex displacement → positionNode (gentle bubbling/flowing, NOT shards) ──
    // Plan: bubble*0.35 + flow*0.25 (down from 1.5 + 0.8) and a radial falloff to 0
    // at the rim so the lake reads flat-calm to the far shore, never a jagged wall.
    const posL = positionLocal;
    const vtime = uTime.mul(0.3);
    const bubble = snoise3(vec3(posL.x.mul(0.1), posL.z.mul(0.1), vtime));
    const flow = snoise3(vec3(posL.x.mul(0.05).add(vtime.mul(0.5)), posL.z.mul(0.05), vtime.mul(0.2)));
    const uvCentered = uv().sub(0.5);
    const radial = length(uvCentered);
    const rimFalloff = oneMinus(smoothstep(0.3, 0.55, radial)); // 1 center → 0 rim
    // Basin swells: inside the molten basins the surface rolls like the legacy floor
    // (~3x amplitude); outside them the lake stays the calm mirror the value ladder
    // depends on.
    const basinV = basinMaskAt(posL.x, posL.z);
    const displacement = bubble.mul(0.22).add(flow.mul(0.16))
        .mul(rimFalloff)
        .mul(basinV.mul(2.3).add(1.0))
        .mul(uPulseIntensity.mul(0.4).add(1.0));
    const displaced = vec3(posL.x, posL.y.add(displacement), posL.z);

    const vPos = varying(displaced);
    const vElevation = varying(displacement);
    const vBasin = varying(basinV);

    // ── Fragment temperature field → colorNode ──
    // DOMAIN-WARP the lookup (adapt pyrestorm's flow technique) so the molten reads as
    // meandering RIVERS of glowing lava, not a static amber temperature gradient.
    const ftime = uTime.mul(0.15);
    // Lava lake fbm dropped 4->3 octaves (perf): the largest co-visible surface in the chapter
    // (360x360 opaque plane the camera looks ACROSS); the finest octave is lost in haze + ACES.
    const warp = vec3(
        fbm(vPos.mul(0.035).add(vec3(ftime.mul(0.4), 0.0, 0.0)), 3),
        0.0,
        fbm(vPos.mul(0.035).add(vec3(0.0, 0.0, ftime.mul(0.4)).add(9.0)), 3),
    ).mul(6.0);
    const wPos = vPos.add(warp);
    const flow1 = fbm(wPos.mul(0.06).add(vec3(ftime, 0.0, ftime.mul(0.5))), 3);
    const flow2 = fbm(wPos.mul(0.1).add(vec3(ftime.mul(-0.3), ftime.mul(0.2), 0.0)), 3);
    const cracks = fbm(wPos.mul(0.3).add(vec3(ftime.mul(0.1), 0.0, ftime.mul(0.15))), 3);
    // High-freq crust map: dark charred islands floating in the molten (pyrestorm).
    const crustMap = fbm(wPos.mul(0.5).add(vec3(ftime.mul(0.2), 0.0, 0.0)), 3).add(0.5);
    // WAVE 3a — THE STUDY'S CRUST WINDOW, ported. Wave 1 measured this exact trade three
    // times: at a wide window the lake is a dark floor with smears and stops being a key at
    // all; when the pale stop wins it becomes a cream beach. Crust is the MINORITY on a lake
    // that has to light a cathedral, so the window is narrowed and pushed up.
    const crustFactor = smoothstep(0.60, 0.90, crustMap);

    // Lower base + wider contrast so most of the lake falls into the dark charred
    // crust band (the molten reads as glowing rivers/cracks across dark rock). Inside
    // the molten basins the temperature floor lifts so the pool reads mostly molten.
    const temp = clamp(
        flow1.mul(0.52).add(flow2.mul(0.28)).add(0.24)
            .add(vElevation.mul(0.08))
            .add(vBasin.mul(0.16))
            .mul(uPulseIntensity.mul(0.25).add(1.0)),
        0.0,
        1.0,
    );

    // The pale hot stop is reached only in the thinnest seams — `pow(...,3)` instead of a
    // linear ramp — so the lake body stays molten orange that still reads as melted ROCK.
    const hotMix = mix(uColorMid, uColorHot, pow(clamp(temp.sub(0.7).div(0.3), 0.0, 1.0), 3.0));
    const midMix = mix(uColorCool, uColorMid, temp.sub(0.4).div(0.3));
    const coolMix = uColorCool.mul(temp.div(0.4));
    const lowColor = mix(coolMix, midMix, step(0.4, temp));
    let color = mix(lowColor, hotMix, step(0.7, temp));

    // Float dark charred crust islands over the molten (kills the amber-soup look).
    color = mix(color, uColorCool, crustFactor.mul(0.6));
    // QUANTISED GLITTER (plan §2.3): a hard smoothstep window makes discrete winking glints
    // on the melt seams instead of a smooth specular sheen. It is the cheapest thing in this
    // act that reads as "expensive", and it costs one smoothstep on a field already computed.
    const glint = smoothstep(0.62, 0.70, cracks).mul(oneMinus(crustFactor));
    color = color.add(uColorHot.mul(glint).mul(0.55));

    // Narrow bright molten veins/cracks (threads of glow across dark crust); brighter
    // where the crust has cracked open (no crust chunk on top). Inside the basins the
    // veins return to the legacy floor's yellow-white (#ffffaa cores over the orange
    // flows) at full energy; across the seam every vein quenches to the silvery-blue
    // pahoehoe sheen, then to teal — the ocean's first cyan.
    const veinIntensity = smoothstep(0.5, 0.66, cracks).mul(oneMinus(crustFactor.mul(0.7)));
    const seamMid = smoothstep(0.0, 0.55, uSeam);
    const seamEnd = smoothstep(0.55, 1.0, uSeam);
    let veinColor = mix(uColorHot, uLegacyHot, vBasin.mul(0.85));
    veinColor = mix(mix(veinColor, uQuenchSilver, seamMid), uQuenchTeal, seamEnd);
    color = color.add(veinColor.mul(veinIntensity).mul(vBasin.mul(0.5).add(0.48)));

    // Slow hot spots that pulse (sparse warm highlights, not a wash) — plus the legacy
    // floor's pow-3 pulse spots at full energy inside the basins, beat-reactive like
    // the original createLavaFloor shader.
    const hotSpot = pow(max(0.0, snoise3(wPos.mul(0.18).add(ftime.mul(1.4)))), 4.0);
    const heatAlive = oneMinus(uSeam.mul(0.6)); // molten emission dies across the seam
    color = color.add(uColorHot.mul(hotSpot).mul(0.24).mul(heatAlive));
    color = color.add(uLegacyHot.mul(hotSpot).mul(vBasin).mul(0.55).mul(heatAlive));
    color = color.add(
        uLegacyHot.mul(uPulseIntensity).mul(vBasin)
            .mul(veinIntensity.add(hotSpot)).mul(0.3)
            .mul(heatAlive),
    );

    // Fresnel grazing-angle reflection: at the shallow look-across angle the lake
    // surface picks up a cool obsidian sheen, breaking the monochrome amber (<10%).
    // The lake is horizontal (normal = +Y), so the grazing term is driven by how
    // shallow the view ray is to the surface (small |viewDir.y| → strong fresnel).
    const viewDir = normalize(vPos.sub(cameraPosition));
    const fresnel = pow(oneMinus(clamp(abs(viewDir.y), 0.0, 1.0)), 3.0);
    color = mix(color, uColorReflect, fresnel.mul(0.35));

    // §3.1 Bright hot/dark horizon RIM line: a crisp molten edge where the lake meets
    // the far wall (the rim ring of the wide plane), so the floor reads as having a
    // far EDGE and the cavern a size. Driven off the centred radial: a thin bright
    // band near the rim, fading to charred just outside it. `uDescent` lifts it as the
    // camera nears the lake (the far shore opens up on the descent reveal).
    const rimBand = smoothstep(0.34, 0.42, radial)
        .mul(oneMinus(smoothstep(0.42, 0.5, radial)));
    const rimPulse = sin(uTime.mul(0.8).add(radial.mul(40.0))).mul(0.12).add(0.88);
    const rimGlow = rimBand.mul(rimPulse).mul(uDescent.mul(0.5).add(0.6));
    color = color.add(uColorHot.mul(rimGlow).mul(1.65)); // brightened from 0.85 to 1.65
    // Beyond the rim the lake falls to near-black charred shore (the dark vault meets).
    const beyondRim = smoothstep(0.5, 0.62, radial);
    color = mix(color, uColorCool, beyondRim.mul(0.85));

    // §5.5 (cheap) heat-shimmer: wobble the molten read in the lower/near frame by a
    // small sin(uTime + worldY) so the lake surface visibly RIPPLES with heat. No pass.
    const shimmer = sin(uTime.mul(1.7).add(vPos.x.mul(0.08)).add(vPos.z.mul(0.06)))
        .mul(0.04).add(1.0);
    color = color.mul(shimmer);

    // Descent drama: the lake glows hotter as the camera drops toward it. Capped low
    // so the dark crust stays dark (no orange-slab blowout).
    const descentLift = uDescent.mul(0.18).add(0.92);
    color = color.mul(uPulseIntensity.mul(0.2).add(descentLift));

    // §5.6 atmospheric depth (manual for MeshBasic): mix toward the warm haze color
    // with camera distance so the far reaches of the wide lake desaturate into fog and
    // the near surface stays crisp — the depth cue lit materials get free from fogNode.
    const camDist = length(vPos.sub(cameraPosition));
    const haze = vec3(0.055, 0.018, 0.016); // cooler dark smoke medium
    const fogAmt = smoothstep(120.0, 320.0, camDist).mul(0.35);
    color = mix(color, haze, fogAmt);

    // Cap the displayed emission below 1.0 (soft) so ACES+bloom gild, never clip.
    // Basin vein cores may cross the 0.85 bloom threshold (sanctioned "vein centers"
    // in the palette law); outside the basins the original cap holds the dark-crust
    // value ladder, and the white-hot #ffe6b0 tier stays reserved for the First Heart.
    const cap = mix(vec3(0.78, 0.46, 0.26), vec3(0.93, 0.9, 0.62), vBasin);
    color = min(color, cap);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    material.colorNode = color;
    material.transparent = false;
    material.side = THREE.FrontSide;
    material.depthWrite = true;
    material.blending = THREE.NormalBlending;
    material.userData.emitsBloom = true;
    material.userData.uniforms = {
        uColorHot, uColorMid, uColorCool, uColorReflect, uLegacyHot, uSeam,
    };

    // §3.1 Widen the readable floor to 360×360 so the lake is visible ACROSS the whole
    // descent (the single highest-impact composition change).
    const geometry = new THREE.PlaneGeometry(360, 360, 72, 72);
    geometry.rotateX(-Math.PI / 2); // Horizontal lake
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = LAVA_LAKE_Y; // Lifted: the camera looks ACROSS a wide lake
    mesh.name = 'lava-lake';
    return { mesh, material, geometry };
}

// ── Distant LAVA-FALL hero (tall additive plane, downward molten streak) ──────────
//
// A focal scale-cue: a tall plane far down the corridor, biased off-centre, with a
// downward-scrolling FBM molten streak (hot core → mid shoulder, side-feathered to 0)
// and a glowing splash pool at the lake line. Additive + capped + feathered so it
// blooms soft, never clips. `uDescent` brightens it as the camera descends toward it.
export function createLavaFallTSL(uTime, uPulseIntensity = uniform(0), uDescent = uniform(0), options = {}) {
    const uOpacity = options.uOpacity ?? uniform(1);
    const uHot = uniform(new THREE.Color(0xffb45a)); // molten core
    const uMid = uniform(new THREE.Color(0xf0520b)); // deep ember shoulder
    const uCool = uniform(new THREE.Color(0x180400)); // charred margins

    const uvc = uv();
    const { x } = uvc;
    const { y } = uvc; // 0 at bottom (splash) → 1 at top (lip)

    // §5.5 (cheap) heat-shimmer: wobble the sampled uv by sin(uTime + worldY)*small so
    // the falling molten visibly shears with rising heat (strongest near the splash).
    const shimmer = sin(uTime.mul(2.2).add(y.mul(9.0))).mul(0.012).mul(oneMinus(y).add(0.3));
    const xs = x.add(shimmer);

    // Downward-scrolling FBM streak: the molten falls, so the noise field scrolls UP
    // in uv (the surface appears to move down). Vertical stretch for streaky flow.
    const streakP = vec3(xs.mul(5.0), y.mul(2.2).add(uTime.mul(0.5)), uTime.mul(0.1));
    // 3 octaves (was default 4): the lava-fall is a distant, additive, edge-feathered
    // plane; the 4th octave (amp 0.0625, ~8x/~16x freq) is sub-pixel here — same
    // proven-safe class as the 4->3 rock-field cut. Trims 2 snoise3 off ch1's cold compile.
    const streak = fbm(streakP, 3).mul(0.5).add(0.5);
    const streak2 = fbm(streakP.mul(2.0).add(vec3(0.0, uTime.mul(0.8), 0.0)), 3).mul(0.5).add(0.5);
    const flowField = streak.mul(0.65).add(streak2.mul(0.35));

    // The falling column is a vertical band centred horizontally; columns of molten.
    const columnMask = oneMinus(smoothstep(0.0, 0.42, abs(xs.sub(0.5))));
    const intensity = clamp(flowField.mul(columnMask), 0.0, 1.0);

    // Glowing splash pool: a bright bloom at the base where the fall hits the lake.
    const splash = oneMinus(smoothstep(0.0, 0.2, y))
        .mul(oneMinus(smoothstep(0.0, 0.55, abs(xs.sub(0.5)))));
    const splashPulse = sin(uTime.mul(2.0)).mul(0.15).add(0.85);

    const heat = clamp(intensity.add(splash.mul(splashPulse).mul(0.7)), 0.0, 1.0);

    let color = mix(uCool, uMid, smoothstep(0.0, 0.55, heat));
    color = mix(color, uHot, smoothstep(0.5, 1.0, heat));
    const descentLift = uDescent.mul(0.34).add(0.95);
    color = color.mul(uPulseIntensity.mul(0.2).add(descentLift));
    color = min(color, vec3(0.95, 0.88, 0.78));

    // Side + top/bottom feather to 0 BEFORE the quad edge so there is no hard rect.
    const sideFeather = smoothstep(0.0, 0.18, x).mul(oneMinus(smoothstep(0.82, 1.0, x)));
    const topFeather = oneMinus(smoothstep(0.86, 1.0, y));
    const bottomFeather = smoothstep(0.0, 0.05, y);
    const alpha = heat.mul(sideFeather).mul(topFeather).mul(bottomFeather).mul(0.86)
        .mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge (ChapterEnvironmentManager)
    material.userData.uniforms = { uHot, uMid, uCool };

    const geometry = new THREE.PlaneGeometry(96, 220, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'lava-fall';
    return { mesh, material, geometry };
}

// ── Vertical god-ray cone (low-opacity ember-light shaft over the lake) ───────────
//
// A large, low-opacity vertical cone of warm light suggesting a shaft punching down
// through the ash to the lake. Additive, very low alpha, radial-feathered, renderOrder
// behind the set pieces. 3–4 of these are placed by earth-core.js. No hard edges.
export function createGodRayConeTSL(uTime, uPulseIntensity = uniform(0), options = {}) {
    const uOpacity = options.uOpacity ?? uniform(1);
    const uTint = uniform(new THREE.Color(0xff8a2e));

    const uvc = uv();
    // Cone uv: ConeGeometry side uv maps `y` along the height (0 bottom/tip → 1
    // top/base) and `x` around the circumference. Brighter near the top (the light
    // source) fading toward the tip, with a soft top/bottom feather; the conical
    // geometry itself provides the volumetric silhouette (no angular-seam masking).
    const yBand = uvc.y;
    const vertical = smoothstep(0.0, 0.3, yBand).mul(oneMinus(smoothstep(0.8, 1.0, yBand)));
    const shimmer = sin(uTime.mul(0.6).add(uvc.y.mul(4.0))).mul(0.12).add(0.88);

    // §5.4 (cheap) depth-fade: a true soft-particle edge-fade reads scene depth (a post
    // pass — DEFERRED). The cheap material-level version fades the cone out as it nears
    // the camera so it never hard-cuts through a near geode (the worst "pops through"
    // tell): grazing the camera = transparent, far = full. No depth texture needed.
    const camDist = length(positionWorld.sub(cameraPosition));
    const nearFade = smoothstep(8.0, 28.0, camDist);

    const intensity = clamp(vertical.mul(shimmer), 0.0, 1.0);
    const color = uTint.mul(uPulseIntensity.mul(0.15).add(1.0));
    const alpha = intensity.mul(nearFade).mul(0.06).mul(uOpacity); // plan: ~0.06 low-opacity cones

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = min(color, vec3(0.9, 0.82, 0.7));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = { uTint };

    // Open cone (wide base at top sky, narrow toward the lake): tip down.
    const geometry = new THREE.ConeGeometry(26, 120, 16, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'god-ray-cone';
    mesh.renderOrder = -8;
    return { mesh, material, geometry };
}

// ── Volcanic background sphere (-90 backstop; must NOT bloom) ─────────────────────
//
// Darker vault ceiling for the value hierarchy: the dome is near-black charred rock
// with only a low warm GLOW BAND at the bottom (the lake's reflected light) so ~70%
// of the frame is deep rock and the molten reads as figure against ground.
export function createVolcanoBackgroundTSL(uTime, uPulseIntensity = uniform(0)) {
    const posL = positionLocal;
    const dir = normalize(posL);

    // Deep charred vault gradient — near-black ceiling, faint warm floor.
    const core = vec3(0.034, 0.009, 0.006); // warm dark red toward the lake (lower)
    const outer = vec3(0.006, 0.004, 0.016); // near-black charred cool-purple ceiling (darker)
    const t = dir.y.mul(0.5).add(0.5);
    let color = mix(outer, core, t);

    // Low warm glow band only at the very bottom (the lake's reflected light).
    const lavaGlow = smoothstep(0.0, 0.45, dir.y.negate());
    const pulse = sin(uTime.mul(0.5)).mul(0.5).add(0.5);
    color = color.add(vec3(0.075, 0.018, 0.006).mul(lavaGlow).mul(pulse.mul(0.32).add(0.48)));
    color = color.add(vec3(0.045, 0.012, 0.004).mul(uPulseIntensity).mul(lavaGlow));

    // §Enclosure (plan item 6) — the frames-15/16 swirling treatment promoted
    // chapter-wide: domain-warped RIDGED convection so the vault reads as dimensional
    // red-brown churn (the missing ember-red midtone band #3a0d04→#5e0a00), never a
    // milky banded wash and never >50% void.
    const swirlTime = uTime.mul(0.012);
    const warpField = vec3(
        fbm3(dir.mul(1.3).add(vec3(swirlTime, 0.0, 0.0)), 3),
        fbm3(dir.mul(1.3).add(vec3(4.0, swirlTime.mul(0.8), 0.0)), 3),
        fbm3(dir.mul(1.3).add(vec3(0.0, 9.0, swirlTime.mul(0.6))), 3),
    ).mul(0.55);
    const conv = clamp(
        // ridged3 4->3 octaves (perf): full-screen backstop dome, capped below every set piece.
        ridged3(dir.mul(2.4).add(warpField).add(vec3(0.0, swirlTime.mul(0.5), 0.0)), 3),
        0.0,
        1.0,
    );
    // Convection belt strongest in the lower/mid vault (the band frames 09–13 missed).
    const beltMask = smoothstep(-0.78, -0.2, dir.y).mul(oneMinus(smoothstep(0.02, 0.5, dir.y)));
    // WAVE 3a — THE MID-WASH LIVES HERE. Measured in-game: the shipped chapter puts 46 % of
    // its pixels in the luma 32-96 band, and this belt is the largest single contributor —
    // a broad ember field at linear 0.23-0.37 painted across the whole vault, which is why
    // Phase 0 read the frame as "~90 % mid-red" while its BLACKS were fine.
    //
    // The fix is the Wave 1 device, not a brightness cut: the wash is DARKNESS-GATED and
    // CONTRAST-SHAPED, so ember survives as filaments where the lake's key does not reach and
    // vanishes where it does. `conv` is already ridged; squaring it turns a field into veins.
    const emberWash = mix(vec3(0.227, 0.051, 0.016), vec3(0.369, 0.039, 0.012), conv);
    const convVeins = conv.mul(conv);
    const keyReachBackdrop = pow(clamp(oneMinus(dir.y.mul(0.5).add(0.5)), 0.0, 1.0), 3.2);
    const darknessGate = oneMinus(keyReachBackdrop);
    color = color.add(emberWash.mul(convVeins).mul(beltMask).mul(darknessGate).mul(0.30));
    // Faint mottle on the ceiling so the upper vault reads as rock, not a flat void.
    color = color.add(vec3(0.05, 0.016, 0.01).mul(conv).mul(smoothstep(0.05, 0.7, dir.y)).mul(0.45));
    // Backdrop discipline: this is still the backstop — capped below every set piece.
    color = min(color, vec3(0.3, 0.1, 0.06));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.side = THREE.BackSide;
    material.depthWrite = false;

    const geometry = new THREE.SphereGeometry(250, 32, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'volcano-background';
    mesh.renderOrder = -90;
    return { mesh, material, geometry };
}

// ── Obsidian geode (solid LIT magma boulder; smooth sphere silhouette) ───────────
//
// §4.2/§4.3/§4.4: a SOLID lit boulder. The body was reading as holey because (a) the
// vertex push created slivers/facets, (b) the fresnel used a stale fixed +Z reference
// (silhouette banding), and (c) it was an unlit MeshBasic that could not fall into
// shadow or occlude with a real albedo. Now:
//   - Option B: no vertex displacement; the SphereGeometry silhouette stays clean;
//   - fresnel is view-correct (pow(1-|dot(nView,viewDir)|,3)) tinted warm + a cool
//     shadow-side term;
//   - it is a MeshStandardNodeMaterial (dark charred albedo + emissive ONLY on hot
//     veins) so it shares the chapter's 2-light key + a baked lake-distance bounce and
//     occludes properly. No new PointLights.
// -- Pyroclastic magma-cloud canopy ------------------------------------------------
//
// A separate inner sky layer adapted from pyrestorm's storm-cloud shader: multi-layer
// FBM density, slow churning motion, dark cool smoke, and lava-lit internal pockets.
// It sits just inside the background sphere so Chapter 1 gets an overhead "magma sky"
// instead of a flat red/black dome.
export function createMagmaCloudCanopyTSL(uTime, uPulseIntensity = uniform(0), options = {}) {
    const uOpacity = options.uOpacity ?? uniform(1);
    const dir = normalize(positionLocal);
    const cloudPos = dir.mul(3.0);
    const motion = vec3(uTime.mul(0.018), uTime.mul(0.012), uTime.mul(0.009));

    // Canopy fbm dropped 4->3 octaves (perf): a depthTest:false full-overdraw sky deck behind
    // everything; the density smoothstep below clips the finest octave to nothing.
    const cloud1 = fbm(cloudPos.add(motion), 3);
    const cloud2 = fbm(cloudPos.mul(2.05).sub(motion.mul(0.62)), 3);
    const cloud3 = fbm(cloudPos.mul(0.55).add(motion.mul(0.38)), 3);
    const densityRaw = cloud1.mul(0.52).add(cloud2.mul(0.32)).add(cloud3.mul(0.24));

    // Keep the deck mostly above/around the corridor. The very top is thinner, so the
    // sky has volume and holes instead of becoming a solid ceiling cap.
    const ceilingMask = smoothstep(-0.32, 0.46, dir.y)
        .mul(oneMinus(smoothstep(0.88, 1.0, dir.y).mul(0.32)));
    const density = smoothstep(-0.16, 0.48, densityRaw).mul(ceilingMask);

    const glowNoise = fbm(cloudPos.mul(2.35).add(vec3(0.0, uTime.mul(-0.08), 0.0)), 3)
        .add(0.5);
    const internalGlow = smoothstep(0.42, 0.86, glowNoise);
    const underLight = oneMinus(smoothstep(0.12, 0.78, dir.y)).mul(density);
    const pulse = sin(uTime.mul(0.55)).mul(0.15).add(0.85);

    let color = vec3(0.014, 0.010, 0.026)
        .add(vec3(0.070, 0.018, 0.012).mul(density));
    // WAVE 3a — THIS CEILING IS THE ACT'S BIGGEST SURFACE AND ITS BIGGEST WASH. The in-game
    // capture is unambiguous: the canopy fills the entire upper half of the frame as one
    // saturated red mass, which is what makes the chapter read as "all mid-red" no matter what
    // the rock and the lake do. (Two earlier attempts moved the backdrop sphere and the rock
    // bounce instead, and neither is what the camera is actually looking at.)
    //
    // Halved toward the vault's charred base, and the ceiling ceiling is dropped: a cloud lit
    // from below by a lake should be a dark vault with fire UNDER it, not a red sky.
    color = color.add(vec3(0.26, 0.062, 0.016).mul(internalGlow).mul(underLight).mul(pulse)
        .mul(0.58));
    color = color.add(vec3(0.09, 0.020, 0.008).mul(uPulseIntensity).mul(underLight));
    color = min(color, vec3(0.22, 0.10, 0.055));

    const alpha = density.mul(0.62).mul(smoothstep(-0.22, 0.28, dir.y).add(0.18)).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.BackSide;
    material.blending = THREE.NormalBlending;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge

    const geometry = new THREE.SphereGeometry(238, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'magma-cloud-canopy';
    mesh.renderOrder = -89;
    return { mesh, material, geometry };
}

export function createRockClusterMaterialTSL(
    uTime,
    uPulseIntensity = uniform(0),
    uBakedBounce = uniform(1),
    options = {},
) {
    const uSeam = options.uSeam ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uColorPrimary = uniform(new THREE.Color(0x9c2e06)); // dimmer hot orange (crack glow)
    const uColorSecondary = uniform(new THREE.Color(0x2a0804)); // deep near-black rock body
    const uColorTertiary = uniform(new THREE.Color(0xff7711)); // hottest crack core (warm-orange instead of 0xffcc66)
    const uHot = uniform(new THREE.Color(0xe94b0a)); // hottest emissive vein core (warm-orange instead of 0xffc066)

    const posL = positionLocal;
    const nrm = normalize(normalLocal);
    const displaced = posL;
    const recomputedNormal = nrm;

    const vNormal = varying(recomputedNormal);
    const vPos = varying(posL);
    const vWorldY = varying(positionWorld.y);
    const vLakeDist = varying(length(positionWorld.xz.sub(vec2(LAKE_CENTER_X, LAKE_CENTER_Z))));

    // ── Fragment: a HOT MAGMA BOULDER (pyrestorm lava-river look), not a flat decal ──
    // Pool molten into the down-/inward-facing crevices so the boulder reads gravity-lit
    // (top crust dark, undersides glowing) rather than a uniform crackle wrapped on it.
    const pool = clamp(oneMinus(vNormal.y).mul(0.6).add(0.2), 0.0, 1.0);
    const { color: field, glow, crackHeat } = moltenRockField(
        vPos.mul(0.9),
        uTime,
        uPulseIntensity,
        float(-0.18), // boulder heat bias: supporting crusty rock, not a hero orb
        pool,
    );
    let color = mix(field, uColorSecondary, 0.35);

    // Subtle cool sub-surface glow in the deepest cracks (complementary accent <10%).
    const deepCrack = smoothstep(0.7, 0.92, crackHeat);
    color = color.add(vec3(0.03, 0.07, 0.10).mul(deepCrack).mul(0.22));

    // §4.3 View-correct fresnel rim: warm where the rim is already molten, with a small
    // COOL term on the shadow side (warm/cool edge separation) so the silhouette is
    // carved from the haze as the camera dollies (no fixed +Z banding).
    const fresnel = viewFresnel(3.0, transformNormalToView(recomputedNormal));
    const warmRim = uColorPrimary.mul(glow.mul(0.5).add(0.25));
    const coolRim = vec3(0.039, 0.102, 0.149); // ~0x0a1a26 cool shadow-side accent
    const shadowSide = oneMinus(clamp(vNormal.y.mul(0.5).add(0.5), 0.0, 1.0));
    color = color.add(mix(warmRim, coolRim.mul(0.6), shadowSide.mul(0.5)).mul(fresnel));

    // §5.2 Lake-distance grounding gradient: near the lake the boulder picks up a warm
    // baked bounce; far away it goes charred. Capped low (holds the ~70% dark).
    const lakeFalloff = oneMinus(clamp(vLakeDist.div(140.0), 0.0, 1.0)); // 1 near → 0 far
    // WAVE 3a — THE KEY COMES FROM BELOW, SO THE BOUNCE MUST TOO. This term reached the whole
    // cluster at `lakeFalloff*0.8 + 0.2` — a floor of 0.2 everywhere, including crowns metres
    // above the lake — which is why the rock glowed red base to crown with no charred anchor.
    // Gating by HEIGHT ABOVE THE LAKE turns an ambient wash back into a bounce, and deleting
    // the floor is the point: a floor is what made it ambient.
    const aboveLake = clamp(vWorldY.sub(float(LAVA_LAKE_Y)).div(46.0), 0.0, 1.0);
    const bounceReach = pow(oneMinus(aboveLake), 2.0);
    const bakedWarm = vec3(0.14, 0.045, 0.012)
        .mul(lakeFalloff.mul(0.85).add(0.05))
        .mul(bounceReach)
        .mul(uBakedBounce);
    color = color.add(bakedWarm);

    // §5.1 Emissive BLEED on the base: where the boulder sits low (near the lake line)
    // the lava licks its underside, so the lowest band glows warm.
    const baseBleed = oneMinus(smoothstep(LAVA_LAKE_Y, LAVA_LAKE_Y + 10.0, vWorldY));

    color = color.mul(uPulseIntensity.mul(0.15).add(1.0));
    color = min(color, vec3(0.62, 0.34, 0.18));

    // §4.4 — a real lit SOLID: dark charred albedo, emissive ONLY on the hottest veins
    // (dark crust contributes ZERO bloom), roughness 0.85 / metalness 0.05, opaque.
    const material = new THREE.MeshStandardNodeMaterial();
    material.positionNode = displaced;
    material.normalNode = transformNormalToView(recomputedNormal);
    material.colorNode = color;
    material.emissiveNode = uHot.mul(pow(crackHeat, 3.0)).mul(0.28)
        .add(uColorPrimary.mul(glow).mul(0.08))
        .add(uHot.mul(baseBleed).mul(0.14)) // base bleed near the lake
        .mul(oneMinus(uSeam.mul(0.7))); // hot veins quench as the waterline rises
    // Plan item 5 + seam choreography: a camera-proximity fade kills the frame-07
    // near-clip class (a geode can never fill the lens as raw planes), and the uSeam
    // term is the authored sink-and-fade so no magma sphere survives past the
    // frame-18 equivalent. uOpacity is the manager-driven ecotone bridge.
    const camDistGeode = length(positionWorld.sub(cameraPosition));
    material.opacityNode = uOpacity
        .mul(smoothstep(5.0, 14.0, camDistGeode))
        .mul(oneMinus(uSeam));
    material.roughness = 0.85;
    material.metalness = 0.05;
    material.transparent = true; // authored at build (QW5) so the fades above can act
    material.depthWrite = true;
    material.blending = THREE.NormalBlending;
    material.side = THREE.FrontSide;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = {
        uColorPrimary, uColorSecondary, uColorTertiary, uHot, uBakedBounce, uSeam,
    };

    return { material };
}

/**
 * Build a single obsidian geode mesh (solid sphere) using the TSL rock-cluster
 * material. Smooth, dark, lit, with narrow glowing cracks. `uBakedBounce` feeds the
 * lake-distance grounding bounce (defaulted so existing callers stay compatible).
 */
export function createRockClusterTSL(
    uTime,
    uPulseIntensity = uniform(0),
    size = 6,
    uBakedBounce = uniform(1),
    options = {},
) {
    const { material } = createRockClusterMaterialTSL(uTime, uPulseIntensity, uBakedBounce, options);
    const geometry = new THREE.SphereGeometry(size, 32, 32);
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh, material, geometry };
}

// ── Magma-horizon glow band (far up-corridor backstop; bloom-eligible) ───────────
//
// A large additive emissive plane placed far ahead so a low forward camera sees a
// READABLE LAVA-LAKE HORIZON LINE (a crisp hot/dark band) at the far shore, not bare
// void. A thin bright rim band makes the lake edge read as a sharp hot/dark LINE; the
// charred margins go near-black `0x050100`. Capped + feathered (no hard edge/blowout).
export function createMagmaHorizonTSL(uTime, uPulseIntensity = uniform(0), options = {}) {
    const uOpacity = options.uOpacity ?? uniform(1);
    const uHot = uniform(new THREE.Color(0xff7a1e)); // molten core of the band
    const uWarm = uniform(new THREE.Color(0x4a1002)); // deep ember red shoulder
    const uCool = uniform(new THREE.Color(0x050100)); // charred margins (near-black)

    const uvc = uv();
    const band = uvc.y;
    const horizonLine = float(0.32);
    const belowHorizon = oneMinus(smoothstep(0.0, horizonLine, band)); // 1 at bottom
    const glowBand = smoothstep(0.0, horizonLine, band)
        .mul(oneMinus(smoothstep(horizonLine, horizonLine.add(0.2), band)));

    // A thin bright rim band exactly at the horizon line so the lake edge is a LINE.
    const rim = smoothstep(horizonLine.sub(0.02), horizonLine, band)
        .mul(oneMinus(smoothstep(horizonLine, horizonLine.add(0.03), band)));

    const ripple = snoise3(vec3(uvc.x.mul(6.0), band.mul(3.0), uTime.mul(0.12)))
        .mul(0.5).add(0.5);
    const heat = clamp(
        glowBand.mul(ripple.mul(0.55).add(0.55)).add(belowHorizon.mul(0.45)).add(rim.mul(0.8)),
        0.0,
        1.0,
    );

    let color = mix(uCool, uWarm, smoothstep(0.0, 0.6, heat));
    color = mix(color, uHot, smoothstep(0.55, 1.0, heat));
    color = color.mul(uPulseIntensity.mul(0.2).add(1.0));
    color = min(color, vec3(0.92, 0.84, 0.72));

    const sideFeather = smoothstep(0.0, 0.16, uvc.x)
        .mul(oneMinus(smoothstep(0.84, 1.0, uvc.x)));
    const vFeather = smoothstep(0.0, 0.06, band)
        .mul(oneMinus(smoothstep(0.82, 1.0, band)));
    const alpha = heat.mul(sideFeather).mul(vFeather).mul(0.82).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = { uHot, uWarm, uCool };

    const geometry = new THREE.PlaneGeometry(560, 200, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'magma-horizon';
    mesh.renderOrder = -85;
    return { mesh, material, geometry };
}

// ── Molten volumetric haze (instanced additive puffs hugging the path) ───────────
//
// Warm glowing haze filling the camera corridor. Instanced billboard quads; radial
// feather to 0 at the quad edge; additive + low opacity so layers build softly.
export function createMoltenHazeMaterialTSL(uTime, uPulseIntensity = uniform(0), options = {}) {
    const uOpacity = options.uOpacity ?? uniform(1);
    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');
    const aSize = attribute('aSize', 'float');

    const t = uTime.mul(0.18).add(aSeed.mul(6.2831));
    const sway = vec3(
        sin(t).mul(2.2),
        sin(t.mul(0.7).add(aSeed)).mul(1.4),
        cos(t.mul(0.6)).mul(2.2),
    );
    const center = aBase.add(sway);
    const worldSize = aSize.mul(uPulseIntensity.mul(0.12).add(1.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, worldSize);

    // §5.5 (cheap) heat-shimmer: wobble the sprite uv by sin(uTime + worldY) so the
    // warm haze visibly shears with rising heat (strongest low, near the lava).
    const heatWobble = sin(uTime.mul(1.3).add(center.y.mul(0.25)).add(aSeed.mul(7.0)))
        .mul(0.03);
    const p = uv().sub(0.5).add(vec2(heatWobble, 0.0));
    const dist = length(p).mul(2.0);
    const feather = pow(clamp(oneMinus(dist), 0.0, 1.0), 1.7);
    const flick = sin(uTime.mul(0.9).add(aSeed.mul(12.0))).mul(0.12).add(0.88);

    // §5.6 distance-graded haze: warmer + denser FAR, thinner + cooler NEAR, so the
    // puffs read as depth-stacked atmosphere (the cheap atmospheric-perspective win).
    const camDist = length(center.sub(cameraPosition));
    const depthT = smoothstep(40.0, 220.0, camDist); // 0 near → 1 far
    // Darkened with the backdrop (Wave 3a): haze is the SECOND broad wash, and it sits in
    // front of everything, so its mid-band contribution is paid at full screen coverage. Warm
    // smoke should be the thing you see the cavern THROUGH, not a layer of its own.
    const nearTint = mix(vec3(0.13, 0.032, 0.015), vec3(0.32, 0.10, 0.026), aSeed);
    const farTint = vec3(0.19, 0.055, 0.030); // warm smoke, not full orange fog
    const tint = mix(nearTint, farTint, depthT);

    material.colorNode = tint.mul(flick).mul(uPulseIntensity.mul(0.15).add(1.0));
    // Lifted 0.12→0.16: enough warm mid-depth fog to backfill the dead-red gaps the
    // screenshots showed without breaking the ~70% dark value hierarchy or blowing out.
    // Denser far (depthT) so distant assets fade into the medium; a near-fade keeps a
    // puff from hard-cutting through a near geode (§5.7 cheap soft-particle proxy).
    const nearFade = smoothstep(6.0, 22.0, camDist);
    material.opacityNode = feather.mul(depthT.mul(0.08).add(0.095)).mul(nearFade).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge

    return { material };
}

// ── Contact-shadow / radial-AO decal (grounding) ─────────────────────────────────
//
// §5.1 — a small dark radial-feathered quad laid flat at the lake/ledge line under each
// column/shelf/geode to fake the ambient-occlusion contact a prop casts where it meets
// the surface (the #1 grounding cue). NormalBlending toward near-black, depthWrite
// false, renderOrder just above the lake so it composites over the molten floor without
// z-fighting. `opacityNode = pow(1 - dist, 2)`.
export function createContactShadowDecalTSL(size = 12, uOpacity = uniform(1)) {
    const uShadow = uniform(new THREE.Color(0x0a0301)); // near-black contact pool

    const p = uv().sub(0.5);
    const dist = clamp(length(p).mul(2.0), 0.0, 1.0); // 0 center → 1 edge
    const feather = pow(oneMinus(dist), 2.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uShadow;
    material.opacityNode = feather.mul(0.82).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = { uShadow };

    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2); // lay flat on the lake/ledge
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'contact-shadow';
    mesh.renderOrder = 6; // after the lake, stable enough to read as contact AO
    return { mesh, material, geometry };
}

// ── Molten pocket / obsidian column shelf (solid; narrow glowing cracks) ──────────
//
// A dark obsidian shelf beside each level node, and (via createObsidianColumnTSL)
// near-black silhouetted foreground columns at corridor corners (repoussoir). Solid
// rock that occludes; only narrow cracks glow (bloom-eligible).
export function createMoltenPocketMaterialTSL(
    uTime,
    uPulseIntensity = uniform(0),
    uBakedBounce = uniform(1),
    isColumnOrOptions = false,
) {
    const options = typeof isColumnOrOptions === 'object' ? isColumnOrOptions : {};
    const isColumn = typeof isColumnOrOptions === 'boolean'
        ? isColumnOrOptions
        : Boolean(options.isColumn);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uSeam = options.uSeam ?? uniform(0);
    const uRock = uniform(new THREE.Color(0x0d0604)); // darker charred obsidian
    const uCrack = uniform(new THREE.Color(0xff5a14)); // molten crack glow
    const uHot = uniform(new THREE.Color(isColumn ? 0xcc4400 : 0xffc066)); // dimmer/warmer for columns

    const posL = positionLocal;
    const vPos = varying(posL);
    const vNormal = varying(normalize(normalLocal));
    const vWorldY = varying(positionWorld.y);
    const vLakeDist = varying(length(positionWorld.xz.sub(vec2(LAKE_CENTER_X, LAKE_CENTER_Z))));

    // ── Pyrestorm lava-river field on the rock (rivers + crust chunks + veins) ──
    // Columns/shelves are repoussoir framing, so keep them mostly charred (low heat
    // bias) — but molten POOLS into the down-facing crevices so the pillars glow from
    // within their cracks instead of wearing a flat crackle decal. This kills the
    // "tiled cracked rock" look the user flagged while keeping the dark silhouette.
    const downFace = clamp(oneMinus(vNormal.y).mul(0.5).add(0.25), 0.0, 1.0);
    const heatBias = float(isColumn ? -0.30 : -0.04);
    const { color: field, glow, crackHeat } = moltenRockField(
        vPos.mul(0.55),
        uTime,
        uPulseIntensity,
        heatBias, // low heat bias: mostly charred framing rock
        downFace,
    );

    const upFace = clamp(vNormal.y.mul(0.5).add(0.5), 0.0, 1.0);
    // Plan item 3 — light the black cones: a lake-distance falloff feeds the vein/rim
    // energy so pillars rising from the molten read warm-lit while far strata stay
    // charred. Zero pure-black untextured shapes (acceptance criterion).
    const lakeFalloff = oneMinus(clamp(vLakeDist.div(160.0), 0.0, 1.0));
    let color = mix(uRock, field, float(isColumn ? 0.24 : 0.42)); // pockets read as ledges, not hero boulders
    color = color.add(
        uHot.mul(pow(crackHeat, 3.0))
            .mul(isColumn ? lakeFalloff.mul(0.11).add(0.09) : float(0.16)),
    );
    color = color.add(vec3(0.14, 0.04, 0.01).mul(upFace).mul(isColumn ? 0.045 : 0.14));

    // §4.3 View-correct fresnel rim (consistency with the geode): a warm grazing edge
    // tinted by how molten the rim already is + a small cool shadow-side term. Carves
    // the near-black silhouette out of the haze without a fixed +Z banding.
    const rim = viewFresnel(isColumn ? 4.0 : 3.0); // pow-4 column rim (Pyrestorm grammar)
    const coolRim = vec3(0.039, 0.102, 0.149); // ~0x0a1a26 cool shadow-side accent
    const shadowSide = oneMinus(upFace);
    const warmRim = uCrack.mul(glow.mul(0.4).add(0.2))
        .mul(isColumn ? lakeFalloff.mul(0.25).add(0.32) : float(0.42));
    color = color.add(mix(warmRim, coolRim.mul(0.5), shadowSide.mul(0.45)).mul(rim));

    // §5.1 Emissive BLEED on the base near the lake line: the lava licks the lowest
    // band so the column/shelf base glows as if it sits IN the lake.
    const baseBleed = oneMinus(smoothstep(LAVA_LAKE_Y, LAVA_LAKE_Y + 12.0, vWorldY));
    color = color.add(uHot.mul(baseBleed).mul(isColumn ? 0.14 : 0.08));

    color = color.mul(uPulseIntensity.mul(0.12).add(1.0));

    // PERF (QW9): the 4 crater-accent PointLights + per-cluster magma-bounce
    // PointLights were removed from the chapter (the lava key + one glow remain).
    // Those lights almost exclusively washed warm fill onto THIS dark-rock material
    // (the geodes/horizon/lake are unlit MeshBasic). Bake their contribution as a
    // baked emissive warm floor here so the shelves/columns still read as warm-lit
    // rock in a populated cavern WITHOUT per-fragment light iterations. Biased to the
    // up-/side-facing faces (where rim/accent light pooled), capped low so the body
    // stays ~70% near-black. `bakedBounce`=0 restores the old (lit-only) look.
    const bake = uBakedBounce.mul(0.5).add(0.5); // hemisphere fill (sky-up bias)
    const bakedWarm = vec3(0.16, 0.052, 0.014)
        .mul(bake.mul(0.7).add(0.18)) // ambient bounce floor + up-face bias
        .mul(uBakedBounce);
    color = color.add(bakedWarm);

    const material = new THREE.MeshStandardNodeMaterial();
    material.colorNode = color;
    material.emissiveNode = uCrack.mul(glow).mul(isColumn ? 0.10 : 0.38)
        // Plan item 3: fbm-traced emissive veining on the columns, scaled by the
        // baked-bounce strength and the lake-distance falloff.
        .add(uHot.mul(pow(crackHeat, isColumn ? 2.2 : 3.0))
            .mul(isColumn ? lakeFalloff.mul(0.17).add(0.08).mul(uBakedBounce) : float(0.14)))
        // Baked accent/bounce emissive — a dim warm self-illumination on the
        // up/side faces so the rock glows softly as if lit by the removed PointLights.
        .add(uHot.mul(bake).mul(uBakedBounce).mul(isColumn ? 0.008 : 0.025))
        // §5.1 emissive BLEED — the base glows where the lava licks it (lake line).
        .add(uHot.mul(baseBleed).mul(isColumn ? 0.11 : 0.07));
    material.opacityNode = uOpacity.mul(isColumn ? float(1.0) : oneMinus(uSeam.mul(0.96)));
    material.transparent = true;
    material.depthWrite = isColumn;
    material.roughness = 0.88;
    material.metalness = 0.08;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity };
    material.userData.uniforms = {
        uRock, uCrack, uHot, uBakedBounce, uOpacity, uSeam,
    };

    return { material };
}

/**
 * Build a single molten pocket shelf mesh (a low, irregular obsidian slab).
 */
export function createMoltenPocketTSL(
    uTime,
    uPulseIntensity = uniform(0),
    size = 6,
    uBakedBounce = uniform(1),
    options = {},
) {
    // CONSOLIDATION (remake plan, boot-reveal saver): reuse a shared isColumn=false material when
    // provided. The moltenRockField graph (~21 snoise3 — the chapter's heaviest, first-compiled-on-
    // reveal pipeline) is byte-identical across pockets; only the geometry `size` differs. Passing
    // one shared material collapses N pocket compiles to 1. Backward-compatible (default builds one).
    const material = options.material ?? createMoltenPocketMaterialTSL(
        uTime,
        uPulseIntensity,
        uBakedBounce,
        { ...options, isColumn: false },
    ).material;
    const geometry = new THREE.IcosahedronGeometry(size, 2);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const jitter = 0.92 + Math.random() * 0.16; // tighter: a rounded shelf, not spiky shards
        pos.setX(i, x * jitter);
        pos.setY(i, y * 0.2); // flatten HARD into a low ledge (was a tall jittered ball)
        pos.setZ(i, z * jitter);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh, material, geometry };
}

/**
 * Build a tall near-black obsidian COLUMN (repoussoir foreground silhouette) using
 * the same dark-rock-with-cracks material. Vertically stretched + jittered so it
 * reads as a charred pillar/stalactite at a corridor corner.
 */
export function createObsidianColumnTSL(
    uTime,
    uPulseIntensity = uniform(0),
    radius = 6,
    height = 70,
    uBakedBounce = uniform(1),
    sharedMaterial = null,
) {
    // The column graph is byte-identical for every column/slab (isColumn=true; only geometry
    // + transform vary), so callers can pass ONE pre-built material to share across all of
    // them and collapse N pipeline compiles of this heavy graph to 1 (cold-start variant cut,
    // zero visual change). Falls back to building its own for standalone callers.
    const { material } = sharedMaterial
        ? { material: sharedMaterial }
        : createMoltenPocketMaterialTSL(uTime, uPulseIntensity, uBakedBounce, true);
    const geometry = new THREE.CylinderGeometry(radius * 0.72, radius, height, 18, 5);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const jitter = 0.94 + Math.random() * 0.12;
        pos.setX(i, x * jitter);
        pos.setZ(i, z * jitter);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'obsidian-column';
    return { mesh, material, geometry };
}

// ── THE FIRST HEART (chapter hero / destination landmark) ────────────────────────
//
// Plan item 1: a white-hot caldera fissure seated on the rail's vanishing point at the
// chapter's far end — the chapter's Journey-mountain, visible from frame 01 and growing
// across the whole descent. A single camera-facing sprite carrying three radial tiers
// (#ffe6b0 white-hot core, #ff6a00 ring, #7a1500 outer ember fade) modulated by a slow
// fissure noise so it reads volcanic, breathing at 0.2 Hz. The white-hot tier belongs to
// this object EXCLUSIVELY (palette law). Across the seam (uSeam) the Heart is the LAST
// emissive to dim: the core walks back down the blackbody ladder (white → orange →
// oxblood) until only the drowned amber ember remains — the same light Chapter 2
// inherits as its hydrothermal vent glow.
export function createFirstHeartTSL(uTime, uPulseIntensity = uniform(0), uDescent = uniform(0), options = {}) {
    const uSeam = options.uSeam ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uCore = uniform(new THREE.Color(0xffe6b0)); // white-hot focal tier (reserved)
    const uRing = uniform(new THREE.Color(0xff6a00)); // flowing-orange ring
    const uOuter = uniform(new THREE.Color(0x7a1500)); // oxblood outer fade

    const p = uv().sub(0.5);
    const d = clamp(length(p).mul(2.0), 0.0, 1.0);

    // 0.2 Hz breathing (2π·0.2 ≈ 1.2566) — the heart of the world, beating slowly.
    const breathe = sin(uTime.mul(1.2566)).mul(0.5).add(0.5);
    const flicker = breathe.mul(0.18).add(0.88);

    const core = pow(clamp(oneMinus(d.mul(2.6)), 0.0, 1.0), 1.6); // tight white-hot core
    const ring = pow(oneMinus(d), 2.4);
    const halo = pow(oneMinus(d), 1.1);

    // Caldera fissure modulation: slow noise breaks the disc into a cracked glow.
    const fissure = snoise3(vec3(p.x.mul(7.0), p.y.mul(3.0), uTime.mul(0.07))).mul(0.5).add(0.5);

    // Seam quench: white surrenders to orange, then oxblood (the blackbody ladder in
    // reverse), while overall energy dies to a drowned ember.
    const quenchMid = smoothstep(0.0, 0.6, uSeam);
    const quenchEnd = smoothstep(0.55, 1.0, uSeam);
    const coreColor = mix(uCore, mix(uRing, uOuter, quenchEnd), quenchMid);
    const ringColor = mix(uRing, uOuter, quenchMid);

    let color = uOuter.mul(halo).mul(0.55)
        .add(ringColor.mul(ring).mul(0.95).mul(fissure.mul(0.35).add(0.75)))
        .add(coreColor.mul(core).mul(1.55));
    const energy = uDescent.mul(0.45).add(0.75)
        .mul(flicker)
        .mul(uPulseIntensity.mul(0.25).add(1.0))
        .mul(oneMinus(uSeam.mul(0.82)));
    color = color.mul(energy);
    color = min(color, vec3(0.95, 0.9, 0.78)); // capped <1.0; core crosses bloom threshold

    const alpha = halo.mul(1.0).mul(oneMinus(uSeam.mul(0.55))).mul(uOpacity);

    const material = new THREE.SpriteNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false; // destination glow must read through haze from frame 01
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = {
        uCore, uRing, uOuter, uSeam,
    };

    const mesh = new THREE.Sprite(material);
    mesh.name = 'first-heart';
    mesh.frustumCulled = false;
    mesh.renderOrder = -40; // after the backstops (-90..-85), behind the set pieces
    return { mesh, material };
}

// ── Selenite geode chapel crystals (mid-chapter cool counterpoint) ────────────────
//
// Plan item 4: the cracked geode "chapel" that fills the frames-08–11 dead zone — 5–9
// translucent selenite beams (#bfe8f0) jutting at conflicting angles, backlit warm by a
// molten pocket beneath (assembled in earth-core.js). Naica's Cave of Crystals is the
// reference: selenite glows because light passes through it. Authored sub-bloom-threshold
// normally; across the seam (uSeam) the crystals brighten and cool toward #58d8ff as the
// heat dies — the cavern's first bioluminescent lights, foreshadowing Chapter 2.
export function createSeleniteCrystalsTSL(uTime, uPulseIntensity = uniform(0), options = {}) {
    const uSeam = options.uSeam ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const beamCount = options.beamCount ?? 7;
    const uSelenite = uniform(new THREE.Color(0xbfe8f0)); // translucent gypsum blade
    const uWarmBack = uniform(new THREE.Color(0xff8a3a)); // molten-pocket backlight
    const uBio = uniform(new THREE.Color(0x58d8ff)); // seam: first ocean cyan

    // Merged beam geometry: 5–7-sided prisms at conflicting angles (one draw call).
    const beamGeometries = [];
    for (let i = 0; i < beamCount; i += 1) {
        const beamLength = 7 + Math.random() * 9;
        const beamRadius = 0.7 + Math.random() * 0.9;
        const beam = new THREE.CylinderGeometry(beamRadius * 0.5, beamRadius, beamLength, 6, 1);
        beam.translate(0, beamLength * 0.5, 0); // base at the chamber floor
        beam.rotateX((Math.random() - 0.5) * 1.5);
        beam.rotateZ((Math.random() - 0.5) * 1.5);
        beam.rotateY(Math.random() * Math.PI * 2);
        beam.translate((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5);
        beamGeometries.push(beam);
    }
    const geometry = mergeGeometries(beamGeometries, false);
    beamGeometries.forEach((g) => g.dispose());

    const vLocalY = varying(positionLocal.y);
    const fres = viewFresnel(2.2);
    // Backlit from beneath: the molten pocket under the chamber floods the blade bases.
    const backlit = oneMinus(smoothstep(-2.0, 10.0, vLocalY));
    const shimmer = sin(uTime.mul(0.6).add(vLocalY.mul(0.7))).mul(0.08).add(0.92);

    let color = uSelenite.mul(fres.mul(0.85).add(0.18));
    color = color.add(uWarmBack.mul(backlit).mul(0.4));
    // Seam: the crystals ignite cool as the heat dies (heat hands off to depth).
    color = color.add(uBio.mul(uSeam).mul(fres.add(backlit.mul(0.5))).mul(0.7));
    color = color.mul(uPulseIntensity.mul(0.12).add(1.0)).mul(shimmer);
    // Rest-state cap stays UNDER the 0.85 bloom threshold; only the seam lift raises
    // it, so the crystals ignite as the heat dies (never compete with the Heart).
    color = min(color, mix(vec3(0.74, 0.8, 0.82), vec3(0.85, 0.94, 0.97), uSeam));

    const alpha = clamp(fres.mul(0.5).add(0.42), 0.0, 1.0).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = {
        uSelenite, uWarmBack, uBio, uSeam,
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'selenite-crystals';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

/**
 * Assemble the converted Earth Core materials into one group + a single uTime uniform
 * the caller ticks each frame. Mirrors deep-ocean.tsl.js's createDeepOceanPilotTSL —
 * used by the standalone WebGPU pilot validation page.
 */
export function createEarthCorePilotTSL() {
    const uTime = uniform(0);
    const uPulseIntensity = uniform(0);
    const uDescent = uniform(0);
    const group = new THREE.Group();
    group.name = 'earth-core-pilot-tsl';

    const background = createVolcanoBackgroundTSL(uTime, uPulseIntensity);
    const cloudCanopy = createMagmaCloudCanopyTSL(uTime, uPulseIntensity);
    const lavaLake = createLavaFloorTSL(uTime, uPulseIntensity, uDescent);
    const lavaFall = createLavaFallTSL(uTime, uPulseIntensity, uDescent);
    lavaFall.mesh.position.set(70, 50, -120);

    group.add(background.mesh, cloudCanopy.mesh, lavaLake.mesh, lavaFall.mesh);

    // A few obsidian geodes distributed around the lake (Fibonacci-ish ring).
    const balls = [];
    const ballCount = 6;
    for (let i = 0; i < ballCount; i += 1) {
        const ballSize = 4 + (i % 3) * 2;
        const ball = createRockClusterTSL(uTime, uPulseIntensity, ballSize);
        const angle = (i / ballCount) * Math.PI * 2;
        const radius = 45;
        ball.mesh.position.set(
            Math.cos(angle) * radius,
            2 + (i % 3) * 4,
            Math.sin(angle) * radius,
        );
        group.add(ball.mesh);
        balls.push(ball);
    }

    return {
        group,
        uniforms: { uTime, uPulseIntensity, uDescent },
        dispose() {
            [background, cloudCanopy, lavaLake, lavaFall, ...balls].forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

/** Readability alias for {@link createLavaFloorTSL} (the opaque molten lava LAKE). */
export const createLavaLakeTSL = createLavaFloorTSL;

export default createEarthCorePilotTSL;

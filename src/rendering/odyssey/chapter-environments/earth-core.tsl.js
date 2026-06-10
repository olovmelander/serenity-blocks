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
    Fn,
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
    transformNormalToView,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { snoise3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld } from './shared/odyssey-tsl-billboard.js';

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
function fbm(pInput) {
    const p0 = vec3(pInput);
    const p1 = p0.mul(2.01);
    const p2 = p1.mul(2.02);
    const p3 = p2.mul(2.03);
    return snoise3(p0).mul(0.5)
        .add(snoise3(p1).mul(0.25))
        .add(snoise3(p2).mul(0.125))
        .add(snoise3(p3).mul(0.0625));
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
    const uCrust = vec3(0.07, 0.03, 0.012); // charred warm-rock crust chunk (not a void)
    const uRiverDark = vec3(0.34, 0.055, 0.012); // cooling molten (deep ember)
    const uRiverBright = vec3(0.92, 0.28, 0.035); // hot flowing magma, below yellow-white
    const uVein = vec3(0.95, 0.32, 0.04); // hottest crack core (warm-orange instead of gold-white)

    const ftime = uTime.mul(0.12);

    // 1. Domain warp: offset the river lookup by a slow low-freq fbm so the molten
    //    flows in meandering channels (no axis-aligned tiling).
    const warp = vec3(
        fbm(pos.mul(0.5).add(vec3(ftime, 0.0, 0.0))),
        fbm(pos.mul(0.5).add(vec3(0.0, ftime.mul(0.7), 5.0))),
        fbm(pos.mul(0.5).add(vec3(7.0, 0.0, ftime.mul(0.5)))),
    ).mul(0.9);
    const warped = pos.add(warp);

    // River field: two octaves flowing at different rates → living molten rivers.
    const river1 = fbm(warped.mul(0.7).add(vec3(0.0, ftime.mul(1.3), 0.0)));
    const river2 = fbm(warped.mul(1.4).add(vec3(ftime.mul(-0.6), 0.0, ftime.mul(0.4))));
    const riverField = river1.mul(0.6).add(river2.mul(0.4)).add(0.5);

    // Pool the molten into recesses / down-facing crevices + the chosen heat bias.
    const riverIntensity = smoothstep(
        float(0.62).sub(heatBias).sub(pool.mul(0.12)),
        float(0.82).sub(heatBias.mul(0.5)),
        riverField,
    );

    // 2. Crust chunks: high-freq map that drops dark CHARRED islands into the stream
    //    (this is the variation that defeats the repetitive decal look).
    const crustMap = fbm(warped.mul(2.6).add(vec3(ftime.mul(0.4), 0.0, 0.0))).add(0.5);
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
    const veinRidge = oneMinus(abs(fbm(warped.mul(3.2).add(vec3(0.0, ftime.mul(0.8), 0.0)))));
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
    color = max(color, vec3(0.05, 0.02, 0.01));

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
export function createLavaFloorTSL(uTime, uPulseIntensity = uniform(0), uDescent = uniform(0)) {
    const uColorHot = uniform(new THREE.Color(0xff8a24)); // Warm molten orange (hottest veins)
    const uColorMid = uniform(new THREE.Color(0xb83208)); // Deep molten orange
    const uColorCool = uniform(new THREE.Color(0x050206)); // Near-black charred crust
    const uColorReflect = uniform(new THREE.Color(0x091022)); // Complementary cool obsidian sheen (<10%)

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
    const displacement = bubble.mul(0.22).add(flow.mul(0.16))
        .mul(rimFalloff)
        .mul(uPulseIntensity.mul(0.4).add(1.0));
    const displaced = vec3(posL.x, posL.y.add(displacement), posL.z);

    const vPos = varying(displaced);
    const vElevation = varying(displacement);

    // ── Fragment temperature field → colorNode ──
    // DOMAIN-WARP the lookup (adapt pyrestorm's flow technique) so the molten reads as
    // meandering RIVERS of glowing lava, not a static amber temperature gradient.
    const ftime = uTime.mul(0.15);
    const warp = vec3(
        fbm(vPos.mul(0.035).add(vec3(ftime.mul(0.4), 0.0, 0.0))),
        0.0,
        fbm(vPos.mul(0.035).add(vec3(0.0, 0.0, ftime.mul(0.4)).add(9.0))),
    ).mul(6.0);
    const wPos = vPos.add(warp);
    const flow1 = fbm(wPos.mul(0.06).add(vec3(ftime, 0.0, ftime.mul(0.5))));
    const flow2 = fbm(wPos.mul(0.1).add(vec3(ftime.mul(-0.3), ftime.mul(0.2), 0.0)));
    const cracks = fbm(wPos.mul(0.3).add(vec3(ftime.mul(0.1), 0.0, ftime.mul(0.15))));
    // High-freq crust map: dark charred islands floating in the molten (pyrestorm).
    const crustMap = fbm(wPos.mul(0.5).add(vec3(ftime.mul(0.2), 0.0, 0.0))).add(0.5);
    const crustFactor = smoothstep(0.46, 0.86, crustMap);

    // Lower base + wider contrast so most of the lake falls into the dark charred
    // crust band (the molten reads as glowing rivers/cracks across dark rock).
    const temp = clamp(
        flow1.mul(0.52).add(flow2.mul(0.28)).add(0.24)
            .add(vElevation.mul(0.08))
            .mul(uPulseIntensity.mul(0.25).add(1.0)),
        0.0,
        1.0,
    );

    const hotMix = mix(uColorMid, uColorHot, temp.sub(0.7).div(0.3));
    const midMix = mix(uColorCool, uColorMid, temp.sub(0.4).div(0.3));
    const coolMix = uColorCool.mul(temp.div(0.4));
    const lowColor = mix(coolMix, midMix, step(0.4, temp));
    let color = mix(lowColor, hotMix, step(0.7, temp));

    // Float dark charred crust islands over the molten (kills the amber-soup look).
    color = mix(color, uColorCool, crustFactor.mul(0.6));

    // Narrow bright molten veins/cracks (threads of glow across dark crust); brighter
    // where the crust has cracked open (no crust chunk on top).
    const veinIntensity = smoothstep(0.5, 0.66, cracks).mul(oneMinus(crustFactor.mul(0.7)));
    color = color.add(uColorHot.mul(veinIntensity).mul(0.48));

    // Slow hot spots that pulse (sparse warm highlights, not a wash).
    const hotSpot = pow(max(0.0, snoise3(wPos.mul(0.18).add(ftime.mul(1.4)))), 4.0);
    color = color.add(uColorHot.mul(hotSpot).mul(0.24));

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
    color = min(color, vec3(0.78, 0.46, 0.26));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    material.colorNode = color;
    material.transparent = false;
    material.side = THREE.FrontSide;
    material.depthWrite = true;
    material.blending = THREE.NormalBlending;
    material.userData.emitsBloom = true;
    material.userData.uniforms = {
        uColorHot, uColorMid, uColorCool, uColorReflect,
    };

    // §3.1 Widen the readable floor to 360×360 so the lake is visible ACROSS the whole
    // descent (the single highest-impact composition change).
    const geometry = new THREE.PlaneGeometry(360, 360, 112, 112);
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
export function createLavaFallTSL(uTime, uPulseIntensity = uniform(0), uDescent = uniform(0)) {
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
    const streak = fbm(streakP).mul(0.5).add(0.5);
    const streak2 = fbm(streakP.mul(2.0).add(vec3(0.0, uTime.mul(0.8), 0.0))).mul(0.5).add(0.5);
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
    const alpha = heat.mul(sideFeather).mul(topFeather).mul(bottomFeather).mul(0.86);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
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
export function createGodRayConeTSL(uTime, uPulseIntensity = uniform(0)) {
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
    const alpha = intensity.mul(nearFade).mul(0.06); // plan: ~0.06 low-opacity cones

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = min(color, vec3(0.9, 0.82, 0.7));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.userData.uniforms = { uTint };

    // Open cone (wide base at top sky, narrow toward the lake): tip down.
    const geometry = new THREE.ConeGeometry(26, 120, 24, 1, true);
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

    // Subtle noise (mottled rock).
    const noise = fbm(posL.mul(0.05).add(uTime.mul(0.02))).mul(0.1);
    color = color.add(vec3(0.018, 0.005, 0.0).mul(noise));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.side = THREE.BackSide;
    material.depthWrite = false;

    const geometry = new THREE.SphereGeometry(250, 48, 32);
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
export function createMagmaCloudCanopyTSL(uTime, uPulseIntensity = uniform(0)) {
    const dir = normalize(positionLocal);
    const cloudPos = dir.mul(3.0);
    const motion = vec3(uTime.mul(0.018), uTime.mul(0.012), uTime.mul(0.009));

    const cloud1 = fbm(cloudPos.add(motion));
    const cloud2 = fbm(cloudPos.mul(2.05).sub(motion.mul(0.62)));
    const cloud3 = fbm(cloudPos.mul(0.55).add(motion.mul(0.38)));
    const densityRaw = cloud1.mul(0.52).add(cloud2.mul(0.32)).add(cloud3.mul(0.24));

    // Keep the deck mostly above/around the corridor. The very top is thinner, so the
    // sky has volume and holes instead of becoming a solid ceiling cap.
    const ceilingMask = smoothstep(-0.32, 0.46, dir.y)
        .mul(oneMinus(smoothstep(0.88, 1.0, dir.y).mul(0.32)));
    const density = smoothstep(-0.16, 0.48, densityRaw).mul(ceilingMask);

    const glowNoise = fbm(cloudPos.mul(2.35).add(vec3(0.0, uTime.mul(-0.08), 0.0)))
        .add(0.5);
    const internalGlow = smoothstep(0.42, 0.86, glowNoise);
    const underLight = oneMinus(smoothstep(0.12, 0.78, dir.y)).mul(density);
    const pulse = sin(uTime.mul(0.55)).mul(0.15).add(0.85);

    let color = vec3(0.014, 0.010, 0.026)
        .add(vec3(0.070, 0.018, 0.012).mul(density));
    color = color.add(vec3(0.58, 0.14, 0.032).mul(internalGlow).mul(underLight).mul(pulse).mul(0.58));
    color = color.add(vec3(0.20, 0.045, 0.018).mul(uPulseIntensity).mul(underLight));
    color = min(color, vec3(0.48, 0.22, 0.12));

    const alpha = density.mul(0.62).mul(smoothstep(-0.22, 0.28, dir.y).add(0.18));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.BackSide;
    material.blending = THREE.NormalBlending;

    const geometry = new THREE.SphereGeometry(238, 64, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'magma-cloud-canopy';
    mesh.renderOrder = -89;
    return { mesh, material, geometry };
}

export function createRockClusterMaterialTSL(
    uTime,
    uPulseIntensity = uniform(0),
    uBakedBounce = uniform(1),
) {
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
    const bakedWarm = vec3(0.14, 0.045, 0.012)
        .mul(lakeFalloff.mul(0.8).add(0.2))
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
        .add(uHot.mul(baseBleed).mul(0.14)); // base bleed near the lake
    material.roughness = 0.85;
    material.metalness = 0.05;
    material.transparent = false;
    material.depthWrite = true;
    material.blending = THREE.NormalBlending;
    material.side = THREE.FrontSide;
    material.userData.emitsBloom = true;
    material.userData.uniforms = {
        uColorPrimary, uColorSecondary, uColorTertiary, uHot, uBakedBounce,
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
) {
    const { material } = createRockClusterMaterialTSL(uTime, uPulseIntensity, uBakedBounce);
    const geometry = new THREE.SphereGeometry(size, 48, 48);
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh, material, geometry };
}

// ── Magma-horizon glow band (far up-corridor backstop; bloom-eligible) ───────────
//
// A large additive emissive plane placed far ahead so a low forward camera sees a
// READABLE LAVA-LAKE HORIZON LINE (a crisp hot/dark band) at the far shore, not bare
// void. A thin bright rim band makes the lake edge read as a sharp hot/dark LINE; the
// charred margins go near-black `0x050100`. Capped + feathered (no hard edge/blowout).
export function createMagmaHorizonTSL(uTime, uPulseIntensity = uniform(0)) {
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
    const alpha = heat.mul(sideFeather).mul(vFeather).mul(0.82);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
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
export function createMoltenHazeMaterialTSL(uTime, uPulseIntensity = uniform(0)) {
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
    const nearTint = mix(vec3(0.22, 0.055, 0.025), vec3(0.55, 0.18, 0.045), aSeed);
    const farTint = vec3(0.34, 0.10, 0.055); // warm smoke, not full orange fog
    const tint = mix(nearTint, farTint, depthT);

    material.colorNode = tint.mul(flick).mul(uPulseIntensity.mul(0.15).add(1.0));
    // Lifted 0.12→0.16: enough warm mid-depth fog to backfill the dead-red gaps the
    // screenshots showed without breaking the ~70% dark value hierarchy or blowing out.
    // Denser far (depthT) so distant assets fade into the medium; a near-fade keeps a
    // puff from hard-cutting through a near geode (§5.7 cheap soft-particle proxy).
    const nearFade = smoothstep(6.0, 22.0, camDist);
    material.opacityNode = feather.mul(depthT.mul(0.08).add(0.095)).mul(nearFade);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    return { material };
}

// ── Contact-shadow / radial-AO decal (grounding) ─────────────────────────────────
//
// §5.1 — a small dark radial-feathered quad laid flat at the lake/ledge line under each
// column/shelf/geode to fake the ambient-occlusion contact a prop casts where it meets
// the surface (the #1 grounding cue). NormalBlending toward near-black, depthWrite
// false, renderOrder just above the lake so it composites over the molten floor without
// z-fighting. `opacityNode = pow(1 - dist, 2)`.
export function createContactShadowDecalTSL(size = 12) {
    const uShadow = uniform(new THREE.Color(0x0a0301)); // near-black contact pool

    const p = uv().sub(0.5);
    const dist = clamp(length(p).mul(2.0), 0.0, 1.0); // 0 center → 1 edge
    const feather = pow(oneMinus(dist), 2.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uShadow;
    material.opacityNode = feather.mul(0.6);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
    material.userData.uniforms = { uShadow };

    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2); // lay flat on the lake/ledge
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'contact-shadow';
    mesh.renderOrder = -7; // just above the lake (lake is opaque, default order 0)
    return { mesh, material, geometry };
}

// ── Molten pocket / obsidian column shelf (solid; narrow glowing cracks) ──────────
//
// A dark obsidian shelf beside each level node, and (via createObsidianColumnTSL)
// near-black silhouetted foreground columns at corridor corners (repoussoir). Solid
// rock that occludes; only narrow cracks glow (bloom-eligible).
export function createMoltenPocketMaterialTSL(uTime, uPulseIntensity = uniform(0), uBakedBounce = uniform(1), isColumn = false) {
    const uRock = uniform(new THREE.Color(0x0d0604)); // darker charred obsidian
    const uCrack = uniform(new THREE.Color(0xff5a14)); // molten crack glow
    const uHot = uniform(new THREE.Color(isColumn ? 0xcc4400 : 0xffc066)); // dimmer/warmer for columns

    const posL = positionLocal;
    const vPos = varying(posL);
    const vNormal = varying(normalize(normalLocal));
    const vWorldY = varying(positionWorld.y);

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
    let color = mix(uRock, field, float(isColumn ? 0.18 : 0.74)); // columns stay silhouetted
    color = color.add(uHot.mul(pow(crackHeat, 3.0)).mul(isColumn ? 0.035 : 0.34));
    color = color.add(vec3(0.14, 0.04, 0.01).mul(upFace).mul(isColumn ? 0.045 : 0.32));

    // §4.3 View-correct fresnel rim (consistency with the geode): a warm grazing edge
    // tinted by how molten the rim already is + a small cool shadow-side term. Carves
    // the near-black silhouette out of the haze without a fixed +Z banding.
    const rim = viewFresnel(3.0);
    const coolRim = vec3(0.039, 0.102, 0.149); // ~0x0a1a26 cool shadow-side accent
    const shadowSide = oneMinus(upFace);
    const warmRim = uCrack.mul(glow.mul(0.4).add(0.2)).mul(isColumn ? 0.07 : 0.82);
    color = color.add(mix(warmRim, coolRim.mul(0.5), shadowSide.mul(0.45)).mul(rim));

    // §5.1 Emissive BLEED on the base near the lake line: the lava licks the lowest
    // band so the column/shelf base glows as if it sits IN the lake.
    const baseBleed = oneMinus(smoothstep(LAVA_LAKE_Y, LAVA_LAKE_Y + 12.0, vWorldY));
    color = color.add(uHot.mul(baseBleed).mul(isColumn ? 0.08 : 0.18));

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
    material.emissiveNode = uCrack.mul(glow).mul(isColumn ? 0.025 : 0.38)
        .add(uHot.mul(pow(crackHeat, 3.0)).mul(isColumn ? 0.035 : 0.34))
        // Baked accent/bounce emissive — a dim warm self-illumination on the
        // up/side faces so the rock glows softly as if lit by the removed PointLights.
        .add(uHot.mul(bake).mul(uBakedBounce).mul(isColumn ? 0.008 : 0.09))
        // §5.1 emissive BLEED — the base glows where the lava licks it (lake line).
        .add(uHot.mul(baseBleed).mul(isColumn ? 0.06 : 0.16));
    material.roughness = 0.88;
    material.metalness = 0.08;
    material.userData.emitsBloom = true;
    material.userData.uniforms = {
        uRock, uCrack, uHot, uBakedBounce,
    };

    return { material };
}

/**
 * Build a single molten pocket shelf mesh (a low, irregular obsidian slab).
 */
export function createMoltenPocketTSL(uTime, uPulseIntensity = uniform(0), size = 6, uBakedBounce = uniform(1)) {
    const { material } = createMoltenPocketMaterialTSL(uTime, uPulseIntensity, uBakedBounce, false);
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
) {
    const { material } = createMoltenPocketMaterialTSL(uTime, uPulseIntensity, uBakedBounce, true);
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

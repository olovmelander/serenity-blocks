// ═══════════════════════════════════════════════════════════════════════════════
// ONE Odyssey water surface — the membrane the camera rises THROUGH at the Ch2→Ch3 breach.
//
// The whole "coming up through the water" complaint is that the underside (Ch2 deep-ocean
// ceiling) and the topside (Ch3 sea/river/lake) were UNRELATED materials — an additive cyan
// caustic sheet vs a normal-blended warm-gold fresnel water — so breaching hard-popped the look.
//
// This builder makes the SAME surface show its caustic-teal underside from below and its
// golden-hour top from above, selected per-pixel by `facing` (does the eye look up at it or down
// on it). One NormalBlending pass serves both sides: the caustic "additive glow" is folded into
// the colour (`color.add(...)`) exactly as the golden sun-glitter already composites, so there is
// no second blend mode and no material swap across the membrane.
//
// Both `createWaterSurfaceTSL` (Ch2) and `createOceanSurfaceTSL`/`createGoldenLakeTSL` (Ch3) call
// this so the palette, normal, displacement and light are literally the same graph on both sides.
// Governing plan: docs/ODYSSEY_JOURNEY_COMPOSITION_REWORK_PLAN_2026-08.md §2 (Fix A).
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three/webgpu';
import {
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    length,
    mix,
    normalize,
    oneMinus,
    positionLocal,
    positionWorld,
    pow,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { snoise3 } from './odyssey-tsl-noise.js';
import { ODYSSEY_SUN } from './chapter-profile.js';

// The ONE sun the whole underwater→surface stretch shares — byte-identical to surface-world's
// SURFACE_SUN_DIR so the god-rays the diver rises toward and the sea/lake glitter agree.
export const ODYSSEY_WATER_SUN_DIR = new THREE.Vector3(...ODYSSEY_SUN).normalize();

// The ONE water palette — byte-identical to Ch2's uDeepColor/uSurfaceColor + caustic crest and to
// CH3_WATER_READABILITY_SETTINGS.deepColor/shallowColor/crestColor, so the declared water-continuity
// contract finally reaches the pixels on BOTH sides of the membrane.
export const ODYSSEY_WATER_PALETTE = Object.freeze({
    deepColor: 0x062a55,
    surfaceColor: 0x0a9bb8,
    caustic: Object.freeze([0.55, 0.95, 1.0]),
});

// Gerstner wave (byte-identical to the deep-ocean ceiling's) — the swell silhouette below the
// breach; eased toward a calm sheet above by uWaveScale so the surface SHAPE morphs continuously.
function gerstnerWave(dir, steep, wlen, p, t) {
    const k = float(6.28318).div(wlen);
    const c = sqrt(float(9.8).div(k));
    const d = normalize(dir);
    const f = k.mul(dot(d, p.xz).sub(c.mul(t)));
    const a = float(steep).div(k);
    return vec3(d.x.mul(a).mul(cos(f)), a.mul(sin(f)), d.y.mul(a).mul(cos(f)));
}

/**
 * The unified Odyssey water material.
 * @param {*} uTime shared time uniform
 * @param {object} opts
 * @param {*} [opts.uDepth]     Ch2 ascent 0..1 — ignites the caustic underside on approach.
 * @param {*} [opts.uSeason]    Ch3 winter cool 0..1.
 * @param {*} [opts.uOpacity]   ecotone crossfade opacity.
 * @param {*} [opts.uWaveScale] 1 = full Ch2 swell; ~0.06 = calm Ch3 above-water ripple.
 * @param {THREE.Vector3} [opts.sunDir] shared sun.
 * @param {boolean} [opts.useRadialEdge] dissolve the plane at its rim (pooled lake) vs fill (sea/river).
 * @param {number}  [opts.baseAlpha] surface opacity ceiling (Ch2 ceiling used 0.8; Ch3 fills at 1.0).
 * @param {*} [opts.reflection] optional reflector() node for the hero lake mirror.
 * @param {object} [opts.shore] optional DEPTH-BASED SHORE BLEND — removes the raw geometric
 *   intersection line wherever terrain rises through the sheet. The terrain heightfield is
 *   BAKED by the caller into a half-float texture (sampled here by world XZ), so the water
 *   evaluates the exact same ground the terrain mesh was displaced by — no scene depth
 *   texture needed (awkward in the r181 WebGPU forward pass) and no hand-ported height
 *   function to drift when the terrain is re-authored. Shape:
 *   { heightTexture, uOriginXZ (vec2 uniform: terrain plate world origin),
 *     uBaseY (float uniform: terrain world base Y), extent (plate half-size, world units),
 *     band (alpha fade depth, world units), shallowTint ([r,g,b] lagoon shallows) }.
 *   Alpha fades 0→1 over `band` of true water depth, and the colour lifts toward
 *   shallowTint over ~3× the band, so every shoreline reads as a natural shallowing
 *   instead of a hard clip. Ch3-only today; omit for byte-identical Ch2 behaviour.
 * @returns {{ material: THREE.MeshBasicNodeMaterial, uniforms: object }}
 */
export function buildOdysseyWaterSurface(uTime, {
    uDepth = uniform(1),
    uSeason = uniform(0),
    uOpacity = uniform(1),
    uWaveScale = uniform(1),
    sunDir = ODYSSEY_WATER_SUN_DIR,
    useRadialEdge = false,
    baseAlpha = 1.0,
    reflection = null,
    shore = null,
} = {}) {
    const sun = vec3(sunDir.x, sunDir.y, sunDir.z);
    const wpos = positionWorld;
    const eyeDir = normalize(cameraPosition.sub(wpos));
    const camDist = length(cameraPosition.sub(wpos));
    const rt = uTime.mul(0.35);
    const gt = uTime.mul(0.5);

    // ── ONE displacement: Gerstner swell + value-noise detail, amplitude scaled by uWaveScale so
    // the surface silhouette eases from the full Ch2 swell to a calm Ch3 sheet across the breach. ──
    const posL = positionLocal;
    const wave = gerstnerWave(vec2(1.0, 0.3), 0.2, 25.0, posL, gt)
        .add(gerstnerWave(vec2(0.7, 0.7), 0.15, 18.0, posL, gt.mul(1.1)));
    const detail = snoise3(vec3(posL.x.mul(0.08), posL.z.mul(0.08), gt.mul(0.3))).mul(2.0);
    const elevation = wave.y.add(detail);
    const vElev = varying(elevation);

    // ── ONE analytic surface normal (small drifting ripple tilt), always ~+Y. Feeds BOTH the
    // facing test and the topside fresnel — NOT Gerstner-derived, so wave folds never sparkle. ──
    const ripA = sin(wpos.x.mul(0.11).add(rt)).add(sin(wpos.z.mul(0.09).sub(rt.mul(0.8))));
    const ripB = sin(wpos.x.mul(0.045).add(wpos.z.mul(0.038)).add(rt.mul(0.6)));
    const nrm = normalize(vec3(
        ripA.mul(0.035).add(ripB.mul(0.02)),
        1.0,
        ripB.mul(0.035).sub(ripA.mul(0.02)),
    ));

    // facing: 0 = seen from BELOW (caustic teal underside) → 1 = seen from ABOVE (golden top).
    // Driven by the eye's HEIGHT above the (horizontal) water plane, NOT the grazing dot(eyeDir,nrm)
    // — the dot conflates "looking along the surface toward the horizon" (grazing, from above) with
    // "the camera is under the water", which bled the dark caustic underside into the far field. The
    // height test is exact for a horizontal water plane and blends per-wave-crest right at the breach.
    const eyeHeight = cameraPosition.y.sub(wpos.y);
    const facing = smoothstep(-1.5, 1.5, eyeHeight);

    // ── BELOW look: the caustic ceiling, folded additive-IN-COLOUR (color.add) so ONE
    // NormalBlending pass serves both sides — no separate AdditiveBlending material. ──
    const uSurfaceColor = uniform(new THREE.Color(ODYSSEY_WATER_PALETTE.surfaceColor));
    const uDeepColor = uniform(new THREE.Color(ODYSSEY_WATER_PALETTE.deepColor));
    const { caustic } = ODYSSEY_WATER_PALETTE;
    const causticsUV = wpos.xz.mul(0.15);
    const cc1 = snoise3(vec3(causticsUV.x, causticsUV.y, uTime.mul(0.2)));
    const cc2 = snoise3(vec3(causticsUV.x.mul(1.4), causticsUV.y.mul(1.4), uTime.mul(-0.15)));
    // CLAMP the base to [0,1] BEFORE pow: cc1+cc2 can be negative (down to ~−0.5), and WGSL
    // pow(negative, 4.0) is undefined → NaN. The old additive Ch2 ceiling hid the NaN (0 over the
    // black abyss), but a NormalBlending mix propagates it to the pixel as black speckle blobs.
    const caustics = pow(clamp(cc1.add(cc2).mul(0.5).add(0.5), 0.0, 1.0), float(4.0));
    const approach = smoothstep(0.5, 0.95, uDepth);
    const ceilingLight = mix(float(0.45), float(1.0), approach);
    // Clamp the elevation mix factor to [0,1]: at Gerstner folds vElev spikes very negative and an
    // unclamped mix() extrapolates below black (the old additive "oil-slick" breach blob).
    const causticCol = vec3(caustic[0], caustic[1], caustic[2]);
    const causticGain = caustics.mul(approach.mul(0.85).add(0.05));
    let belowColor = mix(uDeepColor, uSurfaceColor, clamp(vElev.mul(0.1).add(0.5), 0.0, 1.0)).mul(ceilingLight);
    belowColor = belowColor.add(causticCol.mul(causticGain));

    // ── ABOVE look: golden-hour reduced-fresnel reflectance (rf0≈0.09 → coloured body head-on,
    // reflective only at the grazing rim) toward a warm-gold reflected sky. ──
    const theta = clamp(dot(eyeDir, nrm), 0.0, 1.0);
    const rf0 = float(0.09);
    // CAP the reflectance so the coloured body ALWAYS shows through — even at the grazing gameplay
    // angle. An uncapped reduced-fresnel drove the surface to the pale sky reflection at grazing, so
    // in-game (after ACES) the water washed to near-white and read as flat "ponds", not water.
    const reflectance = rf0.add(float(0.44).sub(rf0).mul(pow(oneMinus(theta), float(5.0))));
    const depthFactor = smoothstep(20.0, 240.0, camDist);
    const winterT = smoothstep(0.7, 0.95, uSeason);
    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave A): clean bright TURQUOISE→blue lake body (was dark
    // teal) so the surface reads as the clear Ghibli/Genshin lake of the reference. Only the ABOVE
    // branch changes — the BELOW underwater ceiling (Ch2 breach) is untouched; surfacing into the
    // now-blue Ch3 sky is consistent for the breach too. Overshoot for the in-game ACES/exposure wash.
    const bodyCol = mix(vec3(0.08, 0.56, 0.62), vec3(0.05, 0.30, 0.60), depthFactor); // richer turquoise near → deep blue far
    // Reflected sky flipped warm-gold → cool SKY-BLUE / white so the lake mirrors the new blue sky +
    // white cumulus. Winter pole (below) unchanged.
    let skyRefl = mix(vec3(0.55, 0.72, 0.88), vec3(0.80, 0.88, 0.98), depthFactor); // sky-blue → bright white-blue
    skyRefl = mix(skyRefl, vec3(0.55, 0.68, 0.82), winterT.mul(0.7));
    const bands = sin(wpos.z.mul(0.16).add(uTime.mul(0.4))).mul(0.5).add(0.5)
        .mul(sin(wpos.x.mul(0.09).sub(uTime.mul(0.25))).mul(0.5).add(0.5));
    skyRefl = skyRefl.mul(mix(float(0.9), float(1.08), bands));
    const vUv = uv();
    let aboveColor;
    if (reflection) {
        // REAL planar mirror (hero lake): fold the actual treeline + sky at the grazing rim.
        const reflUV = screenUV.flipX().add(vec2(nrm.x, nrm.z).mul(0.04));
        aboveColor = mix(bodyCol, reflection.sample(reflUV).rgb, reflectance);
    } else {
        // Broad sea/river: pure warm reflective body — NO faked tree-silhouette reflections. The
        // foliage is stripped (Fix C), so reflected treeline would be inconsistent, and up close it
        // read as dirty dark blobs. Wave crests + light bands + glitter carry the surface variation.
        aboveColor = mix(bodyCol, skyRefl, reflectance);
    }
    // SUN-GLITTER (camera-relative half-vector spec) — whitened from gold to a cool bright sparkle
    // for the daylight lake; an above-water phenomenon (rides inside aboveColor, so `facing` fades it
    // out below the surface).
    const halfV = normalize(sun.add(eyeDir));
    const specDot = clamp(dot(nrm, halfV), 0.0, 1.0);
    const shimmer = sin(wpos.z.mul(7.0).add(uTime.mul(2.0))).mul(0.5).add(0.5)
        .mul(sin(wpos.x.mul(3.2).add(uTime.mul(1.4))).mul(0.5).add(0.5));
    const glitter = pow(specDot, float(90.0)).mul(1.4).add(pow(specDot, float(14.0)).mul(0.22));
    const sunPath = glitter.mul(shimmer.mul(0.5).add(0.7));
    aboveColor = aboveColor.add(vec3(0.92, 0.96, 1.0).mul(sunPath).mul(oneMinus(winterT.mul(0.6))));

    // ── The membrane: one surface, view-dependent. ──
    let color = mix(belowColor, aboveColor, facing);

    // ── Optional depth-based SHORE BLEND (see the option doc above). ──
    let shoreAlpha = float(1.0);
    if (shore) {
        const plateHalf = float(shore.extent);
        const shoreLocal = wpos.xz.sub(shore.uOriginXZ);
        const shoreUvNode = shoreLocal.add(plateHalf).div(plateHalf.mul(2.0));
        // Only inside the baked terrain plate — beyond it there is no land, so the open
        // sea keeps its authored look (and the clamped texture edge can't smear inward).
        const inPlate = smoothstep(0.0, 0.03, shoreUvNode.x)
            .mul(oneMinus(smoothstep(0.97, 1.0, shoreUvNode.x)))
            .mul(smoothstep(0.0, 0.03, shoreUvNode.y))
            .mul(oneMinus(smoothstep(0.97, 1.0, shoreUvNode.y)));
        const terrainY = texture(shore.heightTexture, shoreUvNode).r.add(shore.uBaseY);
        const depthBelow = wpos.y.sub(terrainY); // true water depth over the baked ground
        // Alpha: dissolve to 0 exactly at the land line over `band` of depth. Topside only
        // (facing) — the Ch2-breach underside must never thin. Band is smooth (no noise),
        // honouring the "dissolve band wider than its noise swing" rule by having none.
        // NB the band is now TIGHT (~1u): the shore terrain slopes are shallow (the wade
        // ramp), so a wide depth band smeared into tens of horizontal units of mush — the
        // first cut (2.6u) read as fog, not a waterline. A tight band + the foam rim below
        // gives a *defined* natural line.
        const shoreT = smoothstep(0.0, shore.band, depthBelow);
        const shoreMix = inPlate.mul(facing);
        shoreAlpha = mix(float(1.0), shoreT, shoreMix);
        // Colour: lift the shallows toward a bright lagoon tint over ~3x the alpha band so
        // the deep body hands off through real-looking shallows instead of ending abruptly.
        const shallowT = smoothstep(0.0, shore.band * 3.0, depthBelow);
        const tint = vec3(shore.shallowTint[0], shore.shallowTint[1], shore.shallowTint[2]);
        const shallowed = mix(tint, color, shallowT.mul(0.65).add(0.35));
        color = mix(color, shallowed, shoreMix);
        // FOAM RIM: a soft bright ring just offshore (depth ~0.15–1.6 × band units) where
        // the alpha ramp is already mostly opaque, so it reads as the waterline itself —
        // the single strongest "natural shoreline" cue. Gentle drifting noise breaks it up
        // (modulates brightness only, never the alpha band, so no hard-snap risk).
        const foamBand = smoothstep(0.15, 0.55, depthBelow)
            .mul(oneMinus(smoothstep(0.9, 1.7, depthBelow)));
        const foamNoise = snoise3(vec3(wpos.x.mul(0.32), wpos.z.mul(0.32), uTime.mul(0.25)))
            .mul(0.5)
            .add(0.5);
        const foam = foamBand.mul(foamNoise.mul(0.45).add(0.30)).mul(shoreMix);
        color = color.add(vec3(0.88, 0.94, 0.96).mul(foam));
    }

    // Radial shore alpha (pooled lake) or fill to the scaled edge (sea/river/ceiling).
    const distFromCenter = length(vUv.sub(0.5)).mul(2.0);
    // NO STRAIGHT EDGES (in-game: "i want no straight edges for water land or anything so it feels
    // natural"). A bare radial dissolve still reads as a machined circle, and no dissolve at all
    // leaves the plane's ruler-straight rectangular rim. Break the rim with two octaves of
    // low-frequency noise so the water ends on an organic, meandering coastline in every direction.
    const rimBreak = snoise3(vec3(vUv.x.mul(3.1), vUv.y.mul(3.1), 0.0)).mul(0.15)
        .add(snoise3(vec3(vUv.x.mul(7.3), vUv.y.mul(7.3), 4.7)).mul(0.06));
    const edgeAlpha = useRadialEdge
        ? oneMinus(smoothstep(0.72, 1.0, distFromCenter.add(rimBreak)))
        : float(1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = edgeAlpha.mul(float(baseAlpha)).mul(uOpacity).mul(shoreAlpha);
    // ONE displacement, eased by uWaveScale (Gerstner swell below → calm ripple above).
    material.positionNode = vec3(
        posL.x.add(wave.x.mul(uWaveScale)),
        posL.y.add(elevation.mul(uWaveScale)),
        posL.z.add(wave.z.mul(uWaveScale)),
    );
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.toneMapped = false;
    // The caustic underside is bloom-eligible (Ch2 parity). `facing` keeps the golden top's colour
    // in a normal range so it does not over-bloom; verified in the playground.
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity };
    return {
        material,
        uniforms: {
            uOpacity, uDepth, uSeason, uWaveScale,
        },
    };
}

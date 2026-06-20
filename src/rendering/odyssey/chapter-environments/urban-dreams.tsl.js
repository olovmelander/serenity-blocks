/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Urban Dreams (Chapter 8) — TSL/WebGPU conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — chapter level-up). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6. Faithful TSL ports of urban-dreams.js's
 * six GLSL ShaderMaterials — the night-sky gradient backstop, the procedural
 * lit-window city facades, the energy-conduit spire core, the holographic signs, the
 * wet neon reflection plane, and the ground neon haze — rebuilt as NodeMaterials so
 * they run on the WebGPURenderer and its WebGL2 fallback (one codebase, both backends).
 *
 * Urban Dreams is the highest-contrast world: a neon megastructure over a procedurally
 * lit night city with wet reflections, holographic signage and rain. The live chapter
 * imports ODYSSEY_NOISE_GLSL (od_* value noise), so the `fbm2`/`od_hash21` calls map to
 * `fbm2`/`hash21` from the shared TSL noise lib at the same scales/frequencies.
 *
 * Additive glow surfaces (lit-window facades, conduit core, holo-signs) are tagged
 * `userData.emitsBloom = true` for the future MRT selective-bloom pass; emissiveNode is
 * wired when the TSL post graph lands (kept off here so the standalone pilot harness,
 * which has no MRT bloom, does not double-brighten). Backstops/haze/wet-reflection get
 * no emitsBloom.
 *
 * LEFT AS-IS (render on WebGPURenderer unchanged, not converted here): the rain-streak
 * THREE.Points sprites, the MeshBasicMaterial neon rails / spire frames / crown / sky
 * traffic tubes, the PointLight beacon, and the AmbientLight.
 */

import * as THREE from 'three/webgpu';
import {
    atan,
    attribute,
    clamp,
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
    positionViewDirection,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { fbm2, hash21 } from './shared/odyssey-tsl-noise.js';
import {
    billboardVerticalWorld,
    billboardWorld,
    makeQuadInstancedGeometry,
} from './shared/odyssey-tsl-billboard.js';

const CYAN = 0x00f2ff;
const MAGENTA = 0xff3fb4;

// ── Night-sky gradient dome (-100 backstop; must NOT bloom) ───────────────────────

export function createSkyGradientTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);
    const uOpacity = uniform(1.0);

    const dir = normalize(positionLocal);
    const h = dir.y.mul(0.5).add(0.5);
    // Compass angle around the dome — drives the horizon light-pollution band + bokeh.
    const azimuth = atan(dir.z, dir.x);

    // Night sky: deep indigo up top for strong contrast against the neon, grading to a
    // cooler indigo-violet glow near the horizon. NEVER pure black — a faint indigo floor
    // is kept everywhere so the encore reads as a luminous city night, not a void.
    const top = vec3(0.025, 0.019, 0.070);
    const horizon = vec3(0.150, 0.055, 0.200);
    const base = mix(horizon, top, smoothstep(0.30, 0.85, h));

    // City light-pollution dome hugging the lower sky — a cohesive magenta↔cyan wash that
    // ties the horizon to the chapter's two-tone neon identity. Boosted ~1.5× and lifted
    // higher up the dome so the upper-frame void glows indigo-magenta instead of crushing
    // to raw black between the canyon towers (the #1 fix for the dead-black mid-frame).
    const pollution = pow(oneMinus(h), 1.65);
    const pollutionTint = mix(
        vec3(0.30, 0.07, 0.20),
        vec3(0.0, 0.20, 0.25),
        sin(dir.x.mul(2.0)).mul(0.5).add(0.5),
    ).mul(pollution).mul(uEnergyNode.mul(0.45).add(0.74));

    // HORIZON LIGHT-POLLUTION BAND: a tight, brighter neon glow ring concentrated right at
    // the horizon line (the city below throwing light up), modulated around the compass so
    // it pools rather than reading as a flat wash. This is the "city under the smog" cue.
    // Widened + brightened ~1.5× so the band reads as a luminous skyline glow, not a thin line.
    const horizonBand = pow(smoothstep(0.66, 0.40, h), 1.4);
    const bandPool = sin(azimuth.mul(3.0).add(uTimeNode.mul(0.05))).mul(0.5).add(0.5);
    const bandTint = mix(vec3(0.16, 0.03, 0.24), vec3(0.0, 0.21, 0.30), bandPool)
        .mul(horizonBand)
        .mul(bandPool.mul(0.6).add(0.5))
        .mul(uEnergyNode.mul(0.4).add(0.7));

    // Drifting smog layer (FBM haze rolling across the lower sky).
    const smogUV = vec2(
        azimuth.mul(1.6).add(uTimeNode.mul(0.02)),
        dir.y.mul(2.2),
    );
    const smog = fbm2(smogUV).mul(smoothstep(0.7, 0.1, h));
    const smogTint = vec3(0.06, 0.05, 0.09).mul(smog);

    // DISTANT CITY-LIGHT BOKEH: a DENSE field of soft neon pinpoints filling the lower
    // dome — far skyline windows / aircraft lights so even gaps between the canyon towers
    // read as a luminous city, never pure black. Two layers: a coarse bright tier and a
    // fine fainter tier, both hash-keyed by direction, tinted cyan/magenta and twinkling.
    // Pushed higher up the dome (was horizon-only) so the void above the canyon glows too.
    const bokehCell = vec2(azimuth.mul(9.0), dir.y.mul(11.0)).floor();
    const bokehRnd = hash21(bokehCell);
    const bokehLit = step(0.74, bokehRnd); // far denser than before (was 0.93)
    const bokehTwinkle = sin(uTimeNode.mul(1.4).add(bokehRnd.mul(40.0))).mul(0.35).add(0.65);
    const lowBias = pow(smoothstep(0.82, 0.0, h), 1.2);
    const bokehTint = mix(vec3(0.0, 0.20, 0.27), vec3(0.24, 0.05, 0.19), fract(bokehRnd.mul(7.31)))
        .mul(bokehLit)
        .mul(bokehTwinkle)
        .mul(lowBias);

    // Fine secondary bokeh tier dropped as a per-fragment cost trim (one hash21 noise call
    // per pixel removed); the coarse bokeh tier + pollution wash still keep the lower dome
    // luminous so the skyline never crushes to raw black.

    const color = base
        .add(pollutionTint)
        .add(bandTint)
        .add(smogTint)
        .add(bokehTint);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.transparent = true;
    material.depthWrite = false;

    const geometry = new THREE.SphereGeometry(440, 32, 20);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return { mesh, material, geometry };
}

// ── Synthwave sun hero backdrop (additive disc + scanlines + halo; bloom-eligible) ─

export const CH8_RETROSUN_SHADER_SETTINGS = Object.freeze({
    sunRadius: 320,
    haloRadius: 500,
    discAlpha: 0.92,
    haloAlpha: 0.16,
    alphaCap: 0.96,
});

/**
 * The iconic 80s SYNTHWAVE SUN — a large glowing disc sitting on the horizon DEAD AHEAD
 * down the neon canyon (centerline, beyond the finale spire) so the camera sees it the
 * whole journey and at the finale. Built as TWO camera-facing billboard quads via the
 * shared helper (NO ShaderMaterial, runs on WebGPURenderer):
 *
 *   • a wide SOFT HALO quad behind everything (the bloom-feeding atmospheric glow), and
 *   • the SUN DISC quad itself, carrying:
 *       - a vertical gradient (hot white/yellow top → orange → hot magenta/pink bottom),
 *       - the classic horizontal SCANLINE GAPS that widen toward the bottom (the retro
 *         "venetian blind" sun cut by the horizon haze),
 *       - a soft circular disc mask feathered to 0 before the quad edge.
 *
 * Both quads are ADDITIVE and CAPPED well below 1.0 (soft-feathered; ACES + threshold
 * bloom downstream) so the disc glows without a white blowout. The disc + halo are tagged
 * emitsBloom so the MRT selective-bloom pass gilds them. The shared finale `uReveal` ramp
 * is taken so the sun swells/heats up as the journey ignites; defaults to a lit baseline
 * so the hero disc is always present (never a dead card). The chapter update() ticks
 * uTime/uEnergy and (optionally) uReveal exactly as it does the spire conduit.
 *
 * @param {*} uTime uniform(0) time node
 * @param {*} uEnergy uniform(0.45) energy node
 * @param {{uReveal?:*}} opts shared finale reveal uniform (0 idle → 1 ignited)
 */
export function createSynthwaveSunTSL(uTime, uEnergy, { uReveal } = {}) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);
    const uRevealNode = uReveal ?? uniform(0.4);

    // World half-extents: the disc reads as a colossal sun far down the canyon. Two
    // instances share ONE mesh — index 0 = soft halo (wider, dimmer), index 1 = disc.
    // Creative plan ch8 item 1 (sun visibility): radius raised 240 → 320 so the disc
    // subtends ~25–30% of frame height from mid-chapter at its -1180 station.
    const SUN_RADIUS = CH8_RETROSUN_SHADER_SETTINGS.sunRadius;
    const HALO_RADIUS = CH8_RETROSUN_SHADER_SETTINGS.haloRadius;
    const count = 2;
    const bases = new Float32Array(count * 3); // both at the group origin (group is placed)
    const sizes = new Float32Array(count);
    const kinds = new Float32Array(count); // 0 = halo, 1 = disc
    sizes[0] = HALO_RADIUS;
    sizes[1] = SUN_RADIUS;
    kinds[0] = 0.0;
    kinds[1] = 1.0;

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aKind = attribute('aKind', 'float');

    // Subtle heat-haze breathing so the sun feels alive; the reveal heats it further.
    const breathe = sin(uTimeNode.mul(0.45)).mul(0.04).add(1.0);
    const revealHeat = uRevealNode.mul(0.16).add(1.0); // disc swells ~16% on ignition
    const size = aSize.mul(breathe).mul(revealHeat);
    const positionNode = billboardWorld(aBase, size);

    // Sprite coords: cx,cy in [-0.5,0.5]; vTop in [0,1] (0 bottom → 1 top) for the gradient.
    const cuv = uv();
    const cx = cuv.x.sub(0.5);
    const cy = cuv.y.sub(0.5);
    const vTop = cuv.y; // 0 bottom, 1 top
    const dist = length(vec2(cx, cy));

    // VERTICAL SUN GRADIENT: hot white/yellow crown → warm orange belly → hot magenta/pink
    // base, the canonical synthwave ramp. Two mixes give the three-stop blend.
    const hotTop = vec3(1.25, 0.84, 0.24); // laser-lemon crown
    const mid = vec3(1.20, 0.28, 0.02); // heavy orange body
    const base = vec3(1.10, 0.03, 0.18); // hot magenta/pink base
    const lower = mix(base, mid, smoothstep(0.0, 0.55, vTop));
    const discColor = mix(lower, hotTop, smoothstep(0.6, 1.0, vTop));

    // HORIZONTAL SCANLINE GAPS — the iconic retro cuts. Density is constant up the disc but
    // the gaps WIDEN toward the bottom (the disc dissolves into the horizon haze): below the
    // equator the bands thin out into stripes, above it the disc is near-solid. `step` on a
    // periodic saw gives crisp bands; the cut threshold rises toward the base.
    const bandFreq = float(13.0);
    const saw = fract(vTop.mul(bandFreq));
    // cut threshold: ~0 near the top (no gaps) → ~0.85 near the bottom (wide gaps).
    const cutBelow = smoothstep(0.62, 0.0, vTop).mul(0.85);
    const scan = step(cutBelow, saw); // 1 = lit band, 0 = gap
    // Keep the top third fully solid regardless (the hot crown is uninterrupted).
    const scanMask = max(scan, smoothstep(0.6, 0.86, vTop));

    // Soft circular disc mask feathered to 0 before the quad edge (radius 0.5 in uv space).
    const discMask = smoothstep(0.5, 0.4, dist);
    // Bright hot rim just inside the limb for that glowing-edge pop.
    const rim = smoothstep(0.5, 0.44, dist).mul(smoothstep(0.36, 0.46, dist)).mul(0.5);

    // The WIDE SOFT HALO (atmospheric bloom feeder): a broad radial falloff tinted toward
    // the warm/magenta sun colours, no scanlines. Fed by index 0.
    const haloFall = pow(oneMinus(dist.mul(2.0)).max(0.0), 2.2);
    const haloTint = mix(vec3(1.0, 0.07, 0.25), vec3(1.0, 0.32, 0.06), vTop);

    const isDisc = aKind; // 1 for disc, 0 for halo
    const isHalo = oneMinus(aKind);

    // ENERGY/REVEAL gain — the sun heats up with the music + ignites at the finale, but the
    // additive output is capped < 1.0 (soft) so the bloom gilds it without clipping to white.
    const energyGain = uEnergyNode.mul(0.3).add(0.85);
    const revealGain = uRevealNode.mul(0.45).add(0.7);

    // Compose: disc path (gradient × scanlines × mask, + rim) OR halo path (radial × tint).
    const discOut = discColor.add(rim).mul(scanMask).mul(discMask);
    const haloOut = haloTint.mul(haloFall).mul(0.48);
    const color = discOut.mul(isDisc).add(haloOut.mul(isHalo)).mul(energyGain).mul(revealGain);

    // Per-kind alpha so the disc reads crisp and the halo stays gossamer; both capped soft.
    const discAlpha = scanMask.mul(discMask).mul(CH8_RETROSUN_SHADER_SETTINGS.discAlpha);
    const haloAlpha = haloFall.mul(CH8_RETROSUN_SHADER_SETTINGS.haloAlpha);
    const alpha = clamp(
        discAlpha.mul(isDisc).add(haloAlpha.mul(isHalo)).mul(breathe).mul(revealGain),
        0.0,
        CH8_RETROSUN_SHADER_SETTINGS.alphaCap,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    material.userData.emitsBloom = true;

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aKind: { array: kinds, itemSize: 1 },
    });
    // Two coincident quads at the group origin (max half-extent ~halo×breathe×heat ≈ 560);
    // a real bounding sphere lets the bounded set-piece frustum-cull when off-screen.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 600);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'synthwave-sun-tsl';
    mesh.frustumCulled = true;
    mesh.renderOrder = -95; // behind the city/spire, in front of the sky dome (-100)
    mesh.userData.readability = CH8_RETROSUN_SHADER_SETTINGS;
    return {
        mesh, material, geometry, uReveal: uRevealNode,
    };
}

// ── Skyline silhouette cards + horizon haze (creative plan ch8 item 2) ─────────────
//
// Flat near-black roofline cards placed between the Retrosun and the last tower rank
// so the sun rises BEHIND a city that reads kilometres deep — jagged rooflines,
// setbacks and antenna spikes, partially occluding the disc. No bloom; uOpacity
// exposed (material.uniforms) so the ecotone crossfade reaches the cards.
export function createSkylineSilhouetteTSL(uTime = uniform(0), { seedOffset = 0, lift = 0 } = {}) {
    const uOpacity = uniform(1);
    const vUv = uv();
    // The silhouette is static; uTime stays in the signature for builder uniformity
    // and is referenced as a no-op so the shared clock contract holds.
    const t0 = uTime.mul(0.0);
    // Blocky roofline: per-column heights hashed over ~26 columns, a narrower second
    // tier (setbacks), and antenna spikes on ~15% of blocks.
    const col = vUv.x.mul(26.0).add(t0).floor();
    const roofH = hash21(vec2(col, 3.7 + seedOffset)).mul(0.42).add(0.18);
    const tier2 = hash21(vec2(col, 9.1 + seedOffset)).mul(0.2);
    const cx = fract(vUv.x.mul(26.0));
    const setback = step(0.25, cx).mul(step(cx, 0.75));
    const roof = step(vUv.y, roofH).max(step(vUv.y, roofH.add(tier2)).mul(setback));
    const spike = step(0.85, hash21(vec2(col, 17.3 + seedOffset)))
        .mul(step(cx.sub(0.5).abs(), 0.03))
        .mul(step(vUv.y, roofH.add(tier2).add(0.22)));
    const mask = roof.max(spike);

    const material = new THREE.MeshBasicNodeMaterial();
    // Near-black silhouette; `lift` nudges the nearer card faintly blue so the two
    // ranks separate (#0A0F1F near, #07050F far — never RGB 0,0,0).
    material.colorNode = vec3(0.027 + lift, 0.02 + lift * 1.4, 0.059 + lift * 2.2);
    material.opacityNode = mask.mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge

    const geometry = new THREE.PlaneGeometry(1700, 300, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'skyline-silhouette';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// The magenta-violet HORIZON HAZE band — the chapter's missing mid-value layer: lifts
// the void's black floor behind the skyline and fakes kilometres of city light
// pollution (#C600FF bridging into #580E91, per the Outrun gradient rule).
export function createHorizonHazeTSL(uTime = uniform(0)) {
    const uOpacity = uniform(1);
    const vUv = uv();
    // The haze is static; uTime stays in the signature for builder uniformity.
    const t0 = uTime.mul(0.0);
    const colorNode = mix(
        vec3(0.345, 0.055, 0.569), // cyber grape #580E91
        vec3(0.776, 0.0, 1.0), // deep magenta #C600FF
        oneMinus(vUv.y).mul(0.8).add(t0),
    );
    const band = smoothstep(0.0, 0.25, vUv.y).mul(oneMinus(smoothstep(0.55, 1.0, vUv.y)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode.mul(0.68);
    material.opacityNode = band.mul(0.66).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge

    const geometry = new THREE.PlaneGeometry(1800, 340, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'horizon-haze-band';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ── Procedural lit-window facade (additive-read interior glow; bloom-eligible) ────

export const CH8_FACADE_VALUE_SETTINGS = Object.freeze({
    darkCutoff: 0.35,
    midCutoff: 0.88,
    brightCutoff: 0.975,
    dimGain: 0.12,
    midGain: 0.34,
    brightGain: 0.78,
    colorGain: 0.52,
    edgeSheen: 0.1,
});

/**
 * ONE shared facade NodeMaterial for the whole instanced tower canyon (QW8). The former
 * per-tower `uSeed`/`uGrid` UNIFORMS are now read as PER-INSTANCE attributes off the
 * InstancedMesh geometry, so all ~240 towers share this single material/program instead
 * of compiling ~240 unique ones. The look is byte-for-byte the same as the per-tower
 * material: identical window grid, hash seed, flicker, palette and fresnel sheen — only
 * the source of `seed`/`cols`/`rows` moved from a uniform to `attribute('aFacade')`.
 *
 *   aFacade = vec3(seed, cols, rows)  // per-instance, set in createCityBlocksTSL
 */
function createFacadeMaterial(uTime, uEnergy) {
    const uColorA = uniform(new THREE.Color(CYAN));
    const uColorB = uniform(new THREE.Color(MAGENTA));

    // Per-instance facade params (seed, cols, rows) — replaces the old per-material uniforms.
    const aFacade = attribute('aFacade', 'vec3');
    const seed = aFacade.x;
    const grid = vec2(aFacade.y, aFacade.z);

    const vUv = uv();
    const g = vUv.mul(grid);
    const cell = g.floor();
    const f = fract(g);

    // Window pane within mullions.
    const pane = step(0.14, f.x)
        .mul(step(f.x, 0.86))
        .mul(step(0.12, f.y))
        .mul(step(f.y, 0.9));

    const r = hash21(cell.add(seed));
    // WINDOW VALUE TIERS (creative plan ch8 item 3 — the bi-modal salt-and-pepper fix):
    // ~25% dark, ~55% DIM AMBIENT at a quarter intensity (under the bloom threshold),
    // ~15% mid, and only ~5% full-bright accent rows. The facades become the dark mass
    // the Retrosun needs behind them — light as punctuation, not confetti.
    const lit = step(CH8_FACADE_VALUE_SETTINGS.darkCutoff, r);
    const dimBand = oneMinus(step(CH8_FACADE_VALUE_SETTINGS.midCutoff, r));
    const midBand = step(CH8_FACADE_VALUE_SETTINGS.midCutoff, r)
        .mul(oneMinus(step(CH8_FACADE_VALUE_SETTINGS.brightCutoff, r)));
    const brightBand = step(CH8_FACADE_VALUE_SETTINGS.brightCutoff, r);
    const on = lit.mul(dimBand.mul(CH8_FACADE_VALUE_SETTINGS.dimGain)
        .add(midBand.mul(CH8_FACADE_VALUE_SETTINGS.midGain))
        .add(brightBand.mul(CH8_FACADE_VALUE_SETTINGS.brightGain)));
    const flick = sin(uTime.mul(r.mul(3.0).add(0.6)).add(r.mul(40.0))).mul(0.28).add(0.72);

    // Window colour: cyan/magenta; the warm-cream interior demoted to ≤5% (plan).
    let wcolor = mix(uColorA, uColorB, step(0.5, fract(r.mul(7.31))));
    wcolor = mix(wcolor, vec3(1.0, 0.82, 0.5), step(0.95, r));

    const base = vec3(0.018, 0.022, 0.045);
    // Fresnel edge sheen — view-space normal vs. direction to camera.
    const fres = pow(oneMinus(max(0.0, dot(normalize(normalView), positionViewDirection))), 3.0);

    let color = base;
    color = color.add(wcolor.mul(pane).mul(on)
        .mul(flick.mul(0.45).add(0.45))
        .mul(uEnergy.mul(0.32).add(0.72))
        .mul(CH8_FACADE_VALUE_SETTINGS.colorGain));
    color = color.add(mix(uColorA, uColorB, 0.5)
        .mul(fres)
        .mul(CH8_FACADE_VALUE_SETTINGS.edgeSheen));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.userData.emitsBloom = true;
    material.userData.valueTiers = CH8_FACADE_VALUE_SETTINGS;
    return material;
}

// Shared street datum: the wet-street plane and every tower base snap to this y so the
// city reads as GROUNDED skyscrapers rising off one road, not floating confetti.
const STREET_Y = -60;

export function createCityBlocksTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const group = new THREE.Group();
    group.name = 'city-blocks-tsl';
    const geometries = [];
    const materials = [];

    // A TRUE NEON CANYON the camera flies DOWN. This group is parented into the
    // path-aligned corridor container in urban-dreams.js, so local -Z is the camera's
    // forward travel (up the spline) and local ±X / ±Y are screen right / up. Lit-window
    // facades march down BOTH sides of the corridor from just behind the camera (z≈+50)
    // out to the finale (z≈-1100), HUGGING the centerline so the canyon walls flank the
    // path the camera actually sees instead of a distant off-axis cluster on black.
    //
    // FOUR lateral banks per side: an INNER wall that tightly lines the lane (fills the
    // sides of frame), a MID wall for body, an OUTER staggered skyline for depth, and a
    // CURTAIN bank behind the inner wall so screen-space gaps between towers are backed by
    // more lit facade rather than raw black. The ranks are dense and z-staggered tightly so
    // adjacent towers OVERLAP in screen space (no holes). Every tower is upright (no tilt)
    // and snapped to the common STREET_Y datum so the canyon reads as grounded skyscrapers.
    const RANKS = 30;
    const nearZ = 50; // just behind/beside the camera entry
    const farZ = -1100; // out past the finale spire
    // bank: lateral spread, jitter, z-stagger, height scale; baseDrop is derived from STREET_Y.
    const BANKS = [
        // inner wall — hugs the lane and fills the sides of frame
        {
            lateral: 32, latJit: 8, zStag: 6, zJit: 10, hScale: 1.0,
        },
        // curtain bank — sits just behind the inner wall to plug screen-space gaps
        {
            lateral: 50, latJit: 6, zStag: 16, zJit: 8, hScale: 1.6,
        },
        // mid wall — body of the canyon
        {
            lateral: 70, latJit: 12, zStag: -10, zJit: 14, hScale: 1.22,
        },
        // outer skyline — staggered depth silhouette
        {
            lateral: 112, latJit: 18, zStag: -26, zJit: 22, hScale: 1.45,
        },
    ];
    // A few wider "landmark" towers break the rhythm — placed at fixed ranks so they read
    // as architecture, not noise. Keyed by rank → side.
    const LANDMARKS = { 6: -1, 14: 1, 23: -1 };

    // QW8: ONE InstancedMesh + ONE shared facade material for the whole canyon (~240
    // towers → ~1 draw + ~1 program, down from ~240 + ~240). Per-tower variation that was
    // baked into unique BoxGeometries + unique facade materials is now carried by:
    //   • the per-instance transform (scale = the tower's width/height/depth) and
    //   • the per-instance `aFacade` attribute (seed, cols, rows).
    // The canyon layout (banks/ranks/curtain, lateral spread, z-stagger, landmark widths,
    // STREET_Y snap) is byte-for-byte the same as the per-mesh version — only the draw path
    // changed. A unit BoxGeometry is shared and scaled per instance; because the box is
    // centred, scaling preserves the old centre-at-(STREET_Y + height/2) placement.
    const TOWER_COUNT = RANKS * 2 * BANKS.length;
    const sharedBox = new THREE.BoxGeometry(1, 1, 1);
    const facadeMaterial = createFacadeMaterial(uTimeNode, uEnergyNode);
    const towers = new THREE.InstancedMesh(sharedBox, facadeMaterial, TOWER_COUNT);
    towers.name = 'city-tower-instances-tsl';
    // Static layout — never re-uploaded after build (drift lives in the shader via uTime).
    towers.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const facadeArray = new Float32Array(TOWER_COUNT * 3); // (seed, cols, rows) per instance
    const scratchMatrix = new THREE.Matrix4();
    const scratchPos = new THREE.Vector3();
    const scratchQuat = new THREE.Quaternion(); // identity — towers are upright (no tilt)
    const scratchScale = new THREE.Vector3();

    let instance = 0;
    for (let rank = 0; rank < RANKS; rank += 1) {
        const t = rank / (RANKS - 1); // 0 near → 1 far
        const z = nearZ + (farZ - nearZ) * t;
        // Taller towers toward the far end so the canyon walls keep filling the frame as
        // they recede toward the finale spire.
        const heightBias = 46 + t * 96;
        const landmarkSide = LANDMARKS[rank];

        // Plain for-loops (not forEach) so nothing closes over the mutable `instance`
        // counter — keeps the per-instance layout identical to the former per-mesh nesting.
        for (let s = 0; s < 2; s += 1) {
            const side = s === 0 ? -1 : 1;
            for (let tier = 0; tier < BANKS.length; tier += 1) {
                const bank = BANKS[tier];
                const isLandmark = landmarkSide === side && tier <= 1;
                // Wider towers (18–34, landmarks wider still) so neighbours overlap in
                // screen space and the wall reads continuous, not as scattered slats.
                const width = (isLandmark ? 34 + Math.random() * 18 : 18 + Math.random() * 16);
                const height = (heightBias + Math.random() * (40 + tier * 34))
                    * bank.hScale * (isLandmark ? 1.35 : 1.0);
                const depth = 12 + Math.random() * 18;
                const rows = Math.max(6, Math.round(height / 4));
                const cols = Math.max(3, Math.round(width / 4));

                const lateral = bank.lateral + Math.random() * bank.latJit;
                const zJitter = bank.zStag + (Math.random() - 0.5) * bank.zJit;
                // Snap the base to the wet-street datum so the tower stands ON the road and
                // its glow lines up with the street reflection; height carries it up past
                // the path overhead. (base at STREET_Y → centre at STREET_Y + height/2.)
                scratchPos.set(
                    side * lateral,
                    STREET_Y + height * 0.5,
                    z + zJitter,
                );
                scratchScale.set(width, height, depth);
                scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
                towers.setMatrixAt(instance, scratchMatrix);

                facadeArray[instance * 3] = Math.random() * 100; // seed
                facadeArray[instance * 3 + 1] = cols;
                facadeArray[instance * 3 + 2] = rows;

                instance += 1;
            }
        }
    }
    towers.instanceMatrix.needsUpdate = true;
    sharedBox.setAttribute('aFacade', new THREE.InstancedBufferAttribute(facadeArray, 3));

    group.add(towers);
    geometries.push(sharedBox);
    materials.push(facadeMaterial);

    return {
        group, geometries, materials, material: facadeMaterial,
    };
}

// ── Continuous curtain-wall backdrop (dim lit facade so gaps never show raw black) ──

/**
 * One tall, dim, continuous wall mesh per side BEHIND every block bank. Where the gaps
 * between canyon towers would otherwise reveal pure black, this curtain shows a faint
 * indigo facade with sparse lit windows — the void always reads as "a distant lit wall,"
 * never RGB-black. Far cheaper than more towers: two long boxes, low-detail facade.
 */
export function createCurtainWallTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const group = new THREE.Group();
    group.name = 'curtain-wall-backdrop-tsl';
    const geometries = [];
    const materials = [];

    const WALL_LEN = 1400;
    const WALL_H = 420;
    const WALL_Z = -520; // centred along the corridor span

    [-1, 1].forEach((side) => {
        const vUv = uv();
        // Coarse window grid — dim, sparse, indigo. Reads only as a faint lit backdrop.
        const g = vUv.mul(vec2(56.0, 22.0));
        const cell = g.floor();
        const f = fract(g);
        const pane = step(0.18, f.x).mul(step(f.x, 0.82))
            .mul(step(0.16, f.y)).mul(step(f.y, 0.86));
        const r = hash21(cell.add(side * 13.0));
        const on = step(0.62, r); // most curtain windows dark
        const flick = sin(uTimeNode.mul(r.mul(2.0).add(0.4)).add(r.mul(50.0))).mul(0.2).add(0.8);
        const wtint = mix(vec3(0.0, 0.14, 0.2), vec3(0.16, 0.04, 0.16), fract(r.mul(5.7)));

        // Deep indigo base so the wall body is never black, plus faint windows on top.
        const baseWall = vec3(0.020, 0.018, 0.044);
        const color = baseWall.add(
            wtint.mul(pane).mul(on).mul(flick).mul(uEnergyNode.mul(0.22).add(0.34)),
        );

        const material = new THREE.MeshBasicNodeMaterial();
        material.colorNode = color;
        material.opacityNode = uniform(1.0);
        material.side = THREE.FrontSide;
        // No emitsBloom — the curtain is a backdrop, not a bloom source.

        const geometry = new THREE.BoxGeometry(8, WALL_H, WALL_LEN);
        const mesh = new THREE.Mesh(geometry, material);
        // Behind the outer skyline bank, facing the lane; base near the street datum.
        mesh.position.set(side * 150, STREET_Y + WALL_H * 0.5 - 40, WALL_Z);
        mesh.renderOrder = -90; // behind towers, in front of the sky dome (-100)
        group.add(mesh);
        geometries.push(geometry);
        materials.push(material);
    });

    return {
        group, geometries, materials, material: materials[0],
    };
}

// ── Energy-conduit core for the spire (additive; bloom-eligible) ──────────────────

function createConduitMaterial(uTime, uEnergy, { colorA, colorB, uReveal } = {}) {
    const uColorA = uniform(new THREE.Color(colorA ?? CYAN));
    const uColorB = uniform(new THREE.Color(colorB ?? MAGENTA));
    // Finale reveal ramp (0 baseline glow → 1 full payoff) so the spire ignites as the
    // camera approaches the final node. Defaults to a lit baseline so the structure is
    // always present (never an unlit dead column), then blooms toward 100% progress.
    const uRevealNode = uReveal ?? uniform(1.0);

    const vUv = uv();

    // Vertical energy pulses travelling up the structure.
    const pulseRaw = sin(vUv.y.mul(26.0).sub(uTime.mul(3.0))).mul(0.5).add(0.5);
    const pulse = pow(pulseRaw, 3.0);
    const seams = step(0.92, fract(vUv.x.mul(8.0)));
    const fres = pow(oneMinus(max(0.0, dot(normalize(normalView), positionViewDirection))), 2.0);

    // REVEAL ENERGY SURGE: a fast, bright wavefront rushing UP the conduit, gated by the
    // reveal ramp so on ignition a white-hot pulse fires from the street to the crown. The
    // surge head position is driven by uReveal so it visibly "lights up" the spire.
    const surgePhase = uRevealNode.mul(1.4).sub(0.2); // travels past the top as reveal→1
    const surgeBand = smoothstep(0.18, 0.0, vUv.y.sub(surgePhase).abs());
    const surge = surgeBand.mul(uRevealNode); // only present while igniting

    const color = mix(uColorA, uColorB, vUv.y);
    // Reveal lifts the conduit from a dim baseline (0.45) to full (1.0) glow.
    const revealGain = uRevealNode.mul(0.55).add(0.45);
    const glow = pulse.mul(0.7).add(seams.mul(0.5)).add(fres.mul(0.8))
        .mul(uEnergy.mul(0.8).add(0.7))
        .mul(revealGain);
    // Add the surge as a white-hot core lift on top of the tinted glow.
    const coreColor = mix(color, vec3(1.0, 1.0, 1.0), surge.mul(0.8));
    const litGlow = glow.add(surge.mul(0.9));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = coreColor.mul(litGlow);
    // Cap below 1.0 (soft-feathered, ACES + threshold bloom downstream) — no white blowout.
    material.opacityNode = clamp(litGlow, 0.0, 0.92);
    material.transparent = true;
    material.depthWrite = true;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    return material;
}

/**
 * Build the neon megastructure spire. The conduit cores are converted TSL
 * NodeMaterials; the torus frames, cone crown, and beacon PointLight are
 * MeshBasic/light primitives left as-is (they render on WebGPURenderer unchanged).
 */
export function createNeonCitySpireTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);
    // FINALE REVEAL uniform — the chapter update() ramps this 0→1 as path progress nears
    // 100%, igniting the megastructure as the closing payoff behind the final node.
    const uReveal = uniform(0.4);

    const group = new THREE.Group();
    group.name = 'neon-megastructure-spire-tsl';
    // DEAD AHEAD on the end-of-path sightline: x=0 keeps it on the corridor centerline
    // (parented into the path-aligned container in urban-dreams.js, so local -Z is the
    // camera's forward axis). Lowered to y=-40 so the base sits on the wet-street datum and
    // the spire towers from BELOW the street past the top of frame; z=-560 pulls it nearer
    // so the colossal silhouette dominates the centerline as the journey's final hero image.
    group.position.set(0, -40, -560);

    const geometries = [];
    const materials = [];

    // A colossal tapering megastructure: a wide base that stands on the street climbing to a
    // narrow crown well above the top of frame (~+260 with the group's -40 offset). Each
    // tier's conduit core takes the shared reveal uniform so the whole spire ignites at once.
    const tiers = [
        { height: 260, width: 22, y: 200 },
        { height: 210, width: 38, y: 70 },
        { height: 150, width: 64, y: -40 },
        { height: 96, width: 96, y: -120 },
    ];

    tiers.forEach(({ height, width, y }, index) => {
        // Energy-conduit core (converted) — reveal-driven glow.
        const coreGeo = new THREE.BoxGeometry(width, height, width * 0.55);
        const coreMat = createConduitMaterial(uTimeNode, uEnergyNode, {
            colorA: index % 2 === 0 ? CYAN : MAGENTA,
            colorB: index % 2 === 0 ? MAGENTA : CYAN,
            uReveal,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.y = y;
        group.add(core);
        geometries.push(coreGeo);
        materials.push(coreMat);

        // Torus frame — MeshBasic, left as-is.
        const frameGeo = new THREE.TorusGeometry(width * 0.72, 0.8, 8, 72);
        const frame = new THREE.Mesh(
            frameGeo,
            new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? CYAN : MAGENTA,
                transparent: true,
                opacity: 0.42,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        frame.rotation.x = Math.PI * 0.5;
        frame.position.y = y + height * 0.42;
        group.add(frame);
        geometries.push(frameGeo);
    });

    // Crown height — top of the tallest tier (y 200, height 260 → top ≈ 330).
    const CROWN_Y = 332;

    // Cone crown — MeshBasic, left as-is.
    const crownGeo = new THREE.ConeGeometry(26, 76, 6);
    const crown = new THREE.Mesh(
        crownGeo,
        new THREE.MeshBasicMaterial({
            color: MAGENTA,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }),
    );
    crown.position.y = CROWN_Y;
    group.add(crown);
    geometries.push(crownGeo);

    // EXPANDING SHOCK RING — an additive torus at the crown that, on the reveal, scales
    // outward (eased) and fades, a triumphant pulse radiating from the ignited beacon. Its
    // base scale is tiny so at reveal=0 it's invisible; the chapter update() drives the
    // reveal-eased scale + opacity each frame. Soft additive, capped — bloom gilds it.
    const shockRingGeo = new THREE.TorusGeometry(8, 1.4, 8, 64);
    const shockRingMat = new THREE.MeshBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const shockRing = new THREE.Mesh(shockRingGeo, shockRingMat);
    shockRing.rotation.x = Math.PI * 0.5; // lies flat, expands across the canyon
    shockRing.position.y = CROWN_Y;
    shockRing.scale.setScalar(0.001);
    group.add(shockRing);
    geometries.push(shockRingGeo);
    group.userData.shockRing = shockRing;

    // Beacon light atop the spire — left as-is.
    const beacon = new THREE.PointLight(0xff66c4, 0.8, 520);
    beacon.position.set(0, CROWN_Y + 14, 0);
    group.add(beacon);
    group.userData.beacon = beacon;
    // Expose the reveal uniform so the chapter update() can ramp it with progress.
    group.userData.uReveal = uReveal;

    return {
        group, geometries, materials, material: materials[0], uReveal, shockRing,
    };
}

// ── Holographic sign (scanlines + scroll + flicker; additive, bloom-eligible) ─────

function createSignMaterial(uTime, uEnergy, { color } = {}) {
    const uColor = uniform(new THREE.Color(color ?? CYAN));

    const vUv = uv();

    const scan = sin(vUv.y.add(uTime.mul(0.12)).mul(60.0)).mul(0.5).add(0.5);
    const scroll = step(0.5, fract(vUv.x.mul(6.0).sub(uTime.mul(0.35))));
    const glyphs = hash21(vUv.mul(vec2(18.0, 5.0)).floor().add(uTime.mul(1.2).floor()));
    const body = scan.mul(0.4).add(0.35)
        .mul(scroll.mul(0.5).add(0.5))
        .mul(glyphs.mul(0.6).add(0.6));
    const edge = smoothstep(0.0, 0.06, vUv.x)
        .mul(smoothstep(1.0, 0.94, vUv.x))
        .mul(smoothstep(0.0, 0.12, vUv.y))
        .mul(smoothstep(1.0, 0.88, vUv.y));
    const a = body.mul(edge).mul(uEnergy.mul(0.4).add(0.45));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor.mul(body.add(0.8));
    material.opacityNode = a;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;
    return material;
}

export function createHologramSignsTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const group = new THREE.Group();
    group.name = 'hologram-sign-stack-tsl';
    const geometries = [];
    const materials = [];

    // Signs flank the corridor and stick to the cohesive cyan/magenta duo (the former
    // purple and green signs fought the palette). Alternating sides frame the path.
    const configs = [
        {
            x: -96, y: 40, z: -600, w: 42, h: 14, color: CYAN,
        },
        {
            x: 96, y: 24, z: -630, w: 50, h: 16, color: MAGENTA,
        },
        {
            x: -70, y: -4, z: -560, w: 36, h: 12, color: MAGENTA,
        },
        {
            x: 60, y: 60, z: -690, w: 58, h: 15, color: CYAN,
        },
    ];

    configs.forEach((config, index) => {
        const geometry = new THREE.PlaneGeometry(config.w, config.h);
        const material = createSignMaterial(uTimeNode, uEnergyNode, { color: config.color });
        const sign = new THREE.Mesh(geometry, material);
        sign.position.set(config.x, config.y, config.z);
        sign.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.18;
        group.add(sign);
        geometries.push(geometry);
        materials.push(material);
    });

    return {
        group, geometries, materials, material: materials[0],
    };
}

// ── Full-corridor WET STREET (one long road under the climb; backstop, NO bloom) ──

export function createWetReflectionPlaneTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    // One long wet road spanning the WHOLE climb, lying flat under the corridor at the
    // street datum so the camera always has a floor (no ~80% void). u runs across the lane
    // (width), v runs along its length (depth toward the finale). Wet asphalt base + neon
    // lanes scrolling along the length + a bright cyan centerline under the path conduit.
    const p = uv();
    const acrossSigned = p.x.sub(0.5); // -0.5..0.5 across the lane

    // Puddle ripple distortion + along-length scroll (the road slides under the camera).
    // Octave count trimmed by one (5→4) as a per-fragment cost reduction; the puddle
    // ripple is a subtle distortion driver, so the finest octave is not load-bearing.
    const ripple = fbm2(vec2(p.x.mul(7.0), p.y.mul(3.0).add(uTimeNode.mul(0.22))), 4);

    // NEON LANE SMEARS aligned to the tower banks: vertical bright bands at the lateral X
    // of the inner/mid/outer walls so each smear reads as a tower's reflection on the wet
    // road (cheap wall→floor reflection). Mirrored on ±x via abs().
    const lanePos = acrossSigned.abs().add(ripple.mul(0.012));
    const laneAt = (x) => pow(smoothstep(0.05, 0.0, lanePos.sub(x).abs()), 1.4);
    const lanes = laneAt(0.115) // inner wall (≈ lateral 32 / half-width 280)
        .add(laneAt(0.18)) // curtain bank
        .add(laneAt(0.25)) // mid wall
        .add(laneAt(0.40)); // outer skyline
    // Lanes brighter near the buildings (frame top) and streak along the length.
    const laneFlow = sin(p.y.mul(30.0).sub(uTimeNode.mul(2.0)).add(ripple.mul(5.0)))
        .mul(0.5).add(0.5);
    const laneGlow = lanes.mul(laneFlow.mul(0.5).add(0.5));

    // CENTERLINE CYAN GLOW directly beneath the path conduit — a soft bright strip down
    // the middle of the road tying the wet street to the cyan path identity.
    const centerline = pow(smoothstep(0.045, 0.0, acrossSigned.abs()), 1.5);
    const centerShimmer = sin(p.y.mul(20.0).sub(uTimeNode.mul(2.6))).mul(0.2).add(0.8);

    const cyan = vec3(0.0, 0.85, 1.0);
    const magenta = vec3(1.0, 0.18, 0.68);
    // Lane colour leans cyan near centre, magenta toward the far walls (cyan owns the road).
    const laneColor = mix(cyan, magenta, acrossSigned.abs().mul(1.6).add(ripple.mul(0.1)));
    // Deep indigo wet-asphalt base so the road body is never pure black even between lanes.
    const asphalt = vec3(0.012, 0.016, 0.040);

    const color = asphalt
        .add(laneColor.mul(laneGlow.mul(0.34)))
        .add(cyan.mul(centerline).mul(centerShimmer).mul(0.38));

    // Distance fade so the near road is rich and the far end dissolves into haze, plus a
    // gentle edge feather so the road edges don't read as a hard rectangle.
    const lengthFade = smoothstep(1.0, 0.04, p.y).mul(0.7).add(0.3);
    const edgeFeather = smoothstep(0.5, 0.42, acrossSigned.abs());
    const alpha = clamp(
        color.length().mul(lengthFade).mul(edgeFeather)
            .mul(uEnergyNode.mul(0.4).add(0.7)),
        0.0,
        0.62,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(uEnergyNode.mul(0.25).add(0.82));
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    // Lay the road flat under the whole corridor (local -Z forward, so length runs along z).
    const geometry = new THREE.PlaneGeometry(280, 1400, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wet-neon-reflection-plane-tsl';
    mesh.position.set(0, STREET_Y, -520);
    mesh.rotation.x = -Math.PI * 0.5; // perfectly flat road
    mesh.renderOrder = -80;
    return { mesh, material, geometry };
}

// ── Ground neon haze / light pool (FBM fog + radial falloff; NO bloom) ────────────

function createHazeMaterial(uTime, uEnergy) {
    const vUv = uv();
    const c = vUv.sub(0.5);
    const fog = fbm2(vUv.mul(5.0).add(vec2(uTime.mul(0.05), 0.0)));
    const radial = smoothstep(0.55, 0.0, length(c));
    const color = mix(vec3(0.0, 0.34, 0.48), vec3(0.48, 0.08, 0.34), vUv.x);
    const a = radial.mul(fog.mul(0.14).add(0.12)).mul(uEnergy.mul(0.34).add(0.48));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = a;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    return material;
}

export function createGroundHazeTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const group = new THREE.Group();
    group.name = 'ground-neon-haze-tsl';
    const geometries = [];
    const materials = [];

    // March light-pool haze the WHOLE corridor (near → finale), one pool under each tower
    // gap, so the road glows with neon mist along the entire climb instead of clustering at
    // the finale. Alternating lateral bias so the pools weave between the canyon banks.
    const COUNT = 9;
    const nearZ = 40;
    const farZ = -1080;
    // ONE InstancedMesh + ONE shared haze material for all 9 pools (~9 draws + ~9 pipelines
    // → ~1 + ~1). The pools were already byte-identical PlaneGeometry meshes that share this
    // single material and differ ONLY by a flat (rotation.x = -π/2) transform and a per-pool
    // lateral/z position — pure transform variation, so collapsing them into one instanced
    // draw is zero-visual. The shared material has no custom positionNode (standard plane
    // verts), and update() never touches the pools (the group is added but never stored in
    // userData), so per-instance instanceMatrix is the only state. A unit-scale PlaneGeometry
    // (260×170, identical to the former per-pool geometry) is shared and the old per-mesh
    // position+rotation is composed verbatim into instanceMatrix, preserving placement exactly.
    const sharedMaterial = createHazeMaterial(uTimeNode, uEnergyNode);
    materials.push(sharedMaterial);

    const sharedPlane = new THREE.PlaneGeometry(260, 170);
    const pools = new THREE.InstancedMesh(sharedPlane, sharedMaterial, COUNT);
    pools.name = 'ground-neon-haze-instances-tsl';
    // Static layout — never re-uploaded after build (drift lives in the shader via uTime).
    pools.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const scratchMatrix = new THREE.Matrix4();
    const scratchPos = new THREE.Vector3();
    const scratchQuat = new THREE.Quaternion();
    const scratchScale = new THREE.Vector3(1, 1, 1); // unit scale = the shared 260×170 plane
    // Identical to the former per-mesh `haze.rotation.x = -Math.PI * 0.5` (Euler XYZ → quat).
    scratchQuat.setFromEuler(new THREE.Euler(-Math.PI * 0.5, 0, 0));

    for (let index = 0; index < COUNT; index += 1) {
        const t = index / (COUNT - 1);
        const lateral = ((index % 3) - 1) * 64;
        // Byte-identical to the old per-pool `haze.position.set(...)`.
        scratchPos.set(lateral, STREET_Y + 14, nearZ + (farZ - nearZ) * t);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        pools.setMatrixAt(index, scratchMatrix);
    }
    pools.instanceMatrix.needsUpdate = true;

    group.add(pools);
    geometries.push(sharedPlane);

    return {
        group, geometries, materials, material: materials[0],
    };
}

// ── Volumetric neon haze stack (vertical camera-facing curtains; additive, capped) ─

/**
 * A corridor-length stack of large vertical haze billboards that fill the LANE AIR with
 * volumetric neon fog — cyan low, magenta high. Built as ONE instanced billboard mesh
 * (no per-frame allocation) using the yaw-locked `billboardVerticalWorld` helper so the
 * curtains stand upright while facing the camera. Additive + soft-feathered + capped so
 * the air glows without blowing to white. The chapter update() ticks uTime/uEnergy.
 */
export function createNeonHazeStackTSL(uTime, uEnergy) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const COUNT = 7;
    const bases = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT * 2);
    const seeds = new Float32Array(COUNT);
    const nearZ = 30;
    const farZ = -1060;
    for (let i = 0; i < COUNT; i += 1) {
        const t = i / (COUNT - 1);
        bases[i * 3] = ((i % 2) === 0 ? -1 : 1) * (18 + (i % 3) * 10); // weave across lane
        bases[i * 3 + 1] = STREET_Y + 70 + (i % 4) * 26; // mid-air column centres
        bases[i * 3 + 2] = nearZ + (farZ - nearZ) * t;
        sizes[i * 2] = 130 + (i % 3) * 26; // half-width across the lane
        sizes[i * 2 + 1] = 150 + (i % 4) * 30; // half-height (tall column)
        seeds[i] = i * 1.37;
    }

    const geometry = makeQuadInstancedGeometry(COUNT, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 2 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'vec2');
    const aSeed = attribute('aSeed', 'float');

    const positionNode = billboardVerticalWorld(aBase, aSize.mul(0.5));

    const vUv = uv();
    const c = vUv.sub(0.5);
    // Soft radial-ish falloff that reaches 0 well before the quad edge (feathered).
    const radial = smoothstep(0.5, 0.06, length(vec2(c.x.mul(1.3), c.y)));
    // Rolling fog texture so the curtain breathes rather than reading as a flat card.
    const fog = fbm2(vec2(vUv.x.mul(3.0).add(aSeed), vUv.y.mul(2.0).add(uTimeNode.mul(0.08))));
    // Cyan low / magenta high vertical gradient — the chapter's two-tone air.
    const hazeColor = mix(vec3(0.0, 0.34, 0.52), vec3(0.50, 0.06, 0.36), vUv.y);
    const alpha = clamp(
        radial.mul(fog.mul(0.45).add(0.45)).mul(uEnergyNode.mul(0.36).add(0.28)).mul(0.16),
        0.0,
        0.26,
    );

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = hazeColor;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-haze-stack-tsl';
    mesh.frustumCulled = false;
    mesh.renderOrder = -70;
    return { mesh, material, geometry };
}

/**
 * Assemble the converted Urban Dreams materials into one group + a shared uTime/uEnergy
 * uniform the caller ticks each frame. Mirrors createDeepOceanPilotTSL — used by the
 * standalone WebGPU pilot validation page. The rain Points, neon rails, sky traffic
 * tubes, and ambient lighting from the live chapter are NOT included here (they render
 * unchanged on WebGPURenderer and are not part of the GLSL→TSL conversion).
 */
export function createUrbanDreamsPilotTSL() {
    const uTime = uniform(0);
    const uEnergy = uniform(0.45);
    const group = new THREE.Group();
    group.name = 'urban-dreams-pilot-tsl';

    const sky = createSkyGradientTSL(uTime, uEnergy);
    const sun = createSynthwaveSunTSL(uTime, uEnergy);
    const curtain = createCurtainWallTSL(uTime, uEnergy);
    const city = createCityBlocksTSL(uTime, uEnergy);
    const spire = createNeonCitySpireTSL(uTime, uEnergy);
    const signs = createHologramSignsTSL(uTime, uEnergy);
    const reflection = createWetReflectionPlaneTSL(uTime, uEnergy);
    const haze = createGroundHazeTSL(uTime, uEnergy);
    const hazeStack = createNeonHazeStackTSL(uTime, uEnergy);

    group.add(
        sky.mesh,
        sun.mesh,
        curtain.group,
        city.group,
        spire.group,
        signs.group,
        reflection.mesh,
        haze.group,
        hazeStack.mesh,
    );

    const parts = [sky, sun, curtain, city, spire, signs, reflection, haze, hazeStack];

    return {
        group,
        uniforms: { uTime, uEnergy },
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
                part.geometries?.forEach?.((g) => g.dispose?.());
                part.materials?.forEach?.((mat) => mat.dispose?.());
            });
        },
    };
}

export default createUrbanDreamsPilotTSL;

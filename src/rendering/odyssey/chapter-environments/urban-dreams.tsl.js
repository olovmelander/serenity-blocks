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
 * 2026-10-20 NEON CITY overhaul (docs/ODYSSEY_OVERHAUL_CH8_2026-10.md): the sky (a smog
 * ceiling lit from below, sheet lightning), the facades (lit by the city's glow map, standing
 * in the neon air) and the wet boulevard (traffic, kerb LEDs, the Retrosun traced in the
 * water) are rewritten here on the shared neon modules in ./shared/odyssey-neon-*.js; the
 * spire lost its torus frames and cone for a needle mast and a beacon. The holo signs, ground
 * haze, haze stack and curtain wall builders below are no longer used by the live chapter
 * (kept for the standalone pilot harness, createUrbanDreamsPilotTSL).
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    Fn,
    length,
    max,
    min,
    mix,
    mod,
    modelWorldMatrixInverse,
    normalGeometry,
    normalize,
    normalView,
    oneMinus,
    positionLocal,
    positionViewDirection,
    pow,
    reflect,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { acquireChapterLight } from './shared/chapter-light-pool.js';
import {
    CH8_CITY_LAYOUT,
    RETROSUN_CITY_POS,
    STREET_Y,
    bakeNeonGlow,
    dealCityTowers,
    planNeonSigns,
} from './shared/odyssey-neon-city-plan.js';
import {
    NEON_AIR,
    createNeonCityUniforms,
    createNeonGlowTexture,
    neonAir,
    neonAtmosphere,
    neonCityPos,
    neonGlow,
    neonIgnition,
    neonSpireLight,
} from './shared/odyssey-neon-light.tsl.js';
import { hash21 } from './shared/odyssey-tsl-noise.js';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';
import { makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

/**
 * fbm2's octave walk (rotate by mat2(0.8, 0.6, -0.6, 0.8), lacunarity 2.02, amplitude 0.5^k)
 * read from the shared baked lattice — one texture fetch per octave instead of noise2's four
 * hashes (seamless pass). Each octave samples its own INTEGER z-plane of the lattice: a
 * half-integer z would average two planes and shrink the noise's spread, moving every
 * threshold tuned against noise2.
 * @param {*} pInput vec2 node
 * @param {number} octaves
 * @returns {*} float node in ~[0, sum of amplitudes]
 */
export function latticeFbm2(pInput, octaves = 3) {
    let value = float(0.0);
    let amplitude = 0.5;
    let p = vec2(pInput);
    for (let i = 0; i < octaves; i += 1) {
        value = value.add(latticeNoise3(vec3(p.x, p.y, 3 + i * 11)).mul(amplitude));
        const rx = p.x.mul(0.80).add(p.y.mul(-0.60));
        const ry = p.x.mul(0.60).add(p.y.mul(0.80));
        p = vec2(rx, ry).mul(2.02);
        amplitude *= 0.5;
    }
    return value;
}

const CYAN = 0x00f2ff;
const MAGENTA = 0xff3fb4;

// ── STAGE-SPACE billboards ─────────────────────────────────────────────────────────
// The shared billboardWorld()/billboardVerticalWorld() take `center` in WORLD space, but
// every urban billboard lives in the ROTATED corridor (or the translated chapter group), so
// their camera vector mixed spaces: the quads faced the WORLD ORIGIN, and inside the
// corridor rotation the Retrosun disc turned nearly edge-on (it read as a dark smudge).
// These variants bring the camera into the mesh's LOCAL space first, so a quad faces the
// camera from any parent transform, with the stage's local +Y as its up (scanlines and
// haze columns stay level with the city horizon).

/**
 * Camera-facing quad corner in LOCAL space (any parent transform), up = local +Y.
 * @param {*} center vec3 local-space centre
 * @param {*} size float half-extent (local units)
 * @returns {*} vec3 local position
 */
export function billboardStage(center, size) {
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const toCam = normalize(camLocal.sub(center));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    const up = cross(toCam, right);
    const corner = positionLocal.xy;
    return center.add(right.mul(corner.x.mul(size))).add(up.mul(corner.y.mul(size)));
}

/**
 * Yaw-only camera-facing quad in LOCAL space (stands upright on local +Y).
 * @param {*} center vec3 local-space centre
 * @param {*} sizeXY vec2 (half-width, half-height)
 * @returns {*} vec3 local position
 */
export function billboardStageVertical(center, sizeXY) {
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const toCam = camLocal.sub(center);
    const flat = normalize(vec3(toCam.x, 0.0, toCam.z));
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), flat));
    const corner = positionLocal.xy;
    const size = vec2(sizeXY);
    return center.add(right.mul(corner.x.mul(size.x))).add(vec3(0.0, 1.0, 0.0).mul(corner.y.mul(size.y)));
}

// ── Night-sky gradient dome (-100 backstop; must NOT bloom) ───────────────────────

export function createSkyGradientTSL(uTime, uEnergy, { uReveal, uStorm } = {}) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);
    const revealNode = uReveal ?? uniform(0);
    const stormNode = uStorm ?? uniform(0);
    const uOpacity = uniform(1.0);

    // 2026-10-20 NEON CITY (after Neon District's sky, neon-district-sky.js createSky): the sky
    // over a city in the rain is a CEILING OF SMOG LIT FROM BELOW. The old dome (a gradient, a
    // drifting fbm band and a field of hashed "bokeh" dots) read as a synthwave poster; this one
    // is low cloud, rose over one district and cyan over the next, brightest where it hangs
    // nearest the city, with dark gaps between the billows. At the horizon it is the city's own
    // haze, a little brighter than anything standing in it, so the far towers stand dark against
    // it. It brightens as the spire fires.
    const colorNode = Fn(() => {
        const dir = normalize(positionLocal).toVar();
        const up = max(dir.y, 0.0).toVar();
        const azimuth = atan(dir.z, dir.x);

        // The low sky: the city's haze, brightest at the horizon.
        const low = mix(vec3(0.085, 0.032, 0.12), vec3(0.03, 0.015, 0.05), smoothstep(0.0, 0.3, up));
        const pool = sin(azimuth.mul(3.0).add(uTimeNode.mul(0.03))).mul(0.5).add(0.5);
        const band = mix(vec3(0.14, 0.03, 0.2), vec3(0.02, 0.16, 0.24), pool)
            .mul(exp(up.mul(-9.0))).mul(uEnergyNode.mul(0.3).add(0.65));

        // The smog ceiling: the view ray meets a slab overhead.
        const cuv = vec2(dir.x, dir.z).div(up.add(0.12)).toVar();
        const drift = uTimeNode.mul(0.004);
        const n1 = latticeNoise3(vec3(cuv.x.mul(1.1).add(drift), cuv.y.mul(1.1).add(drift.mul(0.6)), 4.2));
        const n2 = latticeNoise3(vec3(cuv.x.mul(3.1).sub(drift.mul(1.7)), cuv.y.mul(3.1).add(drift), 9.1));
        const body = n1.mul(0.62).add(n2.mul(0.38));
        const cloud = smoothstep(0.34, 0.66, body);
        const veil = smoothstep(0.03, 0.24, up);
        // The city lights the cloud bottoms: rose over one district, cyan over the next.
        const district = smoothstep(0.38, 0.62, latticeNoise3(vec3(cuv.x.mul(0.16), cuv.y.mul(0.16), 1.3)));
        const tint = mix(vec3(1.0, 0.12, 0.48), vec3(0.08, 0.6, 1.0), district);
        // Billows: lit from below, so the bottom of each lump is bright and its top is shade.
        const billow = smoothstep(0.45, 0.85, n2).mul(0.5).add(0.75);
        const underlight = mix(vec3(0.09, 0.034, 0.13), tint.mul(0.12), 0.42)
            .mul(exp(up.mul(-1.9)).mul(1.6).add(0.12))
            .mul(billow)
            .mul(revealNode.mul(0.25).add(1.0));
        const gap = vec3(0.006, 0.005, 0.016);
        const ceiling = mix(gap, underlight, cloud);
        // Sheet lightning inside the smog now and then (Neon District's storm): a patch of the
        // ceiling lit cold from within for a moment (resolveUrbanStorm drives it).
        const cell = latticeNoise3(vec3(cuv.x.mul(0.22).add(uTimeNode.mul(0.01)), cuv.y.mul(0.22), 7.7));
        const sheet = smoothstep(0.5, 0.8, cell).mul(cloud.mul(0.7).add(0.3)).mul(veil);
        return mix(low.add(band), ceiling, veil)
            .add(vec3(0.5, 0.62, 1.0).mul(sheet).mul(stormNode).mul(0.55));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.opacityNode = uOpacity;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge (manager reads material.uniforms)
    material.side = THREE.BackSide;
    material.transparent = true;
    material.depthWrite = false;

    // 440 -> 1800 (seamless pass). The paint is purely directional (normalize(positionLocal)),
    // so the radius only sets DEPTH — and at 440 the dome sat in FRONT of the far tower ranks
    // (z to -650), the Retrosun (-700) and the far street (-1220). That never showed while the
    // dome drew first and everything painted over it; once the towers draw first and occlude
    // (urban-dreams.js update), the dome must lie behind every piece of the city.
    const geometry = new THREE.SphereGeometry(1800, 32, 20);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return { mesh, material, geometry };
}

// ── Synthwave sun hero backdrop (additive disc + scanlines + halo; bloom-eligible) ─

export const CH8_RETROSUN_SHADER_SETTINGS = Object.freeze({
    // 2026-10: 320 → 150. At the -700 station the old disc subtended ~45 deg (70 % of frame
    // height) and only ever showed as a bright slot between towers; ~22 deg reads as a
    // colossal sun sitting on the skyline, as the creative plan intended (25–30 % of frame).
    // NB these are billboard QUAD SIZES (half-extent = size / 2): disc radius 130 u.
    sunRadius: 260,
    haloRadius: 600,
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
    const positionNode = billboardStage(aBase, size);

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

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha.mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // Camera-facing quads cannot overlap themselves: one pass, not a back + front split.
    material.forceSinglePass = true;
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
    // A flat card cannot overlap itself, so the back/front split pass is pure overhead.
    material.forceSinglePass = true;
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
    // A flat band cannot overlap itself, so the back/front split pass is pure overhead.
    material.forceSinglePass = true;
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

// ── Procedural night-tower facade (dark glass mass + sparse clustered lit floors) ────

export const CH8_FACADE_VALUE_SETTINGS = Object.freeze({
    // Window module in world units (one floor ~3.4 u, one bay ~2.6 u) — towers read as
    // dozens of storeys, not a handful of giant tiles.
    floorHeight: 3.0,
    bayWidth: 1.9,
    // Fraction of a lit floor's windows that are on (runs of 4 bays switch together).
    floorFill: 0.68,
    // Scattered single lit windows on dark floors, as a fraction of occupancy.
    scatter: 0.1,
    // Emission gains (kept < 1 so bloom gilds the brightest windows, never clips).
    warmGain: 0.62,
    coolGain: 0.5,
    neonGain: 0.72,
    trimGain: 0.85,
    // Dark-glass body + sky reflection.
    glassReflect: 0.2,
    edgeSheen: 0.035,
    // Atmospheric depth (light-pollution haze) — near towers darkest, far towers lift
    // toward the horizon haze so the ranks separate into silhouette layers.
    hazeNear: 140,
    hazeFar: 1000,
    hazeMax: 0.86,
    // Finale ignition: corridor-plane spire position (x, z) and the lit-floor multiplier a
    // building jumps to once the ignition ring has passed it (arrival level is uCityLight).
    spire: [0, -560],
    ignitedLight: 1.3,
});

/**
 * The neon city's shared uniforms for a builder called WITHOUT the chapter (the pilot harness,
 * unit tests): the planned city's glow map, an identity corridor transform.
 */
export function createDefaultNeon(uTime, uEnergy, {
    uCityLight, uIgniteRadius, uDim, uRainDensity,
} = {}) {
    const { signs } = planNeonSigns(dealCityTowers());
    return createNeonCityUniforms({
        uTime: uTime ?? uniform(0),
        uEnergy: uEnergy ?? uniform(0.45),
        uCityLight: uCityLight ?? uniform(1),
        uIgniteRadius: uIgniteRadius ?? uniform(0),
        uDim: uDim ?? uniform(0),
        uRainDensity: uRainDensity ?? uniform(1),
    }, createNeonGlowTexture(bakeNeonGlow(signs)));
}

/**
 * ONE shared facade NodeMaterial for the whole instanced tower canyon (QW8). Per-instance
 * attributes carry the variation:
 *   aFacade = vec4(seed, occupancy, warmBias, hero)   hero 0 none / 1 cyan / 2 magenta
 *   aDims   = vec3(width, height, depth)              world size (= instance scale)
 *
 * 2026-10 rewrite: a night skyscraper — near-black glass with vertical mullion structure, WHOLE
 * FLOORS lit in clustered runs (most floors dark), warm or cool with rare neon floors; hero
 * towers carry vertical neon edge trim + a crown band. `uCityLight` (0..1.2) switches floors on
 * (the finale ignition), `uDim` gutters whole buildings out one by one (the resolve).
 *
 * 2026-10-20 NEON CITY (after Neon District's facades, neon-district-facades.js): the walls are
 * no longer one flat indigo. They are LIT BY THE CITY — the glow map's shopfront and sign light
 * pooling up the boulevard walls from the street, ledges every few floors catching it from
 * below, wet glass mirroring the glowing mist with rivulets running down it at a glance, the
 * spire's rose light on everything that faces it once it fires — and they stand IN the air
 * (odyssey-neon-light.tsl.js): street mist swallowing their feet, haze thinning their distance.
 * Hero trims are level meters that fill as the ignition ring passes.
 */
function createFacadeMaterial(uTime, uEnergy, {
    uCityLight, uDim, neon,
} = {}) {
    const S = CH8_FACADE_VALUE_SETTINGS;
    const N = neon;
    const arrivalLight = uCityLight ?? uniform(1);
    const dim = uDim ?? uniform(0);

    // These are constant per tower/face. Perspective interpolation introduces tiny
    // per-pixel seed differences that the hashes amplify into speckled, crawling windows.
    const aFacade = varying(attribute('aFacade', 'vec4'), 'vCityFacade').setInterpolation('flat');
    const aDims = varying(attribute('aDims', 'vec3'), 'vCityDimensions').setInterpolation('flat');
    const n = varying(normalGeometry, 'vCityFaceNormal').setInterpolation('flat');
    // The resolve: whole buildings gutter out as uDim rises (per-building threshold).
    const gutter = varying(hash21(vec2(aFacade.x, 91.7)), 'vCityGutter').setInterpolation('flat');
    // Corridor-space position (linear in the vertex: interpolated, no per-fragment matrix).
    const pcVarying = neonCityPos(N, 'vCityPos');

    const colorNode = Fn(() => {
        const seed = aFacade.x;
        const occupancy = aFacade.y;
        const warmBias = aFacade.z;
        const hero = aFacade.w;
        const pc = pcVarying.toVar();

        const isRoof = step(0.5, abs(n.y));
        const isSide = oneMinus(isRoof);
        // ±X faces span the tower's depth, ±Z faces its width.
        const faceW = mix(aDims.x, aDims.z, step(0.5, abs(n.x)));
        const towerH = aDims.y;

        const vUv = uv();
        const fx = vUv.x.mul(faceW);
        const fy = vUv.y.mul(towerH);
        const g = vec2(fx.div(S.bayWidth), fy.div(S.floorHeight));
        const cell = floor(g);
        const f = fract(g);
        // Per-face seed so the four faces of one tower don't repeat; floors use the TOWER seed
        // so a lit floor wraps the whole building.
        const faceSeed = seed.add(n.x.mul(3.17)).add(n.z.mul(7.31));

        // Antialiased window pane; fades to its mean coverage once a bay is sub-pixel.
        const fw = fwidth(g).max(vec2(1e-4, 1e-4)).toVar();
        const paneX = smoothstep(0.14, fw.x.add(0.14), f.x)
            .mul(oneMinus(smoothstep(fw.x.negate().add(0.86), 0.86, f.x)));
        const paneY = smoothstep(0.2, fw.y.add(0.2), f.y).mul(oneMinus(smoothstep(fw.y.negate().add(0.88), 0.88, f.y)));
        const lod = smoothstep(0.22, 0.7, max(fw.x, fw.y)).toVar();
        const pane = mix(paneX.mul(paneY), 0.5, lod).toVar();

        // ── WHICH windows are lit (the ignition ring raises the city's floor count) ─────
        const ign = neonIgnition(N, pc);
        const inWave = ign.level.sub(NEON_AIR.arrivalNeon).div(1 - NEON_AIR.arrivalNeon).toVar();
        const cityLight = mix(arrivalLight, float(S.ignitedLight), inWave);
        // HASH BUDGET (seamless pass): one hash per FLOOR, one per tenant RUN, one per WINDOW.
        const floorRnd = hash21(vec2(cell.y, seed.mul(0.731))).toVar();
        const floorOn = step(oneMinus(occupancy.mul(cityLight)), floorRnd);
        const runRnd = hash21(vec2(floor(cell.x.div(4.0)), cell.y.add(faceSeed.mul(11.0))));
        const winRnd = hash21(cell.add(vec2(faceSeed.mul(5.3), faceSeed.mul(1.9)))).toVar();
        const inFloor = floorOn.mul(step(1.0 - S.floorFill, runRnd)).mul(step(0.1, winRnd));
        const single = step(oneMinus(occupancy.mul(S.scatter).mul(cityLight)), winRnd);
        const aboveLobby = step(1.0, cell.y);
        const buildingAlive = step(dim, gutter.mul(0.98).add(0.01)).toVar();
        const lit = max(inFloor, single).mul(aboveLobby).mul(buildingAlive).mul(isSide);

        // ── WHAT colour ───────────────────────────────────────────────────────────
        const warmRnd = fract(floorRnd.mul(13.37).add(0.37));
        const isWarm = step(warmRnd, warmBias);
        const neonFloor = step(0.965, fract(floorRnd.mul(31.71).add(0.11)));
        const warm = vec3(1.0, 0.56, 0.24).mul(S.warmGain);
        const cool = vec3(0.52, 0.8, 1.0).mul(S.coolGain);
        const neonTint = mix(vec3(1.0, 0.18, 0.66), vec3(0.0, 0.85, 1.0), step(0.5, fract(seed.mul(3.7))));
        const wcolor = mix(mix(cool, warm, isWarm), neonTint.mul(S.neonGain), neonFloor);
        // Per-window brightness spread (blinds, lamps) + a rare slow flicker.
        const winGain = fract(winRnd.mul(13.7)).mul(0.5).add(0.5)
            .mul(mix(1.08, 0.72, f.y))
            .mul(mix(1.0, step(0.45, fract(f.y.mul(7.0))).mul(0.6).add(0.4), step(0.83, fract(winRnd.mul(7.9)))));
        const flick = sin(uTime.mul(winRnd.mul(2.0).add(0.4)).add(winRnd.mul(40.0))).mul(0.5).add(0.5);
        const flicker = mix(1.0, flick.mul(0.6).add(0.4), step(0.985, fract(winRnd.mul(31.1))));
        const energyGain = uEnergy.mul(0.25).add(0.82).mul(ign.front.mul(0.9).add(1.0));
        const windows = wcolor.mul(lit).mul(pane).mul(winGain).mul(flicker)
            .mul(energyGain);

        // ── The city's light on this wall ─────────────────────────────────────────
        const hAbove = max(pc.y.sub(STREET_Y), 0.0).toVar();
        const glowSign = neonGlow(N, pc, 0).mul(ign.level).toVar();
        const glowLow = neonGlow(N, pc, 1).toVar();
        const lowLit = glowLow.mul(ign.level).toVar();
        // Walls that face the boulevard take its light in full, the ends of the blocks part of it.
        const toLane = clamp(n.x.mul(pc.x.sign().negate()), 0.0, 1.0);
        const facing = toLane.mul(0.85).add(abs(n.z).mul(0.38)).add(0.1);
        const fromBelow = lowLit.mul(exp(hAbove.mul(-1 / 18))).mul(1.4)
            .add(glowSign.mul(exp(max(hAbove.sub(14.0), 0.0).mul(-1 / 22))).mul(0.42));
        // Every other street has its own signs: a per-block tint rising off the outer streets.
        const streetTint = mix(vec3(0.9, 0.12, 0.55), vec3(0.0, 0.62, 0.85), step(0.5, fract(seed.mul(1.37))));
        const sideStreet = streetTint.mul(exp(fy.negate().div(14.0))).mul(0.1).mul(ign.level);
        const skyLight = vec3(0.014, 0.011, 0.028).mul(smoothstep(-60.0, 120.0, pc.y).mul(0.75).add(0.25));
        const spire = neonSpireLight(N, pc, n);
        const light = fromBelow.mul(facing).add(sideStreet).add(skyLight).add(spire)
            .toVar();

        // ── Wall: concrete piers and spandrels, glass between ────────────────────
        const pier = step(0.94, fract(g.x.mul(0.5).add(0.03)));
        const tone = fract(seed.mul(0.618)).mul(0.5).add(0.75);
        const concrete = vec3(0.05, 0.047, 0.06).mul(tone);
        // A ledge every sixth floor catches the street's light on its underside (low floors).
        const ledge = oneMinus(smoothstep(0.0, 0.11, f.y)).mul(step(mod(cell.y, 6.0), 0.5)).mul(oneMinus(lod));
        const ledgeLight = lowLit.mul(exp(hAbove.mul(-1 / 22))).mul(0.8).add(glowSign.mul(0.12))
            .mul(ledge)
            .mul(facing);
        const vdotn = clamp(dot(normalize(normalView), positionViewDirection), 0.0, 1.0);
        const m = oneMinus(vdotn);
        const fres = m.mul(m).mul(m).toVar();
        // Rain runs down the glass: rivulets of brighter, wetter glass that mirror the street.
        const riv = latticeNoise3(vec3(fx.mul(0.55), fy.mul(0.028).add(uTime.mul(0.32)), seed.mul(0.37)));
        const wet = mix(float(0.55), smoothstep(0.4, 0.78, riv).mul(0.9).add(0.4), oneMinus(lod));
        // The glass mirrors the glowing mist, the canyon's light below, and the signs.
        const mirrored = N.mistLow.mul(1.0)
            .add(lowLit.mul(exp(hAbove.mul(-1 / 70))).mul(0.32))
            .add(glowSign.mul(0.2));
        // The rain thinning over the resolve dries the glass a little.
        const rainWet = N.uRainDensity.mul(0.4).add(0.6);
        const glassCol = vec3(0.003, 0.004, 0.01).add(mirrored.mul(fres.mul(0.85).add(0.05)).mul(wet).mul(rainWet));
        const diffuse = concrete.mul(light);
        const body = mix(diffuse, glassCol.add(diffuse.mul(0.12)), pane.mul(oneMinus(pier)));

        // Roofs (the eye flies over most of the city's): gravel, plant boxes, a parapet lip that
        // catches the street's glow, and rain standing in puddles that mirror the lit mist — not
        // one flat sheen. Roof metres: x across the width, y across the depth.
        const rx = vUv.x.mul(aDims.x);
        const rz = vUv.y.mul(aDims.z);
        const rimDist = min(min(rx, aDims.x.sub(rx)), min(rz, aDims.z.sub(rz)));
        const parapet = oneMinus(smoothstep(0.35, 0.8, rimDist));
        const unitCell = floor(vec2(rx, rz).div(4.5));
        const unitRnd = hash21(unitCell.add(vec2(seed.mul(1.7), seed.mul(0.3))));
        const unitF = fract(vec2(rx, rz).div(4.5));
        const unitBox = step(0.68, unitRnd).mul(step(0.18, unitF.x)).mul(step(unitF.x, 0.82))
            .mul(step(0.22, unitF.y))
            .mul(step(unitF.y, 0.78))
            .mul(step(1.2, rimDist));
        const gravel = latticeNoise3(vec3(rx.mul(0.7), rz.mul(0.7), seed.mul(0.21)));
        const puddleR = smoothstep(0.58, 0.68, latticeNoise3(vec3(rx.mul(0.09), rz.mul(0.09), seed.mul(0.53))))
            .mul(oneMinus(unitBox)).mul(oneMinus(parapet));
        const roofAlbedo = vec3(0.026, 0.025, 0.032).mul(gravel.mul(0.5).add(0.75))
            .mul(mix(float(1.0), float(0.55), unitBox));
        const roofLight = skyLight.mul(2.2).add(spire).add(lowLit.mul(0.06)).add(glowSign.mul(0.05));
        const roof = roofAlbedo.mul(roofLight)
            .add(concrete.mul(lowLit.mul(0.5).add(skyLight)).mul(parapet).mul(1.6))
            .add(N.mistLow.mul(fres.mul(0.9).add(0.12)).mul(puddleR.mul(0.85).add(0.15)));

        // ── Hero towers: neon edge meters that fill as the ignition passes + a crown ──
        const isHero = step(0.5, hero);
        const heroCol = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.2, 0.7), step(1.5, hero));
        const edgeDist = min(vUv.x, oneMinus(vUv.x)).mul(faceW);
        const edgeTrim = oneMinus(smoothstep(0.18, 0.75, edgeDist));
        const fill = mix(float(0.28), float(1.0), inWave);
        const meterSeg = smoothstep(0.08, 0.2, abs(fract(fy.mul(0.16)).sub(0.5)));
        const meter = step(vUv.y, fill).mul(mix(1.0, meterSeg, oneMinus(lod)));
        const crownDist = oneMinus(vUv.y).mul(towerH);
        const crownBand = oneMinus(smoothstep(0.4, 1.2, crownDist))
            .add(smoothstep(5.0, 5.6, crownDist).mul(oneMinus(smoothstep(6.4, 7.0, crownDist))).mul(0.6));
        const chase = sin(fy.mul(0.09).sub(uTime.mul(1.6)).add(seed)).mul(0.25).add(0.75);
        const trim = heroCol.mul(edgeTrim.mul(chase).mul(meter).add(crownBand.mul(inWave.mul(0.6).add(0.4))))
            .mul(isHero).mul(isSide).mul(S.trimGain)
            .mul(buildingAlive);

        const structure = mix(body, roof, isRoof);
        const lights = windows.add(trim).add(ledgeLight.mul(isSide));
        const air = neonAir(N, pc, glowLow);
        // The air: lit windows punch a little further through it than the walls do.
        return mix(structure.add(lights), air.colour, air.amount)
            .add(lights.mul(air.amount).mul(oneMinus(air.amount)).mul(0.35));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.userData.emitsBloom = true;
    material.userData.valueTiers = CH8_FACADE_VALUE_SETTINGS;
    return material;
}

// Shared street datum, the deterministic PRNG and the corridor-space city plan now live in the
// three-free plan module (2026-10-20 neon overhaul), so the signs and the glow map are dealt from
// the very towers the facades draw. Re-exported here for the chapter's existing importers.
export { CH8_CITY_LAYOUT };

export function createCityBlocksTSL(uTime, uEnergy, {
    uCityLight, uIgniteRadius, uDim, bankCount, neon,
} = {}) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const group = new THREE.Group();
    group.name = 'city-blocks-tsl';
    const geometries = [];
    const materials = [];

    // A NIGHT CITY the camera flies over and through. This group is parented into the
    // path-aligned corridor container (urban-dreams.js) and the camera rides that same
    // stage frame, so local -Z is the camera's travel and local +Y is screen-up.
    //
    // 2026-10 re-stage: the old canyon stacked ever-TALLER walls toward the horizon, so the
    // camera saw a sky slot and never the sun, skyline or city. Now the mid/far city sits
    // mostly BELOW the eye (seen from above: rooftops, glowing street canyons), the lane is
    // flanked by a near wall the camera threads "within", a handful of tall towers break the
    // skyline, and eight hero towers carry neon edge trim. Six lateral banks fill the wide
    // frame out to the horizon; the skyline cards carry the city beyond farZ.
    // Low tier drops the OUTERMOST banks (the skyline cards carry the horizon behind them);
    // the layout is still dealt for every bank so the kept towers are identical on all tiers
    // (dealCityTowers, odyssey-neon-city-plan.js).
    const dealt = dealCityTowers(bankCount);
    const TOWER_COUNT = dealt.length;
    const sharedBox = new THREE.BoxGeometry(1, 1, 1);
    const neonUniforms = neon ?? createDefaultNeon(uTimeNode, uEnergyNode, { uCityLight, uIgniteRadius, uDim });
    const facadeMaterial = createFacadeMaterial(uTimeNode, uEnergyNode, {
        uCityLight, uIgniteRadius, uDim, neon: neonUniforms,
    });
    const towers = new THREE.InstancedMesh(sharedBox, facadeMaterial, TOWER_COUNT);
    towers.name = 'city-tower-instances-tsl';
    towers.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const facadeArray = new Float32Array(TOWER_COUNT * 4); // seed, occupancy, warmBias, hero
    const dimsArray = new Float32Array(TOWER_COUNT * 3); // width, height, depth
    const scratchMatrix = new THREE.Matrix4();
    const scratchPos = new THREE.Vector3();
    const scratchQuat = new THREE.Quaternion();
    const scratchScale = new THREE.Vector3();
    dealt.forEach((tower, instance) => {
        scratchPos.set(tower.x, tower.y, tower.z);
        scratchScale.set(tower.width, tower.height, tower.depth);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        towers.setMatrixAt(instance, scratchMatrix);
        facadeArray[instance * 4] = tower.seed;
        facadeArray[instance * 4 + 1] = tower.occupancy;
        facadeArray[instance * 4 + 2] = tower.warmBias;
        facadeArray[instance * 4 + 3] = tower.hero;
        dimsArray[instance * 3] = tower.width;
        dimsArray[instance * 3 + 1] = tower.height;
        dimsArray[instance * 3 + 2] = tower.depth;
    });
    towers.instanceMatrix.needsUpdate = true;
    sharedBox.setAttribute('aFacade', new THREE.InstancedBufferAttribute(facadeArray, 4));
    sharedBox.setAttribute('aDims', new THREE.InstancedBufferAttribute(dimsArray, 3));
    towers.computeBoundingSphere();
    towers.userData.towers = dealt;

    group.add(towers);
    geometries.push(sharedBox);
    materials.push(facadeMaterial);

    return {
        group, geometries, materials, material: facadeMaterial, towers: dealt,
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

        const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
        const material = new THREE.MeshBasicNodeMaterial();
        material.colorNode = color;
        material.opacityNode = uOpacity;
        material.uniforms = { uOpacity }; // ecotone crossfade bridge
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

// ── Megastructure shell: dark silhouette + energy seams that ignite (bloom-eligible) ──

// Integrate a repeating strip over the pixel footprint instead of thresholding its centre.
// The primitive also covers repeat boundaries; deriving AFTER fract would widen those
// boundaries and leave the thin ribs crawling as the camera moves. Once a period is
// subpixel, retain its mean light rather than resolving a flickering grid.
const spireBandCoverage = /* @__PURE__ */ Fn(([phase, start, duty]) => {
    const footprint = max(fwidth(phase), 1e-4).toVar();
    const lo = phase.sub(start).sub(footprint.mul(0.5)).toVar();
    const hi = lo.add(footprint).toVar();
    const integral = (x) => floor(x).mul(duty).add(min(fract(x), duty));
    const coverage = clamp(integral(hi).sub(integral(lo)).div(footprint), 0, 1);
    return mix(coverage, duty, smoothstep(0.5, 1.0, footprint));
}).setLayout({
    name: 'od_spire_band_coverage',
    type: 'float',
    inputs: [
        { name: 'phase', type: 'float' },
        { name: 'start', type: 'float' },
        { name: 'duty', type: 'float' },
    ],
});

function createConduitMaterial(uTime, uEnergy, { colorA, colorB, uReveal } = {}) {
    const uColorA = uniform(new THREE.Color(colorA ?? CYAN));
    const uColorB = uniform(new THREE.Color(colorB ?? MAGENTA));
    // Finale reveal ramp (0 baseline glow → 1 full payoff) so the spire ignites as the
    // camera approaches the final node. Defaults to a lit baseline so the structure is
    // always present (never an unlit dead column), then blooms toward 100% progress.
    const uRevealNode = uReveal ?? uniform(1.0);

    const vUv = uv();

    // 2026-10: the spire was four ADDITIVE glow boxes — a pastel column with no silhouette.
    // It is now a near-black megastructure (the tallest SHAPE in the skyline, crossing the
    // Retrosun) whose energy lives in thin seams + ribs; dormant it is a dark mass with faint
    // lines, ignition floods the seams and fires the surge up the shaft.
    // Vertical energy pulses travelling up the structure.
    const pulseRaw = sin(vUv.y.mul(26.0).sub(uTime.mul(3.0))).mul(0.5).add(0.5);
    const pulse = pow(pulseRaw, 3.0);
    // Same strip centres and mean coverage as the original grid, filtered at the current
    // render resolution (including dynamic resolution and the narrow upper tiers).
    const seams = spireBandCoverage(vUv.x.mul(5.0), float(0.88), float(0.08));
    const ribs = spireBandCoverage(vUv.y.mul(14.0), float(0.94), float(0.06)).mul(0.55);
    const fres = pow(oneMinus(max(0.0, dot(normalize(normalView), positionViewDirection))), 2.0);

    // REVEAL ENERGY SURGE: a fast, bright wavefront rushing UP the conduit, gated by the
    // reveal ramp so on ignition a white-hot pulse fires from the street to the crown. The
    // surge head position is driven by uReveal so it visibly "lights up" the spire.
    const surgePhase = uRevealNode.mul(1.4).sub(0.2); // travels past the top as reveal→1
    const surgeBand = smoothstep(0.18, 0.0, vUv.y.sub(surgePhase).abs());
    const surge = surgeBand.mul(uRevealNode); // only present while igniting

    const color = mix(uColorA, uColorB, vUv.y);
    // Dormant seams glow at ~18 %; ignition lifts them to full.
    const revealGain = uRevealNode.mul(0.82).add(0.18);
    // Union coverage preserves both strips' light when they become subpixel. max() of
    // their separately filtered values would lose the horizontal ribs' mean contribution.
    const lines = seams.add(ribs.mul(oneMinus(seams)));
    // Ignited, the faces between the seams take a faint inner glow too (the structure is
    // charged, not just outlined).
    const fill = uRevealNode.mul(uRevealNode).mul(0.12);
    const glow = lines.mul(pulse.mul(0.55).add(0.45)).add(fill)
        .mul(uEnergy.mul(0.5).add(0.75))
        .mul(revealGain);
    // Add the surge as a white-hot core lift on top of the tinted glow.
    const coreColor = mix(color, vec3(1.0, 1.0, 1.0), surge.mul(0.8));
    const litGlow = clamp(glow.add(surge.mul(lines.mul(0.6).add(0.35))), 0.0, 1.0);
    // Near-black body with a violet sky sheen at grazing angles (reads against the haze).
    const body = vec3(0.01, 0.008, 0.022).add(vec3(0.05, 0.02, 0.08).mul(fres));

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = body.add(coreColor.mul(litGlow).mul(0.92));
    material.opacityNode = uOpacity;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = true;
    material.blending = THREE.NormalBlending;
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
    // 2026-10: base now stands ON the street (group y = STREET_Y; tiers authored from 0).
    group.position.set(0, STREET_Y, -560);

    const geometries = [];
    const materials = [];

    // A colossal tapering megastructure: a wide base that stands on the street climbing to a
    // narrow crown well above the top of frame (~+260 with the group's -40 offset). Each
    // tier's conduit core takes the shared reveal uniform so the whole spire ignites at once.
    const tiers = [
        { height: 100, width: 18, y: 350 }, // needle 300..400
        { height: 140, width: 34, y: 230 }, // 160..300
        { height: 110, width: 56, y: 105 }, // 50..160
        { height: 50, width: 86, y: 25 }, // podium 0..50
    ];

    // CONSOLIDATION (remake plan #2): the 4 tiers alternate between just TWO conduit configs
    // (even = cyan→magenta, odd = magenta→cyan) and TWO frame colours — so build 2 shared conduit
    // materials + 2 shared frame materials and reuse them by parity. 8 pipelines → 4. All cores
    // share the one uReveal so the spire still ignites as one; per-tier size is geometry only.
    const conduitEven = createConduitMaterial(uTimeNode, uEnergyNode, {
        colorA: CYAN, colorB: MAGENTA, uReveal,
    });
    const conduitOdd = createConduitMaterial(uTimeNode, uEnergyNode, {
        colorA: MAGENTA, colorB: CYAN, uReveal,
    });
    materials.push(conduitEven, conduitOdd);

    tiers.forEach(({ height, width, y }, index) => {
        // Energy-conduit core — reveal-driven glow (shared conduit material by parity).
        const coreGeo = new THREE.BoxGeometry(width, height, width * 0.55);
        const core = new THREE.Mesh(coreGeo, index % 2 === 0 ? conduitEven : conduitOdd);
        core.position.y = y;
        group.add(core);
        geometries.push(coreGeo);
    });

    // 2026-10-20 neon city: the torus frame round every tier (four floating rings) and the pink
    // additive cone on top are retired — they read as a toy against the Retrosun. The crown is
    // now a NEEDLE MAST of the same conduit (its seams fire with the rest of the spire) carrying
    // an aircraft beacon that blinks red, the city's tallest point and its one steady rhythm.
    const MAST_HEIGHT = 120;
    const mastGeo = new THREE.BoxGeometry(5, MAST_HEIGHT, 5);
    const mast = new THREE.Mesh(mastGeo, conduitOdd);
    mast.position.y = 400 + MAST_HEIGHT * 0.5;
    group.add(mast);
    geometries.push(mastGeo);
    // Crown height — the mast's tip (the shock ring and the beacon light start here).
    const CROWN_Y = 400 + MAST_HEIGHT;

    const beaconMaterial = new THREE.MeshBasicNodeMaterial();
    const blink = step(fract(uTimeNode.mul(0.75)), 0.12);
    const beaconUv = uv().sub(0.5);
    const beaconR2 = dot(beaconUv, beaconUv).mul(4.0);
    const beaconGlow = exp(beaconR2.mul(-14.0)).mul(2.2).add(exp(beaconR2.mul(-3.0)).mul(0.25));
    const beaconOpacity = uniform(1);
    beaconMaterial.colorNode = vec4(
        vec3(1.0, 0.12, 0.08).mul(beaconGlow).mul(blink.mul(0.9).add(0.1)).mul(beaconOpacity),
        0.0,
    );
    beaconMaterial.positionNode = billboardStage(vec3(0.0, CROWN_Y + 2.0, 0.0), float(16.0));
    beaconMaterial.uniforms = { uOpacity: beaconOpacity };
    beaconMaterial.transparent = true;
    beaconMaterial.depthWrite = false;
    // Premultiplied 'over' with alpha 0: pure addition that leaves the target's alpha alone.
    beaconMaterial.blending = THREE.CustomBlending;
    beaconMaterial.blendSrc = THREE.OneFactor;
    beaconMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    beaconMaterial.blendSrcAlpha = THREE.OneFactor;
    beaconMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    beaconMaterial.side = THREE.DoubleSide;
    beaconMaterial.forceSinglePass = true;
    const beaconGeo = new THREE.PlaneGeometry(1, 1);
    const beaconSprite = new THREE.Mesh(beaconGeo, beaconMaterial);
    beaconSprite.name = 'spire-beacon';
    beaconSprite.frustumCulled = false;
    group.add(beaconSprite);
    geometries.push(beaconGeo);
    materials.push(beaconMaterial);

    // EXPANDING SHOCK RING — an additive torus at the crown that, on the reveal, scales
    // outward (eased) and fades, a triumphant pulse radiating from the ignited beacon. Its
    // base scale is tiny so at reveal=0 it's invisible; the chapter update() drives the
    // reveal-eased scale + opacity each frame. Soft additive, capped — bloom gilds it.
    // Unit-radius, hair-thin torus scaled to the pulse RADIUS (2026-10): the old 8/1.4 torus
    // scaled ~30x grew a 40-u tube — a fat teal donut parked over the skyline.
    const shockRingGeo = new THREE.TorusGeometry(1, 0.011, 6, 128);
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
    const beacon = acquireChapterLight(8, 'PointLight', { color: 0xff66c4, intensity: 0.8, distance: 520 });
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

function createSignMaterial(uTime, uEnergy, { color, glyphGrid = [18, 5] } = {}) {
    const uColor = uniform(new THREE.Color(color ?? CYAN));

    const vUv = uv();

    const scan = sin(vUv.y.add(uTime.mul(0.12)).mul(60.0)).mul(0.5).add(0.5);
    const scroll = step(0.5, fract(vUv.x.mul(6.0).sub(uTime.mul(0.35))));
    const glyphs = hash21(vUv.mul(vec2(glyphGrid[0], glyphGrid[1])).floor().add(uTime.mul(1.2).floor()));
    const body = scan.mul(0.4).add(0.35)
        .mul(scroll.mul(0.5).add(0.5))
        .mul(glyphs.mul(0.6).add(0.6));
    const edge = smoothstep(0.0, 0.06, vUv.x)
        .mul(smoothstep(1.0, 0.94, vUv.x))
        .mul(smoothstep(0.0, 0.12, vUv.y))
        .mul(smoothstep(1.0, 0.88, vUv.y));
    const a = body.mul(edge).mul(uEnergy.mul(0.4).add(0.45));

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor.mul(body.add(0.8));
    material.opacityNode = a.mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    // Additive + no depth write: the DoubleSide back/front split buys nothing (seamless pass).
    material.forceSinglePass = true;
    material.userData.emitsBloom = true;
    return material;
}

export function createHologramSignsTSL(uTime, uEnergy, options = {}) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);

    const group = new THREE.Group();
    group.name = 'hologram-sign-stack-tsl';
    const geometries = [];
    const materials = [];

    // 2026-10: the four signs sat at z -560..-690 (beyond everything the camera reaches,
    // stacked behind the spire). They now line the boulevard along the camera's whole
    // travel and on into the distance: tall BLADE signs projecting from the facades toward
    // the lane (vertical glyph columns, Blade Runner style) and a few wide MARQUEES at the
    // tower bases. Four shared materials (blade/marquee x cyan/magenta), still 4 pipelines.
    const bladeGeo = new THREE.PlaneGeometry(5, 24);
    const marqueeGeo = new THREE.PlaneGeometry(30, 6);
    geometries.push(bladeGeo, marqueeGeo);
    const mats = {
        bladeCyan: createSignMaterial(uTimeNode, uEnergyNode, { color: CYAN, glyphGrid: [2, 12] }),
        bladeMagenta: createSignMaterial(uTimeNode, uEnergyNode, { color: MAGENTA, glyphGrid: [2, 12] }),
        marqueeCyan: createSignMaterial(uTimeNode, uEnergyNode, { color: CYAN, glyphGrid: [16, 3] }),
        marqueeMagenta: createSignMaterial(uTimeNode, uEnergyNode, { color: MAGENTA, glyphGrid: [16, 3] }),
    };
    materials.push(...Object.values(mats));
    // [kind, side, x-offset from the lane, y, z]
    const configs = [
        ['blade', -1, 27, 8, 92], ['blade', 1, 27, -6, 60], ['marquee', -1, 29, -40, 34],
        ['blade', 1, 28, 14, 6], ['blade', -1, 28, -12, -36], ['marquee', 1, 30, -38, -70],
        ['blade', -1, 30, 22, -110], ['blade', 1, 29, 4, -160], ['blade', -1, 31, -8, -230],
        ['marquee', -1, 31, -34, -280], ['blade', 1, 31, 18, -320], ['blade', -1, 32, 30, -410],
    ];
    // Low tier keeps every other sign (the near ones carry the boulevard read either way).
    const stride = options.signStride ?? 1;
    configs.forEach(([kind, side, offset, y, z], index) => {
        if (index % stride !== 0) return;
        const blade = kind === 'blade';
        const cyan = (index % 3) !== 1;
        let material;
        if (blade) material = cyan ? mats.bladeCyan : mats.bladeMagenta;
        else material = cyan ? mats.marqueeCyan : mats.marqueeMagenta;
        const sign = new THREE.Mesh(blade ? bladeGeo : marqueeGeo, material);
        sign.position.set(side * offset, y, z);
        // Blades face down the boulevard toward the camera; marquees angle toward the lane.
        sign.rotation.y = blade ? 0 : side * -0.5;
        group.add(sign);
    });

    return {
        group, geometries, materials, material: materials[0],
    };
}

// ── The wet boulevard (NO bloom of its own; its lights bloom) ─────────────────────

export const CH8_WET_STREET_SETTINGS = Object.freeze({
    width: 720,
    length: 1400,
    // The boulevard's cross-section (corridor x): road, kerb LED strip, the walk to the walls.
    roadHalf: 18.5,
    kerbHalf: 19.3,
    walkHalf: 24,
    // Six traffic lanes (|x| centres): coming toward the eye on the left, going on the right.
    lanes: [4.6, 9.8, 15.0],
    carCell: 15,
    reflectGain: 0.85,
    sunReflectGain: 0.6,
});

/**
 * The boulevard 70 u below the eye, after Neon District's wet street (neon-district-street.js
 * createStreet), re-scaled from a street you stand in to a canyon floor you fly over: asphalt
 * with worn lane paint, a zebra crossing every block, puddles gathered in the gutters, chasing LED
 * strips down both kerbs, the shopfronts' light pooled along the walls, RIVERS OF TRAFFIC (white
 * headlights coming up the left lanes, red tail lights going down the right, each dragging its
 * streak across the wet road), and in the water the walls' signs smeared into streaks and the
 * Retrosun's reflection traced analytically along the mirrored view ray (never a mirror pass:
 * the 7->8 carry hands the sun over pixel for pixel, a second render of it would pop).
 * @param {*} uTime
 * @param {*} uEnergy
 * @param {{neon?: object, uSunVisible?: *}} [opts]
 */
export function createWetReflectionPlaneTSL(uTime, uEnergy, { neon, uSunVisible } = {}) {
    const uTimeNode = uTime ?? uniform(0);
    const uEnergyNode = uEnergy ?? uniform(0.45);
    const N = neon ?? createDefaultNeon(uTimeNode, uEnergyNode);
    const S = CH8_WET_STREET_SETTINGS;
    const sunVisible = uSunVisible ?? uniform(1);
    const pcVarying = neonCityPos(N, 'vStreetPos');

    const colorNode = Fn(() => {
        const pc = pcVarying.toVar();
        const { x } = pc;
        const { z } = pc;
        const ax = abs(x).toVar();
        const rel = pc.sub(N.camCity).toVar();
        const dist = length(rel).max(1e-3).toVar();
        const V = rel.div(dist).toVar();
        // Screen footprint of a unit of street (fwidth up front: uniform control flow).
        const fx = fwidth(x).toVar();
        const fz = fwidth(z).toVar();
        const ign = neonIgnition(N, pc);
        const glowLow = neonGlow(N, pc, 1).toVar();
        const glowSign = neonGlow(N, pc, 0).mul(ign.level).toVar();

        // ── Puddles and grain ──
        const n1 = latticeNoise3(vec3(x.mul(0.05), z.mul(0.028), 1.7));
        const n2 = latticeNoise3(vec3(x.mul(0.23), z.mul(0.19), 7.3)).toVar();
        const road = oneMinus(smoothstep(S.roadHalf - 0.15, S.roadHalf + 0.15, ax)).toVar();
        const gutter = exp(abs(ax.sub(S.roadHalf - 1.0)).mul(-1.2)).mul(0.24);
        const puddle = smoothstep(0.5, 0.64, n1.add(gutter).add(n2.mul(0.12)))
            .mul(N.uRainDensity.mul(0.4).add(0.6)).toVar();

        // ── Paint: a double centre line, lane dashes, edge lines, a zebra every block ──
        const aa = fx.add(0.012);
        const stripe = (centre, halfWidth) => oneMinus(smoothstep(
            float(halfWidth).sub(aa),
            float(halfWidth).add(aa),
            abs(ax.sub(centre)),
        ));
        const wear = smoothstep(0.25, 0.7, n2);
        const centreLine = stripe(0.36, 0.11);
        const dash = max(stripe(7.2, 0.13), stripe(12.4, 0.13)).mul(step(fract(z.div(9.0)), 0.42));
        const edgeLine = stripe(S.roadHalf - 0.7, 0.12);
        const crossZ = fract(z.add(40.0).div(90.0)).mul(90.0);
        const inCross = step(crossZ, 5.5).mul(step(0.6, crossZ));
        const zebra = inCross.mul(step(fract(x.div(1.7)), 0.5)).mul(step(ax, S.roadHalf - 1.2));
        const white = max(max(dash, edgeLine), zebra).mul(wear).mul(road);
        const amber = centreLine.mul(wear).mul(road).mul(oneMinus(inCross));
        const asphalt = vec3(0.026, 0.027, 0.034).mul(n2.mul(0.6).add(0.7));
        const walk = vec3(0.05, 0.048, 0.06).mul(n2.mul(0.4).add(0.8));
        const albedo = mix(walk, asphalt, road).toVar();
        albedo.assign(mix(albedo, vec3(0.16, 0.165, 0.18), white.mul(0.75)));
        albedo.assign(mix(albedo, vec3(0.2, 0.11, 0.015), amber.mul(0.8)));

        // ── Light: the shopfronts along the walls, the mist's glow, the spire ──
        const nearWall = exp(max(float(S.walkHalf).sub(ax), 0.0).mul(-1 / 6));
        const shops = glowLow.mul(ign.level).mul(nearWall.mul(1.7).add(0.12));
        const light = N.mistLow.mul(0.9).add(shops).add(neonSpireLight(N, pc, vec3(0.0, 1.0, 0.0)));

        // ── Kerb LED strips: dashed, chasing, rose down the left and cyan down the right ──
        const led = stripe(S.kerbHalf, 0.08).mul(step(fract(z.div(2.4)), 0.72));
        const chase = smoothstep(0.72, 1.0, fract(z.mul(0.035).add(uTimeNode.mul(ign.level.mul(0.6).add(0.25)))));
        const ledCol = mix(vec3(1.0, 0.08, 0.4), vec3(0.05, 0.75, 1.0), step(0.0, x))
            .mul(chase.mul(1.3).add(0.32)).mul(ign.level).toVar();
        const spill = exp(abs(ax.sub(S.kerbHalf)).mul(-1.6)).mul(0.07);

        // ── Traffic: three lanes coming (white) on the left, three going (red) on the right ──
        const cars = vec3(0.0).toVar();
        const carStreaks = vec3(0.0).toVar();
        const sigX = max(fx.mul(0.9), 0.3);
        const sigZ = max(fz.mul(0.9), 0.3);
        // A light spread over more than its own size keeps its energy (it merges into a river).
        const spread = float(0.3).div(sigX).mul(float(0.3).div(sigZ)).min(1.0)
            .max(0.12);
        [-1, 1].forEach((dirSide) => {
            // dirSide -1 = left lanes, coming toward the eye (+z); +1 = right lanes, going (-z).
            const dir = -dirSide;
            const tint = dirSide < 0 ? vec3(1.0, 0.92, 0.8).mul(2.6) : vec3(1.0, 0.07, 0.03).mul(2.1);
            S.lanes.forEach((laneX, li) => {
                const lane = laneX * dirSide;
                const speed = 15 + li * 4.5;
                const zz = z.sub(uTimeNode.mul(speed * dir));
                const cell = floor(zz.div(S.carCell));
                const h = hash21(vec2(cell, lane * 7.13 + 3.1));
                const present = step(0.4, h);
                const cz = cell.add(h.mul(0.5).add(0.25)).mul(S.carCell);
                const dz = zz.sub(cz).sub(2.1);
                const dx = abs(x.sub(lane).sub(h.sub(0.5).mul(0.9))).sub(0.72);
                const px = dx.div(sigX);
                const pz = dz.div(sigZ);
                const lamp = exp(px.mul(px).add(pz.mul(pz)).negate());
                cars.addAssign(tint.mul(lamp.mul(spread).mul(present)));
                // The wet road drags each light toward the eye.
                const run = max(dz, 0.0);
                const streak = exp(px.mul(px).mul(-0.5)).mul(exp(run.mul(-1 / 6))).mul(step(0.0, dz));
                carStreaks.addAssign(tint.mul(streak.mul(present).mul(0.16)));
            });
        });

        // ── The mirror ──
        const cosT = clamp(V.y.negate(), 0.0, 1.0);
        const mm = oneMinus(cosT);
        const fres = float(0.03).add(mm.mul(mm).mul(mm).mul(mm).mul(mm)
            .mul(0.97));
        const fresEff = max(fres, puddle.mul(0.32).add(0.05));
        const gloss = mix(float(0.45), float(1.0), puddle);
        // Wet asphalt drags the walls' signs into long streaks.
        const drag = latticeNoise3(vec3(x.mul(0.32).add(n2.mul(0.8)), z.mul(0.011), 3.3));
        const streaks = smoothstep(0.45, 0.85, drag);
        // The Retrosun, traced along the mirrored ray (the water's slope bends it).
        const slope = vec2(n2.sub(0.5), latticeNoise3(vec3(x.mul(0.31), z.mul(0.27), 11.1)).sub(0.5))
            .mul(mix(float(0.09), float(0.025), puddle));
        const nrm = normalize(vec3(slope.x, 1.0, slope.y));
        const R = reflect(V, nrm);
        const sunAt = vec3(RETROSUN_CITY_POS[0], RETROSUN_CITY_POS[1], RETROSUN_CITY_POS[2]);
        const toSun = normalize(sunAt.sub(pc));
        const cosA = clamp(dot(R, toSun), 0.0, 1.0);
        const disc = smoothstep(0.9855, 0.9905, cosA);
        const c2 = cosA.mul(cosA);
        const c8 = c2.mul(c2).mul(c2.mul(c2));
        const aureole = c8.mul(c8).mul(c8).mul(0.18);
        // Which part of the disc the mirrored ray meets: its pink base, orange belly or yellow crown.
        const tDisc = clamp(R.y.sub(toSun.y).div(0.32).add(0.5), 0.0, 1.0);
        const sunCol = mix(
            vec3(1.1, 0.03, 0.18),
            mix(vec3(1.2, 0.28, 0.02), vec3(1.25, 0.84, 0.24), smoothstep(0.6, 1.0, tDisc)),
            smoothstep(0.0, 0.55, tDisc),
        );
        const sunRefl = sunCol.mul(disc.mul(1.3).add(aureole)).mul(sunVisible).mul(S.sunReflectGain);
        const mirror = glowSign.mul(streaks.mul(streaks).mul(1.3).add(0.04))
            .add(N.mistLow.mul(0.9))
            .add(sunRefl)
            .mul(S.reflectGain);

        const col = albedo.mul(light).mul(mix(float(1.0), float(0.5), puddle))
            .add(mirror.mul(fresEff).mul(gloss))
            .add(ledCol.mul(led).mul(1.5))
            .add(ledCol.mul(spill))
            .add(cars.mul(road))
            .add(carStreaks.mul(gloss).mul(road))
            .toVar();
        return neonAtmosphere(N, col, pc, glowLow);
    })();

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.opacityNode = uOpacity;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    // FRONT face only (seamless pass): the road is only ever seen from above (the eye rides
    // 60-80 u over it), and a transparent DoubleSide material is split into a back pass and a
    // front pass — a whole extra draw of a 720 x 1400 plane that could never rasterise.
    material.side = THREE.FrontSide;

    // Lay the road flat under the whole corridor (local -Z forward, so length runs along z).
    const geometry = new THREE.PlaneGeometry(S.width, S.length, 1, 1);
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
    const fog = latticeFbm2(vUv.mul(5.0).add(vec2(uTime.mul(0.05), 0.0)), 3); // 5->3 oct (perf): 9 radial-masked ground-haze pools
    const radial = smoothstep(0.55, 0.0, length(c));
    const color = mix(vec3(0.0, 0.34, 0.48), vec3(0.48, 0.08, 0.34), vUv.x);
    // Halved 2026-10: over the new dark wet street these pools are mist, not a floor wash.
    const a = radial.mul(fog.mul(0.07).add(0.05)).mul(uEnergy.mul(0.34).add(0.48));

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = a.mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    // Additive + no depth write: the DoubleSide back/front split buys nothing (seamless pass).
    material.forceSinglePass = true;
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

    const positionNode = billboardStageVertical(aBase, aSize.mul(0.5));

    const vUv = uv();
    const c = vUv.sub(0.5);
    // Soft radial-ish falloff that reaches 0 well before the quad edge (feathered).
    const radial = smoothstep(0.5, 0.06, length(vec2(c.x.mul(1.3), c.y)));
    // Rolling fog texture so the curtain breathes rather than reading as a flat card.
    const fog = latticeFbm2(vec2(vUv.x.mul(3.0).add(aSeed), vUv.y.mul(2.0).add(uTimeNode.mul(0.08))), 3); // 5->3 oct (perf): 7 large additive haze curtains
    // Cyan low / magenta high vertical gradient — the chapter's two-tone air.
    const hazeColor = mix(vec3(0.0, 0.34, 0.52), vec3(0.50, 0.06, 0.36), vUv.y);
    const alpha = clamp(
        radial.mul(fog.mul(0.45).add(0.45)).mul(uEnergyNode.mul(0.36).add(0.28)).mul(0.09),
        0.0,
        0.14,
    );

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = hazeColor;
    material.opacityNode = alpha.mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    // Additive + no depth write: the DoubleSide back/front split buys nothing (seamless pass).
    material.forceSinglePass = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-haze-stack-tsl';
    mesh.frustumCulled = false;
    mesh.renderOrder = -70;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
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

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
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

// Shared forward-aim sun direction. Ch5 has no on-screen space objects, so the sun is
// the single on-camera hero/anchor/light source: it reads on the DEFAULT forward aim
// (B7 adds a CHAPTER_LOOK biasing the aim up-and-right so the disc sits upper-right).
// Exposed so the gradient, sun-glow sprite and god-ray fans all share ONE direction.
export const SKY_DRIFT_SUN_DIR = new THREE.Vector3(0.34, 0.30, -0.88).normalize();

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
export function createSkyGradientTSL() {
    const uOpacity = uniform(1.0);
    // The sun reads on the DEFAULT forward aim so it is the on-camera hero (no off-
    // screen space objects to anchor against). Shared with the sun-glow sprite + the
    // god-ray fans via SKY_DRIFT_SUN_DIR so the lighting is coherent.
    const uSunDir = uniform(SKY_DRIFT_SUN_DIR.clone());

    const dir = normalize(positionLocal);
    // t in [0,1] from horizon (0) to zenith (1).
    const t = dir.y.mul(0.5).add(0.5);

    // STRENGTHENED vertical gradient — bands spread wide so the dome has real
    // orientation (the old bands sat too close and the master grade flattened them
    // further into one lavender wash). Warm hazy horizon → periwinkle mid → deep
    // warm-violet zenith. All channels < ~0.86 so nothing baseline-blows-out; the
    // additive heroes (sun glow, god-rays, aurora) provide the bright accents.
    const zenith = vec3(0.24, 0.20, 0.42); // deep warm-violet up high
    const midSky = vec3(0.55, 0.52, 0.74); // periwinkle band
    const horizon = vec3(0.86, 0.74, 0.70); // warm hazy horizon glow

    // Two steepened stops (0→0.30, 0.30→1.0) give a crisp horizon band + a real
    // value run from horizon to zenith.
    const lowBand = mix(horizon, midSky, smoothstep(0.0, 0.30, t));
    let color = mix(lowBand, zenith, smoothstep(0.30, 1.0, t));

    // Mie sun (the HERO): forward-scatter halo + a soft capped disc + a broad aureole
    // so the sun reads as a warm anchor, not a smear. cosTheta = dot(viewDir, sunDir).
    const cosTheta = clamp(dot(dir, uSunDir), -1.0, 1.0);
    const mu = max(cosTheta, 0.0);
    const halo = pow(mu, float(5.0)).mul(0.7); // broad warm bloom (boosted)
    const aureole = pow(mu, float(2.0)).mul(0.18); // wide soft aureole around the sun
    const disc = smoothstep(0.985, 0.9995, cosTheta).mul(0.9); // bright core (capped)
    const sunCore = vec3(1.0, 0.82, 0.55); // warm sun core
    color = color.add(sunCore.mul(halo.add(aureole).add(disc)));

    // Gentle horizon haze lift toward the sun azimuth so the lower frame feels warm
    // and atmospheric rather than evenly pale.
    const horizonLift = smoothstep(0.35, 0.0, abs(dir.y)).mul(mu).mul(0.14);
    color = color.add(vec3(0.95, 0.78, 0.66).mul(horizonLift));

    // Hard ceiling so the dome alone can never reach white — raised on the warm side
    // so the boosted sun disc can reach ~0.92 (ACES rolls it off downstream) while
    // the cool zenith stays well sub-white.
    color = color.min(vec3(0.92, 0.86, 0.90));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;

    const geometry = new THREE.SphereGeometry(2500, 64, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return {
        mesh, material, geometry, uniforms: { uOpacity, uSunDir },
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
    material.colorNode = aTint;
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
} = {}) {
    const uTint = uniform(new THREE.Color(tintHex));
    const uLit = uniform(new THREE.Color(litHex));
    // Per-sheet sun back-scatter (0..1): how much this stratum faces the sun, computed
    // CPU-side from the sheet world normal · sun dir. Brightens the sun-facing
    // underside warm so the strata read as lit volume, not flat cards.
    const uBackScatter = uniform(THREE.MathUtils.clamp(backScatter, 0, 1));

    const vUv = uv();
    // Two-scale FBM, drifting in opposite directions → billowing, evolving cloud.
    const p = vUv.mul(scale);
    const t = uTime.mul(drift);
    const base = fbm2(p.add(vec2(t, t.mul(0.4))));
    const detail = fbm2(p.mul(2.1).sub(vec2(t.mul(0.7), 0.0)));
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
    const centered = vUv.sub(0.5);
    const edge = smoothstep(0.42, 0.0, length(centered));

    // Silver-lining rim: a thin bright band along the dense cloud edges toward the lit
    // tint (the cloud's sunlit fringe). Built from the gradient of the density mask
    // approximated as the band where density is mid-valued.
    const rim = smoothstep(0.15, 0.5, density).mul(smoothstep(0.95, 0.55, density));

    // Sun-lit response: brighten the denser cores + the silver-lining rim toward the
    // warm highlight tint. The per-sheet back-scatter lifts the sun-facing undersides.
    const litCore = smoothstep(0.35, 0.85, vUv.y).mul(density);
    const lit = clamp(litCore.mul(0.6).add(rim.mul(0.8)).add(uBackScatter.mul(density).mul(0.5)), 0.0, 1.0);
    const color = mix(uTint, uLit, lit);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    // Capped opacity — many sheets layer, so keep each soft (max ~0.58 at the core).
    material.opacityNode = density.mul(edge).mul(0.58);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.NormalBlending;

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
export function createCloudStrataTSL(uTime) {
    const group = new THREE.Group();
    group.name = 'cloud-strata';
    // [posX, posY, posZ, rotX, rotY, rotZ, scale, tintHex, litHex, coverage, fbmScale]
    // 6 sheets redistributed across the full z -90..-680 span (was 10); each merges the
    // role of ~1.7 of the old sheets, so coverage/scale are bumped for a richer single
    // layer in place of the thinner pairs it replaces.
    const strata = [
        [-95, 38, -90, -1.02, 0.06, 0.20, 0.62, 0xd6d2f0, 0xfff0da, 0.52, 2.0],
        [95, -28, -190, -1.12, 0.16, -0.16, 0.82, 0xc7cdf2, 0xffe9d2, 0.56, 2.3],
        [-50, 50, -290, -0.96, -0.10, 0.22, 1.0, 0xe2d4ee, 0xfff3e0, 0.5, 1.8],
        [80, 8, -410, -1.1, 0.16, -0.18, 1.16, 0xbfc6ee, 0xffead4, 0.58, 2.5],
        [-70, -16, -540, -1.0, -0.12, 0.18, 1.36, 0xe0d6ee, 0xfff4e2, 0.48, 1.8],
        [55, 42, -680, -1.05, 0.06, -0.12, 1.6, 0xcfccf1, 0xffead2, 0.54, 2.1],
    ];
    const parts = [];
    strata.forEach((cfg, i) => {
        const rot = [cfg[3], cfg[4], cfg[5]];
        const sheet = createCloudSheetTSL(uTime, {
            tintHex: cfg[7],
            litHex: cfg[8],
            coverage: cfg[9],
            scale: cfg[10],
            drift: 0.009 + i * 0.0012,
            backScatter: sheetBackScatter(rot),
        });
        sheet.mesh.position.set(cfg[0], cfg[1], cfg[2]);
        sheet.mesh.rotation.set(rot[0], rot[1], rot[2]);
        sheet.mesh.scale.setScalar(cfg[6]);
        sheet.mesh.renderOrder = -55 + i; // behind heroes, in front of dome
        group.add(sheet.mesh);
        parts.push(sheet);
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
export function createGodRayFanTSL(uTime = uniform(0), stripeFreq = 22, phase = 0) {
    const vUv = uv();
    const centered = vUv.sub(0.5);

    // Tight radial mask → a contained shaft, feathered to 0 before the quad edge.
    const radial = smoothstep(0.46, 0.0, length(centered.mul(vec2(0.7, 1.05))));
    // Animated bright stripes raking along the shaft (the volumetric god-ray look).
    const stripes = pow(max(0.0, sin(vUv.x.mul(stripeFreq).add(uTime.mul(0.2)).add(phase))), 3.0).mul(0.22);
    // Warm sun colour fading toward the far (top) end of the shaft.
    const color = mix(vec3(1.0, 0.85, 0.6), vec3(0.85, 0.66, 0.42), vUv.y);
    // Length falloff: brightest near the sun (shaft base), fading toward the viewer.
    const lengthFade = smoothstep(1.0, 0.1, vUv.y).mul(0.6).add(0.4);

    const material = new THREE.MeshBasicNodeMaterial();
    // Low additive floor (0.16) keeps the shaft visible without a bright core.
    material.colorNode = color.mul(stripes.add(0.16));
    material.opacityNode = radial.mul(lengthFade).mul(0.18);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(150, 460, 1, 1);
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
export function createCloudBreakShaftTSL(uTime = uniform(0)) {
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
    fans.forEach((cfg) => {
        const fan = createGodRayFanTSL(uTime, cfg.freq, cfg.phase);
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
export function createAuroraRibbonTSL(uTime, colorA = 0x2effd6, colorB = 0x9a4cff, {
    width = 520, height = 120, segments = 96, bow = 0.0,
    colorMid = 0x44ff8c, colorHi = 0xc24cff, intensity = 1.0,
    // SEAM 5->6: a shared 0..1 fade the curtains multiply into their alpha so the aurora can
    // recede gracefully across the Sky→Space hand-off (defaults to a private full-on uniform
    // when the caller supplies none, so standalone/pilot use is unchanged).
    opacity = null,
} = {}) {
    const uOpacity = opacity ?? uniform(1);
    const uColorA = uniform(new THREE.Color(colorA)); // teal (left/low)
    const uColorMid = uniform(new THREE.Color(colorMid)); // green (centre band)
    const uColorB = uniform(new THREE.Color(colorB)); // violet (right)
    const uColorHi = uniform(new THREE.Color(colorHi)); // magenta (top band)

    // Vertex wobble + a gentle ARC bow across the upper frame (the hero curtain
    // arches rather than hanging flat). bow lifts the ribbon ends down/up parabolically.
    // A slow large-scale sway makes the whole curtain ripple like a real aurora.
    const posL = positionLocal;
    const arcX = posL.x.div(width); // ~[-0.5, 0.5]
    const arc = arcX.mul(arcX).mul(-bow); // parabolic dip toward the edges
    const wobble = sin(posL.x.mul(0.014).add(uTime.mul(0.42))).mul(10.0)
        .add(sin(posL.x.mul(0.033).sub(uTime.mul(0.26))).mul(5.0))
        .add(sin(posL.x.mul(0.006).add(uTime.mul(0.18))).mul(7.0));
    const displaced = vec3(posL.x, posL.y.add(wobble).add(arc), posL.z);

    const vUv = uv();
    // Three interfering curtain frequencies that DRIFT horizontally over time → the
    // characteristic vertical aurora strands that shimmer and slide along the curtain.
    const flow = uTime.mul(0.12);
    const c1 = sin(vUv.x.mul(48.0).add(uTime.mul(0.7))).mul(0.5).add(0.5);
    const c2 = sin(vUv.x.mul(91.0).sub(uTime.mul(0.5))).mul(0.5).add(0.5);
    const c3 = sin(vUv.x.mul(23.0).add(uTime.mul(0.33))).mul(0.5).add(0.5);
    const curtain = c1.mul(0.5).add(c2.mul(0.32)).add(c3.mul(0.28));
    // Soft top/bottom feather so the forward ribbons read as flowing curtains; the
    // base is denser (aurora foot) and fades up toward the magenta crown.
    const vertical = smoothstep(0.0, 0.30, vUv.y).mul(smoothstep(1.0, 0.18, vUv.y));
    // Sharper strands + a lifted floor so the curtain is an ever-present luminous veil.
    const strands = pow(curtain, 2.0).mul(0.7).add(0.34);

    // Horizontal hue run: teal (left) → green (centre) → violet (right), with a slow
    // time drift so the bands slide. Then push the TOP of the curtain toward magenta
    // (green-low / magenta-high), the signature aurora vertical colour split.
    const hx = clamp(vUv.x.add(sin(flow).mul(0.12)), 0.0, 1.0);
    const lowHue = mix(mix(uColorA, uColorMid, smoothstep(0.0, 0.5, hx)), uColorB, smoothstep(0.5, 1.0, hx));
    const crown = smoothstep(0.45, 1.0, vUv.y);
    const color = mix(lowHue, uColorHi, crown.mul(0.6));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    // Boost the ribbon core and lift the strand floor so the HERO aurora reads as a
    // saturated, luminous curtain. Hard-capped at 0.95 so it never blows white even
    // where ribbons overlap (additive). `intensity` scales the brighter foreground
    // hero up and the depth/echo curtains down.
    material.colorNode = min(color.mul(strands.add(0.55)).mul(float(1.55).mul(intensity)), vec3(0.95));
    // Opacity floor lifted so the curtain is visible even in the dim strand troughs —
    // an EVER-PRESENT veil, not a flicker. Still capped soft for the additive stack. The
    // shared uOpacity lets the chapter fade the whole curtain out across the 5->6 seam.
    material.opacityNode = vertical.mul(strands.mul(0.7).add(0.22)).mul(float(0.6).mul(intensity))
        .mul(uOpacity);
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
            uColorA, uColorMid, uColorB, uColorHi, uOpacity,
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
export function createAuroraRibbonsTSL(uTime) {
    const group = new THREE.Group();
    group.name = 'aurora-ribbons';
    // SEAM 5->6: ONE shared fade uniform across all curtains so the whole aurora can recede
    // gracefully across the Sky→Space hand-off (instead of blinking out when the group hides).
    const uOpacity = uniform(1);
    // [x, y, z, colorA, colorB, rotX, rotZ, scale, width, height, bow, colorMid, colorHi, intensity]
    const configs = [
        // ENTRY hero — large + near so the curtain greets the camera the instant the
        // chapter opens (teal→green→violet, magenta crown). Slightly left of centre.
        [-40, 70, -120, 0x2effd6, 0x9a4cff, -0.20, 0.04, 1.0, 600, 132, 78,
            0x44ff8c, 0xd24cff, 1.0],
        // MID hero — the widest sweep, arcing the whole upper frame mid-chapter.
        [30, 84, -300, 0x3cffe0, 0x8a4cff, -0.18, -0.04, 1.12, 680, 128, 90,
            0x52ff96, 0xc24cff, 0.96],
        // High cool back curtain for depth (further + higher, cooler teal→indigo).
        [-20, 96, -240, 0x5cf0ff, 0x6a5cff, -0.14, 0.07, 1.1, 560, 104, 64,
            0x4ce0ff, 0xb05cff, 0.7],
        // LATE hero — keeps a bold curtain ahead through the back half of the chapter
        // so the aurora is present right to the Sky→Space hand-off.
        [10, 76, -500, 0x2cffd0, 0xa24cff, -0.16, -0.05, 1.2, 640, 124, 84,
            0x40ff8c, 0xcc4cff, 0.92],
        // Far back curtain — a softer cool veil deep in the corridor for parallax depth.
        [-30, 100, -640, 0x66f0ff, 0x7a5cff, -0.12, 0.05, 1.3, 600, 100, 60,
            0x58e8ff, 0xb868ff, 0.6],
        // Lower warm-GROUNDED echo — its base picks up the warm sun tint (teal→amber) so
        // one curtain "grounds" toward the sun without breaking the cool identity. Kept
        // dim so the warm note is a hint, not a second hero.
        [40, 40, -200, 0x3affd0, 0xffb066, 0.12, -0.04, 0.9, 460, 84, 44,
            0x6effb0, 0xff9a6a, 0.5],
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
    return { group, parts, uniforms: { uOpacity } };
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

export function createSkyWispTSL(uTime = uniform(0), count = 360) {
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
    material.colorNode = vec3(0.92, 0.88, 0.98);
    // Soft radial feather → no card edge; capped low (additive-soft).
    const dist = length(uv().sub(0.5));
    const glow = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.6);
    material.opacityNode = glow.mul(twinkle).mul(0.16);
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

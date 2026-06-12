/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Cosmic Expanse Environment - Chapter 6 Visual Theme
 *
 * Creates a deep-space vista dominated by a volumetric black hole, a hero gas
 * giant, and a layered nebula. Part of the Odyssey AAA "Cosmic Ascent" overhaul
 * (Phase 4 — chapter level-up); see docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5.
 *
 * WebGPU: the board renderer is now THREE.WebGPURenderer, which cannot draw raw
 * GLSL THREE.ShaderMaterial. The three procedural surfaces (void sky / black-hole
 * accretion + lensing / banded gas giant) are now built by the validated TSL
 * NodeMaterial builders in ./cosmic-expanse.tsl.js, and the three canvas/point
 * particle systems (nebula volume, suction infall, void stars) are instanced
 * billboard quads (THREE.Points renders as 1px on WebGPU) via the shared
 * ./shared/odyssey-tsl-billboard.js helper.
 *
 * Layers (plan §3.2):
 *   0  Nebula void dome      — FBM galactic backdrop, not a flat black sphere
 *   1  Hero anchor           — volumetric black hole: TSL accretion disk
 *                              (swirling plasma + Doppler asymmetry), photon ring,
 *                              fresnel gravitational-lensing shell
 *   1b Hero planet           — banded gas giant with storm bands + atmosphere rim
 *   2  Mid environment       — nebula volume billboards, distant accretion glow
 *   6  Near life             — twinkling starfield + matter spiralling into the void
 *
 * All glow is procedural (uv() disc / fresnel) so create() never needs a
 * `document`/canvas and stays safe in headless tests.
 *
 * Theme: "Journey through stars" -> "The event horizon awaits"
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    cos,
    length,
    mix,
    mod,
    oneMinus,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { getChapterPathRange } from '../path-utils.js';
import {
    createVoidSkyTSL,
    createBlackHoleTSL,
    createHeroPlanetTSL,
    createDistantGalaxyTSL,
    createNebulaPillarTSL,
} from './cosmic-expanse.tsl.js';
import { fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

/**
 * Cosmic Expanse environment configuration
 */
export const COSMIC_EXPANSE_CONFIG = {
    id: 6,
    name: 'cosmic-expanse',
    yStart: 297.5,
    yEnd: 430.0,
    colors: {
        primary: 0x0a0a0a, // Void black
        secondary: 0x1a1a2e, // Deep blue-black
        tertiary: 0xff3300, // Accretion orange
        accent: 0x4400cc, // Event horizon purple
        background: 0x000000, // Pure black
    },
};

// B3b / B-COMPOSE — hero-triad framing march endpoints (lerped by uApproach 0→1 in
// update()). KEY GEOMETRY: across chapter 6 the camera travels local +X/+Y/−Z (forward
// look ≈ (+0.7,+0.5,−0.25)). Heroes placed at a fixed left/deep point therefore DRIFT
// behind + shrink as the camera advances (the screenshots: tiny planet bottom-centre,
// pinprick galaxy far-left). The re-composition LEADS each hero along that forward axis
// (+X/+Y, pulling toward −Z) and grows it, so all three stay framed + clearly visible as
// the camera dollies — the gas giant lower-left foreground, the BH the upper-centre
// destination omen, the galaxy the upper-right far anchor. Module-scoped scratch keeps
// the per-frame lerps allocation-free.
const APPROACH = {
    // Black hole: the destination omen. CREATIVE PLAN (hero re-aim, highest leverage):
    // the camera's forward look runs (+0.7, +0.5, −0.25) — the rail's vanishing point is
    // UP-RIGHT — but the hole used to march at x=0, so for ~15 frames the rail led the
    // eye into empty black while the hero sat centre-left. The march now LEADS +X so
    // the hole rides the rail's vanishing point through the whole act.
    bhScaleA: 1.25,
    bhScaleB: 3.0,
    bhXa: 14,
    bhXb: 130,
    bhZa: -900,
    bhZb: -640,
    bhYa: 20,
    bhYb: 105,
    // Gas giant: a BIG foreground hero in the lower-left of the forward view. Leads in
    // +X/+Y so it tracks with the camera (stays framed) while pulling NEARER (−640→−470)
    // and growing hard (radius 28→62, group scale 1.35→2.2) — the dominant near hero the
    // user wants clearly visible, not a tiny ball on the path.
    planetA: {
        x: -120, y: 8, z: -640, s: 1.35,
    },
    planetB: {
        x: -40, y: 90, z: -470, s: 62 / 28,
    },
    // Galaxy: the upper-right far anchor — HOLDS the upper-right (the same side the
    // rail travels) so the "empty" half of frame always owns a focal.
    galaxyA: {
        x: 150, y: 150, z: -820, s: 120,
    },
    galaxyB: {
        x: 175, y: 185, z: -720, s: 175,
    },
};

const _approachVec = new THREE.Vector3();

// B3 (Overdraw) — hard caps on the nebula billboard tiers. The wispy nebula is a
// fill-rate multiplier (many large overlapping additive quads), so the COUNT is capped
// independently of the preset `particleCount` so high tiers can't scale the cloud into a
// heavy overdraw stack. "Fewer, bigger" reads the same as "many, faint" but costs less
// overdraw — see ODYSSEY_PERFORMANCE_OPTIMIZATION_PLAN.md §3b "fewer-bigger additive layers".
const NEBULA_NEAR_CAP = 150;
const NEBULA_FAR_CAP = 120;

// B-COSMIC-DUST — caps on the DENSE drifting mote field. These are SMALL hard-cored
// motes (not big soft fill), so they tolerate far higher counts than the wispy nebula
// before overdraw bites — but still capped so a high `particleCount` preset can't
// runaway the instance count. Two tiers (near brighter, far dimmer) give parallax depth.
const DUST_NEAR_CAP = 900;
const DUST_FAR_CAP = 1100;

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

export function createCosmicExpanseEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'cosmic-expanse-environment';
    group.userData.chapterId = 6;
    group.userData.yStart = COSMIC_EXPANSE_CONFIG.yStart;
    group.userData.yEnd = COSMIC_EXPANSE_CONFIG.yEnd;
    const chapterRange = getChapterPathRange(6);
    const fallbackCenterY = (COSMIC_EXPANSE_CONFIG.yStart + COSMIC_EXPANSE_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // TSL uniform nodes (expose `.value`, so the existing update() ticks them
    // unchanged). Shared into every TSL builder + billboard material so the whole
    // chapter animates from one clock.
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.3),
        // B3b — chapter-progress omen (0 at chapter entry → 1 at the 6→7 seam). Drives
        // the BH ever-present loom (scale/z/y), the hero-triad framing march (planet +
        // galaxy positions), and the one-time hero nebula PILLAR reveal. A plain scalar
        // ticked from camera progress in update() — no per-frame allocation.
        uApproach: uniform(0),
    };
    group.userData.uniforms = uniforms;

    const particleCount = options.particleCount || 1000;

    // 0. Nebula void dome
    const voidSky = createVoidSky(uniforms);
    group.add(voidSky);

    // 1. The black hole — the act's DESTINATION OMEN. Starts far/small in the upper
    // third and LOOMS larger as the camera approaches the 6→7 seam (driven by uApproach
    // in update(): scale 1.25→3.0, z -900→-640, y 20→70 so it rides the upper third and
    // never sits as a tiny dot on the bottom edge — the #1 Space hero fix). Initial pose
    // matches APPROACH.*A so the first frame / smoke test agrees with the march.
    const blackHole = createBlackHole(uniforms);
    blackHole.position.set(APPROACH.bhXa, APPROACH.bhYa, APPROACH.bhZa);
    blackHole.rotation.x = -1.12;
    blackHole.scale.setScalar(APPROACH.bhScaleA);
    group.add(blackHole);
    group.userData.blackHole = blackHole;

    // 1b. Hero gas giant
    const heroPlanet = createHeroPlanet(uniforms);
    group.add(heroPlanet);
    group.userData.heroPlanet = heroPlanet;

    // 1c. Distant galaxy / quasar — a sharp, persistent deep-space focal anchor
    // up and to the right of the hero, so Space always has a bright far point.
    const galaxy = createDistantGalaxy(uniforms);
    group.add(galaxy);
    group.userData.galaxy = galaxy;

    // 2. Matter spiralling into the void (aligned to the disk plane). Tracks the BH
    // omen's transform each frame in update() so the infall stays seated on the hole as
    // it looms (starts at the BH entry pose).
    const debris = createSuctionParticles(uniforms, particleCount);
    debris.position.copy(blackHole.position);
    debris.rotation.x = -1.12;
    debris.scale.copy(blackHole.scale);
    group.add(debris);
    group.userData.debris = debris;

    // 6. Crisp pinpoint starfield — TWO depth tiers so Space reads DEEP + CLEAR
    // with sharp hot-white pinpoints (the opposite of Sky's haze): a sparse, far
    // shell of small hard pinpoints + a nearer tier of brighter, fewer stars.
    const starsFar = createVoidStars(uniforms, Math.max(96, Math.floor(particleCount * 2.4)), {
        radiusMin: 200,
        radiusSpan: 130,
        sizeBase: 0.7,
        sizeSpan: 1.6,
        coreExp: 2.6,
        name: 'void-stars-far',
    });
    group.add(starsFar);

    const starsNear = createVoidStars(uniforms, Math.max(36, Math.floor(particleCount * 0.7)), {
        radiusMin: 120,
        radiusSpan: 70,
        // B3b — crisper punch-through near tier so stars read OVER the brightest cloud:
        // bigger base, hotter core, a small constant emissive floor, wider diffraction.
        sizeBase: 1.8,
        sizeSpan: 2.8,
        coreExp: 2.0,
        coreMult: 1.45,
        spikeWidth: 11.0,
        emissiveFloor: 0.06,
        brightWeight: 0.7,
        name: 'void-stars-near',
    });
    group.add(starsNear);

    // 2b. Nebula volume — WISPY, color-varied, parallax-tiered (B3b). The flat-pink
    // smoke that dominated 75% of the chapter is broken into fewer/smaller/dimmer near
    // wisps on a cool+warm palette (true-black gaps), PLUS a slower-drifting FAR tier so
    // camera travel reveals parallax depth (near + far + void-dome backstop = 3 planes).
    // B3 (Overdraw): count CAPPED + per-sprite size/alpha nudged up so the same cloud mass
    // reads with ~⅔ the billboards (fewer-bigger — less overdraw, no uniform-haze regression).
    const nebulaVolume = createNebulaVolume(
        uniforms,
        Math.min(NEBULA_NEAR_CAP, Math.max(30, Math.floor(particleCount * 0.26))),
        {
            sizeBase: 22,
            sizeSpan: 52,
            spanX: 620,
            spanY: 300,
            zBase: -640,
            zSpan: 520,
            alphaBase: 0.12,
            driftScale: 1.0,
            name: 'nebula-volume-points',
        },
    );
    group.add(nebulaVolume);
    group.userData.nebulaVolume = nebulaVolume;

    // 2c. FAR nebula tier — large, very dim, deep, drifting much slower for parallax.
    // B3 (Overdraw): the far tier's huge sprites (the biggest fill cost) get the deepest
    // count cut + cap; size/alpha bumped slightly so the deep backdrop body still reads.
    const nebulaFar = createNebulaVolume(
        uniforms,
        Math.min(NEBULA_FAR_CAP, Math.max(20, Math.floor(particleCount * 0.3))),
        {
            sizeBase: 72,
            sizeSpan: 140,
            spanX: 900,
            spanY: 520,
            zBase: -1100,
            zSpan: 500,
            alphaBase: 0.06,
            driftScale: 0.25,
            detailOctaves: 4,
            name: 'nebula-volume-far',
        },
    );
    group.add(nebulaFar);
    group.userData.nebulaFar = nebulaFar;

    // 2e. DENSE drifting mote field (the user's "more particles" — electric-dreams /
    // blood-moon density). TWO tiers for parallax: a NEAR tier of brighter iridescent
    // motes that fills the corridor with twinkling life, plus a FAR tier of fine dim dust
    // for deep parallax. Both INSTANCED + CAPPED + scaled off particleCount; the near tier
    // drifts faster than the far for a strong parallax read as the camera dollies.
    const dustNear = createCosmicDust(
        uniforms,
        Math.min(DUST_NEAR_CAP, Math.max(120, Math.floor(particleCount * 0.55))),
        {
            sizeBase: 0.7,
            sizeSpan: 2.2,
            spanX: 520,
            spanY: 320,
            zBase: -260,
            zSpan: 460,
            alphaBase: 0.55,
            driftScale: 1.0,
            driftAmp: 12.0,
            sparkRatio: 0.26,
            name: 'cosmic-dust-near',
        },
    );
    group.add(dustNear);
    group.userData.dustNear = dustNear;

    const dustFar = createCosmicDust(
        uniforms,
        Math.min(DUST_FAR_CAP, Math.max(160, Math.floor(particleCount * 0.7))),
        {
            sizeBase: 0.5,
            sizeSpan: 1.4,
            spanX: 820,
            spanY: 520,
            zBase: -560,
            zSpan: 760,
            alphaBase: 0.34,
            driftScale: 0.38,
            driftAmp: 7.0,
            sparkRatio: 0.16,
            name: 'cosmic-dust-far',
        },
    );
    group.add(dustFar);
    group.userData.dustFar = dustFar;

    // 2d. Hero nebula PILLAR — a one-time Pillars-of-Creation reveal off the mid-act
    // path, faded in via uApproach (mid-chapter beat). Capped to ONE.
    const nebulaPillar = createNebulaPillar(uniforms);
    group.add(nebulaPillar);
    group.userData.nebulaPillar = nebulaPillar;

    // 2f. ASTEROID GARLAND (creative plan asset 4): 12 dark silhouette rocks crossing
    // the corridor diagonally through the dead-air stretch (progress 0.35–0.65 of the
    // travel), staged UP-RIGHT of the rail with the hero march. Orange accretion rim
    // toward the hole + violet fill come free from the chapter's two lights. Two or
    // three pass within ~30 units of the camera corridor for genuine scale shock.
    const asteroids = createAsteroidGarland();
    group.add(asteroids);
    group.userData.asteroids = asteroids;

    // 2g. AURORA→FILAMENT BRIDGE (creative plan asset 8, Transition In beat 3): the
    // final aurora curtains carried INTO the chapter — stretched filaments that recolor
    // green → crimson (#3DFF8E → #C71F37 → #E8485C) across the entry and dissolve by
    // ~18% local progress, becoming the first crimson nebula filaments.
    const filamentBridge = createAuroraFilamentBridge(uniforms);
    group.add(filamentBridge);
    group.userData.filamentBridge = filamentBridge;

    // 2h. STREAK-MOTE TIER (creative plan asset 6): a sparse rail-hugging tier of
    // slightly elongated quads that sell forward speed through the long middle act.
    const streakMotes = createStreakMotes(uniforms, 90);
    group.add(streakMotes);
    group.userData.streakMotes = streakMotes;

    // Lighting (ominous accretion key)
    setupCosmicLighting(group);

    // Anchor the whole environment to the path's FULL centre (x/y/z), not just Y,
    // so the void dome / black hole / hero planet stay locked to the path corridor
    // and the path never clips out the side of the chapter geometry.
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    return group;
}

function createVoidSky(uniforms) {
    // TSL builder: FBM galactic backdrop (-100 backstop). Returns { mesh } already
    // positioned at renderOrder -100 with BackSide / depthWrite off.
    const { mesh } = createVoidSkyTSL(uniforms.uTime, uniforms.uEnergy);
    return mesh;
}

function createBlackHole(uniforms) {
    // TSL builder: assembles the converted accretion disk + lensing shell with the
    // plain horizon / photon ring / glow rings. Returns { group, disk, lens }.
    const { group } = createBlackHoleTSL(uniforms.uTime, uniforms.uEnergy);
    group.userData.uniforms = uniforms;
    return group;
}

function createHeroPlanet(uniforms) {
    // TSL builder: banded gas-giant surface + plain atmosphere/ring decor. Returns
    // { group, planet }. group.userData.planet is set so update() can spin it. Initial
    // pose matches APPROACH.planetA (update() lerps it onward) so the first frame agrees.
    const { group, planet } = createHeroPlanetTSL(uniforms.uTime);
    group.position.set(APPROACH.planetA.x, APPROACH.planetA.y, APPROACH.planetA.z);
    group.scale.setScalar(APPROACH.planetA.s);
    group.userData.planet = planet;
    return group;
}

function createNebulaVolume(uniforms, count, opts = {}) {
    const {
        sizeBase = 18,
        sizeSpan = 42,
        spanX = 620,
        spanY = 300,
        zBase = -640,
        zSpan = 520,
        alphaBase = 0.10,
        driftScale = 1.0,
        // Creative plan item 6 (far-nebula blockiness, frames 10/12): the far tier's
        // huge sprites under-sample the FBM at 3 octaves, so the deep tier requests 4.
        detailOctaves = 3,
        name = 'nebula-volume-points',
    } = opts;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    // B3b — palette rebalanced AWAY from magenta so cool + warm coexist: one indigo,
    // one cobalt, one (single) magenta, one warm rust, PLUS teal + deep-indigo. This
    // makes the wisps color-varied (with true-black gaps) instead of a flat-pink wash.
    const palette = [
        new THREE.Color(0x6633ff), // indigo
        new THREE.Color(0x2f6bff), // cobalt
        new THREE.Color(0xff5fb0), // magenta (single)
        new THREE.Color(0xffa14a), // warm rust
        new THREE.Color(0x2fd0ff), // teal
        new THREE.Color(0x2a1a6a), // deep indigo
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * spanX;
        positions[stride + 1] = (Math.random() - 0.5) * spanY;
        positions[stride + 2] = zBase - Math.random() * zSpan;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        sizes[index] = sizeBase + Math.random() * sizeSpan;
        phases[index] = Math.random() * Math.PI * 2;
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
    });

    const time = uniforms.uTime;
    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');

    // Animate the soft-cloud CENTER (mirror the old GLSL vertex drift on position).
    const center = vec3(
        aBase.x.add(sin(time.mul(0.05).add(aPhase)).mul(6.0)),
        aBase.y.add(cos(time.mul(0.04).add(aPhase)).mul(4.0)),
        aBase.z,
    );

    // gl_PointSize ~4..90px → small world size; the perspective term is automatic.
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, aSize);

    // ── BLOOD-MOON WISP TEXTURE (adapted to TSL) ──────────────────────────────────
    // Each wisp used to be a flat radial-feather disc — the cause of the "flat pink
    // smoke" wash in the screenshots. We now give every sprite an INTERNAL domain-warped
    // FBM body (the blood-moon nebula technique): warp the sprite uv with a small FBM
    // offset, sample fbm for the gas body + ridged for fibrous strands, and light the
    // strand crests hot. The result is fibrous, billowing volume per sprite instead of a
    // soft blob — so far fewer, bigger sprites read as a rich cloud (perf-safe overdraw).
    // A per-instance phase seed (aPhase) decorrelates each sprite so they don't tile.
    const p = uv().sub(0.5);
    const dist = length(p);
    // Round soft envelope feathered to 0 before the quad edge (no square clip).
    const envelope = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.7);
    const seed = aPhase.mul(3.17);
    // Domain warp the sample coord (the reference's "fluid billowy distortion"). Kept to
    // 2 octaves — the warp only needs low-frequency bend, and these run per-fragment over
    // big additive quads, so octave counts are held LOW to protect fill-rate (perf-safe).
    const warp = vec2(
        fbm3(vec3(p.mul(3.0).add(seed), time.mul(0.05)), 2),
        fbm3(vec3(p.mul(3.0).add(seed).add(7.0), time.mul(0.04).negate()), 2),
    ).sub(0.5).mul(0.55);
    const sp3 = vec3(p.mul(4.2).add(warp).add(seed), time.mul(0.03));
    // Gas body: thresholded FBM so the wisp has dark internal voids, not a solid fill.
    // 3 octaves — enough for fibrous structure without the full 5-octave fragment cost.
    const bodyRaw = fbm3(sp3, detailOctaves);
    const body = smoothstep(0.32, 0.78, bodyRaw);
    // Fibrous strands: ridged crests give the twisting filament structure.
    const strandRaw = ridged3(sp3.mul(0.9).add(4.0), detailOctaves);
    const strand = smoothstep(0.40, 0.80, strandRaw);
    // Hot incandescent strand cores (blood-moon volume highlight) — only the brightest
    // crest tips light up, kept small + warm so the cloud has bright filament cores.
    const core = pow(smoothstep(0.66, 0.9, strandRaw), 2.0);
    // Compose the wisp colour: the instance tint for the body, a warm-hot lift on the
    // strand cores. Capped well below 1 (additive, soft) — ACES + bloom downstream.
    const wispColor = aColor.mul(body.mul(0.7).add(strand.mul(0.5)))
        .add(vec3(1.0, 0.62, 0.5).mul(core).mul(0.5));
    material.colorNode = wispColor;
    // Density = envelope * (body + strands), so the sprite is fibrous + pocketed inside.
    // vAlpha breathes around alphaBase (kept faint) so wisps stay pocketed — variety +
    // parallax + internal structure, not density (never a uniform haze, never blows out).
    const density = envelope.mul(body.mul(0.7).add(strand.mul(0.5)).add(core).max(0.0));
    const breathe = alphaBase * 0.5;
    const vAlpha = varying(sin(time.mul(0.3).add(aPhase)).mul(breathe).add(alphaBase));
    // Cap opacity at 0.6 (additive, soft) so even stacked wisps never approach white
    // blowout — the new internal structure carries the richness, not raw opacity.
    material.opacityNode = clamp(density.mul(vAlpha).mul(2.0), 0.0, 0.6);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    // B3 (Overdraw / QW10): the nebula is a BOUNDED volume (not camera-locked), so give it
    // an explicit instance-cloud bounding sphere and re-enable frustum culling — three's
    // default boundingSphere is computed from the 1×1 base quad (origin-tiny) and would cull
    // the whole system the instant the camera looked away, so we must size it ourselves.
    // Centre = cloud centroid (drift is small + symmetric); radius covers the half-extents
    // plus the max sprite half-size + the per-frame drift so sprites never pop at the edge.
    const maxHalfSize = (sizeBase + sizeSpan) * 0.5;
    const cx = 0;
    const cy = 0;
    const cz = zBase - zSpan * 0.5;
    const hx = spanX * 0.5 + maxHalfSize + 6; // +6/+4 = the sin/cos centre drift below
    const hy = spanY * 0.5 + maxHalfSize + 4;
    const hz = zSpan * 0.5 + maxHalfSize;
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cx, cy, cz),
        Math.sqrt(hx * hx + hy * hy + hz * hz),
    );
    points.frustumCulled = true;
    points.userData.driftScale = driftScale;
    return points;
}

function createNebulaPillar(uniforms) {
    // Hero nebula PILLAR (one-time mid-chapter reveal). B-COMPOSE: re-placed LEFT of and
    // deep behind the corridor (camera travels +X, so a left-biased tall column stays
    // framed as a vertical backdrop instead of sweeping off the right edge low). Lifted +
    // grown so the Pillars-of-Creation reveal reads as a real mid-chapter beat. Faded in
    // by uApproach. A single tall additive plane — capped to one (no per-frame alloc).
    const { mesh } = createNebulaPillarTSL(uniforms.uTime, uniforms.uApproach);
    mesh.position.set(-170, 40, -600);
    mesh.scale.set(200, 420, 1);
    mesh.frustumCulled = false;
    return mesh;
}

function createSuctionParticles(uniforms, count) {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const radii = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.5;
        radii[i] = 30 + Math.random() * 55;
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aPhase: { array: phases, itemSize: 1 },
        aSpeed: { array: speeds, itemSize: 1 },
        aRadius: { array: radii, itemSize: 1 },
    });

    const time = uniforms.uTime;
    const aBase = attribute('aBase', 'vec3');
    const aPhase = attribute('aPhase', 'float');
    const aSpeed = attribute('aSpeed', 'float');
    const aRadius = attribute('aRadius', 'float');

    // Matter spiralling into the void — mirror the old GLSL vertex displacement.
    const t = mod(time.mul(aSpeed).add(aPhase), 10.0);
    const progress = oneMinus(t.div(10.0)); // 1.0 (start) -> 0.0 (center)
    const r = aRadius.mul(progress);
    const angle = aPhase.add(progress.mul(24.0));
    const center = vec3(
        cos(angle).mul(r),
        sin(angle).mul(r).mul(0.32),
        aBase.z.add(oneMinus(progress).mul(6.0)),
    );

    // gl_PointSize (2 + progress*2)px → small world size; perspective is automatic.
    const size = progress.mul(0.5).add(0.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, size);
    // Redshift as it falls in (blue -> orange-red).
    material.colorNode = mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.3, 0.12), oneMinus(progress));
    // glow = pow(1 - dist*2, 1.4) round-discarded at dist > 0.5; alpha = progress.
    const dist = length(uv().sub(0.5));
    const glow = pow(oneMinus(dist.mul(2.0)).max(0.0), 1.4);
    material.opacityNode = glow.mul(progress);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = 'suction-particles';
    points.frustumCulled = false;
    return points;
}

function createVoidStars(uniforms, count, opts = {}) {
    const {
        radiusMin = 200,
        radiusSpan = 120,
        sizeBase = 0.8,
        sizeSpan = 2.4,
        coreExp = 2.6,
        coreMult = 1.15,
        spikeWidth = 14.0,
        emissiveFloor = 0.0,
        brightWeight = 0.0,
        name = 'void-stars',
    } = opts;

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    // Crisp deep-space palette: dominated by hot blue-white pinpoints (the
    // opposite of Sky's pale haze), with a minority of warm gold / cool violet
    // stars for stellar variety. Whites are pushed slightly HOT (>1) so the
    // brightest pinpoints punch through and bloom cleanly.
    const hotPalette = [
        new THREE.Color(1.15, 1.15, 1.2), // hot white-blue
        new THREE.Color(1.1, 1.12, 1.2),
        new THREE.Color(0xcfe0ff),
        new THREE.Color(0xfff0d0),
        new THREE.Color(0xd8c4ff),
    ];
    const tintPalette = [
        new THREE.Color(0x9fc0ff),
        new THREE.Color(0x6fa6ff),
        new THREE.Color(0xffd9a0),
        new THREE.Color(0xffb98a),
        new THREE.Color(0xc59cff),
    ];

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radiusMin + Math.random() * radiusSpan;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        // Sparse big-star distribution: most stars tiny, a few large — squaring the
        // random keeps the field reading as fine pinpoints with rare bright anchors.
        sizes[i] = sizeBase + Math.random() * Math.random() * sizeSpan;
        twinkles[i] = Math.random() * Math.PI * 2;

        const useHot = Math.random() > (1.0 - 0.7 - brightWeight * 0.25);
        const palette = useHot ? hotPalette : tintPalette;
        const color = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinkle: { array: twinkles, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
    });

    const time = uniforms.uTime;
    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinkle = attribute('aTwinkle', 'float');
    const aColor = attribute('aColor', 'vec3');

    // twinkle = 0.78 + 0.22 * sin(...): keep stars mostly ON (sharp + persistent),
    // only a gentle scintillation, so the field never dims into haze. Slightly
    // higher floor than before so the pinpoints stay crisp against the deeper black.
    const twinkle = sin(time.mul(2.2).add(aTwinkle)).mul(0.22).add(0.78);
    const size = aSize.mul(twinkle).mul(0.62);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, size);
    material.colorNode = aColor;
    // Sharp HOT pinpoint: a very tight core (high exponent) for a crisp center, a
    // faint thin halo for a glow seat, plus a subtle 4-point diffraction glint along
    // the sprite axes so the brightest stars read as hot pinpoints. All feathered to
    // 0 before the quad edge — crisp, not hazy.
    const p = uv().sub(0.5);
    const dist = length(p);
    const fall = oneMinus(dist.mul(2.0)).max(0.0);
    const core = pow(fall, coreExp).mul(coreMult);
    const halo = pow(fall, 1.2).mul(0.14);
    // Diffraction spikes: bright along x≈0 and y≈0, decaying with radius — a thin
    // hot cross that sells the "pinpoint star" sparkle without bloating the sprite. The
    // near tier widens these (smaller multiplier → fatter cross) for punchier glints.
    const spike = pow(oneMinus(p.x.abs().mul(spikeWidth)).max(0.0), 3.0)
        .add(pow(oneMinus(p.y.abs().mul(spikeWidth)).max(0.0), 3.0))
        .mul(fall.mul(fall))
        .mul(0.5);
    const vAlpha = varying(twinkle);
    // A small constant emissive floor (near tier) keeps the brightest pinpoints reading
    // OVER bright nebula cloud rather than washing out against it. Capped via core math.
    const floorTerm = fall.mul(fall).mul(emissiveFloor);
    material.opacityNode = core.add(halo).add(spike).add(floorTerm).mul(vAlpha);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    points.frustumCulled = false;
    return points;
}

// B-COSMIC-DUST — DENSE drifting particle field (adapts electric-dreams-v3 motes +
// blood-moon sparks to the perf-safe instanced-billboard contract). A wide volume of
// fine glowing motes on an iridescent magenta/cyan/mint+gold palette, each with a
// per-particle phase so the field drifts organically (parallax via per-tier driftScale
// in update()). INSTANCED + CAPPED + scaled off particleCount; no per-frame allocation.
// Unlike the wispy nebula (big soft fill), these are SMALL hard-cored motes that add
// twinkling DENSITY between the stars and the cloud — the "more particles" the user
// wants — feathered to 0 before the quad edge, additive + capped (no blowout).
function createCosmicDust(uniforms, count, opts = {}) {
    const {
        sizeBase = 0.6,
        sizeSpan = 1.8,
        spanX = 560,
        spanY = 340,
        zBase = -420,
        zSpan = 620,
        alphaBase = 0.5,
        driftScale = 1.0,
        driftAmp = 10.0,
        sparkRatio = 0.22,
        name = 'cosmic-dust',
    } = opts;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const sparks = new Float32Array(count);

    // Iridescent palette adapted from electric-dreams-v3 (magenta / cyan / mint) plus a
    // warm gold mote so the field shares the nebula's cool+warm temperature split.
    const palette = [
        new THREE.Color(0xff4fd0), // hot magenta
        new THREE.Color(0xb45cff), // violet
        new THREE.Color(0x33d6ff), // cyan
        new THREE.Color(0x5cffd0), // mint
        new THREE.Color(0xffc46a), // warm gold
        new THREE.Color(0xcfe0ff), // cool white
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * spanX;
        positions[stride + 1] = (Math.random() - 0.5) * spanY;
        positions[stride + 2] = zBase - Math.random() * zSpan;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        // Power-law sizing (blood-moon spark distribution): squaring keeps most motes
        // tiny with a few brighter sparks, so the field reads as fine dust + rare glints.
        sizes[index] = sizeBase + Math.random() * Math.random() * sizeSpan;
        phases[index] = Math.random() * Math.PI * 2;
        // A minority of motes are "sparks" — brighter, hotter core (energy-driven glow,
        // adapted from electric-dreams' speed→brightness, here a static per-mote flag).
        sparks[index] = Math.random() < sparkRatio ? 1.0 : 0.0;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
        aSpark: { array: sparks, itemSize: 1 },
    });

    const time = uniforms.uTime;
    const energy = uniforms.uEnergy;
    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');
    const aSpark = attribute('aSpark', 'float');

    // Organic per-particle drift (electric-dreams' per-index phase-shifted turbulence):
    // three decorrelated sines so adjacent motes diverge — a living, parallaxing field.
    const dt = time.mul(driftScale * 0.18);
    const center = vec3(
        aBase.x.add(sin(dt.add(aPhase)).mul(driftAmp)),
        aBase.y.add(cos(dt.mul(0.82).add(aPhase.mul(1.7))).mul(driftAmp * 0.7)),
        aBase.z.add(sin(dt.mul(0.6).add(aPhase.mul(2.3))).mul(driftAmp * 0.5)),
    );

    // Twinkle: sparks pulse harder; dust motes shimmer gently. Energy lifts the whole
    // field a touch (audio reactor downstream) — kept subtle so it never goes hazy.
    const twinkle = sin(time.mul(2.4).add(aPhase)).mul(0.5).add(0.5);
    const sparkPulse = aSpark.mul(twinkle).mul(0.6).add(1.0);
    const sizeWorld = aSize.mul(sparkPulse).mul(energy.mul(0.25).add(0.85));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, sizeWorld);
    // Hot-cored mote: tight core + thin halo + a small spark-only diffraction glint, all
    // feathered to 0 before the quad edge (crisp, not hazy). Sparks get a warm-white core
    // lift so they read as energetic glints; dust stays the instance tint.
    const p = uv().sub(0.5);
    const d = length(p);
    const fall = oneMinus(d.mul(2.0)).max(0.0);
    const moteCore = pow(fall, 2.4);
    const moteHalo = pow(fall, 1.2).mul(0.18);
    const glint = pow(oneMinus(p.x.abs().mul(9.0)).max(0.0), 3.0)
        .add(pow(oneMinus(p.y.abs().mul(9.0)).max(0.0), 3.0))
        .mul(fall.mul(fall))
        .mul(aSpark)
        .mul(0.4);
    const moteColor = aColor.add(vec3(1.0, 0.85, 0.7).mul(aSpark).mul(moteCore).mul(0.45));
    material.colorNode = moteColor;
    const vEnergy = varying(twinkle.mul(0.4).add(0.6));
    // Cap below blowout: additive, soft. alphaBase is the per-mote ceiling.
    material.opacityNode = clamp(
        moteCore.add(moteHalo).add(glint).mul(vEnergy).mul(alphaBase),
        0.0,
        0.85,
    );
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const points = new THREE.Mesh(geometry, material);
    points.name = name;
    // Bounded volume — give it an explicit instance-cloud bounding sphere so frustum
    // culling works (three's default is computed from the tiny base quad). Centre =
    // centroid; radius covers half-extents + max mote half-size + drift amplitude.
    const maxHalf = (sizeBase + sizeSpan) * 0.5 + driftAmp;
    const hx = spanX * 0.5 + maxHalf;
    const hy = spanY * 0.5 + maxHalf;
    const hz = zSpan * 0.5 + maxHalf;
    geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 0, zBase - zSpan * 0.5),
        Math.sqrt(hx * hx + hy * hy + hz * hz),
    );
    points.frustumCulled = true;
    points.userData.driftScale = driftScale;
    return points;
}

// Shared scratch for the asteroid tumble (zero per-frame allocation).
const _asteroidDummy = new THREE.Object3D();

/**
 * ASTEROID GARLAND (creative plan asset 4): 12 instanced dark rocks, 4–18 units,
 * strung diagonally up-right across the corridor between the mid-act stations. A lit
 * MeshStandardMaterial silhouette — the orange accretion key (diskLight) rims the
 * holeward edges, the violet rim directional fills the far sides. Per-rock tumble
 * data lives in userData; update() rewrites the instance matrices with a shared dummy.
 */
function createAsteroidGarland() {
    const count = 12;
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({
        color: 0x0b0e18,
        roughness: 0.95,
        metalness: 0.05,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'asteroid-garland';
    mesh.frustumCulled = false;

    const seats = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const spins = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        // Diagonal garland: low-left near → high-right far (with the hero march), a few
        // pulled tight to the corridor (within ~30u) for the close passes.
        const tight = i % 4 === 0;
        seats[i * 3] = THREE.MathUtils.lerp(-30, 150, t) + (Math.random() - 0.5) * 30;
        seats[i * 3 + 1] = THREE.MathUtils.lerp(-16, 96, t) + (Math.random() - 0.5) * 24;
        seats[i * 3 + 2] = THREE.MathUtils.lerp(-180, -520, t)
            + (tight ? 60 : (Math.random() - 0.5) * 60);
        scales[i] = tight ? 4 + Math.random() * 4 : 6 + Math.random() * 12;
        spins[i * 3] = (Math.random() - 0.5) * 0.3;
        spins[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
        spins[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        _asteroidDummy.position.set(seats[i * 3], seats[i * 3 + 1], seats[i * 3 + 2]);
        _asteroidDummy.rotation.set(0, 0, 0);
        _asteroidDummy.scale.setScalar(scales[i]);
        _asteroidDummy.updateMatrix();
        mesh.setMatrixAt(i, _asteroidDummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.seats = seats;
    mesh.userData.scales = scales;
    mesh.userData.spins = spins;
    return mesh;
}

/**
 * AURORA→FILAMENT BRIDGE (creative plan Transition In): three stretched curtain
 * filaments at the chapter entry, recoloring green → crimson as the first ~12% of the
 * chapter elapses and dissolving by ~18% — the sky has become interstellar gas.
 */
function createAuroraFilamentBridge(uniforms) {
    const group = new THREE.Group();
    group.name = 'aurora-filament-bridge';
    const { uTime, uApproach } = uniforms;

    const vUv = uv();
    const strands = pow(sin(vUv.x.mul(42.0).add(uTime.mul(1.2))).mul(0.5).add(0.5), 2.0)
        .mul(0.7)
        .add(0.3);
    // Recolor completes across the first ~12% of the chapter; the filaments stretch as
    // they recolor (handled by the plane scale below) and are gone by ~18%.
    const recolor = clamp(uApproach.mul(8.0), 0.0, 1.0);
    const green = vec3(0.24, 1.0, 0.56); // #3DFF8E (Ch5's last aurora green)
    const crimson = mix(vec3(0.78, 0.12, 0.22), vec3(0.91, 0.28, 0.36), strands); // #C71F37→#E8485C
    const color = mix(green, crimson, recolor);
    const vertical = smoothstep(0.0, 0.3, vUv.y).mul(smoothstep(1.0, 0.2, vUv.y));
    const alive = oneMinus(smoothstep(0.12, 0.18, uApproach));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(strands.add(0.4));
    material.opacityNode = vertical.mul(strands).mul(0.5).mul(alive);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    [
        {
            x: -60, y: 70, z: -140, w: 460, h: 92, rotZ: 0.05,
        },
        {
            x: 40, y: 84, z: -220, w: 540, h: 88, rotZ: -0.04,
        },
        {
            x: -10, y: 92, z: -320, w: 500, h: 80, rotZ: 0.03,
        },
    ].forEach((cfg) => {
        const filament = new THREE.Mesh(new THREE.PlaneGeometry(cfg.w, cfg.h, 1, 1), material);
        filament.position.set(cfg.x, cfg.y, cfg.z);
        filament.rotation.z = cfg.rotZ;
        // Stretched horizontally — curtains elongating into filaments.
        filament.scale.set(1.3, 0.85, 1);
        filament.renderOrder = -9;
        filament.frustumCulled = false;
        group.add(filament);
    });
    return group;
}

/**
 * STREAK-MOTE TIER (creative plan asset 6): rail-hugging elongated additive quads
 * whose streak mask runs along the travel diagonal — the forward-speed cue through
 * the long middle act. GPU-driven wrap (no per-frame CPU).
 */
function createStreakMotes(uniforms, count) {
    const bases = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        bases[i * 3] = (Math.random() - 0.5) * 110;
        bases[i * 3 + 1] = (Math.random() - 0.5) * 70;
        bases[i * 3 + 2] = -60 - Math.random() * 520;
        seeds[i] = Math.random() * Math.PI * 2;
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const { uTime } = uniforms;
    const aBase = attribute('aBase', 'vec3');
    const aSeed = attribute('aSeed', 'float');

    // Rush toward the camera (+Z wrap over the corridor span) so the streaks sell speed.
    const travel = mod(aBase.z.add(600.0).add(uTime.mul(46.0)).add(aSeed.mul(600.0)), 600.0);
    const center = vec3(aBase.x, aBase.y, travel.sub(620.0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, 2.6);
    // Elongated streak mask along the travel diagonal (fixed angle in quad space).
    const STREAK_COS = Math.cos(-0.5);
    const STREAK_SIN = Math.sin(-0.5);
    const p0 = uv().sub(0.5);
    const px = p0.x.mul(STREAK_COS).sub(p0.y.mul(STREAK_SIN));
    const py = p0.x.mul(STREAK_SIN).add(p0.y.mul(STREAK_COS));
    const streak = pow(
        clamp(oneMinus(length(vec2(px.mul(2.0), py.mul(7.0)))), 0.0, 1.0),
        1.4,
    );
    material.colorNode = vec3(0.56, 0.69, 0.94); // cool starlight streak (#8FB0FF family)
    material.opacityNode = streak.mul(0.34);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'cosmic-streak-motes';
    mesh.frustumCulled = false;
    return mesh;
}

function createDistantGalaxy(uniforms) {
    // Sharp, persistent spiral-galaxy/quasar billboard — a crisp deep-space focal anchor
    // up-right of the hero. B-COMPOSE marches it inward toward frame + grows it as the
    // camera approaches the seam ((150,150,-820)/120 → (120,170,-720)/175) via uApproach
    // in update(), so it reads as a real bright spiral rather than a pinprick off-edge.
    const { mesh } = createDistantGalaxyTSL(uniforms.uTime);
    mesh.position.set(APPROACH.galaxyA.x, APPROACH.galaxyA.y, APPROACH.galaxyA.z);
    mesh.scale.setScalar(APPROACH.galaxyA.s);
    mesh.frustumCulled = false;
    return mesh;
}

function setupCosmicLighting(group) {
    group.add(new THREE.AmbientLight(0x141425, 0.5));

    const diskLight = new THREE.PointLight(0xff6a2a, 1.1, 600);
    diskLight.position.set(0, 18, -640);
    group.add(diskLight);
    group.userData.diskLight = diskLight;

    const rimLight = new THREE.DirectionalLight(0x6a4cff, 0.4);
    rimLight.position.set(-60, 50, -200);
    group.add(rimLight);
}

export function updateCosmicExpanseEnvironment(group, delta, time, camera = null, ...updateArgs) {
    // Manager calls update(group, delta, time, camera, cameraProgress, directorState).
    const [cameraProgress = null, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    // Autonomous energy breath (Phase 6 will drive this from the audio reactor).
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp((directorState.energy || 0) * 0.72 + (directorState.bass || 0) * 0.28, 0, 1)
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.32 + Math.sin(time * 0.5) * 0.16
            : 0.24 + audioEnergy * 0.64 + (directorState.beatPulse || 0) * 0.08;
    }

    // ── B3b APPROACH OMEN ────────────────────────────────────────────────────────
    // Chapter-local progress (0 entry → 1 at the 6→7 seam). Prefer the camera's ascent
    // through the chapter y-range (mirrors black-hole-transcendence), fall back to the
    // global cameraProgress, then hold at 0 (smoke tests / no camera).
    let approach = 0;
    const { yStart, yEnd } = group.userData;
    if (camera?.position && Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd !== yStart) {
        approach = THREE.MathUtils.clamp((camera.position.y - yStart) / (yEnd - yStart), 0, 1);
    } else if (Number.isFinite(cameraProgress)) {
        approach = THREE.MathUtils.clamp(cameraProgress, 0, 1);
    }
    const ease = THREE.MathUtils.smoothstep(approach, 0, 1);
    if (uniforms?.uApproach) {
        uniforms.uApproach.value = approach;
    }

    const { blackHole, debris } = group.userData;
    if (blackHole) {
        // Ever-present DESTINATION OMEN: looms larger + rides up into the upper third as
        // the camera approaches the seam (the #1 Space hero-starvation fix).
        const bhScale = THREE.MathUtils.lerp(APPROACH.bhScaleA, APPROACH.bhScaleB, ease);
        blackHole.scale.setScalar(bhScale);
        blackHole.position.set(
            THREE.MathUtils.lerp(APPROACH.bhXa, APPROACH.bhXb, ease),
            THREE.MathUtils.lerp(APPROACH.bhYa, APPROACH.bhYb, ease),
            THREE.MathUtils.lerp(APPROACH.bhZa, APPROACH.bhZb, ease),
        );
        // Subtle precession of the whole assembly.
        blackHole.rotation.z -= delta * 0.04;
    }
    if (debris && blackHole) {
        // Keep the infall seated on the hole as it looms.
        debris.position.copy(blackHole.position);
        debris.scale.copy(blackHole.scale);
    }

    const { heroPlanet } = group.userData;
    if (heroPlanet) {
        // March the gas giant toward mid-distance left-third + grow it (radius 28→40).
        heroPlanet.position.set(
            THREE.MathUtils.lerp(APPROACH.planetA.x, APPROACH.planetB.x, ease),
            THREE.MathUtils.lerp(APPROACH.planetA.y, APPROACH.planetB.y, ease),
            THREE.MathUtils.lerp(APPROACH.planetA.z, APPROACH.planetB.z, ease),
        );
        const planetScale = THREE.MathUtils.lerp(APPROACH.planetA.s, APPROACH.planetB.s, ease);
        heroPlanet.scale.setScalar(planetScale);
        heroPlanet.rotation.y += delta * 0.025;
        heroPlanet.rotation.z = Math.sin(time * 0.08) * 0.025;
    }

    const { nebulaVolume, nebulaFar } = group.userData;
    if (nebulaVolume) {
        nebulaVolume.rotation.y += delta * 0.006 * (nebulaVolume.userData.driftScale ?? 1);
    }
    if (nebulaFar) {
        // Far tier drifts MUCH slower for parallax depth.
        nebulaFar.rotation.y += delta * 0.006 * (nebulaFar.userData.driftScale ?? 0.25);
    }

    // DENSE mote field — the per-particle drift runs in-shader off uTime; a gentle group
    // yaw on top (near faster than far) adds bulk parallax as the camera dollies. No
    // per-frame allocation — just two scalar rotation ticks.
    const { dustNear, dustFar } = group.userData;
    if (dustNear) {
        dustNear.rotation.y += delta * 0.010 * (dustNear.userData.driftScale ?? 1);
    }
    if (dustFar) {
        dustFar.rotation.y += delta * 0.010 * (dustFar.userData.driftScale ?? 0.38);
    }

    const { galaxy } = group.userData;
    if (galaxy) {
        // March the galaxy inward toward frame so it stays a crisp focal point.
        _approachVec.set(
            THREE.MathUtils.lerp(APPROACH.galaxyA.x, APPROACH.galaxyB.x, ease),
            THREE.MathUtils.lerp(APPROACH.galaxyA.y, APPROACH.galaxyB.y, ease),
            THREE.MathUtils.lerp(APPROACH.galaxyA.z, APPROACH.galaxyB.z, ease),
        );
        galaxy.position.copy(_approachVec);
        galaxy.scale.setScalar(THREE.MathUtils.lerp(APPROACH.galaxyA.s, APPROACH.galaxyB.s, ease));
        // Slow billboard roll so the spiral arms turn (the quad stays camera-facing
        // via billboardWorld, but its z-roll spins the sprite's uv frame).
        galaxy.rotation.z += delta * 0.012;
    }

    const { diskLight } = group.userData;
    if (diskLight) {
        diskLight.intensity = 1.0 + Math.sin(time * 0.7) * 0.25 + (uniforms?.uEnergy?.value ?? 0) * 0.4;
    }

    // Asteroid garland: slow per-rock tumble (shared dummy — zero allocation). Twelve
    // matrix rewrites per frame is negligible; the rocks otherwise hold their stations.
    const { asteroids } = group.userData;
    if (asteroids?.userData?.seats) {
        const { seats, scales, spins } = asteroids.userData;
        for (let i = 0; i < scales.length; i += 1) {
            _asteroidDummy.position.set(seats[i * 3], seats[i * 3 + 1], seats[i * 3 + 2]);
            _asteroidDummy.rotation.set(
                time * spins[i * 3],
                time * spins[i * 3 + 1],
                time * spins[i * 3 + 2],
            );
            _asteroidDummy.scale.setScalar(scales[i]);
            _asteroidDummy.updateMatrix();
            asteroids.setMatrixAt(i, _asteroidDummy.matrix);
        }
        asteroids.instanceMatrix.needsUpdate = true;
    }
}

export default {
    config: COSMIC_EXPANSE_CONFIG,
    create: createCosmicExpanseEnvironment,
    update: updateCosmicExpanseEnvironment,
};

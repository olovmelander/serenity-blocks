/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { getChapterPathRange } from '../../path-utils.js';
import { createFBMMountainTSL } from '../mountain-peaks.tsl.js';
import {
    MOUNTAIN_SHADING,
    resolveMountainTreatment,
} from './mountain-language.js';

export const CANONICAL_MOUNTAIN_RANGE_VERSION = 'chapter-04-hero-chain-v2';
export const CANONICAL_HERO_MOUNTAIN_SPEC_IDS = Object.freeze([
    'ch4-left-main',
    'ch4-right-main',
    'ch4-center-hero',
]);

// Hero peaks get their own, LIGHTER haze destination. The shared cool pole (0x33506e) is a
// dark navy left over from the dropped day→night beat: under a bright daylight sky (Ch3
// horizon #bfe4f2) it makes the massif recede DARKER, i.e. inverted aerial perspective.
// Overriding only `fog` here fixes the hero without shifting FAR_RANGE_TREATMENT, whose
// darker pole is ~58% of the flank's final colour and is the read that already works.
const MAIN_PEAK_TREATMENT = {
    ...resolveMountainTreatment({ coolTemp: 1.0 }),
    fog: 0x7d9ec2,
};
const FAR_RANGE_TREATMENT = resolveMountainTreatment({
    coolTemp: 0.72,
    snowLine: MOUNTAIN_SHADING.snowLineFoothill,
});
const MAIN_PEAK_BASE = Object.freeze({
    baseMistStrength: 0.32,
    // Grounding (2026-08): 0.02/0.1 of the hero's 720u height put the chain's alpha-cut at
    // world y ≈ 374 — exactly rail eye height on the whole Ch3→4 approach — so the range
    // FLOATED and everything behind showed through a horizontal gap at its feet (the
    // "second environment" band). 0.005/0.035 seats it opaque from ~y 327, meeting the Ch4
    // snow-floor datum (~302) instead of dissolving at the horizon.
    baseFadeStart: 0.005,
    baseFadeEnd: 0.035,
});
const FAR_RANGE_BASE = Object.freeze({
    baseMistStrength: 0.5,
    baseFadeStart: 0.1,
    baseFadeEnd: 0.3,
});

function fallbackCenter() {
    return new THREE.Vector3(0, 0, 0);
}

function resolveCenter(chapterId) {
    return getChapterPathRange(chapterId)?.center ?? fallbackCenter();
}

function resolveChapterRange(chapterId) {
    return getChapterPathRange(chapterId) ?? {
        start: fallbackCenter(),
        end: fallbackCenter(),
        center: fallbackCenter(),
    };
}

function toLocalPosition(worldPosition, hostCenter) {
    return new THREE.Vector3(
        worldPosition.x - hostCenter.x,
        worldPosition.y - hostCenter.y,
        worldPosition.z - hostCenter.z,
    );
}

export function getCanonicalMountainRangeWorldSpecs({
    includeFarRange = false,
} = {}) {
    const chapter3Center = resolveCenter(3);
    const chapter4Range = resolveChapterRange(4);
    const chapter4Center = chapter4Range.center;
    // ONE MASSIF, not three mountains (2026-08). The three "hero chain" peaks used to sit on
    // three DIFFERENT ground levels (chapter3Center.y −10 / −20 / −30 = a 20u spread) at three
    // different depths (a 140u z spread), so each had its own visible foot line and its own
    // haze/parallax layer — they read as three separate models standing near each other rather
    // than one massif with shoulders. They now share:
    //   • ONE base datum (centerMountainY), which is also the Ch4 snow-floor datum (~world 302),
    //     so the whole chain meets the ground on a single continuous foot line; and
    //   • a TIGHT depth stagger (80u instead of 140u) with the tall centre hero deepest, so the
    //     two mains read as its forward shoulders instead of as separate peaks in front of it.
    // Their footprints already overlap heavily (radii 460/450/670 across a 460u x-spread), so a
    // shared base + tight depth is what fuses them into a single silhouette.
    const centerMountainY = chapter3Center.y - 30;
    const specs = [
        {
            id: 'ch4-left-main',
            role: 'main',
            size: 920,
            height: 360,
            worldPosition: new THREE.Vector3(
                chapter4Center.x - 230,
                centerMountainY,
                chapter4Center.z - 600,
            ),
            seed: 12.34,
            treatment: MAIN_PEAK_TREATMENT,
            base: MAIN_PEAK_BASE,
            isHero: true,
        },
        {
            id: 'ch4-right-main',
            role: 'main',
            size: 900,
            height: 340,
            worldPosition: new THREE.Vector3(
                chapter4Center.x + 230,
                centerMountainY,
                chapter4Center.z - 630,
            ),
            seed: 45.67,
            treatment: MAIN_PEAK_TREATMENT,
            base: MAIN_PEAK_BASE,
            isHero: true,
        },
        {
            id: 'ch4-center-hero',
            role: 'hero',
            size: 1340,
            height: 720,
            worldPosition: new THREE.Vector3(
                chapter4Center.x,
                centerMountainY,
                chapter4Center.z - 680,
            ),
            seed: 89.12,
            treatment: MAIN_PEAK_TREATMENT,
            base: MAIN_PEAK_BASE,
            isHero: true,
        },
    ];

    if (includeFarRange) {
        // ENABLED 2026-08 ("it feels empty on the left side of the big mountains"): this
        // silhouette was fully plumbed but never switched on by any host. Retuned from the
        // original near-centre placement (x −220 — hidden BEHIND the hero) to a genuine
        // FLANK, pushed well past the left-main's outer edge so a misty receding chain fills
        // the empty left sky on the whole Ch3 approach. It sits deeper than the hero plane
        // with the authored far-atmosphere treatment, so it reads as a background
        // aerial-perspective layer, never a band across the hero (the apron lesson).
        //
        // The matching 'ch4-far-right' (x +560, z −1320) was REMOVED 2026-08 on in-game
        // feedback: sitting only 560u off-centre it projected INSIDE the massif's own span
        // rather than beyond it, so instead of balancing the composition it painted a second
        // ridgeline directly behind the hero's right shoulder — which is precisely what was
        // reading through the (then semi-transparent) flank as "mountains behind the hero".
        // The left flank works because −1710 clears the massif angularly; there is no
        // symmetric room on the right, and the composition wants the open sky there.
        specs.push({
            id: 'ch4-far-left',
            role: 'far-range',
            size: 1500,
            height: 430,
            // x −1710 (not the intuitive −780): at ~1700u the same lateral offset
            // subtends HALF the angle it does at the massif's ~850u, so −780 hid the
            // whole chain BEHIND the hero mass (projected centre ndc −0.09 vs the
            // massif spanning −0.45..+0.55). −1710 lands the chain in the empty left
            // third (ndc ≈ −1.0..−0.2 at the rail view), its feet rising out of the
            // open sea haze.
            worldPosition: new THREE.Vector3(
                chapter4Center.x - 1710,
                centerMountainY - 50,
                chapter4Center.z - 1260,
            ),
            seed: 7.77,
            treatment: FAR_RANGE_TREATMENT,
            base: FAR_RANGE_BASE,
            isHero: false,
        });
    }

    return specs;
}

export function createCanonicalMountainRangeTSL({
    hostCenter = null,
    hostChapterId = 4,
    includeFarRange = false,
    name = 'canonical-chapter-04-mountain-range',
    uTransition = null,
    summitGlow = null,
    opacityTargets = null,
    baseOpacity = 1,
} = {}) {
    const resolvedHostCenter = hostCenter ?? resolveCenter(hostChapterId);
    const transition = uTransition ?? uniform(0);
    const group = new THREE.Group();
    group.name = name;
    group.userData.canonicalMountainRange = {
        version: CANONICAL_MOUNTAIN_RANGE_VERSION,
        sourceChapter: 4,
        heroSpecIds: CANONICAL_HERO_MOUNTAIN_SPEC_IDS,
        lockedWorldPlacement: true,
        includesFarRange: includeFarRange,
    };

    // CONSOLIDATION (remake plan #4): peaks that share a treatment (all MAIN hero peaks; both
    // FAR_RANGE peaks) have a byte-identical material graph — so build the material ONCE per
    // treatment and reuse it across their meshes. Ch3's 3 canonical peaks collapse 3 pipelines → 1;
    // Ch4's far range collapses 2 → 1. Per-peak silhouette is all geometry + world position, so the
    // shared material still renders each peak distinctly. Keyed by the treatment object identity
    // (each treatment pairs 1:1 with a base + isHero in getCanonicalMountainRangeWorldSpecs).
    const materialByTreatment = new Map();
    const parts = getCanonicalMountainRangeWorldSpecs({ includeFarRange })
        .map((spec) => {
            const sharedMaterial = materialByTreatment.get(spec.treatment) ?? null;
            const mountain = createFBMMountainTSL({
                size: spec.size,
                height: spec.height,
                seed: spec.seed,
                position: toLocalPosition(spec.worldPosition, resolvedHostCenter),
                treatment: spec.treatment,
                base: spec.base,
                transition,
                summitGlow,
                isHero: spec.isHero,
                material: sharedMaterial,
            });
            if (!sharedMaterial) materialByTreatment.set(spec.treatment, mountain.material);
            mountain.mesh.name = spec.id;
            mountain.mesh.userData.canonicalMountainSpec = {
                id: spec.id,
                role: spec.role,
                version: CANONICAL_MOUNTAIN_RANGE_VERSION,
            };
            if (spec.role === 'far-range') {
                mountain.mesh.renderOrder = -3;
            }
            // UN-FOG THE WHOLE CANONICAL CHAIN (2026-08). Every peak here already carries a
            // complete, authored aerial-perspective language: MOUNTAIN_SHADING.fogNear/fogFar/
            // fogMax ramping toward the treatment's OWN fog colour (a deep cool blue, #33506e
            // at the hero's coolTemp 1.0). The scene FogExp2 was then mixing a PALE MINT
            // (#c8e6c9 in Ch3) / pale grey (#95a5a6 in Ch4) on top of that — an inversion, not
            // a reinforcement.
            //
            // Measured across the 1340u center-hero plane at p=0.30, the surviving true colour
            // ran 95% (near rim) → 41% (cone centre) → 8% (far rim); at p=0.39 the same points
            // read 99% → 56% → 11%. So the scene fog both (a) bleached the massif toward pale
            // mint and (b) painted a huge ramp ACROSS the mesh that SLID as the camera moved —
            // repainting which ridges read as form frame to frame. That is exactly the reported
            // "washed out" + "changes shape / feels like many different modelled mountains".
            //
            // The far-range flank was already exempted and is the control: same builder, same
            // geometry pipeline, reads (in the user's words) "not washed out", "totally like ONE
            // asset", "the same as we move along the path". The heroes now get the same deal.
            // Third instance of this repo's "#1 de-wash lever" (sky dome, landscape ground).
            mountain.material.fog = false;
            if (mountain.uniforms?.uOpacity) {
                mountain.uniforms.uOpacity.value = baseOpacity;
                mountain.uniforms.uOpacity.__odysseyBaseOpacity = baseOpacity;
                opacityTargets?.push(mountain.uniforms.uOpacity);
            }
            group.add(mountain.mesh);
            return {
                id: spec.id,
                role: spec.role,
                mesh: mountain.mesh,
                material: mountain.material,
                geometry: mountain.geometry,
                uniforms: mountain.uniforms,
            };
        });

    group.userData.parts = parts;
    group.userData.specIds = parts.map((part) => part.id);
    // (`isSingleHeroChain` removed 2026-08 — it asserted the group held ONLY the 3 hero specs,
    // which stopped being true once the far-range flanks were enabled, and nothing read it.)
    return { group, parts };
}

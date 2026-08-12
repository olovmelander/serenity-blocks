/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { getChapterPathRange } from '../../path-utils.js';
import { ODYSSEY_PEAK_SPECS } from '../../world/odyssey-peak-specs.js';
import { createFBMMountainTSL } from '../mountain-peaks.tsl.js';
import {
    MOUNTAIN_SHADING,
    resolveMountainTreatment,
} from './mountain-language.js';

export const CANONICAL_MOUNTAIN_RANGE_VERSION = 'chapter-04-hero-chain-v2';
// Derived from the world's authority table rather than restated, so it cannot drift from it.
export const CANONICAL_HERO_MOUNTAIN_SPEC_IDS = Object.freeze(
    ODYSSEY_PEAK_SPECS.filter((peak) => peak.role !== 'far-range').map((peak) => peak.id),
);

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
    // SPEC-AUTHORITY FLIP (2026-08-12): the geometry — sizes, heights, seeds, offsets — now
    // lives in the WORLD's own frozen table (world/odyssey-peak-specs.js) and this builder
    // DERIVES from it, instead of the other way round. The values are byte-identical to the
    // ones that were authored here; only the ownership moved, so that the shipped height
    // field no longer takes its truth from a module scheduled for deletion. The derivation
    // itself is unchanged and worth restating:
    //
    // ONE MASSIF, not three mountains (2026-08). The three "hero chain" peaks share ONE base
    // datum (footDy −30 off the Ch3 centre = the Ch4 snow-floor datum, ~world 302) so the
    // chain meets the ground on a single continuous foot line, and a TIGHT depth stagger
    // (80u) with the tall centre hero deepest, so the mains read as its forward shoulders.
    //
    // The far-left flank (role 'far-range') sits at dx −1710 — NOT the intuitive −780 — so
    // it lands in the empty left third of the frame instead of hiding behind the hero mass,
    // and 50u lower so its feet rise out of the open sea haze. Its mirror 'ch4-far-right'
    // was REMOVED on in-game feedback (it painted a second ridgeline behind the hero's
    // right shoulder); the composition wants the open sky there. Look (treatments/bases) is
    // applied HERE by role — look belongs to the renderer, geometry to the world.
    const chapter3Center = resolveCenter(3);
    const chapter4Center = resolveChapterRange(4).center;

    return ODYSSEY_PEAK_SPECS
        .filter((peak) => includeFarRange || peak.role !== 'far-range')
        .map((peak) => ({
            id: peak.id,
            role: peak.role,
            size: peak.size,
            height: peak.height,
            worldPosition: new THREE.Vector3(
                chapter4Center.x + peak.dx,
                chapter3Center.y + peak.footDy,
                chapter4Center.z + peak.dz,
            ),
            seed: peak.seed,
            treatment: peak.role === 'far-range' ? FAR_RANGE_TREATMENT : MAIN_PEAK_TREATMENT,
            base: peak.role === 'far-range' ? FAR_RANGE_BASE : MAIN_PEAK_BASE,
            isHero: peak.role !== 'far-range',
        }));
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

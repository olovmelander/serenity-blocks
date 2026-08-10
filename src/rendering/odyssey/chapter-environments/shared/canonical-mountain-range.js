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

const MAIN_PEAK_TREATMENT = resolveMountainTreatment({ coolTemp: 1.0 });
const FAR_RANGE_TREATMENT = resolveMountainTreatment({
    coolTemp: 0.72,
    snowLine: MOUNTAIN_SHADING.snowLineFoothill,
});
const MAIN_PEAK_BASE = Object.freeze({
    baseMistStrength: 0.32,
    baseFadeStart: 0.02,
    baseFadeEnd: 0.1,
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
    includeForeground = false,
    includeFarRange = false,
} = {}) {
    const chapter3Center = resolveCenter(3);
    const chapter4Range = resolveChapterRange(4);
    const chapter4Center = chapter4Range.center;
    const centerMountainY = chapter3Center.y - 30;
    const specs = [
        {
            id: 'ch4-left-main',
            role: 'main',
            size: 920,
            height: 360,
            worldPosition: new THREE.Vector3(
                chapter4Center.x - 230,
                chapter3Center.y - 10,
                chapter4Center.z - 540,
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
                chapter3Center.y - 20,
                chapter4Center.z - 590,
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

    if (includeForeground) {
        specs.push({
            id: 'ch4-foreground-ridge',
            role: 'foreground',
            size: 720,
            height: 220,
            worldPosition: new THREE.Vector3(
                chapter4Center.x - 360,
                chapter4Range.start.y - 104,
                chapter4Center.z - 220,
            ),
            seed: 71.5,
            treatment: MAIN_PEAK_TREATMENT,
            base: MAIN_PEAK_BASE,
            isHero: true,
        });
    }

    if (includeFarRange) {
        specs.push(
            {
                id: 'ch4-far-left',
                role: 'far-range',
                size: 1500,
                height: 430,
                worldPosition: new THREE.Vector3(
                    chapter4Center.x - 220,
                    centerMountainY - 40,
                    chapter4Center.z - 1120,
                ),
                seed: 7.77,
                treatment: FAR_RANGE_TREATMENT,
                base: FAR_RANGE_BASE,
                isHero: false,
            },
            {
                id: 'ch4-far-right',
                role: 'far-range',
                size: 1380,
                height: 360,
                worldPosition: new THREE.Vector3(
                    chapter4Center.x + 300,
                    centerMountainY - 55,
                    chapter4Center.z - 1180,
                ),
                seed: 64.2,
                treatment: FAR_RANGE_TREATMENT,
                base: FAR_RANGE_BASE,
                isHero: false,
            },
        );
    }

    return specs;
}

export function createCanonicalMountainRangeTSL({
    hostCenter = null,
    hostChapterId = 4,
    includeForeground = false,
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
        includesForeground: includeForeground,
        includesFarRange: includeFarRange,
    };

    // CONSOLIDATION (remake plan #4): peaks that share a treatment (all MAIN hero peaks; both
    // FAR_RANGE peaks) have a byte-identical material graph — so build the material ONCE per
    // treatment and reuse it across their meshes. Ch3's 3 canonical peaks collapse 3 pipelines → 1;
    // Ch4's far range collapses 2 → 1. Per-peak silhouette is all geometry + world position, so the
    // shared material still renders each peak distinctly. Keyed by the treatment object identity
    // (each treatment pairs 1:1 with a base + isHero in getCanonicalMountainRangeWorldSpecs).
    const materialByTreatment = new Map();
    const parts = getCanonicalMountainRangeWorldSpecs({ includeForeground, includeFarRange })
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
    group.userData.isSingleHeroChain = group.userData.specIds
        .every((id) => CANONICAL_HERO_MOUNTAIN_SPEC_IDS.includes(id))
        && group.userData.specIds.length === CANONICAL_HERO_MOUNTAIN_SPEC_IDS.length;
    return { group, parts };
}

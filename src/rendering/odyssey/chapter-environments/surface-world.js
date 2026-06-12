/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Surface World Environment - Chapter 3 Visual Theme
 *
 * Enhanced Version:
 * - High-Quality Fluffy Grass (Sakura-style billboards) on Terrain
 * - "Rainy Window" style Ocean Surface at horizon
 * - Distant Sakura Landscape/Islands
 * - Volumetric Golden Sun Rays
 * - Flowing "God Ray" Atmosphere
 * - Soft Procedural Clouds
 * - Fluttering Petals & Butterflies
 *
 * WebGPU/TSL: this live chapter now runs on THREE.WebGPURenderer. Its GLSL
 * THREE.ShaderMaterials were replaced with the validated TSL NodeMaterial builders in
 * the sibling surface-world.tsl.js, and the canvas-point petals were rebuilt as instanced
 * billboard quads (odyssey-tsl-billboard.js). The public API (exports, group.userData
 * shape, update signature) is unchanged.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    cos as tslCos,
    float as tslFloat,
    max as tslMax,
    mod as tslMod,
    oneMinus,
    sin as tslSin,
    smoothstep as tslSmoothstep,
    step as tslStep,
    uniform,
    uv,
    vec2 as tslVec2,
    vec3,
} from 'three/tsl';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathPointAt,
    ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET,
} from '../path-utils.js';
import {
    createMountainAuroraBackdrop,
    resolveMountainAuroraPreviewOpacity,
    SURFACE_WORLD_AURORA_PREVIEW_LAYER_OPACITIES,
} from './shared/mountain-aurora.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import {
    createSkyBackgroundTSL,
    createOceanSurfaceTSL,
    createLandscapeTSL,
    createFoothillBridgeTSL,
    createFluffyGrassTSL,
    createSunRaysTSL,
    createCloudsTSL,
    createDistantMountainsTSL,
    createGrassTuftsTSL,
    createTreesTSL,
    createTreeLineTSL,
    createReedsTSL,
    createGreatTreeTSL,
    createFallingLeavesTSL,
    createWaterfallTSL,
    getSurfaceGreatTreeAnchor,
    createPollenTSL,
    createBirdsTSL,
    createSunDiscTSL,
    createSpruceTreesTSL,
    createCabinTSL,
    createForegroundPassByTSL,
    createSnowMotesTSL,
} from './surface-world.tsl.js';

/**
 * Surface World environment configuration
 */
export const SURFACE_WORLD_CONFIG = {
    id: 3,
    name: 'surface-world',
    yStart: 52.5,
    yEnd: 97.5,
    transitionZone: 0.06, // Much earlier fade-in for maximum overlap
    colors: {
        primary: 0x87ceeb, // Sky blue
        secondary: 0x90ee90, // Light green
        tertiary: 0xffb7c5, // Sakura pink
        accent: 0xffd700, // Golden sunlight
        background: 0xc8e6c9, // Soft green fog
    },
};

const SURFACE_WORLD_TERRAIN_DEPTH_OFFSET = 8;

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

// WebGPU/TSL: NodeMaterials expose no `material.uniforms` map, so the per-element
// uniform nodes (uTime/uSnowBlend/uOpacity) returned by the .tsl.js builders are
// collected on each Object3D's `userData.odysseyUniforms` when the element is built.
// These collectors gather those TSL uniform nodes (which support `.value` like the old
// THREE.Uniform) so the existing update() opacity/snow logic ticks unchanged.
function collectUniformTargets(root, uniformName, targets, seen) {
    if (!root) return;

    const collectFromHolder = (holder) => {
        const node = holder?.userData?.odysseyUniforms?.[uniformName];
        if (!node || seen.has(node)) return;
        if (typeof node.value !== 'number') return;

        if (node.__odysseyBaseOpacity === undefined && uniformName === 'uOpacity') {
            node.__odysseyBaseOpacity = node.value;
        }

        seen.add(node);
        targets.push(node);
    };

    collectFromHolder(root);
    root.traverse((child) => collectFromHolder(child));
}

function collectUniformTargetsFromRoots(roots, uniformName) {
    const targets = [];
    const seen = new Set();

    roots.filter(Boolean).forEach((root) => {
        collectUniformTargets(root, uniformName, targets, seen);
    });

    return targets;
}

// Attach a builder's returned TSL uniform nodes onto an Object3D so the collectors
// above can find them by name during traversal.
function tagUniforms(object3d, builderUniforms) {
    if (!object3d || !builderUniforms) return object3d;
    const existing = object3d.userData.odysseyUniforms || {};
    object3d.userData.odysseyUniforms = { ...existing, ...builderUniforms };
    return object3d;
}

export function resolveSurfaceWorldVisibilityState({
    waterSurfaceY,
    surfaceProbeY,
    cameraY,
}) {
    const fallbackProbeY = Number.isFinite(cameraY) ? cameraY : waterSurfaceY;
    const resolvedProbeY = Number.isFinite(surfaceProbeY) ? surfaceProbeY : fallbackProbeY;
    const isUnderwater = resolvedProbeY < (waterSurfaceY - 2);
    const surfaceOpacity = THREE.MathUtils.smoothstep(
        resolvedProbeY,
        waterSurfaceY - 12,
        waterSurfaceY + 2,
    );

    return {
        surfaceProbeY: resolvedProbeY,
        cameraY: fallbackProbeY,
        isUnderwater,
        surfaceOpacity,
    };
}

export function resolveSurfaceWorldAuroraPreviewState(progress) {
    const previewOpacity = resolveMountainAuroraPreviewOpacity(progress);

    return {
        previewOpacity,
        previewVisible: previewOpacity > 0,
    };
}

/**
 * Resolve the ALPINE RAMP for Surface World's distant range + foothill skirt.
 *
 * GATE THE LEAK: those big alpine pieces are anchored at Chapter 3's path center and are
 * huge (≈800–1200 wide). With only the underwater surface-opacity gate they popped into
 * the camera's view during the Deep Ocean→Surface seam (the "alpine peaks + translucent
 * slab during Deep Ocean" bug). They must only fade in across the Surface→Mountains
 * approach (the back portion of Ch3), never during Ch2. This ramps 0→1 over the latter
 * part of Chapter 3 by progress, so they are absent early in Ch3 (and therefore in Ch2).
 *
 * @param {number} progress global Odyssey path progress (0..1), or null.
 * @param {number[]} [chapterPositions] active chapter-start progresses.
 * @returns {{rampOpacity:number, rampVisible:boolean}}
 */
export function resolveSurfaceWorldAlpineRampState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        // No progress info (e.g. the standalone pilot) — show the range fully so the
        // chapter still reads correctly; the leak is a live-traversal artefact only.
        return { rampOpacity: 1, rampVisible: true };
    }

    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { rampOpacity: 1, rampVisible: true };
    }

    // Begin the fade-in just past a third of Chapter 3 (creative plan asset 10: the
    // destination landmark must be faintly present from mid-chapter onward, not a
    // frame-26 surprise) and reach full just before the Mountains boundary.
    const rampStart = ch3Start + (ch4Start - ch3Start) * 0.32;
    const rampEnd = ch4Start;
    const rampOpacity = THREE.MathUtils.smoothstep(progress, rampStart, rampEnd);

    return { rampOpacity, rampVisible: rampOpacity > 0 };
}

// SEAM 3->4 ("the mountains change shape, and the waterfalls disappear"). The manager's
// group-opacity crossfade can't reach these TSL NodeMaterials (their alpha flows through
// opacityNode/uOpacity, not material.opacity), so without this they stay full-opacity until
// group.visible flips false at the seam = a hard pop. This resolves a 1->0 recede ramp keyed
// to global progress across the FINAL stretch of Ch3 into the Surface→Mountains seam:
//   • the WATERFALL recedes (fades) gracefully instead of vanishing, and
//   • the Surface distant-range fades in lock-step with the rising Mountains hero peaks
//     (driven up by the manager ecotone) so the shape SWAP cross-dissolves rather than jumps.
// Pure arithmetic, no allocation. Outside the band (or with no progress) it returns 1 so the
// chapter reads fully when standalone / mid-chapter.
const SURFACE_SEAM_RECEDE_BAND = 0.42; // fraction of Ch3 span before the boundary to recede over

/**
 * ENTRY RAMP (creative plan Transition In): the landscape slab popped into frame 01–02
 * and petals leaked through the breach because the surface elements appeared at full
 * presence the moment the camera crossed the waterline. This ramps everything 0→1 from
 * just inside the 2→3 ecotone to ~7% into the chapter, so the first held composition
 * RISES into frame instead of popping.
 */
export function resolveSurfaceWorldEntryRampState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { entryOpacity: 1 };
    }
    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { entryOpacity: 1 };
    }
    const span = ch4Start - ch3Start;
    const entryOpacity = THREE.MathUtils.smoothstep(
        progress,
        ch3Start - span * 0.02,
        ch3Start + span * 0.07,
    );
    return { entryOpacity };
}

export function resolveSurfaceWorldSeamRecedeState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { recedeOpacity: 1 };
    }

    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { recedeOpacity: 1 };
    }

    // Recede across the last SURFACE_SEAM_RECEDE_BAND of Ch3 up to the boundary. Smoothstep
    // 1->0 (note the reversed edges so it falls as progress rises into the seam).
    const span = ch4Start - ch3Start;
    const recedeStart = ch4Start - span * SURFACE_SEAM_RECEDE_BAND;
    const recedeOpacity = THREE.MathUtils.smoothstep(progress, ch4Start, recedeStart);

    return { recedeOpacity };
}

export function createSurfaceWorldEnvironment() {
    const group = new THREE.Group();
    group.name = 'surface-world-environment';
    group.userData.chapterId = 3;
    group.userData.yStart = SURFACE_WORLD_CONFIG.yStart;
    group.userData.yEnd = SURFACE_WORLD_CONFIG.yEnd;

    // Shared time clock. On WebGPU this is a TSL uniform node (it still exposes `.value`,
    // so the update() loop ticks it exactly as before); it is passed into every .tsl.js
    // builder so all converted materials share one clock.
    //
    // uSeason (creative plan item 6): ONE scalar, 0 at the surface breach → 1 at the
    // Mountains seam, scripting the spring→autumn→winter arc THROUGH LIGHT — the sky
    // bands, sun disc, key light, god-ray density, tree recolor, and the one-at-a-time
    // particle stories (petals → pollen → leaves → snow) all ride it.
    const uTime = uniform(0);
    const uSeason = uniform(0);
    const uniforms = { uTime, uSeason };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(3);
    const chapter4Range = getChapterPathRange(4);
    const fallbackCenterY = (SURFACE_WORLD_CONFIG.yStart + SURFACE_WORLD_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const waterSurfaceY = chapterRange
        ? chapterRange.start.y - ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET
        : chapterCenterY - 15;
    const surfaceOffsetY = waterSurfaceY - chapterCenterY;
    const surfaceWorldY = chapterCenterY + surfaceOffsetY;
    const terrainOffsetY = surfaceOffsetY + (15 - SURFACE_WORLD_TERRAIN_DEPTH_OFFSET);

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    const snowTransitionEndY = chapter4Range?.start.y ?? group.userData.yEnd;
    const snowTransitionRange = chapterRange
        ? (chapterRange.end.y - chapterRange.start.y) * 0.4
        : 18;
    group.userData.snowTransition = {
        endY: snowTransitionEndY,
        range: snowTransitionRange,
    };

    // 1. Sky Background
    const sky = createSkyBackground(uniforms);
    sky.name = 'sky';
    group.add(sky);

    // 2. Ocean Surface (Bottom) - visible from above and below
    const ocean = createOceanSurface(uniforms, surfaceOffsetY);
    ocean.name = 'ocean-surface';
    group.add(ocean);

    // 3. Distant Landscape/Islands - only visible above water
    const landscape = createLandscape(uniforms, surfaceWorldY);
    landscape.name = 'landscape';
    landscape.position.y = terrainOffsetY;
    group.add(landscape);
    group.userData.landscape = landscape;

    // 3.5 Foothill terrain bridge into Chapter 4
    const foothillBridge = createFoothillBridge(uniforms);
    foothillBridge.name = 'foothill-bridge';
    foothillBridge.position.y = terrainOffsetY;
    group.add(foothillBridge);
    group.userData.foothillBridge = foothillBridge;
    group.userData.snowFloor = foothillBridge;

    // 3.75 Distant Mountains on horizon (same style as Chapter 4)
    const distantMountains = createDistantMountains(uniforms);
    distantMountains.name = 'distant-mountains';
    group.add(distantMountains);
    group.userData.distantMountains = distantMountains;
    group.userData.foothillMist = distantMountains.userData.foothillMist;

    const auroraPreview = createMountainAuroraBackdrop(uniforms, {
        name: 'mountain-aurora-preview',
        layerCount: 3,
        layerOpacities: SURFACE_WORLD_AURORA_PREVIEW_LAYER_OPACITIES,
    });
    group.add(auroraPreview);
    group.userData.auroraPreview = auroraPreview;

    // 4. High Quality Fluffy Grass (Removed per user request due to floating artifacts)
    // const grass = createFluffyGrass(uniforms, 1000);
    // group.add(grass);

    // 4.5 Visible golden SUN disc + halo (golden-hour) - only visible above water
    const sun = createSunDisc(uniforms);
    sun.name = 'sun-disc';
    group.add(sun);
    group.userData.sun = sun;

    // 5. Volumetric Sun Rays - only visible above water
    const rays = createSunRays(uniforms);
    rays.name = 'sun-rays';
    group.add(rays);

    // 6. Soft Procedural Clouds - only visible above water
    const clouds = createClouds(uniforms);
    clouds.name = 'clouds';
    group.add(clouds);

    // 7. Petals (Updated) - only visible above water
    const petals = createPetals(uniforms, 600);
    petals.name = 'petals';
    group.add(petals);

    // 8. Butterflies - only visible above water
    const butterflies = createButterflies(20);
    butterflies.name = 'butterflies';
    group.add(butterflies);
    group.userData.butterflies = butterflies;

    // 9. Living Landscapes vegetation — instanced low-poly grass tufts, trees and reeds,
    // all anchored to the same getTerrainHeight() as the terrain so they sit ON the
    // ground. Capped + instanced; FrontSide solid (no flat cardboard undersides).
    const grassTufts = createGrassTufts(uniforms, 700);
    grassTufts.name = 'grass-tufts';
    grassTufts.position.y = terrainOffsetY;
    group.add(grassTufts);
    group.userData.grassTufts = grassTufts;

    const trees = createTrees(uniforms, 26);
    trees.name = 'trees';
    trees.position.y = terrainOffsetY;
    group.add(trees);
    group.userData.trees = trees;

    // Spruce stands — the second species (creative plan item 5): mixed stands with the
    // deciduous rounds so the forest reads as forest, never uniform stamping.
    const spruces = createSpruces(uniforms, 22);
    spruces.name = 'spruce-trees';
    spruces.position.y = terrainOffsetY;
    group.add(spruces);
    group.userData.spruces = spruces;

    // Mid-distance tree LINE (2nd instanced pass) — layers the hill silhouette in depth.
    const treeLine = createTreeLine(uniforms, 44);
    treeLine.name = 'tree-line';
    treeLine.position.y = terrainOffsetY;
    group.add(treeLine);
    group.userData.treeLine = treeLine;

    const reeds = createReeds(uniforms, 220);
    reeds.name = 'reeds';
    reeds.position.y = terrainOffsetY;
    group.add(reeds);
    group.userData.reeds = reeds;

    // HERO landmark: the great ancient tree on a knoll off the left of the path. Plus
    // falling-leaf billboards drifting off its canopy. Anchored via getTerrainHeight in the
    // builder (with -15 baked in like the other prop instancers), then lifted by the same
    // terrainOffsetY the rest of the vegetation uses so it sits on the rendered ground.
    const greatTree = createGreatTree(uniforms);
    greatTree.name = 'great-tree';
    greatTree.position.y += terrainOffsetY;
    group.add(greatTree);
    group.userData.greatTree = greatTree;
    // HOOK for B7 (camera landmark look-bias): the Great Tree's LOCAL anchor (relative to
    // the chapter group) so the camera controller can bias its lookAt toward the hero at the
    // hero-tree beat. World position = group.position + this anchor (with the prop offset).
    const greatTreeAnchor = getSurfaceGreatTreeAnchor();
    group.userData.greatTreeAnchor = {
        x: greatTreeAnchor.x,
        y: (greatTreeAnchor.y - 15) + terrainOffsetY + 30, // canopy mid-height
        z: greatTreeAnchor.z,
    };

    // Corridor sampling for the foreground pass-by layer + the corridor-wide autumn
    // leaves (chapter-local spline stations; create-time only, zero per-frame cost).
    const chapterPositions = getActiveOdysseyChapterPositions();
    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3];
    group.userData.chapterTStart = ch3Start ?? 0.25;
    group.userData.chapterTEnd = ch4Start ?? 0.41;
    const fgPlacements = [];
    const leafPlacements = [];
    if (chapterRange?.center && Number.isFinite(ch3Start) && Number.isFinite(ch4Start)) {
        for (let i = 0; i < 120; i += 1) {
            const t = THREE.MathUtils.lerp(ch3Start, ch4Start, i / 119);
            const pt = getOdysseyPathPointAt(t);
            const side = i % 2 === 0 ? 1 : -1;
            const local = {
                x: pt.x - chapterRange.center.x + side * (2 + Math.random() * 6),
                y: pt.y - chapterCenterY - 1.6 + Math.random() * 1.4,
                z: pt.z - chapterRange.center.z + (Math.random() - 0.5) * 3,
            };
            fgPlacements.push(local);
            if (i % 2 === 0) {
                leafPlacements.push({
                    x: local.x + side * (3 + Math.random() * 14),
                    y: local.y + 6,
                    z: local.z,
                });
            }
        }
    }

    // Foreground PASS-BY layer (creative plan asset 7): the near-silhouette dark anchor
    // flanking the spline the whole chapter — speed, intimacy, and the darkest value in
    // every frame.
    const foregroundLayer = createForegroundLayer(uniforms, fgPlacements);
    foregroundLayer.name = 'foreground-pass-by';
    group.add(foregroundLayer);
    group.userData.foregroundLayer = foregroundLayer;

    const fallingLeaves = createFallingLeaves(uniforms, 120, leafPlacements);
    fallingLeaves.name = 'falling-leaves';
    fallingLeaves.position.y += terrainOffsetY;
    group.add(fallingLeaves);
    group.userData.fallingLeaves = fallingLeaves;

    // Falu-red cabin (creative plan asset 3): the human-scale cue at the treeline,
    // promoted from hazed speck to landmark.
    const cabin = createCabin(uniforms);
    cabin.position.y += terrainOffsetY;
    group.add(cabin);
    group.userData.cabin = cabin;

    // Winter snow motes (creative plan asset 9): the final act's particle story.
    const snowMotes = createSnowMotes(uniforms, 220);
    snowMotes.name = 'snow-motes';
    group.add(snowMotes);
    group.userData.snowMotes = snowMotes;

    // Second beat: a tiered cliff waterfall feeding the lake further down-corridor.
    const waterfall = createWaterfall(uniforms);
    waterfall.name = 'waterfall';
    waterfall.position.y += terrainOffsetY;
    group.add(waterfall);
    group.userData.waterfall = waterfall;

    // 10. Warm-amber pollen motes drifting in the golden-hour light.
    const pollen = createPollen(uniforms, 260);
    pollen.name = 'pollen';
    group.add(pollen);
    group.userData.pollen = pollen;

    // 11. A couple of drifting birds (low-poly silhouettes).
    const birds = createBirds(5);
    birds.name = 'birds';
    group.add(birds);
    group.userData.birds = birds;

    // Golden-hour raking key (Batch B5): a LOW warm directional sun raking from the left
    // gilds the hills with long shadows, balanced by a cool sky-fill ambient that keeps the
    // shadows from going muddy. Lower/warmer than the old near-overhead key so the relief
    // reads at the forward angle without lifting the frame toward white.
    const ambient = new THREE.AmbientLight(0xacc6e6, 0.32); // Cool sky-fill
    group.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffcf7a, 0.7); // Low warm golden key
    sunLight.position.set(-90, 38, -120); // low raking angle from the left
    group.add(sunLight);
    // Creative plan item 6: the season MOVES the key — spring gold → autumn amber →
    // winter pale-blue. Colors precomputed (no per-frame allocation); the update loop
    // rewrites color/intensity every frame per the QW4 light-rig rule.
    group.userData.sunKey = sunLight;
    group.userData.skyFill = ambient;
    group.userData.seasonLight = {
        springKey: new THREE.Color(0xffcf7a),
        autumnKey: new THREE.Color(0xffb070),
        winterKey: new THREE.Color(0xdce8ff),
        springFill: new THREE.Color(0xacc6e6),
        winterFill: new THREE.Color(0xc9d6ee),
    };

    // Store references to surface-only elements for visibility toggling (visible from
    // above the water). The alpine pieces (foothillBridge, distantMountains) are NOT here
    // — they toggle on the combined surface+alpine-ramp gate below so they never appear in
    // the Deep Ocean view (see resolveSurfaceWorldAlpineRampState).
    group.userData.surfaceElements = [
        ocean,
        landscape,
        auroraPreview,
        sun,
        rays,
        clouds,
        petals,
        butterflies,
        grassTufts,
        trees,
        spruces,
        treeLine,
        reeds,
        greatTree,
        fallingLeaves,
        waterfall,
        cabin,
        foregroundLayer,
        snowMotes,
        pollen,
        birds,
    ];
    group.userData.skyElement = sky;
    group.userData.waterSurfaceY = surfaceWorldY;
    group.userData.snowBlendUniformTargets = collectUniformTargetsFromRoots(
        [landscape, foothillBridge, distantMountains],
        'uSnowBlend',
    );
    group.userData.surfaceOpacityUniformTargets = collectUniformTargetsFromRoots(
        [
            ocean,
            landscape,
            sun,
            rays,
            clouds,
            petals,
            butterflies,
            cabin,
            foregroundLayer,
            snowMotes,
            pollen,
        ],
        'uOpacity',
    );
    // SEAM 3->4: the WATERFALL gets its OWN opacity target set so it can be gated by the
    // surface fade AND the seam-recede ramp (so it recedes gracefully into the Mountains
    // approach instead of blinking off when the group hides). Excluded from the surface set
    // above to avoid a double-write of the same uOpacity node in one frame.
    group.userData.waterfallOpacityUniformTargets = collectUniformTargetsFromRoots(
        [waterfall],
        'uOpacity',
    );
    // GATE THE LEAK: the alpine pieces (distant range + foothill skirt) get their own
    // opacity target set so they can be gated by BOTH the underwater surface fade AND the
    // Surface→Mountains alpine ramp (so they never bleed into the Deep Ocean view). They
    // are deliberately excluded from surfaceOpacityUniformTargets above to avoid a
    // double-write of the same uOpacity node within one frame.
    group.userData.alpineOpacityUniformTargets = collectUniformTargetsFromRoots(
        [foothillBridge, distantMountains],
        'uOpacity',
    );
    group.userData.auroraPreviewOpacityUniformTargets = collectUniformTargetsFromRoots(
        [auroraPreview],
        'uOpacity',
    );
    // The alpine pieces toggle on the combined gate (surface + ramp); the rest of the
    // surface elements toggle on surface opacity alone.
    group.userData.alpineElements = [foothillBridge, distantMountains];

    // Anchor the whole environment to the path's FULL center (x,y,z), not just Y, so the
    // terrain/ocean/mountains stay centred on the path and the forward camera never clips
    // through chapter geometry (mirrors mountain-peaks.js).
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    return group;
}

// WebGPU/TSL: sky-sphere backstop delegated to the validated createSkyBackgroundTSL
// builder (graded sky + sun-glow bleed). Same SphereGeometry(2500,64,48), BackSide,
// renderOrder -100. uTime shared in; returned uOpacity tagged for the fade collectors.
function createSkyBackground(uniforms) {
    const { mesh, uniforms: builderUniforms } = createSkyBackgroundTSL(uniforms.uTime, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: paradise ocean delegated to createOceanSurfaceTSL (Gerstner waves +
// caustics + fresnel). Same PlaneGeometry(300,300,64,64) rotated flat, positioned at
// surfaceOffsetY. uTime shared in; returned uOpacity tagged for the fade collectors.
function createOceanSurface(uniforms, surfaceOffsetY = -15) {
    const { mesh, uniforms: builderUniforms } = createOceanSurfaceTSL(uniforms.uTime, surfaceOffsetY);
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: CPU-baked tropical-island terrain delegated to createLandscapeTSL (its
// builder owns the byte-identical getTerrainHeight bake + the GPU sand/grass/fog/snow
// shading). Same position.y = -15 base; uSnowBlend/uOpacity tagged for the collectors.
function createLandscape(uniforms, waterLevel = 60.0) {
    const { mesh, uniforms: builderUniforms } = createLandscapeTSL(uniforms.uTime, waterLevel);
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: foothill terrain bridge into Chapter 4 delegated to createFoothillBridgeTSL
// (its builder owns the byte-identical heightfield walk + the GPU grass/tundra/snow/fog
// shading). Same position (0,0,-500) and renderOrder -2; uSnowBlend/uOpacity tagged for
// the collectors (and the live update() reads uOpacity from userData.odysseyUniforms to
// drive the bridge's depthWrite toggle).
function createFoothillBridge(uniforms) {
    const { mesh, uniforms: builderUniforms } = createFoothillBridgeTSL(uniforms.uTime);
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: fluffy grass delegated to createFluffyGrassTSL (instanced billboard quads
// with wind-sway + the procedural blade CanvasTexture, anchored to the same getTerrainHeight
// bake). Returns the InstancedMesh; kept exported for parity with the live API.
export function createFluffyGrass(uniforms, count) {
    const { mesh } = createFluffyGrassTSL(uniforms.uTime, count);
    return mesh;
}

// WebGPU/TSL: Living Landscapes vegetation. Each builder returns an instanced low-poly
// mesh anchored to getTerrainHeight() (props sit on the ground, no floating). No uniforms
// to tag (the sway is time-driven via the shared uTime node), so they are returned plain.
function createGrassTufts(uniforms, count) {
    const { mesh } = createGrassTuftsTSL(uniforms.uTime, count);
    return mesh;
}

function createTrees(uniforms, count) {
    const { mesh } = createTreesTSL(uniforms.uTime, count, { uSeason: uniforms.uSeason });
    return mesh;
}

// WebGPU/TSL: mid-distance tree LINE (2nd instanced pass). Returns the InstancedMesh.
function createTreeLine(uniforms, count) {
    const { mesh } = createTreeLineTSL(uniforms.uTime, count);
    return mesh;
}

function createReeds(uniforms, count) {
    const { mesh } = createReedsTSL(uniforms.uTime, count);
    return mesh;
}

// WebGPU/TSL: HERO Great Tree (one large merged low-poly tree). Returns the mesh, anchored
// in the builder via getTerrainHeight; the env lifts it by terrainOffsetY like the props.
function createGreatTree(uniforms) {
    const { mesh } = createGreatTreeTSL(uniforms.uTime);
    return mesh;
}

// WebGPU/TSL: falling-leaf billboards — near-tree halo + corridor-wide autumn story.
function createFallingLeaves(uniforms, count, corridorPlacements) {
    const { mesh } = createFallingLeavesTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
        corridorPlacements,
    });
    return mesh;
}

// WebGPU/TSL: tiered cliff waterfall feeding the lake (scrolling emissive ribbons + splash
// pool). Returns the group; uOpacity tagged so the surface fade collector drives it.
function createWaterfall(uniforms) {
    const { group, uniforms: builderUniforms } = createWaterfallTSL(uniforms.uTime);
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: warm-amber pollen motes (instanced billboard quads, radial feather). uOpacity
// is tagged so the surface fade collector drives it like the other surface elements.
function createPollen(uniforms, count) {
    const { mesh, uniforms: builderUniforms } = createPollenTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: drifting low-poly bird silhouettes (animated in update via userData.birds).
// Creative plan asset 8: the first two birds become LOW FAST CROSSERS cutting the
// corridor at height 8–14 — small fast shapes across the travel vector are the
// cheapest "alive" signal the chapter can render.
function createBirds(count) {
    const { group } = createBirdsTSL(count);
    group.children.slice(0, 2).forEach((bird, i) => {
        bird.userData.crosser = true;
        bird.userData.lane = -30 - i * 26;
        bird.userData.height = 8 + i * 5;
        bird.userData.speed = 0.9 + i * 0.3;
    });
    return group;
}

// Spruce stands — second species, evergreen (no autumn recolor).
function createSpruces(uniforms, count) {
    const { mesh } = createSpruceTreesTSL(uniforms.uTime, count);
    return mesh;
}

// Falu-red cabin landmark; uOpacity tagged for the surface fade collectors.
function createCabin(uniforms) {
    const { group, uniforms: builderUniforms } = createCabinTSL(uniforms.uTime);
    return tagUniforms(group, builderUniforms);
}

// Foreground pass-by silhouettes; uOpacity tagged for the surface fade collectors.
function createForegroundLayer(uniforms, placements) {
    const { mesh, uniforms: builderUniforms } = createForegroundPassByTSL(
        uniforms.uTime,
        placements,
    );
    return tagUniforms(mesh, builderUniforms);
}

// Winter snow motes; uOpacity tagged for the surface fade collectors.
function createSnowMotes(uniforms, count) {
    const { mesh, uniforms: builderUniforms } = createSnowMotesTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: visible golden SUN disc + soft halo delegated to createSunDiscTSL (a single
// camera-facing additive billboard, capped below white). Returns the group; uOpacity tagged
// on the group for the surface fade collectors.
function createSunDisc(uniforms) {
    const { group, uniforms: builderUniforms } = createSunDiscTSL(uniforms.uTime, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: additive golden volumetric sun-rays delegated to createSunRaysTSL (its
// builder owns the 5-beam group + bloom-eligible additive material). Returns the group;
// uOpacity tagged on the group for the fade collectors.
function createSunRays(uniforms) {
    const { group, uniforms: builderUniforms } = createSunRaysTSL(uniforms.uTime, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: soft procedural clouds delegated to createCloudsTSL (its builder owns the
// 6-puff group + NormalBlending transparent material). Returns the group; uOpacity tagged
// on the group for the fade collectors.
function createClouds(uniforms) {
    const { group, uniforms: builderUniforms } = createCloudsTSL(uniforms.uTime);
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: 3 distant peaks + base valley mist delegated to createDistantMountainsTSL
// (its builder owns the byte-identical per-mountain cone/FBM bakes, the GPU snow/rock/fog
// shading, and the 4-plane mist). Each peak mesh + the mist meshes are tagged with their
// uSnowBlend/uOpacity nodes so the collectors drive snow + surface fade. The mist group is
// exposed on userData.foothillMist for parity with the live API.
function createDistantMountains(uniforms) {
    const { group, parts, mist } = createDistantMountainsTSL(uniforms.uTime);
    group.name = 'distant-mountains';

    // parts = [leftPeak, centerPeak, rightPeak, mist]. Tag each peak mesh's uniforms.
    parts.forEach((part) => {
        if (part?.mesh) {
            tagUniforms(part.mesh, part.uniforms);
        }
    });

    // Tag the shared mist material's uOpacity onto each mist plane so the fade collector
    // (which traverses children) finds it.
    if (mist?.group && mist.uniforms) {
        mist.group.traverse((child) => {
            if (child.isMesh) tagUniforms(child, mist.uniforms);
        });
    }

    group.userData.foothillMist = mist?.group ?? null;

    return group;
}

// WebGPU/TSL: fluttering sakura petals. The live chapter drew these as THREE.Points
// (PointsMaterial-style sized points), which render as 1px on the WebGPU backend. Rebuilt
// as instanced billboard quads (makeQuadInstancedGeometry + billboardWorld): the falling/
// swaying animation moves each quad's world CENTER on the GPU (same math as the old vertex
// shader, driven off aBase/aRandom/uTime), and a round uv() mask reproduces the old
// gl_PointCoord disc. The pixel gl_PointSize (aSize * 150/-mv.z perspective) becomes a small
// world-space size (perspective is automatic for a world-billboarded quad).
function createPetals(uniforms, count) {
    const bases = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const palette = [
        new THREE.Color(0xffc0cb),
        new THREE.Color(0xffe4e1),
        new THREE.Color(0xffb7c5),
    ];

    for (let i = 0; i < count; i++) {
        bases[i * 3] = (Math.random() - 0.5) * 120;
        bases[i * 3 + 1] = (Math.random() - 0.5) * 80;
        bases[i * 3 + 2] = (Math.random() - 0.5) * 60;

        randoms[i] = Math.random();
        sizes[i] = 1.0 + Math.random();

        const col = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aRandom: { array: randoms, itemSize: 1 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
    });

    const { uTime } = uniforms;
    const uOpacity = uniform(1);

    const aBase = attribute('aBase', 'vec3');
    const aRandom = attribute('aRandom', 'float');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');

    // Animate the petal CENTER — identical math to the old vertex displacement, on aBase.
    const fallSpeed = aRandom.add(2.0);
    const yOffset = tslMod(uTime.mul(fallSpeed).add(aRandom.mul(100.0)), 100.0).sub(50.0);
    let py = aBase.y.sub(yOffset);
    // if (pos.y < -40) pos.y += 80 → step(-40, py) is 1 when py >= -40, so add when it's 0.
    py = py.add(oneMinus(tslStep(-40.0, py)).mul(80.0));
    const px = aBase.x.add(tslSin(uTime.add(aRandom.mul(10.0))).mul(5.0));
    const pz = aBase.z.add(tslCos(uTime.mul(0.7).add(aRandom.mul(5.0))).mul(3.0));
    const center = vec3(px, py, pz);

    // World-space billboard size (replaces the pixel gl_PointSize; perspective is automatic).
    const size = aSize.mul(1.1);
    const positionNode = billboardWorld(center, size);

    // TUMBLING PETAL alpha (creative plan item 4 — no more hard discs/squares): rotate
    // the quad uv over time, then mask a teardrop petal whose width tapers toward the
    // tip, feathered to zero inside the quad edge (sakura petal technique).
    const spin = uTime.mul(aRandom.mul(1.8).add(0.9)).add(aRandom.mul(17.0));
    const ca = tslCos(spin);
    const sa = tslSin(spin);
    const p0 = uv().sub(0.5);
    const pr = tslVec2(p0.x.mul(ca).sub(p0.y.mul(sa)), p0.x.mul(sa).add(p0.y.mul(ca)));
    const widthTaper = tslMax(tslFloat(0.34).mul(oneMinus(pr.y.mul(1.0))), tslFloat(0.08));
    const petalR = tslVec2(pr.x.div(widthTaper), pr.y.div(0.44)).length();
    const petalMask = oneMinus(tslSmoothstep(0.6, 1.0, petalR));

    // Spring's particle story: the petals belong to the breach act and hand off to the
    // summer pollen (one story at a time).
    const springGate = oneMinus(tslSmoothstep(0.24, 0.42, uniforms.uSeason));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    material.opacityNode = petalMask.mul(0.85).mul(springGate).mul(uOpacity);
    material.alphaTest = 0.15;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return tagUniforms(mesh, { uOpacity });
}

function createButterflies(count) {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        side: THREE.DoubleSide,
    });

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {
            speed: 0.5 + Math.random(),
            offset: Math.random() * 100,
        };
        group.add(mesh);
    }
    return group;
}

// NOTE: the foothill valley mist is now built inside createDistantMountainsTSL (the
// .tsl.js builder) — the live createMountainMist GLSL helper was removed in the WebGPU swap.

export function updateSurfaceWorldEnvironment(group, delta, time, camera, cameraProgress = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // Season scalar (creative plan item 6): chapter-local progress 0→1 scripts the
    // spring→autumn→winter arc through light. Drives the in-shader season gates AND the
    // JS-side key-light lerp below.
    if (uniforms?.uSeason && Number.isFinite(cameraProgress)) {
        const tStart = group.userData.chapterTStart ?? 0.25;
        const tEnd = group.userData.chapterTEnd ?? 0.41;
        const span = Math.max(tEnd - tStart, 1e-4);
        uniforms.uSeason.value = THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1);
    }

    // Season-lerped raking key + sky fill (rewritten every frame per the QW4 light-rig
    // rule; colors precomputed at create — zero per-frame allocation). Spring gold
    // #FFCF7A → autumn amber #FFB070 → winter pale #DCE8FF at lower intensity, so
    // autumn frames measure warmer-lit and winter frames cooler-lit (acceptance check).
    const seasonValue = uniforms?.uSeason ? uniforms.uSeason.value : 0;
    const { seasonLight, sunKey } = group.userData;
    if (sunKey && seasonLight) {
        const autumnT = THREE.MathUtils.smoothstep(seasonValue, 0.38, 0.6)
            * (1 - THREE.MathUtils.smoothstep(seasonValue, 0.72, 0.92));
        const winterT = THREE.MathUtils.smoothstep(seasonValue, 0.68, 0.92);
        sunKey.color.copy(seasonLight.springKey)
            .lerp(seasonLight.autumnKey, autumnT)
            .lerp(seasonLight.winterKey, winterT);
        sunKey.intensity = 0.7 + autumnT * 0.05 - winterT * 0.15;
        const { skyFill } = group.userData;
        if (skyFill) {
            skyFill.color.copy(seasonLight.springFill).lerp(seasonLight.winterFill, winterT);
            skyFill.intensity = 0.32 - winterT * 0.06;
        }
    }

    const waterSurfaceY = group.userData.waterSurfaceY || 35;
    const cameraY = camera?.position?.y ?? 100; // Default to above water
    const surfaceProbeY = Number.isFinite(cameraProgress)
        ? getOdysseyPathPointAt(cameraProgress).y
        : cameraY;
    const visibilityState = resolveSurfaceWorldVisibilityState({
        waterSurfaceY,
        surfaceProbeY,
        cameraY,
    });
    const {
        isUnderwater,
        surfaceOpacity,
    } = visibilityState;
    const auroraPreviewState = resolveSurfaceWorldAuroraPreviewState(cameraProgress);
    const alpineRampState = resolveSurfaceWorldAlpineRampState(cameraProgress);
    // SEAM 3->4 recede: 1->0 across the final stretch of Ch3 into the Surface→Mountains seam
    // so the waterfall + distant range fade BEFORE the group hides (no pop), and the distant
    // range cross-dissolves with the rising Mountains peaks rather than swapping shape hard.
    const seamRecedeState = resolveSurfaceWorldSeamRecedeState(cameraProgress);
    const { recedeOpacity } = seamRecedeState;
    // ENTRY RAMP (frames 01–02 slab pop + petal leak fix): every surface element rises
    // into presence across the breach instead of appearing fully formed.
    const { entryOpacity } = resolveSurfaceWorldEntryRampState(cameraProgress);
    const surfaceGate = surfaceOpacity * entryOpacity;
    // The alpine pieces are gated by BOTH the underwater surface fade AND the
    // Surface→Mountains ramp, then receded across the seam so they cross-dissolve out.
    const alpineOpacity = surfaceGate * alpineRampState.rampOpacity * recedeOpacity;

    const { snowTransition } = group.userData;
    const snowBlend = snowTransition
        ? THREE.MathUtils.smoothstep(
            cameraY,
            snowTransition.endY - snowTransition.range,
            snowTransition.endY,
        )
        : 0;

    const snowBlendUniformTargets = group.userData.snowBlendUniformTargets || [];
    snowBlendUniformTargets.forEach((target) => {
        target.value = snowBlend;
    });

    // Toggle visibility of surface-only elements
    const { surfaceElements } = group.userData;

    if (surfaceElements) {
        surfaceElements.forEach((element) => {
            if (element) {
                element.visible = surfaceGate > 0;
            }
        });
    }

    const opacityUniformTargets = group.userData.surfaceOpacityUniformTargets || [];
    opacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * surfaceGate;
    });

    // SEAM 3->4: waterfall recedes (fades) across the seam in addition to the surface fade.
    const waterfallOpacityUniformTargets = group.userData.waterfallOpacityUniformTargets || [];
    waterfallOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * surfaceGate * recedeOpacity;
    });

    // Alpine pieces: toggle on the combined gate + drive their dedicated opacity targets.
    const { alpineElements } = group.userData;
    if (alpineElements) {
        alpineElements.forEach((element) => {
            if (element) {
                element.visible = alpineOpacity > 0;
            }
        });
    }

    const alpineOpacityUniformTargets = group.userData.alpineOpacityUniformTargets || [];
    alpineOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * alpineOpacity;
    });

    const { auroraPreview } = group.userData;
    if (auroraPreview) {
        auroraPreview.visible = surfaceOpacity > 0 && auroraPreviewState.previewVisible;
    }

    const auroraPreviewOpacityUniformTargets = group.userData.auroraPreviewOpacityUniformTargets || [];
    auroraPreviewOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * surfaceGate * auroraPreviewState.previewOpacity;
    });

    const bridge = group.userData.foothillBridge;
    const bridgeMaterial = bridge?.material;
    // WebGPU/TSL: the bridge's uOpacity is a TSL uniform node tagged on userData.odysseyUniforms.
    const bridgeOpacityNode = bridge?.userData?.odysseyUniforms?.uOpacity;
    if (bridgeMaterial && bridgeOpacityNode) {
        const bridgeOpacity = bridgeOpacityNode.value;
        const shouldWriteDepth = bridgeOpacity >= 0.98 && surfaceOpacity >= 0.98;
        if (bridgeMaterial.depthWrite !== shouldWriteDepth) {
            bridgeMaterial.depthWrite = shouldWriteDepth;
            bridgeMaterial.needsUpdate = true;
        }
    }

    // Sky visibility (hide sky sphere when underwater for ocean fade)
    const sky = group.userData.skyElement;
    if (sky) {
        sky.visible = !isUnderwater;
    }

    const { butterflies } = group.userData;
    if (butterflies && !isUnderwater) {
        butterflies.children.forEach((b) => {
            const t = time * b.userData.speed + b.userData.offset;
            b.position.x = Math.sin(t * 0.5) * 30;
            b.position.y = Math.cos(t * 0.3) * 10;
            b.position.z = Math.sin(t * 0.2) * 5 - 20;
            b.rotation.x = Math.sin(t * 10) * 0.5;
            b.rotation.y = Math.atan2(Math.cos(t * 0.5), -Math.sin(t * 0.3));
        });
    }

    // Drifting birds — wide lazy circles overhead with a swept-wing flap (banked into the
    // turn). The geometry is a swept-wing silhouette whose tips carry Y extent, so beating
    // scale.y actually flaps the wings up/down. Only when above water and visible.
    const { birds } = group.userData;
    if (birds && !isUnderwater) {
        birds.children.forEach((bird) => {
            const ud = bird.userData;
            // LOW FAST CROSSERS (creative plan asset 8): straight passes across the
            // corridor at height 8–14, wrapping — motion aimed across the travel vector.
            if (ud.crosser) {
                const span = 240;
                const tx = ((time * ud.speed * 40 + ud.offset * 60) % span) - span / 2;
                bird.position.set(tx, ud.height + Math.sin(time * 2 + ud.offset) * 1.5, ud.lane);
                const crossFlap = 0.6 + Math.abs(Math.sin(time * (ud.flap + 2))) * 0.8;
                bird.scale.set(1.25, 1.25 * crossFlap, 1.25);
                bird.rotation.y = Math.PI / 2;
                bird.rotation.z = 0;
                return;
            }
            const t = time * ud.speed + ud.offset;
            bird.position.set(
                Math.cos(t) * ud.radius,
                ud.height + Math.sin(t * 1.7) * 4,
                Math.sin(t) * ud.radius - 30,
            );
            // Flap: oscillate scale.y so the swept wing tips beat; bank + face the heading.
            const flap = 0.7 + Math.abs(Math.sin(time * ud.flap)) * 0.7;
            bird.scale.set(1.6, 1.6 * flap, 1.6);
            bird.rotation.y = -t + Math.PI / 2;
            bird.rotation.z = Math.sin(t) * 0.28;
        });
    }
}

export default {
    config: SURFACE_WORLD_CONFIG,
    create: createSurfaceWorldEnvironment,
    update: updateSurfaceWorldEnvironment,
};

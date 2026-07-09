/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Mountain Peaks Environment - Chapter 4 Visual Theme
 *
 * Enhanced Version:
 * - High-quality FBM Displacement Mountains (Sakura-style)
 * - Shader-based 3D Aurora Borealis (Aurora-theme style)
 * - Smooth Spherical Background
 * - Falling Snow Particles
 *
 * WebGPU/TSL: the three GLSL ShaderMaterials (sky-sphere, FBM peaks, foothills) are now
 * built by the validated TSL NodeMaterial builders in ./mountain-peaks.tsl.js, and the
 * canvas-texture THREE.Points (stars + falling snow) are drawn as instanced billboard
 * quads (THREE.Points renders 1px on WebGPURenderer). The aurora backdrop stays in its
 * shared helper. The public API (exports, group.userData fields, update signature) is
 * unchanged.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    float,
    length,
    mix,
    mod,
    normalWorld,
    oneMinus,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathPointAt,
} from '../path-utils.js';
import { createMountainAuroraBackdrop } from './shared/mountain-aurora.js';
import {
    createCanonicalMountainRangeTSL,
    getCanonicalMountainRangeWorldSpecs,
} from './shared/canonical-mountain-range.js';
import {
    createMountainSkyTSL,
    createFBMMountainTSL,
    createSnowFloorTSL,
    createCloudSeaDeckTSL,
    createMountainSunTSL,
    buildMountainGeometry,
} from './mountain-peaks.tsl.js';
import {
    billboardWorld,
    makeQuadInstancedGeometry,
} from './shared/odyssey-tsl-billboard.js';
import {
    MOUNTAIN_SHADING,
    resolveMountainTreatment,
} from './shared/mountain-language.js';
import { createSnowConiferBelt } from './shared/snow-conifer-belt.js';

// Ch4-side tree-line (3→4 seam continuity): the snow-conifer belt was designed to bridge the
// seam ("both Ch3 and Ch4 seed conifers" — snow-conifer-belt.js), and Ch3 even comments that
// "the Ch4 side seeds its own conifers on its lower slopes", but Ch4 never did — so the Ch3
// forest stopped DEAD at the boundary and the peaks were bare. Seed a low belt on the near
// snow-floor apron that climbs toward the peaks and thins to bare snow at the tree line, so the
// forest carries across the seam. Placed on the flat snow-floor plane (floorY); the central
// corridor is kept clear for the camera path.
function buildCh4SeamConiferPlacements(floorY) {
    const out = { spruce: [], pine: [], fir: [] };
    let placed = 0;
    let guard = 0;
    while (placed < 80 && guard < 80 * 16) {
        guard += 1;
        const x = (Math.random() - 0.5) * 720;
        const z = -100 - Math.random() * 560; // near the seam (-100) → toward the peaks (-660)
        if (Math.abs(x) < 60) continue; // clear central corridor for the path
        const climb = Math.min(1, Math.max(0, (-z - 100) / 560)); // 0 near seam → 1 toward peaks
        if (climb > 0.72) continue; // tree line ends → bare snow toward the peaks
        if (Math.random() > (1 - climb * 0.8)) continue; // thin toward the line
        let species = 'fir';
        if (climb < 0.4) species = 'spruce';
        else if (climb < 0.65) species = 'pine';
        const scale = (0.7 + Math.random() * 0.6) * (1 - climb * 0.35);
        out[species].push({
            x, y: floorY + 1, z, scale, rotationY: Math.random() * Math.PI * 2,
        });
        placed += 1;
    }
    return out;
}

/**
 * Mountain Peaks environment configuration
 */
export const MOUNTAIN_PEAKS_CONFIG = {
    id: 4,
    name: 'mountain-peaks',
    yStart: 97.5,
    yEnd: 900,
    transitionZone: 0.1, // Increased transition zone for smoother fade out
    colors: {
        primary: 0x2d3436,
        secondary: 0x636e72,
        tertiary: 0xaaffdd, // Aurora green
        accent: 0x74b9ff,
        background: 0x090a0f,
    },
};

const MOUNTAIN_TRANSITION_START = 0.08;
const MOUNTAIN_TRANSITION_END = 0.28;
// SEAM 4->5: the Chapter 4 hero mountain chain is a locked world landmark and Chapter 5
// inherits the exact same chain. Only auxiliary Ch4 summit props fade across the exit.
const MOUNTAIN_SEAM_EXIT_BAND = 0.34; // fraction of Ch4 local progress for prop/atmosphere fade
const MOUNTAIN_ENTRY_BAND = 0.2; // fraction of Ch3 span before the boundary for hero peak fade-in

function smoothstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}
// ONE mountain language (shared/mountain-language.js): heroes ride the cool pole, the
// lower foothill apron pulls toward neutral grey-blue with a higher snow line. The TSL
// builder resolves the canonical palette; here we only forward the per-instance base
// mist/fade so each peak's feet recede correctly.
const FOOTHILL_APRON_TREATMENT = resolveMountainTreatment({
    coolTemp: 0.72,
    snowLine: MOUNTAIN_SHADING.snowLineFoothill,
});
const FOOTHILL_APRON_BASE = Object.freeze({
    baseMistStrength: 0.18, baseFadeStart: 0.08, baseFadeEnd: 0.22,
});

export function resolveMountainPeaksEntryState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { entryOpacity: 1 };
    }

    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 0.352;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { entryOpacity: 1 };
    }

    const span = ch4Start - ch3Start;
    const entryStart = ch4Start - span * MOUNTAIN_ENTRY_BAND;
    const entryOpacity = THREE.MathUtils.smoothstep(progress, entryStart, ch4Start);

    return { entryOpacity };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mark a TSL uniform node (or {value} uniform) as a transition target the update loop ticks.
 */
function pushTransitionTarget(targets, node) {
    if (node) targets.push(node);
}

/**
 * Mark a TSL uniform node as an opacity target, capturing its base value so the update loop
 * can restore it (mirrors the legacy collectUniformTargets / __odysseyBaseOpacity behaviour).
 */
function pushOpacityTarget(targets, node) {
    if (!node) return;
    if (node.__odysseyBaseOpacity === undefined) {
        node.__odysseyBaseOpacity = node.value;
    }
    targets.push(node);
}

export function createMountainPeaksEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'mountain-peaks-environment';
    group.userData.chapterId = 4;
    group.userData.yStart = MOUNTAIN_PEAKS_CONFIG.yStart;
    group.userData.yEnd = MOUNTAIN_PEAKS_CONFIG.yEnd;

    const uniforms = { uTime: { value: 0 } };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(4);
    const fallbackCenterY = (MOUNTAIN_PEAKS_CONFIG.yStart + MOUNTAIN_PEAKS_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        // Use the MAX of logical end and config end to allow visual extension into next chapter
        group.userData.yEnd = Math.max(chapterRange.end.y, MOUNTAIN_PEAKS_CONFIG.yEnd);
    }
    const progressWindow = getMountainChapterProgressWindow();
    group.userData.progressStart = progressWindow.start;
    group.userData.progressEnd = progressWindow.end;

    // Shared TSL transition uniform — drives sky + all peak/foothill materials.
    const uTransition = uniform(0);
    // Shared TSL time uniform for the cloud-sea billow (also reused by the sun ray fan).
    const uTimeNode = uniform(0);
    // Shared climax uniform — peaks at chapter end to ignite the hero summit + sun ray fan.
    const uSummitGlow = uniform(0);
    group.userData.summitGlowUniform = uSummitGlow;
    group.userData.cloudSeaTimeUniform = uTimeNode;
    const transitionTargets = [];
    const opacityTargets = [];
    const mainPeakOpacityTargets = [];

    // 1. High Quality Sky Sphere (Boxiness fix)
    const sky = createSkyBackground(uTransition);
    group.add(sky);
    group.userData.sky = sky;
    pushTransitionTarget(transitionTargets, sky.userData?.tslUniforms?.uTransition);

    // 2. FBM foothills + mountains (aligned to Chapter 3 distant terrain)
    const massif = new THREE.Group();
    massif.name = 'mountain-massif';

    const chapter4StartY = chapterRange?.start.y ?? chapterCenterY;
    const foothillBaseY = (chapter4StartY - chapterCenterY) - 74;

    // Cloud-SEA deck just below the lane — the silver sea the camera breaks UP through, and
    // the abyssal floor that sells altitude every frame (plan ch4 §Composition).
    const cloudSea = createCloudSeaDeckTSL({
        uTime: uTimeNode,
        uTransition,
        y: foothillBaseY + 20,
    });
    massif.add(cloudSea.mesh);
    group.userData.cloudSea = cloudSea.mesh;

    const foothillApron = createFoothillApron(uTransition, foothillBaseY, opacityTargets);
    massif.add(foothillApron);
    group.userData.foothillApron = foothillApron;

    // Smooth snow-ground BASEPLATE (3→4 review fix): a 3000-radius radially-feathered snow
    // disc sitting just under the foothill/peak feet, so the chapter base reads as continuous
    // snow instead of the cloud-sea rim + bare FBM plane edges. This builder was authored +
    // validated in the pilot but was never added to the LIVE scene — the "square baseplate /
    // not smooth at the bottom" the user reported. Shares the ticked uTimeNode for its sparkle.
    const snowFloorY = foothillBaseY - 45;
    const snowFloor = createSnowFloorTSL(uTimeNode, snowFloorY);
    massif.add(snowFloor.group);
    group.userData.snowFloor = snowFloor.mesh;

    // Ch4 tree-line continuity across the 3→4 seam (see buildCh4SeamConiferPlacements above):
    // a low winter conifer belt on the near snow-floor slopes so the Ch3 forest carries into
    // the mountains and thins to bare snow, instead of stopping dead at the boundary.
    const ch4Conifers = createSnowConiferBelt({
        uSnowBlend: uniform(1), // winter throughout
        placementsBySpecies: buildCh4SeamConiferPlacements(snowFloorY),
    });
    ch4Conifers.name = 'snow-conifer-belt-ch4';
    massif.add(ch4Conifers);
    group.userData.ch4Conifers = ch4Conifers;

    const heroSpec = getCanonicalMountainRangeWorldSpecs()
        .find((spec) => spec.id === 'ch4-center-hero');
    const heroCrownLocalY = heroSpec
        ? (heroSpec.worldPosition.y - chapterCenterY) + heroSpec.height * 0.96
        : 660;
    const { group: mountains, parts: mainPeakParts } = createCanonicalMountainRangeTSL({
        hostCenter: chapterRange?.center,
        hostChapterId: 4,
        name: 'main-peaks',
        uTransition,
        summitGlow: uSummitGlow,
        opacityTargets: mainPeakOpacityTargets,
    });
    // SNOW PARITY (3→4 seam): this is the SAME canonical chain the Ch3 distant preview shows,
    // and that preview is driven to full winter snow by the end of Ch3 (snowBlend→1). Ch4 left
    // its copy at uSnowBlend 0 (a higher snow line / more bare rock), so the shared silhouette
    // visibly LOST snow across the handoff. Ch4 is winter throughout, so pin the hero peaks to
    // full snow to match the preview at the seam. (uSnowBlend is otherwise not driven in Ch4.)
    mainPeakParts.forEach((part) => {
        if (part.uniforms?.uSnowBlend) part.uniforms.uSnowBlend.value = 1;
    });
    group.userData.foregroundRidge = null;

    massif.add(mountains);

    // On-screen SUN disc + bloom-halo + ray fan along lightDir (controlled bloom, NOT the
    // old white node blowout). The ray fan widens as uSummitGlow peaks at the climax.
    const sun = createMountainSunTSL({ uTransition, summitGlow: uSummitGlow });
    massif.add(sun.group);
    group.userData.sun = sun.group;

    group.add(massif);
    group.userData.mountains = massif;
    group.userData.mainPeaks = mountains;
    group.userData.mainPeakOpacityUniformTargets = mainPeakOpacityTargets;
    // SEAM 4->5: record the authored base Y and keep the hero chain pinned there. Chapter 5
    // renders the same world-positioned chain, so the handoff is a landmark continuity beat.
    mountains.userData.seamBaseY = mountains.position.y;

    // 2c. SUMMIT BANNER PLUME (creative plan asset 2): a wind-shed streamer ribbon off
    // the hero summit's lee side — the single best "danger + wind + altitude" signal —
    // backlit rose by uSummitGlow at the climax.
    const plume = createBannerPlume(uTimeNode, uSummitGlow, heroCrownLocalY, opacityTargets);
    massif.add(plume);
    group.userData.bannerPlume = plume;

    // 2d. Prayer-flag line + cairns + summit cross (creative plan assets 3–4): the
    // chapter's human-scale and cultural focal cues, placed from the live spline.
    const groupCenterForProps = chapterRange?.center
        ? { x: chapterRange.center.x, y: chapterCenterY, z: chapterRange.center.z }
        : { x: 0, y: chapterCenterY, z: 0 };
    const flagLine = createPrayerFlagLine(uTimeNode, groupCenterForProps, opacityTargets);
    group.add(flagLine);
    group.userData.prayerFlags = flagLine;
    const waymarks = createCairnsAndCross(groupCenterForProps, heroCrownLocalY, opacityTargets);
    group.add(waymarks);
    group.userData.waymarks = waymarks;

    // 2e. EAGLES (creative plan asset 5): two-three soaring raptors crossing the lane —
    // the held middle composition's motion accent. Animated in update (no allocation).
    const eagles = createEagles(3);
    group.add(eagles);
    group.userData.eagles = eagles;

    // 3. Shader Aurora Curtains
    // Authored here so Chapter 5 can inherit the same curtain language, but kept invisible
    // until late Chapter 4; otherwise the 3→4 handoff reads as a square aurora card.
    const aurora = createMountainAuroraBackdrop(uniforms, {
        name: 'mountain-aurora',
        layerOpacities: [1.0, 0.95, 0.95, 0.7],
    });
    aurora.visible = false;
    group.add(aurora);
    group.userData.aurora = aurora;
    group.userData.mountainTransitionUniformTargets = transitionTargets;
    group.userData.mountainOpacityUniformTargets = opacityTargets;
    group.userData.auroraFadeUniformTargets = collectUniformTargets(aurora, 'uAuroraFade');
    group.userData.auroraOpacityUniformTargets = collectUniformTargets(aurora, 'uOpacity');

    // 4. Falling Snow
    const snow = createSnow(uniforms, options.particleCount || 700);
    group.add(snow);
    group.userData.snow = snow;
    // Snow drift is now uTime-driven in the TSL material (perf §5.3); the update loop ticks
    // this node instead of rewriting + re-uploading the InstancedBufferAttribute each frame.
    group.userData.snowTimeUniform = snow.userData.snowTimeUniform;

    // (Stars REMOVED per the creative plan: Chapter 4 is a banded stratospheric dusk and
    // Chapter 5 opens starless — stars are Chapter 6's identity. The old 1000-star shell
    // was part of the washed lilac read and leaked "space" into the alpine act.)

    // Lighting — lower, cooler ambient so shadowed faces stay deep blue (more contrast),
    // and a brighter, crisper moon key so snow caps pop as bright silhouettes.
    const ambient = new THREE.AmbientLight(0x2b3a52, 0.3);
    group.add(ambient);

    const moonLight = new THREE.DirectionalLight(0xcfe6ff, 0.72);
    moonLight.position.set(50, 100, 50);
    group.add(moonLight);

    // Faint warm rim fill from the alpenglow side to echo the rose on the peak tops
    // without flattening the overall cool key.
    const alpenFill = new THREE.DirectionalLight(0xffb59a, 0.18);
    alpenFill.position.set(-60, 40, 30);
    group.add(alpenFill);

    // Anchor the whole massif to the path's FULL center (x,y,z), not just Y. The ch4
    // path swings out to ~x=-200,z=-350; with the group left at world XZ origin the huge
    // FBM peaks (centered around local z=-650, ~800 wide) enveloped the path — the camera
    // flew "straight through the mountain". Centering the group on the path puts the path
    // at the massif's local origin, in front of the peaks (which now frame it from behind).
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    return group;
}

/**
 * Collect the legacy {value} uniforms named `uniformName` from any remaining raw
 * ShaderMaterials (the aurora backdrop shared helper). Kept for the aurora fade/opacity
 * targets; the peak/sky materials are TSL and tracked explicitly during creation.
 */
function collectUniformTargets(root, uniformName) {
    if (!root) return [];

    const targets = [];
    const seen = new Set();

    const collectFromMaterial = (material) => {
        const uniform2 = material?.uniforms?.[uniformName];
        if (!uniform2 || seen.has(uniform2)) return;
        if (typeof uniform2.value !== 'number') return;

        if (uniform2.__odysseyBaseOpacity === undefined && uniformName === 'uOpacity') {
            uniform2.__odysseyBaseOpacity = uniform2.value;
        }

        seen.add(uniform2);
        targets.push(uniform2);
    };

    root.traverse((child) => {
        if (!child.material) return;
        if (Array.isArray(child.material)) {
            child.material.forEach(collectFromMaterial);
        } else {
            collectFromMaterial(child.material);
        }
    });

    return targets;
}

function createSkyBackground(uTransition) {
    // TSL graded sky-sphere (radius 6000, BackSide) from mountain-peaks.tsl.js.
    const { mesh, uniforms: skyUniforms } = createMountainSkyTSL(uTransition);
    mesh.userData.tslUniforms = skyUniforms;
    return mesh;
}

/**
 * SUMMIT BANNER PLUME (creative plan asset 2): instanced billboard streamers shedding
 * off the hero summit's lee (right) side like Everest's banner cloud — a constantly
 * streaming white plume that backlights rose (#F59478 family) as uSummitGlow climaxes.
 */
function createBannerPlume(uTimeNode, uSummitGlow, crownLocalY, opacityTargets) {
    const count = 18;
    const along = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        along[i] = i / (count - 1);
        seeds[i] = Math.random();
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aAlong: { array: along, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const uOpacity = uniform(1);
    const aAlong = attribute('aAlong', 'float');
    const aSeed = attribute('aSeed', 'float');

    // Streamer path: shed from the crown, stretching +x (lee side) and sagging slightly
    // as it dissipates, with a slow billow so the plume visibly streams.
    const billow = sin(uTimeNode.mul(1.3).add(aAlong.mul(9.0)).add(aSeed.mul(6.0)));
    const px = aAlong.mul(95.0).add(12.0).add(billow.mul(4.0));
    const py = float(crownLocalY).add(billow.mul(3.0)).sub(aAlong.mul(16.0)).add(aSeed.mul(6.0));
    const pz = float(-680.0).add(aSeed.sub(0.5).mul(26.0));
    const sizeNode = aAlong.mul(13.0).add(6.0);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(vec3(px, py, pz), sizeNode);

    const r = uv().sub(0.5).length().mul(2.0);
    const puff = pow(clamp(oneMinus(r), 0.0, 1.0), 1.6);
    // White spindrift cloud, backlit rose at the climax (capped — controlled bloom only
    // on the summit ignite itself, never the plume).
    const plumeColor = mix(vec3(0.9, 0.94, 0.99), vec3(0.96, 0.62, 0.49), uSummitGlow.mul(0.7));
    material.colorNode = plumeColor;
    material.opacityNode = puff
        .mul(oneMinus(aAlong.mul(0.85)))
        .mul(0.34)
        .mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'summit-banner-plume';
    mesh.frustumCulled = false;
    pushOpacityTarget(opacityTargets, uOpacity);
    return mesh;
}

/**
 * PRAYER-FLAG LINE (creative plan asset 3): one catenary cord crossing the lane at
 * ~two-thirds chapter progress, strung with sun-bleached lung-ta flags in the
 * traditional five-color order, vertex-rippled by the shared wind.
 */
function createPrayerFlagLine(uTimeNode, groupCenter, opacityTargets) {
    const flagGroup = new THREE.Group();
    flagGroup.name = 'prayer-flag-line';
    const positions = getActiveOdysseyChapterPositions();
    const tA = positions?.[3];
    const tB = positions?.[4];
    if (!Number.isFinite(tA) || !Number.isFinite(tB)) return flagGroup;

    const p0 = getOdysseyPathPointAt(THREE.MathUtils.lerp(tA, tB, 0.66));
    const p1 = getOdysseyPathPointAt(THREE.MathUtils.lerp(tA, tB, 0.7));
    const dirX = p1.x - p0.x;
    const dirZ = p1.z - p0.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const rightX = -dirZ / len;
    const rightZ = dirX / len;
    const baseY = (p0.y - groupCenter.y) + 5.2;
    const ax = (p0.x - groupCenter.x) + rightX * 11;
    const az = (p0.z - groupCenter.z) + rightZ * 11;
    const bx = (p0.x - groupCenter.x) - rightX * 11;
    const bz = (p0.z - groupCenter.z) - rightZ * 11;

    // Catenary cord (sagging line) across the lane, slightly above the rail.
    const cordPoints = [];
    for (let i = 0; i <= 8; i += 1) {
        const t = i / 8;
        cordPoints.push(new THREE.Vector3(
            THREE.MathUtils.lerp(ax, bx, t),
            baseY - Math.sin(t * Math.PI) * 2.4,
            THREE.MathUtils.lerp(az, bz, t),
        ));
    }
    const curve = new THREE.CatmullRomCurve3(cordPoints);
    const uOpacity = uniform(1);
    const cordMaterial = new THREE.MeshBasicNodeMaterial();
    cordMaterial.colorNode = vec3(0.07, 0.07, 0.09);
    cordMaterial.opacityNode = uOpacity;
    cordMaterial.transparent = true;
    flagGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.06, 5, false), cordMaterial));

    // Flags: lung-ta order (blue/white/red/green/yellow), desaturated ~30% so they read
    // sun-bleached and authentic — the chapter's only saturation besides alpenglow.
    const flagCount = 16;
    const bleach = new THREE.Color(0x9a948c);
    const lungTa = [0x2e5fa3, 0xf5f0e6, 0xc0392b, 0x2e7d4f, 0xe3b428]
        .map((hex) => new THREE.Color(hex).lerp(bleach, 0.3));
    const flagColors = new Float32Array(flagCount * 3);
    for (let i = 0; i < flagCount; i += 1) {
        const c = lungTa[i % lungTa.length];
        flagColors[i * 3] = c.r;
        flagColors[i * 3 + 1] = c.g;
        flagColors[i * 3 + 2] = c.b;
    }
    const flagGeometry = new THREE.PlaneGeometry(1.5, 1.05);
    flagGeometry.translate(0.75, -0.52, 0); // hang from the cord-attached edge
    flagGeometry.setAttribute('aFlag', new THREE.InstancedBufferAttribute(flagColors, 3));

    const flagMaterial = new THREE.MeshBasicNodeMaterial();
    // Free edge ripples in the shared wind; the attached edge stays pinned.
    const ripple = sin(uTimeNode.mul(2.8).add(positionWorld.x.mul(1.7)))
        .mul(0.24)
        .mul(uv().x);
    flagMaterial.positionNode = positionLocal.add(vec3(0.0, 0.0, ripple));
    flagMaterial.colorNode = attribute('aFlag', 'vec3').mul(uv().y.mul(0.25).add(0.75));
    flagMaterial.opacityNode = uOpacity;
    flagMaterial.transparent = true;
    flagMaterial.side = THREE.DoubleSide;

    const flags = new THREE.InstancedMesh(flagGeometry, flagMaterial, flagCount);
    const dummy = new THREE.Object3D();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3();
    for (let i = 0; i < flagCount; i += 1) {
        const t = (i + 0.5) / flagCount;
        curve.getPointAt(t, dummy.position);
        curve.getTangentAt(t, tangent);
        dummy.quaternion.setFromUnitVectors(xAxis, tangent);
        dummy.updateMatrix();
        flags.setMatrixAt(i, dummy.matrix);
    }
    flags.instanceMatrix.needsUpdate = true;
    flagGroup.add(flags);

    pushOpacityTarget(opacityTargets, uOpacity);
    flagGroup.traverse((child) => { child.frustumCulled = false; });
    return flagGroup;
}

/**
 * CAIRNS + SUMMIT CROSS (creative plan asset 4): stacked-stone waypoints within ~15
 * units of the rail at the chapter's first and last thirds, and a Gipfelkreuz
 * silhouette on the hero summit crown — the destination that resolves at the climax.
 */
function createCairnsAndCross(groupCenter, crownLocalY, opacityTargets) {
    const group = new THREE.Group();
    group.name = 'alpine-waymarks';
    const uOpacity = uniform(1);

    // Dark stacked stone with snow dusting on up-faces; silhouette-first.
    const stoneMaterial = new THREE.MeshBasicNodeMaterial();
    const snowDust = pow(clamp(normalWorld.y, 0.0, 1.0), 2.0).mul(0.8);
    stoneMaterial.colorNode = mix(vec3(0.07, 0.11, 0.17), vec3(0.86, 0.9, 0.96), snowDust);
    stoneMaterial.opacityNode = uOpacity;
    stoneMaterial.transparent = true;
    stoneMaterial.side = THREE.FrontSide;

    const buildCairn = (scale) => {
        const stones = [];
        const tiers = [1.6, 1.25, 0.95, 0.65, 0.4];
        let y = 0;
        tiers.forEach((r) => {
            const stone = new THREE.IcosahedronGeometry(r * scale, 0);
            stone.scale(1, 0.62, 1);
            y += r * scale * 0.66;
            stone.translate((Math.random() - 0.5) * 0.2 * scale, y, (Math.random() - 0.5) * 0.2 * scale);
            y += r * scale * 0.45;
            stones.push(stone);
        });
        const merged = mergeGeometries(stones, false);
        stones.forEach((s) => s.dispose());
        return merged;
    };

    const positions = getActiveOdysseyChapterPositions();
    const tA = positions?.[3];
    const tB = positions?.[4];
    if (Number.isFinite(tA) && Number.isFinite(tB)) {
        [
            { ft: 0.18, side: 9 },
            { ft: 0.78, side: -12 },
        ].forEach(({ ft, side }) => {
            const pt = getOdysseyPathPointAt(THREE.MathUtils.lerp(tA, tB, ft));
            const cairn = new THREE.Mesh(buildCairn(1.0), stoneMaterial);
            cairn.position.set(
                (pt.x - groupCenter.x) + side,
                (pt.y - groupCenter.y) - 2.4,
                (pt.z - groupCenter.z) - 4,
            );
            group.add(cairn);
        });
    }

    // Gipfelkreuz on the hero crown: mythic-scale thin cross so the silhouette resolves
    // against the sky at the summit-ignite climax (z -680 needs real size to read).
    const post = new THREE.BoxGeometry(1.2, 30, 1.2);
    post.translate(0, 15, 0);
    const arm = new THREE.BoxGeometry(11, 1.2, 1.2);
    arm.translate(0, 22, 0);
    const crossGeometry = mergeGeometries([post, arm], false);
    post.dispose();
    arm.dispose();
    const cross = new THREE.Mesh(crossGeometry, stoneMaterial);
    cross.position.set(0, crownLocalY - 6, -680);
    group.add(cross);

    pushOpacityTarget(opacityTargets, uOpacity);
    group.traverse((child) => { child.frustumCulled = false; });
    return group;
}

/**
 * EAGLES (creative plan asset 5): two-three soaring raptors — slotted-wingtip
 * silhouettes wheeling across the lane every few seconds. Animated in update().
 */
function createEagles(count = 3) {
    const group = new THREE.Group();
    group.name = 'mountain-eagles';

    const wingGeo = new THREE.BufferGeometry();
    const s = 2.4;
    const verts = new Float32Array([
        0.0, -0.05, -1.1, 0.0, 0.02, 1.3, -0.2, 0.08, 0.12,
        -0.12, 0.05, 0.16, -2.5, 0.5, -0.12, -0.4, -0.04, -0.38,
        0.12, 0.05, 0.16, 0.4, -0.04, -0.38, 2.5, 0.5, -0.12,
    ]);
    for (let i = 0; i < verts.length; i += 1) verts[i] *= s;
    wingGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    wingGeo.computeVertexNormals();

    const material = new THREE.MeshBasicNodeMaterial();
    // Near-black raptor silhouette (#0D0B09) with faintly sun-warmed wingtips.
    const tipWarm = smoothstep(2.5, 5.5, length(vec2(positionLocal.x, positionLocal.z)));
    material.colorNode = mix(vec3(0.051, 0.043, 0.035), vec3(0.32, 0.2, 0.12), tipWarm.mul(0.6));
    material.side = THREE.DoubleSide;

    for (let i = 0; i < count; i += 1) {
        const eagle = new THREE.Mesh(wingGeo, material);
        eagle.userData = {
            speed: 0.12 + Math.random() * 0.18,
            radius: 60 + Math.random() * 90,
            height: 26 + Math.random() * 46,
            offset: Math.random() * Math.PI * 2,
            flap: 1.6 + Math.random() * 1.4, // soaring: slow, occasional beats
            lane: -260 - Math.random() * 220,
        };
        group.add(eagle);
    }
    group.traverse((child) => { child.frustumCulled = false; });
    return group;
}

/**
 * Creates a mountain using PlaneGeometry and heightmap displacement
 * (Adapted from SakuraTwilightTheme). Backed by the validated TSL builder; the
 * accumulated opacityTargets array receives this peak's opacity uniform so the
 * update loop can restore it like the legacy collectUniformTargets did.
 */
function createFBMMountain(uTransition, config, opacityTargets) {
    const { mesh, uniforms: peakUniforms } = createFBMMountainTSL({
        ...config,
        transition: uTransition,
    });
    if (opacityTargets) pushOpacityTarget(opacityTargets, peakUniforms.uOpacity);
    mesh.userData.tslUniforms = peakUniforms;
    return mesh;
}

function createFoothillApron(uTransition, baseY, opacityTargets) {
    const group = new THREE.Group();
    group.name = 'foothill-apron';

    // PERF (zero-visual material share): all three foothills are built from the foothill
    // builder with IDENTICAL material args — same FOOTHILL_APRON_TREATMENT, same
    // FOOTHILL_APRON_BASE, same shared uTransition node, isHero:false (no summitGlow / no
    // sun ignite). Their per-mesh difference is ONLY geometry (each peak is a distinct
    // size/height/seed CPU bake) and transform (position). update() never mutates a
    // foothill material per-instance: the only foothill uniform the loop touches is
    // uOpacity, and it writes the SAME `baseOpacity * seamFade` to every entry in
    // mountainOpacityUniformTargets — so a shared material's single uOpacity is ticked
    // identically. We therefore build ONE shared foothill material (peak 1) and reuse it
    // for the geometrically-distinct sibling at x=+330 (its baked geometry is built on its
    // own), collapsing 3 foothill pipelines toward 2. The center (size 1250) foothill is
    // kept as its own material so the chapter keeps a second, independent foothill opacity
    // target (the seam-fade invariant the environment test guards).
    const sharedFoothillConfig = {
        size: 1100,
        height: 72,
        position: new THREE.Vector3(-330, baseY - 12, -600),
        seed: 21.17,
    };
    const { mesh: sharedFoothill, uniforms: sharedFoothillUniforms } = createFBMMountainTSL({
        ...sharedFoothillConfig,
        treatment: FOOTHILL_APRON_TREATMENT,
        base: FOOTHILL_APRON_BASE,
        transition: uTransition,
        isHero: false,
    });
    pushOpacityTarget(opacityTargets, sharedFoothillUniforms.uOpacity);
    sharedFoothill.userData.tslUniforms = sharedFoothillUniforms;
    sharedFoothill.renderOrder = -2;
    group.add(sharedFoothill);

    // Sibling foothill: REUSES the shared material above (identical builder args) with its
    // own distinct CPU-baked geometry + transform. No new pipeline, no new opacity target.
    const siblingGeometry = buildMountainGeometry({ size: 1100, height: 78, seed: 58.42 });
    const siblingFoothill = new THREE.Mesh(siblingGeometry, sharedFoothill.material);
    siblingFoothill.position.set(330, baseY - 10, -710);
    siblingFoothill.renderOrder = -2;
    group.add(siblingFoothill);

    // Center foothill: its own material (keeps a second foothill opacity target alive).
    const centerFoothill = createFBMMountain(uTransition, {
        size: 1250,
        height: 92,
        position: new THREE.Vector3(30, baseY - 20, -860),
        seed: 33.71,
        treatment: FOOTHILL_APRON_TREATMENT,
        base: FOOTHILL_APRON_BASE,
        isHero: false,
    }, opacityTargets);
    centerFoothill.renderOrder = -2;
    group.add(centerFoothill);

    return group;
}

/**
 * Creates a soft, muted snowy terrain
 * Positioned to match Chapter 3 ground level for seamless transition
 * Uses softer colors to prevent glowing/brightness issues
 */
export function createSnowFloor(uniforms, offsetY = -123.75) {
    // Delegate to the validated TSL snow-floor builder (radial circle, sparkle, edge fade).
    // The builder needs a TSL uniform node; a legacy { value } object has no node methods,
    // so bridge to a fresh TSL time uniform when a non-node is supplied.
    const uTime = uniforms?.uTime?.isNode ? uniforms.uTime : uniform(0);
    const { group } = createSnowFloorTSL(uTime, offsetY);
    return group;
}

// Falling-snow wrap window (perf §5.3): the original CPU loop reset y from <-10 back to
// 100 — a 110-unit fall span. The TSL drift mods over the same [-10, 100) window so the
// loop point and density are visually identical, just computed on the GPU from uTime.
const SNOW_Y_SPAN = 110;
const SNOW_Y_MIN = -10;

function createSnow(uniforms, count) {
    const positions = new Float32Array(count * 3);
    // Per-flake fall speed + a gentle horizontal sway phase/amplitude. Replaces the old
    // per-flake {x,y,z} velocity objects + the per-frame CPU integration; the shader now
    // derives each flake's position from uTime so the attribute array is never re-uploaded.
    const fallSpeed = new Float32Array(count);
    const sway = new Float32Array(count * 2); // (phase, ampX|ampZ packed via phase reuse)

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = Math.random() * 100;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
        // Original fall velocity was -0.1 .. -0.3 units/frame @ ~60fps ≈ 6..18 units/sec.
        fallSpeed[i] = 6 + Math.random() * 12;
        sway[i * 2] = Math.random() * Math.PI * 2; // sway phase
        sway[i * 2 + 1] = 0.5 + Math.random() * 1.5; // sway amplitude (world units)
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aFall: { array: fallSpeed, itemSize: 1 },
        aSway: { array: sway, itemSize: 2 },
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;

    // SPINDRIFT (creative plan asset 1 — "snow lacks presence"): the field is rebuilt as
    // wind-SHEARED streaks, not dots. One persistent wind vector (left-to-right, slightly
    // downhill) owns the motion: every flake travels with the wind (wrapped) while it
    // falls, speed and streak length scale with ALTITUDE (high motes whip jet-stream
    // fast, low motes drift), and a slow gust pulse breathes through the sway. All from
    // uTime on the GPU — zero per-frame CPU, no attribute re-upload (perf §5.3 holds).
    const uTime = uniform(0);
    const aBase = attribute('aBase', 'vec3');
    const aFall = attribute('aFall', 'float');
    const aSway = attribute('aSway', 'vec2');

    const altitudeT = clamp(aBase.y.add(10.0).div(110.0), 0.0, 1.0);
    const windSpeed = altitudeT.mul(26.0).add(8.0);

    // y: fall + wrap into [-10, 100). mod() returns [0, span); shift back to the window.
    const fallen = aBase.y.sub(SNOW_Y_MIN).sub(uTime.mul(aFall));
    const yPos = mod(fallen, float(SNOW_Y_SPAN)).add(SNOW_Y_MIN);
    // x: travel WITH the wind, wrapped over the field span so the stream never ends.
    const xDrift = mod(aBase.x.add(100.0).add(uTime.mul(windSpeed)), 200.0).sub(100.0);
    // Gust pulse breathes through the lateral sway (never through the wrap speed).
    const gust = pow(sin(uTime.mul(0.35)).mul(0.5).add(0.5), 2.0).mul(0.8).add(0.6);
    const swayPhase = aSway.x;
    const swayAmp = aSway.y.mul(gust);
    const swayX = sin(uTime.mul(0.6).add(swayPhase)).mul(swayAmp);
    const swayZ = sin(uTime.mul(0.45).add(swayPhase.mul(1.7))).mul(swayAmp.mul(0.6));
    const center = vec3(xDrift.add(swayX), yPos, aBase.z.add(swayZ));

    // Larger quads carry the streaks; higher flakes get longer ones.
    material.positionNode = billboardWorld(center, altitudeT.mul(1.2).add(0.9));

    // Streak mask: the quad uv rotated to the wind angle, compressed across the wind so
    // each flake reads as a wind-sheared STREAK (length scales with altitude).
    const WIND_COS = Math.cos(-0.16);
    const WIND_SIN = Math.sin(-0.16);
    const p0 = uv().sub(0.5);
    const px = p0.x.mul(WIND_COS).sub(p0.y.mul(WIND_SIN));
    const pyr = p0.x.mul(WIND_SIN).add(p0.y.mul(WIND_COS));
    const stretch = altitudeT.mul(3.4).add(2.2);
    const streakD = length(vec2(px.mul(2.0), pyr.mul(2.0).mul(stretch)));
    const streak = pow(clamp(oneMinus(streakD), 0.0, 1.0), 1.5);

    // Cool spindrift crystals (sun-tinted would fight the dusk key; kept cool-bright).
    material.colorNode = vec3(0.87, 0.91, 0.95);
    material.opacityNode = streak.mul(0.55);

    const snow = new THREE.Mesh(geometry, material);
    snow.name = 'mountain-snow';
    snow.frustumCulled = false;
    // Expose the TSL time uniform so the update loop ticks it (mirrors cloudSeaTimeUniform);
    // no per-frame attribute mutation/re-upload remains.
    snow.userData = { snowTimeUniform: uTime };

    return snow;
}

export function updateMountainPeaksEnvironment(group, delta, time, camera, cameraProgress = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    const cameraY = camera?.position?.y ?? group.position.y;
    const yStart = group.userData.yStart ?? MOUNTAIN_PEAKS_CONFIG.yStart;
    const yEnd = group.userData.yEnd ?? MOUNTAIN_PEAKS_CONFIG.yEnd;
    const progressWindow = getMountainChapterProgressWindow();
    const progressStart = progressWindow.start;
    const progressEnd = progressWindow.end;
    let progress = 0;

    if (Number.isFinite(cameraProgress) && progressEnd > progressStart) {
        progress = THREE.MathUtils.clamp(
            (cameraProgress - progressStart) / (progressEnd - progressStart),
            0,
            1,
        );
    } else if (yEnd > yStart) {
        progress = THREE.MathUtils.clamp((cameraY - yStart) / (yEnd - yStart), 0, 1);
    }

    const transition = THREE.MathUtils.smoothstep(
        progress,
        MOUNTAIN_TRANSITION_START,
        MOUNTAIN_TRANSITION_END,
    );

    // Cloud-sea billow scroll (TSL time uniform).
    if (group.userData.cloudSeaTimeUniform) {
        group.userData.cloudSeaTimeUniform.value = time;
    }

    // SUMMIT-GLOW CLIMAX (plan ch4 §Cinematic): ramp up across the back of the chapter so
    // the hero summit ignites rose-gold + the sun ray fan widens together. Peaks ~0.9→1.0,
    // then eases back toward the 4→5 exit (B7 owns the actual exit lerp). The in-shader
    // ignite already fades with night via oneMinus(uTransition), so don't double-gate here.
    if (group.userData.summitGlowUniform) {
        const rise = THREE.MathUtils.smoothstep(progress, 0.62, 0.9);
        const ease = 1 - THREE.MathUtils.smoothstep(progress, 0.94, 1.0) * 0.5;
        group.userData.summitGlowUniform.value = rise * ease;
    }

    const mountainTransitionUniformTargets = group.userData.mountainTransitionUniformTargets || [];
    mountainTransitionUniformTargets.forEach((uniform2) => {
        uniform2.value = transition;
    });

    // SEAM 4->5: ramp 0->1 across the last MOUNTAIN_SEAM_EXIT_BAND of the chapter. The
    // hero chain stays locked; only Ch4-only props and atmospheric accents fade.
    const seamExit = smoothstep01(
        (progress - (1 - MOUNTAIN_SEAM_EXIT_BAND)) / MOUNTAIN_SEAM_EXIT_BAND,
    );
    const seamFade = 1 - seamExit;

    const { mainPeaks } = group.userData;
    if (mainPeaks) {
        const baseY = mainPeaks.userData.seamBaseY ?? 0;
        mainPeaks.position.y = baseY;
    }

    const { entryOpacity } = resolveMountainPeaksEntryState(cameraProgress);
    const mainPeakOpacityUniformTargets = group.userData.mainPeakOpacityUniformTargets || [];
    mainPeakOpacityUniformTargets.forEach((uniform2) => {
        const baseOpacity = typeof uniform2.__odysseyBaseOpacity === 'number'
            ? uniform2.__odysseyBaseOpacity
            : uniform2.value;
        uniform2.value = baseOpacity * entryOpacity;
    });

    const mountainOpacityUniformTargets = group.userData.mountainOpacityUniformTargets || [];
    mountainOpacityUniformTargets.forEach((uniform2) => {
        const baseOpacity = typeof uniform2.__odysseyBaseOpacity === 'number'
            ? uniform2.__odysseyBaseOpacity
            : uniform2.value;
        uniform2.value = baseOpacity * seamFade;
    });

    const auroraFadeUniformTargets = group.userData.auroraFadeUniformTargets || [];
    auroraFadeUniformTargets.forEach((uniform2) => {
        uniform2.value = 1;
    });

    // 4→5 SEAM (creative plan Transition Out): aurora is a late Mountains promise, not a
    // 3→4 entry card. Keep it fully off through the Surface→Mountains handoff, then let
    // it rise gently only near the back of Chapter 4 before Chapter 5 inherits it.
    const auroraPreview = THREE.MathUtils.smoothstep(progress, 0.72, 0.9) * 0.18;
    const auroraRamp = auroraPreview + seamExit * 0.22;
    if (group.userData.aurora) {
        group.userData.aurora.visible = auroraRamp > 0.002;
    }
    const auroraOpacityUniformTargets = group.userData.auroraOpacityUniformTargets || [];
    auroraOpacityUniformTargets.forEach((uniform2) => {
        const baseOpacity = typeof uniform2.__odysseyBaseOpacity === 'number'
            ? uniform2.__odysseyBaseOpacity
            : uniform2.value;
        uniform2.value = baseOpacity * auroraRamp;
    });

    // Eagles: slow soaring circles crossing the lane (the held middle composition's
    // motion accent), banked into the turn with an occasional wing beat.
    const { eagles } = group.userData;
    if (eagles) {
        eagles.children.forEach((eagle) => {
            const ud = eagle.userData;
            const t = time * ud.speed + ud.offset;
            eagle.position.set(
                Math.cos(t) * ud.radius,
                ud.height + Math.sin(t * 1.3) * 6,
                ud.lane + Math.sin(t) * ud.radius * 0.45,
            );
            const soarFlap = 0.82 + Math.abs(Math.sin(time * ud.flap)) * 0.4;
            eagle.scale.set(1.7, 1.7 * soarFlap, 1.7);
            eagle.rotation.y = -t + Math.PI / 2;
            eagle.rotation.z = Math.sin(t) * 0.3;
        });
    }

    // Snow drift (perf §5.3): the per-frame CPU integration + InstancedBufferAttribute
    // re-upload (~1000 flakes × 3 floats every frame) is gone — the TSL material derives
    // each flake's falling/sway position from uTime. Just tick the shared time uniform.
    if (group.userData.snowTimeUniform) {
        group.userData.snowTimeUniform.value = time;
    }
}

export default {
    config: MOUNTAIN_PEAKS_CONFIG,
    create: createMountainPeaksEnvironment,
    update: updateMountainPeaksEnvironment,
};
function getMountainChapterProgressWindow() {
    const chapterPositions = getActiveOdysseyChapterPositions();
    return {
        start: chapterPositions?.[3] ?? 0.352,
        end: chapterPositions?.[4] ?? 0.5,
    };
}

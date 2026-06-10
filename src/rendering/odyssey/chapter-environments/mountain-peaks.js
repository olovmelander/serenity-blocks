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
    float,
    mod,
    sin,
    uniform,
    uv,
    vec3,
    texture as textureNode,
} from 'three/tsl';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
} from '../path-utils.js';
import { createMountainAuroraBackdrop } from './shared/mountain-aurora.js';
import {
    createMountainSkyTSL,
    createFBMMountainTSL,
    createSnowFloorTSL,
    createCloudSeaDeckTSL,
    createMountainSunTSL,
} from './mountain-peaks.tsl.js';
import {
    billboardWorld,
    makeQuadInstancedGeometry,
} from './shared/odyssey-tsl-billboard.js';
import {
    MOUNTAIN_SHADING,
    resolveMountainTreatment,
} from './shared/mountain-language.js';

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
// SEAM 4->5 ("the mountain tops just disappear with a pop"). The manager group-opacity
// crossfade can't reach these TSL peak materials (alpha flows through opacityNode/uOpacity,
// not material.opacity), so without this the peaks stay full-opacity until group.visible
// flips false at the seam = a hard pop. Across the BACK of Ch4 into the 4->5 boundary we
// SINK the peaks downward (so they descend beneath the rising cloud-sea) and FADE their
// uOpacity to ~0, so the summits recede below the clouds rather than blinking out.
const MOUNTAIN_SEAM_EXIT_BAND = 0.34; // fraction of Ch4 (by local progress) over which to sink+fade
const MOUNTAIN_SEAM_SINK_DISTANCE = 140; // world units the peaks descend across the exit

function smoothstep01(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}
// ONE mountain language (shared/mountain-language.js): heroes ride the cool pole, the
// lower foothill apron pulls toward neutral grey-blue with a higher snow line. The TSL
// builder resolves the canonical palette; here we only forward the per-instance base
// mist/fade so each peak's feet recede correctly.
const MAIN_PEAK_TREATMENT = resolveMountainTreatment({ coolTemp: 1.0 });
const FOOTHILL_APRON_TREATMENT = resolveMountainTreatment({
    coolTemp: 0.72,
    snowLine: MOUNTAIN_SHADING.snowLineFoothill,
});
const MAIN_PEAK_BASE = Object.freeze({
    baseMistStrength: 0.32, baseFadeStart: 0.02, baseFadeEnd: 0.1,
});
const FOOTHILL_APRON_BASE = Object.freeze({
    baseMistStrength: 0.18, baseFadeStart: 0.08, baseFadeEnd: 0.22,
});

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
    const chapter3Range = getChapterPathRange(3);
    const fallbackCenterY = (MOUNTAIN_PEAKS_CONFIG.yStart + MOUNTAIN_PEAKS_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const chapter3CenterY = chapter3Range?.center.y ?? chapterCenterY;

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

    const mountains = new THREE.Group();
    mountains.name = 'main-peaks';

    const ch3MountainOffsets = [-10, -20, -30];
    const leftMountainY = chapter3CenterY + ch3MountainOffsets[0];
    const rightMountainY = chapter3CenterY + ch3MountainOffsets[1];
    const centerMountainY = chapter3CenterY + ch3MountainOffsets[2];

    // Left mountain (aligned with Ch3 left mountain) — bigger + pulled NEARER (z -650→-540,
    // size 800→920, height 300→360) so its snowy top dominates the frame (user §Scale: get
    // closer, hero peaks bigger). Tucked slightly inward (x -250→-230) to stay framing the lane.
    const mountain1 = createFBMMountain(uTransition, {
        size: 920,
        height: 360,
        position: new THREE.Vector3(-230, leftMountainY - chapterCenterY, -540),
        seed: 12.34,
        treatment: MAIN_PEAK_TREATMENT,
        base: MAIN_PEAK_BASE,
        summitGlow: uSummitGlow,
    }, opacityTargets);
    mountains.add(mountain1);

    // Right mountain (aligned with Ch3 right mountain) — same treatment: bigger + nearer
    // (z -700→-590, size 800→900, height 280→340).
    const mountain2 = createFBMMountain(uTransition, {
        size: 900,
        height: 340,
        position: new THREE.Vector3(230, rightMountainY - chapterCenterY, -590),
        seed: 45.67,
        treatment: MAIN_PEAK_TREATMENT,
        base: MAIN_PEAK_BASE,
        summitGlow: uSummitGlow,
    }, opacityTargets);
    mountains.add(mountain2);

    // Far center HERO peak (aligned with Ch3 center mountain) — the dominant snowy summit.
    // Pulled markedly closer (z -820→-680) and taller (height 600→720, size 1200→1340) so the
    // snow-capped top fills the upper frame and the climax summit-glow reads big (user §Scale).
    const mountain3 = createFBMMountain(uTransition, {
        size: 1340,
        height: 720,
        position: new THREE.Vector3(0, centerMountainY - chapterCenterY, -680),
        seed: 89.12,
        treatment: MAIN_PEAK_TREATMENT,
        base: MAIN_PEAK_BASE,
        summitGlow: uSummitGlow,
    }, opacityTargets);
    mountains.add(mountain3);

    // ONE near foreground ridge-shoulder, lower-left, mostly below frame so only its sunlit
    // snowy upper edge enters — the near depth tier that sells altitude (plan ch4 §Scale).
    // Pulled in + up a touch (z -260→-220, height 180→220) so its snow-cap crests into frame.
    const foreground = createFBMMountain(uTransition, {
        size: 720,
        height: 220,
        position: new THREE.Vector3(-360, foothillBaseY - 30, -220),
        seed: 71.5,
        treatment: MAIN_PEAK_TREATMENT,
        base: MAIN_PEAK_BASE,
        summitGlow: uSummitGlow,
    }, opacityTargets);
    mountains.add(foreground);
    group.userData.foregroundRidge = foreground;

    massif.add(mountains);

    // On-screen SUN disc + bloom-halo + ray fan along lightDir (controlled bloom, NOT the
    // old white node blowout). The ray fan widens as uSummitGlow peaks at the climax.
    const sun = createMountainSunTSL({ uTransition, summitGlow: uSummitGlow });
    massif.add(sun.group);
    group.userData.sun = sun.group;

    group.add(massif);
    group.userData.mountains = massif;
    group.userData.mainPeaks = mountains;
    // SEAM 4->5: record the peaks' authored base Y so the seam-exit sink is a non-compounding
    // absolute offset (baseY - sink) rather than a per-frame accumulation.
    mountains.userData.seamBaseY = mountains.position.y;

    // 3. Shader Aurora Curtains
    // Lift the curtain opacities a touch so the aurora colour reads more strongly against
    // the now-deeper twilight sky (without flattening it into a wash). Defaults were
    // [1.0, 0.8, 0.8, 0.6]; the back/wide curtain stays subtle.
    const aurora = createMountainAuroraBackdrop(uniforms, {
        name: 'mountain-aurora',
        layerOpacities: [1.0, 0.95, 0.95, 0.7],
    });
    group.add(aurora);
    group.userData.aurora = aurora;
    group.userData.mountainTransitionUniformTargets = transitionTargets;
    group.userData.mountainOpacityUniformTargets = opacityTargets;
    group.userData.auroraFadeUniformTargets = collectUniformTargets(aurora, 'uAuroraFade');
    group.userData.auroraOpacityUniformTargets = collectUniformTargets(aurora, 'uOpacity');

    // 4. Falling Snow
    const snow = createSnow(uniforms, options.particleCount || 1000);
    group.add(snow);
    group.userData.snow = snow;
    // Snow drift is now uTime-driven in the TSL material (perf §5.3); the update loop ticks
    // this node instead of rewriting + re-uploading the InstancedBufferAttribute each frame.
    group.userData.snowTimeUniform = snow.userData.snowTimeUniform;

    // 5. Stars
    const stars = createStars(uniforms, 1000);
    group.add(stars);
    group.userData.stars = stars;

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

function createParticleTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Soft circle gradient
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createStars(uniforms, count) {
    // Build the same spherical-shell star layout as the original Points cloud, but
    // gather only the accepted points (cos(phi) >= 0) so the instanced quad count is exact.
    const positions = [];
    const sizes = [];

    for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 250 + Math.random() * 50;

        if (Math.cos(phi) < 0) continue;

        positions.push(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta),
        );
        sizes.push(0.5 + Math.random() * 1.5);
    }

    const instanceCount = sizes.length;
    const basePositions = new Float32Array(positions);
    const aSize = new Float32Array(sizes);

    const geometry = makeQuadInstancedGeometry(instanceCount, {
        aBase: { array: basePositions, itemSize: 3 },
        aSize: { array: aSize, itemSize: 1 },
    });

    // Round particle sprite (same soft-circle canvas the Points version used).
    const map = createParticleTexture();

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;

    // Billboard each quad at its base position; convert the old ~2px PointsMaterial size +
    // per-point size variation (0.5..2.0) into a small world-space half-extent.
    const worldSize = attribute('aSize', 'float').mul(0.45);
    material.positionNode = billboardWorld(attribute('aBase', 'vec3'), worldSize);

    const sprite = textureNode(map, uv());
    material.colorNode = sprite.rgb.mul(new THREE.Color(0xffffff));
    material.opacityNode = sprite.a.mul(0.8);

    const stars = new THREE.Mesh(geometry, material);
    stars.name = 'mountain-stars';
    stars.frustumCulled = false;
    return stars;
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

    [
        {
            size: 1100,
            height: 72,
            position: new THREE.Vector3(-330, baseY - 12, -600),
            seed: 21.17,
        },
        {
            size: 1250,
            height: 92,
            position: new THREE.Vector3(30, baseY - 20, -860),
            seed: 33.71,
        },
        {
            size: 1100,
            height: 78,
            position: new THREE.Vector3(330, baseY - 10, -710),
            seed: 58.42,
        },
    ].forEach((config) => {
        const foothill = createFBMMountain(uTransition, {
            ...config,
            treatment: FOOTHILL_APRON_TREATMENT,
            base: FOOTHILL_APRON_BASE,
            isHero: false,
        }, opacityTargets);
        foothill.renderOrder = -2;
        group.add(foothill);
    });

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

    // Reuse soft-circle sprite texture.
    const map = createParticleTexture();

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;

    // GPU-side drift (perf §5.3): the snowflake center is derived from uTime in the shader
    // instead of a per-frame JS loop + InstancedBufferAttribute.needsUpdate re-upload. The
    // falling motion mods over the same [-10, 100) window as the old CPU wrap so the look
    // (density, loop point, gentle horizontal sway) is preserved.
    const uTime = uniform(0);
    const aBase = attribute('aBase', 'vec3');
    const aFall = attribute('aFall', 'float');
    const aSway = attribute('aSway', 'vec2');

    // y: fall + wrap into [-10, 100). mod() returns [0, span); shift back to the window.
    const fallen = aBase.y.sub(SNOW_Y_MIN).sub(uTime.mul(aFall));
    const yPos = mod(fallen, float(SNOW_Y_SPAN)).add(SNOW_Y_MIN);
    // x/z: a bounded sine sway (the old per-frame x/z velocity was a tiny gentle walk;
    // a uTime sine reads the same as drifting flakes without unbounded accumulation).
    const swayPhase = aSway.x;
    const swayAmp = aSway.y;
    const swayX = sin(uTime.mul(0.6).add(swayPhase)).mul(swayAmp);
    const swayZ = sin(uTime.mul(0.45).add(swayPhase.mul(1.7))).mul(swayAmp.mul(0.6));
    const center = vec3(aBase.x.add(swayX), yPos, aBase.z.add(swayZ));

    // Original Points size 0.8 -> small world-space half-extent.
    material.positionNode = billboardWorld(center, 0.8);

    // Slightly cooler, dimmer flakes so the dense snowfield adds depth without piling up
    // into a near-white atmospheric wash.
    const sprite = textureNode(map, uv());
    material.colorNode = sprite.rgb.mul(new THREE.Color(0xdfe9f2));
    material.opacityNode = sprite.a.mul(0.6);

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

    // SEAM 4->5: ramp 0->1 across the last MOUNTAIN_SEAM_EXIT_BAND of the chapter so the peaks
    // SINK below the rising cloud-sea and FADE out smoothly, rather than popping when the
    // group hides at the seam. `progress` is local 0..1 across the Ch4 window.
    const seamExit = smoothstep01(
        (progress - (1 - MOUNTAIN_SEAM_EXIT_BAND)) / MOUNTAIN_SEAM_EXIT_BAND,
    );
    const seamFade = 1 - seamExit;

    const { mainPeaks } = group.userData;
    if (mainPeaks) {
        const baseY = mainPeaks.userData.seamBaseY ?? 0;
        mainPeaks.position.y = baseY - seamExit * MOUNTAIN_SEAM_SINK_DISTANCE;
    }

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

    const auroraOpacityUniformTargets = group.userData.auroraOpacityUniformTargets || [];
    auroraOpacityUniformTargets.forEach((uniform2) => {
        const baseOpacity = typeof uniform2.__odysseyBaseOpacity === 'number'
            ? uniform2.__odysseyBaseOpacity
            : uniform2.value;
        uniform2.value = baseOpacity;
    });

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

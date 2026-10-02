/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Urban Dreams Environment - Chapter 8 Visual Theme (the encore)
 *
 * The electric coda: a neon megastructure rising over a procedurally-lit night
 * city, wet reflections, holographic signage, sky traffic and rain. Part of the
 * Odyssey AAA "Cosmic Ascent" overhaul (Phase 4 — chapter level-up); see
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6. This is the highest-contrast world.
 *
 * Layers (plan §3.2):
 *   0  Neon sky          — gradient + horizon light-pollution + drifting smog (FBM)
 *   1  Hero anchor       — neon megastructure spire with an energy-conduit core
 *   2  Mid environment   — city blocks with procedural lit-window facade shaders
 *   3  Atmosphere        — ground neon haze + light pools
 *   5/6 Near life        — holographic signs, wet reflections, rain streaks, traffic
 *
 * WebGPU/TSL: this live chapter now runs on THREE.WebGPURenderer, so every former
 * GLSL THREE.ShaderMaterial (sky / city facades / spire conduit cores / holo-signs /
 * wet-reflection / ground-haze) is built from the validated TSL NodeMaterial builders
 * in the sibling urban-dreams.tsl.js. The shared uTime/uEnergy uniforms are passed
 * INTO those builders so this file's update() ticks them unchanged. The former
 * rain-streak THREE.Points (1px on WebGPU) is now an instanced billboard quad mesh
 * via the shared odyssey-tsl-billboard helper; its CPU fall animation mutates the
 * per-instance `aBase` attribute. The MeshBasic neon rails / spire frames / crown /
 * sky-traffic tubes, the beacon PointLight and the AmbientLight render unchanged.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    clamp,
    dot,
    float,
    fract,
    max,
    mix,
    normalize,
    normalView,
    oneMinus,
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
import { acquireChapterLight } from './shared/chapter-light-pool.js';
import { getChapterProfile } from './shared/chapter-profile.js';
import { pickByQualityTier } from './shared/odyssey-quality-tier.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../path-utils.js';
import { makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import {
    computeStageBasis,
    stageBasisToQuaternion,
    urbanIgnition,
    urbanLocalProgress,
    urbanResolve,
} from '../composition/odyssey-stage-frame.js';
import {
    createSkyGradientTSL,
    createSynthwaveSunTSL,
    createCityBlocksTSL,
    createNeonCitySpireTSL,
    createHologramSignsTSL,
    createWetReflectionPlaneTSL,
    createGroundHazeTSL,
    createNeonHazeStackTSL,
    createSkylineSilhouetteTSL,
    createHorizonHazeTSL,
    billboardStageVertical,
} from './urban-dreams.tsl.js';

export const URBAN_DREAMS_CONFIG = {
    id: 8,
    name: 'urban-dreams',
    // Spline-derived chapter y-range (matches getChapterPathRange(8)); kept here so
    // ChapterEnvironmentManager.getChapterAtPosition() and the userData fallback work
    // even if the path layout lookup is unavailable.
    yStart: 875.9,
    yEnd: 960.0,
    colors: {
        primary: 0x0c0818,
        secondary: 0x201135,
        tertiary: 0x00f2ff,
        accent: 0xff3fb4,
        background: 0x060712,
    },
};

export const CH8_RETROSUN_STAGE = Object.freeze({
    revealFloor: 0.62,
    // Raised 28 → 110 with the disc shrink: the sun now sits ON the skyline (its lower third
    // behind the far rooftops) instead of below the canyon's sightline.
    sun: [0, 110, -700],
    skylineNear: [0, -42, -650],
    skylineFar: [40, -54, -675],
    // Behind the sun (was -688, IN FRONT of it: once the disc shrank to a readable size the
    // haze band covered it entirely).
    horizonHaze: [0, -12, -730],
});

const CYAN = 0x00f2ff;
const MAGENTA = 0xff3fb4;

/**
 * Per-quality-tier set dressing (seamless pass). Chapters used to get only a particle count,
 * so Lane B (Medium, the iGPU) paid the full High city. `high` is the authored city. Medium
 * keeps the composition and thins the rain; Low also drops the two outermost tower banks
 * (the skyline cards hold the horizon behind them) and every other holo sign.
 */
export const CH8_QUALITY_TIERS = Object.freeze({
    high: Object.freeze({ towerBanks: 6, signStride: 1, rain: 900 }),
    medium: Object.freeze({ towerBanks: 6, signStride: 1, rain: 600 }),
    low: Object.freeze({ towerBanks: 4, signStride: 2, rain: 380 }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

function createSkyGradient(uniforms) {
    const { mesh } = createSkyGradientTSL(uniforms.uTime, uniforms.uEnergy);
    return mesh;
}

function createSynthwaveSun(uniforms) {
    // Own reveal uniform so the sun swells/heats with the finale ignition; the chapter
    // update() mirrors the eased reveal into it alongside the spire conduit's uReveal.
    const uReveal = uniform(CH8_RETROSUN_STAGE.revealFloor);
    const { mesh } = createSynthwaveSunTSL(uniforms.uTime, uniforms.uEnergy, { uReveal });
    mesh.userData.uReveal = uReveal;
    return mesh;
}

function createCityBlocks(uniforms, tier = CH8_QUALITY_TIERS.high) {
    const { group } = createCityBlocksTSL(uniforms.uTime, uniforms.uEnergy, {
        uCityLight: uniforms.uCityLight,
        uIgniteRadius: uniforms.uIgniteRadius,
        uDim: uniforms.uDim,
        bankCount: tier.towerBanks,
    });
    group.name = 'city-blocks';
    return group;
}

function createNeonHazeStack(uniforms) {
    const { mesh } = createNeonHazeStackTSL(uniforms.uTime, uniforms.uEnergy);
    mesh.name = 'neon-haze-stack';
    return mesh;
}

function createNeonRails() {
    const group = new THREE.Group();
    group.name = 'neon-rails';

    // Neon ring gates straddling the path: centred on the path axis (x/y ≈ 0) and
    // marching away from the camera so the forward view threads cleanly through them.
    // These FRAME the shared Phase-A unified path conduit (the chapter does not render its
    // own path) — gates around the route, not a competing path line. They march the full
    // length of the new neon canyon so the conduit is gated end-to-end toward the finale.
    // CONSOLIDATION (remake plan #1): two SHARED additive materials (cyan/magenta) serve all 9
    // gates — the 9 near-identical MeshBasicMaterials collapse to 2 compiled pipelines. Rings stay
    // individual meshes so update() can still spin each on its own rotation.z (transform, not
    // material), so the look is byte-identical.
    const ringMaterial = (color) => new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const cyanRing = ringMaterial(CYAN);
    const magentaRing = ringMaterial(MAGENTA);
    for (let index = 0; index < 9; index += 1) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(30 + index * 3.5, 0.5, 8, 96),
            index % 2 === 0 ? cyanRing : magentaRing,
        );
        ring.rotation.x = Math.PI * 0.5;
        ring.position.set(0, -2, -120 - index * 80);
        group.add(ring);
    }

    return group;
}

// Rain wrap geometry (CORRIDOR space, 2026-10): streaks spawn across this local-Y span and
// fall along the city's -Y (its gravity), respawning at the top. The fall is a uTime-driven
// sawtooth in the shader (Batch5), no CPU loop.
const RAIN_SPAN_TOP = 150; // respawn height (above the eye line)
const RAIN_SPAN_BOTTOM = -60; // the street datum
const RAIN_SPAN = RAIN_SPAN_TOP - RAIN_SPAN_BOTTOM;
const RAIN_FALL_SPEED = 120; // corridor units/sec
const RAIN_COUNT = 900;

function createRainCurtain(uniforms, count = RAIN_COUNT) {
    const uTime = uniforms?.uTime ?? uniform(0);
    const uRainDensity = uniforms?.uRainDensity ?? uniform(1);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        // A volume around the camera's actual travel (corridor z +120 → -60) and out over
        // the boulevard; denser near the lane where it reads against the dark towers.
        const lateral = (Math.random() - 0.5) * (Math.random() < 0.6 ? 90 : 260);
        positions[stride] = lateral;
        positions[stride + 1] = 0; // Y comes from the shader sawtooth
        positions[stride + 2] = 140 - Math.random() * 260;
        sizes[index] = 2.2 + Math.random() * 3.2;
        phases[index] = Math.random();
        speeds[index] = 0.82 + Math.random() * 0.36;
        seeds[index] = Math.random();
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aRainPhase: { array: phases, itemSize: 1 },
        aRainSpeed: { array: speeds, itemSize: 1 },
        aRainSeed: { array: seeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aRainPhase = attribute('aRainPhase', 'float');
    const aRainSpeed = attribute('aRainSpeed', 'float');
    const aRainSeed = attribute('aRainSeed', 'float');

    const cycle = fract(
        aRainPhase.add(uTime.mul(RAIN_FALL_SPEED / RAIN_SPAN).mul(aRainSpeed)),
    );
    const fallY = float(RAIN_SPAN_TOP).sub(cycle.mul(RAIN_SPAN));
    const center = vec3(aBase.x, fallY, aBase.z);

    // Thin, tall streak standing on the CITY's up (yaw-only facing in stage space), so it
    // falls straight down the frame now that the camera shares the corridor frame (in world
    // space it used to fall along the view axis, toward the lens).
    const positionNode = billboardStageVertical(center, vec2(aSize.mul(0.045), aSize.mul(1.1)));

    const c = uv().sub(0.5);
    const streak = smoothstep(0.5, 0.05, c.x.abs()).mul(smoothstep(0.5, 0.0, c.y.abs()));
    // Rain CATCHES THE NEON: most drops are cool white-blue, a share glints magenta / cyan.
    const tint = mix(
        vec3(0.62, 0.74, 1.0),
        mix(vec3(1.0, 0.3, 0.78), vec3(0.2, 0.9, 1.0), step(0.6, fract(aRainSeed.mul(17.0)))),
        step(0.62, aRainSeed),
    );
    // Thins out over the finale resolve (drops above the density cut are dropped).
    const alive = step(aRainSeed, uRainDensity);
    const uOpacity = uniform(1); // 7→8 crossfade bridge (rain used to POP in at the seam)

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = tint;
    material.opacityNode = clamp(streak.mul(0.42), 0.0, 1.0).mul(alive).mul(uOpacity);
    material.uniforms = { uOpacity };
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    // Additive + no depth write: the DoubleSide back/front split buys nothing (seamless pass).
    material.forceSinglePass = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rain-streak-curtain';
    mesh.frustumCulled = false;
    return mesh;
}

function createNeonCitySpire(uniforms) {
    const { group } = createNeonCitySpireTSL(uniforms.uTime, uniforms.uEnergy);
    group.name = 'neon-megastructure-spire';
    return group;
}

function createHologramSigns(uniforms, tier = CH8_QUALITY_TIERS.high) {
    const { group } = createHologramSignsTSL(uniforms.uTime, uniforms.uEnergy, {
        signStride: tier.signStride,
    });
    group.name = 'hologram-sign-stack';
    return group;
}

function createWetReflectionPlane(uniforms) {
    const { mesh } = createWetReflectionPlaneTSL(uniforms.uTime, uniforms.uEnergy);
    mesh.name = 'wet-neon-reflection-plane';
    return mesh;
}

function createGroundHaze(uniforms) {
    const { group } = createGroundHazeTSL(uniforms.uTime, uniforms.uEnergy);
    group.name = 'ground-neon-haze';
    return group;
}

function createSkyTraffic() {
    const group = new THREE.Group();
    group.name = 'sky-traffic-light-trails';
    // Cohesive neon duo only — the former warm-yellow lane broke the cyan/magenta
    // palette and read as visual noise. Light trails now reinforce the city's two-tone
    // identity, with magenta slightly favoured so cyan owns the path and magenta the sky.
    const colors = [CYAN, MAGENTA, MAGENTA];
    // CONSOLIDATION (remake plan #3): two SHARED additive materials (cyan/magenta) across all ~18
    // trails — the per-trail MeshBasicMaterials collapse to 2 pipelines. Trails stay individual
    // meshes so update() slides each along the canyon (transform, not material). One shared opacity
    // (0.55) for trails + heroes; the 0.05 the heroes lose is imperceptible under additive blend.
    // TRON light ribbons (2026-10): a WHITE-HOT core where the tube faces the camera,
    // falling off to the saturated hue at the silhouette (view-facing ramp on the tube
    // normal), soft-edged. Two shared node materials; uOpacity bridges the crossfade.
    const trailMaterial = (hex) => {
        const hue = new THREE.Color(hex);
        const facing = max(0.0, dot(normalize(normalView), positionViewDirection));
        const core = pow(facing, 6.0);
        const uOpacity = uniform(1);
        const material = new THREE.MeshBasicNodeMaterial();
        material.colorNode = mix(vec3(hue.r, hue.g, hue.b), vec3(1.0, 0.96, 1.0), core.mul(0.85))
            .mul(core.mul(0.45).add(0.55));
        material.opacityNode = pow(facing, 0.8).mul(0.75).mul(uOpacity);
        material.uniforms = { uOpacity };
        material.transparent = true;
        material.blending = THREE.AdditiveBlending;
        material.depthWrite = false;
        material.userData.emitsBloom = true;
        return material;
    };
    const cyanTrail = trailMaterial(CYAN);
    const magentaTrail = trailMaterial(MAGENTA);
    const matFor = (color) => (color === CYAN ? cyanTrail : magentaTrail);

    // Sky-lane traffic re-staged onto the 2026-10 city: lanes above the boulevard and over
    // the rooftops (y 18–70, above most roofs, above and below the eye line), streaking
    // toward the spire, spread over the camera's travel and the mid-distance.
    const TRAIL_COUNT = 16;
    const LANES = [-150, -95, -46, -18, 18, 46, 95, 150];
    for (let index = 0; index < TRAIL_COUNT; index += 1) {
        const t = index / (TRAIL_COUNT - 1);
        const baseZ = 90 + (-620 - 90) * t; // near → far down the corridor
        const lane = LANES[(index * 3) % LANES.length];
        const h = 18 + ((index * 23) % 52);
        // Each trail runs forward (toward the finale, -Z) so it streaks down the canyon.
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(lane - 6, h + 3, baseZ + 60),
            new THREE.Vector3(lane, h, baseZ),
            new THREE.Vector3(lane + 6, h - 2, baseZ - 70),
        ]);
        const trail = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 36, 0.55, 7, false),
            matFor(colors[index % colors.length]),
        );
        trail.userData.speed = 80 + index * 9; // world units/sec streaking forward
        trail.userData.baseZ = baseZ;
        group.add(trail);
    }

    // 1–2 bright HERO trails sweeping near the finale spire for a final flourish.
    [-1, 1].forEach((side, i) => {
        // Swing around the spire's upper shaft (crown ~ y 372, base on the street).
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(side * 140, 140 + i * 50, -470),
            new THREE.Vector3(side * 40, 210 + i * 40, -530),
            new THREE.Vector3(-side * 110, 160 + i * 50, -640),
        ]);
        const hero = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 40, 1.0, 8, false),
            matFor(i === 0 ? CYAN : MAGENTA),
        );
        hero.userData.speed = 0; // hero trails sway in place rather than streak
        hero.userData.hero = true;
        group.add(hero);
    });

    return group;
}

/**
 * Build the orientation that aligns the corridor container's LOCAL -Z with the camera's
 * forward travel through chapter 8 (the averaged spline tangent across the chapter) and
 * its local +Y/+X with screen up/right. The follow camera looks DOWN the path tangent,
 * but the environment group is anchored at the path centre with NO rotation — so the
 * city's local-Z corridor would otherwise point across the camera's view (the bug: the
 * canyon sat off-screen while the camera climbed an almost-vertical path). Rotating the
 * container by this quaternion makes the canyon a true corridor the camera flies down.
 * Falls back to identity if the path curve is unavailable (pilot/standalone harness).
 */
function computeCorridorOrientation() {
    const quaternion = new THREE.Quaternion();
    let curve;
    try {
        curve = getOdysseyPathCurve();
    } catch {
        curve = null;
    }
    const range = getChapterPathRange(8);
    if (!curve || !range) {
        return quaternion; // identity fallback
    }

    // Re-derive the chapter's 0..1 t-range from the world y-bounds so the averaged tangent
    // matches the segment the camera actually traverses in this chapter.
    const findT = (targetY) => {
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 48; i += 1) {
            const mid = (lo + hi) / 2;
            if (curve.getPointAt(mid).y < targetY) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    };
    const tStart = findT(range.start.y);
    const tEnd = findT(range.end.y);

    // Average the tangent across the chapter for a stable corridor axis (the path wobbles
    // in z but climbs steadily in y near the finale). The basis maths lives in the shared
    // stage-frame module so the CAMERA rides exactly this frame (stage framing key) — the
    // city's up is the camera's up, so the towers stand upright on screen.
    const basis = computeStageBasis(curve, tStart, tEnd);
    if (!basis) {
        return quaternion;
    }
    return stageBasisToQuaternion(basis, quaternion);
}

export function createUrbanDreamsEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'urban-dreams-environment';
    group.userData.chapterId = 8;
    const tier = pickByQualityTier(options, CH8_QUALITY_TIERS);
    group.userData.qualityTier = tier;

    // Shared TSL uniform nodes — passed INTO every .tsl builder so the materials and
    // this file's update() tick the same uTime/uEnergy. `.value` is mutated each frame.
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.45),
        // City light level (0..1.2): how many floors are lit (finale ignition raises it).
        uCityLight: uniform(1),
        // Finale ignition wave: radius (corridor units) of the ring of light expanding from
        // the spire — buildings inside it switch to their ignited floor count.
        uIgniteRadius: uniform(0),
        // Resolve: 0 = every building alive, 1 = every building guttered out.
        uDim: uniform(0),
        // Rain density (0..1): thins out over the finale resolve.
        uRainDensity: uniform(1),
    };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(8);
    const chapterCenterY = chapterRange?.center.y
        ?? (URBAN_DREAMS_CONFIG.yStart + URBAN_DREAMS_CONFIG.yEnd) / 2;

    // Always set the chapter bounds so downstream consumers (getChapterAtPosition,
    // opacity blending) never see undefined, even if the path lookup fails.
    group.userData.yStart = chapterRange?.start.y ?? URBAN_DREAMS_CONFIG.yStart;
    group.userData.yEnd = chapterRange?.end.y ?? URBAN_DREAMS_CONFIG.yEnd;

    const sky = createSkyGradient(uniforms);
    sky.renderOrder = -100;

    // PATH-ALIGNED CORRIDOR: every directional set piece (city banks, ring gates, rain,
    // spire, signs, wet street, sky traffic) lives in this container, rotated so its local
    // -Z runs straight down the camera's forward travel. This is THE fix for the off-screen
    // canyon — the city now hugs the path within the forward FOV instead of pointing across
    // the camera's view. The container sits at the group origin (the path centre anchor).
    const corridor = new THREE.Group();
    corridor.name = 'urban-corridor';
    corridor.quaternion.copy(computeCorridorOrientation());
    group.add(corridor);
    group.userData.corridor = corridor;

    // The sky dome lives IN the corridor (2026-10): its gradient keys off the dome's local
    // +Y, and on the unrotated group that is world up — which in this chapter is nearly the
    // camera's FORWARD axis, so the zenith sat dead ahead and the light-pollution horizon
    // ring wrapped the view axis. Rotated with the city, the horizon glow sits behind the
    // skyline where it silhouettes the towers.
    corridor.add(sky);

    // (The 420-u curtain-wall backdrop is retired from the live chapter: with the 2026-10
    // city re-stage six tower banks fill the frame to the horizon and the walls would read as
    // two featureless slabs above the rooftops. The builder stays for the pilot harness.)

    // SYNTHWAVE SUN hero backdrop: a colossal glowing disc DEAD AHEAD on the corridor
    // centerline, low on the horizon and far down the canyon (beyond the finale spire at
    // z=-560, past the farthest towers at z≈-1100) so the camera sees it the whole journey
    // and frames it at the finale. Lives in the rotated corridor so it sits straight down
    // the camera's forward -Z; its disc center hugs the street horizon so the lower scanline
    // gaps dissolve into the city skyline. Added BEFORE the city banks so the towers + spire
    // silhouette against it. It shares the finale reveal so it heats up as the journey ignites.
    const sun = createSynthwaveSun(uniforms);
    sun.position.set(...CH8_RETROSUN_STAGE.sun);
    corridor.add(sun);
    group.userData.sun = sun;

    // SKYLINE SILHOUETTE CARDS + HORIZON HAZE (creative plan ch8 item 2): two layered
    // near-black roofline ranks between the Retrosun and the last towers, so the disc
    // is PARTIALLY OCCLUDED and reads distant + enormous, plus the magenta-violet haze
    // band that supplies the chapter's missing mid-value layer.
    const skylineFar = createSkylineSilhouetteTSL(uniforms.uTime, { seedOffset: 31, lift: 0 });
    skylineFar.mesh.position.set(...CH8_RETROSUN_STAGE.skylineFar);
    skylineFar.mesh.scale.set(1.08, 0.9, 1);
    skylineFar.mesh.renderOrder = -88;
    corridor.add(skylineFar.mesh);
    const skylineNear = createSkylineSilhouetteTSL(uniforms.uTime, { seedOffset: 0, lift: 0.012 });
    skylineNear.mesh.position.set(...CH8_RETROSUN_STAGE.skylineNear);
    skylineNear.mesh.renderOrder = -86;
    corridor.add(skylineNear.mesh);
    group.userData.skyline = [skylineNear.mesh, skylineFar.mesh];
    const horizonHaze = createHorizonHazeTSL(uniforms.uTime);
    horizonHaze.mesh.position.set(...CH8_RETROSUN_STAGE.horizonHaze);
    horizonHaze.mesh.renderOrder = -98; // after the dome, BEFORE the sun (-95)
    corridor.add(horizonHaze.mesh);
    group.userData.horizonHaze = horizonHaze.mesh;

    // GATE BRIDGE landmark (creative plan ch8 item 4): a horizontal sky-bridge spanning
    // the canyon at the mid-corridor station; the camera passes UNDER it — the
    // compression-and-release beat that breaks the duplicate mid-chapter frames. One
    // oversized magenta holo-billboard hangs from the deck.
    const gateBridge = new THREE.Group();
    gateBridge.name = 'gate-bridge';
    const bridgeMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0a1c });
    const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(190, 9, 16), bridgeMaterial);
    bridgeDeck.position.y = 42;
    gateBridge.add(bridgeDeck);
    [-88, 88].forEach((pylonX) => {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(10, 110, 12), bridgeMaterial);
        pylon.position.set(pylonX, -8, 0);
        pylon.userData.isPylon = true;
        gateBridge.add(pylon);
    });
    const holoMaterial = new THREE.MeshBasicNodeMaterial();
    const holoUv = uv();
    const holoScan = sin(holoUv.y.mul(60.0).add(uniforms.uTime.mul(3.0))).mul(0.5).add(0.5);
    const holoFlick = sin(uniforms.uTime.mul(9.0)).mul(0.06).add(0.94);
    holoMaterial.colorNode = vec3(1.0, 0.247, 0.706)
        .mul(holoScan.mul(0.35).add(0.65))
        .mul(holoFlick);
    const holoEdge = smoothstep(0.0, 0.06, holoUv.x)
        .mul(oneMinus(smoothstep(0.94, 1.0, holoUv.x)))
        .mul(smoothstep(0.0, 0.1, holoUv.y))
        .mul(oneMinus(smoothstep(0.9, 1.0, holoUv.y)));
    // uOpacity bridge: with an opacityNode, material.opacity is a dead write (r181+), so the
    // billboard ignored the 7→8 crossfade and POPPED in at the seam.
    const holoOpacity = uniform(1);
    holoMaterial.opacityNode = holoEdge.mul(0.42).mul(holoOpacity);
    holoMaterial.uniforms = { uOpacity: holoOpacity };
    holoMaterial.transparent = true;
    holoMaterial.depthWrite = false;
    holoMaterial.side = THREE.DoubleSide;
    holoMaterial.forceSinglePass = true; // additive, no depth write: one pass, not two
    holoMaterial.blending = THREE.AdditiveBlending;
    holoMaterial.userData.emitsBloom = true;
    const holoBillboard = new THREE.Mesh(new THREE.PlaneGeometry(64, 22), holoMaterial);
    holoBillboard.position.y = 24;
    gateBridge.add(holoBillboard);
    // Re-staged 2026-10: at z -300 with the deck 30 u above the eye the bridge only ever
    // read as a black bar slicing the sun, and the camera (which travels corridor z +90 → -10)
    // never passed under it. It is now a LOW skybridge seen from above, spanning the
    // boulevard below the eye line: its magenta billboard glows over the wet street, below
    // the sun/spire sightline, as one more layer of the city rather than a bar across it.
    const BRIDGE_DECK_Y = -38;
    bridgeDeck.position.y = BRIDGE_DECK_Y;
    gateBridge.children.forEach((child) => {
        if (!child.userData.isPylon) return;
        const pylonHeight = BRIDGE_DECK_Y - (-60); // street datum → deck
        child.scale.y = pylonHeight / 110;
        child.position.y = -60 + pylonHeight * 0.5;
    });
    // The sign stands ON the deck facing the approach; the camera flies over the bridge
    // (corridor z +12) around local 0.75 — compression under the sign, release to the spire.
    holoBillboard.scale.y = 0.6;
    holoBillboard.position.y = BRIDGE_DECK_Y + 4.5 + 11 * 0.6 + 0.5;
    gateBridge.position.set(0, 0, 12);
    gateBridge.scale.set(0.62, 1, 1); // span the boulevard (inner banks), not the whole city
    // A slim deck with a neon edge strip (same holo material: +1 draw, no new pipeline)
    // instead of a 9-u black slab across the lower frame.
    bridgeDeck.scale.y = 0.45;
    const deckStrip = new THREE.Mesh(new THREE.PlaneGeometry(190, 1.6), holoMaterial);
    deckStrip.position.z = 8.05;
    deckStrip.scale.y = 1 / 0.45;
    bridgeDeck.add(deckStrip);
    gateBridge.traverse((child) => { child.frustumCulled = false; });
    corridor.add(gateBridge);
    group.userData.gateBridge = gateBridge;

    const cityBlocks = createCityBlocks(uniforms, tier);
    corridor.add(cityBlocks);
    group.userData.cityBlocks = cityBlocks;
    group.userData.cityTowers = cityBlocks.getObjectByName('city-tower-instances-tsl') ?? null;

    const rails = createNeonRails();
    corridor.add(rails);
    group.userData.rails = rails;

    const haze = createGroundHaze(uniforms);
    corridor.add(haze);

    // Volumetric neon haze columns filling the lane air (cyan low / magenta high).
    const hazeStack = createNeonHazeStack(uniforms);
    corridor.add(hazeStack);
    group.userData.hazeStack = hazeStack;

    // Rain lives IN the corridor (2026-10) and falls along the CITY's down: in world space
    // the climb is nearly vertical, so the old world -Y fall streamed along the view axis
    // into the lens. The stage-space billboard keeps each streak upright on the city's up.
    const rain = createRainCurtain(uniforms, tier.rain);
    corridor.add(rain);
    group.userData.rain = rain;

    const spire = createNeonCitySpire(uniforms);
    corridor.add(spire);
    group.userData.spire = spire;

    // ── Hooks for the deferred SERIAL batches (B4 grade / B7 camera) ────────────────
    // The ch8 finale "ignition" (camera CRANE over the last 18%: camUp 1.5→6, lookUp
    // 2.5→7, plus the post-pipeline exposure/bloom swell) is owned by B7/B4. Expose the
    // reveal uniform + a smoothed reveal/progress scalar at the GROUP level so those
    // batches can drive the crane + grade swell from one place without reaching into the
    // spire. `uReveal` is the TSL uniform (0 idle → 1 ignited, smootherstep-eased); the
    // scalar mirrors it for plain JS reads. Updated every frame in update() below.
    group.userData.uReveal = spire.userData.uReveal ?? null;
    group.userData.reveal = 0; // eased 0..1 ignition value (mirror of uReveal.value)
    group.userData.progress = 0; // raw 0..1 chapter/path progress (camera crane driver)

    const signs = createHologramSigns(uniforms, tier);
    corridor.add(signs);
    group.userData.signs = signs;

    const reflectionPlane = createWetReflectionPlane(uniforms);
    corridor.add(reflectionPlane);
    group.userData.reflectionPlane = reflectionPlane;

    const traffic = createSkyTraffic();
    corridor.add(traffic);
    group.userData.traffic = traffic;

    // Ambient from the chapter profile (one source of truth with the director's blended
    // atmosphere; was a hardcoded cyan-leaning 0x101a2a/0.45 that disagreed with the
    // profile's violet 0x2a1a3a/0.4). Only the lit materials here (the level-node rings)
    // read it — the city itself is unlit node materials — so it now tints them violet.
    const { atmosphere } = getChapterProfile(8);
    group.add(acquireChapterLight(8, 'AmbientLight', {
        color: atmosphere.ambientLight,
        intensity: atmosphere.ambientIntensity,
    }));

    // Anchor to the path's FULL centre (x/y/z), not just Y, so the city corridor, ring
    // gates and spire stay aligned to the route and the path never clips chapter geometry.
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    // FogExp2 WASHOUT fix (backlog #3): this is a neon NIGHT-CITY set-piece, not a foggy
    // scene — the profile runs a violet FogExp2 at density 0.012, which at the spire/sun
    // depth (z≈−600..−690) reaches ~100% and flattens every additive neon surface into a
    // uniform violet blob. The city's depth comes from its own sky dome, ground haze pools
    // and additive falloff, not scene fog. Disable fog on every material so the neon reads
    // at full saturation (mirrors the Ch7 space-scene fix + deep-ocean's distant creatures).
    group.traverse((child) => {
        if (!child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => { m.fog = false; });
    });

    return group;
}

export function updateUrbanDreamsEnvironment(group, delta, time, camera, ...updateArgs) {
    // ChapterEnvironmentManager calls update(group, delta, time, camera, cameraProgress,
    // directorState): updateArgs[0] is the 0..1 path progress, [1] the director state.
    const [cameraProgress = null, directorState = null] = updateArgs;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    // The encore grooves hardest — autonomous breath until Phase 6 drives audio.
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp(
                (directorState.energy || 0) * 0.58
                    + (directorState.mid || 0) * 0.22
                    + (directorState.treble || 0) * 0.2,
                0,
                1,
            )
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.45 + Math.sin(time * 0.8) * 0.28
            : 0.34 + audioEnergy * 0.72 + (directorState.beatPulse || 0) * 0.12;
    }
    const energy = uniforms?.uEnergy?.value ?? 0.45;

    const { rails } = group.userData;
    if (rails?.children) {
        rails.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.18 + index * 0.05);
        });
    }

    // THE TOWERS OCCLUDE FIRST (seamless pass). The facade has no uOpacity bridge, so the
    // environment manager makes it transparent:true for the 7->8 crossfade (QW5), and in the
    // transparent queue renderOrder outranks depth: the sky dome (-100), horizon haze (-98),
    // Retrosun (-95), skyline cards (-88/-86), the 720 x 1400 street (-80) and the haze stack
    // (-70) all drew IN FULL before the towers that cover ~2/3 of the frame, and the towers then
    // painted over them — several screens of blended fill nobody saw. Once the city is fully
    // present the towers go to the FRONT of the queue (-150): their depth then early-rejects
    // everything behind them, and at opacity 1 normal blending replaces, so the frame is
    // identical. During the crossfade they keep the default order, so a half-faded city never
    // punches tower-shaped holes in chapter 7's sky. A sort key, not a material change: no
    // pipeline is rebuilt.
    const { cityTowers } = group.userData;
    if (cityTowers) {
        cityTowers.renderOrder = (group.userData.chapterOpacity ?? 1) >= 0.999 ? -150 : 0;
    }

    // Rain now falls in the shader: the rain material's positionNode derives a uTime-driven
    // sawtooth Y per streak (createRainCurtain), so there is NO per-frame CPU loop over the
    // aBase array and NO needsUpdate re-upload here anymore (Batch5). uTime was already
    // ticked above, which is all the rain animation needs.

    // FINALE CLOCK (2026-10): ONE in-chapter clock shared with the camera crane and the post
    // ignition swell (composition/odyssey-stage-frame.js). The old ramp used GLOBAL progress
    // (p-0.82)/0.18, which started back in chapter 6 — the player arrived to a spire already
    // ~88 % ignited, and the crane fired after the ignition was over. Now: a dark arrival,
    // ignition across chapter-local 0.35→0.9 (camera crane + bloom swell together), then a
    // settle. Unknown progress (pilot/standalone) idles at a lit baseline.
    const positions = getActiveOdysseyChapterPositions();
    const local = Number.isFinite(cameraProgress)
        ? urbanLocalProgress(cameraProgress, positions[7], positions[8] ?? 1)
        : null;
    const easedReveal = local === null ? 0.6 : urbanIgnition(local);
    const resolve = local === null ? 0 : urbanResolve(local);

    // Publish the ignition state at the group level for the deferred serial batches:
    // B7 reads `reveal`/`progress` to drive the camera crane (camUp 1.5→6, lookUp 2.5→7
    // over the last 18%); B4 reads them for the ch8 exposure/bloom swell. `uReveal` mirrors
    // the eased value so a TSL consumer can bind it directly.
    group.userData.reveal = easedReveal;
    group.userData.resolve = resolve;
    group.userData.progress = cameraProgress ?? 0;

    // CITY IGNITION: the arrival city is dim (fewer lit floors); as the spire fires, a ring
    // of light expands from its base across the city (buildings inside the ring switch to
    // their ignited floor count), reaching past the camera by the end of the ignition.
    if (uniforms?.uCityLight) {
        uniforms.uCityLight.value = 0.62;
        uniforms.uIgniteRadius.value = easedReveal * 820;
        // RESOLVE: a third of the buildings gutter out one by one over the last tenth; the
        // spire, hero trims and the Retrosun stay lit for the held final frame.
        uniforms.uDim.value = resolve * 0.34;
        // The rain thins out with the resolve.
        if (uniforms.uRainDensity) uniforms.uRainDensity.value = 1 - resolve * 0.7;
    }
    if (group.userData.uReveal) {
        group.userData.uReveal.value = easedReveal;
    }

    // SYNTHWAVE SUN heats up / swells with the same finale ignition as the spire
    // conduit — but with a VISIBILITY FLOOR (creative plan ch8 item 1: the disc never
    // landed on screen because the pre-ignition reveal drove its gain toward zero).
    // The sun now idles alive at the configured floor and heats to full at the finale.
    const { sun } = group.userData;
    if (sun?.userData?.uReveal) {
        sun.userData.uReveal.value = CH8_RETROSUN_STAGE.revealFloor
            + easedReveal * (1 - CH8_RETROSUN_STAGE.revealFloor);
    }

    // EXIT DIMMING (creative plan Transition Out): over the resolve (chapter-local 0.9→1,
    // the same finale clock) windows and signs dim through the shared energy uniform while
    // the reveal-driven sun stays the LAST THING LIT. (Was keyed to global p 0.965, i.e.
    // it dimmed the city 85 % from 14 % into the chapter — during the ignition.)
    if (uniforms?.uEnergy && local !== null) {
        uniforms.uEnergy.value *= (1 - resolve * 0.6);
    }

    const { spire } = group.userData;
    if (spire) {
        spire.rotation.y = Math.sin(time * 0.18) * 0.06;

        if (spire.userData.uReveal) {
            spire.userData.uReveal.value = easedReveal;
        }
        if (spire.userData.beacon) {
            spire.userData.beacon.intensity = 0.7
                + Math.sin(time * 3.0) * 0.3
                + energy * 0.4
                + easedReveal * 2.3; // beacon flares to ~3.0 as the reveal completes
        }
        // EXPANDING SHOCK RING from the crown — scales outward (eased) and fades as the
        // reveal completes, a triumphant additive pulse. Idle (reveal≈0) keeps it tiny and
        // transparent; on ignition it sweeps out across the canyon then fades.
        const { shockRing } = spire.userData;
        if (shockRing) {
            // The ignited beacon's HEARTBEAT: a thin ring launches from the crown every ~4.2 s,
            // expands across the skyline and fades — silent before ignition (one motion
            // accent for the finale shot). Radius in world units (unit-radius torus).
            const phase = (time / 4.2) % 1;
            shockRing.scale.setScalar(24 + phase * 520);
            const fade = (1 - phase) * (1 - phase);
            shockRing.material.opacity = THREE.MathUtils.clamp(easedReveal * fade * 0.62, 0, 0.62);
        }
    }

    const { traffic } = group.userData;
    if (traffic?.children) {
        traffic.children.forEach((trail, index) => {
            if (trail.userData.hero) {
                // Hero trails sway gently in place near the finale.
                trail.position.x = Math.sin(time * 0.4 + index) * 18;
                return;
            }
            // Streak each trail FORWARD down the canyon (advancing head); wrap back to the
            // near end when it passes the far end so the traffic flows continuously.
            const baseZ = trail.userData.baseZ ?? 0;
            const span = 760;
            const travelled = (time * (trail.userData.speed ?? 80)) % span;
            trail.position.z = -travelled; // advance toward the finale (-Z)
            // Respawn wrap keeps the trail within the corridor (baseZ is the curve anchor).
            if (baseZ - travelled < -680) {
                trail.position.z = -travelled + span;
            }
            trail.position.x = Math.sin(time * 0.6 + index) * 3; // slight lateral drift
        });
    }
}

export default {
    config: URBAN_DREAMS_CONFIG,
    create: createUrbanDreamsEnvironment,
    update: updateUrbanDreamsEnvironment,
};

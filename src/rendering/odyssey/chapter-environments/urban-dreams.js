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
    float,
    fract,
    oneMinus,
    sin,
    smoothstep,
    uniform,
    uv,
    vec3,
} from 'three/tsl';
import {
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../path-utils.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import {
    createSkyGradientTSL,
    createSynthwaveSunTSL,
    createCityBlocksTSL,
    createCurtainWallTSL,
    createNeonCitySpireTSL,
    createHologramSignsTSL,
    createWetReflectionPlaneTSL,
    createGroundHazeTSL,
    createNeonHazeStackTSL,
    createSkylineSilhouetteTSL,
    createHorizonHazeTSL,
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
    sun: [0, 28, -700],
    skylineNear: [0, -42, -650],
    skylineFar: [40, -54, -675],
    horizonHaze: [0, -12, -688],
});

const CYAN = 0x00f2ff;
const MAGENTA = 0xff3fb4;

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

function createCityBlocks(uniforms) {
    const { group } = createCityBlocksTSL(uniforms.uTime, uniforms.uEnergy);
    group.name = 'city-blocks';
    return group;
}

function createCurtainWall(uniforms) {
    const { group } = createCurtainWallTSL(uniforms.uTime, uniforms.uEnergy);
    group.name = 'curtain-wall-backdrop';
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

// Rain wrap geometry: streaks spawn across this Y span and fall (world -Y), respawning at
// the top once they pass the bottom. These constants mirror the former CPU loop's bounds
// (spawn ~[-120, 240], floor -150) so the look is unchanged — the fall is now a uTime-driven
// sawtooth in the shader instead of a per-frame JS rewrite of the aBase array (Batch5).
const RAIN_SPAN_TOP = 240; // respawn height
const RAIN_SPAN_BOTTOM = -150; // floor before wrap
const RAIN_SPAN = RAIN_SPAN_TOP - RAIN_SPAN_BOTTOM; // 390
const RAIN_FALL_SPEED = 96; // world units/sec (≈ 1.6/frame × 60fps, matches old loop)

function createRainCurtain(uniforms) {
    const uTime = uniforms?.uTime ?? uniform(0);
    const count = 340;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    // Per-streak phase + speed jitter so the curtain doesn't fall in lockstep (replaces the
    // former `(index % 5) * 0.08` per-streak speed variance from the CPU loop).
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        // WORLD-space spread around the near-vertical climb the camera makes through this
        // chapter. The rain mesh lives on the UNROTATED group, so X/Z are lateral and Y is
        // the climb axis (and gravity). A wide X/Z box blankets the canyon; a tall Y range
        // keeps streaks present from below the camera up past the finale spire ahead.
        positions[stride] = (Math.random() - 0.5) * 280;
        positions[stride + 1] = Math.random() * 360 - 120; // initial Y (also the phase seed)
        positions[stride + 2] = (Math.random() - 0.5) * 280;
        sizes[index] = 2.5 + Math.random() * 3.5;
        phases[index] = Math.random(); // 0..1 fall-cycle offset
        speeds[index] = 0.86 + (index % 5) * 0.05; // mild per-streak speed variance
    }

    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU). The fall animation
    // is now driven entirely in the shader from `uTime` + per-instance phase/speed — no
    // per-frame CPU loop over the aBase array and no needsUpdate re-upload (Batch5). aBase
    // holds the static spawn X/Z and the streak's seed Y; the shader computes the falling Y.
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aRainPhase: { array: phases, itemSize: 1 },
        aRainSpeed: { array: speeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aRainPhase = attribute('aRainPhase', 'float');
    const aRainSpeed = attribute('aRainSpeed', 'float');

    // uTime-driven falling Y: a per-streak sawtooth wrapping over [BOTTOM, TOP]. fract()
    // gives the 0..1 cycle position; map it down from TOP so 0 = just respawned at the top
    // and 1 = at the floor. Phase + speed are per-instance so streaks fall out of lockstep.
    const cycle = fract(
        aRainPhase.add(uTime.mul(RAIN_FALL_SPEED / RAIN_SPAN).mul(aRainSpeed)),
    );
    const fallY = float(RAIN_SPAN_TOP).sub(cycle.mul(RAIN_SPAN));
    const center = vec3(aBase.x, fallY, aBase.z);

    // World-space billboard half-extent (pixel gl_PointSize → small world size).
    const positionNode = billboardWorld(center, aSize.mul(0.55));

    // Narrow in x, tall in y -> a falling streak inside each sprite quad.
    const c = uv().sub(0.5);
    const streak = smoothstep(0.5, 0.0, c.x.abs().mul(7.0)).mul(smoothstep(0.5, 0.0, c.y.abs()));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(0.72, 0.95, 1.0);
    material.opacityNode = clamp(streak.mul(0.5), 0.0, 1.0);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

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

function createHologramSigns(uniforms) {
    const { group } = createHologramSignsTSL(uniforms.uTime, uniforms.uEnergy);
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
    const trailMaterial = (color) => new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const cyanTrail = trailMaterial(CYAN);
    const magentaTrail = trailMaterial(MAGENTA);
    const matFor = (color) => (color === CYAN ? cyanTrail : magentaTrail);

    // ~16 trails streaking FORWARD down the canyon at varied heights and depths across the
    // full nearZ→farZ span (not clustered at the finale). Brighter + thicker so they READ
    // as flying traffic instead of invisible threads; an advancing head / fading tail are
    // animated in update() by sliding each trail along its forward axis.
    const TRAIL_COUNT = 16;
    for (let index = 0; index < TRAIL_COUNT; index += 1) {
        const t = index / (TRAIL_COUNT - 1);
        const baseZ = 20 + (-1080 - 20) * t; // near → far down the corridor
        const lane = ((index % 4) - 1.5) * 70; // weave laterally across the lane
        const h = -20 + ((index * 37) % 160); // varied heights between street and skyline
        // Each trail runs forward (toward the finale, -Z) so it streaks down the canyon.
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(lane - 26, h + 8, baseZ + 60),
            new THREE.Vector3(lane, h, baseZ),
            new THREE.Vector3(lane + 24, h - 6, baseZ - 70),
        ]);
        const trail = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 36, 0.7, 7, false),
            matFor(colors[index % colors.length]),
        );
        trail.userData.speed = 80 + index * 9; // world units/sec streaking forward
        trail.userData.baseZ = baseZ;
        group.add(trail);
    }

    // 1–2 bright HERO trails sweeping near the finale spire for a final flourish.
    [-1, 1].forEach((side, i) => {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(side * 120, 70 + i * 30, -460),
            new THREE.Vector3(side * 30, 120 + i * 20, -540),
            new THREE.Vector3(-side * 90, 60 + i * 30, -640),
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
    // in z but climbs steadily in y near the finale).
    const forward = new THREE.Vector3();
    const SAMPLES = 16;
    const sample = new THREE.Vector3();
    for (let i = 0; i <= SAMPLES; i += 1) {
        const t = tStart + (tEnd - tStart) * (i / SAMPLES);
        curve.getTangentAt(t, sample).normalize();
        forward.add(sample);
    }
    if (forward.lengthSq() < 1e-6) {
        return quaternion;
    }
    forward.normalize();

    // Build a basis whose local +Z = -forward (so local -Z = camera forward). Near-vertical
    // tangents make world-up degenerate, so fall back to world +Z as the reference up.
    const worldUp = new THREE.Vector3(0, 1, 0);
    const refUp = Math.abs(forward.dot(worldUp)) > 0.9
        ? new THREE.Vector3(0, 0, 1)
        : worldUp;
    const zAxis = forward.clone().multiplyScalar(-1);
    const xAxis = new THREE.Vector3().crossVectors(refUp, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    quaternion.setFromRotationMatrix(basis);
    return quaternion;
}

export function createUrbanDreamsEnvironment() {
    const group = new THREE.Group();
    group.name = 'urban-dreams-environment';
    group.userData.chapterId = 8;

    // Shared TSL uniform nodes — passed INTO every .tsl builder so the materials and
    // this file's update() tick the same uTime/uEnergy. `.value` is mutated each frame.
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.45),
    };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(8);
    const chapterCenterY = chapterRange?.center.y
        ?? (URBAN_DREAMS_CONFIG.yStart + URBAN_DREAMS_CONFIG.yEnd) / 2;

    // Always set the chapter bounds so downstream consumers (getChapterAtPosition,
    // opacity blending) never see undefined, even if the path lookup fails.
    group.userData.yStart = chapterRange?.start.y ?? URBAN_DREAMS_CONFIG.yStart;
    group.userData.yEnd = chapterRange?.end.y ?? URBAN_DREAMS_CONFIG.yEnd;

    // Sky dome + ambient are directionless backdrops — they stay on the (unrotated)
    // environment group so the dome wraps the whole scene normally.
    const sky = createSkyGradient(uniforms);
    sky.renderOrder = -100;
    group.add(sky);

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

    // Continuous dark curtain-wall backdrop per side FIRST (behind everything) so the void
    // between canyon towers always shows a dim lit wall, never raw black.
    const curtainWall = createCurtainWall(uniforms);
    corridor.add(curtainWall);
    group.userData.curtainWall = curtainWall;

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
    horizonHaze.mesh.renderOrder = -90;
    corridor.add(horizonHaze.mesh);
    group.userData.horizonHaze = horizonHaze.mesh;

    // GATE BRIDGE landmark (creative plan ch8 item 4): a horizontal sky-bridge spanning
    // the canyon at the mid-corridor station; the camera passes UNDER it — the
    // compression-and-release beat that breaks the duplicate mid-chapter frames. One
    // oversized magenta holo-billboard hangs from the deck.
    const gateBridge = new THREE.Group();
    gateBridge.name = 'gate-bridge';
    const bridgeMaterial = new THREE.MeshBasicMaterial({ color: 0x07060f });
    const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(190, 9, 16), bridgeMaterial);
    bridgeDeck.position.y = 42;
    gateBridge.add(bridgeDeck);
    [-88, 88].forEach((pylonX) => {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(10, 110, 12), bridgeMaterial);
        pylon.position.set(pylonX, -8, 0);
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
    holoMaterial.opacityNode = holoEdge.mul(0.75);
    holoMaterial.transparent = true;
    holoMaterial.depthWrite = false;
    holoMaterial.side = THREE.DoubleSide;
    holoMaterial.blending = THREE.AdditiveBlending;
    holoMaterial.userData.emitsBloom = true;
    const holoBillboard = new THREE.Mesh(new THREE.PlaneGeometry(64, 22), holoMaterial);
    holoBillboard.position.y = 24;
    gateBridge.add(holoBillboard);
    gateBridge.position.set(0, 0, -300);
    gateBridge.traverse((child) => { child.frustumCulled = false; });
    corridor.add(gateBridge);
    group.userData.gateBridge = gateBridge;

    const cityBlocks = createCityBlocks(uniforms);
    corridor.add(cityBlocks);
    group.userData.cityBlocks = cityBlocks;

    const rails = createNeonRails();
    corridor.add(rails);
    group.userData.rails = rails;

    const haze = createGroundHaze(uniforms);
    corridor.add(haze);

    // Volumetric neon haze columns filling the lane air (cyan low / magenta high).
    const hazeStack = createNeonHazeStack(uniforms);
    corridor.add(hazeStack);
    group.userData.hazeStack = hazeStack;

    // Rain stays on the UNROTATED group (like every other shared billboard, which only
    // tolerates a pure-translation model matrix — a rotated parent would tilt the
    // camera-facing quads). It is spread in WORLD space around the climbing path and falls
    // in world -Y, which reads as near-vertical streaks down the frame. The fall is driven
    // in-shader from the shared uTime (Batch5) — no per-frame aBase rewrite.
    const rain = createRainCurtain(uniforms);
    group.add(rain);
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

    const signs = createHologramSigns(uniforms);
    corridor.add(signs);
    group.userData.signs = signs;

    const reflectionPlane = createWetReflectionPlane(uniforms);
    corridor.add(reflectionPlane);
    group.userData.reflectionPlane = reflectionPlane;

    const traffic = createSkyTraffic();
    corridor.add(traffic);
    group.userData.traffic = traffic;

    // Subtle cool ambient so the facades cohere as one city against true black instead
    // of scattered bright blocks; the cyan-leaning tint ties the lit windows together.
    group.add(new THREE.AmbientLight(0x101a2a, 0.45));

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

    // Rain now falls in the shader: the rain material's positionNode derives a uTime-driven
    // sawtooth Y per streak (createRainCurtain), so there is NO per-frame CPU loop over the
    // aBase array and NO needsUpdate re-upload here anymore (Batch5). uTime was already
    // ticked above, which is all the rain animation needs.

    // FINALE REVEAL: as path progress approaches 100% the megastructure ignites — the
    // closing payoff staged behind the final node. The reveal ramps over the last stretch
    // of the journey (0 below ~82% → 1 at the end); when progress is unknown (pilot/
    // standalone) it idles at a lit baseline so the spire is never dead.
    const reveal = cameraProgress === null
        ? 0.6
        : THREE.MathUtils.clamp((cameraProgress - 0.82) / 0.18, 0, 1);
    // Ease the ignition (smootherstep) for a graceful crescendo.
    const easedReveal = reveal * reveal * (3 - 2 * reveal);

    // Publish the ignition state at the group level for the deferred serial batches:
    // B7 reads `reveal`/`progress` to drive the camera crane (camUp 1.5→6, lookUp 2.5→7
    // over the last 18%); B4 reads them for the ch8 exposure/bloom swell. `uReveal` mirrors
    // the eased value so a TSL consumer can bind it directly.
    group.userData.reveal = easedReveal;
    group.userData.progress = cameraProgress ?? 0;
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

    // EXIT DIMMING (creative plan Transition Out): across the journey's very end the
    // city gutters out — windows and signs dim through the shared energy uniform while
    // the reveal-driven sun stays the LAST THING LIT, its ember sinking as the encore
    // resolves (the hint of descent back toward the core).
    if (uniforms?.uEnergy && Number.isFinite(cameraProgress)) {
        const dimT = THREE.MathUtils.smoothstep(cameraProgress, 0.965, 1.0);
        uniforms.uEnergy.value *= (1 - dimT * 0.85);
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
                + reveal * 2.3; // beacon flares to ~3.0 as the reveal completes
        }
        // EXPANDING SHOCK RING from the crown — scales outward (eased) and fades as the
        // reveal completes, a triumphant additive pulse. Idle (reveal≈0) keeps it tiny and
        // transparent; on ignition it sweeps out across the canyon then fades.
        const { shockRing } = spire.userData;
        if (shockRing) {
            // A travelling pulse: phase loops once reveal is high so the ring keeps pulsing.
            const pulse = (easedReveal * 0.7 + (Math.sin(time * 1.1) * 0.5 + 0.5) * 0.3);
            const ringScale = 1 + pulse * 34; // expands up to ~34× its base radius
            shockRing.scale.setScalar(ringScale);
            // Brightest mid-expansion, fading as it grows — gated by reveal so it's silent
            // before ignition. Capped well below 1.0 (soft additive, bloom gilds it).
            shockRing.material.opacity = THREE.MathUtils.clamp(
                easedReveal * (1 - pulse) * 0.85,
                0,
                0.7,
            );
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
            const span = 1100;
            const travelled = (time * (trail.userData.speed ?? 80)) % span;
            trail.position.z = -travelled; // advance toward the finale (-Z)
            // Respawn wrap keeps the trail within the corridor (baseZ is the curve anchor).
            if (baseZ - travelled < -1120) {
                trail.position.z = -travelled + span;
            }
            trail.position.x = Math.sin(time * 0.6 + index) * 8; // slight lateral drift
        });
    }
}

export default {
    config: URBAN_DREAMS_CONFIG,
    create: createUrbanDreamsEnvironment,
    update: updateUrbanDreamsEnvironment,
};

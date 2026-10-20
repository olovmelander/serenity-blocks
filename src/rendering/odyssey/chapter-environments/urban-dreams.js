/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Urban Dreams Environment - Chapter 8 Visual Theme (the encore)
 *
 * The electric coda: a neon megastructure rising over a procedurally-lit night
 * city, wet reflections, holographic signage, sky traffic and rain. Part of the
 * Odyssey AAA "Cosmic Ascent" overhaul (Phase 4 — chapter level-up); see
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6. This is the highest-contrast world.
 *
 * THE NEON CITY (2026-10-20 overhaul, after the Neon District theme — Olov: "can chapter 8
 * be inspired from Neon District?"; record docs/ODYSSEY_OVERHAUL_CH8_2026-10.md). A rain-soaked
 * city seen from the rail ~70 u above its boulevard, powered by the spire:
 *   0  Sky          — a ceiling of smog lit from below by the city (urban-dreams.tsl.js)
 *   1  Hero anchor  — the conduit megastructure spire, a needle mast and a blinking beacon
 *   2  The city     — instanced towers LIT BY THE CITY (glow map, ledges, wet glass), roofs
 *   3  The air      — haze + a street mist integrated along the view ray, carrying the signs'
 *                     colour (shared/odyssey-neon-light.tsl.js)
 *   4  The neon     — tube blades, fascias, roof boxes, giant LED screens and their halos
 *                     (shared/odyssey-neon-signs.tsl.js), from one plan that also bakes the
 *                     glow map (shared/odyssey-neon-city-plan.js)
 *   5  Street life  — the wet boulevard with rivers of traffic, lantern strings, skybridges,
 *                     sky traffic, rain lit by what is behind it
 * The ignition ring from the spire (urbanIgnition) switches the city on: signs spell on as it
 * passes, the mist and the windows come up, the hero trims fill like meters.
 *
 * Everything lives in the CORRIDOR (a group rotated into the stage frame the camera rides);
 * materials read their corridor position from `neon.cityFromWorld`, set in update().
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { acquireChapterLight } from './shared/chapter-light-pool.js';
import { getChapterProfile } from './shared/chapter-profile.js';
import { pickByQualityTier } from './shared/odyssey-quality-tier.js';
import { resolveSunCarry } from './urban-dreams-sun-carry.js';
import {
    RETROSUN_CITY_POS,
    bakeNeonGlow,
    dealCityTowers,
    planNeonSigns,
} from './shared/odyssey-neon-city-plan.js';
import { createNeonCityUniforms, createNeonGlowTexture } from './shared/odyssey-neon-light.tsl.js';
import { createNeonRain } from './shared/odyssey-neon-rain.tsl.js';
import {
    createNeonGlyphTexture,
    createNeonSignHalos,
    createNeonSigns,
} from './shared/odyssey-neon-signs.tsl.js';
import { createNeonTraffic } from './shared/odyssey-neon-traffic.tsl.js';
import { createNeonLanterns } from './shared/odyssey-neon-lanterns.tsl.js';
import { createNeonSkybridges } from './shared/odyssey-neon-skybridges.tsl.js';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathCurve,
} from '../path-utils.js';
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
    createWetReflectionPlaneTSL,
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
    // Raised 28 → 110 with the disc shrink: the sun now sits ON the skyline (its lower third
    // behind the far rooftops) instead of below the canyon's sightline.
    sun: [...RETROSUN_CITY_POS],
    skylineNear: [0, -42, -650],
    skylineFar: [40, -54, -675],
    // Behind the lane, just past the last back rank (nearZ 130 + 9 ranks ~ z 370).
    skylineBackNear: [0, -42, 420],
    skylineBackFar: [-40, -54, 445],
    // Behind the sun (was -688, IN FRONT of it: once the disc shrank to a readable size the
    // haze band covered it entirely).
    horizonHaze: [0, -12, -730],
});

/**
 * Per-quality-tier set dressing (seamless pass). Chapters used to get only a particle count,
 * so Lane B (Medium, the iGPU) paid the full High city. `high` is the authored city. Medium
 * keeps the composition and thins the rain; Low also drops the two outermost tower banks
 * (the skyline cards hold the horizon behind them) and every other holo sign.
 */
export const CH8_QUALITY_TIERS = Object.freeze({
    high: Object.freeze({
        towerBanks: 6, signStride: 1, rain: 1400, traffic: 180,
    }),
    medium: Object.freeze({
        towerBanks: 6, signStride: 1, rain: 900, traffic: 140,
    }),
    low: Object.freeze({
        towerBanks: 4, signStride: 2, rain: 520, traffic: 90,
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The urban energy breath (audio-driven when the director runs, autonomous otherwise) — one
 * function, so chapter 7's copy of the Retrosun breathes exactly like the real one.
 * @param {number} time chapter clock (s)
 * @param {object|null} directorState
 * @returns {number}
 */
export function resolveUrbanEnergy(time, directorState = null) {
    if (!directorState) return 0.45 + Math.sin(time * 0.8) * 0.28;
    const audioEnergy = THREE.MathUtils.clamp(
        (directorState.energy || 0) * 0.58
            + (directorState.mid || 0) * 0.22
            + (directorState.treble || 0) * 0.2,
        0,
        1,
    );
    return 0.34 + audioEnergy * 0.72 + (directorState.beatPulse || 0) * 0.12;
}

/**
 * The Retrosun's heat for a global progress (its visibility floor, then the finale ignition).
 * Shared with chapter 7's copy of the sun.
 */
export function resolveRetrosunReveal(progress) {
    const positions = getActiveOdysseyChapterPositions();
    const local = Number.isFinite(progress)
        ? urbanLocalProgress(progress, positions[7], positions[8] ?? 1)
        : null;
    const ignition = local === null ? 0.6 : urbanIgnition(local);
    return CH8_RETROSUN_STAGE.revealFloor + ignition * (1 - CH8_RETROSUN_STAGE.revealFloor);
}

/**
 * World position of the Retrosun's centre and the city's stage orientation — chapter 8's
 * anchor (the path centre) with the corridor rotation applied to CH8_RETROSUN_STAGE.sun.
 * Chapter 7's 7->8 carry glides Gargantua onto this and seats its sun copy on it.
 * @returns {{position: THREE.Vector3, quaternion: THREE.Quaternion}|null}
 */
export function resolveRetrosunStage() {
    const range = getChapterPathRange(8);
    if (!range?.center) return null;
    const quaternion = computeCorridorOrientation();
    const position = new THREE.Vector3(...CH8_RETROSUN_STAGE.sun).applyQuaternion(quaternion).add(range.center);
    return { position, quaternion };
}

function createSkyGradient(uniforms, neon) {
    const { mesh } = createSkyGradientTSL(uniforms.uTime, uniforms.uEnergy, {
        uReveal: neon?.reveal,
        uStorm: neon?.storm,
    });
    return mesh;
}

/**
 * Sheet lightning in the smog: one flash (a double flicker that dies in ~0.6 s) at a hashed
 * moment of every 26 s window of the chapter clock. Closed form in the clock (a fixed rate),
 * so a seek or a capture lands on the same sky every time.
 * @param {number} time chapter clock (s)
 * @returns {number} 0..1
 */
export function resolveUrbanStorm(time) {
    if (!Number.isFinite(time)) return 0;
    const PERIOD = 26;
    const k = Math.floor(time / PERIOD);
    const h = Math.abs(Math.sin(k * 12.9898 + 78.233) * 43758.5453) % 1;
    const age = time - (k * PERIOD + 4 + h * 18);
    if (age < 0 || age > 1.2) return 0;
    let flicker = 0.85;
    if (age < 0.09) flicker = 1;
    else if (age < 0.16) flicker = 0.25;
    return flicker * Math.exp(-age * 5.5);
}

function createSynthwaveSun(uniforms) {
    // Own reveal uniform so the sun swells/heats with the finale ignition; the chapter
    // update() mirrors the eased reveal into it alongside the spire conduit's uReveal.
    const uReveal = uniform(CH8_RETROSUN_STAGE.revealFloor);
    const { mesh } = createSynthwaveSunTSL(uniforms.uTime, uniforms.uEnergy, { uReveal });
    mesh.userData.uReveal = uReveal;
    return mesh;
}

function createCityBlocks(uniforms, tier = CH8_QUALITY_TIERS.high, neon = null) {
    const { group } = createCityBlocksTSL(uniforms.uTime, uniforms.uEnergy, {
        neon,
        uCityLight: uniforms.uCityLight,
        uIgniteRadius: uniforms.uIgniteRadius,
        uDim: uniforms.uDim,
        bankCount: tier.towerBanks,
    });
    group.name = 'city-blocks';
    return group;
}

function createNeonCitySpire(uniforms) {
    const { group } = createNeonCitySpireTSL(uniforms.uTime, uniforms.uEnergy);
    group.name = 'neon-megastructure-spire';
    return group;
}

/**
 * The neon (2026-10-20, after Neon District): tube blades down both walls of the boulevard, lit
 * fascias over the shopfronts, light boxes on the low roofs, each with a soft halo in the wet
 * air. Two draws for every sign in the city. Low keeps every other sign.
 */
function createNeonSignStack(neon, plan, tier = CH8_QUALITY_TIERS.high) {
    const stride = Math.max(1, tier.signStride ?? 1);
    const drawn = stride > 1 ? plan.signs.filter((_, i) => i % stride === 0) : plan.signs;
    const group = new THREE.Group();
    group.name = 'neon-sign-stack';
    group.add(createNeonSigns(neon, drawn, createNeonGlyphTexture()));
    group.add(createNeonSignHalos(neon, drawn));
    return group;
}

function createWetReflectionPlane(uniforms, neon, uSunVisible) {
    const { mesh } = createWetReflectionPlaneTSL(uniforms.uTime, uniforms.uEnergy, { neon, uSunVisible });
    mesh.name = 'wet-neon-reflection-plane';
    return mesh;
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

    // THE NEON CITY (2026-10-20, after Neon District): one plan deals the towers, the signs hung
    // on them and the GLOW MAP of what those signs throw; every surface of the city (walls,
    // street, rain, mist) reads its light from that map and stands in the same air
    // (shared/odyssey-neon-light.tsl.js). The plan is dealt from the tier's own towers, which
    // are identical on every tier (only the outermost banks drop).
    const cityPlanTowers = dealCityTowers(tier.towerBanks);
    const neonPlan = planNeonSigns(cityPlanTowers);
    const neon = createNeonCityUniforms(uniforms, createNeonGlowTexture(bakeNeonGlow(neonPlan.signs)));
    // How much of the Retrosun the street's mirror shows (its crossfade weight, from update()).
    neon.sunVisible = uniform(0);
    // Sheet lightning in the smog (resolveUrbanStorm).
    neon.storm = uniform(0);
    group.userData.neon = neon;
    group.userData.neonPlan = neonPlan;

    const chapterRange = getChapterPathRange(8);
    const chapterCenterY = chapterRange?.center.y
        ?? (URBAN_DREAMS_CONFIG.yStart + URBAN_DREAMS_CONFIG.yEnd) / 2;

    // Always set the chapter bounds so downstream consumers (getChapterAtPosition,
    // opacity blending) never see undefined, even if the path lookup fails.
    group.userData.yStart = chapterRange?.start.y ?? URBAN_DREAMS_CONFIG.yStart;
    group.userData.yEnd = chapterRange?.end.y ?? URBAN_DREAMS_CONFIG.yEnd;

    const sky = createSkyGradient(uniforms, neon);
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
    // ...and the same two ranks BEHIND the lane, past the back ranks (CH8_CITY_LAYOUT.backRanks),
    // turned to face back up it: looking back, the canyon ends on rooftops against the horizon
    // glow instead of on the bare glow itself.
    const skylineBack = [
        [skylineNear, CH8_RETROSUN_STAGE.skylineBackNear, 0],
        [skylineFar, CH8_RETROSUN_STAGE.skylineBackFar, 31],
    ].map(([front, at, seedOffset]) => {
        const lift = front === skylineNear ? 0.012 : 0;
        const card = createSkylineSilhouetteTSL(uniforms.uTime, { seedOffset: seedOffset + 7, lift });
        card.mesh.position.set(...at);
        card.mesh.rotation.y = Math.PI;
        card.mesh.scale.copy(front.mesh.scale);
        card.mesh.renderOrder = front.mesh.renderOrder;
        corridor.add(card.mesh);
        return card.mesh;
    });
    group.userData.skyline = [skylineNear.mesh, skylineFar.mesh, ...skylineBack];
    const horizonHaze = createHorizonHazeTSL(uniforms.uTime);
    horizonHaze.mesh.position.set(...CH8_RETROSUN_STAGE.horizonHaze);
    horizonHaze.mesh.renderOrder = -98; // after the dome, BEFORE the sun (-95)
    corridor.add(horizonHaze.mesh);
    group.userData.horizonHaze = horizonHaze.mesh;

    // SKYBRIDGES (2026-10-20, after Neon District's lit bridges over its street): three glazed
    // walkways span the boulevard between the inner towers, below the rail and at different
    // heights down the canyon — warm windows, a chasing LED strip under the glazing, a dark
    // roof with lit edges seen from the eye above. They replace the old gate bridge (a black
    // deck on pylons with a magenta scanline billboard that sat in the bottom centre of the
    // first frames). One instanced draw. The group keeps its name for the chapter's readers.
    const gateBridge = new THREE.Group();
    gateBridge.name = 'gate-bridge';
    const bridges = createNeonSkybridges(neon, cityPlanTowers);
    gateBridge.add(bridges);
    corridor.add(gateBridge);
    group.userData.gateBridge = gateBridge;

    const cityBlocks = createCityBlocks(uniforms, tier, neon);
    corridor.add(cityBlocks);
    group.userData.cityBlocks = cityBlocks;
    group.userData.cityTowers = cityBlocks.getObjectByName('city-tower-instances-tsl') ?? null;

    // Lantern strings across the boulevard below the rail (2026-10-20): rows of warm points
    // converging on the spire, the canyon floor's depth cue. They replace the nine torus ring
    // gates round the rail, and the street's air is now the neon mist (odyssey-neon-light), so
    // the nine additive haze pools and seven haze curtains that faked it are retired too.
    const lanterns = createNeonLanterns(neon);
    corridor.add(lanterns);
    group.userData.lanterns = lanterns;

    // Rain lives IN the corridor (2026-10) and falls along the CITY's down: in world space
    // the climb is nearly vertical, so the old world -Y fall streamed along the view axis
    // into the lens. The stage-space billboard keeps each streak upright on the city's up.
    const rain = createNeonRain(neon, tier.rain);
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

    const signs = createNeonSignStack(neon, neonPlan, tier);
    corridor.add(signs);
    group.userData.signs = signs;

    const reflectionPlane = createWetReflectionPlane(uniforms, neon, neon.sunVisible);
    corridor.add(reflectionPlane);
    group.userData.reflectionPlane = reflectionPlane;

    // Sky traffic (2026-10-20, after Neon District): white headlights coming up the canyon, red
    // tail lights going, streaks crossing town far down it — one draw (it was eighteen tubes).
    const traffic = createNeonTraffic(neon, tier.traffic ?? 160);
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
        uniforms.uEnergy.value = resolveUrbanEnergy(time, directorState);
    }
    const energy = uniforms?.uEnergy?.value ?? 0.45;

    // THE TOWERS OCCLUDE FIRST (seamless pass). The facade has no uOpacity bridge, so the
    // environment manager makes it transparent:true for the 7->8 crossfade (QW5), and in the
    // transparent queue renderOrder outranks depth: the sky dome (-100), horizon haze (-98),
    // Retrosun (-95), skyline cards (-88/-86) and the 720 x 1400 street (-80) all drew IN FULL
    // before the towers that cover ~2/3 of the frame, and the towers then
    // painted over them — several screens of blended fill nobody saw. Once the city is fully
    // present the towers go to the FRONT of the queue (-150): their depth then early-rejects
    // everything behind them, and at opacity 1 normal blending replaces, so the frame is
    // identical. During the crossfade they keep the default order, so a half-faded city never
    // punches tower-shaped holes in chapter 7's sky. A sort key, not a material change: no
    // pipeline is rebuilt. The manager's COVERAGE weight (the staggered schedule for opaque
    // content, full by the 7->8 boundary) decides it when present, the crossfade weight otherwise.
    const { cityTowers } = group.userData;
    if (cityTowers) {
        const towerWeight = group.userData.chapterCoverage ?? group.userData.chapterOpacity ?? 1;
        cityTowers.renderOrder = towerWeight >= 0.999 ? -150 : 0;
    }

    // Rain falls in the shader (shared/odyssey-neon-rain.tsl.js): a streak's height is a
    // function of uTime and its box follows the eye through neon.camCity (set below); there is
    // no per-frame CPU loop over the drops.

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
    // THE 7->8 CARRY (urban-dreams-sun-carry.js): across the seam window the sun is chapter 7's
    // — Gargantua's light closing into a copy of this disc, drawn identically — so this one
    // stays dark until the hand-over and then takes over at full strength (the copy hides on
    // the same frame). Overrides the crossfade weight only inside the window.
    const sunOpacity = sun?.material?.uniforms?.uOpacity;
    if (sunOpacity) {
        const carry = resolveSunCarry(cameraProgress, positions);
        const base = sunOpacity.__odysseyBaseOpacity ?? sunOpacity.value;
        if (carry?.active && base < 1) {
            sunOpacity.value = carry.handedOver ? 1 : 0;
        } else if (carry?.active) {
            sunOpacity.value = base;
        }
    }

    // THE NEON CITY's per-frame state: where the eye is in corridor space (the air, the rain's
    // box), the lens (pixel-sized rain), the ignition, and how much of the Retrosun the wet
    // street may mirror (its own crossfade weight: dark through the 7->8 carry, like the disc).
    const { neon, corridor } = group.userData;
    if (neon && corridor) {
        corridor.updateWorldMatrix(true, false);
        neon.cityFromWorld.value.copy(corridor.matrixWorld).invert();
        if (camera?.position) {
            neon.camCity.value.copy(camera.position).applyMatrix4(neon.cityFromWorld.value);
            const projY = camera.projectionMatrix?.elements?.[5];
            if (Number.isFinite(projY) && projY > 0) neon.projY.value = projY;
        }
        neon.reveal.value = easedReveal;
        if (neon.storm) neon.storm.value = resolveUrbanStorm(time) * (local === null ? 1 : 1 - resolve);
        const seamCarry = resolveSunCarry(cameraProgress, positions);
        neon.seamReveal.value = seamCarry ? THREE.MathUtils.smoothstep(seamCarry.open, 0.15, 0.85) : 1;
        if (neon.sunVisible) {
            // The disc itself switches over at the hand-over (chapter 7's copy is identical);
            // its reflection has no twin there, so it rises after it (local ~0.05 -> 0.15).
            const afterHandover = local === null ? 1 : THREE.MathUtils.smoothstep(local, 0.05, 0.15);
            neon.sunVisible.value = (sunOpacity ? sunOpacity.value : 1) * afterHandover
                * (CH8_RETROSUN_STAGE.revealFloor + easedReveal * (1 - CH8_RETROSUN_STAGE.revealFloor));
        }
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
            const fade = (1 - phase) * (1 - phase) * (1 - phase);
            shockRing.material.opacity = THREE.MathUtils.clamp(easedReveal * fade * 0.12, 0, 0.12);
        }
    }
}

export default {
    config: URBAN_DREAMS_CONFIG,
    create: createUrbanDreamsEnvironment,
    update: updateUrbanDreamsEnvironment,
};

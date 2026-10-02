/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Black Hole Transcendence Environment - Chapter 7 Visual Theme
 *
 * The journey's gravitational climax. MASTERPIECE PASS (2026-10): the chapter is now built
 * around ONE black hole read the way Interstellar's Gargantua reads, painted Ghibli-soft —
 *
 *   - a pure BLACK shadow, square to the eye, ringed by a thin blazing photon ring;
 *   - a thin, white-hot accretion band crossing in front of it, its plane tilted to within
 *     ~9° of edge-on so it reads as a blade of light, not a target;
 *   - the LENSED far side of that disk bowing over the top of the shadow (and, thinner, under
 *     it) — the fold arcs, which are what make it a black hole and not Saturn;
 *   - a Doppler-bright approaching limb, deep black space behind, and background stars that
 *     the ch7 post lens bends around the shadow; magenta/gold are accents, never a wash.
 *
 * What it replaced: the locked hero's disk faced the camera with an 18° tilt (a bullseye —
 * in-game a washed-out pale ring round a dark disc two thirds of the frame tall), a lensing
 * shell that sat INSIDE the opaque horizon and was never seen, an off-frame halo, a second
 * "entry" black hole, five secondary mini-holes with halos, three glow rings, a violet
 * camera-enveloping wash drawn with depthTest off (it painted the shadow purple), a 520 u
 * dome the camera sat OUTSIDE of (a purple noise wall), and nine flat-coloured infall tubes.
 *
 * Layers:
 *   0  Void dome        — near-black deep space with faint magenta/indigo nebulosity
 *   0b Far starfield    — a full shell behind everything (the post lens bends it)
 *   1  Gargantua        — camera-locked: face pivot (shadow, photon ring, fold arcs) +
 *                         disk pivot (the tilted accretion band) + infall embers in its plane
 *   6  Near life        — transcendence shards + corridor dust (parallax motes)
 *
 * SEAMLESS PASS (2026-10): the shadow is fade-exempt and takes over from ch6's omen shadow
 * exactly where the omen hands off; across the 7->8 window the hero glides onto the
 * Retrosun's direction, its shadow closes and its light becomes the city's sun
 * (urban-dreams-sun-carry.js).
 *
 * THE FALL (2026-10-02): the hole no longer floats beside the journey - the traveller falls into
 * it. Still camera-locked (it can never leave the frame), but its angular size is authored by
 * progress (transitions/odyssey-black-hole-fall.js): it grows until it swallows the frustum just
 * past level 52, drifting onto the view axis; the disk plane sweeps through edge-on; and the
 * shadow's surface becomes a window onto the singularity's interior - the warp tunnel
 * (createSingularityWindowTSL) - so the eye is "inside" without a cut.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { getActiveOdysseyChapterPositions, getChapterPathRange } from '../path-utils.js';
import { getChapterTransitionForChapter } from './shared/chapter-profile.js';
import { pickByQualityTier } from './shared/odyssey-quality-tier.js';
import {
    blackHoleFallAtRest,
    resolveBlackHoleFall,
    resolveBlackHoleFallDepth,
} from '../transitions/odyssey-black-hole-fall.js';
import { CH7_SUN_CARRY, resolveSunCarry } from './urban-dreams-sun-carry.js';
import { createSynthwaveSunTSL } from './urban-dreams.tsl.js';
import { resolveRetrosunReveal, resolveRetrosunStage, resolveUrbanEnergy } from './urban-dreams.js';
import {
    createVoidDomeTSL,
    createAccretionDiskTSL,
    createGargantuaPhotonRingTSL,
    createLensedFoldMaterialTSL,
    createTranscendenceShardsTSL,
    createLensingStarfieldTSL,
    createCorridorDustTSL,
    createInfallEmberFieldTSL,
    createSingularityWindowTSL,
    CH7_CORRIDOR_DUST_SETTINGS,
    CH7_STARFIELD,
    GARGANTUA_LOCK,
    resolveGargantuaFallPosition,
} from './black-hole-transcendence.tsl.js';

export const BLACK_HOLE_TRANSCENDENCE_CONFIG = {
    id: 7,
    name: 'black-hole-transcendence',
    // Spline-derived chapter y-range (matches getChapterPathRange(7)); kept here so
    // ChapterEnvironmentManager.getChapterAtPosition() and the userData fallback work
    // even if the path layout lookup is unavailable.
    yStart: 695.6,
    yEnd: 875.9,
    colors: {
        primary: 0x040208,
        secondary: 0x1b0f2d,
        tertiary: 0xff33cc,
        accent: 0x66e3ff,
        background: 0x000000,
    },
};

/**
 * The Gargantua hero, in WORLD units (no group scale). Sized so the shadow is ~25% of the
 * frame height at the lock depth and the disk band spans ~60% of a 16:9 frame.
 */
export const CH7_GARGANTUA = Object.freeze({
    // lockDepth / upBias / rightBias / shadowRadius — shared with ch6's omen handoff.
    ...GARGANTUA_LOCK,
    // Disk radii as multiples of the shadow radius.
    diskInner: 1.34,
    diskOuter: 4.8,
    // How far the disk plane is lifted out of edge-on toward the eye (rad, ~6°), and its roll
    // in the frame (rad) so the band crosses on a slight diagonal instead of a ruler line.
    // 0.16 put the band's near side across the LOWER half of the shadow; 0.10 crosses it
    // just below the middle, as Gargantua's does.
    diskTilt: 0.10,
    diskRoll: -0.10,
    // Photon ring radii as multiples of the shadow radius.
    photonInner: 1.0,
    photonOuter: 1.075,
    // Infall embers are authored at ~70-260 u; scaled onto the disk's radii.
    emberScale: 2.2,
    // Slow precession of the whole hero about the view axis (rad/s).
    precession: 0.012,
});

/**
 * The lensed far side of the disk, bowed over (and, thinner, under) the shadow. World
 * units, in the face pivot's camera-facing plane.
 */
export const CH7_FOLD_ARC_SETTINGS = Object.freeze({
    opacity: 0.85,
    sweepRatio: 0.96,
    // Coverage for the radial light profile (1.0-1.45 shadow radii): centred at 1.22 S with
    // a 0.23 S tube. The sliver inside the silhouette is depth-hidden by the shadow sphere,
    // which is exactly where the photon ring sits.
    radius: 161,
    tube: 31,
    radialSegments: 12,
    tubularSegments: 96,
});

/**
 * Sprite budgets per quality tier (seamless pass). The far starfield went 760 -> 2200 sprites
 * in the masterpiece pass and the corridor dust sits AROUND the camera (its nearest motes are
 * the biggest quads in the chapter), so Lane B (Medium, the iGPU) no longer pays the High
 * field: `stars` is the starfield count, `dust` / `embers` scale the particleCount-derived
 * densities. High is unchanged (the authored chapter).
 */
export const CH7_QUALITY_TIERS = Object.freeze({
    high: Object.freeze({ stars: CH7_STARFIELD.count, dust: 1, embers: 1 }),
    medium: Object.freeze({ stars: 1300, dust: 0.6, embers: 0.7 }),
    low: Object.freeze({ stars: 800, dust: 0.4, embers: 0.5 }),
});

// The tunnel mouth's final angular radius (rad): past the corners of a 70 deg-FOV frame.
const CH7_EXIT_MOUTH_MAX = 80 * (Math.PI / 180);

// Camera-lock scratch (reused every frame — no per-frame allocation).
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _heroWorld = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _spin = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _fwd = new THREE.Vector3();
const _toSun = new THREE.Vector3();
const _lockDir = new THREE.Vector3();
const _axis = new THREE.Vector3();

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The camera-locked Gargantua. The group itself is re-posed every frame in update(): placed
 * `lockDepth` ahead of the eye on a basis built from the CAMERA'S OWN up vector (the ch7
 * spline climbs nearly vertically at times, where a world-up basis degenerates), so the
 * shadow is always square to the eye and the disk band always reads across the frame.
 */
function createGargantua(uniforms) {
    const S = CH7_GARGANTUA.shadowRadius;
    const group = new THREE.Group();
    group.name = 'distant-background-singularity';

    // ── FACE PIVOT: shadow, photon ring and lensed fold arcs, square to the eye ──
    const face = new THREE.Group();
    face.name = 'dominant-event-horizon-anchor';
    group.add(face);

    // The shadow IS the window onto the interior (black until the fall opens it): one opaque,
    // depth-writing material either way, so nothing about its pipeline changes mid-chapter.
    const singularity = createSingularityWindowTSL(uniforms.uTime);
    const horizon = new THREE.Mesh(new THREE.SphereGeometry(S, 64, 48), singularity.material);
    horizon.name = 'gargantua-shadow';
    // FADE-EXEMPT (seamless pass; agreed interface with the environment manager): the shadow
    // is an opaque occluder through every crossfade and the chapter drives its visibility —
    // see update(). Forced transparent and faded, it and ch6's omen shadow each covered only
    // part of the hole at the 6->7 seam, and stars showed through it.
    horizon.userData.odysseyFadeExempt = true;
    face.add(horizon);

    const uSwell = uniform(0);
    const photon = createGargantuaPhotonRingTSL(uniforms.uTime, {
        innerRadius: S * CH7_GARGANTUA.photonInner,
        outerRadius: S * CH7_GARGANTUA.photonOuter,
        shadowRadius: S,
        uSwell,
    });
    photon.mesh.name = 'gargantua-photon-ring';
    face.add(photon.mesh);

    const foldArcMaterial = createLensedFoldMaterialTSL(uniforms.uTime, {
        shadowRadius: S,
        opacity: CH7_FOLD_ARC_SETTINGS.opacity,
    });
    foldArcMaterial.userData.foldArcOpacity = CH7_FOLD_ARC_SETTINGS.opacity;
    const FOLD_SWEEP = Math.PI * CH7_FOLD_ARC_SETTINGS.sweepRatio;
    const foldGeometry = new THREE.TorusGeometry(
        CH7_FOLD_ARC_SETTINGS.radius,
        CH7_FOLD_ARC_SETTINGS.tube,
        CH7_FOLD_ARC_SETTINGS.radialSegments,
        CH7_FOLD_ARC_SETTINGS.tubularSegments,
        FOLD_SWEEP,
    );
    const topFold = new THREE.Mesh(foldGeometry, foldArcMaterial);
    topFold.rotation.z = Math.PI / 2 - FOLD_SWEEP / 2; // bows OVER the shadow top
    topFold.name = 'lensed-fold-top';
    topFold.userData.readability = CH7_FOLD_ARC_SETTINGS;
    face.add(topFold);
    const bottomFold = new THREE.Mesh(foldGeometry, foldArcMaterial);
    bottomFold.rotation.z = -Math.PI / 2 - FOLD_SWEEP / 2; // bows UNDER the shadow
    // The underside image is the thinner, dimmer one (the shader dims it by `above`).
    bottomFold.name = 'lensed-fold-bottom';
    bottomFold.userData.readability = CH7_FOLD_ARC_SETTINGS;
    face.add(bottomFold);

    // ── DISK PIVOT: the accretion band, its plane lifted diskTilt out of edge-on ──
    // Euler 'ZYX': tilt about X first (ring normal +Z → mostly +Y, a little toward the eye),
    // then roll about the view axis.
    const diskPivot = new THREE.Group();
    diskPivot.name = 'gargantua-disk-pivot';
    diskPivot.rotation.order = 'ZYX';
    diskPivot.rotation.set(-(Math.PI / 2 - CH7_GARGANTUA.diskTilt), 0, CH7_GARGANTUA.diskRoll);
    group.add(diskPivot);

    const uDiskFade = uniform(1);
    const { mesh: disk } = createAccretionDiskTSL(uniforms.uTime, uniforms.uEnergy, {
        innerRadius: S * CH7_GARGANTUA.diskInner,
        outerRadius: S * CH7_GARGANTUA.diskOuter,
        uFade: uDiskFade,
    });
    disk.name = 'distant-accretion-disk';
    diskPivot.add(disk);

    group.userData.face = face;
    group.userData.diskPivot = diskPivot;
    group.userData.disk = disk;
    group.userData.horizon = horizon;
    group.userData.photonRing = photon.mesh;
    group.userData.foldArcs = [topFold, bottomFold];
    group.userData.uSwell = uSwell;
    group.userData.uDiskFade = uDiskFade;
    group.userData.singularity = singularity.uniforms;
    return group;
}

/**
 * THE SUN COPY (7->8 carry). The Retrosun's own builder with its own uniforms, which chapter 7
 * ticks with chapter 8's formulas (resolveUrbanEnergy / resolveRetrosunReveal). Parented to the
 * chapter group (translated only) and oriented on the CITY's stage frame — billboardStage takes
 * "up" from its parent frame, so the copy's gradient and scanlines sit level with the city's
 * exactly as the real disc's do. Seated on the ray to the real sun and scaled by (its distance
 * / the sun's), it projects to the same pixels. Hidden outside the carry.
 */
function createSunCopy(uniforms) {
    const uEnergy = uniform(0.45);
    const uReveal = uniform(0.62);
    const { mesh } = createSynthwaveSunTSL(uniforms.uTime, uEnergy, { uReveal });
    mesh.name = 'gargantua-sun-copy';
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.uEnergy = uEnergy;
    mesh.userData.uReveal = uReveal;
    return mesh;
}

// Chapter-local multiplier on a manager-driven opacity bridge: the environment manager writes
// the crossfade weight into `value` and records it as `__odysseyBaseOpacity`, so scaling from
// the base never compounds across frames.
function scaleBridge(uOpacity, factor) {
    if (!uOpacity) return;
    uOpacity.value = (uOpacity.__odysseyBaseOpacity ?? 1) * factor;
}

function createTranscendenceShards(uniforms) {
    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU). The vertical drift
    // runs in the TSL material (uTime + uCameraY), so update() only feeds the camera Y.
    const { mesh, uniforms: driftUniforms } = createTranscendenceShardsTSL(uniforms.uTime);
    mesh.name = 'transcendence-shards';
    mesh.userData.driftUniforms = driftUniforms;
    return mesh;
}

function createLensingStarfield(uniforms, count = CH7_STARFIELD.count) {
    // A full far shell behind everything — the ch7 post lens bends it round the shadow.
    const { mesh } = createLensingStarfieldTSL(uniforms.uTime, { count });
    mesh.name = 'lensing-starfield';
    return mesh;
}

export function createBlackHoleTranscendenceEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-environment';
    group.userData.chapterId = 7;
    const tier = pickByQualityTier(options, CH7_QUALITY_TIERS);
    group.userData.qualityTier = tier;

    // TSL uniform nodes (shared into the .tsl builders). They expose `.value`, so
    // update() (`uniforms.uTime.value = ...`) ticks them.
    const uniforms = {
        uTime: uniform(0),
        uEnergy: uniform(0.4),
    };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(7);
    const chapterCenterY = chapterRange?.center.y
        ?? (BLACK_HOLE_TRANSCENDENCE_CONFIG.yStart + BLACK_HOLE_TRANSCENDENCE_CONFIG.yEnd) / 2;

    // Always set the chapter bounds so downstream consumers (getChapterAtPosition,
    // opacity blending) never see undefined, even if the path lookup fails.
    group.userData.yStart = chapterRange?.start.y ?? BLACK_HOLE_TRANSCENDENCE_CONFIG.yStart;
    group.userData.yEnd = chapterRange?.end.y ?? BLACK_HOLE_TRANSCENDENCE_CONFIG.yEnd;

    // 0. Deep-space dome, centred on the chapter so the camera is always INSIDE it (the old
    // 520 u dome hung 740 u ahead — the camera sat outside it and saw a purple disc).
    const { mesh: voidDome } = createVoidDomeTSL(uniforms.uTime, uniforms.uEnergy);
    group.add(voidDome);
    group.userData.voidDome = voidDome;

    // 0b. Far starfield shell (behind the hero; the post lens bends it).
    const lensingStarfield = createLensingStarfield(uniforms, tier.stars);
    group.add(lensingStarfield);
    group.userData.lensingStarfield = lensingStarfield;

    // 1. Gargantua — the one hero, camera-locked in update().
    const distantHole = createGargantua(uniforms);
    group.add(distantHole);
    group.userData.distantHole = distantHole;
    group.userData.eventHorizon = distantHole.userData.face;

    // B4 HOOK: world-space centre of the camera-locked hero, refreshed every frame by
    // update(); the ch7 post lens projects it to centre the warp. `lensRadius` (world units)
    // rides on the same Vector3 so the lens can size itself to the PROJECTED shadow.
    group.userData.lensWorldPos = new THREE.Vector3(0, 120, -900);
    group.userData.lensWorldPos.lensRadius = CH7_GARGANTUA.shadowRadius;

    // Drifting dust hugging the corridor (re-centred on the camera in update()).
    const dustCount = Math.floor((options.particleCount
        ? Math.min(CH7_CORRIDOR_DUST_SETTINGS.maxCount, Math.floor(options.particleCount * 2.0))
        : 720) * tier.dust);
    const { mesh: corridorDust } = createCorridorDustTSL(uniforms.uTime, dustCount);
    corridorDust.name = 'corridor-violet-dust';
    group.add(corridorDust);
    group.userData.corridorDust = corridorDust;

    const shards = createTranscendenceShards(uniforms);
    group.add(shards);
    group.userData.shards = shards;

    // The 7->8 carry's sun copy and the real Retrosun's stage (computed once: the layout is
    // fixed by the time chapters are created).
    const sunCopy = createSunCopy(uniforms);
    group.add(sunCopy);
    group.userData.sunCopy = sunCopy;
    group.userData.retrosunStage = resolveRetrosunStage();
    if (group.userData.retrosunStage) sunCopy.quaternion.copy(group.userData.retrosunStage.quaternion);

    // Infall embers — matter in the disk plane, parented to the disk pivot so they orbit
    // IN the band (their authored orbit plane is local XZ; +90° about X lays it onto the
    // pivot's XY disk plane), scaled from their authored ~70-260 u radii onto the disk's.
    const emberCount = Math.floor((options.particleCount ? Math.floor(options.particleCount * 1.6) : 520)
        * tier.embers);
    const { mesh: infallEmbers } = createInfallEmberFieldTSL(uniforms.uTime, emberCount);
    infallEmbers.rotation.x = Math.PI / 2;
    infallEmbers.scale.setScalar(CH7_GARGANTUA.emberScale);
    distantHole.userData.diskPivot.add(infallEmbers);
    group.userData.infallEmbers = infallEmbers;

    // Anchor the whole environment to the path's FULL centre (x/y/z), not just Y.
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    // Space has no atmospheric fog (backlog #3): disable it on EVERY material so the hero
    // reads at full contrast. Guarded by tests/unit/odyssey-chapter-fog-optout.test.js.
    group.traverse((child) => {
        if (!child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => { m.fog = false; });
    });

    return group;
}

/**
 * Pose the hero `lockDepth` ahead of the camera on the CAMERA'S basis (screen-right,
 * screen-up, toward-eye) so the shadow is square to the eye and the disk band reads across
 * the frame whatever the spline does — including the near-vertical climb, where the old
 * world-up `lookAt` basis degenerated. Writes the world centre into `lensWorldPos`.
 */
export function poseGargantua(group, camera, time = 0, glide = 0, fall = null) {
    const { distantHole } = group.userData;
    if (!distantHole || !camera?.position) return false;
    const fallState = fall ?? blackHoleFallAtRest();
    // THE FALL: as the hole grows it recedes along the view axis just enough to keep its near
    // surface clear of the rail and nodes, and eases onto the axis (resolveBlackHoleFallDepth).
    const depth = fallState.active ? resolveBlackHoleFallDepth(fallState.alpha) : GARGANTUA_LOCK.lockDepth;
    resolveGargantuaFallPosition(camera, _heroWorld, depth, fallState.centring);
    // THE 7->8 GLIDE: off the lock onto the Retrosun's direction, at the lock's distance (so the
    // shadow keeps its angular size, which is also the sun disc's). The target is held within
    // maxOffAxis of the view axis so the hero can never leave the frame.
    const sunWorld = group.userData.retrosunStage?.position;
    if (glide > 0 && sunWorld) {
        _lockDir.copy(_heroWorld).sub(camera.position);
        const lockDist = _lockDir.length();
        _lockDir.normalize();
        camera.getWorldDirection(_fwd).normalize();
        _toSun.copy(sunWorld).sub(camera.position).normalize();
        if (_fwd.angleTo(_toSun) > CH7_SUN_CARRY.maxOffAxis) {
            _axis.crossVectors(_fwd, _toSun);
            if (_axis.lengthSq() > 1e-10) {
                _toSun.copy(_fwd).applyAxisAngle(_axis.normalize(), CH7_SUN_CARRY.maxOffAxis);
            }
        }
        _lockDir.lerp(_toSun, glide).normalize();
        _heroWorld.copy(camera.position).addScaledVector(_lockDir, lockDist);
    }
    group.userData.lensWorldPos?.copy(_heroWorld);
    // The hero's scale: the shadow subtends the fall's angular radius from the eye (exactly 1 at
    // rest, where the lock already subtends it).
    const heroDistance = _heroWorld.distanceTo(camera.position);
    const heroScale = fallState.active
        ? Math.max(1e-3, (heroDistance * Math.sin(fallState.alpha)) / CH7_GARGANTUA.shadowRadius)
        : 1;
    distantHole.scale.setScalar(heroScale);
    group.userData.heroScale = heroScale;
    const windowUniforms = distantHole.userData.singularity;
    if (windowUniforms?.uEyeZ) windowUniforms.uEyeZ.value = heroDistance / heroScale;
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // The group is translated but not rotated, so world → local is a subtract.
    distantHole.position.copy(_heroWorld).sub(group.position);
    // Face pivot +Z toward the eye: basis (right, up, back) with back from the hero to the eye.
    _back.copy(camera.position).sub(_heroWorld).normalize();
    _right.crossVectors(_up, _back).normalize();
    _up.crossVectors(_back, _right).normalize();
    _basis.makeBasis(_right, _up, _back);
    distantHole.quaternion.setFromRotationMatrix(_basis);
    // Slow precession about the view axis — bounded, so it never drifts the composition.
    _spin.setFromAxisAngle(_zAxis, Math.sin(time * CH7_GARGANTUA.precession) * 0.06);
    distantHole.quaternion.multiply(_spin);
    return true;
}

/**
 * Where ch7's shadow takes over from ch6's omen shadow: the omen's handoff completes at the
 * 6->7 seam's start (ch7Start - ch6's seam half-width; cosmic-expanse.js
 * resolveOmenHandoffWindow), and this chapter is only drawn past it — so exactly one opaque
 * shadow covers the hole at every progress, and the two coincide where they swap.
 */
function resolveShadowTakeover(chapterPositions) {
    const ch7Start = chapterPositions?.[6];
    if (!Number.isFinite(ch7Start)) return null;
    return ch7Start - (getChapterTransitionForChapter(6)?.seamWidth ?? 0.0222);
}

export function updateBlackHoleTranscendenceEnvironment(group, delta, time, camera, ...updateArgs) {
    const [cameraProgress = null, directorState = null] = updateArgs;
    const chapterPositions = getActiveOdysseyChapterPositions();
    const carry = resolveSunCarry(cameraProgress, chapterPositions);
    const fall = resolveBlackHoleFall(cameraProgress, chapterPositions);
    group.userData.fall = fall;
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }
    if (uniforms?.uEnergy) {
        const audioEnergy = directorState
            ? THREE.MathUtils.clamp((directorState.energy || 0) * 0.62 + (directorState.bass || 0) * 0.38, 0, 1)
            : null;
        uniforms.uEnergy.value = audioEnergy === null
            ? 0.4 + Math.sin(time * 0.45) * 0.2
            : 0.3 + audioEnergy * 0.7 + (directorState.beatPulse || 0) * 0.1;
    }

    const { voidDome } = group.userData;
    if (voidDome) {
        voidDome.rotation.y += delta * 0.006;
        // Inside the singularity the window covers every pixel: the deep-space dome behind it is
        // only depth-rejected fill, so it stops drawing.
        voidDome.visible = fall.inside < 0.999;
    }

    // ── CAMERA-LOCK THE HERO ─────────────────────────────────────────────────────
    if (!poseGargantua(group, camera, time, carry?.glide ?? 0, fall) && group.userData.distantHole) {
        // No-camera fallback (smoke tests): a slow precession in place.
        group.userData.distantHole.rotation.z -= delta * 0.025;
    }

    // ── ONE OPAQUE SHADOW, AND THE 7->8 CARRY ────────────────────────────────────
    const { distantHole, sunCopy } = group.userData;
    const hero = distantHole?.userData;
    const open = carry?.open ?? 0;
    if (hero?.horizon) {
        const takeover = resolveShadowTakeover(chapterPositions);
        // ...and across the 7->8 window the tunnel's mouth opens from the vanishing point; once it
        // has passed the frame's edges the window is gone.
        hero.horizon.visible = (!Number.isFinite(cameraProgress) || takeover === null
            || cameraProgress > takeover) && open < 0.999;
        // Re-asserted until the environment manager honours `odysseyFadeExempt` (until then
        // it still writes a crossfade opacity into this material every frame of a seam).
        if (hero.horizon.material) hero.horizon.material.opacity = 1;
    }
    // The post lens shrinks with the hole: no warp — and no bloom mask — around the new sun. It
    // also grows with the fall (the shadow's world radius scales with the hero), and `portal`
    // tells the post pass to stop masking bloom where the shadow has become the tunnel window.
    if (group.userData.lensWorldPos) {
        group.userData.lensWorldPos.lensRadius = CH7_GARGANTUA.shadowRadius
            * (group.userData.heroScale ?? 1) * (1 - open);
        group.userData.lensWorldPos.portal = fall.portal;
    }
    const windowUniforms = hero?.singularity;
    if (windowUniforms) {
        windowUniforms.uPortal.value = fall.portal;
        windowUniforms.uWarp.value = fall.warp;
        // The mouth grows to 80 deg: past the corners of a 70 deg-FOV frame.
        windowUniforms.uOpen.value = open * CH7_EXIT_MOUTH_MAX;
    }
    // The disk-plane crossing: the band's plane sweeps through edge-on (a razor line) and reopens.
    // Its outer edge is held in front of the eye (<= 0.85 of the hero's distance): left at its
    // physical 4.8 shadow radii, the disk passed BEHIND the camera once the hole outgrew ~12 deg
    // and its face became a cream floor under half the frame.
    if (hero?.diskPivot) {
        hero.diskPivot.rotation.x = -(Math.PI / 2 - fall.diskTilt);
        const heroScale = group.userData.heroScale ?? 1;
        const diskOuter = CH7_GARGANTUA.shadowRadius * CH7_GARGANTUA.diskOuter * heroScale;
        const heroDistance = group.userData.lensWorldPos && camera?.position
            ? group.userData.lensWorldPos.distanceTo(camera.position) : Infinity;
        hero.diskPivot.scale.setScalar(Math.min(1, (0.85 * heroDistance) / Math.max(1e-3, diskOuter)));
    }
    const fill = carry?.fill ?? 0;
    // Once the disk has swept past, the band, its fold arcs and the embers fade out with it.
    const band = (carry?.band ?? 1) * fall.band;
    const motifs = carry?.motifs ?? 1;
    // The photon ring brightens and warms into the new sun's limb; the thin band, its lensed
    // fold arcs and the infall embers collapse into the light; dust, shards and the far stars
    // are gone by the boundary, so no chapter-7 motif lingers over the city.
    if (hero?.uSwell) hero.uSwell.value = fill;
    if (hero?.photonRing) hero.photonRing.scale.setScalar(1 + fill * 0.08);
    if (hero?.uDiskFade) hero.uDiskFade.value = band;
    scaleBridge(hero?.foldArcs?.[0]?.material?.uniforms?.uOpacity, band);
    const {
        infallEmbers, corridorDust: dust, shards: shardMesh, lensingStarfield: stars,
    } = group.userData;
    scaleBridge(infallEmbers?.material?.uniforms?.uOpacity, band);
    scaleBridge(dust?.material?.uniforms?.uOpacity, motifs);
    scaleBridge(shardMesh?.material?.uniforms?.uOpacity, motifs);
    scaleBridge(stars?.material?.uniforms?.uOpacity, motifs);
    // Hidden outright once collapsed / gone, so nothing keeps drawing at zero.
    if (hero?.diskPivot) hero.diskPivot.visible = band > 0.002;
    hero?.foldArcs?.forEach((fold) => { fold.visible = band > 0.002; });
    if (dust) dust.visible = motifs > 0.002;
    if (shardMesh) shardMesh.visible = motifs > 0.002;
    // The far stars sit behind the window once inside: depth-rejected fill, so they stop drawing.
    if (stars) stars.visible = motifs > 0.002 && fall.inside < 0.999;

    // The sun copy fills the closing hole and hands the sun to chapter 8 (which draws the
    // identical disc) at carry.handedOver.
    const stage = group.userData.retrosunStage;
    if (sunCopy) {
        const copyVisible = !!(stage && distantHole && camera?.position) && fill > 0.001 && !carry?.handedOver;
        sunCopy.visible = copyVisible;
        if (copyVisible) {
            distantHole.getWorldPosition(_heroWorld);
            const heroDist = _heroWorld.distanceTo(camera.position);
            const sunDist = Math.max(1, stage.position.distanceTo(camera.position));
            sunCopy.position.copy(_heroWorld).sub(group.position);
            sunCopy.scale.setScalar(heroDist / sunDist);
            sunCopy.userData.uEnergy.value = resolveUrbanEnergy(time, directorState);
            sunCopy.userData.uReveal.value = resolveRetrosunReveal(cameraProgress);
            // Full strength once filled, independent of this chapter's crossfade weight: the
            // copy must match chapter 8's disc pixel for pixel at the hand-over.
            const copyOpacity = sunCopy.material?.uniforms?.uOpacity;
            if (copyOpacity) copyOpacity.value = fill;
        }
    }

    // Re-centre the corridor dust on the camera (group-local) so the camera is always
    // inside it and keeps near + mid motes for parallax.
    const { corridorDust } = group.userData;
    if (camera?.position && corridorDust) {
        corridorDust.position.set(
            camera.position.x - group.position.x,
            camera.position.y - group.position.y,
            camera.position.z - group.position.z,
        );
    }

    // Vertical shard drift runs in the TSL material; feed it the camera Y.
    const { shards } = group.userData;
    const shardDrift = shards?.userData?.driftUniforms;
    if (shardDrift?.uCameraY) {
        shardDrift.uCameraY.value = camera?.position?.y ?? group.position.y;
    }

    const { lensingStarfield } = group.userData;
    if (lensingStarfield) {
        lensingStarfield.rotation.y += delta * 0.002;
    }
}

export default {
    config: BLACK_HOLE_TRANSCENDENCE_CONFIG,
    create: createBlackHoleTranscendenceEnvironment,
    update: updateBlackHoleTranscendenceEnvironment,
};

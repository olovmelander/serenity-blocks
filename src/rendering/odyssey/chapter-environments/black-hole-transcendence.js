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
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { getChapterPathRange } from '../path-utils.js';
import {
    createVoidDomeTSL,
    createAccretionDiskTSL,
    createGargantuaPhotonRingTSL,
    createLensedFoldMaterialTSL,
    createTranscendenceShardsTSL,
    createLensingStarfieldTSL,
    createCorridorDustTSL,
    createInfallEmberFieldTSL,
    CH7_CORRIDOR_DUST_SETTINGS,
    GARGANTUA_LOCK,
    resolveGargantuaLockPosition,
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

// Camera-lock scratch (reused every frame — no per-frame allocation).
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _heroWorld = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _spin = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

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

    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(S, 64, 48),
        new THREE.MeshBasicNodeMaterial({ color: 0x000000 }),
    );
    horizon.name = 'gargantua-shadow';
    face.add(horizon);

    const photon = createGargantuaPhotonRingTSL(uniforms.uTime, {
        innerRadius: S * CH7_GARGANTUA.photonInner,
        outerRadius: S * CH7_GARGANTUA.photonOuter,
        shadowRadius: S,
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

    const { mesh: disk } = createAccretionDiskTSL(uniforms.uTime, uniforms.uEnergy, {
        innerRadius: S * CH7_GARGANTUA.diskInner,
        outerRadius: S * CH7_GARGANTUA.diskOuter,
    });
    disk.name = 'distant-accretion-disk';
    diskPivot.add(disk);

    group.userData.face = face;
    group.userData.diskPivot = diskPivot;
    group.userData.disk = disk;
    group.userData.horizon = horizon;
    group.userData.photonRing = photon.mesh;
    group.userData.foldArcs = [topFold, bottomFold];
    return group;
}

function createTranscendenceShards(uniforms) {
    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU). The vertical drift
    // runs in the TSL material (uTime + uCameraY), so update() only feeds the camera Y.
    const { mesh, uniforms: driftUniforms } = createTranscendenceShardsTSL(uniforms.uTime);
    mesh.name = 'transcendence-shards';
    mesh.userData.driftUniforms = driftUniforms;
    return mesh;
}

function createLensingStarfield(uniforms) {
    // A full far shell behind everything — the ch7 post lens bends it round the shadow.
    const { mesh } = createLensingStarfieldTSL(uniforms.uTime);
    mesh.name = 'lensing-starfield';
    return mesh;
}

export function createBlackHoleTranscendenceEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-environment';
    group.userData.chapterId = 7;

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
    const lensingStarfield = createLensingStarfield(uniforms);
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
    const dustCount = options.particleCount
        ? Math.min(CH7_CORRIDOR_DUST_SETTINGS.maxCount, Math.floor(options.particleCount * 2.0))
        : 720;
    const { mesh: corridorDust } = createCorridorDustTSL(uniforms.uTime, dustCount);
    corridorDust.name = 'corridor-violet-dust';
    group.add(corridorDust);
    group.userData.corridorDust = corridorDust;

    const shards = createTranscendenceShards(uniforms);
    group.add(shards);
    group.userData.shards = shards;

    // Infall embers — matter in the disk plane, parented to the disk pivot so they orbit
    // IN the band (their authored orbit plane is local XZ; +90° about X lays it onto the
    // pivot's XY disk plane), scaled from their authored ~70-260 u radii onto the disk's.
    const emberCount = options.particleCount ? Math.floor(options.particleCount * 1.6) : 520;
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
export function poseGargantua(group, camera, time = 0) {
    const { distantHole } = group.userData;
    if (!distantHole || !camera?.position) return false;
    resolveGargantuaLockPosition(camera, _heroWorld);
    group.userData.lensWorldPos?.copy(_heroWorld);
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

export function updateBlackHoleTranscendenceEnvironment(group, delta, time, camera, ...updateArgs) {
    const [, directorState = null] = updateArgs;
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
    }

    // ── CAMERA-LOCK THE HERO ─────────────────────────────────────────────────────
    if (!poseGargantua(group, camera, time) && group.userData.distantHole) {
        // No-camera fallback (smoke tests): a slow precession in place.
        group.userData.distantHole.rotation.z -= delta * 0.025;
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

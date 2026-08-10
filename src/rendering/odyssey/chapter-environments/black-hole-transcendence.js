/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Black Hole Transcendence Environment - Chapter 7 Visual Theme
 *
 * The journey's gravitational climax: a dominant event horizon ringed by a
 * shader-driven accretion disk and a gravitational-lensing shell, set against a
 * violent magenta/cyan nebula. Part of the Odyssey AAA "Cosmic Ascent" overhaul
 * (Phase 4 — chapter level-up); see docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6.
 *
 * Layers (plan §3.2):
 *   0  Void nebula dome      — FBM filaments, deep magenta/indigo
 *   1  Hero anchor           — dominant event horizon: shader accretion disk
 *                              (swirling plasma + Doppler), photon ring, and a
 *                              fresnel lensing shell with an Einstein-ring band
 *   2  Mid environment       — coplanar accretion glow rings, lensed starfield
 *   6  Near life             — transcendence shards + matter infall streams
 *
 * All glow is GLSL-procedural so create() never needs a `document`/canvas.
 */

import * as THREE from 'three/webgpu';
import {
    mix,
    sin,
    uniform,
    uv,
    vec3,
} from 'three/tsl';
import { getChapterPathRange } from '../path-utils.js';
import {
    createVoidDomeTSL,
    createAccretionDiskTSL,
    createLensingShellTSL,
    createSharedMotifMaterialsTSL,
    createTranscendenceShardsTSL,
    createLensingStarfieldTSL,
    createAmbientWashTSL,
    createCorridorDustTSL,
    createInfallEmberFieldTSL,
    CH7_CORRIDOR_DUST_SETTINGS,
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

// B2 camera-lock scratch vectors — reused EVERY frame in update() so the per-frame
// hero transform allocates nothing (the lead's "reuse scratch Vector3" constraint).
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _heroWorld = new THREE.Vector3();
const _heroLocal = new THREE.Vector3();

export const CH7_FOLD_ARC_SETTINGS = Object.freeze({
    opacity: 0.66,
    sweepRatio: 0.92,
    radius: 92,
    tube: 8.5,
    radialSegments: 8,
    tubularSegments: 60,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Creation
// ═══════════════════════════════════════════════════════════════════════════════
//
// WebGPU conversion: the five custom GLSL ShaderMaterials (void dome, accretion
// disk, lensing shell, transcendence shards, lensed starfield) are now built by the
// validated TSL NodeMaterial builders in ./black-hole-transcendence.tsl.js. The
// shared uTime/uEnergy uniforms are passed INTO those builders so this file's
// update() keeps ticking them unchanged. Non-shader companions (dark horizon,
// photon ring, glow rings, infall tubes) stay as plain MeshBasicMaterial — they
// render natively on the WebGPURenderer via three/webgpu.

function createVoidDome(uniforms) {
    // TSL NodeMaterial dome; share this file's uTime/uEnergy so update() ticks it.
    const { mesh } = createVoidDomeTSL(uniforms.uTime, uniforms.uEnergy);
    return mesh;
}

function createEventHorizon(uniforms) {
    const group = new THREE.Group();
    group.name = 'dominant-event-horizon-anchor';
    // Laterally centred on the path (x=0) and dropped slightly below the eyeline so the
    // forward-looking, gently-downward camera frames the singularity dead-centre instead
    // of letting the lensing/horizon hero slide off the right edge.
    group.position.set(0, -22, -780);
    group.rotation.x = -1.05;

    // Shared ENTRY fade uniform — the close hero is the flyby for the first ~25% of the
    // chapter, then ramps OUT so it hands off cleanly to the camera-locked distant hero
    // (so we never have two equal heroes fighting for the frame). update() drives this.
    const uEntryFade = uniform(1);
    group.userData.uEntryFade = uEntryFade;
    // MeshBasic children whose .opacity update() also fades (the TSL disk/shell fade via
    // the uEntryFade uniform; plain materials need their .opacity ramped directly).
    group.userData.fadeMaterials = [];

    // Dominant dark horizon.
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(38, 48, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1, 1, 0.9);
    group.add(horizon);

    // Shader accretion disk — the visual core (TSL NodeMaterial).
    const { mesh: disk } = createAccretionDiskTSL(uniforms.uTime, uniforms.uEnergy, { uFade: uEntryFade });
    disk.name = 'accretion-disk';
    group.add(disk);
    group.userData.disk = disk;

    // Photon ring hugging the horizon.
    const photonRing = new THREE.Mesh(
        new THREE.RingGeometry(39, 43, 128, 1),
        new THREE.MeshBasicMaterial({
            // Hotter incandescent gold-white photon ring — sharpens the bright rim that
            // hugs the void and reads with more contrast against the magenta accretion.
            color: 0xfff0c2,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    photonRing.userData.baseOpacity = 0.95;
    group.userData.fadeMaterials.push(photonRing);
    group.add(photonRing);

    // Gravitational-lensing shell (Einstein-ring band, TSL NodeMaterial). The band
    // is a view-space fresnel effect on a sphere, so it is rotation-invariant — the
    // parent disk tilt does not skew it; it always rings the horizon facing the
    // camera.
    const { mesh: lensShell } = createLensingShellTSL(uniforms.uTime, uniforms.uEnergy, { uFade: uEntryFade });
    lensShell.name = 'lensing-shell';
    group.add(lensShell);

    return group;
}

/**
 * A large, FAR background singularity that stays framed for most of the traversal.
 * The hero event horizon sits close and is passed early; this distant twin is parked
 * deep down-path and scaled up so the ascending forward camera keeps an awe-inspiring
 * black hole in frame the whole run (the lead's "one large always-visible background
 * black hole"). Same accretion/lensing/photon-ring vocabulary as the hero, dimmer and
 * cooler so it reads as distance, not a second equal hero.
 */
function createDistantBackgroundHole(uniforms) {
    const group = new THREE.Group();
    group.name = 'distant-background-singularity';
    // B2 CAMERA-LOCK HERO: this is no longer a far-parked twin — update() repositions it
    // in front of the camera EVERY FRAME (fwd*900 + an upper-centre screen-anchor bias)
    // and lookAt()s the camera, so ONE colossal lensed hole stays framed for the WHOLE
    // chapter regardless of spline turns. The initial transform here is only the
    // pre-first-frame fallback; scale is enlarged so the locked hero DOMINATES (~40-55%
    // of frame height at the ~900-unit lock depth).
    group.position.set(0, 120, -900);
    group.scale.setScalar(5.5);

    // Colossal event horizon (sphere ~60 vs the close hero's 38) so the void core reads
    // as a pure-black disc that dominates the upper-centre third.
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(60, 48, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1, 1, 0.9);
    group.add(horizon);

    // Hero accretion disk enlarged to uOuter ~220 (geometry extended to match) so the
    // glowing torus wraps the colossal horizon, not a tiny inner band.
    const { mesh: disk } = createAccretionDiskTSL(
        uniforms.uTime,
        uniforms.uEnergy,
        { innerRadius: 64, outerRadius: 220 },
    );
    disk.name = 'distant-accretion-disk';
    group.add(disk);
    group.userData.disk = disk;

    // Razor photon ring hugging the enlarged horizon — brightened to ~0.9 (the plan's hero
    // photon-ring opacity) and hot gold-white so it crosses bloom threshold as the only
    // hard rim, seating the colossal void.
    const photonRing = new THREE.Mesh(
        new THREE.RingGeometry(61, 67, 128, 1),
        new THREE.MeshBasicMaterial({
            color: 0xfff0c2,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    group.add(photonRing);

    // Wide magenta accretion halo (380..560) so the colossal hero carries a soft glowing
    // aura that fills the deep-violet void around the locked singularity.
    const halo = new THREE.Mesh(
        new THREE.RingGeometry(380, 560, 96, 1),
        new THREE.MeshBasicMaterial({
            color: 0xff2bd0,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
    );
    group.add(halo);

    const { mesh: lensShell } = createLensingShellTSL(uniforms.uTime, uniforms.uEnergy);
    lensShell.name = 'distant-lensing-shell';
    group.add(lensShell);

    // LENSED FOLD ARCS (creative plan asset 2 — the Gargantua signature): light from
    // the disk's FAR side bent over the top and under the bottom of the shadow. Without
    // this fold the composition reads as Saturn, not a lensed black hole. Two thin
    // curved additive bands carrying the disk ramp (#FFF4CF → #FF2EA8), end-feathered;
    // they live in this group so the camera-lock orientation caps the shadow every
    // frame. Tagged emitsBloom — these are sanctioned hot accents.
    const foldArcMaterial = new THREE.MeshBasicNodeMaterial();
    const arcU = uv().x; // runs along the arc
    const endFeather = sin(arcU.mul(Math.PI)); // fades to 0 at both arc ends
    const foldRamp = mix(vec3(1.0, 0.957, 0.812), vec3(1.0, 0.18, 0.66), arcU);
    foldArcMaterial.colorNode = foldRamp.mul(endFeather);
    foldArcMaterial.opacityNode = endFeather.mul(CH7_FOLD_ARC_SETTINGS.opacity);
    foldArcMaterial.transparent = true;
    foldArcMaterial.depthWrite = false;
    foldArcMaterial.blending = THREE.AdditiveBlending;
    foldArcMaterial.side = THREE.DoubleSide;
    foldArcMaterial.userData.emitsBloom = true;
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
    group.add(topFold);
    const bottomFold = new THREE.Mesh(foldGeometry, foldArcMaterial);
    bottomFold.rotation.z = -Math.PI / 2 - FOLD_SWEEP / 2; // bows UNDER the shadow
    bottomFold.name = 'lensed-fold-bottom';
    bottomFold.userData.readability = CH7_FOLD_ARC_SETTINGS;
    group.add(bottomFold);
    group.userData.foldArcs = [topFold, bottomFold];

    return group;
}

/**
 * A chain of secondary lensing/accretion motifs distributed ALONG the chapter's
 * local-Y travel (the camera ascends through ~±90 local units). Each is an accretion
 * disk + lensing shell + dark horizon + a bright additive bloom halo so that, between
 * the close hero and the distant background hole, the ascending camera always has a
 * glowing singularity/accretion framed near it (kills the "long empty corridor" the
 * lead flagged). They are kept LARGE and close to the path centre-line (x near 0, only
 * a gentle off-axis offset) and staggered in depth so a hero singularity reads for most
 * of the traversal — not just at one anchor.
 */
function createSecondaryLensingMotifs(uniforms) {
    const group = new THREE.Group();
    group.name = 'secondary-lensing-motifs';

    // [x, y, z, scale, tilt] in the chapter's local frame. Distributed low->high across
    // the local-Y corridor and staggered in depth so one large motif is always framed
    // mid-run; x kept modest so they sit in / near the forward view, not off-screen.
    const specs = [
        [-70, -70, -500, 0.92, -1.20],
        [85, -10, -640, 1.05, -0.95],
        [-55, 55, -820, 1.15, -1.05],
        [70, 120, -1040, 1.30, -0.88],
        [-40, 185, -1320, 1.45, -1.00],
    ];

    // B2 STRUCTURAL: SHARE one accretion-disk material+geometry and one lensing-shell
    // material+geometry across ALL five motifs instead of building 5 fresh copies each
    // (≈10 unique TSL programs → 2; ≈10 geometries → 2). Visuals are identical — each
    // motif's distinct look comes from its parent group transform (position/tilt/scale/
    // spin), not from the material. Likewise share one horizon material+geometry, one
    // photon-ring material+geometry, and just TWO halo materials (the field only uses an
    // alternating magenta/cyan halo color). The bundle is stashed on userData for the
    // caller's dispose path.
    const shared = createSharedMotifMaterialsTSL(uniforms.uTime, uniforms.uEnergy);
    group.userData.sharedMotifMaterials = shared;

    const horizonGeometry = new THREE.SphereGeometry(34, 24, 16);
    const horizonMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

    // Two shared halo materials (even-index magenta, odd-index cyan) + one shared halo
    // geometry, so the 5 halos cost 2 materials + 1 geometry instead of 5 of each.
    const haloGeometry = new THREE.RingGeometry(132, 188, 96, 1);
    const haloMaterialEven = new THREE.MeshBasicMaterial({
        color: 0xff2bd0,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const haloMaterialOdd = new THREE.MeshBasicMaterial({
        color: 0x57dcff,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    group.userData.sharedHorizon = { geometry: horizonGeometry, material: horizonMaterial };
    group.userData.sharedHalo = {
        geometry: haloGeometry, materialEven: haloMaterialEven, materialOdd: haloMaterialOdd,
    };

    // ── B-perf: INSTANCE the spin-invariant motif layers ─────────────────────────────
    // The horizon (uniform-black z-squashed sphere), photon ring (uniform-gold FULL
    // annulus) and halo (uniform magenta/cyan FULL annulus) are all uniform-coloured
    // MeshBasicMaterials on fully-symmetric geometry, so the per-motif Z-spin that
    // update() applies to the motif group is INVISIBLE to them: rotating a uniform sphere
    // about any axis, or a full uniform ring about its own normal (Z), leaves the rendered
    // pixels identical. (For the z-squashed sphere, S=diag(1,1,0.9) commutes with Rz, and
    // the unit sphere is rotation-invariant; for the full rings, a 2π uniform annulus is
    // invariant under its own-axis rotation.) We can therefore bake each motif's STATIC
    // transform (position + tilt(Rx) + uniform scale, spin OMITTED — proven irrelevant)
    // into an InstancedMesh per layer: 5+5+5 separate draws collapse to 1+1+2 (the halo
    // alternates two colours → two instanced meshes). The accretion DISK and lensing
    // SHELL stay as per-motif meshes inside the still-spinning motif group, because the
    // disk's swirl/Doppler is angle-dependent (NOT spin-invariant) — only its safe siblings
    // are instanced. No material is mutated per-instance (update() touches only
    // motif.rotation.z), so this is pixel-for-pixel identical.
    const HALO_EVEN_COUNT = specs.filter((_, i) => i % 2 === 0).length; // indices 0,2,4
    const HALO_ODD_COUNT = specs.length - HALO_EVEN_COUNT; // indices 1,3
    const horizonInstanced = new THREE.InstancedMesh(horizonGeometry, horizonMaterial, specs.length);
    horizonInstanced.name = 'lensing-motif-horizons';
    const photonGeo = shared.photonRing.geometry;
    const photonMat = shared.photonRing.material;
    const photonRingInstanced = new THREE.InstancedMesh(photonGeo, photonMat, specs.length);
    photonRingInstanced.name = 'lensing-motif-photon-rings';
    const haloEvenInstanced = new THREE.InstancedMesh(haloGeometry, haloMaterialEven, HALO_EVEN_COUNT);
    haloEvenInstanced.name = 'lensing-motif-halos-even';
    const haloOddInstanced = new THREE.InstancedMesh(haloGeometry, haloMaterialOdd, HALO_ODD_COUNT);
    haloOddInstanced.name = 'lensing-motif-halos-odd';

    // Scratch transforms reused across the build loop (no per-frame use — build-time only).
    const _motifXform = new THREE.Object3D(); // composes position + tilt(Rx) + scale (spin omitted)
    const _horizonLocal = new THREE.Matrix4().makeScale(1, 1, 0.9); // horizon's own z-squash
    const _instanceMatrix = new THREE.Matrix4();
    let haloEvenCursor = 0;
    let haloOddCursor = 0;

    specs.forEach(([x, y, z, scale, tilt], index) => {
        const motif = new THREE.Group();
        motif.name = `lensing-motif-${index}`;
        motif.position.set(x, y, z);
        motif.rotation.x = tilt;
        motif.scale.setScalar(scale);

        // Static motif matrix (spin EXCLUDED — proven irrelevant for the symmetric layers).
        _motifXform.position.set(x, y, z);
        _motifXform.rotation.set(tilt, 0, 0);
        _motifXform.scale.setScalar(scale);
        _motifXform.updateMatrix();

        // Horizon instance = motif · diag(1,1,0.9) (the per-mesh z-squash it used as a child).
        _instanceMatrix.multiplyMatrices(_motifXform.matrix, _horizonLocal);
        horizonInstanced.setMatrixAt(index, _instanceMatrix);
        // Photon ring + halo sat at the motif origin with no local transform → just the motif.
        photonRingInstanced.setMatrixAt(index, _motifXform.matrix);
        if (index % 2 === 0) {
            haloEvenInstanced.setMatrixAt(haloEvenCursor, _motifXform.matrix);
            haloEvenCursor += 1;
        } else {
            haloOddInstanced.setMatrixAt(haloOddCursor, _motifXform.matrix);
            haloOddCursor += 1;
        }

        // The accretion disk + lensing shell still need the live per-motif spin, so they
        // stay children of the spinning motif group (update() ticks motif.rotation.z).
        const disk = shared.makeDiskMesh(`motif-accretion-disk-${index}`);
        motif.add(disk);

        const lensShell = shared.makeShellMesh(`motif-lensing-shell-${index}`);
        motif.add(lensShell);

        // Per-motif slow spin (alternating) so the field has life without CPU work.
        motif.userData.spin = (index % 2 === 0 ? 1 : -1) * (0.05 + index * 0.015);
        group.add(motif);
    });

    horizonInstanced.instanceMatrix.needsUpdate = true;
    photonRingInstanced.instanceMatrix.needsUpdate = true;
    haloEvenInstanced.instanceMatrix.needsUpdate = true;
    haloOddInstanced.instanceMatrix.needsUpdate = true;
    // The instanced layers carry no userData.spin, so update()'s spin loop no-ops on them.
    group.add(horizonInstanced, photonRingInstanced, haloEvenInstanced, haloOddInstanced);

    return group;
}

function createAccretionGlowRings() {
    const group = new THREE.Group();
    group.name = 'accretion-glow-rings';
    // Coplanar with the event-horizon anchor (kept in lockstep so the outer glow rings
    // stay concentric with the re-centred singularity).
    group.position.set(0, -22, -780);
    group.rotation.x = -1.05;
    const ringColors = [0xff2bd0, 0x57dcff, 0xffb347];

    ringColors.forEach((color, index) => {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(140 + index * 22, 168 + index * 30, 96, 1),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.14 - index * 0.03,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        group.add(ring);
    });

    return group;
}

function createTranscendenceShards(uniforms) {
    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU). The shared
    // uTime drives the twinkle in the TSL material; B5 — the vertical drift now also
    // runs in the TSL material (driven by uTime + uCameraY) so update() no longer
    // rewrites the aBase Float32Array each frame. Stash the drift uniforms so update()
    // can feed camera.position.y into uCameraY.
    const { mesh, uniforms: driftUniforms } = createTranscendenceShardsTSL(uniforms.uTime);
    mesh.name = 'transcendence-shards';
    mesh.userData.driftUniforms = driftUniforms;
    return mesh;
}

function createLensingStarfield(uniforms) {
    // Instanced billboard quads (THREE.Points renders as 1px on WebGPU).
    const { mesh } = createLensingStarfieldTSL(uniforms.uTime);
    mesh.name = 'lensing-starfield';
    return mesh;
}

function createInfallStreams() {
    const group = new THREE.Group();
    group.name = 'infall-streams';
    const colors = [0xff33cc, 0x66e3ff, 0xffb347];

    // B2: SHARE three stream materials (one per color) across the 9 tubes instead of
    // building 9 fresh MeshBasicMaterials. The 9 curves still need their OWN geometry +
    // mesh because update() spins each stream independently (stream.rotation.z), so a
    // full geometry merge would kill the per-stream tangential vortex spin — deferred to
    // Wave 2 (where an instanced/compute approach could keep per-stream motion). Sharing
    // the materials still trims 9 → 3 material instances with zero visual change.
    const streamMaterials = colors.map((color) => new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        // Brightened 0.3 -> 0.5 (plan) — the infall reads as glowing matter, soft
        // additive (ACES + threshold bloom are downstream; no hard white).
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    group.userData.sharedStreamMaterials = streamMaterials;
    // Sheath palette (pink/cyan/gold glow envelopes — creative plan asset 8).
    const sheathMaterials = [0xff4ec8, 0x6ae8ff, 0xffcf6e].map((color) => new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    group.userData.sharedSheathMaterials = sheathMaterials;

    // B2 REWORK: spiral the 9 streams tangentially INWARD to the group's LOCAL origin
    // (0,0,0) so the whole group can be camera-locked onto the distant hero's screen-
    // anchored position each frame (update() positions + orients this group). Each curve
    // starts wide and high, wraps tangentially around the photon ring, and terminates AT
    // the origin (the locked horizon) with a bright hot tip — matter visibly falling in.
    for (let index = 0; index < 9; index += 1) {
        const a0 = (index / 9) * Math.PI * 2;
        const startR = 320 + index * 24;
        const midR = 150 + index * 8;
        const innerR = 72;
        const swirl = 1.7; // tangential wrap (radians) as the stream spirals inward
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(
                Math.cos(a0) * startR,
                90 - index * 9,
                -40 - index * 10,
            ),
            new THREE.Vector3(
                Math.cos(a0 + swirl * 0.5) * midR,
                30 - index * 4,
                -10,
            ),
            new THREE.Vector3(
                Math.cos(a0 + swirl) * innerR,
                Math.sin(a0 + swirl) * innerR * 0.42,
                4,
            ),
            // Terminate AT the locked-hero origin (bright hot tip lands on the horizon).
            new THREE.Vector3(0, 0, 0),
        ]);
        const mesh = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 40, 0.8, 6, false),
            streamMaterials[index % colors.length],
        );
        mesh.userData.spin = (index % 2 === 0 ? 1 : -1) * (0.015 + index * 0.002);
        group.add(mesh);

        // GLOW SHEATH (creative plan asset 8): a wider, very soft additive tube around
        // each stream so the 16–23 "calligraphic swirls" read as LUMINOUS RIBBONS WITH
        // MASS, not sub-pixel wireframes. Shares the parent's spin (child of nothing —
        // added as its own mesh with the same userData.spin so both rotate in step).
        const sheath = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 40, 2.6, 6, false),
            sheathMaterials[index % colors.length],
        );
        sheath.userData.spin = mesh.userData.spin;
        group.add(sheath);
    }

    return group;
}

export function createBlackHoleTranscendenceEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-environment';
    group.userData.chapterId = 7;

    // TSL uniform nodes (shared into the .tsl builders). They expose `.value`, so the
    // existing update() (`uniforms.uTime.value = ...`) ticks them unchanged.
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

    const voidDome = createVoidDome(uniforms);
    voidDome.position.z = -740;
    group.add(voidDome);
    group.userData.voidDome = voidDome;

    // Deep-violet ambient wash the camera sits inside (re-centred on the camera in
    // update()) so the corridor between motifs never reads as dead RGB-black. Kept as a
    // separate camera-enveloping dome — a B3 fold into the world-anchored void dome above was
    // tried and reverted (it left the corridor corners RGB-black; see the .tsl.js note).
    const { mesh: ambientWash } = createAmbientWashTSL(uniforms.uTime, uniforms.uEnergy);
    group.add(ambientWash);
    group.userData.ambientWash = ambientWash;

    // Large always-framed background singularity — keeps an awe hero on screen for the
    // whole ascent (the close hero below is passed early).
    const distantHole = createDistantBackgroundHole(uniforms);
    group.add(distantHole);
    group.userData.distantHole = distantHole;

    // B4 HOOK: world-space position of the camera-locked hero singularity, refreshed
    // every frame by update(). The DEFERRED screen-space gravitational-lensing post node
    // (added in batch B4) projects this to NDC to centre the radial UV warp + the ch7 CA
    // spike on the hero. Kept as a reused Vector3 (no per-frame alloc). See the camera-lock
    // block in updateBlackHoleTranscendenceEnvironment().
    group.userData.lensWorldPos = new THREE.Vector3(0, 120, -900);

    const eventHorizon = createEventHorizon(uniforms);
    group.add(eventHorizon);
    group.userData.eventHorizon = eventHorizon;

    // Secondary lensing/accretion motifs distributed along the local-Y travel so the
    // ascending camera always has a singularity near it (no long empty corridor).
    const secondaryMotifs = createSecondaryLensingMotifs(uniforms);
    group.add(secondaryMotifs);
    group.userData.secondaryMotifs = secondaryMotifs;

    const accretionGlowRings = createAccretionGlowRings();
    group.add(accretionGlowRings);
    group.userData.accretionGlowRings = accretionGlowRings;

    // Drifting violet dust hugging the corridor (re-centred on the camera in update()).
    // Count scales with the quality preset. PERF PASS (2026-06-17): trimmed ~30% to cut
    // additive overdraw on the heaviest chapter (default 1040 → 720, builder cap 1200 → 820).
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

    const lensingStarfield = createLensingStarfield(uniforms);
    group.add(lensingStarfield);
    group.userData.lensingStarfield = lensingStarfield;

    const infallStreams = createInfallStreams();
    group.add(infallStreams);
    group.userData.infallStreams = infallStreams;

    // Dense infall ember / dust field wreathing the camera-locked hero (the user's "MORE
    // particles" ask). Instanced + capped; the count scales off the preset particleCount
    // (default ~520, hard-capped at 900 in the builder) so high-quality tiers add density
    // and low tiers stay light — no per-frame CPU (motion is GPU-side). update() parents
    // it onto the locked hero each frame so the embers always wreathe the on-screen hole.
    // PERF PASS (2026-06-17): trimmed ~30% to cut additive overdraw on the heaviest chapter
    // (default 700 → 520, builder cap 900 → 620).
    const emberCount = options.particleCount ? Math.floor(options.particleCount * 1.6) : 520;
    const { mesh: infallEmbers } = createInfallEmberFieldTSL(uniforms.uTime, emberCount);
    group.add(infallEmbers);
    group.userData.infallEmbers = infallEmbers;

    // Anchor the whole environment to the path's FULL centre (x/y/z), not just Y.
    // A Y-only anchor let the singularity drift laterally so the lensing/horizon hero
    // sat half-off the right frame edge; centring on the path puts the event horizon
    // in front of and centred on the forward-looking camera and stops the path from
    // clipping through the accretion geometry (mirrors mountain-peaks.js).
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    // FogExp2 WASHOUT fix (backlog #3): the whole chapter is a SPACE scene — the hero
    // event horizon + secondary singularities sit at z≈−780, where the profile's violet
    // fog (density 0.012) reaches ~100% and collapses every additive surface to a flat
    // fog-coloured blob. Space has no atmospheric fog; the intended depth comes entirely
    // from the void-dome backstop + ambient wash + additive falloff + parallax dust
    // shells. Disable fog on EVERY material so the heroes read at full contrast (the same
    // reason deep-ocean.tsl.js sets material.fog=false on its distant creatures).
    group.traverse((child) => {
        if (!child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => { m.fog = false; });
    });

    return group;
}

export function updateBlackHoleTranscendenceEnvironment(group, delta, time, camera, ...updateArgs) {
    const [cameraProgress = null, directorState = null] = updateArgs;
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
        voidDome.rotation.y += delta * 0.015;
    }

    const { accretionGlowRings } = group.userData;
    if (accretionGlowRings?.children) {
        accretionGlowRings.children.forEach((ring, index) => {
            ring.rotation.z += delta * (0.12 + index * 0.05) * (index % 2 === 0 ? 1 : -1);
        });
    }

    // ── B2 CAMERA-LOCK THE HERO ──────────────────────────────────────────────────
    // Reposition the colossal distant singularity IN FRONT OF the camera every frame so
    // ONE awe-inspiring lensed hole stays framed for the WHOLE chapter regardless of how
    // the spline turns (the #1 fix — mid-chapter was empty RGB-black because the parked
    // hero left the lookAt cone). World target = camera + fwd*900 + up*screenBias, biased
    // to the upper-centre third; then lookAt(camera) so the disk reads near edge-on. All
    // math reuses the module scratch vectors (no per-frame allocation).
    const { distantHole } = group.userData;
    if (distantHole && camera?.position) {
        const LOCK_DEPTH = 900; // forward distance: disk outer ~220*5.5 fills ~40-55% frame
        const UP_BIAS = 120; // ride the upper-centre third (plan's screen-anchor up bias)
        const RIGHT_BIAS = 26; // slight right, matching the ch7 framing's rightward aim

        // Forward + a stable up basis from the camera.
        camera.getWorldDirection(_fwd).normalize();
        _up.set(0, 1, 0);
        // Right = fwd x up; re-derive up = right x fwd so the bias stays orthonormal even
        // when the camera pitches/rolls down the spline (reuse _heroLocal as the right tmp).
        _heroLocal.crossVectors(_fwd, _up).normalize();
        _up.crossVectors(_heroLocal, _fwd).normalize();

        // World-space hero position in front of the camera, lifted to the upper-centre.
        _heroWorld.copy(camera.position)
            .addScaledVector(_fwd, LOCK_DEPTH)
            .addScaledVector(_up, UP_BIAS)
            .addScaledVector(_heroLocal, RIGHT_BIAS);

        // Publish the WORLD position for B4's deferred screen-space lensing post node.
        group.userData.lensWorldPos.copy(_heroWorld);

        // Convert to the group's LOCAL frame (the group is positioned but not rotated, so a
        // plain subtract is exact — matches the ambient-wash re-centre above).
        _heroLocal.copy(_heroWorld).sub(group.position);
        distantHole.position.copy(_heroLocal);

        // Face the camera so the accretion torus reads near edge-on (iconic lensed look),
        // then keep a slow spin on the local Z for life. lookAt() works in the parent frame;
        // with an unrotated group that is world space, so aim at the camera's world position.
        distantHole.lookAt(camera.position);
        distantHole.rotateX(-0.32); // tilt the disk plane so we see the torus, not edge-on flat
        distantHole.rotateZ(time * 0.05); // gentle precession (was delta-accumulated)
    } else if (distantHole) {
        // No-camera fallback (smoke tests): keep the old slow precession.
        distantHole.rotation.z -= delta * 0.025;
    }

    // ── B2 ENTRY-FADE HANDOFF ────────────────────────────────────────────────────
    // Ramp the close ENTRY event horizon OUT by ~25% chapter progress so it hands off
    // cleanly to the locked hero (never two equal heroes fighting for the frame). Chapter-
    // local progress is derived from the camera's ascent through the chapter y-range (set on
    // userData by create()); falls back to the global cameraProgress, then to fully present.
    const { eventHorizon } = group.userData;
    if (eventHorizon) {
        eventHorizon.rotation.z -= delta * 0.06; // entry hero keeps its slow spin while visible

        let chapterT = null;
        const { yStart, yEnd } = group.userData;
        if (camera?.position && Number.isFinite(yStart) && Number.isFinite(yEnd) && yEnd !== yStart) {
            chapterT = THREE.MathUtils.clamp((camera.position.y - yStart) / (yEnd - yStart), 0, 1);
        } else if (Number.isFinite(cameraProgress)) {
            chapterT = THREE.MathUtils.clamp(cameraProgress, 0, 1);
        }
        if (chapterT !== null) {
            // 1 at chapter top -> 0 by ~25% progress (smooth, no pop).
            const entryFade = 1 - THREE.MathUtils.smoothstep(chapterT, 0.0, 0.25);
            if (eventHorizon.userData.uEntryFade) {
                eventHorizon.userData.uEntryFade.value = entryFade;
            }
            // Plain MeshBasic children (photon ring) need their .opacity ramped directly.
            const { fadeMaterials } = eventHorizon.userData;
            if (Array.isArray(fadeMaterials)) {
                fadeMaterials.forEach((mesh) => {
                    const base = mesh.userData?.baseOpacity ?? 1;
                    if (mesh.material) mesh.material.opacity = base * entryFade;
                });
            }
            // Hide the whole entry group once faded so it cannot occlude the locked hero.
            eventHorizon.visible = entryFade > 0.01;
        }
    }

    // Per-motif alternating spin (the field of secondary singularities along the path).
    const { secondaryMotifs } = group.userData;
    if (secondaryMotifs?.children) {
        secondaryMotifs.children.forEach((motif) => {
            motif.rotation.z += delta * (motif.userData.spin || 0);
        });
    }

    // Re-centre the camera-enveloping ambient wash + corridor dust on the camera (in the
    // group's LOCAL frame: camera - group origin) so the camera is always inside them and
    // no corridor frame goes black. Falls back to a static placement with no camera.
    const { ambientWash, corridorDust } = group.userData;
    if (camera?.position) {
        const localX = camera.position.x - group.position.x;
        const localY = camera.position.y - group.position.y;
        const localZ = camera.position.z - group.position.z;
        if (ambientWash) ambientWash.position.set(localX, localY, localZ);
        // Dust rides with the camera laterally/vertically but keeps its forward bias.
        if (corridorDust) corridorDust.position.set(localX, localY, localZ);
    }

    // B5: vertical shard drift now runs ENTIRELY in the TSL material (uTime + per-shard
    // phase + uCameraY), so the old per-frame element-wise rewrite of the aBase
    // Float32Array + needsUpdate full GPU re-upload is gone (no CPU loop / no upload each
    // frame). We only feed the camera's Y into the drift uniform; if no camera (smoke
    // tests) the drift simply uses the last value. Same gentle vertical bob.
    const { shards } = group.userData;
    const shardDrift = shards?.userData?.driftUniforms;
    if (shardDrift?.uCameraY) {
        shardDrift.uCameraY.value = camera?.position?.y ?? group.position.y;
    }

    const { lensingStarfield, infallStreams } = group.userData;
    if (lensingStarfield) {
        lensingStarfield.rotation.z += delta * 0.012;
    }
    // B2: re-target the infall streams onto the camera-locked hero EACH FRAME. The curves
    // were authored to terminate at the group's LOCAL origin (0,0,0), so positioning +
    // orienting this group onto the locked hero makes every stream spiral into the on-screen
    // singularity (not the old static z=-760 anchor). distantHole.position is already in the
    // group's local frame; copy it so the streams share the hero's anchor + facing.
    if (infallStreams?.children) {
        if (distantHole && camera?.position) {
            infallStreams.position.copy(distantHole.position);
            infallStreams.quaternion.copy(distantHole.quaternion);
        }
        infallStreams.children.forEach((stream) => {
            // Per-stream tangential spin (vortex wrap around the photon ring).
            stream.rotation.z += delta * stream.userData.spin;
        });
    }

    // Wreathe the dense infall ember field onto the camera-locked hero each frame (same
    // anchor + facing as the infall streams) so the embers always orbit the on-screen
    // singularity. The orbital + radial-breathing motion is GPU-side (uTime), so this is
    // just a transform copy — no per-frame allocation, no CPU particle loop.
    const { infallEmbers } = group.userData;
    if (infallEmbers && distantHole && camera?.position) {
        infallEmbers.position.copy(distantHole.position);
        infallEmbers.quaternion.copy(distantHole.quaternion);
    }
}

export default {
    config: BLACK_HOLE_TRANSCENDENCE_CONFIG,
    create: createBlackHoleTranscendenceEnvironment,
    update: updateBlackHoleTranscendenceEnvironment,
};

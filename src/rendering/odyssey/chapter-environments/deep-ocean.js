/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Deep Ocean Environment - Chapter 2 Visual Theme
 *
 * Enhanced Version:
 * - Realistic Water Surface (Gerstner Waves + Caustics) from Below
 * - Volumetric Light Rays (God Rays)
 * - Bioluminescent Jellyfish & Plankton
 * - Deep Sea Gradient
 *
 * WebGPU migration: the three GLSL ShaderMaterials (gradient sphere, Gerstner water
 * ceiling, god-ray cones) are now built by the validated TSL NodeMaterial builders in
 * the sibling deep-ocean.tsl.js (createOceanGradientTSL / createWaterSurfaceTSL /
 * createGodRaysTSL) so they render on THREE.WebGPURenderer. The canvas-texture
 * THREE.Points clouds (bubbles, plankton) — which render as 1px on WebGPU — are now
 * instanced billboard quads via the shared odyssey-tsl-billboard helper. The public
 * API (createDeepOceanEnvironment/updateDeepOceanEnvironment + DEEP_OCEAN_CONFIG +
 * group.userData shape) is unchanged.
 */

import * as THREE from 'three/webgpu';
import {
    attribute,
    float,
    mix,
    mod,
    uniform,
    uv,
    texture,
    vec3,
} from 'three/tsl';
import {
    getChapterPathRange,
    getOdysseyPathCurve,
    getActiveOdysseyChapterPositions,
    ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET,
} from '../path-utils.js';
import {
    createOceanGradientTSL,
    createWaterSurfaceTSL,
    createGodRaysTSL,
    createSeabedTSL,
    createCreatureSilhouetteMaterial,
    createKelpClusterMaterial,
    createJellyfishMaterial,
    createVentGlowTSL,
    createSkylightPaneMaterial,
    createPearlGateTSL,
    updateGodRayInstanceMatrix,
} from './deep-ocean.tsl.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import { loadDeepOceanMantas, updateDeepOceanMantas } from './deep-ocean-manta.js';
import { hasChapter2CreatureAssets } from './shared/chapter-02-creature-assets.js';

/**
 * Deep Ocean environment configuration
 */
export const DEEP_OCEAN_CONFIG = {
    id: 2,
    name: 'deep-ocean',
    yStart: 7.5,
    yEnd: 52.5,
    transitionZone: 0.005, // Extended fade out for maximum overlap
    colors: {
        primary: 0x0066ff, // Ocean blue
        secondary: 0x00ccff, // Bioluminescent cyan
        accent: 0xff66ff, // Jellyfish glow
        background: 0x001030, // Deep ocean dark
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATH-CORRIDOR SAMPLER
// ═══════════════════════════════════════════════════════════════════════════════

// The whole environment group is anchored at the chapter-2 path centre (x,y,z) with NO
// rotation, so every per-instance aBase is a LOCAL offset from that centre. The camera
// dollies UP the spline (y ~124 -> ~293, curving out in x/z near the top), so content
// placed in a fixed scatter cloud around the anchor mostly sits off to the side / behind
// the climbing camera and never reads (the bug in the screenshots). This sampler walks
// the chapter-2 path range, converts each sampled world point into the group's LOCAL
// space (subtract the anchor centre), builds a cheap perpendicular frame from the local
// travel tangent, and returns LOCAL positions strung ALONG the corridor with a lateral
// offset inside [minRadius, maxRadius] — so the moving camera actually flies past them.
//
// Returns { sample(rand01, lateralRadius, jitter) -> {x,y,z}, ok } where sample() picks a
// point at parametric position rand01 along the chapter, offset laterally by ~lateralRadius
// in the corridor cross-section. `ok` is false in the standalone pilot harness (no curve),
// where callers fall back to the legacy scatter so the pilot page still renders.
function createCorridorSampler(anchor) {
    let curve = null;
    try {
        curve = getOdysseyPathCurve();
    } catch {
        curve = null;
    }
    const chapterPositions = getActiveOdysseyChapterPositions();
    const tStart = chapterPositions?.[1];
    const tEnd = chapterPositions?.[2];
    if (!curve || !anchor || !Number.isFinite(tStart) || !Number.isFinite(tEnd)) {
        return { ok: false, sample: null };
    }

    // Pre-sample the corridor centreline + a perpendicular frame at a handful of stations
    // so sample() is allocation-free at call time (create-time only).
    const STATIONS = 16;
    const stations = [];
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= STATIONS; i += 1) {
        const t = tStart + (tEnd - tStart) * (i / STATIONS);
        curve.getPointAt(t, point);
        curve.getTangentAt(t, tangent).normalize();
        // Build a stable perpendicular frame (corridor cross-section axes).
        right.copy(worldUp).cross(tangent);
        if (right.lengthSq() < 1e-5) right.set(1, 0, 0);
        right.normalize();
        up.copy(tangent).cross(right).normalize();
        stations.push({
            cx: point.x - anchor.x,
            cy: point.y - anchor.y,
            cz: point.z - anchor.z,
            rx: right.x,
            ry: right.y,
            rz: right.z,
            ux: up.x,
            uy: up.y,
            uz: up.z,
        });
    }

    function sample(rand01, lateralRadius, jitter = 0) {
        const f = THREE.MathUtils.clamp(rand01, 0, 1) * STATIONS;
        const idx = Math.min(STATIONS - 1, Math.floor(f));
        const frac = f - idx;
        const a = stations[idx];
        const b = stations[idx + 1] ?? a;
        // Interpolate the centreline + frame between adjacent stations.
        const cx = a.cx + (b.cx - a.cx) * frac;
        const cy = a.cy + (b.cy - a.cy) * frac;
        const cz = a.cz + (b.cz - a.cz) * frac;
        // Lateral offset in the corridor cross-section: a random angle + radius so motes
        // ring the path rather than sitting on one side.
        const ang = Math.random() * Math.PI * 2;
        const r = lateralRadius;
        const ox = (a.rx * Math.cos(ang) + a.ux * Math.sin(ang)) * r;
        const oy = (a.ry * Math.cos(ang) + a.uy * Math.sin(ang)) * r;
        const oz = (a.rz * Math.cos(ang) + a.uz * Math.sin(ang)) * r;
        const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
        const jy = jitter ? (Math.random() - 0.5) * jitter : 0;
        const jz = jitter ? (Math.random() - 0.5) * jitter : 0;
        return { x: cx + ox + jx, y: cy + oy + jy, z: cz + oz + jz };
    }

    return { ok: true, sample };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

export function createDeepOceanEnvironment(options = {}) {
    const group = new THREE.Group();
    group.name = 'deep-ocean-environment';
    group.userData.chapterId = 2;
    group.userData.yStart = DEEP_OCEAN_CONFIG.yStart;
    group.userData.yEnd = DEEP_OCEAN_CONFIG.yEnd;

    // Shared uniforms — TSL uniform() nodes ticked via .value in the update loop.
    // uDepth (0 at the chapter foot → 1 at the surface breach) scripts the creative
    // plan's depth ladder: darker-before-lighter water, god-ray density, the caustic
    // ceiling's approach, the entry vent glow, and the exit skylight panes.
    // uOpacity is the manager-driven ecotone crossfade bridge shared by every fading
    // material in the chapter (exposed via material.uniforms so _collectOpacityTargets
    // reaches TSL opacityNode materials — the seam-bleed fix).
    const uniforms = {
        uTime: uniform(0),
        uDepth: uniform(0),
        uOpacity: uniform(1),
        uSteamEntry: uniform(1),
        // 1.1 — god-ray hero amplitude, driven from OdysseyDirector audio state each frame
        // (1 = calm, up to ~1.8 on energy/beat). Defaults to 1 with no director (playground).
        uGodRayPulse: uniform(1),
        // GLB hero-manta escort window (0→1 across the ~0.52 pass) — lifts the manta's
        // ventral bioluminescent rim and tightens its arc into the formation hold.
        uEscort: uniform(0),
    };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(2);
    const fallbackCenterY = (DEEP_OCEAN_CONFIG.yStart + DEEP_OCEAN_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const waterSurfaceY = chapterRange
        ? chapterRange.end.y - ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET
        : chapterCenterY + 20;
    const surfaceOffsetY = waterSurfaceY - chapterCenterY;

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    // Build the path-corridor sampler from the FINAL anchor centre (the same x,y,z the
    // group is positioned at below) so every per-instance aBase lands in the corridor the
    // camera actually flies up — not a fixed scatter cloud beside it. `ok` is false in the
    // pilot harness (no curve); placement falls back to the legacy scatter there.
    const anchor = chapterRange?.center
        ? { x: chapterRange.center.x, y: chapterCenterY, z: chapterRange.center.z }
        : { x: 0, y: chapterCenterY, z: 0 };
    const corridor = createCorridorSampler(anchor);

    // 1. Ocean Gradient Background (TSL NodeMaterial) — uDepth scripts the ladder.
    const oceanGradient = createOceanGradientTSL({ uDepth: uniforms.uDepth });
    group.add(oceanGradient.mesh);

    // 2. Water Surface (Looking up) — brightens + fills the frame on the final approach.
    const waterSurface = createWaterSurfaceTSL(uniforms.uTime, surfaceOffsetY, {
        uDepth: uniforms.uDepth,
        uOpacity: uniforms.uOpacity,
    });
    group.add(waterSurface.mesh);

    // 3. Volumetric God Rays — TSL NodeMaterial, shares uTime. The cones are re-placed
    // ALONG the corridor (createGodRaysTSL stations them in local space, then we shift the
    // whole group up the path) so 2-3 shafts cross the climbing camera's sightline. Light
    // density narrates the ascent (uDepth) and warms slightly at the breach.
    const rays = createGodRaysTSL(uniforms.uTime, {
        uDepth: uniforms.uDepth,
        uOpacity: uniforms.uOpacity,
        uGodRayPulse: uniforms.uGodRayPulse,
    });
    placeGodRaysAlongCorridor(rays.group, corridor);
    group.add(rays.group);

    // 3b. Far seabed silhouette — the abyssal floor far below the path, fading into
    // murk. Placed well under the chapter center so it anchors the bottom of the frame.
    const seabed = createSeabedTSL(uniforms.uTime, { uOpacity: uniforms.uOpacity });
    seabed.mesh.position.set(0, -70, -40);
    group.add(seabed.mesh);

    // 3c. Kelp / coral clusters rooted near the seabed (swaying instanced billboards).
    const kelp = createKelpClusters(uniforms, 18);
    group.add(kelp);

    // 3d. Creature layer (creative plan assets 1 + 5): instances 1–3 are the HERO MANTA
    // TRIO — choreographed banked crossings at progress stations ~0.22/0.52/0.82, sized
    // 35–55 so a wing silhouette actually reads — while instance 0 is the leviathan,
    // DEMOTED to one extreme-distance background crossing (a scale cue, never competing
    // with the mantas). The rest stay small distant whales/rays/jellies.
    // When a pipeline-authored hero-manta GLB is present, it carries the manta trio
    // (real 3D geometry + a glide clip + the escort moment), so the billboard impostor
    // mantas are skipped (those instances fall through to distant scatter). Without the
    // GLB, the billboard heroes carry the chapter exactly as before.
    const useGlbMantas = hasChapter2CreatureAssets();
    const creatures = createCreatureSilhouettes(uniforms, 10, corridor, useGlbMantas);
    group.add(creatures);

    // Hero manta GLB (fire-and-forget; no-op without the asset). Init the registries
    // first so the update loop is safe before the async load resolves.
    group.userData.mantaFlights = [];
    group.userData.mantaMixers = [];
    if (useGlbMantas) {
        loadDeepOceanMantas(group, uniforms, corridor).catch((err) => {
            console.warn('[DeepOcean] manta load error:', err);
        });
    }

    // 3e. Hydrothermal vent glow (creative plan asset 9) — Chapter 1's drowned First
    // Heart, refracted and wobbling below the camera for the chapter's first few
    // percent. Entry-only (uDepth-gated in the material).
    const ventGlow = createVentGlowTSL(uniforms.uTime, {
        uDepth: uniforms.uDepth,
        uOpacity: uniforms.uOpacity,
    });
    const ventSeat = corridor.ok ? corridor.sample(0.02, 3) : { x: 0, y: -70, z: -20 };
    ventGlow.mesh.position.set(ventSeat.x, ventSeat.y - 14, ventSeat.z);
    ventGlow.mesh.scale.set(30, 30, 1);
    group.add(ventGlow.mesh);
    group.userData.ventGlow = ventGlow.mesh;

    // 3f. Fractured SKYLIGHT PANES (creative plan Transition Out) — refracted patches
    // of the Chapter 3 sky just under the wave surface, fading in across the last ~12%
    // of the climb so the breach is built up over ~8 seconds instead of popping.
    const panes = createSkylightPanes(uniforms, corridor, surfaceOffsetY);
    group.add(panes);
    group.userData.skylightPanes = panes;

    // 3g. THE PEARL GATE (creative plan asset 4) — the nacreous threshold ON the rail
    // at ~0.68 progress that the camera passes through, replacing the unlit black torus
    // read. Oriented to face along the path tangent like the chapter markers.
    const gate = createPearlGateTSL(uniforms.uTime, { uOpacity: uniforms.uOpacity });
    if (corridor.ok) {
        const gateSeat = corridor.sample(0.68, 0);
        const gateAhead = corridor.sample(0.72, 0);
        gate.mesh.position.set(gateSeat.x, gateSeat.y, gateSeat.z);
        const gateDir = new THREE.Vector3(
            gateAhead.x - gateSeat.x,
            gateAhead.y - gateSeat.y,
            gateAhead.z - gateSeat.z,
        ).normalize();
        gate.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gateDir);
    } else {
        gate.mesh.position.set(0, 6, -42);
    }
    group.add(gate.mesh);
    group.userData.pearlGate = gate.mesh;

    // 4. Bioluminescent Jellyfish — the PROCESSION (creative plan asset 2): 6–10 large
    // bells strung up the corridor at 18–40u lateral, never on the rail line, with the
    // magenta bells biased to the darkest stretch (progress 0.1–0.35) where they own
    // the frame.
    const jellyfishCount = Math.max(6, Math.min(10, Math.floor((options.particleCount || 500) / 36)));
    const jellyfish = createBioluminescentJellyfish(uniforms, jellyfishCount, corridor);
    group.add(jellyfish);
    group.userData.jellyfish = jellyfish;

    // 5. Bubbles — count trimmed further (fewer, brighter motes read as life, not flat
    // speckle noise; the flat additive murk was the chapter's #1 wash offender, and
    // every bubble is an additive overdraw layer, so the perf pass thins the field).
    const bubbles = createBubbleParticles(
        uniforms,
        Math.floor((options.particleCount || 400) * 0.32),
        corridor,
    );
    group.add(bubbles);

    // 6. Plankton — DENSER + more visible drifting motes, strung through the corridor so
    // the camera flies through a field of bioluminescent sparks (the additive cost stays
    // bounded because each quad is tiny and capped below blowout).
    const plankton = createPlanktonParticles(
        uniforms,
        Math.floor((options.particleCount || 600) * 0.47),
        corridor,
    );
    group.add(plankton);
    group.userData.plankton = plankton;

    // Anchor the whole ocean volume to the path's FULL center (x,y,z), not just Y, so
    // the god-ray cones, water ceiling and particle field stay wrapped around the path
    // as it swings out in X/Z — otherwise the forward camera can drift past the rays /
    // clip through the gradient backstop. (Mirrors mountain-peaks.js anchoring.)
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }
    group.userData.waterSurfaceY = waterSurfaceY;

    // Record the chapter's spline t-span so update() can map global camera progress
    // to the local 0→1 ascent (uDepth) with no per-frame allocation.
    const chapterPositions = getActiveOdysseyChapterPositions();
    group.userData.chapterTStart = chapterPositions?.[1] ?? 0.125;
    group.userData.chapterTEnd = chapterPositions?.[2] ?? 0.25;

    // Cache the per-frame animated set pieces on userData at create time so the update
    // loop never re-walks the scene graph (was 3× getObjectByName/frame). Jellyfish now
    // animate entirely in their shader, so the loop only needs the god-rays + bubbles.
    group.userData.animated = {
        godRays: rays.group,
        bubbles,
    };

    return group;
}

// Re-place the god-ray cones ALONG the corridor so the shafts plunge through the
// climbing camera's sightline at several depths, instead of clustering at one fixed point
// beside the anchor. Each cone keeps its lateral spread + tilt (so they read as separate
// shafts) but its local centre is moved to a corridor station; the cone geometry already
// hangs its wide base UP and feathers downward, so a small +Y lift keeps the bright entry
// near the surface. No-op (keeps the authored layout) in the pilot harness where the
// corridor is unavailable.
function placeGodRaysAlongCorridor(rayGroup, corridor) {
    // The shafts are now ONE InstancedMesh (god-rays-instanced) carrying the six authored
    // transforms in rayInstances/instanceMatrix. Re-place by editing each instance's stored
    // position then recomposing its matrix with its base rotation.z (drift is added later by
    // the update loop) — identical math to the old per-Mesh ray.position.set().
    const instanced = rayGroup?.children?.[0];
    const instances = instanced?.userData?.rayInstances;
    if (!corridor.ok || !instanced || !instances?.length) return;
    const n = instances.length;
    instances.forEach((inst, i) => {
        // Spread the shafts up the corridor (t 0.15..0.9) so the camera meets fresh rays
        // as it climbs; keep the authored lateral X spread + tilt for separation.
        const t = 0.15 + (i / Math.max(1, n - 1)) * 0.75;
        const c = corridor.sample(t, 12 + (i % 3) * 10);
        // Lift the cone so its bright wide top sits above the station (light from above).
        inst.position.set(inst.position.x * 0.6 + c.x, c.y + 24, c.z);
        updateGodRayInstanceMatrix(instanced, i, inst.baseRotZ);
    });
    instanced.instanceMatrix.needsUpdate = true;
}

// Creature silhouettes — instanced billboard quads at multiple depths. Each instance
// picks a shape (0 whale, 1 ray, 2 jelly, 3 COLOSSAL leviathan hero), a size, a base
// tint and a world center; the material depth-tints by world Y so deeper creatures sink
// into shadow.
//
// FLAGSHIP REMAKE: instance 0 is reserved for ONE colossal bioluminescent LEVIATHAN
// (shape 3, aSize ~80) crossing the corridor laterally at the mid-act sightline depth
// (z ~ -55, y ~ -8) — the unforgettable hero beat — with its flank markings + slow X
// traverse driven in the material. The remaining instances stay small distant whales/
// rays/jellies for layered depth (NOT competing silhouettes).
function createCreatureSilhouettes(uniforms, count, corridor, skipHeroMantas = false) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const shapes = new Float32Array(count);
    const tints = new Float32Array(count * 3);

    // Mostly dark silhouette tints; jellies get a faintly luminous base so the glow
    // term in the material has something to lift. The leviathan gets a deep teal-indigo
    // base so its flank markings + body rim (added in the material) read as luminous.
    const whaleTint = new THREE.Color(0x0a1830);
    const rayTint = new THREE.Color(0x0c1c34);
    const jellyTint = new THREE.Color(0x2a6cff);
    const leviathanTint = new THREE.Color(0x081a2e);

    const phases = new Float32Array(count);
    const mantaTint = new THREE.Color(0x0c2238);

    // Hero manta pass stations (creative plan asset 1): progress ~0.22 / 0.52 / 0.82,
    // each entering off-axis and crossing the corridor 20–35u ahead of the camera's
    // sightline on a banked arc (the arc itself runs in the material from aPhase).
    // Pass two sits in the god-ray band (rays are stationed t 0.15–0.9), so the middle
    // crossing is backlit — the chapter's trailer frame.
    const mantaPasses = [
        { t: 0.22, size: 38, phase: 0.0 },
        { t: 0.52, size: 52, phase: 2.1 },
        { t: 0.82, size: 44, phase: 4.2 },
    ];

    for (let i = 0; i < count; i += 1) {
        if (i === 0) {
            // The leviathan, DEMOTED (creative plan asset 5): one extreme-distance
            // crossing at ~0.45 progress, below and beyond the manta layer — a scale
            // cue on the far side of the water column, never a competing silhouette.
            if (corridor?.ok) {
                const c = corridor.sample(0.45, 30);
                positions[0] = c.x - 12;
                positions[1] = c.y - 18;
                positions[2] = c.z - 110; // far beyond the manta layer
            } else {
                positions[0] = -28;
                positions[1] = -20;
                positions[2] = -120;
            }
            shapes[0] = 3;
            sizes[0] = 70;
            phases[0] = 0;
            tints[0] = leviathanTint.r;
            tints[1] = leviathanTint.g;
            tints[2] = leviathanTint.b;
            continue;
        }

        if (!skipHeroMantas && i <= mantaPasses.length) {
            // HERO MANTA TRIO: shape 4, sized 35–55, seated tight on the corridor so
            // the banked arc (±46u lateral in the material) carries each one across
            // the visible frustum 20–35u ahead of the camera.
            const pass = mantaPasses[i - 1];
            if (corridor?.ok) {
                const c = corridor.sample(pass.t, 6);
                positions[i * 3] = c.x;
                positions[i * 3 + 1] = c.y + 4;
                positions[i * 3 + 2] = c.z - 28; // ahead of the station, in the sightline
            } else {
                positions[i * 3] = 0;
                positions[i * 3 + 1] = i * 8 - 8;
                positions[i * 3 + 2] = -30 - i * 10;
            }
            shapes[i] = 4;
            sizes[i] = pass.size;
            phases[i] = pass.phase;
            tints[i * 3] = mantaTint.r;
            tints[i * 3 + 1] = mantaTint.g;
            tints[i * 3 + 2] = mantaTint.b;
            continue;
        }

        // Distribute the remaining creatures DOWN the corridor (varied t) at a far lateral
        // radius + extra depth jitter so they read as distant masses descending past the
        // climbing camera, not a fixed cloud behind the anchor.
        if (corridor?.ok) {
            const t = 0.12 + Math.random() * 0.82;
            const c = corridor.sample(t, 55 + Math.random() * 60, 40);
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = c.y - Math.random() * 24; // bias a touch deeper
            positions[i * 3 + 2] = c.z - 30 - Math.random() * 80; // push behind the sightline
        } else {
            positions[i * 3] = (Math.random() - 0.5) * 180;
            positions[i * 3 + 1] = 18 - Math.random() * 80;
            positions[i * 3 + 2] = -70 - Math.random() * 160;
        }

        // Bias toward whales/rays (big distant masses); a few jellies for glow.
        const r = Math.random();
        let shape = 2; // jelly
        if (r < 0.4) shape = 0; // whale
        else if (r < 0.75) shape = 1; // ray
        shapes[i] = shape;

        // Small distant whales/rays/jellies (the heroes own the foreground scale).
        const baseSizes = [18, 14, 8];
        const base = baseSizes[shape];
        sizes[i] = base + Math.random() * base * 0.5;
        phases[i] = Math.random() * Math.PI * 2;

        const tintByShape = [whaleTint, rayTint, jellyTint];
        const tint = tintByShape[shape];
        tints[i * 3] = tint.r;
        tints[i * 3 + 1] = tint.g;
        tints[i * 3 + 2] = tint.b;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aShape: { array: shapes, itemSize: 1 },
        aTint: { array: tints, itemSize: 3 },
        aPhase: { array: phases, itemSize: 1 },
    });

    const mat = createCreatureSilhouetteMaterial(uniforms.uTime, {
        uOpacity: uniforms.uOpacity,
        uDepth: uniforms.uDepth,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ocean-creatures';
    mesh.frustumCulled = false;
    mesh.renderOrder = -60;
    return mesh;
}

// Kelp / coral clusters — instanced swaying billboards rooted near the seabed.
function createKelpClusters(uniforms, count) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const tints = new Float32Array(count * 3);

    const kelpTints = [
        new THREE.Color(0x0b3a2e), // dark kelp green
        new THREE.Color(0x103f3a), // teal-green
        new THREE.Color(0x0a2f3c), // dark teal coral
    ];

    // FLAGSHIP REMAKE: CLUSTER the kelp around the sunken bioluminescent REEF pockets
    // (which the seabed material lights on the dune crests near the corridor center)
    // instead of scattering it evenly — clustered glowing kelp reads as a living reef.
    // A few cluster centers in the crest band; each kelp instance jitters around one.
    const reefCenters = [
        { x: -34, z: -84 },
        { x: 26, z: -120 },
        { x: -6, z: -150 },
        { x: 44, z: -64 },
    ];

    for (let i = 0; i < count; i += 1) {
        // Root clusters around the reef pocket centers (low Y, seabed crest band).
        const c = reefCenters[i % reefCenters.length];
        positions[i * 3] = c.x + (Math.random() - 0.5) * 30;
        positions[i * 3 + 1] = -64 + Math.random() * 8; // near the seabed surface
        positions[i * 3 + 2] = c.z + (Math.random() - 0.5) * 36;

        sizes[i] = 14 + Math.random() * 22; // cluster height

        const tint = kelpTints[Math.floor(Math.random() * kelpTints.length)];
        tints[i * 3] = tint.r;
        tints[i * 3 + 1] = tint.g;
        tints[i * 3 + 2] = tint.b;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTint: { array: tints, itemSize: 3 },
    });

    const mat = createKelpClusterMaterial(uniforms.uTime, { uOpacity: uniforms.uOpacity });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ocean-kelp';
    mesh.frustumCulled = false;
    mesh.renderOrder = -70;
    return mesh;
}

// Bioluminescent jellyfish — a SINGLE instanced billboard impostor system. Previously
// each jelly was a THREE.Group of (Sphere24x16 dome + Sphere16x12 core + Sprite glow)
// with its own three materials (~3 draws + 3 programs each → ~72 draws for the field)
// plus a per-frame CPU loop walking every group to drift + pulse it. Now ALL jellies
// share ONE NodeMaterial drawn as instanced camera-facing quads; the impostor mask
// folds the dome + core + glow into one quad, and the drift/pulse run in the shader
// from a per-instance phase + uTime — so the update loop never touches them again.
function createBioluminescentJellyfish(uniforms, count, corridor) {
    // Saturated bioluminescent palette (electric cyan, luminous blue, magenta, green,
    // pale cyan) — unchanged from the old per-jelly MeshBasicMaterial colours so each
    // jelly still reads as a true light source on the teal→indigo gradient.
    const jellyColors = [
        new THREE.Color(0x00ffff), // Electric cyan
        new THREE.Color(0x1188ff), // Deep luminous blue
        new THREE.Color(0xff44dd), // Magenta glow
        new THREE.Color(0x44ffbb), // Bioluminescent green
        new THREE.Color(0x66ddff), // Pale cyan
    ];

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const pulseRates = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        // String the jellies UP the corridor (evenly spaced t + jitter) at 18–40u
        // lateral — never on the rail line — so the climbing camera passes a procession
        // of glowing bells. Fall back to the legacy scatter only in the pilot harness.
        const t = (i + Math.random() * 0.7) / count;
        if (corridor?.ok) {
            const c = corridor.sample(t, 18 + Math.random() * 22, 10);
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = c.y;
            positions[i * 3 + 2] = c.z;
        } else {
            positions[i * 3] = (Math.random() - 0.5) * 120;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 35;
            positions[i * 3 + 2] = -15 - Math.random() * 70;
        }

        // BIGGER jellies so they read as the chapter's signature creatures (was *3.2 off a
        // 0.8..2.3 radius). Fewer + larger glowing bells beats a scatter of tiny dots.
        const size = 1.4 + Math.random() * 2.2;
        sizes[i] = size * 3.6;

        // Magenta bells own the darkest stretch (t < 0.35, the abyssal twilight act);
        // elsewhere the cyan/blue/green family carries the procession.
        const magenta = jellyColors[2];
        let color;
        if (t < 0.35 && Math.random() < 0.6) {
            color = magenta;
        } else {
            const cool = [jellyColors[0], jellyColors[1], jellyColors[3], jellyColors[4]];
            color = cool[Math.floor(Math.random() * cool.length)];
        }
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        // Per-instance phase desyncs the in-shader drift + pulse (replaces the old
        // userData {t, speed, pulsePhase}).
        phases[i] = Math.random() * Math.PI * 2;
        // 1.5 — per-instance pulse RATE (~2-4s period) so bells flash independently, not in lockstep.
        pulseRates[i] = 0.35 + Math.random() * 0.45;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
        aPhase: { array: phases, itemSize: 1 },
        aPulseRate: { array: pulseRates, itemSize: 1 },
    });

    const mat = createJellyfishMaterial(uniforms.uTime, { uOpacity: uniforms.uOpacity });
    const mesh = new THREE.Mesh(geo, mat);
    // Keep the historical name so getObjectByName('jellyfish-group') (and any external
    // lookup) still resolves; the update loop now reads it from cached userData.
    mesh.name = 'jellyfish-group';
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    return mesh;
}

// Bubbles — instanced billboard quads (THREE.Points renders as 1px on WebGPU).
function createBubbleParticles(uniforms, count, corridor) {
    const positions = new Float32Array(count * 3);
    const speed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        if (corridor?.ok) {
            const t = Math.random();
            const c = corridor.sample(t, 14 + Math.random() * 40, 20);
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = c.y;
            positions[i * 3 + 2] = c.z;
        } else {
            positions[i * 3] = (Math.random() - 0.5) * 120;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
            positions[i * 3 + 2] = -10 - Math.random() * 50;
        }
        speed[i] = 1.0 + Math.random() * 3.0;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
    });
    // Keep a plain `position` attribute view of the per-instance bases so the update
    // loop can rise/recycle bubbles exactly like the old THREE.Points geometry did.
    const baseAttr = geo.getAttribute('aBase');
    // Recycle window tracks the corridor: bubbles rise toward the surface and wrap to the
    // abyss, so they keep streaming through whatever stretch the camera is climbing (the
    // old fixed -20..20 window left the corridor mostly bubble-free once it climbed past).
    const riseTop = corridor?.ok ? 92 : 20;
    const riseBottom = corridor?.ok ? -92 : -20;
    geo.userData = { speed, riseTop, riseBottom };

    // Create circular bubble texture (canvas map preserved)
    const bubbleTexture = createCircularTexture(0.9, 0.3);

    // World-size from the old pixel size (0.8 → small world quad).
    const center = attribute('aBase', 'vec3');
    const sprite = texture(bubbleTexture, uv());

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = billboardWorld(center, 0.8);
    mat.colorNode = sprite.rgb.mul(vec3(0.667, 0.867, 1.0)); // tint ≈ 0xaaddff
    mat.opacityNode = sprite.a.mul(0.6).mul(uniforms.uOpacity);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.side = THREE.FrontSide; // 1.3 — camera-facing billboard, back face never seen (free fill)
    mat.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'bubbles';
    mesh.frustumCulled = false;
    // Expose the per-instance base attribute so updateDeepOceanEnvironment can
    // read/write the per-bubble Y (the billboard center) and flag it for re-upload.
    mesh.userData.baseAttribute = baseAttr;
    return mesh;
}

/**
 * Create circular glow texture for particles
 */
function createCircularTexture(innerOpacity = 1.0, outerOpacity = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${innerOpacity})`);
    gradient.addColorStop(0.4, `rgba(200, 230, 255, ${innerOpacity * 0.7})`);
    gradient.addColorStop(0.7, `rgba(150, 200, 255, ${outerOpacity * 2})`);
    gradient.addColorStop(1, 'rgba(100, 150, 200, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    return new THREE.CanvasTexture(canvas);
}

function createPlanktonParticles(uniforms, count, corridor) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const drifts = new Float32Array(count * 2); // (speed, phase) per mote

    // Bioluminescent plankton colors (more saturated cyan/green/magenta sparks so the
    // motes pop as drifting bioluminescence rather than a pale haze).
    const planktonColors = [
        new THREE.Color(0x00ffbb), // Cyan-green spark
        new THREE.Color(0x00ccff), // Electric blue
        new THREE.Color(0x66ffaa), // Vivid green
        new THREE.Color(0xff66dd), // Magenta mote
    ];

    // CREATIVE PLAN asset 3 — three explicit DEPTH TIERS so the field reads with
    // parallax instead of uniform snow:
    //   near  (lateral <12u):  large, soft, DIM, fast parallax drift
    //   mid   (12–30u):        medium, the brightest tier
    //   far   (>30u):          small, sharp, faint
    // Tier brightness is baked into aColor (net budget ~40% below the old 1.55×0.95).
    const TIERS = [
        {
            weight: 0.3, latMin: 4, latMax: 12, sizeMin: 0.55, sizeMax: 0.9, gain: 0.5, speed: 2.4,
        },
        {
            weight: 0.45, latMin: 12, latMax: 30, sizeMin: 0.3, sizeMax: 0.55, gain: 0.85, speed: 1.4,
        },
        {
            weight: 0.25, latMin: 30, latMax: 54, sizeMin: 0.16, sizeMax: 0.3, gain: 0.4, speed: 0.7,
        },
    ];

    for (let i = 0; i < count; i++) {
        const roll = Math.random();
        let tier = TIERS[2];
        if (roll < TIERS[0].weight) tier = TIERS[0];
        else if (roll < TIERS[0].weight + TIERS[1].weight) tier = TIERS[1];

        const lateral = tier.latMin + Math.random() * (tier.latMax - tier.latMin);
        if (corridor?.ok) {
            const t = Math.random();
            const c = corridor.sample(t, lateral, 16);
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = c.y;
            positions[i * 3 + 2] = c.z;
        } else {
            positions[i * 3] = (Math.random() - 0.5) * 150;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 50;
            positions[i * 3 + 2] = -10 - Math.random() * 70;
        }

        sizes[i] = tier.sizeMin + Math.random() * (tier.sizeMax - tier.sizeMin);

        // Tier gain baked into the colour so near motes are soft/dim and mid motes
        // carry the brightness — far-tier sparks sit well under the bloom threshold.
        const color = planktonColors[Math.floor(Math.random() * planktonColors.length)];
        colors[i * 3] = color.r * tier.gain;
        colors[i * 3 + 1] = color.g * tier.gain;
        colors[i * 3 + 2] = color.b * tier.gain;

        drifts[i * 2] = tier.speed * (0.8 + Math.random() * 0.4);
        drifts[i * 2 + 1] = Math.random() * 26.0;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
        aDrift: { array: drifts, itemSize: 2 },
    });

    // Create circular plankton texture (canvas map preserved)
    const planktonTexture = createCircularTexture(1.0, 0.1);

    const center = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const aDrift = attribute('aDrift', 'vec2');
    const sprite = texture(planktonTexture, uv());

    // ONE GLOBAL CURRENT (creative plan motion language): every mote drifts diagonally
    // up-corridor along the same vector — the chapter's pointer toward the surface —
    // wrapped over a 26u span so the field flows forever with zero per-frame CPU.
    const currentDir = vec3(0.3, 0.85, 0.25);
    const driftDist = mod(
        uniforms.uTime.mul(aDrift.x).add(aDrift.y),
        float(26.0),
    ).sub(13.0);
    const driftedCenter = center.add(currentDir.mul(driftDist));

    const mat = new THREE.MeshBasicNodeMaterial();
    // Scale per-particle world size by the old global size (0.4) + per-particle size.
    mat.positionNode = billboardWorld(driftedCenter, aSize.add(0.4));
    // Gains cut from 1.55/0.95 (creative plan: the old uniform-brightness soup lifted
    // the whole frame): tier gain lives in aColor, the global multipliers drop so the
    // value structure survives and only the mid tier reads bright.
    const steamTint = vec3(0.72, 0.9, 1.0).mul(0.68);
    mat.colorNode = sprite.rgb.mul(mix(aColor, steamTint, uniforms.uSteamEntry));
    mat.opacityNode = sprite.a.mul(0.62).mul(uniforms.uOpacity);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    // 1.3 — billboardWorld quads always face the camera, so the back face is never seen; FrontSide
    // halves the fragment cost on this dense additive field for zero visual change. (Winding probed
    // on plankton first per the plan; the other billboards follow once confirmed.)
    mat.side = THREE.FrontSide;
    mat.uniforms = { uOpacity: uniforms.uOpacity }; // ecotone crossfade bridge

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'plankton';
    mesh.frustumCulled = false;
    return mesh;
}

// Fractured skylight panes — instanced quads just under the wave surface near the
// chapter's end (the 2→3 surface-breach buildup). Geometry here, material in the
// .tsl.js builder (uDepth-gated reveal across the last ~12% of the climb).
function createSkylightPanes(uniforms, corridor, surfaceOffsetY) {
    const count = 6;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        if (corridor?.ok) {
            const t = 0.9 + (i / count) * 0.08;
            const c = corridor.sample(t, 6 + Math.random() * 14);
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = surfaceOffsetY - 3 - Math.random() * 5;
            positions[i * 3 + 2] = c.z;
        } else {
            positions[i * 3] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 1] = surfaceOffsetY - 4;
            positions[i * 3 + 2] = -10 - Math.random() * 30;
        }
        sizes[i] = 10 + Math.random() * 8;
        seeds[i] = Math.random();
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });
    const mat = createSkylightPaneMaterial(uniforms.uTime, {
        uDepth: uniforms.uDepth,
        uOpacity: uniforms.uOpacity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'skylight-panes';
    mesh.frustumCulled = false;
    mesh.renderOrder = -45;
    return mesh;
}

// `camera` is part of the ChapterEnvironmentManager update contract (kept for API
// parity); `cameraProgress` drives the uDepth ascent ladder; `directorState` carries the
// OdysseyDirector audio state (energy/beat) that swells the god-ray hero (1.1).
// eslint-disable-next-line no-unused-vars, max-len
export function updateDeepOceanEnvironment(group, delta, time, camera = null, cameraProgress = null, directorState = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // 1.1 — couple the god-ray hero amplitude to the music. OdysseyDirector publishes
    // post.godRay (0.4 calm -> ~0.8 at full energy) + beatPulse; map to a 1->1.8 envelope.
    // No director (playground / headless) leaves it at the calm base of 1.
    if (uniforms?.uGodRayPulse) {
        const godRay = directorState?.post?.godRay ?? 0.4;
        const beat = directorState?.beatPulse ?? 0;
        uniforms.uGodRayPulse.value = THREE.MathUtils.clamp(godRay / 0.4 + beat * 0.25, 1, 1.8);
    }

    // Ascent ladder — map GLOBAL camera progress to this chapter's local 0→1 (uDepth)
    // so the water column brightens, the god-rays multiply, the vent glow dies at the
    // entry, and the skylight panes build before the breach.
    if (uniforms?.uDepth && cameraProgress != null) {
        const tStart = group.userData.chapterTStart ?? 0.125;
        const tEnd = group.userData.chapterTEnd ?? 0.25;
        const span = Math.max(tEnd - tStart, 1e-4);
        const depth = THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1);
        uniforms.uDepth.value = depth;
        if (uniforms.uSteamEntry) {
            uniforms.uSteamEntry.value = 1 - THREE.MathUtils.smoothstep(depth, 0.02, 0.14);
        }
    }

    if (group.userData.jellyfish) {
        group.userData.jellyfish.visible = (uniforms?.uSteamEntry?.value ?? 0) < 0.18;
    }

    // GLB hero manta(s): tick the glide clip + drive the escort choreography (no-op
    // without the asset). Reads uDepth from uniforms internally for the escort window.
    updateDeepOceanMantas(group, delta, time);

    // Jellyfish now drift + pulse entirely in their instanced shader (from aPhase +
    // uTime), so there is no per-jelly CPU loop and no scene-walk for them anymore.

    // Animated set pieces are cached on userData at create time — no per-frame
    // getObjectByName scene-walk. (Falls back to a lookup only if a caller built the
    // group through some path that skipped the cache, to stay API-safe.)
    if (!group.userData.animated) {
        group.userData.animated = {
            godRays: group.getObjectByName('god-rays-tsl'),
            bubbles: group.getObjectByName('bubbles'),
        };
    }
    const { animated } = group.userData;

    // Drift the god-ray shafts slowly so the light feels alive (the per-ray
    // driftPhase desyncs them); internal shimmer/volume already animate via uTime. The six
    // shafts are now ONE InstancedMesh: spin each instance's rotation.z exactly as the old
    // per-Mesh write did (baseRotZ + sin(time*0.15 + driftPhase)*0.03) by recomposing its
    // instanceMatrix — same angle, same compose order, so the motion is pixel-identical.
    const { godRays } = animated;
    const godRayInstanced = godRays?.children?.[0];
    const rayInstances = godRayInstanced?.userData?.rayInstances;
    if (godRayInstanced && rayInstances?.length) {
        for (let i = 0; i < rayInstances.length; i += 1) {
            const inst = rayInstances[i];
            const rotZ = inst.baseRotZ + Math.sin(time * 0.15 + inst.driftPhase) * 0.03;
            updateGodRayInstanceMatrix(godRayInstanced, i, rotZ);
        }
        godRayInstanced.instanceMatrix.needsUpdate = true;
    }

    // Update bubbles — rise the per-instance base Y and recycle, then flag the
    // instanced attribute for upload (billboard quads read aBase as their center).
    // Creative plan Transition Out: the streams ACCELERATE toward the surface across
    // the final act, becoming the pearl-bubble rush of the breach.
    const { bubbles } = animated;
    const baseAttr = bubbles?.userData?.baseAttribute;
    // Skip the full per-frame instanced-attribute buffer re-upload while the chapter is
    // off-screen (group.visible is driven by the manager's opacity gate). Bubbles only rise
    // and recycle, so freezing their Y while invisible is imperceptible — they resume from
    // the same position the frame the chapter becomes visible again. Avoids a whole-buffer
    // GPU re-upload every frame for a chapter the camera isn't in.
    if (bubbles && baseAttr && group.visible) {
        const depthValue = uniforms?.uDepth ? uniforms.uDepth.value : 0;
        const breachRush = 1 + 1.6 * THREE.MathUtils.smoothstep(depthValue, 0.8, 1);
        const pos = baseAttr.array;
        const { speed, riseTop = 20, riseBottom = -20 } = bubbles.geometry.userData;
        for (let i = 0; i < speed.length; i++) {
            pos[i * 3 + 1] += speed[i] * breachRush * delta;
            if (pos[i * 3 + 1] > riseTop) pos[i * 3 + 1] = riseBottom;
        }
        baseAttr.needsUpdate = true;
    }
}

export default {
    config: DEEP_OCEAN_CONFIG,
    create: createDeepOceanEnvironment,
    update: updateDeepOceanEnvironment,
};

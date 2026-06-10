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
} from './deep-ocean.tsl.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

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

    // Shared time uniform — a TSL uniform() node so it can feed the .tsl.js builders
    // while still being ticked via .value in the update loop (same surface as before).
    const uniforms = { uTime: uniform(0) };
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

    // 1. Ocean Gradient Background (TSL NodeMaterial)
    const oceanGradient = createOceanGradientTSL();
    group.add(oceanGradient.mesh);

    // 2. Water Surface (Looking up) — TSL NodeMaterial, shares uTime
    const waterSurface = createWaterSurfaceTSL(uniforms.uTime, surfaceOffsetY);
    group.add(waterSurface.mesh);

    // 3. Volumetric God Rays — TSL NodeMaterial, shares uTime. The cones are re-placed
    // ALONG the corridor (createGodRaysTSL stations them in local space, then we shift the
    // whole group up the path) so 2-3 shafts cross the climbing camera's sightline.
    const rays = createGodRaysTSL(uniforms.uTime);
    placeGodRaysAlongCorridor(rays.group, corridor);
    group.add(rays.group);

    // 3b. Far seabed silhouette — the abyssal floor far below the path, fading into
    // murk. Placed well under the chapter center so it anchors the bottom of the frame.
    const seabed = createSeabedTSL(uniforms.uTime);
    seabed.mesh.position.set(0, -70, -40);
    group.add(seabed.mesh);

    // 3c. Kelp / coral clusters rooted near the seabed (swaying instanced billboards).
    const kelp = createKelpClusters(uniforms, 26);
    group.add(kelp);

    // 3d. Far creature silhouettes (whales / rays / jellyfish) strung DOWN the corridor at
    // multiple depths so the frame reads with layered life as the camera climbs; the hero
    // leviathan crosses the mid-act sightline.
    const creatures = createCreatureSilhouettes(uniforms, 9, corridor);
    group.add(creatures);

    // 4. Bioluminescent Jellyfish — FEWER + BIGGER + brighter, distributed ALONG the
    // corridor so the camera passes a string of glowing jellies (was a scatter cloud the
    // climbing camera mostly missed).
    const jellyfishCount = Math.max(6, Math.floor((options.particleCount || 500) / 36));
    const jellyfish = createBioluminescentJellyfish(uniforms, jellyfishCount, corridor);
    group.add(jellyfish);

    // 5. Bubbles — count trimmed further (fewer, brighter motes read as life, not flat
    // speckle noise; the flat additive murk was the chapter's #1 wash offender, and
    // every bubble is an additive overdraw layer, so the perf pass thins the field).
    const bubbles = createBubbleParticles(
        uniforms,
        Math.floor((options.particleCount || 400) * 0.45),
        corridor,
    );
    group.add(bubbles);

    // 6. Plankton — DENSER + more visible drifting motes, strung through the corridor so
    // the camera flies through a field of bioluminescent sparks (the additive cost stays
    // bounded because each quad is tiny and capped below blowout).
    const plankton = createPlanktonParticles(
        uniforms,
        Math.floor((options.particleCount || 600) * 0.7),
        corridor,
    );
    group.add(plankton);

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
    if (!corridor.ok || !rayGroup?.children?.length) return;
    const rays = rayGroup.children;
    const n = rays.length;
    rays.forEach((ray, i) => {
        // Spread the shafts up the corridor (t 0.15..0.9) so the camera meets fresh rays
        // as it climbs; keep the authored lateral X spread + tilt for separation.
        const t = 0.15 + (i / Math.max(1, n - 1)) * 0.75;
        const c = corridor.sample(t, 12 + (i % 3) * 10);
        // Lift the cone so its bright wide top sits above the station (light from above).
        ray.position.set(ray.position.x * 0.6 + c.x, c.y + 24, c.z);
    });
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
function createCreatureSilhouettes(uniforms, count, corridor) {
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

    for (let i = 0; i < count; i += 1) {
        if (i === 0) {
            // THE HERO: one colossal leviathan crossing the MID-ACT sightline. Placed at a
            // corridor station ~halfway up the chapter, pushed ~55u ahead of that station
            // (down-path) so the climbing camera sees it crossing the frame off-centre. The
            // material adds the slow lateral X traverse + flank-marking pulse.
            if (corridor?.ok) {
                const c = corridor.sample(0.5, 18);
                positions[0] = c.x - 12;
                positions[1] = c.y - 6;
                positions[2] = c.z - 45; // ahead of the station, down the corridor
            } else {
                positions[0] = -28;
                positions[1] = -8;
                positions[2] = -55;
            }
            shapes[0] = 3;
            sizes[0] = 84; // aSize ~70-90 (vs 26 for the old generic whale)
            tints[0] = leviathanTint.r;
            tints[1] = leviathanTint.g;
            tints[2] = leviathanTint.b;
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

        // Small distant whales/rays/jellies (the hero owns the foreground scale).
        const baseSizes = [18, 14, 8];
        const base = baseSizes[shape];
        sizes[i] = base + Math.random() * base * 0.5;

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
    });

    const mat = createCreatureSilhouetteMaterial(uniforms.uTime);
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

    const mat = createKelpClusterMaterial(uniforms.uTime);
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

    for (let i = 0; i < count; i += 1) {
        // String the jellies UP the corridor (evenly spaced t + jitter) at a mid lateral
        // radius so the climbing camera passes a procession of glowing jellies. Fall back
        // to the legacy scatter only in the pilot harness.
        if (corridor?.ok) {
            const t = (i + Math.random() * 0.7) / count;
            const c = corridor.sample(t, 18 + Math.random() * 34, 14);
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

        const color = jellyColors[Math.floor(Math.random() * jellyColors.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        // Per-instance phase desyncs the in-shader drift + pulse (replaces the old
        // userData {t, speed, pulsePhase}).
        phases[i] = Math.random() * Math.PI * 2;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
        aPhase: { array: phases, itemSize: 1 },
    });

    const mat = createJellyfishMaterial(uniforms.uTime);
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
    mat.opacityNode = sprite.a.mul(0.6);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.side = THREE.DoubleSide;

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

    // Bioluminescent plankton colors (more saturated cyan/green/magenta sparks so the
    // motes pop as drifting bioluminescence rather than a pale haze).
    const planktonColors = [
        new THREE.Color(0x00ffbb), // Cyan-green spark
        new THREE.Color(0x00ccff), // Electric blue
        new THREE.Color(0x66ffaa), // Vivid green
        new THREE.Color(0xff66dd), // Magenta mote
    ];

    for (let i = 0; i < count; i++) {
        // Fill the corridor cross-section the camera flies through (close + mid lateral
        // radii) all the way UP the chapter, so the motes drift in the sightline as a
        // dense bioluminescent field rather than a flat far-away haze.
        if (corridor?.ok) {
            const t = Math.random();
            const c = corridor.sample(t, 8 + Math.random() * 46, 16);
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = c.y;
            positions[i * 3 + 2] = c.z;
        } else {
            positions[i * 3] = (Math.random() - 0.5) * 150;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 50;
            positions[i * 3 + 2] = -10 - Math.random() * 70;
        }

        // BIGGER motes so they read as drifting sparks (was 0.15..0.45). Closer ones are
        // larger so the field has depth; the additive cost stays bounded (capped count).
        sizes[i] = 0.3 + Math.random() * 0.6;

        // Random color from palette
        const color = planktonColors[Math.floor(Math.random() * planktonColors.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    const geo = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
    });

    // Create circular plankton texture (canvas map preserved)
    const planktonTexture = createCircularTexture(1.0, 0.1);

    const center = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const sprite = texture(planktonTexture, uv());

    const mat = new THREE.MeshBasicNodeMaterial();
    // Scale per-particle world size by the old global size (0.4) + per-particle size.
    mat.positionNode = billboardWorld(center, aSize.add(0.4));
    // Brighter, tighter bioluminescent pops: lift the core gain and the alpha so the
    // motes read as crisp drifting sparks. Small additive quads — no frame blowout.
    mat.colorNode = sprite.rgb.mul(aColor).mul(1.55);
    mat.opacityNode = sprite.a.mul(0.95);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.AdditiveBlending;
    mat.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'plankton';
    mesh.frustumCulled = false;
    return mesh;
}

export function updateDeepOceanEnvironment(group, delta, time) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

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
    // driftPhase desyncs them); internal shimmer/volume already animate via uTime.
    const { godRays } = animated;
    if (godRays) {
        godRays.children.forEach((ray) => {
            const phase = ray.userData.driftPhase || 0;
            ray.rotation.z = (ray.userData.baseRotZ ??= ray.rotation.z)
                + Math.sin(time * 0.15 + phase) * 0.03;
        });
    }

    // Update bubbles — rise the per-instance base Y and recycle, then flag the
    // instanced attribute for upload (billboard quads read aBase as their center).
    const { bubbles } = animated;
    const baseAttr = bubbles?.userData?.baseAttribute;
    if (bubbles && baseAttr) {
        const pos = baseAttr.array;
        const { speed, riseTop = 20, riseBottom = -20 } = bubbles.geometry.userData;
        for (let i = 0; i < speed.length; i++) {
            pos[i * 3 + 1] += speed[i] * delta;
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

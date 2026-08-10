/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Deep Ocean (Chapter 2) — TSL/WebGPU pilot conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P2 — pilot chapter). See
 * docs/ODYSSEY_AAA_MASTER_PLAN.md §3.8. Faithful TSL ports of deep-ocean.js's three
 * GLSL ShaderMaterials — the deep-sea gradient sphere, the Gerstner-wave water
 * ceiling with caustics, and the volumetric god-ray cones — rebuilt as NodeMaterials
 * so they run on THREE.WebGPURenderer and its WebGL2 fallback.
 *
 * COHESION WAVE (Phase B): the chapter was reading as a flat caustic wall, so this
 * pass establishes the iconic ocean depth cues without touching shared files:
 *   - a STRONGER vertical depth gradient (sunlit teal up top -> deep indigo abyss),
 *     with a soft surface light-disc near the apex so the eye reads "surface far above";
 *   - SOFTER, feathered, animated descending GOD-RAYS (no white blob, no blowout);
 *   - a far SEABED silhouette (dune ridges fading into murk) — createSeabedTSL;
 *   - a procedural CREATURE-SILHOUETTE billboard material (whale/ray/jelly masks,
 *     depth-tinted by world Y) — createCreatureSilhouetteMaterial.
 * The corridor field still supplies the far teal depth murk; this module owns the
 * chapter's own hero/mid set pieces.
 *
 * The Ashima `snoise` calls map to `snoise3` (built-in MaterialX gradient noise) in
 * the shared TSL noise lib. The additive water/god-rays/creatures are tagged
 * `userData.emitsBloom = true` for the future MRT selective-bloom pass; emissiveNode
 * is wired when the TSL post graph lands (kept off here so the standalone pilot
 * harness, which has no MRT bloom, does not double-brighten).
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    clamp,
    cos,
    dot,
    float,
    length,
    max,
    min,
    mix,
    normalView,
    normalWorld,
    normalize,
    oneMinus,
    positionLocal,
    positionViewDirection,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { snoise3, fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld } from './shared/odyssey-tsl-billboard.js';
import { buildOdysseyWaterSurface } from './shared/odyssey-water-surface.tsl.js';

// ── Deep-sea gradient sphere (-100 backstop; must NOT bloom) ─────────────────────

export function createOceanGradientTSL(options = {}) {
    // FLAGSHIP REMAKE: "The Sunlit Descent into the Abyss." Strong vertical depth
    // gradient — a more saturated sunlit teal near the surface, a richer mid blue, and
    // a DEEPER velvet indigo abyss (pulled toward 0x020510 so the lower frame can fall
    // into real darkness and the ch2 toe/vignette finally engage). This is the single
    // biggest cohesion cue — the frame must read top=light, bottom=dark.
    //
    // CREATIVE PLAN (Ch2 depth ladder): the chapter gets DARKER BEFORE IT GETS LIGHTER.
    // uDepth (0 at the chapter foot → 1 at the breach) scripts the ascent: progress
    // 0–0.35 plays in abyssal twilight (the upper palette dimmed), then the water
    // column brightens toward the sunlit teal ceiling across the climb — the light
    // narrates the ascent rather than a static gradient the camera happens to sit in.
    const uDepth = options.uDepth ?? uniform(0);
    const uColorTop = uniform(new THREE.Color(0x149aae)); // sunlit teal near surface
    // Vibrancy plan 3.2 — three GRADED bands instead of an indigo->teal jump. uColorMid is the
    // documented missing mid-teal (#0a4a66) so the 0.35-0.7 act climbs through a real cobalt-teal
    // value; uColorBottom lifts the near-black #020510 to a velvet indigo #04101f that still reads
    // as the darkest band (value ~10, under the plan's ~#0a1a2e floor cap) but holds chroma.
    const uColorMid = uniform(new THREE.Color(0x0a4a66)); // mid teal (the missing third band)
    const uColorBottom = uniform(new THREE.Color(0x04101f)); // velvet indigo abyss (darkest band)

    // Use the gradient sphere's LOCAL radial direction for the vertical blend. The
    // environment group is anchored ~209 units UP the path, so feeding positionWorld here
    // made normalize(positionWorld).y ~ +1 across the whole backstop (the +209 anchor
    // dominates) — collapsing the gradient into a flat bright teal wall (the screenshots).
    // The sphere is centred on the group origin, so positionLocal is already the radial
    // offset from centre → normalize(positionLocal).y is true up/down on the dome.
    const dir = normalize(positionLocal);
    const t = dir.y;

    // Bias the midpoint downward so more of the lower frame falls into the abyss —
    // makes the descent feel deep rather than evenly split.
    const upMix = smoothstep(0.0, 0.85, t);
    const downMix = smoothstep(0.0, 0.62, t.negate());
    // Progress-mapped light: at the chapter foot the whole upper column is dimmed to
    // abyssal twilight; the sunlit read is EARNED across the climb.
    // Vibrancy plan 3.1 — push the ascent curve LATER (0.2->0.9, was 0.05->0.75 which saturated
    // by 75%) and dim HARDER at the foot (lightScale floor 0.32, was 0.5) so twilight owns the
    // first ~35%. The down band now dims with the column too (lightScale*0.6+0.4, was *0.4+0.6)
    // so the abyss deepens at the foot instead of only the top. Floor stays 0.32 (not 0) so the
    // entry never reads as a >50% black void — the bio jellies/reef/manta are the bright contrast.
    const ascent = smoothstep(0.2, 0.9, uDepth);
    const lightScale = mix(float(0.32), float(1.0), ascent);
    const up = mix(uColorMid, uColorTop, upMix).mul(lightScale);
    const down = mix(uColorMid.mul(lightScale.mul(0.6).add(0.4)), uColorBottom, downMix);
    let color = mix(down, up, step(0.0, t));

    // Soft surface light-disc: a feathered brightening toward the apex so the eye reads
    // "the surface is far above". Concentrated near +Y. The additive lift is REDUCED
    // (was 0.10,0.26,0.30) and tinted cool so the top stays bright-but-teal — never
    // near-white (the old pale wash) once ACES + threshold bloom act downstream. The
    // disc strengthens with ascent so the promise of the surface grows on approach.
    const surfaceGlow = pow(smoothstep(0.5, 0.98, t), 2.0);
    color = color.add(vec3(0.06, 0.17, 0.21).mul(surfaceGlow).mul(ascent.mul(0.7).add(0.3)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;
    material.fog = false;

    const geometry = new THREE.SphereGeometry(280, 32, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return { mesh, material, geometry };
}

// ── Water ceiling (the breach membrane) — now the shared Odyssey water surface ────

export function createWaterSurfaceTSL(uTime, surfaceOffsetY = 20, options = {}) {
    const uDepth = options.uDepth ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);

    // The breach ceiling is now the ONE shared Odyssey water surface (unified with the Ch3
    // sea/river/lake — see shared/odyssey-water-surface.tsl.js). uDepth ignites the caustic
    // underside on the ascent; from below the camera reads the caustic-teal ceiling, and the SAME
    // material shows its golden-hour top once breached — so "coming up through the water" is one
    // membrane, not a cyan→gold material swap. baseAlpha 0.8 + radial edge match the old ceiling's
    // soft vignette; uWaveScale 1 keeps the full Gerstner swell of the deep-ocean surface.
    const { material } = buildOdysseyWaterSurface(uTime, {
        uDepth,
        uOpacity,
        uWaveScale: uniform(1),
        useRadialEdge: true,
        baseAlpha: 0.8,
    });
    material.uniforms = { uOpacity }; // ecotone crossfade bridge (preserve the existing hook)

    const geometry = new THREE.PlaneGeometry(300, 300, 48, 48);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = surfaceOffsetY;
    return { mesh, material, geometry };
}

// ── Animated CAUSTIC PROJECTION (shared by god-rays + seabed/reef) ────────────────

/**
 * The signature refracted-light cue: two scrolling, sharpened noise layers (the same
 * exponent-4 two-layer graph used by createWaterSurfaceTSL) sampled on a planar UV so
 * the bright veins read as moving caustic light cast onto a surface — NOT flat speckle.
 * Returns a scalar in ~[0,1] (sharp bright veins, dark water between). Caller scales it.
 * @param {*} planarUv vec2 node — the projection plane coordinate (xz world, or shaft uv)
 * @param {*} time float node — the shared uTime uniform
 * @param {number} [freq] base frequency of the caustic lattice
 */
function causticProjection(planarUv, time, freq = 0.15) {
    const cUv = planarUv.mul(freq);
    const c1 = snoise3(vec3(cUv.x, cUv.y, time.mul(0.2)));
    const c2 = snoise3(vec3(cUv.x.mul(1.4), cUv.y.mul(1.4), time.mul(-0.15)));
    // Sharper exponent => bright veins with dark water between (refracted light, not haze).
    return pow(c1.add(c2).mul(0.5).add(0.5), 4.0);
}

// ── Volumetric god-ray cones (additive, bloom-eligible) — HERO of the chapter ─────

export function createGodRaysTSL(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uDepth = options.uDepth ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uGodRayPulse = options.uGodRayPulse ?? uniform(1);
    const vUv = uv();
    const vPos = positionLocal;

    // Rays are brightest at the TOP (where they enter from the surface far above) and
    // feather to nothing as they descend — the iconic ocean light-shaft cue. Cone uv.y
    // runs 0 (apex) -> 1 (base); the cone is translated so its wide base is up top, so
    // brightness should track (1 - uv.y) softened with a gentle power.
    const verticalFade = pow(oneMinus(vUv.y), 1.15);

    // Internal volume: bias toward distinct soft columns, but keep it SOFT (lower
    // exponent than a hard volumetric, so no crisp white edges -> no blowout).
    const noisePos = vec3(vPos.x.mul(0.05), vPos.y.mul(0.02).add(time.mul(0.08)), vPos.z.mul(0.05));
    const volumeNoise = pow(snoise3(noisePos).mul(0.5).add(0.5), 1.35);
    const volume = volumeNoise.mul(0.85);

    // Animated CAUSTIC PROJECTION moving DOWN the shaft length: bright veins crawl
    // along uv.y over time so the shaft reads as refracted, rippling light, not a flat
    // cone. Sampled on the cone uv (x lateral, y down the length).
    const shaftCaustic = causticProjection(
        vec2(vUv.x.mul(3.0), vUv.y.mul(2.0).add(time.mul(-0.12))),
        time,
        1.0,
    ).mul(0.55).add(0.6);

    // Feather hard at the cone edges so shafts melt into the water (no flat blob).
    const edgeFade = pow(oneMinus(pow(abs(vUv.x.sub(0.5)).mul(2.0), 1.6)), 1.4);
    const shimmer = sin(vPos.y.mul(0.28).add(time.mul(1.6))).mul(0.16).add(0.84);
    // Brighter than before (0.30 -> 0.45) so the rays carry the frame as the hero, but
    // still soft-feathered and capped well below blowout (ACES + bloom act downstream).
    // CREATIVE PLAN: light density narrates the ascent — the shafts strengthen with
    // chapter progress (sparse at the abyssal foot, multiplying toward the breach).
    const ascentLight = smoothstep(0.1, 0.85, uDepth).mul(0.5).add(0.5);
    const alphaBase = verticalFade.mul(edgeFade).mul(volume);
    // 1.1 — the hero shafts swell with the music (uGodRayPulse 1->~1.8). The clamp(alpha,0,0.92)
    // ceiling below stays the hard cap so swells brighten the shafts but never run into blowout.
    const alpha = alphaBase.mul(shimmer).mul(shaftCaustic).mul(0.45).mul(ascentLight)
        .mul(uGodRayPulse)
        .mul(uOpacity);

    // Cool teal-blue shaft (kept well off pure white) so the rays read as filtered sea
    // light rather than an over-exposed highlight. On the final approach (the breach)
    // the shafts warm slightly toward the daylight they are about to become.
    const breachWarm = smoothstep(0.85, 1.0, uDepth);
    const topColor = mix(vec3(0.42, 0.80, 0.94), vec3(0.62, 0.84, 0.82), breachWarm.mul(0.6));
    const bottomColor = vec3(0.10, 0.34, 0.60);
    const color = mix(bottomColor, topColor, verticalFade);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = clamp(alpha, 0.0, 0.92);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge

    // TALLER cones (150 -> 220) so the shafts plunge from far above all the way through
    // the mid-frame — reads as light raining down, not a local glow.
    const geometry = new THREE.ConeGeometry(12, 220, 16, 12, true);
    geometry.translate(0, -110, 0);

    const group = new THREE.Group();
    group.name = 'god-rays-tsl';

    // PERF (zero-visual): the 6 shafts all SHARE this one geometry+material and differ
    // ONLY by transform (position / rotation.x / rotation.z / non-uniform scale) plus a
    // per-shaft driftPhase that the env update loop spins via rotation.z. That is exactly
    // the InstancedMesh case — six separate Mesh draws collapse into ONE instanced draw
    // (and one pipeline instead of six). Each shaft's per-instance transform is carried in
    // instanceMatrix, composed bit-for-bit the way Object3D.updateMatrix() would compose a
    // child Mesh (compose(position, quaternionFromEuler(x,0,z,'XYZ'), scale)), so the
    // rendered image is identical. The per-instance authored state lives on userData so the
    // corridor re-placement (placeGodRaysAlongCorridor) and the per-frame rotation.z drift
    // (updateDeepOceanEnvironment) can recompose the same matrices.
    const rayCount = 6;
    const instances = [];
    for (let i = 0; i < rayCount; i += 1) {
        const angle = (i / rayCount) * Math.PI * 0.9 - Math.PI * 0.45;
        const radius = 22 + i * 16;
        const s = 0.5 + i * 0.1;
        instances.push({
            // LOWER origin (55 -> ~30) and spread across depth so 2-3 shafts cross the
            // level mid-act sightline instead of entering above the frame; reach deep below.
            position: new THREE.Vector3(Math.sin(angle) * radius, 30, -34 - i * 16),
            rotX: -0.04,
            baseRotZ: (i - 2.5) * 0.07,
            scale: new THREE.Vector3(s, 1.0, s),
            driftPhase: i * 1.7,
        });
    }

    const rays = new THREE.InstancedMesh(geometry, material, rayCount);
    rays.name = 'god-rays-instanced';
    rays.frustumCulled = false;
    rays.userData.emitsBloom = true;
    rays.userData.rayInstances = instances;
    // Seed the instance matrices from the authored transforms (no drift yet).
    for (let i = 0; i < rayCount; i += 1) {
        updateGodRayInstanceMatrix(rays, i, instances[i].baseRotZ);
    }
    rays.instanceMatrix.needsUpdate = true;

    group.add(rays);
    group.userData.emitsBloom = true;
    return { group, material, geometry };
}

// Recompose god-ray instance `i`'s matrix exactly as Object3D.updateMatrix() composes a
// child Mesh — compose(position, quaternionFromEuler(rotX, 0, rotZ, 'XYZ'), scale) — so an
// InstancedMesh instance is pixel-identical to the old per-shaft Mesh. `rotZ` is the (drifted)
// rotation.z; rotX/position/scale come from the authored per-instance state on userData.
// Used at build time, by the corridor re-placement, and by the per-frame drift, so all three
// paths share one compose order (the only safe way to keep this zero-visual). Module-scope
// scratch objects avoid per-call allocation in the update loop.
const _godRayPos = new THREE.Vector3();
const _godRayQuat = new THREE.Quaternion();
const _godRayEuler = new THREE.Euler();
const _godRayScale = new THREE.Vector3();
const _godRayMat = new THREE.Matrix4();

export function updateGodRayInstanceMatrix(instancedMesh, i, rotZ) {
    const inst = instancedMesh.userData.rayInstances?.[i];
    if (!inst) return;
    _godRayPos.copy(inst.position);
    _godRayEuler.set(inst.rotX, 0, rotZ, 'XYZ');
    _godRayQuat.setFromEuler(_godRayEuler);
    _godRayScale.copy(inst.scale);
    _godRayMat.compose(_godRayPos, _godRayQuat, _godRayScale);
    instancedMesh.setMatrixAt(i, _godRayMat);
}

// ── Far seabed silhouette — dune ridges fading into murk (backstop-ish) ───────────

export function createSeabedTSL(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);

    // Vertex displacement: gentle rolling dunes from ridged FBM so the seabed has a
    // silhouette ridgeline rather than a flat plate. Cheap (the plane is low-res).
    const posL = positionLocal;
    const ridge = ridged3(vec3(posL.x.mul(0.012), posL.y.mul(0.012), 0.0)).mul(14.0);
    const swell = fbm3(vec3(posL.x.mul(0.03), posL.y.mul(0.03), time.mul(0.02))).mul(4.0);
    const displaced = vec3(posL.x, posL.y, ridge.add(swell));

    const vWorld = varying(positionWorld);
    const vRise = varying(ridge.add(swell));

    // Depth tint: the seabed is the deepest thing in frame — near-black indigo, with a
    // faint cooler crest where the dunes rise. Keep it a SILHOUETTE (dark), readable
    // against the slightly-less-dark abyss gradient behind it.
    const crest = smoothstep(0.0, 14.0, vRise);
    const deep = vec3(0.012, 0.020, 0.052);
    const lit = vec3(0.030, 0.060, 0.105);
    let color = mix(deep, lit, crest);

    // Animated CAUSTIC PROJECTION across the floor (refracted surface light dappling the
    // seabed) — sampled on world XZ so the veins crawl over the dunes as the camera
    // moves. Cool teal, soft, capped so it lifts the floor without washing it.
    const floorCaustic = causticProjection(vWorld.xz, time, 0.04);
    color = color.add(vec3(0.05, 0.14, 0.17).mul(floorCaustic).mul(0.6));

    // Sunken bioluminescent REEF payoff: a low-freq macro mask gates emissive reef
    // pockets onto the dune CRESTS (where crest>threshold), pulsing cyan<->magenta. The
    // dive-out hero beat at the bottom of the frame. Kept additive-soft (capped) so the
    // pockets glow as light sources, never clip.
    const reefMask = fbm3(vec3(vWorld.x.mul(0.018), vWorld.z.mul(0.018), 0.0), 4)
        .mul(0.5).add(0.5);
    const reefPocket = smoothstep(0.55, 0.78, reefMask).mul(smoothstep(6.0, 13.0, vRise));
    const reefPulse = sin(time.mul(1.1).add(vWorld.x.mul(0.05))).mul(0.5).add(0.5);
    const reefCyan = vec3(0.16, 1.0, 0.82); // 0x2affd0
    const reefMagenta = vec3(1.0, 0.37, 0.82); // 0xff5fd0
    const reefColor = mix(reefCyan, reefMagenta, reefPulse);
    const reefGlow = reefPocket.mul(reefPulse.mul(0.4).add(0.6)).mul(0.55);
    color = color.add(reefColor.mul(reefGlow));

    // Distance murk: fade the far edges of the seabed into the water so it does not end
    // with a hard line — world |x| for the corridor sides, PLUS a uv-based feather on
    // both plane axes so no straight geometry edge can ever read as a dark panel (the
    // placeholder-kill audit from the creative plan's screenshot diagnosis).
    const fade = oneMinus(smoothstep(80.0, 160.0, abs(vWorld.x)));
    const seabedUv = uv();
    const edgeFeatherX = smoothstep(0.0, 0.12, seabedUv.x)
        .mul(oneMinus(smoothstep(0.88, 1.0, seabedUv.x)));
    const edgeFeatherY = smoothstep(0.0, 0.12, seabedUv.y)
        .mul(oneMinus(smoothstep(0.88, 1.0, seabedUv.y)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = displaced;
    material.colorNode = color;
    material.opacityNode = clamp(fade, 0.0, 1.0)
        .mul(edgeFeatherX)
        .mul(edgeFeatherY)
        .mul(0.92)
        .mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge

    // Wide, shallow plane laid flat; subdivided enough for the dune displacement.
    const geometry = new THREE.PlaneGeometry(360, 200, 48, 24);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ocean-seabed';
    mesh.renderOrder = -90;
    return { mesh, material, geometry };
}

// ── Creature silhouettes — instanced billboard masks, depth-tinted by world Y ─────

/**
 * Procedural soft mask for a far ocean creature, selected per-instance by aShape:
 *   shape 0 → whale (long body + tail flukes)
 *   shape 1 → manta ray (wide flat wings)
 *   shape 2 → jellyfish (dome + trailing tendrils)
 *   shape 3 → COLOSSAL leviathan (long sinuous body + tail + dorsal hump)
 *   shape 4 → HERO MANTA (true diamond, swept wingtips, live wingbeat) — the trio that
 *             carries the chapter (creative plan asset 1)
 * The mask is intentionally SOFT and low-contrast so the creatures read as distant
 * silhouettes/glows, not crisp sprites. Returns the alpha mask in [0,1].
 * `time`/`phase` drive the hero manta's wingbeat; other shapes ignore them.
 */
function creatureMask(p, shape, time = float(0), phase = float(0)) {
    // p in [-0.5, 0.5] quad space; centred coords read naturally for the masks.
    const { x, y } = p;

    // --- Whale: elongated ellipse body + a triangular tail at the left. ---
    const bodyR = length(vec2(x.div(0.42), y.add(0.02).div(0.16)));
    const body = oneMinus(smoothstep(0.6, 1.0, bodyR));
    const tailEdge = abs(y).sub(max(float(0.0), x.negate().sub(0.34)).mul(1.6));
    // 1.6: soften the hard step() tail gate -> smoothstep so the fluke edge feathers (the old
    // step printed a hard triangle base, the "dark triangle" artifact in the review screenshots).
    const tail = oneMinus(smoothstep(0.0, 0.18, tailEdge)).mul(smoothstep(0.30, 0.40, x.negate()));
    const whale = max(body, tail);

    // --- Manta ray: wide, thin, swept wings (broad shallow ellipse). ---
    const rayR = length(vec2(x.div(0.48), y.div(0.10).add(abs(x).mul(2.2))));
    const ray = oneMinus(smoothstep(0.7, 1.0, rayR));

    // --- Jellyfish: dome on top + soft trailing tendrils below. ---
    const domeR = length(vec2(x.div(0.22), max(float(0.0), y.sub(0.05)).div(0.20)));
    const dome = oneMinus(smoothstep(0.5, 1.0, domeR));
    const tendrilX = abs(x.add(sin(y.mul(22.0)).mul(0.05)));
    const tendrils = oneMinus(smoothstep(0.0, 0.06, tendrilX))
        .mul(smoothstep(0.4, 0.0, y))
        .mul(step(y, 0.06));
    const jelly = max(dome, tendrils.mul(0.7));

    // --- COLOSSAL leviathan: a long, low, sinuous body that spans most of the quad,
    // a broad fluked tail at the left, and a soft dorsal arch on top. The body
    // centreline gently undulates so the silhouette reads as a swimming serpent/whale,
    // not a flat blob. Edges feathered so it stays a soft luminous shape. ---
    const spine = sin(x.mul(5.0)).mul(0.05); // gentle body undulation
    const levBodyR = length(vec2(x.div(0.46), y.sub(spine).div(0.115)));
    const levBody = oneMinus(smoothstep(0.55, 1.0, levBodyR));
    // Broad tail flukes at the left end (x < -0.34).
    const levTailEdge = abs(y.sub(spine)).sub(max(float(0.0), x.negate().sub(0.34)).mul(1.9));
    // 1.6: soften the hard step() tail gate (see whale) so the leviathan fluke feathers.
    const levTail = oneMinus(smoothstep(0.0, 0.16, levTailEdge)).mul(smoothstep(0.30, 0.40, x.negate()));
    // Dorsal arch: a low bump over the mid-body.
    const dorsal = oneMinus(smoothstep(0.0, 0.13, abs(y.sub(spine).sub(0.1))))
        .mul(oneMinus(smoothstep(0.0, 0.32, abs(x.add(0.05)))));
    const leviathan = max(max(levBody, levTail), dorsal.mul(0.6));

    // --- HERO MANTA: a true diamond silhouette with swept-back wingtips and a live
    // wingbeat. The wing centreline droops toward the tips (sweep) and the wingbeat
    // term flaps the tips far more than the body, so the silhouette visibly FLIES.
    // Width tapers hard toward |x|≈0.5 so the tips end in points, not a blunt ellipse
    // (the old shape-1 read as "unreadable black speck"). ---
    const mAx = abs(x);
    const flap = sin(time.mul(1.1).add(phase)).mul(pow(mAx.mul(2.0), 1.5)).mul(0.16);
    const mYc = mAx.mul(-0.22).add(flap); // swept centreline + wingbeat
    const mHalfW = max(float(0.02), float(0.16).mul(oneMinus(mAx.mul(1.9))));
    const mantaBody = oneMinus(smoothstep(0.55, 1.0, abs(y.sub(mYc)).div(mHalfW)));
    // Cephalic head bump at the centre + a thin trailing tail filament off the left.
    const mantaHead = oneMinus(smoothstep(0.0, 0.12, length(vec2(x.sub(0.02), y.sub(mYc).sub(0.02)))));
    const mantaTail = oneMinus(smoothstep(0.0, 0.02, abs(y.sub(mYc))))
        .mul(smoothstep(0.3, 0.48, x.negate()));
    const manta = max(max(mantaBody, mantaHead.mul(0.9)), mantaTail.mul(0.8));

    // Select by shape index (step gates).
    const isWhale = oneMinus(step(0.5, shape));
    const isRay = step(0.5, shape).mul(oneMinus(step(1.5, shape)));
    const isJelly = step(1.5, shape).mul(oneMinus(step(2.5, shape)));
    const isLev = step(2.5, shape).mul(oneMinus(step(3.5, shape)));
    const isManta = step(3.5, shape);
    return whale.mul(isWhale)
        .add(ray.mul(isRay))
        .add(jelly.mul(isJelly))
        .add(leviathan.mul(isLev))
        .add(manta.mul(isManta));
}

/**
 * Build the NodeMaterial for the instanced creature billboards. The geometry is built
 * in deep-ocean.js (makeQuadInstancedGeometry) with these per-instance attributes:
 *   aBase  vec3  world-space center
 *   aSize  float world half-extent (the billboard scale)
 *   aShape float 0=whale 1=ray 2=jelly
 *   aTint  vec3  base creature colour (mostly dark, jellies a touch luminous)
 *
 * The creatures are depth-tinted by world Y: deeper (lower Y, further from the lit
 * surface) → darker / more indigo, so multiple creatures at different depths read as a
 * layered descent. Bioluminescent rim keeps the silhouettes alive without blowing out.
 */
export function createCreatureSilhouetteMaterial(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uDepth = options.uDepth ?? uniform(0);

    const center = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aShape = attribute('aShape', 'float');
    const aTint = attribute('aTint', 'vec3');
    const aPhase = attribute('aPhase', 'float');

    const isJelly = step(1.5, aShape).mul(oneMinus(step(2.5, aShape)));
    const isLev = step(2.5, aShape).mul(oneMinus(step(3.5, aShape))); // background leviathan
    const isManta = step(3.5, aShape); // the hero manta trio (creative plan asset 1)

    // Gentle vertical bob per-instance (phase from center.x so they desync).
    const bob = sin(time.mul(0.4).add(center.x.mul(0.2))).mul(1.4);
    // Leviathan traverse: slides slowly across the corridor (X) on a dedicated slow
    // time term so it reads as one deliberate extreme-distance crossing.
    const levTraverse = sin(time.mul(0.06)).mul(48.0).mul(isLev);
    // HERO MANTA banked arcs: each manta crosses the corridor on a lateral-PLUS-
    // vertical ellipse (~39s period → one full crossing every ~20s, per the plan's
    // choreography), desynced by aPhase so the three passes never coincide.
    const mantaPhase = time.mul(0.16).add(aPhase);
    const mantaTravX = sin(mantaPhase).mul(46.0).mul(isManta);
    const mantaTravY = cos(mantaPhase).mul(9.0).mul(isManta);
    const animCenter = vec3(
        center.x.add(levTraverse).add(mantaTravX),
        center.y.add(bob).add(mantaTravY),
        center.z,
    );

    // Banking: roll the quad-space mask with the arc velocity so the manta leans into
    // its turn (cos of the traverse phase). Identity for every other shape.
    const bank = cos(mantaPhase).mul(0.38).mul(isManta);
    const cb = cos(bank);
    const sb = sin(bank);
    const rawUv = positionLocal.xy;
    const localUv = vec2(
        rawUv.x.mul(cb).sub(rawUv.y.mul(sb)),
        rawUv.x.mul(sb).add(rawUv.y.mul(cb)),
    );
    const mask = creatureMask(localUv, aShape, time, aPhase);

    // Vibrancy plan 1.6 — KILL THE FLAT-POLYGON read. At the real camera distance the distant
    // whale/ray/leviathan masks were rendering as hard dark geometric cutouts (even raw billboard
    // quads — straight-edged rectangles/triangles, see the review screenshots). A soft OUTER
    // FEATHER on the UNrotated quad coords guarantees no instance can ever show a straight quad
    // edge; the body lift + translucency below pull the silhouette off pure black so far masses
    // read as ghostly "denser water" forms instead of opaque holes punched in the frame.
    const quadFeather = oneMinus(smoothstep(0.32, 0.5, abs(rawUv.x)))
        .mul(oneMinus(smoothstep(0.32, 0.5, abs(rawUv.y))));

    // Depth tint by the instance's LOCAL corridor Y (the group is anchored ~209 units up
    // the path, so positionWorld.y saturates the old +40/90 band to 1.0 everywhere and
    // killed the descent shading). The local centre Y spans ~[-84, +84] across the
    // chapter corridor → map that to [0,1]: 1 = near surface (lighter), 0 = abyss (darker).
    const depthT = clamp(center.y.add(84.0).div(168.0), 0.0, 1.0);
    const depthDarken = mix(float(0.35), float(1.0), depthT);

    // Soft bioluminescent rim: jellies (shape 2) glow a touch; whales/rays read as
    // near-black silhouettes with only a faint cool edge.
    const rim = oneMinus(mask).mul(mask.mul(4.0)); // bright where the mask edge is
    const edge = clamp(rim, 0.0, 1.0);
    const pulse = sin(time.mul(1.3).add(center.x)).mul(0.2).add(0.8);

    // LEVIATHAN flank markings: a row of soft glowing spots/stripes running along the
    // body axis (local x), gated to the interior of the body so they read as
    // bioluminescent flanks — electric cyan, pulsing. Folded into colour so the hero
    // reads as luminous, not a flat shadow.
    const levMarkRow = oneMinus(smoothstep(0.0, 0.09, abs(localUv.y.add(0.02))));
    const levStripes = pow(sin(localUv.x.mul(26.0)).mul(0.5).add(0.5), 3.0);
    const levPulse = sin(time.mul(1.6).add(localUv.x.mul(4.0))).mul(0.35).add(0.65);
    const levMarks = levMarkRow.mul(levStripes).mul(mask).mul(isLev).mul(levPulse);
    const levCyan = vec3(0.21, 0.88, 1.0); // 0x35e0ff

    // HERO MANTA photophores: two rows of pulsing bioluminescent dots tracing the
    // ventral wing line (the plan's "ventral cyan rim + two photophore lines"), plus a
    // cyan rim biased to the underside so the silhouette reads lit-from-below by the
    // bio key #2ef0ff even when it crosses the dark column.
    const bioCyan = vec3(0.18, 0.94, 1.0); // #2ef0ff bio key
    const phAx = abs(localUv.x);
    const phFlap = sin(time.mul(1.1).add(aPhase)).mul(pow(phAx.mul(2.0), 1.5)).mul(0.16);
    const phYc = phAx.mul(-0.22).add(phFlap);
    const phDots = pow(sin(localUv.x.mul(34.0)).mul(0.5).add(0.5), 3.0);
    const phRowA = oneMinus(smoothstep(0.0, 0.022, abs(localUv.y.sub(phYc).add(0.045))));
    const phRowB = oneMinus(smoothstep(0.0, 0.022, abs(localUv.y.sub(phYc).add(0.08))));
    const photophores = phRowA.add(phRowB).mul(phDots).mul(mask).mul(isManta);
    const ventral = smoothstep(0.0, -0.1, localUv.y.sub(phYc));

    // Lift the silhouette off pure black toward the deep cool water (×0.55, mask-gated) so the
    // body reads as a translucent shape rather than an opaque hole; still dark enough to read as
    // a shadow against the abyss.
    let color = aTint.mul(depthDarken).add(vec3(0.05, 0.13, 0.22).mul(mask).mul(0.55));
    // Faint cool rimlight on all creatures; stronger glow on jellies.
    color = color.add(vec3(0.10, 0.30, 0.42).mul(edge).mul(0.5));
    color = color.add(aTint.mul(edge).mul(isJelly).mul(pulse).mul(1.6));
    // Leviathan: a soft cool body rim + the pulsing flank markings (capped under 1.0).
    color = color.add(levCyan.mul(0.4).mul(edge).mul(isLev));
    color = color.add(levCyan.mul(levMarks).mul(0.7));
    // Hero manta: ventral cyan rim + the two photophore rows, pulsing.
    color = color.add(bioCyan.mul(edge).mul(ventral).mul(isManta).mul(0.55));
    color = color.add(bioCyan.mul(photophores).mul(pulse).mul(0.85));

    // Silhouettes are mostly opaque-dark; jellies + leviathan + manta glow via stronger
    // alpha at the lit areas. Keep overall opacity moderate so they sit "in" the water.
    // More TRANSLUCENT silhouettes (0.78 -> 0.6) so the water shows through and they read as
    // ghostly distant masses; the whole alpha is gated by quadFeather so the billboard quad edge
    // can never print as a straight line (the rectangle/triangle artifact).
    const alpha = mask.mul(0.6)
        .add(edge.mul(isJelly).mul(0.4))
        .add(levMarks.mul(0.5))
        .add(photophores.mul(0.5))
        .mul(quadFeather);

    // 1.6: creatures belong to the deep — fade them out before the breach (gone by uDepth 0.9) so
    // the surfacing frame is about the sky, not a dark silhouette blob competing with the bright
    // water. (The escort manta at 0.52 and the leviathan at 0.45 are well below this, so untouched.)
    const surfaceFade = oneMinus(smoothstep(0.72, 0.9, uDepth));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(animCenter, aSize);
    material.colorNode = color;
    material.opacityNode = clamp(alpha, 0.0, 1.0).mul(uOpacity).mul(surfaceFade);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // NormalBlending for the dark silhouette bodies (additive would erase them); the
    // jelly/leviathan/manta glow is folded into colour so it still reads bright on the
    // deep gradient.
    material.blending = THREE.NormalBlending;
    material.fog = true;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    return material;
}

// ── Bioluminescent jellyfish — instanced billboard impostors ─────────────────────

/**
 * Procedural soft jellyfish impostor mask in quad space (uv runs 0..1; we centre to
 * [-0.5,0.5]). One billboard folds in what used to be THREE separate meshes per jelly
 * (a translucent dome, a brighter inner glow core, and an ambient glow sprite):
 *   - `bell`   : the rounded dome cap, brightest just under its rim;
 *   - `core`   : a tight bright inner blob (the old additive core sphere);
 *   - `tendrils`: a few soft trailing strands hanging below the bell;
 *   - `halo`   : a wide radial falloff (the old additive glow sprite).
 * Returns { mask, core, halo } scalar nodes the material composes so the jelly reads
 * as a luminous translucent creature, not a flat disc. Intentionally soft (no crisp
 * edges) so it matches the additive look of the old three-mesh jelly.
 * @param {*} coord vec2 node — quad uv() in [0,1]
 * @param {*} time  float node — shared uTime
 * @param {*} phase float node — per-instance phase so tendrils/pulse desync
 */
function jellyfishImpostor(coord, time, phase) {
    const p = coord.sub(0.5); // centre to [-0.5, 0.5]
    const { x, y } = p;

    // Bell dome: a broad rounded cap occupying the upper half. Squash Y so it reads as
    // a flattened jellyfish bell; only the upper portion (y>~ -0.05) is the cap.
    const bellR = length(vec2(x.div(0.34), max(float(0.0), y.add(0.06)).div(0.30)));
    const bell = oneMinus(smoothstep(0.45, 1.0, bellR));

    // Inner glow core: a tight bright blob just inside the bell (the old core sphere).
    const coreR = length(vec2(x.div(0.16), y.add(0.02).div(0.18)));
    const core = oneMinus(smoothstep(0.2, 0.9, coreR));

    // Trailing tendrils: a few soft vertical strands hanging below the bell, gently
    // waving with time so the jelly looks alive. Only present below the bell (y<0).
    const wave = sin(y.mul(16.0).add(time.mul(2.0).add(phase))).mul(0.04);
    const strandX = min(
        abs(x.add(wave)),
        abs(x.sub(0.12).add(wave)),
        abs(x.add(0.12).add(wave)),
    );
    const tendrils = oneMinus(smoothstep(0.0, 0.05, strandX))
        .mul(smoothstep(0.0, -0.45, y)) // fade in as we descend below the bell
        .mul(step(y, 0.0));

    // Ambient halo: wide soft radial falloff (the old glow sprite at scale 4.5).
    const haloR = length(p).mul(2.0);
    const halo = pow(oneMinus(clamp(haloR, 0.0, 1.0)), 1.6);

    const mask = max(bell, tendrils.mul(0.6));
    return { mask, core, halo };
}

/**
 * Build the NodeMaterial for the instanced jellyfish billboards. The geometry is built
 * in deep-ocean.js (makeQuadInstancedGeometry) with these per-instance attributes:
 *   aBase  vec3  world-space center (the drift origin)
 *   aSize  float world half-extent (the billboard scale)
 *   aColor vec3  bioluminescent tint
 *   aPhase float per-instance phase (drift + pulse desync)
 *
 * All the per-jelly motion that used to run on the CPU (float drift, breathing pulse)
 * now happens in the shader from aPhase + uTime, so the update loop no longer walks the
 * jellyfish group or touches per-jelly transforms — eliminating ~72 draws and a
 * per-frame scene-walk + per-jelly JS loop.
 */
export function createJellyfishMaterial(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);

    const center = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const aPhase = attribute('aPhase', 'float');
    const aPulseRate = attribute('aPulseRate', 'float');

    // Gentle floating drift — folds the old per-jelly CPU position wander (sin/cos on
    // x/y/z) into the vertex shader so the CPU never touches each jelly again.
    const driftX = cos(time.mul(0.3).add(aPhase)).mul(2.2);
    const driftY = sin(time.mul(0.5).add(aPhase)).mul(1.6)
        .add(sin(time.mul(0.18).add(aPhase.mul(0.7))).mul(2.0));
    const driftZ = sin(time.mul(0.2).add(aPhase.mul(0.5))).mul(1.4);
    const animCenter = vec3(center.x.add(driftX), center.y.add(driftY), center.z.add(driftZ));

    // 1.5 — desync the pulse RATE (not just phase): each jelly breathes on its own ~2-4s rhythm
    // (aPulseRate ~0.35-0.8) so the procession stops throbbing in lockstep (which read as one UI
    // pulse) and becomes a field of independent living things.
    const pulse = sin(time.mul(aPulseRate).add(aPhase)).mul(0.1).add(1.0);
    const size = aSize.mul(pulse);

    const coord = uv();
    const { mask, core, halo } = jellyfishImpostor(coord, time, aPhase);

    // Compose colour: a translucent tinted bell + a brighter core + a soft halo, all
    // additive (matches the old AdditiveBlending three-mesh jelly). Core glow pulses. The
    // jellies are now FEWER + BIGGER (the chapter's signature creatures), so the bell body
    // + halo are lifted so the larger bells read as luminous glowing domes (not flat discs)
    // and feather softly into the water — still capped additive (clamp below) so no blowout.
    // 1.4/1.5 — two-color bioluminescence with an EASED flash. The core is hot-shifted toward
    // white-cyan (a real bell reads saturated-rim + near-white core), giving each jelly internal
    // value structure so the core crosses the bloom threshold while the bell body feathers below.
    // The flash holds dark then snaps bright (pow easing) on the per-instance rate, so distant
    // bells read purely as rhythmic light. The bell body stays lit (never strobes to black).
    const coreFlash = pow(sin(time.mul(aPulseRate.mul(1.15)).add(aPhase.mul(1.3))).mul(0.5).add(0.5), 1.6);
    const corePulse = coreFlash.mul(0.5).add(0.55);
    const coreColor = mix(aColor, vec3(0.55, 1.0, 0.95), 0.55); // hot white-cyan core (bounded so magenta bells stay magenta)
    let color = aColor.mul(mask.mul(0.68)); // translucent bell body (lifted)
    color = color.add(coreColor.mul(core).mul(corePulse).mul(1.6)); // hot inner core, eased flash
    color = color.add(aColor.mul(halo).mul(0.5)); // wider, softer ambient glow halo

    // Alpha mirrors the old layered opacities but folded into one additive quad so the
    // silhouette stays soft + luminous.
    //
    // PLACEHOLDER KILL (creative plan item 4): the tendril band reached the quad's
    // bottom edge at non-zero alpha, printing the "pink rectangles" of frames 11–15.
    // A hard quad-edge feather on BOTH axes (additive blending shows color, so it
    // multiplies color AND alpha) guarantees every term reaches exactly zero before
    // the geometry edge.
    const edgeFeather = oneMinus(smoothstep(0.40, 0.5, abs(coord.x.sub(0.5))))
        .mul(oneMinus(smoothstep(0.40, 0.5, abs(coord.y.sub(0.5)))));
    color = color.mul(edgeFeather);
    const alpha = mask.mul(0.46)
        .add(core.mul(0.85).mul(corePulse))
        .add(halo.mul(0.55))
        .mul(edgeFeather);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(animCenter, size);
    material.colorNode = color;
    material.opacityNode = clamp(alpha, 0.0, 1.0).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide; // 1.3 — camera-facing billboard, back face never seen (free fill)
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    return material;
}

// ── Kelp / coral cluster silhouettes — swaying instanced billboards ──────────────

/**
 * Procedural kelp-frond mask: a clump of tall, thin blades rising from the base of
 * the quad, narrowing toward the top. Quad uv runs (0,0) bottom-left -> (1,1) top.
 * Returns alpha in [0,1].
 */
function kelpMask(coord) {
    const u = coord.x;
    const v = coord.y;

    // A few blades at fixed lateral offsets; each blade sways more toward its tip.
    // blade(centreU): soft vertical strip that thins with height and rises from v=0.
    const blade = (centreU, lean) => {
        // Lateral drift increases with height (v) — the lean argument curls the tip.
        const cu = u.sub(centreU).add(v.mul(lean));
        const width = mix(float(0.05), float(0.012), v); // tapers toward the tip
        const strip = oneMinus(smoothstep(0.0, 1.0, abs(cu).div(width)));
        // Fade in from the base, fade out near the very top so blades look organic.
        const vmask = smoothstep(0.0, 0.08, v).mul(oneMinus(smoothstep(0.85, 1.0, v)));
        return strip.mul(vmask);
    };

    const b1 = blade(float(0.32), float(0.10));
    const b2 = blade(float(0.50), float(-0.04));
    const b3 = blade(float(0.68), float(0.14));
    return max(max(b1, b2), b3);
}

/**
 * Material for instanced kelp/coral clusters. Per-instance attributes (built in
 * deep-ocean.js):
 *   aBase  vec3  world-space base (bottom-centre) of the cluster
 *   aSize  float world height of the cluster
 *   aTint  vec3  base frond colour (dark teal/green)
 * The fronds sway with a current driven by uTime + world X, and are depth-tinted by
 * world Y so deeper clusters sink into shadow. Anchored to the base (not centre) so
 * they appear rooted to the seabed.
 */
export function createKelpClusterMaterial(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);

    const center = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTint = attribute('aTint', 'vec3');

    const coord = uv();

    // Sway: lateral offset grows with height (uv.y), driven by a slow current. Phase
    // from the cluster's world X so neighbours don't sway in lockstep. Applied at the
    // top of the blade and tapering to 0 at the rooted base via coord.y^2.
    const sway = sin(time.mul(0.7).add(center.x.mul(0.3)))
        .mul(coord.y).mul(coord.y).mul(aSize.mul(0.14));

    // Anchor the quad so its BASE sits at aBase: shift the billboard centre up by half
    // the height, then billboard that around the camera. coord.y (0=base,1=top) drives
    // the sway shear (via the sway term) so the cluster stays rooted while tips drift.
    const centreMid = vec3(center.x, center.y.add(aSize.mul(0.5)), center.z);
    const worldPos = billboardWorld(centreMid, aSize).add(vec3(sway, 0.0, 0.0));

    const mask = kelpMask(coord);

    // Depth tint: deeper kelp sinks toward black; shallower keeps a little teal life. Use
    // the LOCAL cluster Y (the anchored group sits ~209u up the path, so positionWorld.y
    // saturated the old +40/70 band to 1.0 everywhere). Kelp roots near the local seabed
    // (~ -64), so bias the band low: -70..0 → [0,1].
    const depthT = clamp(center.y.add(70.0).div(70.0), 0.0, 1.0);
    let color = aTint.mul(mix(float(0.4), float(1.0), depthT));
    // Bioluminescent tip highlight LIFTED for the sunken-reef payoff (the cue that this
    // is a living glowing reef, clustered around the reef pockets). Pulses gently with a
    // per-cluster phase so the glowing kelp breathes. Capped so it glows, never clips.
    const tipPulse = sin(time.mul(1.0).add(center.x.mul(0.4))).mul(0.25).add(0.75);
    const tipGlow = smoothstep(0.5, 0.95, coord.y).mul(0.6).mul(tipPulse);
    color = color.add(vec3(0.10, 0.55, 0.46).mul(tipGlow));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = worldPos;
    material.colorNode = color;
    material.opacityNode = clamp(mask, 0.0, 1.0).mul(0.85).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide; // 1.3 — camera-facing billboard, back face never seen (free fill)
    material.blending = THREE.NormalBlending;
    material.fog = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    return material;
}

// ── Hydrothermal vent glow (1→2 carried element, entry only) ──────────────────────
//
// Creative plan asset 9 / Transition In: Chapter 1's First Heart does not pop out —
// it survives as a refracted, wobbling amber glow seen through water below the camera
// for the chapter's first few percent, then dies as the thermocline passes. This is
// the SAME light source Ch1's Transition Out drowns (#7a1500 oxblood with the amber
// memory of #ffb35c at the core), so the two chapters describe one continuous handoff.
export function createVentGlowTSL(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uDepth = options.uDepth ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uEmber = uniform(new THREE.Color(0x7a1500)); // drowned oxblood body
    const uAmber = uniform(new THREE.Color(0xffb35c)); // warm amber core memory

    const p = uv().sub(0.5);
    // Refraction wobble: ripple the radial distance with slow noise so the drowned
    // glow shimmers like light seen through moving water.
    const ripple = snoise3(vec3(p.x.mul(4.0), p.y.mul(4.0), time.mul(0.5))).mul(0.09);
    const d = clamp(length(p).mul(2.0).add(ripple), 0.0, 1.0);
    const glow = pow(oneMinus(d), 1.8);
    const core = pow(oneMinus(d), 4.0);

    const flicker = sin(time.mul(1.7)).mul(0.12).add(0.88);
    // Entry-only: full at the chapter foot, gone by ~13% of the climb.
    const entryFade = oneMinus(smoothstep(0.05, 0.13, uDepth));

    let color = uEmber.mul(glow).mul(0.8).add(uAmber.mul(core).mul(0.7));
    color = color.mul(flicker).mul(entryFade);
    color = min(color, vec3(0.8, 0.5, 0.3));

    const material = new THREE.SpriteNodeMaterial();
    material.colorNode = color;
    material.opacityNode = glow.mul(entryFade).mul(0.85).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = { uEmber, uAmber };

    const mesh = new THREE.Sprite(material);
    mesh.name = 'hydrothermal-vent-glow';
    mesh.frustumCulled = false;
    mesh.renderOrder = -65;
    return { mesh, material };
}

// ── Fractured skylight panes (2→3 surface-breach approach) ────────────────────────
//
// Creative plan Transition Out: from ~85% progress, bright refracted patches of the
// Chapter 3 sky — its mid azure #2F86D8 shot through with hints of the warm horizon
// gold #F0B878 — fade in just under the wave surface over ~8 seconds, REPLACING the
// popping white slabs of the old frame 20. Instanced billboard quads; geometry built
// in deep-ocean.js with aBase/aSize/aSeed.
export function createSkylightPaneMaterial(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uDepth = options.uDepth ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uAzure = uniform(new THREE.Color(0x2f86d8)); // Ch3 mid azure
    const uGold = uniform(new THREE.Color(0xf0b878)); // Ch3 warm horizon gold

    const center = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aSeed = attribute('aSeed', 'float');

    const p = uv().sub(0.5);
    // Fractured refraction patches: a sharp-ish noise mask so each pane reads as a
    // broken pane of sky seen through the wave surface, not a uniform disc.
    const patchNoise = snoise3(vec3(
        p.x.mul(5.0).add(aSeed.mul(13.0)),
        p.y.mul(5.0).add(aSeed.mul(7.0)),
        time.mul(0.25),
    ));
    const patch = smoothstep(0.05, 0.5, patchNoise);
    const goldMask = pow(
        snoise3(vec3(p.x.mul(2.4).add(aSeed.mul(31.0)), p.y.mul(2.4), time.mul(0.15)))
            .mul(0.5).add(0.5),
        2.0,
    );
    const feather = oneMinus(smoothstep(0.3, 0.5, length(p)));

    // The ~8-second buildup: panes only exist across the last ~12% of the climb.
    const reveal = smoothstep(0.85, 0.97, uDepth);

    let color = mix(uAzure, uGold, goldMask.mul(0.5)).mul(patch.mul(0.8).add(0.2));
    color = color.mul(reveal);
    color = min(color, vec3(0.85, 0.88, 0.92));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(center, aSize);
    material.colorNode = color;
    material.opacityNode = patch.mul(feather).mul(reveal).mul(0.75).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide; // 1.3 — camera-facing billboard, back face never seen (free fill)
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = { uAzure, uGold };
    return material;
}

// ── The Pearl Gate — nacreous rail threshold (creative plan asset 4) ──────────────
//
// The ring the camera passes through at ~0.68 progress becomes grown nacre instead of
// an unlit torus: a deep blue-green base with an iridescent thin-film fresnel sweep
// (cyan → magenta → pearl-white at grazing angles), a soft interior caustic shimmer,
// and a top-light response keyed to the god-rays above. Grazing pearl highlights are
// authored to just cross the bloom threshold so the gate reads as lit nacre.
export function createPearlGateTSL(uTime, options = {}) {
    const time = uTime ?? uniform(0);
    const uOpacity = options.uOpacity ?? uniform(1);
    const uBase = uniform(new THREE.Color(0x0d3a44)); // deep blue-green nacre body

    const fres = pow(oneMinus(abs(dot(normalize(normalView), positionViewDirection))), 1.6);

    // Thin-film sweep: hue cycles across the fresnel band (cyan → magenta → pearl).
    const irid = cos(fres.mul(6.0).add(time.mul(0.3)).add(vec3(0.0, 2.09, 4.19)))
        .mul(0.5).add(0.5);

    // Interior caustic shimmer so the nacre looks grown, responding to the water light.
    const shimmer = snoise3(positionLocal.mul(0.9).add(vec3(0.0, time.mul(0.4), 0.0)))
        .mul(0.5).add(0.5);

    // God-ray key response: the gate is lit from above by the descending shafts.
    const topLight = clamp(normalWorld.y, 0.0, 1.0);

    let color = uBase.add(irid.mul(vec3(0.32, 0.45, 0.5)).mul(fres.mul(0.8).add(0.2)));
    color = color.add(vec3(0.25, 0.5, 0.55).mul(pow(shimmer, 3.0)).mul(0.4));
    color = color.add(vec3(0.35, 0.75, 0.85).mul(topLight).mul(0.35));
    // Pearl-white grazing highlight — the only part that crosses the bloom threshold.
    color = color.add(vec3(0.6, 0.68, 0.7).mul(pow(fres, 3.0)));
    color = min(color, vec3(0.92, 0.96, 0.97));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.transparent = true; // authored at build (QW5) so the ecotone fade can act
    material.depthWrite = true;
    material.side = THREE.FrontSide;
    material.userData.emitsBloom = true;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.userData.uniforms = { uBase };

    const geometry = new THREE.TorusGeometry(7.5, 0.55, 24, 64);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'pearl-gate';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

/**
 * Assemble the three pilot materials into one group + a single uTime uniform the
 * caller ticks each frame. Used by the standalone WebGPU pilot validation page.
 */
export function createDeepOceanPilotTSL({ surfaceOffsetY = 20 } = {}) {
    const uTime = uniform(0);
    const group = new THREE.Group();
    group.name = 'deep-ocean-pilot-tsl';

    const gradient = createOceanGradientTSL();
    const water = createWaterSurfaceTSL(uTime, surfaceOffsetY);
    const rays = createGodRaysTSL(uTime);
    const seabed = createSeabedTSL(uTime);
    seabed.mesh.position.y = -55;

    group.add(gradient.mesh, water.mesh, rays.group, seabed.mesh);

    return {
        group,
        uniforms: { uTime },
        dispose() {
            [gradient, water, rays, seabed].forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createDeepOceanPilotTSL;

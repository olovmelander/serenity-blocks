/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Black Hole Transcendence (Chapter 7) — TSL/WebGPU materials.
 *
 * MASTERPIECE PASS (2026-10): the chapter's hero is one Gargantua-style black hole (see
 * black-hole-transcendence.js). The builders here paint it:
 *   - createVoidDomeTSL           near-black deep space, faint magenta/indigo nebulosity
 *   - createAccretionDiskTSL      the thin white-hot band: BOUNDED rigid rotation + a fixed
 *                                 spiral shear (no unbounded winding), view-dependent Doppler
 *   - createGargantuaPhotonRingTSL the razor ring at the shadow's edge
 *   - createLensedFoldMaterialTSL the lensed far side of the disk, over/under the shadow
 *   - createLensingStarfieldTSL   a far star shell for the ch7 post lens to bend
 *   - corridor dust / infall embers / shards — the near-life particle layers
 *
 * Every fading material keeps an ecotone bridge (`material.uniforms = { uOpacity }`): r181+
 * makes `material.opacity` a dead write wherever an opacityNode is authored, so the bridge IS
 * the chapter crossfade (tests/unit/odyssey-wave46-scope-invariants.test.js counts them).
 * The shared noise is the value-noise lib (never MaterialX noise) — since the seamless pass
 * (2026-10) read from the baked lattice (shared/odyssey-lattice-noise.js: one texture fetch per
 * octave, not eight hashes; the full-frame dome and Gargantua's disk are the big consumers) —
 * and every billboard is `billboardLocal` — the chapter group is anchored ~1.4 km from the origin.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    log,
    max,
    mix,
    mod,
    modelScale,
    modelViewPosition,
    modelWorldMatrix,
    normalize,
    oneMinus,
    positionLocal,
    positionView,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture as sampleTexture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { fbm3, hash21, ridged3 } from './shared/odyssey-tsl-noise.js';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';
import { billboardLocal, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

const TAU = Math.PI * 2;

/**
 * Where Gargantua hangs relative to the eye (world units), shared by ch7's camera lock and
 * ch6's omen handoff so the two land on the same spot at the 6->7 seam.
 */
export const GARGANTUA_LOCK = Object.freeze({
    lockDepth: 900,
    // Screen-anchor bias: the hero rides the upper-centre third, a hair right (the rail owns
    // the lower centre and climbs into it).
    upBias: 150,
    rightBias: 26,
    shadowRadius: 132,
});

const _lockFwd = new THREE.Vector3();
const _lockUp = new THREE.Vector3();
const _lockRight = new THREE.Vector3();

/**
 * World position of the lock: `lockDepth` ahead of the eye on the CAMERA'S basis (its own
 * up vector — the ch7 spline climbs near-vertically, where a world-up basis degenerates).
 * @returns {THREE.Vector3} `out`
 */
export function resolveGargantuaLockPosition(camera, out) {
    camera.getWorldDirection(_lockFwd).normalize();
    _lockUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _lockRight.crossVectors(_lockFwd, _lockUp);
    if (_lockRight.lengthSq() < 1e-8) _lockRight.set(1, 0, 0);
    _lockRight.normalize();
    _lockUp.crossVectors(_lockRight, _lockFwd).normalize();
    return out.copy(camera.position)
        .addScaledVector(_lockFwd, GARGANTUA_LOCK.lockDepth)
        .addScaledVector(_lockUp, GARGANTUA_LOCK.upBias)
        .addScaledVector(_lockRight, GARGANTUA_LOCK.rightBias);
}

/**
 * THE FALL (2026-10-02): the lock's position for a hero `depth` ahead of the eye, its screen bias
 * scaled with the depth (so the hole keeps its place on screen as it recedes to keep its near
 * surface clear of the rail) and eased onto the view axis by `centring`. At depth = lockDepth and
 * centring = 0 this is exactly resolveGargantuaLockPosition (the ch6 omen handoff lands on it).
 * @returns {THREE.Vector3} `out`
 */
export function resolveGargantuaFallPosition(camera, out, depth = GARGANTUA_LOCK.lockDepth, centring = 0) {
    camera.getWorldDirection(_lockFwd).normalize();
    _lockUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _lockRight.crossVectors(_lockFwd, _lockUp);
    if (_lockRight.lengthSq() < 1e-8) _lockRight.set(1, 0, 0);
    _lockRight.normalize();
    _lockUp.crossVectors(_lockRight, _lockFwd).normalize();
    const bias = (depth / GARGANTUA_LOCK.lockDepth) * (1 - centring);
    return out.copy(camera.position)
        .addScaledVector(_lockFwd, depth)
        .addScaledVector(_lockUp, GARGANTUA_LOCK.upBias * bias)
        .addScaledVector(_lockRight, GARGANTUA_LOCK.rightBias * bias);
}

// ── The singularity window — the shadow's surface opens onto the warp tunnel (the fall) ──
//
// The colours of every world the journey has crossed, streaming down the tunnel inside the
// singularity: ember, deep ocean, island green, snow, aurora, nebula violet, accretion amber,
// the city's neon. Authored in sRGB; the texture is tagged so the sampler returns linear.
const CH7_JOURNEY_PALETTE = Object.freeze([
    [255, 112, 40], [24, 132, 220], [92, 196, 84], [214, 228, 255],
    [72, 255, 156], [150, 84, 255], [255, 168, 64], [255, 70, 186],
]);
let _journeyPalette = null;
function getJourneyPaletteTexture() {
    if (_journeyPalette) return _journeyPalette;
    const data = new Uint8Array(CH7_JOURNEY_PALETTE.length * 4);
    CH7_JOURNEY_PALETTE.forEach(([r, g, b], i) => {
        data.set([r, g, b, 255], i * 4);
    });
    const tex = new THREE.DataTexture(data, CH7_JOURNEY_PALETTE.length, 1, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    _journeyPalette = tex;
    return tex;
}

/**
 * The shadow's own material during the fall: pure black while `uPortal` is 0 (the plain shadow),
 * and — as the hole swallows the frame — a window onto the interior. Opaque and depth-writing
 * like the black shadow it replaces (same pipeline state; fade-exempt), so the rail and nodes in
 * front of it still draw over it.
 *
 * The tunnel is computed from the VIEW RAY in the shadow's local frame (the face pivot turns +Z to
 * the eye; XY is the screen plane), not from geometry: a ray at angle theta from the axis meets a
 * unit-radius tunnel at depth cot(theta), so streak lanes in azimuth scrolled along that depth
 * converge on the vanishing point like hyperspace, and the same function keeps reading correctly
 * however large the sphere grows. `uEyeZ` is the eye's distance from the centre in the sphere's
 * LOCAL units (world distance / hero scale).
 * @returns {{ material: THREE.MeshBasicNodeMaterial, uniforms: object }}
 */
export function createSingularityWindowTSL(uTime = uniform(0), options = {}) {
    const uPortal = options.uPortal ?? uniform(0);
    const uWarp = options.uWarp ?? uniform(0);
    const uEyeZ = options.uEyeZ ?? uniform(GARGANTUA_LOCK.lockDepth);
    // The tunnel's MOUTH at the 7->8 exit: angular radius (rad) of the opening round the vanishing
    // point, through which the city and its sun are seen (alpha-tested away; 0 = no opening).
    const uOpen = options.uOpen ?? uniform(0);
    const palette = getJourneyPaletteTexture();

    const ray = normalize(positionLocal.sub(vec3(0.0, 0.0, uEyeZ)));
    const cosT = ray.z.negate().max(1e-4);
    const sinT = length(vec2(ray.x, ray.y)).max(1e-4);
    // Depth down the tunnel (cot theta), capped where the lanes would alias at the vanishing point.
    const depth = cosT.div(sinT).min(80.0);
    const warp = clamp(uWarp, 0.0, 1.0);
    const logDepth = log(depth.add(0.25));
    // A shallow helical wall, rather than tightly wound spokes near the vanishing point.
    // Every travelling feature uses +time: increasing tunnel depth projects nearer the axis,
    // so a fixed feature of depth + time moves OUT toward the traveller as time advances.
    const twist = logDepth.mul(warp.mul(0.22).add(0.08)).add(uTime.mul(0.035));
    const ang = atan(ray.y, ray.x).add(twist);

    // Two sparse banks of long, feathered streaks at different depths. Pixel-footprint widths
    // keep the fine angular detail stable on phone-sized targets and close to the axis.
    const LANES = 72;
    const lanePos = ang.div(TAU).add(0.5).mul(LANES);
    const lane = mod(floor(lanePos), LANES);
    const laneF = fract(lanePos);
    const r1 = hash21(vec2(lane, 7.13));
    const r2 = hash21(vec2(lane, 1.91));
    // Rates never multiply elapsed time by a changing progress value. The faster bank and
    // brighter, longer features emerge with warp instead, so a late-session plunge cannot
    // amplify minutes of elapsed time into a sudden phase jump.
    const speed = mix(0.55, 1.25, r1);
    const seg = fract(logDepth.mul(mix(0.65, 1.2, r2)).add(uTime.mul(speed)).add(r1.mul(17.0)));
    const head = smoothstep(0.0, 0.30, seg).mul(oneMinus(smoothstep(0.30, 0.36, seg)));
    const laneAA = clamp(fwidth(lanePos), 0.018, 0.24);
    const core = oneMinus(smoothstep(0.025, laneAA.add(0.06), abs(laneF.sub(0.5))));
    const lit = smoothstep(0.62, 0.88, r2.add(warp.mul(0.20)));
    const streaks = head.mul(core).mul(lit);

    const finePos = ang.add(0.23).sub(logDepth.mul(0.10)).div(TAU).mul(116);
    const fineLane = mod(floor(finePos), 116);
    const fineSeed = hash21(vec2(fineLane, 23.71));
    const finePhase = fract(logDepth.mul(1.8).add(uTime.mul(1.6)).add(fineSeed.mul(13.0)));
    const fineHead = smoothstep(0.0, 0.40, finePhase)
        .mul(oneMinus(smoothstep(0.40, 0.45, finePhase)));
    const fineCore = oneMinus(smoothstep(
        0.015,
        clamp(fwidth(finePos), 0.015, 0.20).add(0.035),
        abs(fract(finePos).sub(0.5)),
    ));
    const fineStreaks = fineHead.mul(fineCore).mul(smoothstep(0.75, 0.94, fineSeed)).mul(warp);

    // LOG DEPTH: cot(theta) crowds everything interesting into the centre of the frame; its log
    // spreads features evenly across screen radius, so bands and filaments read edge to centre.
    // WALL FILAMENTS: accretion matter spiralling past, two baked-lattice octaves, stretched along
    // the tunnel (low frequency in depth, high in angle) and streaming toward the eye.
    const wallDepth = logDepth.mul(1.1).add(uTime.mul(0.75));
    const wall = vec3(cos(ang).mul(3.4), sin(ang).mul(3.4), wallDepth);
    const filamentField = latticeNoise3(wall).mul(0.65).add(latticeNoise3(wall.mul(2.3)).mul(0.35));
    const filaments = smoothstep(0.5, 0.8, filamentField);

    // The journey's colours, in rings down the tunnel that zoom outward past the eye.
    const band = fract(logDepth.mul(0.32).add(uTime.mul(0.08)));
    const tint = sampleTexture(palette, vec2(band, 0.5)).rgb;
    // Travelling rings make depth legible between the longitudinal streaks. They share the
    // wall's outward direction and stay restrained enough to avoid a flashing strobe.
    const ringPhase = logDepth.mul(2.2).add(uTime.mul(1.0));
    const ringAA = clamp(fwidth(ringPhase), 0.012, 0.12);
    const rings = oneMinus(smoothstep(0.035, ringAA.add(0.12), abs(fract(ringPhase).sub(0.5))))
        .mul(filaments.mul(0.65).add(0.35));
    const ridges = pow(clamp(cos(ang.mul(12.0).sub(logDepth.mul(1.4))).mul(0.5).add(0.5), 0.0, 1.0), 8.0)
        .mul(filaments);
    const axisFade = smoothstep(0.008, 0.055, sinT);
    // Far down the tunnel is dimmer — except the exit light dead ahead (the light at the end,
    // which becomes the city's sun at the 7->8 seam).
    const far = exp(depth.mul(-0.035));
    const exitLight = exp(sinT.mul(sinT).mul(-260.0));
    // The mouth: everything inside the opening is cut away (the scene behind shows through) and a
    // blazing rim rides its edge. Gated so no opening exists until the exit begins.
    const theta = atan(sinT, cosT);
    const opening = smoothstep(0.0, 0.002, uOpen);
    const inMouth = oneMinus(smoothstep(uOpen.mul(0.96), uOpen.add(0.002), theta)).mul(opening);
    const rimOffset = theta.sub(uOpen).div(0.03);
    // The rim blazes while the mouth is small (the light at the end of the tunnel) and fades as it
    // widens: at full width a fixed-intensity rim is a huge bright circle round the whole view
    // (a +20 luma spike in the 7->8 seam gate).
    const rimFade = oneMinus(smoothstep(0.25, 1.1, uOpen));
    const rim = exp(rimOffset.mul(rimOffset).negate()).mul(opening).mul(rimFade);
    const color = tint.mul(filaments.mul(0.15).add(ridges.mul(0.16)).add(0.009))
        .mul(far.mul(0.8).add(0.2)).mul(axisFade)
        .add(mix(tint, vec3(1.0, 0.94, 0.84), head.mul(0.45)).mul(streaks)
            .mul(warp.mul(1.8).add(0.35)).mul(axisFade))
        .add(mix(tint, vec3(0.74, 0.91, 1.0), 0.72).mul(fineStreaks).mul(1.15).mul(axisFade))
        .add(tint.mul(rings).mul(warp.mul(0.19).add(0.035)).mul(axisFade))
        .add(vec3(1.0, 0.86, 0.62).mul(exitLight).mul(warp.mul(1.2).add(0.12)).mul(oneMinus(opening)))
        .add(vec3(1.0, 0.82, 0.55).mul(rim).mul(1.8));

    // As the mouth widens the tunnel walls dim with it, so the frame's brightness eases down into
    // the (darker) city instead of dropping on the frame the mouth passes the edges.
    const leaving = oneMinus(clamp(uOpen.div(1.4), 0.0, 1.0).mul(0.45));
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(clamp(uPortal, 0.0, 1.0)).mul(leaving);
    // Opaque with an alpha test (fixed at creation, so no pipeline change at runtime): the mouth
    // is discarded, the rest writes depth like the plain shadow.
    material.opacityNode = oneMinus(inMouth);
    material.alphaTest = 0.5;
    material.userData.emitsBloom = true;
    return {
        material,
        uniforms: {
            uPortal, uWarp, uEyeZ, uOpen,
        },
    };
}

// ── Void dome — deep space (-100 backstop; must NOT bloom) ──────────────────────────

/** Radius of the ch7 dome — centred on the chapter, so the camera is always inside it. */
export const CH7_VOID_DOME_RADIUS = 3000;

/**
 * Near-black deep space with a faint magenta/indigo nebulosity and a few gold veins. It
 * used to be a 520 u sphere hung 740 u AHEAD of the chapter centre with a raised violet
 * floor — the camera sat outside it and saw a purple disc of noise (the "noise walls").
 * Five noise octaves instead of twelve: it covers the whole frame.
 * @param {object} uTime shared time uniform
 * @param {object} [uEnergy] shared energy uniform
 */
export function createVoidDomeTSL(uTime = uniform(0), uEnergy = uniform(0.4), options = {}) {
    const uOpacity = uniform(1);
    const radius = options.radius ?? CH7_VOID_DOME_RADIUS;

    const dir = normalize(positionLocal);
    const h = dir.y.mul(0.5).add(0.5);
    // Never RGB-zero (a Ghibli frame is never dead black), but a void, not a violet room.
    const base = mix(vec3(0.004, 0.003, 0.010), vec3(0.010, 0.006, 0.022), h);

    const q = dir.mul(2.1).add(vec3(0.0, 0.0, uTime.mul(0.004)));
    const cloud = fbm3(q, 3, latticeNoise3);
    const veins = ridged3(q.mul(1.7).add(7.0), 2, latticeNoise3);
    const body = smoothstep(0.50, 0.78, cloud);
    // Amplitudes are set against the display-space grade (2026-10-01): linear 0.07 already
    // reads as a strong violet there, so the nebulosity stays a whisper.
    let nebula = vec3(0.012, 0.003, 0.015).mul(body); // deep magenta-violet
    nebula = nebula.add(vec3(0.002, 0.003, 0.008).mul(smoothstep(0.45, 0.70, cloud))); // indigo haze
    nebula = nebula.add(vec3(0.030, 0.016, 0.006).mul(smoothstep(0.64, 0.88, veins)).mul(body)); // gold veins
    const color = base.add(nebula.mul(uEnergy.mul(0.25).add(0.85)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge (manager reads material.uniforms)
    material.side = THREE.BackSide;
    material.transparent = true;
    material.depthWrite = false;

    const geometry = new THREE.SphereGeometry(radius, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ch7-void-dome';
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ── Accretion disk — the thin white-hot band (additive, bloom-eligible) ─────────────

/**
 * Gargantua's disk on a RingGeometry (in its local XY plane).
 *
 * MOTION IS BOUNDED. The old swirl added `uTime * speed(r)` to the angle: the inner orbit
 * outran the outer by ~1.3 rad/s, so within minutes neighbouring radii were hundreds of
 * turns apart and the noise aliased into radial static. Now each of two layers is a RIGID
 * rotation wrapped to [0, 2π) (seamless — the noise is sampled on the circle), the spiral is
 * a FIXED log shear, the inner layer simply turns faster than the outer and is cross-faded
 * by radius, and time otherwise only advances the noise's z (evolution, not winding).
 *
 * DOPPLER FROM THE VIEW. Brightness/hue are beamed by `dot(orbital tangent, toward-eye)` in
 * world space (the idea from the black-hole theme's disk, re-written here — theme code is
 * never imported into Odyssey's boot closure): the approaching limb blazes white, the
 * receding limb sinks to a deep amber, whichever way the camera looks.
 */
export function createAccretionDiskTSL(uTime = uniform(0), uEnergy = uniform(0.4), options = {}) {
    const innerRadius = options.innerRadius ?? 177;
    const outerRadius = options.outerRadius ?? 634;
    const uInner = uniform(innerRadius);
    const uOuter = uniform(outerRadius);
    const uHot = uniform(new THREE.Color(0xfff4e6)); // white-hot inner edge
    const uMid = uniform(new THREE.Color(0xffa548)); // gold
    const uCool = uniform(new THREE.Color(0xa83c16)); // deep amber outskirts
    const uAccent = uniform(new THREE.Color(0xc8448c)); // magenta — a breath at the outer rim

    const local = positionLocal.xy;
    const r = length(local);
    const t = clamp(r.sub(uInner).div(uOuter.sub(uInner)), 0.0, 1.0);
    const ang = atan(local.y, local.x);

    const shear = log(max(r.div(uInner), 1.0)).mul(2.6);
    const ringA = ang.sub(mod(uTime.mul(0.40), TAU)).add(shear);
    const ringB = ang.sub(mod(uTime.mul(0.15), TAU)).add(shear);
    const evolve = uTime.mul(0.05);
    const rad = t.mul(2.4).add(0.8);
    const nA = fbm3(vec3(cos(ringA).mul(rad), sin(ringA).mul(rad), evolve).mul(1.7), 3, latticeNoise3);
    const nB = fbm3(vec3(cos(ringB).mul(rad), sin(ringB).mul(rad), evolve.add(7.0)).mul(1.7), 3, latticeNoise3);
    const turb = mix(nA, nB, smoothstep(0.15, 0.65, t));
    // Fine concentric striations, wobbled by the turbulence — the dense lane structure of a
    // thin disk seen nearly edge-on.
    const striae = sin(t.mul(70.0).add(turb.mul(8.0))).mul(0.5).add(0.5);
    const plasma = turb.mul(0.85).add(0.30).mul(mix(float(0.55), float(1.0), striae.mul(striae)));

    // Temperature ladder: white-hot at the inner edge → gold → deep amber; magenta only as a
    // breath at the far rim.
    const temp = pow(oneMinus(t), 1.7);
    let color = mix(uCool, uMid, smoothstep(0.0, 0.5, temp));
    color = mix(color, uHot, smoothstep(0.5, 0.92, temp));
    color = mix(color, uAccent, smoothstep(0.70, 1.0, t).mul(0.35));

    const centre = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    const axis = normalize(modelWorldMatrix.mul(vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    const tangent = normalize(cross(axis, positionWorld.sub(centre)));
    const toEye = normalize(cameraPosition.sub(positionWorld));
    const doppler = dot(tangent, toEye); // +1 approaching, -1 receding
    const beam = pow(clamp(doppler.mul(0.5).add(1.0), 0.4, 1.5), 2.0);
    color = mix(color, vec3(0.88, 0.93, 1.0), smoothstep(0.2, 0.9, doppler).mul(temp).mul(0.35));
    color = mix(color, color.mul(vec3(1.0, 0.55, 0.32)), smoothstep(0.2, 0.9, doppler.negate()).mul(0.55));

    const innerFeather = smoothstep(0.0, 0.035, t);
    const outerFeather = oneMinus(smoothstep(0.5, 1.0, t));
    const glow = temp.mul(1.55).add(0.10);
    const intensity = glow.mul(plasma).mul(beam).mul(uEnergy.mul(0.25).add(0.9));

    // Optional within-chapter fade (default 1) + the cross-chapter ecotone bridge.
    const uFade = options.uFade ?? uniform(1);
    const uOpacity = options.uOpacity ?? uniform(1);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(intensity);
    material.opacityNode = innerFeather.mul(outerFeather).mul(uFade).mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // Additive + no depth write ⇒ the DoubleSide split pass buys nothing (odyssey-planet-aurora).
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 256, 12);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'accretion-disk-tsl';
    return {
        mesh,
        material,
        geometry,
        uniforms: {
            uInner, uOuter, uFade, uOpacity,
        },
    };
}

// Shared view-space read for the camera-facing rim pieces: where this fragment sits around
// the shadow (radius in shadow radii, and which side — the disk's approaching limb is the
// LEFT one for its counter-clockwise orbit seen from just above the plane).
function rimFrame(shadowRadius) {
    const offset = positionView.xy.sub(modelViewPosition.xy);
    const dist = length(offset).max(1e-3);
    return {
        // shadowRadius is authored in the face's LOCAL units; the offset is measured in view
        // space, so divide by the WORLD-scaled radius. ch7's hero has scale 1 (unchanged), but
        // ch6's omen is the same parts scaled 1.2-5.5x, and at local units its fold arcs sat
        // permanently outside their profile and never drew (pre-merge review).
        rr: dist.div(modelScale.x.mul(shadowRadius)),
        side: offset.x.negate().div(dist), // +1 left (approaching), -1 right
        above: offset.y.div(dist), // +1 top, -1 bottom
        angle: atan(offset.y, offset.x),
    };
}

// ── Photon ring — the razor of light at the shadow's edge (additive, bloom) ─────────

export function createGargantuaPhotonRingTSL(uTime = uniform(0), options = {}) {
    const shadowRadius = options.shadowRadius ?? 132;
    const inner = options.innerRadius ?? shadowRadius;
    const outer = options.outerRadius ?? shadowRadius * 1.075;
    const uOpacity = uniform(1);

    const { side, angle } = rimFrame(shadowRadius);
    // Radial position across the ring, from its local geometry: RingGeometry's UV is PLANAR
    // (a square projection), so uv().y ran 0 -> 1 bottom-to-top of the whole ring, not inner-to-
    // outer, and the razor vanished at the top and bottom of the shadow (pre-merge review).
    const across = clamp(length(positionLocal.xy).sub(inner).div(Math.max(outer - inner, 1e-3)), 0.0, 1.0);
    // A razor: bright against the shadow, a soft fall outward.
    const profile = smoothstep(0.0, 0.18, across).mul(oneMinus(smoothstep(0.30, 1.0, across)));
    const beam = pow(clamp(side.mul(0.45).add(1.0), 0.45, 1.5), 2.0);
    const flicker = sin(angle.mul(9.0).add(uTime.mul(0.9))).mul(0.06).add(0.94);
    let color = mix(vec3(1.0, 0.74, 0.46), vec3(1.0, 0.96, 0.9), smoothstep(0.6, 1.4, beam));
    let gain = float(1.6);
    // THE 7->8 SWELL (seamless pass; only chapter 7's hero passes `uSwell`): as the shadow
    // closes the razor brightens and warms toward the Retrosun's crown, so it reads as the new
    // sun's blazing limb. Builders without it compile the unchanged graph.
    if (options.uSwell) {
        color = mix(color, vec3(1.0, 0.72, 0.30), options.uSwell.mul(0.55));
        gain = gain.mul(options.uSwell.mul(1.1).add(1.0));
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(profile.mul(beam).mul(flicker).mul(gain));
    material.opacityNode = profile.mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.RingGeometry(inner, outer, 256, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'gargantua-photon-ring-tsl';
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ── Lensed fold arcs — the far side of the disk, bent over/under the shadow (bloom) ─

/**
 * Material for the two camera-facing fold tori — the image of the disk's FAR side, bent over
 * (and, dimmer, under) the shadow. The torus is only coverage: the light is a RADIAL profile
 * around the shadow, brightest hard against its edge and thinning outward like the disk seen
 * from above, carrying the disk's own striations and temperature, Doppler-beamed by side.
 */
export function createLensedFoldMaterialTSL(uTime = uniform(0), options = {}) {
    const shadowRadius = options.shadowRadius ?? 132;
    const opacity = options.opacity ?? 0.85;
    const uOpacity = uniform(1);

    const {
        rr, side, above, angle,
    } = rimFrame(shadowRadius);
    const rise = smoothstep(1.0, 1.05, rr);
    const fall = pow(oneMinus(smoothstep(1.04, 1.42, rr)), 1.6);
    const profile = rise.mul(fall);
    const beam = pow(clamp(side.mul(0.5).add(1.0), 0.4, 1.5), 2.0);
    const underside = mix(float(0.3), float(1.0), smoothstep(-0.25, 0.25, above));
    const turb = fbm3(vec3(angle.mul(2.5), rr.mul(4.0), uTime.mul(0.05)), 2, latticeNoise3);
    const striae = sin(rr.mul(70.0).add(turb.mul(8.0))).mul(0.5).add(0.5);
    const texture = mix(float(0.6), float(1.0), striae.mul(striae)).mul(turb.mul(0.6).add(0.7));
    const hot = oneMinus(smoothstep(1.03, 1.25, rr));
    const color = mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.94, 0.84), hot);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(profile.mul(beam).mul(underside).mul(texture).mul(1.3));
    material.opacityNode = profile.mul(opacity).mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.FrontSide;
    material.userData.emitsBloom = true;
    return material;
}

// ── Drifting corridor dust (instanced billboards, additive feathered) ────────────────

export const CH7_CORRIDOR_DUST_SETTINGS = Object.freeze({
    minCount: 160,
    maxCount: 820,
    spreadX: 380,
    spreadY: 360,
    depthNear: -55,
    depthSpan: 560,
    minSize: 5.5,
    sizeSpan: 11,
    // Masterpiece pass: the dust is parallax LIFE between the eye and the hero, not a
    // coloured haze — dimmer and smaller than the violet bokeh it was.
    colorGain: 0.7,
    glowPower: 2.2,
    breatheBase: 0.20,
    breatheSwing: 0.08,
    opacityCap: 0.4,
});

/**
 * Near/mid drifting dust motes that hug the corridor the camera traverses. Instanced
 * billboard quads with a radial alpha feather to 0 before the quad edge; the .js update()
 * re-centres the field on the camera so it is always inside it.
 * @param {object} uTime shared time uniform
 */
export function createCorridorDustTSL(uTime = uniform(0), requestedCount = 460, options = {}) {
    const uWarp = options.uWarp ?? uniform(0);
    const count = Math.max(
        CH7_CORRIDOR_DUST_SETTINGS.minCount,
        Math.min(Math.floor(requestedCount), CH7_CORRIDOR_DUST_SETTINGS.maxCount),
    );
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    // Warm starlight dust with a few magenta and cold-blue motes (accents, not a palette).
    const palette = [
        new THREE.Color(0xffe2b8),
        new THREE.Color(0xffc878),
        new THREE.Color(0xfff2e0),
        new THREE.Color(0xd890ff),
        new THREE.Color(0xffb070),
        new THREE.Color(0x9ac8ff),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        positions[stride] = (Math.random() - 0.5) * CH7_CORRIDOR_DUST_SETTINGS.spreadX;
        positions[stride + 1] = (Math.random() - 0.5) * CH7_CORRIDOR_DUST_SETTINGS.spreadY;
        positions[stride + 2] = CH7_CORRIDOR_DUST_SETTINGS.depthNear
            - Math.random() * CH7_CORRIDOR_DUST_SETTINGS.depthSpan;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;
        sizes[index] = CH7_CORRIDOR_DUST_SETTINGS.minSize
            + Math.random() * CH7_CORRIDOR_DUST_SETTINGS.sizeSpan;
        phases[index] = Math.random() * Math.PI * 2;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');

    const warp = clamp(uWarp, 0.0, 1.0);
    // Negative local Z is forward once the environment aligns this mesh to the camera.
    // At rest this is the original dust. During the plunge each mote runs from deep ahead
    // toward the eye, then wraps invisibly; perspective expands its path out of the axis.
    const travel = fract(aBase.z.negate().sub(-CH7_CORRIDOR_DUST_SETTINGS.depthNear)
        .div(CH7_CORRIDOR_DUST_SETTINGS.depthSpan)
        .add(uTime.mul(0.85))
        .add(aPhase.mul(0.11)));
    const movingZ = float(CH7_CORRIDOR_DUST_SETTINGS.depthNear)
        .sub(oneMinus(travel).mul(CH7_CORRIDOR_DUST_SETTINGS.depthSpan));
    const center = vec3(
        aBase.x.add(sin(uTime.mul(0.05).add(aPhase)).mul(7.0)),
        aBase.y.add(cos(uTime.mul(0.04).add(aPhase.mul(1.3))).mul(5.0)),
        mix(aBase.z, movingZ, warp),
    );
    const radial = center.xy.div(length(center.xy).max(1e-4));
    const tangent = vec2(radial.y.negate(), radial.x);
    const streakCorner = tangent.mul(positionLocal.x.mul(aSize).mul(0.16))
        .add(radial.mul(positionLocal.y.mul(aSize).mul(8.0)));
    const streakPosition = center.add(vec3(streakCorner, 0.0));
    // Small, quiet dust leaves the approaching horizon readable. The same budget becomes
    // long bright velocity streaks at the crossing instead of filling the shadow with bokeh.
    const positionNode = mix(billboardLocal(center, aSize.mul(0.48)), streakPosition, warp);

    const d = length(uv().sub(0.5));
    const glow = pow(
        clamp(oneMinus(d.mul(2.0)), 0.0, 1.0),
        CH7_CORRIDOR_DUST_SETTINGS.glowPower,
    );
    const breathe = sin(uTime.mul(0.3).add(aPhase))
        .mul(CH7_CORRIDOR_DUST_SETTINGS.breatheSwing)
        .add(CH7_CORRIDOR_DUST_SETTINGS.breatheBase);
    const travelFade = smoothstep(0.0, 0.09, travel).mul(oneMinus(smoothstep(0.84, 1.0, travel)));

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor.mul(CH7_CORRIDOR_DUST_SETTINGS.colorGain).mul(warp.mul(0.6).add(1.0));
    material.opacityNode = clamp(
        glow.mul(breathe),
        0.0,
        CH7_CORRIDOR_DUST_SETTINGS.opacityCap,
    // The wrap is hidden throughout the plunge too: interpolating this feather with a
    // nonzero resting alpha exposed a partial-depth jump whenever 0 < warp < 1.
    ).mul(uOpacity).mul(travelFade).mul(warp.mul(0.55).add(0.45));
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'corridor-violet-dust-tsl';
    mesh.frustumCulled = false;
    mesh.userData.readability = CH7_CORRIDOR_DUST_SETTINGS;
    return {
        mesh, material, geometry, uniforms: { uOpacity, uWarp },
    };
}

// ── Infall embers — matter orbiting IN the disk plane (instanced, capped) ────────────

/**
 * A dense ember field the .js parents onto Gargantua's disk pivot (orbit plane = local XZ,
 * laid onto the disk by a +90° X rotation, scaled onto the disk's radii). Motion is GPU-side
 * (uTime + per-instance phase): a tangential orbit and a bounded radial breath.
 * @param {object} uTime shared time uniform
 * @param {number} [count] instance count (capped)
 */
export function createInfallEmberFieldTSL(uTime = uniform(0), count = 520) {
    const safeCount = Math.max(48, Math.min(Math.floor(count), 620));
    const bases = new Float32Array(safeCount * 3); // x=baseRadius, y=baseAngle, z=height
    const colors = new Float32Array(safeCount * 3);
    const sizes = new Float32Array(safeCount);
    const phases = new Float32Array(safeCount);
    const seeds = new Float32Array(safeCount);

    // The disk's own temperature ladder (white-gold → amber) with a rare magenta spark.
    const palette = [
        new THREE.Color(0xfff0d8),
        new THREE.Color(0xffd08a),
        new THREE.Color(0xffb05a),
        new THREE.Color(0xff8a3a),
        new THREE.Color(0xffe6c0),
        new THREE.Color(0xff9a4c),
        new THREE.Color(0xffc070),
        new THREE.Color(0xe060b0),
    ];

    // Three shells: inner (just outside the shadow), mid, outer — the field thins outward.
    const SHELL_RADIUS = [86, 150, 230];
    const SHELL_SIZE = [3.2, 2.6, 2.0];
    const SHELL_SPEED = [1.0, 0.7, 0.45];

    for (let index = 0; index < safeCount; index += 1) {
        const stride = index * 3;
        const shell = index % 3;
        const radius = SHELL_RADIUS[shell] + (Math.random() - 0.5) * (30 + shell * 30);
        const angle = Math.random() * Math.PI * 2;
        // A thin sheet: embers hug the disk plane, thickening a little outward.
        const height = (Math.random() - 0.5) * (4 + shell * 5);

        bases[stride] = radius;
        bases[stride + 1] = angle;
        bases[stride + 2] = height;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        sizes[index] = SHELL_SIZE[shell] + Math.random() * 2.0;
        phases[index] = Math.random() * Math.PI * 2;
        // Orbital speed — ONE direction (the disk's), inner shells faster.
        seeds[index] = (0.10 + Math.random() * 0.12) * SHELL_SPEED[shell];
    }

    const geometry = makeQuadInstancedGeometry(safeCount, {
        aBase: { array: bases, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');
    const aSeed = attribute('aSeed', 'float');

    // Bounded: the angle advance is wrapped to [0, 2π) (cos/sin make the wrap seamless).
    const angle = aBase.y.add(mod(uTime.mul(aSeed), TAU));
    const infall = sin(uTime.mul(0.4).mul(abs(aSeed).add(0.3)).add(aPhase)).mul(0.12).add(0.9);
    const radius = aBase.x.mul(infall);
    // Orbit sense matches the disk (counter-clockwise about the disk normal once laid onto
    // the pivot's XY plane): local XZ with -sin on z.
    const center = vec3(
        cos(angle).mul(radius),
        aBase.z.add(sin(uTime.mul(0.22).add(aPhase)).mul(1.5)),
        sin(angle).mul(radius).negate(),
    );
    const positionNode = billboardLocal(center, aSize);

    const d = length(uv().sub(0.5));
    const glow = pow(clamp(oneMinus(d.mul(2.0)), 0.0, 1.0), 2.2);
    const twinkle = sin(uTime.mul(1.6).add(aPhase.mul(1.7))).mul(0.2).add(0.6);

    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor.mul(1.2);
    material.opacityNode = clamp(glow.mul(twinkle), 0.0, 0.8).mul(uOpacity);
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'infall-ember-field-tsl';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ── Twinkling point material (shared by shards + the far starfield) ──────────────────

/**
 * Twinkling additive billboard material. Per-instance `aBase`/`aColor`/`aSize`/`aTwinkle`
 * drive a `billboardLocal` quad; `uv()` is the sprite mask.
 *   options.drift        bounded in-shader vertical bob (shards) fed by uCameraY
 *   options.sizeTwinkle  false ⇒ the twinkle rides ALPHA only, at a per-star rate (stars —
 *                        a pulsing footprint pops sub-pixel stars in and out)
 */
function createTwinkleMaterialTSL(uTime, options = {}) {
    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinkle = attribute('aTwinkle', 'float');
    const sizeTwinkle = options.sizeTwinkle !== false;

    const rate = sizeTwinkle ? float(2.2) : fract(aTwinkle.mul(1.618)).mul(2.4).add(0.6);
    const tw = sin(uTime.mul(rate).add(aTwinkle)).mul(0.5).add(0.5);
    const size = sizeTwinkle ? aSize.mul(tw).mul(1.1).add(0.5) : aSize;

    let center = aBase;
    let driftUniforms = null;
    if (options.drift) {
        const uCameraY = uniform(0); // .js feeds camera.position.y each frame
        const uDriftAmp = uniform(options.drift.amplitude ?? 2.4);
        const uDriftSpeed = uniform(options.drift.speed ?? 0.6);
        const driftY = sin(uTime.mul(uDriftSpeed).add(aTwinkle).add(uCameraY.mul(0.002)))
            .mul(uDriftAmp);
        center = vec3(aBase.x, aBase.y.add(driftY), aBase.z);
        driftUniforms = { uCameraY, uDriftAmp, uDriftSpeed };
    }
    const positionNode = billboardLocal(center, size);

    const d = length(uv().sub(0.5));
    const glow = sizeTwinkle
        ? pow(clamp(oneMinus(d.mul(2.0)), 0.0, 1.0), 1.6)
        : pow(clamp(oneMinus(d.mul(2.0)), 0.0, 1.0), 2.6);
    const uOpacity = uniform(1); // ecotone crossfade (backlog #4)
    const scint = sizeTwinkle ? tw : varying(oneMinus(tw.mul(0.3)));
    // Stars carry a per-star magnitude (from the phase — no new attribute), skewed faint.
    const magnitude = sizeTwinkle ? float(1.0) : pow(fract(aTwinkle.mul(1.37)), 2.5).mul(0.85).add(0.15);
    const alpha = glow.mul(scint).mul(magnitude).mul(uOpacity);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    if (driftUniforms) {
        material.userData.driftUniforms = driftUniforms;
    }
    return material;
}

// ── Transcendence shards (additive points, bloom-eligible) ───────────────────────────

export function createTranscendenceShardsTSL(uTime = uniform(0)) {
    const count = 150;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    const palette = [
        new THREE.Color(0xff9ad8),
        new THREE.Color(0xffe2b0),
        new THREE.Color(0xffd28a),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + (Math.random() * 110);
        positions[stride] = Math.cos(angle) * radius;
        positions[stride + 1] = (Math.random() - 0.5) * 130;
        positions[stride + 2] = -760 - (Math.random() * 130);

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;
        sizes[index] = 1.6 + Math.random() * 2.4;
        twinkles[index] = Math.random() * Math.PI * 2;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinkle: { array: twinkles, itemSize: 1 },
    });

    const material = createTwinkleMaterialTSL(uTime, { drift: { amplitude: 2.4, speed: 0.6 } });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'transcendence-shards-tsl';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: material.userData.driftUniforms,
    };
}

// ── Far starfield — the stars the ch7 post lens bends round the shadow ───────────────

export const CH7_STARFIELD = Object.freeze({
    count: 2200,
    radiusMin: 2350,
    radiusSpan: 450,
    sizeMin: 7,
    sizeSpan: 16,
});

/**
 * A full far shell BEHIND the hero. It used to be 760 sprites in a flattened disc around a
 * fixed point 790-990 u down the chapter — beside, not behind, a hero that is re-posed in
 * front of the camera every frame, so the lens had no stars behind the shadow to bend.
 */
export function createLensingStarfieldTSL(uTime = uniform(0), options = {}) {
    const count = options.count ?? CH7_STARFIELD.count;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    let state = 0x7a3f2b1d;
    const rng = () => {
        state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
        state = (state + 0x6d2b79f5) >>> 0;
        return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
    };

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const r = CH7_STARFIELD.radiusMin + rng() * CH7_STARFIELD.radiusSpan;
        positions[stride] = r * Math.sin(phi) * Math.cos(theta);
        positions[stride + 1] = r * Math.cos(phi);
        positions[stride + 2] = r * Math.sin(phi) * Math.sin(theta);

        // Mostly blue-white and white, a few warm — a sky, not confetti.
        const k = rng();
        let c;
        if (k < 0.55) c = [0.86, 0.9, 1.0];
        else if (k < 0.85) c = [1.0, 0.97, 0.93];
        else c = [1.0, 0.82, 0.62];
        colors[stride] = c[0];
        colors[stride + 1] = c[1];
        colors[stride + 2] = c[2];
        // Power-law sizing: most stars small, a few bright anchors.
        sizes[index] = CH7_STARFIELD.sizeMin + rng() * rng() * CH7_STARFIELD.sizeSpan;
        twinkles[index] = rng() * Math.PI * 2;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinkle: { array: twinkles, itemSize: 1 },
    });

    const material = createTwinkleMaterialTSL(uTime, { sizeTwinkle: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'lensing-starfield-tsl';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// ── Pilot assembler (WebGPU / WebGL2 validation gate) ─────────────────────────────────────
//
// scripts/odyssey-webgpu-validation.mjs and pilot/odyssey-webgpu-pilot.js build every chapter's
// TSL graph in isolation and fail on validation errors; the masterpiece pass removed the old
// assembler with the old hero, which silently turned the ch7 entry into an empty scene
// (pre-merge review). This one assembles TODAY's parts at the shipped proportions (the
// CH7_GARGANTUA multiples in black-hole-transcendence.js), compact enough for the pilot's
// ~120 u camera, so the gate exercises every ch7 pipeline again.
export function createBlackHoleTranscendencePilotTSL() {
    const uTime = uniform(0);
    const uEnergy = uniform(0.4);
    const S = 18;
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-pilot-tsl';
    const face = new THREE.Group();
    group.add(face);
    const shadow = new THREE.Mesh(
        new THREE.SphereGeometry(S, 48, 32),
        new THREE.MeshBasicNodeMaterial({ color: 0x000000 }),
    );
    face.add(shadow);
    const photon = createGargantuaPhotonRingTSL(uTime, { innerRadius: S, outerRadius: S * 1.075, shadowRadius: S });
    face.add(photon.mesh);
    const foldMaterial = createLensedFoldMaterialTSL(uTime, { shadowRadius: S });
    const sweep = Math.PI * 0.8;
    const foldGeometry = new THREE.TorusGeometry(S * 1.25, S * 0.05, 8, 64, sweep);
    const topFold = new THREE.Mesh(foldGeometry, foldMaterial);
    topFold.rotation.z = Math.PI / 2 - sweep / 2;
    const bottomFold = new THREE.Mesh(foldGeometry, foldMaterial);
    bottomFold.rotation.z = -Math.PI / 2 - sweep / 2;
    face.add(topFold, bottomFold);
    const diskPivot = new THREE.Group();
    diskPivot.rotation.order = 'ZYX';
    diskPivot.rotation.set(-(Math.PI / 2 - 0.10), 0, -0.10);
    group.add(diskPivot);
    const disk = createAccretionDiskTSL(uTime, uEnergy, { innerRadius: S * 1.34, outerRadius: S * 4.8 });
    diskPivot.add(disk.mesh);
    const parts = [
        createVoidDomeTSL(uTime, uEnergy),
        createCorridorDustTSL(uTime),
        createInfallEmberFieldTSL(uTime),
        createTranscendenceShardsTSL(uTime),
        createLensingStarfieldTSL(uTime),
    ];
    parts.forEach((part) => group.add(part.mesh));
    return {
        group,
        uniforms: { uTime, uEnergy },
        dispose() {
            [...parts, photon, disk].forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
            shadow.geometry.dispose();
            shadow.material.dispose();
            foldGeometry.dispose();
            foldMaterial.dispose();
        },
    };
}

export default createBlackHoleTranscendencePilotTSL;

/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunset — a longtail boat that now and then crosses the far sea.
 *
 * Every few minutes a Thai longtail boat comes into the picture at one edge, a few hundred
 * metres out, and crosses it at an unhurried pace to the other: the long low hull, the prow
 * swept up and wrapped in coloured garlands, the tarp over the middle, the boatman standing at
 * the stern with the tiller and the long propeller shaft angled down into the sea behind. It
 * rides the same swell the lanterns do. By day it is a painted boat in the light; against the
 * low sun it is a silhouette on the road of light; at dusk its lantern is lit, and the sea
 * mirrors it as it mirrors the lanterns. Nothing in play calls it: it belongs to the evening,
 * like the turning day.
 *
 * The boat is the theme's own, modelled in Blender (scripts/blender/sunset_longtail.py writes
 * sunset-longtail-model.js): real size, 11 m from the transom to the prow's tip. One mesh, one
 * draw; its place, heading, heave, pitch and roll are set on the CPU every frame.
 *
 * When it comes is the theme's own: a passage is planned from a generator of its own, restarted
 * whenever the world seeks, so a seek to a time always shows the same boat (or none).
 *
 * The light is the gulls' (sunset-birds.js): the sky the paint faces and the sea's dim light from
 * below, the sun (or the moon) on the faces turned to it, a silhouette against a low light, and
 * the air between the eye and the boat that the far sea fades into.
 *
 * Seen this far out the sea is nearly a mirror (it shows the pale low sky), and a boat with
 * nothing under it seems to hang in that sky. So the boat is drawn a second time, mirrored in
 * the water under its waterline: only what stands above the water, dimmer, broken into bands by
 * the swell's ripples and fading downward. The sea's own surface lies in front of the mirrored
 * hull, so its vertex stage draws it nearer the eye along the same lines of sight (the same
 * place on screen, a smaller depth): in front of the far water it sits on, behind any lantern
 * nearer than it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, cameraProjectionMatrix, dot, exp, faceDirection, float, length, max, min, mix,
    modelViewMatrix, normalize, normalWorld, positionGeometry, positionLocal, positionWorld, pow, sin, smoothstep,
    step, uniform, vec3, vec4,
} from 'three/tsl';
import {
    DEG, mulberry32, seaHeight, seaSlope, smooth,
} from './sunset-core.js';
import { SUNSET_LONGTAIL } from './sunset-longtail-model.js';
import { TUNE, horizonHaze, skyBase } from './sunset-tsl.js';

/** When and where the boat comes (metres, metres a second, seconds, degrees). */
export const BOAT = Object.freeze({
    /** How far out its course runs, measured square to the view. */
    range: Object.freeze([260, 420]),
    speed: Object.freeze([4.6, 6.6]),
    /** After a start (a seek, a rebuild), before the first passage sets out. */
    firstWait: Object.freeze([60, 150]),
    /** From one passage leaving the picture to the next setting out. */
    gap: Object.freeze([180, 420]),
    /** How far past the frame's edge it comes in and goes out. */
    margin: 7,
    /** How far its course may run off square to the view (it comes a little nearer or goes away). */
    angle: 9,
});

/** How the light falls on the boat (shares of the hour's colours, as for the gulls). */
export const TONE = Object.freeze({
    sky: 1.0,
    sea: 0.55,
    seaSun: 0.2,
    against: 0.14,
    key: 0.85,
    keyAgainst: 0.45,
    rim: 0.05,
});

/** The mirror under the boat: how much of its light the water gives back, and how it breaks up. */
export const MIRROR = Object.freeze({
    /** The water's share of the boat's light (grazing water is a good mirror; the ripples break it). */
    strength: 0.62,
    tint: Object.freeze([0.8, 0.86, 0.95]),
    /** Ripple bands: across (rad/m of height), along (rad/m), how fast they run (rad/s). */
    bands: 6.5,
    along: 0.32,
    run: 1.4,
    /** How fast it fades below the waterline (1/m). */
    fade: 0.42,
    /** How far toward the eye its vertex stage draws it (a share of its distance). */
    nearer: 0.45,
});

/** The lantern's flame (linear) and how bright it burns at full night. */
export const LAMP_RGB = Object.freeze([1.0, 0.56, 0.2]);
export const LAMP_GLOW = 1.1;

// ── The model ─────────────────────────────────────────────────────────────────────────────

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

let decoded = null;

/** The boat as the bundle carries it, decoded once. */
export function longtailModel() {
    if (decoded) return decoded;
    const { quant } = SUNSET_LONGTAIL;
    decoded = Object.freeze({
        positions: Float32Array.from(decode(SUNSET_LONGTAIL.positions, Int16Array), (v) => v * quant),
        index: decode(SUNSET_LONGTAIL.index, Uint16Array),
        colours: decode(SUNSET_LONGTAIL.colours, Uint8Array),
        vertexCount: SUNSET_LONGTAIL.vertexCount,
        triangleCount: SUNSET_LONGTAIL.triangleCount,
        length: SUNSET_LONGTAIL.length,
        lantern: SUNSET_LONGTAIL.lantern,
    });
    return decoded;
}

/** The boat's mesh: positions, normals and paint (rgb, and the lantern's glass in alpha). */
export function buildBoatGeometry() {
    const m = longtailModel();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(m.index, 1));
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(m.colours, 4, true));
    geometry.computeBoundingSphere();
    return geometry;
}

// ── The passages ──────────────────────────────────────────────────────────────────────────

const pick = (rand, [lo, hi]) => lo + (hi - lo) * rand();

/**
 * Plan a passage across the view. The eye looks along -z; `halfView` is half the frame's
 * horizontal field of view (degrees). `dir` 1 goes left to right, -1 right to left.
 * Returns where it sets out, its course (a unit vector), its speed and how long it takes from
 * one edge to the other. Pure: the same numbers give the same passage.
 */
export function planPassage({
    at, halfView, dir, range, speed, slant,
}) {
    const reach = Math.min(80, halfView + BOAT.margin) * DEG;
    const turn = slant * DEG;
    // Its course: across the view, turned a little toward the eye or away from it.
    const dx = dir * Math.cos(turn);
    const dz = Math.sin(turn);
    // The course passes `range` metres straight ahead; where along it does the bearing reach the edge?
    const along = (bearing) => {
        const T = Math.tan(bearing);
        return (T * range) / (dx + T * dz);
    };
    const s0 = along(-dir * reach);
    const s1 = along(dir * reach);
    return {
        at,
        dir,
        x0: dx * s0,
        z0: -range + dz * s0,
        dx,
        dz,
        speed,
        range,
        seconds: Math.max(1, (s1 - s0) / speed),
        heading: Math.atan2(dx, dz),
    };
}

/** Where a passage has the boat at `clock`: x, z and how far through it is (0..1, or outside). */
export function passageAt(p, clock, out = { x: 0, z: 0, u: 0 }) {
    const s = (clock - p.at) * p.speed;
    out.x = p.x0 + p.dx * s;
    out.z = p.z0 + p.dz * s;
    out.u = (clock - p.at) / p.seconds;
    return out;
}

/**
 * The boat on the far sea: `update(clock, view)` once a frame plans the next passage when it is
 * due and sets the mesh on the swell; `lampLight()` is the lantern's light for the glows and the
 * sea's mirror, or null when it is not lit or not in sight.
 */
export function createBoat({ U, seed = 29 }) {
    const geometry = buildBoatGeometry();
    const lamp = uniform(0);
    const waterY = uniform(0);
    const aPaint = attribute('color', 'vec4');

    /** The boat's light as the eye sees it at this fragment (N: its normal, facing the eye side). */
    const boatLight = (N) => {
        const { light } = U;
        const toBoat = positionWorld.sub(cameraPosition).toVar();
        const look = normalize(toBoat).toVar();
        const albedo = aPaint.rgb;
        const glass = aPaint.a;
        // The light: the sun by day, the moon by night, as much of it as stands over the sea.
        const key = normalize(mix(U.sun, U.moon, U.moonKey)).toVar();
        const keyUp = mix(U.sunUp, U.moonUp, U.moonKey);
        // The sky the paint faces, and the sea's dim light from below.
        const seeSky = N.y.mul(0.5).add(0.5);
        const skyLight = skyBase(normalize(vec3(N.x, max(N.y, 0.0).add(0.25), N.z)), U);
        // Seen against a low light the boat is a silhouette on its road; with the sun high it is
        // a painted boat in the light.
        const toward = dot(look, key);
        const sunHigh = smoothstep(Math.sin(18 * DEG), Math.sin(38 * DEG), key.y);
        const glare = smoothstep(Math.cos(55 * DEG), Math.cos(12 * DEG), toward).mul(sunHigh.oneMinus());
        const seaLight = skyBase(normalize(vec3(N.x, 0.12, N.z)), U).mul(TONE.sea)
            .add(light.cloudLit.mul(keyUp).mul(TONE.seaSun));
        const ambient = mix(seaLight, skyLight.mul(TONE.sky), seeSky)
            .mul(mix(float(1.0), float(TONE.against), glare));
        const direct = light.cloudLit.mul(max(dot(N, key), 0.0).mul(keyUp).mul(TONE.key))
            .mul(mix(float(1.0), float(TONE.keyAgainst), glare));
        // A thin rim round the outline close to the light.
        const edge = pow(float(1.0).sub(abs(dot(N, look))), 5.0);
        const rim = light.cloudRim.mul(edge.mul(smoothstep(Math.cos(18 * DEG), Math.cos(3 * DEG), toward))
            .mul(keyUp).mul(TONE.rim));
        // The lantern's glass, lit at dusk and through the night.
        const flame = vec3(LAMP_RGB[0], LAMP_RGB[1], LAMP_RGB[2]).mul(glass.mul(lamp).mul(6.0));
        const col = albedo.mul(ambient.add(direct)).add(rim).add(flame);
        // The air between the eye and the boat: the far sea's own haze.
        const haze = float(1.0).sub(exp(length(toBoat).div(-TUNE.hazeReach)));
        return mix(col, horizonHaze(look, U), haze.mul(min(haze.mul(1.4), 1.0)));
    };

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'sunset-boat';
    material.colorNode = Fn(() => vec4(boatLight(normalize(normalWorld).toVar()), 1.0))();

    // The boat in the water: mirrored under its waterline (the mesh's matrix), drawn nearer the
    // eye along the same lines of sight so the sea in front of it does not hide it.
    const mirror = new THREE.MeshBasicNodeMaterial({
        fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    mirror.name = 'sunset-boat-mirror';
    mirror.vertexNode = Fn(() => {
        const mv = modelViewMatrix.mul(vec4(positionLocal, 1.0));
        return cameraProjectionMatrix.mul(vec4(mv.xyz.mul(MIRROR.nearer), 1.0));
    })();
    mirror.colorNode = Fn(() => {
        const N = normalize(normalWorld).mul(faceDirection).toVar();
        const tint = vec3(MIRROR.tint[0], MIRROR.tint[1], MIRROR.tint[2]);
        return vec4(boatLight(N).mul(tint), 1.0);
    })();
    mirror.opacityNode = Fn(() => {
        // Only what stands above the water is mirrored (the hull under it and the shaft's end are
        // under the sea), broken into bands by the ripples and fading away under the boat.
        const above = step(0.0, positionGeometry.y);
        const under = max(waterY.sub(positionWorld.y), 0.0);
        const ripple = sin(positionWorld.y.mul(MIRROR.bands).add(positionWorld.x.mul(MIRROR.along))
            .add(U.time.mul(MIRROR.run))).mul(0.5).add(0.5);
        return above.mul(ripple.mul(0.55).add(0.3)).mul(exp(under.mul(-MIRROR.fade))).mul(MIRROR.strength);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sunset-boat';
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    const reflection = new THREE.Mesh(geometry, mirror);
    reflection.name = 'sunset-boat-mirror';
    reflection.frustumCulled = false;
    reflection.renderOrder = 2;
    reflection.matrixAutoUpdate = false;
    // A child of the boat (so it goes and comes with it): its matrix undoes the boat's own and
    // mirrors it about the water under it, boat⁻¹ · mirror · boat.
    mesh.add(reflection);
    const flip = new THREE.Matrix4();
    const undo = new THREE.Matrix4();

    const state = {
        rand: mulberry32(seed + 211),
        next: 0,
        passage: null,
        passages: 0,
        x: 0,
        y: 0,
        z: 0,
        u: 0,
        lamp: 0,
        inSight: false,
        /** A capture may leave the boat out (showOnlyParts). */
        shown: true,
        sailing: false,
    };
    const at = { x: 0, z: 0, u: 0 };
    const slope = { x: 0, z: 0 };
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const place = new THREE.Vector3();
    const lantern = new THREE.Vector3();
    const lanternLocal = new THREE.Vector3(...longtailModel().lantern);
    const lampOut = {
        x: 0, y: 0, z: 0, glow: 0, rgb: LAMP_RGB,
    };

    const setOut = (clock, halfView, options = {}) => {
        const { rand } = state;
        const dir = options.dir ?? (rand() < 0.5 ? 1 : -1);
        state.passage = planPassage({
            at: clock,
            halfView,
            dir,
            range: options.range ?? pick(rand, BOAT.range),
            speed: options.speed ?? pick(rand, BOAT.speed),
            slant: options.slant ?? (rand() * 2 - 1) * BOAT.angle,
        });
        state.passages += 1;
    };

    return {
        mesh,
        lamp,
        /** Start over at `clock` (a seek): nothing on the water, the first passage a while off. */
        restart(clock) {
            state.rand = mulberry32(seed + 211);
            state.passage = null;
            state.passages = 0;
            state.next = clock + pick(state.rand, BOAT.firstWait);
            mesh.visible = false;
            state.inSight = false;
            state.sailing = false;
        },
        /** Send a passage now (the playground stages one): `dir`, `range`, `speed`, `slant` optional. */
        send(clock, halfView, options) {
            setOut(clock, halfView, options);
        },
        /**
         * Once a frame: `halfView` is half the frame's horizontal field of view (degrees), `night`
         * 0..1 how far the lantern is lit.
         */
        update(clock, { halfView, night = 0 }) {
            let p = state.passage;
            if (p && clock - p.at > p.seconds) {
                state.passage = null;
                state.next = clock + pick(state.rand, BOAT.gap);
                p = null;
            }
            if (!p && clock >= state.next) {
                setOut(clock, halfView);
                p = state.passage;
            }
            if (!p || clock < p.at) {
                mesh.visible = false;
                state.inSight = false;
                state.sailing = false;
                return;
            }
            passageAt(p, clock, at);
            // It rides the swell: the hull averages the short waves, so it heaves and rocks gently.
            const y = seaHeight(at.x, at.z, clock) * 0.75;
            seaSlope(at.x, at.z, clock, slope);
            const fx = Math.sin(p.heading);
            const fz = Math.cos(p.heading);
            const along = slope.x * fx + slope.z * fz;
            const across = slope.x * fz - slope.z * fx;
            const pitch = -Math.atan(along) * 0.55;
            const roll = Math.atan(across) * 0.7 + Math.sin(clock * 0.9 + p.at) * 0.012;
            euler.set(pitch, p.heading, roll);
            quat.setFromEuler(euler);
            place.set(at.x, y, at.z);
            mesh.matrix.compose(place, quat, scale);
            mesh.matrixWorldNeedsUpdate = true;
            flip.makeScale(1, -1, 1).setPosition(0, 2 * y, 0).multiply(mesh.matrix);
            reflection.matrix.multiplyMatrices(undo.copy(mesh.matrix).invert(), flip);
            reflection.matrixWorldNeedsUpdate = true;
            waterY.value = y;
            state.sailing = true;
            mesh.visible = state.shown;
            state.x = at.x;
            state.y = y;
            state.z = at.z;
            state.u = at.u;
            state.inSight = at.u > 0 && at.u < 1;
            state.lamp = Math.max(0, Math.min(1, night));
            lamp.value = state.lamp;
            lantern.copy(lanternLocal).applyMatrix4(mesh.matrix);
        },
        /** The lantern's light for the glows and the sea's mirror, or null. */
        lampLight() {
            if (!mesh.visible || !(state.lamp > 0.02)) return null;
            lampOut.x = lantern.x;
            lampOut.y = lantern.y;
            lampOut.z = lantern.z;
            lampOut.glow = LAMP_GLOW * state.lamp;
            return lampOut;
        },
        reset() {
            state.passage = null;
            mesh.visible = false;
            state.inSight = false;
            state.sailing = false;
        },
        /** Draw the boat or leave it out (a capture of some parts only). */
        setShown(on) {
            state.shown = on !== false;
            mesh.visible = state.shown && state.sailing;
        },
        /** For the tests and the playground's diagnostics. */
        getState() {
            const p = state.passage;
            return {
                sailing: state.sailing,
                inSight: state.inSight,
                passages: state.passages,
                next: state.next,
                x: state.x,
                y: state.y,
                z: state.z,
                u: state.u,
                dir: p?.dir ?? 0,
                range: p?.range ?? 0,
                seconds: p?.seconds ?? 0,
                lamp: state.lamp,
            };
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
            mirror.dispose();
        },
    };
}

/** How far the lantern is lit at a sun height (degrees): lit through dusk, out by the morning. */
export function lampForSun(sunHeight) {
    return 1 - smooth(-3, 5, sunHeight);
}

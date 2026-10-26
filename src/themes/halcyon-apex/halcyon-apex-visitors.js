/**
 * Halcyon Apex — the visitors: now and then a craft not of this world passes over the sanctuary.
 *
 * Five hulls (a chrome saucer, a dark triangle, a long mothership, three orbs of light, a white
 * capsule) share one mesh and one material, each kind a range of the buffer, and only the kind that
 * flies is drawn (`setDrawRange`), so the sky pays nothing between visits and one pipeline serves all
 * five. Their lamps are sprites (a pool of instanced quads fed from a uniform table), so a lamp still
 * reads as a point of light when its hull is a few pixels across; the same pool draws the beam a
 * saucer lays on the Halcyon.
 *
 * The hulls shade themselves like everything in the sanctuary: chrome mirrors the dawn along its own
 * reflection (the lagoon below the horizon), paint takes the sun and the sky's light, glass holds a
 * glow, and distance fades them into the air. A visitor that comes or goes out of thin air dissolves
 * into the sky behind it. Both parts stand in the lagoon's mirror.
 *
 * Where a visitor is, and which, is a pure function of the world clock (halcyon-apex-visitor-plan.js),
 * so seek(t) shows the same sky a replay does.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    instanceIndex,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    smoothstep,
    step,
    uniform,
    uniformArray,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU,
    haAtmosphere,
    haFogAmount,
    haFresnel,
    haFxMaterial,
    haPart,
    haQuadGeometry,
    haSkyBase,
    haSkyLight,
} from './halcyon-apex-tsl.js';
import {
    LAMP_SLOTS,
    ORB_COUNT,
    VISITOR_KIND,
    VISITOR_LAMPS,
    VISITOR_ROUTE,
    buildHulls,
    visitAt,
    visitorPose,
} from './halcyon-apex-visitor-plan.js';

/** Frames after a build that every hull is drawn (out of sight), so its pipelines exist before the first visit. */
export const VISITOR_WARM_FRAMES = 90;
/** Where the hulls wait while nothing flies (far under the lagoon, outside every camera's view). */
const IDLE = Object.freeze([0, -5000, 0]);
/** The pool slot that draws the beam (one past the lamps). */
const BEAM_SLOT = LAMP_SLOTS;

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** The hull material: one for every kind, each vertex told what it is made of. */
function createHullMaterial(u, v) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexVisitors';
    material.fog = false;
    const part = attribute('aPart', 'vec4');
    // The orbs fly as three: each takes its own offset from the hull's place (zero for the others).
    const unit = part.w;
    const w1 = step(0.5, unit).sub(step(1.5, unit));
    const w2 = step(1.5, unit);
    const offset = v.units[0].mul(float(1.0).sub(w1).sub(w2)).add(v.units[1].mul(w1)).add(v.units[2].mul(w2));
    material.positionNode = positionGeometry.add(offset);
    const vPart = varying(part, 'haVisitorPart');

    material.colorNode = Fn(() => {
        // Pinned before anything reads them (three assigns the normal where it is first built).
        const N = normalize(normalWorld).toVar();
        const P = positionWorld.toVar();
        const V = normalize(P.sub(cameraPosition)).toVar();
        const surface = floor(vPart.x.add(0.5)).toVar();
        const param = clamp(vPart.y, 0.0, 1.0).toVar();
        const cosV = clamp(dot(N, V).negate(), 0.0, 1.0).toVar();
        const R = reflect(V, N).toVar();

        // What a polished face sees along its reflection: the dawn, or the lagoon mirroring it.
        const skyR = haSkyBase(u, vec3(R.x, abs(R.y), R.z));
        const lagoon = skyR.mul(0.35).add(u.deep.mul(0.3)).add(u.shallow.mul(0.06));
        const env = mix(lagoon, skyR, smoothstep(-0.05, 0.05, R.y)).toVar();
        const rs = clamp(dot(R, u.sunDir), 0.0, 1.0);
        const rs2 = rs.mul(rs);
        const rs4 = rs2.mul(rs2);
        const rs8 = rs4.mul(rs4);
        const rs32 = rs8.mul(rs8).mul(rs8).mul(rs8).toVar();
        const rs256 = rs32.mul(rs32).mul(rs32).mul(rs32).mul(rs32)
            .mul(rs32)
            .mul(rs32)
            .mul(rs32);
        const glint = u.sun.mul(rs256.mul(3.0).add(rs32.mul(0.22))).toVar();
        // The light a painted face takes: the sun, the sky over the way it faces, the lagoon below.
        const facing = max(dot(N, u.sunDir), 0.0);
        const light = u.sun.mul(facing).mul(0.9)
            .add(haSkyLight(u, N).mul(1.1))
            .add(u.shallow.mul(max(N.y.negate(), 0.0)).mul(0.35))
            .toVar();
        const lamp = mix(v.lampA, v.lampB, step(0.5, param)).toVar();

        const chrome = env.mul(mix(float(0.55), float(1.0), haFresnel(cosV, 0.6))).mul(vec3(0.95, 0.93, 0.9))
            .add(glint).add(light.mul(0.04));
        const satin = light.mul(param).add(env.mul(haFresnel(cosV, 0.04)).mul(0.7)).add(glint.mul(0.3));
        const matte = light.mul(param).add(env.mul(haFresnel(cosV, 0.04)).mul(0.45)).add(u.sun.mul(rs32).mul(0.08));
        const glass = env.mul(haFresnel(cosV, 0.08).mul(1.2).add(0.06)).add(glint)
            .add(v.lampA.rgb.mul(v.lampA.w).mul(0.1).mul(cosV.mul(0.6).add(0.4)));
        const emitter = lamp.rgb.mul(lamp.w).mul(u.breath);
        const orb = v.lampA.rgb.mul(v.lampA.w).mul(cosV.mul(cosV).mul(1.6).add(0.45)).mul(u.breath);

        const is = (k) => float(1.0).sub(step(0.5, abs(surface.sub(k))));
        const col = chrome.mul(is(0)).add(satin.mul(is(1))).add(matte.mul(is(2))).add(glass.mul(is(3)))
            .add(emitter.mul(is(4)))
            .add(orb.mul(is(5)));
        const seen = haAtmosphere(u, col, P);
        // Coming or going out of thin air, it dissolves into the sky behind it.
        const behind = haSkyBase(u, vec3(V.x, max(V.y, 0.015), V.z));
        return vec4(mix(behind, seen, v.presence), 1.0);
    })();
    return material;
}

/** The lamp sprites and the beam: one pool of quads, fed from a uniform table each frame. */
function createLightMaterial(u, v) {
    const material = haFxMaterial('HalcyonApexVisitorLights');
    const slot = instanceIndex;
    const isBeam = step(BEAM_SLOT - 0.5, float(slot));
    const at = v.glowAt.element(slot);
    const tint = v.glowTint.element(slot);

    // A lamp: a camera-facing quad of `size` metres, never less than a few pixels.
    const clip = viewProjection(at.xyz);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(at.w.mul(pxPerMetre), u.viewport.y.mul(0.004), u.viewport.y.mul(0.07)).mul(step(1e-4, at.w));
    const spriteClip = vec4(
        clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(u.viewport.mul(0.5)).mul(clip.w)),
        clip.z,
        clip.w,
    );
    // The beam: a strip from the hull (top) down to what it lights, turned to face the eye.
    const along = positionGeometry.y.add(0.5);
    const axisAt = mix(v.beamTo.xyz, at.xyz, along);
    const axis = normalize(at.xyz.sub(v.beamTo.xyz).add(vec3(1e-5, 2e-5, 0.0)));
    const side = normalize(cross(axis, cameraPosition.sub(axisAt)).add(vec3(0.0, 1e-6, 1e-6)));
    const width = mix(v.beamTo.w, at.w, along);
    const beamClip = viewProjection(axisAt.add(side.mul(positionGeometry.x.mul(width))));
    material.vertexNode = mix(spriteClip, beamClip, isBeam);

    // The air between the eye and the light takes its share of it.
    const rel = mix(at.xyz, v.beamTo.xyz, isBeam.mul(0.5)).sub(cameraPosition);
    const through = float(1.0).sub(haFogAmount(length(rel), at.y));
    const vTint = varying(vec4(tint.rgb.mul(tint.w).mul(through), isBeam), 'haVisitorTint');

    material.colorNode = Fn(() => {
        const q = clamp(uv(), 0.0, 1.0).toVar();
        // Lamp: a hot core in a soft halo.
        const d = length(q.sub(0.5).mul(2.0));
        const lampLight = exp(d.mul(d).mul(-22.0)).add(exp(d.mul(d).mul(-4.0)).mul(0.22))
            .mul(float(1.0).sub(smoothstep(0.8, 1.0, d)));
        // Beam: soft across, brightest under the hull, a slow ripple running down it.
        const across = q.x.sub(0.5).mul(2.0);
        const profile = exp(across.mul(across).mul(-4.5)).mul(float(1.0).sub(smoothstep(0.85, 1.0, abs(across))));
        const ripple = q.y.mul(36.0).add(u.time.mul(7.0)).sin().mul(0.2)
            .add(0.8);
        const beamLight = profile.mul(smoothstep(0.0, 0.14, q.y)).mul(q.y.mul(0.5).add(0.5)).mul(ripple)
            .mul(float(1.0).sub(smoothstep(0.9, 1.0, q.y)).mul(0.6).add(0.4));
        const shape = mix(lampLight, beamLight, vTint.w);
        return vec4(vTint.rgb.mul(shape).mul(u.breath), 0.0);
    })();
    return material;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {object} u  shared sanctuary uniforms
 * @returns {object} { hulls, lights, update, call, reset, state }
 */
export function createVisitors(u) {
    const hullData = buildHulls();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(hullData.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(hullData.normal, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(hullData.part, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const glowAt = Array.from({ length: LAMP_SLOTS + 1 }, () => new THREE.Vector4(0, 0, 0, 0));
    const glowTint = Array.from({ length: LAMP_SLOTS + 1 }, () => new THREE.Vector4(0, 0, 0, 0));
    const v = {
        presence: uniform(1),
        lampA: uniform(new THREE.Vector4(1, 1, 1, 0)),
        lampB: uniform(new THREE.Vector4(1, 1, 1, 0)),
        units: Array.from({ length: ORB_COUNT }, () => uniform(new THREE.Vector3())),
        glowAt: uniformArray(glowAt, 'vec4'),
        glowTint: uniformArray(glowTint, 'vec4'),
        beamTo: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };

    const hulls = haPart('HalcyonApexVisitors', geometry, createHullMaterial(u, v), -12);
    const lightGeometry = haQuadGeometry(LAMP_SLOTS + 1);
    const lights = haPart('HalcyonApexVisitorLights', lightGeometry, createLightMaterial(u, v), 24);

    const { matrix } = hulls.mesh;
    const position = new THREE.Vector3();
    const tiltAxis = new THREE.Vector3();
    const qTilt = new THREE.Quaternion();
    const qYaw = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const lampAt = new THREE.Vector3();
    const white = [1, 1, 1];

    let frames = 0;
    let forced = null;
    const state = {
        route: null, kind: null, age: 0, presence: 0,
    };

    const place = (p, q) => {
        matrix.compose(position.set(p[0], p[1], p[2]), q, scale);
        hulls.mesh.matrixWorldNeedsUpdate = true;
        hulls.mesh.updateMatrixWorld(true);
    };
    const clearLamps = (from = 0) => {
        for (let i = from; i <= LAMP_SLOTS; i++) {
            glowAt[i].w = 0;
            glowTint[i].w = 0;
        }
        v.beamTo.value.w = 0;
    };
    const idle = (warm) => {
        hulls.mesh.visible = warm;
        lights.mesh.visible = warm;
        state.route = null;
        state.kind = null;
        state.presence = 0;
        if (!warm) return;
        // Out of sight, every kind drawn: its pipelines are built before anything flies.
        geometry.setDrawRange(0, hullData.vertexCount);
        place(IDLE, qYaw.identity());
        v.units.forEach((unit) => unit.value.set(0, 0, 0));
        clearLamps();
    };

    /** Which visit flies at `t`: one the world called, else the schedule's. */
    const visitFor = (t, reduced) => {
        if (forced) {
            const age = t - forced.start;
            if (age >= 0 && age <= forced.route.duration) return { route: forced.route, start: forced.start, age };
        }
        return visitAt(t, reduced);
    };

    /**
     * Each frame: who is in the sky at `t`, where, and how its lamps burn.
     * @param {number} t
     * @param {{ yaw: number, eye: number, halcyonTop: number[], palette: object, reduced: boolean }} frame
     */
    const update = (t, frame) => {
        frames += 1;
        const warm = frames <= VISITOR_WARM_FRAMES;
        const visit = visitFor(t, frame.reduced === true);
        if (!visit) {
            idle(warm);
            return;
        }
        const pose = visitorPose(visit.route, visit.age, frame);
        const kind = VISITOR_KIND[pose.kind];
        const [start, count] = hullData.ranges[kind];
        hulls.mesh.visible = true;
        lights.mesh.visible = true;
        geometry.setDrawRange(start, count);
        state.route = visit.route.name;
        state.kind = pose.kind;
        state.age = visit.age;
        state.presence = pose.presence;
        v.presence.value = pose.presence;

        // ── The hull's place: lean, then heading and spin ──
        const tilt = Math.hypot(pose.tilt[0], pose.tilt[1]);
        if (tilt > 1e-6) qTilt.setFromAxisAngle(tiltAxis.set(pose.tilt[1] / tilt, 0, -pose.tilt[0] / tilt), tilt);
        else qTilt.identity();
        qYaw.setFromAxisAngle(UP, pose.yaw + pose.spin);
        qTilt.multiply(qYaw);
        let centre = pose.p;
        if (pose.units) {
            centre = [0, 1, 2].map((c) => pose.units.reduce((sum, at) => sum + at[c], 0) / pose.units.length);
            pose.units.forEach((at, i) => v.units[i].value.set(at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]));
            qTilt.identity();
        } else {
            v.units.forEach((unit) => unit.value.set(0, 0, 0));
        }
        place(centre, qTilt);

        // ── Lamps ──
        const pal = frame.palette || {};
        const crystal = pal.crystal || [0.2, 0.92, 0.88];
        const sunRaw = pal.sun || [4.6, 3.3, 2.0];
        const sunPeak = Math.max(sunRaw[0], sunRaw[1], sunRaw[2], 1e-3);
        const sun = sunRaw.map((c) => c / sunPeak);
        const mixRgb = (a, b, k) => [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * k);
        const flare = 1 + 3 * pose.flash;
        const shown = pose.presence * flare;
        const { age } = visit;
        const lamps = VISITOR_LAMPS[pose.kind];
        let n = 0;
        const lampOut = (localAt, size, rgb, gain) => {
            if (n >= LAMP_SLOTS) return;
            if (pose.units && localAt.unit !== undefined) {
                const at = pose.units[localAt.unit];
                lampAt.set(at[0], at[1], at[2]);
            } else {
                lampAt.set(localAt[0], localAt[1], localAt[2]).applyMatrix4(matrix);
            }
            glowAt[n].set(lampAt.x, lampAt.y, lampAt.z, size);
            glowTint[n].set(rgb[0], rgb[1], rgb[2], Math.max(0, gain * shown));
            n += 1;
        };
        v.lampA.value.set(1, 1, 1, 0);
        v.lampB.value.set(1, 1, 1, 0);
        if (pose.kind === 'saucer') {
            const under = mixRgb(crystal, white, 0.55);
            lamps.forEach((lamp) => {
                if (lamp.group === 'rim') {
                    const chase = 0.5 + 0.5 * Math.cos(3 * (lamp.index / 12) * TAU - age * 4.2);
                    lampOut(lamp.at, lamp.size, crystal, 9 * (0.22 + 0.78 * chase ** 4));
                } else lampOut(lamp.at, lamp.size, under, 2.5 * (0.85 + 0.15 * Math.sin(age * 2.3)) + 2.5 * pose.beam);
            });
            v.lampA.value.set(under[0], under[1], under[2], (2.5 + 3 * pose.beam) * flare);
        } else if (pose.kind === 'triangle') {
            const warmWhite = [1, 0.96, 0.9];
            const amber = [1, 0.36, 0.08];
            const pulse = (0.5 + 0.5 * Math.sin((age * TAU) / 2.6)) ** 2;
            lamps.forEach((lamp) => {
                if (lamp.group === 'corner') lampOut(lamp.at, lamp.size, warmWhite, 10 * (0.92 + 0.08 * Math.sin(age * 13 + lamp.index * 2)));
                else lampOut(lamp.at, lamp.size, amber, 3 + 6 * pulse);
            });
            v.lampA.value.set(warmWhite[0], warmWhite[1], warmWhite[2], 4 * flare);
            v.lampB.value.set(amber[0], amber[1], amber[2], (1.5 + 3 * pulse) * flare);
        } else if (pose.kind === 'cigar') {
            const blink = (period, offset) => {
                const x = ((age + offset) % period) / 0.13;
                return x < 1 ? Math.sin(x * Math.PI) : 0;
            };
            lamps.forEach((lamp) => {
                if (lamp.group === 'window') {
                    const dim = lamp.index === 2 || lamp.index === 6 ? 0.3 : 1;
                    lampOut(lamp.at, lamp.size, [1, 0.84, 0.6], 10 * dim * (0.8 + 0.2 * Math.sin(age * 0.9 + lamp.index * 1.7)));
                } else if (lamp.group === 'nose') lampOut(lamp.at, lamp.size, white, 16 * blink(1.7, 0));
                else if (lamp.group === 'tail') lampOut(lamp.at, lamp.size, [1, 0.12, 0.06], 14 * blink(1.7, 0.85));
                else lampOut(lamp.at, lamp.size, crystal, 6 + 0.8 * Math.sin(age * 3));
            });
            v.lampB.value.set(crystal[0], crystal[1], crystal[2], 3.5 * flare);
        } else if (pose.kind === 'orbs') {
            const glow = mixRgb(sun, white, 0.4);
            lamps.forEach((lamp) => {
                lampOut({ unit: lamp.index }, lamp.size, glow, 2.6 + 0.9 * Math.sin(age * 5.1 + lamp.index * 2.1));
            });
            v.lampA.value.set(glow[0], glow[1], glow[2], 5 * flare * pose.presence);
        }
        clearLamps(n);
        // The beam, from under the hull down to the Halcyon.
        if (pose.beam > 0.001 && pose.beamFrom) {
            const tint = mixRgb(crystal, white, 0.5);
            glowAt[BEAM_SLOT].set(pose.beamFrom[0], pose.beamFrom[1], pose.beamFrom[2], 2.4);
            glowTint[BEAM_SLOT].set(tint[0], tint[1], tint[2], 0.9 * pose.beam * pose.presence);
            v.beamTo.value.set(pose.beamTo[0], pose.beamTo[1], pose.beamTo[2], 9);
        }
    };

    return {
        hulls,
        lights,
        update,
        /** Fly route `name` from world time `start` (captures, and anything that summons one). */
        call(name, start) {
            const route = VISITOR_ROUTE[name];
            forced = route ? { route, start } : null;
            return Boolean(route);
        },
        /** A rebuilt or reseeked sky: nothing called, the pipelines warmed again. */
        reset() {
            forced = null;
        },
        state,
    };
}

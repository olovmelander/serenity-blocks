/**
 * Vesper Chrysalis — what stands in the water: the two stands of crystal and the reeds.
 *
 * The crystals are six-sided, pointed, a little out of true. They are cut like the chrysalis:
 * every face mirrors the sky, the afterglow comes through the edges that face it, and a cold
 * light of their own gathers at their feet. The silk is made fast to the tallest of each stand,
 * so whatever runs down the silk leaves from here: a lock lights the stand on its side from the
 * foot up.
 *
 * The reeds stand in the shallows at the bottom corners of the view, dark against the lake,
 * and stir in a breath of wind.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SUN_DIR,
    THREAD_PULSES,
    mulberry32,
    vcBell,
    vcFresnel,
    vcPart,
    vcSkyBase,
    vcSkyLight,
} from './vesper-chrysalis-tsl.js';

const SUN_FLAT = (() => {
    const l = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    return [SUN_DIR[0] / l, 0, SUN_DIR[2] / l];
})();

/** A six-sided crystal of unit radius and unit height standing on y = 0, flat-shaded. */
function buildCrystalGeometry() {
    const sides = 6;
    const shoulder = 0.8;
    const pos = [];
    const ring = (y, r) => Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2;
        return [Math.cos(a) * r, y, Math.sin(a) * r];
    });
    // It runs a little below the water so the mirror meets it cleanly.
    const foot = ring(-0.03, 1.06);
    const top = ring(shoulder, 0.84);
    // (The point is on the axis: the silk is made fast to it, see spireTip.)
    const tip = [0, 1, 0];
    for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        pos.push(...foot[i], ...top[i], ...foot[j], ...foot[j], ...top[i], ...top[j]);
        pos.push(...top[i], ...tip, ...top[j]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * @param {object} u
 * @param {object[]} spires  the plan (planSpires), already cut to the tier
 */
export function createSpires(u, spires) {
    const geometry = buildCrystalGeometry();
    const n = spires.length;
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    const seeds = new Float32Array(n * 2);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const axis = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const where = new THREE.Vector3();
    const rand = mulberry32(431);
    const turn = new THREE.Quaternion();
    spires.forEach((c, i) => {
        axis.set(c.lean[0], 1, c.lean[1]).normalize();
        quat.setFromUnitVectors(up, axis);
        turn.setFromAxisAngle(up, rand() * Math.PI);
        quat.multiply(turn);
        scale.set(c.radius, c.height, c.radius);
        where.set(c.x, 0, c.z);
        m.compose(where, quat, scale);
        mesh.setMatrixAt(i, m);
        seeds[i * 2] = c.seed;
        seeds[i * 2 + 1] = c.side;
    });
    mesh.instanceMatrix.needsUpdate = true;
    geometry.setAttribute('aSpire', new THREE.InstancedBufferAttribute(seeds, 2));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisSpires';
    material.fog = false;
    material.toneMapped = false;
    const aSpire = attribute('aSpire', 'vec2');
    const vSpire = varying(aSpire, 'vSpire');
    const vHeight = varying(positionGeometry.y, 'vSpireH');
    material.fragmentNode = Fn(() => {
        const N = normalize(normalWorld).toVar();
        const V = normalize(cameraPosition.sub(positionWorld)).toVar();
        const ndv = clamp(dot(N, V), 0.0, 1.0).toVar();
        const h = clamp(vHeight, 0.0, 1.0).toVar();
        const R = reflect(V.negate(), N);
        const env = vcSkyBase(u, normalize(vec3(R.x, abs(R.y).add(0.02), R.z)));
        const fres = vcFresnel(ndv, 0.16).mul(1.5);
        const body = u.crystal.mul(vcSkyLight(u, N)).mul(0.42).add(u.crystal.mul(0.006));
        const edge = float(1.0).sub(ndv);
        const through = u.glow.mul(clamp(dot(N, vec3(SUN_FLAT[0], 0.0, SUN_FLAT[2])), 0.0, 1.0)).mul(edge).mul(0.5);
        // A cold light of its own, gathered at the foot and breathing.
        const breathe = sin(u.drift.mul(0.5).add(vSpire.x.mul(40.0))).mul(0.25).add(0.75);
        const own = u.crystal.mul(exp(h.mul(-3.0)).mul(0.9).add(edge.mul(edge).mul(0.3))).mul(breathe)
            .mul(u.power.mul(0.9).add(0.55));
        // What runs down the silk leaves from here: the stand on that side lights from the foot up.
        const run = vec3(0.0).toVar();
        for (let i = 0; i < THREAD_PULSES; i++) {
            const A = u.pulseA[i];
            const age = u.time.sub(A.x);
            const mine = float(1.0).sub(step(0.5, abs(A.y.sub(vSpire.y)).mul(abs(A.y))));
            const front = age.mul(2.6);
            const lit = vcBell(h.sub(front).div(0.3)).add(exp(age.mul(-3.0)).mul(0.25)).mul(step(0.0, age))
                .mul(exp(age.mul(-1.6)));
            run.addAssign(u.pulseC[i].mul(lit.mul(mine).mul(A.z)));
        }
        const light = own.add(run.mul(u.pulsesLive).mul(edge.mul(0.7).add(0.5)).mul(1.6)).mul(u.breath);
        return vec4(body.add(env.mul(fres)).add(through).add(light), 1.0);
    })();
    mesh.material = material;
    mesh.frustumCulled = false;
    const part = vcPart('VesperChrysalisSpires', geometry, material, 12, { mesh });
    part.count = n;
    return part;
}

/**
 * Reeds in the shallows at the bottom corners of the view.
 * @param {object} u
 * @param {number} count
 */
export function createReeds(u, count) {
    const seg = 4;
    const pos = [];
    const index = [];
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const w = (1 - t) ** 0.7;
        pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0);
        if (i < seg) {
            const b = i * 2;
            index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    const n = Math.max(1, count);
    const rand = mulberry32(977);
    const base = new Float32Array(n * 4); // (x, z, height, seed)
    for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        // Clumps hard against the bottom corners.
        const clump = Math.floor(rand() * 3);
        const cx = side * (5.2 + clump * 2.3 + rand() * 1.8);
        const cz = -(6.2 + clump * 2.4 + rand() * 2.6);
        base.set([cx + (rand() - 0.5) * 1.5, cz + (rand() - 0.5) * 1.5, 1.5 + rand() * 2.1, rand()], i * 4);
    }
    geometry.setAttribute('aReed', new THREE.InstancedBufferAttribute(base, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = count > 0 ? n : 0;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisReeds';
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    const aReed = attribute('aReed', 'vec4');
    const vT = varying(positionGeometry.y, 'vReedT');
    material.positionNode = Fn(() => {
        const t = positionGeometry.y;
        const sway = sin(u.drift.mul(0.9).add(aReed.w.mul(30.0)).add(aReed.x.mul(0.6))).mul(0.16)
            .add(sin(u.drift.mul(2.1).add(aReed.w.mul(70.0))).mul(0.04));
        const bend = t.mul(t).mul(aReed.z);
        const lean = aReed.w.sub(0.5).mul(0.5);
        return positionLocal.mul(vec3(0.085, 0.0, 1.0)).add(vec3(
            aReed.x.add(bend.mul(sway.add(lean))),
            t.mul(aReed.z),
            aReed.y.add(bend.mul(sway).mul(0.4)),
        ));
    })();
    material.fragmentNode = Fn(() => {
        const t = clamp(vT, 0.0, 1.0);
        // Dark blades; their upper halves catch a little of the sky.
        const sky = vcSkyBase(u, normalize(vec3(0.3, 0.5, -0.8)));
        return vec4(mix(u.range.mul(0.5), u.range.add(sky.mul(0.1)), smoothstep(0.2, 1.0, t)), 1.0);
    })();
    mesh.material = material;
    mesh.frustumCulled = false;
    const part = vcPart('VesperChrysalisReeds', geometry, material, 14, { mesh });
    part.count = mesh.count;
    return part;
}

/**
 * Cinder Drift — running lava: the great fall, the fissure streams, the fountains, the jets.
 *
 * All of it is one instanced ribbon. A ribbon runs from a source along a ballistic curve (lava
 * falling from a lip accelerates away from it; a fountain decelerates to its crown), turns about
 * the vertical to face the camera, and carries a white-hot core in a streaked body with a halo
 * of its own light. Slot 0 is the great fall; the next STREAM_SLOTS are the streams a chain of
 * clears opens in the cliffs (each grows from its lip as the chain reaches it); then the
 * fountains a clear stands along the fissure; then the short jets a lock throws up where it
 * strikes the lake.
 *
 * Nothing is created at event time: a dormant ribbon has no width.
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
    exp,
    float,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    FISSURE_Z, FOUNTAIN_SLOTS, STREAM_SLOTS, cdFxMaterial, cdHeatColor, cdPart, cdQuadGeometry,
} from './cinder-drift-tsl.js';

/** The ribbon is drawn this many times wider than the lava in it: the rest is its halo. */
const HALO = 3.4;
/** The longest a fountain takes to stand up (a short jet stands faster: a third of its life). */
export const FOUNTAIN_RISE = 0.22;
/** Jets a lock throws up from the lake. */
export const JET_SLOTS = 4;

const ROLE_FOUNTAIN = 100;

/**
 * @param {object} u     shared uniforms
 * @param {object} plan  the chamber's plan (the fall and the fissure streams)
 */
export function createFalls(u, plan) {
    const firstFountain = 1 + STREAM_SLOTS;
    const firstJet = firstFountain + FOUNTAIN_SLOTS;
    const count = firstJet + JET_SLOTS;
    const aA = new Float32Array(count * 4);
    const aB = new Float32Array(count * 4);
    const aT = new Float32Array(count * 4);
    const write = (i, from, to, width, kind, role, seed) => {
        aA.set([from[0], from[1], from[2], width], i * 4);
        aB.set([to[0] - from[0], to[1] - from[1], to[2] - from[2], kind], i * 4);
        aT.set([-100, -1, role, seed], i * 4);
    };
    write(0, plan.fall.lip, plan.fall.foot, plan.fall.width, 0, 0, 0.13);
    plan.streams.forEach((s, i) => write(1 + i, s.lip, s.foot, s.width, 0, 1 + i, 0.31 + i * 0.17));
    for (let i = firstFountain; i < count; i++) {
        write(i, [0, 0, -40], [0, 1, -40], 0, 1, ROLE_FOUNTAIN, 0.5 + i * 0.071);
        aT[i * 4 + 1] = 1;
    }
    const geometry = cdQuadGeometry(count, { aA: [aA, 4], aB: [aB, 4], aT: [aT, 4] }, 24);
    ['aA', 'aB', 'aT'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const A = attribute('aA', 'vec4');
    const B = attribute('aB', 'vec4');
    const T = attribute('aT', 'vec4');

    const material = cdFxMaterial('CinderFalls');
    const s = uv().y;
    const kind = B.w;
    const role = T.z;
    const isFall = float(1.0).sub(step(0.5, role));
    const isFountain = step(ROLE_FOUNTAIN - 0.5, role);
    const isStream = float(1.0).sub(isFall).sub(isFountain);
    // How hard this ribbon runs: the fall with the chamber, a stream once the chain reaches it,
    // a fountain between its birth and its end.
    const streamOn = clamp(u.fissures.sub(role.sub(1.0)), 0.0, 1.0);
    const age = u.time.sub(T.x);
    const stand = clamp(age.div(min(T.y.mul(0.3), FOUNTAIN_RISE)), 0.0, 1.0);
    const fountainOn = stand.mul(float(1.0).sub(smoothstep(T.y.mul(0.62), T.y, age))).mul(step(0.0, age));
    const run = isFall.mul(u.fallGain).add(isStream.mul(streamOn)).add(isFountain.mul(fountainOn));
    // A fountain is never still: its crown rides up and down.
    const surge = sin(u.time.mul(9.0).add(T.w.mul(40.0))).mul(0.07).add(sin(u.time.mul(4.3).add(T.w.mul(17.0))).mul(0.06));
    const tall = mix(float(1.0), surge.add(0.94), kind);
    // Lava leaving a lip accelerates away from it; a fountain slows to its crown.
    const sweep = mix(s.mul(s), s.mul(float(2.0).sub(s)), kind);
    const centre = A.xyz.add(vec3(B.x.mul(s), B.y.mul(sweep).mul(tall), B.z.mul(s)));
    // Lava runs down (or up): the ribbon turns about the vertical to face the camera.
    const side = normalize(cross(vec3(0.0, 1.0, 0.0), cameraPosition.sub(centre)));
    // A fall spreads as it drops; a fountain narrows into its crown.
    const flare = mix(s.mul(0.35).add(0.82), float(1.35).sub(s.mul(0.95)), kind);
    const widthNow = A.w.mul(flare).mul(mix(run.mul(0.5).add(0.5), fountainOn.mul(0.4).add(0.6), isFountain)).mul(step(1e-3, run));
    const world = centre.add(side.mul(positionGeometry.x.mul(widthNow).mul(HALO)));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

    const vRun = varying(vec4(run, kind, T.w, isStream.mul(streamOn).add(isFall).add(isFountain.mul(stand))), 'cdFallRun');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = st.x.sub(0.5).mul(HALO); // ±0.5 = the edges of the lava
        const along = st.y;
        const gain = vRun.x;
        const k = vRun.y;
        const seed = vRun.z;
        // Time since the lava left its source, so the texture stretches as the lava speeds up.
        const tFall = mix(sqrt(along), float(1.0).sub(sqrt(float(1.0).sub(along))), k);
        const rate = mix(float(0.62), float(1.3), k);
        // Skins of cooler lava drawn out into long streaks by its own speed.
        const flow = u.time.mul(rate);
        const n1 = u.noise(vec2(across.mul(0.62).add(seed), tFall.mul(0.36).sub(flow.mul(0.42)))).r;
        const n2 = u.noise(vec2(across.mul(1.7).add(n1.mul(0.3)).add(seed.mul(3.0)), tFall.mul(0.9).sub(flow.mul(1.05)))).level(2.0).g;
        // A stream grows from its lip; a fountain's crown dissolves into the drops it throws.
        const reach = float(1.0).sub(smoothstep(vRun.w.mul(1.15).sub(0.2), vRun.w.mul(1.15), along));
        const core = float(1.0).sub(abs(across).mul(2.0));
        const thin = mix(along.mul(0.08), along.mul(along).mul(0.9), k);
        const ragged = mix(float(0.5), float(1.5), k);
        const body = smoothstep(0.0, 0.26, core.add(n2.sub(0.5).mul(ragged)).sub(thin)).mul(reach);
        const temp = mix(float(0.74), float(0.98), k).add(max(core, 0.0).mul(0.46)).add(n1.sub(0.5).mul(0.95)).add(n2.sub(0.5).mul(0.42))
            .sub(mix(along.mul(0.16), along.mul(0.5), k))
            .mul(gain.mul(0.25).add(0.75));
        const lava = cdHeatColor(u, temp).mul(u.breath.mul(0.7).add(0.3));
        // Its own light in the air round it.
        const out = max(abs(across).sub(0.4), 0.0);
        const halo = exp(out.mul(-5.0)).mul(float(1.0).sub(smoothstep(1.0, HALO * 0.5, abs(across))))
            .mul(reach).mul(smoothstep(0.0, 0.05, along))
            .mul(float(1.0).sub(smoothstep(0.86, 1.0, along)));
        const glow = u.mid.mul(0.8).add(u.hot.mul(0.2)).mul(halo.mul(0.2).mul(gain)).mul(u.breath);
        return vec4(lava.mul(body).add(glow.mul(float(1.0).sub(body))), body);
    })();

    const part = cdPart('CinderFalls', geometry, material, 12);
    const stage = (i, {
        x, z, time, life, height, width,
    }) => {
        aA.set([x, -0.2, z, width], i * 4);
        aB.set([0, height, 0, 1], i * 4);
        aT[i * 4] = time;
        aT[i * 4 + 1] = life;
        geometry.getAttribute('aA').needsUpdate = true;
        geometry.getAttribute('aB').needsUpdate = true;
        geometry.getAttribute('aT').needsUpdate = true;
    };
    let fountainCursor = 0;
    let jetCursor = 0;
    /**
     * Stand a fountain on the lake at (x, z) from `time` for `life` seconds, `height` metres tall.
     * @returns {number} the slot used
     */
    part.fountain = (spec) => {
        const slot = fountainCursor % FOUNTAIN_SLOTS;
        fountainCursor += 1;
        stage(firstFountain + slot, spec);
        return slot;
    };
    /** The short jet a lock throws up where it strikes (its own slots: it never takes a fountain's). */
    part.jet = (spec) => {
        const slot = jetCursor % JET_SLOTS;
        jetCursor += 1;
        stage(firstJet + slot, spec);
        return slot;
    };
    part.reset = () => {
        for (let i = firstFountain; i < count; i++) aT[i * 4] = -100;
        geometry.getAttribute('aT').needsUpdate = true;
        fountainCursor = 0;
        jetCursor = 0;
    };
    part.count = count;
    return part;
}

/** How far the fissure runs either side of the board, and the tallest its wall of fire stands. */
export const FISSURE_HALF = 46;
export const WALL_HEIGHT = 11;

/**
 * The fissure itself: a low wall of fire along the crack a clear opens across the lake, out of
 * which the fountains stand. One upright sheet; `u.curtain` is how much of it is alight (a single
 * line lights a hem of flame, four lines a wall). Drawn only where there is fire.
 * @param {object} u
 */
export function createFissure(u) {
    const geometry = new THREE.BufferGeometry();
    const z = FISSURE_Z - 2.5;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -FISSURE_HALF, 0, z, FISSURE_HALF, 0, z, FISSURE_HALF, WALL_HEIGHT, z, -FISSURE_HALF, WALL_HEIGHT, z,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const material = cdFxMaterial('CinderFissure');
    // At rest the sheet has no area: nothing is shaded, and its pipeline is still compiled.
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix)
        .mul(vec4(positionGeometry.mul(step(0.004, u.curtain)), 1.0));
    material.colorNode = Fn(() => {
        const st = uv();
        const x = st.x.sub(0.5).mul(FISSURE_HALF * 2);
        const y = st.y.mul(WALL_HEIGHT);
        // Tongues of flame, each with its own height, climbing and tearing.
        const climb = u.time.mul(1.5);
        const tongues = u.noise(vec2(x.mul(0.045), climb.mul(0.05))).r;
        const lick = u.noise(vec2(x.mul(0.13).add(tongues), y.mul(0.07).sub(climb.mul(0.16)))).g;
        const tear = u.noise(vec2(x.mul(0.34), y.mul(0.2).sub(climb.mul(0.34)).add(lick.mul(0.4)))).b;
        const height = u.curtain.mul(tongues.mul(0.95).add(0.3)).mul(WALL_HEIGHT * 0.86).add(0.01);
        const up = y.div(height);
        const body = float(1.0).sub(smoothstep(0.35, 1.0, up.add(lick.sub(0.5).mul(0.9)).add(tear.sub(0.5).mul(0.6))));
        const ends = float(1.0).sub(smoothstep(0.78, 1.0, abs(st.x.sub(0.5)).mul(2.0)));
        const temp = float(1.35).sub(up.mul(0.75)).add(lick.sub(0.5).mul(0.7)).add(tear.sub(0.5).mul(0.4));
        const k = body.mul(ends).mul(smoothstep(0.0, 0.08, u.curtain)).mul(u.breath);
        return vec4(cdHeatColor(u, temp).mul(k).mul(0.8), k.mul(0.35));
    })();
    return cdPart('CinderFissure', geometry, material, 11);
}

/**
 * Vesper Chrysalis — the chrysalis, its halo and the silk it hangs by.
 *
 * The chrysalis is cut crystal: every facet mirrors the evening sky, the last light comes
 * through its right-hand edge, and whatever is inside shows as a slow pulse through the middle
 * of it. A chain of clears cracks it open from the shoulder down — the cracks run with the
 * light inside — and lights the points of gold on its shoulder one by one.
 *
 * It hangs from threads of silk: a fan of them rising out of the frame and four long ones made
 * fast to the crystal stands at the edges of the view. They are hairlines (their width is set
 * in pixels), strung with dew that catches the afterglow, and every lock sends a bead of the
 * piece's colour running down them to the chrysalis.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CHRYSALIS,
    HEART,
    SUN_DIR,
    THREAD_PULSES,
    TAU,
    chrysalisProfile,
    mulberry32,
    vcBell,
    vcFresnel,
    vcHash11,
    vcPart,
    vcSkyBase,
    vcSkyLight,
} from './vesper-chrysalis-tsl.js';

/** Where the silk is made fast to the chrysalis: the top of its stalk. */
export const STALK = Object.freeze([CHRYSALIS.x, CHRYSALIS.foot + CHRYSALIS.length, CHRYSALIS.z]);

/** Seconds a bead of light takes to run the length of a thread. */
export const PULSE_TRAVEL = 0.75;

const SUN_FLAT = (() => {
    const l = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    return [SUN_DIR[0] / l, 0, SUN_DIR[2] / l];
})();

/**
 * The chrysalis as a faceted solid: rings of a lathe, every other ring turned half a facet so
 * the faces are kites, each vertex nudged so no two facets catch the light alike.
 * `uv` = (angle round it 0..1, height 0..1).
 */
export function buildChrysalisGeometry(seed = 5519) {
    const rand = mulberry32(seed);
    const around = 9;
    const rings = 13;
    const pos = [];
    const uvs = [];
    const at = [];
    for (let j = 0; j <= rings; j++) {
        const t = j / rings;
        const row = [];
        const r0 = chrysalisProfile(t);
        for (let i = 0; i < around; i++) {
            const turn = (i + (j % 2) * 0.5) / around;
            const ang = turn * TAU;
            // The wing cases: two long swellings down the front that meet at the foot.
            const front = Math.cos(ang - Math.PI / 2);
            const cases = Math.max(0, front) ** 2 * Math.abs(Math.sin(ang - Math.PI / 2)) ** 0.6
                * Math.max(0, 1 - Math.abs(t - 0.36) / 0.4) * 0.34;
            const nudge = j === 0 || j === rings ? 0 : (rand() - 0.5) * 0.07;
            const r = r0 * (1 + cases + nudge);
            row.push(pos.length / 3);
            // A little flattened front to back.
            pos.push(
                CHRYSALIS.x + Math.cos(ang) * r,
                CHRYSALIS.foot + t * CHRYSALIS.length,
                CHRYSALIS.z + Math.sin(ang) * r * 0.86,
            );
            uvs.push(turn, t);
        }
        at.push(row);
    }
    const index = [];
    for (let j = 0; j < rings; j++) {
        for (let i = 0; i < around; i++) {
            const i1 = (i + 1) % around;
            const a = at[j][i];
            const b = at[j][i1];
            const c = at[j + 1][i];
            const d = at[j + 1][i1];
            // Outward winding (counter-clockwise seen from outside); the half-turn decides the diagonal.
            if (j % 2 === 0) index.push(a, c, b, b, c, d);
            else index.push(a, d, b, a, c, d);
        }
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    indexed.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    indexed.setIndex(index);
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * @param {object} u  shared uniforms
 */
export function createChrysalis(u) {
    const geometry = buildChrysalisGeometry();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisShell';
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const N = normalize(normalWorld).toVar();
        const V = normalize(cameraPosition.sub(positionWorld)).toVar();
        const ndv = clamp(dot(N, V), 0.0, 1.0).toVar();
        const st = uv().toVar();
        const t = st.y;

        // ── Cut crystal: each facet mirrors the sky (the lake mirrors it back from below) ──
        const R = reflect(V.negate(), N);
        const env = vcSkyBase(u, normalize(vec3(R.x, abs(R.y).add(0.02), R.z)));
        const fres = vcFresnel(ndv, 0.16).mul(1.5);
        const body = u.shell.mul(vcSkyLight(u, N).mul(0.9).add(0.02));
        // The last light comes through the edge that faces where the sun set.
        const edge = float(1.0).sub(ndv);
        const facing = clamp(dot(N, vec3(SUN_FLAT[0], 0.0, SUN_FLAT[2])), 0.0, 1.0);
        const through = u.glow.mul(facing).mul(edge.mul(edge)).mul(0.5)
            .add(u.shell.mul(edge.mul(edge).mul(edge)).mul(0.5));

        // ── What is inside: a slow pulse seen through the middle of it ──
        const beat = sin(u.time.mul(u.power.mul(1.6).add(1.15))).mul(0.5).add(0.5);
        const pulse = beat.mul(beat).mul(0.45).add(0.55);
        const grain = u.noise(vec2(st.x.mul(2.0).add(V.x.mul(0.2)), t.mul(1.3).sub(u.drift.mul(0.012)))).toVar();
        const depth = ndv.mul(ndv);
        const heartAt = vcBell(t.sub(0.56).div(0.62));
        const fedTint = mix(u.core, u.fed.rgb, u.fed.w.mul(0.75));
        const inner = fedTint.mul(u.wake).mul(depth.mul(1.1).add(0.08)).mul(grain.r.mul(0.9).add(0.35))
            .mul(heartAt.mul(0.9).add(0.1))
            .mul(pulse)
            .mul(3.2);

        // ── The cracks: they open at the shoulder and run down as the chain grows ──
        const net = u.noise(vec2(st.x.mul(3.0), t.mul(2.2).add(0.37))).toVar();
        const lineA = vcBell(net.g.sub(0.5).div(0.035));
        const lineB = vcBell(net.b.sub(0.47).div(0.028));
        const fromShoulder = abs(t.sub(CHRYSALIS.shoulder)).add(net.a.mul(0.12));
        const reach = float(1.0).sub(smoothstep(u.crack.mul(0.95), u.crack.mul(0.95).add(0.12), fromShoulder));
        const cracks = max(lineA, lineB.mul(0.8)).mul(reach).mul(step(0.01, u.crack));
        const molten = mix(u.core, vec3(1.0, 0.92, 0.75), 0.35).mul(cracks).mul(pulse.mul(0.6).add(0.7))
            .mul(u.power.mul(4.0).add(3.0));

        // ── The diadem: points of gold round the shoulder, one lit for every step of the chain ──
        const cell = st.x.mul(CHRYSALIS.diadem);
        const which = floor(cell);
        const dq = vec2(fract(cell).sub(0.5).mul(1.35), t.sub(CHRYSALIS.shoulder).div(0.022));
        const dotShape = float(1.0).sub(smoothstep(0.32, 0.5, length(dq)));
        const litDot = step(which.add(0.5), u.combo).mul(0.94).add(0.06);
        const twinkle = sin(u.time.mul(2.3).add(which.mul(1.7))).mul(0.2).add(0.8);
        const gold = vec3(1.0, 0.78, 0.36).mul(dotShape).mul(litDot).mul(twinkle)
            .mul(5.5);

        const light = inner.add(molten).add(gold).mul(u.breath);
        return vec4(body.add(env.mul(fres)).add(through).add(light), 1.0);
    })();

    const shell = new THREE.Mesh(geometry, material);
    shell.name = 'VesperChrysalisShellMesh';
    shell.frustumCulled = false;
    shell.renderOrder = 10;

    // ── The halo: the light it stands in ──
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.MeshBasicNodeMaterial();
    haloMat.name = 'VesperChrysalisHalo';
    haloMat.transparent = true;
    haloMat.blending = THREE.AdditiveBlending;
    haloMat.premultipliedAlpha = true;
    haloMat.depthWrite = false;
    haloMat.fog = false;
    haloMat.toneMapped = false;
    haloMat.side = THREE.DoubleSide;
    const haloLight = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d = length(q);
        const ang = atan(q.y, q.x);
        // Faint spokes that turn slowly, as light does through a crack.
        const spokes = u.noise(vec2(ang.div(TAU).mul(3.0).add(u.drift.mul(0.004)), d.mul(0.15).add(0.5))).r;
        const soft = exp(d.mul(-5.0)).mul(0.32).add(exp(d.mul(-13.0)).mul(0.8));
        const rays = exp(d.mul(-2.4)).mul(smoothstep(0.42, 0.8, spokes)).mul(u.power.mul(0.9).add(u.surge).add(0.12));
        const fade = float(1.0).sub(smoothstep(0.7, 1.0, d));
        const tint = mix(u.core, u.fed.rgb, u.fed.w.mul(0.7));
        const beat = sin(u.time.mul(u.power.mul(1.6).add(1.15))).mul(0.5).add(0.5);
        return tint.mul(soft.add(rays.mul(0.6))).mul(fade).mul(u.wake.mul(1.5).add(u.fed.w.mul(0.5)).add(0.03))
            .mul(beat.mul(0.2).add(0.9))
            .mul(u.breath);
    });
    haloMat.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    haloMat.outputNode = vec4(haloLight(), 0.0);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.name = 'VesperChrysalisHaloMesh';
    halo.position.set(HEART[0], HEART[1], HEART[2] - 2.5);
    halo.scale.set(64, 64, 1);
    halo.frustumCulled = false;
    halo.renderOrder = 60;

    const group = new THREE.Group();
    group.add(shell, halo);
    const part = vcPart('VesperChrysalisRelic', geometry, material, 10, { mesh: group });
    part.dispose = () => {
        haloGeo.dispose();
        haloMat.dispose();
    };
    return part;
}

/**
 * The threads' plan: the fan that rises out of the frame, then the long ones to the stands.
 * @param {number} count          threads in all
 * @param {number[][]} anchors    where the long ones are made fast: [x, y, z, side]
 * @returns {{ a: number[], b: number[], sag: number, side: number, long: boolean, seed: number }[]}
 */
export function planThreads(count, anchors, seed = 811) {
    const rand = mulberry32(seed);
    const out = [];
    anchors.forEach((p) => {
        out.push({
            a: [...STALK], b: [p[0], p[1], p[2]], sag: 5.5 + rand() * 2.5, side: p[3], long: true, seed: rand(),
        });
    });
    const fan = Math.max(0, count - anchors.length);
    for (let i = 0; i < fan; i++) {
        const f = fan > 1 ? i / (fan - 1) : 0.5;
        const lean = (f - 0.5) * 2;
        out.push({
            a: [...STALK],
            b: [
                STALK[0] + lean * 46 + (rand() - 0.5) * 6,
                STALK[1] + 62 + rand() * 16,
                STALK[2] - 6 + (rand() - 0.5) * 22,
            ],
            sag: 0.6 + rand() * 1.4,
            side: Math.sign(lean) || 1,
            long: false,
            seed: rand(),
        });
    }
    return out;
}

/** A point of a thread at fraction `s` (0 = at the chrysalis, 1 = where it is made fast). */
export function threadPoint(thread, s, out = [0, 0, 0]) {
    const droop = thread.sag * 4 * s * (1 - s);
    out[0] = thread.a[0] + (thread.b[0] - thread.a[0]) * s;
    out[1] = thread.a[1] + (thread.b[1] - thread.a[1]) * s - droop;
    out[2] = thread.a[2] + (thread.b[2] - thread.a[2]) * s;
    return out;
}

/**
 * @param {object} u
 * @param {ReturnType<typeof planThreads>} threads
 */
export function createThreads(u, threads) {
    const seg = 28;
    const perThread = (seg + 1) * 2;
    const n = threads.length;
    const position = new Float32Array(n * perThread * 3);
    const tangent = new Float32Array(n * perThread * 3);
    const info = new Float32Array(n * perThread * 4); // (s, across −1|+1, side, seed)
    const index = [];
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    threads.forEach((thread, k) => {
        for (let i = 0; i <= seg; i++) {
            const s = i / seg;
            threadPoint(thread, s, p);
            threadPoint(thread, Math.min(1, s + 1 / seg), q);
            if (i === seg) {
                threadPoint(thread, s - 1 / seg, q);
                for (let c = 0; c < 3; c++) q[c] = p[c] * 2 - q[c];
            }
            for (let e = 0; e < 2; e++) {
                const v = k * perThread + i * 2 + e;
                position.set(p, v * 3);
                tangent.set([q[0] - p[0], q[1] - p[1], q[2] - p[2]], v * 3);
                const kind = thread.long ? 2 : 0;
                info.set([s, e === 0 ? -1 : 1, thread.long ? thread.side : 0, thread.seed + kind], v * 4);
            }
            if (i < seg) {
                const b0 = k * perThread + i * 2;
                index.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangent, 3));
    geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, -70), 400);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisThreads';
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;

    const aInfo = attribute('aInfo', 'vec4');
    const vInfo = varying(aInfo, 'vThread');
    const vAcross = varying(aInfo.y, 'vThreadAcross');

    material.vertexNode = Fn(() => {
        const s = aInfo.x;
        // The silk stirs: most in the middle of a span, not at all where it is made fast.
        const slack = s.mul(float(1.0).sub(s)).mul(4.0);
        const stir = sin(u.drift.mul(0.7).add(aInfo.w.mul(40.0)).add(s.mul(5.0))).mul(slack).mul(0.35);
        const base = attribute('position', 'vec3').add(vec3(stir, stir.mul(0.3), 0.0));
        const viewProj = cameraProjectionMatrix.mul(cameraViewMatrix);
        const c0 = viewProj.mul(vec4(base, 1.0)).toVar();
        const c1 = viewProj.mul(vec4(base.add(attribute('aTangent', 'vec3')), 1.0));
        const s0 = c0.xy.div(max(c0.w, 1e-4));
        const s1 = c1.xy.div(max(c1.w, 1e-4));
        const along = normalize(s1.sub(s0).mul(u.viewport).add(vec2(1e-5, 0.0)));
        const side = vec2(along.y.negate(), along.x);
        // 1.7 px wide, whatever its distance.
        const px = float(1.7);
        const off = side.mul(aInfo.y).mul(px).div(u.viewport).mul(c0.w);
        return vec4(c0.xy.add(off), c0.z, c0.w);
    })();

    const light = Fn(() => {
        const s = vInfo.x;
        const long = step(1.5, vInfo.w);
        const seed = fract(vInfo.w);
        const profile = float(1.0).sub(abs(vAcross));
        // Silk: next to nothing, except where it catches the evening.
        const sheen = sin(s.mul(31.0).add(seed.mul(60.0)).add(u.drift.mul(0.35))).mul(0.5).add(0.5);
        const silk = u.horizon.mul(0.05).add(u.glow.mul(sheen.mul(sheen).mul(sheen)).mul(0.1))
            .mul(long.mul(0.6).add(0.7));
        // Dew: beads strung along it.
        const count = mix(float(46.0), float(120.0), long);
        const at = s.mul(count);
        const bead = vcBell(fract(at).sub(0.5).div(0.2)).mul(step(0.5, vcHash11(floor(at).add(seed.mul(977.0)))));
        const wink = sin(u.time.mul(1.4).add(floor(at).mul(2.1))).mul(0.35).add(0.65);
        const dew = mix(u.glow, vec3(1.0, 0.95, 0.9), 0.5).mul(bead.mul(wink)).mul(0.55);
        // A bead of the piece's colour runs down to the chrysalis and wakes the dew as it passes.
        const run = vec3(0.0).toVar();
        for (let i = 0; i < THREAD_PULSES; i++) {
            const A = u.pulseA[i];
            const age = u.time.sub(A.x);
            const head = float(1.0).sub(age.div(PULSE_TRAVEL));
            const mine = float(1.0).sub(step(0.5, abs(A.y.sub(vInfo.z)).mul(abs(A.y))));
            const live = step(0.0, age).mul(step(age, PULSE_TRAVEL * 1.6)).mul(mine).mul(A.z);
            const x = s.sub(head);
            const body = vcBell(x.div(0.035)).add(vcBell(x.sub(0.09).div(0.12)).mul(0.3));
            const lit = body.add(bead.mul(vcBell(x.div(0.2))).mul(1.2));
            run.addAssign(u.pulseC[i].mul(lit).mul(live).mul(long.mul(4.6).add(2.4)));
        }
        const near = float(1.0).sub(smoothstep(0.86, 1.0, s).mul(float(1.0).sub(long)));
        return silk.add(dew).add(run.mul(u.pulsesLive)).mul(profile).mul(near)
            .mul(u.breath);
    });
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.outputNode = vec4(light(), 0.0);

    const part = vcPart('VesperChrysalisThreads', geometry, material, 62);
    part.count = n;
    return part;
}

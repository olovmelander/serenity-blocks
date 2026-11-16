/**
 * Vesper Chrysalis — what lives round the chrysalis: the moths and butterflies of light.
 *
 * Small luminous wings keep the chrysalis company. Each is two hinged wings that really beat
 * (they are placed in the world, so they foreshorten as they turn and wink as they flap), on a
 * path that is a function of the clock: they circle the chrysalis at their own distances and
 * heights, now and then one settles on the stone and fans its wings slowly, then lifts off again.
 * How many are about is the evening's business (u.flutter.x: more by night, and one for every
 * step of a chain), and a chain draws them in close (u.flutter.y).
 *
 * A second flight is the burst: at the great moments a cloud of them leaves the chrysalis all at
 * once (u.burst), spirals out and up over the lake, and thins away.
 *
 * Nothing is created at event time: every wing is always drawn, a dormant one as a degenerate
 * quad, and any moment can be replayed.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CHRYSALIS,
    TAU,
    mulberry32,
    vcBell,
    vcPart,
} from './vesper-chrysalis-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

/** Seconds a wing of the burst lives. */
export const BURST_LIFE = 9;
/** Seconds over which the burst leaves the chrysalis. */
export const BURST_STAGGER = 1.3;

/** Two wings hinged on a body: x runs −1..1 across them (0 = the body), y −½..½ along it. */
function buildWingPair() {
    const cols = [-1, -0.5, 0, 0.5, 1];
    const rows = [-0.5, 0, 0.5];
    const pos = [];
    const index = [];
    rows.forEach((y) => cols.forEach((x) => pos.push(x, y, 0)));
    for (let j = 0; j < rows.length - 1; j++) {
        for (let i = 0; i < cols.length - 1; i++) {
            const a = j * cols.length + i;
            index.push(a, a + 1, a + cols.length, a + 1, a + cols.length + 1, a + cols.length);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    return g;
}

/**
 * @param {object} u
 * @param {object} [opts]
 * @param {number} [opts.ambient=14]  wings that keep the chrysalis company
 * @param {number} [opts.burst=60]    wings of the burst
 */
export function createFlutter(u, opts = {}) {
    const ambient = Math.max(0, Math.round(opts.ambient ?? 14));
    const burst = Math.max(0, Math.round(opts.burst ?? 60));
    const n = Math.max(1, ambient + burst);
    const geometry = buildWingPair();
    const data = new Float32Array(n * 4); // (seed, second seed, flight 0 = company | 1 = burst, wingspan in metres)
    const rand = mulberry32(4411);
    for (let i = 0; i < n; i++) {
        const isBurst = i >= ambient;
        data.set([rand(), rand(), isBurst ? 1 : 0, isBurst ? 0.9 + rand() * 0.8 : 1.15 + rand() * 0.95], i * 4);
    }
    geometry.setAttribute('aFlutter', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.count = ambient + burst;
    mesh.frustumCulled = false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisFlutter';
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    const aF = attribute('aFlutter', 'vec4');
    const vAt = varying(vec2(positionGeometry.x, positionGeometry.y), 'vFlutterAt');
    const vSeed = flatVarying(vec3(aF.x, aF.y, aF.z), 'vFlutterSeed');
    const vLive = varying(float(0.0), 'vFlutterLive');
    const toWorld = (d) => u.relicX.mul(d.x).add(u.relicY.mul(d.y)).add(u.relicZ.mul(d.z));
    const R = CHRYSALIS.radius;
    const L = CHRYSALIS.length;

    material.vertexNode = Fn(() => {
        const s = aF.x.toVar();
        const s2 = aF.y.toVar();
        const isBurst = step(0.5, aF.z).toVar();
        const heart = u.relicHeart;

        // ── Keeping company: a path round the chrysalis, and now and then a rest on the stone ──
        const gather = u.flutter.y;
        const company = (clock) => {
            const tt = clock.mul(s2.mul(0.5).add(0.75)).add(s.mul(100.0));
            const way = step(0.5, fract(s.mul(11.0))).mul(2.0).sub(1.0);
            const ang = tt.mul(s.mul(0.16).add(0.2)).mul(way).add(s.mul(TAU)).add(sin(tt.mul(0.31).add(s.mul(9.0))).mul(0.8));
            const far = fract(s.mul(7.3)).mul(7.5).add(4.2).mul(float(1.0).sub(gather.mul(0.45)))
                .mul(sin(tt.mul(0.21).add(s.mul(5.0))).mul(0.3).add(1.0));
            const high = fract(s.mul(3.7)).sub(0.5).mul(13.0).add(sin(tt.mul(0.17).add(s.mul(11.0))).mul(2.2))
                .add(sin(tt.mul(2.3).add(s.mul(20.0))).mul(0.4));
            return heart.add(vec3(cos(ang).mul(far), high, sin(ang).mul(far).mul(0.7)));
        };
        const clock = u.drift;
        const a0 = company(clock).toVar();
        const a1 = company(clock.add(0.06)).toVar();
        // Some settle on the stone for a while, then lift off again.
        const cycle = fract(clock.mul(0.031).add(s2));
        const settles = step(fract(s.mul(5.1)), 0.4);
        const resting = smoothstep(0.52, 0.64, cycle).mul(float(1.0).sub(smoothstep(0.88, 0.97, cycle))).mul(settles).toVar();
        const turn = s.mul(TAU * 3.0);
        const seat = u.relicAt.add(toWorld(vec3(
            cos(turn).mul(R * 0.86),
            fract(s.mul(13.0)).mul(0.42).add(0.22).mul(-L),
            sin(turn).mul(R * 0.76),
        ))).toVar();
        const pAmbient = mix(a0, seat, resting).toVar();
        const headAmbient = normalize(mix(a1.sub(a0), u.relicY.add(vec3(0.0, 0.0, 0.2)), resting).add(vec3(1e-4, 0.0, 0.0))).toVar();
        // How many are about: the share of them the evening asks for.
        const shown = smoothstep(0.0, 0.07, u.flutter.x.sub(fract(s.mul(97.0)).mul(0.93)));

        // ── The burst: all at once out of the chrysalis, spiralling out and up, thinning away ──
        const age = u.time.sub(u.burst.x).sub(s.mul(BURST_STAGGER)).toVar();
        const life = s2.mul(3.0).add(BURST_LIFE - 3);
        const out = normalize(vec3(cos(s2.mul(TAU)), fract(s.mul(31.0)).mul(1.1).sub(0.25), sin(s2.mul(TAU)).mul(0.8)));
        const reach = float(1.0).sub(exp(max(age, 0.0).mul(-0.55))).mul(fract(s.mul(17.0)).mul(26.0).add(16.0));
        const swirl = max(age, 0.0).mul(0.42).add(s.mul(3.0));
        const flown = vec3(
            out.x.mul(cos(swirl)).sub(out.z.mul(sin(swirl))),
            out.y,
            out.x.mul(sin(swirl)).add(out.z.mul(cos(swirl))),
        );
        const bob = sin(u.time.mul(2.6).add(s.mul(40.0))).mul(0.5);
        const pBurst = heart.add(flown.mul(reach)).add(vec3(0.0, max(age, 0.0).mul(0.9).add(bob), 0.0)).toVar();
        const headBurst = normalize(vec3(flown.z.negate(), 0.35, flown.x).mul(0.6).add(flown).add(vec3(1e-4, 0.0, 0.0)));
        const alive = step(0.0, age).mul(step(age, life)).mul(smoothstep(0.0, 0.25, age))
            .mul(float(1.0).sub(smoothstep(life.sub(2.2), life, age)))
            .mul(u.burst.y);

        const centre = mix(pAmbient, pBurst, isBurst).toVar();
        const head = normalize(mix(headAmbient, headBurst, isBurst)).toVar();
        const live = mix(shown, alive, isBurst).toVar();
        vLive.assign(live);

        // ── Two wings hinged on the body, beating ──
        const side = normalize(cross(head, vec3(0.0, 1.0, 0.0)).add(vec3(1e-4, 0.0, 1e-4))).toVar();
        const lift = normalize(cross(side, head)).toVar();
        const quick = mix(float(8.0), float(15.0), fract(s.mul(1.7)));
        // A butterfly's stroke: a snap down, a slower lift, and a glide now and then.
        const stroke = sin(u.time.mul(quick).add(s.mul(40.0)));
        const gliding = smoothstep(0.75, 0.95, sin(u.time.mul(0.7).add(s.mul(23.0))));
        const flap = mix(stroke.mul(0.95).add(0.3), float(0.42), gliding);
        const fanning = sin(u.time.mul(1.1).add(s.mul(9.0))).mul(0.5).add(0.55);
        const angle = mix(flap, fanning, resting.mul(float(1.0).sub(isBurst))).toVar();
        const span = aF.w.mul(0.5);
        const reachOut = positionGeometry.x.abs().mul(span);
        const across = positionGeometry.x.sign().mul(reachOut).mul(cos(angle));
        const up = reachOut.mul(sin(angle));
        const along = positionGeometry.y.mul(aF.w).mul(0.78);
        const p = centre.add(side.mul(across)).add(lift.mul(up)).add(head.mul(along));
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(mix(centre, p, live), 1.0));
    })();

    material.outputNode = Fn(() => {
        const x = vAt.x.abs().toVar();
        const y = vAt.y.toVar();
        const s = vSeed.x;
        // A forewing swept forward and a rounder hindwing behind it.
        const fore = vec2(x.sub(0.5).div(0.52), y.sub(0.13).sub(x.mul(0.16)).div(0.3));
        const hind = vec2(x.sub(0.36).div(0.4), y.add(0.2).div(0.27));
        const dFore = length(fore);
        const dHind = length(hind);
        const shape = max(float(1.0).sub(smoothstep(0.86, 1.0, dFore)), float(1.0).sub(smoothstep(0.86, 1.0, dHind))).toVar();
        const nearest = clamp(float(1.0).sub(max(float(1.0).sub(dFore), float(1.0).sub(dHind))), 0.0, 1.0);
        // Veins fan out from the body; the margin is dark with a row of lights along it.
        const veinAt = y.div(max(x, 0.05));
        const veins = vcBell(fract(veinAt.mul(2.4).add(0.5)).sub(0.5).div(0.16)).mul(smoothstep(0.08, 0.3, x));
        const margin = smoothstep(0.7, 0.92, nearest);
        const dots = vcBell(fract(veinAt.mul(2.4)).sub(0.5).div(0.3)).mul(vcBell(nearest.sub(0.86).div(0.07)));
        const body = exp(x.mul(-26.0)).mul(float(1.0).sub(smoothstep(0.3, 0.5, y.abs())));
        // Each of its own colour, from the wings' palette of this hour.
        const pick = fract(s.mul(13.0));
        const tint = mix(mix(u.wingRoot, u.wingMid, smoothstep(0.0, 0.5, pick)), u.wingEdge, smoothstep(0.5, 1.0, pick)).toVar();
        const inner = float(1.0).sub(nearest).mul(0.9).add(0.25);
        const light = tint.mul(inner.mul(float(1.0).sub(margin.mul(0.75))).add(veins.mul(0.5)))
            .add(mix(tint, vec3(1.0, 0.96, 0.9), 0.7).mul(dots.mul(2.2).add(body.mul(1.6))))
            .mul(shape)
            .mul(vLive)
            .mul(u.power.mul(0.6).add(1.5));
        return vec4(light.mul(u.breath), shape.mul(vLive).mul(margin.mul(0.35).add(0.35)));
    })();
    mesh.material = material;

    const part = vcPart('VesperChrysalisFlutter', geometry, material, 69, { mesh });
    part.count = mesh.count;
    part.ambient = ambient;
    part.burst = burst;
    return part;
}

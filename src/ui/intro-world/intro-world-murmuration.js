/**
 * First Light — the murmuration: one great flock of light round the title.
 *
 * A long plume of motes whose head flies a slow loop round the wordmark and whose body follows
 * it, so the flock sweeps across the whole frame in arcs, swinging nearer and further as it
 * goes. Across its body it is a broad, thin ribbon that banks: a wave of turning rolls from its
 * head to its tail, and wherever the ribbon turns edge on its motes crowd along the line of sight
 * and the band blazes, as a murmuration's does. It bulges and thins along its length, splits into
 * two streams on the out-breath and closes again, and on the breath that gathers it the whole
 * flock pours, head first, into a ring of light round the title, holds it, and unravels.
 *
 * Every quantity is a closed form of time (intro-world-core.js `murmurationAt`), and every mote
 * is placed in the vertex stage from a static seed: no compute, no state, so a seek lands where
 * playing would. Motes are a few pixels wide at any distance, additive and premultiplied, with a
 * light budget so the flock keeps its brightness whatever the tier's count. They fade where the
 * title and the menu's navigation stand (screen rects, y down).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    exp,
    float,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sign,
    sin,
    smoothstep,
    uniform,
    uniformArray,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU, buildMurmurationSeeds } from './intro-world-core.js';

/** vec4 rows the world writes each frame (see `write`). */
export const MURMURATION_ROWS = 7;
/** Screen rects (x0, y0, x1, y1; screen fractions, y down) the motes keep out of. */
export const AVOID_SLOTS = 6;

/**
 * @param {object} u shared uniforms: time
 * @param {{ count?: number }} [options] count = motes
 */
export function createMurmuration(u, { count = 100000 } = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(buildMurmurationSeeds(count), 4));
    geometry.instanceCount = count;

    const rows = Array.from({ length: MURMURATION_ROWS }, () => new THREE.Vector4());
    const R = uniformArray(rows, 'vec4');
    const avoid = Array.from({ length: AVOID_SLOTS }, () => new THREE.Vector4(2, 2, 2, 2));
    const avoidNode = uniformArray(avoid, 'vec4');
    const avoidCount = uniform(0, 'int');
    const viewHeight = uniform(1080);
    const aspect = uniform(16 / 9);
    const gain = uniform(1);

    const seed = attribute('aSeed', 'vec4');
    const vLight = varyingProperty('vec3', 'flMurmurLight');

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
    });
    material.name = 'FirstLightMurmuration';
    material.fog = false;

    material.vertexNode = Fn(() => {
        const r0 = R.element(int(0)).toVar(); // centre xyz, gather
        const r1 = R.element(int(1)).toVar(); // loop radii x, y, depth swing; head angle
        const r2 = R.element(int(2)).toVar(); // span, width, thickness, split
        const r3 = R.element(int(3)).toVar(); // bank: waves along, phase, amplitude, base
        const r4 = R.element(int(4)).toVar(); // wobble phase, bulge phase, light, swirl
        const r5 = R.element(int(5)).toVar(); // the ring: centre x, y; radii x, y
        const r6 = R.element(int(6)).toVar(); // touch pulse: age, origin, strength; ring tube
        const sr = seed.w.toVar();
        const a = seed.y.toVar();
        const rho = seed.z.toVar();

        // ── Along the flock: a density wave squeezes it, the ends taper ──
        const sRaw = seed.x.add(sin(seed.x.mul(TAU * 7).sub(r4.y.mul(2.2))).mul(0.016)).toVar();
        const s = clamp(sRaw, 0.0, 1.0).toVar();
        const phi = r1.w.sub(s.mul(r2.x)).toVar();
        const wob = float(1.0).add(sin(phi.mul(3.0).add(r4.x)).mul(0.1))
            .add(sin(phi.mul(5.0).sub(r4.x.mul(1.7))).mul(0.05))
            .toVar();
        const swing = phi.add(r4.x.mul(0.6)).toVar();
        const C = r0.xyz.add(vec3(
            r1.x.mul(wob).mul(cos(phi)),
            r1.y.mul(wob).mul(sin(phi)),
            r1.z.mul(sin(swing)),
        )).toVar();
        const T = normalize(vec3(r1.x.mul(sin(phi)).negate(), r1.y.mul(cos(phi)), r1.z.mul(cos(swing)))).toVar();
        const N = normalize(vec3(T.y, T.x.negate(), 0.0001)).toVar();
        const Bv = cross(T, N).toVar();

        // ── Across it: a broad thin ribbon that banks, a wave of turning running down it ──
        const bankPhase = s.mul(r3.x).mul(TAU).sub(r3.y).toVar();
        const beta = r3.w.add(sin(bankPhase).mul(r3.z)).toVar();
        const Wd = N.mul(cos(beta)).add(Bv.mul(sin(beta))).toVar();
        const Td = Bv.mul(cos(beta)).sub(N.mul(sin(beta))).toVar();
        const taper = pow(max(sin(s.mul(Math.PI)), 0.0), float(0.55));
        const W = r2.y.mul(taper).mul(sin(s.mul(9.0).sub(r4.y)).mul(0.25).add(1.0)).toVar();
        // On the out-breath it splits into two streams (each mote keeps to its side).
        const lobe = sign(cos(a));
        const split = r2.w.toVar();
        const xc = rho.mul(cos(a)).mul(float(1.0).sub(split.mul(0.45))).add(lobe.mul(split).mul(0.55)).mul(W);
        const yc = rho.mul(sin(a)).mul(W).mul(r2.z);

        // ── A touch: a pulse of light runs both ways along the flock from where it was touched ──
        const age = r6.x.toVar();
        const off = abs(s.sub(r6.y)).sub(age.mul(0.45)).mul(14.0).toVar();
        const pulse = exp(off.mul(off).negate()).mul(exp(age.mul(-0.9))).mul(r6.z)
            .mul(select(age.greaterThanEqual(0.0), float(1.0), float(0.0)))
            .toVar();
        const body = C.add(Wd.mul(xc.mul(pulse.mul(0.25).add(1.0)))).add(Td.mul(yc)).toVar();

        // ── The gathering: the flock pours into a ring round the title, head first ──
        const g = smoothstep(s.mul(0.5), s.mul(0.5).add(0.5), r0.w).toVar();
        // (Round the ring the wave wraps instead of piling up at the flock's two ends.)
        const theta = fract(sRaw).mul(TAU).add(r4.w).toVar();
        // A living ring: its outline ripples and its body is thick with motes, not a drawn line.
        const ripple = float(1.0).add(sin(theta.mul(3.0).add(r4.w.mul(2.0))).mul(0.045))
            .add(sin(theta.mul(7.0).sub(r4.w.mul(3.1))).mul(0.025))
            .toVar();
        const tube = r6.w.mul(rho.mul(0.75).add(0.25)).mul(sin(theta.mul(5.0).add(r4.x)).mul(0.35).add(1.0)).toVar();
        const ringP = vec3(
            r5.x.add(r5.z.mul(ripple).add(tube.mul(cos(a))).mul(cos(theta))),
            r5.y.add(r5.w.mul(ripple).add(tube.mul(cos(a))).mul(sin(theta))),
            r0.z.add(tube.mul(sin(a))),
        );
        const world = mix(body, ringP, g).toVar();

        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        const w = max(clip.w, 1e-4);
        const sx = clip.x.div(w).mul(0.5).add(0.5);
        const sy = float(0.5).sub(clip.y.div(w).mul(0.5));
        const presence = float(1.0).toVar();
        Loop({
            start: int(0), end: avoidCount, type: 'int', condition: '<', name: 'zone',
        }, ({ zone }) => {
            const box = avoidNode.element(zone);
            const dx = max(max(box.x.sub(sx), sx.sub(box.z)), 0.0);
            const dy = max(max(box.y.sub(sy), sy.sub(box.w)), 0.0);
            presence.assign(min(presence, smoothstep(0.0, 0.08, length(vec2(dx, dy)))));
        });

        // ── Light: the banking bands, the pulse, the ends fading, a twinkle of its own ──
        // (In the ring the bands soften into beads, a whole number of them round it.)
        const beads = cos(theta.sub(r4.w).mul(3.0).sub(r3.y));
        const band = mix(cos(bankPhase).mul(0.5), beads.mul(0.2), g).add(1.0);
        const ends = smoothstep(0.0, 0.07, s).mul(float(1.0).sub(smoothstep(0.9, 1.0, s)));
        const twinkle = sin(u.time.mul(fract(sr.mul(7.3)).mul(2.2).add(0.7)).add(sr.mul(91.0))).mul(0.22).add(0.86);
        const lit = r4.z.mul(band).mul(twinkle).mul(pulse.mul(2.6).add(1.0)).mul(g.mul(0.3).add(1.0))
            .mul(mix(ends, float(1.0), g))
            .mul(presence)
            .mul(gain);
        // The logo's spectrum along the flock: lavender at its head, aqua through its body, mint
        // at its tail, with cream in its brightest motes and in the ring.
        const lavender = vec3(0.47, 0.37, 1.0);
        const aqua = vec3(0.34, 0.81, 0.85);
        const mint = vec3(0.56, 0.88, 0.62);
        // Gathered, the colour runs round the ring and meets itself (head and tail are neighbours).
        const hueAt = mix(s, float(0.5).sub(cos(s.mul(TAU)).mul(0.5)), g);
        const along = mix(mix(lavender, aqua, smoothstep(0.0, 0.5, hueAt)), mint, smoothstep(0.5, 1.0, hueAt));
        const tint = mix(along, vec3(1.0, 0.92, 0.82), clamp(fract(sr.mul(5.3)).mul(0.3).add(g.mul(0.12)), 0.0, 1.0));
        vLight.assign(tint.mul(lit));

        const scale = viewHeight.div(1080.0);
        const px = float(1.9).add(sr.mul(sr).mul(sr).mul(1.4)).mul(max(scale, 0.6));
        const size = px.div(viewHeight).mul(2.0);
        const offset = positionGeometry.xy.mul(vec2(size.div(aspect), size));
        return vec4(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w);
    })();

    material.outputNode = Fn(() => {
        const r = length(uv().sub(0.5)).mul(2.0);
        const point = exp(r.mul(r).mul(-5.5)).mul(float(1.0).sub(smoothstep(0.82, 1.0, r)));
        return vec4(max(vLight.mul(point), vec3(0.0)), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FirstLightMurmuration';
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;

    return {
        mesh,
        material,
        count,
        /** The frame's state (see intro-world-core.js `murmurationAt`). */
        write(m) {
            rows[0].set(m.center[0], m.center[1], m.center[2], m.gather);
            rows[1].set(m.radii[0], m.radii[1], m.radii[2], m.head);
            rows[2].set(m.span, m.width, m.thick, m.split);
            rows[3].set(m.bank[0], m.bank[1], m.bank[2], m.bank[3]);
            rows[4].set(m.wobble, m.bulge, m.light, m.swirl);
            rows[5].set(m.ring[0], m.ring[1], m.ring[2], m.ring[3]);
            rows[6].set(m.pulse ?? -1, m.pulseAt ?? 0, m.pulseAmp ?? 0, m.ringTube);
        },
        /** The rects the motes keep out of (screen fractions, y down), at most AVOID_SLOTS. */
        setAvoid(rects) {
            const n = Math.min(AVOID_SLOTS, rects.length);
            for (let i = 0; i < n; i++) avoid[i].set(rects[i].x0, rects[i].y0, rects[i].x1, rects[i].y1);
            avoidCount.value = n;
        },
        setViewport(height, viewAspect) {
            viewHeight.value = Math.max(1, height);
            aspect.value = Math.max(0.1, viewAspect);
        },
        setGain(value) {
            gain.value = value;
        },
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            quad.dispose();
            material.dispose();
        },
    };
}

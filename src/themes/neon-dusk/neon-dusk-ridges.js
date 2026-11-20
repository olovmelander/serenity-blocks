/**
 * Neon Dusk — the neon ridgelines: one clean line of light along each range's skyline.
 *
 * The scan lines on the slopes are cross-sections; they never trace the crest itself. This part
 * does: the mountains' build hands over each range's skyline as the rest camera sees it
 * (mesh.userData.crests), and a ribbon is drawn along it — a pixel-thin core in a soft glow, of
 * the same width on screen however far the range stands and however steep the crest runs (the
 * ribbon is widened in the image, square to the line's own run there). It is drawn a little
 * toward the eye along its own sight line (the same place on screen, clear of its own slope's
 * depth), and the nearer ranges still hide it.
 *
 * One draw for all three ranges, additive. The line by the sun warms to the sun's own rim light;
 * a slow shimmer runs along it; and gameplay sends pulses of light out along it from the pass
 * (u.ridgePulses: where a pulse stands as a bearing from the sun, both ways at once). The glass
 * mirrors it with the ranges.
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
    exp,
    float,
    int,
    length,
    max,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { RIG } from './neon-dusk-tsl.js';

/**
 * The ribbon: its half-width as a share of the frame's half-height and the core's share of that;
 * how far each line is drawn toward the eye (a share of its distance); the far, middle and near
 * line's light at rest; the height (world units) under which a crest carries no line (the pass's
 * floor, the ranges' sunken ends).
 */
export const RIDGE = Object.freeze({
    halfWidth: 0.022,
    core: 0.1,
    pull: 0.03,
    gain: Object.freeze([0.55, 0.85, 1.05]),
    floor: Object.freeze([3, 16]),
});

/** The most pulses running along the ridgelines at once. */
export const RIDGE_PULSES = 6;

/**
 * @param {object} u  shared world uniforms
 * @param {Array<{ range: number, points: Float32Array }>} crests  each range's skyline
 * @returns {THREE.Mesh}
 */
export function createRidges(u, crests) {
    let count = 0;
    for (const crest of crests) count += crest.points.length / 3;
    const position = new Float32Array(count * 2 * 3);
    const prev = new Float32Array(count * 2 * 3);
    const next = new Float32Array(count * 2 * 3);
    const ridge = new Float32Array(count * 2 * 4);
    const index = [];
    let v = 0;
    for (const { range, points } of crests) {
        const n = points.length / 3;
        for (let i = 0; i < n; i += 1) {
            const a = Math.max(0, i - 1) * 3;
            const b = Math.min(n - 1, i + 1) * 3;
            const x = points[i * 3];
            const y = points[i * 3 + 1];
            const z = points[i * 3 + 2];
            const bearing = Math.atan2(x - RIG.x, -(z - RIG.z));
            for (let side = -1; side <= 1; side += 2) {
                position.set([x, y, z], v * 3);
                prev.set([points[a], points[a + 1], points[a + 2]], v * 3);
                next.set([points[b], points[b + 1], points[b + 2]], v * 3);
                ridge.set([side, range, bearing, y], v * 4);
                v += 1;
            }
            if (i < n - 1) {
                const at = v - 2;
                index.push(at, at + 1, at + 2, at + 2, at + 1, at + 3);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aPrev', new THREE.BufferAttribute(prev, 3));
    geometry.setAttribute('aNext', new THREE.BufferAttribute(next, 3));
    geometry.setAttribute('aRidge', new THREE.BufferAttribute(ridge, 4));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(RIG.x, 0, RIG.z), 3200);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskRidges';
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;

    const info = attribute('aRidge', 'vec4'); // side, range, bearing from the sun, height
    const aPrev = attribute('aPrev', 'vec3');
    const aNext = attribute('aNext', 'vec3');

    material.vertexNode = Fn(() => {
        // Toward the eye along its own sight line: the same place in the image, nearer in depth.
        const clipOf = (p) => {
            const view = cameraViewMatrix.mul(vec4(p, 1.0));
            return cameraProjectionMatrix.mul(vec4(view.xyz.mul(1 - RIDGE.pull), 1.0));
        };
        const c = clipOf(positionGeometry).toVar();
        const a = clipOf(aPrev).toVar();
        const b = clipOf(aNext).toVar();
        // The line's run in the image (square pixels: x by the aspect).
        const pa = vec2(a.x.mul(u.aspect), a.y).div(max(a.w, 1e-3));
        const pb = vec2(b.x.mul(u.aspect), b.y).div(max(b.w, 1e-3));
        const run = pb.sub(pa).toVar();
        const tn = run.div(max(length(run), 1e-6)).toVar();
        const off = vec2(tn.y.negate(), tn.x).mul(info.x).mul(RIDGE.halfWidth);
        return vec4(c.x.add(off.x.div(u.aspect).mul(c.w)), c.y.add(off.y.mul(c.w)), c.z, c.w);
    })();

    material.outputNode = Fn(() => {
        // Across the ribbon (clamped: MSAA reads thin geometry a little outside its edges).
        const across = clamp(abs(info.x), 0.0, 1.0).toVar();
        const k = across.div(RIDGE.core);
        const core = exp(k.mul(k).negate());
        const glow = exp(across.mul(-4.6)).mul(0.28);
        const body = core.add(glow).mul(float(1.0).sub(smoothstep(0.72, 1.0, across))).toVar();

        const wFar = float(1.0).sub(step(0.5, info.y));
        const wNear = step(1.5, info.y);
        const wMid = float(1.0).sub(wFar).sub(wNear);
        const m = u.mood;
        const bearing = info.z.toVar();
        const tint = mix(mix(u.ridgeFar, mix(u.ridgeFar, u.ridge, 0.6), wMid), u.ridge, wNear).toVar();
        // Beside the sun the crest takes the sun's own rim light.
        const bySun = bearing.div(0.2);
        tint.assign(mix(tint, m.rimSun, exp(bySun.mul(bySun).negate()).mul(0.75)));
        // A perfect clear's crown gilds every line.
        tint.assign(mix(tint, vec3(2.0, 1.15, 0.26), clamp(u.crown, 0.0, 1.0).mul(0.8)));

        const gain = wFar.mul(RIDGE.gain[0]).add(wMid.mul(RIDGE.gain[1])).add(wNear.mul(RIDGE.gain[2])).toVar();
        // A slow shimmer runs along the line.
        const shimmer = sin(bearing.mul(34.0).sub(u.time.mul(0.55)).add(info.y.mul(2.1))).mul(0.16).add(0.84);
        // Pulses: light running out along the crest from the pass, both ways at once:
        // (bearing from the sun, 1/width, light, the one range it runs on or −1 for all).
        const pulses = float(0.0).toVar();
        Loop({
            start: int(0), end: u.ridgePulseCount, type: 'int', condition: '<', name: 'p',
        }, ({ p }) => {
            const P = u.ridgePulses.element(p).toVar();
            const d = abs(bearing).sub(P.x).mul(P.y);
            const on = max(step(P.w, -0.5), float(1.0).sub(step(0.5, abs(info.y.sub(P.w)))));
            pulses.addAssign(exp(d.mul(d).negate()).mul(P.z).mul(on));
        });
        const stand = smoothstep(RIDGE.floor[0], RIDGE.floor[1], info.w);
        const light = gain.mul(shimmer).mul(u.ridgeGain).add(pulses.mul(2.6)).mul(stand);
        return vec4(tint.mul(body).mul(light), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDuskRidges';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
}

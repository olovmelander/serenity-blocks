/**
 * Synthwave Sunset — gulls: a few birds wheeling over the pier against the sunset, ONE instanced
 * draw of camera-facing quads.
 *
 * Each gull circles its own slow loop (centre, radius, height, pace and direction per bird; the
 * centre drifts so no loop repeats exactly) in the free sky beside the board: around the wheel and
 * the sun, low over the sea, high over the pier. Every position is a closed-form function of the
 * gulls' clock, so a seek lands right. The silhouette is drawn in the fragment shader: a small body
 * and two wings bent at the wrist into an M, their dihedral taken from the vertex stage (long
 * glides broken by short bouts of flapping), the edges anti-aliased by their footprint. Toward the
 * sun the edges catch a warm rim. As the evening ends they go to roost (fade out by full dusk).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fwidth,
    max,
    modelViewMatrix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    tan,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { RIG, rgb } from './synthwave-sunset-tsl.js';

const DEG = Math.PI / 180;

/**
 * The loops, by bearing from the rest camera (deg, 0 = the sun), distance (m), height (m), loop
 * radius (m) and pace (m/s; the sign is the direction round). The free sky beside the board spans
 * bearings of about −14° to +22° in a game; the menu centres the sun, so every loop shows there.
 */
export const GULL_LOOPS = Object.freeze([
    [-8, 55, 11, 9, 6.0],
    [6, 85, 18, 14, -6.5],
    [14, 45, 9, 7, 5.0],
    [-3, 70, 14, 11, -5.5],
    [14, 100, 22, 15, 7.0],
    [-9, 110, 14, 18, -6.0],
    [9, 38, 10, 6, 4.5],
    [2, 140, 13, 20, -7.5],
    [15, 60, 15, 9, 5.5],
]);

/** Wingspan (m): a large gull's, generous so the far birds still read as birds. */
const SPAN = 2.4;

/**
 * @param {object} u  world uniforms (gullTime, sunDir, dusk)
 * @param {object} [opts]
 * @param {number} [opts.count=7]
 */
export function createGulls(u, opts = {}) {
    const loops = GULL_LOOPS.slice(0, Math.max(1, Math.min(GULL_LOOPS.length, opts.count ?? 7)));
    const geometry = new THREE.InstancedBufferGeometry();
    // x across the wings (−1..1 = the span), y up (room for the wings' full beat).
    const quad = new THREE.PlaneGeometry(2, 1.6);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    const path = new Float32Array(loops.length * 4);
    const fly = new Float32Array(loops.length * 4);
    loops.forEach(([bearing, distance, height, radius, pace], i) => {
        const a = bearing * DEG;
        path.set([RIG.x + Math.sin(a) * distance, height, RIG.z - Math.cos(a) * distance, radius], i * 4);
        // Phase round the loop, angular speed (rad/s), a seed for drift and flapping.
        fly.set([i * 2.39, pace / radius, (i * 0.618) % 1, 0], i * 4);
    });
    geometry.setAttribute('iGullPath', new THREE.InstancedBufferAttribute(path, 4));
    geometry.setAttribute('iGullFly', new THREE.InstancedBufferAttribute(fly, 4));
    geometry.instanceCount = loops.length;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, -100), 400);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveGulls';
    material.transparent = true;
    material.depthWrite = true;
    material.fog = false;

    const pathA = attribute('iGullPath', 'vec4');
    const flyA = attribute('iGullFly', 'vec4');
    const t = u.gullTime;
    const seed = flyA.z;

    // ── Where each gull is: round its drifting loop, bobbing on the air ──
    const ang = flyA.x.add(t.mul(flyA.y));
    const centre = vec3(
        pathA.x.add(sin(t.mul(0.031).add(seed.mul(40.0))).mul(6.0)),
        pathA.y.add(sin(ang.mul(2.0).add(seed.mul(17.0))).mul(1.6)),
        pathA.z.add(cos(t.mul(0.027).add(seed.mul(29.0))).mul(7.0)),
    );
    const world = centre.add(vec3(cos(ang), 0.0, sin(ang)).mul(pathA.w));
    const mv = modelViewMatrix.mul(vec4(world, 1.0));
    // Banked into the turn: the quad rolls a little toward the loop's centre.
    const roll = flyA.y.sign().mul(0.22).add(sin(t.mul(0.4).add(seed.mul(9.0))).mul(0.08));
    const corner = positionGeometry.xy.mul(SPAN * 0.5);
    const turned = vec2(
        corner.x.mul(cos(roll)).sub(corner.y.mul(sin(roll))),
        corner.x.mul(sin(roll)).add(corner.y.mul(cos(roll))),
    );
    material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xyz.add(vec3(turned, 0.0)), 1.0));

    // ── The wingbeat: long glides, short bouts of flapping (dihedral of the inner wing, rad) ──
    const bout = smoothstep(0.62, 0.8, sin(t.mul(0.37).add(seed.mul(23.0))).mul(0.5).add(0.5));
    const beat = sin(t.mul(8.5).add(seed.mul(31.0)));
    const dihedral = varying(float(0.16).add(sin(t.mul(0.9).add(seed.mul(5.0))).mul(0.05)).add(bout.mul(beat).mul(0.55)));
    const q = varying(positionGeometry.xy);
    const toSun = varying(dot(normalize(world.sub(cameraPosition)), u.sunDir));

    const shape = Fn(() => {
        const ax = abs(q.x).toVar();
        const fw = max(fwidth(q.y), 1e-4).toVar();
        // The wing's centreline: up at the dihedral to the wrist, then down toward the tip (an M).
        const wrist = float(0.42);
        const s1 = tan(clamp(dihedral, -0.5, 0.85)).toVar();
        const s2 = tan(clamp(dihedral.sub(0.45), -0.9, 0.3)).toVar();
        const inner = ax.lessThan(wrist);
        const yc = inner.select(ax.mul(s1), wrist.mul(s1).add(ax.sub(wrist).mul(s2))).sub(0.04);
        const slope = inner.select(s1, s2);
        const across = abs(q.y.sub(yc)).div(sqrt(slope.mul(slope).add(1.0)));
        const half = float(0.12).mul(float(1.0).sub(ax.mul(ax).mul(0.8))).add(0.016);
        const wing = float(1.0).sub(smoothstep(half.sub(fw), half.add(fw), across))
            .mul(float(1.0).sub(smoothstep(0.94, 1.0, ax)))
            .mul(clamp(half.div(fw), 0.0, 1.0));
        // The body: a small blob at the wings' root, a little below them.
        const bx = q.x.div(0.15);
        const by = q.y.add(0.05).div(0.075);
        const body = float(1.0).sub(smoothstep(1.0 - 0.3, 1.0 + 0.3, sqrt(bx.mul(bx).add(by.mul(by)))));
        return max(wing, body);
    });
    const roost = float(1.0).sub(smoothstep(0.62, 0.95, u.dusk));
    material.opacityNode = Fn(() => shape().mul(roost))();
    material.colorNode = Fn(() => {
        const rim = exp(toSun.sub(1.0).mul(40.0)).mul(0.5).add(exp(toSun.sub(1.0).mul(6.0)).mul(0.06));
        return rgb(0x1a1020).add(rgb(0xff9a6a).mul(rim));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveGulls';
    mesh.renderOrder = 60;
    mesh.frustumCulled = false;
    return mesh;
}

/** For tests: where gull `i` is at gull-clock time `t` (the vertex stage's twin). */
export function gullPosition(i, t, target = new THREE.Vector3()) {
    const [bearing, distance, height, radius, pace] = GULL_LOOPS[i];
    const a = bearing * DEG;
    const seed = (i * 0.618) % 1;
    const ang = i * 2.39 + t * (pace / radius);
    const cx = RIG.x + Math.sin(a) * distance + Math.sin(t * 0.031 + seed * 40) * 6;
    const cy = height + Math.sin(ang * 2 + seed * 17) * 1.6;
    const cz = RIG.z - Math.cos(a) * distance + Math.cos(t * 0.027 + seed * 29) * 7;
    return target.set(cx + Math.cos(ang) * radius, cy, cz + Math.sin(ang) * radius);
}

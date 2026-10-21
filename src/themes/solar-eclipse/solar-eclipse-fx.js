/**
 * Solar Eclipse — the motes a locked piece sends from the card to the sun's limb.
 *
 * A mote is a STREAK: a strip laid along the great circle from one direction to another, bowed
 * to one side, its head at a share of the way that is a function of the streak's start time (it
 * eases in, as if caught by the sun), its tail a set share behind. Nothing is simulated, so a
 * frozen clock replays every mote exactly. The world writes a mote as four rows of a table
 * (solar-eclipse-tsl.js): from and start, to and duration, colour and power, and its shape.
 *
 * The salt mirror gives every mote back: a second set of strips reads the same table, turned
 * over the horizon and dimmed by the water, drawn only where the mote itself is above it.
 */
import * as THREE from 'three/webgpu';
import {
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    int,
    length,
    max,
    min,
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
import { SKY_RADIUS, STREAKS, sized } from './solar-eclipse-tsl.js';

const SEGMENTS = 16;
/** Where along a streak its head's heart is: the strip beyond it is the rounded nose. */
const NOSE = 0.9;
/** Seconds a mote's tail takes to catch up with its head once it has landed. */
export const MOTE_FADE = 0.16;

/** The share of a mote's light the water gives back. */
const ECHO = 0.5;
/** How close to the sun's centre a mote may pass (solar radii): just outside the limb. */
const LIMB_CLEAR = 1.045;

function moteMaterial({ u, echo = false }) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const slot = int(attribute('aStreak', 'float').mul(4.0).add(0.5));
    const from = u.streaks.element(slot); // (from, start)
    const to = u.streaks.element(slot.add(1)); // (to, duration)
    const paint = u.streaks.element(slot.add(2)); // (rgb, power)
    const shape = u.streaks.element(slot.add(3)); // (kind, tail, width px, bow)
    const s = positionGeometry.x; // 0 tail … 1 head
    const side = positionGeometry.y;

    const age = u.time.sub(from.w);
    const flown = clamp(age.div(max(to.w, 1e-3)), 0.0, 1.0);
    const over = max(age.sub(to.w), 0.0);
    // It eases into the limb.
    const head = flown.oneMinus().mul(flown.oneMinus()).oneMinus();
    // The tail follows a set share behind, and catches up once the head has landed.
    const tail = max(min(head.sub(shape.y).add(over.div(MOTE_FADE).mul(shape.y)), head), 0.0);
    const bowAxis = normalize(cross(from.xyz, to.xyz).add(vec3(0.0, 1e-5, 0.0)));
    // Round the moon, never across it: a point that would fall on the black disc is carried out
    // to the limb in the sun's plane, so a mote aimed at the far limb runs round the edge.
    const clearOfDisc = (dir) => {
        const f = max(dot(dir, u.camFwd), 1e-4);
        const p = vec2(dot(dir, u.camRight), dot(dir, u.camUp)).div(f).sub(u.sunAt).div(u.sunTan);
        const r = max(length(p), 1e-4);
        const q = p.mul(max(r, LIMB_CLEAR).div(r)).mul(u.sunTan).add(u.sunAt);
        return normalize(u.camFwd.add(u.camRight.mul(q.x)).add(u.camUp.mul(q.y)));
    };
    const placeAt = (share) => clearOfDisc(normalize(mix(from.xyz, to.xyz, share)
        .add(bowAxis.mul(sin(share.mul(Math.PI)).mul(shape.w)))));
    const at = mix(tail, head, s);
    const d = placeAt(at);
    const ahead = placeAt(at.add(0.01));
    const run = normalize(ahead.sub(d).add(to.xyz.sub(from.xyz).mul(1e-4)));

    const alive = step(0.0, age).mul(step(over, MOTE_FADE)).mul(step(0.001, paint.w));
    const aside = normalize(cross(run, d));
    // Thin at the tail, full near the head and rounded off in front of it.
    const front = clamp(s.sub(NOSE).div(1 - NOSE), 0.0, 1.0);
    const nose = front.mul(front).oneMinus().max(0.0).sqrt();
    const taper = s.pow(0.65).mul(nose);
    const width = sized(u, shape.z, 1.3).mul(taper).mul(step(0.002, alive));
    const spot = d.add(aside.mul(side.mul(width)));
    // In the mirror: turned over the horizon, only where the mote itself is above it.
    const placed = echo ? vec3(spot.x, spot.y.negate(), spot.z) : spot;
    material.positionNode = cameraPosition.add(placed.mul(SKY_RADIUS));

    const fade = over.div(MOTE_FADE).oneMinus();
    const shown = echo ? smoothstep(0.0, 0.004, d.y).mul(ECHO) : 1.0;
    const vLight = varying(vec4(paint.xyz, paint.w.mul(alive).mul(max(fade, 0.0)).mul(shown)));
    const vAt = varying(vec2(s, side));
    const along = clamp(vAt.x, 0.0, 1.0);
    const profile = exp(vAt.y.mul(vAt.y).mul(-4.2));
    const body = along.pow(1.3);
    const fromHeart = along.sub(NOSE).div(0.085);
    const hot = exp(fromHeart.mul(fromHeart).negate());
    // It keeps its colour, and sparkles.
    const sparkle = sin(along.mul(52.0).sub(u.time.mul(23.0))).mul(0.22).add(0.9);
    const lit = mix(vLight.rgb, vec3(1.0, 1.0, 1.0), hot.mul(0.35)).mul(body.mul(0.8).add(hot.mul(1.6))).mul(sparkle);
    material.outputNode = vec4(lit.mul(profile).mul(vLight.a).mul(2.4), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

export function createFx({ u, tier }) {
    const rowsCount = SEGMENTS + 1;
    const position = new Float32Array(rowsCount * 2 * 3);
    const index = [];
    for (let i = 0; i < rowsCount; i += 1) {
        for (let s = 0; s < 2; s += 1) {
            const v = (i * 2 + s) * 3;
            // Closer together toward the head, so its rounded nose has enough of them.
            position[v] = 1 - (1 - i / SEGMENTS) ** 2;
            position[v + 1] = s === 0 ? -1 : 1;
        }
        if (i < SEGMENTS) {
            const o = i * 2;
            index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    }
    const count = Math.max(1, Math.min(STREAKS, tier?.motes ?? STREAKS));
    const slots = new Float32Array(count);
    for (let i = 0; i < count; i += 1) slots[i] = i;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aStreak', new THREE.InstancedBufferAttribute(slots, 1));
    geometry.instanceCount = count;
    const group = new THREE.Group();
    group.name = 'solar-eclipse-motes';
    const meshes = [false, true].map((echo) => {
        const mesh = new THREE.Mesh(geometry, moteMaterial({ u, echo }));
        mesh.frustumCulled = false;
        mesh.renderOrder = echo ? 30 : 31;
        mesh.name = echo ? 'solar-eclipse-mote-echoes' : 'solar-eclipse-mote-lights';
        group.add(mesh);
        return mesh;
    });
    return {
        motes: group,
        count,
        dispose() {
            geometry.dispose();
            meshes.forEach((mesh) => mesh.material.dispose());
        },
    };
}

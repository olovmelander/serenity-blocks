/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the pod: dolphins that leave the face of the wave ahead, cross the eye of the barrel
 * against the evening, and go back into the sea in front of it.
 *
 * A chain of clears calls them. Each leap is a plain ballistic arc in the wave's slow motion
 * (the same gravity the spray falls under), so a dolphin hangs at the top of it for a long
 * moment; the tallest leaps are thrown so that their top crosses the sun.
 *
 * The animal is generated (a lofted body, a dorsal fin, two pectoral fins, the flukes) and
 * drawn with one material and one draw call: every dolphin is an instance placed by its own
 * rows of an interleaved buffer (where it is, which way it heads, how it is bent), written on
 * the CPU each frame from the arcs in flight. Nothing is loaded.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, cross, dot, float, frontFacing, max, mix, normalize, positionGeometry,
    reflect, select, sin, smoothstep, varying, vec3, vec4,
} from 'three/tsl';
import {
    clamp01, lerp, mulberry32, smooth, wavePoint,
} from './waves-core.js';
import { GRAVITY } from './waves-spray.js';

/** Nose to the end of the tail stock, metres (the model itself is 2 units long). */
export const DOLPHIN_LENGTH = 2.5;

/** Girth along the body: [s (0 nose .. 1 tail), radius, lift of the section's centre]. */
const GIRTH = [
    [0.0, 0.004, -0.02], [0.05, 0.034, -0.02], [0.105, 0.05, -0.015], [0.15, 0.118, 0.02], [0.25, 0.17, 0.02],
    [0.4, 0.2, 0.0], [0.6, 0.16, 0.0], [0.8, 0.085, 0.01], [0.94, 0.036, 0.015], [1.0, 0.02, 0.015],
];

function girthAt(s) {
    for (let i = 1; i < GIRTH.length; i += 1) {
        if (s <= GIRTH[i][0]) {
            const a = GIRTH[i - 1];
            const b = GIRTH[i];
            const t = smooth(a[0], b[0], s);
            return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
        }
    }
    const last = GIRTH[GIRTH.length - 1];
    return [last[1], last[2]];
}

/**
 * The dolphin: x along the body (nose at +1, tail stock at −1), y up, z to its left.
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint16Array, body: number }}
 *          `body` = how many of the first vertices are the lofted body (the rest are fins).
 */
export function buildDolphin(rings = 26, sides = 12) {
    const positions = [];
    const indices = [];
    for (let i = 0; i <= rings; i += 1) {
        const s = i / rings;
        const [radius, lift] = girthAt(s);
        const x = 1 - 2 * s;
        // The tail stock is a blade: deep, narrow.
        const narrow = 1 - 0.45 * smooth(0.72, 0.96, s);
        const arch = 0.035 * Math.sin(Math.PI * s);
        for (let j = 0; j < sides; j += 1) {
            const a = (j / sides) * Math.PI * 2;
            positions.push(x, lift + arch + Math.cos(a) * radius * 1.04, Math.sin(a) * radius * narrow);
        }
    }
    for (let i = 0; i < rings; i += 1) {
        for (let j = 0; j < sides; j += 1) {
            const a = i * sides + j;
            const b = i * sides + ((j + 1) % sides);
            const c = a + sides;
            const d = b + sides;
            // Outward: the ring index runs toward −x, the side index from +y round to +z.
            indices.push(a, c, b, b, c, d);
        }
    }
    const body = positions.length / 3;
    /** A flat fin as a fan of triangles; drawn two-sided. */
    const fin = (points) => {
        const base = positions.length / 3;
        points.forEach((p) => positions.push(p[0], p[1], p[2]));
        for (let i = 1; i < points.length - 1; i += 1) indices.push(base, base + i, base + i + 1);
    };
    // Dorsal fin: swept back, in the body's own plane.
    fin([[0.2, 0.18, 0], [0.05, 0.33, 0], [-0.13, 0.47, 0], [-0.17, 0.44, 0], [-0.1, 0.3, 0], [-0.14, 0.17, 0]]);
    // Pectoral fins: down and out, one each side.
    [1, -1].forEach((side) => {
        fin([
            [0.42, -0.1, 0.13 * side], [0.3, -0.21, 0.3 * side], [0.13, -0.3, 0.43 * side],
            [0.1, -0.27, 0.4 * side], [0.2, -0.14, 0.17 * side],
        ]);
        // Flukes: flat, a crescent each side of the notch.
        fin([
            [-0.9, 0.015, 0.025 * side], [-1.05, 0.015, 0.2 * side], [-1.21, 0.015, 0.37 * side],
            [-1.17, 0.015, 0.28 * side], [-1.09, 0.015, 0.13 * side], [-1.03, 0.015, 0],
        ]);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(geometry.getAttribute('normal').array),
        indices: new Uint16Array(indices),
        body,
        geometry,
    };
}

const STRIDE = 12;

/** How many dolphins a chain of `combo` clears sends over the water at once. */
export function leapersFor(combo) {
    if (combo >= 9) return 4;
    if (combo >= 7) return 3;
    if (combo >= 5) return 2;
    return combo >= 3 ? 1 : 0;
}

export class WavesPod {
    /**
     * @param {object} p
     * @param {object} p.tier
     * @param {object} p.U
     * @param {{x: number, y: number, z: number}} p.sun   unit vector toward the sun
     * @param {{x: number, y: number, z: number}} p.eye   the rider's eye (the leaps are staged for it)
     */
    constructor({
        tier, U, sun, eye, seed = 21,
    }) {
        this.count = Math.max(1, tier.dolphins);
        this.U = U;
        this.sun = sun;
        this.eye = eye;
        this.seed = seed;
        this.rand = mulberry32(seed * 2749 + 1);
        /** One arc per dolphin: start time, start point, launch velocity, flight time. */
        this.arcs = Array.from({ length: this.count }, () => ({
            active: false,
            started: false,
            landed: false,
            t0: 0,
            x: 0,
            y: 0,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            flight: 1,
            size: 1,
            phase: 0,
        }));
        this.cursor = 0;
        this.data = new Float32Array(this.count * STRIDE);
        const model = buildDolphin();
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = model.geometry.index;
        geometry.setAttribute('position', model.geometry.getAttribute('position'));
        geometry.setAttribute('normal', model.geometry.getAttribute('normal'));
        this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
        this.buffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aPlace', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
        geometry.setAttribute('aHead', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
        geometry.setAttribute('aPose', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
        geometry.instanceCount = this.count;
        this.geometry = geometry;
        this.model = model;

        /** (x, y, z, size), (heading, arch), (swim phase, beat, wetness, -). */
        const aPlace = attribute('aPlace', 'vec4');
        const aHead = attribute('aHead', 'vec4');
        const aPose = attribute('aPose', 'vec4');
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'waves-dolphin';

        const local = positionGeometry;
        // The body beats up and down, more toward the tail, and arcs along its flight.
        const toTail = float(1.0).sub(local.x).mul(0.5);
        const beat = sin(aPose.x.sub(toTail.mul(3.4))).mul(aPose.y).mul(toTail.mul(toTail));
        const arched = local.x.mul(local.x).mul(aHead.w).negate();
        const bent = vec3(local.x, local.y.add(beat).add(arched), local.z);
        const forward = normalize(aHead.xyz);
        const side = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
        const up = cross(side, forward);
        const toWorld = (v) => forward.mul(v.x).add(up.mul(v.y)).add(side.mul(v.z));
        material.positionNode = aPlace.xyz.add(toWorld(bent).mul(aPlace.w));
        const vNormal = varying(toWorld(attribute('normal', 'vec3')), 'vWaveDolphinNormal');
        const vBack = varying(attribute('normal', 'vec3').y, 'vWaveDolphinBack');
        const vWorld = varying(aPlace.xyz.add(toWorld(bent).mul(aPlace.w)), 'vWaveDolphinAt');
        const vWet = varying(aPose.z, 'vWaveDolphinWet');

        material.colorNode = Fn(() => {
            const n0 = normalize(vNormal);
            const N = select(frontFacing, n0, n0.negate()).toVar();
            const V = normalize(cameraPosition.sub(vWorld)).toVar();
            const L = U.sun;
            // Slate on the back, pale under: countershading, as the animal has it.
            const hide = mix(vec3(0.2, 0.25, 0.27), vec3(0.02, 0.032, 0.045), smoothstep(-0.35, 0.3, vBack));
            const { fireTint, skyTint } = U.light;
            const sky = mix(vec3(0.08, 0.14, 0.16), vec3(0.2, 0.28, 0.38), N.y.mul(0.5).add(0.5)).mul(skyTint);
            const sunFace = clamp(dot(N, L), 0.0, 1.0);
            const lit = hide.mul(sky.add(vec3(2.1, 1.35, 0.72).mul(fireTint).mul(sunFace)));
            // Wet skin: the sun slides along it, and its far edge takes the evening.
            const facing = clamp(dot(N, V), 0.0, 1.0);
            const rim = float(1.0).sub(facing);
            const r2 = rim.mul(rim);
            const gleam = clamp(dot(reflect(V.negate(), N), L), 0.0, 1.0);
            const g2 = gleam.mul(gleam);
            const g8 = g2.mul(g2).mul(g2).mul(g2);
            const wet = vWet.mul(0.6).add(0.4);
            const shine = vec3(3.2, 2.2, 1.2).mul(g8.mul(g8).mul(g2)).mul(wet)
                .add(vec3(1.0, 0.6, 0.3).mul(r2.mul(rim)).mul(max(dot(L, V.negate()), 0.0).mul(0.9).add(0.15)))
                .mul(fireTint);
            return vec4(lit.add(shine).mul(mix(vec3(1.0), vec3(1.12, 1.0, 0.84), U.warm)), 1.0);
        })();
        this.material = material;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = 'waves-dolphins';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 12;
        this.reset();
    }

    reset() {
        this.rand = mulberry32(this.seed * 2749 + 1);
        this.cursor = 0;
        this.arcs.forEach((arc) => {
            arc.active = false;
        });
        this.data.fill(0);
        // Unit headings even while hidden: a zero vector would be normalised into NaN.
        for (let i = 0; i < this.count; i += 1) this.data[i * STRIDE + 4] = 1;
        this.buffer.needsUpdate = true;
        this.airborne = 0;
    }

    /**
     * Send one dolphin over the water.
     * @param {number} time   when it breaks the surface
     * @param {number} open   the barrel's opening (the face it leaves follows the wave)
     * @param {object} [o]
     * @param {number} [o.d]        metres ahead of the eye
     * @param {boolean} [o.hero]    throw it across the sun
     * @param {number} [o.height]   metres its back rises above where it left the water
     */
    leap(time, open, { d = null, hero = false, height = null } = {}) {
        const { rand } = this;
        const arc = this.arcs[this.cursor];
        this.cursor = (this.cursor + 1) % this.count;
        const ahead = d ?? 9 + rand() * 9;
        // It leaves the lower face, heading out of the wave and a little down the line.
        const from = wavePoint(0.16 + rand() * 0.08, ahead, open);
        const rise = height ?? 1.5 + rand() * 1.3;
        let vy = Math.sqrt(2 * GRAVITY * rise);
        let flight = (2 * vy) / GRAVITY;
        let vx = -(0.95 + rand() * 0.5);
        let vz = (rand() - 0.35) * 0.5;
        if (hero) {
            // The top of the arc on the line from the eye to the sun, at that distance.
            const reach = (from.z - this.eye.z) / this.sun.z;
            const topX = this.eye.x + this.sun.x * reach;
            const topY = this.eye.y + this.sun.y * reach;
            const climb = Math.max(1.2, topY - from.y - 0.1);
            vy = Math.sqrt(2 * GRAVITY * climb);
            flight = (2 * vy) / GRAVITY;
            vx = (topX - from.x) / (flight * 0.5);
            vz = 0.06;
        }
        // It comes down where it left, in height: on the trough in front of the wave. From a
        // point up the face it has a little further to fall.
        const drop = Math.max(0, from.y);
        flight = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * drop)) / GRAVITY;
        Object.assign(arc, {
            active: true,
            started: false,
            landed: false,
            t0: time,
            x: from.x,
            y: from.y,
            z: from.z,
            vx,
            vy,
            vz,
            flight,
            size: (DOLPHIN_LENGTH / 2) * (0.86 + rand() * 0.28),
            phase: rand() * 6.28,
        });
        return arc;
    }

    /**
     * Fly the arcs. `onSplash(x, y, z, strength)` is called once where a dolphin breaks the
     * surface and once where it goes back in.
     */
    update(time, onSplash) {
        const { data } = this;
        let airborne = 0;
        for (let i = 0; i < this.count; i += 1) {
            const arc = this.arcs[i];
            const at = i * STRIDE;
            if (!arc.active) {
                data[at + 3] = 0;
                continue;
            }
            const t = time - arc.t0;
            if (t < -0.35) {
                data[at + 3] = 0;
                continue;
            }
            // A body length of run-up under the surface before it breaks, and after it is in.
            const lead = 0.9;
            // The splashes first: a long frame may carry an arc past its end in one step.
            if (!arc.started && t >= 0) {
                arc.started = true;
                onSplash?.(arc.x, arc.y, arc.z, 0.8);
            }
            if (!arc.landed && t >= arc.flight) {
                arc.landed = true;
                onSplash?.(arc.x + arc.vx * arc.flight, 0, arc.z + arc.vz * arc.flight, 1);
            }
            if (t > arc.flight + lead) {
                arc.active = false;
                data[at + 3] = 0;
                continue;
            }
            const x = arc.x + arc.vx * t;
            const y = arc.y + arc.vy * t - 0.5 * GRAVITY * t * t;
            const z = arc.z + arc.vz * t;
            const vy = arc.vy - GRAVITY * t;
            const speed = Math.hypot(arc.vx, vy, arc.vz) || 1;
            const inAir = clamp01(t / 0.5) * clamp01((arc.flight + lead - t) / 0.5);
            data[at] = x;
            data[at + 1] = y;
            data[at + 2] = z;
            data[at + 3] = arc.size * smooth(-0.35, 0.1, t);
            data[at + 4] = arc.vx / speed;
            data[at + 5] = vy / speed;
            data[at + 6] = arc.vz / speed;
            // Arched over the top of the leap, straight as it goes in.
            data[at + 7] = 0.07 + 0.09 * Math.sin(Math.PI * clamp01(t / arc.flight));
            data[at + 8] = arc.phase + time * 3.1;
            data[at + 9] = 0.1 + 0.08 * (1 - inAir);
            data[at + 10] = 1 - 0.5 * clamp01(t / arc.flight);
            if (t >= 0 && t <= arc.flight) airborne += 1;
        }
        this.airborne = airborne;
        this.buffer.needsUpdate = true;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.model.geometry.dispose();
        this.material.dispose();
    }
}

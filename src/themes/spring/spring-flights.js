/**
 * Spring — birds passing over the valley: whooper swans for a perfect clear (white, trumpeting
 * their way north in a long V), cranes for a level-up (grey, necks out, legs trailing), both the
 * birds a Norrland spring brings back.
 *
 * A flight crosses the valley in a straight line high over the river, from behind the fall's
 * rim on the left toward the fells on the right, in a V that keeps its shape; each bird's wings
 * beat on its own phase (the vertex shader folds them about the body). The CPU places a dozen
 * birds a frame; nothing else moves.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    float,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { aerial } from './spring-light.js';

/**
 * The kinds of bird: size (wingspan m), how many fly together, their colour, how fast they fly
 * (m/s) and beat their wings (beats/s), and the neck's reach (share of the body).
 */
export const BIRDS = Object.freeze({
    swan: Object.freeze({
        id: 0, span: 2.4, count: 7, colour: [0.82, 0.83, 0.82], speed: 17, beat: 1.6, neck: 0.75,
    }),
    crane: Object.freeze({
        id: 1, span: 2.2, count: 9, colour: [0.32, 0.33, 0.35], speed: 15, beat: 1.3, neck: 0.65,
    }),
});

/**
 * A flight's way across the valley (world m): in over the gorge's rim on the left, low enough to
 * be seen as birds (150–250 m out), and away over the tongue toward the river leaving right.
 */
export const ROUTE = Object.freeze({
    from: Object.freeze([-150, 27, -60]),
    to: Object.freeze([260, 40, -190]),
});

/**
 * One bird (unit wingspan): a body, a long neck and head, and two wings hinged at the body.
 * `aWing` is −1 / +1 on the left / right wing (by how far out from the hinge), 0 on the body.
 */
export function birdGeometry(neck = 0.7) {
    const position = [];
    const wing = [];
    const tri = (a, b, c, w = [0, 0, 0]) => {
        position.push(...a, ...b, ...c);
        wing.push(...w);
    };
    // The body: a spindle along +z (the way it flies).
    const L = 0.42;
    const r = 0.06;
    const ring = [[r, 0], [0, r], [-r, 0], [0, -r * 0.8]];
    for (let k = 0; k < 4; k++) {
        const [ax, ay] = ring[k];
        const [bx, by] = ring[(k + 1) % 4];
        tri([0, 0, L * 0.5], [ax, ay, 0], [bx, by, 0]);
        tri([0, 0, -L * 0.5], [bx, by, 0], [ax, ay, 0]);
    }
    // The neck and head: a thin wedge forward.
    const n = L * 0.5 + neck * 0.45;
    tri([0.02, 0.01, L * 0.45], [-0.02, 0.01, L * 0.45], [0, 0.02, n]);
    tri([0, -0.015, L * 0.45], [0.02, 0.01, L * 0.45], [0, 0.02, n]);
    tri([-0.02, 0.01, L * 0.45], [0, -0.015, L * 0.45], [0, 0.02, n]);
    // The wings: broad, swept a little back, each a pair of triangles out to the tip.
    for (const side of [-1, 1]) {
        const root0 = [side * r, 0, 0.1];
        const root1 = [side * r, 0, -0.08];
        const mid0 = [side * 0.26, 0, 0.08];
        const mid1 = [side * 0.26, 0, -0.1];
        const tip = [side * 0.5, 0, -0.06];
        const w = (p) => side * (Math.abs(p[0]) / 0.5);
        tri(root0, mid0, root1, [w(root0), w(mid0), w(root1)]);
        tri(root1, mid0, mid1, [w(root1), w(mid0), w(mid1)]);
        tri(mid0, tip, mid1, [w(mid0), w(tip), w(mid1)]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geometry.computeVertexNormals();
    return geometry;
}

export class Flights {
    constructor(u, { slots = 2, seed = 0xb1d5 } = {}) {
        this.u = u;
        this.random = mulberry32(seed);
        this.per = Math.max(BIRDS.swan.count, BIRDS.crane.count);
        this.slots = Array.from({ length: slots }, () => ({ kind: null, born: -1e6, phase: 0 }));
        this.cursor = 0;
        this.meshes = Object.values(BIRDS).map((kind) => {
            const geometry = birdGeometry(kind.neck);
            const count = this.per * slots;
            const phase = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
            geometry.setAttribute('aPhase', phase);
            const mesh = new THREE.InstancedMesh(geometry, this.createMaterial(kind), count);
            mesh.name = `SpringFlight ${kind === BIRDS.swan ? 'swans' : 'cranes'}`;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            mesh.renderOrder = 12;
            mesh.userData.kind = kind;
            mesh.userData.phase = phase;
            return mesh;
        });
        this._m = new THREE.Matrix4();
        this._q = new THREE.Quaternion();
        this._p = new THREE.Vector3();
        this._s = new THREE.Vector3();
        this._dir = new THREE.Vector3(...ROUTE.to).sub(new THREE.Vector3(...ROUTE.from));
        this._length = this._dir.length();
        this._dir.normalize();
        this._side = new THREE.Vector3(this._dir.z, 0, -this._dir.x).normalize();
        this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
        this.clear();
    }

    createMaterial(kind) {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SpringFlight';
        const wing = attribute('aWing', 'float');
        const phase = attribute('aPhase', 'float');
        // The wings beat: folded up and down about the body, more toward the tips.
        material.positionNode = Fn(() => {
            const beat = sin(u.time.mul(kind.beat * Math.PI * 2).add(phase.mul(6.283)));
            const lift = abs(wing).mul(beat.mul(0.32).add(0.06));
            return positionLocal.add(vec3(0.0, lift, 0.0));
        })();
        material.colorNode = Fn(() => {
            const P = positionWorld;
            const N = normalize(normalWorld);
            const L = u.sunDir;
            const albedo = vec3(...kind.colour);
            const wrap = clamp(dot(N, L).abs().mul(0.6).add(0.3), 0.0, 1.0);
            // Seen against the light, the wings glow at their edges.
            const V = normalize(P.sub(u.eye));
            const back = clamp(dot(V, L), 0.0, 1.0);
            const lit = albedo.mul(u.sun.mul(u.sunUp).mul(wrap.mul(0.55)).add(u.fill.mul(1.2)))
                .add(u.sun.mul(u.sunUp).mul(back.mul(back).mul(abs(wing)).mul(0.08)));
            return vec4(aerial(u, P, mix(lit, lit.mul(0.85), float(kind.id))), 1.0);
        })();
        return material;
    }

    clear() {
        for (const slot of this.slots) {
            slot.kind = null;
            slot.born = -1e6;
        }
        this._m.makeScale(0, 0, 0);
        for (const mesh of this.meshes) {
            for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this._m);
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    /** A flight sets out: `kind` 'swan' or 'crane', at time t. */
    launch(kind, time) {
        const slot = this.slots[this.cursor];
        this.cursor = (this.cursor + 1) % this.slots.length;
        slot.kind = BIRDS[kind] || BIRDS.swan;
        slot.born = time;
        slot.phase = this.random();
    }

    /** How far along its way a flight is at an age (m). */
    flown(kind, age) {
        return age * kind.speed;
    }

    update(time) {
        const live = this.meshes.map(() => 0);
        this._m.makeScale(0, 0, 0);
        for (const mesh of this.meshes) for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this._m);
        this.slots.forEach((slot, s) => {
            if (!slot.kind) return;
            const age = time - slot.born;
            const along = this.flown(slot.kind, age);
            if (age < 0 || along > this._length + 200) {
                slot.kind = null;
                return;
            }
            const meshIndex = slot.kind.id;
            const mesh = this.meshes[meshIndex];
            const phases = mesh.userData.phase;
            for (let b = 0; b < slot.kind.count; b++) {
                // The V: the leader at its point, the rest stepping back and out on either side.
                const rank = Math.ceil(b / 2);
                let side = 0;
                if (b > 0) side = b % 2 ? -1 : 1;
                const back = rank * 4.2;
                const out = side * rank * 3.1;
                const bob = Math.sin(time * 0.9 + b * 1.7 + slot.phase * 6) * 0.6;
                this._p.set(...ROUTE.from)
                    .addScaledVector(this._dir, along - back)
                    .addScaledVector(this._side, out);
                this._p.y += bob;
                const span = slot.kind.span * (0.94 + ((b * 37) % 10) * 0.012);
                this._s.set(span, span, span);
                this._m.compose(this._p, this._q, this._s);
                const i = s * this.per + b;
                mesh.setMatrixAt(i, this._m);
                phases.array[i] = slot.phase + b * 0.13;
            }
            live[meshIndex] += slot.kind.count;
            phases.needsUpdate = true;
        });
        for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
        this.live = live;
    }

    dispose() {
        for (const mesh of this.meshes) {
            mesh.geometry.dispose();
            mesh.material.dispose();
            mesh.dispose?.();
        }
    }
}

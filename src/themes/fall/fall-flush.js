/**
 * Fall — the flock a perfect clear startles out of the trees.
 *
 * Small birds burst from the crowns beside the board, scatter, gather into one loose flock and cross
 * the sky downwind, beating in bursts and gliding between them as finches do. They are dark against
 * the low sun. Like everything the events throw (fall-event-fx.js), a bird is a record written once
 * and flown by the vertex stage from the clock alone; each bird's life is as long as it takes that
 * bird to leave the frame (worked out through the game's eye when it is thrown), so the flock goes
 * out whole, over the edge of the picture, and none blinks out in the open sky. A full table lets
 * the new bird go.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, color, cos, cross, dot, exp, float, mix, normalize, positionGeometry, pow, saturate,
    sin, smoothstep, step, varyingProperty, vec3, vec4,
} from 'three/tsl';
import { fallEventTier } from './fall-event-light.js';

const STRIDE = 12;
const TAU = Math.PI * 2;
/** The way the flock goes: downwind across the picture in front of the great trees, climbing. */
const HEADING = Object.freeze([0.975, 0.15, 0.06]);
/** A bird never flies longer than this (seconds), and is looked for at the frame's edge this often. */
const LONGEST = 12;
const LOOK = 0.25;
/**
 * A bird's size (the least and the spread; wingspan about 2.2 of it, in metres): drawn larger than a
 * finch, as the squirrel is larger than life, so the flock reads a dozen metres off at game size.
 */
const BIRD_SIZE = Object.freeze([0.36, 0.1]);
/** How far past the frame's edge (in screen fractions) a bird must be before it is let go. */
const BEYOND = 0.08;

/** A small bird, nose toward +z: a body, a tail, and two wings whose `aSpan` runs 0 at the root to 1 at the tip. */
function birdGeometry() {
    const position = [];
    const span = [];
    const index = [];
    const vertex = (x, y, z, along = 0) => {
        position.push(x, y, z);
        span.push(along);
        return position.length / 3 - 1;
    };
    const nose = vertex(0, 0, 0.5);
    const tail = vertex(0, 0.02, -0.46);
    const top = vertex(0, 0.1, 0.06);
    const belly = vertex(0, -0.1, 0.06);
    const left = vertex(-0.1, 0, 0.08);
    const right = vertex(0.1, 0, 0.08);
    index.push(nose, right, top, nose, top, left, nose, left, belly, nose, belly, right);
    index.push(tail, top, right, tail, left, top, tail, belly, left, tail, right, belly);
    const fanLeft = vertex(-0.14, 0.02, -0.86);
    const fanRight = vertex(0.14, 0.02, -0.86);
    index.push(tail, fanLeft, fanRight);
    for (const side of [-1, 1]) {
        const rootFront = vertex(side * 0.07, 0.03, 0.24);
        const rootBack = vertex(side * 0.07, 0.03, -0.16);
        const midFront = vertex(side * 0.58, 0.03, 0.22, 0.47);
        const midBack = vertex(side * 0.58, 0.03, -0.2, 0.47);
        const tip = vertex(side * 1.12, 0.03, -0.1, 1);
        index.push(rootFront, rootBack, midFront, midFront, rootBack, midBack, midFront, midBack, tip);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
    geometry.setIndex(index);
    return geometry;
}

export class FallFlush {
    /**
     * @param {object} o
     * @param {object} o.light   the grove's light rig
     * @param {object} o.tier    a row of FALL_TIERS (or a quality name)
     * @param {() => number} [o.rng]
     * @param {Float32Array | null} [o.crownPoints]  [x, y, z, species] per point
     */
    constructor({
        light, tier, rng = Math.random, crownPoints = null,
    }) {
        this.light = light;
        this.tier = fallEventTier(tier);
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallFlush';
        this.owned = [];
        this.time = 0;
        this.serial = -1;
        this.epoch = null;
        this.at = new THREE.Vector3();
        this.stats = { flown: 0, refused: 0 };
        // (The flock sits where the eye sees the great trees' boughs, not at the crowns' own points:
        // a bird that starts inside a crown is behind its leaves for the best of its flight.)
        this.crownPoints = crownPoints;
        this.roost = [0, 0, 0];
    }

    /**
     * A perch in the boughs as the eye sees them: beside the card (three birds upwind of it for
     * each one downwind, so the flock crosses the whole picture as it leaves) or, where the card
     * leaves no room at its sides, over it; in the upper part of the frame, nearer than the great crowns
     * (a bird that starts inside one is behind its leaves for the best of its flight).
     */
    perch(stage) {
        const { board } = stage;
        const upwind = this.random() < 0.75;
        const room = upwind ? board.x0 - 0.07 : 0.93 - board.x1;
        let sx;
        let sy = 0.1 + this.random() * 0.42;
        if (room > 0.07) sx = upwind ? 0.03 + this.random() * room : board.x1 + 0.04 + this.random() * room;
        else {
            sx = 0.05 + this.random() * 0.5;
            sy = Math.max(0.02, Math.min(sy, board.y0 - 0.02));
        }
        const at = stage.point(sx, sy, 5.5 + this.random() * 3.5, this.at);
        this.roost[0] = at.x;
        this.roost[1] = at.y;
        this.roost[2] = at.z;
        return this.roost;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    build() {
        const capacity = Math.max(0, Math.floor(this.tier.birds || 0));
        if (!capacity) return this;
        const base = birdGeometry();
        this.data = new Float32Array(capacity * STRIDE);
        this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
        this.buffer.setUsage(THREE.DynamicDrawUsage);
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = base.index;
        geometry.setAttribute('position', base.getAttribute('position'));
        geometry.setAttribute('aSpan', base.getAttribute('aSpan'));
        ['iBirdA', 'iBirdB', 'iBirdC'].forEach((name, k) => {
            geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, 4, k * 4));
        });
        geometry.instanceCount = capacity;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, -30), 400);
        this.capacity = capacity;
        this.ends = new Float64Array(capacity).fill(-Infinity);
        this.cursor = 0;
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'FallFlushBirds';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(base, geometry, material);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'FallFlushBirds';
        const A = attribute('iBirdA', 'vec4'); // start, birth
        const B = attribute('iBirdB', 'vec4'); // heading (unit), speed
        const C = attribute('iBirdC', 'vec4'); // size, seed, life, how far it scatters first
        const span = attribute('aSpan', 'float');
        const vWorld = varyingProperty('vec3', 'vFallBirdWorld');
        const vTone = varyingProperty('float', 'vFallBirdTone');
        material.positionNode = Fn(() => {
            const age = light.uTime.sub(A.w).toVar();
            const life = C.z;
            const seed = C.y;
            const heading = B.xyz;
            // Fast out of the leaves, then at its own pace; scattering first, then gathering.
            const run = B.w.mul(age.add(float(1).sub(exp(age.mul(-2.6))).mul(0.4)));
            const side = normalize(cross(vec3(0, 1, 0), heading)).toVar();
            const swing = age.mul(1.9).add(seed.mul(TAU)).toVar();
            const settled = smoothstep(0, 1.3, age);
            const scatter = vec3(cos(seed.mul(19)), 0.55, sin(seed.mul(19)))
                .mul(float(1).sub(exp(age.mul(-2.2)))).mul(C.w);
            const at = A.xyz.add(heading.mul(run)).add(scatter)
                .add(side.mul(sin(swing).mul(0.9).mul(settled)))
                .add(vec3(0, sin(age.mul(2.7).add(seed.mul(40))).mul(0.4).mul(settled), 0))
                .toVar();
            // It faces the way it flies, leaning into each swing.
            const forward = normalize(heading.add(side.mul(cos(swing).mul(0.2)))).toVar();
            const right = normalize(cross(forward, vec3(0, 1, 0))).toVar();
            const up = cross(right, forward).toVar();
            // Bursts of beats with a short glide between them; the outer wing follows the inner.
            const beat = age.mul(seed.mul(8).add(27)).toVar();
            const beating = smoothstep(-0.35, 0.2, sin(age.mul(2.3).add(seed.mul(31))));
            const reach = span.abs();
            const lift = sin(beat.sub(reach.mul(0.7))).mul(beating.mul(0.65).add(0.3)).add(0.12)
                .mul(reach.mul(0.6).add(0.55));
            const present = smoothstep(0, 0.3, age).mul(float(1).sub(smoothstep(life.sub(0.5), life, age)))
                .mul(step(0, age)).mul(step(age, life));
            const size = C.x.mul(present);
            // A wing vertex swings up and down about its root (0.07 out from the body's middle).
            const out = positionGeometry.x.abs().sub(0.07).max(0).mul(step(0.0001, reach));
            const x = positionGeometry.x.sign().mul(positionGeometry.x.abs().sub(out).add(out.mul(cos(lift))));
            const y = positionGeometry.y.add(out.mul(sin(lift)));
            const placed = at.add(right.mul(x.mul(size))).add(up.mul(y.mul(size)))
                .add(forward.mul(positionGeometry.z.mul(size))).toVar();
            vWorld.assign(placed);
            // The wings a shade lighter than the body, lighter still toward their tips.
            vTone.assign(reach.mul(0.6).add(step(0.0001, reach).mul(0.25)));
            return placed;
        })();
        // Small brown birds: dark against the glare and the sky, a shade lighter than the shaded
        // leaves behind them, with the low sun coming through the spread wings.
        // (Darker than a finch in the hand: against the glare a bird a few dozen pixels long reads as a
        // silhouette or not at all.)
        const albedo = mix(color(0x150e09), color(0x3a2b1e), vTone);
        const view = normalize(cameraPosition.sub(vWorld));
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4).mul(vTone).mul(vTone);
        const lit = albedo.mul(light.ambient(vec3(0, 1, 0)).mul(1.3))
            .add(color(0xc88a3c).mul(light.uSunColor).mul(through).mul(0.07));
        material.colorNode = vec4(light.haze(lit, { world: vWorld, strength: 0.8 }), 1);
        return material;
    }

    /**
     * Startle the flock: `strength` (0..1) of the tier's birds leave the crowns over most of a
     * second. `stage` is the game's eye (FallStage): each bird lives until it has left the frame.
     */
    burst(strength, stage) {
        if (!this.capacity || !stage || typeof stage.point !== 'function') return 0;
        const wanted = Math.round(this.capacity * Math.max(0, Math.min(1, strength)));
        let flown = 0;
        for (let i = 0; i < wanted; i += 1) {
            const roost = this.perch(stage).slice();
            // Each its own way within the flock's: a little to either side, a little higher or lower.
            const yaw = (this.random() - 0.5) * 0.44;
            const pitch = (this.random() - 0.5) * 0.2;
            const cosYaw = Math.cos(yaw);
            const sinYaw = Math.sin(yaw);
            let hx = HEADING[0] * cosYaw - HEADING[2] * sinYaw;
            let hy = HEADING[1] + pitch;
            let hz = HEADING[0] * sinYaw + HEADING[2] * cosYaw;
            const length = Math.hypot(hx, hy, hz) || 1;
            hx /= length;
            hy /= length;
            hz /= length;
            const speed = 4.2 + this.random() * 2.2;
            const life = this.flightTime(roost, hx, hy, hz, speed, stage);
            const delay = 0.05 + this.random() * 0.85;
            if (this.fly(roost[0], roost[1], roost[2], hx, hy, hz, speed, life, delay)) flown += 1;
        }
        this.buffer.needsUpdate = true;
        return flown;
    }

    /** How long a bird on this heading takes to leave the frame (seconds, at most LONGEST). */
    flightTime(roost, hx, hy, hz, speed, stage) {
        for (let t = 1.2; t < LONGEST; t += LOOK) {
            const run = speed * (t + 0.4 * (1 - Math.exp(-2.6 * t)));
            const seen = stage.project(roost[0] + hx * run, roost[1] + hy * run, roost[2] + hz * run, this.at);
            if (seen.z <= 0 || seen.x > 1 + BEYOND || seen.x < -BEYOND || seen.y < -BEYOND || seen.y > 1 + BEYOND) {
                return t + 0.6;
            }
        }
        return LONGEST;
    }

    /** Write one bird into a spent slot; false when every bird is in the air (the new one is let go). */
    fly(x, y, z, hx, hy, hz, speed, life, delay = 0) {
        if (!this.capacity || ![x, y, z, hx, hy, hz, speed, life, delay].every(Number.isFinite) || !(life > 0)) return false;
        let slot = -1;
        for (let hop = 0; hop < this.capacity && slot < 0; hop += 1) {
            const index = (this.cursor + hop) % this.capacity;
            if (this.ends[index] <= this.time) slot = index;
        }
        if (slot < 0) {
            this.stats.refused += 1;
            return false;
        }
        const birth = this.time + Math.max(0, delay);
        this.cursor = (slot + 1) % this.capacity;
        this.ends[slot] = birth + life;
        this.data.set([
            x, y, z, birth, hx, hy, hz, speed, BIRD_SIZE[0] + this.random() * BIRD_SIZE[1], this.random(), life,
            0.8 + this.random() * 1.4,
        ], slot * STRIDE);
        this.stats.flown += 1;
        return true;
    }

    /**
     * Take the director's frame: a `flush` cue startles the flock (each serial once).
     * @param {object} [frame]
     * @param {{ time?: number, stage?: object | null }} [options]
     */
    play(frame = {}, { time, stage = null } = {}) {
        this.time = Number.isFinite(time) ? time : this.time;
        const fx = frame && typeof frame === 'object' && frame.fx && typeof frame.fx === 'object' ? frame.fx : null;
        if (!fx) return;
        if (fx.epoch !== this.epoch) {
            this.epoch = fx.epoch;
            this.serial = -1;
        }
        const queue = Array.isArray(fx.cues) ? fx.cues : [];
        let newest = this.serial;
        for (let i = 0; i < queue.length; i += 1) {
            const cue = queue[i];
            if (cue && cue.kind === 'flush' && cue.serial > this.serial) {
                newest = Math.max(newest, cue.serial);
                // Reduced motion keeps the flock (it is the event's own form), a smaller one.
                const motion = Number.isFinite(frame.motion) ? Math.max(0, Math.min(1, frame.motion)) : 1;
                this.burst(cue.strength * (0.5 + 0.5 * motion), stage);
            }
        }
        this.serial = newest;
    }

    /** Birds in the air at the flock's clock, and how many have flown and been let go. */
    counts() {
        let flying = 0;
        if (this.ends) for (let i = 0; i < this.capacity; i += 1) if (this.ends[i] > this.time) flying += 1;
        return { flying, ...this.stats };
    }

    /** Forget every bird in the air (the effects setting off, a seek). */
    reset() {
        this.serial = -1;
        this.epoch = null;
        if (!this.capacity) return;
        this.data.fill(0);
        this.ends.fill(-Infinity);
        this.cursor = 0;
        this.buffer.needsUpdate = true;
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
        this.capacity = 0;
    }
}

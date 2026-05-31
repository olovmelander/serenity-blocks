/* eslint-disable import/no-unresolved */
/**
 * Lunara Theme — GPU compute module.
 *
 * Drives floating motes drifting upward through the alien valley.
 * WebGPU only; the orchestrator falls back to a CPU buffer animation when
 * compute is unavailable.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    cos,
    float,
    fract,
    instanceIndex,
    sin,
    storage,
    uniform,
    vec3,
} from 'three/tsl';
import { curl3 } from './lunara-noise.js';

export class LunaraMoteCompute {
    constructor(particleCount, bounds = {}, randomFn = Math.random) {
        this.capacity = Math.max(1, particleCount);
        this.count = this.capacity;
        this.bounds = {
            width: bounds.width ?? 220,
            height: bounds.height ?? 80,
            depth: bounds.depth ?? 240,
        };
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;

        this.positionData = new Float32Array(this.capacity * 4);
        this.velocityData = new Float32Array(this.capacity * 4);
        this.randomData = new Float32Array(this.capacity * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.randomBuffer = new THREE.StorageBufferAttribute(this.randomData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uDrift = uniform(1.0);

        this.computeNode = null;
        this.seedInitialState();
        this.createComputeNode();
    }

    seedInitialState() {
        for (let i = 0; i < this.capacity; i++) {
            const i4 = i * 4;
            const r1 = this.random();
            const r2 = this.random();
            const r3 = this.random();
            const r4 = this.random();

            this.positionData[i4] = (r1 - 0.5) * this.bounds.width;
            this.positionData[i4 + 1] = (r2 - 0.5) * this.bounds.height;
            this.positionData[i4 + 2] = (r3 - 0.5) * this.bounds.depth;
            this.positionData[i4 + 3] = 1.0;

            this.velocityData[i4] = (this.random() - 0.5) * 0.4;
            this.velocityData[i4 + 1] = 0.4 + this.random() * 0.6;
            this.velocityData[i4 + 2] = (this.random() - 0.5) * 0.3;
            this.velocityData[i4 + 3] = 0.0;

            this.randomData[i4] = r4;
            this.randomData[i4 + 1] = 0.6 + this.random() * 0.8;
            this.randomData[i4 + 2] = this.random();
            this.randomData[i4 + 3] = 0.0;
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.randomBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const randoms = storage(this.randomBuffer, 'vec4', this.count);

        const time = this.uTime;
        const delta = this.uDelta;
        const drift = this.uDrift;

        const halfW = float(this.bounds.width * 0.5);
        const halfH = float(this.bounds.height * 0.5);
        const halfD = float(this.bounds.depth * 0.5);

        const compute = Fn(() => {
            const idx = instanceIndex;
            const pos = positions.element(idx).toVar();
            const vel = velocities.element(idx).toVar();
            const rand = randoms.element(idx).toVar();

            const swayX = sin(time.mul(0.6).add(rand.x.mul(6.283185))).mul(0.4).mul(drift);
            const swayZ = cos(time.mul(0.45).add(rand.x.mul(5.1))).mul(0.3).mul(drift);

            // Curl-noise advection for organic, swirling drift (not pure sway).
            const curl = curl3(
                vec3(pos.x, pos.y, pos.z).mul(0.02).add(vec3(0.0, time.mul(0.05), 0.0)),
            ).mul(drift);

            pos.x.addAssign(vel.x.add(swayX).add(curl.x.mul(0.35)).mul(delta));
            pos.y.addAssign(vel.y.add(curl.y.mul(0.12)).mul(delta));
            pos.z.addAssign(vel.z.add(swayZ).add(curl.z.mul(0.35)).mul(delta));

            const oob = pos.y.greaterThan(halfH)
                .or(abs(pos.x).greaterThan(halfW))
                .or(abs(pos.z).greaterThan(halfD));

            If(oob, () => {
                const seed = float(idx).add(time.mul(0.13)).add(rand.x.mul(57.23));
                const r1 = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                const r2 = fract(sin(seed.mul(78.233)).mul(43758.5453));
                const r3 = fract(sin(seed.mul(39.425)).mul(43758.5453));

                pos.x.assign(r1.sub(0.5).mul(halfW.mul(2.0)));
                pos.y.assign(halfH.negate());
                pos.z.assign(r2.sub(0.5).mul(halfD.mul(2.0)));
                pos.w.assign(1.0);
                vel.y.assign(float(0.4).add(r3.mul(0.6)));
            });

            positions.element(idx).assign(pos);
            velocities.element(idx).assign(vel);
        });

        this.computeNode = compute().compute(this.count);
    }

    setActiveCount(count) {
        const next = Math.max(1, Math.min(this.capacity, Math.floor(count)));
        if (next === this.count) return false;
        this.count = next;
        this.computeNode = null;
        this.createComputeNode();
        return true;
    }

    update(deltaSeconds, time) {
        this.uDelta.value = Math.max(0, Math.min(0.05, deltaSeconds));
        this.uTime.value = time;
    }

    setDrift(value) {
        this.uDrift.value = value;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getRandomBuffer() {
        return this.randomBuffer;
    }

    dispose() {
        this.computeNode = null;
        // StorageBufferAttribute does not require explicit disposal beyond
        // dropping references; Three's WebGPU backend reclaims on GC.
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.randomBuffer = null;
    }
}

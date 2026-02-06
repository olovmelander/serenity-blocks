/**
 * Winter Wonderland Theme - GPU Compute Shaders
 * WebGPU compute shaders for snow particle simulation
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    float,
    sin,
    fract,
    abs,
    If,
} from 'three/tsl';

export class SnowParticleCompute {
    constructor(particleCount, bounds) {
        this.capacity = particleCount;
        this.count = particleCount;
        this.bounds = bounds;

        // Position buffer (vec4: x, y, z, unused)
        this.positionData = new Float32Array(particleCount * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        // Velocity buffer (vec4: vx, vy, vz, unused)
        this.velocityData = new Float32Array(particleCount * 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);

        // Uniforms
        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uWindForce = uniform(0);
        this.uGustIntensity = uniform(0);

        this.computeNode = null;
    }

    setActiveCount(count) {
        const next = Math.max(1, Math.min(this.capacity, Math.floor(count)));
        if (next === this.count) return false;
        this.count = next;
        this.computeNode = null;
        this.createComputeNode();
        return true;
    }

    /**
     * Initialize storage buffers from CPU-generated arrays
     */
    setInitialState(positionArray, velocityArray) {
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            this.positionData[i4] = positionArray[i3];
            this.positionData[i4 + 1] = positionArray[i3 + 1];
            this.positionData[i4 + 2] = positionArray[i3 + 2];
            this.positionData[i4 + 3] = 1.0;

            this.velocityData[i4] = velocityArray[i3] || 0.0;
            this.velocityData[i4 + 1] = velocityArray[i3 + 1] || 0.0;
            this.velocityData[i4 + 2] = velocityArray[i3 + 2] || 0.0;
            this.velocityData[i4 + 3] = 0.0;
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    /**
     * Create compute node (WebGPU only)
     */
    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);

        const time = this.uTime;
        const delta = this.uDelta;
        const width = float(this.bounds.width);
        const halfHeight = float(this.bounds.height * 0.5);
        const depth = float(this.bounds.depth);

        const computeSnow = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();

            // Basic integration
            pos.x.addAssign(vel.x.mul(delta));
            pos.y.addAssign(vel.y.mul(delta));
            pos.z.addAssign(vel.z.mul(delta));

            const outOfBounds = pos.y.lessThan(halfHeight.negate())
                .or(abs(pos.x).greaterThan(width))
                .or(pos.z.greaterThan(200.0));

            If(outOfBounds, () => {
                const seed = float(index).add(time.mul(0.1));
                const rand1 = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                const rand2 = fract(sin(seed.mul(78.233)).mul(43758.5453));
                const rand3 = fract(sin(seed.mul(39.346)).mul(43758.5453));
                const randVel = fract(sin(seed.mul(15.873)).mul(43758.5453));

                pos.x.assign(rand1.sub(0.5).mul(width));
                pos.y.assign(halfHeight.add(rand2.mul(50.0)));
                pos.z.assign(rand3.sub(0.5).mul(depth).sub(200.0));
                vel.y.assign(randVel.mul(-25.0).sub(15.0));
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
        });

        this.computeNode = computeSnow().compute(this.count);
        return this.computeNode;
    }

    /**
     * Update uniforms for GPU compute
     */
    update(time, delta, windForce, gustIntensity) {
        this.uTime.value = time;
        this.uDelta.value = delta;
        if (windForce !== undefined) this.uWindForce.value = windForce;
        if (gustIntensity !== undefined) this.uGustIntensity.value = gustIntensity;
    }

    /**
     * CPU fallback update (mirrors existing snow update logic)
     */
    updateCPU(delta) {
        const b = this.bounds;
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;
            this.positionData[i4] += this.velocityData[i4] * delta;
            this.positionData[i4 + 1] += this.velocityData[i4 + 1] * delta;
            this.positionData[i4 + 2] += this.velocityData[i4 + 2] * delta;
            if (
                this.positionData[i4 + 1] < -b.height / 2
                || Math.abs(this.positionData[i4]) > b.width
                || this.positionData[i4 + 2] > 200
            ) {
                this.positionData[i4] = (Math.random() - 0.5) * b.width;
                this.positionData[i4 + 1] = b.height / 2 + Math.random() * 50;
                this.positionData[i4 + 2] = (Math.random() - 0.5) * b.depth - 200;
                this.velocityData[i4 + 1] = -(15 + Math.random() * 25);
            }
        }
        this.positionBuffer.needsUpdate = true;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getPositionData() {
        return this.positionData;
    }

    getVelocityData() {
        return this.velocityData;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.positionData = null;
        this.velocityData = null;
    }
}

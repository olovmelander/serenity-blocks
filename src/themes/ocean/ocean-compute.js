/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, max-classes-per-file */
/**
 * Ocean Theme — GPU Compute Shaders (WebGPU only)
 *
 * Compute classes for fish flocking, plankton drift, and bubble buoyancy.
 * Mirrors winter-compute.js / black-hole-compute.js patterns:
 *   - StorageBufferAttribute for position/velocity
 *   - Fn() compute kernel → .compute(count)
 *   - CPU fallback methods
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    float,
    sin,
    cos,
    fract,
    abs,
    If,
    clamp,
} from 'three/tsl';

// ═══════════════════════════════════════════════════════════════════════════════
// Fish Flocking Compute (All-Pairs)
// ═══════════════════════════════════════════════════════════════════════════════

export class OceanFishCompute {
    constructor(fishCount, bounds = {}) {
        this.capacity = fishCount;
        this.count = fishCount;
        this.bounds = {
            areaX: bounds.areaX ?? 135,
            areaZ: bounds.areaZ ?? 135,
            surfaceY: bounds.surfaceY ?? 60,
            floorY: bounds.floorY ?? -25,
        };

        // Position buffer (vec4: x, y, z, speed)
        this.positionData = new Float32Array(fishCount * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        // Velocity buffer (vec4: vx, vy, vz, schoolIndex)
        this.velocityData = new Float32Array(fishCount * 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);

        // Uniforms
        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uCurrentStrength = uniform(0.5);

        this.computeNode = null;
    }

    /**
     * Initialize buffers from CPU arrays.
     */
    setInitialState(positions, velocities, speeds, schoolIndices) {
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = speeds?.[i] ?? 5.0;
            this.velocityData[i4] = velocities[i3];
            this.velocityData[i4 + 1] = velocities[i3 + 1];
            this.velocityData[i4 + 2] = velocities[i3 + 2];
            this.velocityData[i4 + 3] = schoolIndices?.[i] ?? 0;
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const areaX = float(this.bounds.areaX);
        const areaZ = float(this.bounds.areaZ);
        const surfaceY = float(this.bounds.surfaceY);
        const floorY = float(this.bounds.floorY);

        const computeFish = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();

            // Simple integration (all-pairs separation would go here in Phase 5)
            pos.x.addAssign(vel.x.mul(delta));
            pos.y.addAssign(vel.y.mul(delta));
            pos.z.addAssign(vel.z.mul(delta));

            // Boundary enforcement
            If(abs(pos.x).greaterThan(areaX), () => {
                vel.x.assign(vel.x.negate().mul(0.8));
                pos.x.assign(clamp(pos.x, areaX.negate(), areaX));
            });
            If(abs(pos.z).greaterThan(areaZ), () => {
                vel.z.assign(vel.z.negate().mul(0.8));
                pos.z.assign(clamp(pos.z, areaZ.negate(), areaZ));
            });
            If(pos.y.greaterThan(surfaceY), () => {
                vel.y.assign(vel.y.negate().mul(0.6));
                pos.y.assign(surfaceY);
            });
            If(pos.y.lessThan(floorY), () => {
                vel.y.assign(vel.y.negate().mul(0.6));
                pos.y.assign(floorY);
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
        });

        this.computeNode = computeFish().compute(this.count);
        return this.computeNode;
    }

    update(time, delta) {
        this.uTime.value = time;
        this.uDelta.value = delta;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getVelocityBuffer() {
        return this.velocityBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.positionData = null;
        this.velocityData = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Plankton Compute (Curl Noise Drift)
// ═══════════════════════════════════════════════════════════════════════════════

export class OceanPlanktonCompute {
    constructor(count, bounds = {}) {
        this.capacity = count;
        this.count = count;
        this.bounds = {
            width: bounds.width ?? 200,
            height: bounds.height ?? 90,
            depth: bounds.depth ?? 200,
        };

        this.positionData = new Float32Array(count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.computeNode = null;
    }

    setInitialState(positionArray) {
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            this.positionData[i4] = positionArray[i3];
            this.positionData[i4 + 1] = positionArray[i3 + 1];
            this.positionData[i4 + 2] = positionArray[i3 + 2];
            this.positionData[i4 + 3] = 1.0;
        }
        this.positionBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const time = this.uTime;
        const delta = this.uDelta;
        const halfW = float(this.bounds.width * 0.5);
        const halfH = float(this.bounds.height * 0.5);
        const halfD = float(this.bounds.depth * 0.5);

        const computePlankton = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();

            // Curl-noise-like drift
            const seed = float(index).mul(0.0137);
            const driftX = sin(time.mul(0.12).add(seed)).mul(0.4);
            const driftY = sin(time.mul(0.09).add(seed.mul(1.7))).mul(0.2);
            const driftZ = cos(time.mul(0.1).add(seed.mul(0.8))).mul(0.35);

            pos.x.addAssign(driftX.mul(delta));
            pos.y.addAssign(driftY.mul(delta));
            pos.z.addAssign(driftZ.mul(delta));

            // Wrap
            If(abs(pos.x).greaterThan(halfW), () => {
                pos.x.assign(pos.x.negate());
            });
            If(abs(pos.y).greaterThan(halfH), () => {
                pos.y.assign(pos.y.negate());
            });
            If(abs(pos.z).greaterThan(halfD), () => {
                pos.z.assign(pos.z.negate());
            });

            positions.element(index).assign(pos);
        });

        this.computeNode = computePlankton().compute(this.count);
        return this.computeNode;
    }

    update(time, delta) {
        this.uTime.value = time;
        this.uDelta.value = delta;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.positionData = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bubble Compute (Buoyancy + Curl)
// ═══════════════════════════════════════════════════════════════════════════════

export class OceanBubbleCompute {
    constructor(count, bounds = {}) {
        this.capacity = count;
        this.count = count;
        this.bounds = {
            width: bounds.width ?? 200,
            surfaceY: bounds.surfaceY ?? 65,
            floor: bounds.floor ?? -20,
            depth: bounds.depth ?? 200,
        };

        this.positionData = new Float32Array(count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.computeNode = null;
    }

    setInitialState(positionArray) {
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            this.positionData[i4] = positionArray[i3];
            this.positionData[i4 + 1] = positionArray[i3 + 1];
            this.positionData[i4 + 2] = positionArray[i3 + 2];
            this.positionData[i4 + 3] = 1.0;
        }
        this.positionBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const time = this.uTime;
        const delta = this.uDelta;
        const halfW = float(this.bounds.width * 0.5);
        const surfaceY = float(this.bounds.surfaceY);
        const floorY = float(this.bounds.floor);
        const halfD = float(this.bounds.depth * 0.5);

        const computeBubbles = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();

            // Buoyancy — rises with slight wobble
            const seed = float(index).mul(0.0213);
            const riseSpeed = float(8.0).add(fract(sin(seed.mul(43758.5453))).mul(6.0));
            pos.y.addAssign(riseSpeed.mul(delta));

            // Wobble
            pos.x.addAssign(
                sin(time.mul(1.2).add(seed.mul(6.28)))
                    .mul(0.3)
                    .mul(delta),
            );
            pos.z.addAssign(
                cos(time.mul(0.9).add(seed.mul(4.8)))
                    .mul(0.25)
                    .mul(delta),
            );

            // Respawn at bottom when hitting surface
            If(pos.y.greaterThan(surfaceY), () => {
                const rand1 = fract(sin(seed.add(time.mul(0.1)).mul(12.9898)).mul(43758.5453));
                const rand2 = fract(sin(seed.add(time.mul(0.1)).mul(78.233)).mul(43758.5453));
                pos.x.assign(rand1.sub(0.5).mul(halfW.mul(2.0)));
                pos.y.assign(floorY.add(rand2.mul(5.0)));
                pos.z.assign(
                    fract(sin(seed.mul(39.346)).mul(43758.5453))
                        .sub(0.5)
                        .mul(halfD.mul(2.0)),
                );
            });

            positions.element(index).assign(pos);
        });

        this.computeNode = computeBubbles().compute(this.count);
        return this.computeNode;
    }

    update(time, delta) {
        this.uTime.value = time;
        this.uDelta.value = delta;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.positionData = null;
    }
}

/**
 * Stellar Velocity - Compute Foundations (Phase 5)
 *
 * This module centralizes compute budgets and aligned buffer layout contracts.
 * Runtime compute kernels are introduced incrementally in later Phase 5 slices.
 */

import * as THREE_WEBGPU from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    float,
    clamp,
    abs,
    step,
    fract,
    sin,
    cos,
    max,
    If,
} from 'three/tsl';

export const STELLAR_VELOCITY_COMPUTE_BUDGETS = {
    Extreme: {
        maxStars: 8000,
        maxBurstParticles: 50000,
        maxAsteroids: 600,
        computeEnabled: true,
    },
    Ultra: {
        maxStars: 6000,
        maxBurstParticles: 40000,
        maxAsteroids: 500,
        computeEnabled: true,
    },
    High: {
        maxStars: 5000,
        maxBurstParticles: 30000,
        maxAsteroids: 400,
        computeEnabled: true,
    },
    Medium: {
        maxStars: 3000,
        maxBurstParticles: 15000,
        maxAsteroids: 250,
        computeEnabled: true,
    },
    Low: {
        maxStars: 1500,
        maxBurstParticles: 5000,
        maxAsteroids: 120,
        computeEnabled: false,
    },
    Minimal: {
        maxStars: 800,
        maxBurstParticles: 2000,
        maxAsteroids: 60,
        computeEnabled: false,
    },
};

// All compute storage entries are vec4-packed (16-byte aligned) for WGSL safety.
export const STELLAR_VELOCITY_COMPUTE_LAYOUT = {
    starState: {
        strideBytes: 32,
        fields: {
            positionSeed: { offsetBytes: 0, format: 'vec4<f32>' }, // xyz + respawn seed
            motionTwinkle: { offsetBytes: 16, format: 'vec4<f32>' }, // velocity, twinklePhase, twinkleSpeed, streakFactor
        },
    },
    burstState: {
        strideBytes: 32,
        fields: {
            positionLife: { offsetBytes: 0, format: 'vec4<f32>' }, // xyz + normalized life
            velocityLife: { offsetBytes: 16, format: 'vec4<f32>' }, // xyz + maxLifeSeconds
        },
    },
};

export function getStellarVelocityComputeBudget(quality = 'High') {
    return STELLAR_VELOCITY_COMPUTE_BUDGETS[quality] || STELLAR_VELOCITY_COMPUTE_BUDGETS.High;
}

export function createAlignedStorageBuffer(entryCount, vec4sPerEntry = 1, initialData = null) {
    const safeEntryCount = Math.max(0, Math.floor(entryCount));
    const safeVec4sPerEntry = Math.max(1, Math.floor(vec4sPerEntry));
    const floatCount = safeEntryCount * safeVec4sPerEntry * 4;
    const data = initialData instanceof Float32Array && initialData.length === floatCount
        ? initialData
        : new Float32Array(floatCount);
    return new THREE_WEBGPU.StorageBufferAttribute(data, 4);
}

export class StellarVelocityStarfieldCompute {
    constructor(starCount, params = {}) {
        this.count = Math.max(0, Math.floor(starCount));
        this.random = typeof params.random === 'function' ? params.random : Math.random;

        // vec4: x, y, z, seed
        this.positionData = new Float32Array(this.count * 4);
        // vec4: velocityFactor, twinklePhase, twinkleSpeed, streakFactor
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = createAlignedStorageBuffer(this.count, 1, this.positionData);
        this.miscBuffer = createAlignedStorageBuffer(this.count, 1, this.miscData);

        this.uWarpStep = uniform(params.warpStep ?? 0.3);
        this.uDelta = uniform(params.delta ?? 0.016);
        this.uTunnelRadius = uniform(params.tunnelRadius ?? 1500);
        this.uMinRadius = uniform(params.minRadius ?? 100);
        this.uResetZ = uniform(params.resetZ ?? 1000);
        this.uSpawnZ = uniform(params.spawnZ ?? -8000);
        this.uTime = uniform(params.time ?? 0);
        this.uNearBandCutoff = uniform(params.nearBandCutoff ?? 0.22);
        this.uMidBandCutoff = uniform(params.midBandCutoff ?? 0.70);
        this.uNearRadiusMin = uniform(params.nearRadiusMin ?? 80);
        this.uMidRadiusMin = uniform(params.midRadiusMin ?? 120);
        this.uFarRadiusMin = uniform(params.farRadiusMin ?? 260);
        this.uNearRadiusScale = uniform(params.nearRadiusScale ?? 0.55);
        this.uMidRadiusScale = uniform(params.midRadiusScale ?? 0.85);
        this.uFarRadiusScale = uniform(params.farRadiusScale ?? 1.25);
        this.uNearZMin = uniform(params.nearZMin ?? -600);
        this.uMidZMin = uniform(params.midZMin ?? -1200);
        this.uFarZMin = uniform(params.farZMin ?? -2500);
        this.uNearZSpan = uniform(params.nearZSpan ?? 2600);
        this.uMidZSpan = uniform(params.midZSpan ?? 4200);
        this.uFarZSpan = uniform(params.farZSpan ?? 6500);

        this.computeNode = null;
    }

    setInitialState(positions, velocityFactors, twinkleData = null) {
        if (!(positions instanceof Float32Array)) return;
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i2 = i * 2;
            const i4 = i * 4;
            this.positionData[i4] = positions[i3] || 0;
            this.positionData[i4 + 1] = positions[i3 + 1] || 0;
            this.positionData[i4 + 2] = positions[i3 + 2] || this.uSpawnZ.value;
            this.positionData[i4 + 3] = this.random();
            this.miscData[i4] = velocityFactors?.[i] ?? 1.0;
            this.miscData[i4 + 1] = twinkleData?.[i2] ?? (this.random() * Math.PI * 2);
            this.miscData[i4 + 2] = twinkleData?.[i2 + 1] ?? (1.0 + this.random() * 2.0);
            this.miscData[i4 + 3] = 1.0;
        }
        this.positionBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const misc = storage(this.miscBuffer, 'vec4', this.count);
        const warpStep = this.uWarpStep;
        const delta = this.uDelta;
        const tunnelRadius = this.uTunnelRadius;
        const resetZ = this.uResetZ;
        const time = this.uTime;
        const nearBandCutoff = this.uNearBandCutoff;
        const midBandCutoff = this.uMidBandCutoff;
        const nearRadiusMin = this.uNearRadiusMin;
        const midRadiusMin = this.uMidRadiusMin;
        const farRadiusMin = this.uFarRadiusMin;
        const nearRadiusScale = this.uNearRadiusScale;
        const midRadiusScale = this.uMidRadiusScale;
        const farRadiusScale = this.uFarRadiusScale;
        const nearZMin = this.uNearZMin;
        const midZMin = this.uMidZMin;
        const farZMin = this.uFarZMin;
        const nearZSpan = this.uNearZSpan;
        const midZSpan = this.uMidZSpan;
        const farZSpan = this.uFarZSpan;

        const computeStars = Fn(() => {
            const index = instanceIndex;
            const indexF = float(index);
            const pos = positions.element(index).toVar();
            const state = misc.element(index).toVar();

            pos.z.addAssign(warpStep.mul(max(state.x, float(0.15))));
            state.y.addAssign(state.z.mul(delta).mul(float(60.0)));
            state.w.assign(
                clamp(
                    float(1.0).add(warpStep.mul(max(state.x, float(0.1))).mul(0.08)),
                    float(1.0),
                    float(4.0),
                ),
            );

            If(pos.z.greaterThan(resetZ), () => {
                const seedA = fract(
                    sin(indexF.mul(12.9898).add(pos.w.mul(78.233)).add(time.mul(0.371))).mul(43758.5453),
                );
                const seedB = fract(
                    sin(indexF.mul(39.346).add(pos.w.mul(11.135)).add(time.mul(0.617))).mul(24634.6345),
                );
                const seedC = fract(
                    sin(indexF.mul(73.156).add(pos.w.mul(19.917)).add(time.mul(0.191))).mul(19534.7912),
                );
                const bandRadiusMin = farRadiusMin.toVar();
                const bandRadiusMax = max(tunnelRadius.mul(farRadiusScale), farRadiusMin.add(float(1.0))).toVar();
                const bandZMin = farZMin.toVar();
                const bandZSpan = farZSpan.toVar();

                If(seedC.lessThan(midBandCutoff), () => {
                    bandRadiusMin.assign(midRadiusMin);
                    bandRadiusMax.assign(max(tunnelRadius.mul(midRadiusScale), midRadiusMin.add(float(1.0))));
                    bandZMin.assign(midZMin);
                    bandZSpan.assign(midZSpan);
                });
                If(seedC.lessThan(nearBandCutoff), () => {
                    bandRadiusMin.assign(nearRadiusMin);
                    bandRadiusMax.assign(max(tunnelRadius.mul(nearRadiusScale), nearRadiusMin.add(float(1.0))));
                    bandZMin.assign(nearZMin);
                    bandZSpan.assign(nearZSpan);
                });

                const radius = bandRadiusMin.add(seedB.mul(max(bandRadiusMax.sub(bandRadiusMin), float(1.0))));
                const angle = seedA.mul(6.28318530718);
                pos.x.assign(cos(angle).mul(radius));
                pos.y.assign(sin(angle).mul(radius));
                pos.z.assign(bandZMin.sub(seedA.mul(bandZSpan)));
                pos.w.assign(seedC);
                state.y.assign(seedC.mul(6.28318530718));
            });

            positions.element(index).assign(pos);
            misc.element(index).assign(state);
        });

        this.computeNode = computeStars().compute(this.count);
        return this.computeNode;
    }

    update(params = {}) {
        if (params.warpStep !== undefined) this.uWarpStep.value = params.warpStep;
        if (params.delta !== undefined) this.uDelta.value = params.delta;
        if (params.tunnelRadius !== undefined) this.uTunnelRadius.value = params.tunnelRadius;
        if (params.minRadius !== undefined) this.uMinRadius.value = params.minRadius;
        if (params.resetZ !== undefined) this.uResetZ.value = params.resetZ;
        if (params.spawnZ !== undefined) this.uSpawnZ.value = params.spawnZ;
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.nearBandCutoff !== undefined) this.uNearBandCutoff.value = params.nearBandCutoff;
        if (params.midBandCutoff !== undefined) this.uMidBandCutoff.value = params.midBandCutoff;
        if (params.nearRadiusMin !== undefined) this.uNearRadiusMin.value = params.nearRadiusMin;
        if (params.midRadiusMin !== undefined) this.uMidRadiusMin.value = params.midRadiusMin;
        if (params.farRadiusMin !== undefined) this.uFarRadiusMin.value = params.farRadiusMin;
        if (params.nearRadiusScale !== undefined) this.uNearRadiusScale.value = params.nearRadiusScale;
        if (params.midRadiusScale !== undefined) this.uMidRadiusScale.value = params.midRadiusScale;
        if (params.farRadiusScale !== undefined) this.uFarRadiusScale.value = params.farRadiusScale;
        if (params.nearZMin !== undefined) this.uNearZMin.value = params.nearZMin;
        if (params.midZMin !== undefined) this.uMidZMin.value = params.midZMin;
        if (params.farZMin !== undefined) this.uFarZMin.value = params.farZMin;
        if (params.nearZSpan !== undefined) this.uNearZSpan.value = params.nearZSpan;
        if (params.midZSpan !== undefined) this.uMidZSpan.value = params.midZSpan;
        if (params.farZSpan !== undefined) this.uFarZSpan.value = params.farZSpan;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.miscData = null;
    }
}

export class StellarVelocityBurstCompute {
    constructor(particleCount, params = {}) {
        this.count = Math.max(0, Math.floor(particleCount));
        this.random = typeof params.random === 'function' ? params.random : Math.random;

        // Ping-pong state buffers:
        // vec4 positionLife: x, y, z, life01
        // vec4 velocityLife: vx, vy, vz, maxLifeSeconds
        this.positionDataA = new Float32Array(this.count * 4);
        this.positionDataB = new Float32Array(this.count * 4);
        this.velocityDataA = new Float32Array(this.count * 4);
        this.velocityDataB = new Float32Array(this.count * 4);

        this.positionBuffers = [
            createAlignedStorageBuffer(this.count, 1, this.positionDataA),
            createAlignedStorageBuffer(this.count, 1, this.positionDataB),
        ];
        this.velocityBuffers = [
            createAlignedStorageBuffer(this.count, 1, this.velocityDataA),
            createAlignedStorageBuffer(this.count, 1, this.velocityDataB),
        ];

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uDamping = uniform(params.damping ?? 0.986);
        this.uSpeedScale = uniform(params.speedScale ?? 60);
        this.uBurstTrigger = uniform(new THREE_WEBGPU.Vector4(0, 0, -500, -1));
        this.uBurstStart = uniform(0);
        this.uBurstCount = uniform(0);
        this.uBurstSpeedMin = uniform(30);
        this.uBurstSpeedMax = uniform(80);
        this.uBurstLifeMin = uniform(1.6);
        this.uBurstLifeMax = uniform(3.2);
        this.uBurstZBias = uniform(0.3);
        this.uDisplayBufferIndex = uniform(0);

        this.computeNode = null;
        this.computeNodes = [];
        this.dispatchIndex = 0;
        this.nextSpawnIndex = 0;
        this.reset();
    }

    reset() {
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;
            this.positionDataA[i4] = 0;
            this.positionDataA[i4 + 1] = 0;
            this.positionDataA[i4 + 2] = -9999;
            this.positionDataA[i4 + 3] = 0;
            this.positionDataB[i4] = 0;
            this.positionDataB[i4 + 1] = 0;
            this.positionDataB[i4 + 2] = -9999;
            this.positionDataB[i4 + 3] = 0;
            this.velocityDataA[i4] = 0;
            this.velocityDataA[i4 + 1] = 0;
            this.velocityDataA[i4 + 2] = 0;
            this.velocityDataA[i4 + 3] = 1;
            this.velocityDataB[i4] = 0;
            this.velocityDataB[i4 + 1] = 0;
            this.velocityDataB[i4 + 2] = 0;
            this.velocityDataB[i4 + 3] = 1;
        }
        this.positionBuffers[0].needsUpdate = true;
        this.positionBuffers[1].needsUpdate = true;
        this.velocityBuffers[0].needsUpdate = true;
        this.velocityBuffers[1].needsUpdate = true;
        this.dispatchIndex = 0;
        this.uDisplayBufferIndex.value = 0;
        this.uBurstTrigger.value.set(0, 0, -500, -1);
        this.uBurstCount.value = 0;
    }

    createComputeNode() {
        const buildComputeNode = (readIndex, writeIndex) => {
            const readPositions = storage(this.positionBuffers[readIndex], 'vec4', this.count);
            const readVelocities = storage(this.velocityBuffers[readIndex], 'vec4', this.count);
            const writePositions = storage(this.positionBuffers[writeIndex], 'vec4', this.count);
            const writeVelocities = storage(this.velocityBuffers[writeIndex], 'vec4', this.count);
            const delta = this.uDelta;
            const time = this.uTime;
            const damping = this.uDamping;
            const speedScale = this.uSpeedScale;
            const burstTrigger = this.uBurstTrigger;
            const burstStart = this.uBurstStart;
            const burstCount = this.uBurstCount;
            const burstSpeedMin = this.uBurstSpeedMin;
            const burstSpeedMax = this.uBurstSpeedMax;
            const burstLifeMin = this.uBurstLifeMin;
            const burstLifeMax = this.uBurstLifeMax;
            const burstZBias = this.uBurstZBias;

            const computeBurst = Fn(() => {
                const index = instanceIndex;
                const indexF = float(index);
                const pos = readPositions.element(index).toVar();
                const vel = readVelocities.element(index).toVar();

                const triggerTime = burstTrigger.w;
                const triggerActive = step(float(0.0), triggerTime);
                const triggerMatch = triggerActive.mul(step(triggerTime, time));
                const inStart = step(float(burstStart), indexF);
                const inEnd = step(indexF, float(burstStart).add(float(burstCount)).sub(float(1.0)));
                const spawnMask = triggerMatch.mul(inStart).mul(inEnd);

                const active = pos.w;
                If(active.greaterThan(float(0.0)), () => {
                    pos.x.addAssign(vel.x.mul(delta).mul(speedScale));
                    pos.y.addAssign(vel.y.mul(delta).mul(speedScale));
                    pos.z.addAssign(vel.z.mul(delta).mul(speedScale));

                    vel.x.assign(vel.x.mul(damping));
                    vel.y.assign(vel.y.mul(damping));
                    vel.z.assign(vel.z.mul(damping));

                    const lifeStep = delta.div(max(vel.w, float(0.0001)));
                    pos.w.assign(pos.w.sub(lifeStep));
                    If(pos.w.lessThanEqual(float(0.0)), () => {
                        pos.w.assign(0.0);
                        pos.z.assign(-9999.0);
                    });
                });

                If(spawnMask.greaterThan(float(0.5)), () => {
                    const seedA = fract(
                        sin(indexF.mul(12.9898).add(time.mul(0.913)).add(float(burstStart).mul(0.117))).mul(43758.5453),
                    );
                    const seedB = fract(
                        sin(indexF.mul(39.346).add(time.mul(0.541)).add(float(burstCount).mul(0.073))).mul(24634.6345),
                    );
                    const seedC = fract(
                        sin(indexF.mul(73.156).add(time.mul(0.317)).add(float(burstStart).mul(0.211))).mul(19534.7912),
                    );
                    const angle = seedA.mul(6.28318530718);
                    const speed = burstSpeedMin.add(seedB.mul(max(burstSpeedMax.sub(burstSpeedMin), float(0.0001))));
                    const lifeMax = burstLifeMin.add(seedC.mul(max(burstLifeMax.sub(burstLifeMin), float(0.0001))));

                    pos.x.assign(burstTrigger.x);
                    pos.y.assign(burstTrigger.y);
                    pos.z.assign(burstTrigger.z);
                    pos.w.assign(1.0);

                    vel.x.assign(cos(angle).mul(speed));
                    vel.y.assign(sin(angle).mul(speed));
                    vel.z.assign(seedC.sub(burstZBias).mul(speed).mul(0.5));
                    vel.w.assign(lifeMax);
                });

                writePositions.element(index).assign(pos);
                writeVelocities.element(index).assign(vel);
            });

            return computeBurst().compute(this.count);
        };

        this.computeNodes = [
            buildComputeNode(0, 1),
            buildComputeNode(1, 0),
        ];
        this.computeNode = this.computeNodes[0];
        return this.computeNode;
    }

    update(params = {}) {
        if (params.delta !== undefined) this.uDelta.value = params.delta;
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.damping !== undefined) this.uDamping.value = params.damping;
        if (params.speedScale !== undefined) this.uSpeedScale.value = params.speedScale;
    }

    triggerBurst(params = {}) {
        this.queueBurst(params);
    }

    queueBurst(params = {}) {
        const originInput = params.origin || { x: 0, y: 0, z: -500 };
        const origin = {
            x: Number.isFinite(originInput.x) ? originInput.x : 0,
            y: Number.isFinite(originInput.y) ? originInput.y : 0,
            z: Number.isFinite(originInput.z) ? originInput.z : -500,
        };
        const count = Math.max(0, Math.min(this.count, Math.floor(params.count ?? 0)));
        const speedMinInput = Number.isFinite(params.speedMin) ? params.speedMin : 30;
        const speedMaxInput = Number.isFinite(params.speedMax) ? params.speedMax : 80;
        const speedMin = Math.min(speedMinInput, speedMaxInput);
        const speedMax = Math.max(speedMinInput, speedMaxInput);
        const lifeMinInput = Number.isFinite(params.lifeMin) ? params.lifeMin : 1.6;
        const lifeMaxInput = Number.isFinite(params.lifeMax) ? params.lifeMax : 3.2;
        const lifeMin = Math.min(lifeMinInput, lifeMaxInput);
        const lifeMax = Math.max(lifeMinInput, lifeMaxInput);
        const zBias = Number.isFinite(params.zBias) ? params.zBias : 0.3;
        const time = Number.isFinite(params.time) ? params.time : this.uTime.value;

        if (count <= 0) return;

        if (this.nextSpawnIndex + count > this.count) {
            this.nextSpawnIndex = 0;
        }

        this.uBurstTrigger.value.set(origin.x, origin.y, origin.z, time);
        this.uBurstStart.value = this.nextSpawnIndex;
        this.uBurstCount.value = count;
        this.uBurstSpeedMin.value = speedMin;
        this.uBurstSpeedMax.value = speedMax;
        this.uBurstLifeMin.value = lifeMin;
        this.uBurstLifeMax.value = lifeMax;
        this.uBurstZBias.value = zBias;
        this.nextSpawnIndex = (this.nextSpawnIndex + count) % this.count;
    }

    dispatch(renderer, time) {
        if (!renderer?.compute || !this.computeNodes.length) return;
        this.uTime.value = time;
        const node = this.computeNodes[this.dispatchIndex];
        renderer.compute(node);

        const activeBufferIndex = this.dispatchIndex === 0 ? 1 : 0;
        this.uDisplayBufferIndex.value = activeBufferIndex;
        this.dispatchIndex = activeBufferIndex;
        this.computeNode = this.computeNodes[this.dispatchIndex];

        this.uBurstCount.value = 0;
        this.uBurstTrigger.value.w = -1;
    }

    getPositionBuffer() {
        return this.positionBuffers[this.uDisplayBufferIndex.value] || this.positionBuffers[0];
    }

    getPositionBuffers() {
        return this.positionBuffers;
    }

    getVelocityBuffer() {
        return this.velocityBuffers[this.uDisplayBufferIndex.value] || this.velocityBuffers[0];
    }

    getVelocityBuffers() {
        return this.velocityBuffers;
    }

    getDisplayBufferIndexUniform() {
        return this.uDisplayBufferIndex;
    }

    dispose() {
        this.computeNode = null;
        this.computeNodes = [];
        this.positionBuffers = [];
        this.velocityBuffers = [];
        this.positionDataA = null;
        this.positionDataB = null;
        this.velocityDataA = null;
        this.velocityDataB = null;
    }
}

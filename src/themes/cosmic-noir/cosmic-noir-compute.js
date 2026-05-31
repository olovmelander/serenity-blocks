/* eslint-disable max-classes-per-file */
/**
 * Cosmic Noir - GPU Compute (Phase 3)
 * Unified void spark particle simulation for WebGPU.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    clamp,
    cos,
    float,
    instanceIndex,
    max,
    normalize,
    pow,
    sin,
    storage,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;

function toLinearColorArray(colorPalette = []) {
    if (!Array.isArray(colorPalette) || colorPalette.length === 0) {
        return [
            [1.0, 1.0, 1.0],
            [0.88, 0.88, 0.91],
            [0.75, 0.75, 0.79],
            [0.63, 0.63, 0.69],
            [0.56, 0.56, 0.63],
        ];
    }

    return colorPalette.map((color) => {
        if (color?.isColor) {
            return [color.r, color.g, color.b];
        }
        return [1.0, 1.0, 1.0];
    });
}

export class CosmicNoirSparkCompute {
    constructor(particleCount, options = {}) {
        this.count = particleCount;
        this.random = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
        this.planetRadius = Number.isFinite(options.planetRadius) ? options.planetRadius : 180;
        this.minLife = Number.isFinite(options.minLife) ? options.minLife : 3.1;
        this.maxLife = Number.isFinite(options.maxLife) ? options.maxLife : 5.0;
        this.maxDelay = Number.isFinite(options.maxDelay) ? options.maxDelay : 0.7;

        // position: x, y, z, active
        // velocity: vx, vy, vz, spare
        // life: birthTime, alpha, maxLife, delay
        // color: r, g, b, size
        this.positionData = new Float32Array(particleCount * 4);
        this.velocityData = new Float32Array(particleCount * 4);
        this.lifeData = new Float32Array(particleCount * 4);
        this.colorData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uBurstTrigger = uniform(-1000);
        this.uPlanetRadius = uniform(this.planetRadius);
        this.nextTriggerIndex = 0;
        // Time (seconds) past which every triggered particle has expired. Lets the
        // animate loop skip compute dispatch + draw while idle (no visible sparks).
        this.lastActiveUntil = -Infinity;

        this.computeNode = null;

        this.setInitialState(options.colorPalette);
    }

    setInitialState(colorPalette = []) {
        const palette = toLinearColorArray(colorPalette);
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const theta = this.random() * TAU;
            const phi = Math.acos(2 * this.random() - 1);

            const sinPhi = Math.sin(phi);
            const radialX = sinPhi * Math.cos(theta);
            const radialY = sinPhi * Math.sin(theta);
            const radialZ = Math.cos(phi);

            const spreadX = (this.random() - 0.5) * 0.45;
            const spreadY = (this.random() - 0.5) * 0.45;
            const spreadZ = (this.random() - 0.5) * 0.45;
            let burstX = radialX + spreadX;
            let burstY = radialY + spreadY;
            let burstZ = radialZ + spreadZ;
            const invLen = 1 / Math.max(1e-5, Math.hypot(burstX, burstY, burstZ));
            burstX *= invLen;
            burstY *= invLen;
            burstZ *= invLen;

            const speed = 34 + this.random() * 28;

            this.positionData[i4] = 0.0;
            this.positionData[i4 + 1] = 0.0;
            this.positionData[i4 + 2] = -9999.0;
            this.positionData[i4 + 3] = 0.0;

            this.velocityData[i4] = burstX * speed;
            this.velocityData[i4 + 1] = burstY * speed;
            this.velocityData[i4 + 2] = burstZ * speed;
            this.velocityData[i4 + 3] = 1.0;

            const lifeSpan = this.minLife + this.random() * (this.maxLife - this.minLife);
            const delay = this.random() * this.maxDelay;
            this.lifeData[i4] = -1000.0;
            this.lifeData[i4 + 1] = 0.0;
            this.lifeData[i4 + 2] = lifeSpan;
            this.lifeData[i4 + 3] = delay;

            const paletteRoll = this.random();
            let colorIndex = 0;
            if (paletteRoll <= 0.5) colorIndex = 0;
            else if (paletteRoll <= 0.7) colorIndex = 1;
            else if (paletteRoll <= 0.85) colorIndex = 2;
            else if (paletteRoll <= 0.95) colorIndex = 3;
            else colorIndex = 4;

            const paletteColor = palette[colorIndex] || palette[0];
            this.colorData[i4] = paletteColor[0];
            this.colorData[i4 + 1] = paletteColor[1];
            this.colorData[i4 + 2] = paletteColor[2];
            this.colorData[i4 + 3] = 38 + this.random() * 44;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const time = this.uTime;
        const planetRadius = this.uPlanetRadius;

        const computeSparks = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const life = lifeData.element(index).toVar();

            const spawnTime = life.x.add(life.w);
            const age = time.sub(spawnTime);
            const maxLife = max(float(0.001), life.z);

            const active = age.greaterThanEqual(float(0.0)).and(age.lessThan(maxLife));
            If(active, () => {
                const lifeNorm = clamp(age.div(maxLife), 0.0, 1.0);
                const decel = max(float(0.35), float(1.0).sub(pow(lifeNorm, 1.2)));
                const radialDir = normalize(vel.xyz.add(vec3(0.0001, 0.0001, 0.0001)));
                const startPos = radialDir.mul(planetRadius);
                const travel = vel.xyz
                    .mul(age.add(delta.mul(0.5)))
                    .mul(decel)
                    .mul(vel.w);

                pos.xyz.assign(startPos.add(travel));
                pos.w.assign(1.0);
                life.y.assign(float(1.0).sub(lifeNorm));
            }).Else(() => {
                pos.assign(vec4(0.0, 0.0, -9999.0, 0.0));
                life.y.assign(0.0);
            });

            positions.element(index).assign(pos);
            lifeData.element(index).assign(life);
        });

        this.computeNode = computeSparks().compute(this.count);
        return this.computeNode;
    }

    update(delta, time) {
        this.uDelta.value = delta;
        this.uTime.value = time;
    }

    markBufferRange(attribute, startIndex, itemCount) {
        if (!attribute || itemCount <= 0) return;
        const itemSize = attribute.itemSize || 4;
        attribute.addUpdateRange(startIndex * itemSize, itemCount * itemSize);
        attribute.needsUpdate = true;
    }

    triggerBurst(time, intensity = 1.0, batchScale = 1.0) {
        const clampedIntensity = Math.max(0.75, Math.min(2.25, intensity));
        const clampedBatchScale = Math.max(0.45, Math.min(1.0, batchScale));
        const normalizedIntensity = (clampedIntensity - 0.75) / 1.5;
        const minBatch = Math.max(900, Math.floor(this.count * 0.08));
        const maxBatch = Math.max(minBatch, Math.floor(this.count * 0.26));
        const targetBatch = Math.min(
            this.count,
            Math.floor((minBatch + (maxBatch - minBatch) * normalizedIntensity) * clampedBatchScale),
        );

        const startIndex = this.nextTriggerIndex;
        let activated = 0;
        while (activated < targetBatch) {
            const index = (startIndex + activated) % this.count;
            const i4 = index * 4;

            const lifeSpan = this.minLife + this.random() * (this.maxLife - this.minLife);
            const delay = this.random() * this.maxDelay;
            const localIntensity = clampedIntensity * (0.88 + this.random() * 0.24);

            this.lifeData[i4] = time;
            this.lifeData[i4 + 1] = 0.0;
            this.lifeData[i4 + 2] = lifeSpan;
            this.lifeData[i4 + 3] = delay;

            this.velocityData[i4 + 3] = Math.max(0.75, Math.min(2.25, localIntensity));
            this.positionData[i4] = 0.0;
            this.positionData[i4 + 1] = 0.0;
            this.positionData[i4 + 2] = -9999.0;
            this.positionData[i4 + 3] = 0.0;

            activated += 1;
        }

        this.nextTriggerIndex = (startIndex + targetBatch) % this.count;
        const firstCount = Math.min(targetBatch, this.count - startIndex);
        const secondCount = targetBatch - firstCount;
        this.markBufferRange(this.positionBuffer, startIndex, firstCount);
        this.markBufferRange(this.velocityBuffer, startIndex, firstCount);
        this.markBufferRange(this.lifeBuffer, startIndex, firstCount);
        if (secondCount > 0) {
            this.markBufferRange(this.positionBuffer, 0, secondCount);
            this.markBufferRange(this.velocityBuffer, 0, secondCount);
            this.markBufferRange(this.lifeBuffer, 0, secondCount);
        }
        this.uBurstTrigger.value = time;
        // Longest possible lifetime for this batch: birth (time) + max spawn delay + max life.
        this.lastActiveUntil = Math.max(
            this.lastActiveUntil,
            time + this.maxDelay + this.maxLife,
        );
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getVelocityBuffer() {
        return this.velocityBuffer;
    }

    getLifeBuffer() {
        return this.lifeBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.lifeBuffer = null;
        this.colorBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.lifeData = null;
        this.colorData = null;
    }
}

export class CosmicNoirStarTwinkleCompute {
    constructor(starCount) {
        this.count = starCount;
        // phase, speed, baseBrightness, size
        this.stateData = new Float32Array(starCount * 4);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);
        this.uDelta = uniform(0);
        this.computeNode = null;
    }

    setInitialData(twinkleData, brightnessData, sizeData) {
        for (let i = 0; i < this.count; i += 1) {
            const base = i * 4;
            const tBase = i * 2;
            this.stateData[base] = twinkleData[tBase] || 0.0;
            this.stateData[base + 1] = twinkleData[tBase + 1] || 1.0;
            this.stateData[base + 2] = brightnessData[i] ?? 0.5;
            this.stateData[base + 3] = sizeData[i] ?? 12.0;
        }
        this.stateBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const tau = float(6.28318530718);

        const computeStars = Fn(() => {
            const index = instanceIndex;
            const entry = state.element(index).toVar();
            entry.x.addAssign(entry.y.mul(delta));
            If(entry.x.greaterThan(tau), () => {
                entry.x.assign(entry.x.sub(tau));
            });
            state.element(index).assign(entry);
        });

        this.computeNode = computeStars().compute(this.count);
        return this.computeNode;
    }

    update(delta) {
        this.uDelta.value = delta;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.stateData = null;
    }
}

export class CosmicNoirAtmosphereFlowCompute {
    constructor() {
        this.count = 2;
        // [0]: flowAx, flowAy, flowBx, flowBy
        // [1]: warpX, warpY, densityPulse, turbulence
        this.flowData = new Float32Array(8);
        this.flowBuffer = new THREE.StorageBufferAttribute(this.flowData, 4);
        this.uTime = uniform(0);
        this.uPulseIntensity = uniform(0);
        this.uExplosionIntensity = uniform(0);
        this.computeNode = null;
    }

    createComputeNode() {
        const flowState = storage(this.flowBuffer, 'vec4', this.count);
        const time = this.uTime;
        const pulse = this.uPulseIntensity;
        const explosion = this.uExplosionIntensity;

        const computeFlow = Fn(() => {
            const flowA = vec4(
                sin(time.mul(0.23)).mul(0.42).add(pulse.mul(0.07)),
                cos(time.mul(0.19)).mul(-0.31).sub(explosion.mul(0.12)),
                sin(time.mul(0.17)).mul(-0.27).add(explosion.mul(0.08)),
                cos(time.mul(0.29)).mul(0.35).add(pulse.mul(0.05)),
            );

            const flowB = vec4(
                sin(time.mul(0.37)).mul(0.45).add(explosion.mul(0.1)),
                cos(time.mul(0.31)).mul(0.45).sub(explosion.mul(0.08)),
                sin(time.mul(0.62)).mul(0.2).add(1.0).add(pulse.mul(0.08)),
                max(float(0.25), float(1.0).add(explosion.mul(0.6))),
            );

            flowState.element(0).assign(flowA);
            flowState.element(1).assign(flowB);
        });

        this.computeNode = computeFlow().compute(1);
        return this.computeNode;
    }

    update(params = {}) {
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.pulseIntensity !== undefined) this.uPulseIntensity.value = params.pulseIntensity;
        if (params.explosionIntensity !== undefined) {
            this.uExplosionIntensity.value = params.explosionIntensity;
        }
    }

    getFlowBuffer() {
        return this.flowBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.flowBuffer = null;
        this.flowData = null;
    }
}

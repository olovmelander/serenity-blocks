/* eslint-disable import/no-unresolved, max-classes-per-file */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cos,
    float,
    instanceIndex,
    sin,
    storage,
    uniform,
} from 'three/tsl';

export const ASTRAL_WEAVE_COMPUTE_BUDGETS = Object.freeze({
    Minimal: Object.freeze({
        enableCompute: false,
        flowParticles: 0,
        dustParticles: 0,
        burstParticles: 0,
    }),
    Low: Object.freeze({
        enableCompute: false,
        flowParticles: 0,
        dustParticles: 0,
        burstParticles: 0,
    }),
    Medium: Object.freeze({
        enableCompute: true,
        flowParticles: 4000,
        dustParticles: 300,
        burstParticles: 320,
    }),
    High: Object.freeze({
        enableCompute: true,
        flowParticles: 10000,
        dustParticles: 600,
        burstParticles: 640,
    }),
    Ultra: Object.freeze({
        enableCompute: true,
        flowParticles: 18000,
        dustParticles: 1100,
        burstParticles: 960,
    }),
    Extreme: Object.freeze({
        enableCompute: true,
        flowParticles: 28000,
        dustParticles: 1600,
        burstParticles: 1400,
    }),
});

export function getAstralWeaveComputeBudget(qualityName) {
    const budget = ASTRAL_WEAVE_COMPUTE_BUDGETS[qualityName] || ASTRAL_WEAVE_COMPUTE_BUDGETS.High;
    return { ...budget };
}

function ensureRandom(randomFn) {
    return typeof randomFn === 'function' ? randomFn : Math.random;
}

export class AstralWeaveFlowParticleCompute {
    constructor(count, config = {}, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = ensureRandom(randomFn);
        this.laneCount = Math.max(4, Math.floor(config.laneCount || 24));
        this.config = {
            radiusMin: Number.isFinite(config.radiusMin) ? config.radiusMin : 8,
            radiusMax: Number.isFinite(config.radiusMax) ? config.radiusMax : 26,
            verticalScale: Number.isFinite(config.verticalScale) ? config.verticalScale : 7,
            depthScale: Number.isFinite(config.depthScale) ? config.depthScale : 12,
            speedMin: Number.isFinite(config.speedMin) ? config.speedMin : 0.45,
            speedMax: Number.isFinite(config.speedMax) ? config.speedMax : 1.2,
            center: {
                x: Number.isFinite(config.center?.x) ? config.center.x : 0,
                y: Number.isFinite(config.center?.y) ? config.center.y : 4,
                z: Number.isFinite(config.center?.z) ? config.center.z : -8,
            },
        };

        this.positionData = new Float32Array(this.count * 4);
        this.stateData = new Float32Array(this.count * 4);
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uEnergy = uniform(0);
        this.uCenter = uniform(new THREE.Vector3(
            this.config.center.x,
            this.config.center.y,
            this.config.center.z,
        ));
        this.uSwirlScale = uniform(Number.isFinite(config.swirlScale) ? config.swirlScale : 1);
        this.uVerticalScale = uniform(this.config.verticalScale);
        this.uDepthScale = uniform(this.config.depthScale);

        this.computeNode = null;
        this.initializeState();
    }

    initializeState() {
        const span = this.config.radiusMax - this.config.radiusMin;
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const laneNorm = (i % this.laneCount) / this.laneCount;
            const seed = this.random();
            const radius = this.config.radiusMin + span * (0.12 + seed * 0.88);
            const phase = this.random() * Math.PI * 2;
            const speed = this.config.speedMin + (this.config.speedMax - this.config.speedMin) * this.random();
            const swirl = 0.35 + this.random() * 0.9;
            const size = 1.2 + this.random() * 2.6;
            const colorMix = this.random();

            this.positionData[i4] = Math.cos(phase) * radius;
            this.positionData[i4 + 1] = (this.random() - 0.5) * this.config.verticalScale;
            this.positionData[i4 + 2] = Math.sin(phase) * radius;
            this.positionData[i4 + 3] = laneNorm;

            this.stateData[i4] = phase;
            this.stateData[i4 + 1] = speed;
            this.stateData[i4 + 2] = radius;
            this.stateData[i4 + 3] = laneNorm;

            this.miscData[i4] = size;
            this.miscData[i4 + 1] = seed;
            this.miscData[i4 + 2] = colorMix;
            this.miscData[i4 + 3] = swirl;
        }

        this.positionBuffer.needsUpdate = true;
        this.stateBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const states = storage(this.stateBuffer, 'vec4', this.count);
        const misc = storage(this.miscBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const time = this.uTime;
        const energy = this.uEnergy;
        const center = this.uCenter;
        const swirlScale = this.uSwirlScale;
        const verticalScale = this.uVerticalScale;
        const depthScale = this.uDepthScale;

        const computeParticles = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const state = states.element(index).toVar();
            const info = misc.element(index).toVar();

            state.x.addAssign(delta.mul(state.y).mul(float(0.5).add(energy.mul(0.7))));

            const laneAngle = state.x.add(state.w.mul(6.28318530718)).toVar();
            const weaveA = sin(state.x.mul(2.1).add(info.y.mul(9.0))).mul(2.3).mul(info.w);
            const weaveB = cos(state.x.mul(1.6).sub(info.z.mul(7.0))).mul(1.4).mul(swirlScale);
            const radius = state.z
                .mul(float(0.9).add(energy.mul(0.12)))
                .add(weaveA)
                .add(weaveB);
            const height = sin(state.x.mul(0.65).add(info.y.mul(5.0)))
                .mul(verticalScale)
                .mul(float(0.3).add(info.w.mul(0.7)))
                .add(cos(laneAngle.mul(1.7)).mul(1.4))
                .add(energy.mul(1.4));
            const depth = sin(laneAngle)
                .mul(depthScale)
                .mul(float(0.62).add(info.z.mul(0.52)))
                .add(cos(state.x.mul(1.9).add(time.mul(0.12))).mul(3.8));

            pos.x.assign(center.x.add(cos(laneAngle).mul(radius)));
            pos.y.assign(center.y.add(height));
            pos.z.assign(center.z.add(depth));

            positions.element(index).assign(pos);
            states.element(index).assign(state);
            misc.element(index).assign(info);
        });

        this.computeNode = computeParticles().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        if (Number.isFinite(options.energy)) this.uEnergy.value = options.energy;
        if (options.center?.isVector3) this.uCenter.value.copy(options.center);
        if (Array.isArray(options.center) && options.center.length >= 3) {
            this.uCenter.value.set(options.center[0], options.center[1], options.center[2]);
        }
        if (options.center && Number.isFinite(options.center.x) && Number.isFinite(options.center.y) && Number.isFinite(options.center.z)) {
            this.uCenter.value.set(options.center.x, options.center.y, options.center.z);
        }
        if (Number.isFinite(options.swirlScale)) this.uSwirlScale.value = options.swirlScale;
        if (Number.isFinite(options.verticalScale)) this.uVerticalScale.value = options.verticalScale;
        if (Number.isFinite(options.depthScale)) this.uDepthScale.value = options.depthScale;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.stateBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.stateData = null;
        this.miscData = null;
    }
}

export class AstralWeaveBurstCompute {
    constructor(count, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = ensureRandom(randomFn);
        this.cursor = 0;

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uGravity = uniform(-12.5);
        this.uDrag = uniform(0.988);

        this.computeNode = null;
        this.initializeState();
    }

    initializeState() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 0;
            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;
            this.miscData[i4] = 0;
            this.miscData[i4 + 1] = 0;
            this.miscData[i4 + 2] = 0;
            this.miscData[i4 + 3] = 0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const misc = storage(this.miscBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const gravity = this.uGravity;
        const drag = this.uDrag;

        const computeBursts = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const props = misc.element(index).toVar();

            const active = pos.w.greaterThan(0.5);
            If(active, () => {
                vel.y.addAssign(gravity.mul(delta));
                vel.xyz.mulAssign(drag);
                pos.xyz.addAssign(vel.xyz.mul(delta));
                props.y.subAssign(delta.mul(float(0.9).add(props.z.mul(0.3))));

                const dead = props.y.lessThanEqual(0.0);
                If(dead, () => {
                    pos.w.assign(0.0);
                    pos.z.assign(-9999.0);
                    props.y.assign(0.0);
                });
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            misc.element(index).assign(props);
        });

        this.computeNode = computeBursts().compute(this.count);
        return this.computeNode;
    }

    spawnBurst(count, origin = {}, options = {}) {
        const amount = Math.max(1, Math.floor(Number(count) || 1));
        const ox = Number.isFinite(origin.x) ? origin.x : 0;
        const oy = Number.isFinite(origin.y) ? origin.y : 0;
        const oz = Number.isFinite(origin.z) ? origin.z : -6;
        const spread = Number.isFinite(options.spread) ? options.spread : 4.6;
        const verticalBoost = Number.isFinite(options.verticalBoost) ? options.verticalBoost : 5.5;
        const speedMin = Number.isFinite(options.speedMin) ? options.speedMin : 3.6;
        const speedMax = Number.isFinite(options.speedMax) ? options.speedMax : 12.5;
        const sizeMin = Number.isFinite(options.sizeMin) ? options.sizeMin : 3.2;
        const sizeMax = Number.isFinite(options.sizeMax) ? options.sizeMax : 9.8;
        const lifeMin = Number.isFinite(options.lifeMin) ? options.lifeMin : 0.45;
        const lifeMax = Number.isFinite(options.lifeMax) ? options.lifeMax : 1.15;

        for (let i = 0; i < amount; i += 1) {
            const slot = this.cursor % this.count;
            const i4 = slot * 4;
            this.cursor += 1;

            const theta = this.random() * Math.PI * 2;
            const phi = this.random() * Math.PI;
            const speed = speedMin + this.random() * (speedMax - speedMin);

            this.positionData[i4] = ox + (this.random() - 0.5) * spread;
            this.positionData[i4 + 1] = oy + (this.random() - 0.5) * spread * 0.35;
            this.positionData[i4 + 2] = oz + (this.random() - 0.5) * spread;
            this.positionData[i4 + 3] = 1;

            this.velocityData[i4] = Math.cos(theta) * Math.sin(phi) * speed;
            this.velocityData[i4 + 1] = Math.abs(Math.cos(phi)) * speed + verticalBoost;
            this.velocityData[i4 + 2] = Math.sin(theta) * Math.sin(phi) * speed;
            this.velocityData[i4 + 3] = 0;

            this.miscData[i4] = sizeMin + this.random() * (sizeMax - sizeMin);
            this.miscData[i4 + 1] = lifeMin + this.random() * (lifeMax - lifeMin);
            this.miscData[i4 + 2] = this.random();
            this.miscData[i4 + 3] = this.random();
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    update(delta, options = {}) {
        this.uDelta.value = delta;
        if (Number.isFinite(options.gravity)) this.uGravity.value = options.gravity;
        if (Number.isFinite(options.drag)) {
            this.uDrag.value = Math.min(0.999, Math.max(0.85, options.drag));
        }
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
        this.velocityBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.miscData = null;
    }
}

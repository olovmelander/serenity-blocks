/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams Theme - GPU Compute Particles
 * Organic drifting spark particles with blob attraction
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cos,
    float,
    fract,
    instanceIndex,
    length,
    sin,
    storage,
    uniform,
} from 'three/tsl';

export const ELECTRIC_DREAMS_COMPUTE_BUDGETS = Object.freeze({
    Minimal: Object.freeze({ enableCompute: false, sparkCount: 16 }),
    Low: Object.freeze({ enableCompute: false, sparkCount: 32 }),
    Medium: Object.freeze({ enableCompute: false, sparkCount: 48 }),
    High: Object.freeze({ enableCompute: false, sparkCount: 64 }),
    Ultra: Object.freeze({ enableCompute: false, sparkCount: 96 }),
    Extreme: Object.freeze({ enableCompute: false, sparkCount: 128 }),
});

export function getElectricDreamsComputeBudget(qualityName) {
    return { ...(ELECTRIC_DREAMS_COMPUTE_BUDGETS[qualityName] || ELECTRIC_DREAMS_COMPUTE_BUDGETS.High) };
}

export class ElectricDreamsSparkCompute {
    constructor(count, config = {}) {
        this.count = Math.max(1, Math.floor(count));
        this.config = {
            boundsWidth: Number.isFinite(config.boundsWidth) ? config.boundsWidth : 35,
            boundsHeight: Number.isFinite(config.boundsHeight) ? config.boundsHeight : 25,
            boundsDepth: Number.isFinite(config.boundsDepth) ? config.boundsDepth : 40,
        };

        // position: xyz + life (0-1)
        this.positionData = new Float32Array(this.count * 4);
        // velocity: xyz + maxLife
        this.velocityData = new Float32Array(this.count * 4);
        // misc: size, colorMix, seed, phase
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uComboIntensity = uniform(0);
        this.uComboSpeedBoost = uniform(1);
        this.uBoundsWidth = uniform(this.config.boundsWidth);
        this.uBoundsHeight = uniform(this.config.boundsHeight);

        this.computeNode = null;
        this.initializeState();
    }

    initializeState() {
        const { boundsWidth, boundsHeight, boundsDepth } = this.config;
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const seed = Math.random();
            const maxLife = 8 + Math.random() * 20;

            // Random initial position within bounds
            this.positionData[i4] = (Math.random() - 0.5) * boundsWidth * 2;
            this.positionData[i4 + 1] = (Math.random() - 0.5) * boundsHeight * 2;
            this.positionData[i4 + 2] = (Math.random() - 0.5) * boundsDepth;
            this.positionData[i4 + 3] = Math.random(); // life (start at random phase)

            // Gentle initial drift velocity
            this.velocityData[i4] = (Math.random() - 0.5) * 0.3;
            this.velocityData[i4 + 1] = (Math.random() - 0.5) * 0.3;
            this.velocityData[i4 + 2] = (Math.random() - 0.5) * 0.2;
            this.velocityData[i4 + 3] = maxLife;

            // Misc: size, colorMix, seed, phase
            this.miscData[i4] = 2.0 + Math.random() * 5.0;
            this.miscData[i4 + 1] = Math.random();
            this.miscData[i4 + 2] = seed;
            this.miscData[i4 + 3] = Math.random() * Math.PI * 2;
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
        const time = this.uTime;
        const comboIntensity = this.uComboIntensity;
        const comboSpeedBoost = this.uComboSpeedBoost;
        const boundsW = this.uBoundsWidth;
        const boundsH = this.uBoundsHeight;

        const computeSparks = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const info = misc.element(index).toVar();

            const life = pos.w.toVar();
            const maxLife = vel.w;
            const seed = info.z;
            const phase = info.w;

            // Organic drift using layered sine waves
            const speedMul = float(1.0).add(comboIntensity.mul(0.8)).mul(comboSpeedBoost);
            const driftX = sin(time.mul(0.15).add(phase).mul(speedMul)).mul(0.5)
                .add(sin(time.mul(0.08).add(seed.mul(10.0))).mul(0.3));
            const driftY = sin(time.mul(0.12).add(phase.mul(1.3)).mul(speedMul)).mul(0.4)
                .add(cos(time.mul(0.06).add(seed.mul(8.0))).mul(0.25));
            const driftZ = cos(time.mul(0.1).add(phase.mul(0.7)).mul(speedMul)).mul(0.3);

            // Apply drift as acceleration
            vel.x.addAssign(driftX.mul(delta).mul(0.3));
            vel.y.addAssign(driftY.mul(delta).mul(0.3));
            vel.z.addAssign(driftZ.mul(delta).mul(0.2));

            // Damping
            const damping = float(0.992);
            vel.x.mulAssign(damping);
            vel.y.mulAssign(damping);
            vel.z.mulAssign(damping);

            // Speed cap
            const speed = length(vel.xyz);
            const maxSpeed = float(2.0).add(comboIntensity.mul(3.0));
            If(speed.greaterThan(maxSpeed), () => {
                const scale = maxSpeed.div(speed);
                vel.x.mulAssign(scale);
                vel.y.mulAssign(scale);
                vel.z.mulAssign(scale);
            });

            // Update position
            pos.x.addAssign(vel.x);
            pos.y.addAssign(vel.y);
            pos.z.addAssign(vel.z);

            // Advance life
            life.addAssign(delta.div(maxLife));

            // Soft boundary: push back when near edges
            const edgePush = float(0.05);
            If(pos.x.greaterThan(boundsW), () => {
                vel.x.subAssign(edgePush);
            });
            If(pos.x.lessThan(boundsW.negate()), () => {
                vel.x.addAssign(edgePush);
            });
            If(pos.y.greaterThan(boundsH), () => {
                vel.y.subAssign(edgePush);
            });
            If(pos.y.lessThan(boundsH.negate()), () => {
                vel.y.addAssign(edgePush);
            });
            If(pos.z.greaterThan(float(15.0)), () => {
                vel.z.subAssign(edgePush);
            });
            If(pos.z.lessThan(float(-30.0)), () => {
                vel.z.addAssign(edgePush);
            });

            // Respawn when life expires
            If(life.greaterThan(1.0), () => {
                // Hash-based pseudo-random respawn
                const r1 = fract(sin(float(index).add(time.mul(0.37)).mul(12.9898)).mul(43758.5453));
                const r2 = fract(sin(float(index).add(time.mul(0.53)).mul(78.233)).mul(43758.5453));
                const r3 = fract(sin(float(index).add(time.mul(0.71)).mul(39.425)).mul(43758.5453));

                pos.x.assign(r1.sub(0.5).mul(boundsW).mul(2.0));
                pos.y.assign(r2.sub(0.5).mul(boundsH).mul(2.0));
                pos.z.assign(r3.sub(0.5).mul(30.0).sub(5.0));

                vel.x.assign(r1.sub(0.5).mul(0.2));
                vel.y.assign(r2.sub(0.5).mul(0.2));
                vel.z.assign(r3.sub(0.5).mul(0.1));

                life.assign(0.0);
            });

            pos.w.assign(life);
            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            misc.element(index).assign(info);
        });

        this.computeNode = computeSparks().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        if (Number.isFinite(options.comboIntensity)) this.uComboIntensity.value = options.comboIntensity;
        if (Number.isFinite(options.comboSpeedBoost)) this.uComboSpeedBoost.value = options.comboSpeedBoost;
        if (Number.isFinite(options.boundsWidth)) this.uBoundsWidth.value = options.boundsWidth;
        if (Number.isFinite(options.boundsHeight)) this.uBoundsHeight.value = options.boundsHeight;
    }

    getPositionBuffer() { return this.positionBuffer; }

    getMiscBuffer() { return this.miscBuffer; }

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

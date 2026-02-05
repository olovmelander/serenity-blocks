/**
 * Synthwave Sunset Theme - GPU Compute Shaders
 * WebGPU compute shader for particle simulation
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    float,
    max,
    If,
} from 'three/tsl';

export class SynthwaveParticleCompute {
    constructor(particleCount) {
        this.count = particleCount;

        // State buffer: vec4 * 2 per particle
        // [0]: position.xyz, life
        // [1]: velocity.xyz, maxLife
        this.stateData = new Float32Array(particleCount * 8);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        // Color buffer: vec4 per particle (r, g, b, size)
        this.colorData = new Float32Array(particleCount * 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uGravity = uniform(5.0);

        this.computeNode = null;

        this.reset();
    }

    reset() {
        this.stateData.fill(0);
        this.colorData.fill(0);
        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count * 2);
        const delta = this.uDelta;
        const gravity = this.uGravity;

        const computeParticles = Fn(() => {
            const index = instanceIndex;
            const base = index.mul(2);
            const pos = state.element(base).toVar();
            const vel = state.element(base.add(1)).toVar();

            const life = pos.w;
            const maxLife = max(vel.w, float(0.0001));

            const active = life.greaterThan(0.0);
            If(active, () => {
                pos.x.addAssign(vel.x.mul(delta));
                pos.y.addAssign(vel.y.mul(delta));
                pos.z.addAssign(vel.z.mul(delta));
                vel.y.subAssign(gravity.mul(delta));

                pos.w.assign(pos.w.sub(delta.div(maxLife)));
                If(pos.w.lessThanEqual(0.0), () => {
                    pos.w.assign(0.0);
                });
            });

            state.element(base).assign(pos);
            state.element(base.add(1)).assign(vel);
        });

        this.computeNode = computeParticles().compute(this.count);
        return this.computeNode;
    }

    update(delta) {
        this.uDelta.value = delta;
    }

    spawn(index, particle) {
        if (index < 0 || index >= this.count) return;
        const base = index * 8;
        this.stateData[base] = particle.x;
        this.stateData[base + 1] = particle.y;
        this.stateData[base + 2] = particle.z;
        this.stateData[base + 3] = particle.life;
        this.stateData[base + 4] = particle.vx;
        this.stateData[base + 5] = particle.vy;
        this.stateData[base + 6] = particle.vz;
        this.stateData[base + 7] = particle.maxLife;

        const cBase = index * 4;
        this.colorData[cBase] = particle.color.r;
        this.colorData[cBase + 1] = particle.color.g;
        this.colorData[cBase + 2] = particle.color.b;
        this.colorData[cBase + 3] = particle.size;

        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.colorBuffer = null;
        this.stateData = null;
        this.colorData = null;
    }
}

export class SynthwaveHighlightCompute {
    constructor(highlightCount) {
        this.count = highlightCount;

        // State buffer: vec4 per highlight (x, y, z, intensity)
        this.stateData = new Float32Array(highlightCount * 4);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        // Color buffer: vec4 per highlight (r, g, b, phase)
        this.colorData = new Float32Array(highlightCount * 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uScrollSpeed = uniform(5.0);
        this.uMaxZ = uniform(90.0);

        this.computeNode = null;

        this.reset();
    }

    reset() {
        this.stateData.fill(0);
        this.colorData.fill(0);
        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const speed = this.uScrollSpeed;
        const maxZ = this.uMaxZ;

        const computeHighlights = Fn(() => {
            const index = instanceIndex;
            const entry = state.element(index).toVar();
            const intensity = entry.w;

            const active = intensity.greaterThan(0.0);
            If(active, () => {
                entry.z.addAssign(speed.mul(delta));
                If(entry.z.greaterThan(maxZ), () => {
                    entry.w.assign(0.0);
                });
            });

            state.element(index).assign(entry);
        });

        this.computeNode = computeHighlights().compute(this.count);
        return this.computeNode;
    }

    update(delta) {
        this.uDelta.value = delta;
    }

    spawn(index, data) {
        if (index < 0 || index >= this.count) return;
        const base = index * 4;
        this.stateData[base] = data.x;
        this.stateData[base + 1] = data.y;
        this.stateData[base + 2] = data.z;
        this.stateData[base + 3] = data.intensity;

        const cBase = index * 4;
        this.colorData[cBase] = data.color.r;
        this.colorData[cBase + 1] = data.color.g;
        this.colorData[cBase + 2] = data.color.b;
        this.colorData[cBase + 3] = data.phase ?? 0;

        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    deactivate(index) {
        if (index < 0 || index >= this.count) return;
        const base = index * 4;
        this.stateData[base + 3] = 0;
        this.stateBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.colorBuffer = null;
        this.stateData = null;
        this.colorData = null;
    }
}

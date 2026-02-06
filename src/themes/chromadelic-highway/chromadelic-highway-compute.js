/**
 * Chromadelic Highway - GPU Compute Shaders
 * WebGPU compute shaders for particle simulation (speed particles, ambient particles)
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    clamp,
    float,
    vec2,
    vec3,
    vec4,
    sin,
    cos,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    smoothstep,
    If,
} from 'three/tsl';

// ─────────────────────────────────────────────────────────────────────────────
// Speed Particle Compute
// Moves particles along the road corridor toward the camera, respawns at far end
// ─────────────────────────────────────────────────────────────────────────────

export class SpeedParticleCompute {
    constructor(particleCount, randomFn = Math.random) {
        this.count = particleCount;
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;

        // Buffer layout: vec4 each
        // position: xyz + lifetime
        // velocity: xyz + spare
        // life: lifetime + color.rgb
        // misc: size + active + random + spare
        this.positionData = new Float32Array(particleCount * 4);
        this.velocityData = new Float32Array(particleCount * 4);
        this.lifeData = new Float32Array(particleCount * 4);
        this.miscData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uPulseIntensity = uniform(0);
        this.uPlayPace = uniform(1.0);

        this.computeNode = null;
    }

    setInitialState(positions, colors, sizes) {
        const count = this.count;
        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 0;

            // Velocity: forward along Z
            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 3.0 + this.random() * 5.0;
            this.velocityData[i4 + 3] = 0;

            this.lifeData[i4] = this.random() * 10.0; // lifetime
            this.lifeData[i4 + 1] = colors[i3];
            this.lifeData[i4 + 2] = colors[i3 + 1];
            this.lifeData[i4 + 3] = colors[i3 + 2];

            this.miscData[i4] = sizes[i];
            this.miscData[i4 + 1] = 1.0; // active
            this.miscData[i4 + 2] = this.random(); // random seed
            this.miscData[i4 + 3] = 0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const time = this.uTime;
        const pulseIntensity = this.uPulseIntensity;
        const playPace = this.uPlayPace;

        const computeParticles = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const misc = miscData.element(index).toVar();

            // Speed scales with pulse and play pace
            const speed = vel.z.mul(float(1.0).add(pulseIntensity.mul(1.5))).mul(playPace);

            // Move forward (toward camera)
            pos.z.addAssign(speed.mul(delta));

            // Respawn when past camera
            const pastCamera = pos.z.greaterThan(float(300.0));
            If(pastCamera, () => {
                pos.z.assign(float(-2200.0));
                // Randomize X position using hash
                const seed = misc.z;
                const side = fract(sin(seed.mul(43758.5453)).mul(0.5).add(0.5));
                const sideSign = mix(float(-1.0), float(1.0), side.greaterThan(0.5));
                pos.x.assign(sideSign.mul(float(80.0).add(fract(sin(seed.mul(12345.6789))).mul(60.0))));
                pos.y.assign(fract(sin(seed.mul(98765.4321))).mul(60.0).add(5.0));
            });

            positions.element(index).assign(pos);
        })().compute(this.count);

        this.computeNode = computeParticles;
    }

    update(delta, time, pulseIntensity, playPace) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        this.uPulseIntensity.value = pulseIntensity;
        this.uPlayPace.value = playPace;
    }

    dispose() {
        this.computeNode = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient Particle Compute
// Orbital motion, floating drift for ambient particles
// ─────────────────────────────────────────────────────────────────────────────

export class AmbientParticleCompute {
    constructor(particleCount) {
        this.count = particleCount;

        this.positionData = new Float32Array(particleCount * 4);
        this.miscData = new Float32Array(particleCount * 4);
        this.lifeData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uPulseIntensity = uniform(0);
        this.uSpeedMultiplier = uniform(1.0);

        this.computeNode = null;
    }

    setInitialState(positions, colors, randoms, sizes) {
        const count = this.count;
        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 0;

            this.lifeData[i4] = randoms[i]; // random phase
            this.lifeData[i4 + 1] = colors[i3];
            this.lifeData[i4 + 2] = colors[i3 + 1];
            this.lifeData[i4 + 3] = colors[i3 + 2];

            this.miscData[i4] = sizes[i];
            this.miscData[i4 + 1] = 1.0;
            this.miscData[i4 + 2] = randoms[i];
            this.miscData[i4 + 3] = 0;
        }

        this.positionBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);

        const time = this.uTime;
        const speedMultiplier = this.uSpeedMultiplier;

        const computeAmbient = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const misc = miscData.element(index).toVar();
            const life = lifeData.element(index).toVar();

            const aRandom = life.x;

            // Orbital rotation
            const orbitSpeed = float(0.05).add(aRandom.mul(0.05)).mul(speedMultiplier);
            const angle = time.mul(orbitSpeed);
            const s = sin(angle);
            const c = cos(angle);

            // Rotate XZ
            const newX = pos.x.mul(c).sub(pos.z.mul(s));
            const newZ = pos.x.mul(s).add(pos.z.mul(c));
            pos.x.assign(newX);
            pos.z.assign(newZ);

            // Floating motion
            pos.y.addAssign(sin(time.mul(0.3).add(aRandom.mul(10.0))).mul(0.15));

            // Side sway
            pos.x.addAssign(sin(time.mul(0.2).add(aRandom.mul(5.0))).mul(0.1));

            positions.element(index).assign(pos);
        })().compute(this.count);

        this.computeNode = computeAmbient;
    }

    update(delta, time, pulseIntensity, speedMultiplier) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        this.uPulseIntensity.value = pulseIntensity;
        this.uSpeedMultiplier.value = speedMultiplier;
    }

    dispose() {
        this.computeNode = null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shooting Star Trail Compute (Optional Milestone)
// Moves each star trail particle with a shared velocity (no CPU position updates)
// ─────────────────────────────────────────────────────────────────────────────

export class ShootingStarCompute {
    constructor(particleCount) {
        this.count = particleCount;

        this.positionData = new Float32Array(particleCount * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        this.uDelta = uniform(0);
        this.uVelocity = uniform(new THREE.Vector3());

        this.computeNode = null;
    }

    setInitialState(positions) {
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 0;
        }
        this.positionBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const velocity = this.uVelocity;

        const computeTrails = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();

            pos.x.addAssign(velocity.x.mul(delta));
            pos.y.addAssign(velocity.y.mul(delta));
            pos.z.addAssign(velocity.z.mul(delta));

            positions.element(index).assign(pos);
        })().compute(this.count);

        this.computeNode = computeTrails;
    }

    update(delta, velocity) {
        this.uDelta.value = delta;
        this.uVelocity.value.copy(velocity);
    }

    dispose() {
        this.computeNode = null;
    }
}

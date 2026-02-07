/**
 * Black Hole Theme - GPU Compute Shaders
 * WebGPU compute shader for particle simulation
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
    pow,
    step,
    normalize,
    smoothstep,
    If,
} from 'three/tsl';

export class BlackHoleParticleCompute {
    constructor(particleCount) {
        this.count = particleCount;

        // Buffer layout (vec4 per particle each)
        // position: xyz + spare
        // velocity: xyz + spare
        // life: lifetime + color.rgb
        // misc: size + active + random + lockUntilTime
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
        this.uBlackHolePos = uniform(new THREE.Vector3(0, 0, 0));
        this.uGravitySurge = uniform(0);
        this.uBurstFactor = uniform(0);
        this.uBurstPhase = uniform(0);
        this.uActiveCount = uniform(particleCount);

        this.computeNode = null;
    }

    setInitialState(positions, velocities, colors, sizes, lifetimes, randoms = null) {
        const count = this.count;
        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 0;

            this.velocityData[i4] = velocities[i3];
            this.velocityData[i4 + 1] = velocities[i3 + 1];
            this.velocityData[i4 + 2] = velocities[i3 + 2];
            this.velocityData[i4 + 3] = 0;

            this.lifeData[i4] = lifetimes[i];
            this.lifeData[i4 + 1] = colors[i3];
            this.lifeData[i4 + 2] = colors[i3 + 1];
            this.lifeData[i4 + 3] = colors[i3 + 2];

            this.miscData[i4] = sizes[i];
            this.miscData[i4 + 1] = 1.0;
            this.miscData[i4 + 2] = randoms ? randoms[i] : Math.random();
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
        const blackHolePos = this.uBlackHolePos;
        const gravitySurge = this.uGravitySurge;
        const burstFactor = this.uBurstFactor;
        const burstPhase = this.uBurstPhase;
        const activeCount = this.uActiveCount;

        const computeParticles = Fn(() => {
            const index = instanceIndex;
            const active = float(index).lessThan(activeCount);
            If(active, () => {
                const pos = positions.element(index).toVar();
                const vel = velocities.element(index).toVar();
                const life = lifeData.element(index).toVar();
                const misc = miscData.element(index).toVar();

                const toCenter = blackHolePos.sub(pos.xyz);
                const dist = length(toCenter);
                const dir = normalize(toCenter);

                const burstBlend = smoothstep(float(0.0), float(8.0), burstFactor);
                const isBurst = max(step(float(0.5), burstPhase), step(float(0.06), burstBlend));
                const maxDist = mix(float(1500.0), float(2500.0), burstBlend);

                If(dist.greaterThan(50.0), () => {
                    If(isBurst.greaterThan(0.5), () => {
                        const burstStrength = burstFactor.mul(float(400.0).div(dist.add(50.0))).mul(delta);
                        vel.x.addAssign(dir.x.negate().mul(burstStrength));
                        vel.y.addAssign(dir.y.negate().mul(burstStrength));
                        vel.z.addAssign(dir.z.negate().mul(burstStrength));

                        vel.x.assign(vel.x.mul(0.998));
                        vel.y.assign(vel.y.mul(0.998));
                        vel.z.assign(vel.z.mul(0.998));

                        const speed = length(vel.xyz);
                        const maxSpeed = float(15.0).add(burstFactor.mul(3.0));
                        If(speed.greaterThan(maxSpeed), () => {
                            const scale = maxSpeed.div(speed);
                            vel.x.assign(vel.x.mul(scale));
                            vel.y.assign(vel.y.mul(scale));
                            vel.z.assign(vel.z.mul(scale));
                        });
                    }).Else(() => {
                        let pullStrength = float(800.0).div(dist.mul(dist).add(100.0)).mul(delta);
                        const surgeBoost = float(5.0).add(gravitySurge.mul(2.0));
                        pullStrength = pullStrength.mul(mix(float(1.0), surgeBoost, step(float(0.001), gravitySurge)));

                        vel.x.addAssign(dir.x.mul(pullStrength));
                        vel.y.addAssign(dir.y.mul(pullStrength));
                        vel.z.addAssign(dir.z.mul(pullStrength));

                        vel.x.assign(vel.x.mul(0.995));
                        vel.y.assign(vel.y.mul(0.995));
                        vel.z.assign(vel.z.mul(0.995));

                        vel.x.assign(vel.x.mul(0.99));
                        vel.y.assign(vel.y.mul(0.99));
                        vel.z.assign(vel.z.mul(0.99));

                        const speed = length(vel.xyz);
                        const maxSpeed = float(8.0).add(gravitySurge.mul(5.0));
                        If(speed.greaterThan(maxSpeed), () => {
                            const scale = maxSpeed.div(speed);
                            vel.x.assign(vel.x.mul(scale));
                            vel.y.assign(vel.y.mul(scale));
                            vel.z.assign(vel.z.mul(scale));
                        });
                    });
                });

                pos.x.addAssign(vel.x);
                pos.y.addAssign(vel.y);
                pos.z.addAssign(vel.z);

                const distAfter = length(blackHolePos.sub(pos.xyz));
                const outOfBounds = distAfter.lessThan(80.0).or(distAfter.greaterThan(maxDist));
                const lockExpired = step(misc.w, time).greaterThan(0.5);
                If(outOfBounds.and(lockExpired), () => {
                    const seed = float(index).add(time.mul(0.13));
                    const r1 = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                    const r2 = fract(sin(seed.mul(78.233)).mul(43758.5453));
                    const r3 = fract(sin(seed.mul(39.425)).mul(43758.5453));

                    const angle = r1.mul(6.28318530718);
                    const radius = float(400.0).add(r2.mul(600.0));
                    const height = r3.sub(0.5).mul(120.0);

                    const tilt = float(-1.319468914);
                    const cosT = cos(tilt);
                    const sinT = sin(tilt);

                    const px = cos(angle).mul(radius);
                    const pz = sin(angle).mul(radius);
                    const py = height;

                    const pY = py.mul(cosT).sub(pz.mul(sinT));
                    const pZ = py.mul(sinT).add(pz.mul(cosT));

                    pos.x.assign(px);
                    pos.y.assign(pY);
                    pos.z.assign(pZ);

                    const orbitalSpeed = float(0.3).add(r2.mul(0.3));
                    const vx = sin(angle).negate().mul(orbitalSpeed);
                    const vz = cos(angle).mul(orbitalSpeed);
                    const vy = r3.sub(0.5).mul(0.05);

                    const vY = vy.mul(cosT).sub(vz.mul(sinT));
                    const vZ = vy.mul(sinT).add(vz.mul(cosT));

                    vel.x.assign(vx);
                    vel.y.assign(vY);
                    vel.z.assign(vZ);

                    life.x.assign(float(0.5).add(r1.mul(0.5)));
                    misc.y.assign(1.0);
                    misc.w.assign(0.0);
                });

                If(life.x.lessThan(1.0), () => {
                    life.x.assign(min(float(1.0), life.x.add(delta.mul(0.5))));
                });

                positions.element(index).assign(pos);
                velocities.element(index).assign(vel);
                lifeData.element(index).assign(life);
                miscData.element(index).assign(misc);
            });
        });

        this.computeNode = computeParticles().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = delta;
        this.uTime.value = params.time ?? this.uTime.value;
        if (params.blackHolePos) {
            this.uBlackHolePos.value.copy(params.blackHolePos);
        }
        if (params.gravitySurge !== undefined) {
            this.uGravitySurge.value = params.gravitySurge;
        }
        if (params.burstFactor !== undefined) {
            this.uBurstFactor.value = params.burstFactor;
        }
        if (params.burstPhase !== undefined) {
            this.uBurstPhase.value = params.burstPhase ? 1.0 : 0.0;
        }
        if (params.activeCount !== undefined) {
            this.uActiveCount.value = params.activeCount;
        }
    }

    spawn(index, particle, lockUntil = 0) {
        if (index < 0 || index >= this.count) return;
        const i4 = index * 4;
        this.positionData[i4] = particle.x;
        this.positionData[i4 + 1] = particle.y;
        this.positionData[i4 + 2] = particle.z;
        this.positionData[i4 + 3] = 0;

        this.velocityData[i4] = particle.vx;
        this.velocityData[i4 + 1] = particle.vy;
        this.velocityData[i4 + 2] = particle.vz;
        this.velocityData[i4 + 3] = 0;

        this.lifeData[i4] = particle.life;
        this.lifeData[i4 + 1] = particle.color.r;
        this.lifeData[i4 + 2] = particle.color.g;
        this.lifeData[i4 + 3] = particle.color.b;

        this.miscData[i4] = particle.size;
        this.miscData[i4 + 1] = 1.0;
        this.miscData[i4 + 3] = lockUntil;

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
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

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.lifeBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.lifeData = null;
        this.miscData = null;
    }
}

export class BlackHoleBurstCompute {
    constructor(particleCount) {
        this.count = particleCount;

        // position: xyz + spare
        // angles: theta, phi, random, active
        // life: life, color.r, color.g, color.b
        // misc: baseSize, seedOffset, spare, spare
        this.positionData = new Float32Array(particleCount * 4);
        this.angleData = new Float32Array(particleCount * 4);
        this.lifeData = new Float32Array(particleCount * 4);
        this.miscData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.angleBuffer = new THREE.StorageBufferAttribute(this.angleData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uBlackHolePos = uniform(new THREE.Vector3(0, 0, 0));
        this.uBurstFactor = uniform(0);
        this.uBurstSeed = uniform(0);
        this.nextTriggerIndex = 0;

        this.computeNode = null;
    }

    setInitialState(angles, colors, sizes, randoms = null) {
        const count = this.count;
        for (let i = 0; i < count; i += 1) {
            const i4 = i * 4;
            const theta = angles ? angles[i * 2] : Math.random() * Math.PI * 2;
            const phi = angles ? angles[i * 2 + 1] : Math.acos(2 * Math.random() - 1);
            const rand = randoms ? randoms[i] : Math.random();

            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 0;

            this.angleData[i4] = theta;
            this.angleData[i4 + 1] = phi;
            this.angleData[i4 + 2] = rand;
            this.angleData[i4 + 3] = 0;

            const cIndex = i * 3;
            this.lifeData[i4] = 0;
            this.lifeData[i4 + 1] = colors ? colors[cIndex] : 1.0;
            this.lifeData[i4 + 2] = colors ? colors[cIndex + 1] : 0.7;
            this.lifeData[i4 + 3] = colors ? colors[cIndex + 2] : 0.4;

            this.miscData[i4] = sizes ? sizes[i] : 5.0 + Math.random() * 8.0;
            this.miscData[i4 + 1] = 0;
            this.miscData[i4 + 2] = 0;
            this.miscData[i4 + 3] = 0;
        }

        this.positionBuffer.needsUpdate = true;
        this.angleBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const angles = storage(this.angleBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const blackHolePos = this.uBlackHolePos;
        const burstFactor = this.uBurstFactor;

        const computeBursts = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const angle = angles.element(index).toVar();
            const life = lifeData.element(index).toVar();
            const misc = miscData.element(index).toVar();

            const active = angle.w;

            If(active.greaterThan(0.5), () => {
                const nextLife = life.x.add(delta.mul(0.4));
                life.x.assign(nextLife);

                const lifeClamped = clamp(nextLife, float(0.0), float(1.0));
                const easeOut = float(1.0).sub(pow(float(1.0).sub(lifeClamped), float(3.0)));

                const baseMax = float(900.0).add(angle.z.mul(500.0));
                const maxRadius = baseMax.mul(float(1.0).add(burstFactor.mul(0.08)));
                const radius = float(120.0).add(maxRadius.sub(120.0).mul(easeOut));

                const sinPhi = sin(angle.y);
                const localSeed = misc.y;
                const spiralAngle = angle.x.add(localSeed).add(lifeClamped.mul(3.0).mul(angle.z.sub(0.5)));

                pos.x.assign(radius.mul(sinPhi).mul(cos(spiralAngle)).add(blackHolePos.x));
                pos.y.assign(radius.mul(sinPhi).mul(sin(spiralAngle)).add(blackHolePos.y));
                pos.z.assign(radius.mul(cos(angle.y)));

                If(nextLife.greaterThan(1.0), () => {
                    angle.w.assign(0.0);
                    life.x.assign(0.0);
                    pos.x.assign(0.0);
                    pos.y.assign(0.0);
                    pos.z.assign(-9999.0);
                });
            }).Else(() => {
                pos.x.assign(0.0);
                pos.y.assign(0.0);
                pos.z.assign(-9999.0);
            });

            positions.element(index).assign(pos);
            angles.element(index).assign(angle);
            lifeData.element(index).assign(life);
            miscData.element(index).assign(misc);
        });

        this.computeNode = computeBursts().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = delta;
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.blackHolePos) {
            this.uBlackHolePos.value.copy(params.blackHolePos);
        }
        if (params.burstFactor !== undefined) {
            this.uBurstFactor.value = params.burstFactor;
        }
    }

    trigger(seed = 0, intensity = 1.0) {
        const clampedIntensity = Math.max(0.0, Math.min(1.0, intensity));
        const minBatch = Math.max(256, Math.floor(this.count * 0.12));
        const maxBatch = Math.max(minBatch, Math.floor(this.count * 0.45));
        const targetBatch = Math.min(
            this.count,
            Math.floor(minBatch + (maxBatch - minBatch) * clampedIntensity),
        );

        let activated = 0;
        let scanned = 0;
        const startIndex = this.nextTriggerIndex;

        // Prefer inactive particles so ongoing bursts are not reset.
        while (activated < targetBatch && scanned < this.count) {
            const index = (startIndex + scanned) % this.count;
            const i4 = index * 4;

            if (this.angleData[i4 + 3] < 0.5) {
                this.angleData[i4 + 3] = 1.0;
                this.lifeData[i4] = 0.0;
                this.miscData[i4 + 1] = seed + (Math.random() - 0.5) * 0.9;
                activated += 1;
            }

            scanned += 1;
        }

        // Keep additive behavior stable: do not recycle active burst particles.
        // If saturated, we simply spawn fewer this trigger and preserve existing waves.

        this.nextTriggerIndex = (startIndex + scanned) % this.count;
        this.uBurstSeed.value = seed;
        this.angleBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getAngleBuffer() {
        return this.angleBuffer;
    }

    getLifeBuffer() {
        return this.lifeBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.angleBuffer = null;
        this.lifeBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.angleData = null;
        this.lifeData = null;
        this.miscData = null;
    }
}

export class BlackHoleLensingCompute {
    constructor(starCount) {
        this.count = starCount;

        this.baseData = new Float32Array(starCount * 4);
        this.outputData = new Float32Array(starCount * 4);

        this.baseBuffer = new THREE.StorageBufferAttribute(this.baseData, 4);
        this.outputBuffer = new THREE.StorageBufferAttribute(this.outputData, 4);

        this.uTime = uniform(0);
        this.uBlackHolePos = uniform(new THREE.Vector3(0, 0, 0));
        this.uStrength = uniform(0.6);
        this.uActiveCount = uniform(starCount);

        this.computeNode = null;
    }

    setInitialState(positions) {
        const count = this.count;
        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;
            const x = positions[i3];
            const y = positions[i3 + 1];
            const z = positions[i3 + 2];

            this.baseData[i4] = x;
            this.baseData[i4 + 1] = y;
            this.baseData[i4 + 2] = z;
            this.baseData[i4 + 3] = 1.0;

            this.outputData[i4] = x;
            this.outputData[i4 + 1] = y;
            this.outputData[i4 + 2] = z;
            this.outputData[i4 + 3] = 1.0;
        }

        this.baseBuffer.needsUpdate = true;
        this.outputBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const basePositions = storage(this.baseBuffer, 'vec4', this.count);
        const outputPositions = storage(this.outputBuffer, 'vec4', this.count);

        const blackHolePos = this.uBlackHolePos;
        const strength = this.uStrength;
        const activeCount = this.uActiveCount;

        const computeLensing = Fn(() => {
            const index = instanceIndex;
            const active = float(index).lessThan(activeCount);
            If(active, () => {
                const base = basePositions.element(index).toVar();
                const pos = outputPositions.element(index).toVar();

                const toCenter = base.xyz.sub(blackHolePos);
                const toCenter2d = vec2(toCenter.x, toCenter.y);
                const dist = length(toCenter2d);
                const safeDist = max(dist, float(1.0));

                const ringRadius = float(220.0);
                const ringWidth = float(140.0);
                const ring = smoothstep(ringRadius.sub(ringWidth), ringRadius, dist)
                    .sub(smoothstep(ringRadius, ringRadius.add(ringWidth), dist));

                const lensingStrength = strength.add(ring.mul(strength).mul(0.6));
                const deflect = lensingStrength.mul(float(500.0)).div(safeDist.add(120.0));
                const ringBoost = ring.mul(lensingStrength).mul(120.0);

                const dir2d = normalize(toCenter2d);
                const perp = vec2(dir2d.y.negate(), dir2d.x);

                const offset = dir2d.mul(deflect.add(ringBoost)).add(perp.mul(ringBoost.mul(0.4)));

                pos.x.assign(base.x.add(offset.x));
                pos.y.assign(base.y.add(offset.y));
                pos.z.assign(base.z);

                outputPositions.element(index).assign(pos);
            });
        });

        this.computeNode = computeLensing().compute(this.count);
        return this.computeNode;
    }

    update(params = {}) {
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.blackHolePos) {
            this.uBlackHolePos.value.copy(params.blackHolePos);
        }
        if (params.strength !== undefined) {
            this.uStrength.value = params.strength;
        }
        if (params.activeCount !== undefined) {
            this.uActiveCount.value = params.activeCount;
        }
    }

    getPositionBuffer() {
        return this.outputBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.baseBuffer = null;
        this.outputBuffer = null;
        this.baseData = null;
        this.outputData = null;
    }
}

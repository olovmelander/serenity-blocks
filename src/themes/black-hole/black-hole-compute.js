/* eslint-disable max-classes-per-file */
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
import { DISK_COS_TILT, DISK_SIN_TILT } from './black-hole-disk-basis.js';

// The ambient integrator MUST share the CPU integrator's reference cadence. The CPU authored
// every per-step constant (0.98505/0.998 damping, the 0.0009 orbital assist, position += vel*stepScale)
// against stepScale = simDelta*60 — a 60 Hz reference tick. Velocities are stored in units per
// reference tick, so this constant is that tick rate; it MUST be 60. At 30 (the earlier value)
// position advance, flow/burst damping and orbital assist all ran at HALF rate, so the dust held a
// slow-decaying orbit instead of spiralling into the hole. The compute-dispatch cadence is
// independent of this (delta is integrated), so any real framerate reproduces the same motion.
const PARTICLE_REFERENCE_HZ = 60.0;
const MAX_PARTICLE_DELTA = 0.075;

// RingGeometry is authored in local XY and rotated by -PI * 0.42 around X.
// Disk-local basis (tilt, cos, sin) is shared with the TSL materials so the physics
// and the rendered placement agree on exactly one plane. See black-hole-disk-basis.js.

function markFullBufferDirty(buffer) {
    buffer.clearUpdateRanges?.();
    buffer.needsUpdate = true;
}

function addBufferUpdateRange(buffer, start, count) {
    const lastRange = buffer.updateRanges[buffer.updateRanges.length - 1];
    const end = start + count;
    const lastEnd = lastRange ? lastRange.start + lastRange.count : -1;

    if (lastRange && start <= lastEnd && end >= lastRange.start) {
        const mergedStart = Math.min(lastRange.start, start);
        lastRange.start = mergedStart;
        lastRange.count = Math.max(lastEnd, end) - mergedStart;
        return;
    }

    buffer.addUpdateRange(start, count);
}

function markBufferRangeDirty(buffer, start, count) {
    addBufferUpdateRange(buffer, start, count);
    buffer.needsUpdate = true;
}

function releaseStorageBuffer(buffer) {
    if (!buffer) return;
    buffer.clearUpdateRanges?.();
    // StorageBufferAttribute has no dispose() in three r181. Keep this optional so
    // a future three upgrade can release it directly without changing call sites.
    buffer.dispose?.();
}

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
        this.uReferenceStep = uniform(0);
        this.uBurstDamping = uniform(1);
        this.uFlowDamping = uniform(1);
        this.uPlaneDamping = uniform(0);
        this.uTime = uniform(0);
        this.uBlackHolePos = uniform(new THREE.Vector3(0, 0, 0));
        this.uGravitySurge = uniform(0);
        this.uBurstFactor = uniform(0);
        this.uBurstPhase = uniform(0);
        this.uComboScatterUntil = uniform(0);
        this.uActiveCount = uniform(particleCount);

        this.computeNode = null;
    }

    setInitialState(positions, velocities, colors, sizes, lifetimes, randoms = null) {
        const { count } = this;
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

        markFullBufferDirty(this.positionBuffer);
        markFullBufferDirty(this.velocityBuffer);
        markFullBufferDirty(this.lifeBuffer);
        markFullBufferDirty(this.miscBuffer);
    }

    createComputeNode() {
        this.computeNode?.dispose?.();
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const referenceStep = this.uReferenceStep;
        const burstDamping = this.uBurstDamping;
        const flowDamping = this.uFlowDamping;
        const planeDamp = this.uPlaneDamping;
        const time = this.uTime;
        const blackHolePos = this.uBlackHolePos;
        const gravitySurge = this.uGravitySurge;
        const burstFactor = this.uBurstFactor;
        const burstPhase = this.uBurstPhase;
        const comboScatterUntil = this.uComboScatterUntil;
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
                // Only combo-spawned (lock-active) particles should receive burst/scatter force.
                const lockExpiredStep = step(misc.w, time);
                const lockActive = float(1.0).sub(lockExpiredStep);
                const scatterActive = step(time, comboScatterUntil).mul(lockActive);
                const burstRequested = max(step(float(0.5), burstPhase), step(float(0.06), burstFactor));
                const burstActive = burstRequested.mul(lockActive);
                const effectiveBurstFactor = max(burstFactor.mul(burstActive), scatterActive.mul(1.5));
                const burstBlend = smoothstep(float(0.0), float(8.0), effectiveBurstFactor);
                const isBurst = max(burstActive, scatterActive);
                const maxDistBase = mix(float(950.0), float(1700.0), burstBlend);
                const maxDist = mix(maxDistBase, float(4200.0), scatterActive);
                const minResetDist = mix(float(80.0), float(30.0), scatterActive);

                If(dist.greaterThan(50.0), () => {
                    If(isBurst.greaterThan(0.5), () => {
                        const burstStrength = effectiveBurstFactor.mul(float(400.0).div(dist.add(50.0))).mul(delta);
                        vel.x.addAssign(dir.x.negate().mul(burstStrength));
                        vel.y.addAssign(dir.y.negate().mul(burstStrength));
                        vel.z.addAssign(dir.z.negate().mul(burstStrength));

                        vel.x.mulAssign(burstDamping);
                        vel.y.mulAssign(burstDamping);
                        vel.z.mulAssign(burstDamping);

                        const speed = length(vel.xyz);
                        const maxSpeed = float(15.0).add(effectiveBurstFactor.mul(3.0));
                        If(speed.greaterThan(maxSpeed), () => {
                            const scale = maxSpeed.div(speed);
                            vel.x.assign(vel.x.mul(scale));
                            vel.y.assign(vel.y.mul(scale));
                            vel.z.assign(vel.z.mul(scale));
                        });
                    }).Else(() => {
                        const basePullStrength = float(800.0).div(dist.mul(dist).add(100.0)).mul(delta);
                        // STRONG suction during combos, eased smoothly back to 1.0 on the way out
                        // (no step snap). Equals the old 5 + surge*2 for surge >= 4 (full impact) and
                        // reaches 1.0 continuously as surge -> 0, so the post-combo pull settles
                        // smoothly. Mirrors the CPU path: 1 + surge*2 + smoothstep(0,4,surge)*4.
                        const surgeBoost = float(1.0)
                            .add(gravitySurge.mul(2.0))
                            .add(smoothstep(float(0.0), float(4.0), gravitySurge).mul(4.0));
                        const surgedPullStrength = basePullStrength.mul(surgeBoost);
                        // Keep combo-emitted particles from snapping straight back to center.
                        const pullStrength = surgedPullStrength.mul(
                            mix(float(1.0), float(0.08), lockActive),
                        );

                        // Match the CPU integrator EXACTLY: it pulls with the full position
                        // vector (`vel -= pos * pullStrength`), so the inward force scales with
                        // distance (|pull| ~ 800/d·dt). Using the unit `dir` here made the pull
                        // ~d× too weak (|pull| ~ 800/d²·dt) — at a ~400-unit dust radius that is
                        // hundreds of times weaker, so the dust orbited instead of being sucked in.
                        // toCenter == -pos here (compute runs black-hole-at-origin).
                        vel.x.addAssign(toCenter.x.mul(pullStrength));
                        vel.y.addAssign(toCenter.y.mul(pullStrength));
                        vel.z.addAssign(toCenter.z.mul(pullStrength));

                        // Preserve the old High-tier 0.995 * 0.99 damping at the
                        // 30 Hz reference cadence, with exponential time scaling.
                        vel.x.mulAssign(flowDamping);
                        vel.y.mulAssign(flowDamping);
                        vel.z.mulAssign(flowDamping);

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

                const cosT = float(DISK_COS_TILT);
                const sinT = float(DISK_SIN_TILT);
                const normal = vec3(float(0.0), sinT, cosT);

                const rel = pos.xyz.sub(blackHolePos);
                const planeOffset = rel.x.mul(normal.x).add(rel.y.mul(normal.y)).add(rel.z.mul(normal.z));
                const radialVec = rel.sub(normal.mul(planeOffset));
                const radialDist = max(length(radialVec), float(1.0));

                const tangentRaw = vec3(
                    normal.y.mul(radialVec.z).sub(normal.z.mul(radialVec.y)),
                    normal.z.mul(radialVec.x).sub(normal.x.mul(radialVec.z)),
                    normal.x.mul(radialVec.y).sub(normal.y.mul(radialVec.x)),
                );
                const tangent = normalize(tangentRaw.add(vec3(0.0001, 0.0001, 0.0001)));

                // Match the CPU's LINEAR innerBias ramp exactly: 1 - clamp((radialDist-220)/530, 0, 1).
                // A smoothstep here is a cubic curve that runs ~7% stronger in the inner disk, adding
                // extra orbit-holding tangential push that resists the inward spiral.
                const innerBias = float(1.0).sub(clamp(radialDist.sub(220.0).div(530.0), float(0.0), float(1.0)));
                const orbitalAssist = float(0.0009).add(innerBias.mul(0.0015)).mul(referenceStep);
                vel.x.addAssign(tangent.x.mul(orbitalAssist));
                vel.y.addAssign(tangent.y.mul(orbitalAssist));
                vel.z.addAssign(tangent.z.mul(orbitalAssist));

                // CPU: planePull = clampedPlaneOffset * planePullScale, planePullScale = simDelta*60.
                // referenceStep now == simDelta*60, so scale by it directly. (The old x2 only existed to
                // fake a 60 Hz step out of the previous 30 Hz reference; keeping it would now double this.)
                const planePull = clamp(planeOffset.mul(0.0035), float(-0.32), float(0.32))
                    .mul(referenceStep);
                vel.x.subAssign(normal.x.mul(planePull));
                vel.y.subAssign(normal.y.mul(planePull));
                vel.z.subAssign(normal.z.mul(planePull));

                const normalVelocity = vel.x.mul(normal.x).add(vel.y.mul(normal.y)).add(vel.z.mul(normal.z));
                // Normal-velocity plane damping; uPlaneDamping = min(0.35, dt*5), matching the CPU.
                vel.x.subAssign(normal.x.mul(normalVelocity).mul(planeDamp));
                vel.y.subAssign(normal.y.mul(normalVelocity).mul(planeDamp));
                vel.z.subAssign(normal.z.mul(normalVelocity).mul(planeDamp));

                pos.x.addAssign(vel.x.mul(referenceStep));
                pos.y.addAssign(vel.y.mul(referenceStep));
                pos.z.addAssign(vel.z.mul(referenceStep));

                const distAfter = length(blackHolePos.sub(pos.xyz));
                const outOfBounds = distAfter.lessThan(minResetDist).or(distAfter.greaterThan(maxDist));
                const lockExpired = lockExpiredStep.greaterThan(0.5);
                If(outOfBounds.and(lockExpired), () => {
                    const seed = float(index).add(time.mul(0.13));
                    const r1 = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                    const r2 = fract(sin(seed.mul(78.233)).mul(43758.5453));
                    const r3 = fract(sin(seed.mul(39.425)).mul(43758.5453));

                    const angle = r1.mul(6.28318530718);
                    const radius = float(260.0).add(r2.mul(360.0));
                    const height = r3.sub(0.5).mul(70.0);

                    const diskX = cos(angle).mul(radius);
                    const diskY = sin(angle).mul(radius);
                    const pY = diskY.mul(cosT).add(height.mul(sinT));
                    const pZ = diskY.mul(sinT).negate().add(height.mul(cosT));

                    pos.x.assign(blackHolePos.x.add(diskX));
                    pos.y.assign(blackHolePos.y.add(pY));
                    pos.z.assign(blackHolePos.z.add(pZ));

                    const orbitalSpeed = float(0.28).add(r2.mul(0.22));
                    const vx = sin(angle).negate().mul(orbitalSpeed);
                    const diskVy = cos(angle).mul(orbitalSpeed);
                    const normalJitter = r3.sub(0.5).mul(0.03);
                    const vY = diskVy.mul(cosT).add(normalJitter.mul(sinT));
                    const vZ = diskVy.mul(sinT).negate().add(normalJitter.mul(cosT));

                    vel.x.assign(vx);
                    vel.y.assign(vY);
                    vel.z.assign(vZ);

                    life.x.assign(float(0.64).add(r1.mul(0.26)));
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
        const safeDelta = Number.isFinite(delta)
            ? Math.max(0, Math.min(MAX_PARTICLE_DELTA, delta))
            : 0;
        const referenceStep = safeDelta * PARTICLE_REFERENCE_HZ;
        this.uDelta.value = safeDelta;
        this.uReferenceStep.value = referenceStep;
        // Compute cadence is shared by every particle, so evaluate exponential
        // damping once on the CPU instead of three pow() operations per invocation.
        this.uBurstDamping.value = 0.998 ** referenceStep;
        this.uFlowDamping.value = 0.98505 ** referenceStep;
        // CPU planeDamp = Math.min(0.35, simDelta*5) exactly. The old 1-(5/6)^referenceStep only
        // coincidentally matched at the previous 30 Hz reference; at 60 Hz it would over-damp ~2x.
        this.uPlaneDamping.value = Math.min(0.35, safeDelta * 5.0);
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
        if (params.comboScatterUntil !== undefined) {
            this.uComboScatterUntil.value = params.comboScatterUntil;
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

        // Storage buffers have already diverged from their CPU mirrors after the
        // first compute dispatch. Upload only this explicitly replaced slot.
        markBufferRangeDirty(this.positionBuffer, i4, 4);
        markBufferRangeDirty(this.velocityBuffer, i4, 4);
        markBufferRangeDirty(this.lifeBuffer, i4, 4);
        markBufferRangeDirty(this.miscBuffer, i4, 4);
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
        this.computeNode?.dispose?.();
        releaseStorageBuffer(this.positionBuffer);
        releaseStorageBuffer(this.velocityBuffer);
        releaseStorageBuffer(this.lifeBuffer);
        releaseStorageBuffer(this.miscBuffer);
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
    constructor(particleCount, options = {}) {
        this.count = particleCount;

        // position: xyz + spare
        // angles: theta, phi, random, spare (static parameters)
        // life: life, color.r, color.g, color.b
        // misc: baseSize + spare channels + spawnTime
        this.positionData = new Float32Array(particleCount * 4);
        this.angleData = new Float32Array(particleCount * 4);
        this.lifeData = new Float32Array(particleCount * 4);
        this.miscData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.angleBuffer = new THREE.StorageBufferAttribute(this.angleData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uTime = uniform(0);
        this.nextTriggerIndex = 0;
        this.reuseUntil = new Float32Array(particleCount);
        this.currentTime = 0;
        this.burstLifetimeSeconds = Math.max(6, Number(options.lifetimeSeconds) || 12.0);
        this.inactiveSpawnTime = 1e9;
        this.maxReuseUntil = 0;

        this.computeNode = null;
    }

    setInitialState(angles, colors, sizes, randoms = null) {
        const { count } = this;
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
            this.miscData[i4 + 3] = this.inactiveSpawnTime;
            this.reuseUntil[i] = 0;
        }
        this.maxReuseUntil = 0;

        markFullBufferDirty(this.positionBuffer);
        markFullBufferDirty(this.angleBuffer);
        markFullBufferDirty(this.lifeBuffer);
        markFullBufferDirty(this.miscBuffer);
    }

    createComputeNode() {
        this.computeNode?.dispose?.();
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const angles = storage(this.angleBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const time = this.uTime;
        const lifetime = float(this.burstLifetimeSeconds);

        const computeBursts = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const angle = angles.element(index);
            const life = lifeData.element(index).toVar();
            const misc = miscData.element(index);

            const spawnTime = misc.w;
            const age = time.sub(spawnTime);
            const hasSpawned = step(spawnTime, time);
            const active = hasSpawned.mul(step(age, lifetime));
            const lifeClamped = clamp(age.div(lifetime), float(0.0), float(1.0));
            life.x.assign(mix(float(0.0), lifeClamped, active));

            If(active.greaterThan(0.5), () => {
                pos.w.assign(1.0);

                // Explosion phase: life 0→0.4  |  Float phase: life 0.4→1.0
                const explosionProgress = clamp(lifeClamped.div(float(0.4)), float(0.0), float(1.0));
                const floatProgress = clamp(lifeClamped.sub(float(0.4)).div(float(0.6)), float(0.0), float(1.0));

                const maxRadius = float(900.0).add(angle.z.mul(700.0));
                const startRadius = float(120.0);

                const easeOut = float(1.0).sub(pow(float(1.0).sub(explosionProgress), float(2.5)));
                const explosionRadius = startRadius.add(maxRadius.sub(startRadius).mul(easeOut));

                // Drift angle - slight spiral during float phase
                const driftAngle = angle.x.add(lifeClamped.mul(1.5).mul(angle.z.sub(0.5)));

                // Gentle oscillating drift after explosion settles in local XY.
                const driftAmt = maxRadius.mul(0.12);
                const driftDiskX = sin(angle.z.mul(float(6.2832)).add(lifeClamped.mul(float(2.5))))
                    .mul(driftAmt).mul(floatProgress);
                const driftDiskY = cos(angle.z.mul(float(9.4248)).add(lifeClamped.mul(float(1.8))))
                    .mul(driftAmt).mul(floatProgress);

                // Burst expands in RingGeometry's local XY plane.
                const diskX = explosionRadius.mul(cos(driftAngle)).add(driftDiskX);
                const diskY = explosionRadius.mul(sin(driftAngle)).add(driftDiskY);
                const diskHeight = explosionRadius.mul(angle.y.sub(float(1.5708)).mul(float(0.04)));

                // Apply U/V/N basis for RingGeometry rotated -PI * 0.42 around X.
                const cosTilt = float(DISK_COS_TILT);
                const sinTilt = float(DISK_SIN_TILT);
                const px = diskX;
                const py = diskY.mul(cosTilt).add(diskHeight.mul(sinTilt));
                const pz = diskY.mul(sinTilt).negate().add(diskHeight.mul(cosTilt));

                // Keep burst positions local; render path applies current black-hole offset.
                pos.x.assign(px);
                pos.y.assign(py);
                pos.z.assign(pz);
            }).Else(() => {
                pos.x.assign(0.0);
                pos.y.assign(0.0);
                pos.z.assign(-9999.0);
                pos.w.assign(0.0);
            });

            positions.element(index).assign(pos);
            lifeData.element(index).assign(life);
        });

        this.computeNode = computeBursts().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        if (params.time !== undefined) {
            this.uTime.value = params.time;
            this.currentTime = params.time;
        } else {
            const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
            this.currentTime += safeDelta;
            this.uTime.value = this.currentTime;
        }
    }

    activateParticles(requestedCount, now = this.currentTime, seed = 0) {
        const targetBatch = Math.max(0, Math.floor(requestedCount));
        if (targetBatch <= 0) {
            return { activated: 0, remaining: 0 };
        }
        if (this.count <= 0) {
            return { activated: 0, remaining: targetBatch };
        }
        this.currentTime = now;

        let activated = 0;
        let scanned = 0;
        const seedOffset = this.count > 0 && Number.isFinite(seed)
            ? Math.abs(Math.trunc(seed * 9973)) % this.count
            : 0;
        const startIndex = (this.nextTriggerIndex + seedOffset) % this.count;

        // Prefer inactive particles so ongoing bursts are not reset.
        while (activated < targetBatch && scanned < this.count) {
            const index = (startIndex + scanned) % this.count;
            const i4 = index * 4;

            if (now >= this.reuseUntil[index]) {
                this.miscData[i4 + 3] = now;
                // Burst misc data is CPU-owned/read-only in the kernel, so full
                // adjacent vec4 slots can be merged into fewer queue writes.
                addBufferUpdateRange(this.miscBuffer, i4, 4);
                this.reuseUntil[index] = now + this.burstLifetimeSeconds;
                this.maxReuseUntil = Math.max(this.maxReuseUntil, this.reuseUntil[index]);
                activated += 1;
            }

            scanned += 1;
        }

        // Keep additive behavior stable: do not recycle active burst particles.
        // If saturated, we simply spawn fewer this trigger and preserve existing waves.

        this.nextTriggerIndex = (startIndex + scanned) % this.count;
        if (activated > 0) {
            // Spawn time is the only CPU-authored value the analytic burst kernel
            // consumes. Preserve every GPU-owned position and upload only touched
            // scalar ranges; a saturated request now causes no buffer upload.
            this.miscBuffer.needsUpdate = true;
        }

        return {
            activated,
            remaining: Math.max(0, targetBatch - activated),
        };
    }

    hasActiveParticles(now = this.currentTime) {
        return now <= this.maxReuseUntil;
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
        this.computeNode?.dispose?.();
        releaseStorageBuffer(this.positionBuffer);
        releaseStorageBuffer(this.angleBuffer);
        releaseStorageBuffer(this.lifeBuffer);
        releaseStorageBuffer(this.miscBuffer);
        this.computeNode = null;
        this.positionBuffer = null;
        this.angleBuffer = null;
        this.lifeBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.angleData = null;
        this.lifeData = null;
        this.miscData = null;
        this.reuseUntil = null;
    }
}

export class BlackHoleLensingCompute {
    constructor(starCount) {
        this.count = starCount;

        this.baseData = new Float32Array(starCount * 4);
        this.outputData = new Float32Array(starCount * 4);

        this.baseBuffer = new THREE.StorageBufferAttribute(this.baseData, 4);
        this.outputBuffer = new THREE.StorageBufferAttribute(this.outputData, 4);

        this.uBlackHolePos = uniform(new THREE.Vector3(0, 0, 0));
        this.uStrength = uniform(0.6);
        this.uActiveCount = uniform(starCount);

        this.computeNode = null;
    }

    setInitialState(positions) {
        const { count } = this;
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

        markFullBufferDirty(this.baseBuffer);
        markFullBufferDirty(this.outputBuffer);
    }

    createComputeNode() {
        this.computeNode?.dispose?.();
        const basePositions = storage(this.baseBuffer, 'vec4', this.count);
        const outputPositions = storage(this.outputBuffer, 'vec4', this.count);

        const blackHolePos = this.uBlackHolePos;
        const strength = this.uStrength;
        const activeCount = this.uActiveCount;

        const computeLensing = Fn(() => {
            const index = instanceIndex;
            const active = float(index).lessThan(activeCount);
            If(active, () => {
                const base = basePositions.element(index);
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
        this.computeNode?.dispose?.();
        releaseStorageBuffer(this.baseBuffer);
        releaseStorageBuffer(this.outputBuffer);
        this.computeNode = null;
        this.baseBuffer = null;
        this.outputBuffer = null;
        this.baseData = null;
        this.outputData = null;
    }
}

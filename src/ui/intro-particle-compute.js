/**
 * Intro Animation - GPU Compute Particle System
 * Handles all particle types in a unified compute dispatch:
 *   Type 0: Stars (25,000) - layered far/mid/near depth field
 *   Type 1: Nebula particles (2,200) - soft swirl and pulse accents
 *   Type 2: Sparkles (2,500) - twinkling foreground motes
 *   Type 3: Shooting star trails (450) - streaking trails + tetromino trails
 *   Type 4: Collision bursts (512) - controlled event particles
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    clamp,
    float,
    fract,
    instanceIndex,
    int,
    sin,
    sqrt,
    storage,
    uniform,
} from 'three/tsl';

const TYPE_STAR = 0;
const TYPE_NEBULA = 1;
const TYPE_SPARKLE = 2;
const TYPE_SHOOTING_TRAIL = 3;
const TYPE_COLLISION_BURST = 4;

const STAR_COUNT = 25000;
const NEBULA_COUNT = 2200;
const SPARKLE_COUNT = 2500;
const SHOOTING_TRAIL_COUNT = 450;
const COLLISION_BURST_COUNT = 512;
const MAX_TETROMINO_SLOTS = 50;
const RESERVED_TETROMINO_TRAILS = Math.min(SHOOTING_TRAIL_COUNT, MAX_TETROMINO_SLOTS * 2);

const TOTAL_PARTICLES = STAR_COUNT + NEBULA_COUNT + SPARKLE_COUNT + SHOOTING_TRAIL_COUNT + COLLISION_BURST_COUNT;

const STAR_OFFSET = 0;
const NEBULA_OFFSET = STAR_COUNT;
const SPARKLE_OFFSET = NEBULA_OFFSET + NEBULA_COUNT;
const SHOOTING_OFFSET = SPARKLE_OFFSET + SPARKLE_COUNT;
const COLLISION_OFFSET = SHOOTING_OFFSET + SHOOTING_TRAIL_COUNT;

const GALAXY_COLORS = [
    [1.0, 0.2, 0.4],
    [0.0, 1.0, 1.0],
    [1.0, 1.0, 0.0],
    [1.0, 0.4, 0.0],
    [0.6, 0.2, 1.0],
    [0.0, 1.0, 0.4],
    [1.0, 0.0, 0.6],
    [0.2, 0.6, 1.0],
];

export class IntroParticleCompute {
    constructor() {
        this.count = TOTAL_PARTICLES;

        this.positionData = new Float32Array(TOTAL_PARTICLES * 4);
        this.velocityData = new Float32Array(TOTAL_PARTICLES * 4);
        this.lifeData = new Float32Array(TOTAL_PARTICLES * 4);
        this.miscData = new Float32Array(TOTAL_PARTICLES * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uAttractionStrength = uniform(0.85);
        this.uWarpFactor = uniform(0);
        this.uAudioPulse = uniform(0);
        this.uEventIntensity = uniform(1.0);

        this.shootingStarCursor = 0;
        this.trailCursor = 0;
        this.TRAIL_POINTS_PER_STAR = 15;
        this.MAX_SHOOTING_STARS = 20;
        this.lastShootingStarTime = 0;
        this.dynamicTrailCount = Math.max(1, SHOOTING_TRAIL_COUNT - RESERVED_TETROMINO_TRAILS);

        this.shootingStarMinInterval = 2.0;
        this.shootingStarMaxInterval = 5.0;
        this.enableAutoShootingStars = true;
        this.qualityKey = 'HIGH';
        this.layerProfile = {
            far: { ratio: 0.68, sizeMin: 0.06, sizeMax: 0.16, speedMul: 0.72 },
            mid: { ratio: 0.24, sizeMin: 0.18, sizeMax: 0.34, speedMul: 1.0 },
            near: { ratio: 0.08, sizeMin: 0.36, sizeMax: 0.64, speedMul: 1.36 },
        };

        this.collisionCursor = 0;
        this.PARTICLES_PER_BURST = 32;
        this.MAX_BURSTS = 16;

        this.computeNode = null;

        this.tetrominoPositionBuffer = null;
        this.tetrominoVelocityBuffer = null;
        this.tetrominoCount = 0;
    }

    _markParticleRangeUpdated(buffer, particleStart, particleCount = 1) {
        if (!buffer || particleCount <= 0) return;

        const start = Math.max(0, particleStart * 4);
        const count = Math.max(0, particleCount * 4);

        if (typeof buffer.addUpdateRange === 'function') {
            buffer.addUpdateRange(start, count);
        }
        buffer.needsUpdate = true;
    }

    initializeParticles() {
        this._initStars();
        this._initNebula();
        this._initSparkles();
        this._initShootingTrails();
        this._initCollisionBursts();

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    _initStars() {
        const farRatio = Math.max(0.0, Math.min(1.0, this.layerProfile.far.ratio));
        const midRatio = Math.max(0.0, Math.min(1.0, this.layerProfile.mid.ratio));
        const farCutoff = farRatio;
        const midCutoff = Math.min(1.0, farRatio + midRatio);

        for (let i = 0; i < STAR_COUNT; i++) {
            const idx = (STAR_OFFSET + i) * 4;
            const color = GALAXY_COLORS[Math.floor(Math.random() * GALAXY_COLORS.length)];
            const layerSeed = Math.random();

            let sizeMin = this.layerProfile.mid.sizeMin;
            let sizeMax = this.layerProfile.mid.sizeMax;
            let speedMul = this.layerProfile.mid.speedMul;

            if (layerSeed < farCutoff) {
                sizeMin = this.layerProfile.far.sizeMin;
                sizeMax = this.layerProfile.far.sizeMax;
                speedMul = this.layerProfile.far.speedMul;
            } else if (layerSeed >= midCutoff) {
                sizeMin = this.layerProfile.near.sizeMin;
                sizeMax = this.layerProfile.near.sizeMax;
                speedMul = this.layerProfile.near.speedMul;
            }

            this.positionData[idx] = (Math.random() - 0.5) * 300;
            this.positionData[idx + 1] = (Math.random() - 0.5) * 300;
            this.positionData[idx + 2] = (Math.random() - 0.5) * 200 - 50;
            this.positionData[idx + 3] = TYPE_STAR;

            this.velocityData[idx] = (Math.random() - 0.5) * 0.01 * speedMul;
            this.velocityData[idx + 1] = (Math.random() - 0.5) * 0.01 * speedMul;
            this.velocityData[idx + 2] = (Math.random() - 0.5) * 0.005 * speedMul;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 1.0;
            this.lifeData[idx + 1] = color[0] * 0.7 + 0.3;
            this.lifeData[idx + 2] = color[1] * 0.7 + 0.3;
            this.lifeData[idx + 3] = color[2] * 0.7 + 0.3;

            this.miscData[idx] = sizeMin + Math.random() * Math.max(0.001, sizeMax - sizeMin);
            this.miscData[idx + 1] = Math.random() * Math.PI * 2;
            this.miscData[idx + 2] = layerSeed;
            this.miscData[idx + 3] = 1.0;
        }
    }

    _initNebula() {
        for (let i = 0; i < NEBULA_COUNT; i++) {
            const idx = (NEBULA_OFFSET + i) * 4;
            const color = GALAXY_COLORS[Math.floor(Math.random() * GALAXY_COLORS.length)];

            const angle = Math.random() * Math.PI * 2;
            const radius = 10 + Math.random() * 50;
            const spread = 5;

            this.positionData[idx] = Math.cos(angle) * radius + (Math.random() - 0.5) * spread;
            this.positionData[idx + 1] = (Math.random() - 0.5) * 40;
            this.positionData[idx + 2] = Math.sin(angle) * radius - 20 + (Math.random() - 0.5) * spread;
            this.positionData[idx + 3] = TYPE_NEBULA;

            this.velocityData[idx] = -Math.sin(angle) * 0.02;
            this.velocityData[idx + 1] = (Math.random() - 0.5) * 0.01;
            this.velocityData[idx + 2] = Math.cos(angle) * 0.02;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 1.0;
            this.lifeData[idx + 1] = color[0];
            this.lifeData[idx + 2] = color[1];
            this.lifeData[idx + 3] = color[2];

            this.miscData[idx] = 1.0 + Math.random() * 2.0;
            this.miscData[idx + 1] = Math.random() * Math.PI * 2;
            this.miscData[idx + 2] = Math.random();
            this.miscData[idx + 3] = 1.0;
        }
    }

    _initSparkles() {
        for (let i = 0; i < SPARKLE_COUNT; i++) {
            const idx = (SPARKLE_OFFSET + i) * 4;

            this.positionData[idx] = (Math.random() - 0.5) * 150;
            this.positionData[idx + 1] = (Math.random() - 0.5) * 100;
            this.positionData[idx + 2] = (Math.random() - 0.5) * 100 - 30;
            this.positionData[idx + 3] = TYPE_SPARKLE;

            this.velocityData[idx] = 0;
            this.velocityData[idx + 1] = 0;
            this.velocityData[idx + 2] = 0;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 1.0;
            this.lifeData[idx + 1] = 1.0;
            this.lifeData[idx + 2] = 1.0;
            this.lifeData[idx + 3] = 1.0;

            this.miscData[idx] = Math.random() * 0.3 + 0.1;
            this.miscData[idx + 1] = Math.random() * Math.PI * 2;
            this.miscData[idx + 2] = Math.random();
            this.miscData[idx + 3] = 1.0;
        }
    }

    _initShootingTrails() {
        for (let i = 0; i < SHOOTING_TRAIL_COUNT; i++) {
            const idx = (SHOOTING_OFFSET + i) * 4;

            this.positionData[idx] = 0;
            this.positionData[idx + 1] = 0;
            this.positionData[idx + 2] = -9999;
            this.positionData[idx + 3] = TYPE_SHOOTING_TRAIL;

            this.velocityData[idx] = 0;
            this.velocityData[idx + 1] = 0;
            this.velocityData[idx + 2] = 0;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 0;
            this.lifeData[idx + 1] = 1.0;
            this.lifeData[idx + 2] = 1.0;
            this.lifeData[idx + 3] = 1.0;

            if (i < RESERVED_TETROMINO_TRAILS) {
                const slot = i % MAX_TETROMINO_SLOTS;
                const layer = Math.floor(i / MAX_TETROMINO_SLOTS);
                this.miscData[idx] = 0.15 + layer * 0.08;
                this.miscData[idx + 1] = -1.0 - layer; // marks GPU-driven tetromino trails
                this.miscData[idx + 2] = slot;
                this.miscData[idx + 3] = 1.0;
            } else {
                const trailIndex = i % this.TRAIL_POINTS_PER_STAR;
                this.miscData[idx] = 0.5;
                this.miscData[idx + 1] = trailIndex / this.TRAIL_POINTS_PER_STAR;
                this.miscData[idx + 2] = Math.random();
                this.miscData[idx + 3] = 0.0;
            }
        }
    }

    _initCollisionBursts() {
        for (let i = 0; i < COLLISION_BURST_COUNT; i++) {
            const idx = (COLLISION_OFFSET + i) * 4;

            this.positionData[idx] = 0;
            this.positionData[idx + 1] = 0;
            this.positionData[idx + 2] = -9999;
            this.positionData[idx + 3] = TYPE_COLLISION_BURST;

            this.velocityData[idx] = 0;
            this.velocityData[idx + 1] = 0;
            this.velocityData[idx + 2] = 0;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 0;
            this.lifeData[idx + 1] = 1.0;
            this.lifeData[idx + 2] = 1.0;
            this.lifeData[idx + 3] = 1.0;

            this.miscData[idx] = 0.5;
            this.miscData[idx + 1] = Math.floor(Math.random() * MAX_TETROMINO_SLOTS);
            this.miscData[idx + 2] = Math.floor(Math.random() * MAX_TETROMINO_SLOTS);
            this.miscData[idx + 3] = 0.0;
        }
    }

    bindTetrominoBuffers(positionBuffer, velocityBuffer, count = MAX_TETROMINO_SLOTS) {
        this.tetrominoPositionBuffer = positionBuffer || null;
        this.tetrominoVelocityBuffer = velocityBuffer || null;
        this.tetrominoCount = Math.max(0, count | 0);
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);
        const hasTetrominoSource = !!(this.tetrominoPositionBuffer && this.tetrominoVelocityBuffer && this.tetrominoCount > 0);
        const tetrominoPositions = hasTetrominoSource
            ? storage(this.tetrominoPositionBuffer, 'vec4', this.tetrominoCount)
            : null;
        const tetrominoVelocities = hasTetrominoSource
            ? storage(this.tetrominoVelocityBuffer, 'vec4', this.tetrominoCount)
            : null;
        const tetrominoCount = Math.max(1, this.tetrominoCount || 1);

        const time = this.uTime;
        const delta = this.uDelta;
        const attraction = this.uAttractionStrength;
        const warp = this.uWarpFactor;
        const audioPulse = this.uAudioPulse;
        const eventIntensity = this.uEventIntensity;

        const computeParticles = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const life = lifeData.element(index).toVar();
            const misc = miscData.element(index).toVar();

            const particleType = pos.w;
            const active = misc.w.greaterThan(float(0.5));

            If(active, () => {
                const isStar = particleType.lessThan(float(0.5));
                If(isStar, () => {
                    const phase = misc.y;
                    const sway = sin(time.mul(float(0.3)).add(phase)).mul(float(0.005));
                    const centerPullX = pos.x.negate().mul(float(0.0004)).mul(attraction);
                    const centerPullY = pos.y.negate().mul(float(0.0003)).mul(attraction);

                    pos.x.addAssign(vel.x.add(sway).add(centerPullX).mul(delta));
                    pos.y.addAssign(vel.y.add(centerPullY).mul(delta));
                    pos.z.addAssign(vel.z.sub(warp.mul(float(0.7))).mul(delta));

                    const colorShift = sin(time.mul(float(0.5)).add(misc.z.mul(float(10.0)))).mul(float(0.05));
                    life.y.addAssign(colorShift.mul(delta));
                    life.z.addAssign(colorShift.mul(float(0.7)).mul(delta));
                    life.x.assign(clamp(life.x.add(audioPulse.mul(float(0.08))), float(0.2), float(1.0)));

                    const wrapBound = float(150.0);
                    If(abs(pos.x).greaterThan(wrapBound), () => {
                        pos.x.assign(pos.x.negate());
                    });
                    If(abs(pos.y).greaterThan(wrapBound), () => {
                        pos.y.assign(pos.y.negate());
                    });
                });

                const isNebula = particleType.greaterThan(float(0.5)).and(particleType.lessThan(float(1.5)));
                If(isNebula, () => {
                    const swirlX = pos.z.negate().mul(float(0.0005));
                    const swirlZ = pos.x.mul(float(0.0005));
                    const toCenterX = pos.x.negate().mul(float(0.0008)).mul(attraction);
                    const toCenterZ = pos.z.add(float(20.0)).negate().mul(float(0.0008)).mul(attraction);

                    pos.x.addAssign(vel.x.add(swirlX).add(toCenterX).mul(delta).mul(float(60.0)));
                    pos.y.addAssign(vel.y.mul(delta).mul(float(60.0)));
                    pos.z.addAssign(vel.z.add(swirlZ).add(toCenterZ).sub(warp.mul(float(0.35))).mul(delta).mul(float(60.0)));

                    const pulse = sin(time.mul(float(2.0)).add(misc.y)).mul(float(0.25)).add(float(1.0)).add(audioPulse.mul(float(0.15)));
                    misc.x.assign(clamp(misc.x.mul(pulse), float(0.5), float(4.0)));
                });

                const isSparkle = particleType.greaterThan(float(1.5)).and(particleType.lessThan(float(2.5)));
                If(isSparkle, () => {
                    const twinkle = abs(sin(time.mul(float(3.0)).add(misc.y))).mul(float(0.75)).add(float(0.25));
                    life.x.assign(clamp(twinkle.add(audioPulse.mul(float(0.18))), float(0.0), float(1.0)));
                });

                const isTrail = particleType.greaterThan(float(2.5)).and(particleType.lessThan(float(3.5)));
                If(isTrail, () => {
                    const isTetrominoTrail = misc.y.lessThan(float(-0.5));
                    If(isTetrominoTrail, () => {
                        if (hasTetrominoSource) {
                            const slot = int(clamp(misc.z, float(0.0), float(tetrominoCount - 1)));
                            const tPos = tetrominoPositions.element(slot).toVar();
                            const tVel = tetrominoVelocities.element(slot).toVar();
                            const tActive = tPos.w.greaterThan(float(0.5));

                            If(tActive, () => {
                                const layerOffset = misc.y.add(float(1.0)).negate();
                                const trailDistance = float(16.0).add(layerOffset.mul(float(8.0)));
                                pos.x.assign(tPos.x.sub(tVel.x.mul(trailDistance)));
                                pos.y.assign(tPos.y.sub(tVel.y.mul(trailDistance)));
                                pos.z.assign(tPos.z.sub(tVel.z.mul(trailDistance)));
                                vel.x.assign(tVel.x.mul(float(0.35)));
                                vel.y.assign(tVel.y.mul(float(0.35)));
                                vel.z.assign(tVel.z.mul(float(0.35)));
                                life.x.assign(float(0.35).mul(eventIntensity).add(audioPulse.mul(float(0.2))));
                                life.y.assign(float(0.95));
                                life.z.assign(float(0.9).add(audioPulse.mul(float(0.1))));
                                life.w.assign(float(1.0));
                                misc.w.assign(float(1.0));
                            });

                            If(tActive.not(), () => {
                                life.x.assign(float(0.0));
                                misc.w.assign(float(0.0));
                                pos.z.assign(float(-9999.0));
                            });
                        } else {
                            life.x.assign(float(0.0));
                            misc.w.assign(float(0.0));
                            pos.z.assign(float(-9999.0));
                        }
                    });

                    const isDynamicTrail = isTetrominoTrail.not();
                    If(isDynamicTrail, () => {
                        pos.x.addAssign(vel.x.mul(delta).mul(float(60.0)));
                        pos.y.addAssign(vel.y.mul(delta).mul(float(60.0)));
                        pos.z.addAssign(vel.z.sub(warp.mul(float(0.5))).mul(delta).mul(float(60.0)));

                        life.x.subAssign(delta.mul(float(0.9)).div(eventIntensity));

                        const dead = life.x.lessThanEqual(float(0.0));
                        If(dead, () => {
                            misc.w.assign(float(0.0));
                            pos.z.assign(float(-9999.0));
                        });
                    });
                });

                const isBurst = particleType.greaterThan(float(3.5));
                If(isBurst, () => {
                    vel.x.assign(vel.x.mul(float(0.98)));
                    vel.y.assign(vel.y.mul(float(0.98)));
                    vel.z.assign(vel.z.mul(float(0.98)));

                    pos.x.addAssign(vel.x.mul(delta).mul(float(60.0)));
                    pos.y.addAssign(vel.y.mul(delta).mul(float(60.0)));
                    pos.z.addAssign(vel.z.mul(delta).mul(float(60.0)));

                    life.x.subAssign(delta.mul(float(2.0)).div(eventIntensity));

                    const dead = life.x.lessThanEqual(float(0.0));
                    If(dead, () => {
                        misc.w.assign(float(0.0));
                        pos.z.assign(float(-9999.0));
                    });
                });
            });

            const inactive = active.not();
            If(inactive, () => {
                const isBurst = particleType.greaterThan(float(3.5));
                If(isBurst, () => {
                    if (hasTetrominoSource) {
                        const slotA = int(clamp(misc.y, float(0.0), float(tetrominoCount - 1)));
                        const slotB = int(clamp(misc.z, float(0.0), float(tetrominoCount - 1)));
                        const posA = tetrominoPositions.element(slotA).toVar();
                        const posB = tetrominoPositions.element(slotB).toVar();
                        const bothActive = posA.w.greaterThan(float(0.5)).and(posB.w.greaterThan(float(0.5)));

                        If(bothActive, () => {
                            const dx = posA.x.sub(posB.x);
                            const dy = posA.y.sub(posB.y);
                            const dz = posA.z.sub(posB.z);
                            const distSq = dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));
                            const near = distSq.lessThan(float(40.0));
                            const proximity = clamp(float(1.0).sub(sqrt(distSq).div(float(6.5))), float(0.0), float(1.0));
                            const triggerBias = fract(sin(time.mul(float(11.73)).add(float(index).mul(float(0.183)))).mul(float(43758.5453)));
                            const shouldTrigger = near.and(triggerBias.lessThan(proximity.mul(float(0.08)).mul(eventIntensity)));

                            If(shouldTrigger, () => {
                                const cx = posA.x.add(posB.x).mul(float(0.5));
                                const cy = posA.y.add(posB.y).mul(float(0.5));
                                const cz = posA.z.add(posB.z).mul(float(0.5));
                                const seed = float(index).add(time.mul(float(13.37)));
                                const rx = fract(sin(seed.mul(float(12.9898))).mul(float(43758.5453))).sub(float(0.5));
                                const ry = fract(sin(seed.mul(float(78.233))).mul(float(43758.5453))).sub(float(0.5));
                                const rz = fract(sin(seed.mul(float(39.425))).mul(float(43758.5453))).sub(float(0.5));
                                pos.x.assign(cx);
                                pos.y.assign(cy);
                                pos.z.assign(cz);
                                vel.x.assign(rx.mul(float(0.55)).mul(eventIntensity));
                                vel.y.assign(ry.mul(float(0.55)).mul(eventIntensity));
                                vel.z.assign(rz.mul(float(0.55)).mul(eventIntensity));
                                life.x.assign(float(1.0));
                                life.y.assign(float(1.0));
                                life.z.assign(float(0.9).add(audioPulse.mul(float(0.1))));
                                life.w.assign(float(1.0));
                                misc.w.assign(float(1.0));
                            });
                        });
                    }
                });
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            lifeData.element(index).assign(life);
            miscData.element(index).assign(misc);
        });

        this.computeNode = computeParticles().compute(this.count);
        return this.computeNode;
    }

    spawnShootingStar() {
        const starIndex = this.shootingStarCursor;
        const baseOffset = SHOOTING_OFFSET + RESERVED_TETROMINO_TRAILS + starIndex * this.TRAIL_POINTS_PER_STAR;

        const startX = (Math.random() - 0.5) * 100 + 30;
        const startY = 40 + Math.random() * 20;
        const startZ = -20 - Math.random() * 30;

        const vx = -0.8 - Math.random() * 0.5;
        const vy = -0.5 - Math.random() * 0.3;

        for (let j = 0; j < this.TRAIL_POINTS_PER_STAR; j++) {
            const idx = (baseOffset + j) * 4;
            const trailFraction = j / this.TRAIL_POINTS_PER_STAR;

            this.positionData[idx] = startX - vx * trailFraction * 0.5;
            this.positionData[idx + 1] = startY - vy * trailFraction * 0.5;
            this.positionData[idx + 2] = startZ;
            this.positionData[idx + 3] = TYPE_SHOOTING_TRAIL;

            const speedFalloff = 1.0 - trailFraction * 0.3;
            this.velocityData[idx] = vx * speedFalloff;
            this.velocityData[idx + 1] = vy * speedFalloff;
            this.velocityData[idx + 2] = 0;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 1.0 - trailFraction * 0.5;
            this.lifeData[idx + 1] = 1.0;
            this.lifeData[idx + 2] = 1.0;
            this.lifeData[idx + 3] = 1.0;

            this.miscData[idx] = (1.0 - trailFraction) * 0.8 + 0.1;
            this.miscData[idx + 1] = trailFraction;
            this.miscData[idx + 2] = Math.random();
            this.miscData[idx + 3] = 1.0;
        }

        this.shootingStarCursor = (this.shootingStarCursor + 1) % this.MAX_SHOOTING_STARS;
        this._markParticleRangeUpdated(this.positionBuffer, baseOffset, this.TRAIL_POINTS_PER_STAR);
        this._markParticleRangeUpdated(this.velocityBuffer, baseOffset, this.TRAIL_POINTS_PER_STAR);
        this._markParticleRangeUpdated(this.lifeBuffer, baseOffset, this.TRAIL_POINTS_PER_STAR);
        this._markParticleRangeUpdated(this.miscBuffer, baseOffset, this.TRAIL_POINTS_PER_STAR);
    }

    spawnTetrominoTrail(x, y, z, vx, vy, vz) {
        const segmentCount = 3;
        const dynamicCount = this.dynamicTrailCount;
        if (dynamicCount <= 0) return;

        for (let j = 0; j < segmentCount; j++) {
            const particleIndex = SHOOTING_OFFSET + RESERVED_TETROMINO_TRAILS + ((this.trailCursor + j) % dynamicCount);
            const idx = particleIndex * 4;
            const back = j * 0.35;

            this.positionData[idx] = x - vx * back;
            this.positionData[idx + 1] = y - vy * back;
            this.positionData[idx + 2] = z - vz * back;
            this.positionData[idx + 3] = TYPE_SHOOTING_TRAIL;

            this.velocityData[idx] = vx * 0.4;
            this.velocityData[idx + 1] = vy * 0.4;
            this.velocityData[idx + 2] = vz * 0.4;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 0.55 - j * 0.12;
            this.lifeData[idx + 1] = 0.95;
            this.lifeData[idx + 2] = 0.9;
            this.lifeData[idx + 3] = 1.0;

            this.miscData[idx] = 0.22 - j * 0.04;
            this.miscData[idx + 1] = j / segmentCount;
            this.miscData[idx + 2] = Math.random();
            this.miscData[idx + 3] = 1.0;
        }

        this.trailCursor = (this.trailCursor + segmentCount) % dynamicCount;
        this._markParticleRangeUpdated(this.positionBuffer, SHOOTING_OFFSET + RESERVED_TETROMINO_TRAILS, dynamicCount);
        this._markParticleRangeUpdated(this.velocityBuffer, SHOOTING_OFFSET + RESERVED_TETROMINO_TRAILS, dynamicCount);
        this._markParticleRangeUpdated(this.lifeBuffer, SHOOTING_OFFSET + RESERVED_TETROMINO_TRAILS, dynamicCount);
        this._markParticleRangeUpdated(this.miscBuffer, SHOOTING_OFFSET + RESERVED_TETROMINO_TRAILS, dynamicCount);
    }

    spawnCollisionBurst(x, y, z) {
        const burstIndex = this.collisionCursor;
        const baseOffset = COLLISION_OFFSET + burstIndex * this.PARTICLES_PER_BURST;

        const color = GALAXY_COLORS[Math.floor(Math.random() * GALAXY_COLORS.length)];

        for (let j = 0; j < this.PARTICLES_PER_BURST; j++) {
            const idx = (baseOffset + j) * 4;

            this.positionData[idx] = x;
            this.positionData[idx + 1] = y;
            this.positionData[idx + 2] = z;
            this.positionData[idx + 3] = TYPE_COLLISION_BURST;

            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.5) * Math.PI;
            const speed = 0.2 + Math.random() * 0.4;

            this.velocityData[idx] = Math.cos(angle) * Math.cos(elevation) * speed;
            this.velocityData[idx + 1] = Math.sin(elevation) * speed;
            this.velocityData[idx + 2] = Math.sin(angle) * Math.cos(elevation) * speed;
            this.velocityData[idx + 3] = 0;

            this.lifeData[idx] = 1.0;
            this.lifeData[idx + 1] = color[0];
            this.lifeData[idx + 2] = color[1];
            this.lifeData[idx + 3] = color[2];

            this.miscData[idx] = 0.3 + Math.random() * 0.4;
            this.miscData[idx + 1] = 0;
            this.miscData[idx + 2] = Math.random();
            this.miscData[idx + 3] = 1.0;
        }

        this.collisionCursor = (this.collisionCursor + 1) % this.MAX_BURSTS;
        this._markParticleRangeUpdated(this.positionBuffer, baseOffset, this.PARTICLES_PER_BURST);
        this._markParticleRangeUpdated(this.velocityBuffer, baseOffset, this.PARTICLES_PER_BURST);
        this._markParticleRangeUpdated(this.lifeBuffer, baseOffset, this.PARTICLES_PER_BURST);
        this._markParticleRangeUpdated(this.miscBuffer, baseOffset, this.PARTICLES_PER_BURST);
    }

    setAttractionStrength(value) {
        this.uAttractionStrength.value = Math.max(0.0, Math.min(1.5, value));
    }

    setLayerProfile(layers) {
        if (!layers) return;
        this.layerProfile = {
            far: {
                ratio: Number.isFinite(layers?.far?.ratio) ? layers.far.ratio : this.layerProfile.far.ratio,
                sizeMin: Number.isFinite(layers?.far?.sizeMin) ? layers.far.sizeMin : this.layerProfile.far.sizeMin,
                sizeMax: Number.isFinite(layers?.far?.sizeMax) ? layers.far.sizeMax : this.layerProfile.far.sizeMax,
                speedMul: Number.isFinite(layers?.far?.speedMul) ? layers.far.speedMul : this.layerProfile.far.speedMul,
            },
            mid: {
                ratio: Number.isFinite(layers?.mid?.ratio) ? layers.mid.ratio : this.layerProfile.mid.ratio,
                sizeMin: Number.isFinite(layers?.mid?.sizeMin) ? layers.mid.sizeMin : this.layerProfile.mid.sizeMin,
                sizeMax: Number.isFinite(layers?.mid?.sizeMax) ? layers.mid.sizeMax : this.layerProfile.mid.sizeMax,
                speedMul: Number.isFinite(layers?.mid?.speedMul) ? layers.mid.speedMul : this.layerProfile.mid.speedMul,
            },
            near: {
                ratio: Number.isFinite(layers?.near?.ratio) ? layers.near.ratio : this.layerProfile.near.ratio,
                sizeMin: Number.isFinite(layers?.near?.sizeMin) ? layers.near.sizeMin : this.layerProfile.near.sizeMin,
                sizeMax: Number.isFinite(layers?.near?.sizeMax) ? layers.near.sizeMax : this.layerProfile.near.sizeMax,
                speedMul: Number.isFinite(layers?.near?.speedMul) ? layers.near.speedMul : this.layerProfile.near.speedMul,
            },
        };
    }

    setEventIntensity(value) {
        this.uEventIntensity.value = Math.max(0.35, Math.min(1.6, value));
    }

    setWarpFactor(value) {
        this.uWarpFactor.value = Math.max(0.0, Math.min(1.0, value));
    }

    setAudioPulse(value) {
        this.uAudioPulse.value = Math.max(0.0, Math.min(1.0, value));
    }

    setBackgroundMode(enabled) {
        this.enableAutoShootingStars = !enabled;
        if (enabled) {
            this.shootingStarMinInterval = 3.5;
            this.shootingStarMaxInterval = 6.0;
        } else {
            this.shootingStarMinInterval = 2.0;
            this.shootingStarMaxInterval = 5.0;
        }

        this.applyQualityProfile(this.qualityKey, enabled);
    }

    applyQualityProfile(qualityKey, backgroundMode = false) {
        this.qualityKey = qualityKey || this.qualityKey;

        let starRatio = 1.0;
        let nebulaRatio = 1.0;
        let sparkleRatio = 1.0;

        if (this.qualityKey === 'MEDIUM') {
            starRatio = 0.48;
            nebulaRatio = 0.58;
            sparkleRatio = 0.55;
        } else if (this.qualityKey === 'LOW') {
            starRatio = 0.22;
            nebulaRatio = 0.3;
            sparkleRatio = 0.25;
        }

        if (backgroundMode) {
            starRatio *= 0.45;
            nebulaRatio *= 0.45;
            sparkleRatio *= 0.45;
        }

        this._setRangeActive(STAR_OFFSET, STAR_COUNT, starRatio);
        this._setRangeActive(NEBULA_OFFSET, NEBULA_COUNT, nebulaRatio);
        this._setRangeActive(SPARKLE_OFFSET, SPARKLE_COUNT, sparkleRatio);
    }

    _setRangeActive(offset, count, ratio) {
        const activeCount = Math.max(1, Math.floor(count * Math.max(0, Math.min(1, ratio))));
        for (let i = 0; i < count; i++) {
            const idx = (offset + i) * 4;
            const active = i < activeCount ? 1.0 : 0.0;
            this.miscData[idx + 3] = active;
            if (active === 0.0) {
                this.lifeData[idx] = 0.0;
            } else if (this.lifeData[idx] <= 0.0) {
                this.lifeData[idx] = 1.0;
            }
        }

        this._markParticleRangeUpdated(this.lifeBuffer, offset, count);
        this._markParticleRangeUpdated(this.miscBuffer, offset, count);
    }

    update(delta, time) {
        this.uDelta.value = delta;
        this.uTime.value = time;

        const nextInterval = this.shootingStarMinInterval
            + Math.random() * (this.shootingStarMaxInterval - this.shootingStarMinInterval);

        if (this.enableAutoShootingStars && time - this.lastShootingStarTime > nextInterval) {
            this.spawnShootingStar();
            this.lastShootingStarTime = time;
        }

    }

    getPositionBuffer() { return this.positionBuffer; }
    getLifeBuffer() { return this.lifeBuffer; }
    getMiscBuffer() { return this.miscBuffer; }

    static get STAR_OFFSET() { return STAR_OFFSET; }
    static get STAR_COUNT() { return STAR_COUNT; }
    static get NEBULA_OFFSET() { return NEBULA_OFFSET; }
    static get NEBULA_COUNT() { return NEBULA_COUNT; }
    static get SPARKLE_OFFSET() { return SPARKLE_OFFSET; }
    static get SPARKLE_COUNT() { return SPARKLE_COUNT; }
    static get SHOOTING_OFFSET() { return SHOOTING_OFFSET; }
    static get SHOOTING_TRAIL_COUNT() { return SHOOTING_TRAIL_COUNT; }
    static get COLLISION_OFFSET() { return COLLISION_OFFSET; }
    static get COLLISION_BURST_COUNT() { return COLLISION_BURST_COUNT; }
    static get TOTAL_PARTICLES() { return TOTAL_PARTICLES; }

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

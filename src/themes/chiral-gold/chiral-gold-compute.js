/* eslint-disable max-classes-per-file */
/**
 * Chiral Gold - GPU compute systems
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    clamp,
    cos,
    float,
    instanceIndex,
    length,
    max,
    mix,
    normalize,
    pow,
    sin,
    smoothstep,
    step,
    storage,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;

function toLinearColorArray(colorPalette = []) {
    if (!Array.isArray(colorPalette) || colorPalette.length === 0) {
        return [
            [0.72, 0.52, 0.04],
            [1.0, 0.84, 0.0],
            [1.0, 0.97, 0.86],
            [0.72, 0.45, 0.2],
            [1.0, 1.0, 1.0],
        ];
    }

    return colorPalette.map((color) => {
        if (color?.isColor) {
            return [color.r, color.g, color.b];
        }
        return [1, 1, 1];
    });
}

export class ChiralGoldDustCompute {
    constructor(particleCount, options = {}) {
        this.count = particleCount;
        this.random = typeof options.randomFn === 'function' ? options.randomFn : Math.random;

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
        this.uBass = uniform(0);
        this.uMid = uniform(0);
        this.uEnergy = uniform(0);
        this.uBeatPulse = uniform(0);
        this.uFormationState = uniform(0);
        this.uFormationProgress = uniform(0);

        this.computeNode = null;

        this.setInitialState(options);
    }

    setInitialState(options = {}) {
        const palette = toLinearColorArray(options.colorPalette);

        const nearRatio = 0.20;
        const midRatio = 0.35;
        const farRatio = 0.25;
        // remaining 0.20 = envelope band

        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const r = this.random();
            const theta = this.random() * TAU;

            // Defaults = far band
            let minRadius = 3800;
            let maxRadius = 8500;
            let baseSizeMin = 5;
            let baseSizeMax = 16;
            let baseSpeed = 0.025;
            let zDepthMin = -2000;
            let zDepthMax = 400;
            let yRange = 4200;

            if (r < nearRatio) {
                minRadius = 1800;
                maxRadius = 3400;
                baseSizeMin = 14;
                baseSizeMax = 28;
                baseSpeed = 0.14;
                zDepthMin = -600;
                zDepthMax = 800;
                yRange = 2800;
            } else if (r < nearRatio + midRatio) {
                minRadius = 2900;
                maxRadius = 5200;
                baseSizeMin = 10;
                baseSizeMax = 22;
                baseSpeed = 0.07;
                zDepthMin = -1200;
                zDepthMax = 600;
                yRange = 3800;
            } else if (r >= nearRatio + midRatio + farRatio) {
                // Envelope band: wraps around camera for edge-to-edge coverage
                minRadius = 2000;
                maxRadius = 8000;
                baseSizeMin = 3;
                baseSizeMax = 12;
                baseSpeed = 0.018;
                zDepthMin = -5000;
                zDepthMax = 1800;
                yRange = 4800;
            }

            const radius = minRadius + this.random() * (maxRadius - minRadius);
            const height = (this.random() - 0.5) * yRange;
            const tilt = (this.random() - 0.5) * 0.52;
            const stretchX = 1.2 + this.random() * 0.85;
            const stretchZ = 0.72 + this.random() * 0.65;

            const zDepth = zDepthMin + this.random() * (zDepthMax - zDepthMin);
            const x = Math.cos(theta) * radius * stretchX;
            const z = Math.sin(theta) * radius * stretchZ + zDepth;
            const y = height + Math.sin(theta * 0.7) * 150 * (1 + r);

            // velocity.w stores per-particle orbital speed baseline.
            this.positionData[i4] = x;
            this.positionData[i4 + 1] = y;
            this.positionData[i4 + 2] = z;
            this.positionData[i4 + 3] = 1;

            this.velocityData[i4] = tilt;
            this.velocityData[i4 + 1] = (this.random() - 0.5) * 0.5;
            this.velocityData[i4 + 2] = (this.random() - 0.5) * 0.5;
            this.velocityData[i4 + 3] = baseSpeed * (0.9 + this.random() * 0.2);

            const localLife = 8 + this.random() * 12;
            this.lifeData[i4] = -this.random() * localLife;
            this.lifeData[i4 + 1] = 0.7 + this.random() * 0.3;
            this.lifeData[i4 + 2] = localLife;
            this.lifeData[i4 + 3] = this.random();

            const paletteRoll = this.random();
            let colorIndex = 0;
            if (paletteRoll <= 0.4) colorIndex = 0;
            else if (paletteRoll <= 0.65) colorIndex = 1;
            else if (paletteRoll <= 0.85) colorIndex = 2;
            else if (paletteRoll <= 0.95) colorIndex = 3;
            else colorIndex = 4;

            const paletteColor = palette[colorIndex] || palette[0];
            this.colorData[i4] = paletteColor[0];
            this.colorData[i4 + 1] = paletteColor[1];
            this.colorData[i4 + 2] = paletteColor[2];
            this.colorData[i4 + 3] = baseSizeMin + this.random() * (baseSizeMax - baseSizeMin);
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

        const computeDust = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const life = lifeData.element(index).toVar();

            const maxLife = max(float(0.001), life.z);
            const age = this.uTime.sub(life.x);
            const lifeNorm = clamp(age.div(maxLife), 0.0, 1.0);
            const expired = age.greaterThan(maxLife);

            If(expired, () => {
                const seedA = sin(life.w.mul(91.37).add(this.uTime.mul(0.73))).mul(0.5).add(0.5);
                const seedB = sin(life.w.mul(47.13).add(this.uTime.mul(0.41)).add(life.x.mul(0.013))).mul(0.5).add(0.5);
                const seedC = sin(life.w.mul(63.77).add(this.uTime.mul(0.29))).mul(0.5).add(0.5);
                const seedD = sin(life.w.mul(33.41).add(this.uTime.mul(0.53))).mul(0.5).add(0.5);
                const seedLife = sin(life.w.mul(79.91).add(this.uTime.mul(0.17))).mul(0.5).add(0.5);

                const seedE = sin(life.w.mul(53.19).add(this.uTime.mul(0.61))).mul(0.5).add(0.5);

                // Band masks based on orbital speed stored in vel.w
                // Near≈0.14, Mid≈0.07, Far≈0.025, Envelope≈0.018
                const nearMask = step(float(0.11), vel.w);
                const midOrNearMask = step(float(0.055), vel.w);
                const midMask = clamp(midOrNearMask.sub(nearMask), 0.0, 1.0);
                const belowMidMask = float(1.0).sub(midOrNearMask);
                const envMask = clamp(float(1.0).sub(step(float(0.020), vel.w)), 0.0, 1.0);
                const farMask = clamp(belowMidMask.sub(envMask), 0.0, 1.0);

                const minRadius = nearMask.mul(1800.0).add(midMask.mul(2900.0)).add(farMask.mul(3800.0)).add(envMask.mul(2000.0));
                const maxRadius = nearMask.mul(3400.0).add(midMask.mul(5200.0)).add(farMask.mul(8500.0)).add(envMask.mul(8000.0));
                const yRange = nearMask.mul(2800.0).add(midMask.mul(3800.0)).add(farMask.mul(4200.0)).add(envMask.mul(4800.0));

                // Z-depth offset per band: scatter particles in front of and behind the camera plane
                const zDepthMin = nearMask.mul(-600.0).add(midMask.mul(-1200.0)).add(farMask.mul(-2000.0)).add(envMask.mul(-5000.0));
                const zDepthRange = nearMask.mul(1400.0).add(midMask.mul(1800.0)).add(farMask.mul(2400.0)).add(envMask.mul(6800.0));

                const radius = mix(minRadius, maxRadius, seedA);
                const angle = seedB.mul(TAU).add(this.uTime.mul(0.035));
                const stretchX = float(1.2).add(seedC.mul(0.85));
                const stretchZ = float(0.72).add(seedD.mul(0.65));
                const zScatter = zDepthMin.add(seedE.mul(zDepthRange));

                pos.x.assign(cos(angle).mul(radius).mul(stretchX));
                pos.z.assign(sin(angle).mul(radius).mul(stretchZ).add(zScatter));
                pos.y.assign(seedD.sub(0.5).mul(yRange));

                life.x.assign(this.uTime);
                life.z.assign(float(8.0).add(seedLife.mul(12.0)));
                life.w.assign(sin(life.w.mul(37.0).add(this.uTime.mul(0.31))).mul(0.5).add(0.5));
                life.y.assign(0.18);
            }).Else(() => {
                // Toroidal vortex flow math - keeps particles in a swirling, breathing torus framing the board
                const radXZ = length(vec2(pos.x, pos.z)).add(0.001);
                const dirX = pos.x.div(radXZ);
                const dirZ = pos.z.div(radXZ);

                // Tangential vector (orbit direction)
                const tangX = dirZ.negate();
                const tangZ = dirX;

                // Radial pull/push to maintain a stable golden ring around the board
                // Target radius = 3000, slowly undulating over time
                const targetRadius = float(3000.0).add(sin(this.uTime.mul(0.12)).mul(450.0));
                const radialDelta = radXZ.sub(targetRadius);
                const pullStrength = radialDelta.mul(0.09); // pull back toward target radius

                // Spiral velocity vector (speed is accelerated by mids)
                const spiralSpeed = vel.w.mul(float(420.0).add(this.uMid.mul(550.0)));
                const spiralX = tangX.mul(spiralSpeed).sub(dirX.mul(pullStrength));
                const spiralZ = tangZ.mul(spiralSpeed).sub(dirZ.mul(pullStrength));

                // Vertical wave oscillation (drifting up and down based on radius and bass)
                const verticalWave = sin(radXZ.mul(0.00062).sub(this.uTime.mul(0.48))).mul(110.0);
                const verticalSpeed = (vel.y.mul(55.0).add(verticalWave)).mul(float(1.0).add(this.uBass.mul(1.6)));

                pos.x.addAssign(spiralX.mul(this.uDelta));
                pos.z.addAssign(spiralZ.mul(this.uDelta));
                pos.y.addAssign(verticalSpeed.mul(this.uDelta));

                // Layered Curl Noise (TSL)
                const f1 = float(0.0015);
                const f2 = float(0.0042);
                const nt = this.uTime.mul(0.08);

                // Octave 1: low frequency currents (overall flow)
                const cx1 = sin(pos.y.mul(f1).add(nt)).sub(cos(pos.z.mul(f1).sub(nt.mul(0.75))));
                const cy1 = sin(pos.z.mul(f1).add(nt.mul(1.15))).sub(cos(pos.x.mul(f1).add(nt.mul(0.55))));
                const cz1 = sin(pos.x.mul(f1).sub(nt.mul(0.95))).sub(cos(pos.y.mul(f1).sub(nt.mul(0.45))));

                // Octave 2: high frequency micro-jitter (swimming currents, reactive to mids)
                const cx2 = sin(pos.y.mul(f2).sub(nt.mul(1.85))).add(cos(pos.z.mul(f2).add(nt.mul(1.25))));
                const cy2 = sin(pos.z.mul(f2).add(nt.mul(1.55))).add(cos(pos.x.mul(f2).sub(nt.mul(1.65))));
                const cz2 = sin(pos.x.mul(f2).sub(nt.mul(1.15))).add(cos(pos.y.mul(f2).add(nt.mul(1.45))));

                const noise1 = vec3(cx1, cy1, cz1);
                const noise2 = vec3(cx2, cy2, cz2).mul(float(0.38).add(this.uMid.mul(0.72)));
                const combinedNoise = normalize(noise1.add(noise2).add(0.0001));

                const flowAmp = mix(float(140.0), float(520.0), clamp(this.uEnergy.mul(1.65).add(this.uMid.mul(0.95)), 0.0, 1.0));
                pos.xyz.addAssign(combinedNoise.mul(flowAmp).mul(this.uDelta));

                // Beat push — radial outward impulse (2.8x stronger than before)
                const radialDir = normalize(vec3(pos.x, 0.0, pos.z).add(vec3(0.0001, 0.0, 0.0001)));
                const beatPush = this.uBeatPulse.mul(this.uDelta).mul(480.0);
                pos.xyz.addAssign(radialDir.mul(beatPush));

                // Bass breathing — radial scale (4x stronger than before)
                const radius = max(float(1.0), length(vec2(pos.x, pos.z)));
                const bassScale = float(1.0).add(this.uBass.mul(0.016).mul(this.uDelta).mul(60.0));
                pos.x.assign(pos.x.div(radius).mul(radius.mul(bassScale)));
                pos.z.assign(pos.z.div(radius).mul(radius.mul(bassScale)));

                const formation = this.uFormationState;
                const progress = clamp(this.uFormationProgress, 0.0, 1.0);

                If(formation.greaterThan(float(0.5)).and(formation.lessThan(float(1.5))), () => {
                    const selected = life.w.lessThan(float(0.3));
                    If(selected, () => {
                        const convergeScale = mix(float(1.0), float(0.18), progress);
                        pos.xyz.assign(pos.xyz.mul(convergeScale));
                    }).Else(() => {
                        const supportScale = mix(float(1.0), float(0.88), progress.mul(0.5));
                        pos.xyz.assign(pos.xyz.mul(supportScale));
                    });
                }).Else(() => {
                    If(formation.greaterThan(float(1.5)).and(formation.lessThan(float(2.5))), () => {
                        const pulse = sin(progress.mul(Math.PI)).mul(0.65);
                        pos.xyz.assign(pos.xyz.mul(float(1.0).add(pulse)));
                    }).Else(() => {
                        If(formation.greaterThan(float(2.5)), () => {
                            const collapse = clamp(progress.div(0.22), 0.0, 1.0);
                            const explode = clamp(progress.sub(0.22).div(0.78), 0.0, 1.0);
                            const collapsePos = pos.xyz.mul(mix(float(1.0), float(0.05), collapse));
                            const burstAngle = life.w.mul(TAU).add(this.uTime.mul(0.31));
                            const burstDir = normalize(vec3(
                                cos(burstAngle),
                                sin(burstAngle.mul(1.3)).mul(0.35),
                                sin(burstAngle),
                            ));
                            const explodedPos = collapsePos.add(burstDir.mul(explode.mul(2600.0)));
                            const mixMode = step(float(0.22), progress);
                            pos.xyz.assign(mix(collapsePos, explodedPos, mixMode));
                        });
                    });
                });

                const fade = clamp(float(1.0).sub(lifeNorm.mul(0.58)), 0.08, 1.0);
                const twinkle = sin(this.uTime.mul(1.85).add(life.w.mul(12.0))).mul(0.5).add(0.5);
                life.y.assign(clamp(fade.mul(twinkle.mul(0.75).add(0.25)), 0.08, 1.0));
            });

            positions.element(index).assign(pos);
            lifeData.element(index).assign(life);
        });

        this.computeNode = computeDust().compute(this.count);
        return this.computeNode;
    }

    update(params = {}) {
        if (params.delta !== undefined) this.uDelta.value = params.delta;
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.bass !== undefined) this.uBass.value = params.bass;
        if (params.mid !== undefined) this.uMid.value = params.mid;
        if (params.energy !== undefined) this.uEnergy.value = params.energy;
        if (params.beatPulse !== undefined) this.uBeatPulse.value = params.beatPulse;
        if (params.formationState !== undefined) this.uFormationState.value = params.formationState;
        if (params.formationProgress !== undefined) this.uFormationProgress.value = params.formationProgress;
    }

    getPositionBuffer() {
        return this.positionBuffer;
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

export class ChiralGoldBurstCompute {
    constructor(particleCount, options = {}) {
        this.count = particleCount;
        this.random = typeof options.randomFn === 'function' ? options.randomFn : Math.random;

        this.minLife = Number.isFinite(options.minLife) ? options.minLife : 2.0;
        this.maxLife = Number.isFinite(options.maxLife) ? options.maxLife : 4.0;
        this.maxDelay = Number.isFinite(options.maxDelay) ? options.maxDelay : 0.5;

        // CPU writes configuration to spawn buffers (GPU Read-only)
        this.spawnPosData = new Float32Array(particleCount * 4);
        this.spawnVelData = new Float32Array(particleCount * 4);
        this.spawnMiscData = new Float32Array(particleCount * 4); // x: maxLife, y: delay
        this.colorData = new Float32Array(particleCount * 4); // Material reads

        // GPU updates state tracking buffers (GPU Read-Write, Material reads)
        this.positionData = new Float32Array(particleCount * 4);
        this.velocityData = new Float32Array(particleCount * 4);
        this.lifeData = new Float32Array(particleCount * 4); // y: alphaLife

        this.spawnPosBuffer = new THREE.StorageBufferAttribute(this.spawnPosData, 4);
        this.spawnVelBuffer = new THREE.StorageBufferAttribute(this.spawnVelData, 4);
        this.spawnMiscBuffer = new THREE.StorageBufferAttribute(this.spawnMiscData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uGravity = uniform(-8.0);
        this.uFlowBlend = uniform(0.22);

        this.origin = new THREE.Vector3(0, 0, 0);
        this.nextTriggerIndex = 0;
        this.computeNode = null;

        this.setInitialState(options);
    }

    setInitialState(options = {}) {
        const palette = toLinearColorArray(options.colorPalette);

        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;

            // Spawn configuration
            this.spawnPosData[i4] = 0;
            this.spawnPosData[i4 + 1] = 0;
            this.spawnPosData[i4 + 2] = -9999;
            this.spawnPosData[i4 + 3] = -1000; // spawnTime

            this.spawnVelData[i4] = 0;
            this.spawnVelData[i4 + 1] = 0;
            this.spawnVelData[i4 + 2] = 0;
            this.spawnVelData[i4 + 3] = 0;

            this.spawnMiscData[i4] = this.minLife + this.random() * (this.maxLife - this.minLife); // maxLife
            this.spawnMiscData[i4 + 1] = this.random() * this.maxDelay; // delay
            this.spawnMiscData[i4 + 2] = 0;
            this.spawnMiscData[i4 + 3] = 0;

            // Material bindings
            const paletteRoll = this.random();
            let colorIndex = 0;
            if (paletteRoll <= 0.6) colorIndex = 1;
            else if (paletteRoll <= 0.85) colorIndex = 2;
            else colorIndex = 3;
            const c = palette[colorIndex] || palette[1] || [1, 0.84, 0];

            this.colorData[i4] = c[0];
            this.colorData[i4 + 1] = c[1];
            this.colorData[i4 + 2] = c[2];
            this.colorData[i4 + 3] = 4 + this.random() * 96; // size

            // Initial GPU state overrides (GPU owns these)
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = -9000; // pos.w holds initialization timestamp

            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;

            this.lifeData[i4] = 0;
            this.lifeData[i4 + 1] = 0; // alphaLife
            this.lifeData[i4 + 2] = 0;
            this.lifeData[i4 + 3] = 0;
        }

        // We only upload the GPU ownership buffers on initialization
        this.spawnPosBuffer.needsUpdate = true;
        this.spawnVelBuffer.needsUpdate = true;
        this.spawnMiscBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const spawnPosData = storage(this.spawnPosBuffer, 'vec4', this.count);
        const spawnVelData = storage(this.spawnVelBuffer, 'vec4', this.count);
        const spawnMiscData = storage(this.spawnMiscBuffer, 'vec4', this.count);
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);

        const computeBurst = Fn(() => {
            const index = instanceIndex;
            const spawnPos = spawnPosData.element(index).toVar();
            const spawnVel = spawnVelData.element(index).toVar();
            const spawnMisc = spawnMiscData.element(index).toVar();

            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const life = lifeData.element(index).toVar();

            // Hardware reads spawnTime and lifetime params cleanly written by CPU
            const spawnTime = spawnPos.w.add(spawnMisc.y);
            const maxLife = max(float(0.001), spawnMisc.x);
            const maxLifePlusSpawn = spawnTime.add(maxLife);
            const age = this.uTime.sub(spawnTime);

            const active = this.uTime.greaterThanEqual(spawnTime).and(this.uTime.lessThan(maxLifePlusSpawn));

            // To ensure stateful integration doesn't overwrite manually,
            // we snapshot spawn parameters strictly once per trigger.
            const isInitialized = pos.w.equals(spawnTime);
            const justSpawned = active.and(isInitialized.not());

            If(justSpawned, () => {
                pos.xyz.assign(spawnPos.xyz);
                vel.xyz.assign(spawnVel.xyz);
                pos.w.assign(spawnTime); // Timestamp prevents re-initialization
            });

            If(active, () => {
                const lifeNorm = clamp(age.div(maxLife), 0.0, 1.0);
                const decel = max(float(0.25), float(1.0).sub(pow(lifeNorm, 1.5)));

                vel.y.addAssign(this.uGravity.mul(this.uDelta));
                pos.xyz.addAssign(vel.xyz.mul(this.uDelta).mul(decel));

                const joinFlow = clamp(lifeNorm.sub(0.7).div(0.3), 0.0, 1.0);
                const radialDir = normalize(vec3(pos.x, 0.0, pos.z).add(vec3(0.0001, 0.0, 0.0001)));
                const orbitalFlow = vec3(radialDir.z.negate(), 0.16, radialDir.x).mul(36.0);
                vel.xyz.assign(mix(vel.xyz, orbitalFlow, joinFlow.mul(this.uFlowBlend)));

                life.y.assign(float(1.0).sub(lifeNorm)); // alphaLife
            }).Else(() => {
                pos.xyz.assign(vec3(0.0, 0.0, -9999.0));
                life.y.assign(0.0);
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            lifeData.element(index).assign(life);
        });

        this.computeNode = computeBurst().compute(this.count);
        return this.computeNode;
    }

    update(params = {}) {
        if (params.delta !== undefined) this.uDelta.value = params.delta;
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.flowBlend !== undefined) this.uFlowBlend.value = params.flowBlend;
    }

    triggerBurst(time, intensity = 1, origin = null, comboCount = 0, options = {}) {
        if (origin?.isVector3) {
            this.origin.copy(origin);
        }

        const velocityMultiplier = Number.isFinite(options.velocityMultiplier)
            ? Math.max(0.35, options.velocityMultiplier)
            : 1.0;
        const sizeMultiplier = Number.isFinite(options.sizeMultiplier)
            ? Math.max(0.35, options.sizeMultiplier)
            : 1.0;
        const sparkBoost = Number.isFinite(options.sparkBoost)
            ? Math.max(0, options.sparkBoost)
            : 0.0;
        const lifeMultiplier = Number.isFinite(options.lifeMultiplier)
            ? Math.max(0.35, options.lifeMultiplier)
            : (options.profile === 'hero_close' ? 0.87 : 1.0);

        const clampedIntensity = Math.max(0.75, Math.min(2.25, intensity));
        const normalizedIntensity = (clampedIntensity - 0.75) / 1.5;
        const minBatch = Math.max(120, Math.floor(this.count * 0.015));
        const maxBatch = Math.max(minBatch, Math.floor(this.count * 0.045));
        const baseBatch = Math.floor(minBatch + (maxBatch - minBatch) * normalizedIntensity);
        const targetBatch = Math.min(
            this.count,
            options.profile === 'lock_burst' ? Math.floor(baseBatch * 0.35) : baseBatch,
        );

        const startIndex = this.nextTriggerIndex;
        for (let activated = 0; activated < targetBatch; activated += 1) {
            const index = (startIndex + activated) % this.count;
            const i4 = index * 4;

            const localLife = (this.minLife + this.random() * (this.maxLife - this.minLife)) * lifeMultiplier;
            const localDelay = this.random() * this.maxDelay;
            const patternRoll = this.random();

            let vx = 0;
            let vy = 0;
            let vz = 0;

            if (options.profile === 'lock_burst') {
                // Spherical small burst
                const theta = this.random() * TAU;
                const phi = Math.acos(2.0 * this.random() - 1.0);
                const sinPhi = Math.sin(phi);
                const speed = (35.0 + this.random() * 35.0) * clampedIntensity * velocityMultiplier;
                vx = sinPhi * Math.cos(theta) * speed;
                vy = sinPhi * Math.sin(theta) * speed;
                vz = Math.cos(phi) * speed;
            } else if (options.profile === 'dissolve') {
                // Symmetrical dissolve: blast outward to the sides (left or right)
                const isLeftOrigin = this.origin.x < 0;
                const sideDir = isLeftOrigin ? -1.0 : 1.0;

                vx = (sideDir * (220.0 + this.random() * 260.0) + (this.random() - 0.5) * 60.0) * clampedIntensity * velocityMultiplier;
                vy = (this.random() - 0.5) * 120.0 * velocityMultiplier;
                vz = (this.random() - 0.5) * 90.0 * velocityMultiplier;
            } else if (patternRoll < 0.6) {
                // Radial explosion
                const theta = this.random() * TAU;
                const phi = Math.acos(2 * this.random() - 1);
                const sinPhi = Math.sin(phi);
                const dirX = sinPhi * Math.cos(theta);
                const dirY = sinPhi * Math.sin(theta);
                const dirZ = Math.cos(phi);
                const speed = 180 + this.random() * 220;
                vx = dirX * speed * clampedIntensity * velocityMultiplier;
                vy = dirY * speed * clampedIntensity * velocityMultiplier;
                vz = dirZ * speed * clampedIntensity * velocityMultiplier;
            } else if (patternRoll < 0.85) {
                // Spiral shooters
                const angle = this.random() * TAU;
                const tangentialSpeed = 160 + comboCount * 25;
                const outwardSpeed = 120 + comboCount * 20;
                vx = (
                    (-Math.sin(angle) * tangentialSpeed + Math.cos(angle) * outwardSpeed)
                    * (0.7 + this.random() * 0.6)
                    * velocityMultiplier
                );
                vz = (
                    (Math.cos(angle) * tangentialSpeed + Math.sin(angle) * outwardSpeed)
                    * (0.7 + this.random() * 0.6)
                    * velocityMultiplier
                );
                vy = (Math.sin(angle * 2.0) * 25 + 20 + this.random() * 30) * velocityMultiplier;
            } else {
                // Screen streakers
                const streakSpeed = 400 + this.random() * 350;
                vx = (this.random() - 0.5) * 40 * velocityMultiplier;
                vy = (this.random() - 0.5) * 40 * velocityMultiplier;
                vz = streakSpeed * velocityMultiplier;
            }

            const jitter = options.profile === 'lock_burst' ? 4.0 : 12.0;
            this.spawnPosData[i4] = this.origin.x + (this.random() - 0.5) * jitter;
            this.spawnPosData[i4 + 1] = this.origin.y + (this.random() - 0.5) * jitter;
            this.spawnPosData[i4 + 2] = this.origin.z + (this.random() - 0.5) * jitter;
            this.spawnPosData[i4 + 3] = time; // spawnTime

            this.spawnVelData[i4] = vx;
            this.spawnVelData[i4 + 1] = vy;
            this.spawnVelData[i4 + 2] = vz;
            this.spawnVelData[i4 + 3] = 0;

            this.spawnMiscData[i4] = localLife; // maxLife
            this.spawnMiscData[i4 + 1] = localDelay; // delay

            const sizeBoost = sizeMultiplier * (1.0 + sparkBoost * 0.32);
            this.colorData[i4 + 3] = Math.min(220, Math.max(3, (3 + this.random() * 117) * sizeBoost));
        }

        this.nextTriggerIndex = (startIndex + targetBatch) % this.count;

        // Critical Fix: We ONLY update spawn parameters and color sizes via CPU to WebGPU.
        // We MUST NOT upload `positionBuffer` or `velocityBuffer` natively, as that
        // overwrites and destroys the active simulation properties across frames.
        this.spawnPosBuffer.needsUpdate = true;
        this.spawnVelBuffer.needsUpdate = true;
        this.spawnMiscBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
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
        this.spawnPosBuffer = null;
        this.spawnVelBuffer = null;
        this.spawnMiscBuffer = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.lifeBuffer = null;
        this.colorBuffer = null;
        this.spawnPosData = null;
        this.spawnVelData = null;
        this.spawnMiscData = null;
        this.positionData = null;
        this.velocityData = null;
        this.lifeData = null;
        this.colorData = null;
    }
}

export class ChiralGoldWispCompute {
    constructor(particleCount, options = {}) {
        this.count = particleCount;
        this.random = typeof options.randomFn === 'function' ? options.randomFn : Math.random;

        this.positionData = new Float32Array(particleCount * 4);
        this.paramAData = new Float32Array(particleCount * 4);
        this.paramBData = new Float32Array(particleCount * 4);
        this.colorData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.paramABuffer = new THREE.StorageBufferAttribute(this.paramAData, 4);
        this.paramBBuffer = new THREE.StorageBufferAttribute(this.paramBData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uTreble = uniform(0);
        this.uMid = uniform(0);
        this.uBeatPulse = uniform(0);

        this.computeNode = null;

        this.setInitialState(options);
    }

    setInitialState(options = {}) {
        const palette = toLinearColorArray(options.colorPalette);

        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const ampX = 200 + this.random() * 600;
            const ampY = 140 + this.random() * 360;
            const ampZ = 200 + this.random() * 600;

            const freqA = 1 + Math.floor(this.random() * 5) + this.random() * 0.18;
            const freqB = 1 + Math.floor(this.random() * 5) + this.random() * 0.18;
            const freqC = 1 + Math.floor(this.random() * 5) + this.random() * 0.18;

            const phase = this.random() * TAU;
            const attractorGroup = this.random();

            this.positionData[i4] = (this.random() - 0.5) * 3200;
            this.positionData[i4 + 1] = (this.random() - 0.5) * 2200;
            this.positionData[i4 + 2] = (this.random() - 0.5) * 2400;
            this.positionData[i4 + 3] = 1;

            this.paramAData[i4] = ampX;
            this.paramAData[i4 + 1] = ampY;
            this.paramAData[i4 + 2] = ampZ;
            this.paramAData[i4 + 3] = freqA;

            this.paramBData[i4] = freqB;
            this.paramBData[i4 + 1] = freqC;
            this.paramBData[i4 + 2] = phase;
            this.paramBData[i4 + 3] = attractorGroup;

            const paletteRoll = this.random();
            let colorIndex = 2;
            if (paletteRoll <= 0.55) colorIndex = 1;
            else if (paletteRoll <= 0.8) colorIndex = 2;
            else if (paletteRoll <= 0.95) colorIndex = 0;
            else colorIndex = 4;
            const c = palette[colorIndex] || [1, 0.93, 0.75];

            this.colorData[i4] = c[0];
            this.colorData[i4 + 1] = c[1];
            this.colorData[i4 + 2] = c[2];
            this.colorData[i4 + 3] = 60 + this.random() * 60;
        }

        this.positionBuffer.needsUpdate = true;
        this.paramABuffer.needsUpdate = true;
        this.paramBBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const paramA = storage(this.paramABuffer, 'vec4', this.count);
        const paramB = storage(this.paramBBuffer, 'vec4', this.count);

        const computeWisps = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const pA = paramA.element(index).toVar();
            const pB = paramB.element(index).toVar();

            // Treble doubles Lissajous speed — wisps dance faster with bright sounds
            const t = this.uTime.mul(float(1.0).add(this.uTreble.mul(1.6)));

            const lx = pA.x.mul(sin(t.mul(pA.w).add(pB.z)));
            const ly = pA.y.mul(sin(t.mul(pB.x).add(pB.z.mul(0.7))));
            const lz = pA.z.mul(sin(t.mul(pB.y).add(pB.z.mul(1.3))));
            const lissajous = vec3(lx, ly, lz);

            const attractor = vec3(0.0, 0.0, 0.0).toVar();
            If(pB.w.lessThan(float(0.25)), () => {
                attractor.assign(vec3(
                    sin(t.mul(0.22)).mul(1400.0),
                    cos(t.mul(0.19)).mul(600.0),
                    cos(t.mul(0.25)).mul(1100.0),
                ));
            }).Else(() => {
                If(pB.w.lessThan(float(0.5)), () => {
                    attractor.assign(vec3(
                        cos(t.mul(0.17)).mul(1300.0),
                        sin(t.mul(0.21)).mul(600.0),
                        sin(t.mul(0.27)).mul(1300.0),
                    ));
                }).Else(() => {
                    If(pB.w.lessThan(float(0.75)), () => {
                        attractor.assign(vec3(
                            sin(t.mul(0.28).add(1.2)).mul(1200.0),
                            cos(t.mul(0.16).add(0.8)).mul(700.0),
                            cos(t.mul(0.24).add(2.0)).mul(1200.0),
                        ));
                    }).Else(() => {
                        attractor.assign(vec3(
                            cos(t.mul(0.25).add(2.1)).mul(1400.0),
                            sin(t.mul(0.18).add(1.7)).mul(550.0),
                            sin(t.mul(0.23).add(0.5)).mul(1100.0),
                        ));
                    });
                });
            });

            // Mid drives cohesion: quiet=scattered, loud=clustered together
            const cohesion = clamp(float(0.12).add(this.uMid.mul(0.55)), 0.08, 0.65);
            const target = mix(lissajous, attractor, cohesion);

            // Beats push wisps dramatically outward (0.35 → 0.75)
            const beatScale = float(1.0).add(this.uBeatPulse.mul(0.75));
            pos.xyz.assign(target.mul(beatScale));

            const flash = smoothstep(float(0.0), float(1.0), this.uBeatPulse).mul(0.45);
            pos.w.assign(float(1.0).add(flash));

            positions.element(index).assign(pos);
        });

        this.computeNode = computeWisps().compute(this.count);
        return this.computeNode;
    }

    update(params = {}) {
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.delta !== undefined) this.uDelta.value = params.delta;
        if (params.treble !== undefined) this.uTreble.value = params.treble;
        if (params.mid !== undefined) this.uMid.value = params.mid;
        if (params.beatPulse !== undefined) this.uBeatPulse.value = params.beatPulse;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.paramABuffer = null;
        this.paramBBuffer = null;
        this.colorBuffer = null;
        this.positionData = null;
        this.paramAData = null;
        this.paramBData = null;
        this.colorData = null;
    }
}

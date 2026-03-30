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
    vec3,
} from 'three/tsl';

/**
 * Stellar Drift - Compute Systems (Phase 5)
 *
 * These systems are optional and only run when WebGPU compute is available.
 * CPU animation remains the deterministic fallback path.
 */

export class StellarAmbientParticleCompute {
    constructor(count, bounds = {}, randomFn = Math.random) {
        this.count = count;
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;
        this.bounds = {
            xMin: bounds.xMin ?? -2000,
            xMax: bounds.xMax ?? 2000,
            yMin: bounds.yMin ?? -1000,
            yMax: bounds.yMax ?? 1000,
            zMin: bounds.zMin ?? -1600,
            zMax: bounds.zMax ?? 800,
        };

        this.positionData = new Float32Array(count * 4);
        this.miscData = new Float32Array(count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uDriftScale = uniform(1.0);

        this.computeNode = null;
    }

    setInitialState(positions, randoms, sizes) {
        for (let i = 0; i < this.count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 1.0;

            const rand = randoms?.[i] ?? this.random();
            const size = sizes?.[i] ?? (1 + this.random() * 2);
            this.miscData[i4] = rand; // phase seed
            this.miscData[i4 + 1] = size; // size seed
            this.miscData[i4 + 2] = this.random(); // drift seed
            this.miscData[i4 + 3] = 0.6 + this.random() * 0.9; // lateral speed
        }

        this.positionBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const xMin = float(this.bounds.xMin);
        const xMax = float(this.bounds.xMax);
        const yMin = float(this.bounds.yMin);
        const yMax = float(this.bounds.yMax);
        const zMin = float(this.bounds.zMin);
        const zMax = float(this.bounds.zMax);
        const zSpan = zMax.sub(zMin);

        const delta = this.uDelta;
        const time = this.uTime;
        const driftScale = this.uDriftScale;

        const computeAmbient = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const misc = miscData.element(index).toVar();

            const phase = misc.x;
            const driftSeed = misc.z;
            const lateralSpeed = misc.w.mul(driftScale);

            // Keep the ambient field gliding left-to-right with subtle bobbing.
            pos.x.addAssign(lateralSpeed.mul(delta));
            pos.y.addAssign(sin(time.mul(0.35).add(phase.mul(6.283185))).mul(1.8).mul(delta));
            pos.z.addAssign(cos(time.mul(0.2).add(driftSeed.mul(6.283185))).mul(1.2).mul(delta));

            If(pos.x.greaterThan(xMax), () => {
                pos.x.assign(xMin);
            });
            If(pos.y.greaterThan(yMax), () => {
                pos.y.assign(yMin);
            });
            If(pos.y.lessThan(yMin), () => {
                pos.y.assign(yMax);
            });
            If(pos.z.greaterThan(zMax), () => {
                pos.z.assign(pos.z.sub(zSpan));
            });
            If(pos.z.lessThan(zMin), () => {
                pos.z.assign(pos.z.add(zSpan));
            });

            positions.element(index).assign(pos);
        });

        this.computeNode = computeAmbient().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        if (options.driftScale !== undefined) {
            this.uDriftScale.value = options.driftScale;
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
        this.miscBuffer = null;
        this.positionData = null;
        this.miscData = null;
    }
}

export class StellarDustRingCompute {
    constructor(count, randomFn = Math.random) {
        this.count = count;
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;

        this.positionData = new Float32Array(count * 4);
        // radius, angle, yBase, angularSpeed
        this.orbitalData = new Float32Array(count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.orbitalBuffer = new THREE.StorageBufferAttribute(this.orbitalData, 4);

        this.uDelta = uniform(0);
        this.uSpeedScale = uniform(1.0);

        this.computeNode = null;
    }

    setInitialState(positions, radii, angles, yBases, angularSpeeds) {
        for (let i = 0; i < this.count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 1.0;

            this.orbitalData[i4] = radii?.[i] ?? (600 + this.random() * 600);
            this.orbitalData[i4 + 1] = angles?.[i] ?? (this.random() * Math.PI * 2);
            this.orbitalData[i4 + 2] = yBases?.[i] ?? ((this.random() - 0.5) * 40);
            this.orbitalData[i4 + 3] = angularSpeeds?.[i] ?? (0.16 + this.random() * 0.24);
        }

        this.positionBuffer.needsUpdate = true;
        this.orbitalBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const orbital = storage(this.orbitalBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const speedScale = this.uSpeedScale;

        const computeDust = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const orbit = orbital.element(index).toVar();

            const radius = orbit.x;
            const angle = orbit.y.add(orbit.w.mul(speedScale).mul(delta));
            const yBase = orbit.z;

            const zFlat = sin(angle).mul(radius).mul(0.2);
            pos.x.assign(cos(angle).mul(radius));
            pos.y.assign(yBase.add(zFlat.mul(0.5)));
            pos.z.assign(zFlat.mul(2.0));

            orbit.y.assign(angle);

            positions.element(index).assign(pos);
            orbital.element(index).assign(orbit);
        });

        this.computeNode = computeDust().compute(this.count);
        return this.computeNode;
    }

    update(delta, options = {}) {
        this.uDelta.value = delta;
        if (options.speedScale !== undefined) {
            this.uSpeedScale.value = options.speedScale;
        }
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getOrbitalBuffer() {
        return this.orbitalBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.orbitalBuffer = null;
        this.positionData = null;
        this.orbitalData = null;
    }
}

export class StellarNebulaBurstCompute {
    constructor(capacity = 12000, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(capacity));
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;
        this.spawnCursor = 0;

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.lifeData = new Float32Array(this.count * 4);
        this.colorData = new Float32Array(this.count * 4);
        // size, active, seed, decay
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uDrag = uniform(0.995);
        this.uTurbulence = uniform(0.3);

        this.computeNode = null;
        this.resetState();
    }

    resetState() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 1.0;

            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;

            this.lifeData[i4] = 0;
            this.lifeData[i4 + 1] = 0;
            this.lifeData[i4 + 2] = 0;
            this.lifeData[i4 + 3] = 0;

            this.colorData[i4] = 1;
            this.colorData[i4 + 1] = 1;
            this.colorData[i4 + 2] = 1;
            this.colorData[i4 + 3] = 200;

            this.miscData[i4] = 200; // size
            this.miscData[i4 + 1] = 0; // active
            this.miscData[i4 + 2] = this.random(); // seed
            this.miscData[i4 + 3] = 0.15; // life decay / sec
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const drag = this.uDrag;
        const turbulence = this.uTurbulence;

        const computeBurst = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const life = lifeData.element(index).toVar();
            const misc = miscData.element(index).toVar();

            const active = misc.y.greaterThan(0.5);
            If(active, () => {
                const wobble = vec3(
                    sin(misc.z.mul(37.0).add(life.x.mul(11.0))).mul(turbulence),
                    cos(misc.z.mul(23.0).add(life.x.mul(13.0))).mul(turbulence),
                    sin(misc.z.mul(41.0).add(life.x.mul(9.0))).mul(turbulence),
                );

                vel.x.assign(vel.x.mul(drag).add(wobble.x.mul(delta)));
                vel.y.assign(vel.y.mul(drag).add(wobble.y.mul(delta)));
                vel.z.assign(vel.z.mul(drag).add(wobble.z.mul(delta)));

                pos.x.addAssign(vel.x.mul(delta));
                pos.y.addAssign(vel.y.mul(delta));
                pos.z.addAssign(vel.z.mul(delta));

                life.x.subAssign(delta.mul(misc.w));

                const dead = life.x.lessThanEqual(float(0.0));
                If(dead, () => {
                    life.x.assign(0.0);
                    misc.y.assign(0.0);
                    pos.z.assign(-9999.0);
                });
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            lifeData.element(index).assign(life);
            miscData.element(index).assign(misc);
        });

        this.computeNode = computeBurst().compute(this.count);
        return this.computeNode;
    }

    spawnBurst(count, origin, color, spread = 40000, lifeSeconds = 6.7) {
        const spawnCount = Math.max(1, Math.min(this.count, Math.floor(count)));
        const originX = origin?.x ?? 0;
        const originY = origin?.y ?? 0;
        const originZ = origin?.z ?? 0;
        const burstColor = color?.isColor ? color : new THREE.Color(color ?? 0xffffff);
        const luminance = (burstColor.r * 0.2126) + (burstColor.g * 0.7152) + (burstColor.b * 0.0722);

        for (let i = 0; i < spawnCount; i += 1) {
            const index = this.spawnCursor;
            const i4 = index * 4;

            const spreadX = (this.random() - 0.5) * spread * 0.8;
            const spreadY = (this.random() - 0.5) * spread * 0.5;
            const speed = (4800 + this.random() * 4800) * (0.92 + burstColor.b * 0.18 + burstColor.r * 0.08);
            const particleSize = (180 + this.random() * 170) * (0.82 + luminance * 0.46);
            const lifeDecay = 1 / Math.max(0.9, lifeSeconds * (0.94 + luminance * 0.42));

            this.positionData[i4] = originX + spreadX;
            this.positionData[i4 + 1] = originY + spreadY;
            this.positionData[i4 + 2] = originZ + 3000 + this.random() * 2000;
            this.positionData[i4 + 3] = 1.0;

            this.velocityData[i4] = (this.random() - 0.5) * 2100;
            this.velocityData[i4 + 1] = (this.random() - 0.5) * 2100;
            this.velocityData[i4 + 2] = speed;
            this.velocityData[i4 + 3] = 0.0;

            this.lifeData[i4] = 1.0;
            this.lifeData[i4 + 1] = 0.0;
            this.lifeData[i4 + 2] = 0.0;
            this.lifeData[i4 + 3] = 0.0;

            this.colorData[i4] = burstColor.r;
            this.colorData[i4 + 1] = burstColor.g;
            this.colorData[i4 + 2] = burstColor.b;
            this.colorData[i4 + 3] = particleSize;

            this.miscData[i4] = particleSize;
            this.miscData[i4 + 1] = 1.0;
            this.miscData[i4 + 2] = this.random();
            this.miscData[i4 + 3] = lifeDecay;

            this.spawnCursor = (this.spawnCursor + 1) % this.count;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    update(delta, options = {}) {
        this.uDelta.value = delta;
        if (options.drag !== undefined) {
            this.uDrag.value = options.drag;
        }
        if (options.turbulence !== undefined) {
            this.uTurbulence.value = options.turbulence;
        }
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

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.lifeBuffer = null;
        this.colorBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.lifeData = null;
        this.colorData = null;
        this.miscData = null;
    }
}

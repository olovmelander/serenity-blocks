/**
 * Ice Temple Theme - GPU Compute Shaders
 * WebGPU compute for snow simulation and shard burst pooling.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    float,
    fract,
    instanceIndex,
    sin,
    cos,
    storage,
    uniform,
} from 'three/tsl';

export class IceTempleSnowCompute {
    constructor(particleCount, bounds, randomFn = Math.random) {
        this.capacity = particleCount;
        this.count = particleCount;
        this.bounds = {
            width: bounds?.width ?? 80,
            height: bounds?.height ?? 40,
            depth: bounds?.depth ?? 60,
        };
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;

        this.positionData = new Float32Array(particleCount * 4);
        this.velocityData = new Float32Array(particleCount * 4);
        this.randomData = new Float32Array(particleCount * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.randomBuffer = new THREE.StorageBufferAttribute(this.randomData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uDrift = uniform(1.0);

        this.computeNode = null;
    }

    setActiveCount(count) {
        const nextCount = Math.max(1, Math.min(this.capacity, Math.floor(count)));
        if (nextCount === this.count) return false;
        this.count = nextCount;
        this.computeNode = null;
        this.createComputeNode();
        return true;
    }

    setInitialState(positions, randoms, speeds) {
        for (let i = 0; i < this.capacity; i++) {
            const i3 = i * 3;
            const i4 = i * 4;

            const randomValue = randoms?.[i] ?? this.random();
            const speed = speeds?.[i] ?? (0.5 + this.random());

            this.positionData[i4] = positions[i3];
            this.positionData[i4 + 1] = positions[i3 + 1];
            this.positionData[i4 + 2] = positions[i3 + 2];
            this.positionData[i4 + 3] = 1.0;

            this.velocityData[i4] = (this.random() - 0.5) * 0.25;
            this.velocityData[i4 + 1] = -(0.8 + speed * 0.9);
            this.velocityData[i4 + 2] = (this.random() - 0.5) * 0.22;
            this.velocityData[i4 + 3] = 0.0;

            this.randomData[i4] = randomValue;
            this.randomData[i4 + 1] = speed;
            this.randomData[i4 + 2] = this.random();
            this.randomData[i4 + 3] = 0.0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.randomBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const randoms = storage(this.randomBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const time = this.uTime;
        const drift = this.uDrift;

        const width = float(this.bounds.width);
        const halfHeight = float(this.bounds.height * 0.5);
        const depth = float(this.bounds.depth);

        const computeSnow = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const rand = randoms.element(index).toVar();

            const swayX = sin(time.mul(0.45).add(rand.x.mul(6.283185))).mul(0.3).mul(drift);
            const swayZ = cos(time.mul(0.3).add(rand.x.mul(5.1))).mul(0.18).mul(drift);

            pos.x.addAssign(vel.x.add(swayX).mul(delta));
            pos.y.addAssign(vel.y.mul(delta));
            pos.z.addAssign(vel.z.add(swayZ).mul(delta));

            const outOfBounds = pos.y.lessThan(halfHeight.negate())
                .or(abs(pos.x).greaterThan(width))
                .or(abs(pos.z).greaterThan(depth));

            If(outOfBounds, () => {
                const seed = float(index).add(time.mul(0.11)).add(rand.x.mul(57.23));
                const r1 = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                const r2 = fract(sin(seed.mul(78.233)).mul(43758.5453));
                const r3 = fract(sin(seed.mul(39.425)).mul(43758.5453));
                const r4 = fract(sin(seed.mul(51.719)).mul(43758.5453));

                pos.x.assign(r1.sub(0.5).mul(width));
                pos.y.assign(halfHeight.add(r2.mul(20.0)));
                pos.z.assign(r3.sub(0.5).mul(depth));

                vel.x.assign(r4.sub(0.5).mul(0.25));
                vel.y.assign(float(-0.75).sub(rand.y.mul(0.95)));
                vel.z.assign(r3.sub(0.5).mul(0.25));
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
        });

        this.computeNode = computeSnow().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, drift = 1.0) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        this.uDrift.value = drift;
    }

    updateCPU(delta, time = 0) {
        const { width, depth, height } = this.bounds;
        const halfHeight = height * 0.5;

        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;
            const baseRandom = this.randomData[i4];

            this.positionData[i4] += this.velocityData[i4] * delta;
            this.positionData[i4 + 1] += this.velocityData[i4 + 1] * delta;
            this.positionData[i4 + 2] += this.velocityData[i4 + 2] * delta;

            this.positionData[i4] += Math.sin(time * 0.45 + baseRandom * 6.283185) * 0.3 * delta;
            this.positionData[i4 + 2] += Math.cos(time * 0.3 + baseRandom * 5.1) * 0.18 * delta;

            if (
                this.positionData[i4 + 1] < -halfHeight
                || Math.abs(this.positionData[i4]) > width
                || Math.abs(this.positionData[i4 + 2]) > depth
            ) {
                this.positionData[i4] = (this.random() - 0.5) * width;
                this.positionData[i4 + 1] = halfHeight + this.random() * 20;
                this.positionData[i4 + 2] = (this.random() - 0.5) * depth;
                this.velocityData[i4] = (this.random() - 0.5) * 0.25;
                this.velocityData[i4 + 1] = -(0.75 + this.randomData[i4 + 1] * 0.95);
                this.velocityData[i4 + 2] = (this.random() - 0.5) * 0.25;
            }
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getRandomBuffer() {
        return this.randomBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.randomBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.randomData = null;
    }
}

export class IceTempleShardBurstCompute {
    constructor(capacity = 2048, randomFn = Math.random) {
        this.count = capacity;
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;
        this.spawnCursor = 0;
        this.pendingUpload = false;

        // CPU writes configuration to spawn buffers (GPU Read-only)
        this.spawnPosData = new Float32Array(capacity * 4);
        this.spawnVelData = new Float32Array(capacity * 4);
        this.spawnMiscData = new Float32Array(capacity * 4); // x: size, y: active, z: seed, w: lifeDecay

        // GPU updates state tracking buffers (GPU Read-Write, Material reads)
        this.positionData = new Float32Array(capacity * 4);
        this.velocityData = new Float32Array(capacity * 4);
        this.lifeData = new Float32Array(capacity * 4);
        this.miscData = new Float32Array(capacity * 4);

        this.spawnPosBuffer = new THREE.StorageBufferAttribute(this.spawnPosData, 4);
        this.spawnVelBuffer = new THREE.StorageBufferAttribute(this.spawnVelData, 4);
        this.spawnMiscBuffer = new THREE.StorageBufferAttribute(this.spawnMiscData, 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.lifeBuffer = new THREE.StorageBufferAttribute(this.lifeData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uGravity = uniform(8.0);
        this.uDrag = uniform(0.985);
        this.uTime = uniform(0);

        this.computeNode = null;
        this.resetState();
    }

    resetState() {
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;

            this.spawnPosData[i4] = 0;
            this.spawnPosData[i4 + 1] = 0;
            this.spawnPosData[i4 + 2] = -9999;
            this.spawnPosData[i4 + 3] = -1000; // spawnTime

            this.spawnVelData[i4] = 0;
            this.spawnVelData[i4 + 1] = 0;
            this.spawnVelData[i4 + 2] = 0;
            this.spawnVelData[i4 + 3] = 0;

            this.spawnMiscData[i4] = 1.0; // size
            this.spawnMiscData[i4 + 1] = 0.0; // active
            this.spawnMiscData[i4 + 2] = this.random(); // random seed
            this.spawnMiscData[i4 + 3] = 1.0; // life decay multiplier

            // Initial GPU state overrides
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = -9000; // pos.w holds initialization timestamp to prevent double-spawning

            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;

            this.lifeData[i4] = 0;
            this.lifeData[i4 + 1] = 0;
            this.lifeData[i4 + 2] = 0;
            this.lifeData[i4 + 3] = 0;

            this.miscData[i4] = 1.0;
            this.miscData[i4 + 1] = 0.0;
            this.miscData[i4 + 2] = this.spawnMiscData[i4 + 2];
            this.miscData[i4 + 3] = 1.0;
        }

        this.spawnPosBuffer.needsUpdate = true;
        this.spawnVelBuffer.needsUpdate = true;
        this.spawnMiscBuffer.needsUpdate = true;

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
        this.pendingUpload = false;
    }

    createComputeNode() {
        const spawnPosData = storage(this.spawnPosBuffer, 'vec4', this.count);
        const spawnVelData = storage(this.spawnVelBuffer, 'vec4', this.count);
        const spawnMiscData = storage(this.spawnMiscBuffer, 'vec4', this.count);

        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const lifeData = storage(this.lifeBuffer, 'vec4', this.count);
        const miscData = storage(this.miscBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const gravity = this.uGravity;
        const drag = this.uDrag;

        const computeShardBurst = Fn(() => {
            const index = instanceIndex;

            const spawnPos = spawnPosData.element(index).toVar();
            const spawnVel = spawnVelData.element(index).toVar();
            const spawnMisc = spawnMiscData.element(index).toVar();

            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const life = lifeData.element(index).toVar();
            const misc = miscData.element(index).toVar();

            const spawnTime = spawnPos.w;
            // A particle is initialized if its internal timestamp matches the spawn buffer timestamp
            const isInitialized = pos.w.equal(spawnTime);
            // We only want to initialize if the CPU told us to spawn (spawnMisc.y > 0.5) and we haven't yet
            const justSpawned = spawnMisc.y.greaterThan(0.5).and(isInitialized.not());

            If(justSpawned, () => {
                pos.xyz.assign(spawnPos.xyz);
                vel.xyz.assign(spawnVel.xyz);
                pos.w.assign(spawnTime); // Timestamp prevents re-initialization

                life.x.assign(1.0);
                life.y.assign(0.0);
                life.z.assign(0.0);
                life.w.assign(0.0);

                misc.x.assign(spawnMisc.x); // size
                misc.y.assign(1.0); // active
                misc.z.assign(spawnMisc.z); // random seed
                misc.w.assign(spawnMisc.w); // life decay
            });

            const active = misc.y.greaterThan(0.5);
            If(active, () => {
                vel.y.subAssign(gravity.mul(delta));
                vel.x.assign(vel.x.mul(drag));
                vel.y.assign(vel.y.mul(drag));
                vel.z.assign(vel.z.mul(drag));

                pos.x.addAssign(vel.x.mul(delta));
                pos.y.addAssign(vel.y.mul(delta));
                pos.z.addAssign(vel.z.mul(delta));

                life.x.subAssign(delta.mul(misc.w));

                const dead = life.x.lessThanEqual(0.0).or(pos.y.lessThan(-2.0));
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

        this.computeNode = computeShardBurst().compute(this.count);
        return this.computeNode;
    }

    spawnBurst(count, originX = 0, originZ = 0, options = {}) {
        const spawnCount = Math.max(1, Math.min(this.count, Math.floor(count)));
        const style = options.style || 'default';
        const spread = Number.isFinite(options.spread) ? Math.max(0.05, options.spread) : 1.5;
        const directionX = Number.isFinite(options.directionX) ? options.directionX : 0;
        const directionZ = Number.isFinite(options.directionZ) ? options.directionZ : 0;
        const directionLength = Math.hypot(directionX, directionZ);
        const dirX = directionLength > 1e-5 ? directionX / directionLength : 0;
        const dirZ = directionLength > 1e-5 ? directionZ / directionLength : 0;
        const spawnTime = options.time || (performance.now() / 1000.0); // Provide a timestamp or generate one

        const styleDefaults = {
            radialSpeedMin: style === 'pillar-jet' ? 1.8 : (style === 'crack-front' ? 2.2 : 2.5),
            radialSpeedMax: style === 'pillar-jet' ? 4.0 : (style === 'crack-front' ? 4.5 : 7.0),
            upwardMin: style === 'pillar-jet' ? 4.0 : (style === 'crack-front' ? 0.5 : 2.0),
            upwardMax: style === 'pillar-jet' ? 7.5 : (style === 'crack-front' ? 2.2 : 6.0),
            sizeMin: style === 'pillar-jet' ? 0.95 : 0.72,
            sizeMax: style === 'pillar-jet' ? 1.45 : 1.18,
            lifeDecayMin: style === 'crack-front' ? 0.58 : 0.42,
            lifeDecayMax: style === 'crack-front' ? 0.95 : 0.76,
        };

        const radialSpeedMin = Number.isFinite(options.radialSpeedMin)
            ? Math.max(0.1, options.radialSpeedMin)
            : styleDefaults.radialSpeedMin;
        const radialSpeedMax = Number.isFinite(options.radialSpeedMax)
            ? Math.max(radialSpeedMin, options.radialSpeedMax)
            : styleDefaults.radialSpeedMax;
        const upwardMin = Number.isFinite(options.upwardMin)
            ? options.upwardMin
            : styleDefaults.upwardMin;
        const upwardMax = Number.isFinite(options.upwardMax)
            ? Math.max(upwardMin, options.upwardMax)
            : styleDefaults.upwardMax;
        const sizeMin = Number.isFinite(options.sizeMin)
            ? Math.max(0.1, options.sizeMin)
            : styleDefaults.sizeMin;
        const sizeMax = Number.isFinite(options.sizeMax)
            ? Math.max(sizeMin, options.sizeMax)
            : styleDefaults.sizeMax;
        const lifeDecayMin = Number.isFinite(options.lifeDecayMin)
            ? Math.max(0.1, options.lifeDecayMin)
            : styleDefaults.lifeDecayMin;
        const lifeDecayMax = Number.isFinite(options.lifeDecayMax)
            ? Math.max(lifeDecayMin, options.lifeDecayMax)
            : styleDefaults.lifeDecayMax;

        for (let i = 0; i < spawnCount; i++) {
            const index = this.spawnCursor;
            const i4 = index * 4;
            const rand = this.random();
            const angle = this.random() * Math.PI * 2;
            const speed = radialSpeedMin + this.random() * (radialSpeedMax - radialSpeedMin);

            this.spawnPosData[i4] = originX + (this.random() - 0.5) * spread;
            this.spawnPosData[i4 + 1] = 0.4 + this.random() * 1.6;
            this.spawnPosData[i4 + 2] = originZ + (this.random() - 0.5) * spread;
            this.spawnPosData[i4 + 3] = spawnTime; // Unique timestamp forces re-init

            let velocityX = Math.cos(angle) * speed;
            let velocityY = upwardMin + this.random() * (upwardMax - upwardMin);
            let velocityZ = Math.sin(angle) * speed;

            if (style === 'pillar-jet') {
                velocityX *= 0.65;
                velocityZ *= 0.65;
            } else if (style === 'crack-front' && directionLength > 1e-5) {
                const directionalSpeed = speed * (0.75 + this.random() * 0.55);
                const tangentX = -dirZ;
                const tangentZ = dirX;
                const tangentJitter = (this.random() - 0.5) * (0.95 + spread * 0.55);
                velocityX = dirX * directionalSpeed + tangentX * tangentJitter;
                velocityZ = dirZ * directionalSpeed + tangentZ * tangentJitter;
            }

            this.spawnVelData[i4] = velocityX;
            this.spawnVelData[i4 + 1] = velocityY;
            this.spawnVelData[i4 + 2] = velocityZ;
            this.spawnVelData[i4 + 3] = 0.0;

            this.spawnMiscData[i4] = sizeMin + this.random() * (sizeMax - sizeMin); // size multiplier
            this.spawnMiscData[i4 + 1] = 1.0; // active signal
            this.spawnMiscData[i4 + 2] = rand; // random seed
            this.spawnMiscData[i4 + 3] = lifeDecayMin + this.random() * (lifeDecayMax - lifeDecayMin); // life decay

            this.spawnCursor = (this.spawnCursor + 1) % this.count;
        }

        this.pendingUpload = true;
        if (options.deferUpload !== true) {
            this.commitSpawns();
        }
    }

    commitSpawns() {
        if (!this.pendingUpload) return false;
        if (!this.spawnPosBuffer || !this.spawnVelBuffer || !this.spawnMiscBuffer) {
            this.pendingUpload = false;
            return false;
        }

        // Critical Fix: ONLY upload the spawn parameters via CPU. DO NOT overwrite state buffers!
        this.spawnPosBuffer.needsUpdate = true;
        this.spawnVelBuffer.needsUpdate = true;
        this.spawnMiscBuffer.needsUpdate = true;

        this.pendingUpload = false;
        return true;
    }

    update(delta, time) {
        this.uDelta.value = delta;
        if (time !== undefined) {
            this.uTime.value = time;
        }
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getLifeBuffer() {
        return this.lifeBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.spawnPosBuffer = null;
        this.spawnVelBuffer = null;
        this.spawnMiscBuffer = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.lifeBuffer = null;
        this.miscBuffer = null;

        this.spawnPosData = null;
        this.spawnVelData = null;
        this.spawnMiscData = null;
        this.positionData = null;
        this.velocityData = null;
        this.lifeData = null;
        this.miscData = null;
    }
}

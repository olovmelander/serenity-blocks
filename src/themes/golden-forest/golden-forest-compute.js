import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    clamp,
    cos,
    float,
    fract,
    instanceIndex,
    length,
    max,
    mod,
    normalize,
    sin,
    storage,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

/**
 * WebGPU bird simulation for Golden Forest.
 *
 * This is an intentionally lightweight flock approximation designed to mirror
 * the meditative silhouette motion of the existing WebGL GPGPU path while
 * staying robust on current WebGPU backends.
 */
export class GoldenForestBirdCompute {
    constructor(count, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = typeof randomFn === 'function' ? randomFn : Math.random;

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);

        this.updateVelocityNode = null;
        this.updatePositionNode = null;
    }

    setInitialState() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const seed = this.random();

            const x = this.random() * 2000 - 1000; // -1000..1000
            const nearCanopy = this.random() < 0.45;
            const y = nearCanopy
                ? 28 + this.random() * 30
                : 60 + this.random() * 160;
            const z = this.random() * 1200 - 800; // -800..400

            this.positionData[i4] = x;
            this.positionData[i4 + 1] = y;
            this.positionData[i4 + 2] = z;
            this.positionData[i4 + 3] = seed * Math.PI * 2;

            const vx = this.random() - 0.5;
            const vy = (this.random() - 0.5) * 0.6;
            const vz = this.random() - 0.5;
            const invLen = 1 / Math.max(0.0001, Math.sqrt(vx * vx + vy * vy + vz * vz));
            const baseSpeed = 2.4 + this.random() * 2.1;
            this.velocityData[i4] = vx * invLen * baseSpeed;
            this.velocityData[i4 + 1] = vy * invLen * baseSpeed;
            this.velocityData[i4 + 2] = vz * invLen * baseSpeed;
            this.velocityData[i4 + 3] = seed;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    createComputeNodes() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const uTime = this.uTime;
        const uDelta = this.uDelta;

        const updateVelocity = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();

            const seed = vel.w;
            const phase = uTime.mul(0.085).add(seed.mul(6.283185));

            // Shared moving flock center with mild per-bird phase offsets.
            const target = vec3(
                sin(phase).mul(480.0),
                float(90.0).add(sin(uTime.mul(0.21).add(seed.mul(11.0))).mul(48.0)),
                float(-280.0).add(cos(uTime.mul(0.12).add(seed.mul(7.0))).mul(280.0)),
            );

            const toTarget = target.sub(pos.xyz);
            const targetDist = max(length(toTarget), float(0.0001));
            const seek = normalize(toTarget)
                .mul(clamp(targetDist.div(520.0), 0.15, 1.0))
                .mul(1.2);

            // Per-bird drift noise to break rigid lockstep.
            const drift = vec3(
                sin(uTime.mul(0.72).add(seed.mul(17.0))),
                sin(uTime.mul(0.53).add(seed.mul(23.0))).mul(0.45),
                cos(uTime.mul(0.67).add(seed.mul(19.0))),
            ).mul(0.85);

            const nextVel = vel.xyz.toVar();
            nextVel.addAssign(seek.mul(uDelta.mul(8.5)));
            nextVel.addAssign(drift.mul(uDelta.mul(2.5)));
            nextVel.addAssign(pos.xyz.negate().mul(0.0016).mul(uDelta.mul(4.0)));

            // Keep flock in broad scene bounds.
            If(pos.x.greaterThan(950.0), () => {
                nextVel.x.subAssign(uDelta.mul(10.0));
            });
            If(pos.x.lessThan(-950.0), () => {
                nextVel.x.addAssign(uDelta.mul(10.0));
            });

            If(pos.y.greaterThan(380.0), () => {
                nextVel.y.subAssign(uDelta.mul(6.0));
            });
            If(pos.y.lessThan(18.0), () => {
                nextVel.y.addAssign(uDelta.mul(8.0));
            });

            If(pos.z.greaterThan(400.0), () => {
                nextVel.z.subAssign(uDelta.mul(10.0));
            });
            If(pos.z.lessThan(-900.0), () => {
                nextVel.z.addAssign(uDelta.mul(10.0));
            });

            // Match WebGL behavior: encourage canopy glides.
            const canopyBand = clamp(pos.y.sub(35.0).div(105.0), 0.0, 1.0);
            nextVel.y.subAssign(canopyBand.mul(2.5).mul(uDelta));

            const speed = max(length(nextVel), float(0.0001));
            const clampedSpeed = clamp(speed, 1.25, 5.5);
            nextVel.assign(normalize(nextVel).mul(clampedSpeed));
            vel.xyz.assign(nextVel);

            velocities.element(index).assign(vel);
        });

        const updatePosition = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();

            // Match legacy position integration scale from GPUComputationRenderer path.
            pos.xyz.assign(pos.xyz.add(vel.xyz.mul(uDelta).mul(15.0)));

            const flapPhaseAdvance = uDelta
                .mul(4.0)
                .add(length(vec3(vel.x, 0.0, vel.z)).mul(uDelta.mul(2.2)));
            pos.w.assign(mod(pos.w.add(flapPhaseAdvance), 62.83));

            // Deterministic tiny drift in phase seed to avoid long-running lock.
            const reseed = fract(sin(float(index).add(uTime.mul(0.013))).mul(43758.5453));
            vel.w.assign(vel.w.mul(0.9995).add(reseed.mul(0.0005)));

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
        });

        this.updateVelocityNode = updateVelocity().compute(this.count);
        this.updatePositionNode = updatePosition().compute(this.count);
    }

    update(time, delta) {
        this.uTime.value = time;
        this.uDelta.value = delta;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getVelocityBuffer() {
        return this.velocityBuffer;
    }

    dispose() {
        this.updateVelocityNode = null;
        this.updatePositionNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.positionData = null;
        this.velocityData = null;
    }
}

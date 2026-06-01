/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Eruption Compute Sim
 *
 * One GPU compute dispatch drives the whole eruption fountain — replaces the
 * old theme's 15 000-particle CPU explosion loop. Three roles, partitioned by
 * instance index (deterministic, no per-particle role buffer):
 *   - fountain core: dense, fast-up, short-lived  → the bright column
 *   - embers:        wider, slower, long-lived     → drifting sparks
 *   - lava bombs:    rare, heavy, arc outward       → glowing chunks
 *
 * Buffers (2 × vec4 × count):
 *   positions:  xyz + age (0..1)
 *   velocities: xyz + lifetime (seconds)
 *
 * Spawn happens on the GPU at end-of-life / below-vent. `uIntensity` and the
 * decaying `uErupt` burst scale launch velocity, so combos visibly detonate.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cos,
    float,
    fract,
    instanceIndex,
    sin,
    step,
    storage,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

export const ERUPTION_BUDGETS = Object.freeze({
    Minimal: 1800,
    Low: 3000,
    Medium: 5000,
    High: 7500,
    Ultra: 11000,
    Extreme: 16000,
});

export function getEruptionBudget(qualityName) {
    return ERUPTION_BUDGETS[qualityName] || ERUPTION_BUDGETS.High;
}

const VENT_Y = 155; // crater floor world height

export class EruptionSim {
    constructor(count) {
        this.count = Math.max(1, Math.floor(count));
        this.bombCount = Math.floor(this.count * 0.02);
        this.emberCount = Math.floor(this.count * 0.32);

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);

        // Stagger initial ages so the fountain streams in rather than puffing
        // all at once; park everyone at the vent with zero velocity so the GPU
        // spawn (age>1 path) launches them on the first frames.
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = VENT_Y;
            this.positionData[i4 + 2] = 0;
            this.positionData[i4 + 3] = Math.random(); // age
            this.velocityData[i4 + 3] = 1.6; // lifetime placeholder
        }

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uIntensity = uniform(0);
        this.uErupt = uniform(0); // burst spike, decays fast
        this.uGravity = uniform(380);

        this.computeNode = null;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);

        const dt = this.uDelta;
        const time = this.uTime;
        const intensity = this.uIntensity;
        const erupt = this.uErupt;
        const gravity = this.uGravity;
        const bombF = float(this.bombCount);
        const emberF = float(this.emberCount);

        const computeFn = Fn(() => {
            const index = instanceIndex;
            const idxF = float(index).toVar();

            // Role masks (disjoint): bombs are the first slice, then embers,
            // then everything else is fountain core.
            const bombMask = step(idxF, bombF).toVar();
            const emberMask = step(idxF, emberF).sub(bombMask).toVar();
            const fountainMask = float(1.0).sub(step(idxF, emberF)).toVar();

            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const pXYZ = pos.xyz.toVar();
            const vXYZ = vel.xyz.toVar();
            const age = pos.w.toVar();
            const life = vel.w.toVar();

            // Forces: gravity + buoyant churn turbulence (stronger mid-column).
            vXYZ.addAssign(vec3(0.0, gravity.mul(dt).negate(), 0.0));
            const churn = float(140.0).mul(fountainMask.mul(1.0).add(emberMask.mul(0.6)).add(0.2));
            const tX = sin(time.mul(1.3).add(idxF.mul(0.7)).add(pXYZ.y.mul(0.01))).mul(churn);
            const tZ = cos(time.mul(1.1).add(idxF.mul(0.9)).add(pXYZ.y.mul(0.012))).mul(churn);
            vXYZ.addAssign(vec3(tX, 0.0, tZ).mul(dt));
            vXYZ.mulAssign(0.992);

            // Integrate + age.
            pXYZ.addAssign(vXYZ.mul(dt));
            age.addAssign(dt.div(life));

            // GPU respawn at the vent on death / fall-back below the crater.
            const doRespawn = age.greaterThan(1.0).or(pXYZ.y.lessThan(float(VENT_Y - 90)));
            If(doRespawn, () => {
                const seed = idxF.add(time.mul(57.0));
                const r1 = fract(sin(seed.mul(12.9898)).mul(43758.5453)).toVar();
                const r2 = fract(sin(seed.mul(78.233)).mul(43758.5453)).toVar();
                const r3 = fract(sin(seed.mul(39.425)).mul(43758.5453)).toVar();
                const ang = r1.mul(6.2832);

                const spawnR = bombMask.mul(22.0).add(emberMask.mul(95.0)).add(fountainMask.mul(38.0))
                    .mul(r2.mul(0.6).add(0.5));
                pXYZ.assign(vec3(cos(ang).mul(spawnR), float(VENT_Y), sin(ang).mul(spawnR)));

                const burst = intensity.mul(0.7).add(0.5).add(erupt.mul(0.6));
                const upBase = fountainMask.mul(640.0).add(emberMask.mul(380.0)).add(bombMask.mul(1000.0));
                const up = upBase.mul(burst).mul(r3.mul(0.5).add(0.72));
                const outBase = fountainMask.mul(70.0).add(emberMask.mul(130.0)).add(bombMask.mul(340.0));
                const out = outBase.mul(r2.mul(0.6).add(0.4));
                vXYZ.assign(vec3(cos(ang).mul(out), up, sin(ang).mul(out)));

                life.assign(fountainMask.mul(1.6).add(emberMask.mul(3.8)).add(bombMask.mul(2.6)).add(0.2));
                age.assign(0.0);
            });

            positions.element(index).assign(vec4(pXYZ, age));
            velocities.element(index).assign(vec4(vXYZ, life));
        });

        this.computeNode = computeFn().compute(this.count);
        return this.computeNode;
    }

    /** Spike the eruption (combo / line clear). */
    erupt(strength) {
        this.uErupt.value = Math.min(4, this.uErupt.value + strength);
    }

    update(delta, time, intensity) {
        this.uDelta.value = Math.min(delta, 0.033);
        this.uTime.value = time;
        this.uIntensity.value = intensity;
        this.uErupt.value = Math.max(0, this.uErupt.value - delta * 2.0);
    }

    getPositionBuffer() { return this.positionBuffer; }

    getVelocityBuffer() { return this.velocityBuffer; }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.positionData = null;
        this.velocityData = null;
    }
}

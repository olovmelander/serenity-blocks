/* eslint-disable import/no-unresolved */
/**
 * Starlight — Stardust Particles Compute System (`StardustSim`)
 *
 * The living "river of light" hero layer (masterpiece plan §5). Forked from
 * electric-dreams-v3/sim/fluid-particles.js: same GPU compute spine (storage
 * buffers → TSL compute Fn → billboard InstancedMesh) and the same impulse
 * system (RADIAL / VORTEX / ATTRACTOR) for event reactions, but the force model
 * is replaced:
 *   - 3-sine turbulence → divergence-free CURL NOISE so motes swirl in coherent
 *     eddies and never clump (a calm drifting current, not random jitter).
 *   - focal gravity / board-repulsion → a gentle bounds-centering + slow breeze.
 *   - particles spawn + respawn in a WIDE SLAB (the sky canopy), not an ellipsoid.
 *
 * Native WebGPU advances storage buffers with compute. WebGL2 advances the same
 * particle arrays on the CPU and renders them through instanced attributes.
 *
 * Storage layout (3 × vec4 × count):
 *   positions:  xyz + age (0..1)
 *   velocities: xyz + lifetime (seconds)
 *   colors:     rgb (base mote color) + energy (0..1, speed-driven brightness)
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cross,
    float,
    fract,
    instanceIndex,
    length,
    max,
    sin,
    storage,
    uniform,
    vec3,
} from 'three/tsl';
import { curlNoise3 } from '../materials/tsl-noise-lib.js';
import { IMPULSE_TYPE } from './impulse-types.js';

export const STARDUST_BUDGETS = Object.freeze({
    Minimal: Object.freeze({ count: 0, flowStrength: 0 }),
    Low: Object.freeze({ count: 6000, flowStrength: 1.1 }),
    Medium: Object.freeze({ count: 12000, flowStrength: 1.2 }),
    High: Object.freeze({ count: 20000, flowStrength: 1.3 }),
    Ultra: Object.freeze({ count: 30000, flowStrength: 1.35 }),
    Extreme: Object.freeze({ count: 40000, flowStrength: 1.4 }),
});

export function getStardustBudget(qualityName) {
    return { ...(STARDUST_BUDGETS[qualityName] || STARDUST_BUDGETS.High) };
}

export const MAX_IMPULSES = 8;
export { IMPULSE_TYPE }; // re-exported from ./impulse-types.js for existing importers

// Cool + warm fairy-dust seed colors (the starlightRamp endpoints).
const COOL = [0.75, 0.85, 1.0];
const WARM = [1.0, 0.91, 0.76];

export class StardustSim {
    constructor(count, options = {}) {
        this.count = Math.max(1, Math.floor(count));
        this.bounds = {
            width: options.boundsWidth ?? 22,
            height: options.boundsHeight ?? 12,
            depth: options.boundsDepth ?? 10,
        };

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.colorData = new Float32Array(this.count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        // Impulse slots (vec4 pos+strength, vec4 dir+type).
        this._impulsePositions = [];
        this._impulseParams = [];
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            this._impulsePositions.push(uniform(new THREE.Vector4(0, 0, 0, 0)));
            this._impulseParams.push(uniform(new THREE.Vector4(0, 1, 0, 0)));
        }

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uFlowStrength = uniform(options.flowStrength ?? 1.3);
        this.uBreeze = uniform(new THREE.Vector3(0.05, 0.018, 0));
        this.uDamping = uniform(0.965);
        this.uMaxSpeed = uniform(3.2);
        this.uCenterPull = uniform(0.12); // gentle bounds-centering (keeps the river coherent)
        this.uBounds = uniform(new THREE.Vector3(this.bounds.width, this.bounds.height, this.bounds.depth));

        this.computeNode = null;
        this._initParticleState();
    }

    _initParticleState() {
        const { width, height, depth } = this.bounds;
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = (Math.random() * 2 - 1) * width;
            this.positionData[i4 + 1] = (Math.random() * 2 - 1) * height;
            this.positionData[i4 + 2] = (Math.random() * 2 - 1) * depth;
            this.positionData[i4 + 3] = Math.random(); // age

            this.velocityData[i4] = (Math.random() - 0.5) * 0.3;
            this.velocityData[i4 + 1] = (Math.random() - 0.5) * 0.3;
            this.velocityData[i4 + 2] = (Math.random() - 0.5) * 0.2;
            this.velocityData[i4 + 3] = 14 + Math.random() * 22; // lifetime seconds

            // Base mote color: blend cool↔warm so the river shimmers in temperature.
            const t = Math.random();
            this.colorData[i4] = COOL[0] + (WARM[0] - COOL[0]) * t;
            this.colorData[i4 + 1] = COOL[1] + (WARM[1] - COOL[1]) * t;
            this.colorData[i4 + 2] = COOL[2] + (WARM[2] - COOL[2]) * t;
            this.colorData[i4 + 3] = 0.4 + Math.random() * 0.6; // energy seed
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const colors = storage(this.colorBuffer, 'vec4', this.count);

        const dt = this.uDelta;
        const time = this.uTime;
        const flowStr = this.uFlowStrength;
        const breeze = this.uBreeze;
        const damping = this.uDamping;
        const maxSpeed = this.uMaxSpeed;
        const centerPull = this.uCenterPull;
        const bounds = this.uBounds;
        const impulsePositions = this._impulsePositions;
        const impulseParams = this._impulseParams;

        const computeFn = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const col = colors.element(index).toVar();

            const pXYZ = pos.xyz.toVar();
            const vXYZ = vel.xyz.toVar();
            const age = pos.w.toVar();

            // 1. Divergence-free curl-noise flow field — the coherent current.
            const flow = curlNoise3(pXYZ, time);
            vXYZ.addAssign(flow.mul(flowStr).mul(dt));

            // 2. Gentle global breeze (lazy mass drift).
            vXYZ.addAssign(breeze.mul(dt));

            // 3. Soft bounds-centering — keeps the river from dispersing to the
            // edges (pull grows with distance past the bounds, cheap + stable).
            const overX = max(pXYZ.x.abs().sub(bounds.x), float(0.0)).mul(pXYZ.x.sign().negate());
            const overY = max(pXYZ.y.abs().sub(bounds.y), float(0.0)).mul(pXYZ.y.sign().negate());
            const overZ = max(pXYZ.z.abs().sub(bounds.z), float(0.0)).mul(pXYZ.z.sign().negate());
            vXYZ.addAssign(vec3(overX, overY, overZ).mul(centerPull).mul(dt).mul(4.0));

            // 4. Impulses (event reactions; inactive slots cost ~nothing).
            for (let i = 0; i < MAX_IMPULSES; i += 1) {
                const ip = impulsePositions[i];
                const ipar = impulseParams[i];
                const impCenter = ip.xyz.toVar();
                const impStr = ip.w.toVar();
                const impDir = ipar.xyz.toVar();
                const impType = ipar.w.toVar();

                const toImp = pXYZ.sub(impCenter).toVar();
                const dImp = length(toImp).toVar();
                const safeImp = max(dImp, float(0.05));
                const fallOff = max(float(1.0).sub(dImp.mul(0.16)), float(0.0));
                const fallOffSq = fallOff.mul(fallOff);

                If(impType.lessThan(float(0.5)).and(impStr.greaterThan(float(0.01))), () => {
                    vXYZ.addAssign(toImp.div(safeImp).mul(impStr).mul(fallOffSq).mul(dt));
                });
                const isVortex = impType.greaterThan(float(0.5))
                    .and(impType.lessThan(float(1.5)))
                    .and(impStr.greaterThan(float(0.01)));
                If(isVortex, () => {
                    const tangent = cross(impDir, toImp.div(safeImp));
                    vXYZ.addAssign(tangent.mul(impStr).mul(fallOffSq).mul(dt));
                });
                If(impType.greaterThan(float(1.5)).and(impStr.greaterThan(float(0.01))), () => {
                    vXYZ.addAssign(impCenter.sub(pXYZ).div(safeImp).mul(impStr).mul(fallOffSq)
                        .mul(dt));
                });
            }

            // 5. Damping + speed cap. Delta-normalized (pow to the 60 Hz-referenced
            //    exponent) so drift speed matches at 60/120/144 Hz.
            vXYZ.mulAssign(damping.pow(dt.mul(60.0)));
            const sp = length(vXYZ).toVar();
            If(sp.greaterThan(maxSpeed), () => {
                vXYZ.mulAssign(maxSpeed.div(sp));
            });

            // 6. Integrate.
            pXYZ.addAssign(vXYZ.mul(dt));

            // 7. Age advance + respawn at end-of-life (hash-scattered in the slab).
            age.addAssign(dt.div(vel.w));
            If(age.greaterThan(float(1.0)), () => {
                const idxF = float(index);
                const r1 = fract(sin(idxF.mul(12.9898).add(time.mul(0.37))).mul(43758.5453));
                const r2 = fract(sin(idxF.mul(78.233).add(time.mul(0.53))).mul(43758.5453));
                const r3 = fract(sin(idxF.mul(39.425).add(time.mul(0.71))).mul(43758.5453));
                pXYZ.assign(vec3(
                    r1.sub(0.5).mul(2.0).mul(bounds.x),
                    r2.sub(0.5).mul(2.0).mul(bounds.y),
                    r3.sub(0.5).mul(2.0).mul(bounds.z),
                ));
                vXYZ.assign(vec3(r1.sub(0.5).mul(0.3), r2.sub(0.5).mul(0.3), r3.sub(0.5).mul(0.2)));
                age.assign(float(0.0));
            });

            // 8. Energy ← speed (fast motes glow brighter; smoothed).
            const energyTarget = sp.div(maxSpeed).mul(0.6).add(0.4);
            // Delta-normalized smoothing (≈0.1 per frame at 60 Hz).
            const energyLerp = dt.mul(-6.3).exp().oneMinus();
            col.w.assign(col.w.add(energyTarget.sub(col.w).mul(energyLerp)));

            pos.x.assign(pXYZ.x);
            pos.y.assign(pXYZ.y);
            pos.z.assign(pXYZ.z);
            pos.w.assign(age);
            vel.x.assign(vXYZ.x);
            vel.y.assign(vXYZ.y);
            vel.z.assign(vXYZ.z);
            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            colors.element(index).assign(col);
        });

        this.computeNode = computeFn().compute(this.count);
        return this.computeNode;
    }

    pushImpulse(position, strength, dir, type = IMPULSE_TYPE.RADIAL) {
        let slot = -1;
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            if (this._impulsePositions[i].value.w < 0.01) { slot = i; break; }
        }
        if (slot < 0) slot = 0;
        this._impulsePositions[slot].value.set(position.x, position.y, position.z, strength);
        const d = dir || { x: 0, y: 0, z: 1 };
        this._impulseParams[slot].value.set(d.x, d.y, d.z, type);
    }

    decayImpulses(delta) {
        const k = Math.exp(-delta * 4);
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            const ip = this._impulsePositions[i].value;
            ip.w *= k;
            if (ip.w < 0.01) ip.w = 0;
        }
    }

    update(delta, time) {
        this.uDelta.value = Math.min(delta, 0.033);
        this.uTime.value = time;
        this.decayImpulses(delta);
    }

    /**
     * WebGL2 keeps the same motes and event/lifetime model using CPU attributes.
     * A bounded analytic curl replaces the six MaterialX vector-noise samples:
     * each flow component depends on the other axes, so divergence stays zero.
     */
    updateCPU(delta, time) {
        this.update(delta, time);
        const dt = Math.max(0, this.uDelta.value);
        const flow = this.uFlowStrength.value;
        const breeze = this.uBreeze.value;
        const bounds = this.uBounds.value;
        const center = this.uCenterPull.value * dt * 4;
        const damping = this.uDamping.value ** (dt * 60);
        const maxSpeed = this.uMaxSpeed.value;
        const energyLerp = 1 - Math.exp(-6.3 * dt);
        const fractCPU = (value) => value - Math.floor(value);
        const phase = time * 0.05;
        const secondPhase = time * -0.035;
        for (let i = 0; i < this.count; i += 1) {
            const j = i * 4;
            let x = this.positionData[j];
            let y = this.positionData[j + 1];
            let z = this.positionData[j + 2];
            let vx = this.velocityData[j];
            let vy = this.velocityData[j + 1];
            let vz = this.velocityData[j + 2];
            vx += (-0.18 * Math.cos(z * 0.18 + phase) - 0.0945 * Math.sin(y * 0.27 + secondPhase)) * flow * dt;
            vy += (-0.18 * Math.cos(x * 0.18 + phase) - 0.0945 * Math.sin(z * 0.27 + secondPhase)) * flow * dt;
            vz += (-0.18 * Math.cos(y * 0.18 + phase) - 0.0945 * Math.sin(x * 0.27 + secondPhase)) * flow * dt;
            vx += breeze.x * dt - Math.max(Math.abs(x) - bounds.x, 0) * Math.sign(x) * center;
            vy += breeze.y * dt - Math.max(Math.abs(y) - bounds.y, 0) * Math.sign(y) * center;
            vz += breeze.z * dt - Math.max(Math.abs(z) - bounds.z, 0) * Math.sign(z) * center;
            for (let k = 0; k < MAX_IMPULSES; k += 1) {
                const impulse = this._impulsePositions[k].value;
                if (impulse.w <= 0.01) continue;
                const parameter = this._impulseParams[k].value;
                const dx = x - impulse.x;
                const dy = y - impulse.y;
                const dz = z - impulse.z;
                const distance = Math.hypot(dx, dy, dz);
                const scale = (impulse.w * Math.max(1 - distance * 0.16, 0) ** 2 * dt)
                    / Math.max(distance, 0.05);
                if (parameter.w < 0.5) {
                    vx += dx * scale; vy += dy * scale; vz += dz * scale;
                } else if (parameter.w < 1.5) {
                    vx += (parameter.y * dz - parameter.z * dy) * scale;
                    vy += (parameter.z * dx - parameter.x * dz) * scale;
                    vz += (parameter.x * dy - parameter.y * dx) * scale;
                } else {
                    vx -= dx * scale; vy -= dy * scale; vz -= dz * scale;
                }
            }
            vx *= damping; vy *= damping; vz *= damping;
            const speed = Math.hypot(vx, vy, vz);
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                vx *= scale; vy *= scale; vz *= scale;
            }
            x += vx * dt; y += vy * dt; z += vz * dt;
            let age = this.positionData[j + 3] + dt / this.velocityData[j + 3];
            if (age > 1) {
                const r1 = fractCPU(Math.sin(i * 12.9898 + time * 0.37) * 43758.5453);
                const r2 = fractCPU(Math.sin(i * 78.233 + time * 0.53) * 43758.5453);
                const r3 = fractCPU(Math.sin(i * 39.425 + time * 0.71) * 43758.5453);
                x = (r1 - 0.5) * 2 * bounds.x;
                y = (r2 - 0.5) * 2 * bounds.y;
                z = (r3 - 0.5) * 2 * bounds.z;
                vx = (r1 - 0.5) * 0.3; vy = (r2 - 0.5) * 0.3; vz = (r3 - 0.5) * 0.2;
                age = 0;
            }
            this.positionData[j] = x; this.positionData[j + 1] = y; this.positionData[j + 2] = z;
            this.positionData[j + 3] = age;
            this.velocityData[j] = vx; this.velocityData[j + 1] = vy; this.velocityData[j + 2] = vz;
            const targetEnergy = (speed / maxSpeed) * 0.6 + 0.4;
            this.colorData[j + 3] += (targetEnergy - this.colorData[j + 3]) * energyLerp;
        }
    }

    getPositionBuffer() { return this.positionBuffer; }

    getColorBuffer() { return this.colorBuffer; }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.colorBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.colorData = null;
        this._impulsePositions = null;
        this._impulseParams = null;
    }
}

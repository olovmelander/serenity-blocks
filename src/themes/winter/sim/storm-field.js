/* eslint-disable import/no-unresolved, camelcase */
/**
 * Winter AAA — GPU Curl-Noise Storm Field (Phase 1)
 *
 * Divergence-free curl-noise wind advecting the snow particles so they move in
 * coherent sheets and gusts instead of falling as independent dots (the single
 * thing that turns "TV static" into "blizzard"). Drop-in replacement for the
 * trivial-gravity SnowParticleCompute: exposes the same surface
 * (getPositionBuffer / count / computeNode / update / setActiveCount / dispose)
 * so the theme's LOD + lifecycle plumbing is unchanged.
 *
 * The field is a 2D curl (XY, the screen plane) derived from a scalar noise
 * potential ψ:  v = (∂ψ/∂y, −∂ψ/∂x). 2D curl is divergence-free, cheap
 * (3 noise taps/particle), and reads beautifully as wind-blown snow facing
 * camera; a gentle per-particle Z wobble adds parallax. Base fall + global gust
 * + turbulence amplitude are all driven by StormDirector.intensity, so the snow
 * escalates with the game. Combos inject a transient vortex.
 *
 * See docs/WINTER_AAA_PLAN.md §3.1.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    float,
    vec2,
    vec3,
    sin,
    fract,
    abs,
    mix,
    clamp,
    length,
    smoothstep,
    mx_noise_float,
    If,
} from 'three/tsl';

export class StormField {
    constructor(particleCount, bounds) {
        this.capacity = particleCount;
        this.count = particleCount;
        this.bounds = bounds;

        // vec4 buffers: position(xyz, phase-seed in w), velocity(xyz, w unused)
        this.positionData = new Float32Array(particleCount * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityData = new Float32Array(particleCount * 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);

        // --- Uniforms (driven per-frame from StormDirector) ---
        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uWindX = uniform(0); // horizontal world-space wind
        this.uBaseFall = uniform(-70); // downward speed (negative)
        this.uTurbAmp = uniform(220); // curl strength
        this.uDrag = uniform(1.8); // how fast velocity chases the wind field
        this.uParallaxZ = uniform(6); // gentle z drift amplitude
        this.uNoiseFreq = uniform(0.0016); // spatial scale of turbulence
        this.uFieldScroll = uniform(0.06); // how fast the field evolves in time
        // Vortex slot (combo-injected): xy center, z strength, w radius
        this.uVortex = uniform(new THREE.Vector4(0, 0, 0, 250));

        this.computeNode = null;
    }

    setInitialState() {
        const b = this.bounds;
        const centerY = b.centerY ?? 0;
        const centerZ = b.centerZ ?? -200;
        for (let i = 0; i < this.capacity; i++) {
            const i4 = i * 4;
            this.positionData[i4] = (Math.random() - 0.5) * b.width;
            this.positionData[i4 + 1] = centerY + (Math.random() - 0.5) * b.height;
            this.positionData[i4 + 2] = centerZ + (Math.random() - 0.5) * b.depth;
            this.positionData[i4 + 3] = Math.random() * Math.PI * 2; // per-particle phase
            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = -(15 + Math.random() * 25);
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    setActiveCount(count) {
        const next = Math.max(1, Math.min(this.capacity, Math.floor(count)));
        if (next === this.count) return false;
        this.count = next;
        this.computeNode = null;
        this.createComputeNode();
        return true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);

        const width = float(this.bounds.width);
        const depth = float(this.bounds.depth);
        const centerY = float(this.bounds.centerY ?? 0);
        const centerZ = float(this.bounds.centerZ ?? -200);
        const halfHeight = float(this.bounds.height * 0.5);
        const halfDepth = float(this.bounds.depth * 0.5);
        const bottomY = centerY.sub(halfHeight);
        const topY = centerY.add(halfHeight);
        const frontZ = centerZ.add(halfDepth).add(float(80.0));
        const {
            uTime, uDelta, uWindX, uBaseFall, uTurbAmp, uDrag,
            uParallaxZ, uNoiseFreq, uFieldScroll, uVortex,
        } = this;

        // Scalar potential ψ(p) — animated low-freq gradient noise.
        const psi = Fn(([q]) => {
            const scroll = uTime.mul(uFieldScroll);
            return mx_noise_float(vec3(
                q.x.mul(uNoiseFreq).add(scroll),
                q.y.mul(uNoiseFreq),
                q.z.mul(uNoiseFreq).sub(scroll),
            ));
        });

        const computeStorm = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const p = pos.xyz;

            // --- 2D curl of ψ in the XY plane: v = (∂ψ/∂y, −∂ψ/∂x) ---
            const eps = float(8.0);
            const c = psi(p);
            const dPsiDx = psi(vec3(p.x.add(eps), p.y, p.z)).sub(c).div(eps);
            const dPsiDy = psi(vec3(p.x, p.y.add(eps), p.z)).sub(c).div(eps);
            const curlX = dPsiDy.mul(uTurbAmp);
            // Damp the vertical curl so snow keeps falling instead of hovering.
            const curlY = dPsiDx.negate().mul(uTurbAmp).mul(0.45);

            const wobblePhase = uTime.mul(0.3).add(pos.w);
            const windX = uWindX.add(curlX);
            const windY = uBaseFall.add(curlY);
            const windZ = sin(wobblePhase).mul(uParallaxZ);

            // Chase the wind field (inertia → smooth, weighty motion).
            const k = clamp(uDrag.mul(uDelta), 0.0, 1.0);
            vel.x.assign(mix(vel.x, windX, k));
            vel.y.assign(mix(vel.y, windY, k));
            vel.z.assign(mix(vel.z, windZ, k));

            // --- Transient combo vortex (swirl in XY around uVortex.xy) ---
            const toC = vec2(p.x.sub(uVortex.x), p.y.sub(uVortex.y));
            const dist = length(toC).add(0.001);
            const falloff = smoothstep(uVortex.w, float(0.0), dist).mul(uVortex.z);
            const tangent = vec2(toC.y.negate(), toC.x).div(dist);
            vel.x.addAssign(tangent.x.mul(falloff));
            vel.y.addAssign(tangent.y.mul(falloff));

            // Integrate.
            pos.x.addAssign(vel.x.mul(uDelta));
            pos.y.addAssign(vel.y.mul(uDelta));
            pos.z.addAssign(vel.z.mul(uDelta));

            // Respawn through the top when it leaves the box.
            const outOfBounds = pos.y.lessThan(bottomY)
                .or(abs(pos.x).greaterThan(width))
                .or(pos.z.greaterThan(frontZ));
            If(outOfBounds, () => {
                const seed = float(index).add(uTime.mul(0.1));
                const r1 = fract(sin(seed.mul(12.9898)).mul(43758.5453));
                const r2 = fract(sin(seed.mul(78.233)).mul(43758.5453));
                const r3 = fract(sin(seed.mul(39.346)).mul(43758.5453));
                pos.x.assign(r1.sub(0.5).mul(width));
                pos.y.assign(topY.add(r2.mul(60.0)));
                pos.z.assign(centerZ.add(r3.sub(0.5).mul(depth)));
                vel.x.assign(0.0);
                vel.y.assign(uBaseFall.mul(0.6));
                vel.z.assign(0.0);
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
        });

        this.computeNode = computeStorm().compute(this.count);
        return this.computeNode;
    }

    /**
     * Per-frame uniform push.
     * @param {number} time
     * @param {number} delta
     * @param {object} params - { windX, baseFall, turbAmp, drag, parallaxZ }
     */
    update(time, delta, params = {}) {
        this.uTime.value = time;
        this.uDelta.value = Math.min(0.05, Math.max(0, delta));
        if (params.windX !== undefined) this.uWindX.value = params.windX;
        if (params.baseFall !== undefined) this.uBaseFall.value = params.baseFall;
        if (params.turbAmp !== undefined) this.uTurbAmp.value = params.turbAmp;
        if (params.drag !== undefined) this.uDrag.value = params.drag;
        if (params.parallaxZ !== undefined) this.uParallaxZ.value = params.parallaxZ;

        // Decay the vortex strength so combo swirls fade out (~1.5s).
        const v = this.uVortex.value;
        if (v.z > 0.0001) {
            v.z = Math.max(0, v.z - delta * v.z * 0.9 - delta * 4.0);
        }
    }

    /** Inject a transient swirl into the snow (called on combos). */
    addVortex(x, y, strength, radius = 260) {
        const v = this.uVortex.value;
        // Keep the stronger of the current / incoming vortex.
        if (strength >= v.z) {
            v.set(x, y, strength, radius);
        }
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getPositionData() {
        return this.positionData;
    }

    getVelocityData() {
        return this.velocityData;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.positionData = null;
        this.velocityData = null;
    }
}

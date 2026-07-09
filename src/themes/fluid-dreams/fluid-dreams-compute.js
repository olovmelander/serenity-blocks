/**
 * Fluid Dreams Theme - GPU Compute (WebGPU path)
 *
 * Curl-noise advected ambient particles, fully GPU-resident.
 * No JS-side per-frame buffer rewrites — all physics happen on device.
 */

import * as THREE from 'three/webgpu';
import {
    cos,
    float,
    Fn,
    fract,
    If,
    instanceIndex,
    length,
    max,
    min,
    mix,
    mx_noise_float,
    normalize,
    sin,
    smoothstep,
    step,
    storage,
    uniform,
    vec3,
} from 'three/tsl';

import { ELECTRIC_PALETTE } from './fluid-dreams-materials.js';

// 3D curl from three noise gradients — divergence-free flow field.
const curlField = Fn(([p]) => {
    const e = float(0.1);
    const dx = vec3(e, float(0.0), float(0.0));
    const dy = vec3(float(0.0), e, float(0.0));
    const dz = vec3(float(0.0), float(0.0), e);

    const x0 = mx_noise_float(p.sub(dx));
    const x1 = mx_noise_float(p.add(dx));
    const y0 = mx_noise_float(p.sub(dy));
    const y1 = mx_noise_float(p.add(dy));
    const z0 = mx_noise_float(p.sub(dz));
    const z1 = mx_noise_float(p.add(dz));

    return vec3(
        y1.sub(y0).sub(z1.sub(z0)),
        z1.sub(z0).sub(x1.sub(x0)),
        x1.sub(x0).sub(y1.sub(y0)),
    ).div(e.mul(2.0));
});

const hashSeed = Fn(([seed]) => fract(sin(seed.mul(12.9898)).mul(43758.5453)));

export class FluidDreamsParticleCompute {
    constructor(particleCount, options = {}) {
        this.count = Math.max(1, Math.floor(particleCount));
        this.boundsRadius = options.boundsRadius ?? 55.0;
        this.spawnInner = options.spawnInner ?? 14.0;
        this.spawnOuter = options.spawnOuter ?? 48.0;

        // Buffer layout: position (xyz + life), velocity (xyz + spare), color (rgb + sprite size).
        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.colorData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uFlowStrength = uniform(options.flowStrength ?? 1.4);
        this.uDamping = uniform(options.damping ?? 0.94);
        this.uVelocityBoost = uniform(0);
        this.uBoundsRadius = uniform(this.boundsRadius);
        // Combo-hum attract field: pulls particles toward a moving focal point.
        // uAttractStrength > 0 creates an inward swirl that intensifies with combo.
        this.uAttractCenter = uniform(new THREE.Vector3(0, 0, 0));
        this.uAttractStrength = uniform(0);

        this._initRandomSpawn();
        this.computeNode = null;
    }

    _initRandomSpawn() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const u = Math.random();
            const v = Math.random();
            const theta = u * Math.PI * 2;
            const phi = Math.acos(2 * v - 1);
            const r = this.spawnInner + Math.random() * (this.spawnOuter - this.spawnInner);
            const sinPhi = Math.sin(phi);

            this.positionData[i4] = r * sinPhi * Math.cos(theta);
            this.positionData[i4 + 1] = r * sinPhi * Math.sin(theta);
            this.positionData[i4 + 2] = r * Math.cos(phi);
            this.positionData[i4 + 3] = Math.random(); // initial life

            this.velocityData[i4] = (Math.random() - 0.5) * 0.2;
            this.velocityData[i4 + 1] = (Math.random() - 0.5) * 0.2;
            this.velocityData[i4 + 2] = (Math.random() - 0.5) * 0.2;
            this.velocityData[i4 + 3] = Math.random(); // per-particle seed

            // Initial color sampled from the electric palette.
            const t = Math.random();
            const color = this._samplePaletteJS(t);
            this.colorData[i4] = color.x;
            this.colorData[i4 + 1] = color.y;
            this.colorData[i4 + 2] = color.z;
            this.colorData[i4 + 3] = 3.5 + Math.random() * 5.0; // sprite size (pixels)
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    _samplePaletteJS(t) {
        const stops = [
            ELECTRIC_PALETTE.neonPink,
            ELECTRIC_PALETTE.electricViolet,
            ELECTRIC_PALETTE.electricCyan,
            ELECTRIC_PALETTE.electricViolet,
            ELECTRIC_PALETTE.warmGold,
        ];
        const scaled = t * (stops.length - 1);
        const i = Math.floor(scaled);
        const f = scaled - i;
        const a = stops[i];
        const b = stops[Math.min(stops.length - 1, i + 1)];
        return {
            x: a.x + (b.x - a.x) * f,
            y: a.y + (b.y - a.y) * f,
            z: a.z + (b.z - a.z) * f,
        };
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const colors = storage(this.colorBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const time = this.uTime;
        const flowStrength = this.uFlowStrength;
        const damping = this.uDamping;
        const velocityBoost = this.uVelocityBoost;
        const boundsRadius = this.uBoundsRadius;
        const attractCenter = this.uAttractCenter;
        const attractStrength = this.uAttractStrength;

        // Palette colors as constants the compute kernel can mix.
        const pNeonPink = vec3(ELECTRIC_PALETTE.neonPink.x, ELECTRIC_PALETTE.neonPink.y, ELECTRIC_PALETTE.neonPink.z);
        const pViolet = vec3(ELECTRIC_PALETTE.electricViolet.x, ELECTRIC_PALETTE.electricViolet.y, ELECTRIC_PALETTE.electricViolet.z);
        const pCyan = vec3(ELECTRIC_PALETTE.electricCyan.x, ELECTRIC_PALETTE.electricCyan.y, ELECTRIC_PALETTE.electricCyan.z);
        const pGold = vec3(ELECTRIC_PALETTE.warmGold.x, ELECTRIC_PALETTE.warmGold.y, ELECTRIC_PALETTE.warmGold.z);

        const compute = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const col = colors.element(index).toVar();

            // Curl-noise force in a slowly drifting flow field.
            const samplePos = pos.xyz.mul(0.08).add(vec3(0.0, time.mul(0.06), 0.0));
            const force = curlField(samplePos).mul(flowStrength).mul(float(1.0).add(velocityBoost));

            vel.x.assign(vel.x.mul(damping).add(force.x.mul(delta)));
            vel.y.assign(vel.y.mul(damping).add(force.y.mul(delta)));
            vel.z.assign(vel.z.mul(damping).add(force.z.mul(delta)));

            // Soft inward bias when far from origin so the field stays composed.
            const dist = length(pos.xyz);
            const radialFalloff = smoothstep(boundsRadius.mul(0.55), boundsRadius, dist);
            const inward = normalize(pos.xyz).mul(radialFalloff).mul(0.6);
            vel.x.subAssign(inward.x.mul(delta));
            vel.y.subAssign(inward.y.mul(delta));
            vel.z.subAssign(inward.z.mul(delta));

            // Combo-hum attract field — particles drawn toward the focal point.
            // No-op when uAttractStrength = 0, so calm gameplay pays nothing extra.
            const toAttract = attractCenter.sub(pos.xyz);
            const attractDist = max(length(toAttract), float(0.5));
            const attractDir = toAttract.div(attractDist);
            // Slight 1/r falloff so far particles get pulled less strongly than near ones.
            const falloff = float(1.0).div(attractDist.mul(0.08).add(float(1.0)));
            const attractAccel = attractDir.mul(attractStrength).mul(falloff).mul(delta).mul(3.0);
            vel.x.addAssign(attractAccel.x);
            vel.y.addAssign(attractAccel.y);
            vel.z.addAssign(attractAccel.z);

            // Integrate position.
            pos.x.addAssign(vel.x.mul(delta).mul(8.0));
            pos.y.addAssign(vel.y.mul(delta).mul(8.0));
            pos.z.addAssign(vel.z.mul(delta).mul(8.0));

            // Life advances slowly; respawn out-of-bounds OR dead particles.
            pos.w.assign(pos.w.add(delta.mul(0.08)));
            const distAfter = length(pos.xyz);
            const outOfBounds = step(boundsRadius, distAfter);
            const dead = step(float(1.0), pos.w);
            const respawn = max(outOfBounds, dead);

            If(respawn.greaterThan(0.5), () => {
                const seed = float(index).mul(0.137).add(time.mul(0.19));
                const r1 = hashSeed(seed);
                const r2 = hashSeed(seed.add(1.7));
                const r3 = hashSeed(seed.add(3.3));
                const r4 = hashSeed(seed.add(5.5));

                const theta = r1.mul(6.28318);
                const phiRaw = r2.mul(2.0).sub(1.0);
                const phi = phiRaw.mul(1.5707);
                const r = float(14.0).add(r3.mul(34.0));

                const sinP = cos(phi); // since phi is asin-style, cos drives ring radius
                pos.x.assign(r.mul(sinP).mul(cos(theta)));
                pos.y.assign(r.mul(sin(phi)));
                pos.z.assign(r.mul(sinP).mul(sin(theta)));
                pos.w.assign(0.0);

                vel.x.assign(r4.sub(0.5).mul(0.4));
                vel.y.assign(r1.sub(0.5).mul(0.4));
                vel.z.assign(r2.sub(0.5).mul(0.4));

                // New colour from the electric palette by spawn-seed.
                const t = r3;
                const violetCyan = mix(pViolet, pCyan, smoothstep(float(0.0), float(0.5), t));
                const cyanGold = mix(violetCyan, pGold, smoothstep(float(0.5), float(0.8), t));
                const finalCol = mix(cyanGold, pNeonPink, smoothstep(float(0.8), float(1.0), t));
                col.x.assign(finalCol.x);
                col.y.assign(finalCol.y);
                col.z.assign(finalCol.z);
                col.w.assign(float(3.5).add(r4.mul(5.0))); // sprite size (pixels)
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            colors.element(index).assign(col);
        });

        this.computeNode = compute().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = clampNumber(delta, 0, 0.1);
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.flowStrength !== undefined) this.uFlowStrength.value = params.flowStrength;
        if (params.damping !== undefined) this.uDamping.value = params.damping;
        if (params.velocityBoost !== undefined) this.uVelocityBoost.value = params.velocityBoost;
        if (params.attractCenter) this.uAttractCenter.value.copy(params.attractCenter);
        if (params.attractStrength !== undefined) this.uAttractStrength.value = params.attractStrength;
    }

    getPositionBuffer() { return this.positionBuffer; }

    getVelocityBuffer() { return this.velocityBuffer; }

    getColorBuffer() { return this.colorBuffer; }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.colorBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.colorData = null;
    }
}

function clampNumber(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
}

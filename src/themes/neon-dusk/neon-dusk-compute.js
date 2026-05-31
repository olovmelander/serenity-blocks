/**
 * Neon Dusk Theme - GPU Compute Shaders
 * WebGPU compute shaders for particles, highlights, retro pixels, and star twinkle.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    storage,
    uniform,
    instanceIndex,
    float,
    max,
    step,
    mix,
    length,
    sin,
    cos,
    If,
    fract,
} from 'three/tsl';

// ---------------------------------------------------------------------------
// Burst / General Particle Compute
// ---------------------------------------------------------------------------

export class NeonDuskParticleCompute {
    constructor(particleCount, params = {}) {
        this.count = particleCount;

        // State buffer: vec4 * 3 per particle
        // [0]: position.xyz, life
        // [1]: velocity.xyz, maxLife
        // [2]: size, type, reserved, reserved
        this.stateData = new Float32Array(particleCount * 12);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        // Color buffer: vec4 per particle (r, g, b, unused)
        this.colorData = new Float32Array(particleCount * 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uGravity = uniform(params.gravity ?? 20.0);
        this.uSquareDamping = uniform(params.squareDamping ?? 0.98);

        this.computeNode = null;
    }

    reset() {
        this.stateData.fill(0);
        this.colorData.fill(0);
        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count * 3);
        const delta = this.uDelta;
        const gravity = this.uGravity;
        const squareDamping = this.uSquareDamping;

        const computeParticles = Fn(() => {
            const index = instanceIndex;
            const base = index.mul(3);
            const pos = state.element(base).toVar();
            const vel = state.element(base.add(1)).toVar();
            const misc = state.element(base.add(2)).toVar();

            const life = pos.w;
            const maxLife = max(vel.w, float(0.0001));
            const active = life.greaterThan(0.0);

            If(active, () => {
                pos.x.addAssign(vel.x.mul(delta));
                pos.y.addAssign(vel.y.mul(delta));
                pos.z.addAssign(vel.z.mul(delta));

                const type = misc.y;
                const squareFactor = step(float(1.5), type);
                const gravityScale = float(1.0).sub(squareFactor);
                const damping = mix(float(1.0), squareDamping, squareFactor);

                vel.y.assign(vel.y.mul(damping));
                vel.y.subAssign(gravity.mul(delta).mul(gravityScale));

                pos.w.assign(pos.w.sub(delta.div(maxLife)));
                If(pos.w.lessThanEqual(0.0), () => {
                    pos.w.assign(0.0);
                });
            });

            state.element(base).assign(pos);
            state.element(base.add(1)).assign(vel);
            state.element(base.add(2)).assign(misc);
        });

        this.computeNode = computeParticles().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = delta;
        if (params.gravity !== undefined) {
            this.uGravity.value = params.gravity;
        }
        if (params.squareDamping !== undefined) {
            this.uSquareDamping.value = params.squareDamping;
        }
    }

    spawn(index, particle) {
        if (index < 0 || index >= this.count) return;
        const base = index * 12;
        this.stateData[base] = particle.x;
        this.stateData[base + 1] = particle.y;
        this.stateData[base + 2] = particle.z;
        this.stateData[base + 3] = particle.life;
        this.stateData[base + 4] = particle.vx;
        this.stateData[base + 5] = particle.vy;
        this.stateData[base + 6] = particle.vz;
        this.stateData[base + 7] = particle.maxLife;
        this.stateData[base + 8] = particle.size;
        this.stateData[base + 9] = particle.type;

        const cBase = index * 4;
        this.colorData[cBase] = particle.color.r;
        this.colorData[cBase + 1] = particle.color.g;
        this.colorData[cBase + 2] = particle.color.b;
        this.colorData[cBase + 3] = 1.0;

        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.colorBuffer = null;
        this.stateData = null;
        this.colorData = null;
    }
}

// ---------------------------------------------------------------------------
// Retro Pixel Compute (floating squares)
// ---------------------------------------------------------------------------

export class NeonDuskPixelCompute {
    constructor(pixelCount, params = {}) {
        this.count = pixelCount;

        // State buffer: vec4 * 3 per pixel
        // [0]: position.xyz, life
        // [1]: velocity.xyz, baseX
        // [2]: size, type, baseZ, baseY
        this.stateData = new Float32Array(pixelCount * 12);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        // Color buffer: vec4 per pixel (r, g, b, unused)
        this.colorData = new Float32Array(pixelCount * 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uSun = uniform(new THREE.Vector3());
        this.uAttraction = uniform(params.attraction ?? 0.0);
        this.uDrag = uniform(params.drag ?? 0.98);
        this.uMaxY = uniform(params.maxY ?? 150.0);
        this.uMinY = uniform(params.minY ?? 0.0);

        this.computeNode = null;
    }

    reset() {
        this.stateData.fill(0);
        this.colorData.fill(0);
        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count * 3);
        const delta = this.uDelta;
        const time = this.uTime;
        const sun = this.uSun;
        const attraction = this.uAttraction;
        const drag = this.uDrag;
        const maxY = this.uMaxY;
        const minY = this.uMinY;

        const computePixels = Fn(() => {
            const index = instanceIndex;
            const base = index.mul(3);
            const pos = state.element(base).toVar();
            const vel = state.element(base.add(1)).toVar();
            const misc = state.element(base.add(2)).toVar();

            const toSun = sun.sub(pos.xyz);
            const dist = max(length(toSun), float(1.0));
            const pull = toSun.div(dist).mul(attraction);

            vel.x.addAssign(pull.x.mul(delta));
            vel.y.addAssign(pull.y.mul(delta));
            vel.z.addAssign(pull.z.mul(delta));

            vel.x.assign(vel.x.mul(drag));
            vel.y.assign(vel.y.mul(drag));
            vel.z.assign(vel.z.mul(drag));

            pos.x.addAssign(vel.x.mul(delta));
            pos.y.addAssign(vel.y.mul(delta));
            pos.z.addAssign(vel.z.mul(delta));

            const phase = float(index).mul(10.0);
            const lifePulse = sin(time.mul(2.0).add(phase)).mul(0.5).add(0.5);
            pos.w.assign(lifePulse);

            const outOfBounds = pos.y.greaterThan(maxY);
            If(outOfBounds, () => {
                pos.x.assign(vel.w);
                pos.y.assign(max(minY, misc.w));
                pos.z.assign(misc.z);
            });

            state.element(base).assign(pos);
        });

        this.computeNode = computePixels().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = delta;
        if (params.time !== undefined) {
            this.uTime.value = params.time;
        }
        if (params.sun !== undefined) {
            this.uSun.value.copy(params.sun);
        }
        if (params.attraction !== undefined) {
            this.uAttraction.value = params.attraction;
        }
        if (params.drag !== undefined) {
            this.uDrag.value = params.drag;
        }
        if (params.maxY !== undefined) {
            this.uMaxY.value = params.maxY;
        }
        if (params.minY !== undefined) {
            this.uMinY.value = params.minY;
        }
    }

    spawn(index, pixel) {
        if (index < 0 || index >= this.count) return;
        const base = index * 12;
        this.stateData[base] = pixel.x;
        this.stateData[base + 1] = pixel.y;
        this.stateData[base + 2] = pixel.z;
        this.stateData[base + 3] = pixel.life;
        this.stateData[base + 4] = pixel.vx;
        this.stateData[base + 5] = pixel.vy;
        this.stateData[base + 6] = pixel.vz;
        this.stateData[base + 7] = pixel.x;
        this.stateData[base + 8] = pixel.size;
        this.stateData[base + 9] = pixel.type ?? 2.0;
        this.stateData[base + 10] = pixel.z;
        this.stateData[base + 11] = pixel.y;

        const cBase = index * 4;
        this.colorData[cBase] = pixel.color.r;
        this.colorData[cBase + 1] = pixel.color.g;
        this.colorData[cBase + 2] = pixel.color.b;
        this.colorData[cBase + 3] = 1.0;

        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.colorBuffer = null;
        this.stateData = null;
        this.colorData = null;
    }
}

// ---------------------------------------------------------------------------
// Highlight Compute
// ---------------------------------------------------------------------------

export class NeonDuskHighlightCompute {
    constructor(highlightCount, params = {}) {
        this.count = highlightCount;

        // State buffer: vec4 per highlight (x, y, z, intensity)
        this.stateData = new Float32Array(highlightCount * 4);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        // Color buffer: vec4 per highlight (r, g, b, phase)
        this.colorData = new Float32Array(highlightCount * 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uScrollSpeed = uniform(params.scrollSpeed ?? 10.0);
        this.uMaxZ = uniform(params.maxZ ?? 300.0);

        this.computeNode = null;
    }

    reset() {
        this.stateData.fill(0);
        this.colorData.fill(0);
        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const speed = this.uScrollSpeed;
        const maxZ = this.uMaxZ;

        const computeHighlights = Fn(() => {
            const index = instanceIndex;
            const entry = state.element(index).toVar();
            const intensity = entry.w;
            const active = intensity.greaterThan(0.0);

            If(active, () => {
                entry.z.addAssign(speed.mul(delta));
                If(entry.z.greaterThan(maxZ), () => {
                    entry.w.assign(0.0);
                });
            });

            state.element(index).assign(entry);
        });

        this.computeNode = computeHighlights().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = delta;
        if (params.scrollSpeed !== undefined) {
            this.uScrollSpeed.value = params.scrollSpeed;
        }
        if (params.maxZ !== undefined) {
            this.uMaxZ.value = params.maxZ;
        }
    }

    spawn(index, data) {
        if (index < 0 || index >= this.count) return;
        const base = index * 4;
        this.stateData[base] = data.x;
        this.stateData[base + 1] = data.y;
        this.stateData[base + 2] = data.z;
        this.stateData[base + 3] = data.intensity;

        const cBase = index * 4;
        this.colorData[cBase] = data.color.r;
        this.colorData[cBase + 1] = data.color.g;
        this.colorData[cBase + 2] = data.color.b;
        this.colorData[cBase + 3] = data.phase ?? 0;

        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    deactivate(index) {
        if (index < 0 || index >= this.count) return;
        const base = index * 4;
        this.stateData[base + 3] = 0;
        this.stateBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.colorBuffer = null;
        this.stateData = null;
        this.colorData = null;
    }
}

// ---------------------------------------------------------------------------
// Star Twinkle Compute
// ---------------------------------------------------------------------------

export class NeonDuskStarCompute {
    constructor(starCount) {
        this.count = starCount;

        // State buffer: vec4 per star (phase, speed, brightness, size)
        this.stateData = new Float32Array(starCount * 4);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        this.uDelta = uniform(0);
        this.computeNode = null;
    }

    reset() {
        this.stateData.fill(0);
        this.stateBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const tau = float(6.283185);

        const computeStars = Fn(() => {
            const index = instanceIndex;
            const entry = state.element(index).toVar();
            entry.x.addAssign(entry.y.mul(delta));
            If(entry.x.greaterThan(tau), () => {
                entry.x.assign(entry.x.sub(tau));
            });
            state.element(index).assign(entry);
        });

        this.computeNode = computeStars().compute(this.count);
        return this.computeNode;
    }

    update(delta) {
        this.uDelta.value = delta;
    }

    setInitialData(twinkleData, brightnessData, sizeData) {
        for (let i = 0; i < this.count; i++) {
            const base = i * 4;
            const tBase = i * 2;
            this.stateData[base] = twinkleData[tBase] || 0;
            this.stateData[base + 1] = twinkleData[tBase + 1] || 0;
            this.stateData[base + 2] = brightnessData[i] ?? 0.5;
            this.stateData[base + 3] = sizeData[i] ?? 1.0;
        }
        this.stateBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.stateData = null;
    }
}

// ---------------------------------------------------------------------------
// Field Compute (ambient drift layers: dust motes, rising embers)
// ---------------------------------------------------------------------------
//
// A general-purpose drifting-particle field shared by the atmospheric layers.
// Each particle is advected by cheap curl-style turbulence, optional buoyancy
// (rising), and optional attraction toward the sun, then toroidally wrapped
// inside a bounding box so the field never depletes. Buffer layout matches the
// particle materials (vec4 * 3 per particle):
//   [0]: position.xyz, life
//   [1]: velocity.xyz, (reserved)
//   [2]: size, type, (reserved), (reserved)

export class NeonDuskFieldCompute {
    constructor(count, params = {}) {
        this.count = count;

        this.stateData = new Float32Array(count * 12);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        this.colorData = new Float32Array(count * 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uSun = uniform(new THREE.Vector3());
        this.uBuoyancy = uniform(params.buoyancy ?? 0.0);
        this.uSunPull = uniform(params.sunPull ?? 0.0);
        this.uDrag = uniform(params.drag ?? 0.985);
        this.uCurlAmp = uniform(params.curlAmp ?? 1.0);
        this.uCurlScale = uniform(params.curlScale ?? 0.012);
        this.uBounds = uniform(
            new THREE.Vector3(params.boundX ?? 400.0, params.maxY ?? 150.0, params.boundZ ?? 320.0),
        );
        this.uMinY = uniform(params.minY ?? 0.0);
        this.uCenterZ = uniform(params.centerZ ?? -250.0);

        this.computeNode = null;
    }

    reset() {
        this.stateData.fill(0);
        this.colorData.fill(0);
        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count * 3);
        const delta = this.uDelta;
        const time = this.uTime;
        const sun = this.uSun;
        const buoyancy = this.uBuoyancy;
        const sunPull = this.uSunPull;
        const drag = this.uDrag;
        const curlAmp = this.uCurlAmp;
        const curlScale = this.uCurlScale;
        const bounds = this.uBounds;
        const minY = this.uMinY;
        const centerZ = this.uCenterZ;

        const computeField = Fn(() => {
            const index = instanceIndex;
            const base = index.mul(3);
            const pos = state.element(base).toVar();
            const vel = state.element(base.add(1)).toVar();

            // Cheap divergence-light curl turbulence
            const cx = sin(pos.y.mul(curlScale).add(time)).sub(cos(pos.z.mul(curlScale).sub(time)));
            const cy = sin(pos.z.mul(curlScale).add(time.mul(0.7)));
            const cz = cos(pos.x.mul(curlScale).add(time)).sub(sin(pos.y.mul(curlScale).sub(time)));

            vel.x.addAssign(cx.mul(curlAmp).mul(delta));
            vel.y.addAssign(cy.mul(curlAmp).mul(delta).add(buoyancy.mul(delta)));
            vel.z.addAssign(cz.mul(curlAmp).mul(delta));

            // Gentle attraction toward the sun
            const toSun = sun.sub(pos.xyz);
            const dist = max(length(toSun), float(1.0));
            vel.x.addAssign(toSun.x.div(dist).mul(sunPull).mul(delta));
            vel.y.addAssign(toSun.y.div(dist).mul(sunPull).mul(delta));
            vel.z.addAssign(toSun.z.div(dist).mul(sunPull).mul(delta));

            vel.x.assign(vel.x.mul(drag));
            vel.y.assign(vel.y.mul(drag));
            vel.z.assign(vel.z.mul(drag));

            pos.x.addAssign(vel.x.mul(delta));
            pos.y.addAssign(vel.y.mul(delta));
            pos.z.addAssign(vel.z.mul(delta));

            // Toroidal box wrap so the field never depletes
            If(pos.y.greaterThan(bounds.y), () => { pos.y.assign(minY); });
            If(pos.y.lessThan(minY), () => { pos.y.assign(bounds.y); });
            If(pos.x.greaterThan(bounds.x), () => { pos.x.assign(bounds.x.negate()); });
            If(pos.x.lessThan(bounds.x.negate()), () => { pos.x.assign(bounds.x); });
            const zHi = centerZ.add(bounds.z);
            const zLo = centerZ.sub(bounds.z);
            If(pos.z.greaterThan(zHi), () => { pos.z.assign(zLo); });
            If(pos.z.lessThan(zLo), () => { pos.z.assign(zHi); });

            // Soft per-particle twinkle in [0.3, 1.0]
            const phase = float(index).mul(7.0);
            pos.w.assign(sin(time.mul(1.5).add(phase)).mul(0.35).add(0.65));

            state.element(base).assign(pos);
            state.element(base.add(1)).assign(vel);
        });

        this.computeNode = computeField().compute(this.count);
        return this.computeNode;
    }

    update(delta, params = {}) {
        this.uDelta.value = delta;
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.sun !== undefined) this.uSun.value.copy(params.sun);
        if (params.buoyancy !== undefined) this.uBuoyancy.value = params.buoyancy;
        if (params.sunPull !== undefined) this.uSunPull.value = params.sunPull;
        if (params.drag !== undefined) this.uDrag.value = params.drag;
        if (params.curlAmp !== undefined) this.uCurlAmp.value = params.curlAmp;
    }

    spawn(index, p) {
        if (index < 0 || index >= this.count) return;
        const base = index * 12;
        this.stateData[base] = p.x;
        this.stateData[base + 1] = p.y;
        this.stateData[base + 2] = p.z;
        this.stateData[base + 3] = p.life ?? 1.0;
        this.stateData[base + 4] = p.vx ?? 0;
        this.stateData[base + 5] = p.vy ?? 0;
        this.stateData[base + 6] = p.vz ?? 0;
        this.stateData[base + 8] = p.size ?? 1.0;
        this.stateData[base + 9] = p.type ?? 0.0;

        const cBase = index * 4;
        this.colorData[cBase] = p.color.r;
        this.colorData[cBase + 1] = p.color.g;
        this.colorData[cBase + 2] = p.color.b;
        this.colorData[cBase + 3] = 1.0;

        this.stateBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    getStateBuffer() {
        return this.stateBuffer;
    }

    getColorBuffer() {
        return this.colorBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.colorBuffer = null;
        this.stateData = null;
        this.colorData = null;
    }
}

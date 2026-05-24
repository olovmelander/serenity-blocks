/**
 * Shifting Sands Theme - GPU Compute Shaders
 * WebGPU compute shaders for sandworm trail and particle simulation
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
    vec4,
    sin,
    cos,
    fract,
    floor,
    mod,
    abs,
    exp,
    clamp,
    step,
    smoothstep,
    max,
    pow,
    dot,
    mix,
    If,
} from 'three/tsl';

// ============== TSL TERRAIN HEIGHT APPROXIMATION ==============
// Matches the CPU PerlinNoise terrain in the theme (simplified 2-octave FBM)

// ============== TSL NOISE FUNCTIONS (Matched with Materials) ==============

const tslHash3 = /* @__PURE__ */ Fn(([p_immutable]) => {
    const p = vec3(p_immutable).toVar();
    p.assign(vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6))
    ));
    return fract(sin(p).mul(43758.5453)).mul(2.0).sub(1.0);
});

const tslNoise3D = /* @__PURE__ */ Fn(([p_immutable]) => {
    const p = vec3(p_immutable).toVar();
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const n000 = dot(tslHash3(i.add(vec3(0, 0, 0))), f.sub(vec3(0, 0, 0)));
    const n100 = dot(tslHash3(i.add(vec3(1, 0, 0))), f.sub(vec3(1, 0, 0)));
    const n010 = dot(tslHash3(i.add(vec3(0, 1, 0))), f.sub(vec3(0, 1, 0)));
    const n110 = dot(tslHash3(i.add(vec3(1, 1, 0))), f.sub(vec3(1, 1, 0)));
    const n001 = dot(tslHash3(i.add(vec3(0, 0, 1))), f.sub(vec3(0, 0, 1)));
    const n101 = dot(tslHash3(i.add(vec3(1, 0, 1))), f.sub(vec3(1, 0, 1)));
    const n011 = dot(tslHash3(i.add(vec3(0, 1, 1))), f.sub(vec3(0, 1, 1)));
    const n111 = dot(tslHash3(i.add(vec3(1, 1, 1))), f.sub(vec3(1, 1, 1)));

    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z
    );
});

const tslHash2D = /* @__PURE__ */ Fn(([p_immutable]) => {
    const p = vec2(p_immutable).toVar();
    const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
});

const tslSmoothNoise2D = /* @__PURE__ */ Fn(([p_immutable]) => {
    const p = vec2(p_immutable).toVar();
    const i = floor(p);
    const f = fract(p).toVar();
    f.assign(f.mul(f).mul(float(3.0).sub(f.mul(2.0))));

    const a = tslHash2D(i);
    const b = tslHash2D(i.add(vec2(1.0, 0.0)));
    const c = tslHash2D(i.add(vec2(0.0, 1.0)));
    const d = tslHash2D(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
});

const tslApproxTerrainHeight = /* @__PURE__ */ Fn(([x, z]) => {
    const dir = float(0.628); // PI * 0.2 (dune direction)
    const cosDir = cos(dir);
    const sinDir = sin(dir);
    const rx = x.mul(cosDir).add(z.mul(sinDir));
    const rz = x.mul(sinDir).negate().add(z.mul(cosDir));

    // Primary dunes — 2-octave FBM with ridge shaping
    const duneCoord = vec2(rx.mul(0.003), rz.mul(0.003));
    const fbm = tslSmoothNoise2D(duneCoord).mul(0.6)
        .add(tslSmoothNoise2D(duneCoord.mul(2.0)).mul(0.4));
    const h = abs(fbm.mul(2.0).sub(1.0)).mul(45.0);

    // Secondary rolling hills
    const h2 = tslSmoothNoise2D(vec2(x.mul(0.012), z.mul(0.012).add(100.0))).mul(15.0);

    // Asymmetric windward factor
    const windward = sin(rx.mul(0.02)).mul(0.3).add(0.7);

    return h.add(h2).mul(windward).sub(20.0);
});

/**
 * Compute shader for sandworm trail calculation
 * Outputs worm head position and path parameters to a storage buffer
 * This buffer is shared between dune and smoke shaders to avoid duplicate calculations
 */
export class WormTrailCompute {
    constructor() {
        // Worm state buffer - stores current worm position and path
        // Layout: 2x vec4
        // [0]: headX, headZ, pathBaseX, pathSlope
        // [1]: cycleHash, horizonFade, distFromHead, 0
        this.wormStateData = new Float32Array(8);
        this.wormStateBuffer = new THREE.StorageBufferAttribute(this.wormStateData, 4);

        // Uniforms
        this.uTime = uniform(0);

        // Worm movement parameters
        this.wormSpeed = 30.0;
        this.wormCycleLength = 2000.0;

        // Compute node (created lazily)
        this.computeNode = null;

        // CPU fallback values (for WebGL backend)
        this.cpuState = {
            headX: 0,
            headZ: 0,
            pathBaseX: 0,
            pathSlope: 0,
            cycleHash: 0,
            horizonFade: 0,
        };
    }

    /**
     * Create the compute node for GPU execution
     * Only call this on WebGPU backend
     */
    createComputeNode() {
        const wormState = storage(this.wormStateBuffer, 'vec4', 2);
        const time = this.uTime;
        const wormSpeed = float(this.wormSpeed);
        const wormCycleLength = float(this.wormCycleLength);

        const computeWormPosition = Fn(() => {
            // Worm cycle calculation
            const wormCycleTime = wormCycleLength.div(wormSpeed);
            const currentCycle = floor(time.div(wormCycleTime));
            const wormHeadZ = mod(time.mul(wormSpeed), wormCycleLength).sub(1000.0);

            // Pseudo-random path variation per cycle (deterministic based on cycle number)
            const cycleHash = fract(sin(currentCycle.mul(12.9898)).mul(43758.5453));
            const cycleHash2 = fract(sin(currentCycle.mul(78.233).add(1.0)).mul(43758.5453));

            // Calculate worm path - varies each cycle for natural movement
            const wormPathBaseX = cycleHash.sub(0.5).mul(200.0);
            const wormPathSlope = cycleHash2.sub(0.5).mul(0.6);
            const wormHeadX = wormPathBaseX.add(wormHeadZ.mul(wormPathSlope));

            // Horizon fade-in to prevent pop-in when worm appears
            const distFromStart = wormHeadZ.add(1000.0);
            const horizonFade = pow(smoothstep(0.0, 1200.0, distFromStart), 5.0);

            // Write to storage buffer
            // vec4(headX, headZ, pathBaseX, pathSlope)
            wormState.element(0).assign(vec4(wormHeadX, wormHeadZ, wormPathBaseX, wormPathSlope));
            // vec4(cycleHash, horizonFade, 0, 0) - extra slots for future use
            wormState.element(1).assign(vec4(cycleHash, horizonFade, 0.0, 0.0));
        });

        // Create compute node with 1 invocation (single worm calculation)
        this.computeNode = computeWormPosition().compute(1);
        return this.computeNode;
    }

    /**
     * Update worm position on CPU (for WebGL fallback)
     * Mirrors the GPU compute shader logic exactly
     */
    updateCPU(time) {
        const wormCycleTime = this.wormCycleLength / this.wormSpeed;
        const currentCycle = Math.floor(time / wormCycleTime);
        const wormHeadZ = (time * this.wormSpeed % this.wormCycleLength) - 1000.0;

        // Pseudo-random path variation per cycle
        const cycleHash = this.fract(Math.sin(currentCycle * 12.9898) * 43758.5453);
        const cycleHash2 = this.fract(Math.sin(currentCycle * 78.233 + 1.0) * 43758.5453);

        const wormPathBaseX = (cycleHash - 0.5) * 200.0;
        const wormPathSlope = (cycleHash2 - 0.5) * 0.6;
        const wormHeadX = wormPathBaseX + wormHeadZ * wormPathSlope;

        // Horizon fade-in
        const distFromStart = wormHeadZ + 1000.0;
        const horizonFade = Math.pow(this.smoothstep(0.0, 1200.0, distFromStart), 5.0);

        // Store CPU state for uniform access
        this.cpuState = {
            headX: wormHeadX,
            headZ: wormHeadZ,
            pathBaseX: wormPathBaseX,
            pathSlope: wormPathSlope,
            cycleHash: cycleHash,
            horizonFade: horizonFade,
        };

        // Also update the buffer for consistency
        this.wormStateData[0] = wormHeadX;
        this.wormStateData[1] = wormHeadZ;
        this.wormStateData[2] = wormPathBaseX;
        this.wormStateData[3] = wormPathSlope;
        this.wormStateData[4] = cycleHash;
        this.wormStateData[5] = horizonFade;
        this.wormStateData[6] = 0;
        this.wormStateData[7] = 0;

        return this.cpuState;
    }

    // Helper: GLSL-style fract
    fract(x) {
        return x - Math.floor(x);
    }

    // Helper: GLSL-style smoothstep
    smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    /**
     * Update time uniform (for GPU path)
     */
    update(time) {
        this.uTime.value = time;
    }

    /**
     * Get the worm state storage buffer for use in other shaders
     */
    getWormStateBuffer() {
        return this.wormStateBuffer;
    }

    /**
     * Get CPU state values (for WebGL fallback uniforms)
     */
    getCPUState() {
        return this.cpuState;
    }

    /**
     * Get uniforms for passing to materials (WebGL fallback)
     */
    getUniforms() {
        return {
            uWormHeadX: uniform(this.cpuState.headX),
            uWormHeadZ: uniform(this.cpuState.headZ),
            uWormPathBaseX: uniform(this.cpuState.pathBaseX),
            uWormPathSlope: uniform(this.cpuState.pathSlope),
            uWormCycleHash: uniform(this.cpuState.cycleHash),
            uWormHorizonFade: uniform(this.cpuState.horizonFade),
        };
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.computeNode = null;
        this.wormStateBuffer = null;
        this.wormStateData = null;
    }
}

/**
 * GPU-driven spice particle simulation
 * Replaces CPU-bound particle updates with compute shader
 * NOTE: This will be implemented in Phase 4
 */
export class SpiceParticleCompute {
    constructor(particleCount) {
        this.count = particleCount;

        // Position buffer (vec4: x, y, z, life)
        this.positionData = new Float32Array(particleCount * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        // Velocity buffer (vec4: vx, vy, vz, phase)
        this.velocityData = new Float32Array(particleCount * 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);

        this.uTime = uniform(0);
        this.uWindStrength = uniform(0.5);
        this.uSpiceIntensity = uniform(1.0);

        this.computeNode = null;

        this.initializeParticles();
    }

    /**
     * Initialize particle positions and velocities
     */
    initializeParticles() {
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;

            // Random position in desert area
            this.positionData[i4] = (Math.random() - 0.5) * 600;      // x
            this.positionData[i4 + 1] = Math.random() * 80 - 10;      // y
            this.positionData[i4 + 2] = (Math.random() - 0.5) * 600;  // z
            this.positionData[i4 + 3] = Math.random();                 // life (0-1)

            // Random phase for variation
            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = Math.random() * Math.PI * 2; // phase
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
    }

    /**
     * Create compute node for GPU execution
     */
    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const time = this.uTime;
        const wind = this.uWindStrength;

        const computeSpice = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();

            const phase = vel.w;

            // Swirling motion using sine waves
            const t = time.mul(0.15).add(phase.mul(10.0));

            const swirl1 = sin(t.mul(1.2).add(pos.y.mul(0.05))).mul(20.0).mul(wind);
            const swirl2 = cos(t.mul(0.9).add(pos.x.mul(0.03))).mul(15.0).mul(wind);
            const swirl3 = sin(t.mul(0.7).add(pos.z.mul(0.04))).mul(10.0).mul(wind);

            // Update position with delta time approximation (0.016 = 60fps)
            pos.x.addAssign(swirl1.mul(0.016));
            pos.z.addAssign(swirl2.mul(0.016));
            pos.y.addAssign(swirl3.mul(0.016));

            // General wind drift
            pos.x.addAssign(sin(time.mul(0.3)).mul(0.16));
            pos.z.addAssign(cos(time.mul(0.2)).mul(0.08));

            // Vertical rise
            pos.y.addAssign(sin(t.mul(2.0).add(phase.mul(6.28))).mul(0.08));

            // Respawn if out of bounds
            const outOfBounds = pos.y.greaterThan(80.0)
                .or(pos.y.lessThan(-20.0))
                .or(abs(pos.x).greaterThan(350.0))
                .or(abs(pos.z).greaterThan(350.0));

            If(outOfBounds, () => {
                // Pseudo-random respawn position based on index
                pos.x.assign(fract(sin(float(index).mul(12.9898)).mul(43758.5453)).sub(0.5).mul(600.0));
                pos.y.assign(fract(sin(float(index).mul(78.233)).mul(43758.5453)).mul(60.0).sub(10.0));
                pos.z.assign(fract(sin(float(index).mul(45.164)).mul(43758.5453)).sub(0.5).mul(600.0));
            });

            // Write back
            positions.element(index).assign(pos);
        });

        this.computeNode = computeSpice().compute(this.count);
        return this.computeNode;
    }

    /**
     * Update uniforms (for GPU compute path)
     */
    update(time, windStrength, spiceIntensity) {
        this.uTime.value = time;
        if (windStrength !== undefined) this.uWindStrength.value = windStrength;
        if (spiceIntensity !== undefined) this.uSpiceIntensity.value = spiceIntensity;
    }

    /**
     * CPU fallback update for WebGL backend
     * Mirrors the GPU compute logic
     */
    updateCPU(time, windStrength, spiceIntensity) {
        const wind = windStrength ?? 0.5;

        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;
            let x = this.positionData[i4];
            let y = this.positionData[i4 + 1];
            let z = this.positionData[i4 + 2];
            const phase = this.velocityData[i4 + 3];

            // Swirling motion using sine waves
            const t = time * 0.15 + phase * 10.0;

            const swirl1 = Math.sin(t * 1.2 + y * 0.05) * 20.0 * wind;
            const swirl2 = Math.cos(t * 0.9 + x * 0.03) * 15.0 * wind;
            const swirl3 = Math.sin(t * 0.7 + z * 0.04) * 10.0 * wind;

            // Update position with delta time approximation
            x += swirl1 * 0.016;
            z += swirl2 * 0.016;
            y += swirl3 * 0.016;

            // General wind drift
            x += Math.sin(time * 0.3) * 0.16;
            z += Math.cos(time * 0.2) * 0.08;

            // Vertical rise
            y += Math.sin(t * 2.0 + phase * 6.28) * 0.08;

            // Respawn if out of bounds
            if (y > 80.0 || y < -20.0 || Math.abs(x) > 350.0 || Math.abs(z) > 350.0) {
                x = (this.fract(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 600.0;
                y = this.fract(Math.sin(i * 78.233) * 43758.5453) * 60.0 - 10.0;
                z = (this.fract(Math.sin(i * 45.164) * 43758.5453) - 0.5) * 600.0;
            }

            this.positionData[i4] = x;
            this.positionData[i4 + 1] = y;
            this.positionData[i4 + 2] = z;
        }

        this.positionBuffer.needsUpdate = true;
    }

    // Helper: GLSL-style fract
    fract(x) {
        return x - Math.floor(x);
    }

    /**
     * Get position buffer for rendering
     */
    getPositionBuffer() {
        return this.positionBuffer;
    }

    /**
     * Get velocity buffer (contains phases)
     */
    getVelocityBuffer() {
        return this.velocityBuffer;
    }

    /**
     * Get position data array for CPU-based rendering
     */
    getPositionData() {
        return this.positionData;
    }

    /**
     * Get velocity data array (for phases)
     */
    getVelocityData() {
        return this.velocityData;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.positionData = null;
        this.velocityData = null;
    }
}

/**
 * Enhanced sand smoke with GPU compute simulation
 * Features: Physics-based particle system with emission, advection, and drag
 * Fixed: Now emits from the worm head and flows naturally
 */
export class SandSmokeCompute {
    constructor(particleCount, wormTrailCompute, options = {}) {
        this.count = particleCount;
        this.wormTrail = wormTrailCompute;

        // Particle state buffer (2x vec4 per particle)
        // [0]: x, y, z, life (life = 0..1, 0 = dead)
        // [1]: vx, vy, vz, rand (velocity + stable random)
        this.stateData = new Float32Array(particleCount * 8);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        this.uTime = uniform(0);
        this.uWindStrength = uniform(0.5);
        this.leadScale = options.leadScale ?? 1.0;
        this.uLeadScale = uniform(this.leadScale);

        this.computeNode = null;

        this.initializeParticles();
    }

    /**
     * Initialize smoke particle positions
     */
    initializeParticles() {
        for (let i = 0; i < this.count; i++) {
            const i8 = i * 8;

            // Start dead to stagger emission
            this.stateData[i8] = 0;      // x
            this.stateData[i8 + 1] = -100; // y (underground)
            this.stateData[i8 + 2] = 0;   // z

            // Stagger startup over a short window to avoid a single-frame emission spike.
            this.stateData[i8 + 3] = -Math.random() * 8.0; // life (negative = delay)

            // Velocity & Props
            this.stateData[i8 + 4] = 0; // vx
            this.stateData[i8 + 5] = 0; // vy
            this.stateData[i8 + 6] = 0; // vz
            this.stateData[i8 + 7] = Math.random(); // rand (stable ID)
        }

        this.stateBuffer.needsUpdate = true;
    }

    /**
     * Create compute node - integrates with worm trail buffer
     */
    createComputeNode() {
        if (!this.wormTrail) {
            console.warn('[SandSmokeCompute] WormTrailCompute not provided');
            return null;
        }

        const state = storage(this.stateBuffer, 'vec4', this.count * 2);
        const wormState = storage(this.wormTrail.getWormStateBuffer(), 'vec4', 2);
        const time = this.uTime;
        const wind = this.uWindStrength;
        const leadScale = this.uLeadScale;

        const computeSmoke = Fn(() => {
            const index = instanceIndex;
            const stateIdx0 = index.mul(2);
            const stateIdx1 = index.mul(2).add(1);

            const posLife = state.element(stateIdx0).toVar();
            const velRand = state.element(stateIdx1).toVar();

            const life = posLife.w;
            const dt = float(0.016);

            const wormHead = wormState.element(0);
            const wormHeadX = wormHead.x;
            const wormHeadZ = wormHead.y;
            const wormPathBaseX = wormHead.z;
            const wormPathSlope = wormHead.w;

            If(life.lessThanEqual(0.0), () => {
                If(life.lessThan(-0.05), () => {
                    posLife.w.addAssign(dt);
                }).Else(() => {
                    const r = velRand.w;
                    const r2 = fract(sin(float(index).mul(127.1).add(time.mul(3.7))).mul(43758.5453));
                    const r3 = fract(sin(float(index).mul(269.5).add(time.mul(1.5))).mul(43758.5453));

                    // Particle type: head plume (~42%) vs trailing wake dust (~58%).
                    // Stable per-particle so the visual mix stays consistent over time.
                    const isWake = step(float(0.42), r); // 0 = head plume, 1 = wake dust

                    // Head spawn: explosive eruption right at / just ahead of worm head.
                    const headJitter = r3.mul(46.0).sub(6.0).mul(leadScale); // -6..+40 along Z
                    const headSpawnZ = wormHeadZ.add(headJitter);

                    // Wake spawn: distributed BEHIND the head along the carved trail.
                    // wakeT^1.25 biases more particles near the head for density falloff.
                    const wakeT = pow(r2, float(1.25));
                    const wakeOffset = wakeT.mul(300.0).sub(20.0); // -20..+280 behind head
                    const wakeSpawnZ = wormHeadZ.sub(wakeOffset);

                    const spawnZ = mix(headSpawnZ, wakeSpawnZ, isWake);

                    // X position follows the worm path with organic meander.
                    const meander = tslNoise3D(vec3(spawnZ.mul(0.02), float(0.0), time.mul(0.02))).mul(12.0);
                    const spawnPathX = wormPathBaseX.add(spawnZ.mul(wormPathSlope)).add(meander);

                    const angle = r.mul(6.28).add(r3.mul(0.4));

                    // Head bursts cluster tight; wake dust scatters wider across the groove.
                    const headRadius = float(5.0).add(r3.mul(16.0));
                    const wakeRadius = float(11.0).add(r3.mul(26.0));
                    const radius = mix(headRadius, wakeRadius, isWake);

                    posLife.x.assign(spawnPathX.add(cos(angle).mul(radius)));
                    posLife.z.assign(spawnZ.add(sin(angle).mul(radius)));

                    // Height: hug the terrain surface, tiny lift to seat into the sand.
                    const terrainH = tslApproxTerrainHeight(posLife.x, posLife.z);
                    posLife.y.assign(terrainH.add(float(0.6)).add(r3.mul(2.0)));

                    // Velocities differ dramatically between head plumes and wake dust.
                    // Head: explosive vertical eruption with strong outward + forward push.
                    const headOutward = float(20.0).add(r2.mul(16.0));
                    const headVx = cos(angle).mul(headOutward);
                    const headVz = sin(angle).mul(headOutward).add(float(7.0));
                    const headVy = float(22.0).add(r3.mul(24.0));

                    // Wake: gentle ground-hugging puff that lingers in the trough.
                    const wakeOutward = float(2.5).add(r2.mul(5.0));
                    const wakeVx = cos(angle).mul(wakeOutward);
                    const wakeVz = sin(angle).mul(wakeOutward).sub(float(1.5));
                    const wakeVy = float(3.0).add(r3.mul(6.0));

                    velRand.x.assign(mix(headVx, wakeVx, isWake));
                    velRand.y.assign(mix(headVy, wakeVy, isWake));
                    velRand.z.assign(mix(headVz, wakeVz, isWake));

                    posLife.w.assign(float(1.0));
                });
            }).Else(() => {
                const age = float(1.0).sub(life);
                const isWake = step(float(0.42), velRand.w);

                // Head plume: heavy gravity drop -> buoyant rise. Wake: gentle, low gravity.
                const gravityHead = mix(float(-30.0), float(2.0), smoothstep(0.0, 0.4, age));
                const gravityWake = mix(float(-10.0), float(1.2), smoothstep(0.0, 0.55, age));
                const gravity = mix(gravityHead, gravityWake, isWake);
                velRand.y.addAssign(gravity.mul(dt));

                // Drag: head decelerates fast, wake drifts.
                const dragHead = mix(float(0.5), float(2.5), smoothstep(0.0, 0.3, age));
                const dragWake = mix(float(0.25), float(1.4), smoothstep(0.0, 0.45, age));
                const drag = mix(dragHead, dragWake, isWake);
                velRand.x.subAssign(velRand.x.mul(drag).mul(dt));
                velRand.y.subAssign(velRand.y.mul(drag).mul(dt));
                velRand.z.subAssign(velRand.z.mul(drag).mul(dt));

                const windFactor = smoothstep(0.2, 1.0, age);
                const windScale = mix(float(11.0), float(6.5), isWake);
                velRand.x.addAssign(windScale.mul(wind).mul(windFactor).mul(dt));

                const turbScale = mix(float(10.0), float(5.5), isWake);
                const noisePos = posLife.xyz.mul(0.05).add(vec3(time.mul(0.2), 0.0, 0.0));
                const turbX = tslNoise3D(noisePos).mul(turbScale);
                const turbY = tslNoise3D(noisePos.add(vec3(100.0, 0.0, 0.0))).mul(turbScale.mul(0.5));
                const turbZ = tslNoise3D(noisePos.add(vec3(0.0, 0.0, 100.0))).mul(turbScale);

                velRand.x.addAssign(turbX.mul(windFactor).mul(dt));
                velRand.y.addAssign(turbY.mul(windFactor).mul(dt));
                velRand.z.addAssign(turbZ.mul(windFactor).mul(dt));

                const groundH = tslApproxTerrainHeight(posLife.x, posLife.z);
                If(posLife.y.lessThan(groundH), () => {
                    posLife.y.assign(groundH.add(0.1));
                    velRand.y.mulAssign(-0.3);
                    velRand.x.mulAssign(0.5);
                    velRand.z.mulAssign(0.5);
                });

                posLife.x.addAssign(velRand.x.mul(dt));
                posLife.y.addAssign(velRand.y.mul(dt));
                posLife.z.addAssign(velRand.z.mul(dt));

                // Decay: head burns out fast (~3.5s), wake lingers (~7s) for continuous trail.
                const decayHead = float(0.28).add(velRand.w.mul(0.10));
                const decayWake = float(0.12).add(velRand.w.mul(0.06));
                const decay = mix(decayHead, decayWake, isWake);
                posLife.w.subAssign(decay.mul(dt));

                If(life.greaterThan(0.68).and(life.lessThan(0.72)), () => {
                    velRand.xyz.mulAssign(float(0.5));
                });

                // Cooldown — wake particles cycle fast for a continuously-fed trail.
                If(posLife.w.lessThanEqual(0.0), () => {
                    const cooldownBase = mix(float(-0.5), float(-0.08), isWake);
                    posLife.w.assign(cooldownBase.sub(velRand.w.mul(0.6)));
                    velRand.xyz.assign(vec3(0.0));
                });
            });

            state.element(stateIdx0).assign(posLife);
            state.element(stateIdx1).assign(velRand);
        });

        this.computeNode = computeSmoke().compute(this.count);
        return this.computeNode;
    }

    /**
     * Update uniforms
     */
    update(time, windStrength) {
        this.uTime.value = time;
        this.uWindStrength.value = windStrength;
    }

    /**
     * Runtime art-direction knob: adjusts how far ahead of the worm the smoke spawns.
     */
    setLeadScale(scale) {
        if (!Number.isFinite(scale)) return;
        this.leadScale = Math.max(0.5, Math.min(1.8, scale));
        this.uLeadScale.value = this.leadScale;
    }

    /**
     * CPU fallback update for WebGL backend
     * Mirrors the GPU compute logic (simplified)
     */
    updateCPU(time, windStrength) {
        const wind = windStrength ?? 0.5;
        const wormState = this.wormTrail?.getCPUState?.() ?? { headX: 0, headZ: 0 };
        const dt = 0.016;
        const leadScale = this.leadScale ?? 1.0;

        for (let i = 0; i < this.count; i++) {
            const i8 = i * 8;

            // Unpack
            let x = this.stateData[i8];
            let y = this.stateData[i8 + 1];
            let z = this.stateData[i8 + 2];
            let life = this.stateData[i8 + 3];

            let vx = this.stateData[i8 + 4];
            let vy = this.stateData[i8 + 5];
            let vz = this.stateData[i8 + 6];
            const rand = this.stateData[i8 + 7];

            // Particle type: head plume vs wake dust (stable per particle via rand)
            const isWake = rand >= 0.42 ? 1 : 0;

            // Respawn
            if (life <= 0) {
                if (life < -0.05) {
                    this.stateData[i8 + 3] += dt;
                    continue;
                }

                const r2 = Math.random();
                const r3 = Math.random();

                // Head spawn: at / just ahead of worm head. Wake spawn: distributed behind.
                const headJitter = (r3 * 46.0 - 6.0) * leadScale;
                const headSpawnZ = wormState.headZ + headJitter;

                const wakeT = Math.pow(r2, 1.25);
                const wakeOffset = wakeT * 300.0 - 20.0;
                const wakeSpawnZ = wormState.headZ - wakeOffset;

                const spawnZ = isWake ? wakeSpawnZ : headSpawnZ;

                const meander = Math.sin(spawnZ * 0.02 + time * 0.02) * 12.0;
                const spawnPathX = wormState.pathBaseX + spawnZ * wormState.pathSlope + meander;

                const angle = rand * 6.28 + r3 * 0.4;
                const headRadius = 5.0 + r3 * 16.0;
                const wakeRadius = 11.0 + r3 * 26.0;
                const radius = isWake ? wakeRadius : headRadius;

                x = spawnPathX + Math.cos(angle) * radius;
                z = spawnZ + Math.sin(angle) * radius;
                const terrainH = this.approxTerrainHeight(x, z);
                y = terrainH + 0.6 + r3 * 2.0;

                if (isWake) {
                    // Lingering wake dust: gentle puff, hugs the trough
                    const outwardSpeed = 2.5 + r2 * 5.0;
                    vx = Math.cos(angle) * outwardSpeed;
                    vz = Math.sin(angle) * outwardSpeed - 1.5;
                    vy = 3.0 + r3 * 6.0;
                } else {
                    // Explosive head plume: high vertical + forward burst
                    const outwardSpeed = 20.0 + r2 * 16.0;
                    vx = Math.cos(angle) * outwardSpeed;
                    vz = Math.sin(angle) * outwardSpeed + 7.0;
                    vy = 22.0 + r3 * 24.0;
                }

                life = 1.0;
            } else {
                const age = 1.0 - life;

                // Gravity: heavy for head plume, gentle for wake dust
                let gravity;
                if (isWake) {
                    if (age > 0.55) gravity = 1.2;
                    else gravity = -10.0 + (11.2 * (age / 0.55));
                } else {
                    if (age > 0.4) gravity = 2.0;
                    else gravity = -30.0 + (32.0 * (age / 0.4));
                }
                vy += gravity * dt;

                // Drag
                let drag;
                if (isWake) {
                    if (age > 0.45) drag = 1.4;
                    else drag = 0.25 + (1.15 * (age / 0.45));
                } else {
                    if (age > 0.3) drag = 2.5;
                    else drag = 0.5 + (2.0 * (age / 0.3));
                }
                vx -= vx * drag * dt;
                vy -= vy * drag * dt;
                vz -= vz * drag * dt;

                // Wind
                if (age > 0.2) {
                    const windScale = isWake ? 6.5 : 11.0;
                    vx += windScale * wind * dt;
                    const turbScale = isWake ? 5.5 : 10.0;
                    vx += Math.sin(y * 0.05 + time) * turbScale * dt;
                    vy += Math.sin(x * 0.05 + time) * turbScale * 0.5 * dt;
                    vz += Math.sin(z * 0.05 + time) * turbScale * dt;
                }

                x += vx * dt;
                y += vy * dt;
                z += vz * dt;

                const groundH = this.approxTerrainHeight(x, z);
                if (y < groundH) {
                    y = groundH + 0.1;
                    vy *= -0.3;
                    vx *= 0.5;
                    vz *= 0.5;
                }

                // Decay: head burns out fast, wake lingers
                const decay = isWake
                    ? 0.12 + rand * 0.06
                    : 0.28 + rand * 0.10;
                life -= decay * dt;
                if (life <= 0) {
                    life = isWake ? (-0.08 - rand * 0.6) : (-0.5 - rand * 0.6);
                    vx = 0;
                    vy = 0;
                    vz = 0;
                }
            }

            // Pack
            this.stateData[i8] = x;
            this.stateData[i8 + 1] = y;
            this.stateData[i8 + 2] = z;
            this.stateData[i8 + 3] = life;
            this.stateData[i8 + 4] = vx;
            this.stateData[i8 + 5] = vy;
            this.stateData[i8 + 6] = vz;
        }

        this.stateBuffer.needsUpdate = true;
    }

    /**
     * Get state buffer for rendering
     */
    getStateBuffer() {
        return this.stateBuffer;
    }

    /**
     * Get raw state data for CPU-updated rendering
     */
    getStateData() {
        return this.stateData;
    }

    // Helper: GLSL-style fract
    fract(x) {
        return x - Math.floor(x);
    }

    // Reuse existing terrain approx helper from file scope
    // But since it's inside the class now and 'approxTerrainHeight' is a method...
    approxTerrainHeight(x, z) {
        const dir = 0.628; // PI * 0.2
        const cosD = Math.cos(dir), sinD = Math.sin(dir);
        const rx = x * cosD + z * sinD;
        const rz = -x * sinD + z * cosD;

        // Primary dunes — 2-octave FBM
        const cx = rx * 0.003, cz = rz * 0.003;
        const fbm = this._smoothNoise2D(cx, cz) * 0.6
            + this._smoothNoise2D(cx * 2, cz * 2) * 0.4;
        const h = Math.abs(fbm * 2 - 1) * 45;

        // Secondary rolling hills
        const h2 = this._smoothNoise2D(x * 0.012, z * 0.012 + 100) * 15;

        // Asymmetric windward
        const windward = Math.sin(rx * 0.02) * 0.3 + 0.7;

        return (h + h2) * windward - 20;
    }

    // Helper: GLSL-style mod
    mod(a, b) {
        return ((a % b) + b) % b;
    }

    /* Noise helpers reused from previous implementation */
    _hash2D(px, py) {
        const p3x = this.fract(px * 0.1031);
        const p3y = this.fract(py * 0.1031);
        const p3z = this.fract(px * 0.1031);
        const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
        return this.fract((p3x + d) * (p3y + d) * (p3z + d));
    }

    _smoothNoise2D(px, py) {
        const ix = Math.floor(px), iy = Math.floor(py);
        let fx = px - ix, fy = py - iy;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const a = this._hash2D(ix, iy);
        const b = this._hash2D(ix + 1, iy);
        const c = this._hash2D(ix, iy + 1);
        const d = this._hash2D(ix + 1, iy + 1);
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.computeNode = null;
        this.stateBuffer = null;
        this.stateData = null;
        this.wormTrail = null;
    }
}

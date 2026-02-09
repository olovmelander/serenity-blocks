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
 * Features: FBM turbulence, worm trail following, volumetric scattering
 * NOTE: This will be fully implemented in Phase 5
 */
/**
 * Enhanced sand smoke with GPU compute simulation
 * Features: Physics-based particle system with emission, advection, and drag
 * Fixed: Now emits from the worm head and flows naturally
 */
export class SandSmokeCompute {
    constructor(particleCount, wormTrailCompute) {
        this.count = particleCount;
        this.wormTrail = wormTrailCompute;

        // Particle state buffer (2x vec4 per particle)
        // [0]: x, y, z, life (life = 0..1, 0 = dead)
        // [1]: vx, vy, vz, rand (velocity + stable random)
        this.stateData = new Float32Array(particleCount * 8);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        this.uTime = uniform(0);
        this.uWindStrength = uniform(0.5);

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
            this.stateData[i8 + 3] = -Math.random() * 5.0; // life (negative = delay)

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

        const computeSmoke = Fn(() => {
            const index = instanceIndex;
            const stateIdx0 = index.mul(2);
            const stateIdx1 = index.mul(2).add(1);

            const posLife = state.element(stateIdx0).toVar(); // x, y, z, life
            const velRand = state.element(stateIdx1).toVar(); // vx, vy, vz, rand

            const life = posLife.w;
            const dt = float(0.016); // Fixed delta time

            // Read worm state from shared buffer
            const wormHead = wormState.element(0);
            const wormHeadX = wormHead.x;
            const wormHeadZ = wormHead.y;        // headZ
            const wormPathBaseX = wormHead.z;     // pathBaseX
            const wormPathSlope = wormHead.w;     // pathSlope

            // --- SPAWN LOGIC ---
            If(life.lessThanEqual(0.0), () => {
                // If deeply negative, just increment (delay)
                If(life.lessThan(-0.05), () => {
                    posLife.w.addAssign(dt);
                }).Else(() => {
                    // SPAWN along the worm TRAIL, not just at the head.
                    // Use a hash of index+time to get a second random for trail offset.
                    const r = velRand.w; // stable random seed per particle
                    const r2 = fract(sin(float(index).mul(127.1).add(time.mul(3.7))).mul(43758.5453));

                    // Distribute along the trail: 0..400 units behind the head
                    const trailOffset = r2.mul(400.0);
                    const spawnZ = wormHeadZ.sub(trailOffset);

                    // Follow the worm path (baseX + slope * z)
                    const spawnPathX = wormPathBaseX.add(spawnZ.mul(wormPathSlope));

                    // Scatter perpendicular to path
                    const angle = r.mul(6.28);
                    const radius = float(3.0).add(r.mul(25.0));

                    posLife.x.assign(spawnPathX.add(cos(angle).mul(radius)));
                    posLife.z.assign(spawnZ.add(sin(angle).mul(radius)));

                    // Height: terrain + ridge offset
                    const terrainH = tslApproxTerrainHeight(posLife.x, posLife.z);
                    posLife.y.assign(terrainH.add(18.0));

                    // Velocity: strong upward burst + gentle lateral spread
                    // Particles near the head get more velocity, trail particles get less
                    const headProximity = float(1.0).sub(trailOffset.div(400.0)); // 1 at head, 0 at tail
                    const upVel = float(20.0).add(headProximity.mul(30.0)).add(r.mul(15.0));
                    velRand.x.assign(cos(angle).mul(8.0).add(r.mul(5.0)));
                    velRand.y.assign(upVel);
                    velRand.z.assign(sin(angle).mul(8.0).add(r.mul(5.0)));

                    posLife.w.assign(float(1.0));
                });
            }).Else(() => {
                // --- PHYSICS UPDATE ---

                // 1. Buoyancy — strong upward force for towering plume
                velRand.y.addAssign(float(28.0).mul(dt));

                // 2. Wind advection
                const windForce = vec3(wind.mul(15.0), 0.0, wind.mul(5.0));
                velRand.xyz.addAssign(windForce.mul(dt));

                // 3. Turbulence
                const noisePos = posLife.xyz.mul(0.015).add(vec3(time.mul(0.08), 0.0, 0.0));
                const turb = vec3(
                    sin(noisePos.y.mul(3.0).add(noisePos.z.mul(2.0))).mul(25.0),
                    sin(noisePos.x.mul(2.5)).mul(8.0),
                    cos(noisePos.y.mul(3.0).add(noisePos.x.mul(2.0))).mul(25.0)
                );
                velRand.xyz.addAssign(turb.mul(dt));

                // 4. Drag — lighter drag for taller plumes
                velRand.xyz.mulAssign(float(0.97));

                // 5. Integration
                posLife.xyz.addAssign(velRand.xyz.mul(dt));

                // 6. Terrain collision
                const groundH = tslApproxTerrainHeight(posLife.x, posLife.z);
                const minH = groundH.add(1.0);
                If(posLife.y.lessThan(minH), () => {
                    posLife.y.assign(minH);
                    velRand.y.assign(abs(velRand.y).mul(0.3)); // Bounce up slightly
                    velRand.x.mulAssign(0.85);
                    velRand.z.mulAssign(0.85);
                });

                // 7. Life decay — slow for lingering clouds
                const decay = float(0.12).add(velRand.w.mul(0.08)); // ~5-8 second lifetime
                posLife.w.subAssign(decay.mul(dt));
            });

            // Write back
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
     * CPU fallback update for WebGL backend
     * Mirrors the GPU compute logic (simplified)
     */
    updateCPU(time, windStrength) {
        const wind = windStrength ?? 0.5;
        const wormState = this.wormTrail?.getCPUState?.() ?? { headX: 0, headZ: 0 };
        const dt = 0.016;

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

            // Respawn
            if (life <= 0) {
                // Only spawn if delay is over (negative life counts up)
                if (life < -0.02) {
                    this.stateData[i8 + 3] += dt;
                    continue;
                }

                const angle = rand * 6.28;
                const radius = 5.0 + rand * 35.0;
                x = wormState.headX + Math.cos(angle) * radius;
                z = wormState.headZ + Math.sin(angle) * radius;
                const terrainH = this.approxTerrainHeight(x, z);
                y = terrainH + 22.0;

                const upVel = 35.0 + rand * 25.0;
                vx = Math.cos(angle) * 15.0 + rand * 10.0;
                vy = upVel;
                vz = Math.sin(angle) * 15.0 + rand * 10.0;
                life = 1.0;
            } else {
                // Physics
                vy += 20.0 * dt; // Buoyancy
                vx += wind * 20.0 * dt; // Wind

                // Turbulence
                vx += Math.sin(y * 0.1 + time) * 30.0 * dt;
                vy += Math.sin(x * 0.1 + time) * 10.0 * dt;
                vz += Math.sin(z * 0.1 + time) * 30.0 * dt;

                // Drag
                vx *= 0.96;
                vy *= 0.96;
                vz *= 0.96;

                // Integrate
                x += vx * dt;
                y += vy * dt;
                z += vz * dt;

                // Collision
                const groundH = this.approxTerrainHeight(x, z);
                if (y < groundH + 1.0) {
                    y = groundH + 1.0;
                    vy *= 0.5;
                    vx *= 0.9;
                    vz *= 0.9;
                }

                // Decay — slow for lingering dust clouds
                const decay = 0.15 + rand * 0.1;
                life -= decay * dt;
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

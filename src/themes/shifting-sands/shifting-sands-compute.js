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
    If,
} from 'three/tsl';

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
export class SandSmokeCompute {
    constructor(particleCount, wormTrailCompute) {
        this.count = particleCount;
        this.wormTrail = wormTrailCompute;

        // Particle state buffer (2x vec4 per particle)
        // [0]: x, y, z, opacity
        // [1]: rand, wormIntensity, depth, size
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

            // Position (spread across view)
            this.stateData[i8] = (Math.random() - 0.5) * 2000;     // x
            this.stateData[i8 + 1] = 0;                             // y (set by shader)
            this.stateData[i8 + 2] = -2000 + Math.random() * 2800;  // z
            this.stateData[i8 + 3] = 0.3;                           // opacity

            // Properties
            this.stateData[i8 + 4] = Math.random();                 // rand
            this.stateData[i8 + 5] = 0;                             // wormIntensity
            this.stateData[i8 + 6] = 0;                             // depth
            this.stateData[i8 + 7] = 220 + Math.random() * 180;     // size (smaller, tighter)
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
            const pos = state.element(index.mul(2)).toVar();
            const props = state.element(index.mul(2).add(1)).toVar();

            const rand = props.x;
            const rand2 = fract(sin(rand.mul(19.17).add(3.1)).mul(43758.5453));
            const rand3 = fract(sin(rand.mul(77.31).add(1.7)).mul(43758.5453));

            // Read worm position from shared buffer
            const wormHead = wormState.element(0);
            const wormHeadX = wormHead.x;
            const wormHeadZ = wormHead.y;
            const wormPathBaseX = wormHead.z;
            const wormPathSlope = wormHead.w;

            // Distribute particles along the trail, centered around the head
            const along = rand2.sub(0.5).mul(600.0); // trail length (tighter to head)
            const lateral = rand3.sub(0.5).mul(80.0);

            const trailZ = wormHeadZ.add(along);
            const trailX = wormPathBaseX.add(trailZ.mul(wormPathSlope));

            const swirl = sin(time.mul(0.6).add(rand.mul(6.2831))).mul(12.0);
            const drift = cos(time.mul(0.4).add(rand.mul(3.14))).mul(8.0);

            pos.x.assign(trailX.add(lateral).add(swirl));
            pos.z.assign(trailZ.add(drift));

            // Vertical lift (soft, low)
            const lift = sin(time.mul(0.5).add(rand.mul(9.1))).mul(18.0).add(6.0);
            pos.y.assign(lift.add(wind.mul(4.0)));

            // Worm visibility (trail proximity + head proximity)
            const distFromPath = abs(pos.x.sub(trailX));
            const trailWidth = float(70.0);
            const pathMask = exp(distFromPath.mul(distFromPath).mul(-1.0).div(trailWidth.mul(trailWidth)));

            // Favor trailing smoke (behind head)
            const behindMask = smoothstep(200.0, 0.0, wormHeadZ.sub(pos.z));
            const distFromHead = abs(pos.z.sub(wormHeadZ));
            const headMask = smoothstep(280.0, 0.0, distFromHead);

            const wormVisibility = clamp(pathMask.mul(headMask).mul(behindMask).mul(1.2), 0.0, 1.0);

            // Store for fragment shader: wormIntensity + trail fade
            props.y.assign(wormVisibility);
            props.z.assign(headMask);

            // Write back
            state.element(index.mul(2)).assign(pos);
            state.element(index.mul(2).add(1)).assign(props);
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
     * Mirrors the GPU compute logic (approximate)
     */
    updateCPU(time, windStrength) {
        const wind = windStrength ?? 0.5;
        const wormState = this.wormTrail?.getCPUState?.() ?? null;

        const wormHeadX = wormState?.headX ?? 0;
        const wormHeadZ = wormState?.headZ ?? 0;
        const wormPathBaseX = wormState?.pathBaseX ?? 0;
        const wormPathSlope = wormState?.pathSlope ?? 0;

        for (let i = 0; i < this.count; i++) {
            const i8 = i * 8;

            const rand = this.stateData[i8 + 4];
            const rand2 = this.fract(Math.sin(rand * 19.17 + 3.1) * 43758.5453);
            const rand3 = this.fract(Math.sin(rand * 77.31 + 1.7) * 43758.5453);

            const along = (rand2 - 0.5) * 600.0;
            const lateral = (rand3 - 0.5) * 80.0;

            const trailZ = wormHeadZ + along;
            const trailX = wormPathBaseX + trailZ * wormPathSlope;

            const swirl = Math.sin(time * 0.6 + rand * 6.2831) * 12.0;
            const drift = Math.cos(time * 0.4 + rand * 3.14) * 8.0;

            const x = trailX + lateral + swirl;
            const z = trailZ + drift;
            const y = Math.sin(time * 0.5 + rand * 9.1) * 18.0 + 6.0 + wind * 4.0;

            const distFromPath = Math.abs(x - trailX);
            const trailWidth = 70.0;
            const pathMask = Math.exp(-(distFromPath * distFromPath) / (trailWidth * trailWidth));

            const behindMask = this.smoothstep(200.0, 0.0, wormHeadZ - z);
            const distFromHead = Math.abs(z - wormHeadZ);
            const headMask = this.smoothstep(280.0, 0.0, distFromHead);
            const wormVisibility = Math.min(1.0, pathMask * headMask * behindMask * 1.2);

            this.stateData[i8] = x;
            this.stateData[i8 + 1] = y;
            this.stateData[i8 + 2] = z;
            // opacity stays in i8+3
            this.stateData[i8 + 5] = wormVisibility;
            this.stateData[i8 + 6] = headMask;
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

    // Helper: GLSL-style smoothstep
    smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    // Helper: GLSL-style mod
    mod(a, b) {
        return ((a % b) + b) % b;
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

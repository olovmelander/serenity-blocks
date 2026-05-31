/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams V3 — Fluid Particles Compute System
 *
 * GPU-driven particle simulation. ~50K particles updated per-frame in a single
 * WebGPU compute dispatch. Not true SPH/MPM — this is a velocity-field fluid
 * approximation that LOOKS like fluid (mass + impulses + vortices) without the
 * neighborhood-search cost.
 *
 * Force field per particle:
 *   1. Gentle gravity toward focal point (keeps mass coherent)
 *   2. Per-event impulse list (radial bursts + vortices from line clears, combos)
 *   3. Noise-driven turbulence (organic motion when no events)
 *   4. Damping + speed cap (stability)
 *
 * Storage layout (3 buffers × 4 floats × count):
 *   positions:  xyz + age      (age 0..1, drives color + size animation)
 *   velocities: xyz + lifetime (lifetime caps particle lifespan)
 *   colors:     rgb + energy   (energy 0..1, drives bloom intensity)
 *
 * Impulse list (uniform buffer, max 8 active):
 *   Each impulse: vec4(x,y,z,strength) + vec4(dirX,dirY,dirZ,type)
 *   type: 0=radial-push, 1=vortex, 2=attractor
 *
 * Performance: 50K particles × ~30 ops/particle = ~1.5M ops/frame on GPU.
 * On RTX 3070 this is well under 1ms. CPU cost is zero — just uniform updates.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cos,
    cross,
    float,
    fract,
    instanceIndex,
    length,
    max,
    sin,
    smoothstep,
    storage,
    uniform,
    vec3,
} from 'three/tsl';
import { generateShape } from './shape-formations.js';

export const FLUID_BUDGETS = Object.freeze({
    // focalRadius bumped ~60% across tiers so the mass naturally settles wider —
    // fills out the empty screen edges on either side of the game board.
    // gravityStrength slightly reduced so the wider equilibrium isn't fighting
    // a too-strong pull back to center.
    // Particle counts bumped at higher tiers to maintain visual density across
    // the larger area (otherwise the same particles spread thinner = looks sparse).
    Minimal: Object.freeze({ count: 5000, focalRadius: 7.0, gravityStrength: 0.55 }),
    Low: Object.freeze({ count: 12000, focalRadius: 8.0, gravityStrength: 0.58 }),
    Medium: Object.freeze({ count: 25000, focalRadius: 9.0, gravityStrength: 0.62 }),
    High: Object.freeze({ count: 45000, focalRadius: 9.5, gravityStrength: 0.65 }),
    Ultra: Object.freeze({ count: 65000, focalRadius: 10.0, gravityStrength: 0.68 }),
    Extreme: Object.freeze({ count: 90000, focalRadius: 11.0, gravityStrength: 0.72 }),
});

export function getFluidBudget(qualityName) {
    return { ...(FLUID_BUDGETS[qualityName] || FLUID_BUDGETS.High) };
}

// Max simultaneous active impulses. More than 8 simultaneous game events
// at the same instant is rare; queue overflow is silent (oldest drops).
export const MAX_IMPULSES = 8;

// Impulse types — matches type slot in impulse uniform.
export const IMPULSE_TYPE = Object.freeze({
    RADIAL: 0, // outward push from origin
    VORTEX: 1, // rotational swirl around origin (uses dir as axis)
    ATTRACTOR: 2, // inward pull toward origin (for "gather" effects)
});

export class FluidParticleSim {
    constructor(count, options = {}) {
        this.count = Math.max(1, Math.floor(count));
        this.focalPoint = options.focalPoint?.clone?.() || new THREE.Vector3(0, 0, 0);
        this.bounds = {
            width: options.boundsWidth ?? 18,
            height: options.boundsHeight ?? 12,
            depth: options.boundsDepth ?? 16,
        };

        // ─── Particle storage buffers ───
        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.colorData = new Float32Array(this.count * 4);
        // targetData: xyz = target position the particle is attracted to,
        // w = per-particle attraction multiplier (0..1). 0 = "free" (no pull).
        // The buffer is populated by shape generators; sim's attraction force
        // pulls particles toward these positions when uShapeStrength > 0.
        this.targetData = new Float32Array(this.count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.colorBuffer = new THREE.StorageBufferAttribute(this.colorData, 4);
        this.targetBuffer = new THREE.StorageBufferAttribute(this.targetData, 4);
        this.currentShape = 'free';

        // ─── Impulse uniforms (8 slots × 2 vec4) ───
        // Slot layout: positions[i] = vec4(x,y,z, strength)
        //              params[i]    = vec4(dirX, dirY, dirZ, type)
        // Strength = 0 means slot is inactive. Dead slots cost ~3 ops/particle to skip.
        this._impulsePositions = [];
        this._impulseParams = [];
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            this._impulsePositions.push(uniform(new THREE.Vector4(0, 0, 0, 0)));
            this._impulseParams.push(uniform(new THREE.Vector4(0, 1, 0, 0)));
        }

        // ─── Global uniforms ───
        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uFocalPoint = uniform(this.focalPoint.clone());
        this.uFocalRadius = uniform(options.focalRadius ?? 6.0);
        this.uGravityStrength = uniform(options.gravityStrength ?? 0.75);
        this.uTurbulence = uniform(options.turbulence ?? 0.5);
        this.uDamping = uniform(0.985);
        this.uMaxSpeed = uniform(8.0);
        this.uHeat = uniform(0); // 0..1, drives color shift

        // ─── Board-repulsion uniforms ───
        // Compositional trick: the game board occupies a vertical rectangle in
        // screen center. By pushing particles AWAY from that volume, the fluid
        // naturally wraps around the board — creating a halo framing effect
        // that visually "lights" the play area without occluding gameplay.
        // halfExtents = vec3(x,y,z) defining the no-go zone half-sizes.
        // strength = 0 disables (no repulsion); typical range 6-12.
        // softness = falloff distance beyond the rect boundary (smoother edge).
        this.uBoardCenter = uniform(new THREE.Vector3(0, 0, 0));
        this.uBoardHalfExtents = uniform(new THREE.Vector3(0, 0, 0));
        this.uBoardRepulsion = uniform(options.boardRepulsion ?? 0);
        this.uBoardSoftness = uniform(options.boardSoftness ?? 1.2);

        // ─── Anisotropic gravity ───
        // 1.0 = isotropic (default). <1 in a component = weaker pull on that
        // axis = mass spreads MORE along it. (0.5, 1.0, 1.0) means horizontal
        // pull is half as strong → fluid spreads wider sideways.
        this.uGravityAniso = uniform(
            options.gravityAnisotropy?.clone?.() || new THREE.Vector3(1, 1, 1),
        );

        // ─── Shape attraction ───
        // 0 = no attraction (free fluid); higher values pull particles toward
        // their targets. The morph between shapes happens via spring physics:
        // setShape() rewrites targets; the running force handles transition.
        // When shape mode is active, gravity + board-repulsion get scaled DOWN
        // (uShapeOverride below) so the formation isn't fighting other forces.
        this.uShapeStrength = uniform(0);
        // Multiplier (0..1) applied to gravity + board-repulsion when shape
        // mode is active. 0 = formation totally overrides; 1 = forces stack.
        // Default 0.35 = gravity is 35% normal during shape, lets formation win.
        this.uShapeOverride = uniform(0.35);

        this.computeNode = null;
        this._initParticleState();
        // Initialize target buffer to 'free' state (no attraction). The first
        // setShape() call will overwrite with real targets.
        generateShape('free', this.targetData, this.count);
        this.targetBuffer.needsUpdate = true;
    }

    _initParticleState() {
        // Spawn particles in an ANISOTROPIC ellipsoid around the focal point.
        // Wider on X (horizontal spread to "hug" the screen sides around the
        // game board), tighter on Y/Z. Without this, the runtime anisotropic
        // gravity takes ~5s to reshape an isotropic spawn — particles look
        // like a sphere on frame 1, then flatten. Spawning pre-shaped means
        // the composition is correct from the very first visible frame.
        const fp = this.focalPoint;
        const r0 = (this.uFocalRadius?.value ?? 6.0) * 0.85;
        const aniso = this.uGravityAniso?.value || new THREE.Vector3(1, 1, 1);
        // Inverse anisotropy → spread axes (weaker gravity = wider spread).
        const spreadX = 1 / Math.max(0.1, aniso.x);
        const spreadY = 1 / Math.max(0.1, aniso.y);
        const spreadZ = 1 / Math.max(0.1, aniso.z);
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            // Spherical coords, scaled per-axis by inverse anisotropy.
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = r0 * Math.cbrt(Math.random());
            const sinPhi = Math.sin(phi);
            this.positionData[i4] = fp.x + r * sinPhi * Math.cos(theta) * spreadX;
            this.positionData[i4 + 1] = fp.y + r * sinPhi * Math.sin(theta) * spreadY;
            this.positionData[i4 + 2] = fp.z + r * Math.cos(phi) * spreadZ;
            this.positionData[i4 + 3] = Math.random(); // age 0..1

            // Tiny orbital velocity — gives the initial frame some life so
            // even on Frame 1 the mass isn't a static cloud.
            const tangent = Math.atan2(this.positionData[i4 + 1] - fp.y, this.positionData[i4] - fp.x) + Math.PI / 2;
            this.velocityData[i4] = Math.cos(tangent) * 0.4;
            this.velocityData[i4 + 1] = Math.sin(tangent) * 0.4;
            this.velocityData[i4 + 2] = (Math.random() - 0.5) * 0.2;
            this.velocityData[i4 + 3] = 8 + Math.random() * 14; // lifetime seconds

            // Color seed — picked from the iridescence palette. Per-particle
            // color is later modulated by velocity magnitude in the shader.
            const colorPick = Math.random();
            if (colorPick < 0.4) {
                // Magenta / pink
                this.colorData[i4] = 0.85;
                this.colorData[i4 + 1] = 0.25;
                this.colorData[i4 + 2] = 0.92;
            } else if (colorPick < 0.75) {
                // Cyan
                this.colorData[i4] = 0.06;
                this.colorData[i4 + 1] = 0.75;
                this.colorData[i4 + 2] = 0.95;
            } else {
                // Mint highlight
                this.colorData[i4] = 0.55;
                this.colorData[i4 + 1] = 0.95;
                this.colorData[i4 + 2] = 0.88;
            }
            this.colorData[i4 + 3] = 0.4 + Math.random() * 0.6; // energy
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const colors = storage(this.colorBuffer, 'vec4', this.count);
        const targets = storage(this.targetBuffer, 'vec4', this.count);

        const dt = this.uDelta;
        const time = this.uTime;
        const focal = this.uFocalPoint;
        const focalR = this.uFocalRadius;
        const gravStr = this.uGravityStrength;
        const gravAniso = this.uGravityAniso;
        const turbStr = this.uTurbulence;
        const damping = this.uDamping;
        const maxSpeed = this.uMaxSpeed;
        const boardCenter = this.uBoardCenter;
        const boardHalf = this.uBoardHalfExtents;
        const boardRepStr = this.uBoardRepulsion;
        const boardSoftness = this.uBoardSoftness;
        const shapeStr = this.uShapeStrength;
        const shapeOverride = this.uShapeOverride;
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

            // Shape mode has TWO separate dimmers:
            //   gravityDimmer  — linear/soft. Gravity still helps shapes converge
            //                    and prevents far drift; only mildly reduced.
            //   boardDimmer    — aggressive smoothstep. Board-repulsion turns
            //                    OFF as soon as shape mode starts, so shapes
            //                    can occupy the central board area without
            //                    getting torn apart into a cross silhouette.
            // Threshold 0.05→0.18 means board-repulsion is fully off whenever
            // shapeStr > 0.18 (well below any real shape trigger value of 0.35+).
            const gravityDimmer = float(1.0).sub(
                shapeStr.mul(float(1.0).sub(shapeOverride)),
            );
            const boardDimmer = float(1.0).sub(smoothstep(0.05, 0.18, shapeStr));

            // 1. Gentle gravity toward focal point — keeps the mass coherent.
            // Scaled down softly when in shape mode.
            const toFocal = focal.sub(pXYZ).toVar();
            const distFocal = length(toFocal).toVar();
            const safeFocal = max(distFocal, float(0.01));
            const focalDir = toFocal.div(safeFocal);
            const pullStrength = gravStr.mul(
                float(1.0).add(max(distFocal.sub(focalR), float(0.0)).mul(0.4)),
            ).mul(gravityDimmer);
            const pullVec = focalDir.mul(pullStrength).mul(gravAniso);
            vXYZ.addAssign(pullVec.mul(dt));

            // 1a. SHAPE ATTRACTION — pull toward target position (if active).
            // Attraction multiplier bumped 8→11 so shapes settle crisper.
            // tgt.w is per-particle weight; free-mode (shapeStr=0) costs zero work.
            const tgt = targets.element(index).toVar();
            const toTarget = tgt.xyz.sub(pXYZ);
            const attractStrength = shapeStr.mul(tgt.w).mul(11.0);
            vXYZ.addAssign(toTarget.mul(attractStrength).mul(dt));

            // 1b. Board-repulsion. Pushes particles outward when they're
            // INSIDE a rectangular zone centered at boardCenter with halfExtents
            // sized to the game board. Soft falloff (boardSoftness) prevents
            // hard wall artifacts at the rect edge.
            // Skip cheaply when repulsion strength is 0 (single multiply by 0).
            const local = pXYZ.sub(boardCenter).toVar();
            const localAbs = vec3(
                max(local.x, local.x.negate()),
                max(local.y, local.y.negate()),
                max(local.z, local.z.negate()),
            );
            // Distance from each axis to the rect surface (negative = inside).
            const outsideDist = vec3(
                localAbs.x.sub(boardHalf.x),
                localAbs.y.sub(boardHalf.y),
                localAbs.z.sub(boardHalf.z),
            );
            // Inside-ness factor: 1 at very center, 0 at boardSoftness beyond edge.
            const insideX = float(1.0).sub(max(outsideDist.x.div(boardSoftness), float(0.0)));
            const insideY = float(1.0).sub(max(outsideDist.y.div(boardSoftness), float(0.0)));
            const insideZ = float(1.0).sub(max(outsideDist.z.div(boardSoftness), float(0.0)));
            const inside = max(insideX, float(0.0))
                .mul(max(insideY, float(0.0)))
                .mul(max(insideZ, float(0.0)));
            // Push direction: outward from board center along the dominant axis.
            // Sign of local component determines push direction per axis.
            // Scaled by boardDimmer (aggressive smoothstep) — fully off when
            // shape mode is active so formations don't get carved by board edge.
            const pushDir = vec3(
                local.x.div(max(localAbs.x, float(0.001))),
                local.y.div(max(localAbs.y, float(0.001))),
                local.z.div(max(localAbs.z, float(0.001))),
            );
            vXYZ.addAssign(pushDir.mul(boardRepStr).mul(inside).mul(boardDimmer).mul(dt));

            // 2. Apply impulses. Each impulse is a (position, strength, dir, type).
            // strength=0 means slot is dead — multiplying by strength makes inactive
            // slots cost zero force (only the 3 conditional ops to evaluate the slot).
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
                const fallOff = max(float(1.0).sub(dImp.mul(0.18)), float(0.0)); // ~5.5u reach
                const fallOffSq = fallOff.mul(fallOff);

                // RADIAL: outward push from impulse center (type < 0.5)
                If(impType.lessThan(float(0.5)).and(impStr.greaterThan(float(0.01))), () => {
                    const outDir = toImp.div(safeImp);
                    vXYZ.addAssign(outDir.mul(impStr).mul(fallOffSq).mul(dt));
                });

                // VORTEX: rotation around impulse axis (type ~1.0)
                const isVortex = impType.greaterThan(float(0.5))
                    .and(impType.lessThan(float(1.5)))
                    .and(impStr.greaterThan(float(0.01)));
                If(isVortex, () => {
                    // Tangent = axis × radial-vector → gives perpendicular swirl direction
                    const tangent = cross(impDir, toImp.div(safeImp));
                    vXYZ.addAssign(tangent.mul(impStr).mul(fallOffSq).mul(dt));
                });

                // ATTRACTOR: inward pull (type ~2.0)
                If(impType.greaterThan(float(1.5)).and(impStr.greaterThan(float(0.01))), () => {
                    const inDir = impCenter.sub(pXYZ).div(safeImp);
                    vXYZ.addAssign(inDir.mul(impStr).mul(fallOffSq).mul(dt));
                });
            }

            // 3. Organic turbulence — three sine waves at different frequencies.
            // Per-particle phase shift via index makes adjacent particles diverge
            // (looks more chaotic / less coherent than uniform turbulence).
            const idxF = float(index);
            const turbX = sin(time.mul(0.55).add(idxF.mul(0.013))).mul(turbStr).mul(0.35);
            const turbY = cos(time.mul(0.42).add(idxF.mul(0.017))).mul(turbStr).mul(0.32);
            const turbZ = sin(time.mul(0.31).add(idxF.mul(0.011))).mul(turbStr).mul(0.22);
            vXYZ.addAssign(vec3(turbX, turbY, turbZ).mul(dt));

            // 4. Damping (per-frame, so frame-rate independent only at 60fps;
            // good enough — adaptive scaling keeps us near 60).
            vXYZ.mulAssign(damping);

            // 5. Speed cap
            const sp = length(vXYZ).toVar();
            If(sp.greaterThan(maxSpeed), () => {
                vXYZ.mulAssign(maxSpeed.div(sp));
            });

            // 6. Integrate position
            pXYZ.addAssign(vXYZ.mul(dt));

            // 7. Age advance + soft respawn at end of life. Respawning at the
            // focal point with a small outward velocity preserves the "mass"
            // appearance even as particles age out individually.
            age.addAssign(dt.div(vel.w));
            If(age.greaterThan(float(1.0)), () => {
                // Hash respawn position around focal point
                const r1 = fract(sin(idxF.mul(12.9898).add(time.mul(0.37))).mul(43758.5453));
                const r2 = fract(sin(idxF.mul(78.233).add(time.mul(0.53))).mul(43758.5453));
                const r3 = fract(sin(idxF.mul(39.425).add(time.mul(0.71))).mul(43758.5453));
                // Spherical respawn (Box-Muller-ish via 3 hashes)
                const r = focalR.mul(0.4).mul(r1);
                const theta = r2.mul(6.2832);
                const phiSin = sin(r3.mul(3.1416));
                const phiCos = cos(r3.mul(3.1416));
                pXYZ.assign(focal.add(vec3(
                    r.mul(phiSin).mul(cos(theta)),
                    r.mul(phiSin).mul(sin(theta)),
                    r.mul(phiCos),
                )));
                vXYZ.assign(vec3(
                    r1.sub(0.5).mul(0.6),
                    r2.sub(0.5).mul(0.6),
                    r3.sub(0.5).mul(0.4),
                ));
                age.assign(float(0.0));
            });

            // 8. Update color energy based on speed — fast particles glow brighter.
            // This is what makes impulse events visually pop (sudden bright cores).
            const energyTarget = sp.div(maxSpeed).mul(0.7).add(0.3);
            col.w.assign(col.w.add(energyTarget.sub(col.w).mul(0.12)));

            // Write back
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

    /**
     * Pushes an impulse into the active list. Replaces the oldest active
     * slot if all 8 are taken (newest event wins — looks more responsive).
     */
    pushImpulse(position, strength, dir, type = IMPULSE_TYPE.RADIAL) {
        // Find empty slot first, otherwise replace oldest (slot 0).
        let slot = -1;
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            if (this._impulsePositions[i].value.w < 0.01) {
                slot = i;
                break;
            }
        }
        if (slot < 0) slot = 0;

        this._impulsePositions[slot].value.set(position.x, position.y, position.z, strength);
        const d = dir || { x: 0, y: 0, z: 1 };
        this._impulseParams[slot].value.set(d.x, d.y, d.z, type);
    }

    /**
     * Per-frame impulse decay. Impulses are momentary — they decay to 0
     * over ~250ms so the same event doesn't keep pushing forever.
     */
    decayImpulses(delta) {
        const k = Math.exp(-delta * 4); // exponential decay, half-life ~170ms
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            const ip = this._impulsePositions[i].value;
            ip.w *= k;
            if (ip.w < 0.01) ip.w = 0;
        }
    }

    /**
     * Configure the board-repulsion zone. Pass `strength=0` to disable.
     * `center` / `halfExtents` are world-space; should be projected from the
     * actual game-board screen rect at the focal plane depth.
     */
    setBoardZone({
        center, halfExtents, strength, softness,
    } = {}) {
        if (center) this.uBoardCenter.value.copy(center);
        if (halfExtents) this.uBoardHalfExtents.value.copy(halfExtents);
        if (Number.isFinite(strength)) this.uBoardRepulsion.value = strength;
        if (Number.isFinite(softness)) this.uBoardSoftness.value = softness;
    }

    /**
     * Change the shape particles are attracted to. The morph happens
     * automatically via the running physics — setting a new shape just
     * rewrites the target buffer.
     *
     * @param {string} shapeName  - registered shape ('sphere', 'torus', 'helix',
     *                              'galaxy', 'heart', 'cube', 'star', 'wave',
     *                              'butterfly', 'ring', 'tetromino', 'free')
     * @param {object} opts       - shape-specific options (see shape-formations.js)
     * @returns {boolean}         - true if shape recognized, false if unknown
     */
    setShape(shapeName, opts = {}) {
        const ok = generateShape(shapeName, this.targetData, this.count, opts);
        if (!ok) {
            console.warn(`[FluidParticleSim] Unknown shape: ${shapeName}`);
            return false;
        }
        this.targetBuffer.needsUpdate = true;
        this.currentShape = shapeName;
        return true;
    }

    /**
     * Adjust how strongly particles are pulled to their targets.
     *   0    = free fluid (default)
     *   0.3  = soft suggestion (particles cluster around formation, still flow)
     *   0.7  = clear shape (recognizable, slight breathing)
     *   1.5  = tight formation (snaps quickly to crisp shape)
     *
     * @param {number} strength
     */
    setShapeStrength(strength) {
        this.uShapeStrength.value = Math.max(0, strength || 0);
    }

    /**
     * Tunes how much OTHER forces (gravity, board-repulsion) are dampened
     * when shape mode is active. 0 = formation totally overrides (shapes can
     * sit inside the board zone); 1 = forces stack (shapes fight to stay
     * outside board / centered). Default 0.35.
     */
    setShapeOverride(override) {
        this.uShapeOverride.value = Math.max(0, Math.min(1, override || 0));
    }

    /**
     * Per-frame uniform update.
     */
    update(delta, time, options = {}) {
        this.uDelta.value = Math.min(delta, 0.033); // cap big deltas (tab-switch)
        this.uTime.value = time;
        if (Number.isFinite(options.heat)) this.uHeat.value = options.heat;
        if (Number.isFinite(options.gravityStrength)) {
            this.uGravityStrength.value = options.gravityStrength;
        }
        if (Number.isFinite(options.turbulence)) {
            this.uTurbulence.value = options.turbulence;
        }
        if (options.focalPoint) {
            this.uFocalPoint.value.copy(options.focalPoint);
        }
        this.decayImpulses(delta);
    }

    getPositionBuffer() { return this.positionBuffer; }

    getColorBuffer() { return this.colorBuffer; }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.colorBuffer = null;
        this.targetBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.colorData = null;
        this.targetData = null;
        this._impulsePositions = null;
        this._impulseParams = null;
    }
}

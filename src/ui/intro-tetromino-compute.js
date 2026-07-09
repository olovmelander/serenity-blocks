/**
 * Intro Animation - GPU Compute Tetromino Physics
 * Handles position integration, rotation, collision detection/response,
 * and boundary checking for up to 50 tetrominos on the GPU.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    clamp,
    cos,
    float,
    fract,
    instanceIndex,
    int,
    length,
    max,
    min,
    normalize,
    sign,
    sin,
    sqrt,
    step,
    storage,
    uniform,
    uint,
    vec3,
    vec4,
} from 'three/tsl';
import {
    INTRO_TETROMINO_BLOCK_OFFSETS_FLAT,
    INTRO_TETROMINO_BLOCK_RADIUS,
    INTRO_TETROMINO_MAX_SPEED,
    INTRO_TETROMINO_ROTATION_KICK,
    clampVectorMagnitude,
} from './intro-tetromino-interactions.js';

const MAX_TETROMINOS = 50;
const MAX_ROTATION_SPEED = 0.05;

export class IntroTetrominoCompute {
    constructor() {
        this.count = MAX_TETROMINOS;
        this.activeCount = 0;
        this.spawnCursor = 0;
        this.spawnTimes = new Float32Array(MAX_TETROMINOS); // CPU-side spawn timestamps for eviction

        // Buffer layout: vec4 per tetromino
        // positionBuffer: xyz + active (1.0 or 0.0)
        // velocityBuffer: xyz + type (0-6 for I,O,T,S,Z,J,L)
        // rotationBuffer: xyz + collision flash (w)
        // rotSpeedBuffer: xyz + unused
        this.positionData = new Float32Array(MAX_TETROMINOS * 4);
        this.velocityData = new Float32Array(MAX_TETROMINOS * 4);
        this.rotationData = new Float32Array(MAX_TETROMINOS * 4);
        this.rotSpeedData = new Float32Array(MAX_TETROMINOS * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.rotationBuffer = new THREE.StorageBufferAttribute(this.rotationData, 4);
        this.rotSpeedBuffer = new THREE.StorageBufferAttribute(this.rotSpeedData, 4);

        // Block offset lookup: 7 shapes × 4 blocks × vec2 (x, y)
        // Each block is 2×2 units; offsets are block centers in local space.
        // Positions derived from actual shape outlines in createTetrominoShape().
        this.blockOffsetData = new Float32Array(INTRO_TETROMINO_BLOCK_OFFSETS_FLAT);
        const offsets = [
            // I: 8×2 horizontal bar
            [-3, 0], [-1, 0], [1, 0], [3, 0],
            // O: 4×4 square
            [-1, -1], [1, -1], [-1, 1], [1, 1],
            // T: T-shape (3 bottom + 1 center top)
            [-2, 0], [0, 0], [2, 0], [0, 2],
            // S: S-shape (2 bottom-left + 2 top-right)
            [-2, -1], [0, -1], [0, 1], [2, 1],
            // Z: Z-shape (2 bottom-right + 2 top-left)
            [0, -1], [2, -1], [-2, 1], [0, 1],
            // J: J-shape (bottom row + right column)
            [-1, -2], [1, -2], [1, 0], [1, 2],
            // L: L-shape (bottom row + left column)
            [-1, -2], [1, -2], [-1, 0], [-1, 2],
        ];
        // Scale by 0.75 to match the rendering scale factor applied in the vertex shader.
        // This ensures collision footprint aligns with what the user sees on screen.
        const renderScale = 0.75;
        for (let i = 0; i < offsets.length; i++) {
            this.blockOffsetData[i * 2] = offsets[i][0] * renderScale;
            this.blockOffsetData[i * 2 + 1] = offsets[i][1] * renderScale;
        }
        this.blockOffsetData.set(INTRO_TETROMINO_BLOCK_OFFSETS_FLAT);
        this.blockOffsetBuffer = new THREE.StorageBufferAttribute(this.blockOffsetData, 2);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uActiveCount = uniform(0);

        // Initialize all as inactive
        for (let i = 0; i < MAX_TETROMINOS; i++) {
            const i4 = i * 4;
            this.positionData[i4 + 3] = 0.0; // inactive
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.rotationBuffer.needsUpdate = true;
        this.rotSpeedBuffer.needsUpdate = true;

        this.computeNode = null;
    }

    _markSlotUpdated(buffer, slot, slotCount = 1) {
        if (!buffer || slotCount <= 0) return;

        const start = Math.max(0, slot * 4);
        const count = Math.max(0, slotCount * 4);

        if (typeof buffer.addUpdateRange === 'function') {
            buffer.addUpdateRange(start, count);
        }
        buffer.needsUpdate = true;
    }

    /**
     * Spawn a tetromino at the given position with velocity.
     * Returns the index or -1 if full.
     */
    spawn(x, y, z, vx, vy, vz, typeIndex = 0) {
        // Find an inactive slot
        let slot = -1;
        for (let i = 0; i < MAX_TETROMINOS; i++) {
            const checkIdx = (this.spawnCursor + i) % MAX_TETROMINOS;
            if (this.positionData[checkIdx * 4 + 3] < 0.5) {
                slot = checkIdx;
                break;
            }
        }
        if (slot === -1) {
            // All slots full — evict the oldest tetromino (earliest spawn time)
            let oldestTime = Infinity;
            let oldestSlot = 0;
            for (let i = 0; i < MAX_TETROMINOS; i++) {
                if (this.spawnTimes[i] < oldestTime) {
                    oldestTime = this.spawnTimes[i];
                    oldestSlot = i;
                }
            }
            slot = oldestSlot;
        }

        const i4 = slot * 4;

        // Position + active flag
        this.positionData[i4] = x;
        this.positionData[i4 + 1] = y;
        this.positionData[i4 + 2] = z;
        this.positionData[i4 + 3] = 1.0; // active

        // Velocity + type
        this.velocityData[i4] = vx;
        this.velocityData[i4 + 1] = vy;
        this.velocityData[i4 + 2] = vz;
        this.velocityData[i4 + 3] = typeIndex;

        // Random rotation
        this.rotationData[i4] = Math.random() * Math.PI * 2;
        this.rotationData[i4 + 1] = Math.random() * Math.PI * 2;
        this.rotationData[i4 + 2] = Math.random() * Math.PI * 2;
        this.rotationData[i4 + 3] = 0; // collision flash (0 = no flash)

        // Rotation speed (no radius needed — compound blocks handle collision)
        this.rotSpeedData[i4] = (Math.random() - 0.5) * 0.01;
        this.rotSpeedData[i4 + 1] = (Math.random() - 0.5) * 0.01;
        this.rotSpeedData[i4 + 2] = (Math.random() - 0.5) * 0.01;
        this.rotSpeedData[i4 + 3] = 0;

        this.activeCount = Math.min(this.activeCount + 1, MAX_TETROMINOS);
        this.spawnCursor = (slot + 1) % MAX_TETROMINOS;
        this.spawnTimes[slot] = performance.now();

        this._markSlotUpdated(this.positionBuffer, slot);
        this._markSlotUpdated(this.velocityBuffer, slot);
        this._markSlotUpdated(this.rotationBuffer, slot);
        this._markSlotUpdated(this.rotSpeedBuffer, slot);

        return slot;
    }

    /**
     * Create the compute shader for tetromino physics
     */
    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const rotations = storage(this.rotationBuffer, 'vec4', this.count);
        const rotSpeeds = storage(this.rotSpeedBuffer, 'vec4', this.count);
        const blockOffsets = storage(this.blockOffsetBuffer, 'vec2', 28); // 7 shapes × 4 blocks

        const delta = this.uDelta;
        const activeCount = this.uActiveCount;
        const maxSpeed = float(INTRO_TETROMINO_MAX_SPEED);
        const restitution = float(0.8);
        // Bounds are well beyond the visible screen so tetrominos only
        // disappear when truly off-screen, not while still visible.
        const boundX = float(130.0);
        const boundY = float(90.0);
        const boundZ = float(80.0);

        const computeTetrominoes = Fn(() => {
            const i = instanceIndex;
            const pos = positions.element(i).toVar();
            const vel = velocities.element(i).toVar();
            const rot = rotations.element(i).toVar();
            const rotSpd = rotSpeeds.element(i).toVar();

            const active = pos.w.greaterThan(float(0.5));

            If(active, () => {
                // === Position integration ===
                pos.x.addAssign(vel.x.mul(delta).mul(float(60.0)));
                pos.y.addAssign(vel.y.mul(delta).mul(float(60.0)));
                pos.z.addAssign(vel.z.mul(delta).mul(float(60.0)));

                // === Rotation integration ===
                rot.x.addAssign(rotSpd.x.mul(delta).mul(float(60.0)));
                rot.y.addAssign(rotSpd.y.mul(delta).mul(float(60.0)));
                rot.z.addAssign(rotSpd.z.mul(delta).mul(float(60.0)));

                // === Boundary check: deactivate if out of bounds ===
                const outOfBounds = abs(pos.x).greaterThan(boundX)
                    .or(abs(pos.y).greaterThan(boundY))
                    .or(abs(pos.z).greaterThan(boundZ));

                If(outOfBounds, () => {
                    pos.w.assign(float(0.0)); // deactivate
                });

                // === Compound block collision ===
                // Each tetromino = 4 blocks (2×2 each, scaled by 0.75 = 1.5×1.5 visual).
                // Block radius = 0.75 (half of 1.5 visual block size).
                const blockRadius = float(INTRO_TETROMINO_BLOCK_RADIUS);
                const blockRadiusSum = float(INTRO_TETROMINO_BLOCK_RADIUS * 2);
                const blockRadiusSumSq = float((INTRO_TETROMINO_BLOCK_RADIUS * 2) ** 2);

                // My type index for block offset lookup
                const myTypeInt = int(vel.w.add(float(0.5)));

                // My rotation (Z axis = 2D facing angle)
                const myAngle = rot.z;
                const myCos = cos(myAngle);
                const mySin = sin(myAngle);

                // Decay collision flash (stored in rot.w) each frame
                rot.w.mulAssign(float(0.92));

                Loop({
                    start: int(0), end: int(MAX_TETROMINOS), type: 'int', condition: '<',
                }, ({ i: j }) => {
                    const shouldSkip = j.equal(int(i));
                    If(shouldSkip.not(), () => {
                        const otherPos = positions.element(j).toVar();
                        const otherActive = otherPos.w.greaterThan(float(0.5));

                        If(otherActive, () => {
                            const cdx = pos.x.sub(otherPos.x);
                            const cdy = pos.y.sub(otherPos.y);
                            const cdz = pos.z.sub(otherPos.z);

                            // Z-depth gate: generous to catch screen-overlapping pieces
                            const zGate = abs(cdz).lessThan(float(15.0));

                            // Broad phase: skip if centers are too far apart
                            // Max block offset ~3 + block radius 1 = 4 per tetromino → 8 total + margin
                            const centerDistSq = cdx.mul(cdx).add(cdy.mul(cdy));
                            const broadPhase = centerDistSq.lessThan(float(225.0)); // 15×15

                            If(zGate.and(broadPhase), () => {
                                const otherRot = rotations.element(j);
                                const otherVelData = velocities.element(j);
                                const otherTypeInt = int(otherVelData.w.add(float(0.5)));

                                const otherAngle = otherRot.z;
                                const oCos = cos(otherAngle);
                                const oSin = sin(otherAngle);

                                // Accumulate collision response across all block pairs
                                const accumNx = float(0.0).toVar();
                                const accumNy = float(0.0).toVar();
                                const maxPen = float(0.0).toVar();
                                const hitCount = float(0.0).toVar();

                                // Check all 4×4 block pairs
                                Loop({
                                    start: int(0), end: int(4), type: 'int', condition: '<',
                                }, ({ i: bi }) => {
                                    // My block position (rotate local offset by my Z angle)
                                    const myBlockOff = blockOffsets.element(myTypeInt.mul(int(4)).add(bi));
                                    const myBx = myBlockOff.x.mul(myCos).sub(myBlockOff.y.mul(mySin)).add(pos.x);
                                    const myBy = myBlockOff.x.mul(mySin).add(myBlockOff.y.mul(myCos)).add(pos.y);

                                    Loop({
                                        start: int(0), end: int(4), type: 'int', condition: '<',
                                    }, ({ i: bj }) => {
                                        // Other block position (rotate by other's Z angle)
                                        const otherBlockOff = blockOffsets.element(otherTypeInt.mul(int(4)).add(bj));
                                        const oBx = otherBlockOff.x.mul(oCos).sub(otherBlockOff.y.mul(oSin)).add(otherPos.x);
                                        const oBy = otherBlockOff.x.mul(oSin).add(otherBlockOff.y.mul(oCos)).add(otherPos.y);

                                        // Circle-circle check between blocks
                                        const bdx = myBx.sub(oBx);
                                        const bdy = myBy.sub(oBy);
                                        const bDistSq = bdx.mul(bdx).add(bdy.mul(bdy));

                                        If(bDistSq.lessThan(blockRadiusSumSq), () => {
                                            const bDist = max(sqrt(bDistSq), float(0.01));
                                            const pen = blockRadiusSum.sub(bDist);

                                            // Weight the normal by penetration depth
                                            accumNx.addAssign(bdx.div(bDist).mul(pen));
                                            accumNy.addAssign(bdy.div(bDist).mul(pen));
                                            maxPen.assign(max(maxPen, pen));
                                            hitCount.addAssign(float(1.0));
                                        });
                                    });
                                });

                                // Resolve if any blocks overlap
                                If(hitCount.greaterThan(float(0.0)), () => {
                                    // Normalize accumulated collision normal
                                    const nLen = max(sqrt(accumNx.mul(accumNx).add(accumNy.mul(accumNy))), float(0.01));
                                    const nx = accumNx.div(nLen);
                                    const ny = accumNy.div(nLen);

                                    const otherVel = velocities.element(j).toVar();
                                    const rvx = vel.x.sub(otherVel.x);
                                    const rvy = vel.y.sub(otherVel.y);
                                    const velAlongNormal = rvx.mul(nx).add(rvy.mul(ny));

                                    // Resolve if approaching OR overlapping
                                    const shouldResolve = velAlongNormal.lessThan(float(0.0))
                                        .or(maxPen.greaterThan(float(0.3)));

                                    If(shouldResolve, () => {
                                        // Impulse-based response
                                        const effectiveVAL = min(velAlongNormal, float(-0.01));
                                        const impulse = float(-1.0).sub(restitution).mul(effectiveVAL).div(float(2.0));

                                        vel.x.addAssign(impulse.mul(nx));
                                        vel.y.addAssign(impulse.mul(ny));

                                        // Positional correction proportional to overlap
                                        const correction = max(maxPen.mul(float(0.35)), float(0.1));
                                        pos.x.addAssign(nx.mul(correction));
                                        pos.y.addAssign(ny.mul(correction));

                                        // Collision flash
                                        rot.w.assign(float(1.0));

                                        // Rotation perturbation
                                        const seed = float(i).add(float(j).mul(float(7.31)));
                                        const perturbX = fract(sin(seed.mul(float(12.9898))).mul(float(43758.5453))).sub(float(0.5)).mul(float(0.03));
                                        const perturbY = fract(sin(seed.mul(float(78.233))).mul(float(43758.5453))).sub(float(0.5)).mul(float(0.03));
                                        const perturbZ = fract(sin(seed.mul(float(39.425))).mul(float(43758.5453))).sub(float(0.5)).mul(float(0.03));
                                        rotSpd.x.addAssign(perturbX);
                                        rotSpd.y.addAssign(perturbY);
                                        rotSpd.z.addAssign(perturbZ);
                                    });
                                });
                            });
                        });
                    });
                });

                // === Speed clamping ===
                const speedSq = vel.x.mul(vel.x).add(vel.y.mul(vel.y)).add(vel.z.mul(vel.z));
                const maxSpeedSq = maxSpeed.mul(maxSpeed);
                const tooFast = speedSq.greaterThan(maxSpeedSq);
                If(tooFast, () => {
                    const speed = sqrt(speedSq);
                    const scale = maxSpeed.div(speed);
                    vel.x.assign(vel.x.mul(scale));
                    vel.y.assign(vel.y.mul(scale));
                    vel.z.assign(vel.z.mul(scale));
                });

                // === Rotation speed clamping ===
                const maxRot = float(MAX_ROTATION_SPEED);
                rotSpd.x.assign(clamp(rotSpd.x, maxRot.negate(), maxRot));
                rotSpd.y.assign(clamp(rotSpd.y, maxRot.negate(), maxRot));
                rotSpd.z.assign(clamp(rotSpd.z, maxRot.negate(), maxRot));
            });

            // Write back
            positions.element(i).assign(pos);
            velocities.element(i).assign(vel);
            rotations.element(i).assign(rot);
            rotSpeeds.element(i).assign(rotSpd);
        });

        this.computeNode = computeTetrominoes().compute(this.count);
        return this.computeNode;
    }

    /**
     * Update uniforms and handle spawning logic each frame
     */
    update(delta, time) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        this.uActiveCount.value = this.activeCount;
    }

    /**
     * Read back active state from position buffer (for instanced mesh visibility).
     * Returns an array of { active, x, y, z, rx, ry, rz, type } per slot.
     */
    readState() {
        const states = [];
        for (let i = 0; i < MAX_TETROMINOS; i++) {
            const i4 = i * 4;
            states.push({
                active: this.positionData[i4 + 3] > 0.5,
                x: this.positionData[i4],
                y: this.positionData[i4 + 1],
                z: this.positionData[i4 + 2],
                rx: this.rotationData[i4],
                ry: this.rotationData[i4 + 1],
                rz: this.rotationData[i4 + 2],
                type: Math.round(this.velocityData[i4 + 3]),
            });
        }
        return states;
    }

    /**
     * Count currently active tetrominos
     */
    getActiveCount() {
        let count = 0;
        for (let i = 0; i < MAX_TETROMINOS; i++) {
            if (this.positionData[i * 4 + 3] > 0.5) count++;
        }
        this.activeCount = count;
        return count;
    }

    getPositionBuffer() { return this.positionBuffer; }

    getVelocityBuffer() { return this.velocityBuffer; }

    getRotationBuffer() { return this.rotationBuffer; }

    getRotSpeedBuffer() { return this.rotSpeedBuffer; }

    static get MAX_TETROMINOS() { return MAX_TETROMINOS; }

    _copySlotFromLiveData(target, source, slot) {
        if (!target || !source) return;

        const i4 = slot * 4;
        if (source.length < i4 + 4) return;

        target[i4] = source[i4];
        target[i4 + 1] = source[i4 + 1];
        target[i4 + 2] = source[i4 + 2];
        target[i4 + 3] = source[i4 + 3];
    }

    /**
     * Apply a cursor poke to one live storage-buffer slot.
     * Used by the WebGPU renderer after an on-demand readback hit test.
     */
    applyClickImpulseToSlot(
        slot,
        liveState = {},
        impulse = {},
        rotationKick = INTRO_TETROMINO_ROTATION_KICK,
    ) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_TETROMINOS) {
            return false;
        }

        const i4 = slot * 4;
        const {
            positions,
            velocities,
            rotations,
            rotSpeeds,
        } = liveState || {};

        const positionSource = positions?.length >= i4 + 4 ? positions : this.positionData;
        if (positionSource[i4 + 3] <= 0.5) {
            return false;
        }

        this._copySlotFromLiveData(this.positionData, positions, slot);
        this._copySlotFromLiveData(this.velocityData, velocities, slot);
        this._copySlotFromLiveData(this.rotationData, rotations, slot);
        this._copySlotFromLiveData(this.rotSpeedData, rotSpeeds, slot);

        const velocity = clampVectorMagnitude({
            x: this.velocityData[i4] + (Number.isFinite(impulse?.x) ? impulse.x : 0),
            y: this.velocityData[i4 + 1] + (Number.isFinite(impulse?.y) ? impulse.y : 0),
            z: this.velocityData[i4 + 2] + (Number.isFinite(impulse?.z) ? impulse.z : 0),
        }, INTRO_TETROMINO_MAX_SPEED);

        this.velocityData[i4] = velocity.x;
        this.velocityData[i4 + 1] = velocity.y;
        this.velocityData[i4 + 2] = velocity.z;
        this.positionData[i4 + 3] = 1.0;
        this.rotationData[i4 + 3] = 1.0;

        const kick = Math.max(0, Number.isFinite(rotationKick) ? rotationKick : INTRO_TETROMINO_ROTATION_KICK);
        this.rotSpeedData[i4] = Math.max(
            -MAX_ROTATION_SPEED,
            Math.min(MAX_ROTATION_SPEED, this.rotSpeedData[i4] + (Math.random() - 0.5) * kick * 2),
        );
        this.rotSpeedData[i4 + 1] = Math.max(
            -MAX_ROTATION_SPEED,
            Math.min(MAX_ROTATION_SPEED, this.rotSpeedData[i4 + 1] + (Math.random() - 0.5) * kick * 2),
        );
        this.rotSpeedData[i4 + 2] = Math.max(
            -MAX_ROTATION_SPEED,
            Math.min(MAX_ROTATION_SPEED, this.rotSpeedData[i4 + 2] + (Math.random() - 0.5) * kick * 2),
        );

        this._markSlotUpdated(this.velocityBuffer, slot);
        this._markSlotUpdated(this.rotationBuffer, slot);
        this._markSlotUpdated(this.rotSpeedBuffer, slot);

        return true;
    }

    /**
     * Kick active tetrominos outward for warp-dismiss transitions.
     */
    applyWarpImpulse(strength = 0.5) {
        const impulse = Math.max(0, strength);
        for (let i = 0; i < MAX_TETROMINOS; i++) {
            const i4 = i * 4;
            if (this.positionData[i4 + 3] <= 0.5) continue;

            const x = this.positionData[i4];
            const y = this.positionData[i4 + 1];
            const z = this.positionData[i4 + 2];
            const len = Math.sqrt(x * x + y * y + z * z) || 1;
            const nx = x / len;
            const ny = y / len;
            const nz = z / len;

            this.velocityData[i4] += nx * impulse;
            this.velocityData[i4 + 1] += ny * impulse;
            this.velocityData[i4 + 2] += nz * impulse;

            this.rotSpeedData[i4] += (Math.random() - 0.5) * 0.04;
            this.rotSpeedData[i4 + 1] += (Math.random() - 0.5) * 0.04;
            this.rotSpeedData[i4 + 2] += (Math.random() - 0.5) * 0.04;
        }

        this._markSlotUpdated(this.velocityBuffer, 0, MAX_TETROMINOS);
        this._markSlotUpdated(this.rotSpeedBuffer, 0, MAX_TETROMINOS);
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.rotationBuffer = null;
        this.rotSpeedBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.rotationData = null;
        this.rotSpeedData = null;
    }
}

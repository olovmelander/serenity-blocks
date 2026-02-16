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
    sin,
    sqrt,
    storage,
    uniform,
    uint,
    vec3,
    vec4,
} from 'three/tsl';

const MAX_TETROMINOS = 50;

export class IntroTetrominoCompute {
    constructor() {
        this.count = MAX_TETROMINOS;
        this.activeCount = 0;
        this.spawnCursor = 0;

        // Buffer layout: vec4 per tetromino
        // positionBuffer: xyz + active (1.0 or 0.0)
        // velocityBuffer: xyz + type (0-6 for I,O,T,S,Z,J,L)
        // rotationBuffer: xyz + unused
        // rotSpeedBuffer: xyz + radius
        this.positionData = new Float32Array(MAX_TETROMINOS * 4);
        this.velocityData = new Float32Array(MAX_TETROMINOS * 4);
        this.rotationData = new Float32Array(MAX_TETROMINOS * 4);
        this.rotSpeedData = new Float32Array(MAX_TETROMINOS * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.rotationBuffer = new THREE.StorageBufferAttribute(this.rotationData, 4);
        this.rotSpeedBuffer = new THREE.StorageBufferAttribute(this.rotSpeedData, 4);

        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uActiveCount = uniform(0);

        // Initialize all as inactive
        for (let i = 0; i < MAX_TETROMINOS; i++) {
            const i4 = i * 4;
            this.positionData[i4 + 3] = 0.0; // inactive
            this.rotSpeedData[i4 + 3] = 3.0; // default radius
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
        if (slot === -1) return -1; // all slots full

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
        this.rotationData[i4 + 3] = 0;

        // Rotation speed + collision radius
        this.rotSpeedData[i4] = (Math.random() - 0.5) * 0.01;
        this.rotSpeedData[i4 + 1] = (Math.random() - 0.5) * 0.01;
        this.rotSpeedData[i4 + 2] = (Math.random() - 0.5) * 0.01;
        this.rotSpeedData[i4 + 3] = 3.0; // collision radius

        this.activeCount = Math.min(this.activeCount + 1, MAX_TETROMINOS);
        this.spawnCursor = (slot + 1) % MAX_TETROMINOS;

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

        const delta = this.uDelta;
        const activeCount = this.uActiveCount;
        const maxSpeed = float(0.2);
        const restitution = float(0.8);
        const boundX = float(90.0);
        const boundY = float(60.0);
        const boundZ = float(50.0);

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

                // === Collision detection with all other active tetrominos ===
                // O(n^2) but n is small (max 50)
                const myRadius = rotSpd.w;

                Loop({ start: int(0), end: int(MAX_TETROMINOS), type: 'int', condition: '<' }, ({ i: j }) => {
                    const shouldSkip = j.equal(int(i));
                    If(shouldSkip.not(), () => {
                        const otherPos = positions.element(j).toVar();
                        const otherActive = otherPos.w.greaterThan(float(0.5));

                        If(otherActive, () => {
                            const dx = pos.x.sub(otherPos.x);
                            const dy = pos.y.sub(otherPos.y);
                            const dz = pos.z.sub(otherPos.z);
                            const distSq = dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));

                            const otherRotSpd = rotSpeeds.element(j);
                            const otherRadius = otherRotSpd.w;
                            const radiusSum = myRadius.add(otherRadius);
                            const radiusSumSq = radiusSum.mul(radiusSum);

                            const colliding = distSq.lessThan(radiusSumSq);
                            If(colliding, () => {
                                const dist = max(sqrt(distSq), float(0.001));
                                const nx = dx.div(dist);
                                const ny = dy.div(dist);
                                const nz = dz.div(dist);

                                const otherVel = velocities.element(j).toVar();

                                const rvx = vel.x.sub(otherVel.x);
                                const rvy = vel.y.sub(otherVel.y);
                                const rvz = vel.z.sub(otherVel.z);

                                const velAlongNormal = rvx.mul(nx).add(rvy.mul(ny)).add(rvz.mul(nz));

                                // Only resolve if approaching
                                const approaching = velAlongNormal.lessThan(float(0.0));
                                If(approaching, () => {
                                    const jImpulse = float(-1.0).sub(restitution).mul(velAlongNormal).div(float(2.0));

                                    vel.x.addAssign(jImpulse.mul(nx));
                                    vel.y.addAssign(jImpulse.mul(ny));
                                    vel.z.addAssign(jImpulse.mul(nz));

                                    // Positional correction to prevent overlap
                                    const penetration = radiusSum.sub(dist);
                                    const correction = penetration.mul(float(0.4)); // half for each
                                    pos.x.addAssign(nx.mul(correction));
                                    pos.y.addAssign(ny.mul(correction));
                                    pos.z.addAssign(nz.mul(correction));

                                    // Perturb rotation on collision
                                    const seed = float(i).add(float(j).mul(float(7.31)));
                                    const perturbX = fract(sin(seed.mul(float(12.9898))).mul(float(43758.5453))).sub(float(0.5)).mul(float(0.01));
                                    const perturbY = fract(sin(seed.mul(float(78.233))).mul(float(43758.5453))).sub(float(0.5)).mul(float(0.01));
                                    const perturbZ = fract(sin(seed.mul(float(39.425))).mul(float(43758.5453))).sub(float(0.5)).mul(float(0.01));
                                    rotSpd.x.addAssign(perturbX);
                                    rotSpd.y.addAssign(perturbY);
                                    rotSpd.z.addAssign(perturbZ);
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
                const maxRot = float(0.05);
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

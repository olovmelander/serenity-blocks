import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    clamp,
    cos,
    float,
    instanceIndex,
    mix,
    sin,
    storage,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

export const WOLFHOUR_COMPUTE_BUDGETS = Object.freeze({
    Minimal: {
        enableCompute: false,
        computeStarTwinkle: false,
        spiritCount: 0,
        ambientParticles: 0,
        debrisPerCrash: 40,
        meteorTrailSegments: 40,
    },
    Low: {
        enableCompute: false,
        computeStarTwinkle: false,
        spiritCount: 0,
        ambientParticles: 0,
        debrisPerCrash: 40,
        meteorTrailSegments: 40,
    },
    Medium: {
        enableCompute: true,
        computeStarTwinkle: false,
        spiritCount: 24,
        ambientParticles: 600,
        debrisPerCrash: 80,
        meteorTrailSegments: 56,
    },
    High: {
        enableCompute: true,
        computeStarTwinkle: false,
        spiritCount: 48,
        ambientParticles: 1000,
        debrisPerCrash: 96,
        meteorTrailSegments: 56,
    },
    Ultra: {
        enableCompute: true,
        computeStarTwinkle: false,
        spiritCount: 72,
        ambientParticles: 1600,
        debrisPerCrash: 128,
        meteorTrailSegments: 60,
    },
    Extreme: {
        enableCompute: true,
        computeStarTwinkle: false,
        spiritCount: 96,
        ambientParticles: 3000,
        debrisPerCrash: 150,
        meteorTrailSegments: 64,
    },
});

export function getWolfhourComputeBudget(qualityName) {
    const budget = WOLFHOUR_COMPUTE_BUDGETS[qualityName] || WOLFHOUR_COMPUTE_BUDGETS.High;
    return { ...budget };
}

function ensureRandom(randomFn) {
    return typeof randomFn === 'function' ? randomFn : Math.random;
}

export class WolfhourStarTwinkleCompute {
    constructor(count, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = ensureRandom(randomFn);

        this.stateData = new Float32Array(this.count * 4);
        this.stateBuffer = new THREE.StorageBufferAttribute(this.stateData, 4);

        this.uDelta = uniform(0);
        this.uTwinkleScale = uniform(1.0);

        this.computeNode = null;
        this.initializeState();
    }

    initializeState() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.stateData[i4] = this.random() * Math.PI * 2; // phase
            this.stateData[i4 + 1] = 0.8 + this.random() * 2.8; // speed
            this.stateData[i4 + 2] = 0.75 + this.random() * 0.35; // color temp
            this.stateData[i4 + 3] = this.random(); // diffraction mask seed
        }
        this.stateBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const state = storage(this.stateBuffer, 'vec4', this.count);
        const delta = this.uDelta;
        const twinkleScale = this.uTwinkleScale;

        const computeTwinkle = Fn(() => {
            const index = instanceIndex;
            const current = state.element(index).toVar();

            const phase = current.x.add(current.y.mul(delta).mul(twinkleScale));
            current.x.assign(phase);
            current.z.assign(clamp(current.z.add(sin(phase.mul(0.13)).mul(0.0012)), 0.65, 1.15));

            state.element(index).assign(current);
        });

        this.computeNode = computeTwinkle().compute(this.count);
        return this.computeNode;
    }

    update(delta, options = {}) {
        this.uDelta.value = delta;
        if (Number.isFinite(options.twinkleScale)) {
            this.uTwinkleScale.value = options.twinkleScale;
        }
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

export class WolfhourSpiritCompute {
    constructor(count, bounds = {}, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = ensureRandom(randomFn);

        this.bounds = {
            xMin: bounds.xMin ?? -900,
            xMax: bounds.xMax ?? 900,
            yMin: bounds.yMin ?? -500,
            yMax: bounds.yMax ?? 550,
            zMin: bounds.zMin ?? -1200,
            zMax: bounds.zMax ?? 250,
        };

        this.positionData = new Float32Array(this.count * 4);
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uSurge = uniform(0);
        this.uScatter = uniform(0);
        this.uXMin = uniform(this.bounds.xMin);
        this.uXMax = uniform(this.bounds.xMax);
        this.uYMin = uniform(this.bounds.yMin);
        this.uYMax = uniform(this.bounds.yMax);
        this.uZMin = uniform(this.bounds.zMin);
        this.uZMax = uniform(this.bounds.zMax);

        this.computeNode = null;
    }

    setBounds(bounds = {}) {
        this.bounds = {
            ...this.bounds,
            ...bounds,
        };
        this.uXMin.value = this.bounds.xMin;
        this.uXMax.value = this.bounds.xMax;
        this.uYMin.value = this.bounds.yMin;
        this.uYMax.value = this.bounds.yMax;
        this.uZMin.value = this.bounds.zMin;
        this.uZMax.value = this.bounds.zMax;
    }

    setInitialState(positions, phases, speeds, sizes) {
        for (let i = 0; i < this.count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions?.[i3] ?? (this.random() - 0.5) * 1400;
            this.positionData[i4 + 1] = positions?.[i3 + 1] ?? (120 + this.random() * 380);
            this.positionData[i4 + 2] = positions?.[i3 + 2] ?? (-200 - this.random() * 700);
            this.positionData[i4 + 3] = 1.0;

            this.miscData[i4] = phases?.[i] ?? (this.random() * Math.PI * 2);
            this.miscData[i4 + 1] = speeds?.[i] ?? (0.5 + this.random() * 1.0);
            this.miscData[i4 + 2] = sizes?.[i] ?? (60 + this.random() * 60);
            this.miscData[i4 + 3] = this.random();
        }

        this.positionBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const misc = storage(this.miscBuffer, 'vec4', this.count);

        const time = this.uTime;
        const delta = this.uDelta;
        const surge = this.uSurge;
        const scatter = this.uScatter;

        const xMin = this.uXMin;
        const xMax = this.uXMax;
        const yMin = this.uYMin;
        const yMax = this.uYMax;
        const zMin = this.uZMin;
        const zMax = this.uZMax;

        const xSpan = xMax.sub(xMin);
        const ySpan = yMax.sub(yMin);
        const zSpan = zMax.sub(zMin);

        const computeSpirit = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const props = misc.element(index).toVar();

            const phase = props.x;
            const speed = props.y;
            const seed = props.w;

            const t = time.mul(speed).add(phase);
            const drift = vec3(
                sin(t).mul(9.0),
                cos(t.mul(0.65).add(seed.mul(6.283185))).mul(6.0),
                sin(t.mul(0.5).add(seed.mul(3.14159))).mul(7.0),
            );

            pos.xyz.addAssign(drift.mul(delta));
            pos.y.addAssign(float(5.0).mul(delta));

            const radial = vec3(pos.x, 0.0, pos.z);
            const radialLength = abs(radial.x).add(abs(radial.z)).add(0.001);
            const radialDir = radial.div(radialLength);
            pos.x.addAssign(radialDir.x.mul(scatter).mul(120.0).mul(delta));
            pos.z.addAssign(radialDir.z.mul(scatter).mul(120.0).mul(delta));
            pos.y.addAssign(surge.mul(26.0).mul(delta));

            If(pos.x.greaterThan(xMax), () => {
                pos.x.assign(pos.x.sub(xSpan));
            });
            If(pos.x.lessThan(xMin), () => {
                pos.x.assign(pos.x.add(xSpan));
            });
            If(pos.y.greaterThan(yMax), () => {
                pos.y.assign(pos.y.sub(ySpan));
            });
            If(pos.y.lessThan(yMin), () => {
                pos.y.assign(pos.y.add(ySpan));
            });
            If(pos.z.greaterThan(zMax), () => {
                pos.z.assign(pos.z.sub(zSpan));
            });
            If(pos.z.lessThan(zMin), () => {
                pos.z.assign(pos.z.add(zSpan));
            });

            positions.element(index).assign(pos);
        });

        this.computeNode = computeSpirit().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        if (Number.isFinite(options.surge)) this.uSurge.value = options.surge;
        if (Number.isFinite(options.scatter)) this.uScatter.value = options.scatter;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.miscData = null;
    }
}

export class WolfhourMeteorTrailCompute {
    constructor(segmentCount) {
        this.count = Math.max(2, Math.floor(segmentCount));

        this.positionData = new Float32Array(this.count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);

        this.uHeadX = uniform(0);
        this.uHeadY = uniform(0);
        this.uHeadZ = uniform(0);
        this.uAngle = uniform(0);
        this.uDirection = uniform(1);
        this.uTrailLength = uniform(150);

        this.uMode = uniform(0); // 0 linear, 1 target interpolation
        this.uStartX = uniform(0);
        this.uStartY = uniform(0);
        this.uTargetX = uniform(0);
        this.uTargetY = uniform(0);
        this.uProgress = uniform(0);

        this.computeNode = null;
        this.reset();
    }

    reset() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -1500;
            this.positionData[i4 + 3] = 1;
        }
        this.positionBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);

        const headX = this.uHeadX;
        const headY = this.uHeadY;
        const headZ = this.uHeadZ;
        const angle = this.uAngle;
        const direction = this.uDirection;
        const trailLength = this.uTrailLength;

        const mode = this.uMode;
        const startX = this.uStartX;
        const startY = this.uStartY;
        const targetX = this.uTargetX;
        const targetY = this.uTargetY;
        const progress = this.uProgress;
        const countMinusOne = float(Math.max(1, this.count - 1));

        const computeTrail = Fn(() => {
            const index = instanceIndex;
            const idx = float(index);
            const t = idx.div(countMinusOne);

            const eased = progress.mul(progress);
            const headTX = mix(startX, targetX, eased);
            const headTY = mix(startY, targetY, eased);
            const hx = headX.toVar();
            const hy = headY.toVar();
            If(mode.greaterThan(0.5), () => {
                hx.assign(headTX);
                hy.assign(headTY);
            });

            const offset = t.mul(trailLength);
            const x = hx.sub(cos(angle).mul(offset).mul(direction));
            const y = hy.sub(sin(angle).mul(offset));

            positions.element(index).assign(vec4(x, y, headZ, 1.0));
        });

        this.computeNode = computeTrail().compute(this.count);
        return this.computeNode;
    }

    updateLinear(params = {}) {
        this.uMode.value = 0;
        if (Number.isFinite(params.headX)) this.uHeadX.value = params.headX;
        if (Number.isFinite(params.headY)) this.uHeadY.value = params.headY;
        if (Number.isFinite(params.headZ)) this.uHeadZ.value = params.headZ;
        if (Number.isFinite(params.angle)) this.uAngle.value = params.angle;
        if (Number.isFinite(params.direction)) this.uDirection.value = params.direction;
        if (Number.isFinite(params.trailLength)) this.uTrailLength.value = params.trailLength;
    }

    updateTarget(params = {}) {
        this.uMode.value = 1;
        if (Number.isFinite(params.headZ)) this.uHeadZ.value = params.headZ;
        if (Number.isFinite(params.startX)) this.uStartX.value = params.startX;
        if (Number.isFinite(params.startY)) this.uStartY.value = params.startY;
        if (Number.isFinite(params.targetX)) this.uTargetX.value = params.targetX;
        if (Number.isFinite(params.targetY)) this.uTargetY.value = params.targetY;
        if (Number.isFinite(params.progress)) this.uProgress.value = params.progress;
        if (Number.isFinite(params.angle)) this.uAngle.value = params.angle;
        if (Number.isFinite(params.direction)) this.uDirection.value = params.direction;
        if (Number.isFinite(params.trailLength)) this.uTrailLength.value = params.trailLength;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.positionData = null;
    }
}

export class WolfhourDebrisCompute {
    constructor(count, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = ensureRandom(randomFn);

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uDelta = uniform(0);
        this.uGravity = uniform(-360.0);
        this.uDrag = uniform(0.985);

        this.computeNode = null;
        this.reset();
    }

    reset() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 1;

            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;

            // size, seed, life, active
            this.miscData[i4] = 20;
            this.miscData[i4 + 1] = this.random();
            this.miscData[i4 + 2] = 0;
            this.miscData[i4 + 3] = 0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    setInitialState(positions, velocities, sizes, rotations) {
        for (let i = 0; i < this.count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions?.[i3] ?? 0;
            this.positionData[i4 + 1] = positions?.[i3 + 1] ?? 0;
            this.positionData[i4 + 2] = positions?.[i3 + 2] ?? -900;
            this.positionData[i4 + 3] = 1;

            this.velocityData[i4] = velocities?.[i3] ?? 0;
            this.velocityData[i4 + 1] = velocities?.[i3 + 1] ?? 0;
            this.velocityData[i4 + 2] = velocities?.[i3 + 2] ?? 0;
            this.velocityData[i4 + 3] = 0;

            this.miscData[i4] = sizes?.[i] ?? (12 + this.random() * 20);
            this.miscData[i4 + 1] = Number.isFinite(rotations?.[i])
                ? ((((rotations[i] / (Math.PI * 2)) % 1) + 1) % 1)
                : this.random();
            this.miscData[i4 + 2] = 1.0;
            this.miscData[i4 + 3] = 1.0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const misc = storage(this.miscBuffer, 'vec4', this.count);

        const delta = this.uDelta;
        const gravity = this.uGravity;
        const drag = this.uDrag;

        const computeDebris = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const props = misc.element(index).toVar();

            const active = props.w.greaterThan(0.5);
            If(active, () => {
                vel.y.addAssign(gravity.mul(delta));
                vel.xyz.mulAssign(drag);
                pos.xyz.addAssign(vel.xyz.mul(delta));

                props.z.subAssign(delta.mul(0.23));

                const dead = props.z.lessThanEqual(0.0);
                If(dead, () => {
                    props.z.assign(0.0);
                    props.w.assign(0.0);
                    pos.z.assign(-9999.0);
                });
            });

            positions.element(index).assign(pos);
            velocities.element(index).assign(vel);
            misc.element(index).assign(props);
        });

        this.computeNode = computeDebris().compute(this.count);
        return this.computeNode;
    }

    update(delta, options = {}) {
        this.uDelta.value = delta;
        if (Number.isFinite(options.gravity)) this.uGravity.value = options.gravity;
        if (Number.isFinite(options.drag)) this.uDrag.value = options.drag;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.miscData = null;
    }
}

export class WolfhourMeteorTrailBatchCompute {
    constructor(maxTrails, segmentsPerTrail) {
        this.maxTrails = Math.max(1, Math.floor(maxTrails));
        this.segmentsPerTrail = Math.max(2, Math.floor(segmentsPerTrail));
        this.count = this.maxTrails * this.segmentsPerTrail;

        this.positionData = new Float32Array(this.count * 4);
        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.slotActive = new Uint8Array(this.maxTrails);
        this.slotCursor = 0;

        this.computeNode = null;
        this.reset();
    }

    reset() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 1;
        }
        this.slotActive.fill(0);
        this.positionBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);

        const noopCompute = Fn(() => {
            const index = instanceIndex;
            const current = positions.element(index).toVar();
            positions.element(index).assign(current);
        });

        this.computeNode = noopCompute().compute(this.count);
        return this.computeNode;
    }

    isValidSlot(slot) {
        return Number.isInteger(slot) && slot >= 0 && slot < this.maxTrails;
    }

    getSlotOffset(slot) {
        return slot * this.segmentsPerTrail;
    }

    acquireSlot() {
        for (let scan = 0; scan < this.maxTrails; scan += 1) {
            const slot = (this.slotCursor + scan) % this.maxTrails;
            if (this.slotActive[slot] !== 1) {
                this.slotActive[slot] = 1;
                this.slotCursor = (slot + 1) % this.maxTrails;
                this.clearSlot(slot);
                return slot;
            }
        }
        return -1;
    }

    clearSlot(slot) {
        if (!this.isValidSlot(slot)) return;
        const offset = this.getSlotOffset(slot);
        for (let i = 0; i < this.segmentsPerTrail; i += 1) {
            const i4 = (offset + i) * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 1;
        }
        this.positionBuffer.needsUpdate = true;
    }

    releaseSlot(slot) {
        if (!this.isValidSlot(slot)) return;
        this.slotActive[slot] = 0;
        this.clearSlot(slot);
    }

    setLinearTrailState(slot, params = {}) {
        if (!this.isValidSlot(slot) || this.slotActive[slot] !== 1) return false;

        const headX = Number.isFinite(params.headX) ? params.headX : 0;
        const headY = Number.isFinite(params.headY) ? params.headY : 0;
        const headZ = Number.isFinite(params.headZ) ? params.headZ : -1200;
        const angle = Number.isFinite(params.angle) ? params.angle : 0;
        const direction = Number.isFinite(params.direction) ? params.direction : 1;
        const trailLength = Number.isFinite(params.trailLength) ? params.trailLength : 150;
        const denom = Math.max(1, this.segmentsPerTrail - 1);
        const offset = this.getSlotOffset(slot);

        for (let i = 0; i < this.segmentsPerTrail; i += 1) {
            const t = i / denom;
            const lengthOffset = t * trailLength;
            const i4 = (offset + i) * 4;
            this.positionData[i4] = headX - Math.cos(angle) * lengthOffset * direction;
            this.positionData[i4 + 1] = headY - Math.sin(angle) * lengthOffset;
            this.positionData[i4 + 2] = headZ;
            this.positionData[i4 + 3] = 1;
        }
        this.positionBuffer.needsUpdate = true;
        return true;
    }

    setTargetTrailState(slot, params = {}) {
        if (!this.isValidSlot(slot) || this.slotActive[slot] !== 1) return false;

        const startX = Number.isFinite(params.startX) ? params.startX : 0;
        const startY = Number.isFinite(params.startY) ? params.startY : 0;
        const targetX = Number.isFinite(params.targetX) ? params.targetX : 0;
        const targetY = Number.isFinite(params.targetY) ? params.targetY : 0;
        const progress = Number.isFinite(params.progress) ? params.progress : 0;
        const headZ = Number.isFinite(params.headZ) ? params.headZ : -1200;
        const angle = Number.isFinite(params.angle) ? params.angle : 0;
        const direction = Number.isFinite(params.direction) ? params.direction : 1;
        const trailLength = Number.isFinite(params.trailLength) ? params.trailLength : 150;
        const eased = progress * progress;
        const resolvedHeadX = startX + (targetX - startX) * eased;
        const resolvedHeadY = startY + (targetY - startY) * eased;

        return this.setLinearTrailState(slot, {
            headX: resolvedHeadX,
            headY: resolvedHeadY,
            headZ,
            angle,
            direction,
            trailLength,
        });
    }

    update() {
        // CPU-driven updates happen via setLinearTrailState/setTargetTrailState.
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    hasActiveSlots() {
        return this.slotActive?.some((value) => value === 1) === true;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.positionData = null;
        this.slotActive = null;
    }
}

export class WolfhourDebrisBatchCompute {
    constructor(maxCrashSlots, debrisPerCrash, randomFn = Math.random) {
        this.maxCrashSlots = Math.max(1, Math.floor(maxCrashSlots));
        this.debrisPerCrash = Math.max(1, Math.floor(debrisPerCrash));
        this.count = this.maxCrashSlots * this.debrisPerCrash;
        this.random = ensureRandom(randomFn);

        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.miscData = new Float32Array(this.count * 4);
        this.slotActive = new Uint8Array(this.maxCrashSlots);
        this.slotCursor = 0;

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.velocityBuffer = new THREE.StorageBufferAttribute(this.velocityData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.computeNode = null;
        this.reset();
    }

    reset() {
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 1;

            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;

            // x=size, y=seed, z=life, w=active
            this.miscData[i4] = 16;
            this.miscData[i4 + 1] = this.random();
            this.miscData[i4 + 2] = 0;
            this.miscData[i4 + 3] = 0;
        }
        this.slotActive.fill(0);

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);

        const noopCompute = Fn(() => {
            const index = instanceIndex;
            const current = positions.element(index).toVar();
            positions.element(index).assign(current);
        });

        this.computeNode = noopCompute().compute(this.count);
        return this.computeNode;
    }

    isValidSlot(slot) {
        return Number.isInteger(slot) && slot >= 0 && slot < this.maxCrashSlots;
    }

    getSlotOffset(slot) {
        return slot * this.debrisPerCrash;
    }

    acquireSlot() {
        for (let scan = 0; scan < this.maxCrashSlots; scan += 1) {
            const slot = (this.slotCursor + scan) % this.maxCrashSlots;
            if (this.slotActive[slot] !== 1) {
                this.slotActive[slot] = 1;
                this.slotCursor = (slot + 1) % this.maxCrashSlots;
                this.clearSlot(slot);
                return slot;
            }
        }
        return -1;
    }

    clearSlot(slot) {
        if (!this.isValidSlot(slot)) return;
        const offset = this.getSlotOffset(slot);
        for (let i = 0; i < this.debrisPerCrash; i += 1) {
            const i4 = (offset + i) * 4;
            this.positionData[i4] = 0;
            this.positionData[i4 + 1] = 0;
            this.positionData[i4 + 2] = -9999;
            this.positionData[i4 + 3] = 1;
            this.velocityData[i4] = 0;
            this.velocityData[i4 + 1] = 0;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = 0;
            this.miscData[i4 + 2] = 0;
            this.miscData[i4 + 3] = 0;
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    releaseSlot(slot) {
        if (!this.isValidSlot(slot)) return;
        this.slotActive[slot] = 0;
        this.clearSlot(slot);
    }

    triggerDebrisSlot(slot, positions, velocities, sizes, rotations) {
        if (!this.isValidSlot(slot) || this.slotActive[slot] !== 1) return false;

        const offset = this.getSlotOffset(slot);
        for (let i = 0; i < this.debrisPerCrash; i += 1) {
            const i3 = i * 3;
            const i4 = (offset + i) * 4;

            this.positionData[i4] = positions?.[i3] ?? 0;
            this.positionData[i4 + 1] = positions?.[i3 + 1] ?? 0;
            this.positionData[i4 + 2] = positions?.[i3 + 2] ?? -1200;
            this.positionData[i4 + 3] = 1;

            this.velocityData[i4] = velocities?.[i3] ?? ((this.random() - 0.5) * 240);
            this.velocityData[i4 + 1] = velocities?.[i3 + 1] ?? (180 + this.random() * 220);
            this.velocityData[i4 + 2] = velocities?.[i3 + 2] ?? ((this.random() - 0.5) * 120);
            this.velocityData[i4 + 3] = 0;

            this.miscData[i4] = sizes?.[i] ?? (10 + this.random() * 18);
            this.miscData[i4 + 1] = Number.isFinite(rotations?.[i])
                ? ((((rotations[i] / (Math.PI * 2)) % 1) + 1) % 1)
                : this.random();
            this.miscData[i4 + 2] = 1.0;
            this.miscData[i4 + 3] = 1.0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
        return true;
    }

    update(delta, options = {}) {
        const gravity = Number.isFinite(options.gravity) ? options.gravity : -380.0;
        const drag = Number.isFinite(options.drag) ? options.drag : 0.983;

        if (!Number.isFinite(delta) || delta <= 0) return;

        let touched = false;
        for (let slot = 0; slot < this.maxCrashSlots; slot += 1) {
            if (this.slotActive[slot] !== 1) continue;
            let hasAlive = false;
            const offset = this.getSlotOffset(slot);
            for (let i = 0; i < this.debrisPerCrash; i += 1) {
                const i4 = (offset + i) * 4;
                const active = this.miscData[i4 + 3] > 0.5;
                if (!active) continue;

                this.velocityData[i4 + 1] += gravity * delta;
                this.velocityData[i4] *= drag;
                this.velocityData[i4 + 1] *= drag;
                this.velocityData[i4 + 2] *= drag;

                this.positionData[i4] += this.velocityData[i4] * delta;
                this.positionData[i4 + 1] += this.velocityData[i4 + 1] * delta;
                this.positionData[i4 + 2] += this.velocityData[i4 + 2] * delta;

                this.miscData[i4 + 2] -= delta * 0.23;
                if (this.miscData[i4 + 2] <= 0) {
                    this.miscData[i4 + 2] = 0;
                    this.miscData[i4 + 3] = 0;
                    this.positionData[i4 + 2] = -9999;
                } else {
                    hasAlive = true;
                }
                touched = true;
            }
            if (!hasAlive) {
                this.slotActive[slot] = 0;
            }
        }

        if (touched) {
            this.positionBuffer.needsUpdate = true;
            this.velocityBuffer.needsUpdate = true;
            this.miscBuffer.needsUpdate = true;
        }
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getVelocityBuffer() {
        return this.velocityBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    hasActiveSlots() {
        return this.slotActive?.some((value) => value === 1) === true;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.miscData = null;
        this.slotActive = null;
    }
}

export class WolfhourAmbientParticleCompute {
    constructor(count, bounds = {}, randomFn = Math.random) {
        this.count = Math.max(1, Math.floor(count));
        this.random = ensureRandom(randomFn);

        this.bounds = {
            xMin: bounds.xMin ?? -1000,
            xMax: bounds.xMax ?? 1000,
            yMin: bounds.yMin ?? -700,
            yMax: bounds.yMax ?? 700,
            zMin: bounds.zMin ?? -1800,
            zMax: bounds.zMax ?? 300,
        };

        this.positionData = new Float32Array(this.count * 4);
        this.miscData = new Float32Array(this.count * 4);

        this.positionBuffer = new THREE.StorageBufferAttribute(this.positionData, 4);
        this.miscBuffer = new THREE.StorageBufferAttribute(this.miscData, 4);

        this.uTime = uniform(0);
        this.uDelta = uniform(0);
        this.uScatter = uniform(0);
        this.uSwirl = uniform(0);

        this.uXMin = uniform(this.bounds.xMin);
        this.uXMax = uniform(this.bounds.xMax);
        this.uYMin = uniform(this.bounds.yMin);
        this.uYMax = uniform(this.bounds.yMax);
        this.uZMin = uniform(this.bounds.zMin);
        this.uZMax = uniform(this.bounds.zMax);

        this.computeNode = null;
    }

    setBounds(bounds = {}) {
        this.bounds = {
            ...this.bounds,
            ...bounds,
        };
        this.uXMin.value = this.bounds.xMin;
        this.uXMax.value = this.bounds.xMax;
        this.uYMin.value = this.bounds.yMin;
        this.uYMax.value = this.bounds.yMax;
        this.uZMin.value = this.bounds.zMin;
        this.uZMax.value = this.bounds.zMax;
    }

    setInitialState(positions, sizes, phases) {
        for (let i = 0; i < this.count; i += 1) {
            const i3 = i * 3;
            const i4 = i * 4;

            this.positionData[i4] = positions?.[i3] ?? (this.random() - 0.5) * 2000;
            this.positionData[i4 + 1] = positions?.[i3 + 1] ?? (this.random() - 0.5) * 1200;
            this.positionData[i4 + 2] = positions?.[i3 + 2] ?? (-1800 + this.random() * 2000);
            this.positionData[i4 + 3] = 1.0;

            this.miscData[i4] = phases?.[i] ?? (this.random() * Math.PI * 2);
            this.miscData[i4 + 1] = sizes?.[i] ?? (4.0 + this.random() * 4.0);
            this.miscData[i4 + 2] = this.random();
            this.miscData[i4 + 3] = 0.6 + this.random() * 0.8;
        }

        this.positionBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
    }

    createComputeNode() {
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const misc = storage(this.miscBuffer, 'vec4', this.count);

        const time = this.uTime;
        const delta = this.uDelta;
        const scatter = this.uScatter;
        const swirl = this.uSwirl;

        const xMin = this.uXMin;
        const xMax = this.uXMax;
        const yMin = this.uYMin;
        const yMax = this.uYMax;
        const zMin = this.uZMin;
        const zMax = this.uZMax;

        const xSpan = xMax.sub(xMin);
        const zSpan = zMax.sub(zMin);

        const computeAmbient = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const props = misc.element(index).toVar();

            const phase = props.x;
            const seed = props.z;
            const speed = props.w;

            pos.y.addAssign(float(8.0).mul(delta).mul(speed));
            pos.x.addAssign(sin(time.mul(0.22).add(phase)).mul(9.0).mul(delta));
            pos.z.addAssign(cos(time.mul(0.18).add(seed.mul(6.283185))).mul(7.0).mul(delta));

            const swirlPhase = time.mul(0.8).add(seed.mul(6.283185));
            pos.x.addAssign(cos(swirlPhase).mul(swirl).mul(60.0).mul(delta));
            pos.z.addAssign(sin(swirlPhase).mul(swirl).mul(60.0).mul(delta));

            const scatterDir = vec3(
                cos(seed.mul(17.0).add(time.mul(1.5))),
                0.0,
                sin(seed.mul(23.0).add(time.mul(1.2))),
            );
            pos.xyz.addAssign(scatterDir.mul(scatter).mul(150.0).mul(delta));

            If(pos.x.greaterThan(xMax), () => {
                pos.x.assign(pos.x.sub(xSpan));
            });
            If(pos.x.lessThan(xMin), () => {
                pos.x.assign(pos.x.add(xSpan));
            });
            If(pos.y.greaterThan(yMax), () => {
                pos.y.assign(yMin);
            });
            If(pos.y.lessThan(yMin), () => {
                pos.y.assign(yMax);
            });
            If(pos.z.greaterThan(zMax), () => {
                pos.z.assign(pos.z.sub(zSpan));
            });
            If(pos.z.lessThan(zMin), () => {
                pos.z.assign(pos.z.add(zSpan));
            });

            positions.element(index).assign(pos);
        });

        this.computeNode = computeAmbient().compute(this.count);
        return this.computeNode;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = delta;
        this.uTime.value = time;
        if (Number.isFinite(options.scatter)) this.uScatter.value = options.scatter;
        if (Number.isFinite(options.swirl)) this.uSwirl.value = options.swirl;
    }

    getPositionBuffer() {
        return this.positionBuffer;
    }

    getMiscBuffer() {
        return this.miscBuffer;
    }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.miscBuffer = null;
        this.positionData = null;
        this.miscData = null;
    }
}

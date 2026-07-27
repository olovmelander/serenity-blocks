/* eslint-disable import/no-unresolved */
/**
 * Lunara reaction particles.
 *
 * A pooled, event-driven particle/ring system for piece locks, line clears,
 * and combo resonance. WebGPU uses storage-buffer particle state with a TSL
 * compute update; the fallback path updates the same pool on the CPU.
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import {
    Fn,
    If,
    float,
    instanceIndex,
    max,
    sin,
    storage,
    uniform,
    vec3,
} from 'three/tsl';
import { COLS, HIDDEN_ROWS, ROWS } from '../../core/constants.js';
import { readLockViewportOrigin } from '../../events/lock-origin.js';
import {
    createLunaraReactionParticleMaterialWebGPU,
    createLunaraReactionParticleMaterialWebGL,
    createLunaraHeroShardMaterialWebGPU,
    createLunaraHeroShardMaterialWebGL,
    createLunaraReactionRibbonMaterialWebGPU,
    createLunaraReactionRibbonMaterialWebGL,
    createLunaraShockwaveMaterialWebGPU,
    createLunaraShockwaveMaterialWebGL,
} from './lunara-materials.js';
import { curl3 } from './lunara-noise.js';

const PARTICLE_CAPACITY = {
    Minimal: 0,
    Low: 260,
    Medium: 520,
    High: 900,
    Ultra: 1400,
    Extreme: 1900,
};

const HERO_SHARD_CAPACITY = {
    Minimal: 0,
    Low: 32,
    Medium: 56,
    High: 96,
    Ultra: 144,
    Extreme: 208,
};

const RING_POOL_SIZE = {
    Minimal: 0,
    Low: 4,
    Medium: 6,
    High: 10,
    Ultra: 14,
    Extreme: 18,
};

const RIBBON_POOL_SIZE = {
    Minimal: 0,
    Low: 4,
    Medium: 6,
    High: 10,
    Ultra: 14,
    Extreme: 18,
};

const DEFAULT_PRIMARY_MOON_POS = new THREE.Vector3(-360, 380.4, -1968);
const DEFAULT_COMPANION_MOON_POS = new THREE.Vector3(115, 340.4, -1908);
const DEFAULT_PRIMARY_RADIUS = 210;
const DEFAULT_COMPANION_RADIUS = 97.5;

const CRYSTAL_ANCHORS = [
    {
        x: -30, z: 26, spreadX: 6, spreadZ: 5, hero: true, foreground: true,
    },
    {
        x: 34, z: 22, spreadX: 7, spreadZ: 5, hero: true, foreground: true,
    },
    {
        x: -34, z: 8, spreadX: 7, spreadZ: 7, hero: true,
    },
    {
        x: 38, z: 1, spreadX: 8, spreadZ: 8, hero: true,
    },
    {
        x: -58, z: -24, spreadX: 10, spreadZ: 8, hero: true,
    },
    {
        x: 62, z: -32, spreadX: 12, spreadZ: 10, hero: true,
    },
    {
        x: -38, z: -72, spreadX: 16, spreadZ: 15, hero: false,
    },
    {
        x: 42, z: -82, spreadX: 18, spreadZ: 14, hero: false,
    },
];

const PALETTES = {
    lock: [0x80fbff, 0xcbb8ff, 0xf1e7ff],
    line: [0xa676ff, 0x73f4ff, 0xe2d4ff],
    tetris: [0xff63bc, 0xf5e8ff, 0x7cf2ff],
    combo: [0xff78c8, 0x64ffe5, 0xc9b6ff],
    moon: [0xff5faa, 0xc78cff, 0xf8edff],
};

function clamp(value, min, maxValue) {
    return Math.max(min, Math.min(maxValue, value));
}

function makeSeededRandom(seed) {
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state <= 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function pickPaletteColor(palette, rng, warmth = 0) {
    const colors = PALETTES[palette] ?? PALETTES.line;
    const index = Math.min(colors.length - 1, Math.floor(rng() * colors.length));
    const color = new THREE.Color(colors[index]);
    if (warmth > 0) color.lerp(new THREE.Color(0xfff3ff), warmth);
    return color;
}

function normalizeEventPayload(payload = {}) {
    return payload?.detail || payload || {};
}

export class LunaraReactionParticles {
    constructor(options = {}) {
        this.scene = options.scene ?? null;
        this.renderer = options.renderer ?? null;
        this.isWebGPU = options.isWebGPU === true;
        this.useCompute = this.isWebGPU && options.useCompute === true;
        this.usesNodeMaterials = options.usesNodeMaterials ?? Boolean(
            this.isWebGPU
            || this.renderer?.isWebGPURenderer === true
            || this.renderer?.backend?.isWebGLBackend === true,
        );
        this.quality = options.quality ?? 'High';
        const fallbackScale = this.isWebGPU ? 1 : 0.5;
        const sparkBudget = Math.floor(options.capacity ?? options.preset?.reactionParticleCount ?? PARTICLE_CAPACITY[this.quality] ?? PARTICLE_CAPACITY.High);
        const heroBudget = Math.floor(options.heroCapacity ?? options.preset?.reactionHeroShardCount ?? HERO_SHARD_CAPACITY[this.quality] ?? HERO_SHARD_CAPACITY.High);
        this.capacity = Math.max(
            0,
            Math.floor(sparkBudget * fallbackScale),
        );
        this.ringCount = Math.max(0, Math.floor(options.ringCount ?? RING_POOL_SIZE[this.quality] ?? RING_POOL_SIZE.High));
        this.heroCapacity = Math.max(0, Math.floor(heroBudget * fallbackScale));
        this.ribbonCount = Math.max(0, Math.floor(options.ribbonCount ?? options.preset?.reactionRibbonCount ?? RIBBON_POOL_SIZE[this.quality] ?? RIBBON_POOL_SIZE.High));
        this.terrainSampler = typeof options.terrainSampler === 'function'
            ? options.terrainSampler
            : (() => -3.8);
        this.getCamera = typeof options.getCamera === 'function' ? options.getCamera : (() => null);
        this.getPrimaryMoonPosition = typeof options.getPrimaryMoonPosition === 'function'
            ? options.getPrimaryMoonPosition
            : (() => DEFAULT_PRIMARY_MOON_POS);
        this.getCompanionMoonPosition = typeof options.getCompanionMoonPosition === 'function'
            ? options.getCompanionMoonPosition
            : (() => DEFAULT_COMPANION_MOON_POS);
        this.primaryMoonRadius = options.primaryMoonRadius ?? DEFAULT_PRIMARY_RADIUS;
        this.companionMoonRadius = options.companionMoonRadius ?? DEFAULT_COMPANION_RADIUS;

        this.seed = options.seed ?? 55291;
        this.rng = makeSeededRandom(this.seed);
        this.cursor = 0;
        this.heroCursor = 0;
        this.ribbonCursor = 0;
        this.lastAnchorSide = 1;
        this.comboAnchorIndex = 0;

        this.positionLifeData = null;
        this.velocitySeedData = null;
        this.colorEnergyData = null;
        this.miscData = null;
        this.styleTimingData = null;
        this.renderPositionData = null;
        this.lifeData = null;
        this.energyData = null;
        this.sizeData = null;
        this.phaseData = null;
        this.colorData = null;
        this.typeData = null;
        this.delayData = null;
        this.stretchData = null;

        this.positionLifeBuffer = null;
        this.velocitySeedBuffer = null;
        this.colorEnergyBuffer = null;
        this.miscBuffer = null;
        this.styleTimingBuffer = null;
        this.computeNode = null;
        this.uTime = uniform(0);
        this.uDelta = uniform(0);

        this.geometry = null;
        this.material = null;
        this.points = null;
        this.heroGeometry = null;
        this.heroMaterial = null;
        this.heroMesh = null;
        this.heroPositionData = null;
        this.heroVelocityData = null;
        this.heroColorData = null;
        this.heroLifeData = null;
        this.heroMaxLifeData = null;
        this.heroSizeData = null;
        this.heroStretchData = null;
        this.heroDelayData = null;
        this.heroDragData = null;
        this.heroAlphaData = null;
        this.heroSeedData = null;
        this.ringGeometry = null;
        this.rings = [];
        this.ribbonGeometry = null;
        this.ribbons = [];
        this.tmpA = new THREE.Vector3();
        this.tmpB = new THREE.Vector3();
        this.tmpC = new THREE.Vector3();
        this.tmpD = new THREE.Vector3();
        this.tmpE = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();
        this.tmpQuat = new THREE.Quaternion();
    }

    init() {
        if (!this.scene) {
            return;
        }

        if (this.capacity <= 0) {
            this.createHeroShardPool();
            this.createRingPool();
            this.createRibbonPool();
            return;
        }

        this.positionLifeData = new Float32Array(this.capacity * 4);
        this.velocitySeedData = new Float32Array(this.capacity * 4);
        this.colorEnergyData = new Float32Array(this.capacity * 4);
        this.miscData = new Float32Array(this.capacity * 4);
        this.styleTimingData = new Float32Array(this.capacity * 4);

        for (let i = 0; i < this.capacity; i += 1) {
            const i4 = i * 4;
            this.positionLifeData[i4 + 1] = -9999;
            this.miscData[i4 + 2] = 1;
            this.styleTimingData[i4 + 2] = 1;
        }

        this.geometry = new THREE.BufferGeometry();

        if (this.useCompute) {
            this.positionLifeBuffer = new WEBGPU.StorageBufferAttribute(this.positionLifeData, 4);
            this.velocitySeedBuffer = new WEBGPU.StorageBufferAttribute(this.velocitySeedData, 4);
            this.colorEnergyBuffer = new WEBGPU.StorageBufferAttribute(this.colorEnergyData, 4);
            this.miscBuffer = new WEBGPU.StorageBufferAttribute(this.miscData, 4);
            this.styleTimingBuffer = new WEBGPU.StorageBufferAttribute(this.styleTimingData, 4);
            this.geometry.setAttribute('position', this.positionLifeBuffer);
            const { material } = createLunaraReactionParticleMaterialWebGPU({
                positionLifeBuffer: this.positionLifeBuffer,
                colorEnergyBuffer: this.colorEnergyBuffer,
                miscBuffer: this.miscBuffer,
                styleTimingBuffer: this.styleTimingBuffer,
                count: this.capacity,
                sizeMul: this.quality === 'Low' ? 0.82 : 1.0,
                emissiveMul: this.quality === 'Low' ? 0.82 : 1.0,
            });
            this.material = material;
            this.createComputeNode();
        } else {
            this.renderPositionData = new Float32Array(this.capacity * 3);
            this.lifeData = new Float32Array(this.capacity);
            this.energyData = new Float32Array(this.capacity);
            this.sizeData = new Float32Array(this.capacity);
            this.phaseData = new Float32Array(this.capacity);
            this.colorData = new Float32Array(this.capacity * 3);
            this.typeData = new Float32Array(this.capacity);
            this.delayData = new Float32Array(this.capacity);
            this.stretchData = new Float32Array(this.capacity);
            for (let i = 0; i < this.capacity; i += 1) {
                this.renderPositionData[i * 3 + 1] = -9999;
                this.sizeData[i] = 0;
                this.phaseData[i] = this.rng();
                this.stretchData[i] = 1;
            }
            this.geometry.setAttribute('position', new THREE.BufferAttribute(this.renderPositionData, 3));
            this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colorData, 3));
            this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lifeData, 1));
            this.geometry.setAttribute('aMaxLife', new THREE.BufferAttribute(new Float32Array(this.capacity).fill(1), 1));
            this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeData, 1));
            this.geometry.setAttribute('aEnergy', new THREE.BufferAttribute(this.energyData, 1));
            this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(this.phaseData, 1));
            this.geometry.setAttribute('aType', new THREE.BufferAttribute(this.typeData, 1));
            this.geometry.setAttribute('aDelay', new THREE.BufferAttribute(this.delayData, 1));
            this.geometry.setAttribute('aStretch', new THREE.BufferAttribute(this.stretchData, 1));
            const { material } = createLunaraReactionParticleMaterialWebGL({
                nodeCompatible: this.usesNodeMaterials,
                sizeMul: this.quality === 'Low' ? 0.78 : 1.0,
                emissiveMul: this.quality === 'Low' ? 0.82 : 1.0,
            });
            this.material = material;
        }

        this.geometry.setDrawRange(0, this.capacity);
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -400), 2600);
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 6;
        this.scene.add(this.points);
        this.createHeroShardPool();
        this.createRingPool();
        this.createRibbonPool();
    }

    createComputeNode() {
        if (!this.useCompute || !this.positionLifeBuffer) return;

        const positions = storage(this.positionLifeBuffer, 'vec4', this.capacity);
        const velocities = storage(this.velocitySeedBuffer, 'vec4', this.capacity);
        const colors = storage(this.colorEnergyBuffer, 'vec4', this.capacity);
        const misc = storage(this.miscBuffer, 'vec4', this.capacity);
        const timing = storage(this.styleTimingBuffer, 'vec4', this.capacity);
        const delta = this.uDelta;
        const time = this.uTime;

        const compute = Fn(() => {
            const idx = instanceIndex;
            const pos = positions.element(idx).toVar();
            const vel = velocities.element(idx).toVar();
            const color = colors.element(idx).toVar();
            const meta = misc.element(idx).toVar();
            const style = timing.element(idx).toVar();

            If(pos.w.greaterThan(0.0), () => {
                style.y.assign(max(style.y.sub(delta), float(0.0)));
                If(style.y.lessThan(0.001), () => {
                    const curl = curl3(vec3(pos.x, pos.y, pos.z).mul(0.018).add(vec3(0.0, time.mul(0.08), 0.0)));
                    const drag = max(style.w, float(0.0));
                    vel.x.addAssign(curl.x.mul(delta).mul(meta.w));
                    vel.y.addAssign(curl.y.mul(delta).mul(meta.w).add(float(-0.16).mul(delta)));
                    vel.z.addAssign(curl.z.mul(delta).mul(meta.w));
                    vel.x.mulAssign(max(float(0.0), float(1.0).sub(drag.mul(delta))));
                    vel.y.mulAssign(max(float(0.0), float(1.0).sub(drag.mul(delta).mul(0.65))));
                    vel.z.mulAssign(max(float(0.0), float(1.0).sub(drag.mul(delta))));

                    pos.x.addAssign(vel.x.mul(delta));
                    pos.y.addAssign(vel.y.mul(delta));
                    pos.z.addAssign(vel.z.mul(delta));
                    pos.w.assign(max(pos.w.sub(delta), float(0.0)));
                    color.w.assign(max(color.w.sub(delta.mul(0.32)), float(0.0)));
                });

                If(pos.w.lessThan(0.001), () => {
                    pos.y.assign(float(-9999.0));
                    color.w.assign(float(0.0));
                });
            });

            positions.element(idx).assign(pos);
            velocities.element(idx).assign(vel);
            colors.element(idx).assign(color);
            timing.element(idx).assign(style);
        });

        this.computeNode = compute().compute(this.capacity);
    }

    createRingPool() {
        if (!this.scene || this.ringCount <= 0) return;

        this.ringGeometry = new THREE.PlaneGeometry(1, 1);
        const factory = this.usesNodeMaterials ? createLunaraShockwaveMaterialWebGPU : createLunaraShockwaveMaterialWebGL;

        for (let i = 0; i < this.ringCount; i += 1) {
            const { material } = factory({ color: new THREE.Color(0x9be0ff), opacity: 0.7 });
            const mesh = new THREE.Mesh(this.ringGeometry, material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            mesh.renderOrder = 3;
            this.scene.add(mesh);
            this.rings.push({
                mesh,
                material,
                elapsed: 0,
                duration: 1,
                sky: false,
            });
        }
    }

    createHeroShardPool() {
        if (!this.scene || this.heroCapacity <= 0) return;

        this.heroPositionData = new Float32Array(this.heroCapacity * 3);
        this.heroVelocityData = new Float32Array(this.heroCapacity * 3);
        this.heroColorData = new Float32Array(this.heroCapacity * 3);
        this.heroLifeData = new Float32Array(this.heroCapacity);
        this.heroMaxLifeData = new Float32Array(this.heroCapacity);
        this.heroSizeData = new Float32Array(this.heroCapacity);
        this.heroStretchData = new Float32Array(this.heroCapacity);
        this.heroDelayData = new Float32Array(this.heroCapacity);
        this.heroDragData = new Float32Array(this.heroCapacity);
        this.heroAlphaData = new Float32Array(this.heroCapacity);
        this.heroSeedData = new Float32Array(this.heroCapacity);

        this.heroGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
        const colorAttr = new THREE.InstancedBufferAttribute(this.heroColorData, 3);
        const alphaAttr = new THREE.InstancedBufferAttribute(this.heroAlphaData, 1);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        alphaAttr.setUsage(THREE.DynamicDrawUsage);
        this.heroGeometry.setAttribute('aColor', colorAttr);
        this.heroGeometry.setAttribute('aAlpha', alphaAttr);

        const factory = this.usesNodeMaterials ? createLunaraHeroShardMaterialWebGPU : createLunaraHeroShardMaterialWebGL;
        const { material } = factory({
            emissiveMul: this.quality === 'Low' ? 0.82 : 1.0,
        });
        this.heroMaterial = material;
        this.heroMesh = new THREE.InstancedMesh(this.heroGeometry, this.heroMaterial, this.heroCapacity);
        this.heroMesh.frustumCulled = false;
        this.heroMesh.renderOrder = 7;
        this.heroMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.clearHeroShards();
        this.scene.add(this.heroMesh);
    }

    createRibbonPool() {
        if (!this.scene || this.ribbonCount <= 0) return;

        this.ribbonGeometry = new THREE.PlaneGeometry(1, 1, 1, 12);
        const factory = this.usesNodeMaterials ? createLunaraReactionRibbonMaterialWebGPU : createLunaraReactionRibbonMaterialWebGL;
        for (let i = 0; i < this.ribbonCount; i += 1) {
            const { material } = factory({
                colorA: new THREE.Color(0x70f4ff),
                colorB: new THREE.Color(0xff75c8),
                opacity: 0.55,
                thickness: 0.07,
                arc: 0.16,
            });
            const mesh = new THREE.Mesh(this.ribbonGeometry, material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            mesh.renderOrder = 4;
            this.scene.add(mesh);
            this.ribbons.push({
                mesh,
                material,
                elapsed: 0,
                duration: 1,
                sky: false,
                roll: 0,
            });
        }
    }

    clearHeroShards() {
        if (!this.heroMesh) return;
        this.heroCursor = 0;
        this.heroPositionData?.fill(0);
        this.heroVelocityData?.fill(0);
        this.heroLifeData?.fill(0);
        this.heroMaxLifeData?.fill(1);
        this.heroSizeData?.fill(0);
        this.heroStretchData?.fill(1);
        this.heroDelayData?.fill(0);
        this.heroDragData?.fill(0.4);
        this.heroAlphaData?.fill(0);
        this.heroSeedData?.fill(0);
        const offscreen = this.tmpMatrix.compose(
            this.tmpA.set(0, -9999, 0),
            this.tmpQuat.identity(),
            this.tmpB.set(0.001, 0.001, 0.001),
        );
        for (let i = 0; i < this.heroCapacity; i += 1) {
            this.heroMesh.setMatrixAt(i, offscreen);
        }
        this.heroMesh.instanceMatrix.needsUpdate = true;
        const alpha = this.heroGeometry?.attributes?.aAlpha;
        if (alpha) alpha.needsUpdate = true;
    }

    get qualityScale() {
        return clamp(this.capacity / PARTICLE_CAPACITY.High, 0.42, 1.75);
    }

    get heroQualityScale() {
        return clamp(this.heroCapacity / HERO_SHARD_CAPACITY.High, 0.32, 1.75);
    }

    scaledCount(count) {
        if (this.capacity <= 0) return 0;
        return Math.max(1, Math.round(count * this.qualityScale));
    }

    scaledHeroCount(count) {
        if (this.heroCapacity <= 0) return 0;
        return Math.max(1, Math.round(count * this.heroQualityScale));
    }

    markStorageDirty() {
        if (!this.useCompute) return;
        this.positionLifeBuffer.needsUpdate = true;
        this.velocitySeedBuffer.needsUpdate = true;
        this.colorEnergyBuffer.needsUpdate = true;
        this.miscBuffer.needsUpdate = true;
        this.styleTimingBuffer.needsUpdate = true;
    }

    markCpuDirty() {
        if (!this.geometry || this.useCompute) return;
        Object.values(this.geometry.attributes).forEach((attribute) => {
            attribute.needsUpdate = true;
        });
    }

    clear(options = {}) {
        if (options.resetRandom) {
            this.rng = makeSeededRandom(this.seed);
            this.lastAnchorSide = 1;
            this.comboAnchorIndex = 0;
        }
        this.cursor = 0;

        if (this.positionLifeData) {
            this.positionLifeData.fill(0);
            this.velocitySeedData?.fill(0);
            this.colorEnergyData?.fill(0);
            this.miscData?.fill(0);
            this.styleTimingData?.fill(0);
            for (let i = 0; i < this.capacity; i += 1) {
                const i4 = i * 4;
                this.positionLifeData[i4 + 1] = -9999;
                this.miscData[i4 + 2] = 1;
                this.styleTimingData[i4 + 2] = 1;
            }
            this.markStorageDirty();
        }

        if (this.renderPositionData) {
            this.renderPositionData.fill(0);
            this.lifeData?.fill(0);
            this.energyData?.fill(0);
            this.sizeData?.fill(0);
            this.colorData?.fill(0);
            this.typeData?.fill(0);
            this.delayData?.fill(0);
            this.stretchData?.fill(1);
            const maxLife = this.geometry?.attributes?.aMaxLife?.array;
            if (maxLife) maxLife.fill(1);
            for (let i = 0; i < this.capacity; i += 1) {
                this.renderPositionData[i * 3 + 1] = -9999;
            }
            this.markCpuDirty();
        }

        this.clearHeroShards();

        for (const ring of this.rings) {
            ring.mesh.visible = false;
            ring.elapsed = 0;
            ring.duration = 1;
        }
        for (const ribbon of this.ribbons) {
            ribbon.mesh.visible = false;
            ribbon.elapsed = 0;
            ribbon.duration = 1;
        }
    }

    writeParticle(index, position, velocity, color, options = {}) {
        const maxLifeValue = options.life ?? 0.8;
        const energy = options.energy ?? 0.8;
        const size = options.size ?? 5.0;
        const curlStrength = options.curl ?? 2.0;
        const type = options.type ?? 0;
        const delay = options.delay ?? 0;
        const stretch = options.stretch ?? 1;
        const drag = options.drag ?? 0.18;
        const phase = this.rng();

        const i4 = index * 4;
        this.positionLifeData[i4 + 0] = position.x;
        this.positionLifeData[i4 + 1] = position.y;
        this.positionLifeData[i4 + 2] = position.z;
        this.positionLifeData[i4 + 3] = maxLifeValue;
        this.velocitySeedData[i4 + 0] = velocity.x;
        this.velocitySeedData[i4 + 1] = velocity.y;
        this.velocitySeedData[i4 + 2] = velocity.z;
        this.velocitySeedData[i4 + 3] = phase;
        this.colorEnergyData[i4 + 0] = color.r;
        this.colorEnergyData[i4 + 1] = color.g;
        this.colorEnergyData[i4 + 2] = color.b;
        this.colorEnergyData[i4 + 3] = energy;
        this.miscData[i4 + 0] = size;
        this.miscData[i4 + 1] = phase;
        this.miscData[i4 + 2] = maxLifeValue;
        this.miscData[i4 + 3] = curlStrength;
        this.styleTimingData[i4 + 0] = type;
        this.styleTimingData[i4 + 1] = delay;
        this.styleTimingData[i4 + 2] = stretch;
        this.styleTimingData[i4 + 3] = drag;

        if (!this.useCompute) {
            const i3 = index * 3;
            this.renderPositionData[i3 + 0] = position.x;
            this.renderPositionData[i3 + 1] = position.y;
            this.renderPositionData[i3 + 2] = position.z;
            this.lifeData[index] = maxLifeValue;
            this.energyData[index] = energy;
            this.sizeData[index] = size;
            this.phaseData[index] = phase;
            this.typeData[index] = type;
            this.delayData[index] = delay;
            this.stretchData[index] = stretch;
            this.colorData[i3 + 0] = color.r;
            this.colorData[i3 + 1] = color.g;
            this.colorData[i3 + 2] = color.b;
            this.geometry.attributes.aMaxLife.array[index] = maxLifeValue;
        }
    }

    spawnParticle(position, velocity, color, options = {}) {
        if (this.capacity <= 0) return;
        const index = this.cursor;
        this.cursor = (this.cursor + 1) % this.capacity;
        this.writeParticle(index, position, velocity, color, options);
    }

    spawnCrystalFan(anchor, count, palette = 'line', intensity = 1.0) {
        if (count <= 0) return;
        const side = anchor.x >= 0 ? 1 : -1;
        const source = this.tmpA;
        const velocity = this.tmpB;
        for (let i = 0; i < count; i += 1) {
            const spread = 0.35 + this.rng() * 1.15;
            source.set(
                anchor.x + (this.rng() - 0.5) * 4.8,
                anchor.y + 0.4 + this.rng() * 3.8,
                anchor.z + (this.rng() - 0.5) * 5.4,
            );
            velocity.set(
                side * (7 + this.rng() * 18) * spread,
                (10 + this.rng() * 28) * intensity,
                (-3 + this.rng() * 15) * spread,
            );
            const color = pickPaletteColor(palette, this.rng, palette === 'tetris' ? 0.16 : 0.04);
            this.spawnParticle(source, velocity, color, {
                life: 0.46 + this.rng() * 0.46 + intensity * 0.08,
                energy: 0.56 + this.rng() * 0.34 + intensity * 0.12,
                size: 2.3 + this.rng() * 5.8 + intensity * 1.8,
                curl: 1.4 + intensity * 2.2,
            });
        }
        this.markStorageDirty();
        this.markCpuDirty();
    }

    spawnMoonBurst(origin, radius, count, palette = 'moon', intensity = 1.0, target = null) {
        if (count <= 0) return;
        const source = this.tmpA;
        const velocity = this.tmpB;
        const outward = this.tmpC;
        for (let i = 0; i < count; i += 1) {
            const angle = this.rng() * Math.PI * 2;
            const rim = radius * (0.55 + this.rng() * 0.4);
            outward.set(Math.cos(angle), Math.sin(angle), (this.rng() - 0.5) * 0.16).normalize();
            source.copy(origin).addScaledVector(outward, rim);
            if (target) {
                velocity.copy(target).sub(source).normalize().multiplyScalar(72 + this.rng() * 66);
                velocity.addScaledVector(outward, 16 + this.rng() * 26);
            } else {
                velocity.copy(outward).multiplyScalar(42 + this.rng() * 86);
                velocity.z += 18 + this.rng() * 28;
            }
            const color = pickPaletteColor(palette, this.rng, 0.12);
            this.spawnParticle(source, velocity, color, {
                life: 1.05 + this.rng() * 0.8 + intensity * 0.2,
                energy: 0.62 + this.rng() * 0.42,
                size: 18 + this.rng() * 32 + intensity * 10,
                curl: 3.2 + intensity * 2.4,
            });
        }
        this.markStorageDirty();
        this.markCpuDirty();
    }

    spawnOrbitTrail(count, intensity = 1.0) {
        const companion = this.getVectorFromGetter(this.getCompanionMoonPosition, DEFAULT_COMPANION_MOON_POS);
        const primary = this.getVectorFromGetter(this.getPrimaryMoonPosition, DEFAULT_PRIMARY_MOON_POS);
        const midpoint = this.tmpC.copy(primary).lerp(companion, 0.5);
        const tangent = this.tmpB.copy(companion).sub(primary);
        tangent.set(-tangent.y, tangent.x, tangent.z * 0.18).normalize();
        const source = this.tmpA;
        const velocity = new THREE.Vector3();

        for (let i = 0; i < count; i += 1) {
            const arc = (i / Math.max(1, count - 1) - 0.5) * Math.PI * 0.95;
            const radial = companion.clone().sub(midpoint).normalize();
            source.copy(companion)
                .addScaledVector(radial, Math.sin(arc) * this.companionMoonRadius * 0.65)
                .addScaledVector(tangent, Math.cos(arc) * this.companionMoonRadius * 0.95);
            velocity.copy(tangent).multiplyScalar(42 + this.rng() * 48).addScaledVector(radial, 18 + this.rng() * 28);
            const color = pickPaletteColor('moon', this.rng, 0.08);
            this.spawnParticle(source, velocity, color, {
                life: 0.9 + this.rng() * 0.65,
                energy: 0.62 + this.rng() * 0.28,
                size: 16 + this.rng() * 26 + intensity * 8,
                curl: 2.2 + intensity * 1.6,
                delay: (i / Math.max(1, count - 1)) * 0.28,
                type: 1.25,
                stretch: 2.2 + this.rng() * 1.8,
                drag: 0.08 + this.rng() * 0.12,
            });
        }
        this.markStorageDirty();
        this.markCpuDirty();
    }

    spawnCrystalExplosion(anchor, profile = {}) {
        const palette = profile.palette ?? 'line';
        const intensity = profile.intensity ?? 1.0;
        const sparkCount = this.scaledCount(profile.sparkCount ?? 42);
        const heroCount = this.scaledHeroCount(profile.heroCount ?? 10);
        const side = anchor.x >= 0 ? 1 : -1;
        const primary = this.getVectorFromGetter(this.getPrimaryMoonPosition, DEFAULT_PRIMARY_MOON_POS);
        const companion = this.getVectorFromGetter(this.getCompanionMoonPosition, DEFAULT_COMPANION_MOON_POS);
        const moonTarget = this.tmpD.copy(primary).lerp(companion, profile.moonBias ?? 0.44);
        const toMoon = this.tmpE.copy(moonTarget).sub(anchor).normalize();
        const source = this.tmpA;
        const velocity = this.tmpB;
        const delayBase = profile.delay ?? 0;
        const delaySpread = profile.delaySpread ?? 0.12;

        for (let i = 0; i < sparkCount; i += 1) {
            const wave = i / Math.max(1, sparkCount - 1);
            source.set(
                anchor.x + (this.rng() - 0.5) * (profile.sourceSpreadX ?? 6.8),
                anchor.y + 0.45 + this.rng() * (profile.sourceSpreadY ?? 4.4),
                anchor.z + (this.rng() - 0.5) * (profile.sourceSpreadZ ?? 6.6),
            );
            velocity.set(
                side * (16 + this.rng() * 42) * (0.72 + intensity * 0.28),
                (18 + this.rng() * 46) * intensity,
                (-10 + this.rng() * 32) * (0.7 + intensity * 0.3),
            );
            velocity.addScaledVector(toMoon, (8 + this.rng() * 24) * intensity);
            const color = pickPaletteColor(palette, this.rng, palette === 'tetris' ? 0.18 : 0.07);
            this.spawnParticle(source, velocity, color, {
                life: (profile.life ?? 0.72) + this.rng() * 0.58 + intensity * 0.08,
                energy: (profile.energy ?? 0.62) + this.rng() * 0.44 + intensity * 0.1,
                size: (profile.size ?? 3.8) + this.rng() * 8.5 + intensity * 3.2,
                curl: 2.2 + intensity * 3.1,
                delay: delayBase + wave * (profile.waveDelay ?? 0.14) + this.rng() * delaySpread,
                type: this.rng() > 0.78 ? 1.5 : 0.35,
                stretch: 0.85 + this.rng() * 1.6 + intensity * 0.35,
                drag: 0.16 + this.rng() * 0.28,
            });
        }

        for (let i = 0; i < heroCount; i += 1) {
            const wave = i / Math.max(1, heroCount - 1);
            source.set(
                anchor.x + (this.rng() - 0.5) * 4.4,
                anchor.y + 1.4 + this.rng() * 4.2,
                anchor.z + (this.rng() - 0.5) * 5.2,
            );
            velocity.set(
                side * (38 + this.rng() * 72) * (0.72 + intensity * 0.24),
                (32 + this.rng() * 68) * intensity,
                (-24 + this.rng() * 64) * (0.74 + intensity * 0.18),
            );
            velocity.addScaledVector(toMoon, (22 + this.rng() * 42) * intensity);
            const color = pickPaletteColor(palette, this.rng, 0.14);
            this.spawnHeroShard(source, velocity, color, {
                life: 0.48 + this.rng() * 0.48 + intensity * 0.08,
                size: 9 + this.rng() * 14 + intensity * 4,
                stretch: 4.8 + this.rng() * 5.8 + intensity * 1.4,
                delay: delayBase + wave * (profile.heroWaveDelay ?? 0.16) + this.rng() * delaySpread * 0.7,
                drag: 0.28 + this.rng() * 0.28,
            });
        }

        this.markStorageDirty();
        this.markCpuDirty();
    }

    spawnMoonRimCorona(origin, radius, profile = {}) {
        const sparkCount = this.scaledCount(profile.sparkCount ?? 56);
        const heroCount = this.scaledHeroCount(profile.heroCount ?? 10);
        const palette = profile.palette ?? 'moon';
        const intensity = profile.intensity ?? 1.0;
        const target = profile.target ?? null;
        const camera = this.getCamera();
        const viewDir = this.tmpC.copy(camera?.position ?? new THREE.Vector3(0, 10, 42)).sub(origin).normalize();
        const right = this.tmpD.set(viewDir.z, 0, -viewDir.x);
        if (right.lengthSq() < 0.001) right.set(1, 0, 0);
        right.normalize();
        const up = this.tmpE.crossVectors(right, viewDir).normalize();
        const source = this.tmpA;
        const velocity = this.tmpB;
        const arcStart = profile.arcStart ?? -0.35;
        const arcSpan = profile.arcSpan ?? Math.PI * 1.5;

        for (let i = 0; i < sparkCount; i += 1) {
            const wave = i / Math.max(1, sparkCount - 1);
            const angle = arcStart + wave * arcSpan + (this.rng() - 0.5) * 0.28;
            const rim = radius * (0.9 + this.rng() * 0.18);
            const rimDir = this.tmpC.copy(right).multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).normalize();
            source.copy(origin).addScaledVector(rimDir, rim);
            if (target) {
                velocity.copy(target).sub(source).normalize().multiplyScalar((62 + this.rng() * 72) * intensity);
                velocity.addScaledVector(rimDir, (12 + this.rng() * 32) * intensity);
            } else {
                velocity.copy(rimDir).multiplyScalar((48 + this.rng() * 98) * intensity);
                velocity.addScaledVector(viewDir, 18 + this.rng() * 26);
            }
            const color = pickPaletteColor(palette, this.rng, 0.16);
            this.spawnParticle(source, velocity, color, {
                life: 0.85 + this.rng() * 0.82 + intensity * 0.18,
                energy: 0.68 + this.rng() * 0.46,
                size: 14 + this.rng() * 34 + intensity * 10,
                curl: 3.8 + intensity * 2.6,
                delay: (profile.delay ?? 0) + wave * (profile.waveDelay ?? 0.24) + this.rng() * 0.07,
                type: 1.4,
                stretch: 1.3 + this.rng() * 2.2,
                drag: 0.12 + this.rng() * 0.2,
            });
        }

        for (let i = 0; i < heroCount; i += 1) {
            const wave = i / Math.max(1, heroCount - 1);
            const angle = arcStart + wave * arcSpan + (this.rng() - 0.5) * 0.2;
            const rimDir = this.tmpC.copy(right).multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).normalize();
            source.copy(origin).addScaledVector(rimDir, radius * (0.96 + this.rng() * 0.1));
            velocity.copy(target ? target.clone().sub(source).normalize() : rimDir)
                .multiplyScalar((76 + this.rng() * 86) * intensity)
                .addScaledVector(viewDir, 14 + this.rng() * 24);
            const color = pickPaletteColor(palette, this.rng, 0.18);
            this.spawnHeroShard(source, velocity, color, {
                life: 0.62 + this.rng() * 0.45,
                size: 20 + this.rng() * 24 + intensity * 8,
                stretch: 5.6 + this.rng() * 6.6,
                delay: (profile.delay ?? 0) + wave * (profile.heroWaveDelay ?? 0.18),
                drag: 0.2 + this.rng() * 0.22,
            });
        }

        this.markStorageDirty();
        this.markCpuDirty();
    }

    spawnOrbitRibbon(profile = {}) {
        const companion = this.getVectorFromGetter(this.getCompanionMoonPosition, DEFAULT_COMPANION_MOON_POS);
        const primary = this.getVectorFromGetter(this.getPrimaryMoonPosition, DEFAULT_PRIMARY_MOON_POS);
        const midpoint = primary.clone().lerp(companion, 0.64);
        this.spawnRibbon({
            position: midpoint,
            length: profile.length ?? this.companionMoonRadius * 4.9,
            width: profile.width ?? this.companionMoonRadius * 1.7,
            duration: profile.duration ?? 1.35,
            opacity: profile.opacity ?? 0.74,
            thickness: profile.thickness ?? 0.06,
            arc: profile.arc ?? 0.2,
            sky: true,
            roll: profile.roll ?? -0.28,
            colorA: profile.colorA ?? new THREE.Color(0xff78c8),
            colorB: profile.colorB ?? new THREE.Color(0x7cf2ff),
        });
    }

    spawnValleyRibbon(profile = {}) {
        const side = profile.side ?? (this.rng() > 0.5 ? 1 : -1);
        const x = profile.x ?? side * (22 + this.rng() * 16);
        const z = profile.z ?? (-16 - this.rng() * 34);
        const y = this.terrainSampler(x, z) + 0.18;
        this.spawnRibbon({
            position: new THREE.Vector3(x, y, z),
            length: profile.length ?? (78 + this.rng() * 36),
            width: profile.width ?? (12 + this.rng() * 8),
            duration: profile.duration ?? 1.05,
            opacity: profile.opacity ?? 0.42,
            thickness: profile.thickness ?? 0.05,
            arc: profile.arc ?? side * 0.18,
            ground: true,
            roll: profile.roll ?? (side * (0.22 + this.rng() * 0.22)),
            colorA: profile.colorA ?? new THREE.Color(0x7cf2ff),
            colorB: profile.colorB ?? new THREE.Color(0xcaa6ff),
        });
    }

    triggerPieceLock(payload = {}) {
        const detail = normalizeEventPayload(payload);
        const anchor = this.resolvePieceAnchor(detail.piece, detail.viewportOrigin);
        this.spawnCrystalExplosion(anchor, {
            palette: 'lock',
            sparkCount: 24,
            heroCount: 6,
            intensity: 0.72,
            life: 0.46,
            energy: 0.5,
            size: 2.6,
            delaySpread: 0.035,
            waveDelay: 0.045,
            heroWaveDelay: 0.05,
            sourceSpreadX: 3.6,
            sourceSpreadY: 2.4,
            sourceSpreadZ: 3.8,
        });
        this.spawnRing(anchor, {
            color: new THREE.Color(0x8ffbff),
            size: 34,
            duration: 0.76,
            opacity: 0.48,
            ground: true,
        });
    }

    triggerLineClear(payload = {}) {
        const detail = normalizeEventPayload(payload);
        const lineCount = clamp(Math.floor(detail.lineCount ?? detail.count ?? detail.lines ?? 1), 1, 4);
        const isTetris = lineCount >= 4;
        const palette = isTetris ? 'tetris' : 'line';
        const anchors = this.pickCrystalAnchors(isTetris ? 5 : 2);

        anchors.forEach((anchor, index) => {
            this.spawnCrystalExplosion(anchor, {
                palette,
                sparkCount: isTetris ? 54 : 34 + lineCount * 10,
                heroCount: isTetris ? 8 : 7 + lineCount * 2,
                intensity: isTetris ? 1.18 + index * 0.04 : 0.85 + lineCount * 0.14 + index * 0.06,
                life: isTetris ? 0.86 : 0.62,
                energy: isTetris ? 0.78 : 0.58,
                delay: index * (isTetris ? 0.045 : 0.075),
                delaySpread: isTetris ? 0.12 : 0.1,
                waveDelay: isTetris ? 0.22 : 0.14,
                heroWaveDelay: isTetris ? 0.18 : 0.11,
                sourceSpreadX: isTetris ? 9.0 : 6.4,
                sourceSpreadY: isTetris ? 5.6 : 4.2,
                sourceSpreadZ: isTetris ? 8.0 : 6.0,
            });
            this.spawnRing(anchor, {
                color: new THREE.Color(isTetris ? 0xff71c4 : 0x8eefff),
                size: isTetris ? 76 + index * 18 : 44 + lineCount * 14 + index * 10,
                duration: 0.95 + lineCount * 0.08,
                opacity: isTetris ? 0.52 : 0.34 + lineCount * 0.06,
                ground: true,
            });
        });

        const valleyRibbonCount = isTetris ? 3 : Math.min(2, lineCount);
        for (let i = 0; i < valleyRibbonCount; i += 1) {
            this.spawnValleyRibbon({
                side: i % 2 === 0 ? -1 : 1,
                z: isTetris ? -18 - i * 16 : -14 - i * 18,
                length: isTetris ? 118 - i * 10 : 78 + lineCount * 12,
                width: isTetris ? 20 : 12 + lineCount * 3,
                duration: isTetris ? 1.22 : 0.92,
                opacity: isTetris ? 0.48 : 0.32,
                roll: (i % 2 === 0 ? -1 : 1) * (0.18 + i * 0.08),
                colorA: new THREE.Color(0x6ff4ff),
                colorB: new THREE.Color(isTetris ? 0xff77c8 : 0xc7b4ff),
            });
        }

        if (isTetris) {
            const primary = this.getVectorFromGetter(this.getPrimaryMoonPosition, DEFAULT_PRIMARY_MOON_POS);
            const companion = this.getVectorFromGetter(this.getCompanionMoonPosition, DEFAULT_COMPANION_MOON_POS);
            const midpoint = primary.clone().lerp(companion, 0.5);
            this.spawnMoonRimCorona(primary, this.primaryMoonRadius, {
                palette: 'moon',
                sparkCount: 72,
                heroCount: 12,
                intensity: 1.15,
                delay: 0.08,
                waveDelay: 0.32,
                arcStart: -0.9,
                arcSpan: Math.PI * 1.35,
            });
            this.spawnMoonRimCorona(companion, this.companionMoonRadius, {
                palette: 'tetris',
                sparkCount: 62,
                heroCount: 10,
                intensity: 1.12,
                delay: 0.12,
                waveDelay: 0.28,
                arcStart: -0.35,
                arcSpan: Math.PI * 1.55,
            });
            this.spawnOrbitRibbon({
                duration: 1.28,
                opacity: 0.78,
                roll: -0.22,
                arc: 0.22,
            });
            this.spawnOrbitTrail(this.scaledCount(58), 1.2);
            this.spawnRing(midpoint, {
                color: new THREE.Color(0xff8bd4),
                size: this.companionMoonRadius * 2.2,
                duration: 1.35,
                opacity: 0.75,
                sky: true,
            });
        }
    }

    triggerCombo(payload = {}) {
        const detail = normalizeEventPayload(payload);
        const combo = Math.floor(detail.comboCount ?? detail.combo ?? detail.count ?? 0);
        if (combo < 2) return;

        const tier = combo >= 7 ? 3 : combo >= 4 ? 2 : 1;
        const anchors = this.pickCrystalAnchors(tier + 1);
        anchors.forEach((anchor, index) => {
            this.spawnCrystalExplosion(anchor, {
                palette: 'combo',
                sparkCount: combo >= 7 ? 52 : 24 + combo * 5,
                heroCount: combo >= 7 ? 11 : 6 + tier * 3,
                intensity: 0.85 + tier * 0.28 + index * 0.05,
                life: 0.68 + tier * 0.06,
                energy: 0.62 + tier * 0.08,
                delay: index * 0.06,
                delaySpread: 0.12,
                waveDelay: 0.18,
                heroWaveDelay: 0.16,
            });
        });

        if (combo >= 4 && combo < 7) {
            const companion = this.getVectorFromGetter(this.getCompanionMoonPosition, DEFAULT_COMPANION_MOON_POS);
            this.spawnMoonRimCorona(companion, this.companionMoonRadius * 0.82, {
                palette: 'moon',
                sparkCount: 32 + combo * 3,
                heroCount: 5,
                intensity: 0.75,
                delay: 0.05,
                waveDelay: 0.16,
                arcStart: -0.2,
                arcSpan: Math.PI * 1.0,
            });
            this.spawnOrbitRibbon({
                duration: 0.95,
                opacity: 0.5,
                width: this.companionMoonRadius * 1.25,
                length: this.companionMoonRadius * 3.1,
                roll: 0.18,
                arc: 0.14,
            });
        }

        if (combo >= 7) {
            const primary = this.getVectorFromGetter(this.getPrimaryMoonPosition, DEFAULT_PRIMARY_MOON_POS);
            const companion = this.getVectorFromGetter(this.getCompanionMoonPosition, DEFAULT_COMPANION_MOON_POS);
            const midpoint = primary.clone().lerp(companion, 0.54);
            this.spawnMoonRimCorona(primary, this.primaryMoonRadius * 0.84, {
                palette: 'combo',
                sparkCount: 72,
                heroCount: 14,
                intensity: 1.22,
                target: midpoint,
                delay: 0.06,
                waveDelay: 0.34,
                heroWaveDelay: 0.22,
                arcStart: -0.95,
                arcSpan: Math.PI * 1.5,
            });
            this.spawnMoonRimCorona(companion, this.companionMoonRadius * 0.98, {
                palette: 'moon',
                sparkCount: 68,
                heroCount: 12,
                intensity: 1.24,
                target: midpoint,
                delay: 0.1,
                waveDelay: 0.3,
                heroWaveDelay: 0.2,
                arcStart: -0.35,
                arcSpan: Math.PI * 1.62,
            });
            this.spawnOrbitRibbon({
                duration: 1.45,
                opacity: 0.82,
                length: this.companionMoonRadius * 5.5,
                width: this.companionMoonRadius * 2.0,
                roll: -0.32,
                arc: 0.24,
                colorA: new THREE.Color(0xff72c8),
                colorB: new THREE.Color(0x72ffe8),
            });
            this.spawnOrbitTrail(this.scaledCount(64), 1.32);
            this.spawnValleyRibbon({
                side: -1,
                length: 128,
                width: 22,
                opacity: 0.44,
                duration: 1.24,
                roll: -0.28,
                colorA: new THREE.Color(0x72ffe8),
                colorB: new THREE.Color(0xcdbbff),
            });
            this.spawnValleyRibbon({
                side: 1,
                length: 118,
                width: 20,
                opacity: 0.38,
                duration: 1.18,
                roll: 0.26,
                colorA: new THREE.Color(0xff78c8),
                colorB: new THREE.Color(0x86f8ff),
            });
            this.spawnRing(midpoint, {
                color: new THREE.Color(0xf2c8ff),
                size: this.primaryMoonRadius * 0.86,
                duration: 1.45,
                opacity: 0.76,
                sky: true,
            });
        }
    }

    update(deltaSeconds, time) {
        const dt = clamp(deltaSeconds, 0, 0.05);
        const u = this.material?.userData?.uniforms;
        if (u?.uTime) u.uTime.value = time;

        if (this.useCompute && this.computeNode && this.renderer) {
            this.uDelta.value = dt;
            this.uTime.value = time;
            try {
                if (typeof this.renderer.compute === 'function') {
                    this.renderer.compute(this.computeNode);
                } else if (typeof this.renderer.computeAsync === 'function') {
                    this.renderer.computeAsync(this.computeNode);
                }
            } catch (error) {
                console.warn('[LunaraReactionParticles] compute update failed:', error);
            }
        }

        this.updateCpuMirror(dt);
        this.updateHeroShards(dt);
        this.updateRings(dt);
        this.updateRibbons(dt);
    }

    updateCpuMirror(deltaSeconds) {
        if (!this.positionLifeData) return;
        let changed = false;
        for (let i = 0; i < this.capacity; i += 1) {
            const i4 = i * 4;
            let life = this.positionLifeData[i4 + 3];
            if (life <= 0) continue;
            const delay = Math.max(0, (this.styleTimingData?.[i4 + 1] ?? 0) - deltaSeconds);
            if (this.styleTimingData) this.styleTimingData[i4 + 1] = delay;
            if (delay > 0.001) {
                if (!this.useCompute) {
                    const i3 = i * 3;
                    this.renderPositionData[i3 + 0] = this.positionLifeData[i4 + 0];
                    this.renderPositionData[i3 + 1] = -9999;
                    this.renderPositionData[i3 + 2] = this.positionLifeData[i4 + 2];
                    this.delayData[i] = delay;
                    changed = true;
                }
                continue;
            }
            life = Math.max(0, life - deltaSeconds);
            const drag = Math.max(0, this.styleTimingData?.[i4 + 3] ?? 0.18);
            const dragXz = Math.max(0, 1 - drag * deltaSeconds);
            const dragY = Math.max(0, 1 - drag * deltaSeconds * 0.65);
            this.velocitySeedData[i4 + 0] *= dragXz;
            this.velocitySeedData[i4 + 1] *= dragY;
            this.velocitySeedData[i4 + 2] *= dragXz;
            this.positionLifeData[i4 + 0] += this.velocitySeedData[i4 + 0] * deltaSeconds;
            this.positionLifeData[i4 + 1] += this.velocitySeedData[i4 + 1] * deltaSeconds;
            this.positionLifeData[i4 + 2] += this.velocitySeedData[i4 + 2] * deltaSeconds;
            this.velocitySeedData[i4 + 1] -= 0.16 * deltaSeconds;
            this.colorEnergyData[i4 + 3] = Math.max(0, this.colorEnergyData[i4 + 3] - deltaSeconds * 0.32);
            this.positionLifeData[i4 + 3] = life;
            if (life <= 0.001) {
                this.positionLifeData[i4 + 1] = -9999;
                this.colorEnergyData[i4 + 3] = 0;
            }
            if (!this.useCompute) {
                const i3 = i * 3;
                this.renderPositionData[i3 + 0] = this.positionLifeData[i4 + 0];
                this.renderPositionData[i3 + 1] = this.positionLifeData[i4 + 1];
                this.renderPositionData[i3 + 2] = this.positionLifeData[i4 + 2];
                this.lifeData[i] = life;
                this.energyData[i] = this.colorEnergyData[i4 + 3];
                this.delayData[i] = delay;
                changed = true;
            }
        }
        if (changed) this.markCpuDirty();
    }

    updateHeroShards(deltaSeconds) {
        if (!this.heroMesh || !this.heroLifeData) return;
        const camera = this.getCamera();
        const cameraPos = camera?.position ?? this.tmpC.set(0, 12, 42);
        let matrixChanged = false;
        let alphaChanged = false;

        for (let i = 0; i < this.heroCapacity; i += 1) {
            const i3 = i * 3;
            let life = this.heroLifeData[i];
            let delay = this.heroDelayData[i];
            if (life <= 0 && delay <= 0) continue;

            if (delay > 0) {
                delay = Math.max(0, delay - deltaSeconds);
                this.heroDelayData[i] = delay;
                this.heroAlphaData[i] = 0;
                alphaChanged = true;
                continue;
            }

            life = Math.max(0, life - deltaSeconds);
            this.heroLifeData[i] = life;
            if (life <= 0.001) {
                this.heroAlphaData[i] = 0;
                this.heroMesh.setMatrixAt(i, this.tmpMatrix.compose(
                    this.tmpA.set(0, -9999, 0),
                    this.tmpQuat.identity(),
                    this.tmpB.set(0.001, 0.001, 0.001),
                ));
                matrixChanged = true;
                alphaChanged = true;
                continue;
            }

            const drag = Math.max(0, this.heroDragData[i]);
            const dragMul = Math.max(0, 1 - drag * deltaSeconds);
            this.heroVelocityData[i3 + 0] *= dragMul;
            this.heroVelocityData[i3 + 1] *= Math.max(0, 1 - drag * deltaSeconds * 0.6);
            this.heroVelocityData[i3 + 2] *= dragMul;
            this.heroVelocityData[i3 + 1] -= 0.24 * deltaSeconds;

            this.heroPositionData[i3 + 0] += this.heroVelocityData[i3 + 0] * deltaSeconds;
            this.heroPositionData[i3 + 1] += this.heroVelocityData[i3 + 1] * deltaSeconds;
            this.heroPositionData[i3 + 2] += this.heroVelocityData[i3 + 2] * deltaSeconds;

            const maxLifeValue = Math.max(0.001, this.heroMaxLifeData[i]);
            const lifeNorm = clamp(life / maxLifeValue, 0, 1);
            const age = 1 - lifeNorm;
            const birth = clamp(age / 0.1, 0, 1);
            const fade = Math.pow(lifeNorm, 1.35) * birth;
            const alpha = Math.min(0.92, fade * (0.42 + this.heroSeedData[i] * 0.28));
            this.heroAlphaData[i] = alpha;

            const pos = this.tmpA.set(
                this.heroPositionData[i3 + 0],
                this.heroPositionData[i3 + 1],
                this.heroPositionData[i3 + 2],
            );
            const vel = this.tmpB.set(
                this.heroVelocityData[i3 + 0],
                this.heroVelocityData[i3 + 1],
                this.heroVelocityData[i3 + 2],
            );
            const normal = this.tmpC.copy(cameraPos).sub(pos).normalize();
            const up = this.tmpD.copy(vel);
            if (up.lengthSq() < 0.0001) up.set(0, 1, 0);
            up.normalize();
            up.addScaledVector(normal, -up.dot(normal));
            if (up.lengthSq() < 0.0001) up.set(0, 1, 0).addScaledVector(normal, -normal.y).normalize();
            else up.normalize();
            const right = this.tmpE.crossVectors(up, normal).normalize();
            up.crossVectors(normal, right).normalize();

            this.tmpMatrix.makeBasis(right, up, normal);
            this.tmpQuat.setFromRotationMatrix(this.tmpMatrix);
            const baseSize = this.heroSizeData[i] * (0.62 + fade * 0.56);
            const lengthScale = baseSize * Math.max(1, this.heroStretchData[i]) * (0.82 + age * 0.35);
            const widthScale = Math.max(0.6, baseSize * 0.12);
            this.tmpMatrix.compose(pos, this.tmpQuat, this.tmpB.set(widthScale, lengthScale, 1));
            this.heroMesh.setMatrixAt(i, this.tmpMatrix);
            matrixChanged = true;
            alphaChanged = true;
        }

        if (matrixChanged) this.heroMesh.instanceMatrix.needsUpdate = true;
        if (alphaChanged && this.heroGeometry?.attributes?.aAlpha) {
            this.heroGeometry.attributes.aAlpha.needsUpdate = true;
        }
    }

    updateRings(deltaSeconds) {
        const camera = this.getCamera();
        for (const ring of this.rings) {
            if (!ring.mesh.visible) continue;
            ring.elapsed += deltaSeconds;
            const progress = clamp(ring.elapsed / ring.duration, 0, 1);
            const u = ring.material.userData?.uniforms;
            if (u?.uProgress) u.uProgress.value = progress;
            if (ring.sky && camera) ring.mesh.lookAt(camera.position);
            if (progress >= 1) ring.mesh.visible = false;
        }
    }

    updateRibbons(deltaSeconds) {
        const camera = this.getCamera();
        for (const ribbon of this.ribbons) {
            if (!ribbon.mesh.visible) continue;
            ribbon.elapsed += deltaSeconds;
            const progress = clamp(ribbon.elapsed / Math.max(0.001, ribbon.duration), 0, 1);
            const uniforms = ribbon.material.userData?.uniforms;
            if (uniforms?.uProgress) uniforms.uProgress.value = progress;
            if (ribbon.sky && camera) {
                ribbon.mesh.lookAt(camera.position);
                ribbon.mesh.rotateZ(ribbon.roll);
            }
            if (progress >= 1) ribbon.mesh.visible = false;
        }
    }

    spawnRing(position, options = {}) {
        if (this.rings.length === 0) return;
        const ring = this.rings.find((candidate) => !candidate.mesh.visible)
            ?? this.rings.reduce((oldest, candidate) => (
                candidate.elapsed > oldest.elapsed ? candidate : oldest
            ), this.rings[0]);
        const mesh = ring.mesh;
        const material = ring.material;
        const uniforms = material.userData?.uniforms;
        if (uniforms?.uColor && options.color) uniforms.uColor.value.copy(options.color);
        if (uniforms?.uOpacity) uniforms.uOpacity.value = options.opacity ?? 0.7;
        if (uniforms?.uProgress) uniforms.uProgress.value = 0;

        mesh.visible = true;
        mesh.position.copy(position);
        mesh.scale.setScalar(options.size ?? 80);
        if (options.ground) {
            mesh.rotation.set(-Math.PI / 2, 0, 0);
            ring.sky = false;
        } else {
            ring.sky = options.sky === true;
            const camera = this.getCamera();
            if (camera) mesh.lookAt(camera.position);
        }
        ring.elapsed = 0;
        ring.duration = options.duration ?? 1.1;
    }

    spawnHeroShard(position, velocity, color, options = {}) {
        if (!this.heroMesh || this.heroCapacity <= 0) return;
        const index = this.heroCursor;
        this.heroCursor = (this.heroCursor + 1) % this.heroCapacity;
        const i3 = index * 3;
        this.heroPositionData[i3 + 0] = position.x;
        this.heroPositionData[i3 + 1] = position.y;
        this.heroPositionData[i3 + 2] = position.z;
        this.heroVelocityData[i3 + 0] = velocity.x;
        this.heroVelocityData[i3 + 1] = velocity.y;
        this.heroVelocityData[i3 + 2] = velocity.z;
        this.heroColorData[i3 + 0] = color.r;
        this.heroColorData[i3 + 1] = color.g;
        this.heroColorData[i3 + 2] = color.b;
        this.heroLifeData[index] = options.life ?? 0.75;
        this.heroMaxLifeData[index] = options.life ?? 0.75;
        this.heroSizeData[index] = options.size ?? 9;
        this.heroStretchData[index] = options.stretch ?? 4.8;
        this.heroDelayData[index] = options.delay ?? 0;
        this.heroDragData[index] = options.drag ?? 0.38;
        this.heroAlphaData[index] = 0;
        this.heroSeedData[index] = this.rng();

        const colorAttr = this.heroGeometry?.attributes?.aColor;
        const alphaAttr = this.heroGeometry?.attributes?.aAlpha;
        if (colorAttr) colorAttr.needsUpdate = true;
        if (alphaAttr) alphaAttr.needsUpdate = true;
    }

    spawnRibbon(options = {}) {
        if (this.ribbons.length === 0) return;
        const ribbon = this.ribbons.find((candidate) => !candidate.mesh.visible)
            ?? this.ribbons.reduce((oldest, candidate) => (
                candidate.elapsed > oldest.elapsed ? candidate : oldest
            ), this.ribbons[0]);
        const mesh = ribbon.mesh;
        const uniforms = ribbon.material.userData?.uniforms;
        if (uniforms?.uColorA && options.colorA) uniforms.uColorA.value.copy(options.colorA);
        if (uniforms?.uColorB && options.colorB) uniforms.uColorB.value.copy(options.colorB);
        if (uniforms?.uOpacity) uniforms.uOpacity.value = options.opacity ?? 0.55;
        if (uniforms?.uThickness) uniforms.uThickness.value = options.thickness ?? 0.07;
        if (uniforms?.uArc) uniforms.uArc.value = options.arc ?? 0.16;
        if (uniforms?.uProgress) uniforms.uProgress.value = 0;

        mesh.visible = true;
        mesh.position.copy(options.position ?? this.tmpA.set(0, 0, -60));
        mesh.scale.set(options.length ?? 90, options.width ?? 18, 1);
        ribbon.sky = options.sky === true;
        ribbon.roll = options.roll ?? 0;
        if (options.ground) {
            mesh.rotation.set(-Math.PI / 2, 0, options.roll ?? 0);
            ribbon.sky = false;
        } else {
            const camera = this.getCamera();
            if (camera) {
                mesh.lookAt(camera.position);
                mesh.rotateZ(ribbon.roll);
            } else {
                mesh.rotation.set(0, 0, ribbon.roll);
            }
        }
        ribbon.elapsed = 0;
        ribbon.duration = options.duration ?? 1.15;
    }

    resolvePieceAnchor(piece, viewportOrigin = null) {
        // A scrolling/nonstandard mode (Infinity) supplies the ON-SCREEN normalized lock
        // position; prefer it over the fixed-board centroid, whose piece.y grows into the
        // hundreds in Infinity and pins the crystal anchor to the nearest floor.
        const viewport = readLockViewportOrigin({ viewportOrigin });
        if (!viewport && (!piece || !Array.isArray(piece.shape))) {
            return this.pickFallbackAnchor();
        }

        let bias;
        let visibleRow;
        if (viewport) {
            bias = clamp(viewport.x * 2 - 1, -1, 1);
            visibleRow = clamp(viewport.y * ROWS, 0, ROWS);
        } else {
            let sumX = 0;
            let sumY = 0;
            let occupied = 0;
            for (let row = 0; row < piece.shape.length; row += 1) {
                const shapeRow = piece.shape[row];
                if (!Array.isArray(shapeRow)) continue;
                for (let col = 0; col < shapeRow.length; col += 1) {
                    if (!shapeRow[col]) continue;
                    sumX += (Number(piece.x) || 0) + col + 0.5;
                    sumY += (Number(piece.y) || HIDDEN_ROWS) + row + 0.5;
                    occupied += 1;
                }
            }

            if (occupied === 0) return this.pickFallbackAnchor();

            const boardX = sumX / occupied;
            const boardY = sumY / occupied;
            bias = clamp((boardX / Math.max(1, COLS)) * 2 - 1, -1, 1);
            visibleRow = clamp(boardY - HIDDEN_ROWS, 0, ROWS);
        }

        const side = Math.abs(bias) < 0.12 ? this.lastAnchorSide * -1 : Math.sign(bias);
        this.lastAnchorSide = side || 1;
        const targetX = (side || 1) * (30 + Math.abs(bias) * 42);
        const targetZ = clamp(38 - visibleRow * 6.2, -104, 34);
        return this.nearestCrystalAnchor(targetX, targetZ, side || 1);
    }

    pickFallbackAnchor() {
        this.lastAnchorSide *= -1;
        const side = this.lastAnchorSide;
        const candidates = CRYSTAL_ANCHORS.filter((anchor) => anchor.hero && Math.sign(anchor.x) === side);
        const anchor = candidates[Math.floor(this.rng() * candidates.length)] ?? CRYSTAL_ANCHORS[0];
        return this.anchorToVector(anchor);
    }

    pickCrystalAnchors(count) {
        const heroes = CRYSTAL_ANCHORS.filter((anchor) => anchor.hero);
        const left = heroes.filter((anchor) => anchor.x < 0);
        const right = heroes.filter((anchor) => anchor.x >= 0);
        if (left.length > 0 && right.length > 0) {
            const anchors = [];
            const startRight = this.comboAnchorIndex % 2 === 1;
            const bankOffset = Math.floor(this.comboAnchorIndex / 2);
            for (let i = 0; i < count; i += 1) {
                const useRight = i % 2 === 0 ? startRight : !startRight;
                const bank = useRight ? right : left;
                const anchor = bank[(bankOffset + Math.floor(i / 2)) % bank.length];
                anchors.push(this.anchorToVector(anchor));
            }
            this.comboAnchorIndex = (this.comboAnchorIndex + 1) % Math.max(1, (Math.max(left.length, right.length) * 2));
            return anchors;
        }

        const anchors = [];
        for (let i = 0; i < count; i += 1) {
            const anchor = heroes[(this.comboAnchorIndex + i * 2) % heroes.length];
            anchors.push(this.anchorToVector(anchor));
        }
        this.comboAnchorIndex = (this.comboAnchorIndex + 1) % heroes.length;
        return anchors;
    }

    nearestCrystalAnchor(targetX, targetZ, side) {
        let best = null;
        let bestDist = Infinity;
        for (const anchor of CRYSTAL_ANCHORS) {
            if (anchor.hero && Math.sign(anchor.x) !== Math.sign(side)) continue;
            const dx = anchor.x - targetX;
            const dz = anchor.z - targetZ;
            const dist = dx * dx + dz * dz * 0.45;
            if (dist < bestDist) {
                best = anchor;
                bestDist = dist;
            }
        }
        return this.anchorToVector(best ?? CRYSTAL_ANCHORS[0]);
    }

    anchorToVector(anchor) {
        const jitterX = (this.rng() - 0.5) * anchor.spreadX * 0.35;
        const jitterZ = (this.rng() - 0.5) * anchor.spreadZ * 0.35;
        const x = anchor.x + jitterX;
        const z = anchor.z + jitterZ;
        return new THREE.Vector3(x, this.terrainSampler(x, z) + (anchor.foreground ? 2.4 : 1.7), z);
    }

    getVectorFromGetter(getter, fallback) {
        const value = getter?.();
        if (value?.isVector3) return value.clone();
        if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
            return new THREE.Vector3(value.x, value.y, value.z);
        }
        return fallback.clone();
    }

    snapshot() {
        const activeSparks = this.positionLifeData
            ? Array.from({ length: this.capacity }).reduce((total, _, i) => total + (this.positionLifeData[i * 4 + 3] > 0 ? 1 : 0), 0)
            : 0;
        const activeHeroShards = this.heroLifeData
            ? Array.from({ length: this.heroCapacity }).reduce((total, _, i) => total + (this.heroLifeData[i] > 0 || this.heroDelayData[i] > 0 ? 1 : 0), 0)
            : 0;
        return {
            backend: this.useCompute ? 'WebGPU compute' : (this.isWebGPU ? 'WebGPU CPU' : 'WebGL/CPU'),
            capacity: this.capacity,
            heroCapacity: this.heroCapacity,
            ringCapacity: this.ringCount,
            ribbonCapacity: this.ribbonCount,
            activeSparks,
            activeHeroShards,
            activeRings: this.rings.filter((ring) => ring.mesh.visible).length,
            activeRibbons: this.ribbons.filter((ribbon) => ribbon.mesh.visible).length,
        };
    }

    dispose() {
        if (this.points && this.scene) this.scene.remove(this.points);
        this.geometry?.dispose?.();
        this.material?.dispose?.();
        if (this.heroMesh && this.scene) this.scene.remove(this.heroMesh);
        this.heroGeometry?.dispose?.();
        this.heroMaterial?.dispose?.();
        for (const ring of this.rings) {
            if (this.scene) this.scene.remove(ring.mesh);
            ring.material?.dispose?.();
        }
        this.ringGeometry?.dispose?.();
        for (const ribbon of this.ribbons) {
            if (this.scene) this.scene.remove(ribbon.mesh);
            ribbon.material?.dispose?.();
        }
        this.ribbonGeometry?.dispose?.();
        this.points = null;
        this.geometry = null;
        this.material = null;
        this.heroMesh = null;
        this.heroGeometry = null;
        this.heroMaterial = null;
        this.rings = [];
        this.ringGeometry = null;
        this.ribbons = [];
        this.ribbonGeometry = null;
        this.computeNode = null;
        this.positionLifeBuffer = null;
        this.velocitySeedBuffer = null;
        this.colorEnergyBuffer = null;
        this.miscBuffer = null;
        this.styleTimingBuffer = null;
    }
}

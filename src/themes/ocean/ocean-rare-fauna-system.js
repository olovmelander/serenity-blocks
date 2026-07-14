/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    abs,
    cameraPosition,
    dot,
    float,
    max as tslMax,
    materialColor,
    mix,
    normalize as tslNormalize,
    normalWorld,
    positionLocal,
    positionWorld,
    pow as tslPow,
    sin,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { loadGltfCached } from './ocean-asset-loader.js';
import { tslCausticProjection } from './ocean-tsl-helpers.js';
import {
    OCEAN_FAUNA_ASSET_VERSION,
    OCEAN_RARE_FAUNA_ASSETS,
    getRareFaunaAssetCandidates,
    summarizeFaunaAssetManifest,
} from './ocean-fauna-assets.js';

const FORWARD = new THREE.Vector3(1, 0, 0);
const DEFAULT_COOLDOWN = [9999, 9999];
const MIN_FIRST_SPAWN_DELAY = 90;
const ASSET_PRELOAD_LEAD_TIME = 24;
const PLAYFIELD_SAFE_Z = -82;

// ── Shark predator-prey behavior ────────────────────────────────────────────
const SHARK_PHASE = {
    PROWL: 'PROWL',
    STALK: 'STALK',
    CHARGE: 'CHARGE',
    STRIKE: 'STRIKE',
    DISENGAGE: 'DISENGAGE',
};

const SHARK_PHASE_CLIPS = {
    [SHARK_PHASE.PROWL]: 'shark_cruise_loop',
    [SHARK_PHASE.STALK]: 'shark_stalk_loop',
    [SHARK_PHASE.CHARGE]: 'shark_charge_loop',
    [SHARK_PHASE.STRIKE]: 'shark_strike_lunge',
    [SHARK_PHASE.DISENGAGE]: 'shark_disengage_loop',
};

const SHARK_LEGACY_CLIP = 'shark_s_curve_swim_loop';
const SHARK_SAFE_Z = { min: -132, max: -12 };
const SHARK_SAFE_Y = { min: 14, max: 58 };

const SHARK_BEHAVIOR = {
    // Range at which the shark notices a school and begins stalking
    stalkRange: 80,
    // How often (seconds) the shark scans for prey while prowling
    scanInterval: 2.0,
    // Phase durations
    stalkDuration: [4.0, 7.0],
    chargeDuration: [2.0, 3.0],
    strikeDuration: [0.8, 1.2],
    disengageDuration: [6.0, 10.0],
    // Hunts per spawn
    maxHunts: [2, 4],
    // Speed multipliers per phase
    speedMultiplier: {
        [SHARK_PHASE.PROWL]: 1.0,
        [SHARK_PHASE.STALK]: 1.15,
        [SHARK_PHASE.CHARGE]: 2.8,
        [SHARK_PHASE.STRIKE]: 3.2,
        [SHARK_PHASE.DISENGAGE]: 0.7,
    },
    // Animation speed multipliers per phase
    animSpeedMultiplier: {
        [SHARK_PHASE.PROWL]: 1.0,
        [SHARK_PHASE.STALK]: 1.15,
        [SHARK_PHASE.CHARGE]: 2.0,
        [SHARK_PHASE.STRIKE]: 2.5,
        [SHARK_PHASE.DISENGAGE]: 0.7,
    },
    // Influence overrides per phase  { radius, strength, duration }
    influence: {
        [SHARK_PHASE.PROWL]: { radius: 65, strength: 0.6, duration: 1.15 },
        [SHARK_PHASE.STALK]: { radius: 95, strength: 1.1, duration: 1.4 },
        [SHARK_PHASE.CHARGE]: { radius: 155, strength: 2.1, duration: 1.8 },
        [SHARK_PHASE.STRIKE]: { radius: 165, strength: 2.5, duration: 2.2 },
        [SHARK_PHASE.DISENGAGE]: { radius: 90, strength: 0.5, duration: 1.0 },
    },
    // How aggressively the shark blends toward the target during stalk (0–1)
    stalkLerp: 0.3,
    // During DISENGAGE the shark lifts upward by this amount
    disengageLiftY: 12,
    targetRefreshInterval: 0.18,
    maxSpeed: {
        [SHARK_PHASE.PROWL]: 13.0,
        [SHARK_PHASE.STALK]: 17.0,
        [SHARK_PHASE.CHARGE]: 42.0,
        [SHARK_PHASE.STRIKE]: 50.0,
        [SHARK_PHASE.DISENGAGE]: 15.0,
    },
    turnResponsiveness: {
        [SHARK_PHASE.PROWL]: 2.4,
        [SHARK_PHASE.STALK]: 3.8,
        [SHARK_PHASE.CHARGE]: 6.8,
        [SHARK_PHASE.STRIKE]: 8.5,
        [SHARK_PHASE.DISENGAGE]: 2.1,
    },
    arriveRadius: {
        [SHARK_PHASE.PROWL]: 14,
        [SHARK_PHASE.STALK]: 22,
        [SHARK_PHASE.CHARGE]: 8,
        [SHARK_PHASE.STRIKE]: 3,
        [SHARK_PHASE.DISENGAGE]: 18,
    },
};

export const RARE_FAUNA_ASSET_SOURCES = Object.fromEntries(
    Object.entries(OCEAN_RARE_FAUNA_ASSETS).map(([kind, entry]) => [
        kind,
        [
            `${entry.primary.id}: ${entry.primary.sourceMode} ${entry.primary.license}`,
            entry.fallback
                ? `${entry.fallback.id}: fallback ${entry.fallback.sourceMode} ${entry.fallback.license}`
                : null,
        ].filter(Boolean).join('; '),
    ]),
);

const CREATURE_DEFS = {
    shark: {
        assetKey: 'shark',
        influenceKind: 'predator',
        influenceRadius: 78,
        influenceStrength: 0.72,
        influenceDuration: 1.15,
        influenceInterval: 0.32,
        duration: [38, 54],
        scale: [4.8, 6.2],
        rollAmplitude: 0.035,
        pitchAmplitude: 0.03,
        tint: 0xa4cdd0,
        referenceSpeed: 14,
    },
    turtle: {
        assetKey: 'turtle',
        influenceKind: 'large-neutral',
        influenceRadius: 48,
        influenceStrength: 0.22,
        influenceDuration: 1.4,
        influenceInterval: 0.7,
        duration: [46, 68],
        scale: [5.2, 7.1],
        pitchAmplitude: 0.045,
        rollAmplitude: 0.045,
        tint: 0x8aa98e,
        referenceSpeed: 4,
    },
    whale: {
        assetKey: 'whale',
        influenceKind: 'massive-neutral',
        influenceRadius: 180,
        influenceStrength: 0.45,
        influenceDuration: 2.5,
        influenceInterval: 1.2,
        duration: [60, 90],
        scale: [12.0, 16.0],
        rollAmplitude: 0.015,
        pitchAmplitude: 0.01,
        tint: 0x3a5a7a,
        referenceSpeed: 6,
    },
    mantaRay: {
        assetKey: 'mantaRay',
        influenceKind: 'large-neutral',
        influenceRadius: 64,
        influenceStrength: 0.28,
        influenceDuration: 1.6,
        influenceInterval: 0.8,
        duration: [48, 72],
        scale: [6.4, 8.6],
        rollAmplitude: 0.06,
        pitchAmplitude: 0.05,
        tint: 0x2c3e58,
        referenceSpeed: 5,
    },
    dolphin: {
        assetKey: 'dolphin',
        influenceKind: 'neutral',
        influenceRadius: 52,
        influenceStrength: 0.32,
        influenceDuration: 1.3,
        influenceInterval: 0.6,
        duration: [42, 64],
        scale: [4.8, 6.2],
        rollAmplitude: 0.05,
        pitchAmplitude: 0.06,
        tint: 0x9ec4d4,
        referenceSpeed: 10,
    },
};

const WHALE_VARIANTS = [
    {
        id: 'blue-giant',
        tint: 0x3a5a7a,
        scaleBias: 1.0,
        pathBias: -2,
        animationSpeed: 0.4,
    },
];

const TURTLE_VARIANTS = [
    {
        id: 'loggerhead-glide',
        tint: 0x8ba585,
        scaleBias: 1.0,
        pathBias: -1,
        animationSpeed: 0.82,
    },
    {
        id: 'green-shadow',
        tint: 0x789a98,
        scaleBias: 0.88,
        pathBias: 1,
        animationSpeed: 0.68,
    },
];

const MANTA_VARIANTS = [
    {
        id: 'manta-glide',
        tint: 0x2c3e58,
        scaleBias: 1.0,
        pathBias: 0,
        animationSpeed: 0.55,
    },
];

const DOLPHIN_VARIANTS = [
    {
        id: 'dolphin-cruiser',
        tint: 0x9ec4d4,
        scaleBias: 1.0,
        pathBias: 0,
        animationSpeed: 1.05,
    },
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Map a forwardAxis string ("'+X' | '-X' | '+Z' | '-Z'") to a unit vector
// representing the model's authored forward direction in its local space.
// Used as the "from" vector when computing orientation targets, instead of
// the hardcoded +X — this is what lets Quaternius/kenchoo models (authored
// facing -Z) orient correctly without being rotated sideways.
const FORWARD_AXIS_VECTORS = {
    '+X': new THREE.Vector3(1, 0, 0),
    '-X': new THREE.Vector3(-1, 0, 0),
    '+Z': new THREE.Vector3(0, 0, 1),
    '-Z': new THREE.Vector3(0, 0, -1),
};

export function getModelForwardVector(forwardAxis = '+X') {
    return FORWARD_AXIS_VECTORS[forwardAxis] ?? FORWARD_AXIS_VECTORS['+X'];
}

// Discover bones on a cloned shark scene and snapshot their rest rotations so
// the per-frame procedural overlay can additively perturb them (fox-style
// secondary motion layered on top of the GLB swim clip).
//
// Two-stage discovery:
// 1. Name-based regex (project-authored rigs have semantic names).
// 2. Spatial fallback for Quaternius/third-party rigs that use auto names
//    like "Bone", "Bone.001". We walk the longest bone chain and treat the
//    back half as tail, plus pick the most-forward bone as head and the
//    most-lateral pair as fins.
//
// modelForward is the model's authored forward axis (default +X). It's used
// in the spatial fallback to determine which end of the bone chain is the
// head vs. tail.
function collectSharkBones(root, modelForward) {
    if (!root) return null;
    const snapshotRotation = (node) => ({
        node,
        baseQuaternion: node.quaternion.clone(),
        baseEuler: new THREE.Euler().setFromQuaternion(node.quaternion, 'XYZ'),
    });
    const wrap = (tail, fins, head, source) => {
        if (!tail.length && !fins.length && !head) return null;
        console.debug(
            `🌊 [Ocean] Shark bones (${source}): tail=${tail.length} fins=${fins.length} head=${head ? 1 : 0}`,
        );
        return {
            tail: tail.map(snapshotRotation),
            fins: fins.map(snapshotRotation),
            head: head ? snapshotRotation(head) : null,
            scratchEuler: new THREE.Euler(),
            scratchQuat: new THREE.Quaternion(),
        };
    };

    // Stage 1: name-based discovery.
    const tail = [];
    const fins = [];
    let head = null;
    const TAIL_RX = /(tail|spine|back|caudal)/i;
    const HEAD_RX = /(head|jaw|skull)/i;
    const FIN_RX = /(fin|pectoral|wing|flipper)/i;
    root.traverse((node) => {
        if (!node.isBone && !node.isObject3D) return;
        const name = node.name || '';
        if (HEAD_RX.test(name) && !head) {
            head = node;
        } else if (TAIL_RX.test(name)) {
            tail.push(node);
        } else if (FIN_RX.test(name)) {
            fins.push(node);
        }
    });
    if (tail.length || fins.length || head) {
        return wrap(tail, fins, head, 'name-match');
    }

    // Stage 2: spatial fallback. Quaternius rigs use generic names — we have
    // to identify bones by their position in the bind pose.
    root.updateMatrixWorld(true);
    const bones = [];
    root.traverse((node) => {
        if (node.isBone) bones.push(node);
    });
    if (bones.length < 2) return null;

    // Project each bone onto the model's forward axis to know "how far back".
    const forward = (modelForward ?? new THREE.Vector3(1, 0, 0)).clone().normalize();
    const tmp = new THREE.Vector3();
    const meta = bones.map((bone) => {
        bone.getWorldPosition(tmp);
        return {
            bone,
            projection: tmp.dot(forward),
            lateral: Math.abs(tmp.dot(new THREE.Vector3(0, 1, 0).cross(forward))),
        };
    });
    // Sort along forward axis: smallest projection = back of body (tail end).
    meta.sort((a, b) => a.projection - b.projection);

    // Tail = back third of bones (those with smallest forward projection).
    const tailEnd = Math.max(2, Math.floor(meta.length / 3));
    const tailBones = meta.slice(0, tailEnd).map((m) => m.bone);
    // Head = the bone furthest forward.
    const headBone = meta[meta.length - 1].bone;
    // Fins = the two bones with highest lateral offset, excluding tail/head.
    const finCandidates = meta
        .slice(tailEnd, meta.length - 1)
        .sort((a, b) => b.lateral - a.lateral);
    const finBones = finCandidates.slice(0, 2).map((m) => m.bone);

    return wrap(tailBones, finBones, headBone, 'spatial-fallback');
}

function roundMetric(value, decimals = 2) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** decimals;
    return Math.round(value * scale) / scale;
}

function randRange(rng, min, max) {
    return min + rng() * (max - min);
}

function sanitizeRange(range, fallback) {
    if (!Array.isArray(range) || range.length < 2) return fallback;
    const min = Number(range[0]);
    const max = Number(range[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
    return [Math.max(0, Math.min(min, max)), Math.max(0, Math.max(min, max))];
}

function normalizeSettings(settings = {}) {
    const enabled = settings.enabled === true;
    const maxActive = Math.max(0, Math.floor(settings.maxActive ?? (enabled ? 1 : 0)));
    return {
        enabled,
        maxActive,
        firstSpawnDelay: Math.max(
            MIN_FIRST_SPAWN_DELAY,
            Number(settings.firstSpawnDelay ?? MIN_FIRST_SPAWN_DELAY),
        ),
        minGap: Math.max(30, Number(settings.minGap ?? 45)),
        quietAfterGameplay: Math.max(6, Number(settings.quietAfterGameplay ?? 12)),
        turtleCooldown: sanitizeRange(settings.turtleCooldown, DEFAULT_COOLDOWN),
        sharkCooldown: sanitizeRange(settings.sharkCooldown, DEFAULT_COOLDOWN),
        whaleCooldown: sanitizeRange(settings.whaleCooldown, DEFAULT_COOLDOWN),
        mantaRayCooldown: sanitizeRange(settings.mantaRayCooldown, DEFAULT_COOLDOWN),
        dolphinCooldown: sanitizeRange(settings.dolphinCooldown, DEFAULT_COOLDOWN),
    };
}

const RARE_FAUNA_KINDS = ['shark', 'turtle', 'whale', 'mantaRay', 'dolphin'];

// Frame-rate-corrected turn responsiveness per creature (Fix 4).
// Higher = snappier. Per-frame slerp alpha = 1 - exp(-rate * dt).
const CREATURE_TURN_RATES = {
    shark: 8.0,
    turtle: 1.4,
    whale: 0.9,
    mantaRay: 1.6,
    dolphin: 4.0,
};

function disposeObject(root) {
    if (!root) return;
    const geometries = new Set();
    const materials = new Set();

    root.traverse((child) => {
        if (child.geometry) geometries.add(child.geometry);
        if (Array.isArray(child.material)) {
            child.material.forEach((material) => materials.add(material));
        } else if (child.material) {
            materials.add(child.material);
        }
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
}

function cubicPoint(path, t, target) {
    const inv = 1 - t;
    target
        .copy(path.start)
        .multiplyScalar(inv * inv * inv)
        .addScaledVector(path.controlA, 3 * inv * inv * t)
        .addScaledVector(path.controlB, 3 * inv * t * t)
        .addScaledVector(path.end, t * t * t);
    return target;
}

function cubicDerivative(path, t, target, tempA = new THREE.Vector3(), tempB = new THREE.Vector3()) {
    const inv = 1 - t;
    target
        .copy(tempA.copy(path.controlA).sub(path.start))
        .multiplyScalar(3 * inv * inv)
        .addScaledVector(tempA.copy(path.controlB).sub(path.controlA), 6 * inv * t)
        .addScaledVector(tempB.copy(path.end).sub(path.controlB), 3 * t * t);
    return target;
}

export class OceanRareFaunaSystem {
    constructor({
        scene = null,
        camera = null,
        preset = {},
        quality = 'High',
        getSeabedHeight = () => -10,
        isPointOccupied = () => false,
        getFishSystem = () => null,
        getCamera = () => null,
        getGameplayEffects = () => null,
        rng = Math.random,
    } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.quality = quality;
        this.getSeabedHeight = getSeabedHeight;
        this.isPointOccupied = isPointOccupied;
        this.getFishSystem = getFishSystem;
        this.getCamera = getCamera;
        this.getGameplayEffects = getGameplayEffects;
        this.rng = rng;
        this.settings = normalizeSettings(preset?.rareFauna);
        this.disposed = false;
        this.loadGeneration = 0;

        this.assets = new Map();
        this.assetStatus = Object.fromEntries(RARE_FAUNA_KINDS.map((kind) => [kind, 'idle']));
        this.assetRuntime = Object.fromEntries(RARE_FAUNA_KINDS.map((kind) => [kind, null]));
        this.assetErrors = Object.fromEntries(RARE_FAUNA_KINDS.map((kind) => [kind, null]));
        this.instancePool = Object.fromEntries(RARE_FAUNA_KINDS.map((kind) => [kind, []]));
        this.assetLoadPromises = new Map();
        this.pendingLoadKind = null;
        this.activeCreatures = [];
        const offsets = RARE_FAUNA_KINDS.map((_, i) => randRange(
            this.rng,
            i * 50,
            i * 50 + (i === 0 ? 30 : 70),
        ));
        for (let i = offsets.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
        }

        this.nextByKind = Object.fromEntries(
            RARE_FAUNA_KINDS.map((kind, i) => [kind, this.settings.firstSpawnDelay + offsets[i]]),
        );
        this.nextEligibleAt = this.settings.firstSpawnDelay;
        this.quietUntil = 0;
        this.lastUpdateTime = 0;
        this.lastSpawn = null;
        this.pathPoint = new THREE.Vector3();
        this.pathTangent = new THREE.Vector3();
        this.pathDerivativeTempA = new THREE.Vector3();
        this.pathDerivativeTempB = new THREE.Vector3();
        this.orientationTarget = new THREE.Quaternion();
        this.orientationBank = new THREE.Quaternion();
        this.orientationEuler = new THREE.Euler();
    }

    init() {
        // First cameo is at least 90 s away. updatePreloadSchedule() already
        // starts the chosen asset 24 s before it is due, so loading a multi-MB
        // whale/manta during theme boot only creates avoidable startup spikes.
    }

    getNextScheduledKind() {
        return RARE_FAUNA_KINDS.reduce((nextKind, kind) => (
            !nextKind || this.nextByKind[kind] < this.nextByKind[nextKind] ? kind : nextKind
        ), null);
    }

    ensureAssetLoaded(kind) {
        if (!kind) return Promise.resolve(null);
        if (this.assets.has(kind)) return Promise.resolve(this.assets.get(kind));
        if (this.assetLoadPromises.has(kind)) return this.assetLoadPromises.get(kind);
        if (this.assetStatus[kind] === 'missing' || this.assetStatus[kind] === 'error') {
            return Promise.resolve(null);
        }

        const promise = this.loadAsset(kind).finally(() => {
            this.assetLoadPromises.delete(kind);
        });
        this.assetLoadPromises.set(kind, promise);
        return promise;
    }

    queueAssetLoad(kind) {
        if (!kind) return Promise.resolve(null);
        if (this.pendingLoadKind) {
            return this.assetLoadPromises.get(this.pendingLoadKind) ?? Promise.resolve(null);
        }

        this.pendingLoadKind = kind;
        return this.ensureAssetLoaded(kind).finally(() => {
            if (this.pendingLoadKind === kind) this.pendingLoadKind = null;
        });
    }

    async loadAsset(kind) {
        if (this.assets.has(kind)) return this.assets.get(kind);
        const candidates = getRareFaunaAssetCandidates(kind);
        if (!candidates.length) {
            this.assetStatus[kind] = 'missing';
            return null;
        }

        this.assetStatus[kind] = 'loading';
        return this.loadAssetCandidate(kind, candidates, 0, null);
    }

    async loadAssetCandidate(kind, candidates, index, lastError) {
        if (this.disposed) return null;
        if (index >= candidates.length) {
            this.assetStatus[kind] = 'error';
            console.warn(`🌊 [Ocean] Rare fauna ${kind} assets failed to load:`, lastError);
            return null;
        }

        const asset = candidates[index];
        const generation = this.loadGeneration;
        try {
            const gltf = await loadGltfCached(asset.url);
            // The theme may have been evicted while the network/cache request
            // was in flight. Do not populate a disposed scene.
            if (this.disposed || generation !== this.loadGeneration || !this.scene) {
                disposeObject(gltf.scene);
                return null;
            }
            this.prepareAsset(gltf.scene);
            const record = { gltf, asset, fallbackUsed: asset.fallback === true };
            this.assets.set(kind, record);
            this.assetRuntime[kind] = this.makeRuntimeAssetSummary(record);
            this.assetStatus[kind] = 'loaded';
            this.assetErrors[kind] = null;
            this.prewarmCreatureInstances(kind, record);
            return record;
        } catch (error) {
            if (this.disposed || generation !== this.loadGeneration) return null;
            this.assetErrors[kind] = {
                assetId: asset.id,
                message: error?.message || String(error),
            };
            return this.loadAssetCandidate(kind, candidates, index + 1, error);
        }
    }

    prepareAsset(root) {
        // WebGPU has a hard limit of 8 vertex buffers per pipeline. GLB models
        // often ship with position, normal, uv, tangent, color, skinIndex,
        // skinWeight (= 9+ buffers). We strip attributes that aren't needed for
        // our simple transparent underwater rendering to stay within the limit.
        const KEEP_ATTRIBUTES = new Set([
            'position', 'normal', 'uv', 'tangent',
            // Per-vertex countershading written by the asset generator
            'color',
            // Skinning attributes are needed for animation mixers
            'skinIndex', 'skinWeight',
        ]);

        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = false;
            child.castShadow = false;
            child.receiveShadow = false;

            // Strip excess vertex attributes from the geometry
            const { geometry } = child;
            if (geometry) {
                const attributeNames = Object.keys(geometry.attributes);
                for (const name of attributeNames) {
                    if (!KEEP_ATTRIBUTES.has(name)) {
                        geometry.deleteAttribute(name);
                    }
                }
            }

            // Preserve PBR materials for AAA quality (Abzu/Subnautica look).
            // We use MeshStandardNodeMaterial to retain normal maps, roughness, etc.,
            // while adding transparency and TSL-driven caustics and rim lighting.
            const oldMaterials = Array.isArray(child.material) ? child.material : [child.material];
            const newMaterials = oldMaterials.map((mat) => {
                if (!mat) return mat;

                const hasVertexColors = !!(child.geometry?.getAttribute?.('color'))
                    || mat.vertexColors === true;
                const nodeMat = new MeshStandardNodeMaterial({
                    color: mat.color || new THREE.Color(0xffffff),
                    map: mat.map ?? null,
                    normalMap: mat.normalMap ?? null,
                    roughnessMap: mat.roughnessMap ?? null,
                    metalnessMap: null,
                    roughness: Math.min(0.68, Math.max(0.34, mat.roughness ?? 0.46)),
                    metalness: 0.0,
                    envMapIntensity: 1.2,
                    vertexColors: hasVertexColors,
                    transparent: true,
                    depthWrite: false,
                    opacity: 0,
                    side: mat.side ?? THREE.DoubleSide,
                    fog: true,
                    toneMapped: true,
                });

                const uTime = uniform(0);
                const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.18);

                // Rim light for that Abzu / Subnautica depth look
                const viewDir = tslNormalize(cameraPosition.sub(positionWorld));
                const rimFresnel = tslPow(
                    float(1.0).sub(tslMax(dot(normalWorld, viewDir), float(0.0))),
                    float(2.5),
                );
                const rimColor = vec3(0.1, 0.5, 0.6).mul(rimFresnel).mul(0.14);

                // Add animated caustics overlay
                const causticColor = vec3(0.4, 0.9, 0.8).mul(caustic).mul(0.1);

                const isTurtle = child.name.toLowerCase().includes('turtle')
                    || (mat.name && mat.name.toLowerCase().includes('turtle'))
                    || (child.parent && child.parent.name.toLowerCase().includes('turtle'));

                if (isTurtle) {
                    // Procedural shell pattern (scutes)
                    const shellPattern = abs(
                        sin(positionLocal.x.mul(float(8.0))).add(
                            sin(positionLocal.z.mul(float(8.0))),
                        ),
                    );
                    const scutes = smoothstep(float(0.4), float(0.8), shellPattern);
                    const shellColor = mix(vec3(0.05, 0.15, 0.12), vec3(0.12, 0.32, 0.28), scutes);

                    // Mix with original color but lean towards procedural pattern
                    nodeMat.colorNode = mix(
                        materialColor.rgb,
                        shellColor,
                        float(0.65),
                    );

                    // More intense rim for turtle
                    const turtleRim = vec3(0.2, 0.6, 0.55).mul(rimFresnel).mul(0.16);
                    nodeMat.emissiveNode = causticColor.add(turtleRim);
                } else {
                    nodeMat.emissiveNode = causticColor.add(rimColor);
                }

                if (mat.emissiveMap) {
                    nodeMat.emissiveMap = mat.emissiveMap;
                    nodeMat.emissiveIntensity = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1;
                } else if (mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0)) {
                    nodeMat.emissive = mat.emissive;
                    nodeMat.emissiveIntensity = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1;
                }

                nodeMat.name = `${mat.name || child.name || 'rare-fauna'} AAA PBR`;
                nodeMat.userData = {
                    uTime,
                    aquaticFaunaMaterial: true,
                    sourceMaterial: mat.name || null,
                    grade: 'aaa-pbr-caustics',
                };
                mat.dispose();
                return nodeMat;
            });
            child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
        });
    }

    prewarmCreatureInstances(kind, record, specificVariantId = null) {
        let variants;
        if (kind === 'turtle') {
            variants = TURTLE_VARIANTS;
        } else if (kind === 'whale') {
            variants = WHALE_VARIANTS;
        } else if (kind === 'mantaRay') {
            variants = MANTA_VARIANTS;
        } else if (kind === 'dolphin') {
            variants = DOLPHIN_VARIANTS;
        } else {
            variants = [{ id: 'reef-shark' }];
        }
        if (specificVariantId) {
            variants = variants.filter((v) => v.id === specificVariantId);
        }
        const def = CREATURE_DEFS[kind];
        variants.forEach((variant) => {
            const group = SkeletonUtils.clone(record.gltf.scene);
            const materials = this.collectCloneMaterials(group, def, variant);

            group.position.set(0, -1000, 0);

            group.name = `OceanRareFauna:${kind}:${variant.id}:${record.asset?.id || 'unknown'}-pooled`;
            group.userData.isOceanRareFauna = true;
            group.userData.kind = kind;
            group.userData.variant = variant.id;
            group.userData.assetId = record.asset?.id || null;
            group.userData.modelVersion = record.asset?.modelVersion || null;
            group.userData.fallbackAsset = record.fallbackUsed === true;

            const mixer = new THREE.AnimationMixer(group);
            const animationActions = new Map();
            record.gltf.animations.forEach((clip) => {
                const action = mixer.clipAction(clip);
                animationActions.set(clip.name || '(unnamed)', action);
                if (kind !== 'shark') action.play();
            });

            // Bone references for procedural overlay (shark only, fox-style
            // tail/fin/head animation layered on top of the GLB swim clip).
            const bones = kind === 'shark'
                ? collectSharkBones(group, getModelForwardVector(record.asset?.forwardAxis))
                : null;

            // Parked pool clones sit at y=-1000 until spawned. Hide them so the
            // renderer skips ~5 invisible skinned GLBs (draw call + vertex work)
            // every frame; spawnCreature flips this back on. Visually identical
            // (they are off-screen and inactive while parked).
            group.visible = false;
            this.scene.add(group);

            this.instancePool[kind].push({
                variant: variant.id,
                group,
                materials,
                mixer,
                animationActions,
                bones,
                active: false,
            });
        });
    }

    update(delta, time, {
        currentStrength = 0.5,
        glowIntensity = 0.8,
        gameplayIntensity = 0,
    } = {}) {
        this.lastUpdateTime = time;
        const dt = clamp(delta || 0.016, 0.001, 0.05);
        this.updateActiveCreatures(dt, time, glowIntensity);
        this.updateQuietWindow(time, currentStrength, gameplayIntensity);
        this.prefetchUpcomingAsset(time);

        if (!this.settings.enabled || this.settings.maxActive <= 0) return;
        if (this.activeCreatures.length >= this.settings.maxActive) return;
        if (time < this.nextEligibleAt || time < this.quietUntil) return;

        const kind = this.selectDueKind(time);
        if (!kind) return;
        if (!this.areAssetsReady(kind)) {
            this.queueAssetLoad(kind);
            return;
        }

        this.spawnCreature(kind, time, { forced: false });
    }

    prefetchUpcomingAsset(time) {
        if (!this.settings.enabled || this.settings.maxActive <= 0 || this.pendingLoadKind) return;
        let nextKind = null;
        for (const kind of RARE_FAUNA_KINDS) {
            if (this.assetStatus[kind] !== 'idle') continue;
            if (!nextKind || this.nextByKind[kind] < this.nextByKind[nextKind]) nextKind = kind;
        }
        if (!nextKind || this.nextByKind[nextKind] - time > ASSET_PRELOAD_LEAD_TIME) return;
        this.queueAssetLoad(nextKind);
    }

    updateQuietWindow(time, currentStrength, gameplayIntensity) {
        const strengthSpike = Math.max(0, currentStrength - 0.92);
        const intensity = Math.max(strengthSpike, Number(gameplayIntensity) || 0);
        if (intensity <= 0.28) return;
        this.quietUntil = Math.max(this.quietUntil, time + this.settings.quietAfterGameplay);
    }

    updateActiveCreatures(dt, time, glowIntensity) {
        const survivors = [];
        this.activeCreatures.forEach((creature) => {
            creature.age += dt;
            if (creature.age >= creature.duration) {
                this.releaseCreature(creature);
                return;
            }

            // Snapshot position BEFORE movement so we can derive linear
            // speed for the velocity-driven mixer ratio (Fix 2).
            creature.previousPosition.copy(creature.group.position);

            if (creature.kind === 'shark' && creature.behavior) {
                // Shark uses predator-prey state machine instead of pure
                // cubic-path following.
                this.updateSharkBehavior(creature, dt, time);
            } else {
                const t = clamp(creature.age / creature.duration, 0, 1);
                cubicPoint(creature.path, t, this.pathPoint);
                cubicDerivative(
                    creature.path,
                    t,
                    this.pathTangent,
                    this.pathDerivativeTempA,
                    this.pathDerivativeTempB,
                );
                creature.group.position.copy(this.pathPoint);
            }

            this.orientCreature(creature, time, dt);
            this.updateCreatureOpacity(creature, glowIntensity);
            this.updateCreatureInfluence(creature, dt);
            this.updateCreatureAnimation(creature, dt);
            // Velocity-driven mixer playback (Fix 2): tail beats now scale
            // with linear travel speed instead of running at a fixed tempo.
            const playbackRate = this.computeAnimationPlaybackRate(creature, dt);
            creature.mixer?.update(dt * playbackRate);
            if (creature.kind === 'shark' && creature.bones) {
                this.applySharkProceduralOverlay(creature, dt, time);
            }
            survivors.push(creature);
        });
        this.activeCreatures = survivors;
    }

    // Maps current linear travel speed to a mixer playback rate.
    // For the shark, a phase-aware floor keeps CHARGE/STRIKE looking aggressive
    // even if velocity momentarily dips. For other creatures, the rate scales
    // smoothly with travel speed clamped to a sensible range.
    computeAnimationPlaybackRate(creature, dt) {
        const reference = creature.referenceSpeed || 8;
        let linearSpeed;
        if (creature.kind === 'shark' && creature.behavior) {
            linearSpeed = creature.behavior.velocity.length();
        } else {
            linearSpeed = creature.group.position.distanceTo(creature.previousPosition) / Math.max(dt, 0.001);
        }
        let ratio = clamp(linearSpeed / reference, 0.35, 2.6);
        if (creature.kind === 'shark') {
            const phase = creature.behavior?.phase;
            const floor = ({
                [SHARK_PHASE.CHARGE]: 1.5,
                [SHARK_PHASE.STRIKE]: 1.8,
            })[phase] ?? 0;
            if (ratio < floor) ratio = floor;
        }
        return ratio;
    }

    // ── Shark predator-prey state machine ───────────────────────────────────
    updateSharkBehavior(creature, dt, time) {
        const b = creature.behavior;
        const fishSystem = this.getFishSystem();
        b.timer += dt;

        // Advance pathT so we can always compute the "home" Bezier position.
        const pathSpeed = (SHARK_BEHAVIOR.speedMultiplier[b.phase] ?? 1);
        b.pathT = clamp(
            b.pathT + (dt / creature.duration) * pathSpeed,
            0,
            1,
        );
        cubicPoint(creature.path, b.pathT, this.pathPoint);
        cubicDerivative(
            creature.path,
            b.pathT,
            this.pathTangent,
            this.pathDerivativeTempA,
            this.pathDerivativeTempB,
        );

        switch (b.phase) {
        case SHARK_PHASE.PROWL: {
            b.desiredPosition.copy(this.pathPoint);
            this.steerSharkToward(creature, b.desiredPosition, dt);

            b.scanTimer -= dt;
            if (!b.exiting && b.scanTimer <= 0 && fishSystem && b.huntCount < b.maxHunts) {
                b.scanTimer = SHARK_BEHAVIOR.scanInterval;
                const targetFound = this.findNearestSharkTarget(
                    fishSystem,
                    creature.group.position,
                    SHARK_BEHAVIOR.stalkRange,
                    b.targetPosition,
                );
                if (targetFound >= 0) {
                    b.targetSchoolIndex = targetFound;
                    this.setSharkPhase(
                        creature,
                        SHARK_PHASE.STALK,
                        randRange(
                            this.rng,
                            SHARK_BEHAVIOR.stalkDuration[0],
                            SHARK_BEHAVIOR.stalkDuration[1],
                        ),
                    );
                }
            }

            if (b.exiting && b.pathT >= 0.985) {
                creature.age = creature.duration;
            }
            break;
        }

        case SHARK_PHASE.STALK: {
            this.refreshSharkTarget(creature, fishSystem, dt);

            const lerpFactor = clamp(
                SHARK_BEHAVIOR.stalkLerp * (b.timer / Math.max(0.001, b.cooldownTimer)),
                0,
                0.58,
            );
            b.desiredPosition.copy(this.pathPoint).lerp(b.targetPosition, lerpFactor);
            this.steerSharkToward(creature, b.desiredPosition, dt);

            this.pathTangent.subVectors(b.targetPosition, creature.group.position);
            if (this.pathTangent.lengthSq() < 0.01) this.pathTangent.copy(b.velocity);

            if (b.timer >= b.cooldownTimer) {
                b.chargeOrigin.copy(creature.group.position);
                this.setSharkPhase(
                    creature,
                    SHARK_PHASE.CHARGE,
                    randRange(
                        this.rng,
                        SHARK_BEHAVIOR.chargeDuration[0],
                        SHARK_BEHAVIOR.chargeDuration[1],
                    ),
                );
            }
            break;
        }

        case SHARK_PHASE.CHARGE: {
            this.refreshSharkTarget(creature, fishSystem, dt);

            const chargeT = clamp(b.timer / Math.max(0.001, b.cooldownTimer), 0, 1);
            const wobbleScale = 1 - chargeT;
            b.desiredPosition.set(
                b.targetPosition.x + Math.sin(time * 8.0 + creature.phase) * 1.2 * wobbleScale,
                b.targetPosition.y + Math.cos(time * 6.5 + creature.phase) * 0.8 * wobbleScale,
                b.targetPosition.z,
            );
            this.steerSharkToward(creature, b.desiredPosition, dt);
            this.pathTangent.subVectors(b.targetPosition, creature.group.position);
            if (this.pathTangent.lengthSq() < 0.01) this.pathTangent.set(1, 0, 0);

            fishSystem?.displaceSchoolGoal?.(
                b.targetSchoolIndex,
                creature.group.position,
                dt * 20,
            );

            const distToTarget = creature.group.position.distanceTo(b.targetPosition);
            if (b.timer >= b.cooldownTimer || (b.timer > 0.45 && distToTarget < 9)) {
                this.setSharkPhase(
                    creature,
                    SHARK_PHASE.STRIKE,
                    randRange(
                        this.rng,
                        SHARK_BEHAVIOR.strikeDuration[0],
                        SHARK_BEHAVIOR.strikeDuration[1],
                    ),
                );
            }
            break;
        }

        case SHARK_PHASE.STRIKE: {
            const strikeT = clamp(b.timer / Math.max(0.001, b.cooldownTimer), 0, 1);
            b.desiredPosition.lerpVectors(b.strikeStart, b.strikeEnd, strikeT * (2 - strikeT));
            this.steerSharkToward(creature, b.desiredPosition, dt);
            this.pathTangent.copy(b.strikeDirection);

            fishSystem?.displaceSchoolGoal?.(
                b.targetSchoolIndex,
                creature.group.position,
                dt * 34,
            );

            if (b.timer >= b.cooldownTimer) {
                b.huntCount++;
                this.setSharkPhase(
                    creature,
                    SHARK_PHASE.DISENGAGE,
                    randRange(
                        this.rng,
                        SHARK_BEHAVIOR.disengageDuration[0],
                        SHARK_BEHAVIOR.disengageDuration[1],
                    ),
                );
            }
            break;
        }

        case SHARK_PHASE.DISENGAGE: {
            const disengageT = clamp(b.timer / Math.max(0.001, b.cooldownTimer), 0, 1);
            const liftY = SHARK_BEHAVIOR.disengageLiftY * Math.sin(disengageT * Math.PI);
            b.desiredPosition
                .copy(this.pathPoint)
                .addScaledVector(b.disengageOffset, Math.sin(disengageT * Math.PI))
                .setY(this.pathPoint.y + liftY);
            this.steerSharkToward(creature, b.desiredPosition, dt);

            if (b.timer >= b.cooldownTimer) {
                if (b.huntCount >= b.maxHunts) {
                    b.exiting = true;
                    creature.duration = Math.min(creature.duration, creature.age + 10);
                }
                b.targetSchoolIndex = -1;
                b.scanTimer = SHARK_BEHAVIOR.scanInterval * 1.5;
                this.setSharkPhase(creature, SHARK_PHASE.PROWL, 0, 0.45);
            }
            break;
        }

        default:
            creature.group.position.copy(this.pathPoint);
            break;
        }

        // Continuous environmental interactions (bubbles & silt)
        const gameplayEffects = this.getGameplayEffects?.();
        if (gameplayEffects) {
            // 1. Bubbles: spawn bubble trails at high speed (CHARGE or STRIKE)
            if (b.phase === SHARK_PHASE.CHARGE || b.phase === SHARK_PHASE.STRIKE) {
                b.effectTimer = (b.effectTimer || 0) + dt;
                if (b.effectTimer >= 0.05) {
                    b.effectTimer = 0;
                    gameplayEffects.spawnParticleBurst(
                        gameplayEffects.bubblePool,
                        creature.group.position,
                        4,
                        0.4,
                        false,
                        false,
                    );
                }
            }

            // 2. Silt: kick up silt when close to the bottom and moving quickly
            const floorY = this.getSeabedHeight(creature.group.position.x, creature.group.position.z);
            const distToFloor = creature.group.position.y - floorY;
            if (distToFloor < 10.0) {
                const speed = b.velocity.length();
                const speedRatio = speed / SHARK_BEHAVIOR.maxSpeed[SHARK_PHASE.PROWL];
                if (speedRatio > 1.1) {
                    b.siltEffectTimer = (b.siltEffectTimer || 0) + dt;
                    if (b.siltEffectTimer >= 0.1) {
                        b.siltEffectTimer = 0;
                        const intensity = Math.max(0.1, (1.0 - distToFloor / 10.0) * (speedRatio - 1.0));
                        gameplayEffects.spawnParticleBurst(
                            gameplayEffects.siltPool,
                            creature.group.position,
                            3,
                            intensity,
                            false,
                            false,
                        );
                    }
                }
            }
        }
    }

    findNearestSharkTarget(fishSystem, position, range, target) {
        const centroids = fishSystem?.getSchoolCentroids?.() ?? [];
        let bestDist = Infinity;
        let bestIdx = -1;
        for (let i = 0; i < centroids.length; i++) {
            const c = centroids[i];
            if (!c || c.fishCount <= 0) continue;
            const d = Math.hypot(c.x - position.x, (c.y - position.y) * 0.5, c.z - position.z);
            if (d < bestDist && d < range) {
                bestDist = d;
                bestIdx = c.index;
                target.set(c.x, c.y, c.z);
            }
        }
        return bestIdx;
    }

    refreshSharkTarget(creature, fishSystem, dt) {
        const b = creature.behavior;
        if (!fishSystem || b.targetSchoolIndex < 0) return;
        b.targetRefreshTimer -= dt;
        if (b.targetRefreshTimer > 0) return;
        b.targetRefreshTimer = SHARK_BEHAVIOR.targetRefreshInterval;

        const centroids = fishSystem.getSchoolCentroids?.() ?? [];
        let target = null;
        for (let i = 0; i < centroids.length; i++) {
            if (centroids[i].index === b.targetSchoolIndex) {
                target = centroids[i];
                break;
            }
        }
        if (target && target.fishCount > 0) {
            b.targetPosition.set(target.x, target.y, target.z);
            return;
        }

        const replacement = this.findNearestSharkTarget(
            fishSystem,
            creature.group.position,
            SHARK_BEHAVIOR.stalkRange * 1.35,
            b.targetPosition,
        );
        b.targetSchoolIndex = replacement;
    }

    setSharkPhase(creature, phase, duration = 0, fadeDuration = 0.3) {
        const b = creature.behavior;
        if (!b) return;
        if (b.phase === phase) {
            b.cooldownTimer = duration || b.cooldownTimer;
            return;
        }

        b.previousPhase = b.phase;
        b.phase = phase;
        b.timer = 0;
        b.cooldownTimer = duration;
        b.targetRefreshTimer = 0;

        if (phase === SHARK_PHASE.STRIKE) {
            b.strikeStart.copy(creature.group.position);
            b.strikeDirection.subVectors(b.targetPosition, creature.group.position);
            if (b.strikeDirection.lengthSq() < 0.001) b.strikeDirection.copy(b.velocity);
            if (b.strikeDirection.lengthSq() < 0.001) b.strikeDirection.set(1, 0, 0);
            b.strikeDirection.normalize();
            b.strikeEnd
                .copy(b.targetPosition)
                .addScaledVector(b.strikeDirection, 16);
            this.clampSharkVector(b.strikeEnd);

            // Spawn shockwave at strike location
            const gameplayEffects = this.getGameplayEffects?.();
            if (gameplayEffects) {
                gameplayEffects.spawnShockwave(creature.group.position, 14, 0.95);
            }

            // Scatter nearby fish schools
            const fishSystem = this.getFishSystem?.();
            if (fishSystem) {
                fishSystem.triggerGameplaySurge(1.2, b.targetPosition || creature.group.position);
            }

            // Proximity camera shake
            const camera = this.getCamera?.();
            if (camera) {
                const rawCamera = camera.camera || camera;
                const distToCam = creature.group.position.distanceTo(rawCamera.position);
                if (distToCam < 100) {
                    const magnitude = Math.max(0.1, 1.2 * (1.0 - distToCam / 100));
                    camera.applyShakeImpulse(magnitude, 350);
                }
            }
        } else if (phase === SHARK_PHASE.CHARGE) {
            const fishSystem = this.getFishSystem?.();
            if (fishSystem && b.targetPosition) {
                // Preemptive moderate scare centered at target school position when charge starts
                fishSystem.triggerGameplaySurge(0.55, b.targetPosition);
            }
        } else if (phase === SHARK_PHASE.DISENGAGE) {
            const side = this.rng() < 0.5 ? -1 : 1;
            b.disengageOffset.set(
                -b.strikeDirection.z * 12 * side,
                0,
                b.strikeDirection.x * 12 * side,
            );
        }

        this.playCreatureClip(creature, SHARK_PHASE_CLIPS[phase], fadeDuration);
    }

    steerSharkToward(creature, target, dt) {
        const b = creature.behavior;
        const { phase } = b;
        const maxSpeed = SHARK_BEHAVIOR.maxSpeed[phase] ?? 14;
        const turnResponsiveness = SHARK_BEHAVIOR.turnResponsiveness[phase] ?? 3;
        const arriveRadius = SHARK_BEHAVIOR.arriveRadius[phase] ?? 12;
        const { position } = creature.group;

        this.clampSharkVector(target);
        b.desiredVelocity.subVectors(target, position);
        const dist = b.desiredVelocity.length();
        if (dist > 0.001) {
            const arrival = clamp(dist / arriveRadius, 0.28, 1);
            b.desiredVelocity.multiplyScalar((maxSpeed * arrival) / dist);
        } else {
            b.desiredVelocity.set(0, 0, 0);
        }

        const turn = clamp(1 - Math.exp(-turnResponsiveness * dt), 0.02, 0.42);
        b.velocity.lerp(b.desiredVelocity, turn);
        const velocityLength = b.velocity.length();
        if (velocityLength > maxSpeed) b.velocity.multiplyScalar(maxSpeed / velocityLength);

        position.addScaledVector(b.velocity, dt);
        this.clampSharkVector(position);
        if (b.velocity.lengthSq() > 0.01) {
            this.pathTangent.copy(b.velocity);
        } else {
            this.pathTangent.subVectors(target, position);
        }
        if (this.pathTangent.lengthSq() < 0.001) this.pathTangent.set(1, 0, 0);
    }

    clampSharkVector(vector) {
        vector.z = clamp(vector.z, SHARK_SAFE_Z.min, SHARK_SAFE_Z.max);
        const floorY = this.getSeabedHeight(vector.x, vector.z) + 8;
        vector.y = clamp(vector.y, Math.max(SHARK_SAFE_Y.min, floorY), SHARK_SAFE_Y.max);
        return vector;
    }

    // Layer fox-style procedural bone motion on top of the GLB swim clip so
    // a single Quaternius "Swim" animation reads as alive across all five
    // predator phases. Per-phase amplitudes drive aggression.
    applySharkProceduralOverlay(creature, dt, time) {
        const { bones } = creature;
        if (!bones) return;
        const phase = creature.behavior?.phase ?? SHARK_PHASE.PROWL;
        // Aggression ramps from PROWL → STRIKE.
        const aggression = ({
            [SHARK_PHASE.PROWL]: 0.35,
            [SHARK_PHASE.STALK]: 0.55,
            [SHARK_PHASE.CHARGE]: 1.0,
            [SHARK_PHASE.STRIKE]: 1.25,
            [SHARK_PHASE.DISENGAGE]: 0.45,
        })[phase] ?? 0.5;
        const swayFrequency = 1.6 + aggression * 3.4;
        const swayPhase = creature.phase || 0;
        const t = time * swayFrequency + swayPhase;

        // Tail: lateral S-curve sway. Each successive tail bone gets a phase
        // delay so the motion ripples back like a real shark stroke.
        bones.tail.forEach((bone, i) => {
            const tailAmp = (0.18 + aggression * 0.32) * (0.55 + 0.15 * i);
            const delay = i * 0.45;
            const sway = Math.sin(t - delay) * tailAmp;
            bones.scratchEuler.copy(bone.baseEuler);
            bones.scratchEuler.y += sway;
            bone.node.quaternion.setFromEuler(bones.scratchEuler);
        });

        // Pectoral fins: low-amplitude flutter on the Z axis (roll-like).
        bones.fins.forEach((bone, i) => {
            const finAmp = 0.08 + aggression * 0.05;
            const sign = i % 2 === 0 ? 1 : -1;
            const flutter = Math.sin(time * 4.5 + i * 0.7) * finAmp * sign;
            bones.scratchEuler.copy(bone.baseEuler);
            bones.scratchEuler.z += flutter;
            bone.node.quaternion.setFromEuler(bones.scratchEuler);
        });

        // Head tracking: yaw the head toward the steering target during STALK
        // and CHARGE so the shark visibly "locks on".
        if (bones.head && creature.behavior) {
            const target = creature.behavior.targetPosition;
            const pos = creature.group.position;
            const dx = target.x - pos.x;
            const dz = target.z - pos.z;
            const dist = Math.hypot(dx, dz);
            const tracking = ({
                [SHARK_PHASE.STALK]: 0.55,
                [SHARK_PHASE.CHARGE]: 0.85,
                [SHARK_PHASE.STRIKE]: 1.0,
            })[phase] ?? 0;
            if (tracking > 0 && dist > 0.001) {
                // Approximate yaw in body-local space (assumes forward = +X).
                const desiredYaw = Math.atan2(dz, dx) - creature.group.rotation.y;
                const clampedYaw = clamp(desiredYaw, -0.6, 0.6) * tracking;
                bones.scratchEuler.copy(bones.head.baseEuler);
                bones.scratchEuler.y += clampedYaw;
                bones.head.node.quaternion.setFromEuler(bones.scratchEuler);
            } else {
                bones.head.node.quaternion.copy(bones.head.baseQuaternion);
            }
        }
    }

    playCreatureClip(creature, clipName, fadeDuration = 0.25) {
        const actions = creature.animationActions;
        if (!actions || !actions.size) return;
        // Resolve a clip even when the GLB doesn't ship the legacy per-phase
        // names. Order: requested clipName → legacy fallback → first clip in
        // the GLB (which is what the Quaternius bundle provides as "Swim").
        let nextClip = null;
        if (actions.has(clipName)) {
            nextClip = clipName;
        } else if (actions.has(SHARK_LEGACY_CLIP)) {
            nextClip = SHARK_LEGACY_CLIP;
        } else {
            const firstKey = actions.keys().next().value;
            if (firstKey) nextClip = firstKey;
        }
        if (!nextClip) return;
        const nextAction = actions.get(nextClip);
        if (!nextAction || creature.activeClipName === nextClip) return;

        const previousAction = actions.get(creature.activeClipName);
        nextAction.enabled = true;
        nextAction.reset();
        nextAction.setEffectiveWeight(1);
        nextAction.setEffectiveTimeScale(creature.animationTimeScale ?? 1);
        nextAction.play();

        if (previousAction && fadeDuration > 0) {
            previousAction.crossFadeTo(nextAction, fadeDuration, false);
        } else if (previousAction) {
            previousAction.stop();
        }
        creature.activeClipName = nextClip;
    }

    updateCreatureAnimation(creature) {
        // No-op: playback rate is now driven by computeAnimationPlaybackRate()
        // via mixer.update(dt * rate) in updateActiveCreatures. Keep actions
        // at unit timeScale so they don't double-multiply with the mixer rate.
        creature.animationTimeScale = 1;
        creature.animationActions?.forEach((action) => {
            action.setEffectiveTimeScale(1);
        });
    }

    orientCreature(creature, time, dt = 0.016) {
        if (this.pathTangent.lengthSq() < 0.001) this.pathTangent.set(1, 0, 0);
        this.pathTangent.normalize();

        // Use the model's authored forward axis (default +X for project-authored
        // assets, -Z for Quaternius/kenchoo) so the head points along travel
        // direction instead of sideways.
        const fromAxis = creature.modelForward ?? FORWARD;
        this.orientationTarget.setFromUnitVectors(fromAxis, this.pathTangent);
        const phaseBank = creature.behavior
            ? clamp((creature.behavior.velocity.z || 0) * 0.012, -0.22, 0.22)
            : 0;
        this.orientationEuler.set(
            Math.sin(time * 0.42 + creature.phase) * creature.rollAmplitude,
            0,
            Math.sin(time * 0.33 + creature.phase * 1.7) * creature.pitchAmplitude + phaseBank,
        );
        this.orientationBank.setFromEuler(this.orientationEuler);
        this.orientationTarget.multiply(this.orientationBank);

        // Frame-rate-correct slerp: exponential decay with per-kind turn rate.
        // turnRate has units of "radians of decay per second" — higher = snappier.
        const turnRate = CREATURE_TURN_RATES[creature.kind] ?? 1.6;
        const alpha = 1 - Math.exp(-turnRate * dt);
        creature.group.quaternion.slerp(this.orientationTarget, alpha);
    }

    updateCreatureOpacity(creature, glowIntensity) {
        const visibility = clamp(0.92 + glowIntensity * 0.08, 0.92, 1);
        creature.materials.forEach((material) => {
            material.opacity = creature.baseOpacity * visibility;
            if (material.userData && material.userData.uTime) {
                material.userData.uTime.value = this.lastUpdateTime;
            }
        });
    }

    updateCreatureInfluence(creature, dt) {
        creature.influenceTimer -= dt;
        if (creature.influenceTimer > 0) return;
        creature.influenceTimer = creature.influenceInterval;

        // Shark overrides influence parameters based on behavior phase.
        let { influenceRadius, influenceStrength, influenceDuration } = creature;
        if (creature.behavior) {
            const phaseInfluence = SHARK_BEHAVIOR.influence[creature.behavior.phase];
            if (phaseInfluence) {
                influenceRadius = phaseInfluence.radius;
                influenceStrength = phaseInfluence.strength;
                influenceDuration = phaseInfluence.duration;
            }
        }

        this.getFishSystem()?.addEnvironmentalInfluence?.({
            kind: creature.influenceKind,
            position: creature.group.position,
            radius: influenceRadius,
            strength: influenceStrength,
            duration: influenceDuration,
        });
    }

    selectDueKind(time) {
        const candidates = RARE_FAUNA_KINDS.filter((kind) => (
            time >= this.nextByKind[kind]
            && this.assetStatus[kind] !== 'missing'
            && this.assetStatus[kind] !== 'error'
        ));
        if (candidates.length === 0) return null;
        const readyCandidates = candidates.filter((kind) => this.areAssetsReady(kind));
        const pool = readyCandidates.length > 0 ? readyCandidates : candidates;
        return pool[Math.floor(this.rng() * pool.length)];
    }

    areAssetsReady(kind = null) {
        if (kind) return this.assetStatus[kind] === 'loaded';
        // At least one kind must be loaded for global readiness; individual
        // kinds (e.g. orphaned mantaRay without an asset) shouldn't block others.
        return RARE_FAUNA_KINDS.some((k) => this.assetStatus[k] === 'loaded');
    }

    async forceSpawn(kind = 'turtle') {
        const normalizedKind = RARE_FAUNA_KINDS.includes(kind) ? kind : 'turtle';
        await this.ensureAssetLoaded(normalizedKind);
        return this.spawnCreature(normalizedKind, this.lastUpdateTime, { forced: true });
    }

    spawnCreature(kind, time, { forced = false } = {}) {
        const definition = CREATURE_DEFS[kind];
        if (!definition) return false;
        const assetRecord = this.assets.get(definition.assetKey);
        const gltf = assetRecord?.gltf;
        const asset = assetRecord?.asset;
        if (!gltf?.scene || !this.scene) return false;

        if (this.activeCreatures.length >= this.settings.maxActive) {
            if (!forced) return false;
            this.activeCreatures.forEach((creature) => {
                this.releaseCreature(creature);
            });
            this.activeCreatures = [];
        }

        let variant;
        if (kind === 'turtle') {
            variant = this.pickTurtleVariant();
        } else if (kind === 'whale') {
            variant = this.pickWhaleVariant();
        } else if (kind === 'mantaRay') {
            variant = this.pickMantaVariant();
        } else if (kind === 'dolphin') {
            variant = this.pickDolphinVariant();
        } else {
            variant = { id: 'reef-shark' };
        }

        let poolItems = this.instancePool[kind].filter((item) => item.variant === variant.id && !item.active);
        if (poolItems.length === 0) {
            this.prewarmCreatureInstances(kind, assetRecord, variant.id);
            poolItems = this.instancePool[kind].filter((item) => item.variant === variant.id && !item.active);
        }
        if (poolItems.length === 0) return false;

        const poolItem = poolItems[0];
        poolItem.active = true;

        const { group } = poolItem;
        const { materials } = poolItem;
        const { mixer } = poolItem;
        const { animationActions } = poolItem;
        const { bones } = poolItem;

        group.visible = true;

        const path = this.createPath(kind, variant);
        const duration = randRange(this.rng, definition.duration[0], definition.duration[1]);
        const scale = randRange(this.rng, definition.scale[0], definition.scale[1])
            * (variant.scaleBias ?? 1)
            * (asset?.runtimeScale ?? 1);

        group.scale.setScalar(scale);
        cubicPoint(path, 0, this.pathPoint);
        cubicDerivative(
            path,
            0,
            this.pathTangent,
            this.pathDerivativeTempA,
            this.pathDerivativeTempB,
        );
        group.position.copy(this.pathPoint);
        group.quaternion.identity();
        if (kind === 'shark') mixer?.stopAllAction();

        const baseAnimSpeed = variant.animationSpeed ?? randRange(this.rng, 0.74, 0.96);
        const initialVelocity = new THREE.Vector3();
        if (kind === 'shark') {
            initialVelocity.copy(this.pathTangent);
            if (initialVelocity.lengthSq() < 0.001) initialVelocity.set(1, 0, 0);
            initialVelocity.normalize().multiplyScalar(SHARK_BEHAVIOR.maxSpeed[SHARK_PHASE.PROWL]);
        }
        const creature = {
            kind,
            variant: variant.id,
            assetId: asset?.id || null,
            modelVersion: asset?.modelVersion || null,
            fallbackUsed: assetRecord?.fallbackUsed === true,
            triangleCount: asset?.triangleCount ?? null,
            animationNames: asset?.animationNames ?? [],
            modelForward: getModelForwardVector(asset?.forwardAxis),
            referenceSpeed: asset?.referenceSpeed ?? definition.referenceSpeed ?? null,
            previousPosition: new THREE.Vector3(),
            group,
            mixer,
            animationActions,
            bones,
            activeClipName: null,
            animationTimeScale: 1,
            poolItem,
            path,
            materials,
            duration,
            age: 0,
            phase: randRange(this.rng, 0, Math.PI * 2),
            animationSpeed: baseAnimSpeed,
            baseOpacity: 1.0,
            rollAmplitude: definition.rollAmplitude,
            pitchAmplitude: definition.pitchAmplitude,
            influenceKind: definition.influenceKind,
            influenceRadius: definition.influenceRadius,
            influenceStrength: definition.influenceStrength,
            influenceDuration: definition.influenceDuration,
            influenceInterval: definition.influenceInterval,
            influenceTimer: 0.08,
            // Shark predator-prey behavior state (null for non-sharks)
            behavior: kind === 'shark' ? {
                phase: SHARK_PHASE.PROWL,
                timer: 0,
                scanTimer: randRange(this.rng, 0.5, SHARK_BEHAVIOR.scanInterval),
                huntCount: 0,
                maxHunts: Math.floor(randRange(this.rng, SHARK_BEHAVIOR.maxHunts[0], SHARK_BEHAVIOR.maxHunts[1] + 1)),
                targetSchoolIndex: -1,
                targetPosition: new THREE.Vector3(),
                stalkDirection: new THREE.Vector3(),
                chargeOrigin: new THREE.Vector3(),
                desiredPosition: new THREE.Vector3(),
                desiredVelocity: new THREE.Vector3(),
                velocity: initialVelocity,
                strikeStart: new THREE.Vector3(),
                strikeEnd: new THREE.Vector3(),
                strikeDirection: new THREE.Vector3(1, 0, 0),
                disengageOffset: new THREE.Vector3(),
                cooldownTimer: 0,
                targetRefreshTimer: 0,
                baseAnimSpeed,
                pathT: 0,
                previousPhase: null,
                exiting: false,
            } : null,
        };
        if (kind === 'shark') {
            this.playCreatureClip(creature, SHARK_PHASE_CLIPS[SHARK_PHASE.PROWL], 0);
        }

        this.activeCreatures.push(creature);
        this.lastSpawn = {
            kind,
            variant: variant.id,
            assetId: asset?.id || null,
            modelVersion: asset?.modelVersion || null,
            fallbackUsed: assetRecord?.fallbackUsed === true,
            time,
        };
        if (!forced) this.scheduleNext(kind, time);
        return true;
    }

    pickTurtleVariant() {
        const index = Math.floor(this.rng() * TURTLE_VARIANTS.length);
        return TURTLE_VARIANTS[Math.min(TURTLE_VARIANTS.length - 1, index)];
    }

    pickWhaleVariant() {
        const index = Math.floor(this.rng() * WHALE_VARIANTS.length);
        return WHALE_VARIANTS[Math.min(WHALE_VARIANTS.length - 1, index)];
    }

    pickMantaVariant() {
        const index = Math.floor(this.rng() * MANTA_VARIANTS.length);
        return MANTA_VARIANTS[Math.min(MANTA_VARIANTS.length - 1, index)];
    }

    pickDolphinVariant() {
        const index = Math.floor(this.rng() * DOLPHIN_VARIANTS.length);
        return DOLPHIN_VARIANTS[Math.min(DOLPHIN_VARIANTS.length - 1, index)];
    }

    collectCloneMaterials(group, definition, variant) {
        const tint = new THREE.Color(variant.tint ?? definition.tint);
        const materials = [];
        group.traverse((child) => {
            if (!child.isMesh) return;
            const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
            const cloned = sourceMaterials.map((material) => {
                const nextMaterial = material.clone();
                if (nextMaterial.color) nextMaterial.color.lerp(tint, 0.16);
                nextMaterial.transparent = true;
                nextMaterial.opacity = 1;
                nextMaterial.depthWrite = true;
                nextMaterial.fog = true;
                nextMaterial.toneMapped = true;
                nextMaterial.userData = {
                    ...(nextMaterial.userData || {}),
                    aquaticFaunaMaterial: true,
                    runtimeTint: `0x${tint.getHexString()}`,
                    alphaDistanceFade: true,
                    underwaterRimHint: true,
                };
                materials.push(nextMaterial);
                return nextMaterial;
            });
            child.material = Array.isArray(child.material) ? cloned : cloned[0];
        });
        return materials;
    }

    releaseCreature(creature) {
        if (creature.poolItem) {
            creature.poolItem.active = false;
            creature.poolItem.group.position.set(0, -1000, 0);
            creature.poolItem.group.visible = false;
        } else {
            this.scene?.remove(creature.group);
            creature.materials.forEach((material) => material.dispose());
        }
    }

    createPath(kind, variant) {
        const side = this.rng() < 0.5 ? -1 : 1;
        const variantBias = variant.pathBias ?? 0;
        const startX = side * randRange(this.rng, 250, 280);
        const endX = -side * randRange(this.rng, 250, 280);
        // Shark swims in the school layer so hunts read clearly without
        // jumping into the camera-near foreground.
        let rearZ = randRange(this.rng, -136, -96);
        let y = randRange(this.rng, 27, 48);
        if (kind === 'shark') {
            rearZ = randRange(this.rng, -105, -50);
            y = randRange(this.rng, 16, 30);
        } else if (kind === 'whale') {
            rearZ = randRange(this.rng, -220, -180);
            y = randRange(this.rng, 30, 50);
        } else if (kind === 'mantaRay') {
            rearZ = randRange(this.rng, -160, -110);
            y = randRange(this.rng, 22, 38);
        } else if (kind === 'dolphin') {
            rearZ = randRange(this.rng, -120, -80);
            y = randRange(this.rng, 30, 48);
        }
        const arc = side * randRange(this.rng, 42, 68) + variantBias * 12;
        const start = new THREE.Vector3(startX, this.clampFaunaY(startX, rearZ, y), rearZ);
        const end = new THREE.Vector3(endX, this.clampFaunaY(endX, rearZ + variantBias * 8, y), rearZ);
        const controlA = new THREE.Vector3(
            startX * 0.42,
            this.clampFaunaY(startX * 0.42, rearZ - 10, y + randRange(this.rng, -4, 7)),
            Math.min(PLAYFIELD_SAFE_Z, rearZ - arc * 0.22),
        );
        const controlB = new THREE.Vector3(
            endX * 0.42,
            this.clampFaunaY(endX * 0.42, rearZ - 6, y + randRange(this.rng, -3, 6)),
            Math.min(PLAYFIELD_SAFE_Z, rearZ + arc * 0.18),
        );

        return {
            start,
            controlA,
            controlB,
            end,
        };
    }

    clampFaunaY(x, z, desiredY) {
        let floor = this.getSeabedHeight(x, z) + 8;

        // If this point is inside a reef wall or large rock, lift the floor
        // to force the path ABOVE the obstacle.
        if (this.isPointOccupied(x, z, 10)) {
            floor = Math.max(floor, 38); // Lift above most reef walls
        }

        return clamp(desiredY, floor, 58);
    }

    scheduleNext(kind, time) {
        const cooldownKey = `${kind}Cooldown`;
        const cooldown = this.settings[cooldownKey] ?? this.settings.turtleCooldown;
        this.nextByKind[kind] = time + randRange(this.rng, cooldown[0], cooldown[1]);
        this.nextEligibleAt = time + this.settings.minGap;
    }

    makeRuntimeAssetSummary(record) {
        const { asset, gltf, fallbackUsed } = record;
        return {
            id: asset.id,
            kind: asset.kind,
            modelVersion: asset.modelVersion,
            fileName: asset.fileName,
            sourceMode: asset.sourceMode,
            license: asset.license,
            author: asset.author,
            sourceUrl: asset.sourceUrl,
            triangleCount: asset.triangleCount,
            textureCount: asset.textureCount,
            animationNames: gltf.animations.length
                ? gltf.animations.map((clip) => clip.name || '(unnamed)')
                : asset.animationNames,
            runtimeScale: asset.runtimeScale,
            fallbackUsed,
        };
    }

    collectSignoff() {
        const active = this.activeCreatures[0] ?? null;
        return {
            assetVersion: OCEAN_FAUNA_ASSET_VERSION,
            enabled: this.settings.enabled === true,
            quality: this.quality,
            maxActive: this.settings.maxActive,
            activeCount: this.activeCreatures.length,
            activeCreature: active
                ? {
                    kind: active.kind,
                    variant: active.variant,
                    assetId: active.assetId,
                    modelVersion: active.modelVersion,
                    fallbackUsed: active.fallbackUsed,
                    triangleCount: active.triangleCount,
                    animationNames: active.animationNames,
                    age: roundMetric(active.age, 2),
                    duration: roundMetric(active.duration, 2),
                    position: {
                        x: roundMetric(active.group.position.x, 2),
                        y: roundMetric(active.group.position.y, 2),
                        z: roundMetric(active.group.position.z, 2),
                    },
                    sharkBehavior: active.behavior
                        ? {
                            phase: active.behavior.phase,
                            previousPhase: active.behavior.previousPhase,
                            huntCount: active.behavior.huntCount,
                            maxHunts: active.behavior.maxHunts,
                            activeClip: active.activeClipName,
                            animationTimeScale: roundMetric(active.animationTimeScale, 2),
                            influenceStrength: roundMetric(
                                SHARK_BEHAVIOR.influence[active.behavior.phase]?.strength,
                                2,
                            ),
                        }
                        : null,
                }
                : null,
            loadedAssets: { ...this.assetStatus },
            loadedAssetIds: Object.fromEntries(
                Object.entries(this.assetRuntime).map(([kind, runtime]) => [
                    kind,
                    runtime?.id ?? null,
                ]),
            ),
            assetRuntime: Object.fromEntries(
                RARE_FAUNA_KINDS.map((k) => [k, this.assetRuntime[k] ? { ...this.assetRuntime[k] } : null]),
            ),
            assetErrors: { ...this.assetErrors },
            nextCooldown: Object.fromEntries(
                RARE_FAUNA_KINDS.map((k) => [k, roundMetric(this.nextByKind[k] - this.lastUpdateTime, 2)]),
            ),
            quietFor: roundMetric(Math.max(0, this.quietUntil - this.lastUpdateTime), 2),
            lastSpawn: this.lastSpawn,
            assetSources: RARE_FAUNA_ASSET_SOURCES,
            attribution: {
                shark: {
                    sourceMode: this.assetRuntime.shark?.sourceMode ?? null,
                    license: this.assetRuntime.shark?.license ?? null,
                    author: this.assetRuntime.shark?.author ?? null,
                    sourceUrl: this.assetRuntime.shark?.sourceUrl ?? null,
                },
            },
            assetManifest: summarizeFaunaAssetManifest().rareFauna,
        };
    }

    dispose() {
        this.disposed = true;
        this.loadGeneration += 1;
        this.activeCreatures.forEach((creature) => {
            this.releaseCreature(creature);
        });
        this.activeCreatures = [];
        this.assets.forEach((record) => disposeObject(record.gltf?.scene));
        this.assets.clear();
        if (this.instancePool) {
            Object.values(this.instancePool).forEach((pool) => {
                pool.forEach((item) => {
                    this.scene?.remove(item.group);
                    item.materials.forEach((m) => m.dispose());
                });
            });
            this.instancePool = Object.fromEntries(RARE_FAUNA_KINDS.map((kind) => [kind, []]));
        }
        this.scene = null;
        this.camera = null;
        this.assetLoadPromises.clear();
        this.pendingLoadKind = null;
    }
}

export default OceanRareFaunaSystem;

/**
 * Ocean Theme — Coral Reef Dweller Fish System
 *
 * Small fish that live among corals and rocks: clownfish orbiting anemones,
 * chromis hovering above branches, gobies perched on surfaces, blennies
 * peeking from crevices, cardinalfish under ledges, dottybacks darting
 * between coral heads.
 *
 * Also includes GLB-based reef-dweller creatures (e.g. TripoSR seahorses)
 * that hover near coral/rock anchors with slow bob and yaw sway.
 *
 * Each fish is anchored to a coral/rock position and swims within a tight
 * territory radius. Uses instanced rendering (one mesh per species) for
 * minimal GPU cost.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
    attribute, cameraPosition, clamp as tslClamp, dot, exp, float,
    length, max as tslMax, mix, normalize, positionLocal, positionWorld,
    pow, sin, smoothstep, uniform, vec3, vec2, normalMap, texture, normalWorld,
} from 'three/tsl';
import { loadGltfCached } from './ocean-asset-loader.js';
import {
    OCEAN_REEF_SEAHORSE_ASSET,
    OCEAN_REEF_SEAHORSE_RIGGED_ASSET,
} from './ocean-fauna-assets.js';

// Vibrance constants for TripoSR-generated seahorse mesh. Kept in sync with
// the same constants in ocean-atmosphere-system.js so corals and seahorse
// read at matching saturation against the new daylight palette. Under bright
// ambient + directional lighting the previous emissive of 0.55 caused the
// seahorse to glow unnaturally; we let PBR shading carry most of the color
// and only top up with a light emissive.
const TRIPOSR_VERTEX_COLOR_BOOST = 1.35;
const TRIPOSR_EMISSIVE_BOOST = 0.22;

// Walk down a skeleton from `root` and return the longest chain of bones —
// then drop the leading "trunk" joints that are shared parents of multiple
// limbs. For a UniRig-auto-rigged seahorse the longest path starts at
// root → trunk → tail; if we animate the trunk, the head and fins (other
// children of trunk) tilt along with the tail. We only want to flex the
// tail-exclusive bones, so we skip leading joints that have non-chain
// siblings.
function findLongestBoneChain(root) {
    if (!root || !root.isBone) return [];

    function longestFrom(node) {
        let best = [];
        for (const child of node.children) {
            if (!child.isBone) continue;
            const childChain = longestFrom(child);
            if (childChain.length > best.length) best = childChain;
        }
        return [node, ...best];
    }
    const chain = longestFrom(root); // includes root

    // Strip the leading run of branching joints (the body-trunk). Stop as soon
    // as we hit the first joint that has only one bone child — that's where
    // the dominant chain becomes "tail-exclusive".
    let cut = 0;
    for (let i = 0; i < chain.length - 1; i++) {
        const boneChildren = chain[i].children.filter((c) => c.isBone);
        if (boneChildren.length > 1) {
            cut = i + 1;
        } else {
            break;
        }
    }
    return chain.slice(cut);
}

const textureLoader = new THREE.TextureLoader();
let dwellerScaleNormalMap = null;
function getDwellerScaleNormalMap() {
    if (!dwellerScaleNormalMap) {
        dwellerScaleNormalMap = typeof document === 'undefined'
            ? new THREE.Texture()
            : textureLoader.load('/src/themes/ocean/assets/textures/fish-scales-normal.png');
        dwellerScaleNormalMap.wrapS = THREE.RepeatWrapping;
        dwellerScaleNormalMap.wrapT = THREE.RepeatWrapping;
    }
    return dwellerScaleNormalMap;
}

// ── Species Definitions ─────────────────────────────────────────────────────
const REEF_SPECIES = [
    {
        name: 'clownfish',
        bodyLength: 0.55,
        bodyHeight: 0.22,
        bodyWidth: 0.13,
        tailHeight: 0.3,
        stripeFrequency: 22,
        patternStrength: 0.7,
        base: new THREE.Color(0xff4500),
        accent: new THREE.Color(0xffffff),
        behavior: 'orbit',
        territoryRadius: 4,
        hoverHeight: 1.5,
        weight: 1.0,
        minQuality: 1,
    },
    {
        name: 'blue-green-chromis',
        bodyLength: 0.45,
        bodyHeight: 0.18,
        bodyWidth: 0.10,
        tailHeight: 0.26,
        stripeFrequency: 0,
        patternStrength: 0.08,
        base: new THREE.Color(0x00f5ff),
        accent: new THREE.Color(0x7fffd4),
        behavior: 'hover',
        territoryRadius: 5,
        hoverHeight: 3.5,
        weight: 1.4,
        minQuality: 1,
    },
    {
        name: 'coral-goby',
        bodyLength: 0.35,
        bodyHeight: 0.12,
        bodyWidth: 0.08,
        tailHeight: 0.18,
        stripeFrequency: 0,
        patternStrength: 0.05,
        base: new THREE.Color(0xffd700),
        accent: new THREE.Color(0x9acd32),
        behavior: 'perch',
        territoryRadius: 2.5,
        hoverHeight: 0.6,
        weight: 0.8,
        minQuality: 2,
    },
    {
        name: 'bicolor-blenny',
        bodyLength: 0.5,
        bodyHeight: 0.14,
        bodyWidth: 0.09,
        tailHeight: 0.22,
        stripeFrequency: 5,
        patternStrength: 0.62,
        base: new THREE.Color(0x483d8b),
        accent: new THREE.Color(0xff8c00),
        behavior: 'peek',
        territoryRadius: 2,
        hoverHeight: 0.4,
        weight: 0.7,
        minQuality: 2,
    },
    {
        name: 'pajama-cardinalfish',
        bodyLength: 0.55,
        bodyHeight: 0.24,
        bodyWidth: 0.12,
        tailHeight: 0.28,
        stripeFrequency: 32,
        patternStrength: 0.48,
        base: new THREE.Color(0xff69b4),
        accent: new THREE.Color(0x4b0082),
        behavior: 'hover',
        territoryRadius: 3.5,
        hoverHeight: 2.0,
        weight: 0.9,
        minQuality: 3,
    },
    {
        name: 'royal-dottyback',
        bodyLength: 0.4,
        bodyHeight: 0.16,
        bodyWidth: 0.10,
        tailHeight: 0.24,
        stripeFrequency: 6,
        patternStrength: 0.55,
        base: new THREE.Color(0xda70d6),
        accent: new THREE.Color(0xffff00),
        behavior: 'dart',
        territoryRadius: 6,
        hoverHeight: 1.8,
        weight: 0.6,
        minQuality: 3,
    },
    // Yellow tang school — the bright yellow schoolers visible in the upper-left
    // of the reference reef photo. Saturated body, single dark accent stripe,
    // hovers in loose clusters above reef shelves.
    {
        name: 'yellow-tang',
        bodyLength: 0.6,
        bodyHeight: 0.32,
        bodyWidth: 0.10,
        tailHeight: 0.34,
        stripeFrequency: 2,
        patternStrength: 0.18,
        base: new THREE.Color(0xffd824),
        accent: new THREE.Color(0x1a1a1a),
        behavior: 'hover',
        territoryRadius: 5.5,
        hoverHeight: 4.0,
        weight: 1.3,
        minQuality: 2,
    },
];

const RADIAL_SEGMENTS = 8;

// Seahorse spawn counts by quality tier index (0=Minimal..5=Extreme)
const SEAHORSE_COUNTS_BY_TIER = [0, 1, 2, 3, 5, 7];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randRange(lo, hi) { return lo + Math.random() * (hi - lo); }

// ── Procedural geometry (smaller/rounder fish variant) ──────────────────────
function createDwellerGeometry(species) {
    const verts = []; const coords = []; const
        idx = [];
    const half = species.bodyLength * 0.5;
    const rings = [
        {
            x: -half * 0.75, w: 0.28, h: 0.30, c: 0.08,
        },
        {
            x: -half * 0.42, w: 0.78, h: 0.82, c: 0.22,
        },
        {
            x: -half * 0.05, w: 1.0, h: 1.0, c: 0.45,
        },
        {
            x: half * 0.32, w: 0.85, h: 0.88, c: 0.68,
        },
        {
            x: half * 0.68, w: 0.38, h: 0.45, c: 0.92,
        },
    ];
    const ringIdx = [];

    const addV = (x, y, z, c) => { const i = verts.length / 3; verts.push(x, y, z); coords.push(c); return i; };
    const addT = (a, b, c) => { idx.push(a, b, c); };

    rings.forEach((r) => {
        const cur = [];
        for (let s = 0; s < RADIAL_SEGMENTS; s++) {
            const a = (s / RADIAL_SEGMENTS) * Math.PI * 2;
            cur.push(addV(r.x, Math.sin(a) * species.bodyHeight * r.h, Math.cos(a) * species.bodyWidth * r.w, r.c));
        }
        ringIdx.push(cur);
    });

    for (let r = 0; r < ringIdx.length - 1; r++) {
        for (let s = 0; s < RADIAL_SEGMENTS; s++) {
            const n = (s + 1) % RADIAL_SEGMENTS;
            addT(ringIdx[r][s], ringIdx[r][n], ringIdx[r + 1][s]);
            addT(ringIdx[r][n], ringIdx[r + 1][n], ringIdx[r + 1][s]);
        }
    }

    const tailRoot = addV(-half * 0.88, 0, 0, 0.02);
    const headTip = addV(half * 1.02, 0, 0, 1.0);
    for (let s = 0; s < RADIAL_SEGMENTS; s++) {
        const n = (s + 1) % RADIAL_SEGMENTS;
        addT(tailRoot, ringIdx[0][s], ringIdx[0][n]);
        addT(headTip, ringIdx[ringIdx.length - 1][n], ringIdx[ringIdx.length - 1][s]);
    }

    // Paddle tail (rounder than school fish)
    const tX = -half * 1.08;
    const tTop = addV(tX, species.tailHeight * 0.42, 0, 0);
    const tFar = addV(tX - species.bodyLength * 0.14, 0, 0, 0);
    const tBot = addV(tX, -species.tailHeight * 0.42, 0, 0);
    addT(tailRoot, tTop, tFar);
    addT(tailRoot, tFar, tBot);

    // Small dorsal fin
    const dA = addV(-half * 0.15, species.bodyHeight * 0.68, 0, 0.38);
    const dB = addV(half * 0.08, species.bodyHeight * 1.3, 0, 0.55);
    const dC = addV(half * 0.35, species.bodyHeight * 0.52, 0, 0.72);
    addT(dA, dB, dC);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('aBodyCoord', new THREE.Float32BufferAttribute(coords, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

// ── NodeMaterial (WebGPU) for dweller fish ──────────────────────────────────
function createDwellerNodeMaterial(species) {
    const material = new MeshBasicNodeMaterial({
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);

    const aMisc = attribute('aMisc', 'vec4');
    const aBodyCoord = tslClamp(
        positionLocal.x
            .add(float(species.bodyLength * 0.77))
            .mul(float(1 / (species.bodyLength * 1.32))),
        float(0.0),
        float(1.0),
    );
    const phase = aMisc.x;
    const speed = aMisc.y;

    const tailW = pow(float(1.0).sub(tslClamp(aBodyCoord, float(0.0), float(1.0))), float(2.4));
    const swim = sin(uTime.mul(6.0).add(speed.mul(0.4)).add(phase).add(aBodyCoord.mul(5.0)));
    const bend = swim.mul(0.08).mul(tailW).mul(float(0.8).add(uCurrentStrength.mul(0.15)));
    const swimLift = sin(uTime.mul(2.5).add(phase)).mul(0.012).mul(tailW);
    material.positionNode = positionLocal.add(vec3(float(0.0), swimLift, bend));

    const scaleTilingX = float(14.0);
    const scaleTilingY = float(18.0);
    const scaleUV = vec2(aBodyCoord.mul(scaleTilingX), positionLocal.y.mul(scaleTilingY));
    const texNormal = texture(getDwellerScaleNormalMap(), scaleUV).xyz.mul(2.0).sub(1.0);

    const baseNormal = normalize(normalWorld);
    const normal = normalize(baseNormal.add(texNormal.mul(1.5)));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const lightDir = normalize(vec3(0.22, 0.94, -0.2));

    const diff = tslMax(dot(normal, lightDir), float(0.0)).mul(0.65).add(0.55);
    const rim = pow(float(1.0).sub(tslMax(dot(normal, viewDir), float(0.0))), float(2.0));

    const stripeWave = sin(aBodyCoord.mul(float(species.stripeFrequency)).add(phase.mul(6.283)));
    const stripe = smoothstep(float(0.42), float(0.92), stripeWave).mul(species.patternStrength);

    const uBaseColor = vec3(species.base.r, species.base.g, species.base.b);
    const uAccentColor = vec3(species.accent.r, species.accent.g, species.accent.b);

    let color = mix(uBaseColor, uAccentColor, stripe);
    color = color.mul(diff);
    color = color.add(uAccentColor.mul(rim).mul(0.35));

    // Add a tiny procedural scale shimmer
    const scaleShimmer = sin(aBodyCoord.mul(float(80.0)).add(uTime.mul(float(2.0))))
        .mul(0.5).add(0.5).mul(rim.mul(0.2));
    color = color.add(vec3(0.9, 1.0, 1.0).mul(scaleShimmer));

    // Eye-spot glow for visibility
    const eyePos = positionLocal.add(vec3(float(species.bodyLength * 0.4), float(0.0), float(0.0)));
    const eyeDist = length(eyePos);
    const eyeGlow = smoothstep(float(0.08), float(0.02), eyeDist).mul(2.0);
    color = color.add(vec3(1.0, 1.0, 0.8).mul(eyeGlow));

    color = color.add(vec3(0.1, 0.52, 0.62).mul(float(0.06).add(rim.mul(0.12))));

    const viewDist = length(cameraPosition.sub(positionWorld));
    const fog = float(1.0).sub(exp(viewDist.negate().mul(0.01)));
    color = mix(color, vec3(0.02, 0.22, 0.26), tslClamp(fog.mul(0.5), float(0.0), float(0.7)));

    material.colorNode = color.add(uBaseColor.mul(0.15)); // Constant light lift for visibility
    material.emissiveNode = vec3(0.0);
    material.userData = { uTime, uCurrentStrength };
    return material;
}

// ── Simple ShaderMaterial (WebGL) for dweller fish ──────────────────────────
function createDwellerMaterial(species, isWebGPU = false) {
    if (isWebGPU) return createDwellerNodeMaterial(species);
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCurrentStrength: { value: 0.5 },
            uBaseColor: { value: species.base },
            uAccentColor: { value: species.accent },
            uStripeFreq: { value: species.stripeFrequency },
            uPatternStr: { value: species.patternStrength },
            uFogColor: { value: new THREE.Color(0x002a34) },
            uNormalMap: { value: getDwellerScaleNormalMap() },
        },
        vertexShader: /* glsl */`
            uniform float uTime;
            uniform float uCurrentStrength;
            attribute float aBodyCoord;
            attribute vec4 aMisc;
            varying float vBodyCoord;
            varying float vPhase;
            varying float vDist;
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;
            varying vec2 vScaleUV;

            void main() {
                float phase = aMisc.x;
                float speed = aMisc.y;
                float tailW = pow(1.0 - clamp(aBodyCoord, 0.0, 1.0), 2.4);
                float swim = sin(uTime * (6.0 + speed * 0.4) + phase + aBodyCoord * 5.0);
                vec3 pos = position;
                pos.z += swim * 0.08 * tailW * (0.8 + uCurrentStrength * 0.15);
                pos.y += sin(uTime * 2.5 + phase) * 0.012 * tailW;

                vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
                vBodyCoord = aBodyCoord;
                vPhase = phase;
                vDist = length((viewMatrix * worldPos).xyz);
                vWorldPos = worldPos.xyz;
                vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
                vScaleUV = vec2(aBodyCoord * 14.0, position.y * 18.0);
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: /* glsl */`
            uniform float uTime;
            uniform vec3 uBaseColor;
            uniform vec3 uAccentColor;
            uniform float uStripeFreq;
            uniform float uPatternStr;
            uniform vec3 uFogColor;
            uniform sampler2D uNormalMap;
            varying float vBodyCoord;
            varying float vPhase;
            varying float vDist;
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;
            varying vec2 vScaleUV;

            void main() {
                vec3 baseNormal = normalize(vWorldNormal);
                vec3 scaleNormal = texture2D(uNormalMap, vScaleUV).xyz * 2.0 - 1.0;
                vec3 n = normalize(baseNormal + scaleNormal * 1.2);
                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                vec3 lightDir = normalize(vec3(0.22, 0.94, -0.2));

                float diff = max(dot(n, lightDir), 0.0) * 0.72 + 0.36;
                float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.0);
                float stripe = smoothstep(0.42, 0.92, sin(vBodyCoord * uStripeFreq + vPhase * 6.283)) * uPatternStr;

                vec3 color = mix(uBaseColor, uAccentColor, stripe);
                color *= diff;
                color += uAccentColor * rim * 0.18;
                color += vec3(0.06, 0.42, 0.48) * (0.03 + rim * 0.05);

                float fog = 1.0 - exp(-vDist * 0.012);
                color = mix(color, uFogColor, clamp(fog * 0.55, 0.0, 0.72));
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: THREE.DoubleSide,
    });
}

// ── Main System Class ───────────────────────────────────────────────────────
export class OceanReefDwellerSystem {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {number} opts.totalCount - total dweller fish budget
     * @param {number} opts.qualityTier - 0=Minimal..5=Extreme
     * @param {Function} opts.getSeabedHeight
     * @param {Function} opts.getFishSystem - returns OceanFishSystem for influence reads
     */
    constructor({
        scene, totalCount, qualityTier = 3, getSeabedHeight, isPointOccupied, getFishSystem, isWebGPU = false,
    }) {
        this.scene = scene;
        this.isWebGPU = isWebGPU;
        this.totalCount = totalCount;
        this.qualityTier = qualityTier;
        this.getSeabedHeight = getSeabedHeight;
        this.isPointOccupied = isPointOccupied;
        this.getFishSystem = getFishSystem;

        this.anchors = []; // { x, y, z } world positions of corals/rocks
        this.fish = []; // per-fish state
        this.meshes = []; // instanced meshes, one per species
        this.materials = [];
        this.speciesUsed = []; // indices into REEF_SPECIES
        this.speciesFishRanges = new Map(); // speciesIdx -> { start, count }
        this.dummy = new THREE.Object3D();
        // Reused for the per-dweller matrix compose: building the yaw quaternion
        // directly (setFromAxisAngle) and composing avoids the Euler object's
        // _onChange Euler->quaternion round-trip on every instance every tick.
        this._dwellerQuat = new THREE.Quaternion();
        this._dwellerUp = new THREE.Vector3(0, 1, 0);
        this.elapsed = 0;

        // GLB seahorse layer
        this.seahorseCount = SEAHORSE_COUNTS_BY_TIER[clamp(qualityTier, 0, SEAHORSE_COUNTS_BY_TIER.length - 1)] || 0;
        this.seahorseGLTF = null;
        this.seahorseClones = []; // { group, anchor, phase, yawPhase, bobPhase }
        this.seahorseLoadPromise = null;
    }

    /**
     * @param {Array<{x:number, y:number, z:number}>} anchorPositions
     */
    init(anchorPositions) {
        if (!this.scene || this.totalCount <= 0 || !anchorPositions.length) return;
        this.anchors = anchorPositions.map((a) => ({ x: a.x, y: a.y, z: a.z }));

        // Filter species by quality tier
        this.speciesUsed = REEF_SPECIES
            .map((s, i) => ({ s, i }))
            .filter((e) => e.s.minQuality <= this.qualityTier)
            .map((e) => e.i);
        if (!this.speciesUsed.length) return;

        this.distributeFish();
        this.createMeshes();

        // Load and spawn GLB seahorses
        if (this.seahorseCount > 0) {
            this.loadAndSpawnSeahorses();
        }
    }

    distributeFish() {
        const totalWeight = this.speciesUsed.reduce((sum, si) => sum + REEF_SPECIES[si].weight, 0);
        // Assign fish to anchors, round-robin through species
        let placed = 0;
        const speciesCounts = new Map();
        this.speciesUsed.forEach((si) => speciesCounts.set(si, 0));

        for (let a = 0; a < this.anchors.length && placed < this.totalCount; a++) {
            const anchor = this.anchors[a];
            const fishPerAnchor = clamp(
                Math.round(this.totalCount / this.anchors.length + randRange(-1, 1)),
                1,
                6,
            );
            for (let f = 0; f < fishPerAnchor && placed < this.totalCount; f++) {
                // Pick species weighted
                const si = this.speciesUsed[(a + f) % this.speciesUsed.length];
                const species = REEF_SPECIES[si];
                const angle = randRange(0, Math.PI * 2);
                const radius = randRange(0.5, species.territoryRadius * 0.6);
                const hY = species.hoverHeight + randRange(-0.3, 0.3);

                const fx = anchor.x + Math.cos(angle) * radius;
                const fz = anchor.z + Math.sin(angle) * radius;

                this.fish.push({
                    speciesIndex: si,
                    anchorIndex: a,
                    // Current position
                    x: fx,
                    y: anchor.y + hY,
                    z: fz,
                    // Behavior state
                    phase: randRange(0, Math.PI * 2),
                    speed: randRange(0.8, 1.6),
                    orbitAngle: angle,
                    orbitRadius: radius,
                    dartTimer: randRange(0, 3),
                    dartTargetX: 0,
                    dartTargetZ: 0,
                    peekPhase: randRange(0, Math.PI * 2),
                    scale: randRange(0.8, 1.15),
                    // Predator state
                    threatLevel: 0,
                });
                speciesCounts.set(si, speciesCounts.get(si) + 1);
                placed++;
            }
        }

        // Sort fish by species for instanced mesh ranges
        this.fish.sort((a, b) => a.speciesIndex - b.speciesIndex);
        // Build ranges
        let start = 0;
        this.speciesUsed.forEach((si) => {
            const count = speciesCounts.get(si) || 0;
            this.speciesFishRanges.set(si, { start, count });
            start += count;
        });
    }

    createMeshes() {
        this.speciesUsed.forEach((si) => {
            const range = this.speciesFishRanges.get(si);
            if (!range || range.count <= 0) return;

            const species = REEF_SPECIES[si];
            const geometry = createDwellerGeometry(species);
            const material = createDwellerMaterial(species, this.isWebGPU);

            // Per-instance attributes
            const misc = new Float32Array(range.count * 4);
            for (let i = 0; i < range.count; i++) {
                const fish = this.fish[range.start + i];
                misc[i * 4] = fish.phase;
                misc[i * 4 + 1] = fish.speed;
                misc[i * 4 + 2] = Math.random(); // pattern jitter
                misc[i * 4 + 3] = Math.random(); // shimmer
            }
            geometry.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));

            const mesh = new THREE.InstancedMesh(geometry, material, range.count);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // WS 1.2: enable frustum culling. Dwellers stay near their anchor
            // (orbit/hover/perch within ~25m), so an anchor-AABB + margin gives
            // a much tighter sphere than the fish-system domain wrap.
            if (this.anchors.length > 0) {
                let minX = Infinity; let minY = Infinity; let
                    minZ = Infinity;
                let maxX = -Infinity; let maxY = -Infinity; let
                    maxZ = -Infinity;
                for (const a of this.anchors) {
                    if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
                    if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
                    if (a.z < minZ) minZ = a.z; if (a.z > maxZ) maxZ = a.z;
                }
                const cx = (minX + maxX) * 0.5;
                const cy = (minY + maxY) * 0.5;
                const cz = (minZ + maxZ) * 0.5;
                const dx = maxX - cx;
                const dy = maxY - cy;
                const dz = maxZ - cz;
                const radius = (Math.sqrt(dx * dx + dy * dy + dz * dz) + 30) * 1.15;
                geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), radius);
                mesh.frustumCulled = true;
            }
            mesh.name = `reef-dweller-${species.name}`;
            this.scene.add(mesh);
            this.meshes.push({ mesh, speciesIndex: si, range });
            this.materials.push(material);
        });
    }

    update(dt, elapsed, { currentStrength = 0.5, heavyTick = true, heavyDt = dt } = {}) {
        if (!this.fish.length && !this.seahorseClones.length) return;
        this.elapsed = elapsed;

        // Always update uniforms (cheap, must stay at 60 Hz so time-based
        // shader effects don't strobe).
        this.materials.forEach((mat) => {
            if (mat.userData && mat.userData.uTime) {
                mat.userData.uTime.value = elapsed;
                mat.userData.uCurrentStrength.value = currentStrength;
            } else if (mat.uniforms) {
                mat.uniforms.uTime.value = elapsed;
                mat.uniforms.uCurrentStrength.value = currentStrength;
            }
        });

        // Frame striding: heavy behavior + matrix updates run at 30 Hz.
        // Skipped frames let the next heavy tick consume the accumulated dt
        // so motion stays at the same speed.
        if (!heavyTick) {
            this.updateSeahorses(dt, elapsed);
            return;
        }
        const stepDt = Math.max(heavyDt, dt);

        // Read predator influences from the fish system
        const influences = this.getFishSystem?.()?.getEnvironmentalInfluences?.() ?? [];
        const predators = influences.filter((inf) => inf.kind === 'predator');

        // Update each fish's behavior and threat
        for (let i = 0; i < this.fish.length; i++) {
            const f = this.fish[i];
            const species = REEF_SPECIES[f.speciesIndex];
            const anchor = this.anchors[f.anchorIndex];

            // Compute threat from nearby predators
            let threat = 0;
            for (let p = 0; p < predators.length; p++) {
                const pred = predators[p];
                const dx = f.x - pred.position.x;
                const dz = f.z - pred.position.z;
                const dist = Math.hypot(dx, dz) || 1;
                const falloff = clamp(1 - dist / pred.radius, 0, 1);
                const life = 1 - clamp(pred.age / pred.duration, 0, 1);
                threat = Math.max(threat, falloff * life * pred.strength);
            }
            f.threatLevel += (threat - f.threatLevel) * clamp(stepDt * 3, 0, 1);

            // Territory compression under threat
            const territoryScale = 1 - f.threatLevel * 0.7;
            const effectiveRadius = species.territoryRadius * territoryScale;
            const effectiveHover = species.hoverHeight * (1 - f.threatLevel * 0.5);
            const speedMul = 1 + f.threatLevel * 1.5;

            // Behavior-specific position updates
            switch (species.behavior) {
            case 'orbit': {
                f.orbitAngle += stepDt * (0.6 + f.speed * 0.3) * speedMul;
                const r = clamp(f.orbitRadius, 0.4, effectiveRadius);
                const figure8 = Math.sin(f.orbitAngle * 0.5) * r * 0.3;
                f.x = anchor.x + Math.cos(f.orbitAngle) * r;
                f.z = anchor.z + Math.sin(f.orbitAngle) * r + figure8;
                f.y = anchor.y + effectiveHover + Math.sin(elapsed * 1.2 + f.phase) * 0.35;
                break;
            }
            case 'hover': {
                const sway = 0.5 * (1 - f.threatLevel * 0.6);
                f.x = anchor.x + Math.sin(elapsed * 0.35 + f.phase) * sway * effectiveRadius * 0.4;
                f.z = anchor.z + Math.cos(elapsed * 0.28 + f.phase * 1.3) * sway * effectiveRadius * 0.4;
                f.y = anchor.y + effectiveHover + Math.sin(elapsed * 0.8 + f.phase) * 0.4;
                break;
            }
            case 'perch': {
                // Mostly still, occasional short dart
                f.dartTimer -= stepDt;
                if (f.dartTimer <= 0) {
                    f.dartTimer = randRange(2, 5) / speedMul;
                    const da = randRange(0, Math.PI * 2);
                    const dr = randRange(0.3, effectiveRadius * 0.5);
                    f.dartTargetX = anchor.x + Math.cos(da) * dr;
                    f.dartTargetZ = anchor.z + Math.sin(da) * dr;
                }
                f.x += (f.dartTargetX - f.x) * clamp(stepDt * 2.5, 0, 0.15);
                f.z += (f.dartTargetZ - f.z) * clamp(stepDt * 2.5, 0, 0.15);
                f.y = anchor.y + effectiveHover + Math.sin(elapsed * 0.5 + f.phase) * 0.08;
                break;
            }
            case 'peek': {
                f.peekPhase += stepDt * (0.8 + f.threatLevel * 2);
                const peekOut = Math.max(0, Math.sin(f.peekPhase)) * effectiveRadius * 0.5;
                f.x = anchor.x + Math.cos(f.phase) * peekOut;
                f.z = anchor.z + Math.sin(f.phase) * peekOut;
                f.y = anchor.y + effectiveHover + Math.sin(elapsed * 1.5 + f.phase) * 0.12;
                break;
            }
            case 'dart': {
                f.dartTimer -= stepDt * speedMul;
                if (f.dartTimer <= 0) {
                    f.dartTimer = randRange(1.2, 3.5);
                    const da = randRange(0, Math.PI * 2);
                    const dr = randRange(1, effectiveRadius);
                    f.dartTargetX = anchor.x + Math.cos(da) * dr;
                    f.dartTargetZ = anchor.z + Math.sin(da) * dr;
                }
                const lerpRate = clamp(stepDt * 3.5, 0, 0.2);
                f.x += (f.dartTargetX - f.x) * lerpRate;
                f.z += (f.dartTargetZ - f.z) * lerpRate;
                f.y = anchor.y + effectiveHover + Math.sin(elapsed * 1.8 + f.phase) * 0.55;
                break;
            }
            default:
                break;
            }
        }

        // Update instanced meshes
        this.meshes.forEach(({ mesh, range }) => {
            for (let i = 0; i < range.count; i++) {
                const f = this.fish[range.start + i];
                this.dummy.position.set(f.x, f.y, f.z);
                this.dummy.scale.setScalar(f.scale);

                // Face movement direction (approximate via velocity from anchor)
                const anchor = this.anchors[f.anchorIndex];
                const dx = f.x - anchor.x;
                const dz = f.z - anchor.z;
                const angle = Math.atan2(dz, dx);
                // Yaw-only quaternion straight into a compose — byte-identical to
                // rotation.set(0, yaw, 0) + updateMatrix(), without the Euler sync.
                this._dwellerQuat.setFromAxisAngle(this._dwellerUp, -angle + Math.PI * 0.5);
                this.dummy.matrix.compose(this.dummy.position, this._dwellerQuat, this.dummy.scale);
                mesh.setMatrixAt(i, this.dummy.matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
        });

        // Update GLB seahorses — slow hover/bob with small yaw sway. Uses
        // frame dt (not stepDt) so the GLB skinned animation stays at 60 Hz.
        this.updateSeahorses(dt, elapsed);
    }

    // ── GLB Seahorse Layer ───────────────────────────────────────────────────
    loadAndSpawnSeahorses() {
        if (this.seahorseLoadPromise) return this.seahorseLoadPromise;
        const rigged = OCEAN_REEF_SEAHORSE_RIGGED_ASSET;
        const unrigged = OCEAN_REEF_SEAHORSE_ASSET;
        const primary = rigged && rigged.url ? rigged : unrigged;
        if (!primary || !primary.url) return null;

        const tryLoad = (asset) => loadGltfCached(asset.url)
            .then((gltf) => {
                this.seahorseAsset = asset;
                this.seahorseGLTF = gltf;
                this.prepareSeahorseAsset(gltf.scene);
                this.spawnSeahorses();
            });

        this.seahorseLoadPromise = tryLoad(primary).catch((err) => {
            if (primary !== unrigged && unrigged && unrigged.url) {
                console.warn('🌊 [Ocean] Rigged seahorse GLB unavailable, falling back to unrigged:', err?.message || err);
                return tryLoad(unrigged).catch((err2) => {
                    console.warn('🌊 [Ocean] Failed to load seahorse GLB:', err2);
                });
            }
            console.warn('🌊 [Ocean] Failed to load seahorse GLB:', err);
        });
        return this.seahorseLoadPromise;
    }

    prepareSeahorseAsset(root) {
        // Same underwater transparent material treatment as rare fauna GLBs.
        // Strip excess vertex attributes to stay within WebGPU vertex buffer limits.
        const KEEP_ATTRIBUTES = new Set([
            'position', 'normal', 'uv', 'tangent', 'color',
            'skinIndex', 'skinWeight',
        ]);

        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = false;
            child.castShadow = false;
            child.receiveShadow = false;

            const { geometry } = child;
            if (geometry) {
                const attributeNames = Object.keys(geometry.attributes);
                for (const name of attributeNames) {
                    if (!KEEP_ATTRIBUTES.has(name)) {
                        geometry.deleteAttribute(name);
                    }
                }
            }

            const oldMaterials = Array.isArray(child.material) ? child.material : [child.material];
            const newMaterials = oldMaterials.map((mat) => {
                if (!mat) return mat;
                const hasVertexColors = !!(child.geometry?.getAttribute?.('color'))
                    || mat.vertexColors === true;
                const nodeMat = new MeshStandardNodeMaterial({
                    color: mat.color || new THREE.Color(0xffffff),
                    map: mat.map ?? null,
                    normalMap: mat.normalMap ?? null,
                    roughness: mat.roughness !== undefined ? mat.roughness : 0.5,
                    metalness: mat.metalness !== undefined ? mat.metalness : 0.05,
                    vertexColors: hasVertexColors,
                    transparent: false,
                    depthWrite: true,
                    opacity: 1.0,
                    side: mat.side ?? THREE.DoubleSide,
                    fog: true,
                    toneMapped: true,
                });
                if (hasVertexColors) {
                    const vColor = attribute('color', 'vec3');
                    nodeMat.colorNode = vColor.mul(TRIPOSR_VERTEX_COLOR_BOOST);
                    nodeMat.emissiveNode = vColor.mul(TRIPOSR_EMISSIVE_BOOST);
                }
                nodeMat.name = `${mat.name || 'seahorse'} reef-dweller PBR`;
                nodeMat.userData = { aquaticFaunaMaterial: true };
                mat.dispose();
                return nodeMat;
            });
            child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
        });
    }

    spawnSeahorses() {
        if (!this.seahorseGLTF || !this.anchors.length) return;
        const asset = this.seahorseAsset || OCEAN_REEF_SEAHORSE_ASSET;
        const baseScale = asset.runtimeScale;

        // The TripoSR mesh's body silhouette spans the Y–Z plane diagonally
        // (head sits at +Y/-Z, tail base at -Y/+Z), so without correction the
        // seahorse appears to lean backward. Tilt the model forward around X
        // to bring the body axis vertical. Negative X-rotation pitches the
        // head from -Z toward +Y. Tune if the lean changes after re-rigging.
        const uprightPitchX = -0.55; // ~31° forward pitch

        // Pick anchors spread across the reef
        const anchorIndices = [];
        const step = Math.max(1, Math.floor(this.anchors.length / this.seahorseCount));
        for (let i = 0; i < this.seahorseCount && anchorIndices.length < this.anchors.length; i++) {
            anchorIndices.push((i * step) % this.anchors.length);
        }

        for (let i = 0; i < anchorIndices.length; i++) {
            const anchorIdx = anchorIndices[i];
            const anchor = this.anchors[anchorIdx];
            const model = SkeletonUtils.clone(this.seahorseGLTF.scene);

            // Wrap the model in a parent Group so updateSeahorses() can drive
            // world position + yaw on the outer group while the inner model
            // holds the static upright-pitch correction undisturbed.
            const group = new THREE.Group();
            model.rotation.x = uprightPitchX;
            group.add(model);

            // Randomize scale slightly around the base
            const scaleJitter = baseScale * (0.85 + Math.random() * 0.3);
            group.scale.setScalar(scaleJitter);

            // Position near the anchor with small offset
            const offsetAngle = Math.random() * Math.PI * 2;
            const offsetR = 1.0 + Math.random() * 2.5;
            group.position.set(
                anchor.x + Math.cos(offsetAngle) * offsetR,
                anchor.y + 1.2 + Math.random() * 2.0,
                anchor.z + Math.sin(offsetAngle) * offsetR,
            );

            group.name = `reef-seahorse-${i}`;
            group.userData.isOceanReefDweller = true;
            group.userData.kind = 'seahorse';

            // Find the skeleton root inside the cloned model, then walk down
            // to grab the longest bone chain (the spine/tail for a
            // seahorse-shaped rig).
            let skeletonRoot = null;
            model.traverse((node) => {
                if (!skeletonRoot && node.isBone) skeletonRoot = node;
            });
            const tailChain = findLongestBoneChain(skeletonRoot);
            const tailInitial = tailChain.map((b) => b.rotation.clone());

            this.scene.add(group);
            this.seahorseClones.push({
                group,
                anchorIndex: anchorIdx,
                phase: Math.random() * Math.PI * 2,
                yawPhase: Math.random() * Math.PI * 2,
                bobPhase: Math.random() * Math.PI * 2,
                baseY: group.position.y,
                tailChain,
                tailInitial,
            });
        }
    }

    updateSeahorses(dt, elapsed) {
        for (let i = 0; i < this.seahorseClones.length; i++) {
            const sh = this.seahorseClones[i];
            const anchor = this.anchors[sh.anchorIndex];

            // Slow vertical bob
            sh.group.position.y = sh.baseY + Math.sin(elapsed * 0.4 + sh.bobPhase) * 0.6;

            // Small horizontal drift
            sh.group.position.x = anchor.x + Math.sin(elapsed * 0.15 + sh.phase) * 1.2;
            sh.group.position.z = anchor.z + Math.cos(elapsed * 0.12 + sh.phase * 0.7) * 0.8;

            // Small yaw sway — seahorses gently turn side to side
            sh.group.rotation.y = Math.sin(elapsed * 0.25 + sh.yawPhase) * 0.25;

            // Procedural spine/tail sway — phase travels down the chain so the
            // tail looks like a wave, with the tip moving more than the base.
            // No-op for the unrigged fallback (tailChain is empty).
            const chain = sh.tailChain;
            if (chain && chain.length) {
                const inv = 1 / chain.length;
                for (let b = 0; b < chain.length; b++) {
                    const bone = chain[b];
                    const init = sh.tailInitial[b];
                    const t = elapsed * 1.6 + sh.phase + b * 0.55;
                    const amp = 0.18 * ((b + 1) * inv);
                    bone.rotation.x = init.x;
                    bone.rotation.y = init.y + Math.cos(t * 0.7) * amp * 0.4;
                    bone.rotation.z = init.z + Math.sin(t) * amp;
                }
            }
        }
    }

    dispose() {
        this.meshes.forEach(({ mesh }) => {
            this.scene?.remove(mesh);
            mesh.geometry?.dispose();
            mesh.material?.dispose();
        });
        this.meshes = [];
        this.materials = [];
        this.fish = [];
        this.anchors = [];

        // Dispose GLB seahorse clones
        this.seahorseClones.forEach(({ group }) => {
            this.scene?.remove(group);
            group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        });
        this.seahorseClones = [];
        this.seahorseGLTF = null;
        this.seahorseLoadPromise = null;
    }
}

export default OceanReefDwellerSystem;

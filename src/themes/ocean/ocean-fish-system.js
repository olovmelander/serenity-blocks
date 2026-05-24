/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp as tslClamp,
    dot,
    exp,
    float,
    length,
    max as tslMax,
    mix,
    normalize as tslNormalize,
    normalize,
    normalWorld,
    positionLocal,
    positionWorld,
    pow as tslPow,
    pow,
    reflect,
    sin,
    smoothstep,
    uniform,
    vec3,
    texture,
    vec2,
} from 'three/tsl';
import { tslCausticProjection } from './ocean-tsl-helpers.js';
import {
    OCEAN_FAUNA_ASSET_VERSION,
    OCEAN_HERO_FISH_ASSETS,
    summarizeFaunaAssetManifest,
} from './ocean-fauna-assets.js';
import { getModelForwardVector } from './ocean-rare-fauna-system.js';

const FORWARD = new THREE.Vector3(1, 0, 0);
const FISH_AREA_X = 135;
const FISH_AREA_Z = 135;
const SURFACE_Y = 60;
const SCHOOL_COUNT = 6;
const HERO_ASSET_MAX_ACTIVE = 7;

const textureLoader = new THREE.TextureLoader();
let fishScaleNormalMap = null;
function getFishScaleNormalMap() {
    if (!fishScaleNormalMap) {
        fishScaleNormalMap = typeof document === 'undefined'
            ? new THREE.Texture()
            : textureLoader.load('/src/themes/ocean/assets/textures/fish-scales-normal.png');
        fishScaleNormalMap.wrapS = THREE.RepeatWrapping;
        fishScaleNormalMap.wrapT = THREE.RepeatWrapping;
    }
    return fishScaleNormalMap;
}

const SPECIES = [
    {
        name: 'reef-tang',
        bodyLength: 1.35,
        bodyHeight: 0.32,
        bodyWidth: 0.18,
        tailHeight: 0.58,
        stripeFrequency: 16,
        patternStrength: 0.38,
        base: new THREE.Color(0x16d9cc),
        accent: new THREE.Color(0xffe26c),
    },
    {
        name: 'silver-sardine',
        bodyLength: 1.45,
        bodyHeight: 0.22,
        bodyWidth: 0.13,
        tailHeight: 0.42,
        stripeFrequency: 24,
        patternStrength: 0.18,
        base: new THREE.Color(0xd2f5f9),
        accent: new THREE.Color(0x2fa9b8),
    },
    {
        name: 'ember-anthias',
        bodyLength: 1.18,
        bodyHeight: 0.28,
        bodyWidth: 0.16,
        tailHeight: 0.5,
        stripeFrequency: 11,
        patternStrength: 0.44,
        base: new THREE.Color(0xff5e3a),
        accent: new THREE.Color(0xffd700),
    },
    {
        name: 'sunlit-bannerfish',
        bodyLength: 1.28,
        bodyHeight: 0.36,
        bodyWidth: 0.15,
        tailHeight: 0.5,
        stripeFrequency: 9,
        patternStrength: 0.56,
        base: new THREE.Color(0xfff142),
        accent: new THREE.Color(0x123456),
    },
];

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

function roundMetric(value, decimals = 2) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** decimals;
    return Math.round(value * scale) / scale;
}

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

function addVertex(vertices, bodyCoords, x, y, z, bodyCoord) {
    const index = vertices.length / 3;
    vertices.push(x, y, z);
    bodyCoords.push(bodyCoord);
    return index;
}

function addTriangle(indices, a, b, c) {
    indices.push(a, b, c);
}

function createFishGeometry(species, isWebGPU = false) {
    const vertices = [];
    const bodyCoords = [];
    const indices = [];
    const radialSegments = 10;
    const halfLength = species.bodyLength * 0.5;

    const ringDefs = [
        {
            x: -halfLength * 0.82,
            width: 0.22,
            height: 0.24,
            coord: 0.08,
        },
        {
            x: -halfLength * 0.55,
            width: 0.72,
            height: 0.76,
            coord: 0.2,
        },
        {
            x: -halfLength * 0.12,
            width: 1.0,
            height: 1.0,
            coord: 0.42,
        },
        {
            x: halfLength * 0.28,
            width: 0.9,
            height: 0.9,
            coord: 0.66,
        },
        {
            x: halfLength * 0.72,
            width: 0.42,
            height: 0.5,
            coord: 0.9,
        },
    ];
    const ringIndices = [];

    ringDefs.forEach((ring) => {
        const currentRing = [];
        for (let s = 0; s < radialSegments; s++) {
            const a = (s / radialSegments) * Math.PI * 2;
            currentRing.push(
                addVertex(
                    vertices,
                    bodyCoords,
                    ring.x,
                    Math.sin(a) * species.bodyHeight * ring.height,
                    Math.cos(a) * species.bodyWidth * ring.width,
                    ring.coord,
                ),
            );
        }
        ringIndices.push(currentRing);
    });

    for (let r = 0; r < ringIndices.length - 1; r++) {
        const ringA = ringIndices[r];
        const ringB = ringIndices[r + 1];
        for (let s = 0; s < radialSegments; s++) {
            const next = (s + 1) % radialSegments;
            addTriangle(indices, ringA[s], ringA[next], ringB[s]);
            addTriangle(indices, ringA[next], ringB[next], ringB[s]);
        }
    }

    const tailRoot = addVertex(vertices, bodyCoords, -halfLength * 0.94, 0, 0, 0.02);
    const headTip = addVertex(vertices, bodyCoords, halfLength * 1.08, 0, 0, 1.0);
    const firstRing = ringIndices[0];
    const lastRing = ringIndices[ringIndices.length - 1];

    for (let s = 0; s < radialSegments; s++) {
        const next = (s + 1) % radialSegments;
        addTriangle(indices, tailRoot, firstRing[s], firstRing[next]);
        addTriangle(indices, headTip, lastRing[next], lastRing[s]);
    }

    const tailX = -halfLength * 1.18;
    const tailTop = addVertex(vertices, bodyCoords, tailX, species.tailHeight * 0.52, 0, 0);
    const tailFar = addVertex(vertices, bodyCoords, tailX - species.bodyLength * 0.18, 0, 0, 0);
    const tailBottom = addVertex(vertices, bodyCoords, tailX, -species.tailHeight * 0.52, 0, 0);
    addTriangle(indices, tailRoot, tailTop, tailFar);
    addTriangle(indices, tailRoot, tailFar, tailBottom);

    const dorsalA = addVertex(
        vertices,
        bodyCoords,
        -halfLength * 0.22,
        species.bodyHeight * 0.75,
        0,
        0.36,
    );
    const dorsalB = addVertex(
        vertices,
        bodyCoords,
        halfLength * 0.1,
        species.bodyHeight * 1.72,
        0,
        0.58,
    );
    const dorsalC = addVertex(
        vertices,
        bodyCoords,
        halfLength * 0.45,
        species.bodyHeight * 0.58,
        0,
        0.78,
    );
    addTriangle(indices, dorsalA, dorsalB, dorsalC);

    const ventralA = addVertex(
        vertices,
        bodyCoords,
        -halfLength * 0.08,
        -species.bodyHeight * 0.7,
        0,
        0.45,
    );
    const ventralB = addVertex(
        vertices,
        bodyCoords,
        halfLength * 0.15,
        -species.bodyHeight * 1.28,
        0,
        0.58,
    );
    const ventralC = addVertex(
        vertices,
        bodyCoords,
        halfLength * 0.38,
        -species.bodyHeight * 0.48,
        0,
        0.72,
    );
    addTriangle(indices, ventralA, ventralC, ventralB);

    const sideFinX = halfLength * 0.12;
    const finBackX = -halfLength * 0.08;
    const sideZ = species.bodyWidth * 1.02;
    const finDrop = -species.bodyHeight * 0.62;
    const rightA = addVertex(
        vertices,
        bodyCoords,
        sideFinX,
        -species.bodyHeight * 0.08,
        sideZ,
        0.58,
    );
    const rightB = addVertex(
        vertices,
        bodyCoords,
        finBackX,
        finDrop,
        sideZ + species.bodyWidth * 1.35,
        0.46,
    );
    const rightC = addVertex(
        vertices,
        bodyCoords,
        sideFinX + species.bodyLength * 0.14,
        -species.bodyHeight * 0.22,
        sideZ,
        0.68,
    );
    const leftA = addVertex(
        vertices,
        bodyCoords,
        sideFinX,
        -species.bodyHeight * 0.08,
        -sideZ,
        0.58,
    );
    const leftB = addVertex(
        vertices,
        bodyCoords,
        finBackX,
        finDrop,
        -sideZ - species.bodyWidth * 1.35,
        0.46,
    );
    const leftC = addVertex(
        vertices,
        bodyCoords,
        sideFinX + species.bodyLength * 0.14,
        -species.bodyHeight * 0.22,
        -sideZ,
        0.68,
    );
    addTriangle(indices, rightA, rightB, rightC);
    addTriangle(indices, leftA, leftC, leftB);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (!isWebGPU) {
        geometry.setAttribute('aBodyCoord', new THREE.Float32BufferAttribute(bodyCoords, 1));
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
}

function createFishNodeMaterial(species) {
    const material = new MeshBasicNodeMaterial({
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const uGlowIntensity = uniform(0.8);

    const aMisc = attribute('aMisc', 'vec4');
    const aPackedBase = attribute('aBaseColor', 'vec4');
    const aBodyCoord = tslClamp(
        positionLocal.x
            .add(float(species.bodyLength * 0.77))
            .mul(float(1 / (species.bodyLength * 1.32))),
        float(0.0),
        float(1.0),
    );
    const aPhase = aMisc.x;
    const aSpeed = aMisc.y;
    const aPattern = aMisc.z;
    const aShimmer = aMisc.w;
    const aHero = aPackedBase.w;
    const aBaseColor = aPackedBase.xyz;
    const aAccentColor = vec3(species.accent.r, species.accent.g, species.accent.b)
        .mul(float(0.92).add(aShimmer.mul(0.18)));

    const tailWeight = pow(
        float(1.0).sub(tslClamp(aBodyCoord, float(0.0), float(1.0))),
        float(2.2),
    );
    const swim = sin(
        uTime
            .mul(float(5.0).add(aSpeed.mul(0.45)))
            .add(aPhase)
            .add(aBodyCoord.mul(5.4)),
    );
    const fineSwim = sin(
        uTime
            .mul(float(9.0).add(aSpeed.mul(0.5)))
            .add(aPhase.mul(1.7))
            .add(aBodyCoord.mul(12.0)),
    );
    const bend = swim
        .mul(0.13)
        .add(fineSwim.mul(0.025))
        .mul(tailWeight)
        .mul(float(0.75).add(uCurrentStrength.mul(0.2)));
    const swimLift = sin(uTime.mul(2.0).add(aPhase).add(aBodyCoord.mul(3.0)))
        .mul(0.018)
        .mul(tailWeight);
    material.positionNode = positionLocal.add(vec3(float(0.0), swimLift, bend));

    const scaleTilingX = float(18.0);
    const scaleTilingY = float(24.0);
    const scaleUV = vec2(aBodyCoord.mul(scaleTilingX), positionLocal.y.mul(scaleTilingY));
    const texNormal = texture(getFishScaleNormalMap(), scaleUV).xyz.mul(2.0).sub(1.0);

    const baseNormal = normalize(normalWorld);
    const normal = normalize(baseNormal.add(texNormal.mul(1.4)));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const lightDir = normalize(vec3(0.22, 0.94, -0.2));
    const diffuse = tslMax(dot(normal, lightDir), float(0.0)).mul(0.68).add(0.42);
    const rim = pow(float(1.0).sub(tslMax(dot(normal, viewDir), float(0.0))), float(2.0));
    const spec = pow(
        tslMax(dot(reflect(lightDir.negate(), normal), viewDir), float(0.0)),
        float(48.0),
    );

    // Procedural iridescence/shimmer for scales
    const scaleShimmer = sin(aBodyCoord.mul(float(120.0)).add(dot(normal, viewDir).mul(float(15.0))))
        .mul(0.5).add(0.5)
        .mul(rim.mul(0.6));

    const stripeWave = sin(
        aBodyCoord.mul(float(species.stripeFrequency)).add(aPattern.mul(6.28318)),
    );
    const stripe = smoothstep(float(0.42), float(0.92), stripeWave).mul(species.patternStrength);
    const lateralLine = smoothstep(float(0.04), float(0.0), abs(normal.y)).mul(0.14);

    const causticA = sin(positionWorld.x.mul(0.18).add(uTime.mul(0.9)).add(aShimmer.mul(6.0)));
    const causticB = sin(positionWorld.z.mul(0.16).sub(uTime.mul(0.72)));
    const caustic = pow(tslMax(causticA.mul(causticB).mul(0.5).add(0.5), float(0.0)), float(5.0));
    const scaleFlicker = sin(aBodyCoord.mul(52.0).add(aShimmer.mul(10.0))).mul(0.035);

    let color = mix(aBaseColor, aAccentColor, stripe);
    color = mix(color, aAccentColor, lateralLine);
    color = color.mul(diffuse);
    color = color.add(aAccentColor.mul(caustic.mul(0.2).add(rim.mul(0.24)).add(scaleFlicker)));
    color = color.add(vec3(0.8, 0.95, 1.0).mul(scaleShimmer.mul(0.35)));
    color = color.add(
        vec3(0.8, 1.0, 0.92)
            .mul(spec)
            .mul(float(0.45).add(aHero.mul(0.12))),
    );
    color = color.add(
        vec3(0.1, 0.65, 0.75)
            .mul(uGlowIntensity)
            .mul(float(0.045).add(rim.mul(0.12))),
    );

    const viewDist = length(cameraPosition.sub(positionWorld));
    color = mix(
        color,
        vec3(0.035, 0.3, 0.31),
        smoothstep(float(48.0), float(168.0), viewDist).mul(0.13),
    );
    color = color.mul(float(1.0).add(aHero.mul(0.08)));

    const fog = float(1.0).sub(exp(viewDist.negate().mul(0.009)));
    color = mix(color, vec3(0.02, 0.2, 0.25), tslClamp(fog.mul(0.55), float(0.0), float(0.72)));

    material.colorNode = color.add(aBaseColor.mul(0.1)); // Visibility lift
    material.emissiveNode = vec3(0.0);
    material.userData = { uTime, uCurrentStrength, uGlowIntensity };

    return material;
}

function createFishMaterial(species, isWebGPU = false) {
    if (isWebGPU) return createFishNodeMaterial(species);

    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCurrentStrength: { value: 0.5 },
            uGlowIntensity: { value: 0.8 },
            uFogColor: { value: new THREE.Color(0x002a34) },
            uStripeFrequency: { value: species.stripeFrequency },
            uPatternStrength: { value: species.patternStrength },
            uNormalMap: { value: getFishScaleNormalMap() },
        },
        vertexShader: `
            uniform float uTime;
            uniform float uCurrentStrength;
            attribute float aBodyCoord;
            attribute vec4 aMisc;
            attribute vec4 aBaseColor;
            attribute vec4 aAccentColor;
            varying float vBodyCoord;
            varying float vPattern;
            varying float vShimmer;
            varying float vHero;
            varying float vDist;
            varying vec3 vBaseColor;
            varying vec3 vAccentColor;
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;
            varying vec2 vScaleUV;

            void main() {
                float aPhase = aMisc.x;
                float aSpeed = aMisc.y;
                float aPattern = aMisc.z;
                float aShimmer = aMisc.w;
                float aHero = aBaseColor.w;

                float tailWeight = pow(1.0 - clamp(aBodyCoord, 0.0, 1.0), 2.2);
                float swim = sin(uTime * (5.0 + aSpeed * 0.45) + aPhase + aBodyCoord * 5.4);
                float fineSwim = sin(uTime * (9.0 + aSpeed * 0.5) + aPhase * 1.7 + aBodyCoord * 12.0);
                float bend = (swim * 0.13 + fineSwim * 0.025) * tailWeight * (0.75 + uCurrentStrength * 0.2);

                vec3 pos = position;
                pos.z += bend;
                pos.y += sin(uTime * 2.0 + aPhase + aBodyCoord * 3.0) * 0.018 * tailWeight;

                vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
                vec4 mvPos = viewMatrix * worldPos;

                vBodyCoord = aBodyCoord;
                vPattern = aPattern;
                vShimmer = aShimmer;
                vHero = aHero;
                vDist = length(mvPos.xyz);
                vBaseColor = aBaseColor.xyz;
                vAccentColor = aAccentColor.xyz;
                vWorldPos = worldPos.xyz;
                vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
                vScaleUV = vec2(aBodyCoord * 18.0, position.y * 24.0);

                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uGlowIntensity;
            uniform float uStripeFrequency;
            uniform float uPatternStrength;
            uniform vec3 uFogColor;
            uniform sampler2D uNormalMap;
            varying float vBodyCoord;
            varying float vPattern;
            varying float vShimmer;
            varying float vHero;
            varying float vDist;
            varying vec3 vBaseColor;
            varying vec3 vAccentColor;
            varying vec3 vWorldPos;
            varying vec3 vWorldNormal;
            varying vec2 vScaleUV;

            void main() {
                vec3 baseNormal = normalize(vWorldNormal);
                vec3 scaleNormal = texture2D(uNormalMap, vScaleUV).xyz * 2.0 - 1.0;
                vec3 normal = normalize(baseNormal + scaleNormal * 1.2);
                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                vec3 lightDir = normalize(vec3(0.22, 0.94, -0.2));

                float diffuse = max(dot(normal, lightDir), 0.0) * 0.74 + 0.34;
                float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.2);
                float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 38.0);
                float stripeWave = sin(vBodyCoord * uStripeFrequency + vPattern * 6.28318);
                float stripe = smoothstep(0.42, 0.92, stripeWave) * uPatternStrength;
                float lateralLine = smoothstep(0.04, 0.0, abs(normal.y)) * 0.14;

                float causticA = sin(vWorldPos.x * 0.18 + uTime * 0.9 + vShimmer * 6.0);
                float causticB = sin(vWorldPos.z * 0.16 - uTime * 0.72);
                float caustic = pow(max((causticA * causticB) * 0.5 + 0.5, 0.0), 5.0);
                float scaleFlicker = sin(vBodyCoord * 52.0 + vShimmer * 10.0) * 0.035;

                vec3 color = mix(vBaseColor, vAccentColor, stripe);
                color = mix(color, vAccentColor, lateralLine);
                color *= diffuse;
                color += vAccentColor * (caustic * 0.2 + rim * 0.24 + scaleFlicker);
                color += vec3(0.7, 0.95, 0.82) * spec * (0.1 + vHero * 0.08);
                color += vec3(0.08, 0.55, 0.62) * uGlowIntensity * (0.035 + rim * 0.07);
                color = mix(color, vec3(0.035, 0.3, 0.31), smoothstep(48.0, 168.0, vDist) * 0.13);
                color *= 1.0 + vHero * 0.08;

                float fog = 1.0 - exp(-vDist * 0.0105);
                color = mix(color, uFogColor, clamp(fog * 0.58, 0.0, 0.76));

                gl_FragColor = vec4(color, 1.0);
            }
        `,
        side: THREE.DoubleSide,
    });
}

export class OceanFishSystem {
    constructor({
        scene, camera, preset, getSeabedHeight, isPointOccupied, isWebGPU = false,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.getSeabedHeight = getSeabedHeight;
        this.isPointOccupied = (x, z, r) => (isPointOccupied ? isPointOccupied(x, z, r) : false);
        this.isWebGPU = isWebGPU;

        this.meshes = [];
        this.materials = [];
        this.totalSchoolFish = Math.max(0, Math.floor(preset.fishCount ?? 0));
        this.heroCount = Math.max(0, Math.floor(preset.heroFishCount ?? 0));
        this.totalFish = this.totalSchoolFish + this.heroCount;
        this.heroAssetCount = Math.min(
            HERO_ASSET_MAX_ACTIVE,
            Math.max(0, Math.ceil(this.heroCount / 4)),
        );

        this.positions = new Float32Array(this.totalFish * 3);
        this.velocities = new Float32Array(this.totalFish * 3);
        this.scales = new Float32Array(this.totalFish);
        this.phases = new Float32Array(this.totalFish);
        this.speeds = new Float32Array(this.totalFish);
        this.speciesIndices = new Uint8Array(this.totalFish);
        this.localIndices = new Uint16Array(this.totalFish);
        this.schoolIndices = new Uint8Array(this.totalFish);
        this.heroFlags = new Uint8Array(this.totalFish);
        this.laneY = new Float32Array(this.totalFish);

        this.schoolStarts = new Uint16Array(SCHOOL_COUNT);
        this.schoolEnds = new Uint16Array(SCHOOL_COUNT);
        this.schoolGoals = new Float32Array(SCHOOL_COUNT * 3);
        this.schoolSeeds = new Float32Array(SCHOOL_COUNT * 4);
        this.schoolThreatOffsets = new Float32Array(SCHOOL_COUNT * 3);

        this.activeSchoolFish = 0;
        this.activeHeroFish = 0;
        this.activeFishCount = 0;
        this.nextSchoolToActivate = 0;
        this.populationRevealAge = 0;
        this.nextPopulationRevealAt = 0.7;
        this.populationRevealInterval = 0.72;
        this.heroAssetLoadDelay = 2.4;
        this.heroAssetLoadStarted = false;

        this.dummy = new THREE.Object3D();
        this.direction = new THREE.Vector3(1, 0, 0);
        this.heroProjection = new THREE.Vector3();
        this.heroAssetProjection = new THREE.Vector3();
        this.heroAssetDirection = new THREE.Vector3(1, 0, 0);
        this.heroAssetLoader = null;
        this.heroAssetLoadPromise = null;
        this.heroAssetRecords = new Map();
        this.heroAssetCreatures = [];
        this.heroAssetStatus = Object.fromEntries(
            OCEAN_HERO_FISH_ASSETS.map((asset) => [asset.id, 'idle']),
        );
        this.heroAssetErrors = Object.fromEntries(
            OCEAN_HERO_FISH_ASSETS.map((asset) => [asset.id, null]),
        );
        this.gameplaySurge = 0;
        this.gameplaySurgeAnchor = new THREE.Vector3();
        this.environmentalInfluences = [];
    }

    init() {
        if (!this.scene || this.totalFish <= 0) return;

        this.assignSpecies();
        this.seedSchools();
        this.seedFishState();
        this.createMeshes();
        this.activateInitialPopulation();
        // Priming only writes the first active wave into instance matrices.
        // Later schools stay outside mesh.count until their reveal timer fires.
        this.updateMatrices();
    }

    assignSpecies() {
        const speciesCounts = new Uint16Array(SPECIES.length);
        for (let i = 0; i < this.totalFish; i++) {
            const pick = (i * 37) % 100;
            let speciesIndex = 0;
            if (pick >= 40 && pick < 66) speciesIndex = 1;
            else if (pick >= 66 && pick < 86) speciesIndex = 2;
            else if (pick >= 86) speciesIndex = 3;

            this.speciesIndices[i] = speciesIndex;
            this.localIndices[i] = speciesCounts[speciesIndex];
            speciesCounts[speciesIndex]++;
        }
        this.speciesCounts = speciesCounts;
    }

    seedSchools() {
        const basePerSchool = Math.floor(this.totalSchoolFish / SCHOOL_COUNT);
        let start = 0;
        for (let s = 0; s < SCHOOL_COUNT; s++) {
            const extra = s < this.totalSchoolFish % SCHOOL_COUNT ? 1 : 0;
            const count = basePerSchool + extra;
            this.schoolStarts[s] = start;
            this.schoolEnds[s] = start + count;
            start += count;

            const i4 = s * 4;
            const i3 = s * 3;
            const sideLane = s % 3 === 1 ? -1 : 1;
            const centerSchool = s % 3 === 2;
            const depthLayer = s / Math.max(1, SCHOOL_COUNT - 1);
            this.schoolSeeds[i4] = centerSchool ? randRange(-46, 46) : sideLane * randRange(44, 105);
            this.schoolSeeds[i4 + 1] = randRange(20, 52) + Math.sin(depthLayer * Math.PI) * 10;
            this.schoolSeeds[i4 + 2] = randRange(-122, -14) + depthLayer * 34;

            // Collision Check: If the school center is inside a rock, nudge it out
            if (this.isPointOccupied(this.schoolSeeds[i4], this.schoolSeeds[i4 + 2], 12)) {
                this.schoolSeeds[i4] += sideLane * 20;
                this.schoolSeeds[i4 + 2] += 20;
            }

            this.schoolSeeds[i4 + 3] = randRange(0, Math.PI * 2);
            this.schoolGoals[i3] = this.schoolSeeds[i4];
            this.schoolGoals[i3 + 1] = this.schoolSeeds[i4 + 1];
            this.schoolGoals[i3 + 2] = this.schoolSeeds[i4 + 2];
        }
    }

    seedFishState() {
        // Spawn each school clustered off-camera on one of the far sides.
        // The existing school goal-seeking + flocking forces (see
        // updateSchoolGoals / updateSchoolFish) naturally pull them toward
        // their target position over the next several seconds, producing a
        // cinematic swim-in that hides startup population cost behind motion.
        const SPAWN_X = 175;
        for (let s = 0; s < SCHOOL_COUNT; s++) {
            const start = this.schoolStarts[s];
            const end = this.schoolEnds[s];
            const seed = s * 4;
            const targetX = this.schoolSeeds[seed];
            const cy = this.schoolSeeds[seed + 1];
            const cz = this.schoolSeeds[seed + 2];

            // Pick a side: if school target is offset to one side use the
            // far side as origin (longer swim), otherwise alternate by index.
            let spawnSign = s % 2 === 0 ? -1 : 1;
            if (Math.abs(targetX) > 6) {
                spawnSign = targetX < 0 ? -1 : 1;
            }
            const spawnX = spawnSign * SPAWN_X;
            const inwardSpeed = randRange(5.0, 7.5);

            for (let i = start; i < end; i++) {
                const angle = randRange(0, Math.PI * 2);
                const radius = randRange(4, 18);
                const i3 = i * 3;
                const speed = randRange(4.2, 7.2);

                this.schoolIndices[i] = s;
                this.positions[i3] = spawnX + Math.cos(angle) * radius;
                this.positions[i3 + 1] = cy + randRange(-6, 6);
                this.positions[i3 + 2] = cz + Math.sin(angle) * radius;
                // Initial velocity points toward the school target so the
                // flock arrives organized instead of dispersing first.
                this.velocities[i3] = -spawnSign * inwardSpeed;
                this.velocities[i3 + 1] = randRange(-0.25, 0.25);
                this.velocities[i3 + 2] = randRange(-0.6, 0.6);
                this.speeds[i] = speed;
                this.scales[i] = randRange(1.25, 2.15);
                this.phases[i] = randRange(0, Math.PI * 2);
                this.laneY[i] = cy;
            }
        }

        for (let i = this.totalSchoolFish; i < this.totalFish; i++) {
            const i3 = i * 3;
            const dir = Math.random() < 0.5 ? 1 : -1;
            const speed = randRange(10, 16);

            this.heroFlags[i] = 1;
            this.positions[i3] = dir * randRange(92, 132);
            this.positions[i3 + 1] = Math.random() < 0.5 ? randRange(24, 34) : randRange(46, 58);
            this.positions[i3 + 2] = randRange(24, 66);
            this.velocities[i3] = -dir * speed;
            this.velocities[i3 + 1] = randRange(-0.25, 0.25);
            this.velocities[i3 + 2] = randRange(-0.6, 0.6);
            this.speeds[i] = speed;
            this.scales[i] = randRange(3.05, 4.45);
            this.phases[i] = randRange(0, Math.PI * 2);
            this.laneY[i] = this.positions[i3 + 1];
        }
    }

    activateInitialPopulation() {
        if (this.totalSchoolFish > 0) {
            this.activateNextSchool();
        } else if (this.heroCount > 0) {
            this.activateHeroFish();
        } else {
            this.syncActiveMeshCounts();
        }
    }

    activateNextSchool() {
        if (this.nextSchoolToActivate >= SCHOOL_COUNT) return false;

        const schoolIndex = this.nextSchoolToActivate;
        this.nextSchoolToActivate += 1;
        this.activeSchoolFish = Math.max(
            this.activeSchoolFish,
            this.schoolEnds[schoolIndex],
        );
        this.syncActiveMeshCounts();
        return true;
    }

    activateHeroFish() {
        if (this.activeHeroFish >= this.heroCount) return false;
        this.activeHeroFish = this.heroCount;
        this.syncActiveMeshCounts();
        return true;
    }

    updatePopulationReveal(dt) {
        this.populationRevealAge += dt;

        if (this.populationRevealAge >= this.nextPopulationRevealAt) {
            if (this.activeSchoolFish < this.totalSchoolFish) {
                this.activateNextSchool();
                this.nextPopulationRevealAt += this.populationRevealInterval;
            } else if (this.activeHeroFish < this.heroCount) {
                this.activateHeroFish();
                this.nextPopulationRevealAt += 0.45;
            }
        }

        if (
            !this.heroAssetLoadStarted
            && this.heroAssetCount > 0
            && this.populationRevealAge >= this.heroAssetLoadDelay
        ) {
            this.heroAssetLoadStarted = true;
            this.initHeroAssetLayer();
        }
    }

    syncActiveMeshCounts() {
        this.activeSchoolFish = clamp(this.activeSchoolFish, 0, this.totalSchoolFish);
        this.activeHeroFish = clamp(this.activeHeroFish, 0, this.heroCount);
        this.activeFishCount = this.activeSchoolFish >= this.totalSchoolFish
            ? this.totalSchoolFish + this.activeHeroFish
            : this.activeSchoolFish;

        const activeSpeciesCounts = new Uint16Array(SPECIES.length);
        for (let i = 0; i < this.activeFishCount; i++) {
            activeSpeciesCounts[this.speciesIndices[i]]++;
        }

        this.meshes.forEach((mesh, speciesIndex) => {
            if (mesh) mesh.count = activeSpeciesCounts[speciesIndex] || 0;
        });
    }

    createMeshes() {
        for (let speciesIndex = 0; speciesIndex < SPECIES.length; speciesIndex++) {
            const count = this.speciesCounts[speciesIndex];
            if (count <= 0) continue;

            const species = SPECIES[speciesIndex];
            const geometry = createFishGeometry(species, this.isWebGPU);
            const material = createFishMaterial(species, this.isWebGPU);
            const misc = new Float32Array(count * 4);
            const baseColor = new Float32Array(count * 4);
            const accentColor = new Float32Array(count * 4);

            for (let i = 0; i < this.totalFish; i++) {
                if (this.speciesIndices[i] !== speciesIndex) continue;
                const local = this.localIndices[i];
                const colorJitter = randRange(0.82, 1.16);
                const accentJitter = randRange(0.88, 1.22);
                misc[local * 4] = this.phases[i];
                misc[local * 4 + 1] = this.speeds[i];
                misc[local * 4 + 2] = Math.random();
                misc[local * 4 + 3] = Math.random();
                baseColor[local * 4] = clamp(species.base.r * colorJitter, 0, 1);
                baseColor[local * 4 + 1] = clamp(species.base.g * colorJitter, 0, 1);
                baseColor[local * 4 + 2] = clamp(species.base.b * colorJitter, 0, 1);
                baseColor[local * 4 + 3] = this.heroFlags[i];
                accentColor[local * 4] = clamp(species.accent.r * accentJitter, 0, 1);
                accentColor[local * 4 + 1] = clamp(species.accent.g * accentJitter, 0, 1);
                accentColor[local * 4 + 2] = clamp(species.accent.b * accentJitter, 0, 1);
                accentColor[local * 4 + 3] = 0;
            }

            geometry.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
            geometry.setAttribute('aBaseColor', new THREE.InstancedBufferAttribute(baseColor, 4));
            if (!this.isWebGPU) {
                geometry.setAttribute(
                    'aAccentColor',
                    new THREE.InstancedBufferAttribute(accentColor, 4),
                );
            }

            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.count = 0;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            this.scene.add(mesh);
            this.meshes[speciesIndex] = mesh;
            this.materials[speciesIndex] = material;
        }
    }

    initHeroAssetLayer() {
        if (!this.scene || this.heroAssetCount <= 0 || !OCEAN_HERO_FISH_ASSETS.length) return;
        if (this.heroAssetLoadPromise) return;

        this.heroAssetLoadStarted = true;
        this.heroAssetLoader = new GLTFLoader();
        this.heroAssetLoadPromise = (async () => {
            const results = [];
            for (const asset of OCEAN_HERO_FISH_ASSETS) {
                const res = await this.loadHeroAsset(asset);
                results.push(res);
                await new Promise((resolve) => { setTimeout(resolve, 30); });
            }
            this.spawnHeroAssetInstances();
            return this.heroAssetRecords;
        })();
    }

    async loadHeroAsset(asset) {
        if (this.heroAssetRecords.has(asset.id)) return this.heroAssetRecords.get(asset.id);
        this.heroAssetStatus[asset.id] = 'loading';

        try {
            const gltf = await this.heroAssetLoader.loadAsync(asset.url);
            this.prepareHeroAsset(gltf.scene);
            const record = { gltf, asset };
            this.heroAssetRecords.set(asset.id, record);
            this.heroAssetStatus[asset.id] = 'loaded';
            this.heroAssetErrors[asset.id] = null;
            return record;
        } catch (error) {
            this.heroAssetStatus[asset.id] = 'error';
            this.heroAssetErrors[asset.id] = error?.message || String(error);
            console.warn(`🌊 [Ocean] Hero fish asset ${asset.id} failed to load:`, error);
            return null;
        }
    }

    prepareHeroAsset(root) {
        const keepAttributes = new Set(['position', 'normal', 'uv', 'tangent', 'color', 'skinIndex', 'skinWeight']);

        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = false;
            child.castShadow = false;
            child.receiveShadow = false;

            const { geometry } = child;
            if (geometry) {
                Object.keys(geometry.attributes).forEach((name) => {
                    if (!keepAttributes.has(name)) geometry.deleteAttribute(name);
                });
            }

            const sourceMaterials = Array.isArray(child.material)
                ? child.material
                : [child.material];
            const normalized = sourceMaterials.map((source) => {
                if (!source) return source;

                const hasVertexColors = !!(child.geometry?.getAttribute?.('color'))
                    || source.vertexColors === true;
                const nodeMat = new MeshStandardNodeMaterial({
                    color: source.color || new THREE.Color(0xffffff),
                    map: source.map ?? null,
                    normalMap: source.normalMap ?? null,
                    roughnessMap: source.roughnessMap ?? null,
                    metalnessMap: source.metalnessMap ?? null,
                    roughness: source.roughness !== undefined ? source.roughness : 0.4,
                    metalness: source.metalness !== undefined ? source.metalness : 0.1,
                    envMapIntensity: 1.2,
                    transparent: true,
                    opacity: 0,
                    depthWrite: true,
                    side: source.side ?? THREE.DoubleSide,
                    vertexColors: hasVertexColors,
                    fog: true,
                    toneMapped: true,
                });

                const uTime = uniform(0);
                const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.18);

                const viewDir = tslNormalize(cameraPosition.sub(positionWorld));
                const rimFresnel = tslPow(
                    float(1.0).sub(tslMax(dot(normalWorld, viewDir), float(0.0))),
                    float(2.5),
                );
                const rimColor = vec3(0.1, 0.5, 0.6).mul(rimFresnel).mul(0.45);
                const causticColor = vec3(0.4, 0.9, 0.8).mul(caustic).mul(0.28);

                nodeMat.emissiveNode = causticColor.add(rimColor);
                if (source.emissiveMap) {
                    nodeMat.emissiveMap = source.emissiveMap;
                    nodeMat.emissiveIntensity = source.emissiveIntensity !== undefined ? source.emissiveIntensity : 1;
                } else if (
                    source.emissive
                    && (source.emissive.r > 0 || source.emissive.g > 0 || source.emissive.b > 0)
                ) {
                    nodeMat.emissive = source.emissive;
                    nodeMat.emissiveIntensity = source.emissiveIntensity !== undefined ? source.emissiveIntensity : 1;
                }

                nodeMat.name = `${source.name || child.name || 'hero-fish'} AAA PBR`;
                nodeMat.userData = {
                    uTime,
                    aquaticFaunaMaterial: true,
                    sourceMaterial: source.name || null,
                    alphaDistanceFade: true,
                    underwaterRimHint: true,
                };
                source.dispose();
                return nodeMat;
            });
            child.material = Array.isArray(child.material) ? normalized : normalized[0];
        });
    }

    spawnHeroAssetInstances() {
        if (!this.scene || this.heroAssetCount <= 0) return;
        const records = OCEAN_HERO_FISH_ASSETS
            .map((asset) => this.heroAssetRecords.get(asset.id))
            .filter(Boolean);
        if (!records.length) return;

        while (this.heroAssetCreatures.length < this.heroAssetCount) {
            const record = records[this.heroAssetCreatures.length % records.length];
            this.spawnHeroAssetCreature(record);
        }
    }

    spawnHeroAssetCreature(record, forcedPosition = null) {
        if (!record?.gltf?.scene || !this.scene) return false;
        const { asset, gltf } = record;
        const group = SkeletonUtils.clone(gltf.scene);
        const materials = this.collectHeroAssetMaterials(group, asset);
        const mixer = gltf.animations.length ? new THREE.AnimationMixer(group) : null;
        const direction = Math.random() < 0.5 ? 1 : -1;

        if (mixer) {
            gltf.animations.forEach((clip) => {
                const action = mixer.clipAction(clip);
                action.play();
                action.time = randRange(0, Math.max(0.001, clip.duration));
            });
        }

        const creature = {
            assetId: asset.id,
            modelVersion: asset.modelVersion,
            group,
            materials,
            mixer,
            direction,
            speed: randRange(7.8, 12.6),
            laneY: randRange(30, 54),
            laneZ: randRange(18, 76),
            age: 0,
            phase: randRange(0, Math.PI * 2),
            animationSpeed: randRange(0.86, 1.14),
            baseOpacity: 1.0,
            runtimeScale: asset.runtimeScale * randRange(0.88, 1.14),
            triangleCount: asset.triangleCount,
            animationNames: asset.animationNames,
            modelForward: getModelForwardVector(asset.forwardAxis),
            referenceSpeed: asset.referenceSpeed ?? 10,
            previousPosition: new THREE.Vector3(),
        };

        group.name = `OceanHeroFishAsset:${asset.id}`;
        group.userData.isOceanHeroFishAsset = true;
        group.userData.assetId = asset.id;
        group.userData.modelVersion = asset.modelVersion;
        group.userData.sourceMode = asset.sourceMode;
        group.scale.setScalar(creature.runtimeScale);
        this.resetHeroAssetCreature(creature, forcedPosition, true);
        this.scene.add(group);
        this.heroAssetCreatures.push(creature);
        return true;
    }

    collectHeroAssetMaterials(group, asset) {
        const tint = asset.id.includes('banner')
            ? new THREE.Color(0xffeeb5)
            : new THREE.Color(0x2fd0d1);
        const materials = [];

        group.traverse((child) => {
            if (!child.isMesh) return;
            const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
            const cloned = sourceMaterials.map((material) => {
                const nextMaterial = material.clone();
                if (nextMaterial.color) nextMaterial.color.lerp(tint, 0.08);
                nextMaterial.transparent = true;
                nextMaterial.opacity = 0;
                nextMaterial.depthWrite = true;
                nextMaterial.fog = true;
                nextMaterial.toneMapped = true;
                nextMaterial.userData = {
                    ...(nextMaterial.userData || {}),
                    aquaticFaunaMaterial: true,
                    assetId: asset.id,
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

    resetHeroAssetCreature(creature, forcedPosition = null, initial = false) {
        let dir = creature.direction;
        if (!initial) dir = Math.random() < 0.5 ? 1 : -1;
        creature.direction = dir;
        creature.speed = randRange(7.8, 12.6);
        creature.laneY = randRange(30, 54);
        creature.laneZ = randRange(18, 76);
        creature.phase = randRange(0, Math.PI * 2);
        creature.age = 0;

        if (forcedPosition) {
            creature.group.position.copy(forcedPosition);
        } else {
            creature.group.position.set(
                -dir * randRange(112, 152),
                creature.laneY + randRange(-2, 2),
                creature.laneZ,
            );
        }
    }

    update(delta, elapsed, { currentStrength = 0.5, glowIntensity = 0.8 } = {}) {
        if (this.totalFish <= 0) return;

        const dt = clamp(delta || 0.016, 0.001, 0.033);
        this.updatePopulationReveal(dt);
        const activeGameplaySurge = this.gameplaySurge;
        this.gameplaySurge = Math.max(0, this.gameplaySurge - dt * 0.74);
        this.updateEnvironmentalInfluences(dt);
        this.updateSchoolGoals(elapsed);
        if (this.activeSchoolFish > 0) {
            this.updateSchoolFish(
                dt,
                elapsed,
                currentStrength,
                activeGameplaySurge,
                this.environmentalInfluences,
            );
        }
        if (this.activeHeroFish > 0) this.updateHeroFish(dt, elapsed);
        this.updateHeroAssetLayer(dt, elapsed, currentStrength);
        if (this.activeFishCount > 0) this.updateMatrices();

        this.materials.forEach((material) => {
            if (!material) return;
            if (material.uniforms) {
                material.uniforms.uTime.value = elapsed;
                material.uniforms.uCurrentStrength.value = currentStrength;
                material.uniforms.uGlowIntensity.value = glowIntensity;
            }
            if (material.userData) {
                if (material.userData.uTime) material.userData.uTime.value = elapsed;
                if (material.userData.uCurrentStrength) material.userData.uCurrentStrength.value = currentStrength;
                if (material.userData.uGlowIntensity) material.userData.uGlowIntensity.value = glowIntensity;
            }
        });
    }

    updateHeroAssetLayer(dt, elapsed, currentStrength) {
        if (!this.heroAssetCreatures.length) return;
        const viewerPosition = this.camera?.position ?? null;

        this.heroAssetCreatures.forEach((creature) => {
            creature.age += dt;

            const surgeBoost = 1 + this.gameplaySurge * 0.16;
            const speed = creature.speed * (1 + currentStrength * 0.045) * surgeBoost;
            // Velocity-driven mixer playback (Fix 2): tail beats scale with
            // actual travel speed instead of running at a fixed tempo.
            const reference = creature.referenceSpeed || 10;
            const playbackRate = clamp(speed / reference, 0.4, 2.4);
            creature.mixer?.update(dt * playbackRate);
            const waveY = Math.sin(elapsed * 0.55 + creature.phase) * 3.2;
            const waveZ = Math.cos(elapsed * 0.36 + creature.phase * 1.3) * 4.8;
            const targetY = creature.laneY + waveY;
            const targetZ = creature.laneZ + waveZ;
            const previous = creature.group.position.clone();

            creature.group.position.x += creature.direction * speed * dt;
            creature.group.position.y += (targetY - creature.group.position.y) * clamp(dt * 0.72, 0, 1);
            creature.group.position.z += (targetZ - creature.group.position.z) * clamp(dt * 0.48, 0, 1);

            const escapedRight = creature.direction > 0 && creature.group.position.x > 158;
            const escapedLeft = creature.direction < 0 && creature.group.position.x < -158;
            if (escapedRight || escapedLeft) {
                this.resetHeroAssetCreature(creature);
            }

            this.heroAssetDirection.subVectors(creature.group.position, previous);
            if (this.heroAssetDirection.lengthSq() < 0.0001) {
                this.heroAssetDirection.set(creature.direction, 0, 0);
            }
            this.heroAssetDirection.normalize();
            // Use the model's authored forward axis (default +X for legacy
            // assets, -Z for Quaternius) so the head points along travel.
            creature.group.quaternion.setFromUnitVectors(
                creature.modelForward ?? FORWARD,
                this.heroAssetDirection,
            );
            creature.group.rotateX(Math.sin(elapsed * 0.34 + creature.phase) * 0.025);
            creature.group.rotateZ(Math.sin(elapsed * 0.42 + creature.phase * 0.7) * 0.038);

            let distanceFade = 1;
            if (viewerPosition) {
                const distance = viewerPosition.distanceTo(creature.group.position);
                distanceFade = clamp(1 - (distance - 132) / 112, 0.42, 1);
            }
            const fadeIn = clamp(creature.age / 1.35, 0, 1);
            const opacity = creature.baseOpacity
                * fadeIn
                * distanceFade;
            creature.materials.forEach((material) => {
                material.opacity = opacity;
                if (material.userData && material.userData.uTime) {
                    material.userData.uTime.value = elapsed;
                }
            });
        });
    }

    updateSchoolGoals(elapsed) {
        for (let s = 0; s < SCHOOL_COUNT; s++) {
            const i4 = s * 4;
            const i3 = s * 3;
            const phase = this.schoolSeeds[i4 + 3];
            this.schoolThreatOffsets[i3] *= 0.92;
            this.schoolThreatOffsets[i3 + 1] *= 0.86;
            this.schoolThreatOffsets[i3 + 2] *= 0.92;

            const baseX = this.schoolSeeds[i4] + Math.sin(elapsed * 0.12 + phase) * 42;
            const baseY = this.schoolSeeds[i4 + 1] + Math.sin(elapsed * 0.09 + phase * 1.7) * 8;
            const baseZ = this.schoolSeeds[i4 + 2] + Math.cos(elapsed * 0.1 + phase * 0.8) * 48;
            this.schoolGoals[i3] = clamp(baseX + this.schoolThreatOffsets[i3], -FISH_AREA_X, FISH_AREA_X);
            this.schoolGoals[i3 + 1] = clamp(baseY + this.schoolThreatOffsets[i3 + 1], 14, SURFACE_Y);
            this.schoolGoals[i3 + 2] = clamp(baseZ + this.schoolThreatOffsets[i3 + 2], -FISH_AREA_Z, FISH_AREA_Z);
        }
    }

    triggerGameplaySurge(intensity = 0, anchor = null) {
        const surge = clamp(Number(intensity) || 0, 0, 1.2);
        if (surge <= 0) return;
        this.gameplaySurge = Math.max(this.gameplaySurge, surge);
        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.z)) {
            this.gameplaySurgeAnchor.set(
                anchor.x,
                Number.isFinite(anchor.y) ? anchor.y : 12,
                anchor.z,
            );
        }
    }

    addEnvironmentalInfluence({
        kind = 'large-neutral',
        position = null,
        radius = 60,
        strength = 0.35,
        duration = 1.2,
    } = {}) {
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return;

        const influence = {
            kind: kind === 'predator' ? 'predator' : 'large-neutral',
            position: new THREE.Vector3(
                position.x,
                Number.isFinite(position.y) ? position.y : 24,
                position.z,
            ),
            radius: clamp(Number(radius) || 60, 12, 180),
            strength: clamp(Number(strength) || 0, 0, 2.0),
            duration: clamp(Number(duration) || 1.2, 0.1, 6),
            age: 0,
        };

        if (influence.strength <= 0) return;
        this.environmentalInfluences.push(influence);
        if (this.environmentalInfluences.length > 8) this.environmentalInfluences.shift();
    }

    updateEnvironmentalInfluences(dt) {
        if (!this.environmentalInfluences.length) return;
        this.environmentalInfluences.forEach((influence) => {
            influence.age += dt;
        });
        this.environmentalInfluences = this.environmentalInfluences.filter(
            (influence) => influence.age < influence.duration,
        );
    }

    updateSchoolFish(
        dt,
        elapsed,
        currentStrength,
        gameplaySurge = 0,
        environmentalInfluences = [],
    ) {
        const separationDistSq = 4.5 * 4.5;
        const alignmentDistSq = 13 * 13;
        const cohesionDistSq = 22 * 22;
        const currentBoost = 1 + currentStrength * 0.06;
        const surgeAnchor = this.gameplaySurgeAnchor;

        for (let s = 0; s < SCHOOL_COUNT; s++) {
            const start = this.schoolStarts[s];
            const end = Math.min(this.schoolEnds[s], this.activeSchoolFish);
            if (end <= start) continue;
            const goalIndex = s * 3;
            const gx = this.schoolGoals[goalIndex];
            const gy = this.schoolGoals[goalIndex + 1];
            const gz = this.schoolGoals[goalIndex + 2];

            for (let i = start; i < end; i++) {
                const i3 = i * 3;
                const px = this.positions[i3];
                const py = this.positions[i3 + 1];
                const pz = this.positions[i3 + 2];
                let desiredX = (gx - px) * 0.018;
                let desiredY = (gy - py) * 0.026;
                let desiredZ = (gz - pz) * 0.018;
                let sepX = 0;
                let sepY = 0;
                let sepZ = 0;
                let alignX = 0;
                let alignY = 0;
                let alignZ = 0;
                let cohX = 0;
                let cohY = 0;
                let cohZ = 0;
                let alignCount = 0;
                let cohesionCount = 0;

                for (let j = start; j < end; j++) {
                    if (i === j) continue;
                    const j3 = j * 3;
                    const dx = this.positions[j3] - px;
                    const dy = this.positions[j3 + 1] - py;
                    const dz = this.positions[j3 + 2] - pz;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    if (distSq < 0.0001 || distSq > cohesionDistSq) continue;

                    if (distSq < separationDistSq) {
                        const force = (separationDistSq - distSq) / separationDistSq;
                        sepX -= dx * force;
                        sepY -= dy * force;
                        sepZ -= dz * force;
                    } else if (distSq < alignmentDistSq) {
                        alignX += this.velocities[j3];
                        alignY += this.velocities[j3 + 1];
                        alignZ += this.velocities[j3 + 2];
                        alignCount++;
                    } else {
                        cohX += this.positions[j3];
                        cohY += this.positions[j3 + 1];
                        cohZ += this.positions[j3 + 2];
                        cohesionCount++;
                    }
                }

                if (alignCount > 0) {
                    desiredX += (alignX / alignCount) * 0.045;
                    desiredY += (alignY / alignCount) * 0.025;
                    desiredZ += (alignZ / alignCount) * 0.045;
                }
                if (cohesionCount > 0) {
                    desiredX += (cohX / cohesionCount - px) * 0.01;
                    desiredY += (cohY / cohesionCount - py) * 0.008;
                    desiredZ += (cohZ / cohesionCount - pz) * 0.01;
                }

                desiredX += sepX * 0.12;
                desiredY += sepY * 0.1;
                desiredZ += sepZ * 0.12;
                desiredX += Math.sin(elapsed * 0.65 + this.phases[i]) * 0.12;
                desiredZ += Math.cos(elapsed * 0.55 + this.phases[i] * 1.4) * 0.1;
                let environmentalSpeedBoost = 1;

                if (gameplaySurge > 0.02) {
                    const surgeX = px - surgeAnchor.x;
                    const surgeY = (py - surgeAnchor.y) * 0.34;
                    const surgeZ = pz - surgeAnchor.z;
                    const surgeDist = Math.hypot(surgeX, surgeY, surgeZ) || 1;
                    const falloff = clamp(1 - surgeDist / 165, 0, 1);
                    const response = falloff * gameplaySurge;
                    desiredX += (surgeX / surgeDist) * response * 3.4;
                    desiredY += (surgeY / surgeDist) * response * 1.1 + response * 0.32;
                    desiredZ += (surgeZ / surgeDist) * response * 3.4;
                }

                environmentalInfluences.forEach((influence) => {
                    const dx = px - influence.position.x;
                    const dy = (py - influence.position.y) * 0.48;
                    const dz = pz - influence.position.z;
                    const dist = Math.hypot(dx, dy, dz) || 1;
                    const falloff = clamp(1 - dist / influence.radius, 0, 1);
                    if (falloff <= 0) return;

                    const life = 1 - clamp(influence.age / influence.duration, 0, 1);
                    const response = falloff * life * influence.strength;
                    if (influence.kind === 'predator') {
                        // Charge/strike (strength > 1.0) = explosive scatter;
                        // stalk (moderate) = bait-ball tightening then flee.
                        const isCharge = influence.strength > 1.0;
                        const fleeMultiplier = isCharge ? 7.2 : 3.4; // AAA intensity scatter
                        desiredX += (dx / dist) * response * fleeMultiplier;
                        desiredY += (dy / dist) * response * (isCharge ? 1.45 : 0.65) + response * 0.22;
                        desiredZ += (dz / dist) * response * fleeMultiplier;

                        // Under moderate threat fish tighten aggressively toward their school goal
                        // (defensive bait-ball). During a charge they only scatter.
                        if (!isCharge && falloff > 0.15) {
                            desiredX += (gx - px) * response * 0.085;
                            desiredZ += (gz - pz) * response * 0.085;
                        } else {
                            desiredX += (gx - px) * response * 0.012;
                            desiredZ += (gz - pz) * response * 0.012;
                        }
                        environmentalSpeedBoost = Math.max(
                            environmentalSpeedBoost,
                            isCharge ? 1 + response * 2.4 : 1 + response * 0.68,
                        );
                    } else {
                        desiredX += (dx / dist) * response * 0.72;
                        desiredY += (dy / dist) * response * 0.24 + response * 0.08;
                        desiredZ += (dz / dist) * response * 0.72;
                        environmentalSpeedBoost = Math.max(
                            environmentalSpeedBoost,
                            1 + response * 0.08,
                        );
                    }
                });

                const floorY = this.getSeabedHeight(px, pz) + 5.5;
                if (py < floorY) desiredY += (floorY - py) * 0.22;
                if (py > SURFACE_Y) desiredY -= (py - SURFACE_Y) * 0.18;
                if (px > FISH_AREA_X) desiredX -= (px - FISH_AREA_X) * 0.08;
                if (px < -FISH_AREA_X) desiredX += (-FISH_AREA_X - px) * 0.08;
                if (pz > FISH_AREA_Z) desiredZ -= (pz - FISH_AREA_Z) * 0.08;
                if (pz < -FISH_AREA_Z) desiredZ += (-FISH_AREA_Z - pz) * 0.08;

                this.applyDesiredVelocity(
                    i,
                    desiredX,
                    desiredY,
                    desiredZ,
                    dt,
                    0.86,
                    currentBoost * environmentalSpeedBoost,
                );
            }
        }
    }

    updateHeroFish(dt, elapsed) {
        const end = this.totalSchoolFish + this.activeHeroFish;
        for (let i = this.totalSchoolFish; i < end; i++) {
            const i3 = i * 3;
            const phase = this.phases[i];
            const dir = this.velocities[i3] >= 0 ? 1 : -1;
            const targetY = this.laneY[i] + Math.sin(elapsed * 0.7 + phase) * 3.5;
            const desiredX = dir * this.speeds[i];
            const desiredY = (targetY - this.positions[i3 + 1]) * 0.42;
            const desiredZ = Math.sin(elapsed * 0.38 + phase * 1.3) * 1.4;

            this.applyDesiredVelocity(i, desiredX, desiredY, desiredZ, dt, 0.45, 1);

            if ((dir > 0 && this.positions[i3] > 145) || (dir < 0 && this.positions[i3] < -145)) {
                const nextDir = Math.random() < 0.5 ? 1 : -1;
                this.positions[i3] = -nextDir * randRange(104, 142);
                this.positions[i3 + 1] = Math.random() < 0.5 ? randRange(24, 34) : randRange(46, 58);
                this.positions[i3 + 2] = randRange(24, 66);
                this.velocities[i3] = nextDir * this.speeds[i];
                this.laneY[i] = this.positions[i3 + 1];
                this.phases[i] = randRange(0, Math.PI * 2);
            }
        }
    }

    applyDesiredVelocity(index, desiredX, desiredY, desiredZ, dt, turnResponsiveness, speedBoost) {
        const i3 = index * 3;
        const desiredLen = Math.hypot(desiredX, desiredY, desiredZ) || 1;
        const targetSpeed = this.speeds[index] * speedBoost;
        const targetX = (desiredX / desiredLen) * targetSpeed;
        const targetY = (desiredY / desiredLen) * targetSpeed;
        const targetZ = (desiredZ / desiredLen) * targetSpeed;
        const turn = clamp(dt * turnResponsiveness, 0.02, 0.18);

        this.velocities[i3] += (targetX - this.velocities[i3]) * turn;
        this.velocities[i3 + 1] += (targetY - this.velocities[i3 + 1]) * turn;
        this.velocities[i3 + 2] += (targetZ - this.velocities[i3 + 2]) * turn;

        const vx = this.velocities[i3];
        const vy = this.velocities[i3 + 1];
        const vz = this.velocities[i3 + 2];
        const len = Math.hypot(vx, vy, vz) || 1;
        const maxSpeed = targetSpeed * 1.18;
        if (len > maxSpeed) {
            const scale = maxSpeed / len;
            this.velocities[i3] *= scale;
            this.velocities[i3 + 1] *= scale;
            this.velocities[i3 + 2] *= scale;
        }

        this.positions[i3] += this.velocities[i3] * dt;
        this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
        this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;
    }

    updateMatrices() {
        for (let i = 0; i < this.activeFishCount; i++) {
            const i3 = i * 3;
            const speciesIndex = this.speciesIndices[i];
            const mesh = this.meshes[speciesIndex];
            if (!mesh) continue;

            this.direction.set(
                this.velocities[i3],
                this.velocities[i3 + 1],
                this.velocities[i3 + 2],
            );
            if (this.direction.lengthSq() < 0.0001) this.direction.set(1, 0, 0);
            this.direction.normalize();

            this.dummy.position.set(
                this.positions[i3],
                this.positions[i3 + 1],
                this.positions[i3 + 2],
            );
            this.dummy.quaternion.setFromUnitVectors(FORWARD, this.direction);
            this.dummy.scale.setScalar(this.scales[i]);
            this.dummy.updateMatrix();
            mesh.setMatrixAt(this.localIndices[i], this.dummy.matrix);
        }

        this.meshes.forEach((mesh) => {
            if (mesh) mesh.instanceMatrix.needsUpdate = true;
        });
    }

    hasHeroFishInView(margin = 0.14) {
        if (!this.camera || (this.heroCount <= 0 && this.heroAssetCreatures.length <= 0)) {
            return false;
        }

        this.camera.updateMatrixWorld();
        const heroEnd = this.totalSchoolFish + this.activeHeroFish;
        for (let i = this.totalSchoolFish; i < heroEnd; i++) {
            const i3 = i * 3;
            this.heroProjection
                .set(this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2])
                .project(this.camera);

            if (
                this.heroProjection.z >= -1
                && this.heroProjection.z <= 1
                && Math.abs(this.heroProjection.x) <= 1 + margin
                && Math.abs(this.heroProjection.y) <= 1 + margin
            ) {
                return true;
            }
        }

        for (const creature of this.heroAssetCreatures) {
            this.heroAssetProjection.copy(creature.group.position).project(this.camera);
            if (
                this.heroAssetProjection.z >= -1
                && this.heroAssetProjection.z <= 1
                && Math.abs(this.heroAssetProjection.x) <= 1 + margin
                && Math.abs(this.heroAssetProjection.y) <= 1 + margin
            ) {
                return true;
            }
        }

        return false;
    }

    forceHeroAssetFish(assetId = 'hero-reef-fish') {
        const record = this.heroAssetRecords.get(assetId)
            || this.heroAssetRecords.values().next().value;
        if (!record) {
            this.initHeroAssetLayer();
            return false;
        }
        if (this.heroAssetCreatures.length >= HERO_ASSET_MAX_ACTIVE) {
            const oldest = this.heroAssetCreatures.shift();
            if (oldest) {
                this.scene?.remove(oldest.group);
                oldest.materials.forEach((material) => material.dispose());
            }
        }
        const forcedPosition = new THREE.Vector3(
            -96,
            randRange(34, 46),
            randRange(26, 54),
        );
        return this.spawnHeroAssetCreature(record, forcedPosition);
    }

    collectSignoff() {
        return {
            assetVersion: OCEAN_FAUNA_ASSET_VERSION,
            proceduralSchoolFish: this.totalSchoolFish,
            proceduralHeroFish: this.heroCount,
            activeProceduralFish: this.activeFishCount,
            activeSchoolFish: this.activeSchoolFish,
            activeHeroFish: this.activeHeroFish,
            proceduralSchoolsInstanced: true,
            heroAssetLayer: {
                enabled: this.heroAssetCount > 0,
                requestedCount: this.heroAssetCount,
                activeCount: this.heroAssetCreatures.length,
                maxActive: HERO_ASSET_MAX_ACTIVE,
                loadedAssetIds: Array.from(this.heroAssetRecords.keys()),
                statuses: { ...this.heroAssetStatus },
                errors: { ...this.heroAssetErrors },
                sourceMode: 'blender-hero-assets-procedural-schools',
                activeAssets: this.heroAssetCreatures.map((creature) => ({
                    id: creature.assetId,
                    modelVersion: creature.modelVersion,
                    triangleCount: creature.triangleCount,
                    animationNames: creature.animationNames,
                    opacity: roundMetric(creature.materials[0]?.opacity ?? 0, 3),
                    position: {
                        x: roundMetric(creature.group.position.x),
                        y: roundMetric(creature.group.position.y),
                        z: roundMetric(creature.group.position.z),
                    },
                })),
                manifest: summarizeFaunaAssetManifest().heroFish,
            },
        };
    }

    /**
     * Returns the current centroid of each school so that predator AI can
     * pick a target school to stalk / charge.
     */
    getSchoolCentroids() {
        const centroids = [];
        for (let s = 0; s < SCHOOL_COUNT; s++) {
            const start = this.schoolStarts[s];
            const end = Math.min(this.schoolEnds[s], this.activeSchoolFish);
            const count = Math.max(0, end - start);
            let x = 0;
            let y = 0;
            let z = 0;
            if (count > 0) {
                for (let i = start; i < end; i++) {
                    const i3 = i * 3;
                    x += this.positions[i3];
                    y += this.positions[i3 + 1];
                    z += this.positions[i3 + 2];
                }
                x /= count;
                y /= count;
                z /= count;
            } else {
                x = this.schoolGoals[s * 3];
                y = this.schoolGoals[s * 3 + 1];
                z = this.schoolGoals[s * 3 + 2];
            }
            centroids.push({
                index: s,
                x,
                y,
                z,
                fishCount: count,
            });
        }
        return centroids;
    }

    /**
     * Push an entire school's goal position away from a threat source.
     * Called by the shark behavior system during CHARGE / STRIKE phases.
     */
    displaceSchoolGoal(schoolIndex, awayFrom, amount) {
        if (schoolIndex < 0 || schoolIndex >= SCHOOL_COUNT) return;
        if (!awayFrom || !Number.isFinite(awayFrom.x) || !Number.isFinite(awayFrom.z)) return;
        const i3 = schoolIndex * 3;
        const dx = this.schoolGoals[i3] - awayFrom.x;
        const dy = (this.schoolGoals[i3 + 1] - (Number.isFinite(awayFrom.y) ? awayFrom.y : 24)) * 0.35;
        const dz = this.schoolGoals[i3 + 2] - awayFrom.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const push = clamp(Number(amount) || 0, 0, 5.2);
        this.schoolThreatOffsets[i3] += (dx / dist) * push;
        this.schoolThreatOffsets[i3 + 1] += (dy / dist) * push * 0.4;
        this.schoolThreatOffsets[i3 + 2] += (dz / dist) * push;

        const offsetLength = Math.hypot(
            this.schoolThreatOffsets[i3],
            this.schoolThreatOffsets[i3 + 1] * 1.6,
            this.schoolThreatOffsets[i3 + 2],
        );
        if (offsetLength > 54) {
            const scale = 54 / offsetLength;
            this.schoolThreatOffsets[i3] *= scale;
            this.schoolThreatOffsets[i3 + 1] *= scale;
            this.schoolThreatOffsets[i3 + 2] *= scale;
        }
    }

    /**
     * Exposes the current environmental influence list so external systems
     * (e.g. reef dweller fish) can read predator proximity.
     */
    getEnvironmentalInfluences() {
        return this.environmentalInfluences;
    }

    dispose() {
        this.heroAssetCreatures.forEach((creature) => {
            this.scene?.remove(creature.group);
            creature.materials.forEach((material) => material.dispose());
        });
        this.heroAssetCreatures = [];
        this.heroAssetRecords.forEach((record) => disposeObject(record.gltf?.scene));
        this.heroAssetRecords.clear();
        this.heroAssetLoadPromise = null;
        this.heroAssetLoader = null;

        this.meshes.forEach((mesh) => {
            if (!mesh) return;
            this.scene?.remove(mesh);
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
            else mesh.material?.dispose();
        });
        this.meshes = [];
        this.materials = [];
        this.scene = null;
        this.camera = null;
        this.heroProjection = null;
        this.heroAssetProjection = null;
        this.heroAssetDirection = null;
        this.gameplaySurgeAnchor = null;
        this.environmentalInfluences = [];
    }
}

export default OceanFishSystem;

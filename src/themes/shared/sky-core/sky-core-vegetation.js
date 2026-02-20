import * as THREE from 'three';

import {
    createFlowerHeadMaterial,
    createFlowerStemMaterial,
    createGrassMaterial,
} from './sky-core-materials.js';
import { createFlowerCarpetField } from './sky-core-flower-carpet-field.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - (2 * t));
}

function hash2(x, y) {
    const raw = Math.sin((x * 127.1) + (y * 311.7)) * 43758.5453;
    return raw - Math.floor(raw);
}

function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
    }

    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    return null;
}

function configureAtlasTexture(texture) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

export function createGrassAtlasTexture(params = {}) {
    const width = params.width ?? 128;
    const height = params.height ?? 128;
    const canvas = createCanvas(width, height);

    if (!canvas) {
        const data = new Uint8Array([255, 255, 255, 255]);
        const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        return configureAtlasTexture(fallback);
    }
    const context = canvas.getContext('2d');

    // Smooth soft unified blade texture
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0.0, 'rgba(150, 150, 150, 0.4)');
    gradient.addColorStop(1.0, 'rgba(255, 255, 255, 1.0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    // Subtle vertical fiber noise
    context.fillStyle = 'rgba(0, 0, 0, 0.05)';
    for (let i = 0; i < 60; i += 1) {
        const x = Math.random() * width;
        const w = 1 + Math.random() * 2;
        context.fillRect(x, 0, w, height);
    }

    const texture = new THREE.CanvasTexture(canvas);
    return configureAtlasTexture(texture);
}

export function createFlowerAtlasTexture(params = {}) {
    const width = params.width ?? 128;
    const height = params.height ?? 128;
    const canvas = createCanvas(width, height);

    if (!canvas) {
        const data = new Uint8Array([255, 255, 255, 255]);
        const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        return configureAtlasTexture(fallback);
    }
    const context = canvas.getContext('2d');

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const radius = width * 0.42;

    // Soft glowing base
    const aura = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    aura.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    aura.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    aura.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    context.fillStyle = aura;
    context.fillRect(0, 0, width, height);

    // Simple overlapping rounded petals for a clean, stylized look
    context.fillStyle = 'rgba(255, 255, 255, 0.95)';
    const numPetals = 5;
    for (let i = 0; i < numPetals; i += 1) {
        const angle = (i / numPetals) * Math.PI * 2;
        context.save();
        context.translate(centerX, centerY);
        context.rotate(angle);

        context.beginPath();
        context.ellipse(0, radius * 0.4, radius * 0.28, radius * 0.5, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    const texture = new THREE.CanvasTexture(canvas);
    return configureAtlasTexture(texture);
}

function createTaperedCrossGeometry({
    cardCount = 4,
    widthBottom = 0.72,
    widthTop = 0.12,
    height = 1,
    curve = 0.06,
}) {
    const positions = [];
    const uvs = [];

    const y0 = 0;
    const y1 = height * 0.48;
    const y2 = height;

    for (let c = 0; c < cardCount; c += 1) {
        const angle = (Math.PI / cardCount) * c;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const points = [
            [-widthBottom * 0.5, y0, 0],
            [widthBottom * 0.5, y0, 0],
            [-widthBottom * 0.36, y1, curve],
            [widthBottom * 0.36, y1, curve],
            [-widthTop * 0.5, y2, curve * 2.2],
            [widthTop * 0.5, y2, curve * 2.2],
        ];

        const rotatePoint = (point) => {
            const x = point[0] * cosA - point[2] * sinA;
            const z = point[0] * sinA + point[2] * cosA;
            return [x, point[1], z];
        };

        const p0 = rotatePoint(points[0]);
        const p1 = rotatePoint(points[1]);
        const p2 = rotatePoint(points[2]);
        const p3 = rotatePoint(points[3]);
        const p4 = rotatePoint(points[4]);
        const p5 = rotatePoint(points[5]);

        const pushTri = (a, b, cPos, au, av, bu, bv, cu, cv) => {
            positions.push(a[0], a[1], a[2], b[0], b[1], b[2], cPos[0], cPos[1], cPos[2]);
            uvs.push(au, av, bu, bv, cu, cv);
        };

        // Lower segment
        pushTri(p0, p1, p2, 0, 0, 1, 0, 0.2, 0.56);
        pushTri(p2, p1, p3, 0.2, 0.56, 1, 0, 0.8, 0.56);
        // Upper segment
        pushTri(p2, p3, p4, 0.2, 0.56, 0.8, 0.56, 0.38, 1);
        pushTri(p4, p3, p5, 0.38, 1, 0.8, 0.56, 0.62, 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

function fillHiddenInstances(mesh, startIndex, dummy) {
    for (let i = startIndex; i < mesh.count; i += 1) {
        dummy.position.set(0, -9999, 0);
        dummy.quaternion.identity();
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
}

function computePlacementMask(terrainField, x, z, normalY, options = {}) {
    const pathMask = terrainField.samplePathMask(x, z);
    const valleyMask = terrainField.sampleValleyMask(x, z);
    const curvature = terrainField.sampleCurvature(x, z);

    const slopeMask = smoothstep(options.slopeMin ?? 0.52, 1.0, normalY);
    const pitPenalty = smoothstep(0.32, 1.34, curvature);
    const shoulderBoost = smoothstep(0.18, 0.72, pathMask) * (1 - smoothstep(0.7, 0.96, pathMask));

    const base = (options.base ?? 0.22)
        + valleyMask * (options.valleyWeight ?? 0.34)
        + shoulderBoost * (options.shoulderWeight ?? 0.42)
        + slopeMask * (options.slopeWeight ?? 0.22)
        - pitPenalty * (options.pitWeight ?? 0.32)
        - pathMask * (options.pathWeight ?? 0.24);

    return {
        mask: clamp(base, 0, 1),
        pathMask,
        valleyMask,
        curvature,
        slopeMask,
    };
}

function buildGrassInstances(mesh, terrainField, params = {}, kind = 'near') {
    const { count } = mesh;
    const spread = (params.terrainSize ?? 640) * (kind === 'near' ? 0.65 : 0.95);
    const maxAttempts = count * (kind === 'near' ? 8 : 6);

    const phases = new Float32Array(count);
    const tints = new Float32Array(count * 3);
    const leans = new Float32Array(count * 2);

    const dummy = new THREE.Object3D();
    const terrainNormal = new THREE.Vector3();
    const smoothedNormal = new THREE.Vector3();
    const slopeQuat = new THREE.Quaternion();
    const yawQuat = new THREE.Quaternion();

    let placed = 0;
    let attempts = 0;

    while (placed < count && attempts < maxAttempts) {
        attempts += 1;

        const x = (Math.random() - 0.5) * spread * 2;
        const z = (Math.random() - 0.5) * spread * 2;
        terrainField.sampleNormal(x, z, terrainNormal);

        const placement = computePlacementMask(terrainField, x, z, terrainNormal.y, {
            base: kind === 'near' ? 0.2 : 0.16,
            slopeMin: kind === 'near' ? 0.72 : 0.76,
            valleyWeight: kind === 'near' ? 0.32 : 0.28,
            shoulderWeight: kind === 'near' ? 0.44 : 0.36,
            slopeWeight: kind === 'near' ? 0.24 : 0.2,
            pitWeight: kind === 'near' ? 0.34 : 0.3,
            pathWeight: kind === 'near' ? 0.24 : 0.3,
        });

        // Organic sweeping clustering waves
        const wave1 = Math.sin(x * 0.03 + Math.cos(z * 0.02)) * 0.5 + 0.5;
        const wave2 = Math.sin(z * 0.05 + Math.cos(x * 0.04)) * 0.5 + 0.5;
        const clusterNoise = Math.pow(wave1 * 0.6 + wave2 * 0.4, 2.0);

        const strictSlopeMask = smoothstep(0.68, 0.82, terrainNormal.y);
        const acceptChance = placement.mask * clusterNoise * strictSlopeMask;

        // Higher threshold makes distinct dense clumps instead of uniform spread
        if (acceptChance < 0.15 + Math.random() * 0.3 || terrainNormal.y < 0.68) {
            continue;
        }

        const y = terrainField.sampleHeight(x, z);
        // Point more upright to prevent awkward horizontal sticking out
        smoothedNormal.copy(terrainNormal).lerp(WORLD_UP, kind === 'near' ? 0.6 : 0.75).normalize();
        slopeQuat.setFromUnitVectors(WORLD_UP, smoothedNormal);
        const pathDir = terrainField.samplePathCenter(x + 4.2) - terrainField.samplePathCenter(x - 4.2);
        const flowAngle = Math.atan2(pathDir, 8.4);
        const yawNoise = (Math.random() - 0.5) * (kind === 'near' ? 0.9 : 1.1);
        yawQuat.setFromAxisAngle(smoothedNormal, flowAngle + yawNoise);

        dummy.position.set(x, y + (kind === 'near' ? 0.16 : 0.1), z);
        dummy.quaternion.copy(slopeQuat).multiply(yawQuat);

        const scaleBase = kind === 'near' ? 0.95 : 0.75;
        const scaleSpread = kind === 'near' ? 0.85 : 0.55;
        let localScale = scaleBase + acceptChance * scaleSpread;

        // 15% chance for a tall 'hero' blade to break up the uniform carpet
        if (Math.random() < 0.15) {
            localScale *= 1.4 + Math.random() * 0.6;
        }

        dummy.scale.set(
            localScale * (0.92 + Math.random() * 0.28),
            localScale * (0.98 + Math.random() * 0.34),
            localScale * (0.92 + Math.random() * 0.28),
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(placed, dummy.matrix);

        phases[placed] = Math.random() * Math.PI * 2;

        const tint = 0.88 + clusterNoise * 0.16;
        tints[placed * 3] = tint * (0.94 + placement.valleyMask * 0.05);
        tints[placed * 3 + 1] = tint * (0.97 + placement.slopeMask * 0.04);
        tints[placed * 3 + 2] = tint * (0.9 + (1 - placement.pathMask) * 0.04);

        const leanAngle = Math.random() * Math.PI * 2;
        const leanStrength = (0.03 + Math.random() * 0.12) * (0.9 + (1 - smoothedNormal.y) * 0.4);
        leans[placed * 2] = Math.cos(leanAngle) * leanStrength;
        leans[placed * 2 + 1] = Math.sin(leanAngle) * leanStrength;

        placed += 1;
    }

    fillHiddenInstances(mesh, placed, dummy);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    mesh.geometry.setAttribute('aLean', new THREE.InstancedBufferAttribute(leans, 2));

    mesh.userData.maxCount = placed;
    mesh.count = placed;

    return placed;
}

const FLOWER_PALETTES = Object.freeze({
    prairie: Object.freeze({
        pink:   [0.97, 0.42, 0.68],
        yellow: [0.98, 0.75, 0.22],
        purple: [0.72, 0.36, 0.94],
        blue:   [0.36, 0.60, 0.98],
        white:  [0.96, 0.94, 0.88],
        stem:   [0.46, 0.70, 0.43],
    }),
    sunset: Object.freeze({
        pink:   [0.98, 0.45, 0.66],
        yellow: [0.98, 0.72, 0.25],
        purple: [0.75, 0.38, 0.90],
        blue:   [0.38, 0.58, 0.96],
        white:  [0.95, 0.90, 0.84],
        stem:   [0.48, 0.68, 0.42],
    }),
    soft: Object.freeze({
        pink:   [0.95, 0.54, 0.73],
        yellow: [0.95, 0.80, 0.35],
        purple: [0.78, 0.50, 0.92],
        blue:   [0.46, 0.68, 0.94],
        white:  [0.93, 0.92, 0.90],
        stem:   [0.54, 0.78, 0.50],
    }),
});

function resolveFlowerPalette(preset = 'prairie') {
    const normalized = String(preset || 'prairie').toLowerCase();
    return FLOWER_PALETTES[normalized] || FLOWER_PALETTES.prairie;
}

function toFlowerColor(family, palette, layer = 'head') {
    let source = palette.white;
    if (layer === 'stem') {
        source = palette.stem;
    } else if (family === 'pink') {
        source = palette.pink;
    } else if (family === 'yellow') {
        source = palette.yellow;
    } else if (family === 'purple') {
        source = palette.purple ?? palette.pink;
    } else if (family === 'blue') {
        source = palette.blue ?? palette.white;
    }
    const shade = 0.9 + (Math.random() * 0.16);
    const sat = 0.94 + (Math.random() * 0.14);
    return [
        clamp(source[0] * shade, 0, 1),
        clamp(source[1] * shade * sat, 0, 1),
        clamp(source[2] * shade, 0, 1),
    ];
}

function createCrossCardGeometry({
    cardCount = 2,
    width = 0.5,
    height = 0.5,
    yOffset = 0.3,
}) {
    const positions = [];
    const uvs = [];
    const halfW = width * 0.5;

    for (let c = 0; c < cardCount; c += 1) {
        const angle = (Math.PI / cardCount) * c;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const rotatePoint = (x, y, z) => {
            const rx = x * cosA - z * sinA;
            const rz = x * sinA + z * cosA;
            return [rx, y, rz];
        };

        const p0 = rotatePoint(-halfW, yOffset, 0);
        const p1 = rotatePoint(halfW, yOffset, 0);
        const p2 = rotatePoint(-halfW, yOffset + height, 0);
        const p3 = rotatePoint(halfW, yOffset + height, 0);

        positions.push(
            p0[0],
            p0[1],
            p0[2],
            p1[0],
            p1[1],
            p1[2],
            p2[0],
            p2[1],
            p2[2],
            p2[0],
            p2[1],
            p2[2],
            p1[0],
            p1[1],
            p1[2],
            p3[0],
            p3[1],
            p3[2],
        );

        uvs.push(
            0,
            0,
            1,
            0,
            0,
            1,
            0,
            1,
            1,
            0,
            1,
            1,
        );
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

function sampleFlowerCoverageMetrics(terrainField, carpetField, params = {}) {
    const terrainSize = params.terrainSize ?? 640;
    const spread = terrainSize * 0.5;
    const depthMin = params.flowerDepthMin ?? (-terrainSize * 0.34);
    const depthMax = params.flowerDepthMax ?? (terrainSize * 0.22);
    const step = clamp(Math.floor(params.flowerDiagnosticStep ?? 8), 6, 16);
    let sampleCount = 0;
    let coverage05 = 0;
    let coverage10 = 0;
    let coverage20 = 0;
    const familyCounts = {
        yellow: 0,
        pink: 0,
        purple: 0,
        blue: 0,
        white: 0,
    };

    for (let x = -spread; x <= spread; x += step) {
        for (let z = depthMin; z <= depthMax; z += step) {
            const carpet = carpetField.sampleCarpet(x, z);
            sampleCount += 1;
            if (!carpet) continue;
            if (carpet.density >= 0.05) coverage05 += 1;
            if (carpet.density >= 0.1) {
                coverage10 += 1;
                const knownFamily = ['yellow', 'pink', 'purple', 'blue'].includes(carpet.family);
                const family = knownFamily ? carpet.family : 'white';
                familyCounts[family] += 1;
            }
            if (carpet.density >= 0.2) coverage20 += 1;
        }
    }

    const denom = Math.max(1, sampleCount);
    const familyDenom = Math.max(1, familyCounts.yellow + familyCounts.pink + familyCounts.purple + familyCounts.blue + familyCounts.white);
    return {
        sampleCount,
        coverage05: coverage05 / denom,
        coverage10: coverage10 / denom,
        coverage20: coverage20 / denom,
        familyCounts,
        familyShare: {
            yellow: familyCounts.yellow / familyDenom,
            pink:   familyCounts.pink   / familyDenom,
            purple: familyCounts.purple / familyDenom,
            blue:   familyCounts.blue   / familyDenom,
            white:  familyCounts.white  / familyDenom,
        },
    };
}

function scoreFlowerCandidate(carpet, exclusion) {
    const laneStrength = (carpet.bandMask * 0.62) + (carpet.pocketMask * 0.38);
    const inclusion = (1 - exclusion.pathCore) * (1 - exclusion.steepnessPenalty);
    const score = carpet.density
        * (0.52 + laneStrength * 0.48)
        * (0.46 + carpet.pocketMask * 0.54)
        * inclusion;
    return {
        score,
        laneStrength,
        inclusion,
    };
}

function assignFlowerFamilies(candidates, params = {}) {
    const whiteShareMax = clamp(params.flowerWhiteShareMax ?? 0.1, 0, 0.4);
    const total = candidates.length;
    const whiteCap = Math.floor(total * whiteShareMax);
    const yellowTarget = Math.round(total * 0.28);
    const pinkTarget   = Math.round(total * 0.24);
    const purpleTarget = Math.round(total * 0.20);
    const blueTarget   = Math.round(total * 0.18);
    // white gets the remaining ~10%
    const counts = { yellow: 0, pink: 0, purple: 0, blue: 0, white: 0 };

    return candidates.map((candidate) => {
        const weights = candidate.familyWeights || { yellow: 0.22, pink: 0.22, purple: 0.14, blue: 0.14, white: 0.08 };
        const familyHint = candidate.familyHint;

        const yellowScore  = (weights.yellow  ?? 0.22) + (familyHint === 'yellow'  ? 0.08 : 0) + (yellowTarget  - counts.yellow  > 0 ? 0.24 : -0.08);
        const pinkScore    = (weights.pink    ?? 0.22) + (familyHint === 'pink'    ? 0.08 : 0) + (pinkTarget    - counts.pink    > 0 ? 0.24 : -0.08);
        const purpleScore  = (weights.purple  ?? 0.14) + (familyHint === 'purple'  ? 0.08 : 0) + (purpleTarget  - counts.purple  > 0 ? 0.20 : -0.08);
        const blueScore    = (weights.blue    ?? 0.14) + (familyHint === 'blue'    ? 0.08 : 0) + (blueTarget    - counts.blue    > 0 ? 0.20 : -0.08);
        const whiteScore   = counts.white < whiteCap
            ? (weights.white ?? 0.08) * 0.34 + (familyHint === 'white' ? 0.03 : 0)
            : -2;

        const best = Math.max(yellowScore, pinkScore, purpleScore, blueScore, whiteScore);
        let family = 'yellow';
        if      (purpleScore === best) family = 'purple';
        else if (blueScore   === best) family = 'blue';
        else if (pinkScore   === best) family = 'pink';
        else if (whiteScore  === best) family = 'white';

        counts[family] += 1;
        return { ...candidate, family };
    });
}

function generateFlowerAnchors(terrainField, carpetField, params = {}) {
    const anchorCount = Math.max(0, Math.floor(params.flowerAnchorCount ?? 900));
    const anchorMin = Math.max(0, Math.floor(params.flowerAnchorMin ?? Math.round(anchorCount * 0.35)));
    const terrainSize = params.terrainSize ?? 640;
    const spread = terrainSize * 0.8;
    const depthMin = params.flowerDepthMin ?? (-terrainSize * 0.34);
    const depthMax = params.flowerDepthMax ?? (terrainSize * 0.22);
    const requiredCandidates = Math.max(anchorMin, anchorCount);
    const normal = new THREE.Vector3();
    const candidates = [];
    const cellSize = clamp(params.flowerAnchorCellSize ?? 8, 6, 10);
    const cellsX = Math.max(1, Math.floor((spread * 2) / cellSize));
    const cellsZ = Math.max(1, Math.floor((depthMax - depthMin) / cellSize));

    for (let ix = 0; ix < cellsX; ix += 1) {
        for (let iz = 0; iz < cellsZ; iz += 1) {
            const centerX = -spread + ((ix + 0.5) * cellSize);
            const centerZ = depthMin + ((iz + 0.5) * cellSize);
            const jitterX = (hash2((ix + 1) * 0.73, (iz + 1) * 1.17) - 0.5) * cellSize * 0.84;
            const jitterZ = (hash2((ix + 1) * 1.09, (iz + 1) * 0.59) - 0.5) * cellSize * 0.84;
            const x = centerX + jitterX;
            const z = centerZ + jitterZ;
            if (z < depthMin || z > depthMax) continue;

            terrainField.sampleNormal(x, z, normal);
            if (normal.y < 0.75) continue;

            const exclusion = carpetField.sampleExclusion(x, z);
            if (exclusion.pathCore > 0.98 || exclusion.steepnessPenalty > 0.88) continue;

            const carpet = carpetField.sampleCarpet(x, z);
            if (!carpet || carpet.density < 0.02) continue;

            const wave1 = Math.sin(x * 0.03 + Math.cos(z * 0.02)) * 0.5 + 0.5;
            const wave2 = Math.sin(z * 0.05 + Math.cos(x * 0.04)) * 0.5 + 0.5;
            const clusterNoise = Math.pow(wave1 * 0.6 + wave2 * 0.4, 2.0);

            const scored = scoreFlowerCandidate(carpet, exclusion);
            const nearBias = smoothstep(depthMin + terrainSize * 0.06, depthMax - terrainSize * 0.05, z);
            const weightedScore = scored.score * (0.4 + nearBias * 0.85) * (0.3 + clusterNoise * 0.7);
            if (weightedScore < 0.006) continue;

            candidates.push({
                x,
                y: terrainField.sampleHeight(x, z),
                z,
                density: carpet.density,
                bandMask: carpet.bandMask,
                pocketMask: carpet.pocketMask,
                familyHint: carpet.family,
                familyWeights: carpetField.sampleFamilyWeights(x, z),
                score: weightedScore,
                sortJitter: hash2(x * 0.043 + 4.3, z * 0.037 - 2.1),
            });
        }
    }

    // Relaxed fallback sweep to guarantee visible anchors for lower tiers.
    const maxAttempts = anchorCount * 15;
    let attempts = 0;
    while (candidates.length < requiredCandidates && attempts < maxAttempts) {
        attempts += 1;
        const x = (Math.random() - 0.5) * spread * 2;
        const nearU = 1 - ((1 - Math.random()) ** 2);
        const z = depthMin + nearU * (depthMax - depthMin);
        terrainField.sampleNormal(x, z, normal);
        if (normal.y < 0.72) continue;

        const exclusion = carpetField.sampleExclusion(x, z);
        if (exclusion.pathCore > 0.96 || exclusion.steepnessPenalty > 0.82) continue;

        const carpet = carpetField.sampleCarpet(x, z);
        if (!carpet || carpet.density < 0.02) continue;

        const wave1 = Math.sin(x * 0.03 + Math.cos(z * 0.02)) * 0.5 + 0.5;
        const wave2 = Math.sin(z * 0.05 + Math.cos(x * 0.04)) * 0.5 + 0.5;
        const clusterNoise = Math.pow(wave1 * 0.6 + wave2 * 0.4, 2.0);

        const scored = scoreFlowerCandidate(carpet, exclusion);
        const nearBias = smoothstep(depthMin + terrainSize * 0.08, depthMax - terrainSize * 0.04, z);
        const weightedScore = scored.score * (0.5 + nearBias * 0.78) * (0.3 + clusterNoise * 0.7);
        if (weightedScore < 0.012) continue;

        candidates.push({
            x,
            y: terrainField.sampleHeight(x, z),
            z,
            density: carpet.density,
            bandMask: carpet.bandMask,
            pocketMask: carpet.pocketMask,
            familyHint: carpet.family,
            familyWeights: carpetField.sampleFamilyWeights(x, z),
            score: weightedScore,
            sortJitter: hash2(x * 0.039 + 1.7, z * 0.041 + 7.3),
        });
    }

    candidates.sort((a, b) => {
        const aScore = a.score + (a.sortJitter * 0.06);
        const bScore = b.score + (b.sortJitter * 0.06);
        return bScore - aScore;
    });

    const selected = candidates.slice(0, anchorCount);
    const withFamilies = assignFlowerFamilies(selected, params);
    const anchors = withFamilies.map((candidate) => ({
        x: candidate.x,
        y: candidate.y,
        z: candidate.z,
        density: candidate.density,
        family: candidate.family,
        bandMask: candidate.bandMask,
        pocketMask: candidate.pocketMask,
    }));

    const familyCounts = {
        yellow: 0,
        pink: 0,
        purple: 0,
        blue: 0,
        white: 0,
    };
    const depthBuckets = {
        near: 0,
        mid: 0,
        far: 0,
    };
    let depthSum = 0;
    anchors.forEach((anchor) => {
        const knownFamily = ['yellow', 'pink', 'purple', 'blue'].includes(anchor.family);
        const key = knownFamily ? anchor.family : 'white';
        familyCounts[key] += 1;
        depthSum += anchor.z;
        if (anchor.z > terrainSize * 0.02) {
            depthBuckets.near += 1;
        } else if (anchor.z > -terrainSize * 0.18) {
            depthBuckets.mid += 1;
        } else {
            depthBuckets.far += 1;
        }
    });

    const diagnostics = sampleFlowerCoverageMetrics(terrainField, carpetField, params);
    const familyTotal = Math.max(1, anchors.length);
    return {
        anchors,
        diagnostics: {
            ...diagnostics,
            requestedAnchors: anchorCount,
            anchorMin,
            candidateCount: candidates.length,
            acceptedAnchors: anchors.length,
            familyCounts,
            depthBuckets,
            averageAnchorDepth: anchors.length > 0 ? depthSum / anchors.length : 0,
            familyShareAccepted: {
                yellow: familyCounts.yellow / familyTotal,
                pink:   familyCounts.pink   / familyTotal,
                purple: familyCounts.purple / familyTotal,
                blue:   familyCounts.blue   / familyTotal,
                white:  familyCounts.white  / familyTotal,
            },
        },
    };
}

function buildFlowerLayerInstances(mesh, terrainField, anchors, params = {}) {
    const capacity = mesh.count;
    const phases = new Float32Array(capacity);
    const colors = new Float32Array(capacity * 3);
    const leans = new Float32Array(capacity * 2);
    const normal = new THREE.Vector3();
    const smoothedNormal = new THREE.Vector3();
    const slopeQuat = new THREE.Quaternion();
    const yawQuat = new THREE.Quaternion();
    const dummy = new THREE.Object3D();
    const layer = params.layer === 'stem' ? 'stem' : 'head';
    const terrainSize = params.terrainSize ?? 640;
    const palette = resolveFlowerPalette(params.flowerPalettePreset);
    const groundLift = layer === 'stem'
        ? (params.flowerGroundLiftStem ?? 0.34)
        : (params.flowerGroundLiftHead ?? 0.66);
    const slopeLiftScale = params.flowerSlopeLift ?? 0.12;

    let placed = 0;

    for (let i = 0; i < anchors.length && placed < capacity; i += 1) {
        const anchor = anchors[i];
        const horizonFade = smoothstep(-terrainSize * 0.16, -terrainSize * 0.45, anchor.z);
        const clusterBase = layer === 'stem' ? 3 : 2;
        const clusterGain = layer === 'stem'
            ? Math.round(2 + anchor.density * 5 + anchor.pocketMask * 3)
            : Math.round(2 + anchor.density * 5 + anchor.bandMask * 3);
        const nearBias = smoothstep(-terrainSize * 0.22, terrainSize * 0.16, anchor.z);
        const nearBoost = 0.72 + nearBias * 0.62;
        const perAnchor = Math.max(
            1,
            Math.round((clusterBase + clusterGain) * (1 - horizonFade * 0.56) * nearBoost),
        );

        for (let n = 0; n < perAnchor && placed < capacity; n += 1) {
            const jitterAngle = Math.random() * Math.PI * 2;
            const jitterRadius = (layer === 'stem' ? 0.48 : 0.72) * (0.2 + Math.random() * 0.86);
            const x = anchor.x + Math.cos(jitterAngle) * jitterRadius;
            const z = anchor.z + Math.sin(jitterAngle) * jitterRadius;
            const y = terrainField.sampleHeight(x, z);

            terrainField.sampleNormal(x, z, normal);
            // More upright to avoid horizontal flowers poking out of ridges
            smoothedNormal.copy(normal).lerp(WORLD_UP, layer === 'stem' ? 0.75 : 0.85).normalize();
            slopeQuat.setFromUnitVectors(WORLD_UP, smoothedNormal);
            yawQuat.setFromAxisAngle(smoothedNormal, Math.random() * Math.PI * 2);

            const slopeLift = (1 - normal.y) * slopeLiftScale;
            dummy.position.set(x, y + groundLift + slopeLift, z);
            dummy.quaternion.copy(slopeQuat).multiply(yawQuat);

            const scaleBase = layer === 'stem' ? 0.66 : 0.72;
            const scaleGain = layer === 'stem' ? 0.94 : 1.08;
            const scale = scaleBase + anchor.density * scaleGain + Math.random() * (layer === 'stem' ? 0.28 : 0.22);
            dummy.scale.set(
                scale * (0.82 + Math.random() * 0.24),
                scale * (0.88 + Math.random() * 0.26),
                scale * (0.82 + Math.random() * 0.24),
            );
            dummy.updateMatrix();
            mesh.setMatrixAt(placed, dummy.matrix);

            phases[placed] = Math.random() * Math.PI * 2;

            const color = toFlowerColor(anchor.family, palette, layer);
            colors[placed * 3] = color[0];
            colors[placed * 3 + 1] = color[1];
            colors[placed * 3 + 2] = color[2];

            const leanAngle = Math.random() * Math.PI * 2;
            const leanStrength = (layer === 'stem' ? 0.02 : 0.03) + Math.random() * 0.05;
            leans[placed * 2] = Math.cos(leanAngle) * leanStrength;
            leans[placed * 2 + 1] = Math.sin(leanAngle) * leanStrength;

            placed += 1;
        }
    }

    fillHiddenInstances(mesh, placed, dummy);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    mesh.geometry.setAttribute('aLean', new THREE.InstancedBufferAttribute(leans, 2));

    mesh.userData.maxCount = placed;
    mesh.count = placed;
    return placed;
}

function setInstanceDensity(mesh, scale = 1) {
    if (!mesh) return 0;
    const maxCount = mesh.userData?.maxCount ?? mesh.count;
    const nextCount = clamp(Math.floor(maxCount * scale), 0, maxCount);
    mesh.count = nextCount;
    return nextCount;
}

function disposeMesh(mesh) {
    if (!mesh) return;
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material?.dispose?.());
    } else {
        mesh.material?.dispose?.();
    }
}

export function createGrassSystem(scene, terrainField, params = {}) {
    const nearCapacity = Math.max(0, Math.floor(params.grassNearCount ?? 9000));
    const midCapacity = Math.max(0, Math.floor(params.grassMidCount ?? 6200));
    const antialias = params.antialias === true;

    const atlasTexture = createGrassAtlasTexture();

    const nearGeometry = createTaperedCrossGeometry({
        cardCount: 4,
        widthBottom: 0.94,
        widthTop: 0.18,
        height: 0.96,
        curve: 0.06,
    });

    const midGeometry = createTaperedCrossGeometry({
        cardCount: 2,
        widthBottom: 0.76,
        widthTop: 0.2,
        height: 0.72,
        curve: 0.05,
    });

    const nearRuntime = createGrassMaterial({
        atlasTexture,
        windStrength: params.windStrength ?? 0.9,
        baseColor: params.baseColor || new THREE.Color(0x3d7e3d), // Deeper forest green root
        tipColor: params.tipColor || new THREE.Color(0xb4df74), // Warmer, brighter tip
        backlightColor: params.backlightColor || new THREE.Color(0xe9f8a6), // Very bright yellow-green scatter
        fogColor: params.fogColor || new THREE.Color(0xb8d0df),
        fogNear: params.fogNear ?? 86,
        fogFar: params.fogFar ?? 350,
        sunDirection: params.sunDirection,
        alphaToCoverage: antialias,
    });

    const midRuntime = createGrassMaterial({
        atlasTexture,
        windStrength: (params.windStrength ?? 0.9) * 0.88,
        baseColor: params.baseColor || new THREE.Color(0x3d7e3d),
        tipColor: params.tipColor || new THREE.Color(0xb4df74),
        backlightColor: params.backlightColor || new THREE.Color(0xe9f8a6),
        fogColor: params.fogColor || new THREE.Color(0xb8d0df),
        fogNear: (params.fogNear ?? 86) + 18,
        fogFar: (params.fogFar ?? 350) + 24,
        sunDirection: params.sunDirection,
        alphaToCoverage: antialias,
    });

    const nearMesh = new THREE.InstancedMesh(nearGeometry, nearRuntime.material, nearCapacity);
    const midMesh = new THREE.InstancedMesh(midGeometry, midRuntime.material, midCapacity);
    nearMesh.frustumCulled = false;
    midMesh.frustumCulled = false;
    nearMesh.renderOrder = 10;
    midMesh.renderOrder = 8;

    const group = new THREE.Group();
    group.name = 'sky-v2-grass-system';
    group.add(midMesh);
    group.add(nearMesh);

    buildGrassInstances(nearMesh, terrainField, params, 'near');
    buildGrassInstances(midMesh, terrainField, params, 'mid');

    scene.add(group);

    return {
        type: 'grass',
        group,
        nearMesh,
        midMesh,
        atlasTexture,
        uniformSets: [nearRuntime.uniforms, midRuntime.uniforms],
        windScale: 1,
        densityScale: 1,
        setDensityScale(scale = 1) {
            const clamped = clamp(scale, 0.1, 2);
            this.densityScale = clamped;
            const near = setInstanceDensity(this.nearMesh, clamped);
            const mid = setInstanceDensity(this.midMesh, clamped);
            return { near, mid, scale: clamped };
        },
        state() {
            return {
                near: this.nearMesh?.count ?? 0,
                nearMax: this.nearMesh?.userData?.maxCount ?? 0,
                mid: this.midMesh?.count ?? 0,
                midMax: this.midMesh?.userData?.maxCount ?? 0,
                densityScale: this.densityScale,
            };
        },
        dispose() {
            if (this.group?.parent) {
                this.group.parent.remove(this.group);
            }
            disposeMesh(this.nearMesh);
            disposeMesh(this.midMesh);
            this.atlasTexture?.dispose?.();
        },
    };
}

export function createFlowerSystem(scene, terrainField, params = {}) {
    const anchorCapacity = Math.max(
        0,
        Math.floor(params.flowerAnchorCount ?? ((params.flowerNearCount ?? 2400) * 0.25)),
    );
    const headsCapacity = Math.max(0, Math.floor(params.flowerHeadsCount ?? params.flowerNearCount ?? 2400));
    const stemsCapacity = Math.max(
        0,
        Math.floor(params.flowerStemsCount ?? Math.round(headsCapacity * 1.26)),
    );
    const antialias = params.antialias === true;
    let activePalettePreset = params.flowerPalettePreset || 'prairie';
    let activeHeadLift = params.flowerGroundLiftHead ?? 0.66;
    let activeStemLift = params.flowerGroundLiftStem ?? 0.34;
    let activeSlopeLift = params.flowerSlopeLift ?? 0.12;
    const carpetField = createFlowerCarpetField(terrainField, {
        carpetStrength: params.flowerCarpetStrength ?? params.flowerRibbonDensity ?? 1,
        palettePreset: activePalettePreset,
    });

    const headAtlasTexture = createFlowerAtlasTexture();
    const headGeometry = createCrossCardGeometry({
        cardCount: 2,
        width: 0.92,
        height: 0.82,
        yOffset: 0.48,
    });
    const stemGeometry = createTaperedCrossGeometry({
        cardCount: 2,
        widthBottom: 0.38,
        widthTop: 0.08,
        height: 1.05,
        curve: 0.02,
    });

    const headRuntime = createFlowerHeadMaterial({
        atlasTexture: headAtlasTexture,
        windStrength: params.windStrength ?? 0.68,
        fogColor: params.fogColor || new THREE.Color(0xb8d0df),
        fogNear: params.fogNear ?? 84,
        fogFar: params.fogFar ?? 326,
        glowStrength: params.glowStrength ?? 0.2,
        alphaToCoverage: antialias,
        sunDirection: params.sunDirection,
    });

    const stemRuntime = createFlowerStemMaterial({
        windStrength: (params.windStrength ?? 0.68) * 0.82,
        fogColor: params.fogColor || new THREE.Color(0xb8d0df),
        fogNear: (params.fogNear ?? 84) - 8,
        fogFar: (params.fogFar ?? 326) - 24,
        glowStrength: 0.06,
        alphaToCoverage: antialias,
        sunDirection: params.sunDirection,
    });

    const headMesh = new THREE.InstancedMesh(headGeometry, headRuntime.material, headsCapacity);
    const stemMesh = new THREE.InstancedMesh(stemGeometry, stemRuntime.material, stemsCapacity);
    headMesh.frustumCulled = false;
    stemMesh.frustumCulled = false;
    headMesh.renderOrder = 12;
    stemMesh.renderOrder = 11;

    const group = new THREE.Group();
    group.name = 'sky-v2-flower-system';
    group.add(stemMesh);
    group.add(headMesh);

    let anchors = [];
    let lastDiagnostics = null;
    const rebuildInstances = () => {
        const generated = generateFlowerAnchors(terrainField, carpetField, {
            ...params,
            flowerAnchorCount: anchorCapacity,
            flowerGroundLiftHead: activeHeadLift,
            flowerGroundLiftStem: activeStemLift,
            flowerSlopeLift: activeSlopeLift,
        });
        anchors = generated.anchors;
        lastDiagnostics = generated.diagnostics;

        const headsPlaced = buildFlowerLayerInstances(headMesh, terrainField, anchors, {
            ...params,
            layer: 'head',
            flowerPalettePreset: activePalettePreset,
            flowerGroundLiftHead: activeHeadLift,
            flowerGroundLiftStem: activeStemLift,
            flowerSlopeLift: activeSlopeLift,
        });
        const stemsPlaced = buildFlowerLayerInstances(stemMesh, terrainField, anchors, {
            ...params,
            layer: 'stem',
            flowerPalettePreset: activePalettePreset,
            flowerGroundLiftHead: activeHeadLift,
            flowerGroundLiftStem: activeStemLift,
            flowerSlopeLift: activeSlopeLift,
        });

        return {
            anchors: anchors.length,
            heads: headsPlaced,
            stems: stemsPlaced,
            diagnostics: lastDiagnostics,
        };
    };

    const initial = rebuildInstances();
    scene.add(group);

    return {
        type: 'flowers',
        group,
        mesh: headMesh,
        headMesh,
        stemMesh,
        headAtlasTexture,
        carpetField,
        anchorCount: initial.anchors,
        flowerPalettePreset: activePalettePreset,
        carpetStrength: carpetField.getState().strength,
        uniformSets: [headRuntime.uniforms, stemRuntime.uniforms],
        windScale: 0.72,
        densityScale: 1,
        flowerGroundLiftHead: activeHeadLift,
        flowerGroundLiftStem: activeStemLift,
        flowerSlopeLift: activeSlopeLift,
        setDensityScale(scale = 1) {
            const clamped = clamp(scale, 0.1, 2);
            this.densityScale = clamped;
            const headVisible = setInstanceDensity(this.headMesh, clamped);
            const stemVisible = setInstanceDensity(this.stemMesh, clamped);
            return {
                headVisible,
                stemVisible,
                scale: clamped,
            };
        },
        setCarpetStrength(value = 1) {
            this.carpetStrength = carpetField.setStrength(value);
            const result = rebuildInstances();
            this.anchorCount = result.anchors;
            this.setDensityScale(this.densityScale);
            return {
                carpetStrength: this.carpetStrength,
                ...result,
            };
        },
        rebuild() {
            const result = rebuildInstances();
            this.anchorCount = result.anchors;
            this.setDensityScale(this.densityScale);
            return {
                ...result,
            };
        },
        setPalette(preset = 'prairie') {
            activePalettePreset = String(preset || 'prairie').toLowerCase();
            this.flowerPalettePreset = activePalettePreset;
            carpetField.setPalette(activePalettePreset);
            const result = rebuildInstances();
            this.anchorCount = result.anchors;
            this.setDensityScale(this.densityScale);
            return {
                palette: this.flowerPalettePreset,
                ...result,
            };
        },
        setGroundLift(headLift = activeHeadLift, stemLift = activeStemLift, slopeLift = activeSlopeLift) {
            activeHeadLift = clamp(Number(headLift) || activeHeadLift, 0.2, 1.8);
            activeStemLift = clamp(Number(stemLift) || activeStemLift, 0.15, 1.4);
            activeSlopeLift = clamp(Number(slopeLift) || activeSlopeLift, 0.02, 0.35);
            this.flowerGroundLiftHead = activeHeadLift;
            this.flowerGroundLiftStem = activeStemLift;
            this.flowerSlopeLift = activeSlopeLift;
            const result = rebuildInstances();
            this.anchorCount = result.anchors;
            this.setDensityScale(this.densityScale);
            return {
                headLift: activeHeadLift,
                stemLift: activeStemLift,
                slopeLift: activeSlopeLift,
                ...result,
            };
        },
        sampleCarpet(x, z) {
            return carpetField.sampleCarpet(x, z);
        },
        diagnostics() {
            return {
                ...(lastDiagnostics || {}),
                headVisible: this.headMesh?.count ?? 0,
                headMax: this.headMesh?.userData?.maxCount ?? 0,
                stemVisible: this.stemMesh?.count ?? 0,
                stemMax: this.stemMesh?.userData?.maxCount ?? 0,
                densityScale: this.densityScale,
                carpetStrength: this.carpetStrength,
                palette: this.flowerPalettePreset,
                flowerGroundLiftHead: this.flowerGroundLiftHead,
                flowerGroundLiftStem: this.flowerGroundLiftStem,
                flowerSlopeLift: this.flowerSlopeLift,
            };
        },
        state() {
            return {
                anchors: this.anchorCount,
                headVisible: this.headMesh?.count ?? 0,
                headMax: this.headMesh?.userData?.maxCount ?? 0,
                stemVisible: this.stemMesh?.count ?? 0,
                stemMax: this.stemMesh?.userData?.maxCount ?? 0,
                densityScale: this.densityScale,
                carpetStrength: this.carpetStrength,
                palette: this.flowerPalettePreset,
                diagnostics: this.diagnostics(),
            };
        },
        dispose() {
            if (this.group?.parent) {
                this.group.parent.remove(this.group);
            }
            disposeMesh(this.headMesh);
            disposeMesh(this.stemMesh);
            this.headAtlasTexture?.dispose?.();
        },
    };
}

export function createMoteSystem(scene, params = {}) {
    const count = Math.max(0, Math.floor(params.moteCount ?? 800));
    const geometry = new THREE.PlaneGeometry(0.8, 0.8);
    const material = new THREE.MeshBasicMaterial({
        color: 0xfffcbd, // Warm glowing yellow
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    // We'll use instanced mesh but constantly update the matrices in a render loop 
    // to simulate wandering flocking paths without complex compute shaders for now.
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20; // Render over vegetation

    const motes = new Float32Array(count * 4); // x, y, z, phase
    const spread = (params.terrainSize ?? 640) * 0.45;

    for (let i = 0; i < count; i++) {
        motes[i * 4] = (Math.random() - 0.5) * spread * 2; // x
        motes[i * 4 + 1] = 2 + Math.random() * 40; // y
        motes[i * 4 + 2] = (Math.random() - 0.5) * spread * 2; // z
        motes[i * 4 + 3] = Math.random() * Math.PI * 2; // phase
    }

    mesh.userData.motes = motes;
    mesh.userData.maxCount = count;

    scene.add(mesh);

    return {
        type: 'motes',
        mesh,
        update: (time, windStrength = 1, terrainField = null) => {
            const dummy = new THREE.Object3D();
            const data = mesh.userData.motes;
            let idx = 0;

            // Simple camera tracking to keep motes wrapped around the player
            // But for this static scene, we just let them drift based on time

            for (let i = 0; i < count; i++) {
                let x = data[idx];
                let y = data[idx + 1];
                let z = data[idx + 2];
                const phase = data[idx + 3];

                // Drift with wind + turbulence
                x += Math.sin(time * 0.5 + phase) * 0.1 * windStrength;
                z += Math.cos(time * 0.6 + phase) * 0.1 * windStrength;
                y += Math.sin(time * 1.2 + phase * 2.1) * 0.05;

                // Keep them roughly above ground
                if (terrainField) {
                    const ty = terrainField.sampleHeight(x, z);
                    if (y < ty + 1) y = ty + 1 + Math.random() * 2;
                }

                // Wrap around bounds softly
                if (x > spread) x = -spread;
                if (x < -spread) x = spread;
                if (z > spread) z = -spread;
                if (z < -spread) z = spread;

                data[idx] = x;
                data[idx + 1] = y;
                data[idx + 2] = z;

                // Billboarding is faked by just facing camera in update loop?
                // For simplicity, they are just fast moving planes that look like streaks
                dummy.position.set(x, y, z);

                // Scale pulses
                const pulse = 0.5 + 0.5 * Math.sin(time * 3.0 + phase * 5.0);
                dummy.scale.setScalar(0.4 + pulse * 0.6);

                // Orient along movement
                dummy.lookAt(x + Math.sin(time * 0.5 + phase), y + Math.sin(time * 1.2 + phase * 2.1), z + Math.cos(time * 0.6 + phase));

                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                idx += 4;
            }
            mesh.instanceMatrix.needsUpdate = true;
        },
        dispose() {
            if (mesh?.parent) mesh.parent.remove(mesh);
            geometry.dispose();
            material.dispose();
        }
    }
}

export function createWindLinesSystem(scene, params = {}) {
    const count = (params.windLineCount ?? 40) * 1.5; // More ribbons
    // Use a cylinder aligned to Z axis so it's visible from all angles when moving
    const geometry = new THREE.CylinderGeometry(0.25, 0.05, 38, 4);
    geometry.rotateX(Math.PI / 2); // Align height with Z axis for lookAt
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.65, // Much more opaque
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 25; // Render over vegetation

    // x, y, z, phase
    const lines = new Float32Array(count * 4);
    const spread = (params.terrainSize ?? 640) * 0.45;

    for (let i = 0; i < count; i++) {
        lines[i * 4] = (Math.random() - 0.5) * spread * 2; // x
        lines[i * 4 + 1] = 2 + Math.random() * 40; // y
        lines[i * 4 + 2] = (Math.random() - 0.5) * spread * 2; // z
        lines[i * 4 + 3] = Math.random(); // lifespan/phase
    }

    mesh.userData.lines = lines;
    scene.add(mesh);

    return {
        type: 'windLines',
        mesh,
        update: (time, windStrength = 1, terrainField = null) => {
            const dummy = new THREE.Object3D();
            const data = mesh.userData.lines;
            let idx = 0;

            for (let i = 0; i < count; i++) {
                let x = data[idx];
                let y = data[idx + 1];
                let z = data[idx + 2];
                let phase = data[idx + 3];

                // Fast, forceful wind currents
                const windDx = Math.sin(time * 0.5) * 0.3 + 1.8;
                const windDz = Math.cos(time * 0.6) * 0.3 + 1.2;

                x += windDx * windStrength * 3.5; // Faster
                z += windDz * windStrength * 3.5; // Faster
                phase += 0.008; // Age faster

                if (phase > 1.0) {
                    phase = 0;
                    x = (Math.random() - 0.5) * spread * 2;
                    z = (Math.random() - 0.5) * spread * 2;

                    if (terrainField) {
                        const ty = terrainField.sampleHeight(x, z);
                        y = ty + 2 + Math.random() * 10;
                    }
                }

                if (terrainField) {
                    const ty = terrainField.sampleHeight(x, z);
                    // Hug terrain loosely
                    y += (ty + 3 - y) * 0.02;
                }

                // Wrap around bounds softly
                if (x > spread) x = -spread;
                if (x < -spread) x = spread;
                if (z > spread) z = -spread;
                if (z < -spread) z = spread;

                data[idx] = x;
                data[idx + 1] = y;
                data[idx + 2] = z;
                data[idx + 3] = phase;

                dummy.position.set(x, y, z);

                // Fade in and fade out based on phase
                const scaleStr = Math.sin(phase * Math.PI);
                dummy.scale.set(scaleStr, scaleStr, scaleStr);

                // Orient along movement path
                dummy.lookAt(x + windDx, y, z + windDz);

                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                idx += 4;
            }
            mesh.instanceMatrix.needsUpdate = true;
        },
        dispose() {
            if (mesh?.parent) mesh.parent.remove(mesh);
            geometry.dispose();
            material.dispose();
        }
    }
}

function updateUniformSet(uniforms, time, windStrength, sunDirection) {
    if (!uniforms) return;
    if (uniforms.uTime) uniforms.uTime.value = time;
    if (uniforms.uWindStrength) uniforms.uWindStrength.value = windStrength;
    if (uniforms.uSunDirection && sunDirection?.isVector3) {
        uniforms.uSunDirection.value.copy(sunDirection);
    }
}

export function updateVegetation(bundle, time, windState = {}) {
    if (!bundle) return;

    const baseWind = clamp(windState.strength ?? 1, 0.2, 3.2);
    const gust = clamp(windState.gust ?? 0, -0.5, 1.5);
    const combinedWind = clamp(baseWind + gust * 0.35, 0.25, 3.2);

    if (bundle.grass?.uniformSets) {
        bundle.grass.uniformSets.forEach((uniforms) => {
            updateUniformSet(
                uniforms,
                time,
                combinedWind * (bundle.grass.windScale ?? 1),
                windState.sunDirection,
            );
        });
    }

    if (bundle.flowers?.uniformSets) {
        bundle.flowers.uniformSets.forEach((uniforms) => {
            updateUniformSet(
                uniforms,
                time,
                combinedWind * (bundle.flowers.windScale ?? 0.72),
                windState.sunDirection,
            );
        });
    }
}

export function disposeVegetation(bundle) {
    if (!bundle) return;
    if (bundle.grass?.dispose) bundle.grass.dispose();
    if (bundle.flowers?.dispose) bundle.flowers.dispose();
    if (bundle.motes?.dispose) bundle.motes.dispose();
    if (bundle.wind?.dispose) bundle.wind.dispose();
}

import * as THREE from 'three';
import { clamp } from '@utils/helpers.js';

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - (2 * t));
}

function hash2(x, y) {
    const raw = Math.sin((x * 127.1) + (y * 311.7)) * 43758.5453;
    return raw - Math.floor(raw);
}

function normalizeWeights(weights) {
    const sum = Math.max(
        1e-6,
        (weights.pink || 0)
        + (weights.yellow || 0)
        + (weights.purple || 0)
        + (weights.blue || 0)
        + (weights.white || 0),
    );
    return {
        pink: clamp((weights.pink || 0) / sum, 0, 1),
        yellow: clamp((weights.yellow || 0) / sum, 0, 1),
        purple: clamp((weights.purple || 0) / sum, 0, 1),
        blue: clamp((weights.blue || 0) / sum, 0, 1),
        white: clamp((weights.white || 0) / sum, 0, 1),
    };
}

function remap01(value, inMin, inMax) {
    return clamp((value - inMin) / Math.max(1e-6, inMax - inMin), 0, 1);
}

function sampleLaneMask(distance, width) {
    const absDistance = Math.abs(distance);
    const inner = smoothstep(width * 1.22, width * 0.18, absDistance);
    const feather = smoothstep(width * 1.86, width * 0.82, absDistance);
    return clamp((inner * 0.74) + (feather * 0.28), 0, 1);
}

function samplePatchCluster(x, z, config) {
    const cellSize = config.patchCellSize + (hash2(x * 0.0031, z * 0.0031) - 0.5) * config.patchJitter;
    const ix = Math.floor((x + 8192) / Math.max(8, cellSize));
    const iz = Math.floor((z + 8192) / Math.max(8, cellSize));

    const seedA = hash2((ix * 0.71) + 3.4, (iz * 0.63) - 1.7);
    const seedB = hash2((ix * 0.47) - 2.3, (iz * 0.83) + 6.2);
    const seedC = hash2((ix * 1.11) + 8.9, (iz * 0.39) - 4.1);
    const active = smoothstep(config.patchActivationThreshold, 0.98, seedA);

    const centerX = ((ix + 0.5) * cellSize) - 8192 + ((seedB - 0.5) * cellSize * 0.42);
    const centerZ = ((iz + 0.5) * cellSize) - 8192 + ((seedC - 0.5) * cellSize * 0.42);

    const radiusX = cellSize * (0.44 + seedB * 0.46);
    const radiusZ = cellSize * (0.34 + seedC * 0.42);
    const dx = x - centerX;
    const dz = z - centerZ;
    const ellipse = Math.sqrt(
        ((dx * dx) / Math.max(1e-6, radiusX * radiusX))
        + ((dz * dz) / Math.max(1e-6, radiusZ * radiusZ)),
    );
    const core = smoothstep(1.18, 0.08, ellipse);
    const ripple = 0.88 + hash2(x * 0.051, z * 0.049) * 0.16;
    return clamp(active * core * ripple, 0, 1);
}

function resolvePalette(name, overrides = {}) {
    const normalized = String(name || 'prairie').toLowerCase();
    const presets = {
        prairie: {
            pinkBoost: 1.0,
            yellowBoost: 1.0,
            purpleBoost: 1.0,
            blueBoost: 1.0,
            whiteBoost: 0.34,
        },
        sunset: {
            pinkBoost: 1.22,
            yellowBoost: 0.88,
            purpleBoost: 0.85,
            blueBoost: 0.72,
            whiteBoost: 0.3,
        },
        soft: {
            pinkBoost: 0.9,
            yellowBoost: 0.82,
            purpleBoost: 1.1,
            blueBoost: 1.15,
            whiteBoost: 0.42,
        },
    };
    const base = presets[normalized] || presets.prairie;
    return {
        pinkBoost: clamp(overrides.pinkBoost ?? base.pinkBoost, 0.2, 2.4),
        yellowBoost: clamp(overrides.yellowBoost ?? base.yellowBoost, 0.2, 2.4),
        purpleBoost: clamp(overrides.purpleBoost ?? base.purpleBoost, 0.2, 2.4),
        blueBoost: clamp(overrides.blueBoost ?? base.blueBoost, 0.2, 2.4),
        whiteBoost: clamp(overrides.whiteBoost ?? base.whiteBoost, 0.1, 1.4),
        preset: normalized in presets ? normalized : 'prairie',
    };
}

export function createFlowerCarpetField(terrainField, params = {}) {
    const normalScratch = new THREE.Vector3();

    const config = {
        pathCenterYellowOffset: params.pathCenterYellowOffset ?? 42,
        pathCenterPinkOffset: params.pathCenterPinkOffset ?? 16,
        pathCenterWhiteOffset: params.pathCenterWhiteOffset ?? -14,
        pathCenterPurpleOffset: params.pathCenterPurpleOffset ?? -54,
        pathCenterBlueOffset: params.pathCenterBlueOffset ?? 78,
        yellowWidth: params.yellowWidth ?? 44,
        pinkWidth: params.pinkWidth ?? 36,
        whiteWidth: params.whiteWidth ?? 22,
        purpleWidth: params.purpleWidth ?? 38,
        blueWidth: params.blueWidth ?? 42,
        patchCellSize: params.patchCellSize ?? 32,
        patchJitter: params.patchJitter ?? 8,
        patchActivationThreshold: params.patchActivationThreshold ?? 0.34,
        horizonFadeStart: params.horizonFadeStart ?? -120,
        horizonFadeEnd: params.horizonFadeEnd ?? -280,
        slopeStart: params.slopeStart ?? 0.8,
        slopeEnd: params.slopeEnd ?? 0.5,
        pathCoreStart: params.pathCoreStart ?? 0.84,
        pathCoreEnd: params.pathCoreEnd ?? 1.0,
    };

    const state = {
        strength: clamp(params.carpetStrength ?? 1, 0.1, 2.4),
        palette: resolvePalette(params.palettePreset, params.palette),
    };

    function sampleBandMasks(x, z) {
        const pathCenter = terrainField.samplePathCenter(x);
        const yellowCenter = pathCenter + config.pathCenterYellowOffset + Math.sin((x * 0.017) - 1.2) * 8.5;
        const pinkCenter = pathCenter + config.pathCenterPinkOffset + Math.sin((x * 0.021) + 0.7) * 7.8;
        const whiteCenter = pathCenter + config.pathCenterWhiteOffset + Math.sin((x * 0.019) + 2.1) * 5.6;
        const purpleCenter = pathCenter + config.pathCenterPurpleOffset + Math.sin((x * 0.023) - 0.8) * 9.2;
        const blueCenter = pathCenter + config.pathCenterBlueOffset + Math.sin((x * 0.015) + 1.4) * 10.4;

        const yellowBand = sampleLaneMask(z - yellowCenter, config.yellowWidth);
        const pinkBand = sampleLaneMask(z - pinkCenter, config.pinkWidth);
        const whiteBand = sampleLaneMask(z - whiteCenter, config.whiteWidth);
        const purpleBand = sampleLaneMask(z - purpleCenter, config.purpleWidth);
        const blueBand = sampleLaneMask(z - blueCenter, config.blueWidth);
        const bandMask = clamp(Math.max(yellowBand, pinkBand, whiteBand, purpleBand, blueBand), 0, 1);

        return {
            yellowBand,
            pinkBand,
            whiteBand,
            purpleBand,
            blueBand,
            bandMask,
        };
    }

    function sampleExclusion(x, z) {
        const pathMask = terrainField.samplePathMask(x, z);
        const pathCore = smoothstep(config.pathCoreStart, config.pathCoreEnd, pathMask);

        terrainField.sampleNormal(x, z, normalScratch);
        const steepnessPenalty = smoothstep(config.slopeStart, config.slopeEnd, normalScratch.y);

        return {
            pathCore,
            steepnessPenalty,
        };
    }

    function sampleFamilyWeights(x, z) {
        const bands = sampleBandMasks(x, z);
        const patchMask = samplePatchCluster(x, z, config);
        const directional = 0.78 + ((Math.sin((x * 0.018) + (z * 0.006) + 0.6) + 1) * 0.14);
        const valley = terrainField.sampleValleyMask(x, z);
        const yellowShape = Math.max(bands.yellowBand * 0.55, patchMask);
        const pinkShape = Math.max(bands.pinkBand * 0.4, patchMask);
        const whiteShape = Math.max(bands.whiteBand * 0.35, patchMask * 0.52);
        const purpleShape = Math.max(bands.purpleBand * 0.48, patchMask * 0.60);
        const blueShape = Math.max(bands.blueBand * 0.52, patchMask * 0.55);

        const weights = {
            pink: bands.pinkBand * pinkShape * directional * (0.74 + valley * 0.42),
            yellow: bands.yellowBand * yellowShape * directional * (0.84 + valley * 0.24),
            purple: bands.purpleBand * purpleShape * directional * (0.80 + valley * 0.38),
            blue: bands.blueBand * blueShape * directional * (0.82 + valley * 0.30),
            white: bands.whiteBand * whiteShape * directional * 0.28,
        };

        weights.pink *= state.palette.pinkBoost;
        weights.yellow *= state.palette.yellowBoost;
        weights.purple *= state.palette.purpleBoost;
        weights.blue *= state.palette.blueBoost;
        weights.white *= state.palette.whiteBoost;

        return normalizeWeights(weights);
    }

    function sampleCarpet(x, z) {
        const bands = sampleBandMasks(x, z);
        const pocketMask = samplePatchCluster(x, z, config);
        const family = sampleFamilyWeights(x, z);
        const exclusion = sampleExclusion(x, z);

        const farFade = smoothstep(config.horizonFadeStart, config.horizonFadeEnd, z);
        const familyMax = Math.max(family.pink, family.yellow, family.purple, family.blue, family.white);
        const valleyMask = terrainField.sampleValleyMask(x, z);
        const densityBase = Math.max(
            0,
            (bands.bandMask * 0.62) + (pocketMask * 0.8) + (valleyMask * 0.08) - 0.12,
        );
        const inclusion = clamp((1 - exclusion.pathCore * 0.95) * (1 - exclusion.steepnessPenalty * 0.85), 0, 1);
        const nearBoost = 1 + remap01(z, config.horizonFadeEnd, config.horizonFadeStart) * 0.46;
        const density = clamp(
            densityBase
                * inclusion
                * (0.88 + familyMax * 0.3)
                * (1 - farFade * 0.56)
                * nearBoost
                * state.strength,
            0,
            1,
        );

        let familyName = 'yellow';
        let bestWeight = family.yellow;
        if (family.pink > bestWeight) {
            familyName = 'pink';
            bestWeight = family.pink;
        }
        if (family.purple > bestWeight) { familyName = 'purple'; bestWeight = family.purple; }
        if (family.blue > bestWeight) {
            familyName = 'blue';
            bestWeight = family.blue;
        }
        if (family.white > bestWeight) { familyName = 'white'; }

        return {
            density,
            family: familyName,
            bandMask: bands.bandMask,
            pocketMask,
        };
    }

    return {
        sampleCarpet,
        sampleFamilyWeights,
        sampleExclusion,
        setStrength(value = 1) {
            state.strength = clamp(Number(value) || 1, 0.1, 2.4);
            return state.strength;
        },
        setPalette(preset, overrides = {}) {
            state.palette = resolvePalette(preset, overrides);
            return { ...state.palette };
        },
        getState() {
            return {
                strength: state.strength,
                palette: { ...state.palette },
                config: { ...config },
            };
        },
    };
}

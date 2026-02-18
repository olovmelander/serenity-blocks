import * as THREE from 'three';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - (2 * t));
}

function hash2(x, y) {
    const raw = Math.sin((x * 127.1) + (y * 311.7)) * 43758.5453;
    return raw - Math.floor(raw);
}

function valueNoise2D(x, z) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const u = smoothstep(0, 1, fx);
    const v = smoothstep(0, 1, fz);

    const a = hash2(ix, iz);
    const b = hash2(ix + 1, iz);
    const c = hash2(ix, iz + 1);
    const d = hash2(ix + 1, iz + 1);

    const xBlendA = lerp(a, b, u);
    const xBlendB = lerp(c, d, u);
    return (lerp(xBlendA, xBlendB, v) * 2) - 1;
}

function fbm2D(x, z, octaves = 5, lacunarity = 2.03, gain = 0.52) {
    let amplitude = 0.5;
    let frequency = 1.0;
    let total = 0.0;
    let normalizer = 0.0;

    for (let i = 0; i < octaves; i += 1) {
        total += valueNoise2D(x * frequency, z * frequency) * amplitude;
        normalizer += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return normalizer > 0 ? total / normalizer : 0;
}

export function createSkyTerrainField(params = {}) {
    const config = {
        size: params.size ?? 640,
        minHeight: params.minHeight ?? -46,
        maxHeight: params.maxHeight ?? 68,
        pathWidth: params.pathWidth ?? 66,
        pathDepth: params.pathDepth ?? 14.2,
        shoulderLift: params.shoulderLift ?? 7.8,
        pathCenterOffset: params.pathCenterOffset ?? -20,
        pathNearSoftening: params.pathNearSoftening ?? 0.56,
        nearSofteningStart: params.nearSofteningStart ?? 46,
        nearSofteningEnd: params.nearSofteningEnd ?? 228,
        valleyStrength: params.valleyStrength ?? 5.2,
        ...params,
    };

    function samplePathCenter(x) {
        return (
            Math.sin((x + 68) * 0.0049) * 86
            + Math.sin((x - 190) * 0.0038) * 48
            + config.pathCenterOffset
        );
    }

    function samplePathSignedDistance(x, z) {
        return z - samplePathCenter(x);
    }

    function samplePathMask(x, z) {
        const distance = Math.abs(samplePathSignedDistance(x, z));
        const widthScale = 1 + (Math.sin((x + 96) * 0.0039) * 0.08) + (Math.sin((x - 42) * 0.0062) * 0.05);
        const pathWidth = config.pathWidth * widthScale;
        const inner = smoothstep(pathWidth * 1.12, pathWidth * 0.34, distance);
        const outer = smoothstep(pathWidth * 2.06, pathWidth * 0.92, distance);
        return clamp((inner * 0.75) + (outer * 0.35), 0, 1);
    }

    function sampleValleyMask(x, z) {
        const pathMask = samplePathMask(x, z);
        const offCenterA = Math.abs((z + 64) - (Math.sin((x + 20) * 0.0043) * 52));
        const offCenterB = Math.abs((z - 128) - (Math.sin((x - 170) * 0.0032) * 38));
        const carveA = smoothstep(138, 24, offCenterA);
        const carveB = smoothstep(162, 36, offCenterB);
        return clamp((pathMask * 0.72) + (carveA * 0.34) + (carveB * 0.26), 0, 1);
    }

    function sampleHeight(x, z) {
        const nx = x * 0.0042;
        const nz = z * 0.0042;

        const warpX = fbm2D((nx * 0.74) + 13.7, (nz * 0.74) - 7.9, 3, 2.0, 0.55);
        const warpZ = fbm2D((nx * 0.76) - 9.4, (nz * 0.76) + 10.8, 3, 2.0, 0.55);
        const wx = nx + (warpX * 0.54);
        const wz = nz + (warpZ * 0.54);

        const macro = fbm2D(wx * 0.64, wz * 0.64, 5, 2.01, 0.52);
        const rolling = fbm2D((wx * 1.14) + 6.9, (wz * 1.14) - 4.6, 4, 2.03, 0.54);
        const ridgeBase = fbm2D((wx * 2.08) - 2.4, (wz * 2.08) + 5.5, 3, 2.08, 0.56);
        const ridges = clamp(1 - Math.abs(ridgeBase), 0, 1) ** 2.0;

        const pathMask = samplePathMask(x, z);
        const valleyMask = sampleValleyMask(x, z);

        const detailAttenuation = 1 - (pathMask * 0.54) - (valleyMask * 0.24);
        let height = (macro * 22.0) + (rolling * 8.2) + (ridges * 3.4 * clamp(detailAttenuation, 0.35, 1.0));

        const meander = Math.sin((x + 84) * 0.0034) * 6.4;
        const lateral = Math.sin((z - 36) * 0.0062) * 2.6;
        height += meander + lateral;

        const foregroundSoftening = smoothstep(
            config.nearSofteningStart,
            config.nearSofteningEnd,
            z,
        ) * config.pathNearSoftening;
        const carveScale = 1 - foregroundSoftening;
        const pathCarve = pathMask * config.pathDepth * carveScale;
        const shoulder = smoothstep(0.24, 0.74, pathMask) * config.shoulderLift;
        const valleyCarve = valleyMask * config.valleyStrength * (0.78 + carveScale * 0.22);

        const heroHill = Math.exp(-(((x - 74) * (x - 74)) + ((z + 82) * (z + 82))) / 42000) * 8.8;
        const leftHill = Math.exp(-(((x + 176) * (x + 176)) + ((z + 22) * (z + 22))) / 52000) * 7.6;
        const rightHill = Math.exp(-(((x - 202) * (x - 202)) + ((z + 138) * (z + 138))) / 54000) * 7.2;
        const centerBasin = Math.exp(-((x * x) + ((z + 34) * (z + 34))) / 56000) * 1.9;

        const bankNoise = fbm2D((nx * 1.42) + 3.2, (nz * 1.42) - 1.4, 3, 2.1, 0.55);
        const leftBank = Math.exp(-((x + (config.size * 0.35)) ** 2) / 32000) * (4.4 + (bankNoise * 1.2));
        const rightBank = Math.exp(-((x - (config.size * 0.35)) ** 2) / 32000) * (4.2 + (bankNoise * 1.1));
        const edgeLift = smoothstep(config.size * 0.24, config.size * 0.5, Math.abs(x)) * 2.8;

        height += heroHill + leftHill + rightHill + leftBank + rightBank + shoulder + edgeLift;
        height -= pathCarve + valleyCarve + centerBasin;

        return clamp(height, config.minHeight, config.maxHeight);
    }

    function sampleNormal(x, z, target = new THREE.Vector3()) {
        const step = 3.2;
        const xPos = sampleHeight(x + step, z);
        const xNeg = sampleHeight(x - step, z);
        const zPos = sampleHeight(x, z + step);
        const zNeg = sampleHeight(x, z - step);
        target.set(xNeg - xPos, step * 2.0, zNeg - zPos);
        return target.normalize();
    }

    function sampleCurvature(x, z) {
        const step = 3.6;
        const center = sampleHeight(x, z);
        const xCurv = sampleHeight(x + step, z) + sampleHeight(x - step, z) - (2 * center);
        const zCurv = sampleHeight(x, z + step) + sampleHeight(x, z - step) - (2 * center);
        return xCurv + zCurv;
    }

    return {
        config,
        sampleHeight,
        sampleNormal,
        sampleCurvature,
        samplePathCenter,
        samplePathSignedDistance,
        samplePathMask,
        sampleValleyMask,
    };
}

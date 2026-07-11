/* eslint-disable import/no-unresolved */
import {
    cameraPosition,
    clamp,
    float,
    fog,
    length,
    mix,
    positionWorld,
    smoothstep,
    vec3,
} from 'three/tsl';

const QUALITY_VOLUME_COUNT = Object.freeze({
    Minimal: 0,
    Low: 1,
    Medium: 2,
    High: 3,
    Ultra: 3,
    Extreme: 3,
});

function ellipsoidMask(center, radii, featherStart) {
    const normalized = positionWorld.sub(center).div(radii);
    return float(1.0).sub(
        smoothstep(float(featherStart), float(1.0), length(normalized)),
    );
}

/**
 * ABZU-style material fog profile with a clear pocket, low-opacity silhouette
 * hold, and a stronger far dissolve. Cheap ellipsoids give the canyon and side
 * reefs distinct density without a raymarching pass.
 */
export function createOceanFogNode(quality = 'High') {
    const volumeCount = QUALITY_VOLUME_COUNT[quality] ?? QUALITY_VOLUME_COUNT.High;
    const viewDistance = length(cameraPosition.sub(positionWorld));

    const silhouetteHold = smoothstep(float(34.0), float(68.0), viewDistance).mul(0.105);
    const farDissolve = smoothstep(float(112.0), float(238.0), viewDistance).mul(0.66);
    const lowWater = float(1.0).sub(
        smoothstep(float(-12.0), float(38.0), positionWorld.y),
    );

    let localDensity = float(0.0);
    let canyonVolume = float(0.0);
    if (volumeCount >= 1) {
        canyonVolume = ellipsoidMask(vec3(0, 5, -94), vec3(92, 42, 76), 0.46);
        localDensity = localDensity.add(canyonVolume.mul(0.12));
    }
    if (volumeCount >= 2) {
        const leftReef = ellipsoidMask(vec3(-68, 2, -36), vec3(44, 27, 52), 0.54);
        localDensity = localDensity.add(leftReef.mul(0.065));
    }
    if (volumeCount >= 3) {
        const rightReef = ellipsoidMask(vec3(72, 4, -48), vec3(48, 30, 58), 0.54);
        localDensity = localDensity.add(rightReef.mul(0.08));
    }

    const fogFactor = clamp(
        silhouetteHold
            .add(farDissolve)
            .add(localDensity.mul(lowWater.mul(0.7).add(0.3))),
        float(0.0),
        float(0.82),
    );
    const fogColor = mix(
        vec3(0.035, 0.39, 0.52),
        vec3(0.012, 0.16, 0.29),
        clamp(
            farDissolve.add(canyonVolume.mul(0.32)).add(lowWater.mul(0.16)),
            float(0.0),
            float(1.0),
        ),
    );

    return fog(fogColor, fogFactor);
}

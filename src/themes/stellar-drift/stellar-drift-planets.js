/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** Baked weather and analytic world-space lighting shared by both node backends. */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, bumpMap, cameraPosition, cameraViewMatrix, dot, exp, float, floor, fract,
    length, mix, normalWorld, normalWorldGeometry, normalize, positionWorld,
    pow, reference, select, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;
export const STELLAR_DRIFT_SUN = Object.freeze([-0.62, 0.7, 0.75]);
const saturate = (value) => Math.min(1, Math.max(0, value));
const wrap = (value) => value - Math.floor(value);
const interpolate = (a, b, value) => a + (b - a) * value;
const BELT_STOPS = [
    [0, 0.34], [0.055, 0.58], [0.092, 0.36], [0.137, 0.77],
    [0.194, 0.65], [0.228, 0.25], [0.263, 0.57], [0.300, 0.84],
    [0.351, 0.82], [0.387, 0.36], [0.433, 0.30], [0.471, 0.61],
    [0.516, 0.80], [0.550, 0.77], [0.587, 0.34], [0.625, 0.42],
    [0.657, 0.74], [0.706, 0.80], [0.751, 0.28], [0.793, 0.66],
    [0.826, 0.69], [0.857, 0.31], [0.902, 0.63], [0.944, 0.57], [1, 0.35],
];

function beltWeather(latitude) {
    const v = saturate(latitude);
    for (let index = 1; index < BELT_STOPS.length; index += 1) {
        const [end, high] = BELT_STOPS[index];
        if (v <= end) {
            const [start, low] = BELT_STOPS[index - 1];
            const fraction = (v - start) / (end - start);
            return interpolate(low, high, fraction * fraction * (3 - 2 * fraction));
        }
    }
    return BELT_STOPS[BELT_STOPS.length - 1][1];
}

// Fixed lattices make the weather identical at corresponding UVs in every tier.
function weatherFields() {
    let state = 428731;
    const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
    return [8, 16, 32, 64].map((size) => ({
        size, values: Float32Array.from({ length: size * size }, random),
    }));
}

function sampleWeather(fields, u, v) {
    let result = 0; let amplitude = 0.55; let total = 0;
    for (const { size, values } of fields) {
        const x = wrap(u) * size; const y = wrap(v) * size;
        const rawX = Math.floor(x); const rawY = Math.floor(y);
        const ix = rawX % size; const iy = rawY % size;
        const sx = (x - rawX) ** 2 * (3 - 2 * (x - rawX));
        const sy = (y - rawY) ** 2 * (3 - 2 * (y - rawY));
        const nx = (ix + 1) % size; const ny = (iy + 1) % size;
        const a = interpolate(values[iy * size + ix], values[iy * size + nx], sx);
        const b = interpolate(values[ny * size + ix], values[ny * size + nx], sx);
        result += interpolate(a, b, sy) * amplitude;
        total += amplitude; amplitude *= 0.5;
    }
    return result / total;
}

/** The RGB cloud albedo and alpha relief are baked once, including coherent spiral storms. */
export function createGasGiantTexture(width = 512) {
    const height = width / 2;
    const data = new Uint8Array(width * height * 4);
    const fields = weatherFields();
    const palette = [
        [0.17, 0.026, 0.095], [0.43, 0.066, 0.035], [0.77, 0.22, 0.055],
        [0.94, 0.51, 0.19], [0.87, 0.69, 0.43],
    ];
    const storms = [
        [0.29, 0.43, 0.070, 0.041, 1], [0.64, 0.61, 0.046, 0.027, -1],
        [0.83, 0.29, 0.028, 0.022, 1], [0.10, 0.74, 0.023, 0.016, -1],
    ];
    for (let y = 0; y < height; y += 1) {
        const v = y / height;
        const pole = Math.sin(v * Math.PI) ** 0.5;
        for (let x = 0; x < width; x += 1) {
            const u = x / width;
            const weather = sampleWeather(fields, u, v * 1.4);
            const fineWeather = sampleWeather(fields, u * 3, v * 3.4);
            let latitude = v + (weather - 0.5) * 0.024 * pole
                + Math.sin(u * TAU * 7 + v * 49) * 0.005 * pole;
            let storm = 0; let spiral = 0;
            for (const [cx, cy, rx, ry, direction] of storms) {
                const dx = (wrap(u - cx + 0.5) - 0.5) / rx; const dy = (v - cy) / ry;
                const radial = Math.sqrt(dx * dx + dy * dy);
                const envelope = Math.exp(-radial * radial * 0.85);
                const angle = Math.atan2(dy, dx) + envelope * 3.6 * direction;
                latitude += (Math.sin(angle) * radial - dy) * ry * envelope * 0.62;
                storm += envelope;
                spiral += Math.sin(radial * 17 - angle * 2 * direction + weather * 2) * envelope;
            }
            const broad = beltWeather(latitude);
            const turbulence = sampleWeather(fields, u * 4 + weather * 0.2, latitude * 2.7);
            const shear = Math.sin(latitude * 227 + weather * 7 + Math.sin(u * TAU * 17) * 0.7);
            const filaments = Math.sin(latitude * 610 + fineWeather * 13 + spiral * 1.5);
            const colorCoordinate = saturate(broad + shear * 0.064
                + (weather - 0.5) * 0.23 + (turbulence - 0.5) * 0.33
                + spiral * 0.065) * (palette.length - 1);
            const stop = Math.min(palette.length - 2, Math.floor(colorCoordinate));
            const fraction = colorCoordinate - stop;
            const highCloud = saturate((shear + filaments * 0.2 - 0.63) * 0.7);
            const relief = saturate(0.4 + broad * 0.20 + shear * 0.10 + filaments * 0.045
                + (fineWeather - 0.5) * 0.19 + spiral * 0.08);
            const index = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
                const base = interpolate(palette[stop][channel], palette[stop + 1][channel], fraction);
                const white = [0.92, 0.76, 0.55][channel];
                const cloud = interpolate(base, white, highCloud * 0.48);
                const vortex = [0.71, 0.19, 0.077][channel];
                const color = interpolate(cloud, vortex, saturate(storm) * 0.27)
                    * (0.96 + fineWeather * 0.07 + filaments * 0.014);
                data[index + channel] = Math.round(saturate(color) * 255);
            }
            data[index + 3] = Math.round(relief * 255);
        }
    }
    const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true;
    map.name = 'stellar-drift-cloud-belts';
    return map;
}

function material(name, options = {}) {
    const result = new THREE.MeshBasicNodeMaterial({ fog: false, ...options });
    result.name = `stellar-drift-${name}`; result.emissiveNode = vec3(0);
    return result;
}

/** Lit cloud volumes: strong spherical falloff, a dark hemisphere and warm thin-film scattering. */
export function createStellarDriftPlanetMaterial({
    map, noise, time, rim, heroCenter, heroRadius, ringNormal,
}) {
    const planet = material('gas-giant');
    const q = uv().add(vec2(time.mul(0.0007), 0));
    // Basic materials deliberately bypass normalNode. Read the bump result explicitly in world space.
    const cloudNormal = bumpMap(texture(map, q).a, 0.11)
        .transformNormalByInverseViewMatrix(cameraViewMatrix);
    planet.colorNode = Fn(() => {
        const n = normalize(normalWorld).toVar();
        const reliefNormal = normalize(cloudNormal).toVar();
        const light = normalize(vec3(...STELLAR_DRIFT_SUN)).toVar();
        const view = normalize(cameraPosition.sub(positionWorld)).toVar();
        const facingSun = dot(n, light).toVar();
        const day = smoothstep(-0.055, 0.09, facingSun).toVar();
        const diffuse = dot(reliefNormal, light).max(0).toVar();
        const clouds = texture(map, q).rgb.toVar();
        const subtle = texture(noise, q.mul(vec2(9, 4))).r.mul(0.045).add(0.975);
        const shading = pow(diffuse, 0.88).mul(day).toVar();
        let ringShadow = float(1);
        if (heroCenter && heroRadius && ringNormal) {
            const relative = positionWorld.sub(heroCenter).toVar();
            const ringPlane = normalize(ringNormal).toVar();
            const alignment = dot(light, ringPlane).toVar();
            const divisor = select(alignment.lessThan(0), alignment.min(-0.001), alignment.max(0.001));
            const alongRay = dot(relative, ringPlane).negate().div(divisor).toVar();
            const radius = length(relative.add(light.mul(alongRay))).div(heroRadius).toVar();
            const edge = smoothstep(1.22, 1.27, radius)
                .mul(float(1).sub(smoothstep(2.11, 2.19, radius))).toVar();
            const gap = smoothstep(1.79, 1.83, radius)
                .mul(float(1).sub(smoothstep(1.88, 1.91, radius))).toVar();
            const density = texture(noise, vec2(radius.mul(3), 0.21)).r.mul(0.30).add(0.70);
            const occlusion = edge.mul(float(1).sub(gap.mul(0.90)))
                .mul(smoothstep(0.01, 0.15, alongRay)).mul(density);
            ringShadow = float(1).sub(occlusion.mul(0.28));
        }
        const surface = clouds.mul(vec3(1.10, 1.01, 0.93)).mul(shading.mul(1.12).add(0.018))
            .mul(subtle).mul(ringShadow)
            .toVar();
        // Nebula bounce keeps the night silhouette readable without flattening its terminator.
        const bounce = clouds.mul(vec3(0.015, 0.030, 0.063)).mul(float(1).sub(day));
        const limb = pow(float(1).sub(dot(n, view).max(0)), 4.5).toVar();
        const twilight = exp(abs(facingSun).mul(-13)).toVar();
        const sunset = vec3(0.93, 0.24, 0.055).mul(twilight).mul(limb).mul(0.26);
        const rayleigh = vec3(0.018, 0.20, 0.49).mul(limb).mul(0.055).mul(day.mul(0.6).add(0.4));
        return surface.add(bounce).add(sunset).add(rayleigh);
    })();
    planet.emissiveNode = Fn(() => {
        const view = normalize(cameraPosition.sub(positionWorld));
        const limb = pow(float(1).sub(dot(normalize(normalWorld), view).max(0)), 5);
        return vec3(0.035, 0.16, 0.31).mul(rim).mul(limb).mul(0.09);
    })();
    return planet;
}

/** A thin luminous atmosphere that follows the sun instead of outlining the entire sphere. */
export function createStellarDriftAtmosphereMaterial({ rim }) {
    const shell = material('atmospheric-scattering', {
        transparent: true, depthWrite: false, side: THREE.BackSide,
    });
    const scattering = Fn(() => {
        // BackSide flips shading normals; sunlight still follows the shell's outward geometry normal.
        const n = normalize(normalWorldGeometry).toVar();
        const view = normalize(cameraPosition.sub(positionWorld)).toVar();
        const edge = pow(float(1).sub(abs(dot(n, view))), 6).toVar();
        const sun = dot(n, normalize(vec3(...STELLAR_DRIFT_SUN))).toVar();
        const day = smoothstep(-0.18, 0.48, sun).toVar();
        const sunset = exp(abs(sun).mul(-7)).toVar();
        const color = mix(vec3(0.035, 0.24, 0.72), vec3(0.16, 0.47, 0.92), day)
            .add(vec3(0.95, 0.24, 0.025).mul(sunset).mul(0.8));
        const alpha = edge.mul(day.mul(0.10).add(0.052)).mul(rim.mul(0.65).add(1));
        return vec4(color, alpha);
    })();
    shell.colorNode = scattering.rgb; shell.opacityNode = scattering.a;
    shell.emissiveNode = scattering.rgb.mul(scattering.a).mul(0.7);
    return shell;
}

/** Shared copper/ice moon material with shaded crater rims, basins and coherent mineral patches. */
export function createStellarDriftMoonMaterial({ noise }) {
    const moon = material('cratered-moon');
    const icy = reference('userData.driftMoonPalette', 'float');
    const craterField = Fn(([q]) => {
        const cell = floor(q).toVar();
        const seed = texture(noise, cell.mul(0.071).add(vec2(0.17, 0.41))).rgb.toVar();
        const center = seed.rg.mul(0.42).add(0.29).toVar();
        const distance = length(fract(q).sub(center)).div(seed.b.mul(0.10).add(0.14)).toVar();
        const basin = float(1).sub(smoothstep(0.15, 0.89, distance)).toVar();
        const crest = exp(pow(distance.sub(0.94).mul(8), 2).negate()).toVar();
        const scatter = exp(distance.mul(distance).mul(-0.55)).toVar();
        return vec3(basin, crest, scatter);
    }).setLayout({ name: 'driftMoonCraters', type: 'vec3', inputs: [{ name: 'q', type: 'vec2' }] });
    moon.colorNode = Fn(() => {
        const q = uv().toVar();
        const broad = texture(noise, q.mul(vec2(4, 2))).rgb.toVar();
        const fine = texture(noise, q.mul(vec2(31, 17))).r.toVar();
        const crater = craterField(q.mul(vec2(34, 17))).toVar();
        const bigCrater = craterField(q.mul(vec2(14, 7)).add(vec2(0.38, 0.27))).toVar();
        const n = normalize(normalWorld).toVar();
        const view = normalize(cameraPosition.sub(positionWorld)).toVar();
        const light = normalize(vec3(...STELLAR_DRIFT_SUN)).toVar();
        const facingSun = dot(n, light).toVar();
        const day = smoothstep(-0.035, 0.04, facingSun).toVar();
        const diffuse = pow(facingSun.max(0), 0.86).toVar();
        const mineral = smoothstep(0.30, 0.63, broad.r.add(broad.b.mul(0.13))).toVar();
        const low = mix(vec3(0.22, 0.042, 0.037), vec3(0.020, 0.11, 0.24), icy);
        const high = mix(vec3(0.76, 0.31, 0.105), vec3(0.17, 0.56, 0.66), icy);
        const albedo = mix(low, high, mineral).mul(fine.mul(0.20).add(0.90)).toVar();
        const basins = crater.x.mul(0.23).add(bigCrater.x.mul(0.20)).toVar();
        const rims = crater.y.mul(0.15).add(bigCrater.y.mul(0.12)).toVar();
        const relief = float(1).sub(basins).add(rims).toVar();
        const surface = albedo.mul(diffuse.mul(day).mul(1.22).add(0.026)).mul(relief);
        const limb = pow(float(1).sub(dot(n, view).max(0)), 5);
        const sky = mix(vec3(0.14, 0.025, 0.020), vec3(0.025, 0.18, 0.29), icy);
        return surface.add(sky.mul(limb).mul(day).mul(0.08));
    })();
    return moon;
}

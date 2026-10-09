/**
 * Verdant Hills — the light, air, wind and clouds of a bright day on the downs.
 *
 * Materials stay unlit node materials and call into this rig, so both renderer backends
 * shade identically. One static shadow map of the home hill says where the oak shades the
 * grass; one cloud field says everything else: `cloudDensity()` is what the sky marches
 * through, and `cloudShadow()` projects the same field down the sun's rays, so the shadows
 * that drift over the hills are the shadows of the clouds above them. `haze()` lays the
 * same aerial perspective over every surface, `wind()` moves bark and leaves together, and
 * `meadowWind()` rolls gusts through the grass — the steady bands of the breeze, the rings
 * that spread from the foot of the board, and the front that crosses the valley when the
 * game asks for it.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, dot, exp, float, length, max, mix, normalize, positionWorld, pow, saturate, shadow, sin,
    smoothstep, texture, uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import { VerdantHillsRings } from './verdant-hills-rings.js';

export const VERDANT_HILLS_SUN_AZIMUTH_DEGREES = 30;
export const VERDANT_HILLS_SUN_ELEVATION_DEGREES = 36;
const SUN_AZIMUTH = THREE.MathUtils.degToRad(VERDANT_HILLS_SUN_AZIMUTH_DEGREES);
const SUN_ELEVATION = THREE.MathUtils.degToRad(VERDANT_HILLS_SUN_ELEVATION_DEGREES);
const TAU = Math.PI * 2;
/** How fast a gust ring crosses the grass, metres a second. */
export const VERDANT_HILLS_WAVE_SPEED = 10;
const WAVE_LIFE = 4.4;
/** The cumulus deck: flat bases at one height, tops wherever the field is thickest. */
export const VERDANT_HILLS_CLOUD_BASE = 1150;
export const VERDANT_HILLS_CLOUD_TOP = 2350;
/** One tile of the cloud field, in metres. */
export const VERDANT_HILLS_CLOUD_TILE = 12500;
/** The height at which a point's sun ray is taken to meet the deck. */
const CLOUD_SHADOW_HEIGHT = 1500;
export const VERDANT_HILLS_CLOUD_SIZE = 256;
const CLOUD_TEXTURE_SIZE = VERDANT_HILLS_CLOUD_SIZE;
/** The seed of the cloud field the theme ships and starts from. */
export const VERDANT_HILLS_CLOUD_SEED = 1456;
/** Version of the baked cloud field's encoding; the loader refuses a file written for another. */
export const VERDANT_HILLS_CLOUD_SCHEMA = 1;
/** How far the clouds travel in a second at rest, metres. */
const CLOUD_DRIFT = 11;
/** The share of the sky under cloud on a fair day. */
const CLOUD_COVER = 0.25;
/** Where the field stands when a session starts: the home hill in the sun, a shadow on its way. */
const CLOUD_START = Object.freeze([0.25, 0.8125]);

/**
 * Unit vector from the scene toward the sun: high, ahead and to the right, out of the top
 * of the frame. The oak stands on the left, so its shadow falls away from the lens.
 */
export const VERDANT_HILLS_SUN_DIRECTION = Object.freeze(new THREE.Vector3(
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
));
/** The wind blows out over the valley, away from the lens and to the right. */
export const VERDANT_HILLS_WIND_DIRECTION = Object.freeze(new THREE.Vector3(0.5, 0, -0.866));

function hashCell(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise on a lattice of `cells` (0..1). */
function tileValue(u, v, cells, seed) {
    const fx = u * cells;
    const fy = v * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
    const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const at = (x, y) => hashCell(((x % cells) + cells) % cells, ((y % cells) + cells) % cells, seed);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
}

/** Tileable cellular noise: 1 at a cell's feature point, falling to 0 between them. */
function tileCells(u, v, cells, seed) {
    const fx = u * cells;
    const fy = v * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let nearest = 9;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const cx = x0 + dx;
            const cy = y0 + dy;
            const wx = ((cx % cells) + cells) % cells;
            const wy = ((cy % cells) + cells) % cells;
            const px = cx + 0.15 + 0.7 * hashCell(wx, wy, seed);
            const py = cy + 0.15 + 0.7 * hashCell(wx, wy, seed + 71);
            const d = (px - fx) * (px - fx) + (py - fy) * (py - fy);
            if (d < nearest) nearest = d;
        }
    }
    return Math.max(0, 1 - Math.sqrt(nearest) * 1.15);
}

/** Four channels of tileable value noise at rising frequencies. */
function createNoiseTexture(seed, size = 128) {
    const data = new Uint8Array(size * size * 4);
    [4, 8, 16, 32].forEach((cells, channel) => {
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                data[(y * size + x) * 4 + channel] = Math.round(
                    tileValue(x / size, y / size, cells, seed + channel * 17) * 255,
                );
            }
        }
    });
    const noise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    noise.wrapS = THREE.RepeatWrapping;
    noise.wrapT = THREE.RepeatWrapping;
    noise.magFilter = THREE.LinearFilter;
    noise.minFilter = THREE.LinearMipmapLinearFilter;
    noise.generateMipmaps = true;
    noise.colorSpace = THREE.NoColorSpace;
    noise.name = 'VerdantHillsValueNoise';
    noise.needsUpdate = true;
    return noise;
}

/**
 * Tileable domes: a smooth rounded mound over every cell's feature point, summed where
 * they overlap. Unlike a cellular distance this has no point at its top and no crease
 * between neighbours, which is what lets a heap of them read as cumulus.
 */
function tileDomes(u, v, cells, seed, reach = 0.78) {
    const fx = u * cells;
    const fy = v * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const cx = x0 + dx;
            const cy = y0 + dy;
            const wx = ((cx % cells) + cells) % cells;
            const wy = ((cy % cells) + cells) % cells;
            const px = cx + 0.12 + 0.76 * hashCell(wx, wy, seed);
            const py = cy + 0.12 + 0.76 * hashCell(wx, wy, seed + 71);
            // Some mounds are large, some small, a few absent.
            const size = reach * (0.3 + 0.95 * hashCell(wx, wy, seed + 143) ** 1.5);
            const d = ((px - fx) * (px - fx) + (py - fy) * (py - fy)) / (size * size);
            if (d < 1) sum += (1 - d) * (1 - d) * (0.55 + 0.45 * hashCell(wx, wy, seed + 211));
        }
    }
    return sum;
}

/**
 * The cloud field. R = how high the cumulus heaps (0..1, rounded mounds on mounds);
 * G = the billows that carve its flanks; B = finer billows; A opaque, so the baked copy
 * decodes like any picture. `edges[i]` is the height below which `i / 255` of the sky lies,
 * so a threshold can be chosen that leaves a given share of the sky under cloud. The theme
 * ships this function's result baked (scripts/verdant-hills/bake-land.mjs) and calls it
 * only when that file is not at hand.
 */
export function createVerdantHillsCloudData(seed = 7, size = CLOUD_TEXTURE_SIZE) {
    const data = new Uint8Array(size * size * 4);
    const field = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const v = y / size;
            // The day's weather: broad swells in which the heaps gather and between which the sky is clear.
            const broad = tileValue(u, v, 2, seed) * 0.6 + tileValue(u, v, 5, seed + 1) * 0.4;
            const mass = tileDomes(u, v, 7, seed + 3);
            const turrets = tileDomes(u, v, 17, seed + 4, 0.7);
            const knobs = tileDomes(u, v, 37, seed + 12, 0.66);
            const puffs = tileDomes(u, v, 13, seed + 21, 0.6);
            // Turrets stand on the masses, knobs on the turrets: a cauliflower, not a scatter.
            // Small puffs of their own drift in the clear air between the great heaps.
            const heap = mass * (0.62 + turrets * 0.5 + turrets * knobs * 0.3) * (0.3 + broad * 1.2)
                + puffs * (0.2 + knobs * 0.1) * (1.1 - broad);
            field[y * size + x] = heap;
            const billow = 1 - (tileCells(u, v, 7, seed + 5) * 0.52 + tileCells(u, v, 15, seed + 6) * 0.3
                + tileCells(u, v, 31, seed + 7) * 0.18);
            const fine = 1 - (tileCells(u, v, 19, seed + 8) * 0.55 + tileCells(u, v, 41, seed + 9) * 0.45);
            const offset = (y * size + x) * 4;
            data[offset + 1] = Math.round(THREE.MathUtils.clamp(billow, 0, 1) * 255);
            data[offset + 2] = Math.round(THREE.MathUtils.clamp(fine, 0, 1) * 255);
            data[offset + 3] = 255;
        }
    }
    // Scale to the tall heaps of the day, not to the one freak where three mounds met.
    const highest = Float32Array.from(field).sort()[Math.floor(field.length * 0.996)] || 1;
    const counts = new Uint32Array(256);
    for (let i = 0; i < field.length; i += 1) {
        const level = Math.round(Math.min(1, field[i] / highest) * 255);
        data[i * 4] = level;
        counts[level] += 1;
    }
    // The height at each share of the sky, read off the cumulative histogram.
    const edges = new Float32Array(256);
    let below = 0;
    let level = 0;
    for (let i = 0; i < 256; i += 1) {
        const share = (i / 255) * field.length;
        while (level < 255 && below + counts[level] < share) {
            below += counts[level];
            level += 1;
        }
        edges[i] = level / 255;
    }
    return { data, edges };
}

/** How a cloud field must be sampled, whether it was baked or made on the spot. */
export function prepareVerdantHillsClouds(field) {
    const map = field;
    map.flipY = false;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'VerdantHillsCloudField';
    map.needsUpdate = true;
    return map;
}

function createCloudTexture(seed) {
    const { data, edges } = createVerdantHillsCloudData(seed);
    const map = new THREE.DataTexture(data, CLOUD_TEXTURE_SIZE, CLOUD_TEXTURE_SIZE, THREE.RGBAFormat);
    return { texture: prepareVerdantHillsClouds(map), edges };
}

export class VerdantHillsLight {
    /** `clouds` is the baked cloud field ({ texture, edges }); without it one is made here. */
    constructor({ tier, rng = Math.random, clouds = null }) {
        this.tier = tier;
        const seed = Math.floor(rng() * 4096);
        this.uTime = uniform(0);
        this.uSunDir = uniform(VERDANT_HILLS_SUN_DIRECTION.clone());
        this.uSunColor = uniform(new THREE.Color(3.5, 3.2, 2.7));
        this.uSkyLight = uniform(new THREE.Color(0.3, 0.44, 0.66));
        this.uBounce = uniform(new THREE.Color(0.13, 0.2, 0.07));
        // A washed summer sky: deep blue overhead, milk at the rim, and a glow toward the sun.
        this.uZenith = uniform(new THREE.Color(0.035, 0.15, 0.5));
        this.uSkyMid = uniform(new THREE.Color(0.1, 0.34, 0.74));
        this.uHorizon = uniform(new THREE.Color(0.42, 0.6, 0.8));
        this.uHorizonSun = uniform(new THREE.Color(0.86, 0.86, 0.78));
        // Shaded air is the blue of distance; sunlit air is added by the shafts between the
        // clouds where the tier has them, and by this analytic glow where it does not.
        this.uHazeCool = uniform(new THREE.Color(0.24, 0.38, 0.58));
        this.uHazeWarm = uniform(new THREE.Color(0.8, 0.76, 0.6));
        this.uHazeSun = uniform(tier.shafts > 0 ? 0.3 : 1);
        this.uHaze = uniform(0.00016);
        this.uGroundLevel = uniform(20);
        // Wind: a steady breeze up the valley, gusts that roll through the grass in bands,
        // and a travelling front. `uWindClock` runs faster the harder it blows.
        this.uWindDir = uniform(VERDANT_HILLS_WIND_DIRECTION.clone());
        this.uWind = uniform(0.34);
        this.uGust = uniform(0);
        this.uWindClock = uniform(0);
        this.uFront = uniform(new THREE.Vector4(0, 0, 26, 0)); // along the wind, strength, width
        // Gameplay envelopes shared by every material.
        this.uWarmth = uniform(0);
        this.uGlow = uniform(0);
        this.uShimmer = uniform(0);
        // The clouds: how much of the sky they cover, where the field has drifted to, and
        // the gap the game can open in them (ground x, z, radius, strength).
        this.uCloudCover = uniform(CLOUD_COVER);
        // How soft a cloud's skin is (in slab heights) and how deep the billows carve it.
        this.uCloudSoft = uniform(0.18);
        this.uCloudCarve = uniform(1);
        // The field's height at that share of the sky, and the span from there to its highest heap.
        this.uCloudEdge = uniform(0.5);
        this.uCloudSpan = uniform(0.5);
        this.uCloudOffset = uniform(new THREE.Vector2(CLOUD_START[0], CLOUD_START[1]));
        this.uSunPool = uniform(new THREE.Vector4(0, 0, 400, 0));
        this.cloudSpeed = 1;
        // The clock at the last frame: the breeze eases by the time between two of them.
        this.windTime = 0;
        // Gusts that spread through the grass from the foot of the board.
        this.waves = new VerdantHillsRings(tier.waves, WAVE_LIFE);
        this.uWaves = uniformArray(this.waves.rings);
        this.noiseTexture = createNoiseTexture(seed);
        // The clouds are the same every day (their start is tuned to this field); only the
        // grain of everything else follows the generator.
        this.ownsClouds = !(clouds?.texture && clouds.edges?.length === 256);
        const field = this.ownsClouds ? createCloudTexture(VERDANT_HILLS_CLOUD_SEED) : clouds;
        this.cloudTexture = field.texture;
        this.cloudEdges = field.edges;
        this.setCloudCover(CLOUD_COVER);

        this.sun = new THREE.DirectionalLight(0xffffff, 1);
        this.sun.name = 'VerdantHillsSun';
        this.sun.castShadow = true;
        const { shadow: sunShadow } = this.sun;
        sunShadow.mapSize.set(tier.shadowMap[0], tier.shadowMap[1]);
        // A coarser map needs more bias, or the boughs shade themselves in stripes.
        sunShadow.bias = -0.0012 * (2048 / tier.shadowMap[0]) ** 1.5;
        sunShadow.normalBias = 0;
        sunShadow.radius = 2.4;
        // Nothing that casts moves under a fixed sun, so the map is drawn once.
        sunShadow.autoUpdate = false;
        sunShadow.needsUpdate = true;
        this.shadowNode = shadow(this.sun);
        this.shadowFrames = 0;
    }

    /** Aim the shadow camera so its box holds the home hill: the oak, the wall and the lens. */
    frameShadows({
        centre = new THREE.Vector3(8, 58, -22), halfWidth = 62, halfHeight = 52, depth = 260,
    } = {}) {
        const { sun } = this;
        sun.position.copy(centre).addScaledVector(VERDANT_HILLS_SUN_DIRECTION, depth * 0.5);
        sun.target.position.copy(centre);
        const { camera } = sun.shadow;
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.near = 1;
        camera.far = depth;
        camera.updateProjectionMatrix();
        sun.updateMatrixWorld(true);
        sun.target.updateMatrixWorld(true);
        sun.shadow.needsUpdate = true;
        this.shadowFrames = 0;
    }

    addTo(group) {
        group.add(this.sun, this.sun.target);
    }

    noise(coordinate) {
        return texture(this.noiseTexture, coordinate);
    }

    // -- clouds -------------------------------------------------------------------------
    /** Where a point's sun ray meets the cloud deck (metres, xz). */
    sunFoot(world) {
        const reach = float(CLOUD_SHADOW_HEIGHT).sub(world.y).div(this.uSunDir.y);
        return world.xz.add(this.uSunDir.xz.mul(reach));
    }

    /** How open the gap in the clouds is along a point's sun ray (0..1). */
    sunGap(world) {
        const pool = this.uSunPool;
        const centre = pool.xy.add(this.uSunDir.xz.mul(float(CLOUD_SHADOW_HEIGHT).sub(this.uGroundLevel)
            .div(this.uSunDir.y)));
        const away = this.sunFoot(world).sub(centre).div(pool.z);
        return exp(dot(away, away).negate()).mul(pool.w);
    }

    /** The cloud field over a ground coordinate, blurred to `level` mips. */
    cloudField(xz, level = 0) {
        const at = xz.div(VERDANT_HILLS_CLOUD_TILE).add(this.uCloudOffset);
        return level > 0 ? texture(this.cloudTexture, at).level(level) : texture(this.cloudTexture, at);
    }

    /** 1 where the sun reaches a point between the clouds, less under one, more in the game's pool of light. */
    cloudShadow(world = positionWorld) {
        const field = this.cloudField(this.sunFoot(world), 1.5).r;
        const under = smoothstep(-0.03, 0.2, field.sub(this.uCloudEdge).div(this.uCloudSpan));
        // Where the game has opened the clouds the sun comes down harder than anywhere else.
        const gap = this.sunGap(world);
        // While its pool of light crosses the valley, the rest of the land stands a little in shade.
        const dimmed = under.mul(0.86).oneMinus().mul(this.uSunPool.w.mul(0.4).oneMinus());
        return mix(dimmed, float(2.3), saturate(gap));
    }

    /**
     * Density of the cumulus at a point (0..1): flat-based heaps whose tops stand highest
     * where the field is thickest, their flanks carved by billows that travel with them.
     */
    cloudDensity(point, { detail = true, range = null } = {}) {
        const span = VERDANT_HILLS_CLOUD_TOP - VERDANT_HILLS_CLOUD_BASE;
        const h = point.y.sub(VERDANT_HILLS_CLOUD_BASE).div(span);
        // Explicit mip levels throughout: the march samples inside loops and branches.
        const at = point.xz.div(VERDANT_HILLS_CLOUD_TILE).add(this.uCloudOffset);
        const field = texture(this.cloudTexture, at).level(0).r.sub(this.sunGap(point).mul(0.5));
        const shape = saturate(field.sub(this.uCloudEdge).div(this.uCloudSpan));
        // The field is mounds on mounds; the square root of what stands above the
        // threshold rounds each one into a dome with steep sides.
        // Whole multiples of the field's own coordinate, so the billows ride with their cloud.
        const swell = texture(this.cloudTexture, at.mul(7)).level(detail ? 0 : 1).g;
        // Its top is not smooth either: the same billows lift it here and let it sag there.
        const top = shape.sqrt().mul(swell.mul(0.5).add(0.7)).mul(0.94).add(0.03);
        // How far under the cloud's own top a point is, in slab heights.
        const under = top.sub(h);
        let density = saturate(under.div(this.uCloudSoft)).mul(smoothstep(0.0, 0.03, h))
            .mul(smoothstep(0.0, 0.03, shape));
        if (detail) {
            const lean = vec2(h.mul(0.37), h.mul(0.21));
            const billow = texture(this.cloudTexture, at.mul(7).add(lean)).level(0).g;
            // The finest billows are below a far sample's footprint: read them blurred there.
            const blur = range ? saturate(range.div(14000)).mul(3) : float(0);
            const fine = texture(this.cloudTexture, at.mul(22).add(lean.mul(2.3))).level(blur).b;
            const carve = billow.mul(0.68).add(fine.mul(0.32));
            // Billows eat into the skin of the cloud — its top and its flanks — and leave the heart whole.
            const skin = saturate(under.div(0.5)).oneMinus().max(smoothstep(0.3, 0.0, shape));
            density = saturate(density.sub(carve.mul(skin.mul(0.9).add(0.1)).mul(this.uCloudCarve)).mul(2.2));
        }
        return density.mul(saturate(float(1).sub(h).mul(12)));
    }

    // -- light --------------------------------------------------------------------------
    /** 1 where the sun reaches the fragment, 0 in shadow: the oak's shade and the clouds'. */
    sunlight(world = positionWorld) {
        return float(this.shadowNode).mul(this.cloudShadow(world));
    }

    /** Sky radiance seen along a unit direction (no disc, no cloud). */
    sky(direction) {
        const sunward = saturate(dot(direction, this.uSunDir));
        const overhead = saturate(direction.y);
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const sunFlat = normalize(vec2(this.uSunDir.x, this.uSunDir.z));
        const toward = dot(flat, sunFlat).mul(0.5).add(0.5);
        const upper = mix(this.uZenith, this.uSkyMid, pow(overhead.oneMinus(), 2.4));
        const rim = mix(this.uHorizon, this.uHorizonSun, pow(toward, 2.2));
        const glow = this.uSunColor.mul(pow(sunward, 6).mul(0.035).add(pow(sunward, 40).mul(0.09)));
        return mix(upper, rim, pow(overhead.oneMinus(), 7.5)).add(glow).mul(this.uWarmth.mul(0.05).add(1));
    }

    /** Aerial perspective: distance fades a colour into lit air, most in the low damp air. */
    haze(colour, { world = positionWorld, strength = 1 } = {}) {
        const offset = world.sub(cameraPosition);
        const range = length(offset);
        const direction = offset.div(max(range, 0.001));
        const low = exp(max(world.y.sub(this.uGroundLevel), 0).mul(-0.0024));
        const amount = exp(range.mul(this.uHaze).mul(low.mul(0.8).add(0.5)).negate()).oneMinus();
        const sunward = saturate(dot(direction, this.uSunDir));
        const air = this.uHazeCool.add(this.uHazeWarm.mul(pow(sunward, 3).mul(this.uHazeSun)
            .add(this.uWarmth.mul(0.04))));
        return mix(colour, air, saturate(amount.mul(strength)));
    }

    /** Hemisphere ambient: blue sky from above, the green of the grass from below. */
    ambient(normal) {
        return mix(this.uBounce, this.uSkyLight, normal.y.mul(0.5).add(0.5));
    }

    // -- wind ---------------------------------------------------------------------------
    /** How hard the breeze is blowing over a ground coordinate right now (0..1): cat's-paws. */
    windBand(xz) {
        const t = this.uWindClock;
        const direction = vec2(this.uWindDir.x, this.uWindDir.z);
        const along = dot(xz, direction);
        const cross = xz.x.mul(direction.y).sub(xz.y.mul(direction.x));
        // Bands travelling downwind, long across it, their fronts bent so no two look alike.
        const bend = sin(cross.mul(0.031).add(along.mul(0.007))).mul(1.3)
            .add(sin(cross.mul(0.0083).sub(1.9)).mul(2.1));
        const band = sin(along.mul(0.085).sub(t.mul(0.62)).add(bend))
            .add(sin(along.mul(0.19).sub(t.mul(1.05)).sub(cross.mul(0.047)).add(1.7)).mul(0.6))
            .add(sin(along.mul(0.043).sub(t.mul(0.33)).add(bend.mul(0.6)).add(4.1)).mul(0.8))
            .div(2.4);
        return smoothstep(-0.25, 0.85, band);
    }

    /** The front that crosses the valley: how strongly it is passing over a ground coordinate. */
    windFront(xz) {
        const along = dot(xz, vec2(this.uWindDir.x, this.uWindDir.z));
        return exp(along.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
    }

    /**
     * World-space wind offset for a point on a tree. `sway` is how far the wind may carry
     * the point (0 at the trunk, 1 at twig tips); `phase` keeps each limb out of step.
     */
    wind({
        world, base, height, treePhase, sway, phase,
    }) {
        const t = this.uTime;
        const along = world.x.mul(this.uWindDir.x).add(world.z.mul(this.uWindDir.z));
        const swell = sin(along.mul(0.04).sub(this.uWindClock.mul(0.8)).add(world.x.mul(0.017))).mul(0.5).add(0.5);
        const force = this.uWind.add(this.uGust.mul(swell.mul(0.7).add(0.65))).add(this.windFront(world.xz));
        const lift = saturate(world.y.sub(base.y).div(height));
        const lean = lift.mul(lift).mul(height).mul(0.011).mul(force)
            .mul(sin(t.mul(0.5).add(treePhase.mul(TAU))).mul(0.35).add(0.75));
        const limb = sway.mul(sway).mul(force).mul(
            sin(t.mul(1.3).add(phase.mul(TAU)).add(along.mul(0.19))).mul(0.3)
                .add(sin(t.mul(2.4).add(phase.mul(15.1))).mul(0.1)),
        );
        const bob = sway.mul(force).mul(sin(t.mul(1.7).add(phase.mul(9.4)))).mul(0.16);
        const push = lean.add(limb);
        return vec3(this.uWindDir.x.mul(push), bob.sub(limb.abs().mul(0.2)), this.uWindDir.z.mul(push));
    }

    /**
     * What the air is doing at a root in the grass: `push` is the horizontal shove in
     * metres for a point one metre up a stem (scale by height squared), `gust` says how
     * hard the passing band is blowing (0..1), `bloom` how strongly a ring from the board
     * is passing through right now and `front` how much of the valley's front is on it.
     */
    meadowWind(root, phase) {
        const t = this.uTime;
        const direction = vec2(this.uWindDir.x, this.uWindDir.z);
        const along = root.x.mul(direction.x).add(root.z.mul(direction.y));
        const gust = this.windBand(root.xz);
        const front = this.windFront(root.xz);
        const force = this.uWind.mul(gust.mul(1.3).add(0.28)).add(this.uGust.mul(gust.add(0.5))).add(front);
        const flutter = sin(t.mul(phase.mul(1.7).add(2.2)).add(phase.mul(40)).add(along.mul(0.6))).mul(0.34)
            .add(sin(t.mul(5.3).add(phase.mul(91))).mul(0.12)).add(0.8);
        let push = direction.mul(force.mul(flutter));
        let bloom = float(0);
        for (let i = 0; i < this.waves.count; i += 1) {
            const wave = this.uWaves.element(i); // x, z, age, strength
            const offset = root.xz.sub(wave.xy);
            const distance = length(offset).add(0.001);
            const reach = distance.sub(wave.z.mul(VERDANT_HILLS_WAVE_SPEED));
            const packet = exp(reach.div(wave.z.mul(0.55).add(1.1)).pow2().negate());
            const amplitude = packet.mul(wave.w).mul(exp(wave.z.mul(-0.5))).div(distance.mul(0.03).add(1)).min(1.2);
            push = push.add(offset.div(distance).mul(amplitude.mul(1.3)));
            bloom = bloom.add(amplitude);
        }
        return {
            push, gust: saturate(force.mul(0.9)), band: gust, bloom: saturate(bloom), front: saturate(front),
        };
    }

    update(time, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const dial = clamp01(frame.wind);
        // The breeze follows the dial over the same time whatever the frame rate. A clock that
        // stands still or runs back (a capture, a replay) counts as one frame. A dying wind
        // (game over) lets the grass stand.
        const passed = this.uTime.value - this.windTime;
        this.windTime = this.uTime.value;
        const target = (frame.settled === true ? 0.1 : 0.34) + dial * 0.5;
        const ease = 1 - Math.exp(-3.7 * (passed > 0 ? Math.min(passed, 0.1) : 1 / 60));
        this.uWind.value += (target - this.uWind.value) * ease;
        this.uGust.value = clamp01(frame.gust) * 1.5;
        this.uWarmth.value = clamp01(frame.warmth);
        this.uGlow.value = clamp01(frame.glow);
        this.uShimmer.value = clamp01(frame.shimmer);
        this.setCloudCover(this.uCloudCover.value);
        this.cloudSpeed = (frame.settled === true ? 0.35 : 1) + dial * 2.4 + clamp01(frame.gust) * 1.2;
        if (frame.front && Number.isFinite(frame.front.along)) {
            this.uFront.value.set(frame.front.along, clamp01(frame.front.strength) * 2.2, frame.front.width || 26, 0);
        } else this.uFront.value.y = 0;
        if (frame.pool && Number.isFinite(frame.pool.x)) {
            this.uSunPool.value.set(frame.pool.x, frame.pool.z, frame.pool.radius || 400, clamp01(frame.pool.strength));
        } else this.uSunPool.value.w = 0;
        // Pipelines may still be compiling when the first shadow map is drawn; redraw it
        // over the first frames so no late tree is missing from the static map.
        this.shadowFrames += 1;
        if (this.shadowFrames < 10 || this.shadowFrames === 45 || this.shadowFrames === 150) {
            this.sun.shadow.needsUpdate = true;
        }
    }

    /** Choose the share of the sky that lies under cloud (0..1). */
    setCloudCover(cover) {
        const share = THREE.MathUtils.clamp(Number.isFinite(cover) ? cover : 0.3, 0.02, 0.9);
        this.uCloudCover.value = share;
        const edge = this.cloudEdges[Math.round((1 - share) * 255)];
        this.uCloudEdge.value = edge;
        this.uCloudSpan.value = Math.max(0.08, 1 - edge);
    }

    /** Age the gusts in the grass and let the clouds and the wind's bands travel. */
    step(dt) {
        if (!(dt > 0)) return;
        this.waves.update(dt);
        this.uWindClock.value += dt * (0.75 + this.uWind.value * 1.1 + this.uGust.value * 0.5);
        const travel = (dt * CLOUD_DRIFT * this.cloudSpeed) / VERDANT_HILLS_CLOUD_TILE;
        const offset = this.uCloudOffset.value;
        // The field slides against the wind's direction so the clouds travel with it. It is
        // never wrapped: the cirrus reads it at a fraction of its rate, and a session of
        // hours moves it by tens of tiles, far inside what a float holds.
        offset.x -= this.uWindDir.value.x * travel;
        offset.y -= this.uWindDir.value.z * travel;
    }

    /** Put the clouds and the wind back where a session starts (a replay must begin from one place). */
    rewind() {
        this.uWindClock.value = 0;
        this.uCloudOffset.value.set(CLOUD_START[0], CLOUD_START[1]);
        this.uWind.value = 0.34;
        this.windTime = 0;
        this.cloudSpeed = 1;
        this.reset();
    }

    reset() {
        this.waves.reset();
        this.uSunPool.value.w = 0;
        this.uFront.value.y = 0;
    }

    dispose() {
        this.noiseTexture.dispose();
        // A baked field belongs to the asset pack, which outlives a rebuild.
        if (this.ownsClouds) this.cloudTexture.dispose();
        this.shadowNode.dispose?.();
        this.sun.shadow.dispose();
        this.sun.removeFromParent();
        this.sun.target.removeFromParent();
        this.sun.dispose();
    }
}

/**
 * Summer — the land around the lake.
 *
 * One analytic height function: the flowering meadow under the camera, falling gently to
 * the near shore; across the water a spruce-wooded headland on the left, the cottage's
 * promontory closing a cove on the right, an island out where the sun stands and the far
 * shore climbing into hills. Water lies at y = 0. The same function places every tree,
 * flower, reed and stone, and is baked into two small maps: one tells the lake how deep it
 * is, the other tells the meadow where feet have worn a path and where the grass is mown
 * for the dance around the maypole.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, dot, float, length, mix, normalWorld, normalize, positionWorld, pow, reflect, saturate,
    smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';

export const SUMMER_BOUNDS = Object.freeze({
    minX: -380, maxX: 380, minZ: -470, maxZ: 46,
});
/** Heights are stored in the lake map as (height + bias) / range. */
export const SUMMER_MAP_BIAS = 4;
export const SUMMER_MAP_RANGE = 8;
/** The near meadow's own map: path and mown ring. */
export const SUMMER_MEADOW_BOUNDS = Object.freeze({
    minX: -52, maxX: 52, minZ: -18, maxZ: 34,
});

/** Where the things people made stand (x, z in metres; yaw in radians). */
export const SUMMER_PLACES = Object.freeze({
    // The maypole stands where, from the resting landscape camera, the sun is seen through
    // its right-hand wreath (tests/unit/summer-world.test.js holds the alignment).
    maypole: Object.freeze({
        x: -4.78, z: 2.14, yaw: 0.42, ring: 3.3,
    }),
    jetty: Object.freeze({ x: 7.9, z: -7.7, yaw: THREE.MathUtils.degToRad(-14) }),
    boat: Object.freeze({ x: 7, z: -13.6, yaw: THREE.MathUtils.degToRad(24) }),
    cottage: Object.freeze({ x: 22.9, z: -25.8, yaw: THREE.MathUtils.degToRad(-27.7) }),
    // The boathouse stands at the water on the tip of the promontory, clear of the cottage:
    // from the camera nothing of it may come in front of the house.
    shed: Object.freeze({ x: 12.2, z: -28, yaw: THREE.MathUtils.degToRad(-30) }),
    // The flagpole stands beside the house, between it and the boathouse, not before its door.
    flagpole: Object.freeze({ x: 15.2, z: -25.4 }),
});
/**
 * Ground people levelled to build on: the middle of each terrace, the radius that is flat,
 * how far it takes to meet the slope around it, its height above the lake, and how wide the
 * bank is where it meets the water. A building stands on its terrace, never on the slope.
 */
export const SUMMER_TERRACES = Object.freeze([
    Object.freeze({
        x: 22.9, z: -25.8, radius: 7.3, blend: 4.5, height: 1, bank: 1.3,
    }),
    Object.freeze({
        x: 12.2, z: -28, radius: 3.1, blend: 2, height: 0.55, bank: 0.6,
    }),
    // The dance ground: a low mound whose top is mown flat around the maypole.
    Object.freeze({
        x: -4.78, z: 2.14, radius: 3.3, blend: 5, height: 2.242, bank: 1,
    }),
]);
/** The crest of flowers the camera looks over: z of its ridge, its height and half-width. */
export const SUMMER_CREST = Object.freeze({ z: 12.1, height: 1.5, width: 1.55 });
/** The trodden path from the crest down to the jetty. */
const PATH = [[3.4, 13.5], [4.4, 8.2], [6.6, 1.6], [8.2, -4.4], [7.9, -8.4]];

const { clamp, smoothstep: ramp } = THREE.MathUtils;

/** Metres inland of a tapered capsule's edge (negative offshore). */
function capsule(x, z, ax, az, bx, bz, ra, rb) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    return ra + (rb - ra) * t - Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** z of the near bank's waterline. */
function nearWaterline(x) {
    return -9.5 + 1.7 * Math.sin(x * 0.07 + 0.4) + 0.7 * Math.sin(x * 0.19 + 2);
}

/** Signed metres inland for each piece of land (negative: out on the water). */
export function summerShores(x, z) {
    const wobble = 2.4 * Math.sin(x * 0.09 + z * 0.05) + 1.1 * Math.sin(x * 0.23 - z * 0.17);
    return {
        near: z - nearWaterline(x),
        headland: capsule(x, z, -250, -132, -54, -107, 46, 12) + wobble,
        // The promontory: its tip reaches out past the cottage to carry the boathouse.
        homestead: capsule(x, z, 96, -16, 18.5, -27.8, 22, 9.6) + wobble * 0.3,
        right: (x - (60 + 0.12 * z + 5 * Math.sin(z * 0.045 + 1))) * 0.9,
        far: -(z + 300 - 18 * Math.sin(x * 0.009 + 1) - 7 * Math.sin(x * 0.031)),
        island: capsule(x, z, 33, -134, 46, -139, 8, 6) + wobble * 0.4,
        skerry: capsule(x, z, -19, -64, -15, -62.5, 2.6, 2),
    };
}

/** Metres inland of the nearest shore (negative: out on the water). */
export function summerShoreDistance(x, z) {
    const s = summerShores(x, z);
    return Math.max(s.near, s.headland, s.homestead, s.right, s.far, s.island, s.skerry);
}

/** Metres from the middle of the trodden path. */
export function summerPathDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i < PATH.length - 1; i += 1) {
        const [ax, az] = PATH[i];
        const [bx, bz] = PATH[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    // The path meanders a little.
    return best + 0.12 * Math.sin(z * 0.9 + x * 0.4);
}

/** Metres from the foot of the maypole. */
export function summerMaypoleDistance(x, z) {
    return Math.hypot(x - SUMMER_PLACES.maypole.x, z - SUMMER_PLACES.maypole.z);
}

/** Height of the ground; the lake bed where it is below zero. */
export function summerGroundHeight(x, z) {
    const s = summerShores(x, z);
    const inland = Math.max(s.near, s.headland, s.homestead, s.right, s.far, s.island, s.skerry);
    if (inland < 0) return -3.2 * (1 - Math.exp(inland * 0.12));
    const meadow = ramp(s.near, 2, 9);
    const swales = (Math.sin(x * 0.11 + z * 0.07) * 0.2 + Math.sin(x * 0.23 - z * 0.19) * 0.1
        + Math.sin(x * 0.47 + z * 0.61) * 0.035) * meadow;
    const crest = SUMMER_CREST.height * Math.exp(-(((z - SUMMER_CREST.z) / SUMMER_CREST.width) ** 2))
        * ramp(s.near, 3, 8);
    // A low lip at the water's edge, then the land its piece of shore belongs to.
    let height = 0.22 * (1 - Math.exp(-inland * 1.4)) + 0.012 * Math.min(inland, 60)
        + 1.3 * ramp(s.near, 0.6, 21) + swales + crest
        + 6 * ramp(Math.abs(x), 40, 120) * ramp(s.near, 4, 30) + 3 * ramp(z, 24, 44) * meadow
        + 3.5 * ramp(s.headland, 3, 18) + 11 * ramp(s.headland, 20, 70)
        + 1.6 * ramp(s.homestead, 1.2, 7) + 6 * ramp(x, 46, 110) * ramp(s.homestead, 2, 12)
        + 16 * ramp(s.right, 8, 90)
        + 46 * ramp(s.far, 20, 210) * (0.7 + 0.3 * Math.sin(x * 0.008 + 2))
        + 1.9 * ramp(s.island, 1, 5)
        + 0.55 * ramp(s.skerry, 0.2, 1.4);
    for (let i = 0; i < SUMMER_TERRACES.length; i += 1) {
        const terrace = SUMMER_TERRACES[i];
        const distance = Math.hypot(x - terrace.x, z - terrace.z);
        if (distance < terrace.radius + terrace.blend) {
            const level = 1 - ramp(distance, terrace.radius, terrace.radius + terrace.blend);
            // The waterline stays where it is: the terrace meets the lake in a short bank.
            height += (terrace.height - height) * level * ramp(inland, 0, terrace.bank);
        }
    }
    return height;
}

/** Grid lines that are close together around the camera and widen with distance. */
function gridLines(min, max, denseMin, denseMax, denseStep, growth) {
    const lines = [];
    for (let value = denseMin; value <= denseMax + 1e-6; value += denseStep) lines.push(value);
    let step = denseStep;
    for (let value = denseMax; value < max;) {
        step *= growth;
        value = Math.min(max, value + step);
        lines.push(value);
    }
    step = denseStep;
    for (let value = denseMin; value > min;) {
        step *= growth;
        value = Math.max(min, value - step);
        lines.unshift(value);
    }
    return lines;
}

const MAP_WIDTH = 512;
const MAP_HEIGHT = 384;
const MEADOW_MAP_WIDTH = 512;
const MEADOW_MAP_HEIGHT = 256;

/** R = ground height (biased), G = metres from the shore out on the water / 40. */
function createLakeMap() {
    const data = new Uint8Array(MAP_WIDTH * MAP_HEIGHT * 4);
    const {
        minX, maxX, minZ, maxZ,
    } = SUMMER_BOUNDS;
    for (let row = 0; row < MAP_HEIGHT; row += 1) {
        for (let column = 0; column < MAP_WIDTH; column += 1) {
            const x = minX + ((maxX - minX) * column) / (MAP_WIDTH - 1);
            const z = minZ + ((maxZ - minZ) * row) / (MAP_HEIGHT - 1);
            const height = summerGroundHeight(x, z);
            const offshore = -summerShoreDistance(x, z);
            const offset = (row * MAP_WIDTH + column) * 4;
            data[offset] = Math.round(clamp((height + SUMMER_MAP_BIAS) / SUMMER_MAP_RANGE, 0, 1) * 255);
            data[offset + 1] = Math.round(clamp(offshore / 40, 0, 1) * 255);
            data[offset + 3] = 255;
        }
    }
    const map = new THREE.DataTexture(data, MAP_WIDTH, MAP_HEIGHT, THREE.RGBAFormat);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'SummerLakeMap';
    map.needsUpdate = true;
    return map;
}

/** R = trodden path, G = the mown ring around the maypole, B = the crest of tall flowers. */
function createMeadowMap() {
    const data = new Uint8Array(MEADOW_MAP_WIDTH * MEADOW_MAP_HEIGHT * 4);
    const {
        minX, maxX, minZ, maxZ,
    } = SUMMER_MEADOW_BOUNDS;
    for (let row = 0; row < MEADOW_MAP_HEIGHT; row += 1) {
        for (let column = 0; column < MEADOW_MAP_WIDTH; column += 1) {
            const x = minX + ((maxX - minX) * column) / (MEADOW_MAP_WIDTH - 1);
            const z = minZ + ((maxZ - minZ) * row) / (MEADOW_MAP_HEIGHT - 1);
            const offset = (row * MEADOW_MAP_WIDTH + column) * 4;
            data[offset] = Math.round((1 - ramp(summerPathDistance(x, z), 0.16, 0.62)) * 255);
            data[offset + 1] = Math.round((1 - ramp(
                summerMaypoleDistance(x, z),
                SUMMER_PLACES.maypole.ring - 0.7,
                SUMMER_PLACES.maypole.ring + 0.5,
            )) * 255);
            data[offset + 2] = Math.round(Math.exp(-(((z - SUMMER_CREST.z) / SUMMER_CREST.width) ** 2)) * 255);
            data[offset + 3] = 255;
        }
    }
    const map = new THREE.DataTexture(data, MEADOW_MAP_WIDTH, MEADOW_MAP_HEIGHT, THREE.RGBAFormat);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'SummerMeadowMap';
    map.needsUpdate = true;
    return map;
}

/** Lake-map coordinate for a world position (TSL). */
export function summerLakeMapCoordinate(world = positionWorld) {
    const {
        minX, maxX, minZ, maxZ,
    } = SUMMER_BOUNDS;
    return vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ));
}

/** Meadow-map coordinate for a world position (TSL). */
export function summerMeadowMapCoordinate(world = positionWorld) {
    const {
        minX, maxX, minZ, maxZ,
    } = SUMMER_MEADOW_BOUNDS;
    return vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ)).clamp(0, 1);
}

export class SummerTerrain {
    constructor({ light }) {
        this.light = light;
        this.group = new THREE.Group();
        this.group.name = 'SummerLand';
        this.owned = [];
    }

    height(x, z) {
        return summerGroundHeight(x, z);
    }

    build() {
        const {
            minX, maxX, minZ, maxZ,
        } = SUMMER_BOUNDS;
        const xs = gridLines(minX, maxX, -42, 42, 0.5, 1.1);
        const zs = gridLines(minZ, maxZ, -34, 22, 0.5, 1.1);
        const positions = new Float32Array(xs.length * zs.length * 3);
        for (let row = 0; row < zs.length; row += 1) {
            for (let column = 0; column < xs.length; column += 1) {
                positions.set(
                    [xs[column], summerGroundHeight(xs[column], zs[row]), zs[row]],
                    (row * xs.length + column) * 3,
                );
            }
        }
        const indices = [];
        for (let row = 0; row < zs.length - 1; row += 1) {
            for (let column = 0; column < xs.length - 1; column += 1) {
                const a = row * xs.length + column;
                const b = a + 1;
                const c = a + xs.length;
                indices.push(a, c, b, b, c, c + 1);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        this.lakeMap = createLakeMap();
        this.meadowMap = createMeadowMap();
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'SummerGround';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        this.group.add(mesh);
        this.owned.push(geometry, material, this.lakeMap, this.meadowMap);
        this.mesh = mesh;
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'SummerGroundMaterial';
        const world = positionWorld;
        const coarse = light.noise(world.xz.mul(0.017));
        const fine = light.noise(world.xz.mul(0.29));
        const fleck = light.noise(world.xz.mul(1.9).add(fine.rg.mul(0.4)));
        const meadow = texture(this.meadowMap, summerMeadowMapCoordinate(world));
        // Turf: deep clover green in the hollows, fresh June grass, straw where it has dried.
        const turf = mix(color(0x14330c), color(0x3a6a19), fine.g.mul(0.55).add(coarse.b.mul(0.45)));
        const dried = mix(turf, color(0x5f7a2a), smoothstep(0.56, 0.82, coarse.r.mul(0.7).add(fine.a.mul(0.3))));
        // The path: pale flattened grass at its edges, bare earth where feet fall.
        const worn = smoothstep(0.5, 0.95, meadow.r.mul(fleck.b.mul(0.5).add(0.75)));
        const trodden = mix(color(0x5f7030), color(0x6a5334), worn);
        const mown = mix(color(0x4f8a22), color(0x7da432), fine.b);
        let albedo = mix(dried, trodden, smoothstep(0.1, 0.7, meadow.r));
        albedo = mix(albedo, mown, meadow.g.mul(0.85));
        // Far meadows carry their flowers as flecks: the modelled ones stop a way out.
        const range = length(cameraPosition.sub(world));
        const bloomMask = smoothstep(0.83, 0.9, fleck.r).mul(smoothstep(16, 38, range))
            .mul(smoothstep(0.0, 0.5, world.y)).mul(meadow.r.oneMinus());
        const petalTint = mix(
            mix(color(0xfbf6e2), color(0xffd43b), smoothstep(0.3, 0.36, fleck.g)),
            mix(color(0x8a6fe0), color(0xe4472f), smoothstep(0.76, 0.8, fleck.g)),
            smoothstep(0.56, 0.6, fleck.g),
        );
        albedo = mix(albedo, petalTint, bloomMask.mul(0.85));
        // Beyond the water the land is woods: moss and needle litter under the trees.
        const wooded = smoothstep(46, 96, range);
        albedo = mix(albedo, mix(color(0x0f2409), color(0x2c4a16), fine.b), wooded.mul(0.9));
        const smooth = normalize(normalWorld);
        // Granite shows through where the ground steepens; the far hills are forest floor.
        const granite = mix(color(0x55504a), color(0x9a9186), fine.a).mul(fleck.b.mul(0.4).add(0.75));
        const bare = smoothstep(0.62, 0.8, smooth.y.oneMinus().mul(2.2).add(coarse.g.mul(0.35)));
        albedo = mix(albedo, granite, bare);
        // The waterline: dark wet sand that dries into pale sand a hand above the lake.
        const shoreline = float(1).sub(smoothstep(0.04, 0.34, world.y));
        const dryness = fleck.a.mul(0.35).add(smoothstep(-0.02, 0.26, world.y).mul(0.65));
        const sand = mix(color(0x3a2f1e), color(0xc9b584), dryness);
        albedo = mix(albedo, sand, shoreline);

        const normal = normalize(smooth.add(vec3(fine.r.sub(0.5), 0, fine.g.sub(0.5)).mul(0.45)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        // Grass is a deep pile, not a floor: it catches a raking sun far better than a
        // flat plane would, and glows when the sun is behind it.
        const facing = saturate(dot(normal, light.uSunDir)).mul(0.9).add(0.14);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3).mul(shoreline.oneMinus());
        const wet = float(1).sub(smoothstep(0.0, 0.2, world.y));
        const glint = pow(saturate(dot(reflect(view.negate(), normal), light.uSunDir)), 30).mul(wet.mul(1.5));
        const lit = albedo.mul(light.uSunColor).mul(facing).mul(sun)
            .add(albedo.mul(vec3(1.3, 1.2, 0.35)).mul(light.uSunColor).mul(through.mul(0.2)).mul(sun))
            .add(light.uSunColor.mul(glint).mul(sun).mul(0.12))
            .add(albedo.mul(light.ambient(normal)).mul(0.95));
        // fragmentNode, not colorNode: the ground casts into the shadow map it reads.
        material.fragmentNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}

/**
 * Verdant Hills — the land.
 *
 * The lens stands on the crown of a hill of the downs. Straight ahead the hill falls
 * steeply away, so past a brow of deep grass the eye drops into a wide valley — a river, a
 * tarn, a patchwork of pastures and hedgerows — and climbs the far side from ridge to ridge
 * into the haze. Two spurs leave the crown more gently: one down to the left, where the old
 * oak stands, and one down to the right, which carries the drystone wall and the gate, and
 * beyond whose foot a second hill carries the windmill.
 *
 * Everything is one analytic height function, so the mesh, the trees, the grass, the props
 * and the effects all stand on the same ground. The valley's patchwork is baked once into a
 * small map: R = hedgerow above its middle and water below it, G = a pasture's tone, B = the
 * shade of trees and hedges too far away for the shadow map.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, dot, float, length, mix, normalWorld, normalize, positionWorld, pow, reflect, saturate,
    sin, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import { VERDANT_HILLS_SUN_DIRECTION } from './verdant-hills-light.js';

const { smoothstep: ramp, clamp, degToRad } = THREE.MathUtils;

/** Height of the home hill's crown and of the still water in the valley. */
export const VERDANT_HILLS_CROWN = 62;
export const VERDANT_HILLS_WATER_LEVEL = 5;
/** Half-angle of the wedge of land the lens can ever see, either side of -Z. */
export const VERDANT_HILLS_WEDGE_DEGREES = 66;
const RANGE_NEAR = 1.2;
const RANGE_FAR = 13000;
const RING_GROWTH = 1.042;
const WEDGE_SEGMENTS = 264;

/** The valley's patchwork map: its bounds in metres and its size in texels. */
export const VERDANT_HILLS_MAP_BOUNDS = Object.freeze({
    minX: -1500, maxX: 1500, minZ: -2900, maxZ: 100,
});
const FALLBACK_MAP_SIZE = 384;
/** Version of the baked map's encoding; the loader refuses a file written for another. */
export const VERDANT_HILLS_LAND_SCHEMA = 1;
const FIELD_SIZE = 215;

/**
 * Where things stand. Bearings are measured from -Z, positive to the right. `mill` is the
 * crown of the windmill's hill; `tarn` the lake in the valley (centre, half-axes).
 */
export const VERDANT_HILLS_PLACES = Object.freeze({
    eye: Object.freeze({ x: 0, z: 0 }),
    oak: Object.freeze({ x: -8.6, z: -11.8, radius: 1.7 }),
    mill: Object.freeze({
        x: 118, z: -222, top: 53, radius: 8,
    }),
    gate: Object.freeze({ x: 21.5, z: -27.5, radius: 2.6 }),
    bench: Object.freeze({ x: -4.4, z: -7.1, radius: 1 }),
    tarn: Object.freeze({
        x: -300, z: -610, a: 150, b: 74,
    }),
});

/** The two gentle spurs of the home hill: bearing, angular width, how much they ease the slope. */
const SPURS = [
    { bearing: degToRad(36), width: degToRad(15), ease: 0.215 },
    { bearing: degToRad(-34), width: degToRad(19), ease: 0.165 },
];
const STEEP = 0.335;

function hash2(ix, iz, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 (quintic, so slopes are continuous too). */
export function verdantHillsNoise(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const top = hash2(x0, z0, seed) * (1 - sx) + hash2(x0 + 1, z0, seed) * sx;
    const bottom = hash2(x0, z0 + 1, seed) * (1 - sx) + hash2(x0 + 1, z0 + 1, seed) * sx;
    return top * (1 - sz) + bottom * sz;
}

/** The river's course: z of its middle at a given x. */
export function verdantHillsRiverZ(x) {
    return -540 + 95 * Math.sin(x / 330 + 0.6) + 38 * Math.sin(x / 140 + 2.1);
}

/** Distance in metres to the water's edge: negative on the river or the tarn. */
export function verdantHillsWaterDistance(x, z) {
    const slope = (95 / 330) * Math.cos(x / 330 + 0.6) + (38 / 140) * Math.cos(x / 140 + 2.1);
    const river = Math.abs(z - verdantHillsRiverZ(x)) / Math.sqrt(1 + slope * slope) - 13;
    const { tarn } = VERDANT_HILLS_PLACES;
    const dx = (x - tarn.x) / tarn.a;
    const dz = (z - tarn.z) / tarn.b;
    const lake = (Math.sqrt(dx * dx + dz * dz) - 1) * Math.min(tarn.a, tarn.b);
    return Math.min(river, lake);
}

/** The downs beyond the home hill, before anything is levelled or dug. */
function wild(x, z) {
    const range = Math.hypot(x, z);
    let h = 30
        + 84 * (verdantHillsNoise(x / 1150, z / 1150, 11) - 0.5)
        + 42 * (verdantHillsNoise(x / 430, z / 430, 12) - 0.5)
        + 13 * (verdantHillsNoise(x / 160, z / 160, 13) - 0.5)
        + 2.8 * (verdantHillsNoise(x / 52, z / 52, 14) - 0.5);
    // The far ridges stand higher the further away they are, so they stack up the frame.
    h += ramp(range, 900, 7500) * (60 + 190 * verdantHillsNoise(x / 3400, z / 3400, 15));
    // The valley: its floor is nearly level along the river.
    const across = (z - verdantHillsRiverZ(x)) / 260;
    const floor = Math.exp(-across * across) * 0.9;
    h += (VERDANT_HILLS_WATER_LEVEL + 1.5 + (h - VERDANT_HILLS_WATER_LEVEL) * 0.22 - h) * floor;
    return h;
}

/** The home hill's own surface at a point, and how far the downs have taken over from it there. */
const HOME = { height: 0, blend: 0 };
function homeHill(x, z) {
    const range = Math.hypot(x, z);
    const bearing = Math.atan2(x, -z);
    let steep = STEEP;
    let spurred = 0;
    for (const spur of SPURS) {
        const turn = (bearing - spur.bearing) / spur.width;
        const on = Math.exp(-turn * turn);
        steep -= spur.ease * on;
        spurred += on;
    }
    const out = Math.max(0, range - 2.5);
    // A spur levels out as it runs, so its back stays in sight from the crown. The steep faces
    // between the spurs would fall below the valley before the downs take over from them, so
    // the hill bottoms out just above the still water.
    HOME.height = softFloor(
        VERDANT_HILLS_CROWN - steep * ((out * out) / (out + 14)) * (1 - 0.52 * spurred * ramp(range, 16, 95)),
        VERDANT_HILLS_WATER_LEVEL + 0.4,
    );
    // The spurs reach further into the downs than the steep faces between them.
    HOME.blend = ramp(range, 55 + 70 * spurred, 240 + 90 * spurred);
    return HOME;
}

/** A height that never goes under a floor, and is left exactly as it was well above it. */
function softFloor(height, floor, ease = 1.2) {
    const over = (height - floor) / ease;
    return over > 30 ? height : floor + ease * Math.log1p(Math.exp(over));
}

/** The larger of two heights, without the crease a plain maximum leaves. */
function softMax(a, b, ease = 1.2) {
    return 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + ease * ease));
}

/**
 * How much the downs are raised under the windmill so that its hill tops out at the height
 * its place names: the home hill still has a say there, so the lift allows for it.
 */
const MILL_LIFT = (() => {
    const { mill } = VERDANT_HILLS_PLACES;
    const { height, blend } = homeHill(mill.x, mill.z);
    return (mill.top - height) / blend + height - wild(mill.x, mill.z);
})();

/** The land before terraces: the home hill blended into the downs, the mill's hill, the water. */
function raw(x, z) {
    const { mill } = VERDANT_HILLS_PLACES;
    const toMill = Math.hypot(x - mill.x, z - mill.z);
    // No hollow of the downs lies lower than the still water of the valley.
    let downs = softMax(
        wild(x, z) + MILL_LIFT * Math.exp(-(toMill * toMill) / (2 * 78 * 78)),
        VERDANT_HILLS_WATER_LEVEL + 0.4,
    );
    // Still water lies level: the bed dips under it, the banks come down to it.
    const shore = verdantHillsWaterDistance(x, z);
    if (shore < 40) {
        const bank = ramp(shore, -6, 40);
        const level = VERDANT_HILLS_WATER_LEVEL - 1.2 * (1 - ramp(shore, -10, 2));
        downs = level + (downs - level) * bank;
    }
    const { height, blend } = homeHill(x, z);
    return height + (downs - height) * blend;
}

/** Level ground under what stands on the land: centre, flat radius, blend distance. */
export const VERDANT_HILLS_TERRACES = Object.freeze([
    { ...VERDANT_HILLS_PLACES.oak, blend: 1.8 },
    { ...VERDANT_HILLS_PLACES.mill, blend: 9 },
    { ...VERDANT_HILLS_PLACES.gate, blend: 3 },
    { ...VERDANT_HILLS_PLACES.bench, blend: 1.2 },
].map((terrace) => Object.freeze({ ...terrace, level: raw(terrace.x, terrace.z) })));

/** Height of the ground at a point, in metres. */
export function verdantHillsGroundHeight(x, z) {
    let h = raw(x, z);
    for (const terrace of VERDANT_HILLS_TERRACES) {
        const away = Math.hypot(x - terrace.x, z - terrace.z);
        if (away < terrace.radius + terrace.blend) {
            h = terrace.level + (h - terrace.level) * ramp(away, terrace.radius, terrace.radius + terrace.blend);
        }
    }
    return h;
}

/** Upward unit normal of the ground at a point. */
export function verdantHillsGroundNormal(x, z, target = new THREE.Vector3(), reach = 0.5) {
    const dx = verdantHillsGroundHeight(x + reach, z) - verdantHillsGroundHeight(x - reach, z);
    const dz = verdantHillsGroundHeight(x, z + reach) - verdantHillsGroundHeight(x, z - reach);
    return target.set(-dx, 2 * reach, -dz).normalize();
}

// -- the patchwork ----------------------------------------------------------------------
/** Pastures: the two nearest field seeds of a point, in a coordinate bent to follow the land. */
function fieldCell(x, z) {
    const wx = x + 110 * (verdantHillsNoise(x / 520, z / 520, 31) - 0.5);
    const wz = z + 110 * (verdantHillsNoise(x / 520, z / 520, 32) - 0.5);
    const cx = Math.floor(wx / FIELD_SIZE);
    const cz = Math.floor(wz / FIELD_SIZE);
    let first = Infinity;
    let second = Infinity;
    let id = 0;
    let other = 0;
    for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const ix = cx + dx;
            const iz = cz + dz;
            const sx = (ix + 0.18 + 0.64 * hash2(ix, iz, 41)) * FIELD_SIZE;
            const sz = (iz + 0.18 + 0.64 * hash2(ix, iz, 42)) * FIELD_SIZE;
            const d = Math.hypot(wx - sx, wz - sz);
            const key = ix * 7919 + iz * 104729;
            if (d < first) {
                second = first;
                other = id;
                first = d;
                id = key;
            } else if (d < second) {
                second = d;
                other = key;
            }
        }
    }
    return {
        edge: (second - first) * 0.5, id, other,
    };
}

/** What stands at a spot of the valley: hedge 0..1, the pasture's tone 0..1, water 0..1. */
export function verdantHillsFieldAt(x, z) {
    const range = Math.hypot(x, z);
    const cell = fieldCell(x, z);
    const shore = verdantHillsWaterDistance(x, z);
    const water = 1 - ramp(shore, -2.5, 2.5);
    // Two fields in three are parted by a hedge; the rest run into each other.
    const hedged = hash2(Math.min(cell.id, cell.other), Math.max(cell.id, cell.other), 43) < 0.68 ? 1 : 0;
    // The home hill and the windmill's crown are open down, and no hedge stands in water.
    const { mill } = VERDANT_HILLS_PLACES;
    const open = ramp(range, 150, 260) * ramp(Math.hypot(x - mill.x, z - mill.z), 26, 60) * ramp(shore, 4, 14)
        * (1 - ramp(range, 5200, 7000));
    return {
        hedge: (1 - ramp(cell.edge, 2.4, 5.6)) * hedged * open,
        edge: cell.edge,
        tone: hash2(cell.id, 17, 44),
        water,
        open,
    };
}

/**
 * The patchwork as RGBA bytes, `size` texels square: R hedge (above 0.5) and water (below
 * it), G tone, B shade, A opaque.
 * `trees` ({ x, z, height, spread }) lay their shadows into B. The baked map the theme
 * ships is this function at a larger size (scripts/verdant-hills/bake-land.mjs).
 */
export function createVerdantHillsLandData(size, trees = []) {
    const MAP_SIZE = size;
    const data = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
    const {
        minX, maxX, minZ, maxZ,
    } = VERDANT_HILLS_MAP_BOUNDS;
    const stepX = (maxX - minX) / (MAP_SIZE - 1);
    const stepZ = (maxZ - minZ) / (MAP_SIZE - 1);
    const shade = new Float32Array(MAP_SIZE * MAP_SIZE);
    for (let row = 0; row < MAP_SIZE; row += 1) {
        for (let column = 0; column < MAP_SIZE; column += 1) {
            const field = verdantHillsFieldAt(minX + column * stepX, minZ + row * stepZ);
            const offset = (row * MAP_SIZE + column) * 4;
            // Hedge and water share a channel about its middle, so alpha stays opaque and no
            // decoder can premultiply the data away.
            data[offset] = Math.round((0.5 + field.hedge * 0.5 - field.water * 0.5) * 255);
            data[offset + 1] = Math.round(field.tone * 255);
            data[offset + 3] = 255;
            // A hedge shades the strip beside it, away from the sun.
            shade[row * MAP_SIZE + column] = field.hedge * 0.5;
        }
    }
    // Each tree lays a soft shadow on the ground, drawn out away from the sun.
    const flat = Math.hypot(VERDANT_HILLS_SUN_DIRECTION.x, VERDANT_HILLS_SUN_DIRECTION.z);
    const sunX = VERDANT_HILLS_SUN_DIRECTION.x / flat;
    const sunZ = VERDANT_HILLS_SUN_DIRECTION.z / flat;
    const stretch = Math.hypot(VERDANT_HILLS_SUN_DIRECTION.x, VERDANT_HILLS_SUN_DIRECTION.z)
        / VERDANT_HILLS_SUN_DIRECTION.y;
    for (const tree of trees) {
        const reach = tree.height * 0.6 * stretch;
        const cx = tree.x - sunX * reach;
        const cz = tree.z - sunZ * reach;
        const along = tree.spread * 0.5 + tree.height * 0.32 * stretch;
        const across = tree.spread * 0.56;
        const pad = Math.ceil((along + 6) / Math.min(stepX, stepZ));
        const column0 = Math.round((cx - minX) / stepX);
        const row0 = Math.round((cz - minZ) / stepZ);
        for (let row = row0 - pad; row <= row0 + pad; row += 1) {
            for (let column = column0 - pad; column <= column0 + pad; column += 1) {
                if (row >= 0 && row < MAP_SIZE && column >= 0 && column < MAP_SIZE) {
                    const dx = minX + column * stepX - cx;
                    const dz = minZ + row * stepZ - cz;
                    const u = (dx * sunX + dz * sunZ) / along;
                    const v = (dx * sunZ - dz * sunX) / across;
                    const blob = 1 - ramp(Math.sqrt(u * u + v * v), 0.55, 1.25);
                    const index = row * MAP_SIZE + column;
                    shade[index] = Math.max(shade[index], blob * 0.9);
                }
            }
        }
    }
    for (let i = 0; i < shade.length; i += 1) data[i * 4 + 2] = Math.round(clamp(shade[i], 0, 1) * 255);
    return data;
}

/** A coarse patchwork made on the spot, for when the baked map is not at hand. */
function createLandMap(trees) {
    const map = new THREE.DataTexture(
        createVerdantHillsLandData(FALLBACK_MAP_SIZE, trees),
        FALLBACK_MAP_SIZE,
        FALLBACK_MAP_SIZE,
        THREE.RGBAFormat,
    );
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'VerdantHillsLandMap';
    map.needsUpdate = true;
    return map;
}

/** Land-map coordinate for a world position (TSL). */
export function verdantHillsMapCoordinate(world = positionWorld) {
    const {
        minX, maxX, minZ, maxZ,
    } = VERDANT_HILLS_MAP_BOUNDS;
    return vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ));
}

/** The path worn from the crown down the right-hand spur to the gate: points along it. */
export const VERDANT_HILLS_PATH = Object.freeze([
    [4.4, 1.5], [6.6, -7.5], [12, -16.5], [VERDANT_HILLS_PLACES.gate.x, VERDANT_HILLS_PLACES.gate.z],
    [34, -42], [52, -66], [70, -96],
]);

/** Distance in metres from a point to the path. */
export function verdantHillsPathDistance(x, z) {
    let nearest = Infinity;
    for (let i = 0; i < VERDANT_HILLS_PATH.length - 1; i += 1) {
        const [ax, az] = VERDANT_HILLS_PATH[i];
        const [bx, bz] = VERDANT_HILLS_PATH[i + 1];
        const ux = bx - ax;
        const uz = bz - az;
        const t = clamp(((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz), 0, 1);
        nearest = Math.min(nearest, Math.hypot(x - ax - ux * t, z - az - uz * t));
    }
    return nearest;
}

export class VerdantHillsTerrain {
    /** `landMap` is the baked patchwork; without it a coarse one is made from `trees`. */
    constructor({ light, trees = [], landMap = null }) {
        this.light = light;
        this.trees = trees;
        this.bakedMap = landMap;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsLand';
        this.owned = [];
    }

    height(x, z) {
        return verdantHillsGroundHeight(x, z);
    }

    build() {
        const rings = [];
        for (let range = RANGE_NEAR; range < RANGE_FAR; range *= RING_GROWTH) rings.push(range);
        rings.push(RANGE_FAR);
        const wedge = degToRad(VERDANT_HILLS_WEDGE_DEGREES);
        const columns = WEDGE_SEGMENTS + 1;
        const positions = new Float32Array(rings.length * columns * 3);
        for (let ring = 0; ring < rings.length; ring += 1) {
            const range = rings[ring];
            for (let column = 0; column < columns; column += 1) {
                const bearing = -wedge + (2 * wedge * column) / WEDGE_SEGMENTS;
                const x = Math.sin(bearing) * range;
                const z = -Math.cos(bearing) * range;
                const offset = (ring * columns + column) * 3;
                positions[offset] = x;
                positions[offset + 1] = verdantHillsGroundHeight(x, z);
                positions[offset + 2] = z;
            }
        }
        const indices = new Uint32Array((rings.length - 1) * WEDGE_SEGMENTS * 6);
        let cursor = 0;
        for (let ring = 0; ring < rings.length - 1; ring += 1) {
            for (let column = 0; column < WEDGE_SEGMENTS; column += 1) {
                const a = ring * columns + column;
                const b = a + 1;
                const c = a + columns;
                // Counter-clockwise seen from above: +Y faces the sky.
                indices.set([a, b, c, b, c + 1, c], cursor);
                cursor += 6;
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        // The mesh's own grain is as fine as anything the lens can resolve at each range.
        geometry.computeVertexNormals();
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -RANGE_FAR / 2), RANGE_FAR);
        this.landMap = this.bakedMap || createLandMap(this.trees);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsGround';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        // The land receives the oak's shade but casts none: nothing on it is in a hill's shadow.
        mesh.castShadow = false;
        this.group.add(mesh);
        this.owned.push(geometry, material);
        // A baked map belongs to the asset pack, which outlives a rebuild.
        if (!this.bakedMap) this.owned.push(this.landMap);
        this.mesh = mesh;
        this.triangles = indices.length / 3;
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'VerdantHillsGroundMaterial';
        const world = positionWorld;
        const range = length(cameraPosition.sub(world));
        const broad = light.noise(world.xz.mul(0.0019));
        const coarse = light.noise(world.xz.mul(0.017));
        const fine = light.noise(world.xz.mul(0.23));
        const fleck = light.noise(world.xz.mul(1.9).add(fine.rg.mul(0.4)));
        const at = verdantHillsMapCoordinate(world);
        // Past the map's rim the far hills carry no patchwork.
        const rim = smoothstep(0.0, 0.03, at.x).mul(smoothstep(0.0, 0.03, at.x.oneMinus()))
            .mul(smoothstep(0.0, 0.03, at.y)).mul(smoothstep(0.0, 0.03, at.y.oneMinus()));
        const land = texture(this.landMap, at.clamp(0, 1));
        const hedge = saturate(land.r.sub(0.502).mul(2.02)).mul(rim);
        const tone = mix(float(0.5), land.g, rim);
        const shade = land.b.mul(rim);
        const water = saturate(float(0.498).sub(land.r).mul(2.02)).mul(rim);

        // Turf: deep green in the hollows, the fresh green of June on the slopes, and the
        // paler green of grass the wind has dried on the crests.
        const depth = coarse.g.mul(0.5).add(fine.b.mul(0.2)).add(broad.b.mul(0.3));
        const lush = mix(color(0x15400c), color(0x3d7a18), depth);
        const pale = mix(color(0x5c8a24), color(0x86a53a), fine.g);
        let albedo = mix(lush, pale, smoothstep(0.42, 0.82, broad.r.mul(0.55).add(coarse.a.mul(0.45))).mul(0.6));
        // Each pasture has its own green: grazed short, grown for hay, or gone to buttercups.
        const grazed = mix(color(0x2f6b17), color(0x4c8a20), coarse.b);
        const hay = mix(color(0x6b9230), color(0x9aa646), coarse.r);
        albedo = mix(albedo, grazed, smoothstep(0.0, 0.4, tone).oneMinus().mul(0.75).mul(rim));
        albedo = mix(albedo, hay, smoothstep(0.62, 1.0, tone).mul(0.8).mul(rim));
        // Far meadows carry their flowers as flecks: buttercup, daisy, clover.
        const drift = smoothstep(0.5, 0.75, coarse.r.mul(0.6).add(broad.g.mul(0.4)));
        const flowered = smoothstep(0.8, 0.88, fleck.r).mul(drift).mul(smoothstep(9, 30, range))
            .mul(smoothstep(900, 300, range));
        const petal = mix(
            mix(color(0xfff7dc), color(0xffd62e), smoothstep(0.34, 0.4, fleck.g)),
            color(0xe58ab8),
            smoothstep(0.8, 0.84, fleck.g),
        );
        albedo = mix(albedo, petal, flowered.mul(0.8));
        // The path down the spur: pale flattened grass, bare chalk where feet fall.
        let trodden = float(0);
        for (let i = 0; i < VERDANT_HILLS_PATH.length - 1; i += 1) {
            const a = vec2(...VERDANT_HILLS_PATH[i]);
            const b = vec2(...VERDANT_HILLS_PATH[i + 1]);
            const along = saturate(dot(world.xz.sub(a), b.sub(a)).div(dot(b.sub(a), b.sub(a))));
            const away = length(world.xz.sub(a).sub(b.sub(a).mul(along)));
            trodden = trodden.max(smoothstep(1.15, 0.4, away.add(fine.r.sub(0.5).mul(0.6))));
        }
        const bare = smoothstep(0.55, 0.95, trodden.mul(fleck.b.mul(0.6).add(0.7)));
        // A chalk path: grass grazed short along its edges, pale bare chalk down its middle.
        const worn = mix(color(0x6f9a3a), color(0xcfc7a2), bare);
        albedo = mix(albedo, worn, smoothstep(0.05, 0.7, trodden));
        // Hedgerows: hawthorn and bramble, darker than any grass.
        albedo = mix(albedo, mix(color(0x10300b), color(0x24501a), coarse.a), hedge);
        // Under the blades of the home hill the ground is the dark between them.
        albedo = albedo.mul(mix(float(0.56), float(1), smoothstep(14, 110, range).max(smoothstep(0.1, 0.6, trodden))));

        const smooth = normalize(normalWorld);
        const normal = normalize(smooth.add(vec3(fine.r.sub(0.5), 0, fine.g.sub(0.5))
            .mul(smoothstep(260, 20, range).mul(0.4).add(0.08))));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight().mul(shade.mul(0.78).oneMinus());
        // Grass is a deep pile, not a floor: it catches a raking sun far better than a flat
        // plane would, and glows when the sun is behind it.
        const facing = saturate(dot(normal, light.uSunDir)).mul(0.86).add(0.16);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.6);
        // The wind made visible: where a gust lays the grass over, it shows the sky on its
        // back. Near, the bands of the breeze; far, slow swells that take a hillside at a time.
        const near = light.windBand(world.xz).mul(smoothstep(900, 250, range));
        const windward = dot(world.xz, vec2(light.uWindDir.x, light.uWindDir.z));
        const swell = sin(windward.mul(0.0061).sub(light.uWindClock.mul(0.21)).add(broad.a.mul(7)))
            .mul(0.5).add(0.5).pow(3)
            .mul(smoothstep(300, 1100, range));
        const front = light.windFront(world.xz);
        const laid = saturate(near.mul(near).mul(light.uWind.mul(0.8).add(light.uShimmer.mul(0.5)).add(0.3))
            .add(swell.mul(0.5)).add(front.mul(0.7)));
        const sheen = mix(vec3(0.5, 0.62, 0.34), light.uSkyLight, 0.45).mul(laid).mul(0.2);
        const grass = albedo.mul(light.uSunColor).mul(facing).mul(sun).mul(0.3)
            .add(albedo.mul(vec3(1.25, 1.2, 0.4)).mul(light.uSunColor).mul(through.mul(0.1)).mul(sun))
            .add(sheen.mul(sun.mul(0.75).add(0.25)).mul(hedge.oneMinus()))
            .add(albedo.mul(light.ambient(normal)).mul(0.95));
        // Still water: the sky's own colour laid on the valley floor, and the sun's sparkle.
        const ripple = light.noise(world.xz.mul(0.045).add(vec2(light.uTime.mul(0.012), light.uTime.mul(0.007))));
        const waterNormal = normalize(vec3(ripple.r.sub(0.5).mul(0.16), 1, ripple.g.sub(0.5).mul(0.16)));
        const bounce = reflect(view.negate(), waterNormal);
        const mirror = light.sky(normalize(vec3(bounce.x, bounce.y.abs().add(0.02), bounce.z)));
        const sparkle = pow(saturate(dot(bounce, light.uSunDir)), 90).mul(light.cloudShadow(world));
        const pool = mirror.mul(0.82).add(color(0x0d2a2e).mul(0.25))
            .add(light.uSunColor.mul(sparkle).mul(0.6));
        const lit = mix(grass, pool, smoothstep(0.35, 0.65, water));
        material.colorNode = light.haze(lit, { world });
        return material;
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}

/**
 * Fall — the forest floor.
 *
 * A gently rising heightfield with a sunken path that winds from the player's feet toward
 * the low sun. The same analytic functions place trees, litter and falling leaves, so
 * nothing floats or sinks. The ground is shaded by the shared light rig: long trunk
 * shadows, sun-glint on damp leaves, and haze that swallows the distance.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, dot, float, mix, normalize, positionWorld, pow, reflect, saturate, smoothstep, texture,
    vec2, vec3,
} from 'three/tsl';

export const FALL_GROUND_BOUNDS = Object.freeze({
    minX: -110, maxX: 110, minZ: -150, maxZ: 30,
});

// The path as (x, z) waypoints, walked from behind the camera toward the sun.
const PATH_POINTS = [
    [3.2, 30], [1.6, 20], [-1.4, 11], [-5.2, 2], [-10.4, -9], [-14.6, -22], [-17.4, -36], [-22.5, -52],
    [-30.5, -70], [-40, -92], [-51, -118], [-62, -150],
];
const PATH_TABLE = 256;

function catmull(p0, p1, p2, p3, t) {
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** x of the path centre for every z, as a lookup table (the path never doubles back in z). */
function buildPathTable() {
    const table = new Float32Array(PATH_TABLE);
    const zs = PATH_POINTS.map((point) => point[1]);
    for (let i = 0; i < PATH_TABLE; i += 1) {
        const z = FALL_GROUND_BOUNDS.maxZ + (FALL_GROUND_BOUNDS.minZ - FALL_GROUND_BOUNDS.maxZ) * (i / (PATH_TABLE - 1));
        let segment = 0;
        while (segment < zs.length - 2 && z < zs[segment + 1]) segment += 1;
        const t = THREE.MathUtils.clamp((z - zs[segment]) / (zs[segment + 1] - zs[segment]), 0, 1);
        const at = (index) => PATH_POINTS[THREE.MathUtils.clamp(index, 0, PATH_POINTS.length - 1)][0];
        table[i] = catmull(at(segment - 1), at(segment), at(segment + 1), at(segment + 2), t);
    }
    return table;
}

const PATH_X = buildPathTable();

export function fallPathX(z) {
    const span = FALL_GROUND_BOUNDS.minZ - FALL_GROUND_BOUNDS.maxZ;
    const position = THREE.MathUtils.clamp((z - FALL_GROUND_BOUNDS.maxZ) / span, 0, 1) * (PATH_TABLE - 1);
    const index = Math.min(PATH_TABLE - 2, Math.floor(position));
    const t = position - index;
    return PATH_X[index] * (1 - t) + PATH_X[index + 1] * t;
}

/** Horizontal distance from the path centre line (metres). */
export function fallPathDistance(x, z) {
    return Math.abs(x - fallPathX(z)) * 0.92;
}

/** Height of the forest floor. */
export function fallTerrainHeight(x, z) {
    const away = Math.max(0, -z - 16);
    const rise = 0.02 * away ** 1.16;
    const swell = Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.037 - 0.4) * 0.85
        + Math.sin(x * 0.105 + z * 0.068) * 0.26 + Math.cos(x * 0.19 - z * 0.13 + 2) * 0.12;
    const path = fallPathDistance(x, z);
    const bank = THREE.MathUtils.smoothstep(path, 2.5, 13);
    const hollow = -0.32 * Math.exp(-((path / 2.7) ** 2));
    return rise + swell * (0.25 + 0.75 * bank) + hollow;
}

const MAP_SIZE = 256;

/** R = trodden path, G = damp moss, B = broad tonal drift, A = sunlit clearing. */
function createGroundMap(rng) {
    const data = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
    const cells = 12;
    const lattice = new Float32Array(cells * cells * 2);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
    const noise = (u, v, channel) => {
        const fx = u * (cells - 1);
        const fy = v * (cells - 1);
        const x0 = Math.min(cells - 2, Math.floor(fx));
        const y0 = Math.min(cells - 2, Math.floor(fy));
        const tx = fx - x0;
        const ty = fy - y0;
        const at = (x, y) => lattice[(y * cells + x) * 2 + channel];
        return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty)
            + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
    const {
        minX, maxX, minZ, maxZ,
    } = FALL_GROUND_BOUNDS;
    for (let row = 0; row < MAP_SIZE; row += 1) {
        for (let column = 0; column < MAP_SIZE; column += 1) {
            const u = column / (MAP_SIZE - 1);
            const v = row / (MAP_SIZE - 1);
            const x = minX + (maxX - minX) * u;
            const z = minZ + (maxZ - minZ) * v;
            const path = fallPathDistance(x, z);
            const drift = noise(u, v, 0);
            const damp = noise(v, u, 1);
            const trodden = Math.exp(-((path / (1.9 + drift * 1.2)) ** 2));
            const moss = THREE.MathUtils.smoothstep(damp, 0.52, 0.86) * (1 - trodden);
            const clearing = Math.exp(-((path / 9) ** 2)) * THREE.MathUtils.smoothstep(z, -90, -6);
            const offset = (row * MAP_SIZE + column) * 4;
            data[offset] = Math.round(trodden * 255);
            data[offset + 1] = Math.round(moss * 255);
            data[offset + 2] = Math.round(drift * 255);
            data[offset + 3] = Math.round(THREE.MathUtils.clamp(clearing, 0, 1) * 255);
        }
    }
    const map = new THREE.DataTexture(data, MAP_SIZE, MAP_SIZE, THREE.RGBAFormat);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'FallGroundMap';
    map.needsUpdate = true;
    return map;
}

export class FallTerrain {
    constructor({ light, rng = Math.random }) {
        this.light = light;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallForestFloor';
        this.owned = [];
    }

    height(x, z) {
        return fallTerrainHeight(x, z);
    }

    /** Ground-map coordinate for a world position (TSL). */
    mapCoordinate(world = positionWorld) {
        const {
            minX, maxX, minZ, maxZ,
        } = FALL_GROUND_BOUNDS;
        return vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ));
    }

    build() {
        const {
            minX, maxX, minZ, maxZ,
        } = FALL_GROUND_BOUNDS;
        const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 128, 104);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 1) {
            const x = positions.getX(i) + (minX + maxX) / 2;
            const z = positions.getZ(i) + (minZ + maxZ) / 2;
            positions.setXYZ(i, x, fallTerrainHeight(x, z), z);
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        this.groundMap = createGroundMap(this.rng);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'FallLeafCarpet';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.owned.push(geometry, material, this.groundMap);
        this.mesh = mesh;
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'FallLeafCarpetMaterial';
        const world = positionWorld;
        const map = texture(this.groundMap, this.mapCoordinate(world));
        const coarse = light.noise(world.xz.mul(0.035));
        const fine = light.noise(world.xz.mul(0.31));
        const fleck = light.noise(world.xz.mul(1.9).add(fine.rg.mul(0.6)));
        // A carpet of fallen leaves: russet ground, drifts of gold and crimson.
        const russet = mix(color(0x3a1c0f), color(0x6a3414), coarse.g.mul(0.6).add(fine.b.mul(0.4)));
        const gold = mix(color(0x9a5a12), color(0xc98a1e), fleck.r);
        const crimson = color(0x7a1c10);
        const drift = smoothstep(0.46, 0.72, fleck.g.mul(0.55).add(coarse.b.mul(0.3)).add(map.b.mul(0.25)));
        const blush = smoothstep(0.62, 0.84, fleck.b.mul(0.6).add(fine.r.mul(0.4)));
        const leaves = mix(mix(russet, gold, drift), crimson, blush.mul(0.55));
        const earth = mix(color(0x2a1a10), color(0x4a3120), fine.a);
        const moss = mix(color(0x1c2a0c), color(0x3a4a14), fine.g);
        const albedo = mix(mix(leaves, moss, map.g.mul(0.55)), earth, map.r.mul(0.78));

        const normal = normalize(vec3(fine.r.sub(0.5).mul(0.55), 1, fine.g.sub(0.5).mul(0.55)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir)).mul(2.6).add(0.05);
        const glint = pow(saturate(dot(reflect(view.negate(), normal), light.uSunDir)), 22)
            .mul(fleck.a.mul(0.6).add(0.25)).mul(float(1).sub(map.r.mul(0.6)));
        const lit = albedo.mul(light.uSunColor).mul(facing).mul(sun)
            .add(light.uSunColor.mul(glint).mul(sun).mul(0.16))
            .add(albedo.mul(light.ambient(normal)).mul(1.05))
            .add(albedo.mul(light.uSunColor).mul(map.a).mul(light.uWarmth).mul(0.12));
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

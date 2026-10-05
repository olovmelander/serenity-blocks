/**
 * Sakura Twilight — the lie of the land.
 *
 * A lake fills the middle of the picture. The camera stands on a grassy knoll at its
 * near end; the bank steps forward in a lobe on either side (where the two old cherries
 * stand), two wooded points reach out further back, an islet lies off the right-hand one,
 * and the far shore closes the water under the mountain. Everything here is a plain
 * function of (x, z), so placement, the petal simulation and the tests share one terrain.
 */
import * as THREE from 'three/webgpu';
import {
    color, dot, float, mix, normalWorld, normalize, positionWorld, saturate, smoothstep, vec2, vec3, vec4,
} from 'three/tsl';

export const SAKURA_WATER_LEVEL = 0;
/** The ground mesh and the lake-bed map cover this rectangle. */
export const SAKURA_TERRAIN_BOUNDS = Object.freeze({
    minX: -150, maxX: 150, minZ: -210, maxZ: 40,
});
const smooth = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** z of the near shoreline: a cove straight ahead, a lobe of bank on either side. */
export function sakuraShore(x) {
    const side = Math.abs(x);
    return 4.5 - 8 * smooth(3.5, 10.5, side) + 5 * smooth(17, 30, side)
        + 0.7 * Math.sin(x * 0.37 + 1.1) + 0.45 * Math.sin(x * 0.83 + 0.2);
}

/** Metres inland (positive) or offshore (negative) of the nearest shoreline. */
export function sakuraLand(x, z) {
    const wobble = 0.9 * Math.sin(x * 0.31 + z * 0.17) + 0.6 * Math.sin(x * 0.13 - z * 0.41 + 2);
    const nearBank = z - sakuraShore(x);
    const leftPoint = (1 - Math.hypot((x + 42) / 26, (z + 28) / 37)) * 24 + wobble;
    const rightPoint = (1 - Math.hypot((x - 46) / 25, (z + 32) / 37)) * 24 + wobble;
    const islet = (1 - Math.hypot(x - 17, z + 27) / 5.6) * 5.6 + wobble * 0.3;
    const farShore = -152 - z + 8 * Math.sin(x * 0.013 + 1) + 4 * Math.sin(x * 0.041);
    return Math.max(nearBank, leftPoint, rightPoint, islet, farShore);
}

export function sakuraTerrainHeight(x, z) {
    const land = sakuraLand(x, z);
    if (land <= 0) return Math.max(-3.2, land * 0.32);
    const rise = 1 - Math.exp(-land * 0.5);
    const knoll = 1.9 * Math.exp(-((x / 24) ** 2) - (((z - 18) / 9.5) ** 2));
    const roll = 0.28 * Math.sin(x * 0.09 + 0.3) * Math.sin(z * 0.07 + 1.1);
    return 1.25 * rise + knoll * smooth(0, 5, land) + roll * rise;
}

/** The surface a petal lands on: the ground, or the lake where the ground is under it. */
export function sakuraSurfaceHeight(x, z) {
    return Math.max(SAKURA_WATER_LEVEL, sakuraTerrainHeight(x, z));
}

/** How far the stepping-stone path keeps back from the water. */
export const SAKURA_PATH_SETBACK = 2.4;

/** z of the stepping-stone path: it follows the near shore round the cove and both lobes. */
export function sakuraPathZ(x) {
    return sakuraShore(x) + SAKURA_PATH_SETBACK;
}

export function sakuraPathDistance(x, z) {
    return Math.abs(z - sakuraPathZ(x));
}

/** The lake bed as a texture: R = height mapped from -4..4 m, for the water's shallows. */
export function createSakuraBedTexture(size = 256) {
    const {
        minX, maxX, minZ, maxZ,
    } = SAKURA_TERRAIN_BOUNDS;
    const data = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row += 1) {
        const z = minZ + ((row + 0.5) / size) * (maxZ - minZ);
        for (let column = 0; column < size; column += 1) {
            const x = minX + ((column + 0.5) / size) * (maxX - minX);
            const height = sakuraTerrainHeight(x, z);
            const o = (row * size + column) * 4;
            data[o] = Math.round(Math.max(0, Math.min(1, height / 8 + 0.5)) * 255);
            data[o + 1] = Math.round(smooth(-6, 3, sakuraLand(x, z)) * 255);
            data[o + 3] = 255;
        }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.name = 'SakuraLakeBed';
    texture.needsUpdate = true;
    return texture;
}

/** Map a world xz to the lake-bed texture's uv (TSL). */
export function sakuraBedUv(pointXZ) {
    const {
        minX, maxX, minZ, maxZ,
    } = SAKURA_TERRAIN_BOUNDS;
    return pointXZ.sub(vec2(minX, minZ)).div(vec2(maxX - minX, maxZ - minZ));
}

export class SakuraTerrain {
    constructor({ light, rng = Math.random }) {
        this.light = light;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraGround';
    }

    build() {
        const {
            minX, maxX, minZ, maxZ,
        } = SAKURA_TERRAIN_BOUNDS;
        const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 220, 184);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
        const { position } = geometry.attributes;
        for (let i = 0; i < position.count; i += 1) {
            position.setY(i, sakuraTerrainHeight(position.getX(i), position.getZ(i)));
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        this.geometry = geometry;
        this.material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = 'SakuraGround';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        this.mesh = mesh;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'SakuraGround';
        const world = positionWorld;
        const point = world.xz;
        const normal = normalize(normalWorld);
        const broad = light.noise(point.mul(0.013));
        const patch = light.noise(point.mul(0.071).add(broad.rg.mul(0.3)));
        const fine = light.noise(point.mul(0.53));
        // Moss in the damp by the water, spring grass on the knoll.
        const shore = smoothstep(0.02, 0.9, world.y);
        const grass = mix(color(0x0a1a0d), color(0x1f3a16), patch.g.mul(0.7).add(fine.r.mul(0.5)));
        const moss = mix(color(0x0c1c10), color(0x24401c), fine.b);
        const silt = mix(color(0x0d0b10), color(0x1e1a1d), fine.g);
        let albedo = mix(silt, mix(moss, grass, smoothstep(0.5, 1.5, world.y.add(patch.b.mul(0.5)))), shore);
        // Stepping stones worn into the knoll.
        // The same curve as sakuraPathZ(): the shoreline, set back from the water.
        const side = world.x.abs();
        const pathZ = float(4.5 + SAKURA_PATH_SETBACK).sub(smoothstep(3.5, 10.5, side).mul(8))
            .add(smoothstep(17, 30, side).mul(5))
            .add(world.x.mul(0.37).add(1.1).sin().mul(0.7))
            .add(world.x.mul(0.83).add(0.2).sin().mul(0.45));
        const stride = world.x.mul(0.62).add(patch.r.mul(0.9));
        const stone = smoothstep(0.3, 0.42, world.z.sub(pathZ).abs().mul(0.9).add(stride.fract().sub(0.5).abs().mul(0.62)))
            .oneMinus().mul(smoothstep(0.45, 0.8, world.y)).mul(smoothstep(12, 14, world.x.abs()).oneMinus());
        albedo = mix(albedo, mix(color(0x2b2a2f), color(0x4a484d), fine.a), stone);
        // A fall of petals: thick where the wind drops them, thin in the open.
        const drift = smoothstep(0.34, 0.74, broad.b.mul(0.55).add(patch.r.mul(0.6)));
        // The noise is a lattice: a turned second octave keeps its grid from showing.
        const turned = vec2(point.x.mul(0.8).sub(point.y.mul(0.6)), point.x.mul(0.6).add(point.y.mul(0.8)));
        const speck = smoothstep(0.6, 0.72, light.noise(point.mul(0.71)).a.mul(0.6).add(light.noise(turned.mul(1.63)).a.mul(0.5)));
        const petals = speck.mul(drift.mul(0.62).add(0.06)).mul(shore).mul(light.uGlow.mul(0.4).add(1));
        albedo = mix(albedo, mix(color(0xe9a9bd), color(0xfbe3ea), fine.a), saturate(petals));

        const moonFacing = saturate(dot(normal, light.uMoonDir).mul(0.75).add(0.25));
        const ring = light.rings(point);
        const lit = albedo.mul(light.uMoonColor).mul(moonFacing).mul(light.moonlight())
            .add(albedo.mul(light.ambient(normal)).mul(1.2))
            .add(albedo.mul(light.lamps(world.add(vec3(0, 0.25, 0)), normal)))
            // The ring from a locked piece crosses the grass as a breath of pink light.
            .add(mix(albedo, vec3(1.0, 0.6, 0.74), 0.5).mul(ring.band).mul(0.55));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
    }
}

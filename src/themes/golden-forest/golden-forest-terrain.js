/**
 * Golden Forest — the shores of the lake.
 *
 * The land is one analytic height function: a near bank under the camera, a wooded
 * headland across the water on the left where the sun stands, a spit, a promontory and a
 * long shore on the right, an islet, an island and the far shore climbing into hills. Water
 * lies at y = 0. The same function places every tree, reed and rock, and is baked into a
 * small map so the lake knows how deep it is.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, dot, float, mix, normalWorld, normalize, positionWorld, pow, reflect, saturate,
    smoothstep, vec3, vec4,
} from 'three/tsl';
import {
    GOLDEN_FOREST_BOUNDS, LAKE_MAP_HEIGHT, LAKE_MAP_WIDTH, bakeLakeMap, goldenForestGroundHeight,
} from './golden-forest-shape.js';

// The land is three-free (golden-forest-shape.js): a first visit bakes its lake map in a worker.
export {
    GOLDEN_FOREST_BOUNDS, GOLDEN_FOREST_MAP_BIAS, GOLDEN_FOREST_MAP_RANGE, goldenForestGroundHeight,
    goldenForestShoreDistance, goldenForestShores,
} from './golden-forest-shape.js';

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

/** R = ground height (biased), G = metres from the shore out on the water / 40. */
function createLakeMap() {
    const map = new THREE.DataTexture(bakeLakeMap(), LAKE_MAP_WIDTH, LAKE_MAP_HEIGHT, THREE.RGBAFormat);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'GoldenForestLakeMap';
    map.needsUpdate = true;
    return map;
}

export class GoldenForestTerrain {
    constructor({ light }) {
        this.light = light;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestShores';
        this.owned = [];
    }

    height(x, z) {
        return goldenForestGroundHeight(x, z);
    }

    build() {
        const {
            minX, maxX, minZ, maxZ,
        } = GOLDEN_FOREST_BOUNDS;
        const xs = gridLines(minX, maxX, -34, 34, 0.45, 1.1);
        const zs = gridLines(minZ, maxZ, -8, 22, 0.45, 1.1);
        const positions = new Float32Array(xs.length * zs.length * 3);
        for (let row = 0; row < zs.length; row += 1) {
            for (let column = 0; column < xs.length; column += 1) {
                positions.set(
                    [xs[column], goldenForestGroundHeight(xs[column], zs[row]), zs[row]],
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
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'GoldenForestGround';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        this.group.add(mesh);
        this.owned.push(geometry, material, this.lakeMap);
        this.mesh = mesh;
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'GoldenForestGroundMaterial';
        const world = positionWorld;
        const coarse = light.noise(world.xz.mul(0.021));
        const fine = light.noise(world.xz.mul(0.27));
        const fleck = light.noise(world.xz.mul(1.7).add(fine.rg.mul(0.5)));
        // Forest floor: moss and lingonberry, rust drifts of needle litter, grey granite.
        const moss = mix(color(0x24260b), color(0x56501a), fine.g.mul(0.6).add(coarse.b.mul(0.4)));
        const litter = mix(color(0x4a240e), color(0x7a4418), fleck.r);
        const floor = mix(moss, litter, smoothstep(0.42, 0.72, fleck.g.mul(0.5).add(coarse.r.mul(0.5))));
        const granite = mix(color(0x4c4038), color(0x8a766a), fine.a).mul(fleck.b.mul(0.4).add(0.75));
        const smooth = normalize(normalWorld);
        const bare = smoothstep(0.56, 0.74, coarse.g.mul(0.6).add(fine.b.mul(0.3)).add(smooth.y.oneMinus().mul(1.6)));
        // The waterline: dark wet gravel that dries into pale sand a hand above the lake.
        const shoreline = float(1).sub(smoothstep(0.03, 0.55, world.y));
        const gravel = mix(color(0x1e130c), color(0x77583a), fleck.a.mul(smoothstep(-0.02, 0.4, world.y)));
        const albedo = mix(mix(floor, granite, bare), gravel, shoreline);

        const normal = normalize(smooth.add(vec3(fine.r.sub(0.5), 0, fine.g.sub(0.5)).mul(0.5)));
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = saturate(dot(normal, light.uSunDir)).mul(2.4).add(0.04);
        const wet = float(1).sub(smoothstep(0.0, 0.3, world.y));
        const glint = pow(saturate(dot(reflect(view.negate(), normal), light.uSunDir)), 24)
            .mul(fleck.a.mul(0.5).add(0.2).add(wet.mul(1.4)));
        const lit = albedo.mul(light.uSunColor).mul(facing).mul(sun)
            .add(light.uSunColor.mul(glint).mul(sun).mul(0.14))
            .add(albedo.mul(light.ambient(normal)).mul(1.1));
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

/**
 * Summer — the meadow.
 *
 * Tens of thousands of grass clumps and wildflowers between the camera and the shore, all
 * of them geometry, none of them moved by the CPU. Each plant carries its root and a turn
 * as instance data; the vertex shader stands it up, bends it in the wind the light rig
 * describes, and swells its flower heads when a gust from the board passes through. The
 * flowers grow in drifts, the way a real meadow sorts itself, and thin out with distance
 * into the flecks the ground itself carries.
 *
 * Both flower levels of detail and every kind share one material, and so do the two grass
 * levels: instance data lives on the geometry, not in the node graph.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow,
    saturate, smoothstep, uv, varying, vec3,
} from 'three/tsl';
import { SUMMER_VIEWS, summerEye } from './summer-composition.js';
import { SUMMER_FLOWERS, createSummerFlowerGeometry, createSummerGrassGeometry } from './summer-flowers.js';
import {
    SUMMER_CREST, SUMMER_PLACES, summerGroundHeight, summerMaypoleDistance, summerPathDistance, summerShores,
} from './summer-terrain.js';

const NEAR_VARIANTS = 2;
const { smoothstep: ramp } = THREE.MathUtils;

function hash2(ix, iz, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1; decides where each kind of flower grows in drifts. */
export function summerPatchNoise(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const top = hash2(x0, z0, seed) * (1 - sx) + hash2(x0 + 1, z0, seed) * sx;
    const bottom = hash2(x0, z0 + 1, seed) * (1 - sx) + hash2(x0 + 1, z0 + 1, seed) * sx;
    return top * (1 - sz) + bottom * sz;
}

/** How much of the meadow's growth a spot keeps: 0 on water and bare path, 1 in deep grass. */
export function summerMeadowCover(x, z) {
    const shore = summerShores(x, z).near;
    if (shore < 0.7) return 0;
    const path = 1 - ramp(summerPathDistance(x, z), 0.22, 0.7);
    return ramp(shore, 0.7, 2.4) * (1 - path * 0.94);
}

/** How strongly a spot belongs to the crest of tall flowers in front of the camera. */
function crestness(z) {
    return Math.exp(-(((z - SUMMER_CREST.z) / (SUMMER_CREST.width * 1.25)) ** 2));
}

export class SummerMeadow {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerMeadow';
        this.owned = [];
        this.stats = {
            grass: 0, flowers: 0, grassTriangles: 0, flowerTriangles: 0,
        };
        /** Flower counts by kind, for diagnostics and tests. */
        this.census = Object.fromEntries(SUMMER_FLOWERS.map((flower) => [flower.id, 0]));
        const [x, , z] = summerEye(SUMMER_VIEWS.landscape);
        this.eye = { x, z };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildGrass();
        this.buildFlowers();
        return this;
    }

    /** A random spot in front of the camera: `bias` > 1 crowds the picks toward the lens. */
    spot(nearest, farthest, bias) {
        const { rng, eye } = this;
        const depth = nearest + (farthest - nearest) * rng() ** bias;
        // Most of the growth is where a 16:9 screen looks; the rest serves wider ones.
        const spread = rng() < 0.8 ? 0.74 : 0.96;
        const angle = (rng() * 2 - 1) * spread;
        return { x: eye.x + Math.sin(angle) * depth, z: eye.z - Math.cos(angle) * depth, depth };
    }

    /** One draw of `geometry` for a list of plants (x, y, z, yaw, scale, phase, hue). */
    plant(geometry, material, plants, name) {
        if (!plants.length) return null;
        const count = plants.length / 7;
        const roots = new Float32Array(count * 4);
        const turns = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const o = i * 7;
            roots.set([plants[o], plants[o + 1], plants[o + 2], plants[o + 5]], i * 4);
            turns.set([Math.cos(plants[o + 3]), Math.sin(plants[o + 3]), plants[o + 4], plants[o + 6]], i * 4);
        }
        // The vertex data is shared; only the instance data belongs to this draw.
        const instanced = this.own(new THREE.BufferGeometry());
        Object.entries(geometry.attributes).forEach(([key, value]) => instanced.setAttribute(key, value));
        instanced.setIndex(geometry.index);
        instanced.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 4));
        instanced.setAttribute('aTurn', new THREE.InstancedBufferAttribute(turns, 4));
        instanced.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 80);
        const mesh = new THREE.InstancedMesh(instanced, material, count);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        return mesh;
    }

    // -- grass --------------------------------------------------------------------------
    /** Stand a plant on its root, turned and scaled, and bend it in the wind. */
    stand(flex, swell = null) {
        const { light } = this;
        const root = attribute('aRoot', 'vec4'); // x, y, z, phase
        const turn = attribute('aTurn', 'vec4'); // cos, sin, scale, hue
        const paint = attribute('paint', 'vec4');
        const air = light.meadowWind(root.xyz, root.w);
        const shape = swell ? positionGeometry.add(swell(air)) : positionGeometry;
        const sized = shape.mul(turn.z);
        const stood = vec3(
            sized.x.mul(turn.x).sub(sized.z.mul(turn.y)),
            sized.y,
            sized.x.mul(turn.y).add(sized.z.mul(turn.x)),
        );
        const height = paint.x.mul(turn.z);
        // The lean is the same for a plant drawn larger than life: height squared, scaled once.
        const bend = air.push.mul(paint.x.mul(paint.x).mul(turn.z).mul(flex));
        // A stem that leans over also comes down a little.
        const droop = dot(bend, bend).mul(0.5).div(height.add(0.06));
        const normal = vec3(
            normalGeometry.x.mul(turn.x).sub(normalGeometry.z.mul(turn.y)),
            normalGeometry.y,
            normalGeometry.x.mul(turn.y).add(normalGeometry.z.mul(turn.x)),
        );
        return {
            root, turn, paint, air, normal, position: stood.add(root.xyz).add(vec3(bend.x, droop.negate(), bend.y)),
        };
    }

    createGrassMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SummerGrass';
        const plant = this.stand(1.5);
        material.positionNode = plant.position;
        const st = uv();
        const { root, paint } = plant;
        const air = varying(vec3(plant.air.gust, plant.air.bloom, plant.air.front), 'summerGrassAir');
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const field = light.noise(root.xz.mul(0.021));
        const tuft = light.noise(root.xz.mul(0.13));
        // Dark at the root where blades shade each other, June green above, straw at the tips
        // of the clumps that have gone to seed.
        const base = mix(color(0x0c2807), color(0x1f4d10), field.g);
        const tip = mix(color(0x3f8420), color(0x74a22c), tuft.r.mul(0.6).add(st.x.mul(0.4)));
        let blade = mix(base, tip, smoothstep(0.04, 0.85, st.y));
        const dry = smoothstep(0.62, 0.92, field.r.mul(0.65).add(st.x.mul(0.35))).mul(st.y).mul(0.4);
        blade = mix(blade, color(0xa9a650), dry);
        // Seed heads: the purple-brown of timothy and meadow foxtail, on stalks still green.
        blade = mix(blade, color(0x4a6a1e), paint.w.mul(0.75));
        blade = mix(blade, mix(color(0x9a8a52), color(0x8f7a66), st.x), paint.y);
        const normal = normalize(plant.normal);
        const sun = light.sunlight();
        const facing = dot(normal, light.uSunDir).abs().mul(0.85).add(0.28);
        // Looking up the light, every blade is a sliver of stained glass.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3);
        const glow = pow(blade, vec3(0.8)).mul(vec3(0.92, 1.2, 0.3)).mul(through.mul(0.6).add(0.05))
            .mul(st.y.mul(st.y));
        // A blade the wind has laid over shows the sky on its back.
        const sheen = light.uSkyLight.mul(air.x.mul(st.y).mul(0.2));
        const lit = blade.mul(facing).add(glow).mul(light.uSunColor).mul(sun)
            .mul(0.3)
            .add(blade.mul(light.ambient(vec3(0, 1, 0))).mul(st.y.mul(0.75).add(0.25)))
            .add(sheen.mul(sun.mul(0.6).add(0.4)))
            // A ring from the board lifts light off the grass as it goes by.
            .add(blade.mul(vec3(1.5, 1.35, 0.7)).mul(air.y.mul(st.y).mul(0.3)));
        material.colorNode = light.haze(lit, { world });
        return material;
    }

    buildGrass() {
        const { rng, tier } = this;
        const material = this.createGrassMaterial();
        const scatter = (wanted, nearest, farthest, bias, far) => {
            const plants = [];
            for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 6; attempt += 1) {
                const place = this.spot(nearest, farthest, bias);
                const cover = summerMeadowCover(place.x, place.z);
                if (rng() < cover) {
                    const mown = 1 - ramp(
                        summerMaypoleDistance(place.x, place.z),
                        SUMMER_PLACES.maypole.ring - 0.5,
                        SUMMER_PLACES.maypole.ring + 0.6,
                    );
                    const tall = 1 + crestness(place.z) * 0.22 - mown * 0.66;
                    const scale = (0.78 + rng() * 0.5) * tall * (far ? 1 + place.depth * 0.022 : 1);
                    plants.push(
                        place.x,
                        summerGroundHeight(place.x, place.z) - 0.02,
                        place.z,
                        rng() * Math.PI * 2,
                        scale,
                        rng(),
                        rng(),
                    );
                    made += 1;
                }
            }
            return plants;
        };
        const near = this.own(createSummerGrassGeometry({ far: false, seed: 11 }));
        const far = this.own(createSummerGrassGeometry({ far: true, seed: 23 }));
        const nearPlants = scatter(tier.grassNear, 0.9, 11.5, 1.45, false);
        const farPlants = scatter(tier.grassFar, 9.5, 36, 1.22, true);
        this.plant(near, material, nearPlants, 'SummerGrass near');
        this.plant(far, material, farPlants, 'SummerGrass far');
        this.stats.grass = (nearPlants.length + farPlants.length) / 7;
        this.stats.grassTriangles = (nearPlants.length / 7) * (near.index.count / 3)
            + (farPlants.length / 7) * (far.index.count / 3);
    }

    // -- flowers ------------------------------------------------------------------------
    createFlowerMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SummerFlowers';
        const head = attribute('head', 'vec4'); // offset from the head's middle, flower kind
        const albedo = attribute('color', 'vec3');
        // A flower answers twice: every head swells as a ring from the board goes by, and
        // the kind the game has just called on swells and stays lit a moment longer.
        const answer = (air) => saturate(air.bloom.mul(0.3)
            .add(light.speciesGlow(head.w).mul(air.bloom.mul(0.5).add(0.4))));
        const plant = this.stand(0.42, (air) => head.xyz.mul(answer(air).mul(0.42)));
        material.positionNode = plant.position;
        const { paint, turn } = plant;
        const air = varying(vec3(plant.air.gust, plant.air.bloom, answer(plant.air)), 'summerFlowerAir');
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const normal = normalize(plant.normal);
        const petal = smoothstep(0.55, 0.9, paint.y);
        const tone = albedo.mul(turn.w.mul(0.26).add(0.87));
        const sun = light.sunlight();
        const facing = dot(normal, light.uSunDir).abs().mul(0.72).add(0.3);
        // Petals are thin: with the sun behind them they light up from inside.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.2);
        const lantern = pow(tone, vec3(0.85)).mul(through.mul(0.62).add(0.1)).mul(petal.mul(0.75).add(0.25));
        // Low on the plant its neighbours shade it.
        const shade = smoothstep(0.0, 0.3, paint.x.mul(turn.z)).mul(0.5).add(0.5);
        const lit = tone.mul(facing).add(lantern).mul(light.uSunColor).mul(sun)
            .mul(0.23)
            .add(tone.mul(light.ambient(mix(normal, vec3(0, 1, 0), 0.6))).mul(0.9))
            .mul(shade)
            .add(tone.mul(mix(vec3(0.24, 0.22, 0.13), vec3(0.52, 0.48, 0.4), petal)).mul(air.z));
        material.colorNode = light.haze(lit, { world });
        return material;
    }

    buildFlowers() {
        const { rng, tier } = this;
        const material = this.createFlowerMaterial();
        /** Shared with the shore, which plants its water lilies with it. */
        this.flowerMaterial = material;
        const total = SUMMER_FLOWERS.reduce((sum, flower) => sum + flower.share, 0);
        /** Pick a kind for a spot: each grows in its own drifts, the tall ones on the crest. */
        const choose = (x, z, crest) => {
            let sum = 0;
            const weights = SUMMER_FLOWERS.map((flower, index) => {
                const [frequency, threshold] = flower.patch;
                const drift = ramp(
                    summerPatchNoise(x * frequency * 4, z * frequency * 4, index * 13 + 5),
                    threshold,
                    threshold + 0.26,
                );
                const weight = (flower.share / total) * (0.06 + drift) * (1 + crest * flower.crest);
                sum += weight;
                return weight;
            });
            let pick = rng() * sum;
            for (let i = 0; i < weights.length; i += 1) {
                pick -= weights[i];
                if (pick <= 0) return i;
            }
            return weights.length - 1;
        };
        const scatter = (wanted, nearest, farthest, bias, far) => {
            const lists = SUMMER_FLOWERS.map(() => Array.from({ length: far ? 1 : NEAR_VARIANTS }, () => []));
            for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 8; attempt += 1) {
                const place = this.spot(nearest, farthest, bias);
                const cover = summerMeadowCover(place.x, place.z);
                const mown = summerMaypoleDistance(place.x, place.z) < SUMMER_PLACES.maypole.ring + 0.2;
                if (!mown && rng() < cover) {
                    const crest = crestness(place.z);
                    const kind = choose(place.x, place.z, crest);
                    const flower = SUMMER_FLOWERS[kind];
                    // Far flowers are drawn larger than life so the meadow keeps its colour.
                    const scale = (0.82 + rng() * 0.42) * (far ? 1.05 + place.depth * 0.017 : 1 + crest * 0.14);
                    const list = lists[kind][Math.floor(rng() * lists[kind].length) % lists[kind].length];
                    list.push(
                        place.x,
                        summerGroundHeight(place.x, place.z) - 0.015,
                        place.z,
                        rng() * Math.PI * 2,
                        scale,
                        rng(),
                        rng(),
                    );
                    this.census[flower.id] += 1;
                    made += 1;
                }
            }
            return lists;
        };
        const draw = (lists, far) => lists.forEach((variants, kind) => variants.forEach((plants, variant) => {
            if (!plants.length) return;
            const { id } = SUMMER_FLOWERS[kind];
            const geometry = this.own(createSummerFlowerGeometry(id, { far, variant }));
            this.plant(geometry, material, plants, `SummerFlower ${id}${far ? ' far' : ''} ${variant}`);
            this.stats.flowers += plants.length / 7;
            this.stats.flowerTriangles += (plants.length / 7) * (geometry.index.count / 3);
        }));
        draw(scatter(tier.flowersNear, 1.25, 10.5, 1.3, false), false);
        draw(scatter(tier.flowersFar, 9, 36, 1.16, true), true);
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}

/**
 * Verdant Hills — the grass.
 *
 * Tens of thousands of clumps on the crown of the home hill and down its two spurs, all of
 * them geometry, none of them moved by the CPU. Each plant carries its root and a turn as
 * instance data; the vertex shader stands it up and bends it in the wind the light rig
 * describes — the bands of the breeze, the rings that spread from the foot of the board,
 * the front that crosses the valley. A blade the wind has laid over shows the sky on its
 * back, which is what makes the wind visible from here to the far hills (the ground
 * shader carries the same bands on beyond the last blade).
 *
 * Plants grow only where the lens can see them: the hill's own brow hides the slope below.
 * All grass shares one material and all flowers another; instance data lives on the
 * geometry, not in the node graph.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, dot, length, mix, normalGeometry, normalize, positionGeometry, positionWorld,
    pow, saturate, smoothstep, step, uv, varying, vec3,
} from 'three/tsl';
import { VERDANT_HILLS_VIEWS, VerdantHillsSight, verdantHillsEye } from './verdant-hills-composition.js';
import {
    VERDANT_HILLS_FLOWERS, createVerdantHillsFlowerGeometry, createVerdantHillsGrassGeometry,
} from './verdant-hills-flora.js';
import { VERDANT_HILLS_PLACES, verdantHillsNoise, verdantHillsPathDistance } from './verdant-hills-terrain.js';

const FLOWER_VARIANTS = 2;
const { smoothstep: ramp, degToRad } = THREE.MathUtils;

/** How much of the down's growth a spot keeps: none on the path, thin under the oak. */
export function verdantHillsMeadowCover(x, z) {
    const path = 1 - ramp(verdantHillsPathDistance(x, z), 0.5, 1.15);
    const { oak, gate, bench } = VERDANT_HILLS_PLACES;
    const trunk = ramp(Math.hypot(x - oak.x, z - oak.z), 1.1, 2.4);
    const shade = 1 - 0.45 * (1 - ramp(Math.hypot(x - oak.x, z - oak.z), 3, 9.5));
    const trampled = ramp(Math.hypot(x - gate.x, z - gate.z), 0.8, 2.6)
        * ramp(Math.hypot(x - bench.x, z - bench.z), 0.5, 1.3);
    return (1 - path * 0.95) * trunk * shade * trampled;
}

export class VerdantHillsMeadow {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsMeadow';
        this.owned = [];
        this.stats = {
            grass: 0, flowers: 0, grassTriangles: 0, flowerTriangles: 0,
        };
        /** Flower counts by kind, for diagnostics and tests. */
        this.census = Object.fromEntries(VERDANT_HILLS_FLOWERS.map((flower) => [flower.id, 0]));
        /** Where the dandelion clocks stand (x, y, z triples): their seed is what the wind takes. */
        this.clocks = [];
        const [x, y, z] = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
        this.eye = { x, y, z };
        this.sight = new VerdantHillsSight();
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

    /**
     * A random spot in front of the lens that it can actually see. Depth is spread evenly
     * in its logarithm, so the screen stays evenly planted from the lens to the far spurs.
     */
    spot(nearest, farthest) {
        const { rng } = this;
        // Most of the growth is where a 16:9 screen looks; the rest serves wider ones.
        const spread = rng() < 0.82 ? degToRad(41) : degToRad(54);
        return this.sight.spot(rng(), rng(), nearest, farthest, spread);
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
        instanced.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, this.eye.y, -60), 160);
        const mesh = new THREE.InstancedMesh(instanced, material, count);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        return mesh;
    }

    /** Stand a plant on its root, turned and scaled, and bend it in the wind. */
    stand(flex) {
        const { light } = this;
        const root = attribute('aRoot', 'vec4'); // x, y, z, phase
        const turn = attribute('aTurn', 'vec4'); // cos, sin, scale, hue
        const paint = attribute('paint', 'vec4');
        const air = light.meadowWind(root.xyz, root.w);
        // Only one clump in eleven has gone to seed: the others keep their head folded away.
        const seeded = paint.w.mul(step(0.09, turn.w)).oneMinus();
        const sized = positionGeometry.mul(turn.z).mul(seeded);
        const stood = vec3(
            sized.x.mul(turn.x).sub(sized.z.mul(turn.y)),
            sized.y,
            sized.x.mul(turn.y).add(sized.z.mul(turn.x)),
        );
        const height = paint.x.mul(turn.z);
        // The lean is the same for a plant drawn larger than life: height squared, scaled once.
        const lean = air.push.mul(paint.x.mul(paint.x).mul(turn.z).mul(flex));
        // However hard it blows, a blade lies over no further than its own length.
        const bend = lean.div(length(lean).div(height.mul(0.7).add(0.01)).add(1));
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

    // -- grass --------------------------------------------------------------------------
    createGrassMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'VerdantHillsGrass';
        const plant = this.stand(1.5);
        material.positionNode = plant.position;
        const st = uv();
        const { root, paint } = plant;
        const air = varying(vec3(plant.air.band, plant.air.bloom, plant.air.front), 'verdantGrassAir');
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const field = light.noise(root.xz.mul(0.017));
        const tuft = light.noise(root.xz.mul(0.11));
        // Dark at the root where blades shade each other, the green of June above, and the
        // pale green-gold of tips the wind has dried.
        const base = mix(color(0x0d2c07), color(0x1e5010), field.g);
        const tip = mix(color(0x3a8a1e), color(0x72ab2c), tuft.r.mul(0.6).add(st.x.mul(0.4)));
        let blade = mix(base, tip, smoothstep(0.03, 0.82, st.y));
        const dry = smoothstep(0.6, 0.92, field.r.mul(0.6).add(st.x.mul(0.4))).mul(st.y).mul(0.42);
        blade = mix(blade, color(0xa8ac52), dry);
        // Seed heads: the purple-brown of timothy and foxtail, on stalks still green.
        blade = mix(blade, color(0x52701f), paint.w.mul(0.75));
        blade = mix(blade, mix(color(0x8f8a4a), color(0x7d6c52), st.x), paint.y);
        const normal = normalize(plant.normal);
        const sun = light.sunlight();
        const facing = dot(normal, light.uSunDir).abs().mul(0.85).add(0.28);
        // Looking up the light, every blade is a sliver of stained glass.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.4);
        const glow = pow(blade, vec3(0.8)).mul(vec3(0.95, 1.2, 0.3)).mul(through.mul(0.75).add(0.06))
            .mul(st.y.mul(st.y));
        // A blade the wind has laid over shows the sky on its back.
        // Only where a band of the breeze is passing, however hard it blows: the wind shows as
        // moving light, never as a haze over the whole hill.
        const laid = saturate(air.x.mul(air.x).mul(light.uWind.mul(0.7).add(light.uShimmer.mul(0.5)).add(0.3))
            .add(air.z.mul(0.38)));
        const sheen = mix(vec3(0.55, 0.66, 0.36), light.uSkyLight, 0.5).mul(laid.mul(st.y).mul(0.26));
        const lit = blade.mul(facing).add(glow).mul(light.uSunColor).mul(sun)
            .mul(0.3)
            .add(blade.mul(light.ambient(vec3(0, 1, 0))).mul(st.y.mul(0.75).add(0.25)))
            .add(sheen.mul(sun.mul(0.7).add(0.3)))
            // A ring from the board lifts light off the grass as it goes by.
            .add(blade.mul(vec3(1.5, 1.4, 0.75)).mul(air.y.mul(st.y).mul(0.5)));
        material.colorNode = light.haze(lit, { world });
        return material;
    }

    buildGrass() {
        const { rng, tier } = this;
        const material = this.createGrassMaterial();
        const scatter = (wanted, nearest, farthest, far) => {
            const plants = [];
            for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 8; attempt += 1) {
                const place = this.spot(nearest, farthest);
                if (place && rng() < verdantHillsMeadowCover(place.x, place.z)) {
                    // Tall on the brow, where it stands against the valley; shorter in the oak's shade.
                    const { oak } = VERDANT_HILLS_PLACES;
                    const shade = 1 - ramp(Math.hypot(place.x - oak.x, place.z - oak.z), 3, 9.5);
                    const lush = 0.88 + 0.3 * verdantHillsNoise(place.x / 6, place.z / 6, 51);
                    // Feet and sheep keep the grass short beside the path.
                    const verge = 0.4 + 0.6 * ramp(verdantHillsPathDistance(place.x, place.z), 1.1, 3.6);
                    const scale = (0.78 + rng() * 0.42) * lush * (1 - shade * 0.32) * verge
                        * (far ? 1 + place.depth * 0.02 : 1);
                    plants.push(place.x, place.y - 0.02, place.z, rng() * Math.PI * 2, scale, rng(), rng());
                    made += 1;
                }
            }
            return plants;
        };
        const near = this.own(createVerdantHillsGrassGeometry({ far: false, seed: 11 }));
        const far = this.own(createVerdantHillsGrassGeometry({ far: true, seed: 23 }));
        const nearPlants = scatter(tier.grassNear, 1.3, 17, false);
        const farPlants = scatter(tier.grassFar, 12, 150, true);
        this.plant(near, material, nearPlants, 'VerdantHillsGrass near');
        this.plant(far, material, farPlants, 'VerdantHillsGrass far');
        this.stats.grass = (nearPlants.length + farPlants.length) / 7;
        this.stats.grassTriangles = (nearPlants.length / 7) * (near.index.count / 3)
            + (farPlants.length / 7) * (far.index.count / 3);
    }

    // -- flowers ------------------------------------------------------------------------
    createFlowerMaterial() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'VerdantHillsFlowers';
        const albedo = attribute('color', 'vec3');
        const plant = this.stand(0.5);
        material.positionNode = plant.position;
        const { paint, turn } = plant;
        const air = varying(vec3(plant.air.band, plant.air.bloom, plant.air.front), 'verdantFlowerAir');
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const normal = normalize(plant.normal);
        const petal = smoothstep(0.55, 0.9, paint.y);
        const tone = albedo.mul(turn.w.mul(0.24).add(0.88));
        const sun = light.sunlight();
        const facing = dot(normal, light.uSunDir).abs().mul(0.72).add(0.3);
        // Petals and down are thin: with the sun behind them they light up from inside.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.2);
        const lantern = pow(tone, vec3(0.85)).mul(through.mul(0.7).add(0.1)).mul(petal.mul(0.75).add(0.25));
        // Low on the plant its neighbours shade it.
        const shade = smoothstep(0.0, 0.3, paint.x.mul(turn.z)).mul(0.5).add(0.5);
        const lit = tone.mul(facing).add(lantern).mul(light.uSunColor).mul(sun)
            .mul(0.25)
            .add(tone.mul(light.ambient(mix(normal, vec3(0, 1, 0), 0.6))).mul(0.9))
            .mul(shade)
            .add(tone.mul(mix(vec3(0.2, 0.2, 0.12), vec3(0.5, 0.48, 0.4), petal)).mul(air.y));
        material.colorNode = light.haze(lit, { world });
        return material;
    }

    buildFlowers() {
        const { rng, tier } = this;
        const material = this.createFlowerMaterial();
        const total = VERDANT_HILLS_FLOWERS.reduce((sum, flower) => sum + flower.share, 0);
        /** Pick a kind for a spot: each grows in its own drifts. */
        const choose = (x, z) => {
            let sum = 0;
            const weights = VERDANT_HILLS_FLOWERS.map((flower, index) => {
                const [frequency, threshold] = flower.patch;
                const drift = ramp(
                    verdantHillsNoise(x * frequency * 4, z * frequency * 4, index * 13 + 5),
                    threshold,
                    threshold + 0.26,
                );
                const weight = (flower.share / total) * (0.02 + drift);
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
        const lists = VERDANT_HILLS_FLOWERS.map(() => Array.from({ length: FLOWER_VARIANTS }, () => []));
        const wanted = tier.flowers;
        for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 8; attempt += 1) {
            const place = this.spot(1.5, 70);
            // Flowers keep to their drifts: between them the down is grass alone.
            const drifted = place ? ramp(verdantHillsNoise(place.x / 9, place.z / 9, 77), 0.36, 0.66) : 0;
            if (place && rng() < verdantHillsMeadowCover(place.x, place.z) * (0.12 + 0.88 * drifted)) {
                const kind = choose(place.x, place.z);
                const flower = VERDANT_HILLS_FLOWERS[kind];
                // Far flowers are drawn larger than life so the down keeps its colour.
                const scale = (0.85 + rng() * 0.4) * (1 + Math.max(0, place.depth - 8) * 0.03);
                lists[kind][Math.floor(rng() * FLOWER_VARIANTS) % FLOWER_VARIANTS].push(
                    place.x,
                    place.y - 0.015,
                    place.z,
                    rng() * Math.PI * 2,
                    scale,
                    rng(),
                    rng(),
                );
                if (flower.id === 'clock') this.clocks.push(place.x, place.y + flower.tall * scale, place.z);
                this.census[flower.id] += 1;
                made += 1;
            }
        }
        lists.forEach((variants, kind) => variants.forEach((plants, variant) => {
            if (!plants.length) return;
            const { id } = VERDANT_HILLS_FLOWERS[kind];
            const geometry = this.own(createVerdantHillsFlowerGeometry(id, { variant }));
            this.plant(geometry, material, plants, `VerdantHillsFlower ${id} ${variant}`);
            this.stats.flowers += plants.length / 7;
            this.stats.flowerTriangles += (plants.length / 7) * (geometry.index.count / 3);
        }));
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

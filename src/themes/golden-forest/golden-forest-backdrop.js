/**
 * Golden Forest — the far shores and the mountains.
 *
 * Beyond the modelled conifers the forest continues as Blender-rendered sprites of the
 * same trees: each stores shading data rather than colour, so it is lit by the same low
 * sun, casts into the shared shadow map and fades into the same golden air. Behind the
 * last wooded hill the land stands in four ranks, each paler than the one in front: a wooded
 * hill with its treeline against the light and a rank of broken fells (two silhouettes), then
 * two ranges of rock and snow that are real ground (golden-forest-ranges.js), lit face by face
 * from the sky: the sun stands beyond them, so the flanks turned to its side of the sky are
 * warm, the flanks turned away are dusk-cool, and their snow takes the colour of the hour.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, color, dot, exp, float, instancedBufferAttribute, length, max, mix, normalize,
    normalWorld, positionLocal, positionWorld, pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { GOLDEN_FOREST_VIEWS, goldenForestEye } from './golden-forest-composition.js';
import { GOLDEN_FOREST_RANGES, createGoldenForestRanges } from './golden-forest-ranges.js';
import { goldenForestShores, goldenForestSurfaceHeight } from './golden-forest-terrain.js';

const SPRUCE_RAMP = [0x07130a, 0x112a10, 0x254414, 0x566418];
const PINE_RAMP = [0x0b1c0d, 0x1b3a15, 0x38561a, 0x748024];
// Where sprite trees stand: a sampling box, the land that counts, and the band's share.
const SPRITE_BANDS = [
    { box: [-340, 340, -400, -212], on: (s) => s.far > 3, share: 0.56 },
    { box: [-200, -28, -140, -96], on: (s) => s.headland > 4, share: 0.14 },
    { box: [40, 180, -200, -40], on: (s) => s.right > 10, share: 0.2 },
    { box: [30, 100, -72, -40], on: (s) => s.promontory > 5, share: 0.06 },
    { box: [-300, -70, -90, 30], on: (s) => s.near > 12, share: 0.04 },
];
// z, base crest height, how jagged, haze strength, seed. The first two are drawn as silhouettes;
// the last two only lend their draws from the theme's stream to the ranges' seed (the ranges are
// real ground: golden-forest-ranges.js).
const RIDGES = [
    [-560, 74, 0.5, 0.9, 3],
    [-780, 128, 0.8, 0.95, 11],
    [-1050, 205, 1.1, 0.985, 23],
    [-1420, 300, 1.3, 1, 41],
];
const SILHOUETTES = 2;
/** The ranges' grid: metres between posts across and in depth, with the post chain and without. */
const RANGE_GRID = Object.freeze({ fine: [9, 22], coarse: [15, 30] });
/** Posts along a ridge's crest, and along the wooded hill's (its treeline wants one every few metres). */
const RIDGE_STEPS = 360;
const HILL_STEPS = 560;
/** The eye the ridges are composed for (the landscape lens) and the sun's bearing from it (degrees). */
const RIDGE_EYE_Z = 14.5;
const RIDGE_SUN_AZIMUTH = THREE.MathUtils.degToRad(-21);
/** Height (m) the snow lies above, and the band it frays over. */
const SNOW_LINE = Object.freeze({ from: 168, band: 60 });

/** A small seeded generator for a ridge's own shape (the theme's stream is left alone). */
function ridgeRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth value noise along a line: a table of random heights joined by eased steps. */
function lineNoise(random, size = 256) {
    const table = Float32Array.from({ length: size }, () => random());
    return (x) => {
        const i = Math.floor(x);
        const f = x - i;
        const a = table[((i % size) + size) % size];
        const b = table[(((i + 1) % size) + size) % size];
        return a + (b - a) * f * f * (3 - 2 * f);
    };
}

/**
 * The crest of a ridge over u = x / span (-0.5..0.5), as a share of its base height: broad
 * massifs, and on them the folded noise that makes peaks (sharp tops, round saddles), more of it
 * and finer the more jagged the range; one summit over the right shore, as there has always
 * been; and a saddle where the sun stands, so its disc rests between two shoulders.
 */
export function goldenForestRidgeCrest({
    offsets, jagged, seed, sunU,
}) {
    const noise = lineNoise(ridgeRandom(Math.floor(offsets.reduce((sum, value) => sum + value, seed) * 9973)));
    return (u) => {
        const massif = 0.5 + 0.34 * (noise(u * 5.5 + offsets[0]) - 0.5) * 2 + 0.16 * Math.sin(u * 23 + offsets[1]);
        let peaks = 0;
        let weight = 0.5;
        let frequency = 13;
        for (let octave = 0; octave < 5; octave += 1) {
            const fold = 1 - Math.abs(2 * noise(u * frequency + offsets[2 + (octave % 4)] * 7) - 1);
            peaks += fold * fold * weight;
            weight *= 0.52;
            frequency *= 2.17;
        }
        const summit = Math.exp(-(((u - 0.115) / 0.07) ** 2)) * 0.5 * (seed > 20 ? 1 : 0.35);
        const saddle = 1 - 0.42 * Math.exp(-(((u - sunU) / 0.05) ** 2));
        return Math.max(0.12, (massif * (0.62 + 0.5 * jagged * peaks) + summit) * saddle);
    };
}

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

export class GoldenForestBackdrop {
    constructor({
        light, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestFarShores';
        this.owned = [];
        this.count = 0;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (this.impostors?.texture && this.impostors.tiles?.length) this.buildForest();
        this.buildRidges();
        this.buildRanges();
        return this;
    }

    /** Far trees, densest along the waterline where their reflections land. */
    layout() {
        const { rng } = this;
        const cards = [];
        const { tiles } = this.impostors;
        const eye = goldenForestEye(GOLDEN_FOREST_VIEWS.landscape);
        SPRITE_BANDS.forEach((band) => {
            const wanted = Math.round(this.tier.farTrees * band.share);
            let made = 0;
            for (let attempt = 0; made < wanted && attempt < wanted * 12; attempt += 1) {
                const x = band.box[0] + (band.box[1] - band.box[0]) * rng();
                // Bias toward the front edge of the band: the shoreline carries the picture.
                const z = band.box[3] + (band.box[2] - band.box[3]) * rng() ** 1.6;
                if (band.on(goldenForestShores(x, z))) {
                    const tile = tiles[Math.floor(rng() * tiles.length) % tiles.length];
                    cards.push({
                        x,
                        z,
                        y: goldenForestSurfaceHeight(x, z) - 0.3,
                        tile,
                        scale: 0.9 + rng() * 0.5,
                        flip: rng() < 0.5,
                        tone: THREE.MathUtils.clamp(
                            0.45 + Math.sin(x * 0.035 + z * 0.05) * 0.3 + (rng() - 0.5) * 0.36,
                            0,
                            1,
                        ),
                        phase: rng(),
                        yaw: Math.atan2(eye[0] - x, eye[2] - z),
                    });
                    made += 1;
                }
            }
        });
        return cards;
    }

    buildForest() {
        const { light, impostors } = this;
        const cards = this.layout();
        this.count = cards.length;
        if (!cards.length) return;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1, 1, 4));
        geometry.translate(0, 0.5, 0);
        const tileData = new Float32Array(cards.length * 4);
        const lookData = new Float32Array(cards.length * 4);
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, pine
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'GoldenForestFarShoreSprites';
        material.shadowSide = THREE.DoubleSide;
        const st = uv();
        const atlasUv = vec2(tile.x.add(st.x.mul(tile.y)), st.y);
        const data = texture(impostors.texture, atlasUv); // shade, needle mask, hue seed, coverage
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.6).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));
        material.maskShadowNode = data.a.greaterThan(0.5);

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const tone = saturate(tile.z.mul(0.62).add(data.b.sub(0.5).mul(0.3)).add(data.r.mul(0.3)));
        const needle = mix(ramp(SPRUCE_RAMP, tone), ramp(PINE_RAMP, tone), tile.w);
        const bark = mix(color(0x1c120d), color(0x7a3c1c), tile.w.mul(smoothstep(0.3, 0.6, st.y)));
        const albedo = mix(bark, needle, data.g).mul(data.r.mul(0.85).add(0.15));
        const glowing = pow(needle, vec3(0.62)).mul(vec3(1.75, 1.05, 0.28)).mul(data.g).mul(data.r);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4);
        const sun = light.sunlight();
        const lit = albedo.mul(0.16).add(glowing.mul(through.mul(1.0).add(0.1))).mul(light.uSunColor).mul(sun)
            .add(albedo.mul(light.ambient(vec3(0, 0.5, 0.86))).mul(1.3))
            // A combo gilds the far shores too, crown by crown round the lake.
            .add(glowing.mul(light.uSunColor).mul(light.gild(world)).mul(smoothstep(0.2, 0.9, st.y)).mul(0.36));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'GoldenForestFarShore';
        const dummy = new THREE.Object3D();
        cards.forEach((card, index) => {
            const width = card.tile.width * card.scale;
            const height = card.tile.height * card.scale;
            const sign = card.flip ? -1 : 1;
            // Stand the trunk, not the tile centre, on the placement.
            const shift = -card.tile.trunk * width * sign;
            dummy.position.set(card.x + Math.cos(card.yaw) * shift, card.y, card.z - Math.sin(card.yaw) * shift);
            dummy.rotation.set(0, card.yaw, 0);
            dummy.scale.set(width, height, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            const u0 = card.tile.x / impostors.atlasWidth;
            const du = card.tile.pixels / impostors.atlasWidth;
            tileData.set([card.flip ? u0 + du : u0, card.flip ? -du : du, card.tone,
                card.tile.species === 'pine' ? 1 : 0], index * 4);
            lookData.set([card.phase, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    /**
     * The wooded hill and the fells behind it: silhouettes that close the far shore, each paler
     * than the one in front. A ridge is one strip from below the water to its crest; every post
     * carries the crest's height above it and its slope there (`_ridge`: height, slope, how
     * wooded), and the fragment draws the hill from those: the light that comes over the crest,
     * ribs falling from it, spruce to the treeline.
     */
    buildRidges() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const shapes = [];
        const indices = [];
        this.rangeSeed = 0;
        RIDGES.forEach(([z, crest, jagged, haze, seed], index) => {
            const steps = index === 0 ? HILL_STEPS : RIDGE_STEPS;
            const span = -z * 3.4;
            const base = positions.length / 3;
            // (Six draws a ridge from the theme's stream, as the ridges have always taken.)
            const offsets = Array.from({ length: 6 }, () => rng() * 6.283);
            if (index >= SILHOUETTES) {
                // The far ranges' own shape is seeded from the draws their silhouettes took.
                this.rangeSeed += Math.floor(offsets.reduce((sum, value) => sum + value, seed) * 1009);
                return;
            }
            const sunU = (Math.tan(RIDGE_SUN_AZIMUTH) * (RIDGE_EYE_Z - z)) / span;
            const profile = goldenForestRidgeCrest({
                offsets, jagged, seed, sunU,
            });
            const trees = ridgeRandom(seed * 7919 + 13);
            const wooded = index === 0 ? 1 : 0;
            const du = 1 / steps;
            for (let i = 0; i <= steps; i += 1) {
                const u = -0.5 + i * du;
                const x = u * span;
                // The wooded hill's crest is its treeline: spruce tops, no two the same height.
                const top = crest * profile(u) + wooded * (2 + trees() * 9);
                const slope = (crest * (profile(u + du) - profile(u - du))) / (2 * du * span);
                positions.push(x, -8, z, x, top, z);
                shades.push(haze, 0, haze, 1);
                shapes.push(top, slope, wooded, top, slope, wooded);
                if (i < steps) {
                    const a = base + i * 2;
                    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                }
            }
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(shades, 2));
        geometry.setAttribute('_ridge', new THREE.Float32BufferAttribute(shapes, 3));
        geometry.setIndex(indices);
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'GoldenForestRidges';
        material.colorNode = Fn(() => {
            const world = positionWorld;
            const ridge = attribute('_ridge', 'vec3'); // the crest's height here, its slope, how wooded
            const offset = world.sub(cameraPosition);
            const range = length(offset);
            const direction = offset.div(max(range, 0.001)).toVar();
            const sunward = saturate(dot(direction, light.uSunDir)).toVar();
            // Metres under the crest, and that as a share of the mountain's height.
            const under = max(ridge.x.sub(world.y), 0).toVar();
            const fall = under.div(max(ridge.x, 1)).toVar();
            // Gullies and ribs fall from the crest, leaning the way its slope leans.
            const lean = world.x.add(under.mul(ridge.y.mul(1.4)));
            const ribs = light.noise(vec2(lean.mul(0.011), under.mul(0.0022).add(world.z.mul(0.01)))).toVar();
            const grain = light.noise(vec2(lean.mul(0.045), world.y.mul(0.012))).toVar();
            const relief = ribs.g.mul(0.62).add(grain.b.mul(0.38)).toVar();
            // Rock, darker in its gullies; the wooded hill is spruce to its crest.
            const rock = mix(color(0x1c0d08), color(0x5e3220), relief.mul(0.7).add(fall.oneMinus().mul(0.3)));
            const wood = mix(color(0x0d1408), color(0x2c3212), grain.g);
            const flank = mix(rock, wood, max(ridge.z, smoothstep(0.5, 0.95, fall.add(ribs.b.sub(0.5).mul(0.3)))));
            // The sun stands beyond the ridges: their faces are lit by the sky.
            const shaded = flank.mul(light.ambient(vec3(0, 0.6, 0.8)).mul(1.5).add(light.uSunColor.mul(pow(sunward, 2)
                .mul(0.1))));
            // Light comes over the crest and a little way down every rib turned to it.
            const rim = exp(under.mul(-0.085)).mul(pow(sunward, 3).mul(0.9).add(0.1))
                .add(exp(under.mul(-0.02)).mul(smoothstep(0.55, 0.9, ribs.g)).mul(pow(sunward, 2)).mul(0.25));
            const lit = shaded.add(light.uSunColor.mul(flank).mul(rim).mul(0.55));
            // The clearer the air, the less of it lies over the far hills.
            const air = uv().x.mul(light.uClarity.mul(-0.2).add(1.12));
            return light.haze(lit, { world, strength: air });
        })();
        const ridges = new THREE.Mesh(geometry, material);
        ridges.name = 'GoldenForestRidges';
        ridges.frustumCulled = false;
        ridges.matrixAutoUpdate = false;
        this.group.add(ridges);
    }

    /**
     * The two far ranges: a grid over golden-forest-ranges.js's height function, with the
     * mesh's own normals. The sun stands beyond them, so no face the eye sees takes its light
     * straight; each is lit by the sky it is turned to: the bright, warm sky on the sun's side,
     * the dusk-cool sky away from it. Snow lies above its line on the gentler faces and takes
     * that light whole, so the alpenglow is rose on the sun's flanks and violet on the others.
     */
    buildRanges() {
        const { light, tier } = this;
        const R = GOLDEN_FOREST_RANGES;
        const [stepX, stepZ] = tier.post ? RANGE_GRID.fine : RANGE_GRID.coarse;
        const columns = Math.round((R.maxX - R.minX) / stepX);
        const rows = Math.round((R.maxZ - R.minZ) / stepZ);
        const { height } = createGoldenForestRanges(this.rangeSeed || 2341);
        const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
        for (let row = 0; row <= rows; row += 1) {
            const z = R.minZ + ((R.maxZ - R.minZ) * row) / rows;
            for (let column = 0; column <= columns; column += 1) {
                const x = R.minX + ((R.maxX - R.minX) * column) / columns;
                // (A little under the lake where there is no mountain, so no flat rim shows.)
                positions.set([x, height(x, z) - 6, z], (row * (columns + 1) + column) * 3);
            }
        }
        const indices = new Uint32Array(columns * rows * 6);
        let cursor = 0;
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const a = row * (columns + 1) + column;
                const b = a + 1;
                const c = a + columns + 1;
                indices.set([a, c, b, b, c, c + 1], cursor);
                cursor += 6;
            }
        }
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'GoldenForestRanges';
        material.colorNode = Fn(() => {
            const world = positionWorld;
            const grain = light.noise(world.xz.mul(0.0031).add(vec2(world.y.mul(0.004), 0))).toVar();
            const fine = light.noise(world.xz.mul(0.011).add(vec2(0, world.y.mul(0.013)))).toVar();
            const relief = grain.g.mul(0.6).add(fine.b.mul(0.4)).toVar();
            // The rock's own small faces bend the mesh's normal a little.
            const normal = normalize(normalWorld.add(vec3(fine.r.sub(0.5), 0, fine.g.sub(0.5)).mul(0.55))).toVar();
            const sunFlat = normalize(vec3(light.uSunDir.x, 0, light.uSunDir.z));
            // 1 where a face is turned to the sun's side of the sky, 0 where it is turned away.
            const side = saturate(dot(normal, sunFlat).mul(0.5).add(0.5)).toVar();
            const rock = mix(color(0x1a0f0b), color(0x66422e), relief.mul(0.75).add(normal.y.mul(0.25)));
            const scrub = mix(color(0x10160a), color(0x2e3414), grain.b);
            const wooded = smoothstep(96, 40, world.y.add(relief.mul(40))).mul(smoothstep(0.45, 0.8, normal.y));
            const ground = mix(rock, scrub, wooded);
            // Snow lies above its line, frayed by the rock, and slides off the steep faces.
            const snowLine = float(SNOW_LINE.from).add(relief.sub(0.5).mul(SNOW_LINE.band * 1.4));
            const snow = smoothstep(0, SNOW_LINE.band, world.y.sub(snowLine))
                .mul(smoothstep(0.42, 0.72, normal.y.add(relief.sub(0.5).mul(0.3))))
                .toVar();
            const albedo = mix(ground, vec3(0.74, 0.72, 0.72), snow);
            const warm = light.uSkyToward.mul(0.42).add(light.uSunColor.mul(0.05));
            const cool = light.uSkyLight.mul(1.1).add(light.uZenith.mul(1.6));
            const skyLight = mix(cool, warm, pow(side, 1.6)).mul(normal.y.mul(0.45).add(0.6));
            // The few faces that do look the sun in the eye: the crests' far shoulders.
            const direct = light.uSunColor.mul(saturate(dot(normal, light.uSunDir))).mul(0.9);
            const lit = albedo.mul(skyLight.add(direct));
            // The clearer the air, the less of it lies over the ranges; and what snow the sky lights
            // shows through the air more than rock does.
            const air = light.uClarity.mul(-0.26).add(1.1).sub(snow.mul(0.12));
            return light.haze(lit, { world, strength: air });
        })();
        const ranges = new THREE.Mesh(geometry, material);
        ranges.name = 'GoldenForestRanges';
        ranges.frustumCulled = false;
        ranges.matrixAutoUpdate = false;
        this.ranges = ranges;
        this.group.add(ranges);
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

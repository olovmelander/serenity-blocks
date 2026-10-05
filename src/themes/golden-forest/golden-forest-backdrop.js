/**
 * Golden Forest — the far shores and the mountains.
 *
 * Beyond the modelled conifers the forest continues as Blender-rendered sprites of the
 * same trees: each stores shading data rather than colour, so it is lit by the same low
 * sun, casts into the shared shadow map and fades into the same golden air. Behind the
 * last wooded hill, four mountain ridges stand one behind another, each paler than the
 * one in front.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, color, dot, float, instancedBufferAttribute, mix, normalize, positionLocal, positionWorld,
    pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { GOLDEN_FOREST_VIEWS, goldenForestEye } from './golden-forest-composition.js';
import { goldenForestGroundHeight, goldenForestShores } from './golden-forest-terrain.js';

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
// z, base crest height, how jagged, haze strength, seed.
const RIDGES = [
    [-560, 74, 0.5, 0.9, 3],
    [-780, 128, 0.8, 0.95, 11],
    [-1050, 205, 1.1, 0.985, 23],
    [-1420, 300, 1.3, 1, 41],
];

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
                        y: goldenForestGroundHeight(x, z) - 0.3,
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
            .add(albedo.mul(light.ambient(vec3(0, 0.5, 0.86))).mul(1.3));
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

    /** Mountain ridges that close the horizon, each a paler silhouette than the last. */
    buildRidges() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const indices = [];
        RIDGES.forEach(([z, crest, jagged, haze, seed]) => {
            const steps = 220;
            const span = -z * 3.4;
            const base = positions.length / 3;
            const offsets = Array.from({ length: 6 }, () => rng() * 6.283);
            for (let i = 0; i <= steps; i += 1) {
                const x = -span / 2 + (span * i) / steps;
                const u = x / span;
                // Broad massifs, then shoulders, then the broken edge of the rock itself.
                const massif = 0.52 + 0.3 * Math.sin(u * 9 + offsets[0]) + 0.18 * Math.sin(u * 23 + offsets[1]);
                const peaks = Math.abs(Math.sin(u * 41 + offsets[2])) * 0.2
                    + Math.abs(Math.sin(u * 97 + offsets[3])) * 0.07;
                const rock = (Math.sin(u * 310 + offsets[4]) + Math.sin(u * 730 + offsets[5]) * 0.5) * 0.012 * jagged;
                // One summit stands over the right shore, as it always has.
                const summit = Math.exp(-(((u - 0.115) / 0.07) ** 2)) * 0.5 * (seed > 20 ? 1 : 0.35);
                const top = crest * Math.max(0.12, massif + peaks * jagged + rock + summit);
                positions.push(x, -8, z, x, top, z);
                shades.push(haze, 0, haze, 1);
                if (i < steps) {
                    const a = base + i * 2;
                    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                }
            }
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(shades, 2));
        geometry.setIndex(indices);
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'GoldenForestRidges';
        const world = positionWorld;
        const direction = normalize(world.sub(cameraPosition));
        const sunward = saturate(dot(direction, light.uSunDir));
        // Forested flanks, bare rock toward the crest, and a breath of light on the sunward side.
        const grain = light.noise(world.xy.mul(0.006));
        const flank = mix(color(0x241008), color(0x5a2a14), grain.g.mul(0.6).add(uv().y.mul(0.4)));
        const lit = flank.mul(light.ambient(vec3(0, 0.6, 0.8)).mul(1.5)
            .add(light.uSunColor.mul(pow(sunward, 2).mul(0.1))));
        material.colorNode = light.haze(lit, { world, strength: uv().x.mul(float(1.05)) });
        const ridges = new THREE.Mesh(geometry, material);
        ridges.name = 'GoldenForestRidges';
        ridges.frustumCulled = false;
        ridges.matrixAutoUpdate = false;
        this.group.add(ridges);
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

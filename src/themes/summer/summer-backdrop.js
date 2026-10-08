/**
 * Summer — the far shores and the blue hills.
 *
 * Beyond the modelled trees the woods continue as Blender-rendered sprites of the same
 * birches and spruces: each stores shading data rather than colour, so it is lit by the
 * same low sun, casts into the shared shadow map and fades into the same evening air.
 * Behind the last wooded hill, four ridges stand one behind another, each bluer and paler
 * than the one in front.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, color, dot, float, instancedBufferAttribute, mix, normalize, positionLocal, positionWorld,
    pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { SUMMER_VIEWS, summerEye } from './summer-composition.js';
import { summerGroundHeight, summerShores } from './summer-terrain.js';

const BIRCH_RAMP = [0x12300b, 0x2c6414, 0x5c9a22, 0x9cc440];
const SPRUCE_RAMP = [0x06120a, 0x0f2810, 0x1f4016, 0x3f5c1c];
// Where sprite trees stand: a sampling box, the land that counts, and the band's share.
const SPRITE_BANDS = [
    { box: [-380, 380, -466, -296], on: (s) => s.far > 3, share: 0.5 },
    { box: [-256, -34, -164, -98], on: (s) => s.headland > 4, share: 0.17 },
    { box: [58, 210, -230, -30], on: (s) => s.right > 9, share: 0.2 },
    { box: [42, 110, -44, -4], on: (s) => s.homestead > 6, share: 0.06 },
    { box: [-330, -66, -90, 34], on: (s) => s.near > 14, share: 0.04 },
    { box: [62, 320, -8, 40], on: (s) => s.near > 12, share: 0.03 },
];
// z, base crest height, how rolling, haze strength, seed.
const RIDGES = [
    [-640, 70, 0.5, 1.4, 3],
    [-860, 112, 0.7, 1.35, 11],
    [-1150, 168, 0.9, 1.3, 23],
    [-1540, 236, 1.0, 1.25, 41],
];

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

export class SummerBackdrop {
    constructor({
        light, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerFarShores';
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
        const birches = tiles.filter((tile) => tile.species === 'birch');
        const spruces = tiles.filter((tile) => tile.species !== 'birch');
        const eye = summerEye(SUMMER_VIEWS.landscape);
        SPRITE_BANDS.forEach((band) => {
            const wanted = Math.round(this.tier.farTrees * band.share);
            let made = 0;
            for (let attempt = 0; made < wanted && attempt < wanted * 12; attempt += 1) {
                const x = band.box[0] + (band.box[1] - band.box[0]) * rng();
                // Bias toward the front edge of the band: the shoreline carries the picture.
                const z = band.box[3] + (band.box[2] - band.box[3]) * rng() ** 1.6;
                const shores = summerShores(x, z);
                if (band.on(shores)) {
                    // Birches keep to the water's edge; the hills behind are spruce.
                    const edge = Math.max(shores.far, shores.headland, shores.right, shores.homestead, shores.near);
                    const list = (rng() < (edge < 14 ? 0.6 : 0.18) && birches.length) || !spruces.length
                        ? birches : spruces;
                    const tile = list[Math.floor(rng() * list.length) % list.length];
                    cards.push({
                        x,
                        z,
                        y: summerGroundHeight(x, z) - 0.3,
                        tile,
                        scale: 0.9 + rng() * 0.5,
                        flip: rng() < 0.5,
                        tone: THREE.MathUtils.clamp(
                            0.5 + Math.sin(x * 0.035 + z * 0.05) * 0.28 + (rng() - 0.5) * 0.36,
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
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, birch
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SummerFarShoreSprites';
        material.shadowSide = THREE.DoubleSide;
        const st = uv();
        const atlasUv = vec2(tile.x.add(st.x.mul(tile.y)), st.y);
        const data = texture(impostors.texture, atlasUv); // shade, leaf mask, hue seed, coverage
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.6).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));
        material.maskShadowNode = data.a.greaterThan(0.5);

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const tone = saturate(tile.z.mul(0.62).add(data.b.sub(0.5).mul(0.3)).add(data.r.mul(0.3)));
        const leaf = mix(ramp(SPRUCE_RAMP, tone), ramp(BIRCH_RAMP, tone), tile.w);
        // A birch's trunk is white from the ground up; a spruce's is in shadow.
        const bark = mix(color(0x1c140e), color(0xcfc9ba), tile.w);
        const albedo = mix(bark, leaf, data.g).mul(data.r.mul(0.85).add(0.15));
        const glowing = pow(leaf, vec3(0.62)).mul(mix(vec3(1.5, 1.2, 0.3), vec3(1.45, 1.5, 0.32), tile.w))
            .mul(data.g).mul(data.r);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4);
        const sun = light.sunlight();
        const lit = albedo.mul(0.14).add(glowing.mul(through.mul(0.7).add(0.08))).mul(light.uSunColor).mul(sun)
            .mul(mix(float(0.6), float(0.36), tile.w))
            .add(albedo.mul(light.ambient(vec3(0, 0.5, 0.86))).mul(1.15));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'SummerFarShore';
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
                card.tile.species === 'birch' ? 1 : 0], index * 4);
            lookData.set([card.phase, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    /** Wooded ridges that close the horizon, each a bluer, paler silhouette than the last. */
    buildRidges() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const indices = [];
        RIDGES.forEach(([z, crest, rolling, haze]) => {
            const steps = 220;
            const span = -z * 3.4;
            const base = positions.length / 3;
            const offsets = Array.from({ length: 6 }, () => rng() * 6.283);
            for (let i = 0; i <= steps; i += 1) {
                const x = -span / 2 + (span * i) / steps;
                const u = x / span;
                // Long whalebacks worn down by ice, then the saw-edge of the spruce on them.
                const massif = 0.5 + 0.3 * Math.sin(u * 7 + offsets[0]) + 0.16 * Math.sin(u * 17 + offsets[1]);
                const shoulders = Math.sin(u * 37 + offsets[2]) * 0.08 + Math.sin(u * 71 + offsets[3]) * 0.03;
                const spruce = (Math.abs(Math.sin(u * 620 + offsets[4]))
                    + Math.abs(Math.sin(u * 1130 + offsets[5])) * 0.6)
                    * 0.012;
                const top = crest * Math.max(0.14, massif + shoulders * rolling + spruce);
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
        material.name = 'SummerRidges';
        const world = positionWorld;
        const direction = normalize(world.sub(cameraPosition));
        const sunward = saturate(dot(direction, light.uSunDir));
        const grain = light.noise(world.xy.mul(0.006));
        const flank = mix(color(0x0d1f10), color(0x25401c), grain.g.mul(0.6).add(uv().y.mul(0.4)));
        const lit = flank.mul(light.ambient(vec3(0, 0.6, 0.8)).mul(1.4)
            .add(light.uSunColor.mul(pow(sunward, 2).mul(0.08))));
        material.colorNode = light.haze(lit, { world, strength: uv().x });
        const ridges = new THREE.Mesh(geometry, material);
        ridges.name = 'SummerRidges';
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

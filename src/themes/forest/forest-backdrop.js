/**
 * Forest — the stands beyond and the hills across the valley.
 *
 * Beyond the modelled trees the forest continues as Blender-rendered sprites of the same
 * trees: each stores shading data rather than colour, so it is lit by the same moon, casts
 * into the shared shadow map and fades into the same night air. They close the plateau
 * behind the old wood and carpet the valley the ride looks down into. Across the valley,
 * four wooded ridges stand one behind another, each paler than the one in front.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, color, dot, float, instancedBufferAttribute, mix, normalize, positionLocal, positionWorld,
    pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { FOREST_VIEWS, forestEye } from './forest-composition.js';
import { forestRide, forestRideHalfWidth } from './forest-plan.js';
import { forestGroundHeight, forestPlateau } from './forest-terrain.js';

const SPRUCE_RAMP = [0x030b07, 0x0a1d10, 0x16321a, 0x2e4c26];
const PINE_RAMP = [0x05120b, 0x0f2618, 0x1e3d24, 0x3b5a30];
const BIRCH_RAMP = [0x0a1a0a, 0x1a3512, 0x33551c, 0x5d7a2a];
// Where sprite trees stand: a sampling box (x0, x1, z0, z1), the land that counts, the
// band's share, and how tall its trees may be.
const SPRITE_BANDS = [
    // The plateau behind the modelled stands, right and left of the ride.
    {
        box: [-20, 150, -210, -70], on: (x, z) => forestPlateau(x, z) > 0.7, share: 0.26, scale: [0.9, 1.35],
    },
    {
        box: [-230, -40, -230, -20], on: (x, z) => forestPlateau(x, z) > 0.7, share: 0.24, scale: [0.9, 1.35],
    },
    // The valley: its sides, and the forest on its floor far below the eye.
    {
        box: [-240, 60, -330, -90],
        on: (x, z) => {
            const plateau = forestPlateau(x, z);
            return plateau > 0.12 && plateau <= 0.7;
        },
        share: 0.22,
        scale: [0.8, 1.2],
    },
    {
        box: [-250, 20, -380, -150], on: (x, z) => forestPlateau(x, z) <= 0.12, share: 0.28, scale: [0.75, 1.15],
    },
];
// z, base crest height, how broken, haze strength, seed.
const RIDGES = [
    [-600, 44, 0.5, 0.9, 3],
    [-820, 76, 0.8, 0.95, 11],
    [-1080, 116, 1.0, 0.985, 23],
    [-1440, 168, 1.2, 1, 41],
];

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

export class ForestBackdrop {
    constructor({
        light, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'ForestFarStands';
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

    layout() {
        const { rng } = this;
        const cards = [];
        // Only full-grown trees make a far stand.
        const tiles = this.impostors.tiles.filter((tile) => tile.height > 12);
        const pool = tiles.length ? tiles : this.impostors.tiles;
        const eye = forestEye(FOREST_VIEWS.landscape);
        SPRITE_BANDS.forEach((band) => {
            const wanted = Math.round(this.tier.farTrees * band.share);
            let made = 0;
            for (let attempt = 0; made < wanted && attempt < wanted * 14; attempt += 1) {
                const x = band.box[0] + (band.box[1] - band.box[0]) * rng();
                const z = band.box[3] + (band.box[2] - band.box[3]) * rng() ** 1.4;
                const { s, d } = forestRide(x, z);
                // Nothing tall stands on the floor of the ride itself, out to where it opens.
                const inRide = s < 150 && Math.abs(d) < forestRideHalfWidth(s) + 3;
                if (!inRide && band.on(x, z)) {
                    const tile = pool[Math.floor(rng() * pool.length) % pool.length];
                    cards.push({
                        x,
                        z,
                        y: forestGroundHeight(x, z) - 0.3,
                        tile,
                        scale: band.scale[0] + rng() * (band.scale[1] - band.scale[0]),
                        flip: rng() < 0.5,
                        tone: THREE.MathUtils.clamp(
                            0.42 + Math.sin(x * 0.035 + z * 0.05) * 0.3 + (rng() - 0.5) * 0.36,
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
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, species
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'ForestFarStandSprites';
        material.shadowSide = THREE.DoubleSide;
        const st = uv();
        const atlasUv = vec2(tile.x.add(st.x.mul(tile.y)), st.y);
        const data = texture(impostors.texture, atlasUv); // shade, foliage mask, hue seed, coverage
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.5).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));
        material.maskShadowNode = data.a.greaterThan(0.5);

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const tone = saturate(tile.z.mul(0.62).add(data.b.sub(0.5).mul(0.3)).add(data.r.mul(0.3)));
        // species: 0 spruce, 1 pine, 2 birch
        const pine = saturate(float(1).sub(tile.w.sub(1).abs()));
        const birch = saturate(tile.w.sub(1));
        const leaf = mix(mix(ramp(SPRUCE_RAMP, tone), ramp(PINE_RAMP, tone), pine), ramp(BIRCH_RAMP, tone), birch);
        const bark = mix(color(0x120d0a), color(0xb4bcc2), birch);
        const albedo = mix(bark, leaf, data.g).mul(data.r.mul(0.85).add(0.15));
        const silver = pow(leaf, vec3(0.6)).mul(vec3(0.55, 0.88, 1.25)).mul(data.g).mul(data.r);
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 4);
        const moon = light.moonlight();
        const glow = light.glow(world);
        const lit = albedo.mul(0.16).add(silver.mul(through.add(0.1))).mul(light.moonColour()).mul(moon)
            .add(albedo.mul(light.ambient(vec3(0, 0.5, 0.86))).mul(1.3))
            .add(albedo.mul(1.5).mul(glow));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world, glow }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'ForestFarStand';
        const dummy = new THREE.Object3D();
        const speciesIndex = { spruce: 0, pine: 1, birch: 2 };
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
                speciesIndex[card.tile.species] ?? 0], index * 4);
            lookData.set([card.phase, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
    }

    /** Wooded ridges across the valley, each a paler silhouette than the last. */
    buildRidges() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const indices = [];
        RIDGES.forEach(([z, crest, broken, haze]) => {
            const steps = 220;
            const span = -z * 3.6;
            const base = positions.length / 3;
            const offsets = Array.from({ length: 6 }, () => rng() * 6.283);
            for (let i = 0; i <= steps; i += 1) {
                const x = -span / 2 + (span * i) / steps;
                const u = x / span;
                // Long backs, then shoulders, then the saw edge of the spruce along the crest.
                const backs = 0.56 + 0.28 * Math.sin(u * 8 + offsets[0]) + 0.16 * Math.sin(u * 21 + offsets[1]);
                const shoulders = Math.abs(Math.sin(u * 37 + offsets[2])) * 0.14;
                const spires = (Math.abs(Math.sin(u * 420 + offsets[4]))
                    + Math.abs(Math.sin(u * 910 + offsets[5])) * 0.6)
                    * 0.022 * broken;
                const top = crest * Math.max(0.14, backs + shoulders * broken + spires);
                positions.push(x, -30, z, x, top, z);
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
        material.name = 'ForestRidges';
        const world = positionWorld;
        const direction = normalize(world.sub(cameraPosition));
        const moonward = saturate(dot(direction, light.uMoonDir));
        const grain = light.noise(world.xy.mul(0.006));
        const flank = mix(color(0x04090b), color(0x0d1a1c), grain.g.mul(0.6).add(uv().y.mul(0.4)));
        const lit = flank.mul(light.ambient(vec3(0, 0.6, 0.8)).mul(1.6)
            .add(light.moonColour().mul(pow(moonward, 2).mul(0.06))));
        material.colorNode = light.haze(lit, { world, strength: uv().x.mul(float(1.05)) });
        const ridges = new THREE.Mesh(geometry, material);
        ridges.name = 'ForestRidges';
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

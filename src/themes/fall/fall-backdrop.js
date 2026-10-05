/**
 * Fall — the deep forest.
 *
 * Beyond the modelled grove the wood continues as Blender-rendered sprites of the same
 * trees. Each sprite stores shading data rather than colour (shade, leaf mask, hue seed),
 * so every far tree takes its own place on the autumn ramp, is lit by the same low sun,
 * casts into the shared shadow map, and fades into the same haze as the trees in front.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, color, dot, float, instancedBufferAttribute, mix, normalize, positionLocal, positionWorld,
    pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { FALL_VIEWS } from './fall-composition.js';
import { fallPathDistance, fallTerrainHeight } from './fall-terrain.js';

const MAPLE_RAMP = [0x5c0a08, 0xa8200a, 0xd0560c, 0xdc9416];
const BIRCH_RAMP = [0xb8780c, 0xd8a012, 0xe8c226, 0xdcd04a];

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

export class FallBackdrop {
    constructor({
        light, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallDeepForest';
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

    /** Far trees in priority order, thinning toward the sunlit corridor of the path. */
    layout() {
        const { rng } = this;
        const cards = [];
        const { tiles } = this.impostors;
        const eye = FALL_VIEWS.landscape.position;
        for (let attempt = 0; cards.length < this.tier.farTrees && attempt < this.tier.farTrees * 8; attempt += 1) {
            const depth = rng() ** 0.8;
            const z = -46 - depth * 104;
            const reach = 58 + -z * 0.62;
            const x = (rng() * 2 - 1) * reach;
            const corridor = 6 + -z * 0.06;
            if (fallPathDistance(x, z) >= corridor) {
                const tile = tiles[Math.floor(rng() * tiles.length) % tiles.length];
                const scale = 1.05 + rng() * 0.55 + depth * 0.35;
                cards.push({
                    x,
                    z,
                    y: fallTerrainHeight(x, z) - 0.25,
                    tile,
                    scale,
                    flip: rng() < 0.5,
                    tone: THREE.MathUtils.clamp(0.5 + Math.sin(x * 0.045 + z * 0.06) * 0.34 + (rng() - 0.5) * 0.36, 0, 1),
                    phase: rng(),
                    yaw: Math.atan2(eye[0] - x, eye[2] - z),
                });
            }
        }
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
        material.name = 'FallDeepForestSprites';
        material.shadowSide = THREE.DoubleSide;
        const st = uv();
        const atlasUv = vec2(tile.x.add(st.x.mul(tile.y)), st.y);
        const data = texture(impostors.texture, atlasUv); // shade, leaf mask, hue seed, coverage
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.7).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.011)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));
        material.maskShadowNode = data.a.greaterThan(0.5);

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const tone = saturate(tile.z.add(data.b.sub(0.5).mul(0.5)));
        const leaf = mix(ramp(MAPLE_RAMP, tone), ramp(BIRCH_RAMP, saturate(tone.mul(0.5).add(0.5))), tile.w);
        const bark = mix(color(0x241710), color(0xb8ae9c), tile.w);
        const albedo = mix(bark, leaf, data.g).mul(data.r.mul(0.85).add(0.15));
        const glowing = pow(leaf, vec3(0.78)).mul(vec3(1.3, 1.08, 0.66)).mul(data.g).mul(data.r);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3);
        const sun = light.sunlight();
        const lit = albedo.mul(0.2).add(glowing.mul(through.mul(1.1).add(0.42))).mul(light.uSunColor).mul(sun)
            .add(albedo.mul(light.ambient(vec3(0, 0.55, 0.83))).mul(1.45));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'FallDeepForest';
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

    /** Wooded ridges that close the horizon behind the last trees. */
    buildRidges() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const indices = [];
        [[-168, 20, 0.62], [-205, 34, 0.5], [-250, 52, 0.4]].forEach(([z, crest, shade], layer) => {
            const steps = 96;
            const span = 520 + layer * 120;
            const base = positions.length / 3;
            const offsets = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
            for (let i = 0; i <= steps; i += 1) {
                const x = -span / 2 + (span * i) / steps;
                const top = crest * (0.62 + 0.2 * Math.sin(x * 0.011 + offsets[0]) + 0.12 * Math.sin(x * 0.031 + offsets[1]))
                    + 2.2 * Math.sin(x * 0.19 + offsets[2]) + (i % 2) * 1.6;
                positions.push(x, -6, z, x, top, z);
                shades.push(shade, shade);
                if (i < steps) {
                    const a = base + i * 2;
                    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
                }
            }
        });
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(shades.flatMap((shade) => [shade, 0]), 2));
        geometry.setIndex(indices);
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'FallWoodedRidges';
        const world = positionWorld;
        const canopy = mix(color(0x3a1a0c), color(0x8a4a12), light.noise(world.xy.mul(0.02)).g);
        const lit = canopy.mul(uv().x).mul(light.ambient(vec3(0, 0.7, 0.7)).mul(1.6)
            .add(light.uSunColor.mul(0.16)));
        material.colorNode = light.haze(lit, { world, strength: float(0.94) });
        const ridges = new THREE.Mesh(geometry, material);
        ridges.name = 'FallWoodedRidges';
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

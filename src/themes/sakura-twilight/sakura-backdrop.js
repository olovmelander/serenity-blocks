/**
 * Sakura Twilight — the far side of the lake.
 *
 * The mountain (a Blender-built cone whose vertex colours carry snow and relief), the
 * layered hills at its feet, and the cherry-lined far shore drawn as data sprites of the
 * grove trees. Every part is lit by the same moon and the same dying afterglow, and
 * dissolves into the same air, as the garden in front of it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, color, dot, instancedBufferAttribute, mix, normalWorld, normalize, positionLocal,
    positionWorld, pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { SAKURA_FUJI, SAKURA_VIEWS } from './sakura-composition.js';
import { sakuraLand, sakuraTerrainHeight } from './sakura-terrain.js';

export class SakuraBackdrop {
    constructor({
        light, fuji, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.fuji = fuji;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraFarShore';
        this.owned = [];
        this.count = 0;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (this.fuji?.geometry) this.buildMountain();
        this.buildHills();
        if (this.impostors?.texture && this.impostors.tiles?.length) this.buildShoreTrees();
        return this;
    }

    buildMountain() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SakuraMountain';
        const paint = attribute('color', 'vec4'); // snow, relief shade, height, -
        const world = positionWorld;
        const normal = normalize(normalWorld);
        const grain = light.noise(world.xz.mul(0.011)).g;
        const snow = smoothstep(0.42, 0.62, paint.r.add(grain.sub(0.5).mul(0.3)));
        const rock = mix(color(0x0c0d1f), color(0x1c1c38), grain).mul(paint.g.mul(0.7).add(0.3));
        const albedo = mix(rock, mix(color(0x9aa2c8), color(0xe9ecff), paint.g), snow);
        // Moon on the right flank, the last rose of the sunset on the left: alpenglow.
        const moonFacing = saturate(dot(normal, light.uMoonDir).mul(0.7).add(0.3));
        const west = normalize(vec3(light.uGlowDir.x, 0.25, light.uGlowDir.y));
        const rose = pow(saturate(dot(normal, west).mul(0.6).add(0.4)), 1.6);
        const lit = albedo.mul(light.uMoonColor).mul(moonFacing).mul(0.55)
            .add(albedo.mul(light.uAfterglow).mul(rose).mul(paint.b.mul(0.7).add(0.3)).mul(0.5))
            .add(albedo.mul(light.ambient(normal)).mul(1.6));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.Mesh(this.fuji.geometry, material);
        mesh.name = 'SakuraMountain';
        mesh.position.set(SAKURA_FUJI.x, SAKURA_FUJI.y, SAKURA_FUJI.z);
        mesh.scale.setScalar(SAKURA_FUJI.height);
        // Turn the shoulder crater away so the classic clean cone faces the garden.
        mesh.rotation.y = 0.9;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    /** Hills that close the horizon either side of the mountain. */
    buildHills() {
        const { light, rng } = this;
        const positions = [];
        const shades = [];
        const indices = [];
        [[-232, 17, 0.9, 760], [-300, 30, 0.72, 980], [-390, 44, 0.56, 1300]].forEach(([z, crest, shade, span]) => {
            const steps = 110;
            const base = positions.length / 3;
            const offsets = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
            for (let i = 0; i <= steps; i += 1) {
                const x = -span / 2 + (span * i) / steps;
                const top = crest * (0.55 + 0.26 * Math.sin(x * 0.0083 + offsets[0]) + 0.16 * Math.sin(x * 0.023 + offsets[1]))
                    + 1.8 * Math.sin(x * 0.13 + offsets[2]);
                positions.push(x, -4, z, x, Math.max(2, top), z);
                shades.push(shade, 0, shade, 1);
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
        material.name = 'SakuraHills';
        const world = positionWorld;
        // Wooded slopes: dark pines with drifts of cherry pink through them.
        const wood = mix(color(0x0a1016), color(0x151b2a), light.noise(world.xy.mul(0.017)).g);
        const blossom = smoothstep(0.56, 0.78, light.noise(world.xy.mul(vec2(0.013, 0.05))).b)
            .mul(smoothstep(0.1, 0.7, uv().y).oneMinus());
        const slope = mix(wood, color(0x5d3350), blossom.mul(0.6)).mul(uv().x);
        const lit = slope.mul(light.ambient(vec3(0, 0.7, 0.7)).mul(2.4).add(light.uMoonColor.mul(0.1)));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const hills = new THREE.Mesh(geometry, material);
        hills.name = 'SakuraHills';
        hills.frustumCulled = false;
        hills.matrixAutoUpdate = false;
        this.group.add(hills);
    }

    /** Far trees in priority order along the shores the modelled grove does not reach. */
    layout() {
        const { rng } = this;
        const cards = [];
        const { tiles } = this.impostors;
        const eye = SAKURA_VIEWS.landscape.position;
        for (let attempt = 0; cards.length < this.tier.farTrees && attempt < this.tier.farTrees * 12; attempt += 1) {
            // Two thirds line the far shore; the rest thicken the backs of the two points.
            const shore = rng() < 0.68;
            const x = shore ? (rng() * 2 - 1) * 330 : (rng() < 0.5 ? -1 : 1) * (44 + rng() * 52);
            const z = shore ? -156 - rng() ** 1.6 * 52 : -22 - rng() * 62;
            if (sakuraLand(x, z) > 2.5) {
                const tile = tiles[Math.floor(rng() * tiles.length) % tiles.length];
                cards.push({
                    x,
                    z,
                    y: sakuraTerrainHeight(x, z) - 0.2,
                    tile,
                    scale: (shore ? 1.25 : 1.05) + rng() * 0.6,
                    flip: rng() < 0.5,
                    tone: THREE.MathUtils.clamp(0.5 + Math.sin(x * 0.045 + z * 0.06) * 0.3 + (rng() - 0.5) * 0.44, 0, 1),
                    phase: rng(),
                    lamp: rng() < 0.36 ? 0.5 + rng() * 0.5 : 0,
                    yaw: Math.atan2(eye[0] - x, eye[2] - z),
                });
            }
        }
        return cards;
    }

    buildShoreTrees() {
        const { light, impostors } = this;
        const cards = this.layout();
        this.count = cards.length;
        if (!cards.length) return;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1, 1, 4));
        geometry.translate(0, 0.5, 0);
        const tileData = new Float32Array(cards.length * 4);
        const lookData = new Float32Array(cards.length * 4);
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, lamp
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'SakuraFarShoreSprites';
        const st = uv();
        const data = texture(impostors.texture, vec2(tile.x.add(st.x.mul(tile.y)), st.y)); // shade, blossom, hue, cover
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.7).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));

        const world = positionWorld;
        const tone = saturate(tile.z.add(data.b.sub(0.5).mul(0.5)));
        const petal = mix(color(0xffe9ef), color(0xf28fb0), tone);
        const albedo = mix(color(0x120c0e), petal, data.g).mul(data.r.mul(0.85).add(0.15));
        // Festival lanterns under some of the far trees warm their lower boughs.
        const underlit = light.uLampColor.mul(tile.w).mul(smoothstep(0.05, 0.75, st.y).oneMinus())
            .mul(light.uLampGain).mul(0.16);
        const lit = albedo.mul(light.uMoonColor).mul(light.moonlight()).mul(0.42)
            .add(albedo.mul(light.ambient(vec3(0, 0.6, 0.8))).mul(2.3))
            .add(albedo.mul(underlit))
            .add(petal.mul(data.g).mul(data.r).mul(light.uGlow).mul(0.12));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'SakuraFarShoreTrees';
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
            tileData.set([card.flip ? u0 + du : u0, card.flip ? -du : du, card.tone, card.lamp], index * 4);
            lookData.set([card.phase, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.cards = cards;
        this.group.add(mesh);
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

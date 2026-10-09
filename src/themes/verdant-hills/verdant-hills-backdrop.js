/**
 * Verdant Hills — the trees of the far hills.
 *
 * Beyond the modelled oaks the hedgerow trees, the copses on the crests and the lone
 * oaks of the far pastures are Blender-rendered sprites of the same four trees: each
 * stores shading data rather than colour, so it is lit by the same high sun, darkens
 * under the same passing clouds and fades into the same summer air. A tier that models
 * fewer of the field trees draws the rest here, in the same places and at the same size,
 * so every shadow baked into the land keeps its tree. There are no painted ridges behind
 * them: the land itself reaches the horizon.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, color, dot, float, instancedBufferAttribute, mix, normalize, positionLocal, positionWorld,
    pow, saturate, sin, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { VERDANT_HILLS_VIEWS, verdantHillsEye } from './verdant-hills-composition.js';
import {
    VERDANT_HILLS_SPRITE_CELLS, VERDANT_HILLS_TREE_SHAPES, layoutVerdantHillsFarTrees, layoutVerdantHillsFieldTrees,
} from './verdant-hills-layout.js';
import { verdantHillsGroundHeight } from './verdant-hills-terrain.js';
import { VERDANT_HILLS_OAK_RAMP } from './verdant-hills-trees.js';

/** How much lighter a sprite's leaf and bark are painted than the modelled tree's. */
const SPRITE_LIFT = 1.15;

function ramped(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

/** 0..1 from a place, for what a field tree's sprite needs and its record does not carry. */
function placeHash(x, z, salt) {
    const value = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
    return value - Math.floor(value);
}

export class VerdantHillsBackdrop {
    /** `rng` is accepted for symmetry with the other parts: the layout plants from its own seed. */
    constructor({
        light, impostors, tier, rng = Math.random,
    }) {
        this.light = light;
        this.impostors = impostors;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsFarTrees';
        this.owned = [];
        /** Sprites drawn: the tier's far trees and the field trees it does not model. */
        this.count = 0;
        this.stats = { farTrees: 0, fieldSprites: 0 };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        if (this.impostors?.texture && this.impostors.tiles?.length) this.buildTrees();
        return this;
    }

    /** The sheet's tile for a cell of the layout: by the tree's name, else by its place in the sheet. */
    tileFor(cell) {
        const { tiles } = this.impostors;
        return tiles.find((tile) => tile.asset === VERDANT_HILLS_SPRITE_CELLS[cell]) || tiles[cell % tiles.length];
    }

    /** Every sprite of this tier: the far trees nearest first, then the field trees left unmodelled. */
    layout() {
        const eye = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
        const far = layoutVerdantHillsFarTrees(null, this.tier.farTrees);
        const field = layoutVerdantHillsFieldTrees().slice(this.tier.fieldTrees).map((tree) => ({
            ...tree, flip: false, phase: placeHash(tree.x, tree.z, 1),
        }));
        this.stats.farTrees = far.length;
        this.stats.fieldSprites = field.length;
        return [...far, ...field].map((tree) => {
            const tile = this.tileFor(tree.cell);
            const shape = VERDANT_HILLS_TREE_SHAPES[tile.asset];
            return {
                x: tree.x,
                z: tree.z,
                // A sprite's foot is set a little into the turf: its tile is cut at the root flare.
                y: verdantHillsGroundHeight(tree.x, tree.z) - 0.25,
                tile,
                // The tile is a picture of the whole modelled tree: scale it as that tree is scaled.
                scale: tree.height / (shape ? shape.height : tile.height),
                flip: tree.flip,
                tone: tree.tone,
                phase: tree.phase,
                yaw: Math.atan2(eye[0] - tree.x, eye[2] - tree.z),
            };
        });
    }

    buildTrees() {
        const { light, impostors } = this;
        const cards = this.layout();
        this.count = cards.length;
        if (!cards.length) return;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1, 1, 4));
        geometry.translate(0, 0.5, 0);
        const tileData = new Float32Array(cards.length * 4);
        const lookData = new Float32Array(cards.length * 4);
        const tile = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tileData, 4)); // u0, du, tone, -
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4)); // phase, height, -, -
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'VerdantHillsFarTreeSprites';
        const st = uv();
        const atlasUv = vec2(tile.x.add(st.x.mul(tile.y)), st.y);
        const data = texture(impostors.texture, atlasUv); // shade, leaf mask, hue seed, coverage
        const force = light.uWind.add(light.uGust);
        const sway = sin(light.uTime.mul(0.6).add(look.x.mul(6.283))).mul(st.y.mul(st.y)).mul(look.y).mul(0.009)
            .mul(force);
        material.positionNode = positionLocal.add(vec3(light.uWindDir.x.mul(sway), 0, light.uWindDir.z.mul(sway)));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        // A card is flat, a crown is not: give it the facing of a dome standing on the card,
        // so its sunward shoulder is lit and its other side falls away into shade.
        const toLens = normalize(vec3(cameraPosition.x.sub(world.x), 0, cameraPosition.z.sub(world.z)));
        const side = vec3(toLens.z, 0, toLens.x.negate());
        const across = st.x.sub(0.5).mul(2);
        const up = st.y.sub(0.56).mul(2.1);
        const out = saturate(float(1).sub(across.mul(across)).sub(up.mul(up))).sqrt().max(0.18);
        const normal = normalize(side.mul(across).add(vec3(0, 1, 0).mul(up)).add(toLens.mul(out)));
        const tone = saturate(tile.z.mul(0.62).add(data.b.sub(0.5).mul(0.3)).add(data.r.mul(0.3)));
        const leaf = ramped(VERDANT_HILLS_OAK_RAMP, tone);
        // A little lighter than the modelled leaf: a sprite's own baked shade is laid over it.
        const albedo = mix(color(0x6a6154), leaf, data.g).mul(data.r.mul(0.85).add(0.15)).mul(SPRITE_LIFT);
        const glowing = pow(leaf, vec3(0.62)).mul(vec3(1.25, 1.5, 0.28)).mul(data.g).mul(data.r.mul(0.6).add(0.4));
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 4);
        const sunward = dot(normal, light.uSunDir);
        const wrap = saturate(sunward.mul(0.55).add(0.45));
        // The sun is high, ahead and to one side: it lights the top of every crown and the
        // shoulder turned to it, in a clear cap; the side the lens sees is lit through its leaves.
        const cap = smoothstep(0.15, 0.8, up.add(across.mul(dot(side, light.uSunDir)).mul(0.6)));
        const behind = saturate(sunward.negate());
        // The clouds' shadows cross the far trees as they cross the hills they stand on.
        const sun = light.sunlight(world);
        const direct = albedo.mul(wrap.mul(0.5).add(cap.mul(0.45)).add(0.06))
            .add(glowing.mul(through.mul(0.7).add(behind.mul(0.26)).add(cap.mul(0.1))));
        const lit = direct.mul(light.uSunColor).mul(sun).mul(0.3).add(albedo.mul(light.ambient(normal)).mul(0.95));
        material.fragmentNode = Fn(() => {
            data.a.lessThan(0.5).discard();
            return vec4(light.haze(lit, { world }), 1);
        })();

        const mesh = new THREE.InstancedMesh(geometry, material, cards.length);
        mesh.name = 'VerdantHillsFarTrees';
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
            tileData.set([card.flip ? u0 + du : u0, card.flip ? -du : du, card.tone, 0], index * 4);
            lookData.set([card.phase, height, 0, 0], index * 4);
        });
        mesh.instanceMatrix.needsUpdate = true;
        // Too far for the shadow map: their shade is baked into the land.
        mesh.castShadow = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.mesh = mesh;
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
        this.mesh = null;
    }
}

/**
 * Verdant Hills — drawing what the wind carries.
 *
 * Two instanced draws read VerdantHillsSeedSim's typed arrays. Chaff — petals, bits of
 * blade, oak leaves — is small cupped kites of real geometry, lit like the plants it came
 * from, so a handful thrown across the light glows like the grass does. Dandelion seed and
 * pollen are soft additive tufts that the sun picks out.
 */
import * as THREE from 'three/webgpu';
import {
    atan, cameraPosition, cos, cross, dot, exp, float, instancedBufferAttribute, instancedDynamicBufferAttribute,
    length, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, saturate, sin, step, uniformArray,
    uv, varying, vec3,
} from 'three/tsl';
import { VerdantHillsSeedSim } from './verdant-hills-seed-sim.js';

const RESERVE_SHARE = 0.86;

/** What chaff can be, by tint; the last is the pale down of seeds. */
export const VERDANT_HILLS_CHAFF = Object.freeze({
    buttercup: 0, daisy: 1, clover: 2, straw: 3, blade: 4, oakLeaf: 5, oakLeafPale: 6,
});

export function verdantHillsChaffPalette() {
    return [0xffd92a, 0xfffdf2, 0xe9a3c4, 0xd9c98a, 0x7fae2e, 0x4f8a22, 0x9ab23c, 0xf4f1e6]
        .map((hex) => new THREE.Color(hex));
}

/** A petal or a leaf: a kite folded along its midrib and cupped a little. */
function createChaffGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, -0.5, 0, 0.36, 0.06, 0.15, 0, 0.5, 0.04, -0.36, 0.06, 0.15,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return geometry;
}

export class VerdantHillsSeeds {
    constructor({
        light, tier, rng = Math.random, homes = null, groundHeight = () => -1e6,
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.homes = homes;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsSeeds';
        this.owned = [];
    }

    build() {
        const count = this.tier.seeds;
        this.sim = new VerdantHillsSeedSim({
            count,
            reserve: Math.round(count * RESERVE_SHARE),
            rng: this.rng,
            homes: this.homes,
            groundHeight: this.groundHeight,
        });
        const { sim, light } = this;
        this.places = new THREE.InstancedBufferAttribute(sim.outPlace, 4);
        this.looks = new THREE.InstancedBufferAttribute(sim.outLook, 4);
        this.seeds = new THREE.InstancedBufferAttribute(sim.seed, 1);
        // Rewritten every frame: the dynamic helper keeps them flagged that way.
        const place = instancedDynamicBufferAttribute(this.places); // xyz, size
        const look = instancedDynamicBufferAttribute(this.looks); // tint, particle kind, spin, brightness
        const seed = instancedBufferAttribute(this.seeds);
        const palette = uniformArray(verdantHillsChaffPalette());
        this.buildChaff({
            place, look, seed, palette, light, count,
        });
        this.buildDown({
            place, look, light, count,
        });
        return this;
    }

    buildChaff({
        place, look, seed, palette, light, count,
    }) {
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'VerdantHillsChaff';
        const chaff = step(look.y, 0.5);
        // Each piece tumbles about an axis of its own.
        const axis = normalize(vec3(sin(seed.mul(37)), cos(seed.mul(91)).mul(0.5), cos(seed.mul(37))));
        const turn = (vector) => vector.mul(cos(look.z))
            .add(cross(axis, vector).mul(sin(look.z)))
            .add(axis.mul(dot(axis, vector)).mul(cos(look.z).oneMinus()));
        material.positionNode = place.xyz.add(turn(positionGeometry.mul(place.w.mul(chaff))));
        const normal = normalize(varying(turn(normalGeometry), 'verdantChaffNormal'));
        const tone = varying(palette.element(look.x.toInt()), 'verdantChaffTone');
        const heat = varying(look.w, 'verdantChaffHeat');
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const sun = light.cloudShadow(world);
        const facing = dot(normal, light.uSunDir).abs().mul(0.72).add(0.3);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.2);
        const lantern = pow(tone, vec3(0.85)).mul(through.mul(0.8).add(0.12));
        const lit = tone.mul(facing).add(lantern).mul(light.uSunColor).mul(sun)
            .mul(0.27)
            .add(tone.mul(light.ambient(mix(normal, vec3(0, 1, 0), 0.6))).mul(0.95))
            // What is in the air keeps a little light of its own, so it reads against the
            // hills; a long combo warms the whirl further.
            .add(tone.mul(saturate(heat.sub(0.85)).mul(1.1).add(0.16)));
        material.colorNode = light.haze(lit, { world });
        const mesh = new THREE.InstancedMesh(createChaffGeometry(), material, count);
        mesh.name = 'VerdantHillsChaff';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.chaff = mesh;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
    }

    buildDown({
        place, look, light, count,
    }) {
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'VerdantHillsDown';
        const down = step(0.5, look.y);
        const pollen = step(1.5, look.y);
        const toEye = normalize(cameraPosition.sub(place.xyz));
        const right = normalize(cross(vec3(0, 1, 0), toEye));
        const up = cross(toEye, right);
        const size = place.w.mul(down).mul(mix(float(1.05), float(0.55), pollen));
        material.positionNode = place.xyz
            .add(right.mul(positionGeometry.x.mul(size)))
            .add(up.mul(positionGeometry.y.mul(size)));
        const centred = uv().sub(0.5).mul(2);
        const radius = length(centred);
        const core = pow(saturate(float(1).sub(radius)), 3);
        // A dandelion seed is a parachute of hairs: a few fine spokes around a bright grain.
        const spokes = pow(cos(atan(centred.y, centred.x).mul(4).add(look.z)).abs(), 26)
            .mul(saturate(float(1).sub(radius))).mul(pollen.oneMinus());
        const halo = exp(radius.mul(-3.6)).mul(saturate(float(1).sub(radius)));
        const kind = varying(pollen, 'verdantDownKind');
        const bright = varying(look.w, 'verdantDownLight');
        // Down is white and shows best where the sun finds it; pollen is a mote of gold.
        const lit = varying(light.cloudShadow(place.xyz).mul(0.8).add(0.2), 'verdantDownSun');
        material.colorNode = mix(vec3(1.0, 0.98, 0.9), vec3(1.0, 0.76, 0.26), kind).mul(light.uSunColor).mul(0.34);
        material.opacityNode = core.add(spokes.mul(0.34)).add(halo.mul(0.3)).mul(bright).mul(lit);
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
        mesh.name = 'VerdantHillsDown';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 60;
        this.down = mesh;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
    }

    reset() {
        this.sim?.reset();
        this.markDirty();
    }

    markDirty() {
        if (!this.places) return;
        this.places.needsUpdate = true;
        this.looks.needsUpdate = true;
    }

    update(dt, env) {
        if (!this.sim) return;
        this.sim.step(dt, env);
        this.markDirty();
    }

    dispose() {
        this.chaff?.dispose();
        this.down?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sim = null;
        this.chaff = null;
        this.down = null;
    }
}

/**
 * Summer — drawing what is in the air.
 *
 * Two instanced draws read SummerPetalSim's typed arrays. Petals are small cupped kites of
 * real geometry in the colour of their flower, lit like the flowers they came from, so a
 * handful thrown across the sun lights up like stained glass. Dandelion seed and pollen
 * are soft additive tufts that the sun picks out. Both are part of the scene, so the lake
 * mirrors every one of them.
 */
import * as THREE from 'three/webgpu';
import {
    atan, cameraPosition, cos, cross, dot, exp, float, instancedBufferAttribute, instancedDynamicBufferAttribute,
    length, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, saturate, sin, step, uniformArray,
    uv, varying, vec3,
} from 'three/tsl';
import { SUMMER_FLOWERS } from './summer-flowers.js';
import { SummerPetalSim } from './summer-petal-sim.js';

const RESERVE_SHARE = 0.86;

/** Petal colours by flower kind; the last is the pale down of seeds. */
export function summerPetalPalette() {
    const colours = [];
    for (let slot = 0; slot < 7; slot += 1) {
        colours.push(new THREE.Color(SUMMER_FLOWERS.find((flower) => flower.slot === slot).petal));
    }
    colours.push(new THREE.Color(0xf4f1e6));
    return colours;
}

/** A petal: a kite folded along its midrib and cupped a little. */
function createPetalGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, -0.5, 0, 0.36, 0.06, 0.15, 0, 0.5, 0.04, -0.36, 0.06, 0.15,
    ], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return geometry;
}

export class SummerPetals {
    constructor({
        light, tier, rng = Math.random, homes = null, groundHeight = () => -1,
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.homes = homes;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'SummerPetals';
        this.owned = [];
    }

    build() {
        const count = this.tier.petals;
        this.sim = new SummerPetalSim({
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
        const look = instancedDynamicBufferAttribute(this.looks); // flower, particle kind, spin, brightness
        const seed = instancedBufferAttribute(this.seeds);
        const palette = uniformArray(summerPetalPalette());
        this.buildPetals({
            place, look, seed, palette, light, count,
        });
        this.buildDown({
            place, look, light, count,
        });
        return this;
    }

    buildPetals({
        place, look, seed, palette, light, count,
    }) {
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SummerPetals';
        const petal = step(look.y, 0.5);
        // Each petal tumbles about an axis of its own.
        const axis = normalize(vec3(sin(seed.mul(37)), cos(seed.mul(91)).mul(0.5), cos(seed.mul(37))));
        const turn = (vector) => vector.mul(cos(look.z))
            .add(cross(axis, vector).mul(sin(look.z)))
            .add(axis.mul(dot(axis, vector)).mul(cos(look.z).oneMinus()));
        material.positionNode = place.xyz.add(turn(positionGeometry.mul(place.w.mul(petal))));
        const normal = normalize(varying(turn(normalGeometry), 'summerPetalNormal'));
        const tone = varying(palette.element(look.x.toInt()), 'summerPetalTone');
        const heat = varying(look.w, 'summerPetalHeat');
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const sun = light.sunlight();
        const facing = dot(normal, light.uSunDir).abs().mul(0.72).add(0.3);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 2.2);
        const lantern = pow(tone, vec3(0.85)).mul(through.mul(0.7).add(0.12));
        const lit = tone.mul(facing).add(lantern).mul(light.uSunColor).mul(sun)
            .mul(0.26)
            .add(tone.mul(light.ambient(mix(normal, vec3(0, 1, 0), 0.6))).mul(0.95))
            // Petals in the air keep a little light of their own, so the dark kinds (lupine,
            // cranesbill) read against the lake; a long combo warms the crown further.
            .add(tone.mul(saturate(heat.sub(0.85)).mul(1.1).add(0.22)));
        material.colorNode = light.haze(lit, { world });
        const mesh = new THREE.InstancedMesh(createPetalGeometry(), material, count);
        mesh.name = 'SummerPetals';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.petals = mesh;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
    }

    buildDown({
        place, look, light, count,
    }) {
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'SummerDown';
        const down = step(0.5, look.y);
        const pollen = step(1.5, look.y);
        const toEye = normalize(cameraPosition.sub(place.xyz));
        const right = normalize(cross(vec3(0, 1, 0), toEye));
        const up = cross(toEye, right);
        const size = place.w.mul(down).mul(mix(float(1.25), float(0.6), pollen));
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
        const kind = varying(pollen, 'summerDownKind');
        const bright = varying(look.w, 'summerDownLight');
        // Seed down is white and only shows where the sun finds it; pollen is a mote of gold.
        const lit = light.sunlight().mul(0.85).add(0.15);
        material.colorNode = mix(vec3(1.0, 0.96, 0.86), vec3(1.0, 0.72, 0.22), kind).mul(light.uSunColor).mul(0.3);
        material.opacityNode = core.add(spokes.mul(0.3)).add(halo.mul(0.3)).mul(bright).mul(lit);
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
        mesh.name = 'SummerDown';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 40;
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
        this.petals?.dispose();
        this.down?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sim = null;
        this.petals = null;
        this.down = null;
    }
}

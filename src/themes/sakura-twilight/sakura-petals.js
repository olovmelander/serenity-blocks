/**
 * Sakura Twilight — drawing the petals in the air.
 *
 * One instanced draw of the petal mesh. Positions and orientations come straight from
 * SakuraPetalSim's typed arrays; the petals are lit as thin translucent blades by the
 * shared light rig, so one drifting between the eye and the moon flares silver, and one
 * passing a lantern turns amber. Petals thrown by the game carry their own light, which
 * the simulation lets fade as they fall.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dot, faceDirection, float, instancedBufferAttribute, length, mix,
    normalGeometry, normalize, positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uniform,
    varying, vec3, vec4,
} from 'three/tsl';
import { SakuraPetalSim } from './sakura-petal-sim.js';
import { SAKURA_WATER_LEVEL, sakuraSurfaceHeight } from './sakura-terrain.js';

const RESERVE_SHARE = 0.45;

/** Rotate a vector by a unit quaternion (TSL). */
function rotate(vector, quaternion) {
    const axis = quaternion.xyz;
    return vector.add(cross(axis, cross(axis, vector).add(vector.mul(quaternion.w))).mul(2));
}

export class SakuraPetals {
    constructor({
        light, blossoms, tier, rng = Math.random, crownPoints = null,
    }) {
        this.light = light;
        this.blossoms = blossoms;
        this.tier = tier;
        this.rng = rng;
        this.crownPoints = crownPoints;
        this.group = new THREE.Group();
        this.group.name = 'SakuraPetalsInTheAir';
        this.uHeat = uniform(0);
        this.owned = [];
    }

    build() {
        const count = this.tier.petals;
        this.sim = new SakuraPetalSim({
            count,
            reserve: Math.round(count * RESERVE_SHARE),
            rng: this.rng,
            surface: sakuraSurfaceHeight,
            waterLevel: SAKURA_WATER_LEVEL,
            crownPoints: this.crownPoints,
        });
        const geometry = this.blossoms.meshes.petal;
        if (!geometry) throw new Error('[Sakura] The blossom pack has no "petal" mesh.');
        const { sim, light } = this;
        this.positions = new THREE.InstancedBufferAttribute(sim.outPosition, 4);
        this.rotations = new THREE.InstancedBufferAttribute(sim.outRotation, 4);
        this.looks = new THREE.InstancedBufferAttribute(sim.outLook, 2);
        [this.positions, this.rotations, this.looks].forEach((buffer) => buffer.setUsage(THREE.DynamicDrawUsage));
        const place = instancedBufferAttribute(this.positions);
        const turn = instancedBufferAttribute(this.rotations);
        const look = instancedBufferAttribute(this.looks); // tone, the light it carries
        const paint = attribute('color', 'vec4'); // along the petal, -, shade, -
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SakuraPetalsInTheAir';
        // A petal that drifts right up to the lens shrinks away instead of filling the view.
        const near = smoothstep(1.2, 5.5, length(place.xyz.sub(cameraPosition)));
        const local = rotate(positionGeometry.mul(place.w.mul(near)), turn);
        material.positionNode = positionLocal.sub(positionGeometry).add(local).add(place.xyz);
        const blade = normalize(varying(rotate(normalGeometry, turn))).mul(float(faceDirection));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const pale = mix(color(0xffe6ed), color(0xffa6c2), look.x);
        const heart = mix(color(0xe9779a), color(0xc23463), look.x);
        const petal = mix(heart, pale, smoothstep(0.02, 0.42, paint.r)).mul(paint.b);
        const moon = light.moonlight();
        const facing = dot(blade, light.uMoonDir);
        const through = pow(saturate(dot(view, light.uMoonDir).negate()), 3);
        const front = petal.mul(saturate(facing.mul(0.6).add(0.4)));
        const back = petal.mul(saturate(facing.negate()).mul(0.5).add(through.mul(1.1)));
        const lamp = varying(light.lamps(positionWorld));
        const ring = varying(light.rings(positionWorld.xz).band);
        // The game's petals are lit from within: pale rose, white-hot while a long combo holds.
        const flicker = sin(light.uTime.mul(8).add(look.x.mul(40))).mul(0.2).add(0.8);
        const inner = mix(vec3(1.5, 0.62, 0.95), vec3(2.6, 1.7, 2.0), this.uHeat)
            .mul(look.y).mul(this.uHeat.mul(1.4).add(1)).mul(flicker);
        const lit = front.add(back).mul(light.uMoonColor).mul(moon)
            .add(petal.mul(light.ambient(blade)).mul(1.6))
            .add(petal.mul(lamp).mul(1.1))
            .add(petal.mul(vec3(1.0, 0.6, 0.78)).mul(ring).mul(0.8))
            .add(petal.mul(inner));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'SakuraPetalsInTheAir';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(material);
        return this;
    }

    reset() {
        this.sim?.reset();
        this.markDirty();
    }

    markDirty() {
        if (this.positions) this.positions.needsUpdate = true;
        if (this.rotations) this.rotations.needsUpdate = true;
        if (this.looks) this.looks.needsUpdate = true;
    }

    update(dt, env, heat = 0) {
        if (!this.sim) return;
        this.uHeat.value = Number.isFinite(heat) ? Math.max(0, Math.min(1, heat)) : 0;
        this.sim.step(dt, env);
        this.markDirty();
    }

    dispose() {
        this.mesh?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sim = null;
        this.mesh = null;
    }
}

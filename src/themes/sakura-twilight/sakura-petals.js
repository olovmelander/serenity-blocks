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
    uv, varying, vec3, vec4,
} from 'three/tsl';
import { SakuraPetalSim } from './sakura-petal-sim.js';
import { SAKURA_SURFACE_CEILING, SAKURA_WATER_LEVEL, sakuraSurfaceHeight } from './sakura-terrain.js';
import { SakuraPetalSimRemote } from './sakura-petal-sim-remote.js';

const RESERVE_SHARE = 0.45;
/**
 * The refined petal's rows from claw to tip, in a petal of unit length and 0.35 half-width:
 * [along, half-width, where the midrib is]. The last row's midrib stops short of its lobes:
 * the notch a cherry petal ends in.
 */
const PETAL_ROWS = [[0, 0.035, 0], [0.2, 0.19, 0.2], [0.45, 0.33, 0.45], [0.67, 0.35, 0.67], [0.86, 0.27, 0.8],
    [1, 0.13, 0.87]];

/** Rotate a vector by a unit quaternion (TSL). */
function rotate(vector, quaternion) {
    const axis = quaternion.xyz;
    return vector.add(cross(axis, cross(axis, vector).add(vector.mul(quaternion.w))).mul(2));
}

/**
 * The petal in the air, drawn finer than the pack's four-triangle one and at its size: a
 * rounded blade, cupped across and rolled back toward the notched tip, so a petal near the
 * eye reads as a petal and its shading turns across it as it tumbles. Same frame as the
 * pack's (lying in XY, claw toward -Y, +Z up) and the same paint (along, -, shade, 1).
 */
export function createSakuraPetalGeometry(authored) {
    if (!authored.boundingBox) authored.computeBoundingBox();
    const box = authored.boundingBox;
    const span = box.max.y - box.min.y;
    const across = (box.max.x - box.min.x) / 0.7;
    const positions = [];
    const paint = [];
    const uvs = [];
    const indices = [];
    PETAL_ROWS.forEach(([along, half, midrib]) => {
        [-1, 0, 1].forEach((side) => {
            const y = side === 0 ? midrib : along;
            const x = side * half;
            const lift = 0.09 * (x / 0.35) ** 2 - 0.06 * y * y;
            positions.push(x * across, box.min.y + y * span, lift * span);
            paint.push(Math.min(1, y), 0, 0.82 + 0.18 * Math.min(1, y), 1);
            uvs.push(0.5 + x / 0.7, y);
        });
    });
    for (let row = 0; row < PETAL_ROWS.length - 1; row += 1) {
        const [left, mid, right] = [row * 3, row * 3 + 1, row * 3 + 2];
        indices.push(left, mid, left + 3, mid, mid + 3, left + 3, mid, right, mid + 3, right, right + 3, mid + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(paint, 4));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = 'SakuraPetalRefined';
    return geometry;
}

export class SakuraPetals {
    constructor({
        light, blossoms, tier, rng = Math.random, crownPoints = null, worker = false,
    }) {
        this.light = light;
        this.blossoms = blossoms;
        this.tier = tier;
        this.rng = rng;
        this.crownPoints = crownPoints;
        /** In play the simulation steps in a worker (sakura-petal-sim-remote.js); tests and captures here. */
        this.worker = worker;
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
            surfaceCeiling: SAKURA_SURFACE_CEILING,
            crownPoints: this.crownPoints,
        });
        if (this.worker && typeof Worker !== 'undefined') {
            try {
                this.sim = new SakuraPetalSimRemote(this.sim, () => new Worker(
                    new URL('./sakura-petal-sim.worker.js', import.meta.url),
                    { type: 'module' },
                ));
            } catch {
                // (No worker: the page steps the petals, as before.)
            }
        }
        const authored = this.blossoms.meshes.petal;
        if (!authored) throw new Error('[Sakura] The blossom pack has no "petal" mesh.');
        const geometry = createSakuraPetalGeometry(authored);
        this.owned.push(geometry);
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
        // Blushed at the claw, palest at the margins of the blade.
        const margin = pow(uv().x.sub(0.5).abs().mul(2), 2).mul(smoothstep(0.25, 0.7, paint.r));
        const petal = mix(mix(heart, pale, smoothstep(0.02, 0.42, paint.r)), color(0xfff3f6), margin.mul(0.4))
            .mul(paint.b);
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
        this.sim?.dispose?.();
        this.mesh?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sim = null;
        this.mesh = null;
    }
}

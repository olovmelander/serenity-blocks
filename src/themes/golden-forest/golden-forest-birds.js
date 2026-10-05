/**
 * Golden Forest — the birds.
 *
 * A flock wheeling over the far side of the lake and a skein crossing the sky in a V, as
 * silhouettes against the sun. Every bird's path is a closed-form function of time, so the
 * whole flight runs in one vertex shader on both backends with no per-frame CPU work, and
 * a capture at a given time always shows the same sky. A big clear startles the flock: it
 * bursts wide and beats harder until it settles.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cos, cross, float, instancedBufferAttribute, mix, mod, normalize, positionGeometry, sin, smoothstep,
    uniform, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;
const SKEIN_SHARE = 0.3;

/** A bird gliding toward -Z: a slim body and two jointed wings; `wing` runs 0 (body) to 1 (tip). */
function createBirdGeometry() {
    const triangles = [
        // body
        [[0, 0, -0.3, 0], [-0.05, 0, 0, 0], [0.05, 0, 0, 0]],
        [[-0.05, 0, 0, 0], [0, 0, 0.32, 0], [0.05, 0, 0, 0]],
    ];
    [-1, 1].forEach((side) => {
        triangles.push(
            [[side * 0.04, 0, -0.12, 0], [side * 0.44, 0, -0.06, 0.5], [side * 0.04, 0, 0.1, 0]],
            [[side * 0.04, 0, 0.1, 0], [side * 0.44, 0, -0.06, 0.5], [side * 0.42, 0, 0.12, 0.5]],
            [[side * 0.44, 0, -0.06, 0.5], [side * 0.9, 0, 0.1, 1], [side * 0.42, 0, 0.12, 0.5]],
        );
    });
    const positions = [];
    const wings = [];
    triangles.forEach((triangle) => triangle.forEach(([x, y, z, wing]) => {
        positions.push(x, y, z);
        wings.push(wing);
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('wing', new THREE.Float32BufferAttribute(wings, 1));
    return geometry;
}

export class GoldenForestBirds {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestBirds';
        this.uStartle = uniform(0);
        this.owned = [];
        this.count = 0;
    }

    build() {
        const count = Math.max(0, Math.floor(this.tier.birds));
        this.count = count;
        if (!count) return this;
        const { light, rng } = this;
        const skein = Math.round(count * SKEIN_SHARE);
        const data = new Float32Array(count * 4); // seed, in the skein (1) or the flock (0), place in the V, size
        for (let i = 0; i < count; i += 1) {
            const inSkein = i < skein;
            data.set([rng(), inSkein ? 1 : 0, inSkein ? i - (skein - 1) / 2 : 0, 0.9 + rng() * 0.5], i * 4);
        }
        const bird = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'GoldenForestBirds';
        const t = light.uTime;
        const phase = bird.x.mul(TAU);
        // The flock: its centre wheels slowly over the far water, each bird milling about
        // it on an ellipse of its own. Positions and headings are both in closed form.
        const turn = t.mul(0.1);
        const centre = vec3(cos(turn).mul(90).sub(46), sin(turn.mul(1.7)).mul(9).add(48), sin(turn).mul(50).sub(160));
        const centreVelocity = vec3(sin(turn).mul(-9), cos(turn.mul(1.7)).mul(1.53), cos(turn).mul(5));
        const rate = bird.x.mul(0.2).add(0.26);
        const spread = this.uStartle.mul(2.4).add(1).mul(24);
        const mill = vec3(
            sin(t.mul(rate).add(phase)).mul(spread),
            sin(t.mul(rate).mul(1.3).add(phase.mul(2.1))).mul(spread).mul(0.3),
            cos(t.mul(rate).mul(0.9).add(phase.mul(1.7))).mul(spread).mul(0.8),
        );
        const millVelocity = vec3(
            cos(t.mul(rate).add(phase)).mul(spread).mul(rate),
            cos(t.mul(rate).mul(1.3).add(phase.mul(2.1))).mul(spread).mul(0.39).mul(rate),
            sin(t.mul(rate).mul(0.9).add(phase.mul(1.7))).mul(spread).mul(-0.72).mul(rate),
        );
        // The skein: a V flying a long straight lane across the sun, coming round again.
        const lane = normalize(vec3(1, 0, 0.1));
        const laneSide = normalize(cross(lane, vec3(0, 1, 0)));
        const travelled = mod(t.mul(11.5).add(260), 1100).sub(550);
        const place = bird.z;
        const skeinPosition = vec3(-20, 62, -290)
            .add(lane.mul(travelled.sub(place.abs().mul(2.5))))
            .add(laneSide.mul(place.mul(2.1)))
            .add(vec3(0, sin(t.mul(0.4).add(place)).mul(0.7), 0));
        const position = mix(centre.add(mill), skeinPosition, bird.y);
        const heading = normalize(mix(centreVelocity.add(millVelocity), lane, bird.y));
        const right = normalize(cross(heading, vec3(0, 1, 0)));
        const up = cross(right, heading);
        // Beat, then glide: each bird keeps its own rhythm, and a startled one only beats.
        const wing = attribute('wing', 'float');
        const beating = smoothstep(-0.3, 0.3, sin(t.mul(0.33).add(bird.x.mul(40)))).max(this.uStartle);
        const flap = sin(t.mul(this.uStartle.mul(5).add(9.5)).add(bird.x.mul(31))).mul(beating)
            .add(float(0.18).mul(beating.oneMinus()));
        const local = positionGeometry.add(vec3(0, wing.mul(flap).mul(0.36), 0)).mul(bird.w);
        material.positionNode = position.add(right.mul(local.x)).add(up.mul(local.y)).sub(heading.mul(local.z));
        // Silhouettes: almost black, taken back into the air like everything else.
        material.colorNode = light.haze(vec3(0.03, 0.017, 0.014), { world: position });
        const mesh = new THREE.InstancedMesh(createBirdGeometry(), material, count);
        mesh.name = 'GoldenForestBirds';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
        return this;
    }

    update(frame = {}) {
        const startle = Number.isFinite(frame.flock) ? THREE.MathUtils.clamp(frame.flock, 0, 1) : 0;
        this.uStartle.value = startle;
    }

    dispose() {
        this.mesh?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}

/**
 * Golden Forest — drawing the fireflies.
 *
 * One instanced, additive draw. Positions, brightness and velocity come straight from
 * GoldenForestSparkSim's typed arrays; each firefly is a soft point of light that turns
 * to face the camera and stretches into a streak along its flight when it moves fast.
 * They are part of the scene, so the lake mirrors every one of them.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cross, dot, exp, float, instancedDynamicBufferAttribute, length, mix, normalize, positionGeometry,
    pow, saturate, uv, vec3,
} from 'three/tsl';
import { GoldenForestSparkSim } from './golden-forest-spark-sim.js';

const RESERVE_SHARE = 0.62;

export class GoldenForestSparks {
    constructor({
        tier, rng = Math.random, homes = null, groundHeight = () => -1,
    }) {
        this.tier = tier;
        this.rng = rng;
        this.homes = homes;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestFireflies';
        this.owned = [];
    }

    build() {
        const count = this.tier.sparks;
        this.sim = new GoldenForestSparkSim({
            count,
            reserve: Math.round(count * RESERVE_SHARE),
            rng: this.rng,
            homes: this.homes,
            groundHeight: this.groundHeight,
        });
        const { sim } = this;
        this.places = new THREE.InstancedBufferAttribute(sim.outPlace, 4);
        this.glows = new THREE.InstancedBufferAttribute(sim.outGlow, 4);
        this.velocities = new THREE.InstancedBufferAttribute(sim.outVelocity, 4);
        // Rewritten every frame: the dynamic helper keeps them flagged that way.
        const place = instancedDynamicBufferAttribute(this.places); // xyz, size
        const glow = instancedDynamicBufferAttribute(this.glows); // brightness, heat, streak, seed
        const velocity = instancedDynamicBufferAttribute(this.velocities);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'GoldenForestFireflies';
        // Face the camera, with the quad's long axis laid along the flight.
        const toEye = normalize(cameraPosition.sub(place.xyz));
        const flight = velocity.xyz.add(vec3(0, 0.0005, 0));
        const along = normalize(flight.sub(toEye.mul(dot(flight, toEye))).add(vec3(0, 0.00001, 0)));
        // along x toEye, in that order, so the quad's front face is the one turned to the eye.
        const across = normalize(cross(along, toEye));
        // A fast firefly draws out into a fine streak: longer, and narrower with it.
        const stretch = glow.z.mul(2.1).add(1);
        const girth = glow.z.mul(-0.25).add(1);
        material.positionNode = place.xyz
            .add(along.mul(positionGeometry.y.mul(place.w).mul(stretch)))
            .add(across.mul(positionGeometry.x.mul(place.w).mul(girth)));
        const st = uv();
        const radius = length(st.sub(0.5)).mul(2);
        const core = pow(saturate(float(1).sub(radius)), 3);
        const halo = exp(radius.mul(-4.2)).mul(saturate(float(1).sub(radius)));
        // A streak is brightest at its head and trails away behind.
        const comet = mix(float(1), pow(st.y, 1.6).mul(0.8).add(0.2), glow.z);
        // Amber at rest, pale gold when a combo heats them; never so bright that the
        // bloom washes the colour out of them.
        const ember = mix(vec3(1.0, 0.42, 0.05), vec3(1.0, 0.74, 0.3), glow.y);
        material.colorNode = ember.mul(glow.y.mul(0.6).add(1.45));
        material.opacityNode = core.mul(1.1).add(halo.mul(0.6)).mul(glow.x).mul(comet);
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
        mesh.name = 'GoldenForestFireflies';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 40;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
        return this;
    }

    reset() {
        this.sim?.reset();
        this.markDirty();
    }

    markDirty() {
        if (!this.places) return;
        this.places.needsUpdate = true;
        this.glows.needsUpdate = true;
        this.velocities.needsUpdate = true;
    }

    update(dt, env) {
        if (!this.sim) return;
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

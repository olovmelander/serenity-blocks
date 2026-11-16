/**
 * Verdant Hills — fireflies in the afterglow.
 *
 * When the day goes down to its afterglow the meadow lights up: small green-gold lamps drifting
 * over the grass heads on the crown of the hill, each glowing and going out on its own slow
 * beat. Every path and every beat is a closed form of the time, so they cost no CPU and a
 * capture at a given time shows the same lamps. By day they are folded away to nothing.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, cross, exp, float, instancedBufferAttribute, length, normalize, positionGeometry, pow,
    saturate, sin, step, uv, varying, vec3, vec4,
} from 'three/tsl';
import { VERDANT_HILLS_VIEWS, verdantHillsEye } from './verdant-hills-composition.js';
import { verdantHillsMeadowCover } from './verdant-hills-meadow.js';
import { verdantHillsGroundHeight } from './verdant-hills-terrain.js';

const TAU = Math.PI * 2;

/** How many lamps a tier lights (never none: every tier keeps the whole picture). */
export function verdantHillsFireflyCount(tier) {
    return Math.max(48, Math.round(60 + (tier?.motes || 0) * 0.4));
}

export class VerdantHillsFireflies {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsFireflies';
        this.count = 0;
    }

    build() {
        const { light, rng } = this;
        const count = verdantHillsFireflyCount(this.tier);
        this.count = count;
        const [eyeX, , eyeZ] = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
        const homes = new Float32Array(count * 4); // x, y, z, seed
        for (let i = 0; i < count; i += 1) {
            let x = 0;
            let z = 0;
            for (let attempt = 0; attempt < 30; attempt += 1) {
                // Most over the near grass, a few out over the brow.
                const depth = 3.5 + rng() ** 1.6 * 42;
                const angle = (rng() * 2 - 1) * 0.78;
                x = eyeX + Math.sin(angle) * depth;
                z = eyeZ - Math.cos(angle) * depth;
                if (verdantHillsMeadowCover(x, z) > 0.5) break;
            }
            homes.set([x, verdantHillsGroundHeight(x, z) + 0.55 + rng() * 1.25, z, rng()], i * 4);
        }
        const home = instancedBufferAttribute(new THREE.InstancedBufferAttribute(homes, 4));
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false,
        });
        material.name = 'VerdantHillsFireflies';
        const t = light.uTime;
        const phase = home.w.mul(TAU);
        const rate = home.w.mul(0.22).add(0.2);
        // A lamp wanders a slow, lazy knot about its place over the grass.
        const place = home.xyz.add(vec3(
            sin(t.mul(rate).add(phase)).mul(1.5).add(sin(t.mul(rate).mul(2.3).add(phase.mul(1.7))).mul(0.5)),
            sin(t.mul(rate).mul(1.7).add(phase.mul(2.1))).mul(0.32),
            cos(t.mul(rate).mul(0.8).add(phase.mul(1.3))).mul(1.5).add(cos(t.mul(rate).mul(2.7).add(phase)).mul(0.4)),
        ));
        const night = light.uNight;
        const toEye = normalize(cameraPosition.sub(place));
        const right = normalize(cross(vec3(0, 1, 0), toEye));
        const up = cross(toEye, right);
        // Never smaller than a pixel or two however far out it drifts; folded away by day.
        const size = length(cameraPosition.sub(place)).mul(0.0034).max(0.085).mul(step(0.03, night));
        material.positionNode = place
            .add(right.mul(positionGeometry.x.mul(size)))
            .add(up.mul(positionGeometry.y.mul(size)));
        // It glows up, holds, and goes out: one long slow flash, then the dark between.
        const beat = pow(saturate(sin(t.mul(home.w.mul(0.7).add(0.75)).add(phase.mul(6.1)))), 2.2);
        const glow = varying(beat.mul(night.mul(night)), 'verdantFireflyGlow');
        const centred = uv().sub(0.5).mul(2);
        const radius = length(centred);
        const lamp = exp(radius.mul(radius).mul(-26)).mul(1.8)
            .add(exp(radius.mul(-3.4)).mul(saturate(float(1).sub(radius))).mul(0.3));
        // Light added to the dusk; the target's alpha is left alone.
        material.outputNode = vec4(vec3(0.62, 1.0, 0.22).mul(lamp).mul(glow).mul(2.1), 0);
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
        mesh.name = 'VerdantHillsFireflies';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 62;
        this.mesh = mesh;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    dispose() {
        this.mesh?.geometry.dispose();
        this.mesh?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}

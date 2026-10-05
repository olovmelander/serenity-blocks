/**
 * Golden Forest — sky and air.
 *
 * The sky dome with its great low sun and bars of evening cloud lit from beneath, banks of
 * mist lying on the water, and dust that only shows where the sun reaches it. All of it
 * reads the shared light rig, so the far shore dissolves into exactly the colour that is
 * behind it and the motes sparkle in the same shafts the shadow map carves.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, dot, exp, float, instancedBufferAttribute, length, mix, normalize, positionLocal,
    positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import { goldenForestGroundHeight } from './golden-forest-terrain.js';

const TAU = Math.PI * 2;
/** Angular radius of the sun's disc: far larger than life, as the lake has always had it. */
export const GOLDEN_FOREST_SUN_RADIUS_DEGREES = 2.5;
// z of each mist bank (far to near), its height, and how thick it lies.
const MIST_BANKS = [
    [-232, 30, 0.6], [-176, 22, 0.52], [-128, 17, 0.46], [-88, 13, 0.4], [-52, 9, 0.34], [-24, 6, 0.26],
];

export class GoldenForestAtmosphere {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestAir';
        this.owned = [];
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildSky();
        this.buildMist();
        this.buildMotes();
        return this;
    }

    buildSky() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'GoldenForestSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        const sunward = saturate(dot(direction, light.uSunDir));
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const toward = dot(flat, normalize(vec2(light.uSunDir.x, light.uSunDir.z))).mul(0.5).add(0.5);
        // Bars of evening cloud: long along the horizon, thin, and sliding very slowly.
        const plane = vec2(direction.x, direction.z).div(direction.y.max(0).add(0.11));
        const drift = light.uTime.mul(0.0011);
        const density = light.noise(plane.mul(vec2(0.043, 0.15)).add(vec2(drift, 0))).g.mul(0.55)
            .add(light.noise(plane.mul(vec2(0.1, 0.4)).sub(vec2(drift.mul(1.7), 0.3))).b.mul(0.3))
            .add(light.noise(plane.mul(vec2(0.29, 0.86)).add(vec2(drift.mul(2.6), 0.1))).a.mul(0.15));
        const cover = smoothstep(0.54, 0.66, density).mul(smoothstep(0.015, 0.16, direction.y))
            .mul(smoothstep(0.95, 0.5, direction.y).mul(0.7).add(0.3));
        // Their thin edges catch the sun from below and burn; their bodies stay ember-brown.
        const edge = float(1).sub(smoothstep(0.52, 0.76, density));
        const body = mix(vec3(0.34, 0.1, 0.04), vec3(0.82, 0.27, 0.08), toward.oneMinus().mul(0.5).add(0.15));
        const cloud = mix(body, vec3(2.3, 1.0, 0.24), edge.mul(pow(toward, 1.6)).mul(light.uWarmth.mul(0.3).add(1)));
        const sky = mix(light.sky(direction), cloud, cover.mul(0.86));
        // The sun: a clean disc with a hot rim of glare, dimmed where a cloud bar crosses it.
        const radius = Math.cos(THREE.MathUtils.degToRad(GOLDEN_FOREST_SUN_RADIUS_DEGREES));
        const disc = smoothstep(radius - 0.00012, radius + 0.0001, sunward);
        const glare = pow(sunward, 1400).mul(0.7).add(pow(sunward, 190).mul(0.2));
        material.colorNode = sky.add(light.uSunColor.mul(disc.mul(3).add(glare))
            .mul(cover.mul(0.45).oneMinus()).mul(light.uWarmth.mul(0.25).add(1)));
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(3000, 48, 24)), material);
        dome.name = 'GoldenForestSky';
        dome.renderOrder = -100;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.sky = dome;
        this.group.add(dome);
    }

    /** Banks of mist lying on the lake; where the sun finds them they turn to gold. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        geometry.translate(0, 0.5, 0);
        MIST_BANKS.slice(0, this.tier.mist).forEach(([z, height, thickness], index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `GoldenForestMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.004 + index * 0.0012);
            const broad = vec2(world.x.mul(0.006).add(scroll), st.y.mul(0.45).add(index * 0.37));
            const billow = light.noise(broad).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.019).sub(scroll.mul(1.6)), st.y.mul(1.2))).g.mul(0.4));
            // Thickest on the water, gone by the top of the card; no edge at either side.
            const band = exp(st.y.mul(-3.4)).mul(smoothstep(1, 0.6, st.y));
            const sides = smoothstep(0, 0.12, st.x).mul(smoothstep(0, 0.12, st.x.oneMinus()));
            const sun = light.sunlight();
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            material.colorNode = light.uHazeCool.mul(1.25)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(1.3).add(0.16)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.1));
            material.opacityNode = smoothstep(0.3, 0.78, billow).mul(band).mul(sides).mul(thickness);
            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, -0.05, z);
            mist.scale.set(420 + -z * 3.2, height, 1);
            mist.name = `GoldenForestMistBank ${index}`;
            mist.renderOrder = 10 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /** Dust and midges: invisible in shade, a slow sparkle wherever a shaft crosses them. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        if (!(count > 0)) return;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 12 - rng() ** 1.4 * 62;
            const x = (rng() * 2 - 1) * (9 + (12 - z) * 0.7);
            data.set([x, Math.max(0, goldenForestGroundHeight(x, z)) + 0.3 + rng() * 9, z, rng()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'GoldenForestSunMotes';
        const t = light.uTime;
        const phase = mote.w.mul(TAU);
        const drift = vec3(
            sin(t.mul(0.23).add(phase)).mul(0.7).add(light.uWindDir.x.mul(light.uGust).mul(1.2)),
            sin(t.mul(0.17).add(phase.mul(2.3))).mul(0.45),
            cos(t.mul(0.19).add(phase.mul(1.7))).mul(0.6),
        );
        const size = mote.w.mul(0.05).add(0.035);
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        const twinkle = sin(t.mul(mote.w.mul(2).add(1.3)).add(phase.mul(7))).mul(0.4).add(0.6);
        material.colorNode = light.uSunColor.mul(0.5).add(light.uHazeWarm.mul(light.uGlow));
        material.opacityNode = disc.pow2().mul(twinkle).mul(light.sunlight().mul(0.95).add(light.uGlow.mul(0.35)));
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'GoldenForestSunMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.motes = motes;
        this.group.add(motes);
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

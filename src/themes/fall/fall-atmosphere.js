/**
 * Fall — sky and air.
 *
 * The sky dome and its cloud streaks, banks of ground mist, dust that only shows where the
 * sun reaches it, and a few wandering wisps. All of it reads the shared light rig, so the
 * forest dissolves into exactly the colour that is behind it and the motes sparkle in the
 * same shafts the shadow map carves.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, cos, dot, exp, float, instancedBufferAttribute, length, mix, normalize, positionGeometry,
    positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import { fallTerrainHeight } from './fall-terrain.js';

const TAU = Math.PI * 2;

export class FallAtmosphere {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallAir';
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
        this.buildWisps();
        return this;
    }

    buildSky() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'FallSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        const sunward = saturate(dot(direction, light.uSunDir));
        const disc = pow(sunward, 2600).mul(9).add(pow(sunward, 320).mul(0.9));
        // High streaks of cloud, lit peach on the sun's side and lavender away from it.
        const plane = vec2(direction.x.mul(0.55), direction.z).div(direction.y.add(0.16));
        const drift = light.uTime.mul(0.0016);
        const streaks = light.noise(plane.mul(vec2(0.16, 0.42)).add(vec2(drift, 0))).g.mul(0.6)
            .add(light.noise(plane.mul(vec2(0.37, 1.1)).sub(vec2(drift.mul(1.7), 0.3))).b.mul(0.4));
        const cover = smoothstep(0.46, 0.7, streaks).mul(smoothstep(0.03, 0.22, direction.y));
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const toward = dot(flat, normalize(vec2(light.uSunDir.x, light.uSunDir.z))).mul(0.5).add(0.5);
        const cloud = mix(color(0x8a7690), vec3(1.7, 1.02, 0.6), pow(toward, 1.6));
        material.colorNode = mix(light.sky(direction), cloud, cover.mul(0.62)).add(light.uSunColor.mul(disc));
        const sky = new THREE.Mesh(this.own(new THREE.SphereGeometry(420, 32, 20)), material);
        sky.name = 'FallSky';
        sky.renderOrder = -100;
        sky.frustumCulled = false;
        sky.matrixAutoUpdate = false;
        this.sky = sky;
        this.group.add(sky);
    }

    /** Low banks of mist between the trunks; where the sun finds them they turn gold. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        const depths = [-104, -76, -52, -31, -15].slice(5 - this.tier.mist);
        depths.forEach((z, index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `FallMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.006 + index * 0.0015);
            const billow = light.noise(vec2(world.x.mul(0.011).add(scroll), st.y.mul(0.5).add(index * 0.37))).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.034).sub(scroll.mul(1.6)), st.y.mul(1.3))).g.mul(0.4));
            const band = exp(st.y.sub(0.3).pow2().mul(-9)).mul(smoothstep(0, 0.12, st.y));
            const sides = smoothstep(0, 0.14, st.x).mul(smoothstep(0, 0.14, st.x.oneMinus()));
            const sun = light.sunlight();
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            const lit = light.uHazeCool.mul(1.5)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(0.9).add(0.14)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.2));
            material.colorNode = lit;
            material.opacityNode = smoothstep(0.34, 0.8, billow).mul(band).mul(sides).mul(-z > 60 ? 0.5 : 0.36);
            const mist = new THREE.Mesh(geometry, material);
            const width = 150 + -z * 1.7;
            const height = 9 + -z * 0.11;
            mist.position.set(0, fallTerrainHeight(0, z) + height * 0.28, z);
            mist.scale.set(width, height, 1);
            mist.name = `FallMistBank ${index}`;
            mist.renderOrder = 10 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /** Dust and pollen: invisible in shade, a slow sparkle wherever a shaft crosses it. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 11 - rng() ** 1.4 * 58;
            const x = (rng() * 2 - 1) * (10 + (11 - z) * 0.62);
            data.set([x, fallTerrainHeight(x, z) + 0.4 + rng() * 9, z, rng()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'FallSunMotes';
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
        motes.name = 'FallSunMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.group.add(motes);
    }

    /** A handful of drifting lights near the ferns; combos call them out of hiding. */
    buildWisps() {
        const { light, rng } = this;
        const count = this.tier.wisps;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const side = i % 2 === 0 ? -1 : 1;
            const z = 8 - rng() * 36;
            const x = side * (4.5 + rng() * 17);
            data.set([x, fallTerrainHeight(x, z) + 0.5 + rng() * 2.6, z, rng()], i * 4);
        }
        const wisp = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'FallWisps';
        const t = light.uTime;
        const phase = wisp.w.mul(TAU);
        const stir = light.uGlow.mul(1.6).add(1);
        const wander = vec3(
            sin(t.mul(0.31).add(phase)).mul(1.5).add(sin(t.mul(0.83).add(phase.mul(3))).mul(0.3)),
            sin(t.mul(0.47).add(phase.mul(1.9))).mul(0.6).add(light.uGlow.mul(1.1)),
            cos(t.mul(0.27).add(phase.mul(1.3))).mul(1.5),
        ).mul(stir);
        const breath = sin(t.mul(0.7).add(phase.mul(5))).mul(0.5).add(0.5);
        const size = breath.mul(0.16).add(0.3).add(light.uGlow.mul(0.2));
        material.positionNode = positionGeometry.mul(size).add(positionLocal.sub(positionGeometry))
            .add(wisp.xyz).add(wander);
        const radius = length(uv().sub(0.5)).mul(2);
        const core = saturate(float(1).sub(radius)).pow(3);
        const halo = exp(radius.mul(-3.2)).mul(saturate(float(1).sub(radius)));
        material.colorNode = mix(color(0xffc46a), color(0x7ff0d8), wisp.w).mul(1.6);
        material.opacityNode = core.add(halo.mul(0.45)).mul(breath.mul(0.35).add(0.2).add(light.uGlow.mul(0.6)));
        const wisps = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        wisps.name = 'FallWisps';
        wisps.renderOrder = 31;
        wisps.frustumCulled = false;
        wisps.matrixAutoUpdate = false;
        this.group.add(wisps);
    }

    update() {}

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

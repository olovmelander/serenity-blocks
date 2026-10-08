/**
 * Summer — sky and air.
 *
 * The sky of Midsummer's Eve: a sun that stands low over the lake without setting, towers
 * of evening cumulus whose edges it gilds from behind, a veil of high cirrus, the thin mist
 * that rises off still water once the air cools, and pollen that only shows where the sun
 * reaches it. All of it reads the shared light rig, so the far shore dissolves into exactly
 * the colour that is behind it.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, dot, exp, float, instancedBufferAttribute, length, mix, normalize, positionLocal,
    positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { summerGroundHeight } from './summer-terrain.js';

const TAU = Math.PI * 2;
/** Angular radius of the sun's disc: larger than life, as a low sun always seems. */
export const SUMMER_SUN_RADIUS_DEGREES = 1.7;
// z of each mist bank (far to near), its height, and how thick it lies.
const MIST_BANKS = [
    [-262, 34, 0.5], [-196, 24, 0.44], [-140, 17, 0.38], [-96, 12, 0.3], [-58, 8, 0.24],
];

export class SummerAtmosphere {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerAir';
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
        material.name = 'SummerSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        const sunward = saturate(dot(direction, light.uSunDir));
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const sunFlat = normalize(vec2(light.uSunDir.x, light.uSunDir.z));
        const toward = dot(flat, sunFlat).mul(0.5).add(0.5);
        // Cumulus: a flat-bottomed deck seen from below and far away, so it stacks toward
        // the horizon. Density is sampled twice, the second time a step toward the sun, and
        // the difference says which side of a cloud is lit.
        const plane = vec2(direction.x, direction.z).div(direction.y.max(0).add(0.14));
        const drift = light.uTime.mul(0.0012);
        // One fetch carries four octaves; a second, warped by the first, breaks the lattice.
        const octaves = vec4(0.46, 0.29, 0.16, 0.09);
        const billow = (at) => {
            const broad = light.noise(at.mul(vec2(0.2, 0.34)).add(vec2(drift, 0.21)));
            const warped = at.mul(vec2(0.43, 0.7)).add(broad.rg.sub(0.5).mul(0.3)).add(vec2(drift.mul(1.7), 0.57));
            return dot(broad, octaves).mul(0.55).add(dot(light.noise(warped), octaves).mul(0.45));
        };
        const density = billow(plane);
        const lit = billow(plane.add(sunFlat.mul(0.22)));
        // Cumulus keeps to the middle of the sky: clear blue overhead, clear gold at the rim.
        const deck = smoothstep(0.03, 0.13, direction.y)
            .mul(smoothstep(0.34, 0.8, direction.y).oneMinus().mul(0.85).add(0.15));
        const crisp = light.noise(plane.mul(vec2(1.9, 3.1)).add(vec2(drift.mul(3), 0.13)));
        const cover = smoothstep(0.53, 0.585, density.add(crisp.b.sub(0.5).mul(0.05)).add(crisp.a.sub(0.5).mul(0.03)))
            .mul(deck);
        // A cloud's sunward edge burns cream; its body is peach, and its shaded side the
        // mauve of evening.
        const edge = saturate(density.sub(lit).mul(9).add(0.42));
        const thin = float(1).sub(smoothstep(0.535, 0.66, density));
        const shade = mix(vec3(0.3, 0.27, 0.44), vec3(0.62, 0.34, 0.3), pow(toward, 1.3));
        const body = mix(vec3(0.78, 0.47, 0.44), vec3(1.12, 0.6, 0.36), pow(toward, 1.6));
        const gilt = mix(vec3(1.22, 0.98, 0.84), vec3(1.95, 1.4, 0.72), pow(toward, 2.2));
        const cloud = mix(
            mix(shade, body, smoothstep(0.1, 0.6, edge)),
            gilt,
            saturate(smoothstep(0.55, 1, edge).mul(0.8).add(thin.mul(pow(toward, 3)).mul(0.7))),
        )
            .mul(light.uWarmth.mul(0.12).add(1));
        // High cirrus: long streaks that keep the last rose of the day.
        const veil = light.noise(plane.mul(vec2(0.05, 0.5)).add(vec2(drift.mul(0.4), 0.7)));
        const cirrus = smoothstep(0.56, 0.84, veil.r.mul(0.6).add(veil.b.mul(0.4)))
            .mul(smoothstep(0.12, 0.45, direction.y)).mul(0.22);
        let sky = light.sky(direction);
        sky = mix(sky, mix(vec3(0.8, 0.5, 0.5), vec3(1.4, 0.95, 0.56), pow(toward, 2)), cirrus.mul(cover.oneMinus()));
        sky = mix(sky, cloud, cover.mul(0.94));
        // The sun: a clean disc and a soft glare, dimmed where a cloud crosses it.
        const radius = Math.cos(THREE.MathUtils.degToRad(SUMMER_SUN_RADIUS_DEGREES));
        const disc = smoothstep(radius - 0.00009, radius + 0.00008, sunward);
        const glare = pow(sunward, 1700).mul(0.6).add(pow(sunward, 260).mul(0.14));
        material.colorNode = sky.add(light.uSunColor.mul(disc.mul(3.4).add(glare))
            .mul(cover.mul(0.6).oneMinus()).mul(light.uWarmth.mul(0.25).add(1)));
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(3200, 48, 24)), material);
        dome.name = 'SummerSky';
        dome.renderOrder = -100;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.sky = dome;
        this.group.add(dome);
    }

    /** Thin evening mist on the lake; where the sun finds it, it turns to gold. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        geometry.translate(0, 0.5, 0);
        MIST_BANKS.slice(0, this.tier.mist).forEach(([z, height, thickness], index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `SummerMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.004 + index * 0.0012);
            const broad = vec2(world.x.mul(0.006).add(scroll), st.y.mul(0.45).add(index * 0.37));
            const billow = light.noise(broad).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.019).sub(scroll.mul(1.6)), st.y.mul(1.2))).g.mul(0.4));
            // Thickest on the water, gone by the top of the card; no edge at either side.
            const band = exp(st.y.mul(-3.6)).mul(smoothstep(0.6, 1, st.y).oneMinus());
            const sides = smoothstep(0, 0.12, st.x).mul(smoothstep(0, 0.12, st.x.oneMinus()));
            const sun = light.sunlight();
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            material.colorNode = light.uHazeCool.mul(1.2)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(1.2).add(0.14)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.1));
            material.opacityNode = smoothstep(0.36, 0.84, billow).mul(band).mul(sides).mul(thickness * 0.6);
            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, -0.05, z);
            mist.scale.set(460 + -z * 3.2, height, 1);
            mist.name = `SummerMistBank ${index}`;
            mist.renderOrder = 10 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /** Pollen and midges: invisible in shade, a slow sparkle wherever the sun crosses them. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        if (!(count > 0)) return;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 13 - rng() ** 1.5 * 46;
            const x = (rng() * 2 - 1) * (7 + (13 - z) * 0.75);
            data.set([x, Math.max(0, summerGroundHeight(x, z)) + 0.25 + rng() ** 1.6 * 7.5, z, rng()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'SummerPollen';
        const t = light.uTime;
        const phase = mote.w.mul(TAU);
        const drift = vec3(
            sin(t.mul(0.23).add(phase)).mul(0.7).add(light.uWindDir.x.mul(light.uGust).mul(1.2)),
            sin(t.mul(0.17).add(phase.mul(2.3))).mul(0.45),
            cos(t.mul(0.19).add(phase.mul(1.7))).mul(0.6),
        );
        const size = mote.w.mul(0.035).add(0.022);
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        const twinkle = sin(t.mul(mote.w.mul(2).add(1.3)).add(phase.mul(7))).mul(0.4).add(0.6);
        material.colorNode = light.uSunColor.mul(0.42).add(light.uHazeWarm.mul(light.uGlow));
        material.opacityNode = disc.pow2().mul(twinkle).mul(light.sunlight().mul(0.9).add(light.uGlow.mul(0.3)));
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'SummerPollen';
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

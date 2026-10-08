/**
 * Forest — the night sky and the air under it.
 *
 * The dome carries the full moon (far larger than life, as the forest has always had it),
 * its aureole and ice halo, a field of stars with the Milky Way running through it, thin
 * cloud silvered where it drifts near the moon, and now and then a falling star. Below it,
 * banks of mist lie in the hollows and fill the valley, and moths and dust drift through
 * the ride, visible only where a moonbeam finds them. All of it reads the shared light
 * rig, so the mist glows in exactly the beams the shadow map carves.
 */
import * as THREE from 'three/webgpu';
import {
    acos, asin, atan, cameraPosition, clamp, cos, dot, exp, float, floor, fract, instancedBufferAttribute, length,
    max, mix, normalize, positionLocal, positionWorld, pow, saturate, sin, smoothstep, sqrt, texture, uniform, uv,
    vec2, vec3,
} from 'three/tsl';
import { FOREST_MOON_DIRECTION } from './forest-light.js';
import { FOREST_MOON_RADIUS_DEGREES, forestRidePoint } from './forest-plan.js';
import { forestGroundHeight } from './forest-terrain.js';

const TAU = Math.PI * 2;
const HALO_DEGREES = 22;
// z of each mist bank (far to near), how high above the floor it stands, and how thick it lies.
const MIST_BANKS = [
    [-250, 16, 0.62], [-170, 12, 0.56], [-112, 9, 0.5], [-66, 6.5, 0.4], [-34, 4.2, 0.3],
];
/** The pole of the Milky Way's band: it crosses the sky from lower right to upper left. */
const GALAXY_POLE = new THREE.Vector3(0.58, 0.42, 0.7).normalize();

/** A cheap, stable hash of a lattice cell. */
function cellHash(cell, salt = 0) {
    return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7)).add(salt)).mul(43758.5453));
}

export class ForestSky {
    constructor({
        light, tier, rng = Math.random, moonMap = null,
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.moonMap = moonMap;
        this.group = new THREE.Group();
        this.group.name = 'ForestNightAir';
        this.owned = [];
        // A falling star: where it starts, which way it goes, how far along it is.
        this.uMeteorFrom = uniform(new THREE.Vector3(0, 1, 0));
        this.uMeteorAlong = uniform(new THREE.Vector3(1, 0, 0));
        this.uMeteor = uniform(new THREE.Vector2(0, 0)); // progress, strength
        this.meteor = { active: false, age: 0, life: 0.9 };
        this.meteorClock = 9 + rng() * 14;
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

    /** Stars of one lattice scale along a direction; `rarity` is the share of empty cells. */
    stars(direction, scale, rarity, salt) {
        const point = direction.mul(scale);
        const cell = floor(point);
        const chance = cellHash(cell, salt);
        const offset = vec3(cellHash(cell, salt + 1.7), cellHash(cell, salt + 3.1), cellHash(cell, salt + 5.3))
            .sub(0.5).mul(0.6);
        const distance = length(fract(point).sub(0.5).sub(offset));
        const present = smoothstep(rarity, 1, chance);
        // A few bright stars, many faint ones; each twinkles on its own clock.
        const magnitude = pow(present, 3).mul(1.6).add(present.mul(0.25));
        const twinkle = sin(this.light.uTime.mul(chance.mul(3.5).add(1.4)).add(chance.mul(97))).mul(0.28).add(0.72);
        const core = smoothstep(0.0, 0.085, distance).oneMinus();
        // Star colours run from blue-white to a few warm ones.
        const warm = cellHash(cell, salt + 9.9);
        const tint = mix(vec3(0.72, 0.84, 1.15), vec3(1.15, 0.92, 0.68), smoothstep(0.78, 1, warm));
        return tint.mul(core.pow2().mul(magnitude).mul(twinkle));
    }

    buildSky() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'ForestSkyDome';
        const direction = normalize(positionWorld.sub(cameraPosition));
        const moonCos = dot(direction, light.uMoonDir);
        const moonward = saturate(moonCos);
        const angle = acos(clamp(moonCos, -1, 1));
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const toward = dot(flat, normalize(vec2(light.uMoonDir.x, light.uMoonDir.z))).mul(0.5).add(0.5);

        // Thin cloud: long streaks high up, sliding very slowly; silver where the moon is behind it.
        const plane = vec2(direction.x, direction.z).div(direction.y.max(0).add(0.12));
        const drift = light.uTime.mul(0.0014);
        const density = light.noise(plane.mul(vec2(0.05, 0.13)).add(vec2(drift, 0))).g.mul(0.55)
            .add(light.noise(plane.mul(vec2(0.12, 0.34)).sub(vec2(drift.mul(1.7), 0.3))).b.mul(0.3))
            .add(light.noise(plane.mul(vec2(0.31, 0.8)).add(vec2(drift.mul(2.6), 0.1))).a.mul(0.15));
        const cover = smoothstep(0.55, 0.7, density).mul(smoothstep(0.02, 0.2, direction.y))
            .mul(smoothstep(0.5, 0.95, direction.y).oneMinus().mul(0.75).add(0.25));
        const edge = smoothstep(0.52, 0.78, density).oneMinus();
        const body = mix(vec3(0.012, 0.022, 0.042), vec3(0.03, 0.055, 0.1), toward);
        const lining = light.moonColour().mul(pow(moonward, 10).mul(0.16).add(pow(toward, 2).mul(edge).mul(0.03)));
        const cloud = body.add(lining);

        // Stars, thinned toward the moon and the horizon; the Milky Way lifts them in a band.
        let night = light.sky(direction);
        if (this.tier.stars) {
            const band = exp(dot(direction, vec3(GALAXY_POLE.x, GALAXY_POLE.y, GALAXY_POLE.z)).pow2().mul(-9));
            const dust = light.noise(plane.mul(0.09).add(0.37)).r.mul(0.6)
                .add(light.noise(plane.mul(0.27)).g.mul(0.4));
            const river = band.mul(smoothstep(0.3, 0.75, dust.mul(0.7).add(band.mul(0.45))));
            const clear = smoothstep(0.86, 0.995, moonward).oneMinus().mul(0.8).add(0.2)
                .mul(smoothstep(0.0, 0.22, direction.y))
                .mul(cover.oneMinus());
            const field = this.stars(direction, 150, float(0.972).sub(river.mul(0.035)), 0)
                .add(this.stars(direction, 330, float(0.965).sub(river.mul(0.07)), 11).mul(0.45));
            night = night.add(field.mul(clear).mul(0.9))
                .add(vec3(0.02, 0.03, 0.05).mul(river).mul(clear));
        }
        let sky = mix(night, cloud, cover.mul(0.82));

        // The falling star: a bright head and a tail that thins behind it.
        const head = normalize(this.uMeteorFrom.add(this.uMeteorAlong.mul(this.uMeteor.x.mul(0.42))));
        const tail = normalize(this.uMeteorFrom.add(this.uMeteorAlong.mul(this.uMeteor.x.mul(0.42).sub(0.1).max(0))));
        const span = head.sub(tail);
        const reach = clamp(dot(direction.sub(tail), span).div(dot(span, span).max(1e-6)), 0, 1);
        const off = length(direction.sub(tail).sub(span.mul(reach)));
        const streak = exp(off.div(0.0011).pow2().negate()).mul(reach.pow2())
            .add(exp(off.div(0.0034).pow2().negate()).mul(reach.pow(6)).mul(0.6));
        sky = sky.add(vec3(0.85, 0.95, 1.2).mul(streak).mul(this.uMeteor.y).mul(cover.mul(0.7).oneMinus()));

        // The moon: its own lit face, warm ivory against the blue it makes of everything else.
        const radius = THREE.MathUtils.degToRad(FOREST_MOON_RADIUS_DEGREES);
        const moonRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), FOREST_MOON_DIRECTION)
            .normalize();
        const moonUp = new THREE.Vector3().crossVectors(FOREST_MOON_DIRECTION, moonRight).normalize();
        const disc = vec2(
            dot(direction, vec3(moonRight.x, moonRight.y, moonRight.z)),
            dot(direction, vec3(moonUp.x, moonUp.y, moonUp.z)),
        ).div(Math.sin(radius));
        const rim = length(disc);
        const inside = smoothstep(0.985, 1.0, rim).oneMinus().mul(smoothstep(0.0, 0.2, moonCos));
        const depth = sqrt(max(float(1).sub(rim.mul(rim)), 0.0004));
        let face = vec3(0.86);
        if (this.moonMap) {
            // Orthographic view of a sphere: the disc position is the surface normal.
            const longitude = atan(disc.x, depth).div(TAU).add(0.5);
            const latitude = asin(clamp(disc.y, -1, 1)).div(Math.PI).add(0.5);
            const seas = texture(this.moonMap, vec2(longitude, latitude)).rgb;
            face = mix(vec3(dot(seas, vec3(0.3333))), seas, 0.6).mul(1.9).add(0.08);
        }
        const limb = pow(depth, 0.45).mul(0.6).add(0.4);
        const moonFace = face.mul(vec3(1.0, 0.95, 0.82)).mul(limb).mul(2.7);
        // Glare hugging the limb, a wide soft aureole, and the faint ring ice lays 22° out.
        const beyond = max(angle.sub(radius), 0);
        const glare = vec3(1.0, 0.93, 0.78).mul(exp(beyond.mul(-34)).mul(0.5))
            .add(vec3(0.62, 0.8, 1.1).mul(exp(beyond.mul(-7.5)).mul(0.1)));
        const ring = exp(angle.sub(THREE.MathUtils.degToRad(HALO_DEGREES)).div(0.016).pow2().negate());
        const halo = vec3(0.7, 0.85, 1.05).mul(ring).mul(light.uMoonGain.sub(0.72).max(0).mul(0.05));
        const veiled = cover.mul(0.5).oneMinus();
        material.colorNode = mix(sky, moonFace.mul(light.uMoonGain.mul(0.5).add(0.5)), inside.mul(veiled))
            .add(glare.mul(light.uMoonGain).mul(inside.oneMinus()).mul(veiled))
            .add(halo);
        const dome = new THREE.Mesh(this.own(new THREE.SphereGeometry(3000, 48, 24)), material);
        dome.name = 'ForestSky';
        // After every solid thing, with the depth test on: the sky is only shaded where it shows.
        dome.renderOrder = 10;
        dome.frustumCulled = false;
        dome.matrixAutoUpdate = false;
        this.sky = dome;
        this.group.add(dome);
    }

    /** Banks of mist lying on the floor of the ride and filling the valley. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        MIST_BANKS.slice(0, this.tier.mist).forEach(([z, height, thickness], index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `ForestMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const above = world.y.sub(light.groundAt(world));
            const scroll = light.uTime.mul(0.0035 + index * 0.001);
            const broad = vec2(world.x.mul(0.007).add(scroll), world.y.mul(0.03).add(index * 0.37));
            const billow = light.noise(broad).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.021).sub(scroll.mul(1.6)), world.y.mul(0.09))).g.mul(0.4));
            // Thickest just above the floor, gone a few metres up; it never shows where it meets the ground.
            const lift = above.div(height);
            const band = smoothstep(-0.02, 0.1, lift).mul(exp(max(lift, 0).mul(-3.2)))
                .mul(smoothstep(0.75, 1, lift).oneMinus());
            const sides = smoothstep(0, 0.1, st.x).mul(smoothstep(0, 0.1, st.x.oneMinus()));
            const moon = light.moonlight();
            const direction = normalize(world.sub(cameraPosition));
            const moonward = saturate(dot(direction, light.uMoonDir));
            const glow = light.glow(world);
            material.colorNode = light.uHazeCool.mul(1.5)
                .add(light.uHazeMoon.mul(light.uMoonGain).mul(moon).mul(pow(moonward, 2).mul(1.1).add(0.16)))
                .add(glow.mul(0.8));
            material.opacityNode = smoothstep(0.28, 0.76, billow).mul(band).mul(sides).mul(thickness);
            const mist = new THREE.Mesh(geometry, material);
            // Tall enough to hold the mist from the valley floor to the plateau behind it.
            mist.position.set(z * 0.42, 2, z);
            mist.scale.set(380 + -z * 2.6, 52, 1);
            mist.name = `ForestMistBank ${index}`;
            mist.renderOrder = 20 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /** Moths and dust in the ride: invisible in shade, a slow glitter wherever a beam crosses them. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        if (!(count > 0)) return;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const s = 3 + rng() ** 1.3 * 64;
            const spot = forestRidePoint(s, (rng() * 2 - 1) * (7 + s * 0.12));
            data.set([spot.x, forestGroundHeight(spot.x, spot.z) + 0.3 + rng() * 8.5, spot.z, rng()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'ForestMoonMotes';
        const t = light.uTime;
        const phase = mote.w.mul(TAU);
        const drift = vec3(
            sin(t.mul(0.21).add(phase)).mul(0.8).add(light.uWindDir.x.mul(light.uGust).mul(1.2)),
            sin(t.mul(0.16).add(phase.mul(2.3))).mul(0.5),
            cos(t.mul(0.18).add(phase.mul(1.7))).mul(0.7),
        );
        const size = mote.w.mul(0.045).add(0.03);
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        // A moth's wings catch the light and lose it again.
        const flutter = sin(t.mul(mote.w.mul(9).add(3)).add(phase.mul(7))).mul(0.45).add(0.55);
        material.colorNode = light.moonColour().mul(0.34);
        material.opacityNode = disc.pow2().mul(flutter).mul(light.moonlight());
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'ForestMoonMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.motes = motes;
        this.group.add(motes);
    }

    /** Send a star across the sky to the right of the moon. */
    shoot(strength = 1) {
        const { rng } = this;
        const azimuth = THREE.MathUtils.degToRad(-12 + rng() * 62);
        const elevation = THREE.MathUtils.degToRad(24 + rng() * 14);
        this.uMeteorFrom.value.set(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.sin(elevation),
            -Math.cos(azimuth) * Math.cos(elevation),
        );
        const fall = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5);
        this.uMeteorAlong.value.set(fall * Math.cos(azimuth), -0.42 - rng() * 0.3, fall * Math.sin(azimuth))
            .normalize();
        this.meteor.active = true;
        this.meteor.age = 0;
        this.meteor.life = 0.7 + rng() * 0.5;
        this.meteor.strength = THREE.MathUtils.clamp(strength, 0.2, 1.6);
    }

    resetEffects() {
        this.meteor.active = false;
        this.uMeteor.value.set(0, 0);
        this.starSerial = undefined;
    }

    /** `frame.stars` counts the falling stars the game has asked for; one also falls now and then. */
    update(dt, frame = {}) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (Number.isFinite(frame.stars) && frame.stars !== this.starSerial) {
            if (this.starSerial !== undefined && frame.stars > this.starSerial) this.shoot(1.3);
            this.starSerial = frame.stars;
        }
        this.meteorClock -= step;
        if (this.meteorClock <= 0 && !this.meteor.active && frame.settled !== true) {
            this.meteorClock = 14 + this.rng() * 22;
            this.shoot(0.7);
        }
        if (this.meteor.active) {
            this.meteor.age += step;
            const progress = this.meteor.age / this.meteor.life;
            if (progress >= 1) {
                this.meteor.active = false;
                this.uMeteor.value.set(0, 0);
            } else {
                const flare = Math.sin(Math.PI * Math.min(1, progress * 1.1));
                this.uMeteor.value.set(progress, flare * this.meteor.strength);
            }
        }
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

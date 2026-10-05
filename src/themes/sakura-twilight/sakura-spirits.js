/**
 * Sakura Twilight — the small lights.
 *
 * Fireflies over the grass, mist lying on the lake, and the three things the game lights:
 * foxfire (kitsunebi) that kindles one flame at a time around the board as a combo
 * builds, paper lanterns set afloat on the lake by cleared lines, and sky lanterns
 * released at a level-up. Everything here is animated in the vertex shader from a few
 * per-instance numbers; launching a lantern only rewrites one slot of an attribute.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, cross, exp, float, fract, instancedBufferAttribute, length, max, mix, normalize,
    positionGeometry, positionWorld, pow, saturate, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { SAKURA_VIEWS } from './sakura-composition.js';
import { createSakuraPropMaterial } from './sakura-prop-material.js';
import { SAKURA_WATER_LEVEL, sakuraLand, sakuraTerrainHeight } from './sakura-terrain.js';

const TAU = Math.PI * 2;
const WATER_LIFE = 86;
const SKY_LIFE = 46;
const FLASH_SLOTS = 8;
const FLASH_SECONDS = 0.62;

/** Offset of a camera-facing sprite vertex around `centre` (TSL). */
function billboard(centre, size) {
    const toEye = normalize(cameraPosition.sub(centre));
    const right = normalize(cross(vec3(0, 1, 0), toEye));
    const up = cross(toEye, right);
    return centre.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
}

export class SakuraSpirits {
    constructor({
        light, props, tier, rng = Math.random,
    }) {
        this.light = light;
        this.props = props;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraSmallLights';
        this.owned = [];
        // Foxfire: the board card's centre and half-extents in the world, and how many burn.
        this.uRingCentre = uniform(new THREE.Vector3(0, 4.4, 7.5));
        this.uRingRight = uniform(new THREE.Vector3(2.2, 0, 0));
        this.uRingUp = uniform(new THREE.Vector3(0, 3.9, 0));
        this.uFoxfire = uniform(0);
        this.uSpirit = uniform(0);
        this.uScatter = uniform(0);
        this.waterCursor = 0;
        this.skyCursor = 0;
        this.waterAmbient = 0;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.quad = this.own(new THREE.PlaneGeometry(1, 1));
        this.buildMist();
        this.buildFireflies();
        this.buildFoxfire();
        this.buildWaterLanterns();
        this.buildSkyLanterns();
        this.buildFlashes();
        return this;
    }

    spriteMaterial(name) {
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = name;
        return material;
    }

    /** Banks of mist lying on the water, lit silver toward the moon. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        const depths = [-140, -96, -62, -34, -14].slice(5 - this.tier.mist);
        depths.forEach((z, index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `SakuraMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const drift = light.uTime.mul(0.004 + index * 0.0012);
            const wisps = light.noise(vec2(world.x.mul(0.006).add(drift), st.y.mul(0.5).add(index * 0.37))).g.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.017).sub(drift.mul(1.7)), st.y.mul(1.3))).b.mul(0.4));
            // Thick on the water, gone by the height of the trees, and soft at both ends.
            const profile = smoothstep(0, 0.16, st.y).mul(smoothstep(0.25, 1, st.y).oneMinus())
                .mul(smoothstep(0, 0.2, st.x)).mul(smoothstep(0.8, 1, st.x).oneMinus());
            const view = normalize(world.sub(cameraPosition));
            const moonward = saturate(view.dot(light.uMoonDir));
            const colour = light.sky(normalize(vec3(view.x, 0.06, view.z))).mul(1.2)
                .add(light.uMoonColor.mul(pow(moonward, 6).mul(0.12)));
            material.colorNode = colour;
            material.opacityNode = smoothstep(0.34, 0.8, wisps).mul(profile).mul(0.3 - index * 0.025);
            const bank = new THREE.Mesh(geometry, material);
            bank.name = material.name;
            bank.position.set(0, 5.5, z);
            bank.scale.set(z < -90 ? 620 : 300, 11, 1);
            bank.updateMatrix();
            bank.matrixAutoUpdate = false;
            bank.frustumCulled = false;
            bank.renderOrder = 4 + index;
            this.group.add(bank);
        });
    }

    /** Fireflies wander over the grass near the water and scatter when the wind gusts. */
    buildFireflies() {
        const { light, rng } = this;
        const eye = SAKURA_VIEWS.landscape.position;
        const homes = [];
        for (let attempt = 0; homes.length < this.tier.fireflies && attempt < this.tier.fireflies * 30; attempt += 1) {
            const depth = rng() ** 1.4;
            const z = eye[2] - 5 - depth * 58;
            const x = (rng() * 2 - 1) * (6 + (eye[2] - z) * 0.9);
            const land = sakuraLand(x, z);
            if (land > 0.2 && land < 9) {
                homes.push(x, sakuraTerrainHeight(x, z) + 0.35 + rng() * 1.5, z, rng());
            }
        }
        const count = homes.length / 4;
        if (!count) return;
        const home = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(homes), 4));
        const material = this.spriteMaterial('SakuraFireflies');
        const t = light.uTime;
        const seed = home.w;
        const roam = vec3(
            sin(t.mul(seed.mul(0.21).add(0.17)).add(seed.mul(TAU))).mul(1.7),
            sin(t.mul(seed.mul(0.33).add(0.29)).add(seed.mul(31))).mul(0.45),
            cos(t.mul(seed.mul(0.19).add(0.23)).add(seed.mul(17))).mul(1.7),
        );
        // A gust (or the game) sends them up and outward for a moment.
        const startle = vec3(sin(seed.mul(91)), 1.2, cos(seed.mul(57))).mul(this.uScatter.mul(1.8));
        const centre = home.xyz.add(roam).add(startle);
        // Each insect glows in slow pulses of its own.
        const pulse = smoothstep(0.25, 0.95, sin(t.mul(seed.mul(0.9).add(1.1)).add(seed.mul(41))))
            .mul(this.uScatter.mul(0.8).add(1));
        material.positionNode = billboard(centre, pulse.mul(0.12).add(0.1));
        const reach = length(uv().sub(0.5)).mul(2);
        const spark = exp(reach.mul(reach).mul(-22)).add(exp(reach.mul(-4.5)).mul(0.14))
            .mul(saturate(float(1).sub(reach)));
        material.colorNode = vec3(1.25, 2.1, 0.5).mul(spark).mul(pulse).mul(1.6);
        const mesh = new THREE.InstancedMesh(this.quad, material, count);
        mesh.name = 'SakuraFireflies';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 20;
        this.group.add(mesh);
    }

    /** Spirit flames that take their places round the board, one for each step of a combo. */
    buildFoxfire() {
        const { light } = this;
        const count = this.tier.foxfire;
        if (!count) return;
        const seeds = new Float32Array(count * 2);
        for (let i = 0; i < count; i += 1) seeds.set([i, this.rng()], i * 2);
        const seed = instancedBufferAttribute(new THREE.InstancedBufferAttribute(seeds, 2)); // order, random
        const material = this.spriteMaterial('SakuraFoxfire');
        const t = light.uTime;
        // Flames are dealt alternately to the left and right of the card and climb it, so
        // the two rows read as a gauge of the combo.
        const order = seed.x;
        const side = fract(order.mul(0.5)).sub(0.25).sign();
        const rank = order.mul(0.5).floor().add(0.5).div(Math.ceil(count / 2));
        const alight = saturate(this.uFoxfire.sub(order));
        const wander = sin(t.mul(0.7).add(seed.y.mul(TAU))).mul(0.09).add(seed.y.mul(0.16));
        const centre = this.uRingCentre
            .add(this.uRingRight.mul(side.mul(wander.add(1))))
            .add(this.uRingUp.mul(rank.mul(2).sub(1).mul(0.94)))
            .add(vec3(0, sin(t.mul(2.3).add(seed.y.mul(29))).mul(0.12), 0));
        const size = alight.mul(seed.y.mul(0.25).add(0.8)).mul(this.uSpirit.mul(0.2).add(1)).mul(0.6);
        // A flame stands on its base, taller than it is wide.
        const toEye = normalize(cameraPosition.sub(centre));
        const right = normalize(cross(vec3(0, 1, 0), toEye));
        const st = uv();
        material.positionNode = centre
            .add(right.mul(positionGeometry.x.mul(size).mul(0.7)))
            .add(vec3(0, 1, 0).mul(positionGeometry.y.add(0.3).mul(size)));
        // A round belly drawn up into a tip that licks from side to side.
        const lick = sin(t.mul(11).add(seed.y.mul(53)).add(st.y.mul(7))).mul(st.y).mul(0.2);
        const half = pow(st.y, 0.55).mul(pow(st.y.oneMinus(), 0.9)).mul(1.9);
        const edge = st.x.sub(0.5).mul(2).add(lick).abs()
            .div(max(half, 0.001));
        const body = smoothstep(0, 1, saturate(edge.oneMinus()));
        const heart = smoothstep(0.2, 1, saturate(edge.mul(2.3).oneMinus())).mul(smoothstep(0.12, 0.7, st.y).oneMinus());
        const flicker = sin(t.mul(13).add(seed.y.mul(71))).mul(0.12).add(0.88);
        const outer = mix(vec3(0.03, 0.16, 1.0), vec3(0.3, 0.14, 1.0), this.uSpirit.mul(0.7));
        const flame = mix(outer, vec3(0.16, 0.85, 1.35), body).mul(body)
            .add(vec3(0.9, 1.2, 1.3).mul(heart).mul(1.1));
        material.colorNode = flame.mul(alight).mul(flicker).mul(1.5);
        const mesh = new THREE.InstancedMesh(this.quad, material, count);
        mesh.name = 'SakuraFoxfire';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 30;
        this.group.add(mesh);
    }

    /** Where a lantern set afloat is at this moment (TSL): xyz and a 0..1 presence. */
    floating(slot, motion) {
        const age = this.light.uTime.sub(slot.z);
        const presence = smoothstep(0, 2.2, age).mul(smoothstep(motion.z.sub(7), motion.z, age).oneMinus())
            .mul(max(age, 0).sign());
        const wander = vec2(sin(age.mul(0.21).add(slot.w.mul(TAU))), cos(age.mul(0.17).add(slot.w.mul(19)))).mul(0.5);
        const place = slot.xy.add(motion.xy.mul(age)).add(wander);
        const bob = sin(this.light.uTime.mul(1.3).add(slot.w.mul(43))).mul(0.018);
        return { centre: vec3(place.x, float(SAKURA_WATER_LEVEL).add(0.02).add(bob), place.y), presence, age };
    }

    buildWaterLanterns() {
        const { light, rng } = this;
        const count = this.tier.waterLanterns;
        const geometry = this.props.meshes.water_lantern;
        if (!count || !geometry) return;
        this.waterSlots = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // x, z, birth, seed
        this.waterMotion = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // vx, vz, life, power
        this.waterSlots.setUsage(THREE.DynamicDrawUsage);
        this.waterMotion.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < count; i += 1) this.waterSlots.setXYZW(i, 0, 0, -1000, rng());
        const slot = instancedBufferAttribute(this.waterSlots);
        const motion = instancedBufferAttribute(this.waterMotion);
        const afloat = this.floating(slot, motion);
        const turn = slot.w.mul(TAU).add(afloat.age.mul(0.05));
        const material = this.own(createSakuraPropMaterial(light, 'SakuraLanternAfloat', {
            shadowed: false,
            look: vec4(slot.w, 0, motion.w, 0),
            place: ({ local }) => {
                const scaled = local.mul(afloat.presence.mul(1.25));
                return afloat.centre.add(vec3(
                    scaled.x.mul(cos(turn)).sub(scaled.z.mul(sin(turn))),
                    scaled.y,
                    scaled.x.mul(sin(turn)).add(scaled.z.mul(cos(turn))),
                ));
            },
        }));
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'SakuraLanternsAfloat';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        // A soft halo so each little flame carries across the water.
        const halo = this.spriteMaterial('SakuraLanternAfloatGlow');
        halo.positionNode = billboard(afloat.centre.add(vec3(0, 0.24, 0)), afloat.presence.mul(1.5));
        const reach = length(uv().sub(0.5)).mul(2);
        halo.colorNode = light.uLampColor.mul(exp(reach.mul(reach).mul(-5)).mul(saturate(float(1).sub(reach))))
            .mul(afloat.presence).mul(motion.w).mul(light.uLampGain.mul(0.4).add(0.6))
            .mul(0.2);
        const glow = new THREE.InstancedMesh(this.quad, halo, count);
        glow.name = 'SakuraLanternsAfloatGlow';
        glow.frustumCulled = false;
        glow.matrixAutoUpdate = false;
        glow.renderOrder = 22;
        this.group.add(glow);
        // A few are already out on the lake when the garden opens.
        this.waterAmbient = Math.min(count, Math.max(2, Math.round(count * 0.22)));
        for (let i = 0; i < this.waterAmbient; i += 1) this.drift(i, -rng() * WATER_LIFE * 0.8);
    }

    /** Send ambient lantern `index` out from one of the banks. */
    drift(index, birth = this.light.uTime.value) {
        const { rng } = this;
        const side = rng() < 0.5 ? -1 : 1;
        const x = side * (9 + rng() * 22);
        const z = -6 - rng() * 44;
        this.waterSlots.setXYZW(index, x, z, birth, rng());
        this.waterMotion.setXYZW(index, -side * (0.05 + rng() * 0.1), -0.03 - rng() * 0.08, WATER_LIFE, 0.8 + rng() * 0.4);
        this.waterSlots.needsUpdate = true;
        this.waterMotion.needsUpdate = true;
    }

    /** Set one lantern afloat at world (x, z), drifting with velocity (vx, vz). */
    launchWater(x, z, vx, vz, power = 1) {
        if (!this.waterSlots) return false;
        const { count } = this.waterSlots;
        const reserve = count - this.waterAmbient;
        if (reserve <= 0) return false;
        const index = this.waterAmbient + (this.waterCursor % reserve);
        this.waterCursor += 1;
        this.waterSlots.setXYZW(index, x, z, this.light.uTime.value, this.rng());
        this.waterMotion.setXYZW(index, vx, vz, WATER_LIFE * (0.7 + this.rng() * 0.3), power);
        this.waterSlots.needsUpdate = true;
        this.waterMotion.needsUpdate = true;
        return true;
    }

    buildSkyLanterns() {
        const { light, rng } = this;
        const count = this.tier.skyLanterns;
        const geometry = this.props.meshes.sky_lantern;
        if (!count || !geometry) return;
        this.skySlots = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // x, y, z, birth
        this.skyMotion = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // rise, drift, seed, size
        this.skySlots.setUsage(THREE.DynamicDrawUsage);
        this.skyMotion.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < count; i += 1) {
            this.skySlots.setXYZW(i, 0, 0, 0, -1000);
            this.skyMotion.setXYZW(i, 1, 0, rng(), 1);
        }
        const slot = instancedBufferAttribute(this.skySlots);
        const motion = instancedBufferAttribute(this.skyMotion);
        const age = light.uTime.sub(slot.w);
        const presence = smoothstep(0, 1.6, age).mul(smoothstep(SKY_LIFE - 12, SKY_LIFE, age).oneMinus())
            .mul(max(age, 0).sign());
        // Released by hand: a slow start, then the warm air takes them.
        const climb = age.mul(motion.x).mul(smoothstep(0, 5, age).mul(0.7).add(0.3));
        const sway = vec3(
            sin(age.mul(0.31).add(motion.z.mul(TAU))).mul(1.1),
            0,
            cos(age.mul(0.23).add(motion.z.mul(13))).mul(1.1),
        ).mul(smoothstep(0, 8, age));
        const wind = vec3(light.uWindDir.x, 0, light.uWindDir.z).mul(age.mul(motion.y));
        const centre = slot.xyz.add(vec3(0, climb, 0)).add(sway).add(wind);
        const material = this.own(createSakuraPropMaterial(light, 'SakuraSkyLantern', {
            shadowed: false,
            glow: 1.15,
            look: vec4(motion.z, 0, 1, 0),
            place: ({ local }) => centre.add(local.mul(presence.mul(motion.w))),
        }));
        material.side = THREE.DoubleSide;
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'SakuraSkyLanterns';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        const halo = this.spriteMaterial('SakuraSkyLanternGlow');
        halo.positionNode = billboard(centre.add(vec3(0, 0.35, 0)), presence.mul(motion.w).mul(2.6));
        const reach = length(uv().sub(0.5)).mul(2);
        halo.colorNode = light.uLampColor.mul(exp(reach.mul(reach).mul(-5)).mul(saturate(float(1).sub(reach))))
            .mul(presence).mul(0.17);
        const glow = new THREE.InstancedMesh(this.quad, halo, count);
        glow.name = 'SakuraSkyLanternGlow';
        glow.frustumCulled = false;
        glow.matrixAutoUpdate = false;
        glow.renderOrder = 23;
        this.group.add(glow);
    }

    /** Release one sky lantern from world (x, y, z); `delay` staggers a whole flight. */
    releaseSky(x, y, z, delay = 0) {
        if (!this.skySlots) return false;
        const index = this.skyCursor % this.skySlots.count;
        this.skyCursor += 1;
        const { rng } = this;
        this.skySlots.setXYZW(index, x, y, z, this.light.uTime.value + delay);
        this.skyMotion.setXYZW(index, 1.0 + rng() * 0.9, 0.12 + rng() * 0.3, rng(), 0.9 + rng() * 0.7);
        this.skySlots.needsUpdate = true;
        this.skyMotion.needsUpdate = true;
        return true;
    }

    /** Soft bursts of light where the game throws petals out from behind the board. */
    buildFlashes() {
        const { light } = this;
        const count = FLASH_SLOTS;
        this.flashSlots = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // x, y, z, birth
        this.flashLook = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2); // strength, turn
        this.flashSlots.setUsage(THREE.DynamicDrawUsage);
        this.flashLook.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < count; i += 1) this.flashSlots.setXYZW(i, 0, 0, 0, -1000);
        const slot = instancedBufferAttribute(this.flashSlots);
        const look = instancedBufferAttribute(this.flashLook);
        const material = this.spriteMaterial('SakuraPetalFlash');
        const life = float(FLASH_SECONDS);
        const age = light.uTime.sub(slot.w);
        const k = saturate(age.div(life));
        // Alive only between its birth and the end of its short life.
        const alive = max(age, 0).sign().mul(max(life.sub(age), 0).sign());
        material.positionNode = billboard(slot.xyz, look.x.mul(pow(k, 0.45).mul(3.2).add(0.7)));
        const st = uv().sub(0.5);
        const reach = length(st).mul(2);
        const bloom = exp(reach.mul(reach).mul(-4.5)).mul(saturate(float(1).sub(reach)));
        // Four thin rays turn the bloom into a glint.
        const turned = vec2(
            st.x.mul(cos(look.y)).sub(st.y.mul(sin(look.y))),
            st.x.mul(sin(look.y)).add(st.y.mul(cos(look.y))),
        );
        const rays = max(exp(turned.x.abs().mul(-70)), exp(turned.y.abs().mul(-70)))
            .mul(saturate(float(1).sub(reach))).mul(k.oneMinus());
        const fade = k.oneMinus().mul(k.oneMinus());
        material.colorNode = mix(vec3(1.9, 1.35, 1.7), vec3(1.3, 0.36, 0.72), k)
            .mul(bloom.mul(0.75).add(rays.mul(0.9))).mul(fade).mul(alive)
            .mul(look.x);
        const mesh = new THREE.InstancedMesh(this.quad, material, count);
        mesh.name = 'SakuraPetalFlashes';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 28;
        this.flashCursor = 0;
        this.group.add(mesh);
    }

    /** A burst of light at a world point; `strength` scales its size and brightness. */
    flash(x, y, z, strength = 1) {
        if (!this.flashSlots || !(strength > 0)) return false;
        const index = this.flashCursor % FLASH_SLOTS;
        this.flashCursor += 1;
        this.flashSlots.setXYZW(index, x, y, z, this.light.uTime.value);
        this.flashLook.setXY(index, Math.min(1.8, strength), this.rng() * Math.PI);
        this.flashSlots.needsUpdate = true;
        this.flashLook.needsUpdate = true;
        return true;
    }

    /** Stand the foxfire beside the board card: its centre and half-extents in world space. */
    setRing(centre, right, up) {
        this.uRingCentre.value.copy(centre);
        this.uRingRight.value.copy(right);
        this.uRingUp.value.copy(up);
    }

    reset() {
        this.uFoxfire.value = 0;
        this.uScatter.value = 0;
        this.waterCursor = 0;
        this.skyCursor = 0;
        this.flashCursor = 0;
        if (this.flashSlots) {
            for (let i = 0; i < FLASH_SLOTS; i += 1) this.flashSlots.setW(i, -1000);
            this.flashSlots.needsUpdate = true;
        }
        if (this.skySlots) {
            for (let i = 0; i < this.skySlots.count; i += 1) this.skySlots.setW(i, -1000);
            this.skySlots.needsUpdate = true;
        }
        if (this.waterSlots) {
            for (let i = this.waterAmbient; i < this.waterSlots.count; i += 1) this.waterSlots.setZ(i, -1000);
            this.waterSlots.needsUpdate = true;
        }
    }

    update(time, frame = {}) {
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        this.uFoxfire.value = Number.isFinite(frame.foxfire) ? Math.max(0, frame.foxfire) : 0;
        this.uSpirit.value = clamp01(frame.spirit);
        this.uScatter.value = clamp01(Math.max(clamp01(frame.gust) * 0.8, frame.front ? frame.front.strength : 0));
        // Ambient lanterns that have burnt out set off again from the bank.
        if (this.waterSlots) {
            for (let i = 0; i < this.waterAmbient; i += 1) {
                if (time - this.waterSlots.getZ(i) > this.waterMotion.getZ(i)) this.drift(i, time);
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

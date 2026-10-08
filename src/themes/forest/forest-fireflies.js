/**
 * Forest — drawing the fireflies.
 *
 * Two instanced, additive draws over ForestFireflySim's typed arrays. The first is the
 * fireflies themselves: soft points of light that turn to face the camera. The second is
 * what a long exposure sees: the path each one has just flown, laid behind it as a fine
 * ribbon, lit only where the firefly was flashing at the time, so a slow wanderer leaves a
 * dotted arc and a spark thrown from the board leaves a streak. The trail needs no history
 * buffer: an ambient firefly's path and flash are closed-form in time, so the vertex shader
 * simply works them out again a little earlier for each point along the ribbon.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, cross, exp, float, fract, instancedBufferAttribute, instancedDynamicBufferAttribute,
    length, mix, normalize, positionGeometry, pow, saturate, sin, uniform, uv, varying, vec3,
} from 'three/tsl';
import {
    FOREST_FIREFLY_DEW, FOREST_SYNC_PHASE_PER_METRE, ForestFireflySim,
} from './forest-firefly-sim.js';
import { FOREST_FIREFLY_COLOUR, FOREST_FIREFLY_HOT } from './forest-light.js';

const TAU = Math.PI * 2;
const RESERVE_SHARE = 0.56;
const SPARK_TRAIL_SECONDS = 0.2;

/** TSL twin of forestFireflyWander(). */
function wander(seed, t) {
    const phase = seed.mul(TAU);
    const time = t.mul(fract(seed.mul(13.7)).mul(0.9).add(0.7));
    return vec3(
        sin(time.mul(0.31).add(phase)).mul(1.3).add(sin(time.mul(0.83).add(phase.mul(3))).mul(0.34))
            .add(sin(time.mul(1.9).add(phase.mul(5.3))).mul(0.12)),
        sin(time.mul(0.47).add(phase.mul(1.9))).mul(0.5).add(sin(time.mul(1.31).add(phase.mul(4.1))).mul(0.16)),
        cos(time.mul(0.27).add(phase.mul(1.3))).mul(1.3).add(cos(time.mul(0.71).add(phase.mul(2.7))).mul(0.3)),
    );
}

function signal(phase) {
    return exp(phase.sub(0.14).div(0.055).pow2().negate())
        .add(exp(phase.sub(0.33).div(0.09).pow2().negate()).mul(0.34));
}

export class ForestFireflies {
    constructor({
        light, tier, rng = Math.random, homes = null, groundHeight = () => 0, hearth = { x: 0, z: 0 },
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.homes = homes;
        this.groundHeight = groundHeight;
        this.hearth = hearth;
        this.group = new THREE.Group();
        this.group.name = 'ForestFireflies';
        this.owned = [];
        this.uSimTime = uniform(0);
        this.uBeat = uniform(0);
        this.uBeatRate = uniform(0.3);
        this.uSync = uniform(0);
        // Seconds of flight an ambient firefly's trail holds; a waking forest draws longer ones.
        this.uTrail = uniform(1.5);
    }

    /** TSL twin of forestFireflyFlash(), `back` seconds ago. */
    flash(seed, away, back) {
        const t = this.uSimTime.sub(back);
        const own = fract(t.div(seed.mul(4.2).add(2.6)).add(seed.mul(7.13)));
        const shared = fract(this.uBeat.sub(this.uBeatRate.mul(back)).sub(away.mul(FOREST_SYNC_PHASE_PER_METRE))
            .add(seed.mul(0.05)));
        const joined = saturate(this.uSync.sub(fract(seed.mul(5.3)).mul(0.8)).div(0.2));
        return mix(signal(own), signal(shared).mul(1.25), joined);
    }

    build() {
        const count = this.tier.fireflies;
        this.sim = new ForestFireflySim({
            count,
            reserve: Math.round(count * RESERVE_SHARE),
            rng: this.rng,
            homes: this.homes,
            groundHeight: this.groundHeight,
            hearth: this.hearth,
        });
        const { sim } = this;
        this.homesAttribute = new THREE.InstancedBufferAttribute(sim.outHome, 4);
        this.places = new THREE.InstancedBufferAttribute(sim.outPlace, 4);
        this.velocities = new THREE.InstancedBufferAttribute(sim.outVelocity, 4);
        this.glows = new THREE.InstancedBufferAttribute(sim.outGlow, 4);
        this.buildLights(count);
        if (this.tier.trail > 0) this.buildTrails(count);
        return this;
    }

    /** The per-instance nodes one material reads (each material needs its own). */
    instance() {
        const home = instancedBufferAttribute(this.homesAttribute); // home xyz, seed
        // Rewritten every frame: the dynamic helper keeps them flagged that way.
        const place = instancedDynamicBufferAttribute(this.places); // offset or position, size
        const velocity = instancedDynamicBufferAttribute(this.velocities); // xyz, kind
        const glow = instancedDynamicBufferAttribute(this.glows); // brightness, heat, away, trail
        const ambient = saturate(velocity.w).oneMinus();
        const dew = saturate(velocity.w.sub(FOREST_FIREFLY_DEW - 1));
        return {
            home, place, velocity, glow, ambient, dew,
        };
    }

    colour(glow, dew) {
        const lit = mix(vec3(...FOREST_FIREFLY_COLOUR), vec3(...FOREST_FIREFLY_HOT), glow.y);
        // Dew is not a firefly: it only throws the moon back.
        return mix(lit, vec3(0.7, 0.88, 1.2), dew);
    }

    buildLights(count) {
        const {
            home, place, glow, ambient, dew,
        } = this.instance();
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'ForestFireflyLights';
        const centre = place.xyz.add(home.xyz.add(wander(home.w, this.uSimTime)).mul(ambient));
        const offset = cameraPosition.sub(centre);
        const range = length(offset);
        const toEye = offset.div(range.max(0.001));
        const right = normalize(cross(vec3(0, 1, 0), toEye));
        const up = cross(toEye, right);
        const stirred = this.light.stir(centre);
        // A reserve spark that is not alight has no size; it must not answer a passing wave.
        const alight = place.w.greaterThan(0.001);
        const bright = glow.x.add(stirred.mul(1.5).mul(dew.oneMinus())).mul(alight);
        // A far firefly is kept a few pixels wide and dimmed instead, so it never flickers
        // in and out between pixels.
        const size = place.w.mul(mix(float(0.66), float(0.9), dew)).add(range.mul(0.0025))
            .mul(bright.min(1.6).mul(0.3).add(0.8)).mul(alight);
        material.positionNode = centre
            .add(right.mul(positionGeometry.x.mul(size)))
            .add(up.mul(positionGeometry.y.mul(size)));
        const light = varying(this.colour(glow, dew).mul(bright).mul(exp(range.mul(-0.011)).mul(0.8).add(0.2)));
        const radius = length(uv().sub(0.5)).mul(2);
        const core = pow(saturate(float(1).sub(radius)), 3);
        const halo = exp(radius.mul(-4.4)).mul(saturate(float(1).sub(radius)));
        material.colorNode = light.mul(1.4);
        material.opacityNode = core.mul(1.2).add(halo.mul(0.5));
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
        mesh.name = 'ForestFireflyLights';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 41;
        this.lights = mesh;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
    }

    buildTrails(count) {
        const {
            home, place, velocity, glow, ambient, dew,
        } = this.instance();
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        material.name = 'ForestFireflyTrails';
        // 0 at the firefly, 1 at the far end of its trail.
        const along = positionGeometry.y.add(0.5);
        const span = mix(float(SPARK_TRAIL_SECONDS).mul(glow.w), this.uTrail, ambient);
        const back = along.mul(span);
        // Where the firefly was `seconds` ago: an ambient one on its closed-form path, a
        // spark by flying its present velocity backward (dew also un-falls).
        const earlier = (seconds) => place.xyz
            .add(home.xyz.add(wander(home.w, this.uSimTime.sub(seconds))).mul(ambient))
            .sub(velocity.xyz.mul(seconds).mul(ambient.oneMinus()))
            .add(vec3(0, 3.2, 0).mul(seconds.mul(seconds)).mul(dew));
        const centre = earlier(back);
        const ahead = earlier(back.sub(0.07));
        const offset = cameraPosition.sub(centre);
        const range = length(offset);
        const toEye = offset.div(range.max(0.001));
        const flight = ahead.sub(centre).add(vec3(0, 0.00002, 0));
        const across = normalize(cross(flight, toEye).add(vec3(0.00001, 0, 0)));
        const width = place.w.mul(0.17).add(range.mul(0.0011)).mul(along.mul(0.65).oneMinus());
        material.positionNode = centre.add(across.mul(positionGeometry.x.mul(width)));
        // An ambient firefly's trail is lit where it was flashing; a spark's simply fades.
        const then = this.flash(home.w, glow.z, back);
        const lit = mix(glow.x, then, ambient).mul(pow(along.oneMinus(), 1.4));
        const light = varying(this.colour(glow, dew).mul(lit).mul(exp(range.mul(-0.011)).mul(0.8).add(0.2))
            .mul(place.w.greaterThan(0.001)));
        const edge = saturate(float(1).sub(positionGeometry.x.abs().mul(2)));
        material.colorNode = light.mul(0.6);
        material.opacityNode = edge.mul(edge);
        const geometry = new THREE.PlaneGeometry(1, 1, 1, this.tier.trail);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'ForestFireflyTrails';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 40;
        this.trails = mesh;
        this.group.add(mesh);
        this.owned.push(material, geometry);
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

    update(dt, env = {}) {
        const { sim } = this;
        if (!sim) return;
        sim.step(dt, env);
        this.uSimTime.value = sim.time;
        this.uBeat.value = sim.beat;
        this.uBeatRate.value = Number.isFinite(env.beatRate) ? THREE.MathUtils.clamp(env.beatRate, 0, 3) : 0.3;
        this.uSync.value = sim.sync;
        const wake = Number.isFinite(env.sync) ? THREE.MathUtils.clamp(env.sync, 0, 1) : 0;
        this.uTrail.value = 1.5 + wake * 1.9;
        sim.shed(this.light.field);
        this.markDirty();
    }

    dispose() {
        this.lights?.dispose();
        this.trails?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sim = null;
        this.lights = null;
        this.trails = null;
    }
}

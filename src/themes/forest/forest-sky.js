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
    Fn, Loop, acos, asin, atan, cameraPosition, clamp, cos, dot, exp, float, floor, fract, instancedBufferAttribute,
    length, max, mix, normalize, positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep,
    sqrt, texture, uniformArray, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { FOREST_MOON_DIRECTION } from './forest-light.js';
import { FOREST_MOON_RADIUS_DEGREES, forestRidePoint } from './forest-plan.js';
import { forestGroundHeight } from './forest-terrain.js';
import { seededRandom } from '../../utils/helpers.js';

const TAU = Math.PI * 2;
const HALO_DEGREES = 22;
/** Stars asked for that may wait their turn, the breath between two, and how much faster a fever's fall. */
const MAX_PENDING_STARS = 4;
const STAR_GAP = 0.12;
const SHOWER = 11;
/** Falling stars the sky can hold at once: one by itself, and the rest for a perfect clear's fan. */
const METEORS = 4;
/**
 * The wreaths of mist near the eye: their own generator's seed, how far one drifts before it comes
 * round (metres), how fast (stretches per unit of the light rig's mist drift), how thick it lies at
 * rest, and how near the eye one fades out (metres: gone, whole).
 */
const WISP_SEED = 2861;
const WISP_STRETCH = 26;
const WISP_PACE = 0.011;
const WISP_THICK = 0.42;
const WISP_CLEAR = [3, 8];
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
        // The falling stars: where each starts and how far along it is (xyz, progress), which way it
        // goes and how bright it is now (xyz, strength). The first is the one that falls by itself and
        // for a clear, one after another; the rest fall together with it in a perfect clear's fan.
        this.meteorFrom = Array.from({ length: METEORS }, () => new THREE.Vector4(0, 1, 0, 0));
        this.meteorAlong = Array.from({ length: METEORS }, () => new THREE.Vector4(1, 0, 0, 0));
        this.uMeteorFrom = uniformArray(this.meteorFrom);
        this.uMeteorAlong = uniformArray(this.meteorAlong);
        this.meteors = Array.from({ length: METEORS }, () => ({
            active: false, age: 0, life: 0.9, strength: 1, wait: 0,
        }));
        [this.meteor] = this.meteors;
        this.meteorClock = 9 + rng() * 14;
        // Stars the game asked for that are still to fall (they fall one after another, never
        // cutting short the one in the sky), and the breath between two of them.
        this.pendingStars = 0;
        this.starGap = 0;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildSky();
        this.buildMist();
        this.buildWisps();
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
        // (The air sets the pace: the drift is summed in the light rig, so a change of pace never jumps it.)
        const drift = light.uCloudScroll.mul(0.0014);
        const density = light.noise(plane.mul(vec2(0.05, 0.13)).add(vec2(drift, 0))).g.mul(0.55)
            .add(light.noise(plane.mul(vec2(0.12, 0.34)).sub(vec2(drift.mul(1.7), 0.3))).b.mul(0.3))
            .add(light.noise(plane.mul(vec2(0.31, 0.8)).add(vec2(drift.mul(2.6), 0.1))).a.mul(0.15));
        // The air's cloud: the thin streaks of a clear night thicken until they close the sky.
        const closing = light.uCloud;
        const cover = smoothstep(closing.mul(-0.34).add(0.55), closing.mul(-0.3).add(0.7), density)
            .mul(smoothstep(0.02, 0.2, direction.y))
            .mul(mix(smoothstep(0.5, 0.95, direction.y).oneMinus().mul(0.75).add(0.25), float(1), closing));
        const edge = smoothstep(0.52, 0.78, density).oneMinus();
        const body = mix(light.uCloudAway, light.uCloudToward, toward)
            // A closed sky is lit from above by the moon it hides: its bellies carry a little of it.
            .mul(closing.mul(density.mul(1.6).add(0.4)).add(1));
        // The moon's own colour, not what the cloud leaves of its light: a veiled moon lights its cloud.
        const behind = light.uMoonColor.mul(light.uVeil);
        const lining = light.moonColour().mul(pow(moonward, 10).mul(0.16).add(pow(toward, 2).mul(edge).mul(0.03)))
            .add(behind.mul(pow(moonward, 26).mul(0.34).add(pow(moonward, 6).mul(0.035)))
                .mul(density.mul(0.9).add(0.35)));
        const cloud = body.add(lining);

        // Stars, thinned toward the moon and the horizon; the Milky Way lifts them in a band.
        // (Under a clouded moon the clear sky between the clouds is darker too.)
        let night = light.sky(direction).mul(light.uVeil.mul(-0.45).add(1));
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
            // The hour says how many of them show: all in deep night, few at first light.
            night = night.add(field.mul(clear).mul(0.9).add(vec3(0.02, 0.03, 0.05).mul(river).mul(clear))
                .mul(light.uStars));
        }
        let sky = mix(night, cloud, cover.mul(0.82));

        // The falling stars: each a bright head and a tail that thins behind it.
        const streaks = Fn(() => {
            const along = direction.toVar();
            const total = float(0).toVar();
            Loop(METEORS, ({ i }) => {
                const from = this.uMeteorFrom.element(i).toVar();
                const way = this.uMeteorAlong.element(i).toVar();
                const head = normalize(from.xyz.add(way.xyz.mul(from.w.mul(0.42)))).toVar();
                const tail = normalize(from.xyz.add(way.xyz.mul(from.w.mul(0.42).sub(0.1).max(0)))).toVar();
                const span = head.sub(tail).toVar();
                const reach = clamp(dot(along.sub(tail), span).div(dot(span, span).max(1e-6)), 0, 1).toVar();
                const off = length(along.sub(tail).sub(span.mul(reach))).toVar();
                const reach2 = reach.mul(reach);
                total.addAssign(exp(off.div(0.0011).pow2().negate()).mul(reach2)
                    .add(exp(off.div(0.0034).pow2().negate()).mul(reach2.mul(reach2).mul(reach2)).mul(0.6))
                    .mul(way.w));
            });
            return total;
        })();
        sky = sky.add(vec3(0.85, 0.95, 1.2).mul(streaks).mul(cover.mul(0.7).oneMinus()));

        // The moon: its own lit face, in deep night warm ivory against the blue it makes of
        // everything else, amber when it has just risen.
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
        const moonFace = face.mul(light.uMoonFace).mul(limb).mul(2.7);
        // Glare hugging the limb, a wide soft aureole, and the faint ring ice lays 22° out, which
        // a back-to-back lights silver with a warm inner edge (uHalo).
        const beyond = max(angle.sub(radius), 0);
        const glare = light.uMoonFace.mul(vec3(1.0, 0.979, 0.951)).mul(exp(beyond.mul(-34)).mul(0.5))
            .add(light.uAureole.mul(exp(beyond.mul(-7.5)).mul(0.1)));
        const offRing = angle.sub(THREE.MathUtils.degToRad(HALO_DEGREES));
        const ring = exp(offRing.div(0.016).pow2().negate());
        const warm = exp(offRing.add(0.012).div(0.01).pow2().negate());
        const ice = light.uMoonGain.sub(0.72).max(0).mul(0.05).add(light.uHalo.mul(0.3));
        const halo = vec3(0.7, 0.85, 1.05).mul(ring).mul(ice)
            .add(vec3(1.0, 0.78, 0.42).mul(warm).mul(light.uHalo.mul(0.18)));
        // Thin cloud dims the moon; the air's cloud takes it altogether, down to a pale disc in the grey.
        const veiled = cover.mul(0.5).oneMinus().mul(light.uVeil.mul(0.78).oneMinus());
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
            const scroll = light.uMistScroll.mul(0.0035 + index * 0.001);
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
            // (The air thickens and thins the banks; never to a wall.)
            material.opacityNode = smoothstep(0.28, 0.76, billow).mul(band).mul(sides)
                .mul(light.uBanks.mul(thickness).min(0.9));
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

    /**
     * Wreaths of mist low in the glade, near the eye: soft cards a few metres across that drift
     * with the air a hand or two above the ferns, lit where a moonbeam finds them and dark in the
     * trees' shade, so the beams have something to fall through this side of the far banks. Each
     * drifts across a stretch of the floor and comes round again, thinning to nothing at both
     * ends of it, so none is ever seen to appear. Their own generator: the forest's draws stay
     * as they were.
     */
    buildWisps() {
        const { light } = this;
        const count = Math.max(0, Math.floor(this.tier.wisps || 0));
        if (!count) return;
        const rng = seededRandom(WISP_SEED);
        const place = new Float32Array(count * 4); // where it drifts about (a little above the floor there), phase
        const shape = new Float32Array(count * 4); // width, height, pace, seed
        for (let i = 0; i < count; i += 1) {
            // Along the ride and out to both sides of where the board stands, near to middling far.
            const spot = forestRidePoint(7 + rng() ** 1.2 * 40, (rng() * 2 - 1) * (9 + rng() * 9));
            place.set([spot.x, forestGroundHeight(spot.x, spot.z) + 0.5 + rng() * 1.1, spot.z, rng()], i * 4);
            shape.set([7 + rng() * 8, 1.5 + rng() * 1.5, 0.6 + rng() * 0.8, rng()], i * 4);
        }
        const at = instancedBufferAttribute(new THREE.InstancedBufferAttribute(place, 4));
        const form = instancedBufferAttribute(new THREE.InstancedBufferAttribute(shape, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false,
        }));
        material.name = 'ForestMistWisps';
        const vWisp = varyingProperty('vec4', 'vForestWisp'); // how far through its drift, seed, -, -
        material.positionNode = Fn(() => {
            // How far through its stretch it has drifted, 0..1 and round again.
            const through = fract(at.w.add(light.uMistScroll.mul(form.z).mul(WISP_PACE))).toVar();
            const along = through.sub(0.5).mul(WISP_STRETCH);
            // (Its height is its home's: the floor rolls a hand's breadth under its drift, and the
            // fragment's own fade keeps it off the moss.)
            const centre = vec3(
                at.x.add(light.uWindDir.x.mul(along)),
                at.y,
                at.z.add(light.uWindDir.z.mul(along)),
            ).toVar();
            // A card that stands up and turns to the eye about its own height.
            const away = centre.sub(cameraPosition);
            const across = normalize(vec3(away.z, 0, away.x.negate()).add(vec3(0.00001, 0, 0)));
            vWisp.assign(vec4(through, form.w, 0, 0));
            return centre.add(across.mul(positionGeometry.x.mul(form.x)))
                .add(vec3(0, positionGeometry.y.mul(form.y), 0));
        })();
        const st = uv();
        const world = positionWorld;
        // A wreath, not a card: its body is eaten by a noise that drifts through it.
        const churn = vec2(vWisp.y.mul(5.3).add(light.uMistScroll.mul(0.004)), vWisp.y.mul(2.7));
        const eaten = light.noise(st.mul(vec2(0.42, 0.3)).add(churn)).g.mul(0.6)
            .add(light.noise(st.mul(vec2(1.1, 0.7)).sub(churn.mul(1.6))).b.mul(0.4));
        const centred = st.sub(0.5).mul(2);
        const body = saturate(float(1).sub(centred.x.mul(centred.x)).sub(centred.y.mul(centred.y).mul(1.15)))
            .mul(smoothstep(0.3, 0.72, eaten));
        // It never shows where it meets the moss, and it comes and goes at the ends of its drift.
        const lift = smoothstep(0.02, 0.5, world.y.sub(light.groundAt(world)));
        const drifted = sin(vWisp.x.mul(Math.PI));
        // Nor a pale plate across the lens where one drifts close to the eye.
        const clear = smoothstep(WISP_CLEAR[0], WISP_CLEAR[1], length(world.sub(cameraPosition)));
        const direction = normalize(world.sub(cameraPosition));
        const moonward = saturate(dot(direction, light.uMoonDir));
        const glow = light.glow(world);
        // Mist scatters the sky's light even in shade: a pale veil over the dark floor, never its colour.
        material.colorNode = light.uHazeCool.mul(1.5).add(light.uSkyLight.mul(0.55))
            .add(light.uHazeMoon.mul(light.uMoonGain).mul(light.moonlight()).mul(pow(moonward, 2).mul(1.3).add(0.3)))
            .add(glow.mul(0.8));
        material.opacityNode = body.mul(lift).mul(drifted).mul(clear).mul(light.uBanks.mul(WISP_THICK).min(0.7));
        const wisps = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        wisps.name = 'ForestMistWisps';
        wisps.renderOrder = 26;
        wisps.frustumCulled = false;
        wisps.matrixAutoUpdate = false;
        this.wisps = wisps;
        this.group.add(wisps);
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
        material.opacityNode = disc.pow2().mul(flutter).mul(light.moonlight()).mul(light.uMotes.min(3));
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'ForestMoonMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.motes = motes;
        this.group.add(motes);
    }

    /**
     * Send a star across the sky to the right of the moon: the one that falls by itself (`slot` 0),
     * or one of a fan (`wait` seconds on; `side` -1 or 1 says which way it falls, else chance does).
     */
    shoot(strength = 1, { slot = 0, wait = 0, side = 0 } = {}) {
        const { rng } = this;
        const meteor = this.meteors[slot] || this.meteor;
        const index = this.meteors.indexOf(meteor);
        const azimuth = THREE.MathUtils.degToRad(-12 + rng() * 62);
        const elevation = THREE.MathUtils.degToRad(24 + rng() * 14);
        this.meteorFrom[index].set(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.sin(elevation),
            -Math.cos(azimuth) * Math.cos(elevation),
            0,
        );
        const way = side || (rng() < 0.5 ? -1 : 1);
        const fall = way * (0.5 + rng() * 0.5);
        const drop = -0.42 - rng() * 0.3;
        const span = Math.hypot(fall, drop) || 1;
        this.meteorAlong[index]
            .set((fall * Math.cos(azimuth)) / span, drop / span, (fall * Math.sin(azimuth)) / span, 0);
        meteor.active = true;
        meteor.age = 0;
        meteor.wait = Number.isFinite(wait) ? Math.max(0, wait) : 0;
        meteor.life = 0.7 + rng() * 0.5;
        meteor.strength = THREE.MathUtils.clamp(strength, 0.2, 1.6);
    }

    /**
     * A perfect clear's fan: every star the sky can hold falls at once, a breath apart, all one
     * way. The one that falls by itself joins it unless it is in the sky already.
     */
    fan(strength = 1.4) {
        const side = this.rng() < 0.5 ? -1 : 1;
        for (let slot = 0; slot < METEORS; slot += 1) {
            if (this.meteors[slot].active) continue;
            this.shoot(strength * (1 - slot * 0.08), { slot, wait: slot * 0.14, side });
        }
    }

    resetEffects() {
        for (let slot = 0; slot < METEORS; slot += 1) {
            this.meteors[slot].active = false;
            this.meteorFrom[slot].w = 0;
            this.meteorAlong[slot].w = 0;
        }
        this.starSerial = undefined;
        this.showerSerial = undefined;
        this.pendingStars = 0;
        this.starGap = 0;
    }

    /**
     * `frame.stars` counts the falling stars the game has asked for: each falls in turn, after the
     * one in the sky. One also falls now and then, and in a fever (`frame.surge.fever`) the clock
     * runs many times faster: stars fall through the moonbeams every second or two.
     */
    update(dt, frame = {}) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        if (Number.isFinite(frame.stars) && frame.stars !== this.starSerial) {
            if (this.starSerial !== undefined && frame.stars > this.starSerial) {
                this.pendingStars = Math.min(MAX_PENDING_STARS, this.pendingStars + frame.stars - this.starSerial);
            }
            this.starSerial = frame.stars;
        }
        this.starGap = Math.max(0, this.starGap - step);
        if (this.pendingStars > 0 && !this.meteor.active && this.starGap <= 0) {
            this.pendingStars -= 1;
            this.shoot(1.3);
        }
        const fever = Number.isFinite(frame.surge?.fever) ? THREE.MathUtils.clamp(frame.surge.fever, 0, 1) : 0;
        this.meteorClock -= step * (1 + fever * SHOWER);
        if (this.meteorClock <= 0 && !this.meteor.active && frame.settled !== true) {
            this.meteorClock = 14 + this.rng() * 22;
            this.shoot(0.7 + fever * 0.4);
        }
        // `frame.shower` counts the fans asked for (a perfect clear's): all the sky's stars at once.
        if (Number.isFinite(frame.shower) && frame.shower !== this.showerSerial) {
            if (this.showerSerial !== undefined && frame.shower > this.showerSerial) this.fan();
            this.showerSerial = frame.shower;
        }
        for (let slot = 0; slot < METEORS; slot += 1) {
            const meteor = this.meteors[slot];
            if (!meteor.active) continue;
            if (meteor.wait > 0) {
                meteor.wait -= step;
                continue;
            }
            meteor.age += step;
            const progress = meteor.age / meteor.life;
            if (progress >= 1) {
                meteor.active = false;
                this.meteorFrom[slot].w = 0;
                this.meteorAlong[slot].w = 0;
                if (slot === 0) this.starGap = STAR_GAP;
            } else {
                this.meteorFrom[slot].w = progress;
                this.meteorAlong[slot].w = Math.sin(Math.PI * Math.min(1, progress * 1.1)) * meteor.strength;
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

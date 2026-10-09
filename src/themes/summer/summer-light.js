/**
 * Summer — the light, air and wind of Midsummer's Eve.
 *
 * The sun of the longest day stands low over the lake and never quite sets. Materials stay
 * unlit node materials and call into this rig, so both renderer backends shade
 * identically: a shared shadow node (one static shadow map of the meadow and its trees)
 * says where the sun reaches, `haze()` lays the same blue-to-gold aerial perspective over
 * every surface, `wind()` moves bark and leaves together, and `meadowWind()` rolls gusts
 * through grass and flowers — the steady breeze, and the rings that spread from the foot
 * of the board when the game asks for them.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, dot, exp, float, length, max, mix, normalize, positionWorld, pow, saturate, shadow, sin,
    smoothstep, step, texture, uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import {
    SUMMER_HOUR_COLOURS, SUMMER_HOURS, createSummerHourState, summerHourAt, summerSunDirection,
} from './summer-hours.js';
import { SummerRings } from './summer-rings.js';

/** Where the evening sun stands (degrees); the other hours' suns are in summer-hours.js. */
export const SUMMER_SUN_AZIMUTH_DEGREES = SUMMER_HOURS[0].sunAzimuth;
export const SUMMER_SUN_ELEVATION_DEGREES = SUMMER_HOURS[0].sunElevation;
// The shadow map follows the sun once it has moved this far, and no more often than this.
const SHADOW_AIM_STEP = THREE.MathUtils.degToRad(0.03);
const SHADOW_AIM_FRAMES = 2;
const TAU = Math.PI * 2;
/** How fast a gust ring crosses the meadow, metres a second. */
export const SUMMER_WAVE_SPEED = 9;
const WAVE_LIFE = 4.2;
/** Flower kinds a piece can excite (seven for the crown, one spare). */
export const SUMMER_SPECIES_SLOTS = 8;

/**
 * Unit vector from the scene toward the evening sun, which the resting camera sees in the
 * ring of the maypole's wreath. Through the night the sun moves (summer-hours.js) but keeps
 * to the open water left of the board, beside the maypole: in single player the score card
 * stands right of the board, and a sun on that side would be hidden behind it.
 */
export const SUMMER_SUN_DIRECTION = Object.freeze(new THREE.Vector3(
    ...summerSunDirection(SUMMER_SUN_AZIMUTH_DEGREES, SUMMER_SUN_ELEVATION_DEGREES),
));

/** Four channels of tileable value noise at rising frequencies. */
function createNoiseTexture(rng, size = 128) {
    const data = new Uint8Array(size * size * 4);
    [4, 8, 16, 32].forEach((cells, channel) => {
        const lattice = new Float32Array(cells * cells);
        for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
        const at = (x, y) => lattice[(y % cells) * cells + (x % cells)];
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const fx = (x / size) * cells;
                const fy = (y / size) * cells;
                const x0 = Math.floor(fx);
                const y0 = Math.floor(fy);
                const tx = (fx - x0) * (fx - x0) * (3 - 2 * (fx - x0));
                const ty = (fy - y0) * (fy - y0) * (3 - 2 * (fy - y0));
                const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
                const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
                data[(y * size + x) * 4 + channel] = Math.round((top * (1 - ty) + bottom * ty) * 255);
            }
        }
    });
    const noise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    noise.wrapS = THREE.RepeatWrapping;
    noise.wrapT = THREE.RepeatWrapping;
    noise.magFilter = THREE.LinearFilter;
    noise.minFilter = THREE.LinearMipmapLinearFilter;
    noise.generateMipmaps = true;
    noise.colorSpace = THREE.NoColorSpace;
    noise.name = 'SummerValueNoise';
    noise.needsUpdate = true;
    return noise;
}

export class SummerLight {
    constructor({ tier, rng = Math.random }) {
        this.tier = tier;
        this.uTime = uniform(0);
        this.uSunDir = uniform(SUMMER_SUN_DIRECTION.clone());
        // Every colour of the light starts at the evening hour and follows the night from
        // there: setHour() copies an hour of summer-hours.js into these uniforms.
        const evening = SUMMER_HOURS[0];
        const tone = (key) => uniform(new THREE.Color(...evening[key]));
        this.uSunColor = tone('sun');
        this.uSkyLight = tone('skyLight');
        this.uBounce = tone('bounce');
        // The sky: overhead, the middle of the dome, and the band at the horizon away from
        // the sun and toward it.
        this.uZenith = tone('zenith');
        this.uSkyMid = tone('skyMid');
        this.uSkyAway = tone('skyAway');
        this.uSkyToward = tone('skyToward');
        // Shaded air is the colour of distance; sunlit air is added by the volumetric shafts
        // where the tier has them, and by this analytic glow where it does not.
        this.uHazeCool = tone('hazeCool');
        this.uHazeWarm = tone('hazeWarm');
        this.uHazeSun = uniform(tier.godrays > 0 ? 0.55 : 1);
        this.uHaze = uniform(evening.haze);
        // Clouds (shaded side, body, sunlit edge) and the high cirrus, each from the side of
        // the sky away from the sun to the side toward it; the lit air of the shafts; and how
        // brightly the lamps behind the windows burn.
        this.uCloudShadeAway = tone('cloudShadeAway');
        this.uCloudShadeToward = tone('cloudShadeToward');
        this.uCloudBodyAway = tone('cloudBodyAway');
        this.uCloudBodyToward = tone('cloudBodyToward');
        this.uCloudGiltAway = tone('cloudGiltAway');
        this.uCloudGiltToward = tone('cloudGiltToward');
        this.uCirrusAway = tone('cirrusAway');
        this.uCirrusToward = tone('cirrusToward');
        this.uShaftCool = tone('shaftCool');
        this.uShaftWarm = tone('shaftWarm');
        this.uLamps = uniform(evening.lamps);
        this.hourUniforms = {
            sun: this.uSunColor,
            skyLight: this.uSkyLight,
            bounce: this.uBounce,
            zenith: this.uZenith,
            skyMid: this.uSkyMid,
            skyAway: this.uSkyAway,
            skyToward: this.uSkyToward,
            hazeCool: this.uHazeCool,
            hazeWarm: this.uHazeWarm,
            cloudShadeAway: this.uCloudShadeAway,
            cloudShadeToward: this.uCloudShadeToward,
            cloudBodyAway: this.uCloudBodyAway,
            cloudBodyToward: this.uCloudBodyToward,
            cloudGiltAway: this.uCloudGiltAway,
            cloudGiltToward: this.uCloudGiltToward,
            cirrusAway: this.uCirrusAway,
            cirrusToward: this.uCirrusToward,
            shaftCool: this.uShaftCool,
            shaftWarm: this.uShaftWarm,
        };
        /** The hour the uniforms hold now (colours, haze, lamps, exposure). */
        this.hour = summerHourAt(0, createSummerHourState());
        /** A playground knob: a number here replaces the hour's haze density. */
        this.hazeOverride = null;
        // The box the shadow map covers, and the sun direction it was last drawn for.
        this.shadowCentre = new THREE.Vector3(4, 8, -8);
        this.shadowDepth = 420;
        this.aimedDirection = SUMMER_SUN_DIRECTION.clone();
        this.framesSinceAim = 0;
        this.sunScratch = [0, 0, 0];
        this.uGroundLevel = uniform(0);
        // Wind: a steady breeze off the lake, gusts that roll across the meadow in bands,
        // and a travelling front.
        this.uWindDir = uniform(new THREE.Vector3(0.88, 0, 0.47));
        this.uWind = uniform(0.3);
        this.uGust = uniform(0);
        this.uFront = uniform(new THREE.Vector4(0, 0, 20, 0)); // x, strength, width
        // Gameplay envelopes shared by every material.
        this.uWarmth = uniform(0);
        this.uGlow = uniform(0);
        // Gusts that spread through the meadow from the foot of the board, and how strongly
        // each kind of flower has just been called on.
        this.waves = new SummerRings(tier.waves, WAVE_LIFE);
        this.uWaves = uniformArray(this.waves.rings);
        this.species = new Float32Array(SUMMER_SPECIES_SLOTS);
        this.speciesVectors = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];
        this.uSpecies = uniformArray(this.speciesVectors);
        this.noiseTexture = createNoiseTexture(rng);

        this.sun = new THREE.DirectionalLight(0xffffff, 1);
        this.sun.name = 'SummerMidnightSun';
        this.sun.castShadow = true;
        const { shadow: sunShadow } = this.sun;
        sunShadow.mapSize.set(tier.shadowMap[0], tier.shadowMap[1]);
        // A coarser map needs more bias, or the boughs shade themselves in stripes.
        sunShadow.bias = -0.0011 * (2048 / tier.shadowMap[0]) ** 1.5;
        sunShadow.normalBias = 0;
        sunShadow.radius = 2.6;
        // The land never moves and the sun moves slowly, so its shadows are drawn only when
        // the sun has moved a little way (aimSun), not every frame.
        sunShadow.autoUpdate = false;
        sunShadow.needsUpdate = true;
        this.shadowNode = shadow(this.sun);
        this.shadowFrames = 0;
    }

    /** Aim the shadow camera so its box holds the meadow, its trees and the cove. */
    frameShadows({
        centre = new THREE.Vector3(4, 8, -8), halfWidth = 62, halfHeight = 30, depth = 420,
    } = {}) {
        const { sun } = this;
        this.shadowCentre.copy(centre);
        this.shadowDepth = depth;
        const { camera } = sun.shadow;
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.near = 1;
        camera.far = depth;
        camera.updateProjectionMatrix();
        this.aimSun(true);
        this.shadowFrames = 0;
    }

    /**
     * Stand the shadow's light where the sun is now and ask for the map again. Returns true
     * when it did: only once the sun has moved a little way since the last time, and not on
     * consecutive frames, so a turning night costs a shadow pass now and then, not each frame.
     */
    aimSun(force = false) {
        const direction = this.uSunDir.value;
        this.framesSinceAim += 1;
        if (!force && (this.framesSinceAim < SHADOW_AIM_FRAMES
            || direction.angleTo(this.aimedDirection) < SHADOW_AIM_STEP)) return false;
        const { sun } = this;
        sun.position.copy(this.shadowCentre).addScaledVector(direction, this.shadowDepth * 0.5);
        sun.target.position.copy(this.shadowCentre);
        sun.updateMatrixWorld(true);
        sun.target.updateMatrixWorld(true);
        sun.shadow.needsUpdate = true;
        this.aimedDirection.copy(direction);
        this.framesSinceAim = 0;
        return true;
    }

    addTo(group) {
        group.add(this.sun, this.sun.target);
    }

    /**
     * Wear the hour of the night at `phase` (see summer-hours.js): its colours go into the
     * uniforms, and the sun stands where that hour has it.
     */
    setHour(phase) {
        const hour = summerHourAt(phase, this.hour);
        for (const key of SUMMER_HOUR_COLOURS) {
            const value = hour[key];
            const colour = this.hourUniforms[key].value;
            colour.r = value[0];
            colour.g = value[1];
            colour.b = value[2];
        }
        this.uHaze.value = Number.isFinite(this.hazeOverride) ? this.hazeOverride : hour.haze;
        this.uLamps.value = hour.lamps;
        const [x, y, z] = summerSunDirection(hour.sunAzimuth, hour.sunElevation, this.sunScratch);
        this.uSunDir.value.set(x, y, z);
        this.aimSun();
        return hour;
    }

    /** 1 where the sun reaches the fragment, 0 in shadow. */
    sunlight() {
        return float(this.shadowNode);
    }

    noise(coordinate) {
        return texture(this.noiseTexture, coordinate);
    }

    /** Sky radiance seen along a unit direction (no disc, no cloud). */
    sky(direction) {
        const sunward = saturate(dot(direction, this.uSunDir));
        const overhead = saturate(direction.y);
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const sunFlat = normalize(vec2(this.uSunDir.x, this.uSunDir.z));
        const toward = dot(flat, sunFlat).mul(0.5).add(0.5);
        const band = mix(this.uSkyAway, this.uSkyToward, pow(toward, 2.6).mul(this.uWarmth.mul(0.15).add(0.95)));
        const upper = mix(this.uZenith, this.uSkyMid, pow(overhead.oneMinus(), 2.2));
        const glow = this.uSunColor.mul(pow(sunward, 7).mul(0.03).add(pow(sunward, 48).mul(0.1)));
        // The warm rim keeps low: toward the sun it climbs a little higher up the sky.
        const rim = pow(overhead.oneMinus(), mix(float(8), float(4.6), pow(toward, 3)));
        return mix(upper, band, rim).add(glow);
    }

    /** Aerial perspective: distance and the damp air over the water fade a colour into lit air. */
    haze(colour, { world = positionWorld, strength = 1 } = {}) {
        const offset = world.sub(cameraPosition);
        const range = length(offset);
        const direction = offset.div(max(range, 0.001));
        const low = exp(max(world.y.sub(this.uGroundLevel), 0).mul(-0.028));
        const amount = exp(range.mul(this.uHaze).mul(low.mul(0.9).add(0.45)).negate()).oneMinus();
        const sunward = saturate(dot(direction, this.uSunDir));
        const air = this.uHazeCool.add(this.uHazeWarm.mul(pow(sunward, 3).mul(this.uHazeSun)
            .add(this.uWarmth.mul(0.05))));
        return mix(colour, air, saturate(amount.mul(strength)));
    }

    /** Hemisphere ambient: blue sky from above, the green of the meadow from below. */
    ambient(normal) {
        return mix(this.uBounce, this.uSkyLight, normal.y.mul(0.5).add(0.5));
    }

    /**
     * World-space wind offset for a point on a tree. `sway` is how far the wind may carry
     * the point (0 at the trunk, 1 at twig tips); `phase` keeps each limb out of step.
     */
    wind({
        world, base, height, treePhase, sway, phase,
    }) {
        const t = this.uTime;
        const along = world.x.mul(this.uWindDir.x).add(world.z.mul(this.uWindDir.z));
        const swell = sin(along.mul(0.04).sub(t.mul(0.8)).add(world.x.mul(0.017))).mul(0.5).add(0.5);
        const front = exp(world.x.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
        const force = this.uWind.add(this.uGust.mul(swell.mul(0.7).add(0.65))).add(front);
        const lift = saturate(world.y.sub(base.y).div(height));
        const lean = lift.mul(lift).mul(height).mul(0.012).mul(force)
            .mul(sin(t.mul(0.5).add(treePhase.mul(TAU))).mul(0.35).add(0.75));
        const limb = sway.mul(sway).mul(force).mul(
            sin(t.mul(1.3).add(phase.mul(TAU)).add(along.mul(0.19))).mul(0.3)
                .add(sin(t.mul(2.4).add(phase.mul(15.1))).mul(0.1)),
        );
        const bob = sway.mul(force).mul(sin(t.mul(1.7).add(phase.mul(9.4)))).mul(0.16);
        const push = lean.add(limb);
        return vec3(this.uWindDir.x.mul(push), bob.sub(limb.abs().mul(0.2)), this.uWindDir.z.mul(push));
    }

    /**
     * What the air is doing at a root in the meadow: `push` is the horizontal shove in
     * metres for a point one metre up a stem (scale by height squared), `gust` says how
     * hard the passing band is blowing (0..1) and `bloom` how strongly a ring from the
     * board is passing through right now.
     */
    meadowWind(root, phase) {
        const t = this.uTime;
        const direction = vec2(this.uWindDir.x, this.uWindDir.z);
        const along = root.x.mul(direction.x).add(root.z.mul(direction.y));
        const cross = root.x.mul(direction.y).sub(root.z.mul(direction.x));
        // Bands of wind travelling downwind, long across it: cat's-paws on the grass.
        const band = sin(along.mul(0.085).sub(t.mul(0.62)).add(cross.mul(0.021)))
            .add(sin(along.mul(0.19).sub(t.mul(1.05)).sub(cross.mul(0.047)).add(1.7)).mul(0.6))
            .add(sin(along.mul(0.043).sub(t.mul(0.33)).add(cross.mul(0.013)).add(4.1)).mul(0.8))
            .div(2.4);
        const gust = smoothstep(-0.25, 0.85, band);
        const front = exp(root.x.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
        const force = this.uWind.mul(gust.mul(1.25).add(0.3)).add(this.uGust.mul(gust.add(0.5))).add(front);
        const flutter = sin(t.mul(phase.mul(1.7).add(2.2)).add(phase.mul(40)).add(along.mul(0.6))).mul(0.34)
            .add(sin(t.mul(5.3).add(phase.mul(91))).mul(0.12)).add(0.8);
        let push = direction.mul(force.mul(flutter));
        let bloom = float(0);
        for (let i = 0; i < this.waves.count; i += 1) {
            const wave = this.uWaves.element(i); // x, z, age, strength
            const offset = root.xz.sub(wave.xy);
            const distance = length(offset).add(0.001);
            const reach = distance.sub(wave.z.mul(SUMMER_WAVE_SPEED));
            const packet = exp(reach.div(wave.z.mul(0.55).add(1.1)).pow2().negate());
            const amplitude = packet.mul(wave.w).mul(exp(wave.z.mul(-0.55))).div(distance.mul(0.035).add(1)).min(1.2);
            push = push.add(offset.div(distance).mul(amplitude.mul(1.25)));
            bloom = bloom.add(amplitude);
        }
        return {
            push, gust: saturate(force.mul(0.9)), bloom: saturate(bloom), front: saturate(front),
        };
    }

    /** How strongly a flower kind (0..7) has just been called on by the game (TSL). */
    speciesGlow(index) {
        const low = this.uSpecies.element(0);
        const high = this.uSpecies.element(1);
        const at = (slot, place) => step(0.5, slot.sub(place).abs()).oneMinus();
        const pick = (vector, slot) => vector.x.mul(at(slot, 0)).add(vector.y.mul(at(slot, 1)))
            .add(vector.z.mul(at(slot, 2))).add(vector.w.mul(at(slot, 3)));
        return pick(low, index).add(pick(high, index.sub(4)));
    }

    update(time, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        this.setHour(Number.isFinite(frame.hour) ? frame.hour : 0);
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        this.uGust.value = clamp01(frame.gust) * 1.5;
        this.uWarmth.value = clamp01(frame.warmth);
        this.uGlow.value = clamp01(frame.glow);
        if (frame.front && Number.isFinite(frame.front.x)) {
            this.uFront.value.set(frame.front.x, clamp01(frame.front.strength) * 2, 20, 0);
        } else this.uFront.value.y = 0;
        const species = Array.isArray(frame.species) || ArrayBuffer.isView(frame.species) ? frame.species : null;
        for (let i = 0; i < SUMMER_SPECIES_SLOTS; i += 1) this.species[i] = species ? clamp01(species[i]) : 0;
        this.speciesVectors[0].fromArray(this.species, 0);
        this.speciesVectors[1].fromArray(this.species, 4);
        // Pipelines may still be compiling when the first shadow map is drawn; redraw it
        // over the first frames so no late tree is missing from the static map.
        this.shadowFrames += 1;
        if (this.shadowFrames < 10 || this.shadowFrames === 45 || this.shadowFrames === 150) {
            this.sun.shadow.needsUpdate = true;
        }
    }

    /** Age the gusts in the meadow. */
    step(dt) {
        this.waves.update(dt);
    }

    reset() {
        this.waves.reset();
        this.species.fill(0);
        this.speciesVectors.forEach((vector) => vector.set(0, 0, 0, 0));
    }

    dispose() {
        this.noiseTexture.dispose();
        this.shadowNode.dispose?.();
        this.sun.shadow.dispose();
        this.sun.removeFromParent();
        this.sun.target.removeFromParent();
        this.sun.dispose();
    }
}

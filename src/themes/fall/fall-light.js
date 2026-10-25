/**
 * Fall — the grove's light, air and wind.
 *
 * One low sun behind the trees lights everything. Materials stay unlit node materials and
 * call into this rig, so both renderer backends shade identically: a shared shadow node
 * (one static shadow map of the whole grove) says where the sun reaches, `haze()` adds the
 * same aerial perspective to every surface, and `wind()` moves bark and leaves together.
 *
 * Whatever MOVES the grove (the gust, the standing breeze of hot play, the wisps' wander) follows
 * its target through a critically damped spring, so a lock or a clear makes the boughs lean in
 * over a fraction of a second instead of jerking to a new pose in one frame. The light itself
 * (warmth, glow) answers at once. As play heats the low sun deepens to late amber and the air
 * clears; a perfect clear's sunburst brightens it (frame-wide, so under Reduce flashing).
 *
 * The light itself turns by the clock (fall-moods.js): `setMood()` lays a light's colours, haze
 * and exposure on the rig as its rest, and play turns whichever light it is toward late amber.
 * The sun never moves, so the grove's static shadow map stays true in every light.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, dot, exp, float, length, max, mix, normalize, positionWorld, pow, saturate, shadow, sin,
    texture, uniform, vec2, vec3,
} from 'three/tsl';
import { gridShadowFilter } from '../shared/grid-shadow-filter.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { FALL_MOODS, createFallMood, fallMoodAt } from './fall-moods.js';

const SUN_AZIMUTH = THREE.MathUtils.degToRad(-23.4);
const SUN_ELEVATION = THREE.MathUtils.degToRad(11.5);
const TAU = Math.PI * 2;
/** The light a session opens in (the quiet afternoon), whose colours the rig is built with. */
const FIRST_MOOD = FALL_MOODS[0];
/**
 * The low sun as it stands in a quiet afternoon, and the late amber a fever turns it to. Every
 * light the clock brings turns the same way, by the same share of each channel.
 */
const SUN_COLOUR = FIRST_MOOD.sun;
const SUN_LATE = Object.freeze([3.9, 1.82, 0.62]);
const SUN_LATE_SHARE = Object.freeze(SUN_LATE.map((late, i) => late / SUN_COLOUR[i]));
/** How far the colour of play turns the sun toward late amber (at a turn of 1). */
const SUN_TURN = 0.8;
/** How much brighter the sun burns at the height of a perfect clear's sunburst. */
const SUN_CROWN = 0.14;
const HAZE = FIRST_MOOD.haze;
/** How much the air clears in a fever (the far trees come forward, the colours hold). */
const HAZE_CLEAR = 0.22;
/** Spring rates (rad/s): the gust the boughs feel, the standing breeze, the wisps' wander. */
const SPRING = Object.freeze({ gust: 9, wind: 2.6, stir: 4 });
/** The steady breeze at rest, and how much a full standing breeze of hot play adds to it. */
const WIND_REST = 0.3;
const WIND_PLAY = 0.75;
/** Gust fronts the wind carries at once, and how wide each blows (m). */
export const FALL_LIGHT_FRONTS = 3;
const FRONT_WIDTH = 14;

/**
 * One step of a critically damped spring toward `target`, exact for a target held over `dt`
 * (so the same motion at any frame rate). `state` is {x, v}.
 */
function springTo(state, target, omega, dt) {
    const offset = state.x - target;
    const decay = Math.exp(-omega * dt);
    const lead = state.v + omega * offset;
    state.x = target + (offset + lead * dt) * decay;
    state.v = (state.v - omega * lead * dt) * decay;
    return state.x;
}

/** Unit vector from the scene toward the sun (behind the trees, left of the board). */
export const FALL_SUN_DIRECTION = Object.freeze(new THREE.Vector3(
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
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
    noise.name = 'FallValueNoise';
    noise.needsUpdate = true;
    return noise;
}

export class FallLight {
    constructor({ tier, rng = Math.random }) {
        this.tier = tier;
        this.uTime = uniform(0);
        this.uSunDir = uniform(FALL_SUN_DIRECTION.clone());
        // Every colour of the grove is a light's (fall-moods.js) and starts at the quiet afternoon's.
        const colour = (key) => uniform(new THREE.Color(...FIRST_MOOD[key]));
        this.uSunColor = colour('sun');
        this.uSkyLight = colour('skyLight');
        this.uBounce = colour('bounce');
        this.uZenith = colour('zenith');
        this.uSkyCool = colour('skyCool');
        this.uSkyWarm = colour('skyWarm');
        this.uSkyRose = colour('skyRose');
        // Shaded air is cool; sunlit air is added by the volumetric shafts where the tier
        // has them, and by this analytic glow where it does not.
        this.uHazeCool = colour('hazeCool');
        this.uHazeWarm = colour('hazeWarm');
        // The cloud deck's undersides away from the sun and toward it, and its bodies the same;
        // and the shafts' colour away from the sun and toward it.
        this.uCloudShade = colour('cloudShade');
        this.uCloudLit = colour('cloudLit');
        this.uCloudBody = colour('cloudBody');
        this.uCloudBodyWarm = colour('cloudBodyWarm');
        this.uShaftShade = colour('shaftShade');
        this.uShaftSun = colour('shaftSun');
        this.uHazeSun = uniform(tier.godrays > 0 ? 0.3 : 1);
        this.uHaze = uniform(HAZE);
        this.uGroundLevel = uniform(0);
        // Wind: a steady breeze, gusts that roll across the grove, and a travelling front.
        this.uWindDir = uniform(new THREE.Vector3(0.94, 0, 0.34));
        this.uWind = uniform(WIND_REST);
        this.uGust = uniform(0);
        // Up to three gust fronts: x and strength of the first two, then the third and the width.
        this.uFront = uniform(new THREE.Vector4(0, 0, 0, 0));
        this.uFrontC = uniform(new THREE.Vector4(0, 0, FRONT_WIDTH, 0));
        // Gameplay envelopes shared by every material.
        this.uWarmth = uniform(0);
        this.uGlow = uniform(0);
        // The glow as things that MOVE with it feel it (eased): the wisps wander wider in it.
        this.uStir = uniform(0);
        // How far play has turned the leaves from gold toward crimson (0..1).
        this.uTurn = uniform(0);
        // The light the grove stands in (setMood): its colours and numbers, how far round the
        // lights it is, its sun at rest and turned late, its haze and the exposure it asks of the
        // lens against rest.
        this.mood = createFallMood();
        this.moodPhase = 0;
        this.restSun = [...SUN_COLOUR];
        this.lateSun = [...SUN_LATE];
        this.restHaze = HAZE;
        this.exposureScale = FIRST_MOOD.exposure;
        this.frontSlots = new Float64Array(FALL_LIGHT_FRONTS * 2);
        this.oneFront = [null];
        this.springs = {
            gust: { x: 0, v: 0 }, wind: { x: WIND_REST, v: 0 }, stir: { x: 0, v: 0 },
        };
        this.noiseTexture = createNoiseTexture(rng);

        this.sun = new THREE.DirectionalLight(0xffffff, 1);
        this.sun.name = 'FallLowSun';
        this.sun.castShadow = true;
        const { shadow: sunShadow } = this.sun;
        sunShadow.mapSize.set(tier.shadowMap[0], tier.shadowMap[1]);
        sunShadow.bias = -0.0009;
        sunShadow.normalBias = 0;
        sunShadow.radius = 2.2;
        // three's PCF turns its samples by per-pixel noise, which drew a crosshatch over the whole
        // grove under this low sun; a fixed grid is as soft and clean. Nine taps where the tier
        // grades in post, four below.
        sunShadow.filterNode = gridShadowFilter(tier.shadowMap, sunShadow.radius, tier.post ? 9 : 4);
        // The grove never moves under a fixed sun, so its shadows are drawn once.
        sunShadow.autoUpdate = false;
        sunShadow.needsUpdate = true;
        this.shadowNode = shadow(this.sun);
        this.shadowFrames = 0;
    }

    /** Aim the shadow camera so its box holds everything the play camera can see. */
    frameShadows({
        centre = new THREE.Vector3(0, 9, -44), halfWidth = 78, halfHeight = 38, depth = 260,
    } = {}) {
        const { sun } = this;
        sun.position.copy(centre).addScaledVector(FALL_SUN_DIRECTION, depth * 0.5);
        sun.target.position.copy(centre);
        const { camera } = sun.shadow;
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.near = 1;
        camera.far = depth;
        camera.updateProjectionMatrix();
        sun.updateMatrixWorld(true);
        sun.target.updateMatrixWorld(true);
        sun.shadow.needsUpdate = true;
        this.shadowFrames = 0;
    }

    addTo(group) {
        group.add(this.sun, this.sun.target);
    }

    /** 1 where the sun reaches the fragment, 0 in shadow. */
    sunlight() {
        return float(this.shadowNode);
    }

    noise(coordinate) {
        return texture(this.noiseTexture, coordinate);
    }

    /** Sky radiance seen along a unit direction. */
    sky(direction) {
        const sunward = saturate(dot(direction, this.uSunDir));
        const overhead = saturate(direction.y);
        const horizon = pow(overhead.oneMinus(), 4.2);
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const sunFlat = normalize(vec2(this.uSunDir.x, this.uSunDir.z));
        const toward = dot(flat, sunFlat).mul(0.5).add(0.5);
        // Low down, the air away from the sun keeps a rose haze; toward it, gold.
        const low = mix(this.uSkyCool, this.uSkyRose, pow(overhead.oneMinus(), 9).mul(0.55));
        const band = mix(low, this.uSkyWarm, pow(toward, 3).mul(this.uWarmth.mul(0.25).add(0.9)));
        const glow = this.uSunColor.mul(pow(sunward, 5).mul(0.1).add(pow(sunward, 48).mul(0.3)));
        return mix(this.uZenith, band, horizon).add(glow);
    }

    /** Aerial perspective: distance and the damp forest floor fade a colour into lit air. */
    haze(colour, { world = positionWorld, strength = 1 } = {}) {
        const offset = world.sub(cameraPosition);
        const range = length(offset);
        const direction = offset.div(max(range, 0.001));
        const low = exp(max(world.y.sub(this.uGroundLevel), 0).mul(-0.07));
        const amount = exp(range.mul(this.uHaze).mul(low.mul(0.85).add(0.5)).negate()).oneMinus();
        const sunward = saturate(dot(direction, this.uSunDir));
        const air = this.uHazeCool.add(this.uHazeWarm.mul(pow(sunward, 3).mul(this.uHazeSun)
            .add(this.uWarmth.mul(0.12))));
        return mix(colour, air, saturate(amount.mul(strength)));
    }

    /** Hemisphere ambient: cool sky from above, warm leaf-litter bounce from below. */
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
        const swell = sin(along.mul(0.05).sub(t.mul(0.85)).add(world.x.mul(0.021))).mul(0.5).add(0.5);
        const width = this.uFrontC.z;
        const gale = (x, strength) => exp(world.x.sub(x).div(width).pow2().negate()).mul(strength);
        const front = gale(this.uFront.x, this.uFront.y).add(gale(this.uFront.z, this.uFront.w))
            .add(gale(this.uFrontC.x, this.uFrontC.y));
        const force = this.uWind.add(this.uGust.mul(swell.mul(0.7).add(0.65))).add(front);
        const lift = saturate(world.y.sub(base.y).div(height));
        const lean = lift.mul(lift).mul(height).mul(0.011).mul(force)
            .mul(sin(t.mul(0.55).add(treePhase.mul(TAU))).mul(0.35).add(0.75));
        const limb = sway.mul(sway).mul(force).mul(
            sin(t.mul(1.5).add(phase.mul(TAU)).add(along.mul(0.21))).mul(0.26)
                .add(sin(t.mul(2.7).add(phase.mul(15.1))).mul(0.11)),
        );
        const bob = sway.mul(force).mul(sin(t.mul(1.9).add(phase.mul(9.4)))).mul(0.07);
        const push = lean.add(limb);
        return vec3(this.uWindDir.x.mul(push), bob.sub(limb.abs().mul(0.15)), this.uWindDir.z.mul(push));
    }

    /**
     * Turn the grove to `phase` lights in (see fall-moods.js): every colour of the rig takes the
     * light's, melted between the two it lies between; its sun and haze become the rest update()
     * turns and clears from. Uniform values only; nothing is rebuilt. Call it before update().
     * @param {number} phase
     */
    setMood(phase) {
        this.moodPhase = Number.isFinite(phase) ? phase : 0;
        const mood = fallMoodAt(this.moodPhase, this.mood);
        const paint = (node, rgb) => node.value.setRGB(rgb[0], rgb[1], rgb[2]);
        paint(this.uSkyLight, mood.skyLight);
        paint(this.uBounce, mood.bounce);
        paint(this.uZenith, mood.zenith);
        paint(this.uSkyCool, mood.skyCool);
        paint(this.uSkyWarm, mood.skyWarm);
        paint(this.uSkyRose, mood.skyRose);
        paint(this.uHazeCool, mood.hazeCool);
        paint(this.uHazeWarm, mood.hazeWarm);
        paint(this.uCloudShade, mood.cloudShade);
        paint(this.uCloudLit, mood.cloudLit);
        paint(this.uCloudBody, mood.cloudBody);
        paint(this.uCloudBodyWarm, mood.cloudBodyWarm);
        paint(this.uShaftShade, mood.shaftShade);
        paint(this.uShaftSun, mood.shaftSun);
        for (let i = 0; i < 3; i += 1) {
            this.restSun[i] = mood.sun[i];
            // The quiet afternoon's own late amber exactly; any other light turned as far.
            this.lateSun[i] = mood.sun[i] === SUN_COLOUR[i] ? SUN_LATE[i] : mood.sun[i] * SUN_LATE_SHARE[i];
        }
        this.restHaze = mood.haze;
        this.exposureScale = mood.exposure;
    }

    /**
     * `frame` is the director's frame with the gust fronts in world x (`fronts`, or one `front`);
     * `dt` moves the springs (none on a zero or invalid step: what moves holds still).
     */
    update(time, frame = {}, dt = 0) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
        const motion = Number.isFinite(frame.motion) ? clamp01(frame.motion) : 1;
        const fever = clamp01(frame.surge?.fever);
        const ripen = clamp01(frame.ripen);
        const turn = clamp01(frame.turn);
        this.uWarmth.value = clamp01(clamp01(frame.warmth) + ripen);
        // Lanterns and wisps are called out of hiding in a fever.
        this.uGlow.value = clamp01(clamp01(frame.glow) + 0.3 * fever);
        this.uTurn.value = turn;
        const { springs } = this;
        if (step > 0) {
            springTo(springs.gust, clamp01(frame.gust) * 1.6 * motion, SPRING.gust, step);
            springTo(springs.wind, WIND_REST + WIND_PLAY * clamp01(frame.breeze), SPRING.wind, step);
            springTo(springs.stir, this.uGlow.value * motion, SPRING.stir, step);
        }
        this.uGust.value = Math.max(0, springs.gust.x);
        this.uWind.value = Math.max(0, springs.wind.x);
        this.uStir.value = Math.max(0, springs.stir.x);
        // The fronts: every one crossing, in the order given (they are summed, so order is free).
        let { fronts } = frame;
        if (!Array.isArray(fronts)) {
            this.oneFront[0] = frame.front;
            fronts = this.oneFront;
        }
        const slots = this.frontSlots.fill(0);
        let used = 0;
        for (let i = 0; i < fronts.length && used < FALL_LIGHT_FRONTS; i += 1) {
            const front = fronts[i];
            if (!front || !Number.isFinite(front.x)) continue;
            slots[used * 2] = front.x;
            slots[used * 2 + 1] = clamp01(front.strength) * 2.2;
            used += 1;
        }
        this.uFront.value.set(slots[0], slots[1], slots[2], slots[3]);
        this.uFrontC.value.set(slots[4], slots[5], FRONT_WIDTH, 0);
        // The low sun deepens to late amber as play heats, and a perfect clear's sunburst
        // brightens it a moment (frame-wide: Reduce flashing keeps a trace of it).
        const late = turn * SUN_TURN;
        const burst = 1 + SUN_CROWN * Math.max(0, Math.min(1.2, Number(frame.crown) || 0)) * flashScale();
        const { restSun, lateSun } = this;
        this.uSunColor.value.setRGB(
            (restSun[0] + (lateSun[0] - restSun[0]) * late) * burst,
            (restSun[1] + (lateSun[1] - restSun[1]) * late) * burst,
            (restSun[2] + (lateSun[2] - restSun[2]) * late) * burst,
        );
        this.uHaze.value = this.restHaze * (1 - HAZE_CLEAR * fever);
        // Pipelines may still be compiling when the first shadow map is drawn; redraw it
        // over the first frames so no late tree is missing from the static map.
        this.shadowFrames += 1;
        if (this.shadowFrames < 10 || this.shadowFrames === 45 || this.shadowFrames === 150) {
            this.sun.shadow.needsUpdate = true;
        }
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

/**
 * Forest — moonlight, night air, wind, and the light the forest makes itself.
 *
 * A full moon stands behind the spruce across the glade and lights everything from behind.
 * Materials stay unlit node materials and call into this rig, so both renderer backends
 * shade identically: a shared shadow node (one static shadow map of the old trees) says
 * where the moon reaches, `haze()` lays the same blue night air over every surface so the
 * forest falls back in layers of mist, `wind()` moves bark and needles together, and
 * `glow()` is the forest's own light: the waves that run across the floor when a piece
 * lands, and the pools the fireflies shed on whatever they pass.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, dot, exp, float, length, max, mix, normalize, positionWorld, pow, saturate, shadow, sin,
    texture, uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import {
    FOREST_HOUR_COLOURS, FOREST_HOURS, createForestHour, forestHourAt,
} from './forest-hours.js';
import { FOREST_LIGHT_FIELD_BOUNDS, ForestLightField } from './forest-light-field.js';
import { FOREST_MOON_AZIMUTH_DEGREES, FOREST_MOON_ELEVATION_DEGREES } from './forest-plan.js';
import { ForestPulses } from './forest-pulses.js';
import { FOREST_BOUNDS, forestGroundHeight } from './forest-terrain.js';

const MOON_AZIMUTH = THREE.MathUtils.degToRad(FOREST_MOON_AZIMUTH_DEGREES);
const MOON_ELEVATION = THREE.MathUtils.degToRad(FOREST_MOON_ELEVATION_DEGREES);
const TAU = Math.PI * 2;

/** Unit vector from the scene toward the moon (down the ride, left of the board). */
export const FOREST_MOON_DIRECTION = Object.freeze(new THREE.Vector3(
    Math.sin(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
    Math.sin(MOON_ELEVATION),
    -Math.cos(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
));
/** The colour of a firefly's light, and of the white gold a long combo heats it to. */
export const FOREST_FIREFLY_COLOUR = Object.freeze([0.72, 1.0, 0.2]);
export const FOREST_FIREFLY_HOT = Object.freeze([1.0, 0.92, 0.52]);

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
    noise.name = 'ForestValueNoise';
    noise.needsUpdate = true;
    return noise;
}

// A caster whose pipeline compiles late is missing from the first maps: redraw at these ages.
const SHADOW_REDRAW_SECONDS = [2, 5, 10, 20];
const HEIGHT_MAP_WIDTH = 256;
const HEIGHT_MAP_HEIGHT = 208;

/** The floor's height in metres, so mist can lie in the hollows and the valley. */
function createHeightTexture() {
    const data = new Uint16Array(HEIGHT_MAP_WIDTH * HEIGHT_MAP_HEIGHT);
    const {
        minX, maxX, minZ, maxZ,
    } = FOREST_BOUNDS;
    for (let row = 0; row < HEIGHT_MAP_HEIGHT; row += 1) {
        for (let column = 0; column < HEIGHT_MAP_WIDTH; column += 1) {
            const x = minX + ((maxX - minX) * column) / (HEIGHT_MAP_WIDTH - 1);
            const z = minZ + ((maxZ - minZ) * row) / (HEIGHT_MAP_HEIGHT - 1);
            data[row * HEIGHT_MAP_WIDTH + column] = THREE.DataUtils.toHalfFloat(forestGroundHeight(x, z));
        }
    }
    const map = new THREE.DataTexture(data, HEIGHT_MAP_WIDTH, HEIGHT_MAP_HEIGHT, THREE.RedFormat, THREE.HalfFloatType);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.NoColorSpace;
    map.generateMipmaps = false;
    map.name = 'ForestFloorHeight';
    map.needsUpdate = true;
    return map;
}

export class ForestLight {
    constructor({ tier, rng = Math.random }) {
        this.tier = tier;
        this.uTime = uniform(0);
        this.uMoonDir = uniform(FOREST_MOON_DIRECTION.clone());
        // Every colour of the night is an hour's (forest-hours.js) and starts at deep night's:
        // ink overhead, slate blue at the horizon, pale steel where the moon stands.
        const night = FOREST_HOURS[0];
        const tone = (key) => uniform(new THREE.Color(night[key][0], night[key][1], night[key][2]));
        this.uMoonColor = tone('moon');
        // Events lift the moon a little; 1 at rest.
        this.uMoonGain = uniform(1);
        this.uSkyLight = tone('skyLight');
        this.uBounce = tone('bounce');
        this.uFill = tone('fill');
        this.uZenith = tone('zenith');
        this.uSkyMid = tone('skyMid');
        this.uSkyAway = tone('skyAway');
        this.uSkyToward = tone('skyToward');
        // Night air: dark in shade; moonlit air is added by the volumetric beams where the
        // tier has them, and by this analytic glow where it does not.
        this.uHazeCool = tone('hazeCool');
        this.uHazeMoon = tone('hazeMoon');
        this.uHazeMoonAmount = uniform(tier.godrays > 0 ? 0.42 : 0.9);
        this.uHaze = uniform(night.haze);
        // What moonlight makes of a surface, the moon's own face and wide glow, the thin
        // cloud, the moonbeams and the lean of the darkest tones, and how many stars show.
        this.uNightTint = tone('nightTint');
        this.uMoonFace = tone('moonFace');
        this.uAureole = tone('aureole');
        this.uCloudAway = tone('cloudAway');
        this.uCloudToward = tone('cloudToward');
        this.uBeamCool = tone('beamCool');
        this.uBeamMoon = tone('beamMoon');
        this.uShade = tone('shade');
        this.uStars = uniform(night.stars);
        this.hourUniforms = {
            moon: this.uMoonColor,
            skyLight: this.uSkyLight,
            bounce: this.uBounce,
            fill: this.uFill,
            zenith: this.uZenith,
            skyMid: this.uSkyMid,
            skyAway: this.uSkyAway,
            skyToward: this.uSkyToward,
            hazeCool: this.uHazeCool,
            hazeMoon: this.uHazeMoon,
            nightTint: this.uNightTint,
            moonFace: this.uMoonFace,
            aureole: this.uAureole,
            cloudAway: this.uCloudAway,
            cloudToward: this.uCloudToward,
            beamCool: this.uBeamCool,
            beamMoon: this.uBeamMoon,
            shade: this.uShade,
        };
        this.hour = createForestHour();
        this.hourPhase = 0;
        // Wind: night air barely moves; gusts and a travelling front come from the game.
        this.uWindDir = uniform(new THREE.Vector3(0.88, 0, 0.47));
        this.uWind = uniform(0.13);
        this.uGust = uniform(0);
        this.uFront = uniform(new THREE.Vector4(0, 0, 20, 0)); // x, strength, width
        // Gameplay envelopes shared by every material.
        this.uGlow = uniform(0);
        this.uWake = uniform(0);
        this.noiseTexture = createNoiseTexture(rng);
        this.heightTexture = createHeightTexture();
        this.groundNodes = new WeakMap();

        this.pulses = new ForestPulses(Math.max(1, tier.pulses));
        this.pulsePlace = uniformArray(this.pulses.place);
        this.pulseShape = uniformArray(this.pulses.shape);
        this.field = tier.lightMap > 0 ? new ForestLightField(tier.lightMap) : null;
        this.fieldTexture = null;
        if (this.field) {
            const map = new THREE.DataTexture(this.field.data, this.field.size, this.field.size, THREE.RedFormat);
            map.magFilter = THREE.LinearFilter;
            map.minFilter = THREE.LinearFilter;
            map.wrapS = THREE.ClampToEdgeWrapping;
            map.wrapT = THREE.ClampToEdgeWrapping;
            map.colorSpace = THREE.NoColorSpace;
            map.generateMipmaps = false;
            map.name = 'ForestFireflyLight';
            map.needsUpdate = true;
            this.fieldTexture = map;
        }

        this.moon = new THREE.DirectionalLight(0xffffff, 1);
        this.moon.name = 'ForestFullMoon';
        this.moon.castShadow = true;
        const { shadow: moonShadow } = this.moon;
        moonShadow.mapSize.set(tier.shadowMap[0], tier.shadowMap[1]);
        // A coarser map needs more bias, or the boughs shade themselves in stripes.
        moonShadow.bias = -0.0011 * (2048 / tier.shadowMap[0]) ** 1.5;
        moonShadow.normalBias = 0;
        moonShadow.radius = 2.6;
        // The trees never move under a fixed moon, so their shadows are drawn once.
        moonShadow.autoUpdate = false;
        moonShadow.needsUpdate = true;
        this.shadowNode = shadow(this.moon);
        this.shadowFrames = 0;
        this.shadowSeconds = 0;
    }

    /** Aim the shadow camera so its box holds the glade and the stands toward the moon. */
    frameShadows({
        centre = new THREE.Vector3(-10, 12, -38), halfWidth = 78, halfHeight = 46, depth = 420,
    } = {}) {
        const { moon } = this;
        moon.position.copy(centre).addScaledVector(FOREST_MOON_DIRECTION, depth * 0.5);
        moon.target.position.copy(centre);
        const { camera } = moon.shadow;
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.near = 1;
        camera.far = depth;
        camera.updateProjectionMatrix();
        moon.updateMatrixWorld(true);
        moon.target.updateMatrixWorld(true);
        moon.shadow.needsUpdate = true;
        this.shadowFrames = 0;
        this.shadowSeconds = 0;
    }

    addTo(group) {
        group.add(this.moon, this.moon.target);
    }

    /**
     * Turn the night to `phase` hours in (see forest-hours.js): every colour of the rig takes
     * the hour's, mixed between the two it lies between. Uniform values only; nothing is rebuilt.
     */
    setHour(phase) {
        this.hourPhase = Number.isFinite(phase) ? phase : 0;
        const hour = forestHourAt(this.hourPhase, this.hour);
        for (let i = 0; i < FOREST_HOUR_COLOURS.length; i += 1) {
            const colour = hour[FOREST_HOUR_COLOURS[i]];
            this.hourUniforms[FOREST_HOUR_COLOURS[i]].value.setRGB(colour[0], colour[1], colour[2]);
        }
        this.uHaze.value = hour.haze;
        this.uStars.value = hour.stars;
    }

    /** 1 where the moon reaches the fragment, 0 in shadow. */
    moonlight() {
        return float(this.shadowNode);
    }

    /** The moon's light, lifted by whatever the game is celebrating. */
    moonColour() {
        return this.uMoonColor.mul(this.uMoonGain);
    }

    noise(coordinate) {
        return texture(this.noiseTexture, coordinate);
    }

    /** Height of the forest floor under a world point (one lookup per material). */
    groundAt(world = positionWorld) {
        if (!this.groundNodes.has(world)) {
            const st = vec2(
                world.x.sub(FOREST_BOUNDS.minX).div(FOREST_BOUNDS.maxX - FOREST_BOUNDS.minX),
                world.z.sub(FOREST_BOUNDS.minZ).div(FOREST_BOUNDS.maxZ - FOREST_BOUNDS.minZ),
            );
            this.groundNodes.set(world, texture(this.heightTexture, st).r);
        }
        return this.groundNodes.get(world);
    }

    /** Sky radiance seen along a unit direction (no disc, no stars, no cloud). */
    sky(direction) {
        const moonward = saturate(dot(direction, this.uMoonDir));
        const overhead = saturate(direction.y);
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const moonFlat = normalize(vec2(this.uMoonDir.x, this.uMoonDir.z));
        const toward = dot(flat, moonFlat).mul(0.5).add(0.5);
        const band = mix(this.uSkyAway, this.uSkyToward, pow(toward, 3.2));
        const upper = mix(this.uZenith, this.uSkyMid, pow(overhead.oneMinus(), 1.8));
        // The moon wears a wide aureole in the damp air.
        const aureole = this.moonColour().mul(pow(moonward, 9).mul(0.012).add(pow(moonward, 70).mul(0.05)));
        return mix(upper, band, pow(overhead.oneMinus(), 3.6)).add(aureole);
    }

    /**
     * The light the forest makes itself at a world point: the waves the game sends across
     * the floor, and the fireflies' own pools of light. Build it once per material and hand
     * the same node to `haze()`, so it is evaluated once.
     */
    glow(world = positionWorld) {
        let total = vec3(0);
        const green = vec3(...FOREST_FIREFLY_COLOUR);
        const hot = vec3(...FOREST_FIREFLY_HOT);
        const count = this.tier.pulses > 0 ? this.pulses.count : 0;
        for (let i = 0; i < count; i += 1) {
            const place = this.pulsePlace.element(i); // centre xyz, radius
            const shape = this.pulseShape.element(i); // strength, width, reach, heat
            const offset = length(world.xz.sub(place.xz)).sub(place.w);
            const front = exp(offset.div(shape.y).pow2().negate());
            // Behind the front the floor keeps a breath of light for a moment.
            const inside = saturate(offset.negate().div(shape.y));
            const after = inside.mul(exp(offset.min(0).div(shape.y.mul(5)))).mul(0.16);
            const rise = exp(max(world.y.sub(place.y), 0).div(shape.z).negate());
            total = total.add(mix(green, hot, shape.w).mul(front.add(after).mul(shape.x).mul(rise)));
        }
        if (this.fieldTexture) {
            const bounds = FOREST_LIGHT_FIELD_BOUNDS;
            const st = vec2(
                world.x.sub(bounds.minX).div(bounds.maxX - bounds.minX),
                world.z.sub(bounds.minZ).div(bounds.maxZ - bounds.minZ),
            );
            const pooled = texture(this.fieldTexture, st).r;
            const rise = exp(max(world.y.sub(this.groundAt(world)).sub(0.3), 0).mul(-0.42));
            total = total.add(mix(green, hot, this.uGlow.mul(0.5)).mul(pooled.mul(rise).mul(1.15)));
        }
        return total;
    }

    /**
     * How brightly the waves of light crossing the forest stir whatever lives at a world
     * point (a firefly, a foxfire cap): the passing front alone, as one number.
     */
    stir(world = positionWorld) {
        let total = float(0);
        const count = this.tier.pulses > 0 ? this.pulses.count : 0;
        for (let i = 0; i < count; i += 1) {
            const place = this.pulsePlace.element(i);
            const shape = this.pulseShape.element(i);
            const offset = length(world.xz.sub(place.xz)).sub(place.w);
            const rise = exp(max(world.y.sub(place.y), 0).div(shape.z.mul(2.2)).negate());
            total = total.add(exp(offset.div(shape.y.mul(1.3)).pow2().negate()).mul(shape.x).mul(rise));
        }
        return total;
    }

    /** Aerial perspective: distance and the damp air in the hollows fade a colour into night. */
    haze(colour, { world = positionWorld, strength = 1, glow = null } = {}) {
        const offset = world.sub(cameraPosition);
        const range = length(offset);
        const direction = offset.div(max(range, 0.001));
        const low = exp(max(world.y.sub(this.groundAt(world)), 0).mul(-0.085));
        const amount = exp(range.mul(this.uHaze).mul(low.mul(1.25).add(0.35)).negate()).oneMinus();
        const moonward = saturate(dot(direction, this.uMoonDir));
        let air = this.uHazeCool.add(this.uHazeMoon.mul(this.uMoonGain)
            .mul(pow(moonward, 3).mul(this.uHazeMoonAmount)));
        // Mist near a wave of light carries some of it.
        if (glow) air = air.add(glow.mul(0.4));
        return mix(colour, air, saturate(amount.mul(strength)));
    }

    /**
     * A surface colour as the eye sees it by moonlight: most of its hue gone, what is left
     * leaning the way the hour leans (blue in deep night). Use it for the moon and sky terms;
     * the forest's own light (`glow`) shows a thing's true colour.
     */
    night(albedo) {
        const grey = dot(albedo, vec3(0.3, 0.59, 0.11));
        return mix(vec3(grey), albedo, 0.5).mul(this.uNightTint);
    }

    /** Hemisphere ambient: the night sky from above, the dark floor from below. */
    ambient(normal) {
        // The lit ride and the bright sky round the moon fill whatever is turned toward them.
        const toward = saturate(normal.x.mul(this.uMoonDir.x).add(normal.z.mul(this.uMoonDir.z)).mul(0.6).add(0.4));
        return mix(this.uBounce, this.uSkyLight, normal.y.mul(0.5).add(0.5))
            .add(this.uFill.mul(toward.mul(toward)).mul(this.uMoonGain));
    }

    /**
     * World-space wind offset for a point on a tree. `sway` is how far the wind may carry
     * the point (0 at the trunk, 1 at bough tips); `phase` keeps each limb out of step.
     */
    wind({
        world, base, height, treePhase, sway, phase,
    }) {
        const t = this.uTime;
        const along = world.x.mul(this.uWindDir.x).add(world.z.mul(this.uWindDir.z));
        const swell = sin(along.mul(0.04).sub(t.mul(0.6)).add(world.x.mul(0.017))).mul(0.5).add(0.5);
        const front = exp(world.x.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
        const force = this.uWind.add(this.uGust.mul(swell.mul(0.7).add(0.65))).add(front);
        const lift = saturate(world.y.sub(base.y).div(height));
        const lean = lift.mul(lift).mul(height).mul(0.012).mul(force)
            .mul(sin(t.mul(0.42).add(treePhase.mul(TAU))).mul(0.35).add(0.75));
        const limb = sway.mul(sway).mul(force).mul(
            sin(t.mul(1.1).add(phase.mul(TAU)).add(along.mul(0.19))).mul(0.3)
                .add(sin(t.mul(2.1).add(phase.mul(15.1))).mul(0.1)),
        );
        // Boughs nod: a spruce limb dips and recovers more than it swings.
        const bob = sway.mul(force).mul(sin(t.mul(1.4).add(phase.mul(9.4)))).mul(0.16);
        const push = lean.add(limb);
        return vec3(this.uWindDir.x.mul(push), bob.sub(limb.abs().mul(0.2)), this.uWindDir.z.mul(push));
    }

    /** How hard the wind blows on the forest floor at a point (ferns, grass). */
    floorWind(world) {
        const t = this.uTime;
        const along = world.x.mul(this.uWindDir.x).add(world.z.mul(this.uWindDir.z));
        const swell = sin(along.mul(0.21).sub(t.mul(0.9))).mul(0.5).add(0.5);
        const front = exp(world.x.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
        return this.uWind.add(this.uGust.mul(swell.mul(0.8).add(0.5))).add(front);
    }

    /**
     * How far a wave of light pushes the undergrowth aside as it passes: a horizontal
     * shove away from each wave's centre, strongest on its front.
     */
    pulseShove(world) {
        let shove = vec3(0);
        const count = this.tier.pulses > 0 ? this.pulses.count : 0;
        for (let i = 0; i < count; i += 1) {
            const place = this.pulsePlace.element(i);
            const shape = this.pulseShape.element(i);
            const away = world.xz.sub(place.xz);
            const distance = length(away).max(0.001);
            const front = exp(distance.sub(place.w).div(shape.y.mul(0.8)).pow2().negate());
            const push = front.mul(shape.x).div(distance);
            shove = shove.add(vec3(away.x.mul(push), 0, away.y.mul(push)));
        }
        return shove;
    }

    update(time, dt, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        this.uGust.value = clamp01(frame.gust) * 1.5;
        this.uGlow.value = clamp01(frame.glow);
        this.uWake.value = clamp01(frame.wake);
        this.uMoonGain.value = 1 + clamp01(frame.moon) * 0.75;
        if (frame.front && Number.isFinite(frame.front.x)) {
            this.uFront.value.set(frame.front.x, clamp01(frame.front.strength) * 2.2, 20, 0);
        } else this.uFront.value.y = 0;
        this.pulses.update(Number.isFinite(dt) ? Math.max(0, dt) : 0);
        // Pipelines may still be compiling when the first shadow map is drawn; redraw it
        // over the first frames so no late tree is missing from the static map.
        this.shadowFrames += 1;
        const before = this.shadowSeconds;
        this.shadowSeconds += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const due = SHADOW_REDRAW_SECONDS.some((mark) => before < mark && this.shadowSeconds >= mark);
        if (this.shadowFrames < 10 || this.shadowFrames === 45 || this.shadowFrames === 150 || due) {
            this.moon.shadow.needsUpdate = true;
        }
    }

    /** Hand the gathered firefly light to the GPU. */
    commitField() {
        if (this.fieldTexture && this.field.dirty) {
            this.field.dirty = false;
            this.fieldTexture.needsUpdate = true;
        }
    }

    reset() {
        this.pulses.reset();
        if (this.field) {
            this.field.clear();
            this.field.commit();
            this.commitField();
        }
    }

    dispose() {
        this.noiseTexture.dispose();
        this.heightTexture.dispose();
        this.fieldTexture?.dispose();
        this.shadowNode.dispose?.();
        this.moon.shadow.dispose();
        this.moon.removeFromParent();
        this.moon.target.removeFromParent();
        this.moon.dispose();
    }
}

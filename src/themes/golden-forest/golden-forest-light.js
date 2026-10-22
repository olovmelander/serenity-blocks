/**
 * Golden Forest — the lake's light, air and wind.
 *
 * One low sun rests on the treetops across the water and lights everything. Materials stay
 * unlit node materials and call into this rig, so both renderer backends shade identically:
 * a shared shadow node (one static shadow map of the shores) says where the sun reaches,
 * `haze()` lays the same golden aerial perspective over every surface so the forest falls
 * back in warm layers, and `wind()` moves bark and needles together.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, dot, exp, float, length, max, mix, normalize, positionWorld, pow, saturate, shadow, sin,
    texture, uniform, vec2, vec3,
} from 'three/tsl';
import { gridShadowFilter } from '../shared/grid-shadow-filter.js';
import { flashScale } from '../../utils/photosensitivity.js';

/** The resting breeze; play raises it (update()). */
export const GOLDEN_FOREST_BREEZE = 0.24;
const FRONT_WIDTH = 22;
const SUN_AZIMUTH = THREE.MathUtils.degToRad(-21);
const SUN_ELEVATION = THREE.MathUtils.degToRad(11.5);
const TAU = Math.PI * 2;

/** Unit vector from the scene toward the sun (over the far shore, left of the board). */
export const GOLDEN_FOREST_SUN_DIRECTION = Object.freeze(new THREE.Vector3(
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
    noise.name = 'GoldenForestValueNoise';
    noise.needsUpdate = true;
    return noise;
}

export class GoldenForestLight {
    constructor({ tier, rng = Math.random }) {
        this.tier = tier;
        this.uTime = uniform(0);
        this.uSunDir = uniform(GOLDEN_FOREST_SUN_DIRECTION.clone());
        this.uSunColor = uniform(new THREE.Color(4.2, 2.1, 0.62));
        this.uSkyLight = uniform(new THREE.Color(0.36, 0.18, 0.17));
        this.uBounce = uniform(new THREE.Color(0.3, 0.12, 0.045));
        // The sky: dusk blue overhead, a rose and mauve middle, ember orange low down and molten
        // gold where the sun stands. The cool top gives the gold something to stand against, and
        // the lake mirrors it in the near water.
        this.uZenith = uniform(new THREE.Color(0.045, 0.05, 0.13));
        this.uSkyMid = uniform(new THREE.Color(0.36, 0.14, 0.16));
        this.uSkyAway = uniform(new THREE.Color(0.6, 0.21, 0.11));
        this.uSkyToward = uniform(new THREE.Color(1.5, 0.66, 0.14));
        // Shaded air is a dusty rose-amber that cools toward mauve; sunlit air is added by the
        // volumetric shafts where the tier has them, and by this analytic glow where it does not.
        this.uHazeCool = uniform(new THREE.Color(0.4, 0.165, 0.11));
        this.uHazeWarm = uniform(new THREE.Color(1.15, 0.52, 0.12));
        this.uHazeSun = uniform(tier.godrays > 0 ? 0.5 : 1);
        this.uHaze = uniform(0.0025);
        this.uGroundLevel = uniform(0);
        // Wind: a steady breeze, gusts that roll across the water, and a travelling front.
        this.uWindDir = uniform(new THREE.Vector3(0.92, 0, 0.39));
        this.uWind = uniform(GOLDEN_FOREST_BREEZE);
        this.uGust = uniform(0);
        // Up to three fronts crossing at once (golden-forest-reactions.js): the first in uFront
        // (x, strength, width), the other two in uFront2 (x, strength, x, strength).
        this.uFront = uniform(new THREE.Vector4(0, 0, FRONT_WIDTH, 0));
        this.uFront2 = uniform(new THREE.Vector4(0, 0, 0, 0));
        // Gameplay envelopes shared by every material.
        this.uWarmth = uniform(0);
        this.uGlow = uniform(0);
        // The sun flares on the treetops: a perfect clear's crown and a back-to-back's gold.
        this.uFlare = uniform(0);
        // The rising wind clears the air: the haze thins and the mist lifts off the water (0..1).
        this.uClearAir = uniform(0);
        // The colours the golden hour rests at; hot play deepens them toward sunset (update()).
        // `haze` is the resting density of the air (a lens may set it, as the icon's does).
        this.resting = {
            sun: this.uSunColor.value.clone(),
            toward: this.uSkyToward.value.clone(),
            mid: this.uSkyMid.value.clone(),
            zenith: this.uZenith.value.clone(),
            hazeWarm: this.uHazeWarm.value.clone(),
            haze: this.uHaze.value,
        };
        this.noiseTexture = createNoiseTexture(rng);

        this.sun = new THREE.DirectionalLight(0xffffff, 1);
        this.sun.name = 'GoldenForestLowSun';
        this.sun.castShadow = true;
        const { shadow: sunShadow } = this.sun;
        sunShadow.mapSize.set(tier.shadowMap[0], tier.shadowMap[1]);
        // A coarser map needs more bias, or the boughs shade themselves in stripes.
        sunShadow.bias = -0.0011 * (2048 / tier.shadowMap[0]) ** 1.5;
        sunShadow.normalBias = 0;
        sunShadow.radius = 2.4;
        // three's PCF turns its samples by per-pixel noise (a crosshatch over the boughs without a
        // temporal filter); a fixed grid is as soft and clean. Nine taps with post, four below.
        sunShadow.filterNode = gridShadowFilter(tier.shadowMap, sunShadow.radius, tier.post ? 9 : 4);
        // The shores never move under a fixed sun, so their shadows are drawn once.
        sunShadow.autoUpdate = false;
        sunShadow.needsUpdate = true;
        this.shadowNode = shadow(this.sun);
        this.shadowFrames = 0;
    }

    /** Aim the shadow camera so its box holds the near shores and the water between them. */
    frameShadows({
        centre = new THREE.Vector3(-6, 10, -52), halfWidth = 118, halfHeight = 44, depth = 520,
    } = {}) {
        const { sun } = this;
        sun.position.copy(centre).addScaledVector(GOLDEN_FOREST_SUN_DIRECTION, depth * 0.5);
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

    /** Sky radiance seen along a unit direction (no disc, no cloud). */
    sky(direction) {
        const sunward = saturate(dot(direction, this.uSunDir));
        const overhead = saturate(direction.y);
        const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
        const sunFlat = normalize(vec2(this.uSunDir.x, this.uSunDir.z));
        const toward = dot(flat, sunFlat).mul(0.5).add(0.5);
        const band = mix(this.uSkyAway, this.uSkyToward, pow(toward, 2.4).mul(this.uWarmth.mul(0.2).add(0.92)));
        const upper = mix(this.uZenith, this.uSkyMid, pow(overhead.oneMinus(), 1.7));
        const glow = this.uSunColor.mul(pow(sunward, 5).mul(0.03).add(pow(sunward, 40).mul(0.12)));
        return mix(upper, band, pow(overhead.oneMinus(), 3.4)).add(glow);
    }

    /** Aerial perspective: distance and the damp air over the water fade a colour into lit air. */
    haze(colour, { world = positionWorld, strength = 1 } = {}) {
        const offset = world.sub(cameraPosition);
        const range = length(offset);
        const direction = offset.div(max(range, 0.001));
        const low = exp(max(world.y.sub(this.uGroundLevel), 0).mul(-0.03));
        const amount = exp(range.mul(this.uHaze).mul(low.mul(0.9).add(0.45)).negate()).oneMinus();
        const sunward = saturate(dot(direction, this.uSunDir));
        const air = this.uHazeCool.add(this.uHazeWarm.mul(pow(sunward, 3).mul(this.uHazeSun)
            .add(this.uWarmth.mul(0.05))));
        return mix(colour, air, saturate(amount.mul(strength)));
    }

    /** Hemisphere ambient: ember sky from above, warm needle-litter bounce from below. */
    ambient(normal) {
        return mix(this.uBounce, this.uSkyLight, normal.y.mul(0.5).add(0.5));
    }

    /** How hard the fronts crossing the view push at world x (TSL): one bell per front. */
    front(x) {
        const bell = (at, strength) => exp(x.sub(at).div(this.uFront.z).pow2().negate()).mul(strength);
        return bell(this.uFront.x, this.uFront.y)
            .add(bell(this.uFront2.x, this.uFront2.y))
            .add(bell(this.uFront2.z, this.uFront2.w));
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
        const swell = sin(along.mul(0.04).sub(t.mul(0.8)).add(world.x.mul(0.017))).mul(0.5).add(0.5);
        const front = this.front(world.x);
        const force = this.uWind.add(this.uGust.mul(swell.mul(0.7).add(0.65))).add(front);
        const lift = saturate(world.y.sub(base.y).div(height));
        const lean = lift.mul(lift).mul(height).mul(0.012).mul(force)
            .mul(sin(t.mul(0.5).add(treePhase.mul(TAU))).mul(0.35).add(0.75));
        const limb = sway.mul(sway).mul(force).mul(
            sin(t.mul(1.3).add(phase.mul(TAU)).add(along.mul(0.19))).mul(0.3)
                .add(sin(t.mul(2.4).add(phase.mul(15.1))).mul(0.1)),
        );
        // Boughs nod: a spruce limb dips and recovers more than it swings.
        const bob = sway.mul(force).mul(sin(t.mul(1.7).add(phase.mul(9.4)))).mul(0.16);
        const push = lean.add(limb);
        return vec3(this.uWindDir.x.mul(push), bob.sub(limb.abs().mul(0.2)), this.uWindDir.z.mul(push));
    }

    /**
     * One frame of light and wind. `worn` is the world's reading of the envelopes (eased gust and
     * warmth, how hot play runs, Reduce motion's share: GoldenForestWorld.wear); `fronts` the
     * fronts crossing, in world x ({ x, strength }).
     */
    update(time, frame = {}, worn = null, fronts = null) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const motion = worn && Number.isFinite(worn.motion) ? clamp01(worn.motion) : 1;
        const level = clamp01(worn?.level);
        const fever = clamp01(worn?.fever);
        this.uGust.value = clamp01(worn ? worn.gust : frame.gust) * 1.6 * motion;
        this.uWarmth.value = clamp01(worn ? worn.warmth : frame.warmth);
        // The fireflies, the motes and the rings' gold glow brighter the hotter play runs.
        this.uGlow.value = clamp01(clamp01(frame.glow) + level * 0.18 + fever * 0.12);
        // The evening wind rises with play: a steady hand stirs the forest, a fever bends it.
        this.uWind.value = GOLDEN_FOREST_BREEZE + (level * 0.2 + fever * 0.24) * motion;
        const crown = Number.isFinite(worn?.crown) ? Math.max(0, worn.crown) : 0;
        const gold = Number.isFinite(worn?.gold) ? Math.max(0, worn.gold) : 0;
        // A brightening of the sun's disc and glare: a flash, so Reduce flashing holds it back.
        this.uFlare.value = Math.min(1.4, crown * 0.9 + gold * 0.3) * flashScale();
        // The golden hour deepens as play runs hot: the sun sinks into molten orange, the sky's
        // low band burns redder and the zenith darkens, so heat reads as richer colour, not paler.
        // The wind it raises clears the air, so the far shore stands out instead of milking over.
        const deepen = level * 0.45 + fever * 0.55;
        const { resting } = this;
        this.uSunColor.value.setRGB(
            resting.sun.r + deepen * 0.4,
            resting.sun.g - deepen * 0.5,
            resting.sun.b - deepen * 0.26,
        );
        this.uSkyToward.value.setRGB(
            resting.toward.r + deepen * 0.1,
            resting.toward.g - deepen * 0.18,
            resting.toward.b - deepen * 0.06,
        );
        this.uSkyMid.value.setRGB(
            resting.mid.r + deepen * 0.04,
            resting.mid.g - deepen * 0.03,
            resting.mid.b - deepen * 0.01,
        );
        this.uZenith.value.setRGB(
            resting.zenith.r - deepen * 0.015,
            resting.zenith.g - deepen * 0.025,
            resting.zenith.b,
        );
        this.uHazeWarm.value.setRGB(
            resting.hazeWarm.r,
            resting.hazeWarm.g - deepen * 0.12,
            resting.hazeWarm.b - deepen * 0.05,
        );
        this.uClearAir.value = deepen;
        this.uHaze.value = resting.haze * (1 - deepen * 0.3);
        const at = (index) => {
            let front = index === 0 ? frame.front : null;
            if (Array.isArray(fronts)) front = fronts[index];
            return front && Number.isFinite(front.x) ? front : null;
        };
        const push = (front) => (front ? clamp01(front.strength) * 2.2 * motion : 0);
        const first = at(0);
        const second = at(1);
        const third = at(2);
        this.uFront.value.set(first ? first.x : 0, push(first), FRONT_WIDTH, 0);
        this.uFront2.value.set(second ? second.x : 0, push(second), third ? third.x : 0, push(third));
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

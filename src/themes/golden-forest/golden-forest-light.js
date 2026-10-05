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
        this.uSkyLight = uniform(new THREE.Color(0.42, 0.19, 0.13));
        this.uBounce = uniform(new THREE.Color(0.3, 0.12, 0.045));
        // The sky: burnt red overhead, ember orange in the middle, molten gold where the sun stands.
        this.uZenith = uniform(new THREE.Color(0.2, 0.048, 0.022));
        this.uSkyMid = uniform(new THREE.Color(0.62, 0.155, 0.05));
        this.uSkyAway = uniform(new THREE.Color(0.66, 0.23, 0.09));
        this.uSkyToward = uniform(new THREE.Color(1.5, 0.66, 0.14));
        // Shaded air is a dusty amber; sunlit air is added by the volumetric shafts where the
        // tier has them, and by this analytic glow where it does not.
        this.uHazeCool = uniform(new THREE.Color(0.44, 0.16, 0.065));
        this.uHazeWarm = uniform(new THREE.Color(1.15, 0.52, 0.12));
        this.uHazeSun = uniform(tier.godrays > 0 ? 0.5 : 1);
        this.uHaze = uniform(0.0025);
        this.uGroundLevel = uniform(0);
        // Wind: a steady breeze, gusts that roll across the water, and a travelling front.
        this.uWindDir = uniform(new THREE.Vector3(0.92, 0, 0.39));
        this.uWind = uniform(0.24);
        this.uGust = uniform(0);
        this.uFront = uniform(new THREE.Vector4(0, 0, 22, 0)); // x, strength, width
        // Gameplay envelopes shared by every material.
        this.uWarmth = uniform(0);
        this.uGlow = uniform(0);
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
        const front = exp(world.x.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
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

    update(time, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        this.uGust.value = clamp01(frame.gust) * 1.6;
        this.uWarmth.value = clamp01(frame.warmth);
        this.uGlow.value = clamp01(frame.glow);
        if (frame.front && Number.isFinite(frame.front.x)) {
            this.uFront.value.set(frame.front.x, clamp01(frame.front.strength) * 2.2, 22, 0);
        } else this.uFront.value.y = 0;
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

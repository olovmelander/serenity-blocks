/**
 * Golden Forest — the lake.
 *
 * A real planar mirror of the shores, sky and fireflies (three's ReflectorNode), broken up
 * the way still water is: glassy in the lee of the banks, ruffled where the breeze lays
 * its cat's-paws, tea-brown and clear over the gravel at your feet. The lake also carries
 * a small pool of analytic rings — every piece that locks, every line that clears, and the
 * odd rising fish sends one across the water, bending the reflection as it goes.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, color, cos, dot, exp, float, length, mix, normalize, positionWorld, pow, reflect, reflector,
    saturate, screenUV, sin, smoothstep, texture, uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import { GoldenForestRipples } from './golden-forest-ripples.js';
import {
    GOLDEN_FOREST_BOUNDS, GOLDEN_FOREST_MAP_BIAS, GOLDEN_FOREST_MAP_RANGE,
} from './golden-forest-terrain.js';

/** Everything the lake mirrors is on this layer as well as the default one. */
export const GOLDEN_FOREST_MIRROR_LAYER = 1;
export const GOLDEN_FOREST_RING_SPEED = 2.6;
const RING_WAVE_NUMBER = 5.2;

export class GoldenForestLake {
    constructor({ light, tier, lakeMap }) {
        this.light = light;
        this.tier = tier;
        this.lakeMap = lakeMap;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestLake';
        this.ripples = new GoldenForestRipples(tier.ripples);
        this.uShimmer = uniform(0);
        this.reflection = null;
        this.owned = [];
    }

    /** Lake-map coordinate for a world position (TSL). */
    mapCoordinate(world = positionWorld) {
        const {
            minX, maxX, minZ, maxZ,
        } = GOLDEN_FOREST_BOUNDS;
        return vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ));
    }

    build({ mirror = true } = {}) {
        const geometry = new THREE.PlaneGeometry(1800, 620, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, -250);
        if (mirror && this.tier.reflection > 0) {
            this.reflection = reflector({
                resolutionScale: this.tier.reflection, bounces: false, generateMipmaps: false,
            });
            this.reflection.target.rotateX(-Math.PI / 2);
            this.reflection.target.name = 'GoldenForestLakeMirror';
            this.group.add(this.reflection.target);
        }
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'GoldenForestWater';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(geometry, material);
        return this;
    }

    /** Mirror only what was tagged: the lake itself and anything left untagged stay out. */
    watch(camera) {
        if (!this.reflection || !camera) return;
        this.reflection.reflector.getVirtualCamera(camera).layers.set(GOLDEN_FOREST_MIRROR_LAYER);
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'GoldenForestWaterMaterial';
        const world = positionWorld;
        const t = light.uTime;
        const map = texture(this.lakeMap, this.mapCoordinate(world));
        const depth = map.r.mul(GOLDEN_FOREST_MAP_RANGE).sub(GOLDEN_FOREST_MAP_BIAS).negate();
        const toEye = cameraPosition.sub(world);
        const range = length(toEye);
        const view = toEye.div(range);

        // -- the surface ---------------------------------------------------------------
        const wind = vec2(light.uWindDir.x, light.uWindDir.z);
        const drift = wind.mul(t.mul(0.02));
        const swell = light.noise(world.xz.mul(0.011).sub(drift.mul(0.35)));
        const chop = light.noise(world.xz.mul(0.06).sub(drift));
        const ripple = light.noise(world.xz.mul(0.31).sub(drift.mul(2.6)).add(chop.rg.mul(0.3)));
        // Cat's-paws: patches the breeze has ruffled, sliding over glassy water.
        const paws = smoothstep(0.42, 0.7, light.noise(world.xz.mul(0.004).sub(drift.mul(0.12))).g.mul(0.7)
            .add(swell.b.mul(0.3)));
        const lee = smoothstep(0.02, 0.5, map.g);
        const ruffle = paws.mul(0.75).add(0.16).mul(lee.mul(0.8).add(0.2)).add(light.uGust.mul(0.3));
        const waves = swell.rg.sub(0.5).mul(0.05)
            .add(chop.gb.sub(0.5).mul(0.11))
            .add(ripple.ba.sub(0.5).mul(0.16))
            .mul(ruffle);

        // -- rings ---------------------------------------------------------------------
        const rings = uniformArray(this.ripples.rings);
        let ringSlope = vec2(0, 0);
        let ringLight = float(0);
        for (let i = 0; i < this.ripples.count; i += 1) {
            const ring = rings.element(i); // x, z, age, strength
            const offset = world.xz.sub(ring.xy);
            const distance = length(offset).add(0.0001);
            const front = distance.sub(ring.z.mul(GOLDEN_FOREST_RING_SPEED));
            const packet = exp(front.div(ring.z.mul(0.5).add(0.55)).pow2().negate());
            const amplitude = packet.mul(ring.w).mul(exp(ring.z.mul(-0.42))).div(distance.mul(0.09).add(1));
            const phase = front.mul(RING_WAVE_NUMBER);
            ringSlope = ringSlope.add(offset.div(distance).mul(sin(phase).mul(amplitude).mul(0.44)));
            ringLight = ringLight.add(amplitude.mul(cos(phase).mul(0.5).add(0.5)));
        }
        const slope = waves.add(ringSlope);
        const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));

        // -- what the water shows --------------------------------------------------------
        let mirrored;
        if (this.reflection) {
            // Reflections stretch down the screen far more than across it, and far water
            // averages its ripples into a blur rather than a wobble.
            const calm = float(1).div(range.mul(0.018).add(1));
            const bend = vec2(slope.x.mul(0.05), slope.y.mul(0.13)).mul(calm.mul(0.85).add(0.15));
            mirrored = this.reflection.sample(screenUV.flipX().add(bend).clamp(0.002, 0.998)).rgb;
        } else mirrored = light.sky(reflect(view.negate(), normal));
        const facing = saturate(dot(normal, view));
        const fresnel = pow(facing.oneMinus(), 5).mul(0.94).add(0.06);
        const sunlit = light.sunlight();
        // Tea-coloured water: the gravel shows through for a pace or two, then is gone.
        const bed = light.noise(world.xz.mul(0.9));
        const gravel = mix(color(0x3a2410), color(0x9a7038), bed.g.mul(0.6).add(bed.a.mul(0.4)));
        const clear = exp(depth.max(0).mul(-1.25));
        const up = vec3(0, 1, 0);
        const body = gravel.mul(clear).mul(light.uSunColor.mul(sunlit).mul(0.3).add(light.ambient(up).mul(1.2)))
            .add(color(0x1a0d05).mul(clear.oneMinus()).mul(light.ambient(up)).mul(1.4));
        // The sun's own glitter, crisper than the mirror can hold it.
        const micro = normalize(vec3(waves.x.mul(-2.4).sub(ringSlope.x), 1, waves.y.mul(-2.4).sub(ringSlope.y)));
        const glitter = pow(saturate(dot(micro, normalize(view.add(light.uSunDir)))), 700).mul(sunlit);
        const surface = mix(body, mirrored, fresnel)
            .add(light.uSunColor.mul(glitter).mul(this.uShimmer.mul(1.2).add(1.3)))
            // Rings carry a thread of gold on their crests.
            .add(vec3(1.5, 0.84, 0.26).mul(ringLight).mul(light.uGlow.mul(0.5).add(0.22)));
        // The waterline is soft: the last finger of water barely tints the gravel under it.
        const shallow = float(1).sub(smoothstep(0.0, 0.16, depth));
        const wetGravel = gravel.mul(0.55).mul(light.uSunColor.mul(sunlit).mul(0.4).add(light.ambient(up).mul(1.2)));
        material.colorNode = light.haze(mix(surface, wetGravel, shallow.mul(0.8)), { world });
        return material;
    }

    update(dt, frame = {}) {
        this.ripples.update(dt);
        const shimmer = Number.isFinite(frame.shimmer) ? THREE.MathUtils.clamp(frame.shimmer, 0, 1) : 0;
        this.uShimmer.value = shimmer;
    }

    reset() {
        this.ripples.reset();
    }

    dispose() {
        this.reflection?.dispose?.();
        this.reflection = null;
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}

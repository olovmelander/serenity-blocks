/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the light every part of the pond shares.
 *
 * Two lights make the picture: a high moon beyond the far bank (one shadow map; the koi, the
 * lily pads and the maple all throw their shadows on the bed) and a stone lantern on the bank.
 * Under the water the moon arrives through the surface, so everything below reads the same
 * texture the water itself is drawn from — the surface's slopes and curvature — and turns the
 * curvature into caustics: where the surface is cupped the light gathers into bright lines,
 * and a ring from a locked piece drags a band of light across the bed and the backs of the fish.
 *
 * Materials in this theme are unlit node materials that call these helpers. The helpers are
 * inline (no setLayout): they read uniforms and textures, and r186 generates a laid-out function
 * once and reuses it, without redeclaring what it captured.
 */
import * as THREE from 'three/webgpu';
import {
    Loop, clamp, dot, exp, float, length, max, min, mix, normalize, shadow, smoothstep, texture, uniform, uniformArray,
    vec2, vec3, vec4,
} from 'three/tsl';
import {
    NOISE_SIZE, POND, POND_LENGTH, POND_WIDTH, bakeNoise,
} from './koi-pond-core.js';

/** Travelling bands of light on the bed and the fish: one per lock or clear. */
export const RING_SLOTS = 8;
/** How fast a ripple (and the band of light that rides it) crosses the pond, metres per second. */
export const WAVE_SPEED = 1.25;
/** Seconds a band of light lives. */
export const RING_LIFE = 5.5;

/** Moonlight on the pond at rest (scene-linear), and the lantern's flame. */
export const MOON_COLOR = Object.freeze([0.62, 0.78, 1.0]);
export const LANTERN_COLOR = Object.freeze([1.0, 0.56, 0.2]);
/** The gold a chain of clears turns the pond: kintsugi, not yellow. */
export const CHAIN_GOLD = Object.freeze([1.0, 0.66, 0.2]);

export function createNoiseTexture(data = bakeNoise()) {
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = 'koi-pond-noise';
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** A 1x1 stand-in for the surface texture until the simulation exists (flat water). */
function createFlatSurface() {
    const tex = new THREE.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    tex.name = 'koi-pond-flat-surface';
    tex.needsUpdate = true;
    return tex;
}

/**
 * The direction toward the moon once its light is in the water (Snell): steeper than in air.
 * Returned as the horizontal offset toward the moon per metre of height.
 */
export function underwaterSlope(moonDir, out = new THREE.Vector2()) {
    const flat = Math.hypot(moonDir.x, moonDir.z);
    if (flat < 1e-5) return out.set(0, 0);
    const sinWater = flat / 1.333;
    const cosWater = Math.sqrt(Math.max(1e-4, 1 - sinWater * sinWater));
    const slope = sinWater / cosWater;
    return out.set((moonDir.x / flat) * slope, (moonDir.z / flat) * slope);
}

export class PondLight {
    /**
     * @param {object} params
     * @param {object} params.tier          the quality tier (koi-pond-quality.js)
     * @param {Uint8Array} [params.noise]   a baked noise field (koi-pond-core.js)
     */
    constructor({ tier, noise } = {}) {
        this.tier = tier;
        this.noiseData = noise || bakeNoise();
        this.noiseTexture = createNoiseTexture(this.noiseData);
        this.noise = texture(this.noiseTexture);
        this.flatSurface = createFlatSurface();
        /** The surface texture: rg = slope (dh/dx, dh/dz), b = curvature, a = foam. */
        this.surface = texture(this.flatSurface);
        /** The simulation itself: r height, g its speed, b foam, a light left in the water. */
        this.waves = texture(this.flatSurface);

        this.moonDirection = new THREE.Vector3(-0.3, 0.78, -0.55).normalize();
        this.u = {
            time: uniform(0),
            moonDir: uniform(this.moonDirection.clone()),
            moonColor: uniform(new THREE.Vector3(...MOON_COLOR)),
            /** Horizontal offset toward the moon per metre of water above a point. */
            underSlope: uniform(underwaterSlope(this.moonDirection)),
            /** xyz = the lantern's flame, w = its reach in metres. */
            lantern: uniform(new THREE.Vector4(5.4, 0.78, -3.3, 5.5)),
            lanternColor: uniform(new THREE.Vector3(...LANTERN_COLOR)),
            /** The night above and the water below (scene-linear ambient). */
            skyAmbient: uniform(new THREE.Vector3(0.034, 0.058, 0.098)),
            waterAmbient: uniform(new THREE.Vector3(0.011, 0.044, 0.052)),
            /** 0..1: the charge of a chain of clears. The pond turns to gold with it. */
            power: uniform(0),
            /** A swell of light after a clear, 0..1.5. */
            glow: uniform(0),
            /** Everything holds its breath (four lines): 1 at rest, near 0 in the hush. */
            breath: uniform(1),
            ringsLive: uniform(0),
            viewport: uniform(new THREE.Vector2(1920, 1080)),
        };
        // Bands of light. A: x, z, birth, strength. C: rgb, reach (metres).
        this.ringA = Array.from({ length: RING_SLOTS }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.ringC = Array.from({ length: RING_SLOTS }, () => new THREE.Vector4(1, 1, 1, 12));
        this.ringANode = uniformArray(this.ringA, 'vec4');
        this.ringCNode = uniformArray(this.ringC, 'vec4');
        this.ringCursor = 0;

        this.moon = null;
        this.shadowNode = null;
        if (tier?.shadows) {
            this.moon = new THREE.DirectionalLight(0xffffff, 1);
            this.moon.name = 'KoiPondMoon';
            this.moon.castShadow = true;
            const { shadow: moonShadow } = this.moon;
            moonShadow.mapSize.set(tier.shadows, tier.shadows);
            moonShadow.bias = -0.0012;
            moonShadow.normalBias = 0.02;
            moonShadow.radius = 2.2;
            this.shadowNode = shadow(this.moon);
        }
        this.frameShadows();
    }

    /** Stand the moon somewhere else (the composition picks it per aspect). */
    setMoon(direction) {
        this.moonDirection.copy(direction).normalize();
        this.u.moonDir.value.copy(this.moonDirection);
        underwaterSlope(this.moonDirection, this.u.underSlope.value);
        this.frameShadows();
    }

    /** Aim the shadow camera so its box holds the pond the play camera can see. */
    frameShadows() {
        const { moon } = this;
        if (!moon) return;
        const centre = new THREE.Vector3(0, 0, -0.8);
        const reach = 30;
        moon.position.copy(centre).addScaledVector(this.moonDirection, reach * 0.5);
        moon.target.position.copy(centre);
        const { camera } = moon.shadow;
        camera.left = -11.5;
        camera.right = 11.5;
        camera.top = 8.5;
        camera.bottom = -8.5;
        camera.near = 0.5;
        camera.far = reach;
        camera.updateProjectionMatrix();
        moon.updateMatrixWorld(true);
        moon.target.updateMatrixWorld(true);
    }

    addTo(group) {
        if (this.moon) group.add(this.moon, this.moon.target);
    }

    // ── nodes ───────────────────────────────────────────────────────────────────────────────

    /** World x,z → the surface texture's coordinates. */
    pondUV(xz) {
        return vec2(xz.x.sub(POND.minX).div(POND_WIDTH), xz.y.sub(POND.minZ).div(POND_LENGTH));
    }

    /** The surface above a world x,z: rg slope, b curvature, a foam. */
    surfaceAt(xz) {
        return this.surface.sample(this.pondUV(xz));
    }

    /** 1 where the moon reaches the fragment, 0 in shadow. */
    moonlight() {
        return this.shadowNode ? float(this.shadowNode) : float(1);
    }

    /**
     * Moonlight gathered by the surface onto a point under the water: about 1 on average,
     * bright lines where the surface is cupped. `point` is a world position with y <= 0.
     */
    caustic(point) {
        const { u } = this;
        const depth = max(point.y.negate(), 0.0);
        const entry = point.xz.add(u.underSlope.mul(depth));
        return this.gather(this.surfaceAt(entry).z, depth);
    }

    /**
     * Curvature → light. A cupped surface (negative curvature here) gathers the moon into a
     * line, the rest of the cell goes dim; the further down, the stronger the lens, until deep
     * water spreads the pattern into an even glow. Scaled so that open water averages about 1.
     */
    gather(curve, depth) {
        const lens = min(depth.mul(1.9).add(0.2), 1.5);
        const focus = float(1.0).add(curve.mul(lens));
        const gathered = float(0.66).div(max(focus, 0.12));
        return mix(gathered, float(1.0), smoothstep(1.15, 2.6, depth));
    }

    /** The same, split a little by colour: the bright lines get a prismatic edge. */
    causticRGB(point) {
        const { u } = this;
        const depth = max(point.y.negate(), 0.0);
        const entry = point.xz.add(u.underSlope.mul(depth));
        const spread = normalize(u.underSlope.add(vec2(1e-4, 0))).mul(depth.mul(0.011).add(0.004));
        const one = (offset) => this.gather(this.surfaceAt(entry.add(offset)).z, depth);
        return vec3(one(spread), one(vec2(0, 0)), one(spread.negate()));
    }

    /** How much moonlight is left `depth` metres down (the water takes the red first). */
    downwelling(depth) {
        return exp(vec3(0.52, 0.2, 0.17).mul(depth).negate());
    }

    /**
     * The lantern's light on a point with normal `normal`. Under the water it reaches a little
     * way down and loses its red slowly: the warm shallows by the right bank.
     */
    lantern(point, normal) {
        const { u } = this;
        const to = u.lantern.xyz.sub(point);
        const dist = max(length(to), 0.05);
        const dir = to.div(dist);
        const reach = float(1.0).div(float(1.0).add(dist.div(u.lantern.w.mul(0.34)).pow2()));
        const wrap = clamp(dot(normal, dir).mul(0.6).add(0.4), 0.0, 1.0);
        const sunk = exp(max(point.y.negate(), 0.0).mul(-0.75));
        return u.lanternColor.mul(reach.mul(wrap).mul(sunk)).mul(u.breath);
    }

    /**
     * The bands of light the board sends across the pond: xyz = light, in the colour of the
     * piece that locked (or the gold of a clear). Skipped by one uniform when none is alive.
     */
    ringLight(xz) {
        const { u } = this;
        const sum = vec3(0.0).toVar();
        Loop(RING_SLOTS, ({ i }) => {
            const a = this.ringANode.element(i);
            const c = this.ringCNode.element(i);
            const age = max(u.time.sub(a.z), 0.0);
            const dist = length(xz.sub(a.xy));
            const front = dist.sub(age.mul(WAVE_SPEED));
            const width = age.mul(0.05).add(0.13);
            const band = exp(front.div(width).pow2().negate());
            // Light lingers a moment in the wake behind the front.
            const wake = smoothstep(-1.2, 0.0, front).mul(float(1.0).sub(smoothstep(-0.1, 0.25, front))).mul(0.03);
            const life = exp(age.mul(-0.55)).mul(smoothstep(0.0, 0.12, age)).mul(smoothstep(c.w, c.w.mul(0.6), dist));
            sum.addAssign(c.xyz.mul(band.add(wake).mul(life).mul(a.w)));
        });
        return sum.mul(u.ringsLive);
    }

    /** Send a band of light out from (x, z). */
    ring(x, z, time, strength, rgb, reach = 12) {
        const slot = this.ringCursor % RING_SLOTS;
        this.ringCursor += 1;
        this.ringA[slot].set(x, z, time, strength);
        this.ringC[slot].set(rgb[0], rgb[1], rgb[2], reach);
    }

    resetRings() {
        this.ringCursor = 0;
        for (let i = 0; i < RING_SLOTS; i += 1) this.ringA[i].set(0, 0, -1000, 0);
    }

    update(time) {
        const { u } = this;
        u.time.value = time;
        let live = 0;
        for (let i = 0; i < RING_SLOTS; i += 1) {
            if (time - this.ringA[i].z < RING_LIFE && this.ringA[i].w > 0) live = 1;
        }
        u.ringsLive.value = live;
    }

    dispose() {
        this.noiseTexture.dispose();
        this.flatSurface.dispose();
        this.shadowNode?.dispose?.();
        if (this.moon) {
            this.moon.shadow.dispose();
            this.moon.removeFromParent();
            this.moon.target.removeFromParent();
            this.moon.dispose();
        }
    }
}

/** A scene-linear colour node from three numbers. */
export const rgb = (r, g, b) => vec3(r, g, b);
export const rgba = (r, g, b, a) => vec4(r, g, b, a);

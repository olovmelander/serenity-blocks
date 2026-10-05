/**
 * Sakura Twilight — the garden's light, air and wind.
 *
 * Three lights make the picture: a low moon behind the trees (one static shadow map,
 * read by every material), the last rose of the afterglow along the horizon, and the
 * warm lanterns under the blossom. Materials stay unlit node materials and call into this
 * rig, so both renderer backends shade identically: `moonlight()` says where the moon
 * reaches, `lamps()` adds the lanterns, `haze()` gives every surface the same air, `wind()`
 * moves bark and blossom together, and `rings()` is the light a locked piece sends out
 * across the lake and the grass.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, cameraPosition, dot, exp, float, length, max, mix, normalize, positionWorld, pow, saturate, shadow, sin,
    texture, uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';

const TAU = Math.PI * 2;
export const SAKURA_RING_SLOTS = 6;
export const SAKURA_RING_SPEED = 13;

/** Unit vector from the scene toward a moon at `azimuth` (right of -Z) and `elevation` degrees. */
export function sakuraMoonDirection(azimuth, elevation, target = new THREE.Vector3()) {
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

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
    noise.name = 'SakuraValueNoise';
    noise.needsUpdate = true;
    return noise;
}

export class SakuraLight {
    /** `lamps` is the garden's lantern list ([{x, y, z, power}]) in priority order. */
    constructor({ tier, rng = Math.random, lamps = [] }) {
        this.tier = tier;
        this.uTime = uniform(0);
        this.moonDirection = sakuraMoonDirection(26.5, 14);
        this.uMoonDir = uniform(this.moonDirection.clone());
        this.uMoonColor = uniform(new THREE.Color(0.5, 0.66, 1.0));
        // Sky: indigo overhead, violet in the middle air, rose where the sun went down.
        this.uZenith = uniform(new THREE.Color(0.004, 0.006, 0.03));
        this.uVault = uniform(new THREE.Color(0.028, 0.017, 0.085));
        this.uHorizon = uniform(new THREE.Color(0.07, 0.038, 0.13));
        this.uAfterglow = uniform(new THREE.Color(0.46, 0.12, 0.17));
        this.uEmber = uniform(new THREE.Color(0.85, 0.34, 0.2));
        this.uGlowDir = uniform(new THREE.Vector2(-0.42, -0.9).normalize());
        this.uSkyLight = uniform(new THREE.Color(0.2, 0.11, 0.24));
        this.uBounce = uniform(new THREE.Color(0.06, 0.035, 0.07));
        this.uHaze = uniform(0.0018);
        this.uMist = uniform(0.003);
        this.uWaterLevel = uniform(0);
        // Wind: a steady breeze, gusts that roll across the garden, and a travelling front.
        this.uWindDir = uniform(new THREE.Vector3(0.96, 0, 0.28));
        this.uWind = uniform(0.24);
        this.uGust = uniform(0);
        this.uFront = uniform(new THREE.Vector4(0, 0, 14, 0)); // x, strength, width
        // Gameplay envelopes shared by every material.
        this.uGlow = uniform(0);
        this.uSpirit = uniform(0);
        this.uLampGain = uniform(1);
        this.uLampColor = uniform(new THREE.Color(2.9, 1.28, 0.4));
        this.lampCount = Math.min(tier.lamps, lamps.length);
        this.lampList = lamps.slice(0, this.lampCount);
        this.lampData = this.lampList.map((lamp) => new THREE.Vector4(lamp.x, lamp.y, lamp.z, lamp.power ?? 1));
        this.lampNodes = this.lampCount > 0 ? uniformArray(this.lampData, 'vec4') : null;
        // Rings: x, z, birth time, strength.
        this.ringData = Array.from({ length: SAKURA_RING_SLOTS }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.ringNodes = uniformArray(this.ringData, 'vec4');
        this.ringCursor = 0;
        this.noiseTexture = createNoiseTexture(rng);
        this.buildShaderFunctions();

        this.moon = new THREE.DirectionalLight(0xffffff, 1);
        this.moon.name = 'SakuraLowMoon';
        this.moon.castShadow = true;
        const { shadow: moonShadow } = this.moon;
        moonShadow.mapSize.set(tier.shadowMap[0], tier.shadowMap[1]);
        // The moon is low: a ground texel spans a long way in depth, so the bias is generous.
        moonShadow.bias = -0.0024;
        moonShadow.normalBias = 0.05;
        moonShadow.radius = 2.4;
        // The garden never moves under a fixed moon, so its shadows are drawn once.
        moonShadow.autoUpdate = false;
        moonShadow.needsUpdate = true;
        this.shadowNode = shadow(this.moon);
        this.shadowFrames = 0;
        this.shadowBox = {
            centre: new THREE.Vector3(0, 7, -24), halfWidth: 78, halfHeight: 34, depth: 320,
        };
    }

    /** Stand the moon somewhere else (each framing has its own) and redraw the shadows. */
    setMoon(azimuth, elevation) {
        sakuraMoonDirection(azimuth, elevation, this.moonDirection);
        this.uMoonDir.value.copy(this.moonDirection);
        this.frameShadows();
    }

    /** Aim the shadow camera so its box holds everything the play camera can see. */
    frameShadows() {
        const { moon } = this;
        const {
            centre, halfWidth, halfHeight, depth,
        } = this.shadowBox;
        moon.position.copy(centre).addScaledVector(this.moonDirection, depth * 0.5);
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
    }

    addTo(group) {
        group.add(this.moon, this.moon.target);
    }

    /** 1 where the moon reaches the fragment, 0 in shadow. */
    moonlight() {
        return float(this.shadowNode);
    }

    noise(coordinate) {
        return texture(this.noiseTexture, coordinate);
    }

    /**
     * The helpers every material shares. The lantern and ring arrays are walked by real
     * shader loops: unrolled in JavaScript they paste ten copies of the lamp maths into
     * every material, and the shader compiler then spends many seconds on the garden's
     * first frame. They stay inline functions (no `setLayout`): in three r186 a function
     * with a layout is generated once and reused, so the uniforms it captures are never
     * declared in the next material that calls it.
     */
    buildShaderFunctions() {
        this.skyFn = Fn(([direction]) => {
            const overhead = saturate(direction.y);
            const low = overhead.oneMinus();
            const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
            const toward = dot(flat, this.uGlowDir).mul(0.5).add(0.5);
            const vault = mix(this.uZenith, this.uVault, pow(low, 2.2));
            const band = mix(this.uHorizon, this.uAfterglow, pow(toward, 2.4));
            const ember = this.uEmber.mul(pow(low, 22).mul(pow(toward, 5)));
            const moonward = saturate(dot(direction, this.uMoonDir));
            const halo = this.uMoonColor.mul(pow(moonward, 9).mul(0.012).add(pow(moonward, 90).mul(0.06)));
            return mix(vault, band, pow(low, 5.5)).add(ember).add(halo)
                .mul(this.uSpirit.mul(0.18).add(1));
        });

        this.hazeFn = Fn(([colour, world, strength]) => {
            const offset = world.sub(cameraPosition);
            const range = length(offset);
            const direction = offset.div(max(range, 0.001));
            const height = max(world.y.sub(this.uWaterLevel), 0.5);
            // The air thins with height (a ray to the summit crosses less of it than one
            // along the water), and a shallow mist lies on the lake itself.
            const thick = height.mul(0.02);
            const column = thick.negate().exp().oneMinus().div(thick);
            const low = exp(height.mul(-0.4));
            const amount = exp(range.mul(this.uHaze.mul(column).add(this.uMist.mul(low))).negate()).oneMinus();
            // The air takes the colour of the sky behind it, so distance melts into the horizon.
            const air = this.skyFn(normalize(vec3(direction.x, max(direction.y, 0).mul(0.5).add(0.035), direction.z)));
            return mix(colour, air, saturate(amount.mul(strength)));
        });

        this.ringsFn = Fn(([point]) => {
            // x: band of light on each front, y: the wave under it, zw: outward push.
            const sum = vec4(0).toVar();
            Loop(SAKURA_RING_SLOTS, ({ i }) => {
                const ring = this.ringNodes.element(i);
                const offset = point.sub(ring.xy);
                const radius = max(length(offset), 0.001);
                const age = this.uTime.sub(ring.z);
                const front = radius.sub(age.mul(SAKURA_RING_SPEED));
                const packet = exp(front.mul(front).mul(-0.11)).mul(ring.w).mul(exp(age.mul(-0.55)))
                    .mul(saturate(age.mul(8)));
                const ripple = sin(front.mul(1.7)).mul(packet);
                sum.addAssign(vec4(packet, ripple, offset.div(radius).mul(ripple)));
            });
            return sum;
        });

        if (!this.lampCount) return;
        this.lampsFn = Fn(([world, normal, shaped]) => {
            const total = float(0).toVar();
            Loop(this.lampCount, ({ i }) => {
                const lamp = this.lampNodes.element(i);
                const offset = lamp.xyz.sub(world);
                const distanceSq = dot(offset, offset);
                const reach = float(1).div(distanceSq.mul(0.05).add(1));
                const order = float(i);
                const flicker = sin(this.uTime.mul(order.mul(0.83).add(6.1)).add(order.mul(2.1)))
                    .mul(sin(this.uTime.mul(order.mul(0.37).add(2.3)).add(order))).mul(0.07).add(0.93);
                const facing = saturate(dot(normal, offset.div(max(distanceSq, 0.0001).sqrt())).mul(0.6).add(0.4));
                total.addAssign(reach.mul(reach).mul(lamp.w).mul(flicker).mul(mix(float(1), facing, shaped)));
            });
            return this.uLampColor.mul(total).mul(this.uLampGain);
        });
    }

    /** Sky radiance seen along a unit direction (no stars, no disc: the dome adds those). */
    sky(direction) {
        return this.skyFn(direction);
    }

    /** Aerial perspective: distance and the mist over the water fade a colour into the air. */
    haze(colour, { world = positionWorld, strength = 1 } = {}) {
        return this.hazeFn(colour, world, float(strength));
    }

    /** Hemisphere ambient: violet sky from above, a dim bounce from the ground. */
    ambient(normal) {
        return mix(this.uBounce, this.uSkyLight, normal.y.mul(0.5).add(0.5));
    }

    /** Warm light from the lanterns reaching a point (optionally shaped by its normal). */
    lamps(world, normal = null) {
        if (!this.lampsFn) return vec3(0);
        return this.lampsFn(world, normal || vec3(0, 1, 0), float(normal ? 1 : 0));
    }

    /**
     * The rings a locked piece sends out: `band` is the light riding each expanding
     * front, `wave` the signed wave under it (for the water), `push` the outward direction
     * scaled by that wave.
     */
    rings(point) {
        const sum = this.ringsFn(point);
        return { band: sum.x, wave: sum.y, push: sum.zw };
    }

    /** Start a ring at world (x, z). Reuses the oldest slot; allocates nothing. */
    ring(x, z, strength) {
        if (!(strength > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
        this.ringData[this.ringCursor].set(x, z, this.uTime.value, Math.min(1.6, strength));
        this.ringCursor = (this.ringCursor + 1) % SAKURA_RING_SLOTS;
        return true;
    }

    resetRings() {
        this.ringData.forEach((ring) => ring.set(0, 0, -1000, 0));
        this.ringCursor = 0;
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
        const front = exp(world.x.sub(this.uFront.x).div(this.uFront.z).pow2().negate()).mul(this.uFront.y);
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

    update(time, frame = {}) {
        this.uTime.value = Number.isFinite(time) ? Math.max(0, time) : this.uTime.value;
        const clamp01 = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        this.uGust.value = clamp01(frame.gust) * 1.6;
        this.uGlow.value = clamp01(frame.glow);
        this.uSpirit.value = clamp01(frame.spirit);
        this.uLampGain.value = (1 + clamp01(frame.lanterns) * 0.7) * (1 - clamp01(frame.hush) * 0.7);
        if (frame.front && Number.isFinite(frame.front.x)) {
            this.uFront.value.set(frame.front.x, clamp01(frame.front.strength) * 2.2, 14, 0);
        } else this.uFront.value.y = 0;
        // Pipelines may still be compiling when the first shadow map is drawn; redraw it
        // over the first frames so no late tree is missing from the static map.
        this.shadowFrames += 1;
        if (this.shadowFrames < 10 || this.shadowFrames === 45 || this.shadowFrames === 150) {
            this.moon.shadow.needsUpdate = true;
        }
    }

    dispose() {
        this.noiseTexture.dispose();
        this.shadowNode.dispose?.();
        this.moon.shadow.dispose();
        this.moon.removeFromParent();
        this.moon.target.removeFromParent();
        this.moon.dispose();
    }
}

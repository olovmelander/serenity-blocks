/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the water's surface as a simulation.
 *
 * A height field over the whole pond obeys the wave equation, stepped at a fixed sixty times a
 * second between two render targets (which both renderer backends can do). Things that touch
 * the water write into it:
 *
 *   plungers   a locked piece, a leaping koi, a falling drop: a small disc that bobs a few times
 *              and so sends out a TRAIN of rings rather than one;
 *   wakes      every koi near the surface presses the water down where it is. A slow fish
 *              leaves soft rings, a fast one outruns its own waves and draws a V.
 *
 * Waves reflect off the bank and off the rocks that stand in the water (a mask baked from the
 * pond's shape) and die in a sponge at the edge of the simulated rectangle.
 *
 * A second pass turns the height field into what the picture needs — slopes for refraction and
 * glints, curvature for caustics, foam — and adds the pond's own breeze-ruffle, which is
 * analytic (a handful of warped wave trains) so that it is sharp, free and independent of the
 * simulation's resolution. Everything else samples only that one texture.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, cos, dot, exp, float, max, min, mix, sin, smoothstep, texture, uniform, uniformArray, uv, vec2, vec4,
} from 'three/tsl';
import {
    POND, POND_LENGTH, POND_WIDTH, clamp01, groundHeight, mulberry32, smooth,
} from './koi-pond-core.js';
import { WAVE_SPEED } from './koi-pond-light.js';

/** The simulation's own clock: fixed, so a replay reproduces a frame exactly. */
export const SIM_STEP = 1 / 60;
/** Plungers alive at once (a hard drop uses one; a four-line clear a handful). */
export const PLUNGER_SLOTS = 12;
/** Floats per wake handed to setWakes(). */
export const WAKE_STRIDE = 6;
/** Wake slots beyond one per koi (the dragon's body). */
export const WAKE_EXTRA = 10;
/** How hard a plunger works the water for the amplitude it is asked for (rings must READ). */
const PLUNGE_GAIN = 2.1;
/** Seconds a plunger bobs. */
const PLUNGER_LIFE = 1.1;
/** How much of its speed a wave keeps each step (the pond rings for a few seconds). */
const DAMPING = 0.9935;

/**
 * The breeze: direction (radians), wavelength (m), slope it adds (radians), speed (m/s), and
 * how much of its curvature the caustics take. The long swells barely tilt the surface (the
 * moon's image must stay a disc) and the caustics are drawn by the middle of the range, where
 * their cells are a hand's breadth to a forearm across.
 */
const RUFFLE = [
    [0.35, 1.9, 0.0055, 0.42, 0.5], [2.1, 1.25, 0.0075, 0.36, 1.0], [3.9, 0.82, 0.0095, 0.3, 1.7],
    [5.2, 0.6, 0.011, 0.27, 2.0], [1.2, 0.44, 0.011, 0.25, 1.7], [4.6, 0.33, 0.01, 0.23, 1.15],
    [2.9, 0.25, 0.009, 0.22, 0.6], [0.9, 0.18, 0.0075, 0.2, 0.3], [3.4, 0.13, 0.006, 0.19, 0.12],
];

function renderTarget(width, height, name) {
    const target = new THREE.RenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    target.texture.name = name;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    target.texture.generateMipmaps = false;
    return target;
}

/**
 * Where waves may travel: 1 in open water, falling to 0 on the bank and inside standing rocks.
 * @param {number} width
 * @param {number} height
 * @param {Array<{x:number,z:number,radius:number}>} rocks  rocks that break the surface
 */
export function bakeWaterMask(width, height, rocks = []) {
    const data = new Uint8Array(width * height * 4);
    for (let j = 0; j < height; j += 1) {
        const z = POND.minZ + ((j + 0.5) / height) * POND_LENGTH;
        for (let i = 0; i < width; i += 1) {
            const x = POND.minX + ((i + 0.5) / width) * POND_WIDTH;
            let open = smooth(0.015, 0.11, -groundHeight(x, z));
            for (let r = 0; r < rocks.length; r += 1) {
                const rock = rocks[r];
                const d = Math.hypot(x - rock.x, z - rock.z);
                open *= smooth(rock.radius * 0.82, rock.radius * 1.12, d);
            }
            const at = (j * width + i) * 4;
            const byte = Math.round(clamp01(open) * 255);
            data[at] = byte;
            data[at + 1] = byte;
            data[at + 2] = byte;
            data[at + 3] = 255;
        }
    }
    return data;
}

export class PondSurface {
    /**
     * @param {object} params
     * @param {PondLight} params.light
     * @param {object} params.tier        { sim: [w, h], derive: [w, h], koi }
     * @param {Array} [params.rocks]      rocks standing in the water
     */
    constructor({ light, tier, rocks = [] }) {
        this.light = light;
        const [simW, simH] = tier.sim;
        const [outW, outH] = tier.derive;
        this.simSize = [simW, simH];
        this.cell = POND_WIDTH / simW; // metres per simulation texel (square by construction)
        this.targets = [renderTarget(simW, simH, 'koi-pond-waves-a'), renderTarget(simW, simH, 'koi-pond-waves-b')];
        this.output = renderTarget(outW, outH, 'koi-pond-surface');
        this.read = 0;
        this.accumulator = 0;
        this.simTime = 0;
        this.steps = 0;
        this.disposed = false;

        const maskData = bakeWaterMask(simW, simH, rocks);
        this.maskTexture = new THREE.DataTexture(maskData, simW, simH, THREE.RGBAFormat, THREE.UnsignedByteType);
        this.maskTexture.name = 'koi-pond-water-mask';
        this.maskTexture.magFilter = THREE.LinearFilter;
        this.maskTexture.minFilter = THREE.LinearFilter;
        this.maskTexture.needsUpdate = true;

        // Plungers: xy = position, z = this step's push (m), w = radius (m).
        this.plungers = Array.from({ length: PLUNGER_SLOTS }, () => ({
            x: 0, z: 0, birth: -100, amp: 0, radius: 0.2, rate: 9, foam: 0,
        }));
        this.plungerData = Array.from({ length: PLUNGER_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0.2));
        this.plungerFoam = Array.from({ length: PLUNGER_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.plungerCursor = 0;
        // Wakes: xy = position, z = push this step (m), w = radius (m).
        this.wakeSlots = Math.max(1, tier.koi + WAKE_EXTRA);
        this.wakeData = Array.from({ length: this.wakeSlots }, () => new THREE.Vector4(0, 0, 0, 0.2));
        // The light a swimmer leaves in the water: x = amount this step, y = radius (m).
        this.wakeGlow = Array.from({ length: this.wakeSlots }, () => new THREE.Vector4(0, 0.2, 0, 0));

        this.u = {
            time: uniform(0),
            gust: uniform(1), // the breeze's strength (1 at rest)
            still: uniform(0), // 1 = the pond holds its breath: the ruffle dies
        };
        this.source = texture(this.targets[0].texture);
        this.heights = texture(this.targets[0].texture);
        // What the water's own shader reads straight from the simulation: b = foam, a = light.
        light.waves.value = this.targets[0].texture;
        this.buildStep(simW, simH);
        this.buildDerive();
        light.surface.value = this.output.texture;
    }

    buildStep(simW, simH) {
        const { source } = this;
        const mask = texture(this.maskTexture);
        const plungers = uniformArray(this.plungerData, 'vec4');
        const plungerFoam = uniformArray(this.plungerFoam, 'vec4');
        const wakes = uniformArray(this.wakeData, 'vec4');
        const wakeGlow = uniformArray(this.wakeGlow, 'vec4');
        const texel = vec2(1 / simW, 1 / simH);
        // The discrete wave equation's stiffness: 2 (c dt / dx)^2, below 1 for stability.
        const stiffness = 2 * ((WAVE_SPEED * SIM_STEP) / this.cell) ** 2;
        if (stiffness >= 0.98) throw new Error(`Koi Pond wave step is unstable (stiffness ${stiffness.toFixed(2)})`);

        const step = Fn(() => {
            const st = uv();
            const here = source.sample(st);
            const sum = source.sample(st.add(vec2(texel.x, 0)))
                .add(source.sample(st.sub(vec2(texel.x, 0))))
                .add(source.sample(st.add(vec2(0, texel.y))))
                .add(source.sample(st.sub(vec2(0, texel.y))))
                .mul(0.25);
            const around = sum.r;
            const velocity = here.g.add(around.sub(here.r).mul(stiffness)).mul(DAMPING).toVar();
            const height = here.r.add(velocity).toVar();
            const foam = here.b.mul(0.978).toVar();
            // Light left in the water spreads like ink and fades.
            const ink = mix(here.a, sum.a, 0.2).mul(0.9875).toVar();

            const world = vec2(mix(POND.minX, POND.maxX, st.x), mix(POND.minZ, POND.maxZ, st.y));
            Loop(PLUNGER_SLOTS, ({ i }) => {
                const p = plungers.element(i);
                const off = world.sub(p.xy);
                const disc = exp(dot(off, off).div(p.w.mul(p.w)).negate());
                height.addAssign(p.z.mul(disc));
                const f = plungerFoam.element(i);
                // (White water lies in a ring where the disc's rim struck, not in a cloud.)
                const reach = dot(off, off).sqrt().sub(f.y).div(f.y.mul(0.45));
                foam.addAssign(f.x.mul(exp(reach.mul(reach).negate())));
            });
            Loop(this.wakeSlots, ({ i }) => {
                const w = wakes.element(i);
                const off = world.sub(w.xy);
                const d2 = dot(off, off);
                height.subAssign(w.z.mul(exp(d2.div(w.w.mul(w.w)).negate())));
                const g = wakeGlow.element(i);
                ink.addAssign(g.x.mul(exp(d2.div(g.y.mul(g.y)).negate())));
            });

            // The bank and the rocks hold the water still; the rectangle's rim swallows waves.
            const open = mask.sample(st).r;
            const rim = smoothstep(0.0, 0.035, st.x).mul(smoothstep(0.0, 0.035, st.x.oneMinus()))
                .mul(smoothstep(0.0, 0.05, st.y)).mul(smoothstep(0.0, 0.05, st.y.oneMinus()));
            const hold = open.mul(mix(0.9, 1.0, rim));
            height.mulAssign(hold.mul(0.9996));
            velocity.mulAssign(hold);
            return vec4(height, velocity, min(foam, 4.0), min(ink.mul(open), 3.0));
        });

        this.stepMaterial = new THREE.NodeMaterial();
        this.stepMaterial.name = 'Koi Pond — wave step';
        this.stepMaterial.depthTest = false;
        this.stepMaterial.depthWrite = false;
        this.stepMaterial.fragmentNode = step();
        this.stepQuad = new THREE.QuadMesh(this.stepMaterial);
    }

    buildDerive() {
        const { heights, light, u } = this;
        const [simW, simH] = this.simSize;
        const texel = vec2(1 / simW, 1 / simH);
        const { cell } = this;
        const rand = mulberry32(9127);
        const waves = RUFFLE.map(([dir, length, tilt, speed, focus]) => {
            const k = (Math.PI * 2) / length;
            return {
                kx: Math.cos(dir), kz: Math.sin(dir), k, tilt, omega: k * speed, phase: rand() * 6.283, focus: tilt * k * focus,
            };
        });

        const derive = Fn(() => {
            const st = uv();
            const centre = heights.sample(st);
            const right = heights.sample(st.add(vec2(texel.x, 0))).r;
            const left = heights.sample(st.sub(vec2(texel.x, 0))).r;
            const up = heights.sample(st.add(vec2(0, texel.y))).r;
            const down = heights.sample(st.sub(vec2(0, texel.y))).r;
            const slope = vec2(right.sub(left), up.sub(down)).div(2 * cell).toVar();
            const curve = right.add(left).add(up).add(down).sub(centre.r.mul(4.0))
                .div(cell * cell)
                .toVar();

            // ── The breeze: warped wave trains, in patches that drift ──
            const world = vec2(mix(POND.minX, POND.maxX, st.x), mix(POND.minZ, POND.maxZ, st.y));
            const drift = u.time.mul(0.011);
            const warp = light.noise.sample(world.mul(0.045).add(vec2(drift, drift.mul(-0.7))));
            const p = world.add(warp.rg.sub(0.5).mul(1.7));
            const patch = light.noise.sample(world.mul(0.021).sub(vec2(drift.mul(0.6), drift.mul(0.35)))).g;
            const lively = mix(0.45, 1.5, smoothstep(0.25, 0.8, patch)).mul(u.gust).mul(u.still.oneMinus());
            const ruffleSlope = vec2(0.0).toVar();
            const ruffleCurve = float(0.0).toVar();
            waves.forEach((w) => {
                const phase = p.x.mul(w.kx * w.k).add(p.y.mul(w.kz * w.k)).sub(u.time.mul(w.omega)).add(w.phase);
                ruffleSlope.addAssign(vec2(w.kx, w.kz).mul(cos(phase).mul(w.tilt)));
                ruffleCurve.subAssign(sin(phase).mul(w.focus));
            });
            // Close to the bank the breeze is broken; the water lies flatter there.
            const open = smoothstep(0.0, 0.6, texture(this.maskTexture, st).r);
            slope.addAssign(ruffleSlope.mul(lively).mul(open));
            curve.addAssign(ruffleCurve.mul(lively).mul(open));
            return vec4(slope, curve, max(centre.b, 0.0));
        });

        this.deriveMaterial = new THREE.NodeMaterial();
        this.deriveMaterial.name = 'Koi Pond — surface derive';
        this.deriveMaterial.depthTest = false;
        this.deriveMaterial.depthWrite = false;
        this.deriveMaterial.fragmentNode = derive();
        this.deriveQuad = new THREE.QuadMesh(this.deriveMaterial);
    }

    /**
     * Something meets the water at (x, z): a disc `radius` metres across bobs `amp` metres a few
     * times and sends out a train of rings. `foam` leaves white water that fades.
     */
    plunge(x, z, {
        amp = 0.02, radius = 0.22, rate = 9, foam = 0, time = this.simTime,
    } = {}) {
        const slot = this.plungers[this.plungerCursor % PLUNGER_SLOTS];
        this.plungerCursor += 1;
        slot.x = x;
        slot.z = z;
        slot.birth = time;
        slot.amp = amp;
        slot.radius = radius;
        slot.rate = rate;
        slot.foam = foam;
    }

    /**
     * Koi (and anything else that swims) press the water down this step and may leave light in
     * it. `list` holds WAKE_STRIDE floats each: x, z, push (m), radius (m), light, light radius.
     */
    setWakes(list, count) {
        for (let i = 0; i < this.wakeSlots; i += 1) {
            const w = this.wakeData[i];
            const g = this.wakeGlow[i];
            if (i < count) {
                const o = i * WAKE_STRIDE;
                w.set(list[o], list[o + 1], list[o + 2], Math.max(0.05, list[o + 3]));
                g.set(list[o + 4], Math.max(0.05, list[o + 5]), 0, 0);
            } else {
                w.set(0, 0, 0, 0.2);
                g.set(0, 0.2, 0, 0);
            }
        }
    }

    /** Still water, no rings in flight (captures, a new run). */
    reset(renderer, time = 0) {
        this.accumulator = 0;
        this.simTime = time;
        this.steps = 0;
        this.plungerCursor = 0;
        this.plungers.forEach((p) => {
            p.birth = -100;
            p.amp = 0;
            p.foam = 0;
        });
        this.setWakes([], 0);
        this.read = 0;
        this.light.waves.value = this.targets[0].texture;
        if (!renderer) return;
        const previous = renderer.getRenderTarget();
        const colour = new THREE.Color();
        renderer.getClearColor(colour);
        const alpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 0);
        this.targets.forEach((target) => {
            renderer.setRenderTarget(target);
            renderer.clear(true, false, false);
        });
        renderer.setRenderTarget(previous);
        renderer.setClearColor(colour, alpha);
    }

    /** One fixed step of the wave equation. */
    stepOnce(renderer) {
        const t = this.simTime;
        for (let i = 0; i < PLUNGER_SLOTS; i += 1) {
            const p = this.plungers[i];
            const age = t - p.birth;
            const data = this.plungerData[i];
            const foam = this.plungerFoam[i];
            if (age >= 0 && age < PLUNGER_LIFE && p.amp !== 0) {
                // Down first, then a few fading bobs: the push is the bob's speed.
                const envelope = Math.exp(-age * 3.4);
                const push = -p.amp * PLUNGE_GAIN * envelope * Math.cos(age * p.rate) * p.rate * SIM_STEP;
                data.set(p.x, p.z, push, p.radius);
                foam.set(age < 0.22 ? p.foam * 0.13 : 0, p.radius * (0.7 + age * 2.2), 0, 0);
            } else {
                data.set(0, 0, 0, 0.2);
                foam.set(0, 0.2, 0, 0);
            }
        }
        const src = this.targets[this.read];
        const dst = this.targets[1 - this.read];
        this.source.value = src.texture;
        renderer.setRenderTarget(dst);
        this.stepQuad.render(renderer);
        this.read = 1 - this.read;
        this.light.waves.value = this.targets[this.read].texture;
        this.simTime += SIM_STEP;
        this.steps += 1;
    }

    /**
     * Advance the water by `dt` seconds (whole fixed steps; the remainder is carried), then
     * rebuild the texture the picture samples.
     * @param {THREE.WebGPURenderer} renderer
     * @param {number} dt
     * @param {number} time     the world clock, for the breeze
     * @param {number} [maxSteps=4]
     */
    update(renderer, dt, time, maxSteps = 4) {
        if (this.disposed || !renderer) return;
        const previous = renderer.getRenderTarget();
        this.accumulator = Math.min(this.accumulator + Math.max(0, dt), SIM_STEP * maxSteps);
        while (this.accumulator >= SIM_STEP - 1e-6) {
            this.stepOnce(renderer);
            this.accumulator -= SIM_STEP;
        }
        this.derive(renderer, time);
        renderer.setRenderTarget(previous);
    }

    derive(renderer, time) {
        this.u.time.value = time;
        this.heights.value = this.targets[this.read].texture;
        renderer.setRenderTarget(this.output);
        this.deriveQuad.render(renderer);
    }

    /**
     * Read the simulation back (diagnostics only: a GPU readback). Resolves to the largest
     * height, foam and light in the water, and the largest slope and curvature derived from it.
     */
    async probe(renderer) {
        const peaks = (pixels, channels) => {
            const out = channels.map(() => 0);
            for (let i = 0; i < pixels.length; i += 4) {
                for (let c = 0; c < channels.length; c += 1) {
                    const v = Math.abs(pixels[i + channels[c]]);
                    if (v > out[c]) out[c] = v;
                }
            }
            return out;
        };
        const sim = this.targets[this.read];
        const a = await renderer.readRenderTargetPixelsAsync(sim, 0, 0, sim.width, sim.height);
        const b = await renderer.readRenderTargetPixelsAsync(this.output, 0, 0, this.output.width, this.output.height);
        const half = (pixels) => (pixels instanceof Uint16Array
            ? Float32Array.from(pixels, (h) => THREE.DataUtils.fromHalfFloat(h)) : pixels);
        const [height, speed, foam, ink] = peaks(half(a), [0, 1, 2, 3]);
        const [slopeX, slopeZ, curve] = peaks(half(b), [0, 1, 2]);
        return {
            height, speed, foam, ink, slope: Math.max(slopeX, slopeZ), curve, steps: this.steps,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.targets.forEach((t) => t.dispose());
        this.output.dispose();
        this.maskTexture.dispose();
        this.stepMaterial.dispose();
        this.deriveMaterial.dispose();
    }
}

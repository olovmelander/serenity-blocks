/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — water in the air: the lip's standing rain, the spray a clear or a lock throws, and
 * the spindrift (mist where the lip comes down, the plume the offshore wind tears off the
 * shoulder's crest).
 *
 * Everything here is slow motion, like the wave: a drop leaves the lip at the speed the water
 * was drawn over it and falls under a fraction of gravity, so it hangs, turns the low sun into
 * a spark and drifts back past the eye. Nothing is stepped on the CPU: a drop's flight is
 * closed form from the moment it left, so a held frame (four lines) holds every drop in the
 * air for free.
 *
 * All three are additive, premultiplied, and write alpha 0: light is added to the frame and
 * nothing else is touched.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cameraViewMatrix, clamp, cos, dot, exp, float, fract, length, max, mix, normalize,
    positionGeometry, sin, smoothstep, texture, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    FLOW, TAU, WAVE, mulberry32, wavePoint,
} from './waves-core.js';

/** Gravity in the wave's slow motion (metres a second squared). */
export const GRAVITY = 0.46;

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial({
        fog: false,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        // A streak's axes turn with the drop's flight, so its winding does too.
        side: THREE.DoubleSide,
    });
    material.name = name;
    return material;
};

const cameraRight = () => vec3(cameraViewMatrix[0].x, cameraViewMatrix[1].x, cameraViewMatrix[2].x);
const cameraUp = () => vec3(cameraViewMatrix[0].y, cameraViewMatrix[1].y, cameraViewMatrix[2].y);

/** A quad turned to the eye and drawn out along a velocity, as the eye sees it. */
const streak = (centre, velocity, size, stretchPerSpeed) => {
    const viewVel = cameraViewMatrix.mul(vec4(velocity, 0.0)).xyz;
    const speed = length(viewVel.xy);
    const along = viewVel.xy.div(max(speed, 1e-3));
    const across = vec2(along.y.negate(), along.x);
    const stretch = float(1.0).add(speed.mul(stretchPerSpeed));
    const local = along.mul(positionGeometry.y.mul(size).mul(stretch)).add(across.mul(positionGeometry.x.mul(size)));
    return centre.add(cameraRight().mul(local.x)).add(cameraUp().mul(local.y));
};

/**
 * How a drop takes the hour: a little of the sky, and the sun (or the moon) when it stands
 * behind it. `light` = the hour's colours (waves-tsl.js createLight).
 */
const dropLight = (position, sun, warm, light) => {
    const toDrop = normalize(position.sub(cameraPosition));
    const forward = clamp(dot(toDrop, sun), 0.0, 1.0);
    const f2 = forward.mul(forward);
    const f8 = f2.mul(f2).mul(f2).mul(f2);
    return vec3(0.5, 0.62, 0.7).mul(light.skyTint).mul(0.6)
        .add(vec3(2.6, 1.7, 0.8).mul(f8.mul(f8)).mul(1.8).add(vec3(1.4, 0.95, 0.5).mul(f2.mul(f2)).mul(0.5))
            .mul(light.fireTint))
        .mul(mix(vec3(1.0), vec3(1.15, 1.0, 0.82), warm));
};

const bead = () => {
    const p = uv().sub(0.5).mul(2.0);
    const d = length(p);
    return exp(d.mul(d).mul(-5.0)).mul(float(1.0).sub(smoothstep(0.78, 1.0, d)));
};

const quads = (count) => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    geometry.instanceCount = count;
    return { base, geometry };
};

// ── The lip's standing rain ─────────────────────────────────────────────────────────────────

/**
 * Drops leaving the lip's torn edge all along the throw, each on its own loop.
 * Seeds: x where along the throw, y how far back in the torn edge (and its size),
 * z its loop's phase and length, w its speed.
 */
export function createLipRain({
    tier, U, shape, seed = 3,
}) {
    const count = tier.droplets;
    const rand = mulberry32(seed * 7919 + 11);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i += 1) seeds[i] = rand();
    const { base, geometry } = quads(count);
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

    const s = attribute('aSeed', 'vec4');
    const material = additive('waves-lip-rain');
    const d = shape.landing.sub(1.2).add(s.x.mul(WAVE.throwLength + 2.5));
    const z = d.negate();
    const life = s.z.mul(2.8).add(2.4);
    const age = fract(s.z.mul(7.31).add(s.x.mul(3.17)).add(U.time.div(life))).mul(life);
    const lip = shape.lipAngle(d);
    const torn = smoothstep(WAVE.lipCrest + 0.25, WAVE.lipClosed - 0.4, lip);
    const reach = mix(float(0.12), float(1.6), torn).mul(U.tear.mul(0.9).add(1.0));
    const row = float(1.0).sub(s.y.mul(reach).mul(0.75).div(lip.mul(WAVE.rho)));
    const from = shape.point(row, z).position;
    const before = shape.point(row.sub(0.014), z).position;
    const tangent = normalize(from.sub(before));
    // Thrown harder while the lip is throwing.
    const speed = s.w.mul(0.9).add(0.45).mul(FLOW.u).mul(U.tear.mul(0.8).add(1.0));
    const stray = vec3(sin(s.w.mul(91.0)), cos(s.x.mul(57.0)), sin(s.y.mul(33.0))).mul(0.13);
    const launch = tangent.mul(speed).add(vec3(0.0, 0.0, FLOW.z)).add(stray);
    const velocity = launch.add(vec3(0.0, age.mul(-GRAVITY), 0.0));
    const centre = from.add(launch.mul(age)).add(vec3(0.0, age.mul(age).mul(-0.5 * GRAVITY), 0.0));
    const fade = smoothstep(0.0, 0.25, age)
        .mul(float(1.0).sub(smoothstep(life.mul(0.7), life, age)))
        .mul(smoothstep(0.0, 0.2, centre.y));
    // Bigger where the lip is really falling.
    const size = s.y.mul(0.026).add(0.014).mul(torn.mul(0.75).add(0.4));
    const twinkle = sin(U.time.mul(s.w.mul(5.0).add(2.0)).add(s.x.mul(40.0))).mul(0.35).add(0.75);
    material.positionNode = streak(centre, velocity, size, 0.35);
    const vLook = varying(dropLight(centre, U.sun, U.warm, U.light).mul(fade).mul(twinkle), 'vWaveRain');
    material.outputNode = Fn(() => vec4(vLook.mul(bead()), 0.0))();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'waves-lip-rain';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            base.dispose();
            material.dispose();
        },
    };
}

// ── Thrown spray ────────────────────────────────────────────────────────────────────────────

const POOL_STRIDE = 12;

/** `rgb` leaned toward one colour of the spectrum (`hue` in radians) by `amount`. */
function spectrum(hue, amount, rgb, out) {
    out[0] = rgb[0] * (1 + amount * Math.cos(hue));
    out[1] = rgb[1] * (1 + amount * Math.cos(hue - 2.094));
    out[2] = rgb[2] * (1 + amount * Math.cos(hue + 2.094));
    return out;
}

/**
 * A ring buffer of drops thrown by events. Each is written once, when it leaves:
 * (x, y, z, birth), (vx, vy, vz, size), (r, g, b, life); the vertex stage flies it from there.
 */
export class SprayPool {
    constructor({ tier, U, seed = 5 }) {
        this.count = tier.spray;
        this.U = U;
        this.seed = seed;
        this.rand = mulberry32(seed * 104729 + 3);
        this.cursor = 0;
        this.data = new Float32Array(this.count * POOL_STRIDE);
        const { base, geometry } = quads(this.count);
        this.buffer = new THREE.InstancedInterleavedBuffer(this.data, POOL_STRIDE);
        this.buffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aStart', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
        geometry.setAttribute('aFlight', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
        geometry.setAttribute('aTint', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
        this.base = base;
        this.geometry = geometry;

        const aStart = attribute('aStart', 'vec4');
        const aFlight = attribute('aFlight', 'vec4');
        const aTint = attribute('aTint', 'vec4');
        const material = additive('waves-spray');
        const age = U.time.sub(aStart.w);
        const life = max(aTint.w, 0.05);
        const alive = smoothstep(0.0, 0.06, age).mul(float(1.0).sub(smoothstep(life.mul(0.55), life, age)));
        const t = max(age, 0.0);
        const velocity = aFlight.xyz.add(vec3(0.0, t.mul(-GRAVITY), 0.0));
        const centre = aStart.xyz.add(aFlight.xyz.mul(t)).add(vec3(0.0, t.mul(t).mul(-0.5 * GRAVITY), 0.0));
        const fade = alive.mul(smoothstep(-0.05, 0.12, centre.y));
        const light = dropLight(centre, U.sun, U.warm, U.light);
        material.positionNode = streak(centre, velocity, aFlight.w.mul(fade.mul(0.4).add(0.6)), 0.35);
        // A drop carries the colour of what threw it, and still sparks in the sun.
        const vLook = varying(aTint.rgb.mul(light.g.mul(0.55).add(0.5)).add(light.mul(0.35)).mul(fade), 'vWaveSpray');
        material.outputNode = Fn(() => vec4(vLook.mul(bead()), 0.0))();
        this.material = material;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = 'waves-spray';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 31;
        this.reset();
    }

    reset() {
        this.rand = mulberry32(this.seed * 104729 + 3);
        this.cursor = 0;
        // Born long ago: nothing is in the air.
        for (let i = 0; i < this.count; i += 1) {
            const at = i * POOL_STRIDE;
            this.data.fill(0, at, at + POOL_STRIDE);
            this.data[at + 3] = -1e4;
            this.data[at + 11] = 0.1;
        }
        this.buffer.needsUpdate = true;
    }

    /** One drop, leaving (x, y, z) at `time` with a velocity. */
    put(time, x, y, z, vx, vy, vz, size, rgb, life) {
        const at = this.cursor * POOL_STRIDE;
        this.cursor = (this.cursor + 1) % this.count;
        const d = this.data;
        d[at] = x;
        d[at + 1] = y;
        d[at + 2] = z;
        d[at + 3] = time;
        d[at + 4] = vx;
        d[at + 5] = vy;
        d[at + 6] = vz;
        d[at + 7] = size;
        d[at + 8] = rgb[0];
        d[at + 9] = rgb[1];
        d[at + 10] = rgb[2];
        d[at + 11] = life;
        this.buffer.needsUpdate = true;
    }

    /**
     * A crown: `n` drops thrown up and outward from a point on the water.
     * @param {number[]} out  outward speed range, @param {number[]} up  upward speed range (m/s);
     * `toward` adds speed toward the eye (+z), so a crown under a board card comes out from under it
     */
    crown(time, x, y, z, {
        n = 24, out = [0.15, 0.55], up = [0.45, 1.0], size = 0.03, rgb = [1, 1, 1], life = [1.6, 2.8], radius = 0.12,
        toward = 0,
    } = {}) {
        const { rand } = this;
        for (let k = 0; k < n; k += 1) {
            const a = rand() * TAU;
            const speed = out[0] + (out[1] - out[0]) * rand();
            const r = Math.sqrt(rand()) * radius;
            this.put(
                time + rand() * 0.08,
                x + Math.cos(a) * r,
                y + 0.02,
                z + Math.sin(a) * r,
                Math.cos(a) * speed + FLOW.u * 0.25,
                up[0] + (up[1] - up[0]) * rand() ** 0.7,
                Math.sin(a) * speed + FLOW.z * 0.5 + toward,
                size * (0.5 + rand()),
                rgb,
                life[0] + (life[1] - life[0]) * rand(),
            );
        }
    }

    /**
     * The lip throws: `n` drops leave its edge between two distances ahead, along the way the
     * water was going, harder than the standing rain. `flown` = seconds of flight the earliest
     * of them are given at once; `beads` = metres the largest drops add to their size; `prism`
     * (0..1) = how far each drop's light is split toward a colour of its own; `spread` = how
     * strongly the speeds crowd toward the slow end (1 = evenly).
     */
    throwLip(time, open, {
        from = 3, to = 16, n = 120, speed = [0.9, 2.2], size = 0.03, rgb = [1, 0.95, 0.85], life = [2.2, 3.8],
        delay = 0.3, flown = 0.9, beads = 0, prism = 0, spread = 1.6,
    } = {}) {
        const { rand } = this;
        const edge = { x: 0, y: 0, z: 0 };
        const inner = { x: 0, y: 0, z: 0 };
        const tint = [1, 1, 1];
        for (let k = 0; k < n; k += 1) {
            const d = from + (to - from) * rand();
            wavePoint(1 - rand() * 0.03, d, open, edge);
            wavePoint(0.95, d, open, inner);
            let tx = edge.x - inner.x;
            let ty = edge.y - inner.y;
            const len = Math.hypot(tx, ty) || 1;
            tx /= len;
            ty /= len;
            const v = speed[0] + (speed[1] - speed[0]) * rand() ** spread;
            // Some are written as already in flight: the sheet is in the air the moment it is thrown.
            this.put(
                time + rand() * delay - rand() * flown,
                edge.x,
                edge.y,
                edge.z,
                tx * v + (rand() - 0.5) * 0.3,
                ty * v + (rand() - 0.5) * 0.3 + 0.12,
                FLOW.z + (rand() - 0.5) * 0.35,
                // Mostly fine spray; `beads` adds the few big drops that hang like glass.
                size * (0.45 + rand() * 1.1) + beads * rand() ** 4,
                prism > 0 ? spectrum(rand() * TAU, prism, rgb, tint) : rgb,
                life[0] + (life[1] - life[0]) * rand(),
            );
        }
    }

    /**
     * A wheel of spray: `n` drops leave the wall all round the tube at one distance, turning
     * with the water and flung ahead toward the eye of the barrel.
     */
    swirl(time, open, {
        d = 4, n = 90, turn = 1.9, ahead = 1.5, size = 0.04, rgb = [0.8, 1, 0.95], life = [2.4, 3.6],
    } = {}) {
        const { rand } = this;
        const at = { x: 0, y: 0, z: 0 };
        const next = { x: 0, y: 0, z: 0 };
        for (let k = 0; k < n; k += 1) {
            const row = 0.04 + (k / n) * 0.9;
            const where = d + (rand() - 0.5) * 0.5;
            wavePoint(row, where, open, at);
            wavePoint(row + 0.02, where, open, next);
            let tx = next.x - at.x;
            let ty = next.y - at.y;
            const len = Math.hypot(tx, ty) || 1;
            tx /= len;
            ty /= len;
            // Off the wall a little (toward the tube's middle), round with the flow, and ahead.
            const inX = -at.x / (WAVE.a * 1.2);
            const inY = (WAVE.b - at.y) / (WAVE.b * 1.2);
            this.put(
                time + (k / n) * 0.45,
                at.x + inX * 0.15,
                at.y + inY * 0.15,
                at.z,
                tx * turn + inX * 0.4,
                ty * turn + inY * 0.4,
                -ahead * (0.7 + rand() * 0.6),
                size * (0.5 + rand()),
                rgb,
                life[0] + (life[1] - life[0]) * rand(),
            );
        }
    }

    dispose() {
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.base.dispose();
        this.material.dispose();
    }
}

// ── Spindrift ───────────────────────────────────────────────────────────────────────────────

/**
 * Soft sheets of spray: the boil where the lip comes down on the trough, and the plume the
 * offshore wind tears off the shoulder's crest ahead and carries back over the wave.
 * Seeds: x where along its line, y size and height, z loop, w which of the two it is.
 */
export function createMist({
    tier, U, shape, noise, seed = 9,
}) {
    const count = Math.max(4, tier.mist);
    const rand = mulberry32(seed * 6151 + 5);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
        seeds[i * 4] = (i + rand()) / count;
        seeds[i * 4 + 1] = rand();
        seeds[i * 4 + 2] = rand();
        // Two in five are the boil at the landing; the rest are the plume.
        seeds[i * 4 + 3] = i % 5 < 2 ? 0 : 1;
    }
    const { base, geometry } = quads(count);
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

    const s = attribute('aSeed', 'vec4');
    const material = additive('waves-spindrift');
    const plume = s.w;
    const life = mix(s.z.mul(2.5).add(3.5), s.z.mul(4.0).add(6.0), plume);
    const phase = fract(s.z.mul(5.3).add(s.x.mul(2.7)).add(U.time.div(life)));
    const age = phase.mul(life);
    // The boil: along the line where the lip meets the trough, rolling up and back.
    const dBoil = shape.landing.sub(2.6).add(s.x.mul(4.4));
    const foot = shape.point(float(1.0), dBoil.negate()).position;
    const boil = vec3(foot.x.add(s.y.sub(0.5).mul(1.1)), max(foot.y, 0.0).add(0.3), foot.z)
        .add(vec3(age.mul(0.16), age.mul(0.24), age.mul(FLOW.z)));
    // The plume: off the crest ahead, carried up and back over the wave by the wind.
    const dPlume = shape.crest.add(s.x.mul(s.x).mul(62.0)).sub(1.0);
    const top = shape.point(float(1.0), dPlume.negate()).position;
    const blown = top.add(vec3(1.25, 0.34, FLOW.z * 0.5).mul(age)).add(vec3(0.0, s.y.mul(0.5), 0.0));
    const centre = mix(boil, blown, plume);
    const size = mix(s.y.mul(0.7).add(0.9).add(age.mul(0.2)), s.y.mul(2.2).add(2.2).add(age.mul(0.85)), plume);
    const fade = smoothstep(0.0, 0.18, phase).mul(float(1.0).sub(smoothstep(0.45, 1.0, phase)));
    const strength = mix(float(0.026).add(U.tear.mul(0.05)), float(0.05), plume);
    // Lit like everything in the air here: mostly by the sun standing behind it.
    const toMist = normalize(centre.sub(cameraPosition));
    const forward = clamp(dot(toMist, U.sun), 0.0, 1.0);
    const f2 = forward.mul(forward);
    const f4 = f2.mul(f2);
    const light = vec3(0.34, 0.42, 0.5).mul(U.light.skyTint)
        .add(vec3(2.4, 1.35, 0.55).mul(f4.mul(f4)).mul(0.7).add(vec3(1.0, 0.62, 0.3).mul(f2).mul(0.35))
            .mul(U.light.fireTint))
        .mul(mix(vec3(1.0), vec3(1.15, 1.0, 0.82), U.warm));
    material.positionNode = centre
        .add(cameraRight().mul(positionGeometry.x.mul(size).mul(mix(float(1.0), float(1.9), plume))))
        .add(cameraUp().mul(positionGeometry.y.mul(size)));
    const vLook = varying(light.mul(fade).mul(strength), 'vWaveMist');
    const vSeed = varying(vec4(s.x, s.y, s.z, phase), 'vWaveMistSeed');
    material.outputNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const d = length(p);
        // A torn puff, not a disc: the noise eats its edge and drifts through it.
        const at = uv().mul(0.42).add(vec2(vSeed.x.mul(7.3), vSeed.y.mul(3.1)))
            .add(vec2(vSeed.w.mul(0.22), U.time.mul(0.012)));
        const wisp = texture(noise, at).b.mul(0.7).add(texture(noise, at.mul(2.3)).a.mul(0.3));
        const torn = smoothstep(0.0, 0.55, wisp.sub(d.mul(d).mul(0.62)));
        const soft = float(1.0).sub(smoothstep(0.55, 1.0, d));
        return vec4(vLook.mul(torn).mul(soft), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'waves-spindrift';
    mesh.frustumCulled = false;
    mesh.renderOrder = 29;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            base.dispose();
            material.dispose();
        },
    };
}

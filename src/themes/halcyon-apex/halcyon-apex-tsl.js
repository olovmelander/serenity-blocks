/**
 * Halcyon Apex — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once and reads no uniform carries `setLayout`, so it
 *    is emitted ONCE as a real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no lit materials): the sanctuary's light
 *    is the sun (direction and colour in the shared uniforms, its reach from one shadow map), the
 *    sky it scatters into, the lagoon's bounce and the event pulses below;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    smoothstep,
    step,
    texture,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CLEAR_AFTERGLOW,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    HALCYON_PALETTES,
    LOCK_SLOTS,
    PULSE_AFTERGLOW,
    PULSE_SLOTS,
    PULSE_SPEED,
    PULSE_WIDTH,
    RING_FADE,
    RING_REACH,
    RING_TAU,
    TAU,
    mulberry32,
} from './halcyon-apex-core.js';

export * from './halcyon-apex-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const haHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'ha_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const haHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ha_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const haLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const haMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const haBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x⁵ by products (a `pow` whose base strays below zero is a NaN). */
export const haPow5 = (x) => {
    const x2 = x.mul(x);
    return x2.mul(x2).mul(x);
};

/** Schlick's Fresnel for a clamped cosine. */
export const haFresnel = (cosine, f0 = 0.04) => float(f0).add(float(1 - f0).mul(haPow5(float(1.0).sub(clamp(cosine, 0.0, 1.0)))));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 4471, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    return base;
}

/** Bilinear, wrapping read of one channel of a baked noise field (the CPU twin of a fetch). */
export function sampleNoise(field, size, x, y, channel = 0) {
    const fx = (((x % 1) + 1) % 1) * size - 0.5;
    const fy = (((y % 1) + 1) % 1) * size - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (ix, iy) => field[((((iy % size) + size) % size) * size + (((ix % size) + size) % size)) * 4 + channel];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
}

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (the lagoon reads
 * it at grazing angles; generating half-float mips on the GPU is not portable to every WebGL2
 * device).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = THREE.DataUtils.toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'halcyon-apex-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the sanctuary's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture }} textures
 */
export function createSanctuaryUniforms(textures) {
    const p = HALCYON_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** 0..1: the sanctuary's charge (combo). */
        power: uniform(0),
        /** 0..LIFT_MAX: how far up the chain has lifted the sanctuary, eased. */
        lift: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light the sanctuary makes: a four-line clear holds its breath (→ 0.15). */
        breath: uniform(1),
        /** Unit vector toward the sun, and its angular radius (radians). */
        sunDir: uniform(new THREE.Vector3(0.48, 0.21, -0.85).normalize()),
        sunSize: uniform(0.0165),
        // The palette (scene-linear), eased by the world between levels.
        sun: v3(p.sun),
        zenith: v3(p.zenith),
        horizon: v3(p.horizon),
        glow: v3(p.glow),
        rose: v3(p.rose),
        cloud: v3(p.cloud),
        cloudShade: v3(p.cloudShade),
        shallow: v3(p.shallow),
        deep: v3(p.deep),
        crystal: v3(p.crystal),
        ley: v3(p.ley),
        stone: v3(p.stone),
        /** Where the Halcyon hangs (its centre) and where the Apex floats. */
        halcyonPos: uniform(new THREE.Vector3(70, 31, -135)),
        apexPos: uniform(new THREE.Vector3(-104, 100, -227)),
        /** The heart gate: (x, y, z, arc length on line A). */
        gate: uniform(new THREE.Vector4(-100, 36, -180, 200)),
        /** What the two hero crystals hold: (Apex amount, Halcyon amount, _, _) and its colour. */
        held: uniform(new THREE.Vector4(0, 0, 0, 0)),
        heldA: uniform(new THREE.Vector3(1, 1, 1)),
        heldB: uniform(new THREE.Vector3(1, 1, 1)),
        /** How far the clouds have drifted, the beads have risen, the crystals have turned. */
        cloudDrift: uniform(0),
        beadLift: uniform(0),
        spin: uniform(0),
        /** A four-line clear: the beacons (birth time, strength) and the ring it sends over the sky. */
        beacon: uniform(new THREE.Vector2(-100, 0)),
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** 1 while any ring / clear wave / ley pulse is still running (the loops are skipped at rest). */
        ringsLive: uniform(0),
        clearLive: uniform(0),
        pulsesLive: uniform(0),
        /** Ring slots: (x, z, birth time, strength) + (colour, reach as a fraction of RING_REACH). */
        lockA: [],
        lockC: [],
        /** Clear slots: (birth time, fronts, strength, sunfire 0..1) + colour + where on the lagoon it starts (x, z). */
        clearA: [],
        clearC: [],
        clearH: [],
        /** Ley pulse slots: (birth time, line 0 | 1, strength, _) + colour. */
        pulseA: [],
        pulseC: [],
        noiseTex: textures.noise,
        /** 1 where the sun reaches the fragment being shaded (the world swaps in the shadow node). */
        sunLit: float(1.0),
    };
    for (let i = 0; i < LOCK_SLOTS; i++) {
        u.lockA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.lockC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
        u.clearH.push(uniform(new THREE.Vector2(0, -12)));
    }
    for (let i = 0; i < PULSE_SLOTS; i++) {
        u.pulseA.push(uniform(new THREE.Vector4(-100, 0, 0, 0)));
        u.pulseC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── The sanctuary's light ───────────────────────────────────────────────────────

/**
 * The sky a direction ends in, without its clouds or the sun's disc: the zenith-to-horizon
 * gradient, the gold the sun pours along the horizon, the rose band opposite it, and the glow
 * round the sun. Every material uses it — as the colour of distance, as the light a surface
 * gathers from the side it faces, and as what a facet or the water mirrors.
 */
export const haSkyBase = (u, dir) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const cs = dot(dir, u.sunDir);
    const toward = max(cs, 0.0);
    const t2 = toward.mul(toward);
    const t4 = t2.mul(t2);
    const t8 = t4.mul(t4);
    const t32 = t8.mul(t8).mul(t8).mul(t8);
    // The horizon is gold toward the sun and turns to rose, then to the zenith's blue, away from it.
    const away = float(1.0).sub(smoothstep(-0.75, 0.55, cs));
    const low = mix(u.horizon, mix(u.rose, u.zenith, 0.35), away.mul(0.82));
    const lift = up.sqrt();
    const grad = mix(low, u.zenith, smoothstep(0.0, 0.92, lift));
    // A band of light lies on the horizon itself.
    const band = low.mul(exp(up.mul(-11.0))).mul(toward.mul(0.4).add(0.15));
    const scatter = u.glow.mul(t4.mul(0.07).add(t32.mul(0.22)).add(t32.mul(t32).mul(0.6)))
        .mul(exp(up.mul(-1.6)).mul(0.6).add(0.4));
    return grad.add(band).add(scatter).mul(u.breath.mul(0.45).add(0.55));
};

/**
 * The colour of distance along a direction: the sky function without the glare round the sun
 * (air between the viewer and a near thing does not carry the sun's disc).
 */
export const haSkyFog = (u, dir) => {
    const up = clamp(dir.y, 0.0, 1.0);
    const cs = dot(dir, u.sunDir);
    const toward = max(cs, 0.0);
    const t2 = toward.mul(toward);
    const away = float(1.0).sub(smoothstep(-0.75, 0.55, cs));
    const low = mix(u.horizon, mix(u.rose, u.zenith, 0.35), away.mul(0.82));
    const grad = mix(low, u.zenith, smoothstep(0.0, 0.92, up.sqrt()));
    return grad.add(u.glow.mul(t2.mul(t2).mul(0.16))).mul(u.breath.mul(0.45).add(0.55));
};

/** The sun's disc along a direction (what a facet or still water mirrors of it). */
export const haSunDisc = (u, dir) => {
    const edge = u.sunSize.cos();
    const cs = dot(dir, u.sunDir);
    return u.sun.mul(smoothstep(edge.sub(0.00012), edge.add(0.00004), cs)).mul(5.0).mul(u.breath);
};

/**
 * The light a surface with normal `n` gathers from the sky: the sky function read a little above
 * the way the surface faces, which is warm on the side that looks at the sun and blue on the far
 * side, and brighter the more of the sky a surface sees.
 */
export const haSkyLight = (u, n) => {
    const d = normalize(vec3(n.x, max(n.y, 0.0).add(0.55), n.z));
    return haSkyBase(u, d).mul(n.y.mul(0.32).add(0.68));
};

/** Fraction of light lost between the camera and a point `dist` away at height `y`. */
export const haFogAmount = (dist, y) => {
    const thin = mix(float(1.0), float(0.5), smoothstep(20.0, 320.0, y));
    const air = float(1.0).sub(exp(dist.mul(-1 / 1650).mul(thin)));
    // Mist lies on the lagoon.
    const mist = float(1.0).sub(exp(dist.mul(-1 / 560))).mul(exp(max(y, 0.0).mul(-0.07))).mul(0.34);
    return float(1.0).sub(float(1.0).sub(air).mul(float(1.0).sub(mist)));
};

/** Apply the atmosphere to a shaded colour at world point `p`. */
export const haAtmosphere = (u, col, p) => {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const f = haFogAmount(dist, p.y);
    return mix(col, haSkyFog(u, vec3(dir.x, max(dir.y, 0.015), dir.z)), f);
};

/**
 * Light of the lock rings at world point `p`: each lock sends a ring out over the lagoon from
 * under the board. Returns the summed colour (HDR).
 */
export const haLockLight = (u, p) => {
    let sum = vec3(0.0);
    for (let i = 0; i < LOCK_SLOTS; i++) {
        const A = u.lockA[i];
        const age = u.time.sub(A.z);
        const radius = u.lockC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = haBell(d.sub(radius).div(u.lockC[i].w.mul(2.0).add(1.6)));
        const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.lockC[i].rgb.mul(shell.mul(env)));
    }
    return sum;
};

/**
 * The clear waves at world point `p`. Returns vec4(colour · front, afterglow): the bright
 * leading fronts (one per cleared line) and the afterglow of everything the wave has passed.
 */
export const haClearLight = (u, p) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const far = clamp(length(p.xz.sub(u.clearH[i])).div(CLEAR_REACH), 0.0, 1.0);
        const pass = float(CLEAR_TRAVEL).mul(far.pow(1 / CLEAR_SHAPE));
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(haBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(since.div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
};

/**
 * The ley pulses at arc length `s` of ley line `line` (0 = the causeway, 1 = the dial). Returns
 * vec4(colour · packet, warmth): the lit packet running up the line and the warmth it leaves.
 */
export const haPulseLight = (u, line, s) => {
    let packet = vec3(0.0);
    let warmth = float(0.0);
    for (let i = 0; i < PULSE_SLOTS; i++) {
        const A = u.pulseA[i];
        const behind = u.time.sub(A.x).mul(PULSE_SPEED).sub(s);
        const on = step(abs(A.y.sub(line)), 0.5).mul(A.z);
        // A crisp head with a tail three times as long.
        const head = haBell(behind.div(PULSE_WIDTH * 0.35)).add(haBell(behind.sub(PULSE_WIDTH).div(PULSE_WIDTH * 1.6)).mul(0.45))
            .add(exp(max(behind, 0.0).mul(-1 / (PULSE_SPEED * 0.3))).mul(step(0.0, behind)).mul(0.32));
        packet = packet.add(u.pulseC[i].mul(head.mul(on)));
        warmth = warmth.add(exp(max(behind, 0.0).mul(-1 / (PULSE_SPEED * PULSE_AFTERGLOW))).mul(step(0.0, behind)).mul(on));
    }
    return vec4(packet, warmth);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function haFxMaterial(name, { depthTest = true } = {}) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

/**
 * A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function haQuadGeometry(count, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** The mesh wrapper every part returns. */
export function haPart(name, geometry, material, renderOrder = 0, reflected = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
}

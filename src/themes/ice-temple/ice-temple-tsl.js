/**
 * Ice Temple — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no scene lights): the temple's light is
 *    the Great Crystal at the end of the nave, the moon over the left colonnade, the aurora
 *    overhead and the gameplay pulses below, so the ice floor's mirror render stays cheap;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CLEAR_AFTERGLOW,
    CLEAR_DEPTH,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    LOCK_FADE,
    LOCK_REACH,
    LOCK_SHELL_WIDTH,
    LOCK_SLOTS,
    LOCK_TAU,
    MOON,
    NAVE,
    SHADOW_ROWS,
    TAU,
    linRGB,
    mulberry32,
} from './ice-temple-core.js';

export * from './ice-temple-core.js';

/** An sRGB hex as a scene-linear vec3 node. */
export function lin(hex) {
    const [r, g, b] = linRGB(hex);
    return vec3(r, g, b);
}

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const itHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'it_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const itHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'it_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1) */
export const itHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'it_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const itLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const itMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const itBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

export const itSaturate = (x) => clamp(x, 0.0, 1.0);

/**
 * A rainbow for the prism: `t` in 0..1 runs red → violet. Smooth, never black, HDR-safe.
 */
export const itSpectrum = /* @__PURE__ */ Fn(([t]) => {
    const x = fract(t).mul(TAU);
    return vec3(
        sin(x.add(1.9)).mul(0.5).add(0.5),
        sin(x.add(0.1)).mul(0.5).add(0.5),
        sin(x.sub(1.9)).mul(0.5).add(0.5),
    ).mul(0.86).add(0.14);
}).setLayout({ name: 'it_spectrum', type: 'vec3', inputs: [{ name: 't', type: 'float' }] });

/**
 * Voronoi: the cell a point lies in. Returns (site.xy, F1, F2): the nearest site in the same
 * space as `p`, and the distances to the nearest and the second-nearest site. F2 − F1 is zero
 * on a cell wall — a crack — and the sites let the floor find where a view ray passing down
 * through the ice crosses that wall.
 */
export const itVoronoi = /* @__PURE__ */ Fn(([p]) => {
    const n = floor(p);
    const f = fract(p);
    const d1 = float(8.0).toVar();
    const d2 = float(8.0).toVar();
    const site = vec2(0.0).toVar();
    for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
            const g = vec2(i, j);
            const o = itHash22(n.add(g)).mul(0.86).add(0.07);
            const r = g.add(o).sub(f);
            const d = dot(r, r);
            const closer = d.lessThan(d1);
            d2.assign(select(closer, d1, min(d2, d)));
            site.assign(select(closer, n.add(g).add(o), site));
            d1.assign(min(d1, d));
        }
    }
    return vec4(site, sqrt(d1), sqrt(d2));
}).setLayout({ name: 'it_voronoi', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }] });

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * A tileable RGBA fBm texture: four decorrelated channels of periodic gradient noise (five
 * octaves), stretched to [0, 1], half floats, with a CPU-built mip chain (the floor reads it at
 * grazing angles; generating half-float mips on the GPU is not portable to every WebGL2 device).
 * Baked once (≈ 45 ms); every veil in the ice, drift of snow and curtain ray is a fetch of it.
 */
export function createNoiseTexture(seed = 7411, size = NOISE_SIZE) {
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
    // Mip chain: 2×2 box filter down to 1×1.
    const mipmaps = [];
    let level = base;
    let w = n;
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
    const tex = new THREE.DataTexture(mipmaps[0].data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'ice-temple-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

/**
 * Every uniform the temple's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture }} textures
 */
export function createTempleUniforms(textures) {
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Half the cotangent of half the vertical field of view: pixels per metre at 1 m = viewport.y × this. */
        projScale: uniform(0.9),
        /** The aurora: its bright lower border, its body, the fringe high above; and its gain. */
        auroraA: uniform(new THREE.Vector3(0.05, 1.0, 0.34)),
        auroraB: uniform(new THREE.Vector3(0.03, 0.62, 1.0)),
        auroraC: uniform(new THREE.Vector3(0.28, 0.11, 1.0)),
        auroraGain: uniform(1),
        /** The Great Crystal: where its light is, its colour and its power (1 at rest). */
        heartPos: uniform(new THREE.Vector3(0, NAVE.heartY, NAVE.heartZ)),
        heartColor: uniform(new THREE.Vector3(0.33, 0.8, 1.0)),
        heartPower: uniform(1),
        /** The moon's light, and how much of the ambient light is left (a hush dims it). */
        moonColor: uniform(new THREE.Vector3(0.62, 0.76, 1.0)),
        ambient: uniform(1),
        /** The night: straight up, at the horizon, and the mist over the ice. */
        skyZenith: uniform(new THREE.Vector3(0.0012, 0.0026, 0.009)),
        skyHorizon: uniform(new THREE.Vector3(0.006, 0.017, 0.036)),
        hazeColor: uniform(new THREE.Vector3(0.006, 0.016, 0.03)),
        /** Mist density at the ice (per metre). */
        mist: uniform(0.0042),
        /**
         * Resonance (the combo): 0..1, its colour, how high the standing glow has climbed the
         * columns (metres), and how far the lit cracks have spread from the board (metres).
         */
        resonance: uniform(0),
        resColor: uniform(new THREE.Vector3(0.05, 1.0, 0.6)),
        resLevel: uniform(0),
        resRadius: uniform(0),
        /** Where the board stands on the ice (x, z). */
        focus: uniform(new THREE.Vector2(0, -7)),
        /** Snow: metres fallen, metres drifted, the vortex's turn (radians), dust gain. */
        snowFall: uniform(0),
        snowDrift: uniform(0),
        swirl: uniform(0),
        dustGain: uniform(1),
        /** Lock slots: (x, z, birth time, strength) + colour. */
        lockA: [],
        lockC: [],
        /** Clear slots: (birth time, fronts, strength, gold 0..1) + colour. */
        clearA: [],
        clearC: [],
        noiseTex: textures.noise,
    };
    for (let i = 0; i < LOCK_SLOTS; i++) {
        u.lockA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.lockC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── The temple's light ──────────────────────────────────────────────────────────

const MOON_DIR = vec3(MOON.dir[0], MOON.dir[1], MOON.dir[2]);

/** The direction toward the moon (a constant node). */
export const itMoonDir = () => MOON_DIR;

/**
 * The night sky along a direction: the gradient, and a soft wash of the aurora overhead (the
 * curtains themselves are geometry; this is what every facet and the far ice mirror of them).
 * `wash` scales the aurora: a mirror shows more of it than the sky dome paints under the curtains.
 */
export function itSky(u, dir, wash = 0.05) {
    const up = dir.y;
    const horizon = exp(abs(up).mul(-5.0));
    const base = mix(u.skyZenith, u.skyHorizon, horizon);
    const k = smoothstep(0.04, 0.5, up);
    const inv = float(1.0).div(max(up, 0.1));
    const sx = dir.x.mul(inv);
    const sz = dir.z.mul(inv);
    const w1 = sin(sx.mul(1.7).add(sin(sz.mul(0.9).add(u.time.mul(0.11))).mul(1.3)).add(u.time.mul(0.07))).mul(0.5).add(0.5);
    const w2 = sin(sz.mul(1.3).sub(sx.mul(0.6)).add(u.time.mul(0.05)).add(2.1)).mul(0.5).add(0.5);
    const glow = u.auroraA.mul(w1.mul(w1)).add(u.auroraB.mul(w2.mul(w2)).mul(0.6));
    return base.mul(u.ambient).add(glow.mul(k).mul(u.auroraGain).mul(wash));
}

/** The Great Crystal and the moon as seen along `dir` from `p` (what a facet mirrors). */
export function itLobes(u, p, dir) {
    const toHeart = u.heartPos.sub(p);
    const hd = max(length(toHeart), 1.0);
    const h = itSaturate(dot(dir, toHeart.div(hd)));
    // The crystal is a few degrees across from the near end of the nave: a tight lobe.
    const heart = u.heartColor.mul(u.heartPower).mul(pow(h, 320.0).mul(2.4).add(pow(h, 36.0).mul(0.06)));
    const m = itSaturate(dot(dir, MOON_DIR));
    const moon = u.moonColor.mul(u.ambient).mul(pow(m, 900.0).mul(9.0).add(pow(m, 30.0).mul(0.16)));
    return heart.add(moon);
}

/** The Great Crystal's light arriving at `p`. */
export function itHeartLight(u, p) {
    const d = u.heartPos.sub(p);
    const d2 = dot(d, d);
    return u.heartColor.mul(u.heartPower).mul(float(1.0).div(d2.mul(0.0011).add(1.0)));
}

/**
 * Fraction of moonlight reaching `p`: every row of columns throws a shadow across the ice.
 * The CPU twin is moonShadowAt() in ice-temple-core.js.
 */
export function itMoonShadow(p) {
    const [lx, lz] = MOON.flat;
    let lit = float(1.0);
    for (let i = 0; i < SHADOW_ROWS.length; i++) {
        const [cx, z0, count, radius, height] = SHADOW_ROWS[i];
        const s = float(cx).sub(p.x).div(lx);
        const zHit = p.z.add(s.mul(lz));
        const k = clamp(floor(float(z0).sub(zHit).div(NAVE.bay).add(0.5)), 0.0, count - 1);
        const perp = abs(zHit.sub(float(z0).sub(k.mul(NAVE.bay)))).mul(Math.abs(lx));
        const rayH = p.y.add(s.mul(MOON.tanElevation));
        const pen = max(s.mul(0.014).add(0.06), 0.05);
        const edge = float(1.0).sub(smoothstep(float(radius).sub(pen), float(radius).add(pen), perp));
        const top = float(1.0).sub(smoothstep(height - 1, height + 1, rayH));
        lit = lit.mul(float(1.0).sub(edge.mul(top).mul(step(0.0, s))));
    }
    return lit;
}

/**
 * Fraction of light lost between the camera and a point: a thin haze everywhere, and a mist
 * that lies on the ice (exponential in height, integrated along the ray in closed form).
 * `rel` = point − camera, `dist` = its length.
 */
export function itFogAmount(u, rel, dist) {
    const falloff = 0.2;
    const k = rel.y.div(max(dist, 1e-3)).mul(falloff);
    const safe = select(abs(k).lessThan(1e-4), float(1e-4), k);
    const run = float(1.0).sub(exp(clamp(dist.mul(safe).negate(), -20.0, 20.0))).div(safe);
    const depth = u.mist.mul(exp(cameraPosition.y.mul(-falloff))).mul(run).add(dist.mul(0.0006));
    return float(1.0).sub(exp(max(depth, 0.0).negate()));
}

/**
 * The Great Crystal's glow in the mist along a view ray, in closed form: the integral of
 * 1 / |x − heart|² from the camera to the surface. Geometry cuts the integral short, so columns
 * stand dark against the glow and the glow wraps round them.
 */
export function itAirlight(u, rel, dist) {
    const dir = rel.div(max(dist, 1e-3));
    const toHeart = u.heartPos.sub(cameraPosition);
    const b = dot(toHeart, dir);
    const h = sqrt(max(dot(toHeart, toHeart).sub(b.mul(b)), 1.4));
    const integral = atan(dist.sub(b).div(h)).add(atan(b.div(h))).div(h);
    // A flare must not white the whole nave out: the glow follows the power only so far.
    return u.heartColor.mul(min(u.heartPower, 1.8)).mul(integral).mul(0.2);
}

/** Apply the atmosphere to a shaded colour at world point `p`. */
export function itAtmosphere(u, col, p) {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const f = itFogAmount(u, rel, dist);
    const dir = rel.div(max(dist, 1e-3));
    const toMoon = itSaturate(dot(dir, MOON_DIR));
    const haze = u.hazeColor.mul(u.ambient)
        .add(u.auroraA.mul(u.auroraGain).mul(0.003))
        .add(u.moonColor.mul(u.ambient).mul(pow(toMoon, 5.0)).mul(0.02));
    return mix(col, haze, f).add(itAirlight(u, rel, dist));
}

/**
 * Light of the lock shells at world point `p`: each lock throws an expanding shell from where
 * the piece struck the ice. Returns the summed colour (HDR).
 */
export function itLockLight(u, p) {
    let sum = vec3(0.0);
    for (let i = 0; i < LOCK_SLOTS; i++) {
        const A = u.lockA[i];
        const age = u.time.sub(A.z);
        const radius = float(LOCK_REACH).mul(float(1.0).sub(exp(age.div(-LOCK_TAU))));
        const d = length(p.sub(vec3(A.x, 0.0, A.y)));
        const shell = itBell(d.sub(radius).div(LOCK_SHELL_WIDTH));
        const env = exp(age.mul(-LOCK_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.lockC[i].mul(shell.mul(env)));
    }
    return sum;
}

/**
 * The clear waves at depth `z` (world, negative ahead of the camera). Returns
 * vec4(colour · front, afterglow): the bright leading fronts (one per cleared line) and the
 * afterglow of everything the wave has already passed.
 */
export function itClearLight(u, z) {
    let front = vec3(0.0);
    let glow = float(0.0);
    const depth = clamp(z.negate().div(CLEAR_DEPTH), 0.0, 1.0);
    const pass = float(CLEAR_TRAVEL).mul(float(1.0).sub(pow(depth, 1 / CLEAR_SHAPE)));
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(itBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(since.div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
}

/**
 * The standing glow of a resonating temple at world point `p`: a slow wave running down the
 * nave, in the resonance's colour. Callers shape it (the columns fill from the floor up).
 */
export function itResonance(u, p) {
    const wave = sin(u.time.mul(2.3).add(p.z.mul(0.13))).mul(0.5).add(0.5);
    return u.resColor.mul(u.resonance).mul(wave.mul(0.55).add(0.45));
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function itFxMaterial(name, { depthTest = true } = {}) {
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
export function itQuadGeometry(count, attributes = {}) {
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

/** Wrap a finished part: a named, never-culled, static mesh. */
export function itPart(name, geometry, material, renderOrder = 0, reflected = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
}

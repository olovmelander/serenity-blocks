/**
 * Cinder Drift — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once and reads no texture or uniform carries
 *    `setLayout`, so it is emitted ONCE as a real shader function;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, the crust's plates are a second
 *    baked texture (a tileable Voronoi with true edge distances), hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no scene lights): the chamber's light is
 *    the lake, the great fall, the night in the roof and the event pulses below;
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
    pow,
    select,
    smoothstep,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    CINDER_PALETTES,
    CLEAR_AFTERGLOW,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    DRIFT_DIR,
    FISSURE_Z,
    HEAT_EXTENT,
    HEAT_HOLD,
    LAKE,
    RING_FADE,
    RING_REACH,
    RING_SLOTS,
    RING_TAU,
    SKYLIGHT,
    STREAM_SLOTS,
} from './cinder-drift-core.js';

export * from './cinder-drift-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const cdHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'cd_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const cdHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'cd_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const cdLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const cdMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const cdBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

// ── Baked fields ────────────────────────────────────────────────────────────────

// The bakes are pure and three-free (cinder-drift-bake.js): a first visit runs them in a worker.
export {
    NOISE_SIZE, PLATE_SIZE, bakeNoise, bakePlates,
} from './cinder-drift-bake.js';

/** Bilinear, wrapping read of one channel of a baked field (the CPU twin of a fetch). */
export function sampleField(field, size, x, y, channel = 0) {
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
 * A four-channel field as a tileable half-float texture with a CPU-built mip chain (the lake
 * reads both at grazing angles; generating half-float mips on the GPU is not portable to every
 * WebGL2 device).
 */
export function createFieldTexture(field, size, name) {
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
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

/** A one-channel half-float texture over `data` (size × size); `repeat` = wrapping. */
export function createScalarTexture(data, size, name, repeat = false) {
    const half = new Uint16Array(size * size);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, size, size, THREE.RedFormat, THREE.HalfFloatType);
    const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

/** Copy a HeatField into its texture (call when the field's `version` has moved). */
export function uploadHeat(tex, field) {
    const half = tex.image.data;
    const { data } = field;
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    tex.needsUpdate = true;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the chamber's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, plates: THREE.Texture, shore: THREE.Texture, heat: THREE.Texture }} textures
 */
export function createChamberUniforms(textures) {
    const p = CINDER_PALETTES[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** 0..1: the chamber's pressure (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** Gain on every light in the chamber: a four-line clear holds its breath (→ 0.15). */
        breath: uniform(1),
        /** Metres the crust has drifted, and the clock the molten lava's skin flows on. */
        drift: uniform(0),
        flow: uniform(0),
        /** How far the embers have been carried up (pressure lifts them faster). */
        lift: uniform(0),
        /** The moment the heat texture is true for. */
        heatRef: uniform(0),
        /** A whirl in the crust (a T-spin): (x, z, birth time, turns). */
        whirl: uniform(new THREE.Vector4(0, 0, -100, 0)),
        // The palette (scene-linear), eased by the world between levels.
        hot: v3(p.hot),
        mid: v3(p.mid),
        deep: v3(p.deep),
        haze: v3(p.haze),
        rock: v3(p.rock),
        cool: v3(p.cool),
        spark: v3(p.spark),
        /** The great fall: the point its light comes from, its foot, and how hard it runs. */
        fallPos: uniform(new THREE.Vector3(-48, 11, -93)),
        fallFoot: uniform(new THREE.Vector3(-48, 0, -92)),
        fallGain: uniform(1),
        /** The skylight's shaft: where it enters and where it lands. */
        skyTop: uniform(new THREE.Vector3(...SKYLIGHT.top)),
        skyFoot: uniform(new THREE.Vector3(...SKYLIGHT.foot)),
        /** Fissures a chain of clears has opened: 0..STREAM_SLOTS. */
        fissures: uniform(0),
        /** Where each fissure opens in the cliff: (x, y, z, 1). */
        fissureAt: [],
        /** How much of the curtain of fire is standing along the fissure (0..1). */
        curtain: uniform(0),
        /** A four-line clear's shock through the rock: (birth time, strength). */
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** 1 while any ring / any clear wave is still in the chamber (the loops are skipped at rest). */
        ringsLive: uniform(0),
        clearLive: uniform(0),
        /** Where on the lake the clear waves start: (x, z). */
        heart: uniform(new THREE.Vector2(0, -10)),
        /** Ring slots: (x, z, birth time, strength) + (colour, reach as a fraction of RING_REACH). */
        ringA: [],
        ringC: [],
        /** Clear slots: (birth time, fronts, strength, white heat 0..1) + colour. */
        clearA: [],
        clearC: [],
        noiseTex: textures.noise,
        plateTex: textures.plates,
        shoreTex: textures.shore,
        heatTex: textures.heat,
    };
    for (let i = 0; i < RING_SLOTS; i++) {
        u.ringA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.ringC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
    }
    for (let i = 0; i < STREAM_SLOTS; i++) u.fissureAt.push(uniform(new THREE.Vector4(0, 20, -100, 1)));
    u.noise = (st) => texture(u.noiseTex, st);
    /** World xz → plate space (where the crust, and the heat it remembers, hold still). */
    u.plateSpace = (xz) => xz.sub(vec2(DRIFT_DIR[0], DRIFT_DIR[1]).mul(u.drift));
    /** The heat the lake remembers at a plate-space point, cooled to now. */
    u.memory = (q) => texture(u.heatTex, q.div(HEAT_EXTENT)).r.mul(exp(u.time.sub(u.heatRef).max(0.0).div(-HEAT_HOLD)));
    /** Open lava between a world xz and the nearest rock: 0 on the shore → 1 far out. */
    u.shore = (xz) => texture(u.shoreTex, vec2(
        xz.x.sub(LAKE.x0).div(LAKE.x1 - LAKE.x0),
        xz.y.sub(LAKE.z0).div(LAKE.z1 - LAKE.z0),
    )).r;
    return u;
}

// ── The chamber's light ─────────────────────────────────────────────────────────

/**
 * The colour of lava at temperature `t`: nothing at 0, its skin's deep red by 0.4, its body by
 * 0.85, its white heart from 1.3 (HDR: the heart is several times brighter than the display).
 */
export const cdHeatColor = (u, tIn) => {
    const t = max(tIn, 0.0);
    return u.deep.mul(smoothstep(0.02, 0.42, t).mul(0.62))
        .add(u.mid.mul(smoothstep(0.3, 0.9, t).mul(1.9)))
        .add(u.hot.mul(smoothstep(0.78, 1.45, t).mul(3.4)))
        .add(vec3(1.0, 0.95, 0.85).mul(smoothstep(1.4, 2.4, t).mul(3.0)));
};

/**
 * The lock rings at world point `p`. Each lock sends a ring out through the crust and throws a
 * flash of light from where it struck. Returns { heat, tint, flash }: how hard the ring's front
 * is passing (scalar), the same in the ring's colour, and the strike's light at `p`.
 */
export const cdRings = (u, p) => {
    let heat = float(0.0);
    let tint = vec3(0.0);
    let flash = vec3(0.0);
    for (let i = 0; i < RING_SLOTS; i++) {
        const A = u.ringA[i];
        const C = u.ringC[i];
        const raw = u.time.sub(A.z);
        const age = max(raw, 0.0);
        const live = step(0.0, raw).mul(A.w);
        const radius = C.w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = cdBell(d.sub(radius).div(C.w.mul(1.5).add(1.1)));
        const env = exp(age.mul(-RING_FADE)).mul(live);
        heat = heat.add(shell.mul(env));
        tint = tint.add(C.rgb.mul(shell.mul(env)));
        const dp = p.sub(vec3(A.x, 0.9, A.y));
        const near = float(1.0).div(float(1.0).add(dot(dp, dp).div(C.w.mul(46.0))));
        flash = flash.add(C.rgb.mul(exp(age.div(-0.34)).mul(live).mul(near)));
    }
    return { heat, tint, flash };
};

/**
 * The clear waves at world point `p`. Returns vec4(colour · front, afterglow): the bright
 * leading fronts (one per cleared line) and the afterglow of everything the wave has passed.
 */
export const cdClear = (u, p) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    const far = clamp(length(p.xz.sub(u.heart)).div(CLEAR_REACH), 0.0, 1.0);
    const pass = float(CLEAR_TRAVEL).mul(pow(far, 1 / CLEAR_SHAPE));
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(cdBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(max(since, 0.0).div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
};

/** How brightly the chamber's air glows: the lake's own light, lifted by pressure and overdrive. */
export const cdGlowGain = (u) => u.power.mul(0.7).add(u.surge.mul(0.35)).add(1.0).mul(u.breath);

/**
 * The light of the fountains a clear stands along the fissure, at world point `p` on a surface
 * facing `N`: a line of fire across the lake. `u.curtain` is how much of it is standing.
 */
export const cdCurtain = (u, p, N) => {
    const to = vec3(0.0, float(7.0).sub(p.y), float(FISSURE_Z).sub(p.z));
    const d2 = dot(to, to);
    const L = to.div(max(d2.sqrt(), 1e-3));
    const along = float(1.0).sub(smoothstep(38.0, 72.0, abs(p.x)));
    return u.mid.mul(0.55).add(u.hot.mul(0.45)).mul(u.curtain).mul(along)
        .mul(float(330.0).div(d2.add(260.0)))
        .mul(max(dot(N, L).add(0.25), 0.0).div(1.25));
};

/**
 * The glow that hangs in the air along a direction, at height `y`: brightest low over the lake
 * and toward the great fall, smoke-dark under the roof. Every surface fades into it.
 */
export const cdHaze = (u, dir, y) => {
    // (Low and lit over the lava; overhead the air is smoke, and smoke is dark.)
    const low = exp(max(y, 0.0).mul(-1 / 11));
    const toFall = max(dot(dir, normalize(u.fallPos.sub(cameraPosition))), 0.0);
    const t2 = toFall.mul(toFall);
    const lobe = t2.mul(t2).mul(t2);
    const fall = u.mid.mul(lobe.mul(0.025).add(lobe.mul(lobe).mul(lobe).mul(0.09))).mul(u.fallGain);
    return u.haze.mul(low.mul(0.92).add(0.05)).add(u.rock.mul(0.25)).add(fall).mul(cdGlowGain(u));
};

/** Fraction of light lost between the camera and a point `dist` away at height `y`. */
export const cdFogAmount = (dist, y) => {
    // Smoke gathers under the roof.
    const thick = smoothstep(16.0, 44.0, y).mul(0.8).add(1.0);
    // (Clear close by, so the rock keeps its shape; thick across the chamber.)
    const k = dist.mul(1 / 250);
    return float(1.0).sub(exp(pow(k, 1.9).mul(thick).negate()));
};

/** How tall the luminous fume over the lava stands: its density falls as e^(−y / FUME_SCALE). */
export const FUME_SCALE = 2.4;
/** Extinction of the fume at the lake's surface, per metre. */
export const FUME_DENSITY = 0.0058;

/**
 * The fume that hangs over the lava, along the ray from the camera to world point `p` (`dist`
 * away): { t, glow } — how much of what lies behind it still shows, and the light the fume adds
 * (it glows with the lava under it). Its density is integrated along the ray in closed form, so a
 * look across the lake passes through metres of it and a look up at the roof through almost none.
 * It drifts in banks with the crust.
 */
export const cdFume = (u, p, dist) => {
    const y0 = max(cameraPosition.y, 0.0);
    const y1 = max(p.y, 0.0);
    const x = y1.sub(y0).div(FUME_SCALE);
    // ∫ e^(−y/s) along the ray = dist · e^(−y0/s) · (1 − e^(−x)) / x  (→ 1 − x/2 as x → 0).
    const small = abs(x).lessThan(0.01);
    const f = select(small, float(1.0).sub(x.mul(0.5)), float(1.0).sub(exp(x.negate())).div(select(small, float(1.0), x)));
    const path = dist.mul(exp(y0.div(-FUME_SCALE))).mul(f);
    const where = u.plateSpace(mix(cameraPosition.xz, p.xz, 0.55));
    const bank = u.noise(where.mul(1 / 61)).r.mul(0.7).add(u.noise(where.mul(1 / 17)).g.mul(0.3));
    const t = exp(path.mul(smoothstep(0.25, 0.75, bank).mul(1.3).add(0.35)).mul(-FUME_DENSITY));
    const glow = u.mid.mul(0.15).add(u.deep.mul(0.22)).mul(cdGlowGain(u)).mul(float(1.0).sub(t));
    return { t, glow };
};

/** Apply the atmosphere to a shaded colour at world point `p`. */
export const cdAtmosphere = (u, col, p) => {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const hazed = mix(col, cdHaze(u, dir, p.y), cdFogAmount(dist, p.y));
    const fume = cdFume(u, p, dist);
    return hazed.mul(fume.t).add(fume.glow);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function cdFxMaterial(name, { depthTest = true } = {}) {
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
 * A unit quad (xy in −0.5..0.5, uv 0..1), `segments` quads along y, for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 * @param {number} [segments=1]
 */
export function cdQuadGeometry(count, attributes = {}, segments = 1) {
    const geometry = new THREE.InstancedBufferGeometry();
    const positions = [];
    const uvs = [];
    const index = [];
    for (let j = 0; j <= segments; j++) {
        const v = j / segments;
        positions.push(-0.5, v - 0.5, 0, 0.5, v - 0.5, 0);
        uvs.push(0, v, 1, v);
        if (j < segments) {
            const a = j * 2;
            index.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** The mesh wrapper every part returns. */
export function cdPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

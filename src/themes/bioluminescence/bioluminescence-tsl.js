/**
 * Bioluminescence — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - pure helpers that are called more than once carry `setLayout`, so they are emitted ONCE as
 *    real shader functions; helpers that read uniforms stay inline (a laid-out function must not
 *    capture a uniform or a texture);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is ONE tileable half-float fBm texture baked on the CPU, hashes are hash-without-sine;
 *  - every surface shades itself (MeshBasicNodeMaterial, no scene lights). The grotto's light is
 *    its own flora: a short list of lamps (the big caps, the elder, the crystals) that the rock,
 *    the water and the MIST all evaluate, so a glow has a halo in the air that things in front of
 *    it cut into, and the pool's mirror gets the same picture from its second render;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    pow,
    sqrt,
    step,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    BIOLUM_PALETTES,
    CLEAR_AFTERGLOW,
    CLEAR_FRONT_GAP,
    CLEAR_FRONT_WIDTH,
    CLEAR_REACH,
    CLEAR_SHAPE,
    CLEAR_SLOTS,
    CLEAR_TRAVEL,
    ELDER,
    EMITTER_MAX,
    LOCK_SLOTS,
    NOISE_SIZE,
    RING_FADE,
    RING_REACH,
    RING_TAU,
    TERRAIN,
} from './bioluminescence-core.js';

export * from './bioluminescence-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const blHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'bl_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const blHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'bl_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1) */
export const blHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'bl_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const blLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const blMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const blBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** x², x⁴ as plain products (pow of a base a hair below zero is NaN, and NaN eats the bloom). */
export const blSq = (x) => x.mul(x);

// ── Textures ────────────────────────────────────────────────────────────────────

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (the water reads it
 * at grazing angles; generating half-float mips on the GPU is not portable to every WebGL2 device).
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
    tex.name = 'bioluminescence-noise';
    tex.needsUpdate = true;
    return tex;
}

/** The floor's heights (metres, water at 0) as a half-float texture the water reads for its depth. */
export function createHeightTexture(heights) {
    const data = new Uint16Array(TERRAIN.nx * TERRAIN.nz);
    for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    const tex = new THREE.DataTexture(data, TERRAIN.nx, TERRAIN.nz, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'bioluminescence-heights';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));

/**
 * Every uniform the grotto's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, heights: THREE.Texture }} textures
 * @param {{ lamps?: number, scatter?: number }} [opts]  how many lamps light surfaces / the mist
 */
export function createGrottoUniforms(textures, opts = {}) {
    const p = BIOLUM_PALETTES[0];
    /** Two rows a lamp: (position, radius), (colour × gain, _). */
    const lampRows = Array.from({ length: EMITTER_MAX * 2 }, () => new THREE.Vector4(0, -1000, 0, 1));
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** 0..1: how awake the grotto is (combo). */
        power: uniform(0),
        /** 0..1.3: the overdrive after the Great Bloom. */
        surge: uniform(0),
        /** Gain on every light in the grotto: a four-line clear holds its breath (→ 0.12). */
        breath: uniform(1),
        /** The grotto's slow pulse, 0..1: every living light swells with it. */
        pulse: uniform(0),
        // The palette (scene-linear), eased by the world between levels.
        primary: v3(p.primary),
        secondary: v3(p.secondary),
        accent: v3(p.accent),
        plankton: v3(p.plankton),
        worm: v3(p.worm),
        crystal: v3(p.crystal),
        vein: v3(p.vein),
        fogFar: v3(p.fogFar),
        fogLow: v3(p.fogLow),
        ambient: v3(p.ambient),
        /** How far the motes have been carried up (a chain lifts them faster). */
        moteLift: uniform(0),
        /** 0..1: how much of the vault's glow-worms are lit. */
        wake: uniform(0.35),
        /** 0..1: the fairy rings' growth (a sprout of rank r stands once this passes r). */
        sprout: uniform(0),
        /**
         * Upright screens are too narrow to see where the courts stand: this draws everything
         * that much nearer the middle of the pool (1 = where the plan put it).
         */
        squeeze: uniform(1),
        /** The Great Bloom: (birth time, strength). */
        shock: uniform(new THREE.Vector2(-100, 0)),
        /** A T-spin's turn of the air, 0..1. */
        swirl: uniform(0),
        /** 1 while any ring / any clear wave is still in the grotto (the loops are skipped at rest). */
        ringsLive: uniform(0),
        clearLive: uniform(0),
        /** Where on the water the latest clear started: (x, z). (The shaders read `clearH`.) */
        heart: uniform(new THREE.Vector2(0, -10)),
        /** Ring slots: (x, z, birth time, strength) + (colour, reach as a fraction of RING_REACH). */
        lockA: [],
        lockC: [],
        /** Clear slots: (birth time, fronts, strength, sunspore 0..1) + colour. */
        clearA: [],
        clearC: [],
        /** Where each clear's wave started on the water: (x, z). */
        clearH: [],
        /** The lamps. */
        lampRows,
        lamps: uniformArray(lampRows, 'vec4'),
        lampCount: Math.max(0, Math.min(EMITTER_MAX, opts.lamps ?? EMITTER_MAX)),
        scatterCount: Math.max(0, Math.min(EMITTER_MAX, opts.scatter ?? EMITTER_MAX)),
        noiseTex: textures.noise,
        heightTex: textures.heights,
    };
    for (let i = 0; i < LOCK_SLOTS; i++) {
        u.lockA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.lockC.push(uniform(new THREE.Vector4(1, 1, 1, 1)));
    }
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        u.clearA.push(uniform(new THREE.Vector4(-100, 1, 0, 0)));
        u.clearC.push(uniform(new THREE.Vector3(1, 1, 1)));
        u.clearH.push(uniform(new THREE.Vector2(0, -10)));
    }
    u.noise = (st) => texture(u.noiseTex, st);
    /** Floor height (metres) at a world xz; clamped at the plan's edge. */
    u.height = (xz) => {
        const st = vec2(
            xz.x.sub(TERRAIN.x0).div(TERRAIN.x1 - TERRAIN.x0),
            xz.y.sub(TERRAIN.z0).div(TERRAIN.z1 - TERRAIN.z0),
        );
        return texture(u.heightTex, st).r;
    };
    /** A family's colour (0 primary, 1 secondary, 2 accent) for a per-instance family index. */
    u.family = (f) => mix(mix(u.primary, u.secondary, step(0.5, f)), u.accent, step(1.5, f));
    return u;
}

// ── The grotto's light ──────────────────────────────────────────────────────────

/** The unit direction from the viewer toward the elder's glow (the far end of the cave). */
const FAR_DIR = (() => {
    const v = new THREE.Vector3(ELDER.x, ELDER.height * 0.55, ELDER.z).normalize();
    return [v.x, v.y, v.z];
})();

/**
 * The colour a direction ends in: the dark of the cave, the far chamber's glow down the pool and
 * the mist that lies on the water. Every material fades into it with distance, and the water and
 * the crystals mirror it.
 */
export const blFogColor = (u, dir) => {
    const toFar = max(dot(dir, vec3(FAR_DIR[0], FAR_DIR[1], FAR_DIR[2])), 0.0);
    const far2 = toFar.mul(toFar);
    const far = far2.mul(far2).mul(0.85).add(far2.mul(0.25));
    const low = exp(abs(dir.y).mul(-5.5));
    const lift = u.power.mul(0.25).add(u.surge.mul(0.3)).add(1.0);
    return u.fogFar.mul(far.add(0.16)).add(u.fogLow.mul(low).mul(0.6)).mul(lift)
        .mul(u.breath.mul(0.75).add(0.25));
};

/** Fraction of light lost between the camera and a point `dist` away at height `y`. */
export const blFogAmount = (dist, y) => {
    const air = float(1.0).sub(exp(dist.mul(-1 / 78)));
    // Mist lies on the water.
    const mist = float(1.0).sub(exp(dist.mul(-1 / 70))).mul(exp(max(y, 0.0).mul(-0.42))).mul(0.5);
    return float(1.0).sub(float(1.0).sub(air).mul(float(1.0).sub(mist)));
};

/**
 * Light of the lamps on a surface at `p` facing `N` (wrapped, so a boulder's far side still
 * takes a little). Returns summed colour (HDR), albedo not applied.
 */
export const blLamps = (u, p, N) => Fn(() => {
    const sum = vec3(0.0).toVar();
    Loop({
        start: 0, end: u.lampCount, type: 'int', condition: '<', name: 'lamp',
    }, ({ lamp }) => {
        const a = u.lamps.element(lamp.mul(2));
        const c = u.lamps.element(lamp.mul(2).add(1));
        const d = a.xyz.sub(p).toVar();
        const r2 = dot(d, d).add(a.w.mul(a.w)).toVar();
        const facing = dot(N, d).div(sqrt(r2));
        const wrap = clamp(facing.mul(0.72).add(0.28), 0.0, 1.0);
        sum.addAssign(c.rgb.mul(wrap.mul(wrap).div(r2)));
    });
    return sum;
})();

/**
 * Light the lamps scatter into the mist along a ray from `origin` (the camera unless given) to a
 * point `dist` away in direction `dir`: the closed-form integral of 1/(d² + r²) along the ray for each lamp,
 * so a glow has a halo and anything in front of it cuts the halo short.
 */
export const blScatter = (u, dir, dist, origin = cameraPosition) => Fn(() => {
    const sum = vec3(0.0).toVar();
    Loop({
        start: 0, end: u.scatterCount, type: 'int', condition: '<', name: 'glow',
    }, ({ glow }) => {
        const a = u.lamps.element(glow.mul(2));
        const c = u.lamps.element(glow.mul(2).add(1));
        const toLamp = a.xyz.sub(origin).toVar();
        const b = dot(toLamp, dir).toVar();
        const h = sqrt(max(dot(toLamp, toLamp).sub(b.mul(b)), 0.0).add(a.w.mul(a.w))).toVar();
        // (A halo is local: the damp air swallows what a lamp throws far.)
        const through = atan(dist.sub(b).div(h)).add(atan(b.div(h))).div(h).mul(exp(h.mul(-0.075)));
        sum.addAssign(c.rgb.mul(through));
    });
    return sum.mul(0.0012);
})();

/**
 * What a mirror at `p` shows of the lamps along its reflected ray `R`: each lamp as a soft disc
 * where the ray passes it. The low tiers' pool has no second render; this is its picture.
 */
export const blLampImage = (u, p, R) => Fn(() => {
    const sum = vec3(0.0).toVar();
    Loop({
        start: 0, end: u.lampCount, type: 'int', condition: '<', name: 'image',
    }, ({ image }) => {
        const a = u.lamps.element(image.mul(2));
        const c = u.lamps.element(image.mul(2).add(1));
        const toLamp = a.xyz.sub(p).toVar();
        const along = max(dot(toLamp, R), 0.0).toVar();
        const off2 = max(dot(toLamp, toLamp).sub(along.mul(along)), 0.0);
        const r2 = a.w.mul(a.w);
        sum.addAssign(c.rgb.mul(r2.div(off2.add(r2)).mul(r2.div(off2.add(r2)))).div(r2.mul(3.0).add(1.0)).mul(step(0.01, along)));
    });
    return sum;
})();

/** Apply the cave's air to a shaded colour at world point `p`. */
export const blAtmosphere = (u, col, p) => {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const dir = rel.div(max(dist, 1e-3));
    const f = blFogAmount(dist, p.y);
    const base = mix(col, blFogColor(u, dir), f);
    return u.scatterCount > 0 ? base.add(blScatter(u, dir, dist)) : base;
};

/**
 * Light of the lock rings at world point `p`: each lock sends a ring out over the pool from
 * under the board, and a smaller one from the foot of the mushroom its swimmer reaches.
 */
export const blLockLight = (u, p) => {
    let sum = vec3(0.0);
    for (let i = 0; i < LOCK_SLOTS; i++) {
        const A = u.lockA[i];
        const age = u.time.sub(A.z);
        const radius = u.lockC[i].w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
        const d = length(p.xz.sub(A.xy));
        const shell = blBell(d.sub(radius).div(u.lockC[i].w.mul(1.6).add(1.2)));
        const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
        sum = sum.add(u.lockC[i].rgb.mul(shell.mul(env)));
    }
    return sum;
};

/**
 * The clear waves at world point `p`. Returns vec4(colour · front, afterglow): the bright
 * leading fronts (one per cleared line) and the afterglow of everything the wave has passed.
 */
export const blClearLight = (u, p) => {
    let front = vec3(0.0);
    let glow = float(0.0);
    for (let i = 0; i < CLEAR_SLOTS; i++) {
        const A = u.clearA[i];
        const far = clamp(length(p.xz.sub(u.clearH[i])).div(CLEAR_REACH), 0.0, 1.0);
        const pass = float(CLEAR_TRAVEL).mul(pow(far, 1 / CLEAR_SHAPE));
        const since = u.time.sub(A.x).sub(pass);
        let f = float(0.0);
        for (let k = 0; k < 4; k++) {
            f = f.add(blBell(since.sub(k * CLEAR_FRONT_GAP).div(CLEAR_FRONT_WIDTH)).mul(step(k + 0.5, A.y)));
        }
        const live = step(0.0, since).mul(A.z);
        front = front.add(u.clearC[i].mul(f.mul(A.z)));
        glow = glow.add(exp(since.div(-CLEAR_AFTERGLOW)).mul(live));
    }
    return vec4(front, glow);
};

/** The grotto's heartbeat at a point: a swell that leaves the elder and crosses the cave. */
export const blPulseAt = (u, p) => {
    const d = length(p.xz.sub(vec2(ELDER.x, ELDER.z)));
    return u.pulse.sub(d.mul(0.011)).mul(Math.PI * 2).sin().mul(0.5)
        .add(0.5);
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function blFxMaterial(name, { depthTest = true } = {}) {
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
export function blQuadGeometry(count, attributes = {}) {
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
export function blPart(name, geometry, material, renderOrder = 0, reflected = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
}

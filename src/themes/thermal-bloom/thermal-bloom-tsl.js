/**
 * Thermal Bloom — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps and the WebGL2 leg):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - builders that read the uniform bag or a texture (tbViewRay, tbSky, tbAerial, …) are plain
 *    JavaScript inlined inside a material's Fn, never laid out;
 *  - no MaterialX noise, no 3D textures, no ShaderMaterial: noise is baked on the CPU into 2D
 *    DataTextures (thermal-bloom-bake.js) or hashed arithmetically;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and unbounded
 *    (HDR); the post stack owns the tone map;
 *  - ONE uniform bag `u`: the world writes `.value`, materials only read. Exactly one uniform
 *    array (the event table), so a stage stays far under its uniform-buffer budget; every other
 *    value is a plain uniform.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    select,
    smoothstep,
    sqrt,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';

import {
    COLORS,
    EVENT_ROWS,
    SEASONS,
    hexToLinear,
} from './thermal-bloom-core.js';

export * from './thermal-bloom-core.js';

// ── Laid-out pure helpers ───────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const tbHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'tb_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1) */
export const tbHash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.zyx.add(31.32)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'tb_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
export const tbRoundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'tb_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/** Rec.709 luminance. */
export const tbLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const tbMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * The mineral filmic: a hue-preserving shoulder on the max channel (identity below k = 0.5), so
 * the mats keep their colour; tuned so lit steam (about 1.1 in the scene) lands near 0.86 and
 * never at a flat 1.0. Only the brightest glints (a peak of 6 and more) whiten.
 */
export const tbFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(tbMax3(c), 1e-5);
    const k = float(0.5);
    const room = float(0.5); // the shoulder rises from k toward 1
    const shoulder = k.add(room.mul(float(1.0).sub(exp(peak.sub(k).div(room).mul(-1.15)))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(6.0, 40.0, peak).mul(0.7));
}).setLayout({ name: 'tb_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

/** Schlick's Fresnel, written as products (a pow of a hair below zero is NaN). */
export const tbSchlick = /* @__PURE__ */ Fn(([cosT, f0]) => {
    const x = float(1.0).sub(clamp(cosT, 0.0, 1.0));
    const x2 = x.mul(x);
    return f0.add(float(1.0).sub(f0).mul(x2.mul(x2).mul(x)));
}).setLayout({
    name: 'tb_schlick', type: 'float', inputs: [{ name: 'cosT', type: 'float' }, { name: 'f0', type: 'float' }],
});

/**
 * Henyey–Greenstein phase as a 0..1 mix weight: 1 looking straight at the sun. x·√x of
 * x = (1 − g)² / (1 + g² − 2g·c), on a clamped cosine (never a pow of a negative).
 */
export const tbHgMix = /* @__PURE__ */ Fn(([cIn, g]) => {
    const c = clamp(cIn, -1.0, 1.0);
    const one = float(1.0).sub(g);
    const x = one.mul(one).div(max(float(1.0).add(g.mul(g)).sub(g.mul(c).mul(2.0)), 1e-4));
    return x.mul(sqrt(x));
}).setLayout({
    name: 'tb_hgMix', type: 'float', inputs: [{ name: 'cIn', type: 'float' }, { name: 'g', type: 'float' }],
});

// ── The uniform bag ─────────────────────────────────────────────────────────────

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const lin = (hex) => {
    const c = hexToLinear(hex);
    return new THREE.Vector3(c[0], c[1], c[2]);
};

/**
 * Every uniform the scene's materials share, set for High Summer at rest. The world owns the
 * values; materials only read.
 */
export function createThermalBloomUniforms() {
    const season = SEASONS[0];
    const events = rows(EVENT_ROWS.total);
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel of the drawing buffer. */
        pixelAngle: uniform(0.0008),
        // The camera, for the full-screen backdrop (drawn without one).
        camPos: uniform(new THREE.Vector3(0, 44, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 0.951, -0.309)),
        camFwd: uniform(new THREE.Vector3(0, -0.309, -0.951)),
        tanHalf: uniform(new THREE.Vector2(0.755, 0.4245)),
        /** Unit vector toward the sun (L), and the sun's colour (linear, scene-referred). */
        sunDir: uniform(new THREE.Vector3(-0.73, 0.53, 0.42)),
        sunColor: uniform(lin(COLORS.sun)),
        // The season's air (eased by the world across a level-up).
        zenith: uniform(lin(season.zenith)),
        haze: uniform(lin(season.haze)),
        pearl: uniform(lin(COLORS.hazePearl)),
        rim: uniform(lin(season.rim)),
        meadow: uniform(lin(season.meadow)),
        plateau: uniform(lin(COLORS.plateau)),
        snow: uniform(season.snow),
        frost: uniform(season.frost),
        /** Aerial perspective: optical depth per metre of the basin's air. */
        airDensity: uniform(0.00011),
        /** The breath (0 warm/thin … 1 cold/thick) and the steam density it implies. */
        breath: uniform(0.5),
        steam: uniform(1),
        /** Wind: heading (unit xz) and speed (m/s). */
        windDir: uniform(new THREE.Vector2(1, 0)),
        windSpeed: uniform(2.5),
        /** The post's iris, inverted: event lights are raised by it so they read at any exposure. */
        iris: uniform(1),
        // Composition (world positions solved from the layout, metres).
        /** The Iris: centre (x, z) and the pool's radius. */
        irisCentre: uniform(new THREE.Vector2(-102, -196)),
        irisRadius: uniform(50),
        /** The direction the runoff fans out toward (unit xz: toward the camera, turned to the Iris's outer side). */
        downhill: uniform(new THREE.Vector2(-0.17, 0.98)),
        /** The combo's gauges: the eye's widening (a fraction) and the fingers' reach (× the rest reach). */
        heat: uniform(0),
        reach: uniform(1),
        /** The succession front: the season rows it sweeps from and to, and its radius (metres). */
        seasonFrom: uniform(0),
        seasonTo: uniform(0),
        frontRadius: uniform(1e6),
        /** The Chalice's vent (x, y, z). */
        chalice: uniform(new THREE.Vector3(147, 6, -255)),
        /** The live events (blocks at EVENT_ROWS); live rows compacted at the front of each block. */
        tables: { events },
        events: uniformArray(events, 'vec4'),
        bloomCount: uniform(0, 'int'),
        fillCount: uniform(0, 'int'),
        jetCount: uniform(0, 'int'),
        eruptionCount: uniform(0, 'int'),
        boilCount: uniform(0, 'int'),
        devilCount: uniform(0, 'int'),
        rosetteCount: uniform(0, 'int'),
        plumeCount: uniform(0, 'int'),
    };
    return u;
}

// ── Inline builders (they read the bag) ─────────────────────────────────────────

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const tbViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

/**
 * The sky along a direction: a high, clean cerulean that pales through the season's haze to a
 * warm pearl at the horizon; a touch brighter toward the sun (which is behind the camera, never
 * in frame), and the brighter band of a clear sky low on the antisolar side kept faint.
 */
export function tbSky(u, dir) {
    const up = clamp(dir.y, 0.0, 1.0);
    // The haze lives in the last few degrees above the rim; above it, a clean cerulean that
    // deepens slowly toward the zenith.
    const band = smoothstep(0.0, 0.075, up);
    const high = smoothstep(0.075, 0.6, up);
    const base = mix(mix(u.haze, u.zenith.mul(1.15), band), u.zenith.mul(0.8), high);
    const sunward = dot(dir, u.sunDir);
    const glow = tbHgMix(sunward, float(0.62)).mul(0.25);
    return base.add(u.sunColor.mul(glow));
}

/**
 * Aerial perspective: a colour seen through `dist` metres of the basin's air along `dir`,
 * scattered toward the warm pearl (lit) haze, never toward blue air. Bounded exponent.
 */
export function tbAerial(u, col, dist, dir) {
    const tau = min(max(dist, 0.0).mul(u.airDensity), 12.0);
    const T = exp(tau.negate());
    const sunward = dot(dir, u.sunDir);
    const inscatter = mix(u.pearl, u.haze, 0.35).add(u.sunColor.mul(tbHgMix(sunward, float(0.5)).mul(0.08)));
    return col.mul(T).add(inscatter.mul(float(1.0).sub(T)));
}

// ── Materials, geometry and textures ────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes.
 * Nothing here writes depth; `depthTest` lets the ground hide what is behind it.
 */
export function tbFxMaterial(name, { depthTest = true, side = THREE.DoubleSide } = {}) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
        side,
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

/** The mesh wrapper every part returns. */
export function tbPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/**
 * Box-filtered mips of an RGBA8 or R8 square bake, down to 1×1 (generating mips on the GPU is not
 * portable to every WebGL2 device for every format, and a CPU chain is the same on both).
 * @param {Uint8Array} data  size × size × channels
 * @returns {{ data: Uint8Array, width: number, height: number }[]}  level 0 first
 */
export function buildMips(data, size, channels = 4) {
    const levels = [{ data, width: size, height: size }];
    let level = data;
    let w = size;
    while (w > 1) {
        const nw = w >> 1;
        const next = new Uint8Array(nw * nw * channels);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * channels;
                const b = a + channels;
                const c = a + w * channels;
                const d = c + channels;
                const o = (y * nw + x) * channels;
                for (let k = 0; k < channels; k++) {
                    next[o + k] = (level[a + k] + level[b + k] + level[c + k] + level[d + k] + 2) >> 2;
                }
            }
        }
        levels.push({ data: next, width: nw, height: nw });
        level = next;
        w = nw;
    }
    return levels;
}

/**
 * A 2D DataTexture over a CPU bake (never a file). `filter` 'nearest' (ids), 'linear' or
 * 'mipmap' (with a CPU chain); `wrap` 'repeat' or 'clamp'; `channels` 4 (RGBA8) or 1 (R8).
 * The same typed array may back two textures (a layout's nearest and linear views).
 */
export function createThermalBloomTexture(data, width, height, {
    name = 'thermal-bloom-bake', filter = 'linear', wrap = 'repeat', channels = 4, mipmaps = null,
} = {}) {
    const format = channels === 1 ? THREE.RedFormat : THREE.RGBAFormat;
    const tex = new THREE.DataTexture(data, width, height, format, THREE.UnsignedByteType);
    const wrapMode = wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.wrapS = wrapMode;
    tex.wrapT = wrapMode;
    if (filter === 'nearest') {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
    } else if (filter === 'mipmap') {
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.mipmaps = mipmaps || buildMips(data, width, channels);
    } else {
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
    }
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.unpackAlignment = 1;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

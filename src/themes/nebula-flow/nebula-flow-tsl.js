/**
 * Nebula Flow — shared TSL: the uniforms every part reads, the baked textures and small helpers.
 *
 * One set of uniforms (createNebulaUniforms) is the scene's state on the GPU: the stage (aspect,
 * pillars, the cluster), the palette, the flow, and the small tables the gameplay writes (births,
 * fronts). Parts never keep copies: the world writes, the materials read.
 *
 * Rules (from the fleet's perf sweeps):
 *  - no `mx_noise_*` anywhere: noise is baked on the CPU (nebula-flow-core.js), hashes are
 *    hash-without-sine;
 *  - helpers with `setLayout` are pure (no uniforms, no textures captured), so they are emitted
 *    once as real shader functions;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    pow,
    smoothstep,
    step,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    BIRTH_FADE,
    BIRTH_LIFE,
    BIRTH_ROWS,
    BIRTH_SLOTS,
    FRONT_ROWS,
    LANTERN_ROWS,
    FRONT_SLOTS,
    HOLE_OPEN,
    IGNITE_FLASH,
    NEBULA_PALETTES,
    NOISE_SIZE,
    PALETTE_HOME,
    PALETTE_KEYS,
    PILLAR_ROWS,
    PILLAR_SLOTS,
    RELEASE_FADE,
    VORTEX_ARMS,
    bakeNoise,
    bakeRelief,
    buildMips,
} from './nebula-flow-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const nfHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'nf_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const nfHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'nf_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const nfHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'nf_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** Smooth minimum (polynomial), k in distance units. */
export const nfSmin = /* @__PURE__ */ Fn(([a, b, k]) => {
    const h = max(k.sub(abs(a.sub(b))), 0).div(k);
    return min(a, b).sub(h.mul(h).mul(k).mul(0.25));
}).setLayout({
    name: 'nf_smin',
    type: 'float',
    inputs: [{ name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'k', type: 'float' }],
});

/**
 * Exact signed distance to a 2D tapered capsule (iq's uneven capsule): circles of radius r1 at
 * the origin and r2 at (0, h), joined by their common tangents. `p` in the capsule's own frame;
 * b = (r1 − r2) / h and a = √(1 − b²), per capsule rather than per pixel (packPillars).
 */
export const nfTaper = /* @__PURE__ */ Fn(([pIn, r1, r2, h, a, b]) => {
    const p = vec2(abs(pIn.x), pIn.y).toVar();
    const k = dot(p, vec2(b.negate(), a));
    const res = dot(p, vec2(a, b)).sub(r1).toVar();
    If(k.lessThan(0), () => { res.assign(length(p).sub(r1)); });
    If(k.greaterThan(a.mul(h)), () => { res.assign(length(p.sub(vec2(0, h))).sub(r2)); });
    return res;
}).setLayout({
    name: 'nf_taper',
    type: 'float',
    inputs: [
        { name: 'pIn', type: 'vec2' }, { name: 'r1', type: 'float' }, { name: 'r2', type: 'float' },
        { name: 'h', type: 'float' }, { name: 'a', type: 'float' }, { name: 'b', type: 'float' },
    ],
});

/** Distance from p to the segment a→b, and where along it (0..1) the nearest point lies. */
export const nfSegment = /* @__PURE__ */ Fn(([p, a, b]) => {
    const ab = b.sub(a);
    const t = dot(p.sub(a), ab).div(max(dot(ab, ab), 1e-6)).clamp(0, 1);
    return vec2(length(p.sub(a.add(ab.mul(t)))), t);
}).setLayout({
    name: 'nf_segment',
    type: 'vec2',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'a', type: 'vec2' }, { name: 'b', type: 'vec2' }],
});

// ── Small maths ─────────────────────────────────────────────────────────────────

export const nfLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const nfMax3 = (c) => max(c.x, max(c.y, c.z));
/** e^(−x²). */
export const nfGauss = (x) => exp(x.mul(x).negate());

/** A hue round the colour wheel (0..1) as a saturated linear colour. */
export const nfHue = (h) => {
    const k = vec3(0, 2 / 3, 1 / 3).add(h);
    const c = abs(fract(k).mul(6).sub(3)).sub(1).clamp(0, 1);
    return c.mul(c);
};

// ── The textures ────────────────────────────────────────────────────────────────

/**
 * A baked field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createNoiseTexture(field = bakeNoise(), size = NOISE_SIZE, name = 'nebula-flow-noise') {
    const mipmaps = buildMips(field, size).map(({ data, width, height }) => {
        const half = new Uint16Array(data.length);
        for (let i = 0; i < data.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
        return { data: half, width, height };
    });
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

/** The relief (height, its exact gradient, a second height) as a texture: bakeRelief(). */
export function createReliefTexture(field = bakeRelief(), size = NOISE_SIZE) {
    return createNoiseTexture(field, size, 'nebula-flow-relief');
}

// ── The scene's state ────────────────────────────────────────────────────────────

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (rgb) => uniform(new THREE.Vector3(rgb[0], rgb[1], rgb[2]));

export function createNebulaUniforms() {
    const home = NEBULA_PALETTES[PALETTE_HOME];
    const tables = {
        pillars: rows(PILLAR_SLOTS * PILLAR_ROWS),
        births: rows(BIRTH_SLOTS * BIRTH_ROWS),
        fronts: rows(FRONT_SLOTS * FRONT_ROWS),
        lanterns: rows(BIRTH_SLOTS * LANTERN_ROWS),
    };
    for (let i = 0; i < BIRTH_SLOTS; i += 1) {
        // dormant: ignition far in the past, power 0, never released
        tables.births[i * BIRTH_ROWS].set(0, -10, -1e5, 0);
        tables.births[i * BIRTH_ROWS + 2].set(0, -1, 1, 0);
    }
    const u = {
        tables,
        pillars: uniformArray(tables.pillars, 'vec4'),
        births: uniformArray(tables.births, 'vec4'),
        fronts: uniformArray(tables.fronts, 'vec4'),
        frontCount: uniform(0, 'int'),
        lanterns: uniformArray(tables.lanterns, 'vec4'),
        lanternCount: uniform(0, 'int'),

        time: uniform(0),
        /** Screen width over height; the frame spans [−aspect, aspect] × [−1, 1]. */
        aspect: uniform(16 / 9),
        /** Drawing-buffer pixels. */
        viewport: uniform(new THREE.Vector2(1280, 720)),
        /** Nursery units per buffer pixel, and per pixel of a 1080-line frame. */
        texel: uniform(2 / 720),
        design: uniform(2 / 1080),
        /** The frame's view of nursery space: (centre x, centre y, half-height); (0, 0, 1) = the screen. */
        view: uniform(new THREE.Vector3(0, 0, 1)),
        /** The parallax offset of the nearest layer (pointer and sway). */
        cam: uniform(new THREE.Vector2(0, 0)),
        cluster: uniform(new THREE.Vector2(0.12, 1.75)),
        /** How far the gas has flowed (integrated, in cycles of the flow map). */
        flow: uniform(0),
        /** The cluster's light (1 at rest; a clear and a chain raise it). */
        shine: uniform(1),
        /** How hot the pillars' lit rims burn (1 at rest; the heat of play raises it). */
        burn: uniform(1),
        /** How much of the cluster's light keeps its place while the vortex winds the gas (0..1). */
        lightHold: uniform(0),
        /** The vortex: (centre x, centre y, turn at the heart in radians, radius). */
        vortex: uniform(new THREE.Vector4(0, 0, 0, 0.9)),
        /**
         * The vortex's arms, one per quarter turn about its heart (in the wound gas, so they spiral):
         * the colours of the chain's last VORTEX_ARMS steps.
         */
        vortexArms: Array.from({ length: VORTEX_ARMS }, () => uniform(new THREE.Vector3(1, 1, 1))),
        /** The arms' turn about the heart: (cos, sin). */
        vortexSpin: uniform(new THREE.Vector2(1, 0)),
        /** How strongly the vortex glows in its tint (0..1). */
        vortexGlow: uniform(0),
        /** A T-spin's twist of the whole flow (radians at the board). */
        twist: uniform(0),
        /** The great star's dust hole: (x, y, radius, healing 0..1). */
        hole: uniform(new THREE.Vector4(0, -10, 0, 0)),
        /** The hush before the great star (0..1: everything sinks). */
        hush: uniform(0),
        /** 1 / exposure ^ 0.8: event lights multiply by it so they read while the iris closes. */
        iris: uniform(1),
        prism: uniform(home.prism),
    };
    PALETTE_KEYS.forEach((key) => {
        u[key] = colour(home[key]);
    });
    return u;
}

/** Copy a palette (paletteAt's output) into the uniforms. */
export function writePalette(u, pal) {
    PALETTE_KEYS.forEach((key) => {
        const c = pal[key];
        u[key].value.set(c[0], c[1], c[2]);
    });
    u.prism.value = pal.prism ?? 0;
}

/** A nursery-space point → clip space through the frame's view. */
export const nfClip = (u, p) => {
    const q = p.sub(u.view.xy).div(u.view.z);
    return vec4(q.x.div(u.aspect), q.y, 0, 1);
};

/** A part: one mesh that is always drawn (dormant instances are zero-sized). */
export function nfPart(name, geometry, material, renderOrder) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `NebulaFlow.${name}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A unit quad (−1..1) as an instanced geometry with `count` instances. */
export function nfQuadGeometry(count, attributes = {}) {
    const base = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    Object.entries(attributes).forEach(([name, { array, size }]) => {
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
    });
    geometry.instanceCount = count;
    return geometry;
}

/**
 * An additive material that adds light and leaves the target's alpha alone (premultiplied
 * blending; the part's outputNode returns `vec4(rgb, 0)`).
 */
export function nfLightMaterial() {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    return material;
}

// ── Births, jets and fronts in closed form (GPU twins of nebula-flow-core.js) ─────

/**
 * A birth's light `age` seconds after ignition: the flash, then a held glow that a clear's
 * release (`released` ≥ 0, in seconds after ignition) first brightens and then lets fade. An
 * ambient star (kind 3) never burns out. Twin of birthLight() in nebula-flow-core.js.
 */
export const nfBirthLight = /* @__PURE__ */ Fn(([age, released, kind]) => {
    const out = float(0).toVar();
    If(age.greaterThanEqual(0), () => {
        const flash = exp(age.div(IGNITE_FLASH).negate()).mul(3.5);
        const held = smoothstep(0, 0.25, age).toVar();
        If(released.greaterThanEqual(0).and(age.greaterThanEqual(released)), () => {
            const since = age.sub(released);
            held.mulAssign(float(1).add(exp(since.div(0.8).negate()).mul(2.2))
                .mul(float(1).sub(smoothstep(RELEASE_FADE * 0.3, RELEASE_FADE, since))));
        }).ElseIf(kind.lessThan(2.5), () => {
            held.mulAssign(float(1).sub(smoothstep(BIRTH_LIFE, BIRTH_LIFE + BIRTH_FADE, age)));
        });
        out.assign(held.add(flash));
    });
    return out;
}).setLayout({
    name: 'nf_birthLight',
    type: 'float',
    inputs: [{ name: 'age', type: 'float' }, { name: 'released', type: 'float' }, { name: 'kind', type: 'float' }],
});

/** The radius the dust has boiled back round a released star (twin of holeRadius()). */
export const nfHoleRadius = (since, size) => float(0.075).mul(size)
    .mul(pow(smoothstep(0, HOLE_OPEN, since), 0.7))
    .mul(float(1).sub(smoothstep(RELEASE_FADE * 0.5, RELEASE_FADE, since)))
    .mul(step(0, since));

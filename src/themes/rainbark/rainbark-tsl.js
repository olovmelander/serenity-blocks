/**
 * Rainbark — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps and the WebGL2 leg):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - builders that read the uniform bag or a texture (rbViewRay, rbAir, …) are plain JavaScript
 *    inlined inside a material's Fn, never laid out;
 *  - no MaterialX noise, no 3D textures, no ShaderMaterial: noise is baked on the CPU into 2D
 *    DataTextures (rainbark-bake.js) or hashed arithmetically;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and unbounded
 *    (HDR); the post stack owns the tone map;
 *  - ONE uniform bag `u`: the world writes `.value`, materials only read. Exactly two uniform
 *    arrays (the palette and the event table), so a stage stays far under its uniform-buffer
 *    budget; every other value is a plain uniform.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cross,
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
    CANOPY_Y,
    EVENT_ROWS,
    PALETTE_ROWS,
    PIECE_AGE,
    ZONES,
    ZONE_COLOR_KEYS,
    climbHeight,
    hexToLinear,
    rampAt,
    sunDirection,
    tideAt,
} from './rainbark-core.js';

export * from './rainbark-core.js';

// ── Laid-out pure helpers ───────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const rbHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'rb_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec3 → [0,1) */
export const rbHash31 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.zyx.add(31.32)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'rb_hash31', type: 'float', inputs: [{ name: 'pIn', type: 'vec3' }] });

/** v rotated by the unit quaternion q (xyz, w). */
export const rbQuatRotate = /* @__PURE__ */ Fn(([q, v]) => {
    const t = cross(q.xyz, v).mul(2.0);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}).setLayout({
    name: 'rb_quatRotate', type: 'vec3', inputs: [{ name: 'q', type: 'vec4' }, { name: 'v', type: 'vec3' }],
});

/** Rounded-box signed distance in pixels. rect = (x0, y0, x1, y1) in pixels (top-left origin). */
export const rbRoundBoxSdf = /* @__PURE__ */ Fn(([p, rect, radius]) => {
    const c = rect.xy.add(rect.zw).mul(0.5);
    const h = rect.zw.sub(rect.xy).mul(0.5);
    const q = abs(p.sub(c)).sub(h).add(radius);
    return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(radius);
}).setLayout({
    name: 'rb_roundBoxSdf',
    type: 'float',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'rect', type: 'vec4' }, { name: 'radius', type: 'float' }],
});

/** Rec.709 luminance. */
export const rbLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const rbMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * The house filmic: a hue-preserving shoulder on the max channel (identity below k = 0.48), then
 * a path to white for the brightest values only (from a peak of 4), so the bark keeps its colour
 * and only the sun's own glints burn clean.
 */
export const rbFilmic = /* @__PURE__ */ Fn(([cIn]) => {
    const c = max(cIn, vec3(0.0));
    const peak = max(rbMax3(c), 1e-5);
    const k = float(0.48);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(4.0, 30.0, peak).mul(0.7));
}).setLayout({ name: 'rb_filmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

/** Schlick's Fresnel, written as products (a pow of a hair below zero is NaN). */
export const rbSchlick = /* @__PURE__ */ Fn(([cosT, f0]) => {
    const x = float(1.0).sub(clamp(cosT, 0.0, 1.0));
    const x2 = x.mul(x);
    return f0.add(float(1.0).sub(f0).mul(x2.mul(x2).mul(x)));
}).setLayout({
    name: 'rb_schlick', type: 'float', inputs: [{ name: 'cosT', type: 'float' }, { name: 'f0', type: 'float' }],
});

/**
 * Henyey–Greenstein forward scatter as a 0..1 mix weight: 1 looking straight at the sun, about
 * 0.025 looking away (g = 0.55). x·√x of x = (1 − g)² / (1 + g² − 2g·c); the cosine is clamped.
 */
export const rbHgMix = /* @__PURE__ */ Fn(([cIn, g]) => {
    const c = clamp(cIn, -1.0, 1.0);
    const one = float(1.0).sub(g);
    const x = one.mul(one).div(float(1.0).add(g.mul(g)).sub(g.mul(c).mul(2.0)));
    return x.mul(sqrt(x));
}).setLayout({
    name: 'rb_hgMix', type: 'float', inputs: [{ name: 'cIn', type: 'float' }, { name: 'g', type: 'float' }],
});

// ── The uniform bag ─────────────────────────────────────────────────────────────

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));

/** Write a zone's colour set (sRGB hexes) into the palette rows, as linear rgb. */
export function writeZoneColors(table, colors) {
    const rgb = [0, 0, 0];
    ZONE_COLOR_KEYS.forEach((key) => {
        hexToLinear(colors[key], rgb);
        table[PALETTE_ROWS[key]].set(rgb[0], rgb[1], rgb[2], 1);
    });
}

/**
 * Every uniform the scene's materials share, set for the Bole zone on level 4. The world owns
 * the values; materials only read.
 */
export function createRainbarkUniforms() {
    const zone = ZONES[1];
    const palette = rows(PALETTE_ROWS.total);
    const events = rows(EVENT_ROWS.total);
    writeZoneColors(palette, zone.colors);
    const rgb = [0, 0, 0];
    // The group means start as old bark; the piece-age rows hold the bark at each piece's age.
    rampAt(0.86, rgb);
    for (let g = 0; g < 4; g++) palette[PALETTE_ROWS.groupMean + g].set(rgb[0], rgb[1], rgb[2], 0.86);
    PIECE_AGE.forEach((age, code) => {
        rampAt(age, rgb);
        palette[PALETTE_ROWS.pieceAge + code].set(rgb[0], rgb[1], rgb[2], age);
    });
    const sun = sunDirection(zone.sunElevation);
    const camY = climbHeight(4);
    const tables = { palette, events };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel of the drawing buffer. */
        pixelAngle: uniform(0.0008),
        // The camera, for the full-screen backdrop (drawn without one).
        camPos: uniform(new THREE.Vector3(0, camY, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.83, 0.47)),
        /** Unit vector toward the sun (L). */
        sunDir: uniform(new THREE.Vector3(sun[0], sun[1], sun[2])),
        /** The walkway's height and the mist floor's top (metres). */
        camY: uniform(camY),
        tide: uniform(tideAt(0, zone)),
        /** The canopy plane (metres). */
        canopyY: uniform(CANOPY_Y),
        /** The air: σA at the tide top, its scale height, and σM inside the mist. */
        sigmaA: uniform(zone.sigmaA),
        scaleHeight: uniform(zone.scaleHeight),
        sigmaM: uniform(zone.sigmaM),
        /** The post's iris, inverted: event lights are raised by it so they read at any exposure. */
        iris: uniform(1),
        tables,
        /** Zone colours, group means and piece-age rows (PALETTE_ROWS). */
        palette: uniformArray(palette, 'vec4'),
        /** Peels, girdles, helices, knocks, gaps and the moult (EVENT_ROWS); live rows compacted. */
        events: uniformArray(events, 'vec4'),
        peelCount: uniform(0, 'int'),
        girdleCount: uniform(0, 'int'),
        helixCount: uniform(0, 'int'),
        knockCount: uniform(0, 'int'),
        gapCount: uniform(0, 'int'),
    };
    /** The zone colours by name, as nodes (linear rgb). */
    u.col = Object.fromEntries(ZONE_COLOR_KEYS.map((key) => [key, u.palette.element(PALETTE_ROWS[key]).xyz]));
    return u;
}

// ── Inline builders (they read the bag) ─────────────────────────────────────────

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const rbViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

/**
 * The light the air scatters toward the eye along a direction: blue-violet shade, warming to
 * sunlit vapour toward the sun (forward scatter), and the mist's warm glow on rays that look down.
 */
export function rbInscatter(u, dir) {
    const toward = rbHgMix(dot(dir, u.sunDir), float(0.55));
    const down = float(1.0).sub(smoothstep(-0.45, 0.0, dir.y));
    return mix(u.col.hazeShade, u.col.hazeSun, toward).add(u.col.underglow.mul(down.mul(0.35)));
}

/**
 * Transmittance of the air from the camera to a point: closed form through the height-falling
 * haze (σA·exp(−(y − tide)/Hs)), plus the mist below the tide. Every exponent is bounded.
 */
export function rbAirTransmittance(u, P) {
    const V = P.sub(u.camPos).toVar();
    const d = max(length(V), 1e-4).toVar();
    const Vy = V.y.div(d).toVar();
    const Hs = u.scaleHeight;
    const a0 = clamp(u.camY.sub(u.tide).div(Hs), -8.0, 40.0);
    const a1 = clamp(P.y.sub(u.tide).div(Hs), -8.0, 40.0);
    const e0 = exp(max(a0, 0.0).negate()).toVar();
    const e1 = exp(max(a1, 0.0).negate()).toVar();
    // A ray that barely climbs: the haze at the camera's height over the whole distance.
    const level = u.sigmaA.mul(e0).mul(d);
    const VyS = select(Vy.lessThan(0.0), min(Vy, -1e-3), max(Vy, 1e-3)).toVar();
    const slanted = u.sigmaA.mul(Hs).mul(e0.sub(e1)).div(VyS);
    const tauA = select(abs(Vy).greaterThan(1e-3), slanted, level);
    const below = u.tide.sub(2.0).sub(min(u.camY, P.y)).div(abs(P.y.sub(u.camY)).add(1e-3));
    const tau = tauA.add(u.sigmaM.mul(d).mul(clamp(below, 0.0, 1.0)));
    return exp(min(max(tau, 0.0), 30.0).negate());
}

/** A colour seen through the air from the camera to the point P (§4.4). */
export function rbAir(u, col, P) {
    const T = rbAirTransmittance(u, P).toVar();
    const dir = P.sub(u.camPos).normalize();
    return col.mul(T).add(rbInscatter(u, dir).mul(float(1.0).sub(T)));
}

// ── Materials, geometry and textures ────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes.
 * Nothing here writes depth; `depthTest` lets the trunks hide what is behind them.
 */
export function rbFxMaterial(name, { depthTest = true, side = THREE.DoubleSide } = {}) {
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
export function rbPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A full-screen pass material for a QuadMesh (no depth). */
export function rbPassMaterial(name, node) {
    const material = new THREE.NodeMaterial();
    material.name = name;
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = node;
    return material;
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
 * The same typed array may back two textures (the patch atlas's nearest and linear views).
 */
export function createRainbarkTexture(data, width, height, {
    name = 'rainbark-bake', filter = 'linear', wrap = 'repeat', channels = 4, mipmaps = null,
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

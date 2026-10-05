/**
 * Chiral Gold — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): noise
 *    is one tileable texture baked on the CPU, hashes are hash-without-sine;
 *  - the gold is a real metal (MeshStandardNodeMaterial, metalness 1) and the only light in the
 *    hall is the studio it reflects: an HDR environment baked on the CPU (softboxes, strip lights,
 *    a scatter of pin lights) and prefiltered once. No scene lights, no shadows;
 *  - everything is scene-linear and unbounded (HDR): the post stack owns the tone map.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraProjectionMatrix,
    cameraViewMatrix,
    dot,
    float,
    fract,
    max,
    texture,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

import {
    ALLOYS,
    COMET_SLOTS,
    PULSE_SLOTS,
    RIPPLE_SLOTS,
    TAU,
    mulberry32,
} from './chiral-gold-core.js';

export * from './chiral-gold-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const cgHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'cg_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const cgHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'cg_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const cgLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const cgMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const cgBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

/** World position → clip space, for parts that place their own vertices. */
export const cgClip = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── The noise texture ───────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * A tileable RGBA texture: four decorrelated channels of periodic gradient noise (four octaves),
 * stretched to [0, 1]. Baked once; the brushing of the gold, the swell of the water and the
 * streaks in the light are all fetches of it.
 */
export function createNoiseTexture(seed = 7919, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const data = new Uint8Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 4; o++) {
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
        const inv = 255 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) data[i * 4 + c] = Math.round((field[i] - lo) * inv);
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'chiral-gold-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The studio ──────────────────────────────────────────────────────────────────

/**
 * The lights the gold reflects. Polished metal shows nothing but its surroundings, so the hall is
 * lit the way a goldsmith's bench is photographed: large soft boxes for the broad faces, tall
 * strip lights for the long running highlights, rim lights behind, dark flags between them (the
 * contrast is what reads as metal), a warm bounce from the water, and a scatter of pin lights
 * that crawl over the ribbons as they turn.
 *
 * `az` is measured from +Z (toward the camera) round to +X, `el` up from the horizon, both in
 * degrees; `w`/`h` are half-extents in degrees; `rgb` is scene-linear radiance.
 */
export const STUDIO_LIGHTS = Object.freeze([
    {
        az: -38, el: 34, w: 28, h: 18, rgb: [5.4, 5.0, 4.4],
    }, // key
    {
        az: 52, el: 12, w: 15, h: 24, rgb: [1.3, 1.15, 0.95],
    }, // fill
    {
        az: -96, el: 18, w: 2.6, h: 50, rgb: [13, 12, 10.6],
    }, // strip, left
    {
        az: 102, el: 22, w: 2.2, h: 46, rgb: [11, 10.1, 8.8],
    }, // strip, right
    {
        az: 0, el: 88, w: 20, h: 20, rgb: [2.6, 2.35, 1.95],
    }, // overhead
    {
        az: -152, el: 26, w: 5, h: 18, rgb: [7, 6.6, 6.0],
    }, // rim, left
    {
        az: 148, el: 30, w: 5, h: 16, rgb: [6, 5.6, 5.0],
    }, // rim, right
    {
        az: 4, el: -16, w: 64, h: 3.5, rgb: [1.1, 0.55, 0.18],
    }, // the water's bounce
    {
        az: 178, el: 4, w: 40, h: 1.6, rgb: [1.4, 0.95, 0.5],
    }, // a line of light on the far horizon
]);

/**
 * Bake the studio into an equirectangular HDR texture (half floats).
 * @param {number} [width=1024]  twice the height; the prefilter's cube faces are width / 4
 */
export function createStudioEquirect(width = 1024, seed = 4242) {
    const W = width;
    const H = width >> 1;
    const rgb = new Float32Array(W * H * 3);
    const lights = STUDIO_LIGHTS.map((l) => {
        const az = (l.az * Math.PI) / 180;
        const el = (l.el * Math.PI) / 180;
        const fx = Math.sin(az) * Math.cos(el);
        const fy = Math.sin(el);
        const fz = Math.cos(az) * Math.cos(el);
        // Right = up × forward (or Z × forward when the light looks straight down).
        const steep = Math.abs(fy) > 0.98;
        const ux = 0;
        const uy = steep ? 0 : 1;
        const uz = steep ? 1 : 0;
        let rx = uy * fz - uz * fy;
        let ry = uz * fx - ux * fz;
        let rz = ux * fy - uy * fx;
        const rl = Math.hypot(rx, ry, rz) || 1;
        rx /= rl;
        ry /= rl;
        rz /= rl;
        return {
            f: [fx, fy, fz],
            r: [rx, ry, rz],
            u: [fy * rz - fz * ry, fz * rx - fx * rz, fx * ry - fy * rx],
            tw: Math.tan((l.w * Math.PI) / 180),
            th: Math.tan((l.h * Math.PI) / 180),
            rgb: l.rgb,
        };
    });
    const edge = (q) => {
        // A softbox: flat across its face, a short soft edge.
        const t = Math.min(1, Math.max(0, (Math.abs(q) - 0.72) / 0.28));
        return 1 - t * t * (3 - 2 * t);
    };
    for (let j = 0; j < H; j++) {
        const lat = ((j + 0.5) / H - 0.5) * Math.PI;
        const cl = Math.cos(lat);
        const dy = Math.sin(lat);
        // A dark room: a breath of warm air above the horizon, the water's amber below it.
        const baseUp = Math.max(0, dy);
        const baseDown = Math.max(0, -dy);
        const br = 0.011 + baseDown * 0.03 + (1 - baseUp) * 0.004;
        const bg = 0.009 + baseDown * 0.014 + (1 - baseUp) * 0.003;
        const bb = 0.008 + baseDown * 0.004 + (1 - baseUp) * 0.002;
        // The room behind the camera is not quite black: a face turned to the lens holds a little bronze.
        const room = Math.max(0, 1 - Math.abs(dy - 0.15) * 1.6);
        for (let i = 0; i < W; i++) {
            const lon = ((i + 0.5) / W - 0.5) * TAU;
            const dx = cl * Math.cos(lon);
            const dz = cl * Math.sin(lon);
            const front = Math.max(0, dz) * room;
            let r = br + front * 0.26;
            let g = bg + front * 0.2;
            let b = bb + front * 0.14;
            for (let k = 0; k < lights.length; k++) {
                const L = lights[k];
                const d = dx * L.f[0] + dy * L.f[1] + dz * L.f[2];
                if (d <= 0.05) continue;
                const tx = (dx * L.r[0] + dy * L.r[1] + dz * L.r[2]) / d;
                if (Math.abs(tx) >= L.tw) continue;
                const ty = (dx * L.u[0] + dy * L.u[1] + dz * L.u[2]) / d;
                if (Math.abs(ty) >= L.th) continue;
                const w = edge(tx / L.tw) * edge(ty / L.th);
                r += L.rgb[0] * w;
                g += L.rgb[1] * w;
                b += L.rgb[2] * w;
            }
            const o = (j * W + i) * 3;
            rgb[o] = r;
            rgb[o + 1] = g;
            rgb[o + 2] = b;
        }
    }
    // Pin lights: small hot discs over the upper hemisphere, rasterised into their own footprint.
    const rand = mulberry32(seed);
    const pins = 34;
    for (let p = 0; p < pins; p++) {
        const lon = (rand() - 0.5) * TAU;
        const lat = (0.06 + rand() * 0.78) * (Math.PI / 2);
        const radius = ((0.5 + rand() * 0.7) * Math.PI) / 180;
        const power = 26 + rand() * 70;
        const warm = 0.82 + rand() * 0.18;
        const cj = (lat / Math.PI + 0.5) * H;
        const ci = (lon / TAU + 0.5) * W;
        const rj = Math.ceil((radius / Math.PI) * H) + 1;
        const ri = Math.ceil(((radius / TAU) * W) / Math.max(0.2, Math.cos(lat))) + 1;
        const px = Math.cos(lat) * Math.cos(lon);
        const py = Math.sin(lat);
        const pz = Math.cos(lat) * Math.sin(lon);
        for (let j = Math.max(0, Math.floor(cj - rj)); j <= Math.min(H - 1, Math.ceil(cj + rj)); j++) {
            const la = ((j + 0.5) / H - 0.5) * Math.PI;
            for (let ii = Math.floor(ci - ri); ii <= Math.ceil(ci + ri); ii++) {
                const i = ((ii % W) + W) % W;
                const lo = ((i + 0.5) / W - 0.5) * TAU;
                const c = Math.cos(la) * Math.cos(lo) * px + Math.sin(la) * py + Math.cos(la) * Math.sin(lo) * pz;
                const ang = Math.acos(Math.min(1, c));
                if (ang >= radius) continue;
                const t = Math.min(1, Math.max(0, (ang / radius - 0.5) / 0.5));
                const w = (1 - t * t * (3 - 2 * t)) * power;
                const o = (j * W + i) * 3;
                rgb[o] += w;
                rgb[o + 1] += w * (0.9 + warm * 0.06);
                rgb[o + 2] += w * warm * 0.86;
            }
        }
    }
    const data = new Uint16Array(W * H * 4);
    const one = THREE.DataUtils.toHalfFloat(1);
    for (let i = 0, o = 0; i < W * H; i++, o += 4) {
        data[o] = THREE.DataUtils.toHalfFloat(Math.min(rgb[i * 3], 60000));
        data[o + 1] = THREE.DataUtils.toHalfFloat(Math.min(rgb[i * 3 + 1], 60000));
        data[o + 2] = THREE.DataUtils.toHalfFloat(Math.min(rgb[i * 3 + 2], 60000));
        data[o + 3] = one;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.name = 'chiral-gold-studio';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

/**
 * Every uniform the hall's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture }} textures
 */
export function createHallUniforms(textures) {
    const first = ALLOYS[0];
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Pixels a metre covers at one metre's depth, over the buffer's height (0.5 / tan(fov / 2)). */
        lens: uniform(1.37),
        /** 0..1.3: the chain's charge. The cores glow, the gold runs hot. */
        heat: uniform(0),
        /** Gain on everything that emits (the four-line hush pulls it down). */
        emit: uniform(1),
        /** A flare each tower holds after a strike (x = left, y = right). */
        flare: uniform(new THREE.Vector2(0, 0)),
        /** The alloy's three braid colours and its glow (scene-linear). */
        alloyA: uniform(new THREE.Vector3(...first.ribbons[0])),
        alloyB: uniform(new THREE.Vector3(...first.ribbons[1])),
        alloyC: uniform(new THREE.Vector3(...first.ribbons[2])),
        glow: uniform(new THREE.Vector3(...first.glow)),
        /** The alloy being poured out, and the height the pour has reached (level-up). */
        prevA: uniform(new THREE.Vector3(...first.ribbons[0])),
        prevB: uniform(new THREE.Vector3(...first.ribbons[1])),
        prevC: uniform(new THREE.Vector3(...first.ribbons[2])),
        pour: uniform(100),
        /** World x of the towers' axes (the right one; the left is its mirror), and their scale. */
        helixX: uniform(6.6),
        helixScale: uniform(1),
        /** Audio: (bass, mid, treble, beat), each 0..1. */
        audio: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** Pulses along the ribbons: (height, birth, strength, side). */
        pulseA: [],
        /** Rings on the water: (x, z, birth, strength) + colour. */
        rippleA: [],
        rippleC: [],
        /** The clear's surge across the water and through the towers: (birth, strength, lines, _). */
        surge: uniform(new THREE.Vector4(-100, 0, 1, 0)),
        /** The four-line strike: (birth, strength, _, _). */
        aurum: uniform(new THREE.Vector4(-100, 0, 0, 0)),
        /** Comets on the great ring: (birth, turns/s signed, strength, band). */
        cometA: [],
        noiseTex: textures.noise,
    };
    for (let i = 0; i < PULSE_SLOTS; i++) u.pulseA.push(uniform(new THREE.Vector4(0, -100, 0, 0)));
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
        u.rippleA.push(uniform(new THREE.Vector4(0, 0, -100, 0)));
        u.rippleC.push(uniform(new THREE.Vector3(1, 0.7, 0.3)));
    }
    for (let i = 0; i < COMET_SLOTS; i++) u.cometA.push(uniform(new THREE.Vector4(-100, 0, 0, 0)));
    u.noise = (st) => texture(u.noiseTex, st);
    return u;
}

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function cgFxMaterial(name, { depthTest = true } = {}) {
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
export function cgQuadGeometry(count, attributes = {}) {
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

/**
 * A strip (x in −0.5..0.5 in `segments` steps, y in −0.5..0.5, uv 0..1) for `count` instances:
 * a quad that can bend along its length.
 */
export function cgStripGeometry(count, segments, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    const position = [];
    const uvs = [];
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const x = i / segments;
        position.push(x - 0.5, -0.5, 0, x - 0.5, 0.5, 0);
        uvs.push(x, 0, x, 1);
        if (i < segments) {
            const a = i * 2;
            index.push(a, a + 2, a + 3, a, a + 3, a + 1);
        }
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** Wrap a finished part: unculled, static, ordered. `reflected` = drawn in the water's mirror. */
export function cgPart(name, geometry, material, renderOrder = 0, reflected = false) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
}

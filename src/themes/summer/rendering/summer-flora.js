/* eslint-disable import/no-unresolved */
/**
 * Low-poly, vertex-coloured FLORA geometry for the Summer "Midsommar" theme.
 *
 * Each factory returns a plain `THREE.BufferGeometry` with a baked `color` vertex
 * attribute, authored in a ~1-unit-tall LOCAL space with the root at y=0 — ready to be
 * instanced and bent by the shared TSL wind material (the wind reads `positionLocal.y`
 * as the 0→1 height mask, so keep the stem at the bottom and the bloom near the top).
 *
 * No materials, no lights — pure geometry + colour, so the same shapes can be reused by
 * the meadow (instanced) and, later, the tree builders. Colours are stored LINEAR (via
 * THREE.Color) to match the effect's `cv()`/`shade()` pipeline.
 *
 * Uses `three/webgpu` (the SAME module instance the effect imports) so geometry/attribute
 * classes are identity-compatible with the scene.
 */
import * as THREE from 'three/webgpu';

const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const lerpC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Tiny deterministic RNG so a given seed always yields the same blade/petal jitter.
function rng(seed) {
    let s = (seed * 1597 + 51749) >>> 0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function Builder() {
    const pos = [], col = [], idx = [];
    let n = 0;
    const api = {
        v(x, y, z, c) { pos.push(x, y, z); col.push(c[0], c[1], c[2]); return n++; },
        tri(a, b, c) { idx.push(a, b, c); },
        quad(a, b, c, d) { idx.push(a, b, c, a, c, d); },
        // Tapered k-gon stem from y0→y1, radius r0→r1, optional lean to (lx,lz) at the top.
        stem(y0, y1, r0, r1, k, c, lx = 0, lz = 0) {
            const bot = [], top = [];
            for (let i = 0; i < k; i++) {
                const a = (i / k) * Math.PI * 2;
                bot.push(api.v(Math.cos(a) * r0, y0, Math.sin(a) * r0, c));
                top.push(api.v(lx + Math.cos(a) * r1, y1, lz + Math.sin(a) * r1, c));
            }
            for (let i = 0; i < k; i++) { const j = (i + 1) % k; api.quad(bot[i], bot[j], top[j], top[i]); }
            return top;
        },
        // Radiating petals: n triangles from an inner ring (ri) out to a lifted tip (ro, +lift).
        petals(hy, ri, ro, lift, n, c, width = 0.42) {
            for (let k = 0; k < n; k++) {
                const am = (k / n) * Math.PI * 2;
                const a1 = ((k + width) / n) * Math.PI * 2, a2 = ((k - width) / n) * Math.PI * 2;
                const i0 = api.v(Math.cos(a2) * ri, hy, Math.sin(a2) * ri, c);
                const i1 = api.v(Math.cos(a1) * ri, hy, Math.sin(a1) * ri, c);
                const tip = api.v(Math.cos(am) * ro, hy + lift, Math.sin(am) * ro, c);
                api.tri(i0, i1, tip);
            }
        },
        // A small fan disc (k-gon) at height hy → flower centre / poppy eye.
        disc(hy, r, k, c) {
            const cc = api.v(0, hy + r * 0.25, 0, c);
            const ring = [];
            for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; ring.push(api.v(Math.cos(a) * r, hy, Math.sin(a) * r, c)); }
            for (let i = 0; i < k; i++) api.tri(cc, ring[i], ring[(i + 1) % k]);
        },
        // A faceted cone tier (k-sided) from y0 up to an apex at y0+h, radius r.
        cone(y0, h, r, k, c, cx = 0, cz = 0) {
            const ring = [];
            for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; ring.push(api.v(cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r, c)); }
            const apex = api.v(cx, y0 + h, cz, c);
            for (let i = 0; i < k; i++) api.tri(ring[i], ring[(i + 1) % k], apex);
        },
        // A faceted blob (4-sided bipyramid / octahedron) centred at (cx,cy,cz).
        octa(cx, cy, cz, rx, ry, rz, c) {
            const top = api.v(cx, cy + ry, cz, c), bot = api.v(cx, cy - ry, cz, c);
            const mid = [];
            for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.4; mid.push(api.v(cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz, c)); }
            for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; api.tri(top, mid[i], mid[j]); api.tri(bot, mid[j], mid[i]); }
        },
        geo() {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            g.setIndex(idx);
            g.computeBoundingSphere();
            return g;
        },
    };
    return api;
}

// ── Oxeye daisy: white petals + golden domed centre on a slim stem. ──
export function buildDaisy() {
    const b = Builder();
    b.stem(0, 0.6, 0.012, 0.009, 4, C(0x3f7a28));
    b.petals(0.6, 0.03, 0.145, 0.028, 11, C(0xf4f3ec), 0.4);
    b.disc(0.6, 0.045, 7, C(0xf2c53d));
    return b.geo();
}

// ── Buttercup: cupped yellow petals, short. ──
export function buildButtercup() {
    const b = Builder();
    b.stem(0, 0.4, 0.011, 0.008, 4, C(0x447b27));
    b.petals(0.4, 0.022, 0.1, 0.055, 5, C(0xf6c324), 0.5); // strong lift → bowl
    b.disc(0.4, 0.026, 5, C(0xb9851a));
    return b.geo();
}

// ── Lupine: tall purple→lilac spike of stacked floret whorls. ──
export function buildLupine() {
    const b = Builder();
    const lo = C(0x7b4fc0), hi = C(0xc6a6ea);
    b.stem(0, 0.52, 0.015, 0.01, 4, C(0x4f7a2a));
    const whorls = 8, base = 0.48, top = 1.32, K = 5;
    for (let w = 0; w < whorls; w++) {
        const t = w / (whorls - 1);
        const y = base + (top - base) * t;
        const r = 0.075 * (1 - t * 0.85);
        const col = lerpC(lo, hi, t);
        for (let k = 0; k < K; k++) {
            const a = (k / K + (w % 2) * 0.5) * Math.PI * 2;
            const bl = b.v(Math.cos(a - 0.32) * 0.013, y + 0.025, Math.sin(a - 0.32) * 0.013, col);
            const br = b.v(Math.cos(a + 0.32) * 0.013, y + 0.025, Math.sin(a + 0.32) * 0.013, col);
            const tip = b.v(Math.cos(a) * r, y - 0.022, Math.sin(a) * r, col); // florets droop outward
            b.tri(bl, br, tip);
        }
    }
    return b.geo();
}

// ── Cornflower: blue spiky star head on a tall slim stem. ──
export function buildCornflower() {
    const b = Builder();
    b.stem(0, 0.7, 0.012, 0.008, 4, C(0x4f7a2a));
    const hy = 0.7, blue = C(0x4a6fd0), deep = C(0x33509e), n = 9;
    const cc = b.v(0, hy + 0.02, 0, deep);
    for (let k = 0; k < n; k++) {
        const am = (k / n) * Math.PI * 2, a1 = ((k + 0.4) / n) * Math.PI * 2, a2 = ((k - 0.4) / n) * Math.PI * 2;
        const i0 = b.v(Math.cos(a2) * 0.022, hy, Math.sin(a2) * 0.022, blue);
        const i1 = b.v(Math.cos(a1) * 0.022, hy, Math.sin(a1) * 0.022, blue);
        const tip = b.v(Math.cos(am) * 0.09, hy + 0.06, Math.sin(am) * 0.09, blue); // upturned spikes
        b.tri(i0, i1, tip); b.tri(cc, i0, i1);
    }
    return b.geo();
}

// ── Poppy: red bowl of petals with a dark eye. ──
export function buildPoppy() {
    const b = Builder();
    b.stem(0, 0.48, 0.012, 0.009, 4, C(0x4f7a2a));
    const hy = 0.48, red = C(0xd7352b), dark = C(0x241008), n = 6;
    b.disc(hy, 0.03, 5, dark);
    for (let k = 0; k < n; k++) {
        const am = (k / n) * Math.PI * 2, a1 = ((k + 0.55) / n) * Math.PI * 2, a2 = ((k - 0.55) / n) * Math.PI * 2;
        const i0 = b.v(Math.cos(a2) * 0.022, hy, Math.sin(a2) * 0.022, red);
        const i1 = b.v(Math.cos(a1) * 0.022, hy, Math.sin(a1) * 0.022, red);
        const tip = b.v(Math.cos(am) * 0.125, hy + 0.06, Math.sin(am) * 0.125, red); // cupped
        b.tri(i0, i1, tip); b.tri(b.v(0, hy + 0.012, 0, dark), i0, i1);
    }
    return b.geo();
}

// ── Grass tuft: several slim bent blades, root→tip green gradient. ──
export function buildGrassTuft(seed = 0) {
    const b = Builder();
    const lo = C(0x3f6b2e), hi = C(0x9cc062);
    const R = rng(seed);
    const n = 4 + ((R() * 3) | 0);
    for (let i = 0; i < n; i++) {
        const yaw = R() * Math.PI * 2, h = 0.6 + R() * 0.55, w = 0.02, bend = 0.05 + R() * 0.14;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const ox = (R() - 0.5) * 0.18, oz = (R() - 0.5) * 0.18;
        const P = (x, y, z) => [ox + x * c - z * s, y, oz + x * s + z * c];
        const tip = lerpC(lo, hi, 1);
        const [p0x, , p0z] = P(-w, 0, 0), [p1x, , p1z] = P(w, 0, 0);
        const [m0x, , m0z] = P(-w * 0.6 + bend * 0.45, 0, 0), [m1x, , m1z] = P(w * 0.6 + bend * 0.45, 0, 0);
        const [tx, , tz] = P(bend, 0, 0);
        const v0 = b.v(p0x, 0, p0z, lo), v1 = b.v(p1x, 0, p1z, lo);
        const md = lerpC(lo, hi, 0.55);
        const m0 = b.v(m0x, h * 0.55, m0z, md), m1 = b.v(m1x, h * 0.55, m1z, md);
        const vt = b.v(tx, h, tz, tip);
        b.quad(v0, v1, m1, m0); b.tri(m0, m1, vt);
    }
    return b.geo();
}

// ─── TREES (unit height ≈ 1.0, root at y=0) — instanced & scaled to world size ───

// Spruce/fir: short trunk + stacked tiered cones, dark→mid faceted greens.
export function buildSpruceTree(seed = 0) {
    const b = Builder();
    const R = rng(seed);
    b.stem(0, 0.13, 0.03, 0.022, 5, C(0x4f3722));
    const greens = [0x20402a, 0x274d31, 0x315c3a, 0x3b6a43, 0x46774c, 0x52864f];
    const tiers = 6, base = 0.09, step = (1.0 - base) / tiers;
    for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const y0 = base + i * step * 0.8;
        const h = step * 1.7;
        const r = 0.34 * (1 - t * 0.82) * (0.92 + R() * 0.14);
        b.cone(y0, h, r, Math.max(5, 8 - i), C(greens[i]));
    }
    return b.geo();
}

// Pine: tall bare reddish trunk + a broad umbrella canopy of 3 shallow tiers up top.
export function buildPineTree(seed = 0) {
    const b = Builder();
    const R = rng(seed);
    b.stem(0, 0.6, 0.024, 0.015, 5, C(0x6e4a2a));
    const greens = [0x2f6b3a, 0x387a42, 0x46894d];
    for (let i = 0; i < 3; i++) {
        const t = i / 2;
        const y0 = 0.5 + t * 0.3;
        const r = 0.32 * (1 - t * 0.5) * (0.92 + R() * 0.14);
        b.cone(y0, 0.27, r, 7, C(greens[i]));
    }
    return b.geo();
}

// Aspen: brown trunk + GOLDEN faceted crown (the warm deciduous accents in the treeline).
export function buildAspenTree(seed = 0) {
    const b = Builder();
    const R = rng(seed);
    b.stem(0, 0.5, 0.024, 0.016, 6, C(0x6b4a2a));
    const can = [0xc9a93a, 0xd8bb46, 0xb8932f, 0xcfae3e];
    const blobs = [
        [0.0, 0.66, 0.0, 0.21, 0.18, 0.21], [-0.13, 0.78, 0.06, 0.17, 0.15, 0.17],
        [0.14, 0.82, -0.05, 0.16, 0.14, 0.16], [0.0, 0.93, 0.0, 0.14, 0.13, 0.14],
    ];
    blobs.forEach((bl, i) => b.octa(bl[0], bl[1] + (R() - 0.5) * 0.03, bl[2], bl[3], bl[4], bl[5], C(can[i % can.length])));
    return b.geo();
}

// Reed / cattail clump: tall slim blades + a brown cattail head, for the lake shoreline.
export function buildReed(seed = 0) {
    const b = Builder();
    const R = rng(seed);
    const green = C(0x4a7a30), dark = C(0x35601f), brown = C(0x6b4a1f);
    const n = 3 + ((R() * 3) | 0);
    for (let i = 0; i < n; i++) {
        const yaw = R() * Math.PI * 2, h = 1.15 + R() * 0.65, w = 0.022, bend = 0.04 + R() * 0.09;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const ox = (R() - 0.5) * 0.16, oz = (R() - 0.5) * 0.16;
        const P = (x, z) => [ox + x * c - z * s, oz + x * s + z * c];
        const [p0x, p0z] = P(-w, 0), [p1x, p1z] = P(w, 0);
        const [mx, mz] = P(bend * 0.5, 0), [tx, tz] = P(bend, 0);
        const v0 = b.v(p0x, 0, p0z, dark), v1 = b.v(p1x, 0, p1z, dark);
        const m0 = b.v(mx - w * 0.5, h * 0.6, mz, green), m1 = b.v(mx + w * 0.5, h * 0.6, mz, green);
        const vt = b.v(tx, h, tz, green);
        b.quad(v0, v1, m1, m0); b.tri(m0, m1, vt);
        if (i === 0) b.cone(h * 0.74, h * 0.24, 0.055, 5, brown, tx * 0.85, tz * 0.85); // cattail head
    }
    return b.geo();
}

// Birch/aspen: slim pale trunk with a couple of dark bands + faceted green crown blobs.
export function buildBirchTree(seed = 0) {
    const b = Builder();
    const R = rng(seed);
    const white = C(0xe8e4d6), dark = C(0x39362f);
    // trunk in 3 segments so we can drop dark bark bands between them
    b.stem(0.0, 0.30, 0.026, 0.022, 6, white);
    b.stem(0.30, 0.33, 0.022, 0.022, 6, dark);
    b.stem(0.33, 0.58, 0.022, 0.016, 6, white);
    const can = [0x6f9f37, 0x82b448, 0x93c45a, 0x77a83e];
    const blobs = [
        [0.0, 0.70, 0.0, 0.20, 0.17, 0.20], [-0.13, 0.82, 0.06, 0.16, 0.15, 0.16],
        [0.14, 0.85, -0.05, 0.15, 0.14, 0.15], [0.0, 0.96, 0.0, 0.13, 0.13, 0.13],
    ];
    blobs.forEach((bl, i) => b.octa(bl[0], bl[1] + (R() - 0.5) * 0.03, bl[2], bl[3], bl[4], bl[5], C(can[i % can.length])));
    return b.geo();
}

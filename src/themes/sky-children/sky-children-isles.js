/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children — Irisfall: all the stone.
 *
 * The isles are upturned mountains, built in JS from seeded functions (no models, no textures on
 * disk):
 *   body       a radial mesh r(θ, y): a low crown of moss — a tilted plate, its outline pushed ±25 %
 *              off round — over a dark root of iron-stone that tapers far down to a point, banded by
 *              strata, ridged by drip curtains, hung with pinnacles
 *   terraces   rimstone shelves fanning down the crown's front from the spring to the lip: each a
 *              2D profile (the back of the shelf, the pool floor, the lip's rounded crest, a SHORT
 *              curtain bulging out and hanging into the next pool) swept along a scalloped outline,
 *              so the basins are kidneys, not a cake's tiers
 *   crags      the summit's rocky hump, the foreground's dark masses
 *   trees      small round crowns of dark leaf on the summit (they give the isles their size)
 *   ruins      extruded arch shapes (the bell-arch, the aqueduct's broken span, the Far Gate)
 * Pools are NOT here (sky-children-water.js): the terraces return where their pools sit.
 *
 * Every isle is pitched a little toward the eye (placement.pitch), so its crown, its pools and the
 * cascade read from across the gulf instead of edge-on.
 *
 * One material shades every stone (attribute aMat, MAT below): the key from behind the eye wrapped
 * round the forms, a cool fill from the shadow side, coloured shadow (never black), rimstone ripples
 * on the travertine, tafoni cups and white mineral drips on the iron-stone, moss on what faces the
 * sky, and the air between, toward the colour of distance.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cameraPosition, clamp, dot, exp, float, floor, fract, fwidth, length, max, min, mix,
    modelPosition, normalWorld, normalize, positionLocal, positionWorld, pow, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smooth } from './sky-children-core.js';
import {
    airColour, earthShadowAt, horizonHaze, scHash21, scWrap, scWrapPi, seaTone, skyBase,
} from './sky-children-tsl.js';
import { drainSteps } from '../shared/build-steps.js';

/** Stone kinds (attribute aMat). */
export const MAT = Object.freeze({
    travertine: 0, iron: 1, bronze: 2, masonry: 3, crown: 4, leaf: 5,
});

// ── CPU noise (deterministic, for geometry only) ──

const NOISE_CACHE = new Map();
/** makeNoise, kept per seed (it is pure: the same seed always grows the same field). */
function noiseOf(seed) {
    if (!NOISE_CACHE.has(seed)) NOISE_CACHE.set(seed, makeNoise(seed));
    return NOISE_CACHE.get(seed);
}

function makeNoise(seed) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(512);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const grad = new Float32Array(256);
    for (let i = 0; i < 256; i++) grad[i] = rand() * 2 - 1;
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const h = (x, y, z) => grad[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];
    const noise3 = (x, y, z) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const zi = Math.floor(z);
        const xf = x - xi;
        const yf = y - yi;
        const zf = z - zi;
        const u = fade(xf);
        const v = fade(yf);
        const w = fade(zf);
        const l = (a, b, t) => a + (b - a) * t;
        return l(
            l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
            l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
            w,
        );
    };
    const fbm3 = (x, y, z, oct = 4) => {
        let a = 0;
        let amp = 0.5;
        let f = 1;
        for (let i = 0; i < oct; i++) {
            a += noise3(x * f, y * f, z * f) * amp;
            f *= 2.03;
            amp *= 0.5;
        }
        return a;
    };
    return { noise3, fbm3, rand };
}

/** Attach a constant float attribute to a geometry. */
function constAttr(geometry, name, value) {
    const n = geometry.attributes.position.count;
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
}

function ensureAttrs(geometry, mat, ao = 1) {
    // Every stone draw is indexed (merging needs all or none).
    if (!geometry.index) {
        const n = geometry.attributes.position.count;
        const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!geometry.attributes.aMat) constAttr(geometry, 'aMat', mat);
    if (!geometry.attributes.aAO) constAttr(geometry, 'aAO', ao);
    const n = geometry.attributes.position.count;
    // Not a bed of the cliffs (tone −1); moss where the stone kind is the crown's.
    if (!geometry.attributes.aBed) {
        const b = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) b[i * 2] = -1;
        geometry.setAttribute('aBed', new THREE.BufferAttribute(b, 2));
    }
    if (!geometry.attributes.aMoss) {
        const m = geometry.attributes.aMat.array;
        const mo = new Float32Array(n);
        for (let i = 0; i < n; i++) mo[i] = Math.abs(m[i] - MAT.crown) < 0.5 ? 1 : 0;
        geometry.setAttribute('aMoss', new THREE.BufferAttribute(mo, 1));
    }
    // The crown's stone is the iron's own kind with a crown weight beside it: an id interpolated
    // from iron to crown across a triangle would sweep through bronze and masonry on the way (a
    // zigzag band along every rim), so aMat only ever names whole pieces.
    if (!geometry.attributes.aCrown) {
        const m = geometry.attributes.aMat.array;
        const cr = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            if (Math.abs(m[i] - MAT.crown) < 0.5) {
                cr[i] = 1;
                m[i] = MAT.iron;
            }
        }
        geometry.setAttribute('aCrown', new THREE.BufferAttribute(cr, 1));
    }
    // Keep only what every stone draw shares (merge needs identical attribute sets).
    Object.keys(geometry.attributes).forEach((k) => {
        if (!['position', 'normal', 'aMat', 'aAO', 'aBed', 'aMoss', 'aCrown'].includes(k)) geometry.deleteAttribute(k);
    });
    return geometry;
}

/**
 * An icosphere, indexed: three's polyhedra are non-indexed (every face its own vertices), so their
 * normals come out faceted; welding first gives smooth rock.
 */
function icosphere(detail) {
    const raw = new THREE.IcosahedronGeometry(1, detail);
    raw.deleteAttribute('normal');
    raw.deleteAttribute('uv');
    const g = mergeVertices(raw, 1e-5);
    raw.dispose();
    return g;
}

/** Grid indices for a rows × cols vertex grid (row-major), optionally wrapping the columns. */
function gridIndex(rows, cols, wrap) {
    const idx = [];
    const cmax = wrap ? cols : cols - 1;
    for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cmax; c++) {
            const c1 = (c + 1) % cols;
            const a = r * cols + c;
            const b = r * cols + c1;
            const d = (r + 1) * cols + c;
            const e = (r + 1) * cols + c1;
            idx.push(a, d, b, b, d, e);
        }
    }
    return idx;
}

/**
 * The outline's low-frequency asymmetry at a local horizontal direction (unit x, z): an isle is
 * never round. `amount` 0.2 pushes the outline about ±25 % in and out.
 */
function outlineScale(S, x, z, amount) {
    if (!amount) return 1;
    const th = Math.atan2(z, x);
    const k = 0.5 * Math.sin(th + 1.3) + 0.3 * Math.sin((2 * th) + 0.4) + 0.7 * S.noise3((x * 1.3) + 3.1, (z * 1.3) - 1.7, 0.5);
    return 1 + amount * k;
}

/**
 * The radius profile of an isle's body at height y (no noise): a low crown (a cone of moss with a
 * rounded summit) over a root that tapers to a point. `p.crownPower` < 1 flattens the crown toward
 * a mesa (the Far Gate's base).
 */
function bodyProfile(p, y) {
    const {
        top, lip, root, radius: R,
    } = p;
    if (y >= lip) {
        if (p.dome) {
            // The inverse of the dome (domeAt): the radius at which the crown stands this high.
            const u = Math.min(1, Math.max(0, (y - lip - 0.8) / Math.max(1, top - lip - 0.8)));
            return R * (1 - u ** (1 / 0.6)) ** (1 / 2.2);
        }
        const u = Math.min(1, (y - lip) / Math.max(1, top - lip)); // 0 at the lip, 1 at the summit
        return R * (0.04 + 0.96 * (1 - u) ** (p.crownPower ?? 0.85));
    }
    const s = (lip - y) / (lip - root); // 0 at the lip, 1 at the tip
    // An upturned mountain: the rim widest, then a long taper to a point.
    const belly = 1 + 0.05 * Math.sin(Math.min(1, s * 4) * Math.PI);
    return R * belly * (1 - s) ** 1.5;
}

/** The crown's height at a local radius (no noise, no asymmetry): the inverse of the crown profile. */
export function crownHeightAt(p, rho) {
    if (p.dome) return p.lip + domeAt(p, rho / p.radius);
    const k = p.crownPower ?? 0.85;
    const f = (rho / p.radius - 0.04) / 0.96;
    if (f >= 1) return p.lip;
    const u = 1 - Math.max(0, f) ** (1 / k);
    return p.lip + u * (p.top - p.lip);
}

/**
 * The crown's height as buildBody lays it at a local point (x, z): its outline's stretch, without
 * the lumps (a few metres either way on a far isle's crown: allow for them).
 */
export function bodyGround(p, x, z, { seed = 1, asym = 0.2 } = {}) {
    const r = Math.hypot(x, z) || 1e-6;
    const k = outlineScale(noiseOf(p.shapeSeed ?? seed + 5), x / r, z / r, asym);
    return crownHeightAt(p, r / k);
}

/**
 * The body: rings × radial vertices round y, with strata, drip ridges and fBm; the crown's front is
 * cut back a little where the terraces stand (`frontCut`).
 */
export function buildBody(p, {
    radial = 96, rings = 64, seed = 1, frontCut = 0.12, asym = 0.2,
} = {}) {
    const N = makeNoise(seed);
    const S = makeNoise(p.shapeSeed ?? seed + 5);
    const cols = radial;
    // Rings: about a third on the crown, the rest down the root, dense under the rim.
    const crownRings = Math.max(6, Math.round(rings * 0.32));
    const rootRings = Math.max(8, rings - crownRings);
    const ringYs = [];
    for (let k = rootRings; k >= 1; k--) ringYs.push(p.lip - (p.lip - p.root) * 0.985 * (k / rootRings) ** 1.45);
    ringYs.push(p.lip);
    for (let k = 1; k <= crownRings; k++) ringYs.push(p.lip + (p.top - p.lip) * (k / crownRings) ** 0.9);
    const pos = [];
    const mat = [];
    const ao = [];
    for (let r = 0; r < ringYs.length; r++) {
        const y = ringYs[r];
        const base = bodyProfile(p, y);
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const ct = Math.cos(th);
            const st = Math.sin(th); // θ = π/2 is +z, the front (toward the eye)
            const below = Math.max(0, (p.lip - y) / (p.lip - p.root));
            const k = outlineScale(S, ct, st, asym);
            // Strata: horizontal bands; drips: vertical ridges down the root; crags: its broken faces.
            // Beds run level (a gentle warp only), the drip grooves cut deep and vertical.
            const strata = (y < p.lip ? 0.035 : 0.012) * Math.sin(y * 0.23 + N.fbm3(ct * 1.3, y * 0.01, st * 1.3, 2) * 1.2);
            const drips = below * 0.24 * Math.abs(N.noise3(th * 7.5, y * 0.006, 2.3));
            const crags = below * 0.3 * N.fbm3(ct * 3.1 + 2, y * 0.025, st * 3.1 + 5, 3);
            const lumps = N.fbm3(ct * 1.6 + 7, y * 0.012, st * 1.6 - 3, 4) * (0.1 + below * 0.3) + crags;
            const facing = Math.max(0, st);
            const cut = y > p.lip ? frontCut * facing ** 1.5 * smooth(p.lip - 2, p.lip + 6, y) : 0;
            const rr = Math.max(0.3, base * k * (1 + strata + lumps - drips - cut));
            pos.push(ct * rr, y, st * rr);
            // The crown is moss and warm rock; under the rim the dark iron-stone root.
            mat.push(y > p.lip + 0.5 ? MAT.crown : MAT.iron);
            // The root darkens downward; the band just under the rim lies in the crown's shade.
            const underRim = 0.7 + 0.3 * smooth(0, 0.06, below);
            ao.push(y > p.lip ? 1 : (0.85 - 0.3 * below) * underRim);
        }
    }
    const rowsN = ringYs.length;
    const index = gridIndex(rowsN, cols, true);
    // The summit: a slightly domed cap.
    const centre = pos.length / 3;
    pos.push(0, p.top + 1.5, 0);
    mat.push(MAT.crown);
    ao.push(1);
    const topRow = (rowsN - 1) * cols;
    for (let c = 0; c < cols; c++) index.push(topRow + ((c + 1) % cols), topRow + c, centre);
    // The root's tip.
    const tip = pos.length / 3;
    pos.push(0, p.root - 6, 0);
    mat.push(MAT.iron);
    ao.push(0.5);
    for (let c = 0; c < cols; c++) index.push(c, (c + 1) % cols, tip);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
}

// ── The massif: an upturned mountain, not a carrot ──

/**
 * Bake the forms' relief into aAO: each vertex against the mean of its neighbours along its
 * normal — creases (the neighbours stand out over it) darken, ridges stay lit — so the ledges,
 * ribs and grooves read in the full-face light from behind the eye.
 */
export function bakeCavity(geometry, strength = 0.45) {
    const pos = geometry.attributes.position.array;
    const nrm = geometry.attributes.normal.array;
    const ao = geometry.attributes.aAO.array;
    const n = geometry.attributes.position.count;
    const sum = new Float32Array(n * 3);
    const cnt = new Float32Array(n);
    const len = new Float32Array(n);
    const idx = geometry.index.array;
    const edge = (a, b) => {
        const dx = pos[b * 3] - pos[a * 3];
        const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
        const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const l = Math.hypot(dx, dy, dz);
        sum[a * 3] += pos[b * 3]; sum[a * 3 + 1] += pos[b * 3 + 1]; sum[a * 3 + 2] += pos[b * 3 + 2];
        sum[b * 3] += pos[a * 3]; sum[b * 3 + 1] += pos[a * 3 + 1]; sum[b * 3 + 2] += pos[a * 3 + 2];
        cnt[a] += 1;
        cnt[b] += 1;
        len[a] += l;
        len[b] += l;
    };
    for (let t = 0; t < idx.length; t += 3) {
        edge(idx[t], idx[t + 1]);
        edge(idx[t + 1], idx[t + 2]);
        edge(idx[t + 2], idx[t]);
    }
    for (let v = 0; v < n; v++) {
        if (!cnt[v]) continue;
        const mx = sum[v * 3] / cnt[v] - pos[v * 3];
        const my = sum[v * 3 + 1] / cnt[v] - pos[v * 3 + 1];
        const mz = sum[v * 3 + 2] / cnt[v] - pos[v * 3 + 2];
        const d = mx * nrm[v * 3] + my * nrm[v * 3 + 1] + mz * nrm[v * 3 + 2];
        const e = Math.max(1e-3, len[v] / cnt[v]);
        const convex = Math.min(1, Math.max(0, 0.5 - (3 * d) / e));
        ao[v] *= 1 - strength + strength * Math.min(1, convex * 1.6);
    }
    geometry.attributes.aAO.needsUpdate = true;
    return geometry;
}

/** The crown dome's height above the lip at a radius fraction q (0 summit, 1 rim). */
function domeAt(p, q) {
    const f = Math.max(0, 1 - Math.min(1, q) ** 2.2);
    return (p.top - p.lip - 0.8) * f ** 0.6 + 0.8;
}

/**
 * The crown's surface height at a local point (x, z): a convex dome, a few knolls on it (the summit
 * and the arch's knoll, all behind the terraces), never below the turf lip.
 */
export function crownSurface(p, x, z) {
    const R = p.radius;
    const q = Math.hypot(x, z) / R;
    let y = p.lip + domeAt(p, q);
    (p.knolls || []).forEach(([kx, kz, h, sigma]) => {
        const dx = x - kx * R;
        const dz = z - kz * R;
        y += h * Math.exp(-(dx * dx + dz * dz) / (sigma * sigma * R * R));
    });
    return y;
}

/** How far a bearing (body angle) lies inside a promontory [bearing, amount, width] (0..amount). */
function spurWeight(spur, th) {
    if (!spur) return 0;
    const d = Math.atan2(Math.sin(th - spur[0]), Math.cos(th - spur[0]));
    return spur[1] * Math.exp(-((d / spur[2]) ** 2));
}

/** How far a bearing (body angle) lies inside the spillway's notch (0..1). */
function notchWeight(p, th) {
    if (!p.notch) return 0;
    const at = Math.PI / 2 - p.notch.th;
    const d = Math.atan2(Math.sin(th - at), Math.cos(th - at));
    return Math.exp(-((d / p.notch.width) ** 2));
}

/** The crown's height as grown, before the builders levelled their pads. */
function rawCrownHeight(p, x, z, seed, asym, spur) {
    const r = Math.hypot(x, z) || 1e-6;
    const ux = x / r;
    const uz = z / r;
    const th = Math.atan2(uz, ux);
    const k = outlineScale(noiseOf(p.shapeSeed ?? seed + 5), ux, uz, asym) * (1 + spurWeight(spur, th));
    const q = r / (p.radius * k);
    const y = crownSurface(p, x / k, z / k) + 0.8 * noiseOf(seed).fbm3(x * 0.05, 1.3, z * 0.05, 3)
        - (p.notch ? p.notch.depth * notchWeight(p, th) * smooth(0.72, 1.0, q) : 0);
    return { y, on: q <= 1.0 };
}

/**
 * The crown's height at a local point exactly as buildMassif lays it: the outline's own stretch and
 * any promontory, the dome and its knolls, the turf's lumps, the spillway's notch, and the level
 * pads the builders cut for their works (`p.pads`: [{ x, z, rx, rz, fall }], each levelled at the
 * crown's height at its centre, blending back into the slope over `fall` metres). `on`: whether the
 * point lies on the crown at all. Everything that stands on a crown (the works, the trees, the
 * outcrops, the terraces) stands on this, so nothing floats and nothing is swallowed.
 */
export function crownHeight(p, x, z, { seed = 1, asym = 0.2, spur = null } = {}) {
    const raw = rawCrownHeight(p, x, z, seed, asym, spur);
    let { y } = raw;
    (p.pads || []).forEach((pad) => {
        const level = pad.y ?? rawCrownHeight(p, pad.x, pad.z, seed, asym, spur).y;
        const d = Math.hypot((x - pad.x) / pad.rx, (z - pad.z) / pad.rz);
        const w = 1 - smooth(1, 1 + pad.fall / Math.min(pad.rx, pad.rz), d);
        y += (level - y) * w;
    });
    return { y, on: raw.on };
}

/** The crown's height as grown (crownHeight), and whether the point is on it. */
export const massifCrownAt = (p, x, z, opts) => crownHeight(p, x, z, opts);

/** The crown's height as buildMassif lays it (crownHeight's height alone). */
export const massifGround = (p, x, z, opts) => crownHeight(p, x, z, opts).y;

/**
 * The beds of a cliff (seeded): [{ top, bottom, hard, tone }] in metres below the lip, from the cap
 * rock down. Hard beds stand out as ledges over the soft ones undercut beneath them.
 */
export function cliffBeds(p, seed = 1) {
    const rand = mulberry32(seed * 131 + 7);
    const beds = [];
    const depth = Math.min(p.lip - p.root, 200);
    // Beds in proportion to the cliff (a far isle at unit size has its beds too).
    const k = Math.min(1, depth / 200);
    let y = 4 * k;
    while (y < depth || !beds.length) {
        const thick = (10 + rand() * 16) * k;
        beds.push({
            top: y, bottom: y + thick, hard: 0.6 + rand() * 0.8, tone: rand(),
        });
        y += thick;
    }
    return beds;
}

/**
 * The massif: a turf-lipped crown dome over a cliff of bedded rock (hard caps standing out over
 * undercut soft beds, buttress ribs, ravines) that hangs below as fused lobes, the main one
 * deepest. `p.lobes`: a count of seeded side lobes, or a table of them ({ phi, off, w, end, power,
 * shoulder }) set on the silhouette's bearings; `p.lean`: [share of the radius, bearing] the root's
 * spine leans toward as it hangs (its deepest point off the axis, never a spinning top).
 * Rings × radial vertices; attributes aMat, aAO (a first guess, refined by the bake), aBed (bed
 * tone, depth within the bed; -1 on the crown) and aMoss.
 */
export function buildMassif(p, {
    radial = 96, rings = 64, seed = 1, asym = 0.2, outletTh = null, spur = null,
} = {}) {
    const N = makeNoise(seed);
    const S = makeNoise(p.shapeSeed ?? seed + 5);
    const rand = mulberry32(seed * 17 + 3);
    const R = p.radius;
    const cols = radial;
    const beds = cliffBeds(p, seed);
    // The hanging lobes: the main one on the axis (deepest), three more about it. The main lobe
    // keeps its shoulders under the rim (the cliff falls near-sheer before the underside turns in),
    // so the isle reads as a mountain turned over, not a carrot.
    let lobes = [{
        phi: 0, off: 0, w: 0.8, end: 1, power: 1.5, shoulder: 1.3,
    }];
    const table = Array.isArray(p.lobes) ? p.lobes : null;
    // (A table still draws the seeded lobes' numbers, so the ravines after them stay put.)
    const lobeCount = table ? 3 : p.lobes ?? 3;
    for (let k = 0; k < lobeCount; k++) {
        // Spread round the isle, each a hanging mass of its own that ends at its own depth.
        // Each stands out of the main lobe as an inverted peak of its own, a saddle between them.
        lobes.push({
            phi: ((k + 0.25 + rand() * 0.5) / lobeCount) * Math.PI * 2,
            off: 0.56 + rand() * 0.2,
            w: 0.56 - k * 0.06,
            end: 0.8 - k * 0.12,
            power: 1.25,
            shoulder: 1.2,
        });
    }
    if (table) lobes = [lobes[0], ...table];
    // Ravines, off the water's side.
    const ravines = [];
    for (let k = 0; k < 3; k++) {
        let th = rand() * Math.PI * 2;
        if (outletTh !== null && Math.abs(Math.atan2(Math.sin(th - outletTh), Math.cos(th - outletTh))) < 0.6) th += Math.PI;
        ravines.push(th);
    }
    // A promontory: the outline pushed out round one bearing (at the crown and the rim; the root under
    // it is cut back, so the spur overhangs the void).
    const notchAt = (th) => notchWeight(p, th);
    const spurAt = (th) => spurWeight(spur, th);
    // The lobes fused by a polynomial smooth maximum (a lobe far under the others adds nothing, so
    // nothing steps where one ends; the saddles between them read as notches).
    const kSmooth = 0.09 * R;
    const section = (ux, uz, s) => {
        let best = -1;
        for (let k = 0; k < lobes.length; k++) {
            const L = lobes[k];
            if (s >= L.end) continue;
            const rho = R * L.w * (1 - (s / L.end) ** (L.shoulder ?? 1)) ** (L.power ?? 1.3);
            let cx = Math.cos(L.phi) * L.off * R * s ** 0.6;
            let cz = Math.sin(L.phi) * L.off * R * s ** 0.6;
            // Each lobe keeps the spine inside it (its centre never further out than 0.9 of its
            // radius): the far side of its disc is then met at every bearing, so the section has no
            // flat web where a lobe's disc would leave a bearing, and as a lobe ends its centre
            // retracts onto the spine instead of leaving a floor.
            const cl = Math.hypot(cx, cz);
            if (cl > 0.9 * rho) {
                cx *= (0.9 * rho) / cl;
                cz *= (0.9 * rho) / cl;
            }
            const cu = cx * ux + cz * uz;
            const d = cu + Math.sqrt(Math.max(0, rho * rho - (cx * cx + cz * cz) + cu * cu));
            if (best < 0) {
                best = d;
            } else {
                const h = Math.max(kSmooth - Math.abs(best - d), 0) / kSmooth;
                best = Math.max(best, d) + (h * h * kSmooth) / 4;
            }
        }
        return Math.max(0, best);
    };
    // The root's spine: it leans as it hangs (none unless the shape asks).
    const leanA = (p.lean?.[0] ?? 0) * R;
    const leanB = p.lean?.[1] ?? 0;
    const spineAt = (s) => [Math.cos(leanB) * leanA * s ** 1.6, Math.sin(leanB) * leanA * s ** 1.6];
    // The bed (and how far into it) at a depth below the lip, warped round the isle and dipping.
    const bedAt = (depthBelow, th, x) => {
        const warped = depthBelow + 6 * N.noise3(Math.cos(th) * 1.5, Math.sin(th) * 1.5, 0.3) + 0.123 * x;
        for (let b = 0; b < beds.length; b++) {
            const B = beds[b];
            if (warped < B.bottom) return { B, t: Math.max(0, (warped - B.top) / (B.bottom - B.top)) };
        }
        return { B: beds[beds.length - 1], t: 1 };
    };

    const pos = [];
    const mat = [];
    const ao = [];
    const bed = [];
    const moss = [];
    const push = (x, y, z, m, a, tone, frac, mo) => {
        pos.push(x, y, z);
        mat.push(m);
        ao.push(a);
        bed.push(tone, frac);
        moss.push(mo);
    };
    // Root rings (from the tip up), the rim, then the crown (from the rim in to the summit).
    const rootRings = Math.max(10, Math.round(rings * 0.6));
    const crownRings = Math.max(6, rings - rootRings - 3);
    const depth = p.lip - p.root;
    for (let i = rootRings; i >= 1; i--) {
        const s = 0.985 * (i / rootRings) ** 1.35; // 0 under the rim, ~1 at the tip
        const y = p.lip - 6 - (depth - 6) * s;
        const [sx, sz] = spineAt(s);
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const ux = Math.cos(th);
            const uz = Math.sin(th);
            const k = outlineScale(S, ux, uz, asym) * (1 + spurAt(th) * (1 - smooth(0, 0.18, s)));
            let r = section(ux, uz, s) * k;
            // Ledges: a hard bed's cap stands out, the soft foot under it is cut back.
            const { B, t } = bedAt(p.lip - y, th, ux * r);
            const ledge = 1 + B.hard * (0.05 * (1 - t) ** 4 - 0.04 * smooth(0.75, 1, t)) * (1 - s * 0.6);
            const rib = 1 + 0.12 * (1 - Math.abs(N.noise3(th * 7, y * 0.004, 1.7))) ** 2;
            let cut = 1;
            ravines.forEach((rth) => {
                const d = Math.atan2(Math.sin(th - rth), Math.cos(th - rth));
                cut *= 1 - 0.22 * Math.exp(-((d / 0.12) ** 2)) * (1 - s * 0.5);
            });
            const lumps = 1 + 0.12 * N.fbm3(ux * 2.2 + 7, y * 0.018, uz * 2.2 - 3, 4) * (0.5 + s);
            // The spillway's gorge, cut back into the cliff's top under the notch.
            const gorge = 1 - 0.08 * notchAt(th) * (1 - smooth(0, 0.12, s));
            r = Math.max(0.4, r * ledge * rib * cut * lumps * gorge);
            const shade = (0.92 - 0.35 * s) * (0.75 + 0.25 * smooth(0, 0.05, s));
            push(sx + ux * r, y, sz + uz * r, MAT.iron, shade * (1 - 0.25 * smooth(0.7, 1, t)), B.tone, t, 0);
        }
    }
    // The rim: the cap-rock band set back, the turf's underside, its lip standing out over it.
    const rim = [[0.93, p.lip - 4, 0.55], [1.0, p.lip - 1.5, 0.72], [1.03, p.lip + 0.8, 1]];
    rim.forEach(([q, y, a], j) => {
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const ux = Math.cos(th);
            const uz = Math.sin(th);
            const k = outlineScale(S, ux, uz, asym) * (1 + spurAt(th));
            const wob = 1 + 0.02 * N.noise3(ux * 4, j, uz * 4);
            const nw = notchAt(th);
            const r = q * R * k * wob * (1 - 0.05 * nw);
            const lift = (j === 2 ? 0.6 * N.noise3(ux * 5, 2, uz * 5) : 0) - (p.notch ? p.notch.depth * nw : 0);
            const kind = j === 2 ? MAT.crown : MAT.iron;
            push(ux * r, y + lift, uz * r, kind, a, j === 0 ? 0.92 : -1, 0, j === 2 ? 1 : 0.35);
        }
    });
    // The crown: a dome from the rim in.
    for (let i = 1; i <= crownRings; i++) {
        const q = 1.03 * (1 - (i / (crownRings + 1)) ** 0.85);
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const ux = Math.cos(th);
            const uz = Math.sin(th);
            const k = outlineScale(S, ux, uz, asym) * (1 + spurAt(th));
            const x = ux * q * R * k;
            const z = uz * q * R * k;
            // Exactly the height everything standing on the crown asks for (crownHeight).
            const { y } = crownHeight(p, x, z, { seed, asym, spur });
            push(x, y, z, MAT.crown, 1, -1, 0, 1);
        }
    }
    const rowsN = rootRings + rim.length + crownRings;
    const index = gridIndex(rowsN, cols, true);
    // The summit.
    const centre = pos.length / 3;
    push(0, crownSurface(p, 0, 0) + 0.4, 0, MAT.crown, 1, -1, 0, 1);
    const topRow = (rowsN - 1) * cols;
    for (let c = 0; c < cols; c++) index.push(topRow + ((c + 1) % cols), topRow + c, centre);
    // The deepest lobe's tip.
    const tip = pos.length / 3;
    const [tx, tz] = spineAt(1);
    push(tx, p.root - 4, tz, MAT.iron, 0.45, beds[beds.length - 1].tone, 1, 0);
    for (let c = 0; c < cols; c++) index.push(c, (c + 1) % cols, tip);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
    g.setAttribute('aBed', new THREE.Float32BufferAttribute(bed, 2));
    g.setAttribute('aMoss', new THREE.Float32BufferAttribute(moss, 1));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
}

/**
 * Pinnacles: secondary roots hanging from the underside, so the silhouette below is a broken
 * mountain upside down, not a carrot.
 */
export function buildPinnacles(p, {
    count = 6, seed = 5, radial = 12, rings = 12,
} = {}) {
    const N = makeNoise(seed);
    const depth = p.lip - p.root;
    const pieces = [];
    for (let i = 0; i < count; i++) {
        const th = (i / count) * Math.PI * 2 + N.rand() * 0.9;
        const sTop = 0.12 + N.rand() * 0.3;
        const yTop = p.lip - depth * sTop;
        const at = bodyProfile(p, yTop) * (0.3 + 0.15 * N.rand());
        const len = depth * (0.15 + 0.22 * N.rand());
        const rad = bodyProfile(p, yTop) * (0.22 + 0.12 * N.rand());
        const lean = -0.03 + 0.1 * N.rand();
        const cx = Math.cos(th);
        const cz = Math.sin(th);
        const pos = [];
        const ao = [];
        for (let r = 0; r < rings; r++) {
            const s = r / (rings - 1);
            const y = yTop - len * s;
            const rr = rad * (1 - s) ** 1.3 + 0.2;
            const ox = cx * (at + len * lean * s);
            const oz = cz * (at + len * lean * s);
            for (let c = 0; c < radial; c++) {
                const a = (c / radial) * Math.PI * 2;
                const n = 1 + 0.35 * N.fbm3(Math.cos(a) * 1.5 + i * 3.7, y * 0.03, Math.sin(a) * 1.5, 3);
                pos.push(ox + Math.cos(a) * rr * n, y, oz + Math.sin(a) * rr * n);
                ao.push(0.62 - 0.25 * s);
            }
        }
        const tipI = pos.length / 3;
        pos.push(cx * (at + len * lean), yTop - len - 3, cz * (at + len * lean));
        ao.push(0.35);
        const index = gridIndex(rings, radial, true);
        const last = (rings - 1) * radial;
        for (let c = 0; c < radial; c++) index.push(last + c, tipI, last + ((c + 1) % radial));
        // The rings run downward, so the grid's own winding faces in: turn every triangle over.
        for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
        g.setIndex(index);
        g.computeVertexNormals();
        pieces.push(ensureAttrs(g, MAT.iron));
    }
    const merged = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    return merged;
}

/**
 * The terraces: `count` rimstone shelves fanning down the front of the crown, from the spring near
 * the summit to the rim. Each is a profile swept along a scalloped outline; the curtains are short
 * (about a third of a shelf's depth), so the cascade lies down the slope as kidney-shaped basins.
 * Returns { geometry, pools, levels, outlets } (local space); outlets are points along the lowest
 * lip with their outward direction, where the falls leave.
 */
export function buildTerraces(p, {
    count = 7, segments = 160, seed = 3, span = 0.8, asym = 0.2,
} = {}) {
    const N = makeNoise(seed);
    const S = makeNoise(p.shapeSeed ?? seed + 5);
    const levels = [];
    // Irregular spacing from the spring down to the rim.
    const high = p.top - (p.top - p.lip) * 0.22;
    const h = (high - p.lip) / count;
    let y = high + h * 0.6;
    for (let i = 0; i < count; i++) {
        y -= h * (0.75 + 0.5 * N.rand());
        levels.push(Math.max(p.lip + 0.6, y));
    }
    const pieces = [];
    const pools = [];
    const outlets = [];
    // The profile across a shelf (outward offset o, height relative to the level, AO).
    const profile = (H, depth, fringe) => [
        [-depth, 0.6, 0.55],
        [-depth * 0.55, -0.55, 0.62],
        [-1.4, -0.5, 0.72],
        [-0.6, 0.38, 0.92],
        [0.15, 0.7, 1.0],
        [0.95, 0.5, 1.0],
        [1.5, -0.2, 0.9],
        [1.85, -H * 0.3, 0.72],
        [1.7, -H * 0.62, 0.55],
        [1.0, -H * 0.88, 0.45],
        [0.3, -H - fringe, 0.4],
    ];
    for (let i = 0; i < count; i++) {
        const y0 = levels[i];
        const last = i === count - 1;
        const next = last ? p.lip - 3 : levels[i + 1];
        const H = Math.max(1.6, y0 - next + 0.4);
        // The run between this lip and the next one down the cone.
        const run = Math.max(3, bodyProfile(p, next) - bodyProfile(p, y0));
        const reach = run * (0.4 + 0.35 * N.rand()) + 2;
        const depth = (run + 3) * 1.25;
        // The cascade is a fan down the front from the spring: narrow at the top, wide at the foot,
        // its middle meandering a little.
        const fan = ((span * Math.PI) / 2) * (0.16 + 0.84 * ((i + 1) / count) ** 0.8);
        // The cascade runs on a diagonal: from the spring a little left of the summit down to the
        // right shoulder, where the Mother Fall leaves the lowest lip (it leads the eye into it).
        const mid = -0.12 + 0.42 * (i / Math.max(1, count - 1)) + Math.sin(i * 0.9 + N.rand()) * 0.06;
        const a0 = mid - fan * (0.85 + 0.15 * N.rand());
        const a1 = mid + fan * (0.85 + 0.15 * N.rand());
        const lobes = Math.max(2, Math.round((a1 - a0) * 4.2 + N.rand() * 2));
        const phase = N.rand() * Math.PI * 2;
        const prof = profile(H, depth, last ? 1.6 : 0.8);
        const rows = prof.length;
        // Segments in proportion to this terrace's share of the widest fan (the spring's are short).
        const cols = Math.max(24, Math.round(segments * ((a1 - a0) / (span * Math.PI))));
        const pos = [];
        const ao = [];
        const outline = [];
        for (let c = 0; c < cols; c++) {
            const t = c / (cols - 1);
            const th = a0 + t * (a1 - a0); // 0 = straight at the eye (+z)
            const ends = Math.sin(Math.PI * t) ** 0.5;
            // Kidneys: rounded lobes along the lip, each a little different, each at its own height
            // (the lip steps instead of running level round the isle).
            const lobePos = ((th - a0) / Math.max(1e-3, a1 - a0)) * lobes;
            const scallop = 0.6 + 0.4 * Math.abs(Math.sin(lobePos * Math.PI + phase)) ** 0.6;
            const lobeId = Math.floor(lobePos + phase / Math.PI);
            const step = N.noise3(lobeId * 1.37, i * 2.1, 0.5) * 1.2;
            const wobble = N.fbm3(th * 3.1, i * 0.7, 0.4, 3);
            const k = outlineScale(S, Math.sin(th), Math.cos(th), asym);
            const base = bodyProfile(p, y0) * k * 0.98;
            const r = base + (reach * (0.4 + 0.6 * scallop) + wobble * 2) * ends;
            outline.push([Math.sin(th) * r, Math.cos(th) * r, Math.sin(th), Math.cos(th), ends, scallop, step, th]);
        }
        for (let r = 0; r < rows; r++) {
            const [o, yy0, a] = prof[r];
            const curtain = r >= 6 ? (r - 5) / (rows - 6) : 0;
            for (let c = 0; c < cols; c++) {
                const [x, z, nx, nz, ends, scallop, step, th] = outline[c];
                let yy = yy0;
                // The curtain's fringe: stalactite drops along its foot.
                if (r === rows - 1) yy -= (Math.abs(N.noise3(c * 0.71, i, 3.3)) * 2.5 + scallop * 1.2) * (i === count - 1 ? 1 : 0.35);
                // Fluting: the curtain hangs in folds, deeper toward its foot.
                const flute = curtain * (Math.sin(th * 46 + N.noise3(th * 9, i, 1.1) * 3) * 0.5 + 0.5) * 0.14;
                const oo = (o + flute) * (0.35 + 0.65 * ends);
                pos.push(x + nx * oo, y0 + step * ends + yy * (0.4 + 0.6 * ends), z + nz * oo);
                ao.push(a * (0.7 + 0.3 * ends) * (1 - curtain * 0.12 * (1 - flute / 1.4)));
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
        g.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(MAT.travertine), 1));
        g.setIndex(gridIndex(rows, cols, false));
        g.computeVertexNormals();
        pieces.push(g);
        // The pools: one per lobe, sitting in the shelf behind the lip.
        for (let j = 0; j < lobes; j++) {
            const t = (j + 0.5) / lobes;
            const c = Math.round(t * (cols - 1));
            const [x, z, nx, nz, ends, , step] = outline[c];
            if (ends < 0.4) continue;
            const inset = depth * 0.49;
            const width = (((a1 - a0) * (bodyProfile(p, y0) + reach * 0.75)) / lobes) * 0.55;
            pools.push({
                x: x - nx * inset * (0.35 + 0.65 * ends),
                y: y0 + 0.45 + step * ends,
                z: z - nz * inset * (0.35 + 0.65 * ends),
                radius: Math.min(width, depth * 0.45) * (0.8 + 0.2 * ends),
                level: i,
                nx,
                nz,
            });
        }
        // Where the water leaves the lowest lip.
        if (i === count - 1) {
            for (let c = 0; c < cols; c += 4) {
                const [x, z, nx, nz, ends, , step, th] = outline[c];
                outlets.push({
                    th, x: x + nx * 1.6, y: y0 + step * ends + 0.4, z: z + nz * 1.6, nx, nz,
                });
            }
        }
    }
    const geometry = mergeGeometries(pieces.map((g) => ensureAttrs(g, MAT.travertine)), false);
    pieces.forEach((g) => g.dispose());
    return {
        geometry, pools, levels, outlets,
    };
}

/**
 * Outcrops: weathered boulders half sunk in the turf, breaking the crown's dome (a scale step
 * between the trees and the isle). Seeded spots on the crown, clear of every `avoid` circle
 * ([x, z, r], local metres): the cascade's corridor, the path, the gateway.
 */
export function buildOutcrops(p, count, { seed = 1, avoid = [], groundAt = null } = {}) {
    const rand = mulberry32(seed * 29 + 11);
    const N = makeNoise(seed + 3);
    const ground = groundAt || ((x, z) => crownSurface(p, x, z));
    const R = p.radius;
    const parts = [];
    for (let tries = 0; parts.length < count && tries < count * 40; tries++) {
        const a = rand() * Math.PI * 2;
        const q = 0.22 + rand() * 0.66;
        const x = Math.cos(a) * q * R;
        const z = Math.sin(a) * q * R;
        const r = 2.2 + rand() * 3.2;
        if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar + r)) continue;
        // Faceted, flat-bedded, a little rough: limestone, its top holding a little moss.
        const g = new THREE.IcosahedronGeometry(1, 0);
        g.deleteAttribute('uv');
        const pa = g.attributes.position;
        for (let v = 0; v < pa.count; v++) {
            const k = 1 + 0.35 * N.noise3(pa.getX(v) * 1.3 + parts.length * 3.1, pa.getY(v) * 1.3, pa.getZ(v) * 1.3);
            pa.setXYZ(v, pa.getX(v) * k, Math.min(pa.getY(v) * k * 0.55, 0.42), pa.getZ(v) * k);
        }
        g.scale(r, r, r * (0.7 + rand() * 0.5));
        g.rotateY(rand() * Math.PI);
        // Bedded in the slope: tilted to the turf's own slope round it, sunk to below its widest
        // course (never resting on one point with air under its downhill side).
        const gx = (ground(x + r, z) - ground(x - r, z)) / (2 * r);
        const gz = (ground(x, z + r) - ground(x, z - r)) / (2 * r);
        const up = new THREE.Vector3(-gx, 1, -gz).normalize();
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up));
        g.translate(x, ground(x, z) - r * 0.22, z);
        g.computeVertexNormals();
        const bed = new Float32Array(pa.count * 2);
        for (let v = 0; v < pa.count; v++) {
            bed[v * 2] = 0.95;
            bed[v * 2 + 1] = 0.45;
        }
        g.setAttribute('aBed', new THREE.BufferAttribute(bed, 2));
        parts.push(ensureAttrs(g, MAT.iron, 0.85));
    }
    const geometry = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return geometry;
}

/**
 * Satellites: small rocks hovering off an isle's flanks and under it, each a little massif of its
 * own (a turf cap, beds, a hanging lobe or two), tilted as if adrift: the plainest sign that the isle
 * floats, and a scale step between it and the far archipelago.
 * spots: [x, y, z, radius]: x and z in units of the isle's radius, y and radius in metres (local).
 */
export function buildSatellites(p, spots, { seed = 1, detail = 1 } = {}) {
    const parts = spots.map(([x, y, z, r], i) => {
        const q = {
            radius: r, top: r * 0.24, lip: 0, root: -r * (1.7 + (i % 3) * 0.55), dome: true, knolls: [], lobes: 1 + (i % 2), shapeSeed: seed * 13 + i,
        };
        const g = buildMassif(q, {
            radial: Math.max(8, Math.round(12 * detail)), rings: Math.max(7, Math.round(9 * detail)), seed: seed + i * 5, asym: 0.4,
        });
        g.rotateZ((((i * 0.37) % 1) - 0.5) * 0.5);
        g.rotateX((((i * 0.61) % 1) - 0.5) * 0.4);
        g.rotateY(i * 1.3);
        g.translate(x * p.radius, y, z * p.radius);
        return ensureAttrs(g, MAT.iron);
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return geometry;
}

/**
 * The rimstone cascade: terraces stepping down the crown's front along one curving flow path, from
 * the spring left of the summit to the spillway's notch on the right shoulder, where the Mother Fall
 * leaves. Each terrace is a crescent dam laid across the flow, bowed downstream, its ends curling
 * back up the slope into the turf; its pool brims just over the ground it holds and backs up
 * against the curtain of the dam above, so the steps stack as rimstone does (never as a cake's
 * tiers, never as a heap of dishes). On its downstream face each dam drops a fluted curtain all
 * the way to the slope. The pools are the jewel slots: two or three across each terrace, sized to
 * it and to each other. Rim outlets round the front let the falls
 * leave either shoulder (in the notch, its floor is their lip).
 * `groundAt(x, z)` is the crown's height as its geometry lays it (default: crownSurface);
 * `crownAt(x, z)` the same with whether the point lies on the crown at all ({ y, on }), so every
 * crest keeps a few metres of turf in front of it (default: inside the radius).
 * Returns { geometry, pools, levels, outlets, footprint, flow } (local space; footprint: [x, z, r]
 * circles over every dam and pool; flow: the apron's line, [x, z, half width] points).
 */
export function buildCascade(p, {
    count = 12, radial = 32, seed = 3, endTh = 0.62, startX = -0.12, startZ = -0.06, bend = [0.12, 0.42], groundAt = null,
    crownAt = null,
} = {}) {
    const N = makeNoise(seed);
    const rand = mulberry32(seed * 7 + 1);
    const R = p.radius;
    const ground = groundAt || (crownAt ? (x, z) => crownAt(x, z).y : (x, z) => crownSurface(p, x, z));
    const onCrown = crownAt ? (x, z) => crownAt(x, z).on : (x, z) => Math.hypot(x, z) <= R;
    // Terraces in proportion to the isle (the Spring Isle's are the reference).
    const scaleR = Math.min(1.15, R / 58);
    // The flow path (local x, z), a quadratic curve from the spring into the notch at endTh: it ends
    // well inside the rim as the crown lays it (its outline's stretch), so the last pool spills down
    // the notch's floor to the lip rather than out over the edge.
    const ex = Math.sin(endTh);
    const ez = Math.cos(endTh);
    let rim = R * 0.6;
    while (rim < R * 1.6 && onCrown(ex * (rim + 0.5), ez * (rim + 0.5))) rim += 0.5;
    const P0 = [startX * R, startZ * R];
    const P2 = [ex * rim * 0.8, ez * rim * 0.8];
    const P1 = [bend[0] * R, bend[1] * R];
    const at = (u) => {
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const c = u * u;
        return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1]];
    };
    const tangentAt = (u) => {
        const c0 = at(Math.max(0, u - 0.01));
        const c1 = at(Math.min(1, u + 0.01));
        const l = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) || 1;
        return [(c1[0] - c0[0]) / l, (c1[1] - c0[1]) / l];
    };
    // Each dam's crest: across the flow (s in −1..1), bowed downstream in its middle.
    const dams = [];
    // Uneven steps: some terraces long and still, some crowded where the slope steepens.
    const gaps = Array.from({ length: count }, () => 0.6 + rand() * 0.9);
    const total = gaps.reduce((a, b) => a + b, 0);
    let run = 0;
    for (let i = 0; i < count; i++) {
        run += gaps[i];
        const u = Math.min(1, (run / total) ** 0.92);
        // Each dam lies across the slope's own fall line where it stands (its crest along the
        // contour, as rimstone grows), the terraces stepping down the flow's path.
        const [fx, fz] = tangentAt(u);
        const [px, pz] = at(u);
        const e = 3 * scaleR;
        let tx = -(ground(px + e, pz) - ground(px - e, pz));
        let tz = -(ground(px, pz + e) - ground(px, pz - e));
        const tl = Math.hypot(tx, tz);
        if (tl < 1e-6) {
            tx = fx;
            tz = fz;
        } else {
            tx /= tl;
            tz /= tl;
        }
        // The terraces fan out down the crown, then gather into the notch.
        const d = {
            u, tx, tz, width: (13 + 17 * u) * scaleR * (0.85 + rand() * 0.3) * (1 - 0.4 * smooth(0.7, 1, u)),
        };
        // The terraces step from one side of the flow line to the other, so the cascade fans down
        // the crown as rimstone does (never a ladder of treads in one column).
        const side = (i % 2 ? 1 : -1) * (0.1 + 0.06 * rand()) * d.width;
        const c0 = at(u);
        d.c = [c0[0] - tz * side, c0[1] + tx * side];
        d.sag = d.width * (0.18 + rand() * 0.16);
        const skew = (rand() - 0.5) * 0.4;
        d.crest = (sv) => {
            const along = d.sag * (1 - sv * sv) + skew * sv * d.width * 0.2;
            return [d.c[0] - tz * sv * d.width * 0.5 + tx * along, d.c[1] + tx * sv * d.width * 0.5 + tz * along];
        };
        // The outward (downstream) normal of the crest at sv.
        d.outward = (sv) => {
            const a = d.crest(Math.max(-1, sv - 0.02));
            const b = d.crest(Math.min(1, sv + 0.02));
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            let nx = (b[1] - a[1]) / l;
            let nz = -(b[0] - a[0]) / l;
            if (nx * tx + nz * tz < 0) {
                nx = -nx;
                nz = -nz;
            }
            return [nx, nz];
        };
        dams.push(d);
    }
    dams.forEach((d, i) => {
        // A dam's bowed middle stops well short of the next dam's wings (which stand on its centre
        // line): rimstone dams never run through one another.
        const next = dams[i + 1];
        if (next) {
            const ahead = (next.c[0] - d.c[0]) * d.tx + (next.c[1] - d.c[1]) * d.tz;
            d.sag = Math.min(d.sag, Math.max(0.5, ahead * 0.55));
        }
        // Every crest keeps 3 m of turf in front of it: where it would not, the dam bows less and
        // narrows, then steps back up the flow.
        const fits = () => Array.from({ length: 9 }, (_, k) => -1 + k / 4).every((sv) => {
            const [x, z] = d.crest(sv);
            const [nx, nz] = d.outward(sv);
            return onCrown(x + nx * 3, z + nz * 3);
        });
        for (let k = 0; k < 10 && !fits(); k++) {
            d.sag *= 0.75;
            d.width *= 0.92;
            if (k >= 3) d.c = [d.c[0] - d.tx * 1.5, d.c[1] - d.tz * 1.5];
        }
    });
    // Each pool's level: just over the ground its dam's middle stands on (the lowest turf under the
    // middle half of the crest), never so high that the crest stands more than a couple of metres
    // proud of it, nor over the highest ground it holds; never above the pool upstream of it. Its
    // dish holds it all round (below), or the turf where the slope rises over the dish's rim.
    const levels = [];
    dams.forEach((d, i) => {
        let mid = Infinity;
        let top = -Infinity;
        for (let k = 0; k <= 8; k++) {
            const sv = -0.75 + (1.5 * k) / 8;
            const [x, z] = d.crest(sv);
            const g = ground(x, z);
            top = Math.max(top, g);
            if (Math.abs(sv) <= 0.5) mid = Math.min(mid, g);
        }
        let level = Math.min(top + 0.5, mid + 1.8);
        if (i > 0) level = Math.min(level, levels[i - 1] - 0.6);
        levels.push(level);
    });

    const pieces = [];
    const pools = [];
    // The pools first (each dam's basin floor reaches under its own): up to three jewels across
    // the terrace (each a slot a lock's light can fill), spread over the stretch of crest that
    // holds water (where it stands proud of the turf; the shoulders sunk in the rising slope hold
    // none), set back straight up the flow (the crest's bowed normals would draw them together),
    // each clear of its neighbours, its downstream rim just behind the crest, and kept to where its
    // centre is under water (the rising slope behind swallows its upstream rim).
    const reach = dams.map((d, i) => {
        const level = levels[i];
        const wet = [];
        for (let k = 0; k <= 30; k++) {
            const sv = -0.75 + (1.5 * k) / 30;
            const [x, z] = d.crest(sv);
            wet.push([sv, ground(x, z) < level - 0.4]);
        }
        let s0 = 0;
        let s1 = 0;
        for (let k = 0; k < wet.length;) {
            if (!wet[k][1]) {
                k++;
            } else {
                let e = k;
                while (e + 1 < wet.length && wet[e + 1][1]) e++;
                if (wet[e][0] - wet[k][0] > s1 - s0) [s0, s1] = [wet[k][0], wet[e][0]];
                k = e + 1;
            }
        }
        const span = ((s1 - s0) * d.width) / 2;
        const spots = Math.max(1, Math.min(d.width > 17 * scaleR ? 3 : 2, Math.floor(span / (4 * scaleR))));
        const svs = Array.from({ length: spots }, (_, k) => s0 + ((k + 0.5) / spots) * (s1 - s0));
        const setBack = (sv, radius) => {
            const [nx, nz] = d.outward(sv);
            return (radius * 1.11 + 0.3) / Math.max(0.5, nx * d.tx + nz * d.tz);
        };
        const centreAt = (sv, radius) => {
            const [x, z] = d.crest(sv);
            const back = setBack(sv, radius);
            return [x - d.tx * back, z - d.tz * back];
        };
        const cs = svs.map((sv) => centreAt(sv, 0));
        let gap = spots > 1 ? Infinity : span;
        for (let k = 1; k < cs.length; k++) gap = Math.min(gap, Math.hypot(cs[k][0] - cs[k - 1][0], cs[k][1] - cs[k - 1][1]));
        const most = Math.min((d.width / (spots * 2)) * 1.25, 5.2 * scaleR, gap * 0.5 - 0.1);
        // How far up the flow the dam's basin floor must reach to lie under its pools.
        let far = 2 * scaleR;
        svs.forEach((sv) => {
            let radius = most;
            let [x, z] = centreAt(sv, radius);
            while (radius > 1.2 && ground(x, z) > level - 0.1) {
                radius = Math.max(1.2, radius * 0.85);
                [x, z] = centreAt(sv, radius);
            }
            if (s1 <= s0 || radius < 1.2 || ground(x, z) > level - 0.05) return;
            far = Math.max(far, setBack(sv, radius) + radius * 1.11 + 0.6);
            pools.push({
                x, y: level - 0.05, z, radius, level: i, nx: d.tx, nz: d.tz,
            });
        });
        return far;
    });
    // The dam's section, from the upstream edge of its basin to the foot of its curtain: [out (m,
    // along the crest's outward normal), dy over the level]: a dish of travertine under the pools,
    // its back rim just over the water (where the turf behind lies lower; under the turf where it
    // rises) and its outer edge always under the turf, the floor, the back slope under the water,
    // the lip brimming just over it (so the water shows from a low eye), and a fluted curtain
    // falling to the slope below. Across the flow the dish closes in side rims at its wings, a
    // skirt beyond them always under the turf: the water is held all round, by stone where the
    // turf lies lower, by the turf where it rises over the rims.
    const FLOOR = -0.2;
    const RIM = 0.05;
    dams.forEach((d, i) => {
        const level = levels[i];
        const far = reach[i] / scaleR;
        const section = [[-far - 0.8, RIM], [-far, RIM], [-far * 0.5, FLOOR], [-0.9, FLOOR], [-0.35, -0.12], [0.05, 0.05],
            [0.45, -0.14], [0.68, null], [0.92, null]];
        const curtainRow = section.findIndex(([, dy]) => dy === null);
        const pos = [];
        const ao = [];
        const cols = radial;
        section.forEach(([out, dy], r) => {
            for (let k = 0; k < cols; k++) {
                const sv = (-1 + (2 * k) / (cols - 1)) * 1.12;
                const skirt = Math.abs(sv) > 1.0001;
                const side = smooth(0.85, 1.0, Math.abs(sv));
                let [x, z] = d.crest(sv);
                const [nx, nz] = d.outward(sv);
                // Fluted: the curtain hangs in folds.
                const flute = dy === null ? (Math.sin(sv * 46 + N.noise3(sv * 3, i, 1.1) * 3) * 0.5 + 0.5) * 0.22 : 0;
                x += nx * (out + flute) * scaleR;
                z += nz * (out + flute) * scaleR;
                const g = ground(x, z);
                let y;
                if (dy === null) {
                    // The curtain falls all the way to the slope below it.
                    const t = r === section.length - 1 ? 1 : 0.55;
                    const crestY = level + 0.06;
                    y = Math.min(crestY - 0.3 * t, crestY + (g - 1.5 - crestY) * t);
                } else if (r === 0) {
                    // The basin's outer edge is always under the turf.
                    y = Math.min(level + dy, g - 0.3);
                } else {
                    // The dish's floor rises into its side rims toward the wings.
                    y = level + dy + (Math.max(dy, RIM) - dy) * (r < curtainRow - 1 ? side : 0);
                }
                // Beyond the wings, the skirt runs under the turf.
                if (skirt) y = Math.min(y, level + RIM, g - 0.3);
                // Stone that would graze the turf (and fight it in depth) stands just clear of it
                // where the dish's floor and rims can (still holding the water's edge), or lies just
                // under it.
                if (y > g - 0.3 && y < g + 0.15) {
                    const dish = r > 0 && r < curtainRow && !skirt;
                    y = dish && g + 0.15 <= level + RIM ? g + 0.15 : g - 0.3;
                }
                pos.push(x, y, z);
                let a = r < curtainRow - 3 ? 0.8 : 1.0;
                if (r === curtainRow - 3) a = 0.62;
                if (dy === null) a = 0.72 - 0.15 * (r - curtainRow);
                ao.push(a);
            }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
        // Rows run downstream and columns along +sv, so the grid's own winding faces down: turn
        // every triangle over so the crest and the curtain face the sky and the eye.
        const index = gridIndex(section.length, cols, false);
        for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
        g.setIndex(index);
        g.computeVertexNormals();
        pieces.push(ensureAttrs(g, MAT.travertine));
    });
    // Rim outlets round the front, where the falls leave: on the rim as the crown lays it, on its
    // turf (in the spillway's notch, the notch's floor).
    const outlets = [];
    for (let k = 0; k <= 24; k++) {
        const th = -1.25 + (2.5 * k) / 24;
        const nx = Math.sin(th);
        const nz = Math.cos(th);
        let r = R * 0.6;
        while (r < R * 1.6 && onCrown(nx * (r + 0.25), nz * (r + 0.25))) r += 0.25;
        const y = crownAt ? ground(nx * r, nz * r) - 0.1
            : p.lip + 0.6 - (p.notch ? p.notch.depth * Math.exp(-(((th - p.notch.th) / p.notch.width) ** 2)) : 0);
        outlets.push({
            th, x: nx * (r + 0.3), y, z: nz * (r + 0.3), nx, nz,
        });
    }
    // Down the spillway's notch, from the last terrace's curtain to the Mother Fall's lip: a runnel
    // of travertine where the water runs, fanning out to the fall's width at the lip (a low white
    // ridge on the turf, its edges dropping steeply under it so they never graze it).
    if (p.notch && crownAt) {
        const last = dams[dams.length - 1];
        const [ox, oz] = last.outward(0);
        const [cx0, cz0] = last.crest(0);
        const from = [cx0 + ox * 1.4 * scaleR, cz0 + oz * 1.4 * scaleR];
        const to = outletAt(outlets, p.notch.th);
        const along = 14;
        const across = 7;
        const lx = to.x - from[0];
        const lz = to.z - from[1];
        const ll = Math.hypot(lx, lz) || 1;
        const pos = [];
        for (let i = 0; i <= along; i++) {
            const t = i / along;
            const w = (2.6 + 6 * t ** 1.5) * scaleR;
            for (let j = 0; j < across; j++) {
                const s = -1 + (2 * j) / (across - 1);
                const x = from[0] + lx * t + (-lz / ll) * s * w * 0.5;
                const z = from[1] + lz * t + (lx / ll) * s * w * 0.5;
                pos.push(x, ground(x, z) + 0.3 - 1.2 * s ** 4, z);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('aAO', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(0.9), 1));
        // (Rows run down the notch, columns across it to the flow's left: turned over to face up.)
        const index = gridIndex(along + 1, across, false);
        for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
        g.setIndex(index);
        g.computeVertexNormals();
        pieces.push(ensureAttrs(g, MAT.travertine));
    }
    // The flow line the travertine apron follows: [x, z, half width] along the dams' centres (at
    // most six of them, inside their sunken wings) and on down the runnel to the lip.
    const flow = [];
    const picks = Math.min(6, dams.length);
    for (let k = 0; k < picks; k++) {
        const d = dams[Math.round((k * (dams.length - 1)) / Math.max(1, picks - 1))];
        flow.push([d.c[0], d.c[1], d.width * 0.45]);
    }
    if (p.notch && crownAt) {
        const last = dams[dams.length - 1];
        const [ox, oz] = last.outward(0);
        const [cx0, cz0] = last.crest(0);
        const lip = outletAt(outlets, p.notch.th);
        flow.push([cx0 + ox * 1.4 * scaleR, cz0 + oz * 1.4 * scaleR, 1.5 * scaleR * 2], [lip.x, lip.z, 4 * scaleR]);
    }
    // Circles [x, z, r] covering every dam and pool, to keep the other works off them.
    const footprint = [
        ...dams.flatMap((d) => Array.from({ length: 13 }, (_, k) => [...d.crest(-1 + k / 6), 3 * scaleR])),
        ...pools.map((q) => [q.x, q.z, q.radius + 1]),
    ];
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    return {
        geometry, pools, levels, outlets, footprint, flow, rows: 9, cols: radial,
    };
}

/** The outlet nearest a bearing on the front (radians, 0 at the eye, + to the isle's left x+). */
export function outletAt(outlets, th) {
    let best = outlets[0];
    outlets.forEach((o) => { if (Math.abs(o.th - th) < Math.abs(best.th - th)) best = o; });
    return best;
}

/** An arch outline as a THREE.Shape: two piers and a round arch (optionally broken on the right). */
function archShape(width, height, thick, { broken = false } = {}) {
    const s = new THREE.Shape();
    const w = width / 2;
    const r = w - thick;
    const spring = height - w;
    s.moveTo(-w, 0);
    s.lineTo(-w, spring);
    s.absarc(0, spring, w, Math.PI, broken ? Math.PI * 0.32 : 0, true);
    if (broken) {
        // The break: a ragged edge down into the right pier's stub.
        const a = Math.PI * 0.32;
        s.lineTo(Math.cos(a) * w * 0.86, Math.sin(a) * w * 0.7 + spring);
        s.lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 0.9 + spring);
        s.absarc(0, spring, r, a * 0.98, Math.PI, false);
    } else {
        s.lineTo(w, 0);
        s.lineTo(w - thick, 0);
        s.lineTo(w - thick, spring);
        s.absarc(0, spring, r, 0, Math.PI, false);
    }
    s.lineTo(-w + thick, 0);
    s.lineTo(-w, 0);
    return s;
}

/** An extruded arch (bevelled), standing on y = 0, its face toward +z. */
export function buildArch(width, height, thick, depth, opts = {}) {
    const g = new THREE.ExtrudeGeometry(archShape(width, height, thick, opts), {
        depth,
        bevelEnabled: opts.bevel ?? true,
        bevelThickness: depth * 0.08,
        bevelSize: thick * 0.08,
        bevelSegments: 2,
        curveSegments: opts.curve ?? 28,
    });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    return ensureAttrs(g, opts.mat ?? MAT.masonry);
}

/** The gateway on the Spring Isle's knoll: its proportions (metres). */
export const GATEWAY = Object.freeze({
    span: 11, pier: 3.2, pierH: 13, ring: 2.3, depth: 3.2, plinth: [[22, 0.9, 7], [20.2, 0.8, 6], [18.6, 0.8, 5]], voussoirs: 11,
});

/** A box piece (masonry), centred at (x, y + h/2, z). */
function block(x, y, z, w, h, d, mat = MAT.masonry) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.deleteAttribute('uv');
    g.translate(x, y + h / 2, z);
    return ensureAttrs(g, mat);
}

/**
 * A stone gateway, standing on y = 0, its face toward +z: a stepped plinth, two square piers with
 * impost blocks, and a round arch of separate voussoirs with a keystone standing proud. Its height
 * (the extrados) is gatewayHeight().
 */
export function buildGateway(G = GATEWAY) {
    const parts = [];
    // The footing: the plinth's courses run on down into the levelled ground (never a gap under it).
    const [w0, , d0] = G.plinth[0];
    parts.push(block(0, -2.6, 0, w0 + 0.5, 2.6, d0 + 0.5));
    let y = 0;
    G.plinth.forEach(([w, h, d]) => {
        parts.push(block(0, y, 0, w, h, d));
        y += h;
    });
    const half = G.span / 2;
    const px = half + G.pier / 2;
    [-px, px].forEach((x) => {
        parts.push(block(x, y, 0, G.pier, G.pierH, G.pier * 0.95));
        parts.push(block(x, y + G.pierH, 0, G.pier * 1.22, 0.8, G.pier * 1.12));
    });
    const spring = y + G.pierH + 0.8;
    const rIn = half;
    const rOut = half + G.ring;
    // The voussoirs bear on one another: hairline joints (the masonry's shading draws them), the
    // springers sitting on their imposts.
    const gap = 0.0015;
    for (let j = 0; j < G.voussoirs; j++) {
        const a0 = (j / G.voussoirs) * Math.PI + (j === 0 ? 0 : gap);
        const a1 = ((j + 1) / G.voussoirs) * Math.PI - (j === G.voussoirs - 1 ? 0 : gap);
        const key = j === (G.voussoirs - 1) / 2;
        const out = rOut + (key ? 0.5 : 0);
        const shape = new THREE.Shape();
        shape.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
        shape.lineTo(Math.cos(a0) * out, Math.sin(a0) * out);
        shape.absarc(0, 0, out, a0, a1, false);
        shape.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
        shape.absarc(0, 0, rIn, a1, a0, true);
        const depth = G.depth * (key ? 1.18 : 1);
        const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 3 });
        g.deleteAttribute('uv');
        g.translate(0, spring, -depth / 2);
        const w = mergeVertices(g, 1e-4);
        g.dispose();
        w.computeVertexNormals();
        parts.push(ensureAttrs(w, MAT.masonry));
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return merged;
}

/** The gateway's height to its extrados, and to the underside of its arch (where the bell hangs). */
export function gatewayHeight(G = GATEWAY) {
    const plinth = G.plinth.reduce((a, [, h]) => a + h, 0);
    const spring = plinth + G.pierH + 0.8;
    return { top: spring + G.span / 2 + G.ring, intrados: spring + G.span / 2 };
}

/** A hexahedron from 8 corners (front quad a0 a1 b1 b0 at +z/2, back at −z/2), flat-shaded masonry. */
function hexa(c, mat = MAT.masonry) {
    // c: [x, y] for the 4 front-face corners (counter-clockwise), with depth d and centre z.
    const [q, d, zc = 0] = c;
    const f = q.map(([x, y]) => [x, y, zc + d / 2]);
    const b = q.map(([x, y]) => [x, y, zc - d / 2]);
    const faces = [
        [f[0], f[1], f[2], f[3]], [b[3], b[2], b[1], b[0]],
        [b[0], b[1], f[1], f[0]], [b[1], b[2], f[2], f[1]], [b[2], b[3], f[3], f[2]], [b[3], b[0], f[0], f[3]],
    ];
    const pos = [];
    faces.forEach(([p0, p1, p2, p3]) => pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return ensureAttrs(g, mat);
}

/**
 * The Far Gate: the waterworks of the spring-builders, a colossal gate their water has half grown
 * over. Standing on y = 0, face toward +z, `W` wide and `H` tall: a stepped plinth, two battered
 * eight-sided piers, an impost band, a tall catenary opening framed by its voussoirs and a receding
 * second order, an attic notched at its centre for a weir, its right shoulder broken away, the
 * fallen blocks of that shoulder bedded in the turf in front of it. `groundAt(x, z)`: the ground's
 * height there in the gate's own frame (default: level with the plinth's foot).
 * Returns { geometry, weir: [x, y, z] (the notch's lip, where its water leaves), profile }.
 */
export function buildFarGate(W = 1400, H = 2200, { groundAt = () => 0 } = {}) {
    const parts = [];
    // The footing: the plinth's lowest course runs on down into its mesa.
    parts.push(block(0, -90, 0, W * 1.27, 90, W * 0.47));
    let y = 0;
    [[1.25, 50, 0.45], [1.17, 45, 0.4], [1.1, 40, 0.36]].forEach(([w, h, d]) => {
        parts.push(block(0, y, 0, W * w, h, W * d));
        y += h;
    });
    // The opening stands low enough under the attic that the attic is a real course of masonry.
    const impost = H * 0.55;
    const half = W * 0.2;
    const pierX = W * 0.35;
    // Battered piers: eight-sided and faceted (each face its own plane, so a pier reads in three or
    // four vertical bands of value, never a smooth tube), wider at the foot, standing on a square
    // base and carrying a flared capital under the impost. Each step stands far enough proud of the
    // shaft to read at the gate's distance, and no two faces share a plane.
    const base = H * 0.03;
    const capital = H * 0.035;
    const octagon = (r0, r1, h, at) => {
        const g = new THREE.CylinderGeometry(r1, r0, h, 8, 1, false);
        g.deleteAttribute('uv');
        g.deleteAttribute('normal');
        g.rotateY(Math.PI / 8);
        g.scale(W * 0.13, 1, W * 0.155);
        g.translate(0, at + h / 2, 0);
        const w = g.toNonIndexed();
        g.dispose();
        w.computeVertexNormals();
        return w;
    };
    [-pierX, pierX].forEach((x) => {
        parts.push(block(x, y, 0, W * 0.38, base, W * 0.35));
        const shaft = octagon(1.18, 1, impost - capital - y - base, y + base);
        const cap = octagon(1, 1.22, capital, impost - capital);
        [shaft, cap].forEach((g) => {
            g.translate(x, 0, 0);
            parts.push(ensureAttrs(g, MAT.masonry));
        });
        parts.push(block(x, impost, 0, W * 0.32, H * 0.03, W * 0.36));
    });
    // The opening: a catenary from impost to crown, its voussoirs set along it.
    const spring = impost + H * 0.03;
    const rise = H * 0.28;
    const a = half * 0.55;
    const curve = (t) => {
        const x = -half + 2 * half * t;
        const yy = spring + (rise * (Math.cosh(half / a) - Math.cosh(x / a))) / (Math.cosh(half / a) - 1);
        return [x, yy];
    };
    const ring = W * 0.075;
    const count = 15;
    // The outward normal of the opening's curve (away from the opening: up at the crown).
    const normalAt = (t) => {
        const [x0, y0] = curve(Math.max(0, t - 0.01));
        const [x1, y1] = curve(Math.min(1, t + 0.01));
        const l = Math.hypot(x1 - x0, y1 - y0) || 1;
        return [-(y1 - y0) / l, (x1 - x0) / l];
    };
    const offset = (t, by) => {
        const [x, yy] = curve(t);
        const [nx, ny] = normalAt(t);
        return [x + nx * by, yy + ny * by];
    };
    // Where a stone's bed meets the impost: under its corner, on the springing line.
    const bed = (t, by) => [offset(t, by)[0], spring];
    // Two orders: the voussoirs, and a thinner one set back on their extrados.
    [[0, ring, W * 0.34, 0], [ring, ring * 0.6, W * 0.3, -W * 0.03]].forEach(([from, thick, depth, zc], order) => {
        for (let j = 0; j < count; j++) {
            // The outer order is gone over the broken right shoulder.
            if (order === 1 && j >= count - 4) continue;
            const t0 = j / count + 0.002;
            const t1 = (j + 1) / count - 0.002;
            // The drape from the weir runs on down over the keystones.
            const wet = order === 0 && Math.abs(j - (count - 1) / 2) <= 1;
            const quad = [offset(t0, from), offset(t1, from), offset(t1, from + thick), offset(t0, from + thick)];
            // The springers are bedded flat on their imposts.
            if (j === 0) [quad[0], quad[3]] = [bed(0, from), bed(0, from + thick)];
            if (j === count - 1) [quad[1], quad[2]] = [bed(1, from), bed(1, from + thick)];
            parts.push(hexa([quad, depth, zc], wet ? MAT.travertine : MAT.masonry));
        }
    });
    // The attic over the arch, notched at its centre for the weir; its right shoulder broken.
    const atticBase = spring + rise + ring;
    const notch = W * 0.075;
    const notchY = atticBase + (H - atticBase) * 0.55;
    parts.push(block(-(W * 0.5 + notch) / 2, atticBase, 0, W * 0.5 - notch, H - atticBase, W * 0.34));
    // The wall the orders stand out from: its face well back of the outer order's and the
    // voussoirs' (by more than the depth buffer can tell apart at the gate's distance, so no joint
    // or extrados fights it), its back flush with theirs.
    const wallFront = W * 0.09;
    const back = wallFront + W * 0.17;
    const wallZ = (wallFront - W * 0.17) / 2;
    // The wall over the arch, each side one solid (its outline extruded: pieces side by side would
    // leave their shared faces inside it, and at the gate's distance those fight the face they meet),
    // laid from the springing over the piers and from the outer order's extrados (the voussoirs'
    // own where that order is gone) over the haunches, so nothing bridges air: up to the attic on
    // the left; on the right the shoulder sheared away on a slant (about 35°), down to under half its
    // height outside. Under the notch the wall comes forward to the voussoirs' face in travertine, the
    // drape where the weir's water once ran (and runs on a perfect clear).
    const x0 = half + ring * 0.4;
    const x1 = W * 0.5;
    const shear = Math.tan(0.6);
    const hIn = atticBase - spring;
    const hOut = Math.max(hIn * 0.3, hIn - shear * (x1 - x0));
    const shoulder = (x) => Math.min(H, atticBase + shear * (x0 - x));
    const tAt = (x, by) => {
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 40; k++) {
            const m = (lo + hi) / 2;
            if (offset(m, by)[0] < x) lo = m;
            else hi = m;
        }
        return (lo + hi) / 2;
    };
    // A solid laid on the stones under it follows their flat tops (each stone's chord), not the curve.
    const onChord = (t, by) => {
        const j = Math.min(count - 1, Math.floor(t * count));
        const [ax, ay] = offset(j / count, by);
        const [bx, by2] = offset((j + 1) / count, by);
        const f = t * count - j;
        return [ax + (bx - ax) * f, ay + (by2 - ay) * f];
    };
    const along = (ta, tb, by) => {
        const ts = [ta];
        for (let j = Math.ceil(ta * count + 1e-6); j / count < tb - 1e-6; j++) ts.push(j / count);
        ts.push(tb);
        return ts.map((t) => onChord(t, by));
    };
    const wall = (outline, depth = back, zc = wallZ, mat = MAT.masonry) => {
        const shape = new THREE.Shape(outline.map(([x, yy]) => new THREE.Vector2(x, yy)));
        const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
        g.deleteAttribute('uv');
        g.translate(0, 0, zc - depth / 2);
        g.computeVertexNormals();
        parts.push(ensureAttrs(g, mat));
    };
    const outerEnd = (count - 4) / count;
    // The break: the sheared shoulder is a ruin, not a roof. Right of the notch a lip stands nearly
    // to the attic's top (the weir's water ran between two walls), then the shoulder steps down in
    // ragged courses, treads and risers inscribed under its 35° line, each its own width.
    const lineAt = (x) => (x <= x0 ? shoulder(x) : atticBase + ((spring + hOut - atticBase) * (x - x0)) / (x1 - x0));
    const lipW = W * 0.06;
    const lipY = Math.max(shoulder(notch), H * 0.985);
    const STEPS = 6;
    const edges = [notch + lipW];
    {
        const rnd = mulberry32(77);
        const ws = Array.from({ length: STEPS }, () => 0.7 + 0.6 * rnd());
        const sum = ws.reduce((s, w) => s + w, 0);
        let acc = 0;
        ws.forEach((w) => {
            acc += w;
            edges.push(notch + lipW + ((x1 - notch - lipW) * acc) / sum);
        });
    }
    const stepTop = (x) => {
        for (let k = 0; k < STEPS; k++) if (x <= edges[k + 1]) return lineAt(edges[k + 1]);
        return lineAt(x1);
    };
    // The outline from the outer foot of the break back to the notch: each tread right to left,
    // then up its riser to the next.
    const stairs = [[x1, lineAt(x1)]];
    for (let k = STEPS - 1; k >= 0; k--) {
        stairs.push([edges[k], lineAt(edges[k + 1])]);
        stairs.push([edges[k], k > 0 ? lineAt(edges[k]) : lipY]);
    }
    stairs.push([notch, lipY]);
    // (The outer order's extrados rises over the attic's foot short of the notch: the left wall stops
    // there, its outline a simple polygon, the attic over the rest.)
    let tTop = tAt(-notch, ring * 1.6);
    if (offset(tTop, ring * 1.6)[1] > atticBase) {
        let lo = 0;
        let hi = tTop;
        for (let k = 0; k < 40; k++) {
            const m = (lo + hi) / 2;
            if (onChord(m, ring * 1.6)[1] < atticBase) lo = m;
            else hi = m;
        }
        tTop = lo;
    }
    const leftTop = onChord(tTop, ring * 1.6)[0];
    wall([[-x1, spring], bed(0, ring * 1.6), ...along(0, tTop, ring * 1.6), [leftTop, atticBase], [-x1, atticBase]]);
    wall([...along(tAt(-notch, ring), tAt(notch, ring), ring), [notch, notchY], [-notch, notchY]], W * 0.34, 0, MAT.travertine);
    wall([...along(tAt(notch, ring * 1.6), outerEnd, ring * 1.6), ...along(outerEnd, 1, ring), bed(1, ring), [x1, spring],
        ...stairs]);
    // The weir: a sill of travertine standing out from the drape at the notch's floor, its lip
    // clear of the face the water falls past.
    parts.push(block(0, notchY - H * 0.012, W * 0.18, notch * 2, H * 0.012, W * 0.02, MAT.travertine));
    // The masonry's top over the arch, and what the haunches' fill stands on, at x.
    const topAt = (x) => {
        if (x <= -notch) return H;
        if (x < notch) return notchY;
        return x <= notch + lipW ? lipY : stepTop(x);
    };
    const floorAt = (x) => {
        const by = Math.abs(x) < notch || x > offset(outerEnd, ring * 1.6)[0] ? ring : ring * 1.6;
        return x < offset(0, by)[0] || x > offset(1, by)[0] ? spring : offset(tAt(x, by), by)[1];
    };
    // The crown of the left two thirds: the builders' scalloped rimstone motif along its top edge.
    for (let k = 0; k < 6; k++) {
        const g = new THREE.CylinderGeometry(W * 0.035, W * 0.035, W * 0.3, 8, 1, false, 0, Math.PI);
        g.deleteAttribute('uv');
        g.rotateX(Math.PI / 2);
        g.rotateZ(Math.PI / 2);
        g.translate(-W * 0.5 + W * 0.04 + k * ((W * 0.5 - notch - W * 0.08) / 5), H, 0);
        parts.push(ensureAttrs(g, MAT.masonry));
    }
    // The threshold the water crosses, its front edge just behind the top course's.
    parts.push(block(0, y - 1, W * 0.05, W * 0.34, H * 0.004 + 1, W * 0.25, MAT.travertine));
    // The fallen blocks of the right shoulder lie bedded in the turf in front of the plinth, each
    // sunk until no corner of its underside stands over the ground.
    const undersides = [];
    [[0.42, 0.06, 0.36, 0.4], [0.56, 0.05, 0.33, -0.5], [0.28, 0.045, 0.44, 0.9]].forEach(([fx, s, fz, rot]) => {
        const g = new THREE.BoxGeometry(W * s * 1.6, W * s, W * s * 1.2);
        g.deleteAttribute('uv');
        g.rotateY(rot);
        g.rotateZ(rot * 0.25);
        g.translate(W * fx, 0, W * fz);
        const pa = g.attributes.position;
        let low = Infinity;
        for (let v = 0; v < pa.count; v++) low = Math.min(low, pa.getY(v));
        let lift = Infinity;
        for (let v = 0; v < pa.count; v++) {
            // The underside's corners: the half of the block nearer its lowest corner.
            if (pa.getY(v) < low + W * s * 0.5) lift = Math.min(lift, groundAt(pa.getX(v), pa.getZ(v)) - pa.getY(v));
        }
        g.translate(0, lift - W * s * 0.06, 0);
        for (let v = 0; v < pa.count; v++) {
            if (pa.getY(v) < low + lift - W * s * 0.06 + W * s * 0.5) undersides.push([pa.getX(v), pa.getY(v), pa.getZ(v)]);
        }
        parts.push(ensureAttrs(g, MAT.masonry));
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return {
        geometry: merged,
        weir: [0, notchY, W * 0.19],
        // Its proportions, for the tests: the attic's foot, the notch, the top line and the fill's floor
        // over the arch, the fallen blocks' underside corners.
        profile: {
            spring, atticBase, notch, notchY, topAt, floorAt, undersides,
        },
    };
}

/** A turned stone baluster (a lathe), standing on y = 0 at (x, z), `h` tall. */
function baluster(x, z, h = 0.98) {
    const prof = [[0.12, 0], [0.16, 0.05], [0.1, 0.15], [0.08, 0.3], [0.14, 0.5], [0.15, 0.6], [0.09, 0.75], [0.08, 0.85],
        [0.14, 0.92], [0.12, 1]].map(([r, y]) => new THREE.Vector2(r, y * h));
    const g = new THREE.LatheGeometry(prof, 8);
    g.deleteAttribute('uv');
    g.translate(x, 0, z);
    const w = mergeVertices(g, 1e-4);
    g.dispose();
    w.computeVertexNormals();
    return ensureAttrs(w, MAT.masonry, 0.85);
}

/** A ledge of travertine (the overlook's own ground): its top at y = 0, a ragged lip toward −z. */
function buildLedge(x0, x1, zBack, zFront, seed) {
    const N = makeNoise(seed);
    const g = new THREE.BoxGeometry(x1 - x0, 1.6, zFront - zBack, 24, 2, 4);
    g.deleteAttribute('uv');
    g.translate((x0 + x1) / 2, -0.8, (zBack + zFront) / 2);
    const pa = g.attributes.position;
    for (let v = 0; v < pa.count; v++) {
        const x = pa.getX(v);
        const z = pa.getZ(v);
        if (z < zBack + 0.01) pa.setZ(v, z - 0.6 * Math.abs(N.fbm3(x * 0.35, 0.5, 1.7, 3)) - 0.15 * N.noise3(x * 2.1, 3, 1));
        if (pa.getY(v) > -0.01) pa.setY(v, 0.08 * N.fbm3(x * 0.5, 1.1, z * 0.5, 2));
    }
    const w = mergeVertices(g, 1e-4);
    g.dispose();
    w.computeVertexNormals();
    return ensureAttrs(w, MAT.travertine, 0.8);
}

/** The overlook's parapet (metres): the newel's height, the balusters' count, pitch and height. */
export const PARAPET = Object.freeze({
    newel: 1.5, balusters: 15, pitch: 0.46, baluster: 0.92,
});

/**
 * A low outcrop of the overlook's own travertine, worn round by the weather: a long, flat-topped
 * rock with a bench stepped into its top and its foot run on down out of sight, moss holding on
 * what faces the sky. Its top at about y = `h`, centred on (x, z).
 */
function buildOutcropRock(x, z, len, h, depth, seed) {
    const N = makeNoise(seed);
    const s = new THREE.SphereGeometry(1, 30, 14);
    s.deleteAttribute('uv');
    s.deleteAttribute('normal');
    const g = mergeVertices(s, 1e-4);
    s.dispose();
    const pa = g.attributes.position;
    const moss = new Float32Array(pa.count);
    for (let v = 0; v < pa.count; v++) {
        const ux = pa.getX(v);
        const uy = pa.getY(v);
        const uz = pa.getZ(v);
        const lump = 1 + 0.16 * N.fbm3(ux * 1.4 + 3.1, uy * 1.4, uz * 1.4, 4) + 0.04 * N.noise3(ux * 7, uy * 7, uz * 7);
        let px = ux * len * 0.5 * lump;
        let py = uy >= 0 ? (uy ** 0.6) * h : uy * h * 2.4;
        let pz = uz * depth * 0.5 * lump;
        // Weathered flat on top: the upper cap pressed down into two benches along the rock.
        if (uy > 0.2) {
            const bench = px < len * 0.1 ? 1 : 0.78;
            py = Math.min(py, h * bench + 0.12 * N.noise3(px * 0.6, 1.3, pz * 0.6));
        }
        px += x;
        pz += z;
        pa.setXYZ(v, px, py, pz);
        // Moss in patches on the tops (the bare travertine between), ragged at the scale of a hand.
        moss[v] = uy > 0.45 ? 0.15 + 0.7 * (0.5 + 0.5 * N.noise3(px * 0.45, 7.7, pz * 0.45)) : 0;
    }
    g.computeVertexNormals();
    g.setAttribute('aMoss', new THREE.BufferAttribute(moss, 1));
    return ensureAttrs(g, MAT.travertine, 0.85);
}

/**
 * The overlook's parapet, the eye's own ground at the frame's bottom corners (a human-scale anchor:
 * a baluster a metre tall makes the isles and the gate read huge). `left`: a ledge, a dressed newel
 * post on a moulded base under a stepped cap, and a close-set balustrade running in from the frame's
 * left edge; the
 * right: no masonry beside the HUD, only the overlook's own rock, a low mossy outcrop running out
 * through the frame's edges. Local +x is the frame's right, +z toward the eye; what faces the sky
 * stands in the sun behind the eye, the rest in the overlook's shadow.
 */
export function buildParapet(left = true) {
    const parts = [];
    if (left) {
        parts.push(buildLedge(-11, 1.5, -1.2, 6, 3));
        // The newel: a plinth and a fillet, the shaft, a collar, then the cap stepped out over it
        // (a slab and a thinner one on top), every course a value of its own in the low sun.
        const n = PARAPET.newel;
        parts.push(block(0.25, 0, 0, 0.8, 0.26, 0.8), block(0.25, 0.26, 0, 0.7, 0.06, 0.7));
        parts.push(block(0.25, 0.32, 0, 0.6, n - 0.44, 0.6));
        parts.push(block(0.25, n - 0.12, 0, 0.68, 0.12, 0.68));
        parts.push(block(0.25, n, 0, 0.84, 0.14, 0.84), block(0.25, n + 0.14, 0, 0.66, 0.08, 0.66));
        // The balustrade: a plinth course, the balusters close-set on it, a moulded handrail.
        // (The courses and the rail run on into the newel, never stopping short of it.)
        const run = PARAPET.balusters * PARAPET.pitch + 0.35;
        const cx = -run / 2;
        parts.push(block(cx, 0, 0, run, 0.15, 0.4));
        parts.push(block(cx, 0.15 + PARAPET.baluster, 0, run, 0.07, 0.32));
        parts.push(block(cx, 0.22 + PARAPET.baluster, 0, run, 0.17, 0.42));
        for (let i = 0; i < PARAPET.balusters; i++) {
            const b = baluster(-0.42 - i * PARAPET.pitch, 0, PARAPET.baluster);
            b.translate(0, 0.15, 0);
            parts.push(b);
        }
    } else {
        parts.push(buildOutcropRock(2.6, 0.2, 8.5, 1.0, 4.6, 7));
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    merged.userData.top = left ? PARAPET.newel + 0.22 : 1.4;
    return merged;
}

/**
 * The Twin Isle's aqueduct, the builders' waterworks at the middle rung of the scale ladder: a
 * two-tier arcade running out along the promontory (local −x from x = 0). The lower tier's piers
 * stand on the stone (each foot at `groundAt(x)`, metres relative to the base), a string course over
 * them, the upper tier twice as many arches at half the pitch, the channel on top. The last upper
 * arch has broken away with the channel's end, and the outer pier runs on down the cliff as a
 * tapering buttress snapped off below.
 * Returns { geometry, lip: [x, y, z] } (where the channel's water leaves, local to the base).
 */
export function buildAqueduct(spans, span, lower, upper, depth, groundAt = () => 0) {
    const parts = [];
    const {
        pier, L, stub, top, lip,
    } = aqueductLayout(spans, span, lower, upper);
    // Each tier one wall pierced by its arches (the spandrels laid up solid under the courses above;
    // bays built side by side would share their piers' faces, and those fight in depth). The
    // upper tier's last bay is broken: its ring fallen from the right shoulder in a ragged break
    // that bites into the spandrel but leaves the channel bearing on masonry.
    const arcade = (n, bay, leg, height, d, brokenLast) => {
        const r = (bay - leg) / 2;
        const spring = height - (bay + leg) / 2;
        const x0 = -n * bay - leg / 2;
        const x1 = leg / 2;
        const shape = new THREE.Shape();
        shape.moveTo(x1, 0);
        shape.lineTo(x1, height);
        shape.lineTo(x0, height);
        shape.lineTo(x0, 0);
        for (let i = n - 1; i >= 0; i--) {
            const c = -(i + 0.5) * bay;
            shape.lineTo(c - r, 0);
            shape.lineTo(c - r, spring);
            if (brokenLast && i === n - 1) {
                const bite = (k) => Math.min(height - 0.45, spring + r * k);
                shape.absarc(c, spring, r, Math.PI, Math.PI * 0.62, true);
                [[0.1, 1.04], [0.24, 1.22], [0.36, 1.13], [0.52, 1.34], [0.66, 1.18], [0.8, 0.98], [0.93, 0.62], [1, 0.22]]
                    .forEach(([dx, k]) => shape.lineTo(c + r * dx, bite(k)));
            } else {
                shape.absarc(c, spring, r, Math.PI, 0, true);
            }
            shape.lineTo(c + r, 0);
        }
        shape.lineTo(x1, 0);
        const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 10 });
        g.deleteAttribute('uv');
        g.translate(0, 0, -d / 2);
        g.computeVertexNormals();
        return g;
    };
    parts.push(arcade(spans, span, pier, lower, depth, false));
    // Each pier runs down to the stone under the lowest corner of its footprint, and on into it.
    const footAt = (x) => {
        let low = Infinity;
        for (const dx of [-pier * 0.6, 0, pier * 0.6]) {
            for (const dz of [-depth * 0.55, 0, depth * 0.55]) low = Math.min(low, groundAt(x + dx, dz));
        }
        // (Deep enough for the coarsest tier's facets, which dip below the curve between corners.)
        return Math.min(0, low - 2.2);
    };
    for (let i = 0; i <= spans; i++) {
        const x = -i * span;
        const foot = footAt(x);
        if (foot < -0.05) parts.push(block(x, foot, 0, pier, -foot, depth * 1.05));
    }
    // The string course, the upper tier, the channel.
    parts.push(block(-L / 2, lower, 0, L + pier, 0.9, depth * 1.12));
    const upper2 = arcade(spans * 2, span / 2, pier * 0.6, upper, depth * 0.86, true);
    upper2.translate(0, lower + 0.9, 0);
    parts.push(upper2);
    parts.push(block(-L / 2, top, 0, L + pier * 0.6, 1.3, depth * 0.95));
    // Past the last pier the broken channel reaches on over the edge: a stub on a corbel stepped out
    // of the pier's head, its end snapped off on a slant (where the span's water leaves).
    parts.push(block(-L - stub * 0.3, top - 1.6, 0, stub * 0.6 + pier * 0.5, 1.6, depth * 0.7));
    parts.push(hexa([[[-L - stub, top + 0.2], [-L, top], [-L, top + 1.3], [-L - stub + 0.4, top + 1.3]], depth * 0.95, 0]));
    const merged = mergeGeometries(parts.map((g) => ensureAttrs(g, MAT.masonry)), false);
    parts.forEach((g) => g.dispose());
    return { geometry: merged, lip };
}

/**
 * The bell: a lathe, mouth down, hanging `hang` metres under its hanger at y = 0 by a stem that runs
 * up into the keystone: it swings about the hanger (a pendulum), its crown clear of the soffit at
 * any swing the world gives it. One closed shell (its wall turned round the lip and back up
 * inside), so a swing that shows its mouth shows dark bronze, not sky.
 */
export const BELL_HANG = 1.1;
export function buildBell(size = 3, hang = BELL_HANG) {
    const n = 18;
    const thick = size * 0.05;
    const at = (t) => [size * (0.18 + 0.32 * t ** 1.8 + (t > 0.85 ? (t - 0.85) * 1.6 : 0)), -t * size * 1.25 - hang];
    // A lathe faces out when its profile runs upward: from the inside's crown on the axis, down the
    // inner wall, round the lip, up the outside, the crown, the stem into the stone.
    const pts = [[0, at(1 / n)[1] - thick]];
    for (let i = 1; i <= n; i++) {
        const [r, y] = at(i / n);
        pts.push([r - thick, y]);
    }
    for (let i = n; i >= 0; i--) pts.push(at(i / n));
    pts.push([size * 0.08, 0.02 - hang], [size * 0.08, 0.4], [0, 0.4]);
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20);
    g.computeVertexNormals();
    return ensureAttrs(g, MAT.bronze);
}

/** A small rough blob (the archipelago): an icosphere pushed by fBm, flat-topped, tapering below. */
export function buildBlob(radius, {
    seed = 9, detail = 3, flatTop = 0.4, taper = 1.6,
} = {}) {
    const N = makeNoise(seed);
    const g = icosphere(detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        let x = p.getX(i);
        let y = p.getY(i);
        let z = p.getZ(i);
        const n = N.fbm3(x * 1.7, y * 1.7, z * 1.7, 4);
        const k = 1 + n * 0.55;
        x *= k;
        z *= k;
        y = y > 0 ? y * flatTop * (1 + n * 0.3) : y * taper * (1 + n * 0.7);
        p.setXYZ(i, x * radius, y * radius, z * radius);
    }
    g.computeVertexNormals();
    const mats = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) mats[i] = p.getY(i) > -radius * 0.12 ? MAT.crown : MAT.iron;
    g.setAttribute('aMat', new THREE.BufferAttribute(mats, 1));
    return ensureAttrs(g, MAT.crown);
}

/**
 * A crag: a broken mass of rock, wider than deep, its top jagged, its upward faces mossed.
 * `buried` sinks its lower part (the summit hump sits IN the crown).
 */
export function buildCrag(width, height, depth, { seed = 21, detail = 3, jag = 0.35 } = {}) {
    const N = makeNoise(seed);
    const g = icosphere(detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const n = N.fbm3(x * 1.9 + 1.3, y * 1.9, z * 1.9 - 0.7, 4);
        const k = 1 + n * 0.5;
        // Jagged above: the noise lifts and drops the top; cliffs below.
        const top = y > 0 ? 1 + jag * N.fbm3(x * 3.1, 0.4, z * 3.1, 3) * 2 : 1;
        p.setXYZ(i, x * k * width, y * height * top * (y > 0 ? 1 : 1.2) * (1 + n * 0.3), z * k * depth);
    }
    g.computeBoundingBox();
    // Its sunlit edge is measured from its own top (shadeBelow counts down from there).
    g.userData.top = g.boundingBox.max.y;
    g.computeVertexNormals();
    const mats = new Float32Array(p.count);
    const ao = new Float32Array(p.count);
    const nrm = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
        mats[i] = nrm.getY(i) > 0.45 ? MAT.crown : MAT.iron;
        ao[i] = 0.6 + 0.4 * Math.max(0, Math.min(1, p.getY(i) / height + 0.5));
    }
    g.setAttribute('aMat', new THREE.BufferAttribute(mats, 1));
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    return ensureAttrs(g, MAT.iron);
}

/**
 * Trees: small round crowns of dark leaf, two or three blobs each, standing on the crown at the
 * given local points [x, y, z, size].
 */
export function buildTrees(spots, seed = 41) {
    const N = makeNoise(seed);
    const parts = [];
    spots.forEach(([x, y, z, size], i) => {
        const lobes = 2 + Math.floor(N.rand() * 2);
        for (let k = 0; k < lobes; k++) {
            const g = icosphere(1);
            const pa = g.attributes.position;
            const r = size * (1 - k * 0.22);
            for (let v = 0; v < pa.count; v++) {
                const n = 1 + 0.25 * N.noise3(pa.getX(v) * 2 + i, pa.getY(v) * 2 + k, pa.getZ(v) * 2);
                pa.setXYZ(v, pa.getX(v) * r * n, pa.getY(v) * r * 0.95 * n, pa.getZ(v) * r * n);
            }
            g.translate(x + (N.rand() - 0.5) * size * 0.6, y + size * (0.9 + k * 0.75), z + (N.rand() - 0.5) * size * 0.6);
            g.computeVertexNormals();
            const ao = new Float32Array(pa.count);
            for (let v = 0; v < pa.count; v++) ao[v] = 0.55 + 0.45 * Math.max(0, Math.min(1, (pa.getY(v) - y) / (size * 2.4)));
            g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
            parts.push(ensureAttrs(g, MAT.leaf));
        }
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return merged;
}

/**
 * Strands: moss curtains and roots hanging from the turf's lip, draped over the edge and falling
 * in a slow wave, broad at the lip and tapering to a ragged end (flat ribbons facing out: curtains,
 * never sticks); lushest under the cascade's foot, none in front of the Mother Fall. A few are bare
 * roots (iron-dark, narrow).
 */
export function buildStrands(p, {
    count = 50, seed = 1, asym = 0.2, outletTh = null, lushTh = null,
} = {}) {
    const S = makeNoise(p.shapeSeed ?? seed + 5);
    const N = makeNoise(seed + 13);
    const rand = mulberry32(seed * 29 + 11);
    const R = p.radius;
    const pos = [];
    const mat = [];
    const ao = [];
    const index = [];
    const SEG = 8;
    for (let i = 0; i < count; i++) {
        let th = rand() * Math.PI * 2;
        if (outletTh !== null && Math.abs(Math.atan2(Math.sin(th - outletTh), Math.cos(th - outletTh))) < 0.2) th += 0.42;
        const ux = Math.cos(th);
        const uz = Math.sin(th);
        const k = outlineScale(S, ux, uz, asym);
        // Lush under the cascade's foot.
        const lush = lushTh === null ? 0 : Math.exp(-((Math.atan2(Math.sin(th - lushTh), Math.cos(th - lushTh)) / 0.5) ** 2));
        const root = rand() < 0.25 && lush < 0.5;
        const L = (7 + rand() * 20) * (1 + lush * 1.1) * (root ? 0.8 : 1);
        const width = root ? 0.5 + rand() * 0.4 : (1.5 + rand() * 2.5) * (1 + lush * 0.4);
        const x0 = ux * R * k * 1.0;
        const z0 = uz * R * k * 1.0;
        const y0 = p.lip + 0.3;
        const wave = (rand() - 0.5) * 0.5;
        const phase = rand() * 6.28;
        const base = pos.length / 3;
        for (let sI = 0; sI <= SEG; sI++) {
            const t = sI / SEG;
            // Over the lip and out a little, then hanging, swinging back toward the cliff as it falls.
            const out = 1.4 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) - t * 1.8;
            const side = wave * L * 0.12 * Math.sin(t * 3.0 + phase);
            const cx = x0 + ux * out - uz * side;
            const cz = z0 + uz * out + ux * side;
            const cy = y0 - (t < 0.12 ? t * 6 : 0.72 + ((t - 0.12) * (L - 0.72)) / 0.88);
            // Broad at the lip, tapering, its end ragged.
            const ragged = 1 + 0.35 * N.noise3(i * 1.7, t * 4, 0.5) * t;
            const half = width * 0.5 * (1 - t * 0.82) * ragged;
            for (const sgn of [-1, 1]) {
                pos.push(cx - uz * half * sgn, cy - (sgn > 0 ? 0 : 0.25 * t * L * 0.05), cz + ux * half * sgn);
                mat.push(root ? MAT.iron : MAT.leaf);
                ao.push(0.82 - 0.4 * t);
            }
        }
        for (let sI = 0; sI < SEG; sI++) {
            const a0 = base + sI * 2;
            const a1 = a0 + 1;
            const b0 = a0 + 2;
            const b1 = a0 + 3;
            index.push(a0, a1, b0, a1, b1, b0);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
}

/** A tapered six-sided trunk from (x, y, z) along (dx, dy, dz), as a stone piece (dark bark). */
function buildTrunk(x, y, z, dx, dy, dz, r0, r1, sides = 6) {
    const len = Math.hypot(dx, dy, dz);
    const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
    g.deleteAttribute('uv');
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    g.applyQuaternion(q);
    g.translate(x, y, z);
    const w = mergeVertices(g, 1e-4);
    g.dispose();
    w.computeVertexNormals();
    const ao = new Float32Array(w.attributes.position.count).fill(0.55);
    w.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    return ensureAttrs(w, MAT.iron);
}

/** A leafy lobe: a jittered icosphere scaled (rx, ry, rz) at (x, y, z), shaded darker underneath. */
function leafLobe(N, x, y, z, rx, ry, rz, i) {
    const g = icosphere(1);
    const pa = g.attributes.position;
    const ao = new Float32Array(pa.count);
    for (let v = 0; v < pa.count; v++) {
        const n = 1 + 0.22 * N.noise3(pa.getX(v) * 2.3 + i, pa.getY(v) * 2.3, pa.getZ(v) * 2.3 - i);
        const vy = pa.getY(v);
        pa.setXYZ(v, x + pa.getX(v) * rx * n, y + vy * ry * n, z + pa.getZ(v) * rz * n);
        ao[v] = 0.5 + 0.5 * (vy * 0.5 + 0.5);
    }
    g.computeVertexNormals();
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    return ensureAttrs(g, MAT.leaf);
}

/**
 * A grove: [x, y, z, size, kind] spots on a crown (local metres). kind 0 a cypress spire (a column
 * of stacked lobes, the vertical scale cue), 1 an umbrella pine (a leaning trunk under flat pads),
 * 2 a shrub (a low clump).
 */
export function buildGrove(spots, seed = 41) {
    const N = makeNoise(seed);
    const parts = [];
    spots.forEach(([x, y, z, size, kind], i) => {
        if (kind === 0) {
            const h = size * (3.2 + N.rand() * 1.2);
            parts.push(buildTrunk(x, y - 0.5, z, 0, 1, 0, size * 0.09, size * 0.06));
            const lobes = 6 + Math.floor(N.rand() * 3);
            for (let k = 0; k < lobes; k++) {
                const t = k / (lobes - 1);
                // Overlapping lobes taper to a point: one flame of leaf, not a stack of balls.
                const r = size * (0.58 - 0.42 * t ** 1.3) * (0.92 + N.rand() * 0.16);
                parts.push(leafLobe(
                    N,
                    x + (N.rand() - 0.5) * size * 0.15,
                    y + h * (0.18 + 0.72 * t),
                    z + (N.rand() - 0.5) * size * 0.15,
                    r,
                    r * 1.9,
                    r,
                    i * 7 + k,
                ));
            }
        } else if (kind === 1) {
            const lean = (N.rand() - 0.5) * 0.5;
            const h = size * (2.2 + N.rand() * 0.8);
            const tx = Math.sin(lean) * h * 0.4;
            parts.push(buildTrunk(x, y - 0.5, z, tx, h, tx * 0.3, size * 0.12, size * 0.07));
            const pads = 3 + Math.floor(N.rand() * 3);
            for (let k = 0; k < pads; k++) {
                const a = (k / pads) * Math.PI * 2 + N.rand();
                const off = size * 0.5 * (k ? 1 : 0);
                const r = size * (k ? 0.62 : 0.85);
                parts.push(leafLobe(
                    N,
                    x + tx + Math.cos(a) * off,
                    y + h + (k ? -size * 0.15 : 0),
                    z + tx * 0.3 + Math.sin(a) * off,
                    r,
                    r * 0.55,
                    r,
                    i * 7 + k,
                ));
            }
        } else {
            const r = size * (0.6 + N.rand() * 0.3);
            parts.push(leafLobe(N, x, y + r * 0.35, z, r, r * 0.7, r, i * 7));
        }
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return merged;
}

/**
 * The spots of a crown's grove: cypress and pine groves on the knolls behind the terraces, a few
 * leaning out over the back rim, shrubs along the edges. Never on the cascade's fan (+z front).
 */
export function groveSpots(p, count, seed = 77, build = {}, avoid = []) {
    const rand = mulberry32(seed);
    // Never in the builders' works (the gateway's terrace, the aqueduct's line): [x, z, r] circles.
    const clear = (x, z, r) => !avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar + r);
    // A trunk's foot sinks into the turf wherever it stands, deep enough that the coarsest tier's
    // crown (its facets dip below the curve between their corners) never leaves it on air.
    const footAt = (x, z) => crownHeight(p, x, z, build).y - 1.3;
    const spots = [];
    const R = p.radius;
    // Each tree keeps its own ground: crowns may touch, never fuse into one dark mass (a small
    // isle's grove spreads as wide as a large one's, so its trees stand as far apart).
    const roomy = (x, z, size) => spots.every(([sx, , sz, ss]) => Math.hypot(x - sx, z - sz) >= 0.45 * (size + ss));
    const spread = Math.max(R, 64);
    // And on the crown, a couple of metres in from its edge.
    const inside = (x, z) => {
        const r = Math.hypot(x, z) || 1;
        return crownHeight(p, (x * (r + 2)) / r, (z * (r + 2)) / r, build).on;
    };
    // Groves: a few centres on the back half and the left shoulder, trees gathered round each.
    const groves = Math.max(2, Math.round(count / 5));
    for (let gI = 0; gI < groves && spots.length < count; gI++) {
        const ang = Math.PI * (1.0 + (gI / groves) * 1.0 + rand() * 0.25);
        const rho = R * (0.25 + rand() * 0.5);
        const gx = Math.cos(ang) * rho;
        const gz = Math.sin(ang) * rho;
        const members = Math.min(count - spots.length, 3 + Math.floor(rand() * 4));
        for (let m = 0, tries = 0; m < members && tries < members * 6; tries++) {
            const a = rand() * Math.PI * 2;
            const d = spread * (0.04 + rand() * 0.13);
            const x = gx + Math.cos(a) * d;
            const z = gz + Math.sin(a) * d;
            const roll = rand();
            let kind = roll < 0.55 ? 0 : 1;
            if (roll > 0.85) kind = 2;
            const size = kind === 2 ? 2.5 + rand() * 2 : 5.5 + rand() * 3.5;
            // A tree's crown spreads about half its size round its trunk.
            if (clear(x, z, size * 0.5) && roomy(x, z, size) && inside(x, z)) {
                spots.push([x, footAt(x, z), z, size, kind]);
                m += 1;
            }
        }
    }
    // A pine or two leaning out over the back rim.
    for (let k = 0; k < 2 && spots.length < count; k++) {
        const a = Math.PI * (1.25 + k * 0.4);
        const x = Math.cos(a) * R * 0.9;
        const z = Math.sin(a) * R * 0.9;
        const size = 5 + rand() * 2;
        if (clear(x, z, size * 0.5) && roomy(x, z, size)) spots.push([x, footAt(x, z) - 0.6, z, size, 1]);
    }
    return spots;
}

/**
 * One material for every stone.
 *
 * @param {object} p
 * @param {object} p.U        the world's uniforms
 * @param {object} p.tex      { stone, noise }
 * @param {number} [p.reach=6000]  metres of air before the stone is mostly haze (far isles: less)
 * @param {number} [p.lamps=0]     held pools that light the stone (the Spring Isle's)
 * @param {number} [p.lipY=0]      the local height of the rim (the drips hang from it)
 * @param {number[][]} [p.path]  a worn path over the turf: local [x, z] points, joined in order
 * @param {number[][]} [p.flow]  the cascade's flow line, local [x, z, half width] points: inside it the
 *                               turf gives way to one cream ribbon of travertine, wet in patches
 * @param {number[]} [p.wet]     [bearing, half-width] (radians, as the cascade's outlets): the cliff under
 *                               the lip there is dark and wet where the fall pours past it
 * @param {number} [p.course]    the masonry's course height (metres; 0: no coursing): sized so a
 *                               course stays a few pixels tall at the piece's own distance
 * @param {number} [p.shadeBelow]  if set, everything under this local height lies in the
 *                                 overlook's cast shadow (the foreground crags): only the fill
 *                                 reaches it, and a warm line of sun along its top edge
 * @param {boolean} [p.grounded]   far pieces only: the Deep's mist is measured down from the piece's
 *                                 own ground (its origin, the gate's mesa crown), not from the eye's
 *                                 level, so the plinth it stands on reads and only its cliff melts
 */
export function createStoneMaterial({
    U, tex, reach = 6000, lamps = 0, lipY = 0, shadeBelow = null, far = false, path = null, course = 0, wet = null,
    grounded = false, flow = null,
}) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.colorNode = Fn(() => {
        const { light } = U;
        const N = normalize(normalWorld).toVar();
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P).toVar();
        const dist = length(toEye).toVar();
        const V = toEye.div(dist).toVar();
        const L = U.shadeKey;
        const matId = attribute('aMat', 'float');
        const ao = attribute('aAO', 'float').toVar();
        const lp = positionLocal.toVar();

        // Biplanar reads of the stone field in the isle's own space (it turns with the isle).
        const an = abs(N);
        const sampleStone = (scale) => {
            const a = texture(tex.stone, vec2(lp.x, lp.y).mul(scale));
            const b = texture(tex.stone, vec2(lp.z, lp.y).mul(scale).add(0.37));
            const c = texture(tex.stone, vec2(lp.x, lp.z).mul(scale).add(0.71));
            const wx = an.z.mul(an.z);
            const wz = an.x.mul(an.x);
            const wy = an.y.mul(an.y);
            return a.mul(wx).add(b.mul(wz)).add(c.mul(wy)).div(wx.add(wy).add(wz).add(1e-4));
        };
        const s1 = sampleStone(0.028).toVar();
        const s2 = sampleStone(0.093).toVar();
        const is = (id) => smoothstep(id - 0.5, id - 0.1, matId).mul(float(1.0).sub(smoothstep(id + 0.1, id + 0.5, matId)));

        // ── Albedo ──
        // Travertine: white with rimstone ripples and a warm stain in the hollows.
        const ripple = s2.r.mul(0.5).add(s1.r.mul(0.5));
        const trav = light.stone.mul(float(0.8).add(ripple.mul(0.24))).toVar();
        trav.assign(mix(trav, trav.mul(vec3(0.93, 0.86, 0.76)), smoothstep(0.55, 0.8, s1.b).mul(0.4)));
        // The cliff's beds: dark iron beds and pale warm limestone, each hard cap a bright line over
        // its own shadowed, undercut foot (aBed: the bed's tone, how far down into it; −1 off the cliff).
        const bedA = attribute('aBed', 'vec2');
        const onBed = smoothstep(-0.1, 0.0, bedA.x);
        const cups = smoothstep(0.35, 0.75, s2.g).mul(0.4);
        const rims = smoothstep(0.55, 0.9, s2.b).mul(0.35);
        const ironBed = light.rock.mul(0.82);
        const limeBed = mix(light.rock, light.stone.mul(0.5), 0.38);
        // Most beds are iron; a few pale ones, each fading in and out along the cliff.
        const bedTone = mix(ironBed, limeBed, smoothstep(0.55, 0.8, bedA.x.add(s1.r.sub(0.5).mul(0.35))));
        const capLine = float(1.0).sub(smoothstep(0.03, 0.09, bedA.y)).mul(onBed);
        const foot = smoothstep(0.72, 1.0, bedA.y).mul(onBed);
        const rock = mix(light.rock, bedTone, onBed).mul(float(1.0).sub(cups.mul(0.3)).add(rims.mul(0.22)))
            .mul(float(1.0).add(capLine.mul(0.3)).sub(foot.mul(0.18)))
            .toVar();
        // White mineral drips: long vertical streaks down the cliff, hanging from the rim and the
        // ledges (a biplanar read of the stone's drip channel, streaks 3-4 m wide, tens of metres long).
        const dX = texture(tex.stone, vec2(lp.z.mul(0.006), lp.y.mul(0.0015))).a;
        const dZ = texture(tex.stone, vec2(lp.x.mul(0.006), lp.y.mul(0.0015)).add(0.43)).a;
        const drip = dX.mul(an.x.mul(an.x)).add(dZ.mul(an.z.mul(an.z))).div(an.x.mul(an.x).add(an.z.mul(an.z)).add(1e-3));
        const underLip = smoothstep(-200.0, -12.0, lp.y.sub(lipY));
        const dripMask = smoothstep(0.55, 0.85, drip).mul(underLip).mul(float(1.0).sub(foot.mul(0.6)));
        rock.assign(mix(rock, light.stone.mul(0.5), dripMask.mul(0.32)));
        if (wet) {
            // Under the spillway the cliff runs wet: dark, a little green, for the first tens of metres.
            const off = scWrapPi(atan(lp.x, lp.z).sub(wet[0]));
            const wetK = exp(off.div(wet[1]).pow2().negate()).mul(smoothstep(-60.0, -6.0, lp.y.sub(lipY)))
                .mul(float(1.0).sub(smoothstep(-1.0, 1.5, lp.y.sub(lipY))));
            rock.assign(mix(rock, rock.mul(vec3(0.42, 0.5, 0.46)), wetK.mul(0.85)));
        }
        // Bronze (dark, turned green in the creases) and the ruins' masonry.
        // Bronze: dark, with verdigris run down its faces in streaks (never spots), greener in the creases.
        const verdigris = clamp(smoothstep(0.4, 0.8, drip).mul(float(1.0).sub(an.y)).add(float(1.0).sub(ao).mul(0.5)), 0.0, 1.0);
        const bronze = mix(vec3(0.16, 0.1, 0.05), vec3(0.1, 0.19, 0.15), verdigris).toVar();
        // Masonry: a mid value (the travertine and the falls stay whiter), laid in courses.
        const masonry = light.stone.mul(float(0.5).add(s2.r.mul(0.12))).mul(vec3(0.95, 0.9, 0.84)).toVar();
        if (course > 0) {
            // Ashlar in running bond on the walls (each course's blocks twice as long as it is tall,
            // every other course shifted half a block), paving on the tops; the joints drawn a
            // constant fraction of the course, faded by their own screen width so they never shimmer.
            const flat = smoothstep(0.6, 0.8, an.y);
            const cy = mix(lp.y, lp.z, flat).div(course).toVar();
            const row = floor(cy);
            const along = mix(an.x.greaterThan(an.z).select(lp.z, lp.x), lp.x, flat).div(course * 2.0).add(row.mul(0.5)).toVar();
            const fy = fract(cy);
            const fx = fract(along);
            const jy = min(fy, float(1.0).sub(fy));
            const jx = min(fx, float(1.0).sub(fx)).mul(2.0);
            const wy = fwidth(cy).mul(1.5).add(1e-4);
            const wx = fwidth(along).mul(3.0).add(1e-4);
            const seen = float(1.0).sub(smoothstep(0.08, 0.2, max(wy, wx)));
            const joint = max(float(1.0).sub(smoothstep(0.035, wy.add(0.035), jy)), float(1.0).sub(smoothstep(0.035, wx.add(0.035), jx)))
                .mul(seen);
            const blockTint = scHash21(vec2(row, floor(along)));
            masonry.mulAssign(blockTint.sub(0.5).mul(0.16).add(1.0).mul(float(1.0).sub(joint.mul(0.45))));
        }
        // Rain has run down under every ledge; moss holds on the tops.
        masonry.assign(mix(masonry, masonry.mul(0.72), smoothstep(0.55, 0.85, drip).mul(float(1.0).sub(an.y)).mul(0.6)));
        masonry.assign(mix(masonry, vec3(0.08, 0.12, 0.04), smoothstep(0.65, 0.92, N.y).mul(smoothstep(0.45, 0.7, s1.g)).mul(0.55)));
        // Crown rock: warm stone laid down in strata, a moss on what faces the sky.
        const nA = texture(tex.noise, vec2(lp.x.add(lp.z), lp.y.mul(3.0)).mul(0.004)).r;
        const nB = texture(tex.noise, vec2(lp.x.sub(lp.z), lp.y).mul(0.017)).a;
        const bands = lp.y.mul(0.42).add(nA.mul(9.0)).sin().mul(0.5)
            .add(0.5);
        const crownRock = mix(light.stone.mul(vec3(0.4, 0.32, 0.25)), light.stone.mul(vec3(0.62, 0.52, 0.4)), bands.mul(0.6).add(nB.mul(0.4)))
            .toVar();
        const moss = mix(vec3(0.07, 0.12, 0.035), vec3(0.16, 0.22, 0.06), nB.mul(0.7).add(s1.g.mul(0.3)));
        // Where the iron gives way to the crown's stone, the line wanders with the strata noise.
        const crownK = smoothstep(0.35, 0.65, attribute('aCrown', 'float').add(nA.sub(0.5).mul(0.25))).toVar();
        // Turf where the moss weight says so, its edge ragged at the scale of a tussock; drier and
        // sun-gold on the knolls' crowns, lusher low down.
        const mossW = attribute('aMoss', 'float');
        const mossK = smoothstep(0.42, 0.58, mossW.add(s1.g.sub(0.5).mul(0.5)));
        const turf = mix(moss, moss.mul(vec3(1.5, 1.3, 0.8)), smoothstep(0.75, 0.98, N.y).mul(nA)).toVar();
        // The meadow: broad drifts of dry, sun-gold grass over the open slopes and the knolls,
        // lusher and darker down in the hollows, and a tussock grain at the scale of a stride.
        const drifts = texture(tex.noise, lp.xz.mul(0.022).add(vec2(0.31, 0.77))).r;
        const grain = texture(tex.noise, lp.xz.mul(0.23).add(vec2(0.53, 0.11))).a;
        const dry = smoothstep(0.42, 0.8, drifts.add(N.y.sub(0.93).mul(1.2))).mul(0.45);
        turf.assign(mix(turf, vec3(0.24, 0.22, 0.09), dry));
        turf.mulAssign(grain.sub(0.5).mul(0.3).add(1.0).mul(mix(float(0.62), float(1.0), smoothstep(0.35, 0.85, ao))));
        if (path && path.length > 1) {
            // The worn path: pale earth and stone, its line wandering a little, its edges frayed.
            const at = lp.xz.add(vec2(nA.sub(0.5), nB.sub(0.5)).mul(3.0)).toVar();
            const d = float(1e4).toVar();
            for (let k = 0; k < path.length - 1; k++) {
                const a = vec2(path[k][0], path[k][1]);
                const ab = vec2(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
                const t = clamp(dot(at.sub(a), ab).div(dot(ab, ab)), 0.0, 1.0);
                d.assign(min(d, length(at.sub(a.add(ab.mul(t))))));
            }
            const worn = float(1.0).sub(smoothstep(1.0, 2.6, d.add(grain.sub(0.5).mul(1.2)))).mul(smoothstep(0.55, 0.8, N.y));
            turf.assign(mix(turf, light.stone.mul(vec3(0.42, 0.4, 0.36)).mul(grain.mul(0.25).add(0.85)), worn.mul(0.7)));
        }
        if (flow && flow.length > 1) {
            // The travertine apron: the water has laid its own white stone all down the cascade's
            // line, one cream ribbon from the spring to the Mother Fall's lip that the dams stand in
            // (the Pamukkale read), wet and ochre in patches, its edge frayed into the turf.
            const at = lp.xz.add(vec2(nA.sub(0.5), nB.sub(0.5)).mul(2.5)).toVar();
            const inside = float(1e4).toVar();
            for (let k = 0; k < flow.length - 1; k++) {
                const a = vec2(flow[k][0], flow[k][1]);
                const ab = vec2(flow[k + 1][0] - flow[k][0], flow[k + 1][1] - flow[k][1]);
                const t = clamp(dot(at.sub(a), ab).div(dot(ab, ab)), 0.0, 1.0);
                const hw = mix(float(flow[k][2]), float(flow[k + 1][2]), t);
                inside.assign(min(inside, length(at.sub(a.add(ab.mul(t)))).div(hw)));
            }
            const apron = float(1.0).sub(smoothstep(0.72, 1.0, inside.add(grain.sub(0.5).mul(0.25)))).mul(smoothstep(0.3, 0.55, N.y));
            const wetStone = mix(trav.mul(1.06), trav.mul(vec3(0.86, 0.74, 0.55)), smoothstep(0.55, 0.8, s1.b).mul(0.7));
            turf.assign(mix(turf, wetStone, apron));
        }
        crownRock.assign(mix(crownRock, turf, max(mossK, smoothstep(0.5, 0.78, N.y).mul(smoothstep(0.25, 0.55, nA.add(0.2))))));
        // Leaf: dark green crowns, warmer where the sun catches them.
        const leaf = mix(vec3(0.02, 0.05, 0.025), vec3(0.06, 0.1, 0.03), s2.r);
        const albedo = trav.toVar();
        albedo.assign(mix(albedo, mix(rock, crownRock, crownK), is(1)));
        albedo.assign(mix(albedo, bronze, is(2)));
        albedo.assign(mix(albedo, masonry, is(3)));
        albedo.assign(mix(albedo, leaf, smoothstep(4.5, 4.9, matId)));
        const ironK = is(1).mul(float(1.0).sub(crownK)).toVar();
        // By moonlight the eye sees little colour: the turf and the stone go toward grey.
        albedo.assign(mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, U.albedoSat));
        // Moss reaches over any stone where the weight says so, and creeps down the cliff from the
        // rim in ragged tongues (longest in the grooves, never on what faces down).
        const tongue = s1.g.mul(18.0).add(s2.r.mul(10.0)).add(4.0);
        const creep = float(1.0).sub(smoothstep(tongue.mul(0.6), tongue, float(lipY).sub(lp.y))).mul(ironK)
            .mul(smoothstep(-0.35, 0.1, N.y))
            .mul(smoothstep(0.35, 0.6, s2.g.add(s1.b.mul(0.3))));
        albedo.assign(mix(albedo, turf, max(mossK.mul(float(1.0).sub(is(1).mul(crownK))), creep).mul(float(1.0).sub(smoothstep(4.5, 4.9, matId)))));

        // ── Light: the key from behind the eye, a cool fill from the sky on the shadow side ──
        const ndl = dot(N, L);
        const nv = clamp(dot(N, V), 0.0, 1.0);
        const sun = float(1.0).toVar();
        if (shadeBelow !== null) {
            // In the overlook's shadow, but the low sun behind the eye still finds every face turned
            // up to the sky (the cap, the handrail, the rock's mossy top) and the grazing edges.
            const grazing = smoothstep(0.6, 0.92, float(1.0).sub(nv)).mul(smoothstep(0.15, 0.5, N.y))
                .mul(smoothstep(shadeBelow - 3.0, shadeBelow, lp.y));
            sun.assign(max(grazing, smoothstep(0.5, 0.85, N.y).mul(0.85)));
        }
        // (At the rose and pearl hours the Earth's shadow climbs the stone: only what stands above
        // its terminator, the crowns and the gate's attic, still takes the key, and burns with the
        // last light: the alpenglow.)
        const sunlit = earthShadowAt(P, U).toVar();
        sun.mulAssign(sunlit.mul(sunlit.mul(U.term).mul(0.4).add(1.0)));
        const diffuse = scWrap(ndl, float(0.08)).mul(ao).mul(sun).toVar();
        const skyUp = skyBase(normalize(N.add(vec3(0.0, 0.6, 0.0))), U);
        const fill = mix(light.shadow, skyUp, N.y.mul(0.25).add(0.3)).mul(ao.mul(0.75).add(0.25)).mul(0.4).toVar();
        // In the Earth's shadow the stone still faces the bright sunset sky behind the eye: a warm
        // dusk glow (never the key's own light) keeps the shadowed cliffs from going black.
        const dusk = float(1.0).sub(sunlit).mul(U.term).mul(max(nv, 0.3));
        fill.addAssign(light.key.mul(U.keyGain).mul(dusk).mul(0.07));
        if (shadeBelow !== null) {
            // The shade is weathered stone, never the card's navy: the sunlit floor of the overlook
            // throws a warm bounce up into it, and the bright sky behind the eye lights what faces it.
            fill.mulAssign(1.3);
            // (The bounce at half the key's chroma: at the rose hour the full key turns the shade salmon.)
            const bounce = mix(vec3(dot(light.key, vec3(0.2126, 0.7152, 0.0722))), light.key, 0.5);
            fill.addAssign(bounce.mul(U.keyGain).mul(float(1.0).sub(N.y.mul(0.5))).mul(0.035));
            fill.addAssign(light.horizon.mul(U.keyGain).mul(nv.mul(0.5).add(0.5)).mul(0.03));
            fill.mulAssign(U.coulisse.mul(5.0).add(1.0));
        }
        // The turf's lip overhangs the cliff: a band of cast shadow right under it (soft-edged, its
        // depth wandering with the stone), and the root a little dimmer for its first tens of metres.
        const below = lp.y.sub(lipY);
        const lipShade = float(1.0).sub(smoothstep(-13.0, -5.0, below.add(s1.r.sub(0.5).mul(5.0))).mul(smoothstep(0.5, -1.5, below))
            .mul(0.62));
        const ironDim = mix(float(1.0), float(0.84), ironK.mul(smoothstep(-40.0, -10.0, below)));
        const lit = light.key.mul(U.keyGain).mul(diffuse).mul(0.66).mul(ironDim)
            .mul(mix(float(1.0), lipShade, ironK));
        const col = albedo.mul(lit.add(fill.mul(ironDim))).toVar();
        // Cavities hold the shadow colour, never black.
        col.assign(mix(col, light.shadow.mul(albedo).mul(0.9), cups.mul(ironK).mul(0.35)));
        // A thin rim of sky only where a form turns away from the key (the shadow side): the sky
        // it faces, never the key's colour.
        const away = float(1.0).sub(smoothstep(-0.1, 0.35, ndl));
        const rimTerm = pow(float(1.0).sub(nv), 3.0).mul(0.35).mul(away);
        const faced = normalize(vec3(N.x, max(N.y, 0.05), N.z));
        col.addAssign(horizonHaze(faced, U).mul(albedo.mul(0.5).add(0.25)).mul(rimTerm).mul(ao));
        // Bronze takes a glint of the key.
        const H = normalize(L.add(V));
        const spec = pow(clamp(dot(N, H), 0.0, 1.0), 40.0).mul(is(2));
        col.addAssign(light.key.mul(U.keyGain).mul(spec).mul(0.8).mul(sun));

        // ── Held pools light the stone round them in their colour (the curtain under them most) ──
        for (let i = 0; i < lamps; i++) {
            const a = U.lamps.element(i * 2);
            const b = U.lamps.element(i * 2 + 1);
            const toL = a.xyz.sub(P);
            const d2 = dot(toL, toL);
            const fall = exp(d2.div(max(a.w.mul(a.w), 1.0)).negate());
            const facing = clamp(dot(N, toL.div(sqrt(max(d2, 1e-4)))).mul(0.5).add(0.6), 0.0, 1.0);
            col.addAssign(albedo.mul(b.xyz).mul(b.w.mul(fall).mul(facing).mul(0.5)));
        }

        // The luminous Deep below throws its light up under every overhang.
        col.addAssign(albedo.mul(light.mistLit).mul(clamp(N.y.negate(), 0.0, 1.0).mul(0.3)).mul(ao.mul(0.6).add(0.4)));

        // ── The air between ──
        if (far) {
            // Far pieces: the optical depth of the air along the ray (thinning with height) and of
            // the Deep's mist (thickening below the eye), so a colossus fades from its foot up and
            // its roots melt into exactly what is behind them; above the eye it keeps a floor of
            // its own values (a painter's two or three planes, never a ghost).
            const y0 = cameraPosition.y;
            const y1 = P.y;
            const dy = y1.sub(y0);
            const hs = 2500.0;
            const mAir = abs(dy).lessThan(4.0).select(
                exp(y0.div(-hs)),
                exp(y0.div(-hs)).sub(exp(y1.div(-hs))).mul(hs).div(dy),
            );
            const yM = grounded ? y1.sub(modelPosition.y).toVar() : y1;
            const deep = max(yM.negate(), 1.0);
            const mMist = smoothstep(0.0, -20.0, yM).mul(float(1.0).sub(float(400.0).mul(float(1.0).sub(exp(min(yM, 0.0).div(400.0)))).div(deep)));
            const tau = dist.mul(mAir.div(10000.0).add(mMist.div(3200.0)));
            // (Never all veil: even the farthest root keeps a trace of its own value, so the bands
            // of the archipelago stack by value instead of collapsing into one flat ghost.)
            const T = max(exp(tau.negate()), smoothstep(-10.0, 40.0, yM).mul(0.1).add(0.12));
            const viewDir = V.negate();
            // The air in front of a far piece is what stands behind it, a few shades darker (the
            // piece always reads as a plane of its own, never a pale ghost): the sky above the
            // horizon, the cloud sea below it.
            const skyBehind = mix(airColour(viewDir, U), skyBase(viewDir, U), smoothstep(0.02, 0.3, viewDir.y)).mul(0.86);
            const veil = mix(seaTone(viewDir, U).mul(0.9), skyBehind, smoothstep(-0.02, 0.02, viewDir.y));
            col.assign(mix(veil, col, T));
            return vec4(col, 1.0);
        }
        const air = float(1.0).sub(exp(dist.div(-reach))).toVar();
        const farAir = airColour(V.negate(), U);
        // The silhouettes soften into the air a little (a form's edge holds less of its own value).
        col.assign(mix(col, farAir, pow(float(1.0).sub(nv), 3.0).mul(0.18)));
        col.assign(mix(col, farAir, min(air, 0.9)));
        // The roots dissolve into the Deep's mist as they hang down toward it (into the sea behind
        // them, never paler than it): the isles float.
        const mist = smoothstep(-110.0, -290.0, P.y).mul(0.85);
        col.assign(mix(col, seaTone(V.negate(), U), mist));
        return vec4(col, 1.0);
    })();
    return material;
}

/** A material for the far isles (the archipelago, the Far Gate): stone shading, more air. */
export function createFarStoneMaterial({
    U, tex, reach = 4200, grounded = false,
}) {
    return createStoneMaterial({
        U, tex, reach, far: true, grounded,
    });
}

export const _internals = {
    bodyProfile, makeNoise, archShape, outlineScale,
};

/** The stone kinds by name (tests check the ids stay put). */
export const STONE_KINDS = Object.freeze(['travertine', 'iron-stone', 'bronze', 'masonry', 'crown', 'leaf']);

// ── Where things stand on the isles (local metres) ──

/**
 * The isles' shapes: the plan's sizes, crowned with domes and the knolls behind their terraces (the
 * summit, the arch's knoll), and the lobes they hang below.
 */
export function isleShapes(plan) {
    return {
        spring: {
            ...plan.spring,
            dome: true,
            knolls: [[-0.1, -0.32, 9, 0.3], [-0.42, -0.12, 6, 0.22], [0.32, -0.45, 4, 0.2]],
            // The root's hanging masses on the silhouette's bearings (left, right, behind; never on
            // the Mother Fall's, body bearing about 0.95), its spine leaning back-left as it hangs.
            lobes: [
                {
                    phi: Math.PI + 0.15, off: 0.55, w: 0.62, end: 0.55, power: 1.25, shoulder: 2,
                },
                {
                    phi: -0.2, off: 0.5, w: 0.5, end: 0.42, power: 1.25, shoulder: 2,
                },
                {
                    phi: -Math.PI / 2 - 0.3, off: 0.5, w: 0.55, end: 0.5, power: 1.25, shoulder: 2,
                },
            ],
            lean: [0.25, Math.PI + 0.3],
            // The spillway: a notch cut in the rim where the Mother Fall leaves (bearing as the
            // cascade's outlets: 0 toward the eye), a gorge under it.
            notch: { th: 0.62, depth: 5, width: 0.1 },
            // The gateway's terrace: the builders levelled the knoll's top for its plinth.
            pads: [{
                x: -plan.spring.radius * 0.42, z: -plan.spring.radius * 0.12, rx: 13.5, rz: 7, fall: 8,
            }],
        },
        twin: {
            ...plan.twin, dome: true, knolls: [[0.2, -0.3, 4, 0.3]], lobes: 2, terraces: 4,
        },
    };
}

/** How the Spring and Twin Isles' bodies are grown (their anchors need the same outline). */
const SPRING_BUILD = Object.freeze({ seed: 33, asym: 0.2, spur: null });
const TWIN_BUILD = Object.freeze({ seed: 71, asym: 0.2, spur: [Math.PI, 0.45, 0.35] });
/** How the Far Gate's mesa is grown (its fallen blocks bed in the same turf). */
export const GATE_BUILD = Object.freeze({ seed: 123, asym: 0.08 });

/** The Far Gate's mesa, broad enough that the plinth stands on it end to end. */
export const gateMesa = (gateP) => ({
    top: 0, lip: -60, root: -gateP.height * 0.55, radius: gateP.width * 0.8, terraces: 0, crownPower: 0.25,
});

/**
 * The aqueduct's own measures (local to its base, running toward −x): its length to the last pier,
 * the broken channel stub that reaches on past it over the edge, and the stub's end, where the
 * span's water leaves. buildAqueduct and the anchors both read them.
 */
export function aqueductLayout(spans, span, lower, upper) {
    const pier = span * 0.22;
    const L = spans * span;
    const stub = span * 0.6;
    const top = lower + 0.9 + upper;
    return {
        pier, L, stub, top, lip: [-(L + stub) + 0.3, top + 1.3, 0],
    };
}

/**
 * The anchors of the set pieces on the isles, local to each isle: the bell-arch and its bell on the
 * Spring Isle's left shoulder, the summit hump behind it, the aqueduct on the Twin Isle and the end
 * of its broken channel (where the span's fall leaves).
 */
export function isleAnchors(plan) {
    const { spring: sp, twin: tw } = isleShapes(plan);
    const archX = -sp.radius * 0.42;
    const archZ = -sp.radius * 0.12;
    const archY = crownHeight(sp, archX, archZ, SPRING_BUILD).y - 0.15;
    const gh = gatewayHeight();
    const arch = {
        x: archX, y: archY, z: archZ, width: GATEWAY.span + 2 * GATEWAY.pier, height: gh.top, thick: gh.top - gh.intrados, depth: GATEWAY.depth,
    };
    // The aqueduct runs from the crown out along the promontory (local −x), its piers on the stone.
    const crownAt = (x, z) => massifCrownAt(tw, x, z, { seed: TWIN_BUILD.seed, asym: TWIN_BUILD.asym, spur: TWIN_BUILD.spur }).y;
    // It starts on the crown beside the cascade's head and runs out along the promontory's own axis
    // (local −x, where every tier's crown has a vertex at the tip) to its tip: its last pier stands on
    // the stone a few metres inside the rim, and only its broken channel reaches on over the edge.
    const x0 = -tw.radius * 0.34;
    const z0 = 0;
    let rim = tw.radius;
    for (let d = 0; d < tw.radius * 3; d += 0.5) {
        if (!massifCrownAt(tw, x0 - d, z0, TWIN_BUILD).on) {
            rim = d;
            break;
        }
    }
    const reach = Math.max(24, rim - 4.0);
    const spans = Math.max(3, Math.min(5, Math.round(reach / 10.5)));
    const aq = {
        x: x0, y: 0, z: z0, spans, span: reach / spans, lower: 12, upper: 6, depth: 4,
    };
    // It comes out of the hill: its first arches stand a little into the rising crown, and its piers
    // grow taller only by part of the fall toward the rim (an aqueduct leaving its hill on arches).
    const startY = crownAt(aq.x, aq.z);
    const endY = crownAt(aq.x - aq.spans * aq.span, aq.z);
    aq.y = startY - 0.6 - 0.3 * Math.max(0, startY - endY);
    aq.groundAt = (x, dz = 0) => crownAt(aq.x + x, aq.z + dz) - aq.y;
    const { lip } = aqueductLayout(aq.spans, aq.span, aq.lower, aq.upper);
    return {
        arch,
        // Hung from the keystone's soffit (the hanger, the swing's pivot): buildBell hangs below it.
        bell: { x: archX, y: archY + arch.height - arch.thick, z: archZ },
        hump: {
            x: -sp.radius * 0.18, y: crownSurface(sp, -sp.radius * 0.18, -sp.radius * 0.26) - 4, z: -sp.radius * 0.26,
        },
        aqueduct: aq,
        spanLip: { x: aq.x + lip[0], y: aq.y + lip[1], z: aq.z },
    };
}

// ── The part: every stone, placed per layout ──

const tmpQ = new THREE.Quaternion();
const pitchQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const rollQ = new THREE.Quaternion();
const swingQ = new THREE.Quaternion();
const bellQ = new THREE.Quaternion();
const bellWorld = [0, 0, 0];

/** The rotation of a placement entry: its yaw (turning +z to the eye), then its pitch toward it. */
export function entryQuaternion(e, out = new THREE.Quaternion()) {
    out.setFromAxisAngle(AXIS_Y, e.yaw);
    pitchQ.setFromAxisAngle(AXIS_X, e.pitch || 0);
    return out.multiply(pitchQ);
}

/** A local point of a placed entry, in the world. */
export function entryToWorld(e, x, y, z, out = [0, 0, 0]) {
    entryQuaternion(e, tmpQ);
    tmpP.set(x, y, z).multiplyScalar(e.scale).applyQuaternion(tmpQ);
    out[0] = tmpP.x + e.pos[0];
    out[1] = tmpP.y + e.pos[1];
    out[2] = tmpP.z + e.pos[2];
    return out;
}

/**
 * The far isles: five shapes at unit radius (a squat mesa, a needle, a twin-lobed isle, one with a
 * clump of trees, one with a ruined pier), each a miniature massif of its own, so the archipelago
 * is a family, not a fence of one blob.
 */
export const FAR_UNIT = 100;

/** The far isles' five builds (each at FAR_UNIT metres of radius), and how each is grown. */
export const FAR_SHAPES = Object.freeze([
    // [top, root, lobes] (the lip at 0)
    [12, -150, 2], [18, -330, 1], [15, -210, 3], [22, -250, 2], [10, -180, 2],
].map(([top, root, lobes], v) => Object.freeze({
    p: {
        top, lip: 0, root, lobes, radius: FAR_UNIT, dome: true, knolls: [[0.2, -0.2, 6, 0.3]], shapeSeed: 300 + v,
    },
    build: { seed: 200 + v * 7, asym: 0.35 },
})));
/** A grove on the fourth far isle ([x, z, size, kind]), a ruined pier on the fifth ([x, z, width]). */
export const FAR_GROVE = Object.freeze([[-20, -20, 9, 0], [5, -30, 10, 0], [-35, 5, 8, 1]]);
export const FAR_RUIN = Object.freeze([35, -10, 14]);

export function buildFarIsles(detail = 1) {
    const radial = Math.max(10, Math.round(14 * detail));
    const rings = Math.max(8, Math.round(10 * detail));
    // Built at FAR_UNIT metres of radius (the cliff's beds and the rim are in metres), scaled at placement.
    return FAR_SHAPES.map(({ p, build }, v) => {
        const parts = [buildMassif(p, { radial, rings, ...build })];
        // (The ruin's and the grove's feet stand on the same build.)
        const ground = (x, z) => crownHeight(p, x, z, build).y;
        if (v === 3) parts.push(buildGrove(FAR_GROVE.map(([x, z, size, kind]) => [x, ground(x, z) - 1, z, size, kind]), 90));
        if (v === 4) {
            const [x, z, w] = FAR_RUIN;
            const h = w / 2;
            const y0 = Math.min(ground(x - h, z), ground(x + h, z), ground(x, z - h), ground(x, z + h)) - 1;
            parts.push(block(x, y0 - 2, z, w, 50, w), block(x, y0 + 48, z, 30, 6, 16));
        }
        const g = mergeGeometries(parts.map((q) => ensureAttrs(q, MAT.iron)), false);
        parts.forEach((q) => q.dispose());
        return g;
    });
}

/** The worn path over the Spring Isle's crown, from the rim past the gateway's door to the spring: local [x, z]. */
export function springPath(plan) {
    const { spring: sp } = isleShapes(plan);
    const { arch } = isleAnchors(plan);
    const R = sp.radius;
    return [[-0.46 * R, 0.86 * R], [-0.36 * R, 0.4 * R], [arch.x + 1, arch.z + arch.depth * 0.5 + 2], [-0.12 * R, -0.06 * R]];
}

/** An isle's rimstone cascade ('spring' | 'twin') as the world builds it on a tier. */
export function isleCascade(plan, tier, name) {
    const p = isleShapes(plan)[name];
    const build = name === 'spring' ? SPRING_BUILD : TWIN_BUILD;
    const segments = name === 'spring' ? tier.terraceSegments : Math.round(tier.terraceSegments * 0.4);
    return buildCascade(p, {
        count: p.terraces * 2,
        radial: Math.max(12, Math.round(segments / 7)),
        seed: build.seed + 11,
        endTh: 0.62,
        crownAt: (x, z) => massifCrownAt(p, x, z, build),
    });
}

/** Circles [x, z, r] every few metres along a path's segments (not only at its corners). */
const alongPath = (path, r) => path.slice(1).flatMap(([x1, z1], k) => {
    const [x0, z0] = path[k];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.5));
    return Array.from({ length: steps + 1 }, (_, j) => [x0 + ((x1 - x0) * j) / steps, z0 + ((z1 - z0) * j) / steps, r]);
});

/**
 * The outcrops on the Spring Isle's crown as the world builds them on a tier: clear of every dam
 * and pool of its cascade (`cascade`, isleCascade's), the path and the gateway.
 */
export function springOutcrops(plan, tier, cascade) {
    const { spring: p } = isleShapes(plan);
    const { arch: a } = isleAnchors(plan);
    return buildOutcrops(p, tier.outcrops ?? 10, {
        seed: 7,
        avoid: [...cascade.footprint, ...alongPath(springPath(plan), 3.5), [a.x, a.z, 12]],
        groundAt: (x, z) => massifGround(p, x, z, SPRING_BUILD),
    });
}

/**
 * The line of sight through the gateway's opening, behind it: circles [x, z, r] no trunk may stand
 * in, so the opening frames the sky and the bell (not a tree standing in the doorway). The eye
 * sees the arch from local (0.063, 0.994), whatever the layout on a desktop.
 */
export function gatewaySight(plan) {
    const { arch: a } = isleAnchors(plan);
    const l = Math.hypot(0.063, 0.994);
    return Array.from({ length: 15 }, (_, k) => {
        const d = 4 + 4 * k;
        return [a.x - (0.063 / l) * d, a.z - (0.994 / l) * d, 8];
    });
}

/** The groves on the Spring and Twin Isles as the world builds them on a tier, clear of the works. */
export function isleGroves(plan, tier, cascades) {
    const { spring, twin } = isleShapes(plan);
    const { arch: a, aqueduct: aq } = isleAnchors(plan);
    const aqLine = Array.from({ length: 9 }, (_, k) => [aq.x - (k / 8) * aq.spans * aq.span, aq.z, 7.5]);
    return {
        spring: groveSpots(spring, tier.groveTrees ?? 18, 77, SPRING_BUILD, [
            [a.x, a.z, 15], [a.x, a.z + 10, 6], ...gatewaySight(plan), ...cascades.spring.footprint,
        ]),
        // (... nor in a band behind its deck, where a tree's crown would crest the channel's line.)
        twin: groveSpots(twin, Math.max(4, Math.round((tier.groveTrees ?? 18) * 0.35)), 79, TWIN_BUILD, [
            ...aqLine, ...aqLine.map(([x, z]) => [x, z - 11, 7]), ...cascades.twin.footprint,
        ]),
    };
}

/**
 * Build every stone draw: the Spring Isle (body, pinnacles, terraces, summit hump, trees,
 * bell-arch), the Twin Isle (body, pinnacles, terraces, the aqueduct's broken span), the Far Gate on
 * its isle, the two foreground crags, the bell, the archipelago (one instanced draw).
 *
 * @returns {{ meshes: THREE.Object3D[], pools: object[], casters: object[], bell: THREE.Mesh,
 *   anchors: object, outlets: object, place(placement: object): void, dispose(): void }}
 *   pools: [{ isle, local {x,y,z}, radius, level, world [x,y,z] }]; casters: [{ a, b, radius }]
 */
export function createIsles(args) {
    return drainSteps(createIslesSteps(args));
}

/**
 * createIsles as steps (0.2 s of main thread in one call otherwise, play-feel probe 2026-10-16): the
 * same pieces in the same order, a yield between the cascades, the crags, each isle and the far
 * archipelago, so the world's stepped build can breathe between them. Returns what createIsles does.
 */
export function* createIslesSteps({
    plan, tier, U, tex,
}) {
    // The cascades first: the stone's apron follows their flow lines, and the groves and the
    // outcrops keep off every dam and pool.
    const cascades = { spring: isleCascade(plan, tier, 'spring'), twin: isleCascade(plan, tier, 'twin') };
    yield 'cascades';
    const material = createStoneMaterial({
        U,
        tex,
        lamps: tier.lamps,
        lipY: plan.spring.lip,
        reach: 6000,
        path: springPath(plan),
        course: 1.6,
        wet: [0.62, 0.16],
        flow: cascades.spring.flow,
    });
    const twinMaterial = createStoneMaterial({
        U, tex, lipY: plan.twin.lip, reach: 3200, course: 2.8, flow: cascades.twin.flow,
    });
    const farMaterial = createFarStoneMaterial({ U, tex, reach: 5200 });
    // The Far Gate is all but the air itself: a colossus a few shades off the sky behind it.
    const gateMaterial = createFarStoneMaterial({
        U, tex, reach: 4800, grounded: true,
    });
    const cornerL = buildParapet(true);
    const cornerR = buildParapet(false);
    yield 'crags';
    // The crags lie in the overlook's shadow; only a line along their tops stands in the sun. No
    // mineral drips (lipY far above them).
    const cornerMaterial = createStoneMaterial({
        U, tex, reach: 6000, lipY: 1e4, shadeBelow: 1.0, course: 0,
    });
    const materials = [material, twinMaterial, farMaterial, gateMaterial, cornerMaterial];
    const meshes = [];
    const geometries = [];
    const pools = [];
    const outlets = {};
    const anchors = isleAnchors(plan);

    const isle = (name, p, opts) => {
        const body = p.dome
            ? bakeCavity(buildMassif(p, {
                radial: opts.radial, rings: opts.rings, seed: opts.seed, asym: opts.asym ?? 0.2, outletTh: opts.outletTh ?? null, spur: opts.spur ?? null,
            }))
            : buildBody(p, {
                radial: opts.radial, rings: opts.rings, seed: opts.seed, frontCut: p.terraces ? 0.14 : 0.04, asym: opts.asym ?? 0.2,
            });
        const parts = [body];
        if (opts.pinnacles) {
            parts.push(buildPinnacles(p, {
                count: opts.pinnacles, seed: opts.seed + 3, radial: opts.pinnacleRadial ?? 12, rings: 12,
            }));
        }
        if (p.terraces) {
            const terraces = opts.terraces ?? (p.dome
                ? buildCascade(p, {
                    count: p.terraces * 2,
                    radial: Math.max(12, Math.round(opts.segments / 7)),
                    seed: opts.seed + 11,
                    endTh: opts.cascadeEnd ?? 0.62,
                    crownAt: (x, z) => massifCrownAt(p, x, z, { seed: opts.seed, asym: opts.asym ?? 0.2, spur: opts.spur ?? null }),
                    ...(opts.cascade || {}),
                })
                : buildTerraces(p, {
                    count: p.terraces, segments: opts.segments, seed: opts.seed + 11, asym: opts.asym ?? 0.2,
                }));
            parts.push(terraces.geometry);
            outlets[name] = terraces.outlets;
            terraces.pools.forEach((q) => pools.push({
                isle: name, local: { x: q.x, y: q.y, z: q.z }, radius: q.radius, level: q.level, world: [0, 0, 0],
            }));
        }
        if (p.dome && opts.strands) {
            parts.push(buildStrands(p, {
                count: opts.strands, seed: opts.seed, asym: opts.asym ?? 0.2, outletTh: opts.outletTh ?? null, lushTh: opts.outletTh ?? null,
            }));
        }
        (opts.extra || []).forEach((g) => parts.push(g));
        const geometry = mergeGeometries(parts.map((g) => ensureAttrs(g, MAT.travertine)), false);
        parts.forEach((g) => g.dispose());
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, opts.material || material);
        mesh.name = `sky-children-${name}`;
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        meshes.push(mesh);
        return mesh;
    };

    // ── The Spring Isle: the bell-arch on its left shoulder, the summit hump, a stand of trees ──
    const { spring: springP, twin: twinP } = isleShapes(plan);
    const { arch: a } = anchors;
    const arch = buildGateway();
    arch.translate(a.x, a.y, a.z);
    // The groves keep off the gateway's terrace (and the path's foot at its door), the aqueduct's line.
    const groves = isleGroves(plan, tier, cascades);
    const trees = buildGrove(groves.spring, 41);
    yield 'spring grove';
    // Outcrops on the crown, clear of the cascade, the path and the gateway.
    const outcrops = springOutcrops(plan, tier, cascades.spring);
    // Rocks adrift beside the Spring Isle and under it (none in front of the Mother Fall).
    const springRocks = buildSatellites(springP, [
        [-1.05, -70, -0.2, 9], [-0.9, -150, 0.6, 7], [0.25, -215, 0.8, 5], [1.22, -35, -0.85, 7], [-1.0, -215, -0.1, 5],
    ], { seed: 5 });
    const springMesh = isle('spring', springP, {
        radial: tier.isleRadial,
        rings: tier.isleRings,
        segments: tier.terraceSegments,
        seed: 33,
        // No needle legs: the root hangs as lobes of its own.
        // The Mother Fall leaves the front-right shoulder (body θ = π/2 − 0.62): no ravine there.
        outletTh: Math.PI / 2 - 0.62,
        strands: tier.strands ?? 50,
        terraces: cascades.spring,
        extra: [arch, trees, springRocks, outcrops],
    });
    yield 'spring';

    // ── The Twin Isle: the aqueduct's stub reaching toward the card (local −x) ──
    const aqA = anchors.aqueduct;
    const aq = buildAqueduct(aqA.spans, aqA.span, aqA.lower, aqA.upper, aqA.depth, aqA.groundAt).geometry;
    aq.translate(aqA.x, aqA.y, aqA.z);
    const twinTrees = buildGrove(groves.twin, 43);
    const twinRocks = buildSatellites(twinP, [[-1.05, -55, 0.15, 6], [0.95, -95, -0.25, 4.5]], { seed: 9, detail: 0.8 });
    const twinMesh = isle('twin', twinP, {
        // A third of the Spring Isle's apparent size: half its segments, half its rings.
        radial: Math.round(tier.isleRadial * 0.5),
        rings: Math.round(tier.isleRings * 0.55),
        segments: Math.round(tier.terraceSegments * 0.4),
        seed: TWIN_BUILD.seed,
        asym: TWIN_BUILD.asym,
        spur: TWIN_BUILD.spur,
        terraces: cascades.twin,
        extra: [aq, twinTrees, twinRocks],
        material: twinMaterial,
    });
    yield 'twin';

    // ── The Far Gate: a colossal broken arch on a far isle's crown ──
    const gateP = plan.gate;
    // A mesa broad enough that the plinth stands on it end to end (its corners well inside the rim).
    const gateBase = gateMesa(gateP);
    // The fallen blocks bed in its turf (4 m allowed for its lumps).
    const farGate = buildFarGate(gateP.width, gateP.height, {
        groundAt: (x, z) => bodyGround(gateBase, x, z, GATE_BUILD) + gateP.sink - 4,
    });
    anchors.weir = { x: farGate.weir[0], y: farGate.weir[1] - gateP.sink, z: farGate.weir[2] };
    const gateArch = farGate.geometry;
    gateArch.translate(0, -gateP.sink, 0);
    const gateMesh = isle('gate', gateBase, {
        radial: 40, rings: 28, segments: 32, ...GATE_BUILD, pinnacles: 3, pinnacleRadial: 8, extra: [gateArch], material: gateMaterial,
    });
    yield 'gate';

    // ── The foreground: two dark crags in the overlook's shadow ──
    geometries.push(cornerL, cornerR);
    const corner = (name, geometry) => {
        const mesh = new THREE.Mesh(geometry, cornerMaterial);
        mesh.name = `sky-children-${name}`;
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 14;
        meshes.push(mesh);
        return mesh;
    };
    const cornerLMesh = corner('cornerL', cornerL);
    const cornerRMesh = corner('cornerR', cornerR);

    // The bell (its own draw: it swings).
    const bellGeo = buildBell(4.6);
    geometries.push(bellGeo);
    const bell = new THREE.Mesh(bellGeo, material);
    bell.name = 'sky-children-bell';
    bell.matrixAutoUpdate = false;
    bell.frustumCulled = false;
    bell.renderOrder = 10;
    meshes.push(bell);

    // The archipelago: the far isles' shapes posed per layout into ONE merged draw (its vertices are
    // rewritten only when the frame is re-solved).
    const count = tier.archipelago;
    yield 'bell';
    const variants = buildFarIsles(tier.archipelago >= 12 ? 1.2 : 1);
    const slotOf = (i) => variants[(i * 3) % variants.length];
    const farGeo = mergeGeometries(Array.from({ length: count }, (_, i) => slotOf(i)), false);
    const farPos = farGeo.attributes.position;
    const farNrm = farGeo.attributes.normal;
    farPos.setUsage(THREE.DynamicDrawUsage);
    farNrm.setUsage(THREE.DynamicDrawUsage);
    geometries.push(farGeo);
    variants.forEach((g) => g.dispose());
    // Where each slot's vertices sit, and its shape's own (unposed) positions and normals.
    const farSlots = [];
    {
        let start = 0;
        for (let i = 0; i < count; i++) {
            const shape = slotOf(i);
            farSlots.push({ start, count: shape.attributes.position.count });
            start += shape.attributes.position.count;
        }
    }
    const farRestPos = Float32Array.from(farPos.array);
    const farRestNrm = Float32Array.from(farNrm.array);
    const archipelago = new THREE.Mesh(farGeo, farMaterial);
    archipelago.name = 'sky-children-archipelago';
    archipelago.frustumCulled = false;
    archipelago.renderOrder = 10;
    meshes.push(archipelago);

    const byName = {
        spring: springMesh, twin: twinMesh, gate: gateMesh, cornerL: cornerLMesh, cornerR: cornerRMesh,
    };
    const casters = Array.from({ length: 8 }, () => ({
        a: [0, 0, 0], b: [0, 0, 0], radius: 0, weight: 0,
    }));
    let bellSwing = 0;
    let placed = null;

    const setMatrix = (mesh, e) => {
        entryQuaternion(e, tmpQ);
        tmpS.setScalar(e.scale);
        tmpP.set(e.pos[0], e.pos[1], e.pos[2]);
        mesh.matrix.compose(tmpP, tmpQ, tmpS);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.updateMatrixWorld(true);
    };
    const setCaster = (i, e, ya, yb, r, w = 1) => {
        const c = casters[i];
        entryToWorld(e, 0, ya, 0, c.a);
        entryToWorld(e, 0, yb, 0, c.b);
        c.radius = r * e.scale;
        c.weight = w;
    };

    return {
        meshes,
        pools,
        casters,
        bell,
        anchors,
        outlets,
        place(placement) {
            placed = placement;
            Object.entries(byName).forEach(([name, mesh]) => setMatrix(mesh, placement[name]));
            pools.forEach((q) => entryToWorld(placement[q.isle], q.local.x, q.local.y, q.local.z, q.world));
            // The archipelago: each far isle posed at its own size, its vertices rewritten.
            for (let i = 0; i < count; i++) {
                const e = placement.archipelago[i % placement.archipelago.length];
                const radius = e.radius ?? e.scale * 200;
                entryQuaternion(e, tmpQ);
                if (e.roll) tmpQ.multiply(rollQ.setFromAxisAngle(AXIS_Z, e.roll));
                const [sw, sh] = e.squash || [1, 1];
                const k = radius / FAR_UNIT;
                const { start, count: n } = farSlots[i];
                for (let v = start; v < start + n; v++) {
                    tmpP.set(farRestPos[v * 3] * sw, farRestPos[v * 3 + 1] * sh, farRestPos[v * 3 + 2] * sw).multiplyScalar(k).applyQuaternion(tmpQ);
                    farPos.array[v * 3] = tmpP.x + e.pos[0];
                    farPos.array[v * 3 + 1] = tmpP.y + e.pos[1];
                    farPos.array[v * 3 + 2] = tmpP.z + e.pos[2];
                    // (A squash turns the normals the other way: scale by its inverse, then renormalise.)
                    tmpS.set(farRestNrm[v * 3] / sw, farRestNrm[v * 3 + 1] / sh, farRestNrm[v * 3 + 2] / sw).normalize().applyQuaternion(tmpQ);
                    farNrm.array[v * 3] = tmpS.x;
                    farNrm.array[v * 3 + 1] = tmpS.y;
                    farNrm.array[v * 3 + 2] = tmpS.z;
                }
            }
            farPos.needsUpdate = true;
            farNrm.needsUpdate = true;
            // The shadow casters: each isle as a capsule down its axis; our own overlook's tower
            // behind the eye throws the shadow that points straight at A.
            setCaster(0, placement.spring, springP.top - 6, springP.root * 0.5, springP.radius * 0.95);
            setCaster(1, placement.twin, twinP.top - 6, twinP.root * 0.5, twinP.radius * 0.9);
            setCaster(2, {
                pos: [0, 0, 6], yaw: 0, pitch: 0, scale: 1,
            }, 30, -60, 7);
            setCaster(3, placement.gate, gateP.height * 0.9 - gateP.sink, -200, gateP.width * 0.18);
            setCaster(4, placement.spring, anchors.arch.y + anchors.arch.height, anchors.arch.y, 9, 0.7);
            setCaster(5, placement.spring, springP.lip - 20, springP.root * 0.9, springP.radius * 0.45);
            setCaster(6, placement.twin, twinP.lip - 20, twinP.root * 0.9, twinP.radius * 0.4);
            setCaster(7, placement.gate, gateP.height * 0.9 - gateP.sink, 0, gateP.width * 0.12, 0.8);
            // Write them for the sky.
            const rows = U.casters.array;
            casters.forEach((c, i) => {
                rows[i * 2].set(c.a[0], c.a[1], c.a[2], c.radius);
                rows[i * 2 + 1].set(c.b[0], c.b[1], c.b[2], c.weight);
            });
            this.update(0);
        },
        /** The bell swings (level up, T-spin): `swing` in radians, decaying. */
        swing(amount) {
            bellSwing = Math.max(bellSwing, amount);
        },
        update(dt, time = 0) {
            if (!placed) return;
            bellSwing *= Math.exp(-dt * 0.8);
            const e = placed.spring;
            const angle = Math.sin(time * 2.6) * bellSwing;
            // Where it hangs first (entryToWorld uses the shared quaternion), then how it turns.
            entryToWorld(e, anchors.bell.x, anchors.bell.y, anchors.bell.z, bellWorld);
            tmpP.set(bellWorld[0], bellWorld[1], bellWorld[2]);
            entryQuaternion(e, bellQ).multiply(swingQ.setFromAxisAngle(AXIS_X, angle));
            tmpS.setScalar(e.scale);
            bell.matrix.compose(tmpP, bellQ, tmpS);
            bell.matrixWorldNeedsUpdate = true;
            bell.updateMatrixWorld(true);
        },
        dispose() {
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
        },
    };
}

export { smooth, max };

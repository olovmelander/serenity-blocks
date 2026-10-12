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
    Fn, abs, attribute, cameraPosition, clamp, dot, exp, float, length, max, min, mix, normalWorld, normalize,
    positionLocal, positionWorld, pow, smoothstep, sqrt, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smooth } from './sky-children-core.js';
import { airColour, scWrap, skyBase } from './sky-children-tsl.js';

/** Stone kinds (attribute aMat). */
export const MAT = Object.freeze({
    travertine: 0, iron: 1, bronze: 2, masonry: 3, crown: 4, leaf: 5,
});

// ── CPU noise (deterministic, for geometry only) ──

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
    // Keep only what every stone draw shares (merge needs identical attribute sets).
    Object.keys(geometry.attributes).forEach((k) => {
        if (!['position', 'normal', 'aMat', 'aAO', 'aBed', 'aMoss'].includes(k)) geometry.deleteAttribute(k);
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
    for (let c = 0; c < cols; c++) index.push(topRow + c, topRow + ((c + 1) % cols), centre);
    // The root's tip.
    const tip = pos.length / 3;
    pos.push(0, p.root - 6, 0);
    mat.push(MAT.iron);
    ao.push(0.5);
    for (let c = 0; c < cols; c++) index.push(c, tip, (c + 1) % cols);
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
 * deepest. Rings × radial vertices; attributes aMat, aAO (a first guess, refined by the bake),
 * aBed (bed tone, depth within the bed; -1 on the crown) and aMoss.
 */
export function buildMassif(p, {
    radial = 96, rings = 64, seed = 1, asym = 0.2, outletTh = null,
} = {}) {
    const N = makeNoise(seed);
    const S = makeNoise(p.shapeSeed ?? seed + 5);
    const rand = mulberry32(seed * 17 + 3);
    const R = p.radius;
    const cols = radial;
    const beds = cliffBeds(p, seed);
    // The hanging lobes: the main one on the axis (deepest), three more about it.
    const lobes = [{
        phi: 0, off: 0, w: 0.82, end: 1, power: 1.25,
    }];
    const lobeCount = p.lobes ?? 3;
    for (let k = 0; k < lobeCount; k++) {
        // Spread round the isle, each a hanging mass of its own that ends at its own depth.
        lobes.push({
            phi: ((k + 0.25 + rand() * 0.5) / lobeCount) * Math.PI * 2,
            off: 0.42 + rand() * 0.2,
            w: 0.62 - k * 0.07,
            end: 0.78 - k * 0.14,
            power: 1.1,
        });
    }
    // Ravines, off the water's side.
    const ravines = [];
    for (let k = 0; k < 3; k++) {
        let th = rand() * Math.PI * 2;
        if (outletTh !== null && Math.abs(Math.atan2(Math.sin(th - outletTh), Math.cos(th - outletTh))) < 0.6) th += Math.PI;
        ravines.push(th);
    }
    const kSmooth = 0.15 * R;
    const section = (ux, uz, s) => {
        let sum = 0;
        for (let k = 0; k < lobes.length; k++) {
            const L = lobes[k];
            if (s >= L.end) continue;
            const rho = R * L.w * (1 - s / L.end) ** (L.power ?? 1.3);
            const cx = Math.cos(L.phi) * L.off * R * s ** 0.6;
            const cz = Math.sin(L.phi) * L.off * R * s ** 0.6;
            const cu = cx * ux + cz * uz;
            const disc = rho * rho - (cx * cx + cz * cz) + cu * cu;
            if (disc <= 0) continue;
            const d = cu + Math.sqrt(disc);
            if (d > 0) sum += Math.exp(d / kSmooth);
        }
        return sum > 0 ? kSmooth * Math.log(sum) : 0;
    };
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
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const ux = Math.cos(th);
            const uz = Math.sin(th);
            const k = outlineScale(S, ux, uz, asym);
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
            r = Math.max(0.4, r * ledge * rib * cut * lumps);
            const shade = (0.92 - 0.35 * s) * (0.75 + 0.25 * smooth(0, 0.05, s));
            push(ux * r, y, uz * r, MAT.iron, shade * (1 - 0.25 * smooth(0.7, 1, t)), B.tone, t, 0);
        }
    }
    // The rim: the cap-rock band set back, the turf's underside, its lip standing out over it.
    const rim = [[0.93, p.lip - 4, 0.55], [1.0, p.lip - 1.5, 0.72], [1.03, p.lip + 0.8, 1]];
    rim.forEach(([q, y, a], j) => {
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const ux = Math.cos(th);
            const uz = Math.sin(th);
            const k = outlineScale(S, ux, uz, asym);
            const wob = 1 + 0.02 * N.noise3(ux * 4, j, uz * 4);
            const r = q * R * k * wob;
            const lift = j === 2 ? 0.6 * N.noise3(ux * 5, 2, uz * 5) : 0;
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
            const k = outlineScale(S, ux, uz, asym);
            const x = ux * q * R * k;
            const z = uz * q * R * k;
            const y = crownSurface(p, x / k, z / k) + 0.8 * N.fbm3(x * 0.05, 1.3, z * 0.05, 3);
            push(x, y, z, MAT.crown, 1, -1, 0, 1);
        }
    }
    const rowsN = rootRings + rim.length + crownRings;
    const index = gridIndex(rowsN, cols, true);
    // The summit.
    const centre = pos.length / 3;
    push(0, crownSurface(p, 0, 0) + 0.4, 0, MAT.crown, 1, -1, 0, 1);
    const topRow = (rowsN - 1) * cols;
    for (let c = 0; c < cols; c++) index.push(topRow + c, topRow + ((c + 1) % cols), centre);
    // The deepest lobe's tip.
    const tip = pos.length / 3;
    push(0, p.root - 4, 0, MAT.iron, 0.45, beds[beds.length - 1].tone, 1, 0);
    for (let c = 0; c < cols; c++) index.push(c, tip, (c + 1) % cols);
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
 * The rimstone cascade: basins strung down the crown's front along one curving flow path, from the
 * spring left of the summit to the outlet on the right shoulder where the Mother Fall leaves. Each
 * basin is a rounded, scalloped dish whose pool stands just above the slope; on its downhill side
 * the dam's fluted curtain drops to the turf (rimstone on a slope), so every basin brims and the
 * steps read as water stepping down, never as a cake's tiers. Rim outlets round the front let the
 * falls leave either shoulder.
 * Returns { geometry, pools, levels, outlets } (local space), as buildTerraces does.
 */
export function buildCascade(p, {
    count = 12, radial = 32, seed = 3, endTh = 0.62, startX = -0.12, startZ = -0.06, bend = [0.12, 0.42],
} = {}) {
    const N = makeNoise(seed);
    const rand = mulberry32(seed * 7 + 1);
    const R = p.radius;
    // Basins in proportion to the isle (the Spring Isle's are the reference).
    const scaleR = Math.min(1, R / 58);
    // The flow path (local x, z), a quadratic curve from the spring to the rim at endTh.
    const P0 = [startX * R, startZ * R];
    const P2 = [Math.sin(endTh) * R * 0.7, Math.cos(endTh) * R * 0.7];
    const P1 = [bend[0] * R, bend[1] * R];
    const at = (u) => {
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const c = u * u;
        return [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1]];
    };
    const pieces = [];
    const pools = [];
    const levels = [];
    for (let i = 0; i < count; i++) {
        const u = count > 1 ? i / (count - 1) : 1;
        const c0 = at(u);
        const c1 = at(Math.min(1, u + 0.02));
        let tx = c1[0] - c0[0];
        let tz = c1[1] - c0[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // Downstream they widen; each steps aside a little from the last.
        const rb = (5.5 + 7.5 * u) * (0.85 + rand() * 0.3) * scaleR;
        const side = (i % 2 ? 1 : -1) * rb * 0.6 * (0.6 + rand() * 0.4);
        const cx = c0[0] - tz * side;
        const cz = c0[1] + tx * side;
        const lobes = 3 + Math.floor(rand() * 4);
        const phase = rand() * Math.PI * 2;
        const outline = (phi, rr) => {
            const scallop = 1 + 0.12 * Math.abs(Math.sin(lobes * phi * 0.5 + phase)) ** 0.6;
            // Stretched along the flow: a kidney, not a coin.
            const ax = Math.cos(phi) * rr * scallop * 1.2;
            const az = Math.sin(phi) * rr * scallop;
            return [cx + tx * ax - tz * az, cz + tz * ax + tx * az];
        };
        // The pool stands just above the highest point of the slope under its rim.
        let level = -Infinity;
        for (let k = 0; k < 16; k++) {
            const [x, z] = outline((k / 16) * Math.PI * 2, rb);
            level = Math.max(level, crownSurface(p, x, z));
        }
        level += 0.25;
        levels.push(level);
        // Rings out from the pool's heart: floor, crest, rounded lip, curtain to the slope.
        const ring = [
            [0.0, -0.45, 0.62], [0.55, -0.4, 0.65], [0.8, -0.3, 0.72], [0.88, 0.1, 0.95], [0.97, 0.22, 1.0],
            [1.06, 0.05, 0.95], [1.14, null, 0.72], [1.2, null, 0.52],
        ];
        const pos = [];
        const ao = [];
        ring.forEach(([rr, dy, a], r) => {
            for (let k = 0; k < radial; k++) {
                const phi = (k / radial) * Math.PI * 2;
                let [x, z] = outline(phi, rb * rr);
                let y;
                if (dy === null) {
                    // The curtain falls to the slope (or stays at the crest where the slope is higher).
                    const t = r === ring.length - 1 ? 1 : 0.5;
                    const ground = crownSurface(p, x, z) - 0.6;
                    const crest = level + 0.15;
                    y = Math.min(crest - 0.4 * t, crest + (ground - crest) * t);
                    // Fluted: the curtain hangs in folds, deeper toward its foot.
                    const flute = (Math.sin(phi * 23 + N.noise3(phi * 5, i, 1.1) * 3) * 0.5 + 0.5) * 0.18 * t * rb * 0.1;
                    const push = flute / Math.max(1, rb);
                    x += (x - cx) * push;
                    z += (z - cz) * push;
                } else {
                    y = level + dy;
                }
                pos.push(x, y, z);
                ao.push(a);
            }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
        g.setIndex(gridIndex(ring.length, radial, true));
        g.computeVertexNormals();
        pieces.push(ensureAttrs(g, MAT.travertine));
        // The basin's pools: one in a small basin, two or three jewels side by side in a big one
        // (each a slot a lock's light can fill).
        let spots = 1;
        if (rb > 10 * scaleR) spots = 3;
        else if (rb > 7 * scaleR) spots = 2;
        for (let k = 0; k < spots; k++) {
            const off = spots === 1 ? 0 : ((k / (spots - 1)) * 2 - 1) * rb * 0.48;
            pools.push({
                x: cx - tz * off, y: level - 0.05, z: cz + tx * off, radius: (rb * 0.84) / Math.sqrt(spots), level: i, nx: tx, nz: tz,
            });
        }
    }
    // Rim outlets round the front: where the falls leave (the last basin feeds the right shoulder).
    const outlets = [];
    for (let k = 0; k <= 24; k++) {
        const th = -1.25 + (2.5 * k) / 24;
        const nx = Math.sin(th);
        const nz = Math.cos(th);
        const x = nx * R * 1.04;
        const z = nz * R * 1.04;
        outlets.push({
            th, x, y: p.lip + 0.6, z, nx, nz,
        });
    }
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    return {
        geometry, pools, levels, outlets,
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
        depth, bevelEnabled: true, bevelThickness: depth * 0.08, bevelSize: thick * 0.08, bevelSegments: 2, curveSegments: 28,
    });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    return ensureAttrs(g, opts.mat ?? MAT.masonry);
}

/** The gateway on the Spring Isle's knoll: its proportions (metres). */
export const GATEWAY = Object.freeze({
    span: 11, pier: 3.2, pierH: 13, ring: 2.3, depth: 3.2, plinth: [[21, 0.9, 7], [18, 0.8, 6], [15.5, 0.8, 5]], voussoirs: 11,
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
 * impost blocks, a round arch of separate voussoirs with a keystone standing proud, and the stubs
 * of two broken columns on the platform. Its height (the extrados) is gatewayHeight().
 */
export function buildGateway(G = GATEWAY) {
    const parts = [];
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
    const gap = 0.012;
    for (let j = 0; j < G.voussoirs; j++) {
        const a0 = (j / G.voussoirs) * Math.PI + gap;
        const a1 = ((j + 1) / G.voussoirs) * Math.PI - gap;
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
    // Broken columns on the platform, each snapped at its own height.
    [[-6.5, 2.4, 6.5], [7.2, 2.0, 3.8]].forEach(([x, z, h]) => {
        const c = new THREE.CylinderGeometry(0.7, 0.8, h, 8, 1, false);
        c.deleteAttribute('uv');
        c.translate(x, y + h / 2, z);
        const w = mergeVertices(c, 1e-4);
        c.dispose();
        w.computeVertexNormals();
        parts.push(ensureAttrs(w, MAT.masonry));
    });
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
function hexa(c) {
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
    return ensureAttrs(g, MAT.masonry);
}

/**
 * The Far Gate: the waterworks of the spring-builders, a colossal gate their water has half grown
 * over. Standing on y = 0, face toward +z, `W` wide and `H` tall: a stepped plinth, two battered
 * eight-sided piers, an impost band, a tall catenary opening framed by its voussoirs and a receding
 * second order, an attic notched at its centre for a weir, its right shoulder broken away.
 * Returns { geometry, weir: [x, y, z] } (the notch's lip, where its water leaves).
 */
export function buildFarGate(W = 1400, H = 2200) {
    const parts = [];
    let y = 0;
    [[1.25, 50, 0.45], [1.17, 45, 0.4], [1.1, 40, 0.36]].forEach(([w, h, d]) => {
        parts.push(block(0, y, 0, W * w, h, W * d));
        y += h;
    });
    const impost = H * 0.62;
    const half = W * 0.2;
    const pierX = W * 0.35;
    // Battered piers: eight-sided, wider at the foot.
    [-pierX, pierX].forEach((x) => {
        const g = new THREE.CylinderGeometry(1, 1.18, impost - y, 8, 1, false);
        g.deleteAttribute('uv');
        g.rotateY(Math.PI / 8);
        g.scale(W * 0.13, 1, W * 0.155);
        g.translate(x, y + (impost - y) / 2, 0);
        const w = mergeVertices(g, 1e-3);
        g.dispose();
        w.computeVertexNormals();
        parts.push(ensureAttrs(w, MAT.masonry));
        parts.push(block(x, impost, 0, W * 0.32, H * 0.03, W * 0.36));
    });
    // The opening: a catenary from impost to crown, its voussoirs set along it.
    const spring = impost + H * 0.03;
    const rise = H * 0.3;
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
    // Two orders: the voussoirs, and a thinner one set back on their extrados.
    [[0, ring, W * 0.34, 0], [ring, ring * 0.6, W * 0.3, -W * 0.03]].forEach(([from, thick, depth, zc]) => {
        for (let j = 0; j < count; j++) {
            const t0 = j / count + 0.002;
            const t1 = (j + 1) / count - 0.002;
            parts.push(hexa([[offset(t0, from), offset(t1, from), offset(t1, from + thick), offset(t0, from + thick)], depth, zc]));
        }
    });
    // The attic over the arch, notched at its centre for the weir; its right shoulder broken.
    const atticBase = spring + rise + ring;
    const notch = W * 0.075;
    const notchY = H - H * 0.04;
    parts.push(block(-(W * 0.5 + notch) / 2, atticBase, 0, W * 0.5 - notch, H - atticBase, W * 0.34));
    parts.push(block((W * 0.5 + notch) / 2 - W * 0.06, atticBase, 0, W * 0.5 - notch - W * 0.12, (H - atticBase) * 0.72, W * 0.34));
    parts.push(block(0, atticBase, 0, notch * 2, notchY - atticBase, W * 0.34));
    // Spandrels over the piers, from the springing to the attic.
    const spanW = W * 0.5 - (half + ring * 0.4);
    [-1, 1].forEach((side) => {
        parts.push(block(side * (W * 0.5 - spanW / 2), spring, 0, spanW, atticBase - spring, W * 0.32));
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    return { geometry: merged, weir: [0, notchY, W * 0.17] };
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

/**
 * The overlook's parapet, the eye's own ground at the frame's bottom corners (a human-scale anchor:
 * a baluster a metre tall makes the isles and the gate read huge). `left`: a ledge, a newel post
 * under a scalloped cap and a balustrade running out of frame; the right: a broken stub on its
 * ledge and a fallen rail. Local +x is the frame's right, +z toward the eye; the top edges stand
 * in the sun behind the eye, the rest in the overlook's shadow.
 */
export function buildParapet(left = true) {
    const parts = [];
    if (left) {
        parts.push(buildLedge(-11, 3.5, -1.2, 6, 3));
        parts.push(block(0.4, 0, 0, 0.9, 2.0, 0.9));
        const cap = new THREE.CylinderGeometry(0.62, 0.5, 0.26, 10, 1, false);
        cap.deleteAttribute('uv');
        const ca = cap.attributes.position;
        for (let v = 0; v < ca.count; v++) {
            const a = Math.atan2(ca.getZ(v), ca.getX(v));
            const k = 1 + 0.08 * Math.abs(Math.sin(a * 4));
            ca.setX(v, ca.getX(v) * k);
            ca.setZ(v, ca.getZ(v) * k);
        }
        cap.translate(0.4, 2.13, 0);
        const cw = mergeVertices(cap, 1e-4);
        cap.dispose();
        cw.computeVertexNormals();
        parts.push(ensureAttrs(cw, MAT.masonry));
        parts.push(block(-4.8, 0, 0, 9.4, 0.15, 0.36));
        parts.push(block(-4.8, 1.13, 0, 9.4, 0.2, 0.34));
        for (let i = 0; i < 9; i++) parts.push(baluster(-0.5 - i * 1.0, 0, 0.98));
    } else {
        parts.push(buildLedge(-3.5, 8, -1.0, 5, 7));
        // The broken stub: a post snapped off on a slant.
        parts.push(hexa([[[-1.65, 0], [-0.75, 0], [-0.75, 1.0], [-1.65, 1.35]], 0.9, 0]));
        // A rail fallen across the ledge, and the rubble of the post.
        const rail = new THREE.BoxGeometry(2.6, 0.2, 0.32);
        rail.deleteAttribute('uv');
        rail.rotateY(0.6);
        rail.rotateZ(0.12);
        rail.translate(1.2, 0.18, 0.9);
        parts.push(ensureAttrs(rail, MAT.masonry));
        parts.push(block(0.2, 0, -0.2, 0.5, 0.35, 0.45), block(-0.4, 0, 0.6, 0.35, 0.25, 0.4));
        parts.push(baluster(-2.6, 0, 0.98));
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    merged.userData.top = left ? 2.26 : 1.35;
    return merged;
}

/** A run of arches (an aqueduct span) with a channel on top, broken at its far end. */
export function buildAqueduct(spans, spanWidth, height, depth) {
    const parts = [];
    for (let i = 0; i < spans; i++) {
        const last = i === spans - 1;
        const g = buildArch(spanWidth, height, spanWidth * 0.2, depth, { broken: last });
        g.translate(-i * spanWidth, 0, 0);
        parts.push(g);
    }
    // The channel along the top (stopping short at the break).
    const len = spanWidth * (spans - 0.6);
    const ch = ensureAttrs(new THREE.BoxGeometry(len, spanWidth * 0.22, depth * 1.15), MAT.masonry);
    ch.translate(-len / 2 + spanWidth / 2, height + spanWidth * 0.11, 0);
    parts.push(ch);
    const merged = mergeGeometries(parts.map((g) => ensureAttrs(g, MAT.masonry)), false);
    parts.forEach((g) => g.dispose());
    return merged;
}

/** The bell: a lathe, mouth down, hanging from y = 0. */
export function buildBell(size = 3) {
    const pts = [];
    const n = 18;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const r = size * (0.18 + 0.32 * t ** 1.8 + (t > 0.85 ? (t - 0.85) * 1.6 : 0));
        pts.push(new THREE.Vector2(r, -t * size * 1.25));
    }
    const g = new THREE.LatheGeometry(pts, 20);
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
 * What hangs from the rim: vines and roots from under the turf lip, falling on gravity curves down
 * the cliff (three-sided tapering tubes), thickest and longest under the cascade's foot, where the
 * water feeds them; none across the fall's outlet. `seed` must be the massif's (the rim matches).
 */
export function buildStrands(p, {
    count = 50, seed = 1, asym = 0.2, outletTh = null, lushTh = null,
} = {}) {
    const S = makeNoise(p.shapeSeed ?? seed + 5);
    const rand = mulberry32(seed * 29 + 11);
    const R = p.radius;
    const pos = [];
    const mat = [];
    const ao = [];
    const index = [];
    const SEG = 8;
    const SIDES = 3;
    for (let i = 0; i < count; i++) {
        let th = rand() * Math.PI * 2;
        if (outletTh !== null && Math.abs(Math.atan2(Math.sin(th - outletTh), Math.cos(th - outletTh))) < 0.18) th += 0.4;
        const ux = Math.cos(th);
        const uz = Math.sin(th);
        const k = outlineScale(S, ux, uz, asym);
        // Lush under the cascade's foot.
        const lush = lushTh === null ? 0 : Math.exp(-((Math.atan2(Math.sin(th - lushTh), Math.cos(th - lushTh)) / 0.5) ** 2));
        const L = (6 + rand() * 18) * (1 + lush * 1.2);
        const thick = (0.7 + rand() * 0.8) * (1 + lush * 0.5);
        const root = rand() < 0.3 && lush < 0.5;
        const x0 = ux * R * k * 0.995;
        const z0 = uz * R * k * 0.995;
        const y0 = p.lip - 1.2;
        const sway = (rand() - 0.5) * 0.25;
        const base = pos.length / 3;
        for (let sI = 0; sI <= SEG; sI++) {
            const t = sI / SEG;
            // Out from the lip, then hanging, curving back toward the cliff as it falls.
            const out = 1.2 * Math.sin(t * Math.PI * 0.8) - t * 1.5;
            const cx = x0 + ux * out + -uz * sway * L * t * t;
            const cz = z0 + uz * out + ux * sway * L * t * t;
            const cy = y0 - L * t;
            const r = thick * (1 - t * 0.8);
            for (let a = 0; a < SIDES; a++) {
                const ang = (a / SIDES) * Math.PI * 2;
                const ox = Math.cos(ang) * r;
                const oz = Math.sin(ang) * r;
                pos.push(cx + ux * ox - uz * oz, cy, cz + uz * ox + ux * oz);
                mat.push(root ? MAT.iron : MAT.leaf);
                ao.push(0.75 - 0.35 * t);
            }
        }
        for (let sI = 0; sI < SEG; sI++) {
            for (let a = 0; a < SIDES; a++) {
                const a0 = base + sI * SIDES + a;
                const a1 = base + sI * SIDES + ((a + 1) % SIDES);
                const b0 = a0 + SIDES;
                const b1 = a1 + SIDES;
                index.push(a0, b0, a1, a1, b0, b1);
            }
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
export function groveSpots(p, count, seed = 77) {
    const rand = mulberry32(seed);
    const spots = [];
    const R = p.radius;
    // Groves: a few centres on the back half and the left shoulder, trees gathered round each.
    const groves = Math.max(2, Math.round(count / 5));
    for (let gI = 0; gI < groves && spots.length < count; gI++) {
        const ang = Math.PI * (1.0 + (gI / groves) * 1.0 + rand() * 0.25);
        const rho = R * (0.25 + rand() * 0.5);
        const gx = Math.cos(ang) * rho;
        const gz = Math.sin(ang) * rho;
        const members = Math.min(count - spots.length, 3 + Math.floor(rand() * 4));
        for (let m = 0; m < members; m++) {
            const a = rand() * Math.PI * 2;
            const d = R * (0.04 + rand() * 0.13);
            const x = gx + Math.cos(a) * d;
            const z = gz + Math.sin(a) * d;
            const roll = rand();
            let kind = roll < 0.55 ? 0 : 1;
            if (roll > 0.85) kind = 2;
            const size = kind === 2 ? 2.5 + rand() * 2 : 5.5 + rand() * 3.5;
            spots.push([x, crownSurface(p, x, z) - 0.3, z, size, kind]);
        }
    }
    // A pine or two leaning out over the back rim.
    for (let k = 0; k < 2 && spots.length < count; k++) {
        const a = Math.PI * (1.25 + k * 0.4);
        const x = Math.cos(a) * R * 0.9;
        const z = Math.sin(a) * R * 0.9;
        spots.push([x, crownSurface(p, x, z) - 0.3, z, 5 + rand() * 2, 1]);
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
 * @param {number} [p.shadeBelow]  if set, everything under this local height lies in the
 *                                 overlook's cast shadow (the foreground crags): only the fill
 *                                 reaches it, and a warm line of sun along its top edge
 */
export function createStoneMaterial({
    U, tex, reach = 6000, lamps = 0, lipY = 0, shadeBelow = null, far = false,
}) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.colorNode = Fn(() => {
        const { light } = U;
        const N = normalize(normalWorld).toVar();
        const P = positionWorld.toVar();
        const toEye = cameraPosition.sub(P).toVar();
        const dist = length(toEye).toVar();
        const V = toEye.div(dist).toVar();
        const L = U.key;
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
        // Bronze (dark, turned green in the creases) and the ruins' masonry.
        const bronze = mix(vec3(0.16, 0.1, 0.05), vec3(0.09, 0.16, 0.12), smoothstep(0.45, 0.75, s2.g)).toVar();
        const masonry = light.stone.mul(float(0.62).add(s2.r.mul(0.2))).mul(vec3(0.95, 0.9, 0.84));
        // Crown rock: warm stone laid down in strata, a moss on what faces the sky.
        const nA = texture(tex.noise, vec2(lp.x.add(lp.z), lp.y.mul(3.0)).mul(0.004)).r;
        const nB = texture(tex.noise, vec2(lp.x.sub(lp.z), lp.y).mul(0.017)).a;
        const bands = lp.y.mul(0.42).add(nA.mul(9.0)).sin().mul(0.5)
            .add(0.5);
        const crownRock = mix(light.stone.mul(vec3(0.4, 0.32, 0.25)), light.stone.mul(vec3(0.62, 0.52, 0.4)), bands.mul(0.6).add(nB.mul(0.4)))
            .toVar();
        const moss = mix(vec3(0.07, 0.12, 0.035), vec3(0.16, 0.22, 0.06), nB.mul(0.7).add(s1.g.mul(0.3)));
        // Turf where the moss weight says so, its edge ragged at the scale of a tussock; drier and
        // sun-gold on the knolls' crowns, lusher low down.
        const mossW = attribute('aMoss', 'float');
        const mossK = smoothstep(0.42, 0.58, mossW.add(s1.g.sub(0.5).mul(0.5)));
        const turf = mix(moss, moss.mul(vec3(1.5, 1.3, 0.8)), smoothstep(0.75, 0.98, N.y).mul(nA)).toVar();
        crownRock.assign(mix(crownRock, turf, max(mossK, smoothstep(0.5, 0.78, N.y).mul(smoothstep(0.25, 0.55, nA.add(0.2))))));
        // Leaf: dark green crowns, warmer where the sun catches them.
        const leaf = mix(vec3(0.02, 0.05, 0.025), vec3(0.06, 0.1, 0.03), s2.r);
        const albedo = trav.toVar();
        albedo.assign(mix(albedo, rock, is(1)));
        albedo.assign(mix(albedo, bronze, is(2)));
        albedo.assign(mix(albedo, masonry, is(3)));
        albedo.assign(mix(albedo, crownRock, is(4)));
        albedo.assign(mix(albedo, leaf, smoothstep(4.5, 4.9, matId)));
        const ironK = is(1);
        // Moss reaches over any stone where the weight says so, and creeps down the cliff from the
        // rim in ragged tongues (longest in the grooves, never on what faces down).
        const tongue = s1.g.mul(18.0).add(s2.r.mul(10.0)).add(4.0);
        const creep = float(1.0).sub(smoothstep(tongue.mul(0.6), tongue, float(lipY).sub(lp.y))).mul(ironK)
            .mul(smoothstep(-0.35, 0.1, N.y))
            .mul(smoothstep(0.35, 0.6, s2.g.add(s1.b.mul(0.3))));
        albedo.assign(mix(albedo, turf, max(mossK.mul(float(1.0).sub(is(4))), creep).mul(float(1.0).sub(smoothstep(4.5, 4.9, matId)))));

        // ── Light: the key from behind the eye, a cool fill from the sky on the shadow side ──
        const ndl = dot(N, L);
        const nv = clamp(dot(N, V), 0.0, 1.0);
        const sun = float(1.0).toVar();
        if (shadeBelow !== null) {
            // In the overlook's shadow: only a warm line along the top edge stands in the sun.
            sun.assign(smoothstep(0.6, 0.92, float(1.0).sub(nv)).mul(smoothstep(0.15, 0.5, N.y))
                .mul(smoothstep(shadeBelow - 3.0, shadeBelow, lp.y)));
        }
        const diffuse = scWrap(ndl, float(0.08)).mul(ao).mul(sun).toVar();
        const skyUp = skyBase(normalize(N.add(vec3(0.0, 0.6, 0.0))), U);
        const fill = mix(light.shadow, skyUp, N.y.mul(0.25).add(0.3)).mul(ao.mul(0.75).add(0.25)).mul(0.4).toVar();
        // The root is in its own shade: less fill, less key.
        // The root is in its own shade under the rim (the crown overhangs it); its faces toward
        // the sun below that still take the key.
        const ironDim = mix(float(1.0), float(0.6), ironK.mul(underLip));
        const lit = light.key.mul(U.keyGain).mul(diffuse).mul(0.66).mul(ironDim);
        const col = albedo.mul(lit.add(fill.mul(ironDim))).toVar();
        // Cavities hold the shadow colour, never black.
        col.assign(mix(col, light.shadow.mul(albedo).mul(0.9), cups.mul(ironK).mul(0.35)));
        // A thin rim of sky only where a form turns away from the key (the shadow side).
        const away = float(1.0).sub(smoothstep(-0.1, 0.35, ndl));
        const rimTerm = pow(float(1.0).sub(nv), 4.0).mul(0.22).mul(away);
        col.addAssign(light.rim.mul(rimTerm).mul(ao));
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
            const deep = max(y1.negate(), 1.0);
            const mMist = smoothstep(0.0, -20.0, y1).mul(float(1.0).sub(float(400.0).mul(float(1.0).sub(exp(min(y1, 0.0).div(400.0)))).div(deep)));
            const tau = dist.mul(mAir.div(7000.0).add(mMist.div(2500.0)));
            const T = max(exp(tau.negate()), smoothstep(-10.0, 40.0, y1).mul(0.22));
            const viewDir = V.negate();
            const veil = mix(mix(light.mistLit, airColour(viewDir, U), 0.5), airColour(viewDir, U), smoothstep(-0.02, 0.02, viewDir.y));
            col.assign(mix(veil, col, T));
            return vec4(col, 1.0);
        }
        const air = float(1.0).sub(exp(dist.div(-reach))).toVar();
        const farAir = airColour(V.negate(), U);
        col.assign(mix(col, farAir, min(air, 0.9)));
        // The roots dissolve into the Deep's mist as they hang down toward it: the isles float.
        const mist = smoothstep(-110.0, -290.0, P.y).mul(0.85);
        col.assign(mix(col, mix(light.mistLit, airColour(V.negate(), U), 0.5), mist));
        return vec4(col, 1.0);
    })();
    return material;
}

/** A material for the far isles (the archipelago, the Far Gate): stone shading, more air. */
export function createFarStoneMaterial({ U, tex, reach = 4200 }) {
    return createStoneMaterial({
        U, tex, reach, far: true,
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
            ...plan.spring, dome: true, knolls: [[-0.1, -0.32, 9, 0.3], [-0.42, -0.12, 6, 0.22], [0.32, -0.45, 4, 0.2]], lobes: 3,
        },
        twin: {
            ...plan.twin, dome: true, knolls: [[0.2, -0.3, 4, 0.3]], lobes: 2, terraces: 4,
        },
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
    const archY = crownSurface(sp, archX, archZ) - 1.2;
    const gh = gatewayHeight();
    const arch = {
        x: archX, y: archY, z: archZ, width: GATEWAY.span + 2 * GATEWAY.pier, height: gh.top, thick: gh.top - gh.intrados, depth: GATEWAY.depth,
    };
    const aq = {
        x: -tw.radius * 0.28, y: 0, z: tw.radius * 0.02, spans: 3, span: 16, height: 22, depth: 5,
    };
    aq.y = crownSurface(tw, aq.x, aq.z) - 2;
    const channelEnd = aq.span * (1.1 - aq.spans);
    return {
        arch,
        bell: { x: archX, y: archY + arch.height - arch.thick - 0.6, z: archZ },
        hump: {
            x: -sp.radius * 0.18, y: crownSurface(sp, -sp.radius * 0.18, -sp.radius * 0.26) - 4, z: -sp.radius * 0.26,
        },
        aqueduct: aq,
        spanLip: { x: aq.x + channelEnd, y: aq.y + aq.height + aq.span * 0.22, z: aq.z },
    };
}

// ── The part: every stone, placed per layout ──

const tmpQ = new THREE.Quaternion();
const pitchQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const swingQ = new THREE.Quaternion();
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

export function buildFarIsles(detail = 1) {
    const radial = Math.max(10, Math.round(14 * detail));
    const rings = Math.max(8, Math.round(10 * detail));
    // Built at FAR_UNIT metres of radius (the cliff's beds and the rim are in metres), scaled at placement.
    const shapes = [
        {
            top: 12, lip: 0, root: -160, lobes: 2,
        },
        {
            top: 18, lip: 0, root: -420, lobes: 1,
        },
        {
            top: 15, lip: 0, root: -260, lobes: 3,
        },
        {
            top: 22, lip: 0, root: -300, lobes: 2,
        },
        {
            top: 10, lip: 0, root: -220, lobes: 2,
        },
    ];
    return shapes.map((sh, v) => {
        const p = {
            ...sh, radius: FAR_UNIT, dome: true, knolls: [[0.2, -0.2, 6, 0.3]], shapeSeed: 300 + v,
        };
        const parts = [buildMassif(p, {
            radial, rings, seed: 200 + v * 7, asym: 0.35,
        })];
        if (v === 3) {
            parts.push(buildGrove([[-20, crownSurface(p, -20, -20), -20, 9, 0], [5, crownSurface(p, 5, -30), -30, 10, 0],
                [-35, crownSurface(p, -35, 5), 5, 8, 1]], 90));
        }
        if (v === 4) {
            const y0 = crownSurface(p, 35, -10);
            parts.push(block(35, y0 - 2, -10, 14, 50, 14), block(35, y0 + 48, -10, 30, 6, 16));
        }
        const g = mergeGeometries(parts.map((q) => ensureAttrs(q, MAT.iron)), false);
        parts.forEach((q) => q.dispose());
        return g;
    });
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
export function createIsles({
    plan, tier, U, tex,
}) {
    const material = createStoneMaterial({
        U, tex, lamps: tier.lamps, lipY: plan.spring.lip, reach: 6000,
    });
    const twinMaterial = createStoneMaterial({
        U, tex, lipY: plan.twin.lip, reach: 3200,
    });
    const farMaterial = createFarStoneMaterial({ U, tex, reach: 5200 });
    // The Far Gate is all but the air itself: a colossus a few shades off the sky behind it.
    const gateMaterial = createFarStoneMaterial({ U, tex, reach: 4800 });
    const cornerL = buildParapet(true);
    const cornerR = buildParapet(false);
    // The crags lie in the overlook's shadow; only a line along their tops stands in the sun. No
    // mineral drips (lipY far above them).
    const cornerMaterial = createStoneMaterial({
        U, tex, reach: 6000, lipY: 1e4, shadeBelow: 1.0,
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
                radial: opts.radial, rings: opts.rings, seed: opts.seed, asym: opts.asym ?? 0.2, outletTh: opts.outletTh ?? null,
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
            const terraces = p.dome
                ? buildCascade(p, {
                    count: p.terraces * 3,
                    radial: Math.max(16, Math.round(opts.segments / 5)),
                    seed: opts.seed + 11,
                    endTh: opts.cascadeEnd ?? 0.62,
                    ...(opts.cascade || {}),
                })
                : buildTerraces(p, {
                    count: p.terraces, segments: opts.segments, seed: opts.seed + 11, asym: opts.asym ?? 0.2,
                });
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
    const trees = buildGrove(groveSpots(springP, tier.groveTrees ?? 18, 77), 41);
    const springMesh = isle('spring', springP, {
        radial: tier.isleRadial,
        rings: tier.isleRings,
        segments: tier.terraceSegments,
        seed: 33,
        pinnacles: 7,
        // The Mother Fall leaves the front-right shoulder (body θ = π/2 − 0.62): no ravine there.
        outletTh: Math.PI / 2 - 0.62,
        strands: tier.strands ?? 50,
        extra: [arch, trees],
    });

    // ── The Twin Isle: the aqueduct's stub reaching toward the card (local −x) ──
    const aqA = anchors.aqueduct;
    const aq = buildAqueduct(aqA.spans, aqA.span, aqA.height, aqA.depth);
    aq.translate(aqA.x, aqA.y, aqA.z);
    const twinTrees = buildGrove(groveSpots(twinP, Math.max(4, Math.round((tier.groveTrees ?? 18) * 0.35)), 79), 43);
    const twinMesh = isle('twin', twinP, {
        // A third of the Spring Isle's apparent size: half its segments, half its rings.
        radial: Math.round(tier.isleRadial * 0.5),
        rings: Math.round(tier.isleRings * 0.55),
        segments: Math.round(tier.terraceSegments * 0.4),
        seed: 71,
        pinnacles: 4,
        pinnacleRadial: 9,
        extra: [aq, twinTrees],
        material: twinMaterial,
    });

    // ── The Far Gate: a colossal broken arch on a far isle's crown ──
    const gateP = plan.gate;
    const farGate = buildFarGate(gateP.width, gateP.height);
    anchors.weir = { x: farGate.weir[0], y: farGate.weir[1] - gateP.sink, z: farGate.weir[2] };
    const gateArch = farGate.geometry;
    gateArch.translate(0, -gateP.sink, 0);
    const gateBase = {
        top: 0, lip: -60, root: -gateP.height * 0.55, radius: gateP.width * 0.48, terraces: 0, crownPower: 0.25,
    };
    const gateMesh = isle('gate', gateBase, {
        radial: 40, rings: 28, segments: 32, seed: 123, pinnacles: 3, pinnacleRadial: 8, extra: [gateArch], material: gateMaterial,
    });

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
                tmpQ.setFromAxisAngle(AXIS_Y, e.yaw);
                const { start, count: n } = farSlots[i];
                for (let v = start; v < start + n; v++) {
                    tmpP.set(farRestPos[v * 3], farRestPos[v * 3 + 1], farRestPos[v * 3 + 2]).multiplyScalar(radius / FAR_UNIT).applyQuaternion(tmpQ);
                    farPos.array[v * 3] = tmpP.x + e.pos[0];
                    farPos.array[v * 3 + 1] = tmpP.y + e.pos[1];
                    farPos.array[v * 3 + 2] = tmpP.z + e.pos[2];
                    tmpS.set(farRestNrm[v * 3], farRestNrm[v * 3 + 1], farRestNrm[v * 3 + 2]).applyQuaternion(tmpQ);
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
            entryQuaternion(e, tmpQ);
            swingQ.setFromAxisAngle(AXIS_X, angle);
            tmpQ.multiply(swingQ);
            entryToWorld(e, anchors.bell.x, anchors.bell.y, anchors.bell.z, bellWorld);
            tmpP.set(bellWorld[0], bellWorld[1], bellWorld[2]);
            tmpS.setScalar(e.scale);
            bell.matrix.compose(tmpP, tmpQ, tmpS);
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

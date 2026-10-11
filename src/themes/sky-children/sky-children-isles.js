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
    // Keep only what every stone draw shares (merge needs identical attribute sets).
    Object.keys(geometry.attributes).forEach((k) => {
        if (!['position', 'normal', 'aMat', 'aAO'].includes(k)) geometry.deleteAttribute(k);
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
            const strata = (y < p.lip ? 0.035 : 0.012) * Math.sin(y * 0.23 + N.fbm3(ct * 1.3, y * 0.01, st * 1.3, 2) * 4);
            const drips = below * 0.14 * Math.abs(N.noise3(th * 7.5, y * 0.006, 2.3));
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
        const sTop = 0.06 + N.rand() * 0.22;
        const yTop = p.lip - depth * sTop;
        const at = bodyProfile(p, yTop) * (0.5 + 0.25 * N.rand());
        const len = depth * (0.2 + 0.32 * N.rand());
        const rad = bodyProfile(p, yTop) * (0.16 + 0.1 * N.rand());
        const lean = 0.1 + 0.12 * N.rand();
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
        const depth = run + 3;
        // The cascade is a fan down the front from the spring: narrow at the top, wide at the foot,
        // its middle meandering a little.
        const fan = ((span * Math.PI) / 2) * (0.16 + 0.84 * ((i + 1) / count) ** 0.8);
        const mid = Math.sin(i * 0.9 + N.rand()) * 0.16;
        const a0 = mid - fan * (0.85 + 0.15 * N.rand());
        const a1 = mid + fan * (0.85 + 0.15 * N.rand());
        const lobes = Math.max(2, Math.round((a1 - a0) * 4.2 + N.rand() * 2));
        const phase = N.rand() * Math.PI * 2;
        const prof = profile(H, depth, last ? 2.5 : 0.8);
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
                if (r === rows - 1) yy -= (Math.abs(N.noise3(c * 0.71, i, 3.3)) * 4 + scallop * 1.5) * (i === count - 1 ? 1 : 0.35);
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
    U, tex, reach = 6000, lamps = 0, lipY = 0, shadeBelow = null,
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
        // Iron-stone: dark, tafoni cups (darker) with lighter rims, white mineral drips.
        const cups = smoothstep(0.35, 0.75, s2.g).mul(0.4);
        const rims = smoothstep(0.55, 0.9, s2.b).mul(0.35);
        const rockStrata = texture(tex.noise, vec2(lp.x.add(lp.z).mul(0.01), lp.y.mul(0.05))).r;
        const rock = light.rock.mul(float(1.0).sub(cups.mul(0.5)).add(rims.mul(0.45)).mul(rockStrata.mul(0.55).add(0.6))).toVar();
        // White mineral drips: long vertical streaks down the dark root, thickest under the rim.
        const across = lp.x.mul(N.z.abs()).add(lp.z.mul(N.x.abs()));
        const drip = texture(tex.noise, vec2(across.mul(0.045), lp.y.mul(0.0035))).b;
        const dripFine = texture(tex.noise, vec2(across.mul(0.16), lp.y.mul(0.012)).add(0.3)).a;
        const underLip = smoothstep(-200.0, -12.0, lp.y.sub(lipY));
        const dripMask = smoothstep(0.6, 0.82, drip.mul(0.7).add(dripFine.mul(0.4))).mul(underLip);
        rock.assign(mix(rock, light.stone.mul(0.42), dripMask.mul(0.3)));
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
        crownRock.assign(mix(crownRock, moss, smoothstep(0.5, 0.78, N.y).mul(smoothstep(0.25, 0.55, nA.add(0.2)))));
        // Leaf: dark green crowns, warmer where the sun catches them.
        const leaf = mix(vec3(0.02, 0.05, 0.025), vec3(0.06, 0.1, 0.03), s2.r);
        const albedo = trav.toVar();
        albedo.assign(mix(albedo, rock, is(1)));
        albedo.assign(mix(albedo, bronze, is(2)));
        albedo.assign(mix(albedo, masonry, is(3)));
        albedo.assign(mix(albedo, crownRock, is(4)));
        albedo.assign(mix(albedo, leaf, smoothstep(4.5, 4.9, matId)));
        const ironK = is(1);

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
        const ironDim = mix(float(1.0), float(0.5), ironK);
        const lit = light.key.mul(U.keyGain).mul(diffuse).mul(0.55).mul(ironDim);
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

        // ── The air between ──
        const air = float(1.0).sub(exp(dist.div(-reach))).toVar();
        const far = airColour(V.negate(), U);
        col.assign(mix(col, far, min(air, 0.9)));
        return vec4(col, 1.0);
    })();
    return material;
}

/** A material for the far isles (the archipelago, the Far Gate): stone shading, more air. */
export function createFarStoneMaterial({ U, tex, reach = 4200 }) {
    return createStoneMaterial({ U, tex, reach });
}

export const _internals = {
    bodyProfile, makeNoise, archShape, outlineScale,
};

/** The stone kinds by name (tests check the ids stay put). */
export const STONE_KINDS = Object.freeze(['travertine', 'iron-stone', 'bronze', 'masonry', 'crown', 'leaf']);

// ── Where things stand on the isles (local metres) ──

/**
 * The anchors of the set pieces on the isles, local to each isle: the bell-arch and its bell on the
 * Spring Isle's left shoulder, the summit hump behind it, the aqueduct on the Twin Isle and the end
 * of its broken channel (where the span's fall leaves).
 */
export function isleAnchors(plan) {
    const sp = plan.spring;
    const tw = plan.twin;
    const archX = -sp.radius * 0.42;
    const archZ = -sp.radius * 0.12;
    const archY = crownHeightAt(sp, Math.hypot(archX, archZ)) - 1.5;
    const arch = {
        x: archX, y: archY, z: archZ, width: 14, height: 30, thick: 2.6, depth: 3,
    };
    const aq = {
        x: -tw.radius * 0.28, y: 0, z: tw.radius * 0.02, spans: 3, span: 16, height: 22, depth: 5,
    };
    aq.y = crownHeightAt(tw, Math.hypot(aq.x, aq.z)) - 2;
    const channelEnd = aq.span * (1.1 - aq.spans);
    return {
        arch,
        bell: { x: archX, y: archY + arch.height - arch.thick - 0.6, z: archZ },
        hump: {
            x: -sp.radius * 0.18, y: crownHeightAt(sp, sp.radius * 0.3) - 4, z: -sp.radius * 0.26,
        },
        aqueduct: aq,
        spanLip: { x: aq.x + channelEnd, y: aq.y + aq.height + aq.span * 0.22, z: aq.z },
    };
}

// ── The part: every stone, placed per layout ──

const tmpM = new THREE.Matrix4();
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
    const gateMaterial = createFarStoneMaterial({ U, tex, reach: 16000 });
    const cp = plan.corner;
    const cornerL = buildCrag(cp.size[0], cp.size[1], cp.size[2], { seed: 91, detail: 4, jag: 0.4 });
    const cornerR = buildCrag(cp.size[0] * 0.7, cp.size[1] * 0.8, cp.size[2] * 0.8, { seed: 93, detail: 3, jag: 0.4 });
    // The crags lie in the overlook's shadow; only a line along their tops stands in the sun. No
    // mineral drips (lipY far above them).
    const cornerMaterial = createStoneMaterial({
        U, tex, reach: 6000, lipY: 1e4, shadeBelow: Math.min(cornerL.userData.top, cornerR.userData.top) - cp.sunLine,
    });
    const materials = [material, twinMaterial, farMaterial, gateMaterial, cornerMaterial];
    const meshes = [];
    const geometries = [];
    const pools = [];
    const outlets = {};
    const anchors = isleAnchors(plan);

    const isle = (name, p, opts) => {
        const body = buildBody(p, {
            radial: opts.radial, rings: opts.rings, seed: opts.seed, frontCut: p.terraces ? 0.14 : 0.04, asym: opts.asym ?? 0.2,
        });
        const parts = [body];
        if (opts.pinnacles) {
            parts.push(buildPinnacles(p, {
                count: opts.pinnacles, seed: opts.seed + 3, radial: opts.pinnacleRadial ?? 12, rings: 12,
            }));
        }
        if (p.terraces) {
            const terraces = buildTerraces(p, {
                count: p.terraces, segments: opts.segments, seed: opts.seed + 11, asym: opts.asym ?? 0.2,
            });
            parts.push(terraces.geometry);
            outlets[name] = terraces.outlets;
            terraces.pools.forEach((q) => pools.push({
                isle: name, local: { x: q.x, y: q.y, z: q.z }, radius: q.radius, level: q.level, world: [0, 0, 0],
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
    const springP = plan.spring;
    const { arch: a } = anchors;
    const arch = buildArch(a.width, a.height, a.thick, a.depth, { mat: MAT.bronze });
    arch.translate(a.x, a.y, a.z);
    const hump = buildCrag(springP.radius * 0.36, 14, springP.radius * 0.3, { seed: 61, detail: 3 });
    hump.translate(anchors.hump.x, anchors.hump.y, anchors.hump.z);
    const treeSpots = [];
    {
        const rand = mulberry32(77);
        for (let i = 0; i < 11; i++) {
            const ang = Math.PI * (1.05 + rand() * 0.75); // the back-left quarter
            const rho = springP.radius * (0.22 + rand() * 0.5);
            const x = Math.cos(ang) * rho;
            const z = Math.sin(ang) * rho * 0.8;
            treeSpots.push([x, crownHeightAt(springP, Math.hypot(x, z)) - 0.5, z, 3 + rand() * 2.6]);
        }
    }
    const trees = buildTrees(treeSpots, 41);
    const springMesh = isle('spring', springP, {
        radial: tier.isleRadial,
        rings: tier.isleRings,
        segments: tier.terraceSegments,
        seed: 33,
        pinnacles: 7,
        extra: [arch, hump, trees],
    });

    // ── The Twin Isle: the aqueduct's stub reaching toward the card (local −x) ──
    const twinP = plan.twin;
    const aqA = anchors.aqueduct;
    const aq = buildAqueduct(aqA.spans, aqA.span, aqA.height, aqA.depth);
    aq.translate(aqA.x, aqA.y, aqA.z);
    const twinTrees = buildTrees([
        [twinP.radius * 0.3, crownHeightAt(twinP, twinP.radius * 0.35) - 0.5, -twinP.radius * 0.2, 3.2],
        [twinP.radius * 0.42, crownHeightAt(twinP, twinP.radius * 0.5) - 0.5, -twinP.radius * 0.05, 2.6],
        [twinP.radius * 0.15, crownHeightAt(twinP, twinP.radius * 0.3) - 0.5, -twinP.radius * 0.35, 2.8],
    ], 43);
    const twinMesh = isle('twin', twinP, {
        radial: Math.round(tier.isleRadial * 0.75),
        rings: Math.round(tier.isleRings * 0.8),
        segments: Math.round(tier.terraceSegments * 0.7),
        seed: 71,
        pinnacles: 4,
        pinnacleRadial: 9,
        extra: [aq, twinTrees],
        material: twinMaterial,
    });

    // ── The Far Gate: a colossal broken arch on a far isle's crown ──
    const gateP = plan.gate;
    const gateArch = buildArch(gateP.width, gateP.height, gateP.width * 0.15, gateP.width * 0.14, { mat: MAT.masonry });
    gateArch.translate(0, -gateP.sink, 0);
    const gateBase = {
        top: 0, lip: -40, root: -gateP.height * 1.3, radius: gateP.width * 0.62, terraces: 0, crownPower: 0.25,
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

    // The archipelago: one instanced draw of teardrop isles.
    const count = tier.archipelago;
    const farGeo = buildBlob(1, {
        seed: 17, detail: 2, flatTop: 0.22, taper: 2.6,
    });
    geometries.push(farGeo);
    const archipelago = new THREE.InstancedMesh(farGeo, farMaterial, count);
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
            // The archipelago.
            for (let i = 0; i < count; i++) {
                const e = placement.archipelago[i % placement.archipelago.length];
                tmpQ.setFromAxisAngle(AXIS_Y, e.yaw);
                tmpS.set(e.scale * 260, e.scale * 230, e.scale * 260);
                tmpP.set(e.pos[0], e.pos[1], e.pos[2]);
                tmpM.compose(tmpP, tmpQ, tmpS);
                archipelago.setMatrixAt(i, tmpM);
            }
            archipelago.instanceMatrix.needsUpdate = true;
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
            archipelago.dispose();
        },
    };
}

export { smooth, max };

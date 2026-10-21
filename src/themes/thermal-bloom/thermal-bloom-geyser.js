/**
 * Thermal Bloom — the geysers (iris-springs.md §1.2, §1.4, §3.6.2): the Chalice's sinter cone on
 * its mound, the eruption columns, their spray veils, splash collars and the spray particles.
 *
 * The Chalice: one heightfield (a polar grid, computed on the CPU) — a cream mound that falls
 * smoothly to the apron and sinks under it (no vertical face anywhere, the depth test cuts it),
 * a squat, lumpy, off-centre cone with a ragged lip round a dark wet vent, and the Stair's head
 * set into it: the mound passes under the Stair's terraces and carries their shoulders, so the
 * Stair descends from the cone rather than standing under a lid. Shading: beaded "popcorn"
 * sinter on the cone (cellular beads, embossed toward the sun, triplanar so nothing streaks down
 * the steep faces), wet streaks down its splash side, bright and dark spicule specks round its
 * base; cellular sinter scale on the mound, radial runoff rills (a wet-dark core, orange-brown
 * stains), the spouters' wet rings; its foot settles into the apron's own colour and light.
 *
 * The columns: one open lathe per eruption slot (the Chalice, the Consort, the Sleeper, the
 * spouters), three layers drawn in one call: the water column, a soft haze shell round it (the
 * rain skirt at the fall-back), and a low splash collar at the vent. Each reads its slot's two
 * rows of the event table, which the world writes from the closed-form schedules: (x, z, base,
 * height) and (radius, fall, flare, kind). The shape widens with height and flares at the crown
 * where the water slows (r ∝ 1/√v), displaced ±15% by two noise octaves; the density streaks up
 * with the water and erodes toward the rim (alpha from the view·normal thickness × the streaks),
 * so the silhouette dissolves; lit like the steam — Steam Pearl on the lit side, blue-grey in
 * shade — never emissive. At the fall-back the crown holds its height while the column empties
 * from the base up and a rain skirt falls from the crown. Dormant slots fold away.
 *
 * The spray: one pool of quads on closed-form ballistic paths from the live columns' vents
 * (p0 + v0·t + ½g·t²), killed at landing, floored at about a pixel; at the fall-back the drops
 * fall from the crown instead.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    dFdx,
    dFdy,
    sign,
    cross,
    Loop,
    abs,
    atan,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    normalWorld,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CHALICE,
    ELEVATION,
    EVENT_ROWS,
    EVENT_SLOTS,
    STEAM_LEAN,
    TB_APRON,
    tbAerial,
    tbCloudShade,
    SURFACE_SUN,
    tbBounce,
    tbBow,
    tbFxMaterial,
    tbHash21,
    tbHgMix,
    tbLuma,
    tbMax3,
    tbPart,
    tbSteamVeil,
} from './thermal-bloom-tsl.js';
import { STAIR, stairGenerator } from './thermal-bloom-bake.js';

const TAU = Math.PI * 2;
/** Gravity (m/s²) for the spray. */
const G = 9.81;

// ── The Chalice's ground (CPU) ─────────────────────────────────────────────────

/**
 * The Chalice's shape (metres). Heights are relative to the vent's base (the cone's foot, at
 * ELEVATION.chalice above the apron); the frame turns with the Stair, +z down the Stair.
 * mound    the mound's mean radius (its lobes reach ±16%), `crest` where it starts to fall,
 *          `spur` how much further it runs out under the Stair (a spur the Stair descends,
 *          half-burying the Stair's upper flanks), `reach` the mesh's own edge
 * sink     how far the skirt sinks under the apron (the depth test cuts it: no vertical face)
 * cone     the cone's height, its foot's and its lip's radii, and its lip's centre (off-axis)
 * flank    where the Stair's head stands from the vent (the world lays it CHALICE.radius × 1.6
 *          down the Stair's line)
 * head     the Stair's head row (metres from the vent) and how far the chute drops from the
 *          cone's foot down to it: across the Stair's width the mound runs down into its top
 *          terrace, easing out level onto it, with no bank and no overhang
 */
export const CHALICE_SHAPE = Object.freeze({
    mound: CHALICE.mound,
    spur: 0.5,
    reach: 80,
    crest: 8,
    sink: 0.6,
    cone: Object.freeze({
        height: CHALICE.height, foot: CHALICE.radius - 0.5, lip: 2.0, x: 0.5, z: -0.4,
    }),
    flank: CHALICE.radius * 1.6,
    head: Object.freeze({ z: 15.5, drop: 4.4 }),
});
const GROUND = -ELEVATION.chalice;

function hashI(x, y, s) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ s;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smoothT = (t) => t * t * (3 - 2 * t);
const smooth01 = (a, b, x) => smoothT(Math.max(0, Math.min(1, (x - a) / (b - a))));
/** Value noise in [0, 1]. */
function vnoise(x, y, s) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smoothT(x - xi);
    const fy = smoothT(y - yi);
    const a = hashI(xi, yi, s);
    const b = hashI(xi + 1, yi, s);
    const c = hashI(xi, yi + 1, s);
    const d = hashI(xi + 1, yi + 1, s);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
/** Value noise round a circle of `n` cells, in [−1, 1] (no seam). */
function anoise(angle, n, s) {
    const v = ((((angle / TAU) % 1) + 1) % 1) * n;
    const i = Math.floor(v);
    const f = smoothT(v - i);
    const h0 = hashI(i % n, 0, s);
    const h1 = hashI((i + 1) % n, 0, s);
    return (h0 + (h1 - h0) * f) * 2 - 1;
}
/** A smooth maximum (k metres of blend). */
function smax(a, b, k) {
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
    return a * (1 - h) + b * h + k * h * (1 - h);
}

/**
 * The Chalice's ground as a function of the local (x, z): `height(x, z)` (metres above the vent's
 * base) and `stairAt(x, z)` (the Stair's own surface there and its edge fade, or null). The Stair
 * is sampled from the same generator (and tier count) the terraces bake, so the mound passes
 * under its terraces and takes its shoulders without a seam or an overhang. Three-free.
 * @param {{ tiers?: number }} options  the Stair's tier count (the quality tier's stairTiers)
 */
export function chaliceField({ tiers = 10 } = {}) {
    const S = CHALICE_SHAPE;
    const gen = stairGenerator({ tiers });
    const sample = {};
    const stairAt = (x, z) => {
        const s = (z - S.flank) / STAIR.length;
        if (s < STAIR.sMin || s > STAIR.sMax) return null;
        const width = gen.widthAt(s);
        if (Math.abs(x) > width * 1.3) return null;
        gen.sample(s, x, sample);
        return { height: sample.height + GROUND, edge: sample.edge };
    };
    // The Stair's head row, tabulated across: its floor's height and how solid it is there.
    const headX0 = -40;
    const headN = 161;
    const headH = new Float32Array(headN);
    const headW = new Float32Array(headN);
    for (let i = 0; i < headN; i++) {
        const v = stairAt(headX0 + i * 0.5, S.head.z);
        headH[i] = v ? v.height : GROUND;
        headW[i] = v ? smooth01(0.55, 0.95, v.edge) : 0;
    }
    const head = (table, x) => {
        const f = Math.max(0, Math.min(headN - 1.001, (x - headX0) / 0.5));
        const i = Math.floor(f);
        return table[i] + (table[i + 1] - table[i]) * (f - i);
    };
    const C = S.cone;
    /** The mound alone (no cone, no Stair): lobed, settling into the apron and sinking under it. */
    /** The mound's lobed radius toward angle `a` (longer down the Stair: the spur). */
    const lobedAt = (a) => {
        const down = Math.max(0, Math.cos(a));
        return S.mound * (1 + 0.13 * anoise(a, 5, 11) + 0.06 * anoise(a, 11, 13)) * (1 + S.spur * down * down);
    };
    const moundAt = (x, z) => {
        const r = Math.hypot(x, z);
        const a = Math.atan2(x, z);
        // Concave flanks, steepest by the cone and easing out onto the apron (no shoulder that
        // could read as a plate's bevelled lip); toward the Stair a fuller spur that carries its
        // head and half buries its upper flanks.
        const lin = Math.max(0, Math.min(1, (r - S.crest) / (lobedAt(a) - S.crest)));
        const soft = Math.hypot(lin, 0.06) - 0.06;
        const concave = (1 - Math.min(1, soft / 0.94)) ** 1.7;
        const st = smooth01(0, 1, lin);
        const full = (1 - st) ** 1.05;
        const down = Math.max(0, Math.cos(a));
        const h = GROUND - S.sink + (S.sink - GROUND) * (concave + (full - concave) * down * down);
        // Relief on the skirt (none at the crest or the foot): broad lumps of old sinter and
        // wandering runoff gullies down the fall line, so its outline is never a turned plate.
        const skirt = 4 * lin * (1 - lin);
        const lumps = (vnoise(x / 15, z / 15, 7) - 0.5) * 3.2 + (vnoise(x / 6, z / 6, 9) - 0.5) * 0.8;
        const g = anoise(a + 0.25 * (vnoise(r / 9, 0.5, 63) - 0.5), 19, 61);
        const gully = smooth01(0.35, 0.85, g) * 0.9;
        return h + (lumps - gully) * skirt;
    };
    /** How far out on the mound's skirt (x, z) lies: 0 at its crest … 1 at its lobed foot. */
    const skirtAt = (x, z) => {
        const r = Math.hypot(x, z);
        return Math.max(0, Math.min(1, (r - S.crest) / (lobedAt(Math.atan2(x, z)) - S.crest)));
    };
    /**
     * The cone: a squat, knobbly beehive of sinter, leaning, its lip off the axis and ragged
     * (higher on one side, notched where the water spills toward the Stair), the vent a bowl.
     */
    const coneAt = (x, z) => {
        const r = Math.hypot(x, z);
        const pull = smooth01(C.foot, 0, r);
        const dx = x - C.x * pull;
        const dz = z - C.z * pull;
        const rc = Math.hypot(dx, dz);
        const a = Math.atan2(dx, dz);
        const foot = C.foot * (1 + 0.18 * anoise(a, 4, 21) + 0.08 * anoise(a, 9, 23));
        const lip = C.lip * (1 + 0.14 * anoise(a, 5, 25));
        const notch = Math.exp(-(((Math.atan2(Math.sin(a - 0.3), Math.cos(a - 0.3))) / 0.32) ** 2));
        const top = C.height * (1 + 0.12 * anoise(a, 3, 27)) - 0.9 * notch;
        let h;
        if (rc <= lip) {
            const q = rc / lip;
            h = top - 2.6 * (1 - q * q) ** 1.2;
        } else {
            const q = Math.min(1, (rc - lip) / (foot - lip));
            h = top * (1 - q ** 1.9) - 0.6 * q - 2.5 * Math.max(0, rc - foot);
        }
        const lumps = (vnoise(x / 2.4, z / 2.4, 31) - 0.5) * 1.6 + (vnoise(x / 1.2, z / 1.2, 33) - 0.5) * 0.6
            + (vnoise(x / 0.6, z / 0.6, 35) - 0.5) * 0.25;
        return h + lumps * smooth01(0, 1.2, rc - lip) * smooth01(foot + 1, foot - 1.5, rc);
    };
    // (past this radius the cone lies far under the mound: the blend would return the mound)
    const coneReach = C.foot * 1.3 + 3;
    const height = (x, z) => {
        const mound = moundAt(x, z);
        let h = Math.hypot(x, z) < coneReach ? smax(mound, coneAt(x, z), 1.2) : mound;
        if (z < S.head.z) {
            // Above the Stair's head: a chute from the cone's foot down onto its top terrace
            // (only outside the cone's own foot: the chute never cuts the cone), steep by the
            // cone, easing out level onto the terrace (no crease at the head).
            const w = head(headW, x) * smooth01(C.foot - 0.5, C.foot + 2.5, Math.hypot(x, z));
            if (w > 0) {
                const k = Math.max(0, (S.head.z - z) / (S.head.z - C.foot));
                const chute = head(headH, x) - 0.4 + S.head.drop * k * k;
                h += (Math.min(h, chute) - h) * w;
            }
        } else {
            // Down the Stair: its terraces are laid over the mound (it passes under them).
            const st = stairAt(x, z);
            if (st) h += (Math.min(h, st.height - 0.4) - h) * smooth01(0.8, 0.97, st.edge);
        }
        return Math.max(h, GROUND - S.sink - 0.4);
    };
    return { height, stairAt, skirtAt };
}

/**
 * The Chalice's mesh: a polar grid round the vent (rings dense at the cone, coarse at the
 * skirt), heights from `chaliceField`, no seam round the angle (the last spoke wraps onto the
 * first, so the normals are continuous); a `skirt` attribute says how far out on the mound's
 * lobed skirt each vertex lies (its outer part takes the apron's colour).
 */
export function chaliceGeometry(field, spokes, rings) {
    const S = CHALICE_SHAPE;
    const count = 1 + rings * spokes;
    const positions = new Float32Array(count * 3);
    const skirt = new Float32Array(count);
    positions[1] = field.height(0, 0);
    for (let i = 0; i < rings; i++) {
        const r = S.reach * ((i + 1) / rings) ** 1.6;
        for (let j = 0; j < spokes; j++) {
            const a = (j / spokes) * TAU;
            const x = Math.sin(a) * r;
            const z = Math.cos(a) * r;
            const o = (1 + i * spokes + j) * 3;
            positions[o] = x;
            positions[o + 1] = field.height(x, z);
            positions[o + 2] = z;
            skirt[1 + i * spokes + j] = field.skirtAt(x, z);
        }
    }
    const index = new Uint32Array(spokes * 3 + (rings - 1) * spokes * 6);
    let n = 0;
    for (let j = 0; j < spokes; j++) {
        index[n++] = 0;
        index[n++] = 1 + j;
        index[n++] = 1 + ((j + 1) % spokes);
    }
    for (let i = 0; i < rings - 1; i++) {
        for (let j = 0; j < spokes; j++) {
            const a0 = 1 + i * spokes + j;
            const b0 = 1 + i * spokes + ((j + 1) % spokes);
            const a1 = a0 + spokes;
            const b1 = b0 + spokes;
            index[n++] = a0;
            index[n++] = a1;
            index[n++] = b0;
            index[n++] = b0;
            index[n++] = a1;
            index[n++] = b1;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('skirt', new THREE.BufferAttribute(skirt, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * The Sleeper's broad dormant mound (§3.12): a low shield of old sinter round a shallow crater,
 * (radius, height above its crater's lip) from the foot up; its foot sinks into the far ground.
 */
const SLEEPER_PROFILE = Object.freeze([
    [95, -22], [80, -15], [64, -8.5], [48, -3.6], [32, -0.6], [18, 0.6], [9, 0.8], [6.5, 0.5],
    [4.6, -0.5], [2.8, -1.4], [0.01, -1.6],
]);
/** The Consort's low mound round its small pool (§3.5); the pool is the flat top inside 3.2 m. */
const CONSORT_PROFILE = Object.freeze([
    [17, -3], [13, -1.5], [9, -0.4], [5.5, 0.15], [3.6, 0.32], [3.2, 0.12], [0.01, 0.12],
]);
/** The Consort's pool radius (metres). */
const CONSORT_POOL = 3.2;

/**
 * Column kinds (the slot's row 1, w): see createColumns. A standing column's row 1 z carries its
 * steam (its height in whole metres plus its amount, 0..1, as the fraction).
 */
export const COLUMN_KIND = Object.freeze({
    water: 0, spouter: 1, standing: 2, jet: 3,
});
/** The brightest lit water and steam (scene-linear, max channel): about 0.95 on the display (the jet reads white). */
const COLUMN_PEAK = 0.95;
/**
 * The Chalice's cone as the surge's overflow follows it (metres, relative to the vent's row, which
 * stands CHALICE.height − 0.6 above the cone's foot): the lip's and the foot's radii, the cone's
 * height over its foot, and the row's height over the foot.
 */
const SPILL = Object.freeze({
    lip: 2.1, foot: 6.2, top: CHALICE.height, base: CHALICE.height - 0.6,
});

/** The geysers' rows from a world's schedules (written by the world each frame). */
export const COLUMN_SLOT = Object.freeze({
    chalice: 0, consort: 1, sleeper: 2, spouter0: 3,
});

/**
 * A lathe of `profile` [(r, y)…] with `segments` round it, its outline made lumpy (a sinter mound
 * is never a turned bowl): the radius and height wander with the angle, more on the skirts.
 */
function lathe(profile, segments) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    const geometry = new THREE.LatheGeometry(pts, segments);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.hypot(x, z);
        if (r < 1e-3) continue;
        const a = Math.atan2(z, x);
        const skirt = Math.min(1, Math.max(0, (r - 6) / 30));
        const wobble = 0.1 * Math.sin(3 * a + 0.7) + 0.07 * Math.sin(5 * a + 2.1 + r * 0.05)
            + 0.04 * Math.sin(11 * a + r * 0.2);
        const k = 1 + wobble * skirt;
        pos.setXYZ(i, x * k, pos.getY(i) + wobble * 6 * skirt * (1 - skirt), z * k);
    }
    geometry.computeVertexNormals();
    return geometry;
}

// ── Shared shading terms ──────────────────────────────────────────────────────

/**
 * The plume shadows on the ground at P, as the basin casts them (each plume's axis cast along
 * the sun, Beer over its thickness), so a shadow crossing the mound's foot never stops at it.
 */
function plumeShadow(u, P) {
    const shade = float(0.0).toVar();
    Loop({
        start: int(0), end: u.steamCount, type: 'int', condition: '<', name: 'cpl',
    }, ({ cpl }) => {
        const A = u.steamPlumes.element(cpl.mul(2));
        const B = u.steamPlumes.element(cpl.mul(2).add(1));
        const run = u.sunDir.xz.div(max(u.sunDir.y, 0.15));
        const top = A.w.mul(0.85);
        const lean = u.windDir.mul(u.windSpeed.mul(STEAM_LEAN)).mul(top.div(400.0).add(1.0));
        const a0 = A.xy.sub(run.mul(A.z.sub(P.y)));
        const a1 = A.xy.add(lean.mul(top)).sub(run.mul(A.z.add(top).sub(P.y)));
        const seg = a1.sub(a0);
        const f = clamp(dot(P.xz.sub(a0), seg).div(max(dot(seg, seg), 1e-3)), 0.0, 1.0);
        const e = length(P.xz.sub(a0.add(seg.mul(f)))).div(max(mix(B.x, B.y, sqrt(f)), 1.0));
        const thick = min(B.x.div(25.0), 1.0);
        const shadowK = max(B.z, step(abs(B.w.sub(1.0)), 0.5));
        // The Chalice's own steam (the thread kind) stands round its cone in a white fog: it
        // shades the ground beyond its foot, not the cone inside it.
        const own = step(abs(B.w.sub(2.0)), 0.5);
        const inside = own.mul(smoothstep(B.x.mul(1.2).add(6.0), B.x.mul(0.4), length(P.xz.sub(A.xy))));
        shade.addAssign(exp(e.mul(e).mul(-1.4)).mul(shadowK).mul(thick).mul(float(1.0).sub(f.mul(0.5)))
            .mul(float(1.0).sub(inside)));
    });
    return exp(shade.mul(u.steam).mul(-1.2));
}

/** The basin's dry sinter at P (its bright flats against damp grey), so the mound's foot meets it. */
function apronAlbedo(tex, P) {
    const noise = (uv) => texture(tex.noise, uv);
    const pr = vec2(P.x.mul(0.8).sub(P.z.mul(0.6)), P.x.mul(0.6).add(P.z.mul(0.8)));
    const pq = vec2(P.x.mul(0.34).add(P.z.mul(0.94)), P.z.mul(0.34).sub(P.x.mul(0.94)));
    const flatsN = noise(pq.mul(0.016 / 4)).x.mul(0.6).add(noise(pr.mul(0.0123 / 4)).y.mul(0.4))
        .add(noise(pr.mul(0.09 / 4)).y.sub(0.5).mul(0.25));
    const flats = smoothstep(0.3, 0.72, flatsN);
    return mix(vec3(0.53, 0.51, 0.47), vec3(0.65, 0.63, 0.58), flats);
}

/** Triplanar cellular lookup (world metres per tile `tile`), weighted by the normal. */
function cellularTri(tex, P, N, tile) {
    const w = abs(N).toVar();
    w.assign(w.mul(w).mul(w.mul(w)));
    w.divAssign(w.x.add(w.y).add(w.z).add(1e-4));
    const a = texture(tex.cellular, P.zy.div(tile));
    const b = texture(tex.cellular, P.xz.div(tile));
    const c = texture(tex.cellular, P.xy.div(tile));
    return a.mul(w.x).add(b.mul(w.y)).add(c.mul(w.z));
}

/**
 * The Chalice: its mound, cone and vent, standing on its vent's base (world y of the base); the
 * mesh turns with the Stair (`place(x, y, z, dir)`, dir the Stair's downhill line in world xz).
 * @param {object} u    the shared uniforms
 * @param {object} tier the quality tier
 * @param {object} tex  the world's baked textures
 */
export function createChalice(u, tier, tex) {
    const field = chaliceField({ tiers: tier.stairTiers });
    const spokes = tier.columnMesh[0] * 8;
    const rings = Math.round(tier.columnMesh[1] * 7);
    const geometry = chaliceGeometry(field, spokes, rings);
    const C = CHALICE_SHAPE.cone;
    const chaliceFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const L = positionLocal.toVar();
        const r = length(L.xz).toVar();
        const ang = atan(L.x, L.z).toVar();
        const N0 = normalize(normalWorld).toVar();
        // Metres a pixel covers here: fine terms fade by it.
        const foot = dist.mul(u.pixelAngle).div(max(abs(dot(N0, V)), 0.2)).toVar();
        const fadeBy = (size) => float(1.0).sub(smoothstep(size * 0.25, size, foot));
        const lc = L.xz.sub(vec2(C.x, C.z));
        const rc = length(lc).toVar();
        // Where the cone stands (its flanks and lip), where the splash zone reaches.
        const cone = smoothstep(C.foot + 1.0, C.foot - 1.5, rc).toVar();
        const splash = smoothstep(14.0, 4.0, r).toVar();
        const above = P.y.toVar(); // metres above the apron

        // ── The mound: cream round the cone, paler grey-cream down the slope, old grey patches ──
        const mott = texture(tex.noise, P.xz.div(34.0)).z.mul(0.6).add(texture(tex.noise, P.xz.div(11.0)).w.mul(0.4))
            .toVar();
        const cream = vec3(0.8, 0.76, 0.66);
        const pale = vec3(0.68, 0.65, 0.58);
        const albedo = mix(pale, cream, splash.add(mott.sub(0.5).mul(0.6)).clamp(0.0, 1.0)).toVar();
        const oldPatch = smoothstep(0.52, 0.7, mott).mul(smoothstep(9.0, 16.0, r));
        albedo.assign(mix(albedo, vec3(0.55, 0.52, 0.47), oldPatch.mul(0.55)));
        // Cellular sinter scale: plates of old crust (two sizes), each its own tone, cracks between
        // them that fade to their mean under a pixel.
        const cellA = texture(tex.cellular, P.xz.div(20.0)).toVar();
        const cellB = texture(tex.cellular, P.xz.div(52.0).add(vec2(0.37, 0.71))).toVar();
        const plate = cellA.z.sub(0.5).mul(0.1).add(cellB.z.sub(0.5).mul(0.12));
        const crack = smoothstep(0.18, 0.0, cellA.x).mul(fadeBy(0.5)).mul(0.7)
            .add(smoothstep(0.12, 0.0, cellB.x).mul(fadeBy(1.2)).mul(0.6));
        const onMound = float(1.0).sub(cone).toVar();
        albedo.mulAssign(float(1.0).add(plate.mul(onMound)).sub(crack.mul(0.24).mul(onMound)));
        // Radial runoff rills down the fall line: a wet-dark core, orange-brown stains at its
        // margins, most where the vent's water runs (toward the Stair), fading on the dry back.
        const rillUV = vec2(ang.mul(9.0 / TAU), r.div(52.0).add(texture(tex.noise, P.xz.div(70.0)).x.mul(0.25)));
        const rillN = texture(tex.noise, rillUV).w.toVar();
        const rillB = texture(tex.noise, rillUV.mul(vec2(2.0, 1.6)).add(0.31)).w;
        const toStair = cos(ang).mul(0.5).add(0.5).toVar();
        const rillZone = smoothstep(C.foot - 1.0, C.foot + 3.0, rc).mul(smoothstep(0.5, 4.5, above)).toVar();
        const wetCore = smoothstep(0.86, 0.95, rillN).add(smoothstep(0.9, 0.97, rillB).mul(0.6)).clamp(0.0, 1.0)
            .mul(rillZone)
            .mul(toStair.mul(0.6).add(0.4))
            .toVar();
        const stain = smoothstep(0.7, 0.86, rillN).add(smoothstep(0.78, 0.9, rillB).mul(0.5)).clamp(0.0, 1.0)
            .mul(rillZone)
            .mul(toStair.mul(0.7).add(0.3))
            .toVar();
        const stainCol = mix(vec3(0.68, 0.4, 0.18), vec3(0.46, 0.26, 0.13), texture(tex.noise, P.xz.div(7.0)).y);
        albedo.assign(mix(albedo, stainCol, stain.mul(0.5)));
        // The vent's runoff keeps mats alive down the rills toward the Stair, cooling as it runs:
        // lemon near the cone, orange, then rust (the Stair's own bands begin here).
        const runCool = smoothstep(C.foot, 34.0, r).toVar();
        const living = mix(
            mix(vec3(0.8, 0.6, 0.08), vec3(0.82, 0.33, 0.07), smoothstep(0.0, 0.45, runCool)),
            vec3(0.45, 0.13, 0.03),
            smoothstep(0.45, 1.0, runCool),
        );
        albedo.assign(mix(albedo, living, stain.mul(toStair).mul(0.7).add(wetCore.mul(0.35)).clamp(0.0, 0.85)));
        // The chute above the Stair's head: the vent's water runs down it, so it is wet and
        // stained, darkening into the Stair's own aged head (no bright lip against it).
        const chute = smoothstep(C.foot - 2.0, 13.5, L.z).mul(smoothstep(21.0, 11.0, abs(L.x))).toVar();
        const chuteStreak = smoothstep(0.45, 0.75, texture(tex.noise, vec2(L.x.div(9.0), L.z.div(40.0))).y);
        const chuteCol = mix(vec3(0.44, 0.4, 0.33), vec3(0.55, 0.36, 0.2), chuteStreak.mul(0.55));
        albedo.assign(mix(albedo, chuteCol, chute.mul(chute.mul(0.35).add(0.6))));

        // ── The cone: knobbly beaded "popcorn" sinter, embossed toward the sun ──
        const sunT = normalize(u.sunDir.sub(N0.mul(dot(u.sunDir, N0))).add(vec3(1e-4, 0.0, 0.0))).mul(0.12);
        const bead = cellularTri(tex, P, N0, 8.4).toVar();
        const beadSun = cellularTri(tex, P.add(sunT), N0, 8.4);
        const beadFade = fadeBy(0.7).toVar();
        const emboss = bead.w.sub(beadSun.w).mul(beadFade);
        const pores = smoothstep(0.22, 0.0, bead.x).mul(beadFade);
        const knob = cellularTri(tex, P.add(vec3(3.1, 0.0, 1.7)), N0, 16.0);
        const coneTone = mix(vec3(0.8, 0.77, 0.69), vec3(0.62, 0.59, 0.53), smoothstep(0.55, 0.85, knob.z).mul(0.7));
        albedo.assign(mix(albedo, coneTone, cone.mul(0.9)));
        const beadZone = cone.add(splash.mul(0.3)).clamp(0.0, 1.0);
        albedo.mulAssign(float(1.0).add(emboss.mul(0.7).sub(pores.mul(0.35)).mul(beadZone)));
        // Spicules round the cone's foot: bright and dark specks, fading to their mean by the pixel.
        const sp = P.xz.div(0.35);
        const spCell = floor(sp);
        const spH = tbHash21(spCell.add(17.3)).toVar();
        const spAt = vec2(tbHash21(spCell.add(3.1)), tbHash21(spCell.add(7.7)));
        const spDot = smoothstep(0.4, 0.15, length(fract(sp).sub(spAt
            .mul(0.5)
            .add(0.25))));
        const spZone = smoothstep(2.0, 4.0, rc).mul(smoothstep(14.0, 7.0, r)).mul(fadeBy(0.35));
        const speck = step(0.78, spH).mul(0.6).sub(step(spH, 0.2).mul(0.55)).mul(spDot)
            .mul(spZone);
        albedo.mulAssign(float(1.0).add(speck));
        // Wet streaks down the splash side (toward the Stair): darker, with old orange-grey stains.
        const streakN = texture(tex.noise, vec2(ang.mul(13.0 / TAU), L.y.div(7.0))).w;
        const splashSide = smoothstep(-0.3, 0.6, cos(ang.sub(0.3)));
        const wetStreak = smoothstep(0.55, 0.8, streakN).mul(splashSide).mul(cone)
            .mul(smoothstep(C.height + 0.5, 0.5, L.y))
            .toVar();
        albedo.assign(mix(albedo, vec3(0.5, 0.4, 0.3), wetStreak.mul(0.5)));
        // The vent: a dark wet throat inside the lip, the rim round it wet and dark.
        const throat = smoothstep(C.lip * 0.98, C.lip * 0.6, rc);
        const wetLip = smoothstep(C.lip + 1.4, C.lip * 0.9, rc).mul(cone);

        // ── The spouters' wet rings (their rows in the event table) ──
        const ring = float(0.0).toVar();
        for (let s = COLUMN_SLOT.spouter0; s < EVENT_SLOTS.eruptions; s++) {
            const A = u.events.element(int(s * 2 + EVENT_ROWS.eruptions));
            const B = u.events.element(int(s * 2 + EVENT_ROWS.eruptions + 1));
            const isSp = step(abs(B.w.sub(COLUMN_KIND.spouter)), 0.5).mul(step(0.05, A.w));
            const d = length(P.xz.sub(A.xy));
            ring.assign(max(ring, smoothstep(3.2, 0.8, d).mul(isSp)));
        }
        const wet = clamp(wetCore.mul(0.8).add(wetStreak.mul(0.8)).add(wetLip.mul(0.7)).add(ring.mul(0.75))
            .add(chute.mul(0.35)), 0.0, 1.0)
            .toVar();
        albedo.mulAssign(float(1.0).sub(wet.mul(0.42)));
        const ringStain = smoothstep(0.3, 0.8, ring).mul(smoothstep(1.0, 0.6, ring));
        albedo.assign(mix(albedo, vec3(0.6, 0.38, 0.2).mul(0.7), ringStain
            .mul(0.45)));
        albedo.mulAssign(float(1.0).sub(throat.mul(0.9)));

        // ── The seasons: rime in First Frost, snow in Deep Cold on the cold skirts only ──
        const cold = smoothstep(11.0, 18.0, r).mul(float(1.0).sub(wet)).toVar();
        const drift = smoothstep(0.35, 0.65, mott.add(cellB.z.sub(0.5).mul(0.3)));
        albedo.assign(mix(albedo, vec3(0.8, 0.82, 0.84), u.frost.mul(cold).mul(drift).mul(0.35)));
        albedo.assign(mix(albedo, vec3(0.78, 0.81, 0.86), u.snow.mul(cold).mul(drift.mul(0.5).add(0.45))));

        // ── The foot settles into the apron: the dead mats and damp grey sinter round it, the
        // rills running on into the basin as orange-brown mat streaks ──
        // (near the Iris the apron round the mound is its outer dead mats; far out, as on the
        // upright preset, bleached dry sinter: the foot takes whichever the basin has there)
        const fromIris = length(P.xz.sub(u.irisCentre)).div(u.irisRadius);
        const dry = max(smoothstep(0.5, 0.8, mott).mul(0.6), smoothstep(6.0, 10.0, fromIris));
        const matsFoot = mix(vec3(0.29, 0.25, 0.21), apronAlbedo(tex, P).mul(mix(float(0.72), float(1.0), dry)), dry);
        const footRill = smoothstep(0.72, 0.9, rillN).mul(toStair.mul(0.6).add(0.4));
        const apron = mix(mix(matsFoot, vec3(0.5, 0.27, 0.12), footRill.mul(0.55)), vec3(0.6, 0.63, 0.68), u.snow);
        const footW = max(smoothstep(0.6, 0.92, attribute('skirt', 'float')), smoothstep(5.5, 0.2, above))
            .mul(smoothstep(14.0, 26.0, r))
            .toVar();
        albedo.assign(mix(albedo, apron, footW));

        // ── Light: the knobs tilt the cone's normal; the foot takes the basin's flat light ──
        const radial = vec3(L.x, 0.0, L.z).div(max(r, 1e-3));
        const tilt = knob.w.sub(0.5).mul(0.6).mul(cone).add(mott.sub(0.5).mul(0.25).mul(onMound).mul(fadeBy(4.0)));
        // (the chute is lit nearly as the Stair's head it runs into, so no bright band crowns it)
        const flatten = max(footW.mul(0.8), chute.mul(0.7));
        const Ntilt = normalize(mix(N0.add(radial.mul(tilt)), vec3(0.0, 1.0, 0.0), flatten));
        // The crust's relief: knobs of popcorn sinter and the plates' edges, as a bump normal
        // from screen derivatives (fading where a pixel covers more than the relief).
        const relief = cellA.w.mul(0.05).add(cellB.w.mul(0.08)).sub(crack.mul(0.03))
            .mul(fadeBy(1.2))
            .mul(float(1.0).sub(footW))
            .mul(onMound.mul(0.7).add(0.3));
        const dpx = dFdx(P);
        const dpy = dFdy(P);
        const rr1 = cross(dpy, Ntilt);
        const rr2 = cross(Ntilt, dpx);
        const det = dot(dpx, rr1);
        const grad = sign(det).mul(dFdx(relief)).mul(rr1).add(sign(det).mul(dFdy(relief)).mul(rr2));
        const N = normalize(abs(det).mul(Ntilt).sub(grad).add(Ntilt.mul(1e-6))).toVar();
        const ndl = dot(N, u.sunDir);
        const lit = clamp(ndl.add(0.1).div(1.1), 0.0, 1.0);
        const skyAmb = mix(u.haze, u.zenith, 0.6).mul(N.y.mul(0.22).add(0.22));
        const shadowT = plumeShadow(u, P);
        // (a cloud takes the direct sun only, never the sky light)
        const cloudT = tbCloudShade(u, P);
        // (the cone's sunlit face is the brightest sinter in the frame: lit a little softer, so it
        // stays under the bloom's knee, §3.3)
        const sunK = mix(mix(float(1.25), float(1.45), footW), float(1.0), cone);
        const bounce = tbBounce(u, N).mul(float(1.0).sub(footW));
        const light = u.sunColor.mul(lit.mul(sunK).mul(SURFACE_SUN).mul(shadowT).mul(cloudT)).add(skyAmb.mul(shadowT.mul(0.4).add(0.6))).add(bounce);
        const col = albedo.mul(light)
            .toVar();
        // Wet sinter: a faint sky sheen where the view grazes.
        const fres = pow(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0)), 4.0);
        col.addAssign(mix(u.haze, u.zenith, 0.5).mul(fres.mul(wet).mul(0.35)));
        // A soft shoulder over the cone's beads and the bright specks round its foot: their
        // highlights ease in under the knee (the texture kept), only the odd bead glints past it.
        const peak = max(tbMax3(col), 1e-4);
        const eased = float(0.86).add(peak.sub(0.86).mul(0.35));
        col.mulAssign(mix(float(1.0), select(peak.greaterThan(0.86), eased.div(peak), float(1.0)), max(cone, splash)));
        const out = tbAerial(u, tbSteamVeil(u, col, P), dist, V.negate());
        return vec4(max(out, vec3(0.0)), 1.0);
    });
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomChalice';
    material.fog = false;
    material.colorNode = chaliceFn();
    const part = tbPart('ThermalBloomChalice', geometry, material, 9);
    part.field = field;
    const frame = {
        x: 0, y: 0, z: 0, c: 1, s: 0,
    };
    /** Stand on the vent's base at (x, y, z), turned so local +z runs down the Stair (`dir`, world xz). */
    part.place = (x, y, z, dir = [0, 1]) => {
        const len = Math.hypot(dir[0], dir[1]) || 1;
        const angle = Math.atan2(dir[0] / len, dir[1] / len);
        Object.assign(frame, {
            x, y, z, c: Math.cos(angle), s: Math.sin(angle),
        });
        part.mesh.position.set(x, y, z);
        part.mesh.rotation.set(0, angle, 0);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    /** A point on the Chalice's ground at local (x, z): world [x, y, z]. */
    part.spot = (lx, lz) => {
        const h = field.height(lx, lz);
        return [frame.x + lx * frame.c + lz * frame.s, frame.y + h, frame.z - lx * frame.s + lz * frame.c];
    };
    return part;
}

/**
 * A dormant sinter mound (the Sleeper's, the Consort's): one lumpy lathe of old grey-brown
 * sinter, blotched and weathered, paler toward its top, settling into the apron's colour at its
 * foot; a dark crater (`crater` m) or a small still pool (`pool` m) at its top.
 */
function createMound(u, tier, tex, {
    name, profile, crater = 0, pool = 0, order = 9,
}) {
    const geometry = lathe(profile, tier.columnMesh[0] * 3);
    const outer = profile[0][0];
    const moundFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const rel = positionLocal;
        const r = length(rel.xz).toVar();
        const mottA = texture(tex.noise, P.xz.div(30.0)).z;
        const mottB = texture(tex.noise, P.xz.div(11.0)).w;
        const mott = mottA.mul(0.6).add(mottB.mul(0.4)).toVar();
        const top = smoothstep(outer * 0.5, outer * 0.12, r);
        const albedo = mix(vec3(0.48, 0.45, 0.4), vec3(0.66, 0.63, 0.56), top.mul(0.6).add(mott.mul(0.4))).toVar();
        albedo.mulAssign(float(1.0).add(mott.sub(0.5).mul(0.4)));
        albedo.assign(mix(albedo, vec3(...TB_APRON).mul(0.88), smoothstep(outer * 0.55, outer * 0.9, r)));
        if (crater > 0) albedo.mulAssign(float(1.0).sub(smoothstep(crater, crater * 0.45, r).mul(0.55)));
        // Snow in Deep Cold (patchy), rime in First Frost; a warm pool keeps its own rim clear.
        const warmRim = pool > 0 ? smoothstep(pool + 1.5, pool + 4.0, r) : float(1.0);
        const patches = smoothstep(0.3, 0.6, mott);
        albedo.assign(mix(albedo, vec3(0.8, 0.82, 0.84), u.frost.mul(patches).mul(warmRim).mul(0.3)));
        albedo.assign(mix(albedo, vec3(0.78, 0.81, 0.86), u.snow.mul(warmRim).mul(patches.mul(0.4).add(0.5))));
        const radial = vec3(rel.x, 0.0, rel.z).div(max(r, 1e-3));
        const N = normalize(normalize(normalWorld).add(radial.mul(mott.sub(0.5).mul(0.4)))).toVar();
        const lit = clamp(dot(N, u.sunDir).add(0.12).div(1.12), 0.0, 1.0);
        const sky = mix(u.haze, u.zenith, 0.6).mul(N.y.mul(0.2).add(0.25));
        const col = albedo.mul(u.sunColor.mul(lit.mul(1.05)).add(sky)).toVar();
        if (pool > 0) {
            // A small still pool, milky turquoise, a wet cream rim round it.
            const pfw = max(fwidth(r), 1e-3);
            const inside = smoothstep(pfw.add(pool), float(pool).sub(pfw), r);
            const rim = smoothstep(pool + 1.2, pool, r).mul(float(1.0).sub(inside));
            col.assign(mix(col, vec3(0.86, 0.83, 0.74).mul(u.sunColor.mul(lit).add(sky)), rim.mul(0.6)));
            // While its chain lives the Consort's mound is wet and a boiling dome swells its pool.
            col.mulAssign(float(1.0).sub(u.consortWet.mul(0.32).mul(float(1.0).sub(inside))));
            const boil = texture(tex.noise, P.xz.div(2.5).add(vec2(u.time.mul(0.6), u.time.mul(-0.4)))).x;
            const dome = smoothstep(pool, 0.0, r).mul(boil.mul(0.6).add(0.4)).mul(u.consortWet);
            const water = vec3(0.12, 0.42, 0.48).mul(u.sunColor.mul(0.7).add(u.zenith.mul(0.3)))
                .add(vec3(0.1, 0.32, 0.34).mul(dome));
            col.assign(mix(col, water, inside));
        }
        const out = tbAerial(u, tbSteamVeil(u, col, P), dist, V.negate());
        return vec4(max(out, vec3(0.0)), 1.0);
    });
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = name;
    material.fog = false;
    material.colorNode = moundFn();
    const part = tbPart(name, geometry, material, order);
    part.place = (x, y, z) => {
        part.mesh.position.set(x, y, z);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}

/** The Sleeper's dormant mound on the far rim. */
export function createSleeper(u, tier, tex) {
    return createMound(u, tier, tex, { name: 'ThermalBloomSleeper', profile: SLEEPER_PROFILE, crater: 6 });
}

/** The Consort's quiet mound and its small pool on the far apron. */
export function createConsort(u, tier, tex) {
    return createMound(u, tier, tex, { name: 'ThermalBloomConsort', profile: CONSORT_PROFILE, pool: CONSORT_POOL });
}

// ── The eruption columns ──────────────────────────────────────────────────────

/** The columns' layers: the water, the haze shell (rain skirt at the fall-back), the splash collar. */
const LAYER = Object.freeze({ water: 0, veil: 1, collar: 2 });

/** Value noise in [0, 1] on (x, y), periodic in x over `period` cells (round a column). */
function tslNoise(x, y, period) {
    const xi = floor(x);
    const yi = floor(y);
    const fx = x.sub(xi);
    const fy = y.sub(yi);
    const sx = fx.mul(fx).mul(float(3.0).sub(fx.mul(2.0)));
    const sy = fy.mul(fy).mul(float(3.0).sub(fy.mul(2.0)));
    const x0 = xi.mod(period);
    const x1 = xi.add(1.0).mod(period);
    const a = tbHash21(vec2(x0, yi));
    const b = tbHash21(vec2(x1, yi));
    const c = tbHash21(vec2(x0, yi.add(1.0)));
    const d = tbHash21(vec2(x1, yi.add(1.0)));
    return mix(mix(a, b, sx), mix(c, d, sx), sy);
}

/**
 * The eruption columns: `EVENT_SLOTS.eruptions` lathes per layer in one geometry (the water, the
 * haze shell, the splash collar). What each layer draws follows the slot's kind:
 *
 *   water     a column that widens with height and flares at its crown, ragged ±15% and more;
 *             a low heave of water (the four-line surge, a splash under ~3 m) is a dome instead.
 *             Its shell is the spray veil (the bow's carrier, §3.4) and, at the fall-back, the
 *             rain skirt; under a dome, a steam skirt flaring round the vent. Its collar is a
 *             churning mound of white water; at the surge (a dome written with no crown flare)
 *             the pool's overflow running down the cone.
 *   spouter   the same, small (the spouters' burbles and pulses).
 *   standing  the Consort: its water layer is the splash, its shell a standing steam column
 *             (row 1 z: the column's height in whole metres plus its amount as the fraction),
 *             underlit turquoise by its pool.
 *   jet       a hard drop's fumarole jet: turbulent steam and water widening as it rises, a puff
 *             of steam round it (its drops fly in one arc: see the spray).
 */
export function createColumns(u, tier, tex) {
    const [segs, rings] = tier.columnMesh;
    const slots = EVENT_SLOTS.eruptions;
    const positions = [];
    const meta = [];
    const index = [];
    const layers = [[LAYER.water, rings], [LAYER.veil, rings], [LAYER.collar, Math.max(4, Math.round(rings / 2))]];
    layers.forEach(([layer, rr]) => {
        for (let s = 0; s < slots; s++) {
            const first = positions.length / 3;
            for (let j = 0; j <= rr; j++) {
                for (let i = 0; i <= segs; i++) {
                    positions.push(i / segs, j / rr, 0);
                    meta.push(s, layer);
                }
            }
            for (let j = 0; j < rr; j++) {
                for (let i = 0; i < segs; i++) {
                    const a = first + j * (segs + 1) + i;
                    const b = a + segs + 1;
                    index.push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aColumn', new THREE.Float32BufferAttribute(meta, 2));
    geometry.setIndex(index);

    const aColumn = attribute('aColumn', 'vec2');
    const rowA = (slot) => u.events.element(int(slot.add(0.5)).mul(2).add(EVENT_ROWS.eruptions));
    const rowB = (slot) => u.events.element(int(slot.add(0.5)).mul(2).add(EVENT_ROWS.eruptions + 1));
    const isLayer = (layer, k) => step(abs(layer.sub(k)), 0.5);
    const isKind = (B, k) => step(abs(B.w.sub(k)), 0.5);
    /** A low heave of water is a dome, not a column (a jet never is). */
    const domeOf = (B, H) => float(1.0).sub(smoothstep(4.5, 9.0, H)).mul(float(1.0).sub(isKind(B, COLUMN_KIND.jet)));
    /** The four-line surge: a water dome written with no crown flare. */
    const surgeOf = (B) => float(1.0).sub(step(0.05, B.z)).mul(isKind(B, COLUMN_KIND.water));
    /** How far a layer leans downwind (metres per metre of height and metre a second of wind). */
    const leanOf = (B, layer) => mix(
        float(0.012),
        float(0.05),
        max(isKind(B, COLUMN_KIND.standing).mul(isLayer(layer, LAYER.veil)), isKind(B, COLUMN_KIND.jet)),
    );

    // ── Vertex: each layer's radius and height ──
    const slotV = aColumn.x;
    const layerV = aColumn.y;
    const A = rowA(slotV);
    const B = rowB(slotV);
    const theta = positionGeometry.x;
    const h01 = positionGeometry.y;
    const t = u.time;
    const H = max(A.w, 0.01);
    const fall = clamp(B.y, 0.0, 1.0);
    const spouter = isKind(B, COLUMN_KIND.spouter);
    const isStand = isKind(B, COLUMN_KIND.standing);
    const isJet = isKind(B, COLUMN_KIND.jet);
    const dome = domeOf(B, H);
    const surge = surgeOf(B).mul(dome);
    const flare = B.z.mul(float(1.0).sub(isStand));
    const standH = floor(B.z).mul(isStand);
    // The water slows as it rises (v ∝ √(1 − h/H)): the crown flares as r ∝ 1/√v.
    const crown = pow(max(float(1.0).sub(h01.mul(0.97)), 0.03), -0.25).sub(1.0).mul(flare);
    // Two octaves round the column, climbing with the water: a ragged silhouette (±15% and more).
    const climb = sqrt(H.mul(2.0 * G)).mul(0.35);
    const yAbs = h01.mul(H);
    const n1 = tslNoise(theta.mul(5.0), yAbs.div(5.0).sub(t.mul(climb).div(5.0)), 5.0);
    const n2 = tslNoise(theta.mul(11.0).add(3.0), yAbs.div(2.2).sub(t.mul(climb).div(2.2)), 11.0);
    const jitter = n1.mul(0.6).add(n2.mul(0.4)).sub(0.5).mul(0.55);
    const rCol = B.x.mul(float(1.0).add(h01.mul(0.6)).add(crown)).mul(float(1.0).add(jitter));
    // The dome: a heaving cap, wider than the vent's lip at the surge (the pool spills over it).
    const capR = sqrt(max(float(1.0).sub(h01.mul(h01)), 0.0));
    const rDome = B.x.mul(1.1).mul(capR).mul(float(1.0).add(jitter.mul(0.8)));
    // The jet: a turbulent cone of steam and water, widening as it rises.
    const rJet = B.x.mul(float(0.45).add(pow(h01, 0.85).mul(2.4))).mul(float(1.0).add(jitter.mul(1.4)));
    const rWater = mix(mix(rCol, rDome, dome), rJet, isJet);
    // The haze shell (the spray veil): wider, densest round the top; at the fall-back a bell of
    // rain from the crown.
    const rCrown = B.x.mul(float(1.6).add(pow(float(0.03), -0.25).sub(1.0).mul(flare)));
    const rVeil = rWater.mul(1.7).add(B.x.mul(0.5)).add(h01.mul(h01).mul(B.x).mul(1.2));
    const rainDrop = fall.mul(fall).mul(H).mul(1.1);
    const rSkirt = rCrown.mul(float(1.0).add(fall.mul(1.4))).mul(float(0.85).add(float(1.0).sub(h01).mul(0.5)))
        .mul(float(1.0).add(jitter.mul(1.5)));
    const isFalling = smoothstep(0.0, 0.08, fall);
    const shellR = mix(rVeil, rSkirt, isFalling);
    const shellY = mix(H.mul(h01.mul(0.92).add(0.12)), H.sub(rainDrop.mul(float(1.0).sub(h01))), isFalling);
    // Under a dome, a steam skirt flares round the vent, off the water spilling down the cone
    // (the surge's, §1.5): a ring of billows hugging the cone's top, rising past the dome.
    const rSteamSkirt = B.x.mul(float(1.25).add(h01.mul(0.9))).mul(float(1.0).add(jitter.mul(1.2))).add(1.0);
    const ySteamSkirt = mix(float(-2.0), H.mul(1.4).add(mix(float(2.0), float(5.0), surge)), h01);
    // A standing column of steam (the Consort's): about 12 m wide, its height in row 1 z.
    const rStand = float(5.2).add(h01.mul(2.4)).mul(float(1.0).add(jitter.mul(0.8)));
    // A jet's steam puffs out round it.
    const rJetVeil = rJet.mul(1.7).add(0.4);
    const veilR = mix(mix(mix(shellR, rSteamSkirt, dome), rJetVeil, isJet), rStand, isStand);
    const veilY = mix(mix(mix(shellY, ySteamSkirt, dome), h01.mul(H.mul(1.12)), isJet), h01.mul(standH), isStand);
    // The collar: a churning mound of white water round the vent, widest at its foot, its top
    // torn by the churn (never a flat ring); at the surge, the overflow running down the cone.
    // (steep-walled: a shallow one shows its far side from above, a white saucer)
    const nCtop = tslNoise(theta.mul(5.0).add(2.0), t.mul(0.6), 5.0);
    const collarH = min(H.mul(0.3).add(0.3), mix(float(4.5), float(0.5), spouter))
        .mul(float(1.0).add(nCtop.sub(0.5).mul(1.2)));
    // (its own ragged outline: round it and slowly up it — the water's jitter, read over the
    // column's whole height, would zigzag its short wall and turn its far side to the camera)
    const nC = tslNoise(theta.mul(7.0), t.mul(0.8).add(h01.mul(0.7)), 7.0);
    const collarR = B.x.mul(float(1.05).add(pow(float(1.0).sub(h01), 1.5).mul(0.3)))
        .mul(float(1.0).add(nC.sub(0.5).mul(0.5)));
    // (the overflow hugs the Chalice's cone: its profile from the lip out toward its foot, a
    // hand above it, so the cone's knobs break it into rivulets)
    const spillR = mix(float(SPILL.lip), float(SPILL.foot), h01).mul(float(1.0).add(jitter.mul(0.4)));
    const spillQ = clamp(spillR.sub(SPILL.lip).div(SPILL.foot - SPILL.lip), 0.0, 1.0);
    const spillY = float(SPILL.top).mul(float(1.0).sub(pow(spillQ, 1.9))).sub(spillQ.mul(0.6)).sub(SPILL.base)
        .add(0.3);
    const cR = mix(collarR, spillR, surge);
    const cY = mix(h01.mul(collarH), spillY, surge);
    const isVeilV = isLayer(layerV, LAYER.veil);
    const isCollarV = isLayer(layerV, LAYER.collar);
    const radius = mix(mix(rWater, veilR, isVeilV), cR, isCollarV);
    const height = mix(mix(yAbs, veilY, isVeilV), cY, isCollarV);
    // A thin jet still covers about a pixel (its alpha thinned to match).
    const axisDist = length(u.camPos.sub(vec3(A.x, A.z.add(height), A.y)));
    const floorR = axisDist.mul(u.pixelAngle).mul(0.7);
    const drawn = max(radius, floorR);
    const vCover = varying(clamp(radius.div(max(drawn, 1e-4)), 0.0, 1.0), 'vColumnCover');
    const vSlot = varying(slotV, 'vColumnSlot');
    const vLayer = varying(layerV, 'vColumnLayer');
    const vTheta = varying(theta, 'vColumnTheta');
    const vH01 = varying(h01, 'vColumnH01');
    // The water leans a touch downwind with height; steam leans more.
    const lean = u.windDir.mul(u.windSpeed.mul(leanOf(B, layerV)).mul(height));

    const material = tbFxMaterial('ThermalBloomColumns', { side: THREE.FrontSide });
    material.positionNode = Fn(() => {
        // A slot folds away while it has no water (a standing column, while it has steam).
        const live = max(step(0.05, A.w), isStand.mul(step(1.0, standH)));
        const ang = theta.mul(TAU);
        const p = vec3(
            A.x.add(cos(ang).mul(drawn)).add(lean.x),
            A.z.add(height),
            A.y.add(sin(ang).mul(drawn)).add(lean.y),
        );
        return mix(vec3(0.0, -1e5, 0.0), p, live);
    })();

    const columnFn = Fn(() => {
        const Af = rowA(vSlot);
        const Bf = rowB(vSlot);
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const Hf = max(Af.w, 0.01);
        const fallF = clamp(Bf.y, 0.0, 1.0).toVar();
        const standF = isKind(Bf, COLUMN_KIND.standing).toVar();
        const jetF = isKind(Bf, COLUMN_KIND.jet).toVar();
        const domeF = domeOf(Bf, Hf).toVar();
        const surgeF = surgeOf(Bf).mul(domeF).toVar();
        const h = P.y.sub(Af.z).toVar();
        const hn = clamp(h.div(Hf), 0.0, 1.2).toVar();
        const layer = vLayer;
        const isWater = isLayer(layer, LAYER.water);
        const isVeil = isLayer(layer, LAYER.veil);
        const isCollar = isLayer(layer, LAYER.collar);
        // The view·normal thickness: the core is dense, the rim thin and translucent.
        const axis = vec2(Af.x, Af.y).add(u.windDir.mul(u.windSpeed.mul(leanOf(Bf, layer)).mul(h)));
        const n = normalize(P.xz.sub(axis).add(vec2(1e-4, 0.0))).toVar();
        const facing = abs(dot(n, V.xz).div(max(length(V.xz), 1e-3))).toVar();
        // Streaks up the water (noise in θ and h − v·t), a finer second tap.
        const speed = sqrt(Hf.mul(2.0 * G)).mul(0.45);
        // (sheared round the column as they climb, so the atlas's tiling never lines a feature up
        // the column at a fixed pitch: a dotted pole)
        const s1 = texture(tex.noise, vec2(vTheta.mul(4.0).add(h.mul(0.0137)), h.sub(u.time.mul(speed)).div(16.7))).x;
        const s2uv = vec2(vTheta.mul(8.0).add(0.37).sub(h.mul(0.0291)), h.sub(u.time.mul(speed.mul(1.3))).div(6.3));
        const s2 = texture(tex.noise, s2uv).y;
        const streak = s1.mul(0.6).add(s2.mul(0.4)).toVar();
        const core = smoothstep(0.05, 0.4, facing).toVar();
        // A wide soft rim: the outer third of the column's width thins out (spray, not a skin).
        const rim = smoothstep(0.0, 0.6, facing).toVar();
        // Erosion: toward the rim the streaks must be denser to show, so the edge dissolves.
        // (a short burst is a solid slug of white water: less of it erodes)
        const short = float(1.0).sub(smoothstep(10.0, 30.0, Hf)).toVar();
        const lo = mix(float(0.62), float(0.04), core).sub(short.mul(0.15));
        const eroded = smoothstep(lo, lo.add(0.22), streak).toVar();

        // ── The water ──
        // The column frays at the crown into spray; at the fall-back it empties from the base up
        // while the crown holds, spreading into a ragged cloud of falling water, then thins away.
        const fray = smoothstep(
            mix(float(1.02), float(1.08), fallF),
            mix(float(0.78), float(0.7), fallF),
            hn.add(streak.sub(0.5).mul(0.3)),
        );
        const cut = fallF.mul(0.82);
        const emptied = smoothstep(cut, cut.add(0.2), hn.add(streak.sub(0.5).mul(0.25)));
        const crownHold = float(1.0).sub(smoothstep(0.65, 1.0, fallF));
        const colWater = eroded.mul(pow(rim, mix(float(1.1), float(0.7), short))).mul(streak.mul(0.3).add(0.75))
            .mul(fray)
            .mul(emptied)
            .mul(crownHold)
            .mul(mix(float(0.95), float(1.15), short));
        // The dome: a heaving cap of churning white water, torn at its top.
        // (it is a closed cap, seen from above: only its very crown tears into spray)
        const domeTop = smoothstep(1.1, 0.95, hn.add(streak.sub(0.5).mul(0.3)));
        const domeWater = pow(smoothstep(0.0, 0.25, facing), 0.4).mul(mix(float(0.85), float(1.0), streak))
            .mul(domeTop)
            .mul(0.97);
        // The jet: dense white at its foot, billowing and thinning as it rises.
        const jn = texture(tex.noise, vec2(vTheta.mul(3.0).add(0.2), h.sub(u.time.mul(speed.mul(0.8))).div(3.0))).x;
        const jetWater = smoothstep(0.0, 0.7, facing).mul(smoothstep(0.3, 0.62, jn.add(float(1.0).sub(hn).mul(0.3))))
            .mul(float(1.0).sub(smoothstep(0.75, 1.05, hn.add(jn.sub(0.5).mul(0.4)))))
            .mul(0.88);
        const water = mix(mix(colWater, domeWater, domeF), jetWater, jetF);

        // ── The shell ──
        // The spray veil: soft, no edge (it fades to nothing at grazing), fine noise, thickest
        // round the top; at the fall-back, rain streaks falling from the crown.
        const fine = texture(tex.noise, vec2(vTheta.mul(6.0).add(0.21), h.sub(u.time.mul(speed.mul(0.35))).div(9.0))).z
            .toVar();
        const sprayHaze = smoothstep(0.0, 0.7, facing).mul(fine.mul(0.8).add(0.2))
            .mul(smoothstep(0.0, 0.25, vH01)).mul(smoothstep(1.0, 0.8, vH01))
            .mul(mix(float(0.55), float(1.5), smoothstep(0.45, 0.95, hn)))
            .mul(float(1.0).sub(smoothstep(0.0, 0.08, fallF)))
            .toVar();
        const shell = sprayHaze.mul(0.3);
        const rainN = texture(tex.noise, vec2(vTheta.mul(14.0), h.add(u.time.mul(11.0)).div(7.0))).x;
        const rain = smoothstep(0.42, 0.72, rainN).mul(smoothstep(0.0, 0.6, facing))
            .mul(smoothstep(0.0, 0.3, vH01)).mul(smoothstep(1.0, 0.85, vH01))
            .mul(smoothstep(0.0, 0.08, fallF))
            .mul(float(1.0).sub(smoothstep(0.8, 1.0, fallF)))
            .mul(0.42);
        // The steam skirt round a dome: billows rolling up and out, thin at the vent.
        const sk1 = texture(tex.noise, vec2(vTheta.mul(2.5).add(0.41), h.sub(u.time.mul(1.4)).div(7.0))).x;
        const sk2 = texture(tex.noise, vec2(vTheta.mul(6.0).add(0.1), h.sub(u.time.mul(2.0)).div(3.0))).y;
        const skirtN = sk1.mul(0.65).add(sk2.mul(0.35));
        const skirtLo = mix(float(0.36), float(0.24), surgeF);
        const skirt = pow(smoothstep(0.0, 0.8, facing), 1.2).mul(smoothstep(skirtLo, 0.7, skirtN))
            .mul(smoothstep(0.0, 0.2, vH01))
            .mul(float(1.0).sub(smoothstep(0.5, 1.0, vH01.add(skirtN.sub(0.5).mul(0.4)))))
            .mul(mix(float(0.3), float(0.95), surgeF))
            .mul(smoothstep(0.3, 1.0, Bf.x));
        // The standing steam column: billows rising up it (two taps at different speeds), a
        // dense core and a soft rim, fading in off its pool and out over its top third.
        const standTop = max(floor(Bf.z), 1.0);
        const standAmount = fract(Bf.z);
        const sb1 = texture(tex.noise, vec2(vTheta.mul(2.0).add(h.mul(0.004)), h.sub(u.time.mul(1.8)).div(14.0))).x;
        const sb2 = texture(tex.noise, vec2(vTheta.mul(5.0).add(0.3), h.sub(u.time.mul(2.6)).div(5.0))).y;
        const standN = sb1.mul(0.65).add(sb2.mul(0.35));
        const standing = pow(smoothstep(0.0, 0.85, facing), 1.1).mul(smoothstep(0.2, 0.6, standN))
            .mul(smoothstep(0.0, float(4.0).div(standTop), vH01))
            .mul(float(1.0).sub(smoothstep(0.6, 1.0, vH01.add(standN.sub(0.5).mul(0.35)))))
            .mul(standAmount)
            .mul(0.97);
        // A jet's puff of steam round it.
        const puffN = texture(tex.noise, vec2(vTheta.mul(4.0).add(0.7), h.sub(u.time.mul(2.0)).div(2.5))).y;
        const jetPuff = smoothstep(0.0, 0.8, facing).mul(smoothstep(0.42, 0.78, puffN))
            .mul(smoothstep(0.1, 0.5, vH01)).mul(float(1.0).sub(smoothstep(0.7, 1.0, vH01)))
            .mul(0.5);
        const veil = mix(mix(mix(shell.add(rain), skirt, domeF), jetPuff, jetF), standing, standF);

        // ── The collar: churning white water, its top torn deep (never a disc) ──
        const churn = texture(tex.noise, vec2(vTheta.mul(6.0).add(0.6), vH01.mul(0.5).sub(u.time.mul(1.1)))).x;
        const churn2 = texture(tex.noise, vec2(vTheta.mul(13.0).add(0.2), vH01.mul(0.9).sub(u.time.mul(1.7)))).y;
        const churnTop = churn.mul(0.8).add(0.3);
        const churnA = smoothstep(churnTop, churnTop.sub(0.3), vH01)
            .mul(pow(smoothstep(0.08, 0.5, facing), 0.6))
            .mul(smoothstep(0.3, 0.62, churn2.add(core.mul(0.2))))
            .mul(float(1.0).sub(smoothstep(0.0, 0.5, fallF)))
            .mul(0.92);
        // The overflow: glossy sheets running down the cone in streaks.
        const spillN = texture(tex.noise, vec2(vTheta.mul(9.0), vH01.mul(0.6).sub(u.time.mul(0.9)))).y;
        const spill = smoothstep(0.35, 0.7, spillN).mul(smoothstep(0.0, 0.3, facing))
            .mul(float(1.0).sub(smoothstep(0.6, 1.0, vH01)))
            .mul(0.8);
        const collar = mix(churnA, spill, surgeF);
        // (a standing column's steam stands whatever its splash does)
        const present = mix(smoothstep(0.0, 0.3, Af.w), float(1.0), standF.mul(isVeil));
        // (a hard drop's jet is the marched steam's and the drops' when the post marches them)
        const jetFade = float(1.0).sub(jetF.mul(u.vapourOn).mul(0.8));
        const alpha = clamp(water.mul(isWater).add(veil.mul(isVeil)).add(collar.mul(isCollar)), 0.0, 1.0)
            .mul(vCover)
            .mul(present)
            .mul(jetFade)
            .toVar();
        alpha.lessThan(0.002).discard();

        // ── Light: Steam Pearl on the sun's side, blue-grey in shade, the split on the form ──
        const cap = sqrt(max(float(1.0).sub(hn.mul(hn)), 0.0));
        const nCol = vec3(n.x, hn.mul(0.35).add(0.1), n.y);
        const nDome = vec3(n.x.mul(cap), hn.add(0.1), n.y.mul(cap));
        const N3 = normalize(mix(nCol, nDome, domeF));
        const lit = smoothstep(-0.25, 0.55, dot(N3, u.sunDir));
        const back = tbHgMix(dot(V, u.sunDir), float(0.3));
        // (the water thrown into the sun reads white: its light a little less warm than the sun's)
        const pearl = mix(vec3(tbLuma(u.sunColor)), u.sunColor, 0.6).mul(0.9).add(mix(u.haze, u.zenith, 0.5).mul(0.1))
            .mul(float(0.92).add(back.mul(0.12)));
        const shadeBlue = vec3(0.34, 0.43, 0.56).mul(mix(float(0.85), float(1.0), u.sunColor.y))
            .add(u.zenith.mul(0.05));
        // (thin steam — a jet, a skirt, a standing column — is lit through from the bright air and
        // the ground: its shade is a soft grey-blue, never a blue edge)
        const steamy = max(max(jetF, standF.mul(isVeil)), domeF.mul(isVeil));
        const shade = mix(shadeBlue, pearl.mul(0.72), steamy.mul(0.45));
        // Sheets and streaks of water inside the column: darker where it is thin, a little
        // brighter where the streak is dense (texture inside the white, not a flat fill).
        const body = mix(shade, pearl, lit).mul(streak.mul(0.24).add(0.88)).toVar();
        // Thin water (the dome's skin, the overflow) shows the pool's milky turquoise.
        const thinWater = domeF.mul(isWater).mul(float(1.0).sub(core)).mul(0.7).add(surgeF.mul(isCollar).mul(0.6));
        body.mulAssign(mix(vec3(1.0), vec3(0.62, 0.86, 0.88), thinWater));
        // The standing steam is underlit by its pool's turquoise; a skirt and a jet by warm ground.
        const under = vec3(0.04, 0.42, 0.5).mul(exp(h.div(-12.0))).mul(standF.mul(isVeil).mul(0.9))
            .add(vec3(0.5, 0.3, 0.16).mul(exp(h.div(-6.0))).mul(max(domeF, jetF).mul(isVeil).mul(0.12)));
        body.addAssign(under);
        // Never emissive, never a flat white: lit steam lands at about 0.95 on the display.
        // (its water brighter than the steam round it: the column stands out of its own steam)
        const peak = mix(float(COLUMN_PEAK), float(COLUMN_PEAK * 1.3), isWater.mul(float(1.0).sub(domeF)));
        body.mulAssign(min(float(1.0), peak.div(max(tbMax3(body), 1e-4))));
        // The bow (§3.4): only during four lines, only in the spray — the veil's own haze and a
        // little in the column's — patchy as the spray is; never in a skirt, a standing column or
        // a collar. It is carried by the spray's density (the premultiplied alpha), never alone.
        const bow = tbBow(dot(V, u.sunDir));
        const inSpray = isVeil.add(isWater.mul(0.25)).mul(float(1.0).sub(domeF)).mul(float(1.0).sub(standF))
            .mul(float(1.0).sub(jetF));
        const sprayPatch = smoothstep(0.35, 0.8, fine);
        const col = body.mul(mix(float(1.0), bow.w, u.bow.mul(inSpray)))
            .add(bow.xyz.mul(u.bow).mul(inSpray).mul(sprayPatch.mul(0.6).add(0.4)).mul(0.85));
        const out = tbAerial(u, col, dist, V.negate());
        return vec4(out.mul(alpha), alpha);
    });
    material.colorNode = columnFn();
    const part = tbPart('ThermalBloomColumns', geometry, material, 62);
    part.slots = slots;
    return part;
}

/**
 * The spray: `tier.spray` quads on ballistic paths from the live columns' vents, each on its own
 * hashed cycle, killed at landing; at the fall-back they fall from the crown as rain. A jet's
 * drops fly in one arc (its slug jumping the lip, §1.5): a narrow fan on a heading of its own.
 */
export function createSpray(u, tier) {
    const count = tier.spray;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const positions = new Float32Array(count * 4 * 3);
    const seeds = new Float32Array(count * 4 * 2);
    const index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
        corners.forEach(([x, y], c) => {
            positions.set([x, y, 0], (i * 4 + c) * 3);
            seeds.set([i, (i * 0.618034) % 1], (i * 4 + c) * 2);
        });
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpray', new THREE.BufferAttribute(seeds, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const aSpray = attribute('aSpray', 'vec2');
    const vCorner = varying(positionGeometry.xy, 'vSprayCorner');
    const slots = EVENT_SLOTS.eruptions;
    // Each drop's cycle: launched up its column to about the column's height, then out and down.
    const id = aSpray.x;
    const slot = id.mod(slots);
    const A = u.events.element(int(slot).mul(2).add(EVENT_ROWS.eruptions));
    const B = u.events.element(int(slot).mul(2).add(EVENT_ROWS.eruptions + 1));
    const h1 = tbHash21(vec2(id, 1.7));
    const h2 = tbHash21(vec2(id, 5.3));
    const h3 = tbHash21(vec2(id, 9.1));
    const isJet = step(abs(B.w.sub(COLUMN_KIND.jet)), 0.5);
    const vUp = sqrt(max(A.w, 0.0).mul(2.0 * G)).mul(mix(h1.mul(0.35).add(0.7), h1.mul(0.12).add(0.62), isJet));
    const period = max(vUp.mul(2.0 / G).add(0.4), 0.6);
    const age = fract(u.time.div(period).add(aSpray.y)).mul(period);
    // Most drops fall close round the column (a mist hugging it); a few fly wide. A jet's fly
    // out in one arc.
    const reach = mix(h2.mul(h2).mul(2.6).add(0.4).add(B.x.mul(0.35)), h2.mul(0.9).add(2.8), isJet);
    const heading = tbHash21(vec2(slot, 3.7)).mul(TAU);
    const ang = mix(h3.mul(TAU), heading.add(h3.sub(0.5).mul(0.3)), isJet);
    const jet = vec3(
        A.x.add(cos(ang).mul(reach).mul(age)),
        A.z.add(vUp.mul(age)).sub(age.mul(age).mul(0.5 * G)),
        A.y.add(sin(ang).mul(reach).mul(age)),
    );
    // At the fall-back: released from the crown over the first half of it, falling as rain.
    const fall = clamp(B.y, 0.0, 1.0);
    const falling = step(0.001, B.y);
    const tFall = sqrt(max(A.w, 0.5).mul(2.0 / G)).mul(1.15);
    const tau = max(fall.mul(tFall).sub(h1.mul(tFall).mul(0.5)), 0.0);
    const crownR = B.x.mul(h2.mul(2.5).add(1.0)).add(reach.mul(tau).mul(0.6));
    const rainDrop = vec3(
        A.x.add(cos(ang).mul(crownR)),
        A.z.add(A.w.mul(h2.mul(0.25).add(0.8))).sub(tau.mul(tau).mul(0.5 * G)),
        A.y.add(sin(ang).mul(crownR)),
    );
    const drop = mix(jet, rainDrop, falling);
    const released = mix(float(1.0), step(1e-3, tau), falling);
    // Only a live slot's drops fly (an empty slot's fold away, wherever its row points).
    const alive = step(A.z, drop.y).mul(step(0.3, A.w)).mul(step(slot.add(0.5), float(u.eruptionCount))).mul(released);
    // Drops thin as they fall (they evaporate and spread into the veil): a haze, never snow.
    const vSprayId = varying(id, 'vSprayId');
    // The bow's colour where the drop is: sparkle on top of the bands, never the bands (§3.4).
    const vBow = varying(tbBow(dot(normalize(u.camPos.sub(drop)), u.sunDir)), 'vSprayBow');
    const life = mix(float(1.0).sub(smoothstep(0.45, 1.0, age.div(period))), float(0.8), falling);
    const vLife = varying(alive.mul(life), 'vSprayLife');

    const material = tbFxMaterial('ThermalBloomSpray');
    material.positionNode = Fn(() => {
        // Camera-facing, at least about a pixel across.
        const toCam = u.camPos.sub(drop);
        const d = length(toCam);
        const right = normalize(vec3(toCam.z.negate(), 0.0, toCam.x));
        const size = max(float(0.06).add(h2.mul(0.08)), d.mul(u.pixelAngle).mul(0.65));
        const corner = right.mul(positionGeometry.x).add(vec3(0.0, 1.0, 0.0).mul(positionGeometry.y)).mul(size);
        return mix(vec3(0.0, -1e5, 0.0), drop.add(corner), alive);
    })();
    const sprayFn = Fn(() => {
        const r = length(vCorner);
        // A few drops at a time send the sun back to the eye (it stands behind us): glints.
        const flash = step(0.93, tbHash21(vec2(vSprayId, floor(u.time.mul(5.0)))));
        const tinted = length(vBow.xyz).mul(u.bow);
        const a = smoothstep(1.0, 0.2, r).mul(vLife).mul(float(0.3).add(flash.mul(0.5)).add(tinted.mul(0.12)));
        const col = u.sunColor.mul(float(0.82).add(flash.mul(5.0))).add(mix(u.haze, u.zenith, 0.5).mul(0.2))
            .add(vBow.xyz.mul(u.bow).mul(0.55));
        return vec4(col.mul(a), a);
    });
    material.colorNode = sprayFn();
    return tbPart('ThermalBloomSpray', geometry, material, 63);
}

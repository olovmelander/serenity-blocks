/**
 * Sunbraid — shared TSL: the uniforms every part reads, the baked noise, and the light of the
 * three suns (one set of functions the land, the towers, the gliders, the sky and the mist all
 * call, so a shadow on the floor, its wedge in the mist and the glow on the horizon always agree).
 *
 * The world writes the uniforms; the materials read them. Readers that sample a texture or read
 * a uniform are inline builders (a laid-out Fn may not capture either); pure arithmetic helpers
 * carry a layout.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import { NOISE_SIZE, noiseData } from './sunbraid-noise.js';
import { MAX_CASTERS } from './sunbraid-plan.js';
import { MAX_GLIDERS } from './sunbraid-glide.js';

export * from './sunbraid-core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const sbHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sb_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0, 1) */
export const sbHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'sb_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

/**
 * Voronoi cells at a point (in cell units, centres jittered by `jitter`): (distance to the nearest
 * centre, to the second, the nearest cell's id in 0..1). The edge between two cells lies where the
 * two distances meet, so (second − nearest) is a distance to the nearest edge (twice it, near one).
 */
export const sbCells = /* @__PURE__ */ Fn(([p, jitter]) => {
    const ip = floor(p);
    const fp = fract(p);
    const d1 = float(8.0).toVar();
    const d2 = float(8.0).toVar();
    const id = float(0.0).toVar();
    for (let j = -1; j <= 1; j += 1) {
        for (let i = -1; i <= 1; i += 1) {
            const o = vec2(i, j);
            const h = sbHash22(ip.add(o));
            const d = length(o.add(h.sub(0.5).mul(jitter)).add(0.5).sub(fp));
            const nearer = d.lessThan(d1);
            d2.assign(select(nearer, d1, min(d2, d)));
            id.assign(select(nearer, h.x, id));
            d1.assign(min(d1, d));
        }
    }
    return vec3(d1, d2, id);
}).setLayout({
    name: 'sb_cells', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }, { name: 'jitter', type: 'float' }],
});

export const sbLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * The suns as seen: the disc's white-hot core and its limb in the sun's own colour (linear, times
 * the light's colour normalised), and the tight halo's strength.
 */
export const SUN_LOOK = Object.freeze({ core: 6.0, rim: 3.0, halo: 0.05 });

/** The mist's light per unit of its (saturated) depth: the suns' share and the sky's. */
export const MIST_LIGHT = Object.freeze({ sun: 0.22, sky: 0.18 });
export const sbMax3 = (c) => max(c.x, max(c.y, c.z));

// ── Baked noise ───────────────────────────────────────────────────────────────────

export function createNoiseTexture(data = noiseData()) {
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'sunbraid-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The scene's state ─────────────────────────────────────────────────────────────

export function createUniforms() {
    const casterRows = Array.from({ length: MAX_CASTERS * 2 }, () => new THREE.Vector4(0, -1e5, 0, 0));
    const gliderRows = Array.from({ length: MAX_GLIDERS }, () => new THREE.Vector4(0, -1e5, 0, 0));
    return {
        time: uniform(0),
        aspect: uniform(16 / 9),
        // The three suns: direction toward each, and its light (colour × power × how much of it
        // gets through the air at its height).
        sun0: uniform(new THREE.Vector3(0, 0.2, -1).normalize()),
        sun1: uniform(new THREE.Vector3(0.8, 0.3, 0.5).normalize()),
        sun2: uniform(new THREE.Vector3(-0.8, 0.3, 0.5).normalize()),
        col0: uniform(new THREE.Vector3(1, 0.27, 0.13)),
        col1: uniform(new THREE.Vector3(0.16, 1, 0.4)),
        col2: uniform(new THREE.Vector3(0.2, 0.36, 1)),
        // Each sun's glow in the sky: its light, lingering a while after it sets (the afterglow).
        glow0: uniform(new THREE.Vector3(1, 0.27, 0.13)),
        glow1: uniform(new THREE.Vector3(0.16, 1, 0.4)),
        glow2: uniform(new THREE.Vector3(0.2, 0.36, 1)),
        /** Each sun's disc: cos of its angular radius (x, y, z per sun) — the sky draws it. */
        discCos: uniform(new THREE.Vector3(0.9997, 0.9998, 0.9999)),
        /** Penumbra half-width (radians) per sun: a little wider than the discs, for softness. */
        penumbra: uniform(new THREE.Vector3(0.03, 0.025, 0.022)),
        /** Each sun's share of the horizon glow (a low sun glows on the horizon). */
        glowShare: uniform(new THREE.Vector3(1, 0.4, 0.4)),
        zenith: uniform(new THREE.Vector3(0.08, 0.1, 0.16)),
        horizon: uniform(new THREE.Vector3(0.5, 0.5, 0.52)),
        /** The light a flat patch of open ground receives from the three suns together. */
        groundLit: uniform(new THREE.Vector3(1, 1, 1)),
        // (Clean high-desert air: the distance goes violet, not white.)
        hazeDensity: uniform(1 / 12000),
        hazeHeight: uniform(420),
        // The valley mist: its density at the floor (per metre), how fast it thins with height,
        // and the floor's height under the eye (world y).
        // (Thinner and lower than it was: seen at a degree or two over the floor, the old mist hid
        // three quarters of the valley beyond two kilometres behind one white band.)
        mistDensity: uniform(1 / 1700),
        mistHeight: uniform(26),
        /** 1 while the post lays the mist's light (with the towers' shadow wedges) over the frame. */
        airMarch: uniform(0),
        // The high cloud: its base (world y), the wind's offset (metres), how much of the sky it
        // covers (the noise threshold) and the size of its tile (metres).
        /** The ribbons braided between the suns (0 none .. 1 full, more in a fever): a chain, a back-to-back run. */
        ribbon: uniform(0),
        /** How far the ribbons have wound (radians): the clock's pace, quicker as play heats. */
        ribbonWind: uniform(0),
        /** The suns' coronas (1 at rest): they blaze as play heats and with every clear. */
        blaze: uniform(1),
        cloudY: uniform(2600),
        cloudDrift: uniform(new THREE.Vector2(0, 0)),
        cloudCover: uniform(0.53),
        cloudScale: uniform(26000),
        eye: uniform(new THREE.Vector3(0, 5, 0)),
        groundY: uniform(0),
        exposureInv: uniform(1),
        casters: uniformArray(casterRows, 'vec4'),
        casterCount: uniform(0, 'int'),
        casterRows,
        // The gliders' shadows: a disc each (centre x, y, z; radius), written every frame.
        gliders: uniformArray(gliderRows, 'vec4'),
        gliderCount: uniform(0, 'int'),
        gliderRows,
    };
}

/** Write the caster list into the rows (cylinder axis x, foot y0, axis z, radius; then top y1). */
export function writeCasters(u, casters) {
    const rows = u.casterRows;
    const n = Math.min(casters.length, rows.length / 2);
    for (let i = 0; i < n; i++) {
        const c = casters[i];
        rows[i * 2].set(c.x, c.y0, c.z, c.r);
        rows[i * 2 + 1].set(c.y1, 0, 0, 0);
    }
    for (let i = n; i < rows.length / 2; i++) {
        rows[i * 2].set(0, -1e5, 0, 0);
        rows[i * 2 + 1].set(0, -1e5, 0, 0);
    }
    u.casterCount.value = n;
}

// ── Shadows ───────────────────────────────────────────────────────────────────────

/**
 * How much of a sun's disc a point sees past one flat-topped cylinder (axis A.x, A.z from A.y up
 * to y1, radius A.w): where the ray toward the sun passes nearest the axis, how far it clears the
 * solid there (round the side, or over the top), as an angle seen from the point, against the
 * disc's half-width pen. 1 in the open, 0 in the umbra, a physical penumbra that widens with
 * distance between. A cylinder behind the point (the ray leaves it) never shadows.
 */
export const sbCylinderVis = /* @__PURE__ */ Fn(([P, S, A, y1, pen]) => {
    const sxz = S.xz.toVar();
    const t = dot(A.xz.sub(P.xz), sxz).div(max(dot(sxz, sxz), 1e-6)).toVar();
    const across = length(P.xz.add(sxz.mul(t)).sub(A.xz)).sub(A.w);
    const y = P.y.add(S.y.mul(t));
    const along = max(y.sub(y1), A.y.sub(y));
    const outside = length(vec2(max(across, 0.0), max(along, 0.0)));
    const clearance = outside.add(min(max(across, along), 0.0));
    const vis = smoothstep(pen.negate(), pen, clearance.div(max(t, 1.0)));
    return select(t.greaterThan(0.0), vis, float(1.0));
}).setLayout({
    name: 'sb_cylinderVis',
    type: 'float',
    inputs: [
        { name: 'P', type: 'vec3' }, { name: 'S', type: 'vec3' }, { name: 'A', type: 'vec4' },
        { name: 'y1', type: 'float' }, { name: 'pen', type: 'float' },
    ],
});

/**
 * How much of a sun's disc a point below a flat disc (a glider's wing: centre G.xyz, radius G.w)
 * sees: where the ray toward the sun crosses the disc's height, how far it passes from its rim, as
 * an angle seen from the point, against the half-width `pen`.
 */
export const sbDiscVis = /* @__PURE__ */ Fn(([P, S, G, pen]) => {
    const t = G.y.sub(P.y).div(max(S.y, 0.02)).toVar();
    const X = P.xz.add(S.xz.mul(t));
    const clearance = length(X.sub(G.xz)).sub(G.w);
    const vis = smoothstep(pen.negate(), pen, clearance.div(max(t, 1.0)));
    return select(t.greaterThan(0.0), vis, float(1.0));
}).setLayout({
    name: 'sb_discVis',
    type: 'float',
    inputs: [
        { name: 'P', type: 'vec3' }, { name: 'S', type: 'vec3' }, { name: 'G', type: 'vec4' },
        { name: 'pen', type: 'float' },
    ],
});

// ── The high cloud ─────────────────────────────────────────────────────────────────

/**
 * The high cloud's density (0..1) over a world point xz: broad drifting banks, warped, with finer
 * fleece in them; how much of the sky they cover follows u.cloudCover.
 */
export function cloudDensity(u, noise, xz, { detail = true } = {}) {
    const p = xz.add(u.cloudDrift).div(u.cloudScale).toVar();
    const warp = texture(noise, p.mul(0.45).add(vec2(0.31, 0.77))).rg.sub(0.5).mul(0.22);
    const broad = texture(noise, p.add(warp)).r;
    if (!detail) return smoothstep(u.cloudCover.sub(0.08), u.cloudCover.add(0.2), broad);
    const billow = texture(noise, p.mul(2.1).add(warp.mul(2.4))).r;
    const fine = texture(noise, p.mul(5.2).add(warp.mul(4.0))).g;
    const v = broad.mul(0.6).add(billow.mul(0.3)).add(fine.mul(0.12));
    return smoothstep(u.cloudCover, u.cloudCover.add(0.16), v);
}

/** How much of a sun's light a point gets past the high cloud (its cloud's shadow on the land). */
export function cloudPass(u, noise, P, S) {
    const lift = max(u.cloudY.sub(P.y), 0.0).div(max(S.y, 0.06));
    // The cloud's broad masses only (its fleece would dapple the floor into camouflage), softly.
    const d = cloudDensity(u, noise, P.xz.add(S.xz.mul(lift)), { detail: false });
    return float(1.0).sub(d.mul(0.16));
}

/**
 * Each sun's visibility at a world point, past every tower and glider (and the high cloud): vec3 (coral, jade,
 * cobalt). One loop over the casters, the three suns per caster.
 */
export function sunVisibility(u, P, noise = null) {
    const v0 = float(1.0).toVar();
    const v1 = float(1.0).toVar();
    const v2 = float(1.0).toVar();
    Loop({
        start: int(0), end: u.casterCount, type: 'int', condition: '<', name: 'cst',
    }, ({ cst }) => {
        const ra = u.casters.element(cst.mul(2)).toVar();
        const rb = u.casters.element(cst.mul(2).add(1)).toVar();
        v0.assign(min(v0, sbCylinderVis(P, u.sun0, ra, rb.x, u.penumbra.x)));
        v1.assign(min(v1, sbCylinderVis(P, u.sun1, ra, rb.x, u.penumbra.y)));
        v2.assign(min(v2, sbCylinderVis(P, u.sun2, ra, rb.x, u.penumbra.z)));
    });
    Loop({
        start: int(0), end: u.gliderCount, type: 'int', condition: '<', name: 'gld',
    }, ({ gld }) => {
        const g = u.gliders.element(gld).toVar();
        v0.assign(min(v0, sbDiscVis(P, u.sun0, g, u.penumbra.x)));
        v1.assign(min(v1, sbDiscVis(P, u.sun1, g, u.penumbra.y)));
        v2.assign(min(v2, sbDiscVis(P, u.sun2, g, u.penumbra.z)));
    });
    if (noise) {
        v0.mulAssign(cloudPass(u, noise, P, u.sun0));
        v1.mulAssign(cloudPass(u, noise, P, u.sun1));
        v2.mulAssign(cloudPass(u, noise, P, u.sun2));
    }
    return vec3(v0, v1, v2);
}

/**
 * The three suns' light on a surface with normal N: Σ colour · max(N·S, 0) · visibility.
 * `wrap` lets light round a soft, translucent form (alabaster) a little past its terminator.
 */
export function sunLight(u, N, vis, wrap = 0) {
    const k = 1 / (1 + wrap);
    const l0 = max(dot(N, u.sun0).add(wrap).mul(k), 0.0).mul(vis.x);
    const l1 = max(dot(N, u.sun1).add(wrap).mul(k), 0.0).mul(vis.y);
    const l2 = max(dot(N, u.sun2).add(wrap).mul(k), 0.0).mul(vis.z);
    return u.col0.mul(l0).add(u.col1.mul(l1)).add(u.col2.mul(l2));
}

// ── The sky ───────────────────────────────────────────────────────────────────────

/**
 * A Henyey–Greenstein lobe (normalised to 1 at mu = 1 for g → 1 shapes alike), written with a
 * guarded base so it never takes the power of a negative.
 */
function lobe(mu, g) {
    const gg = g * g;
    const k = (1 + gg - 2 * g) ** 1.5 / (1 - gg);
    return float(1 - gg).div(pow(max(float(1 + gg).sub(mu.mul(2 * g)), 1e-4), 1.5)).mul(k);
}

/**
 * One sun's light in the sky along `dir`: a broad lobe that tints the whole dome (no part of the
 * sky is ever without it), the glow along the horizon on its side, a tight corona, and the disc —
 * a white-hot core with a limb of the sun's own colour.
 */
function sunInSky(dir, S, C, G, share, discCos, up, blaze) {
    const mu = clamp(dot(dir, S), -1.0, 1.0).toVar();
    const flatDir = normalize(vec3(dir.x, 0.0, dir.z).add(vec3(1e-5, 0.0, 0.0)));
    const flatSun = normalize(vec3(S.x, 0.0, S.z).add(vec3(1e-5, 0.0, 0.0)));
    const toward = dot(flatDir, flatSun).mul(0.5).add(0.5);
    const t2 = toward.mul(toward);
    const band = exp(up.mul(-5.5));
    const horizonGlow = t2.mul(t2).mul(band).mul(share).mul(0.085);
    const broad = lobe(mu, 0.35).mul(0.012);
    // The corona: a tight bright halo in the sun's own colour, falling off fast (a star seen through
    // clean air), then a broad faint one; the old pair was a wide soft wash round each disc.
    // (The heat of play blazes the tight halo only: a broad wash would whiten the sky round the suns.)
    const corona = lobe(mu, 0.86).mul(0.035)
        .add(lobe(mu, 0.975).mul(0.05).add(lobe(mu, 0.996).mul(SUN_LOOK.halo)).mul(blaze));
    // `across` is (1 − mu) over the disc's (1 − cos r): it runs as the square of the angle, so
    // sqrt(across) is the distance from the centre in disc radii.
    const across = float(1.0).sub(mu).div(max(float(1.0).sub(discCos), 1e-7)).toVar();
    const rad = across.max(0.0).sqrt().toVar();
    const discMask = smoothstep(1.04, 0.96, rad);
    // Limb darkening toward the sun's own colour at the edge (a star's rim is cooler than its heart).
    const limb = smoothstep(0.25, 1.0, rad);
    const Cn = C.div(max(max(C.x, max(C.y, C.z)), 1e-3));
    const discLight = mix(vec3(SUN_LOOK.core), Cn.mul(SUN_LOOK.rim), limb).mul(discMask);
    return G.mul(horizonGlow.add(broad)).add(C.mul(corona)).add(discLight);
}

/** One sun's light on the cloud deck seen along `dir`: forward scattering, dimmed by the cloud toward it. */
function cloudLitBy(u, noise, X, dir, S, C) {
    const mu = clamp(dot(dir, S), -1.0, 1.0);
    const phase = lobe(mu, 0.72).mul(0.13).add(lobe(mu, 0.2).mul(0.05));
    const toward = normalize(S.xz.add(vec2(1e-5, 0.0)));
    const ahead = cloudDensity(u, noise, X.add(toward.mul(1200.0)), { detail: false });
    const through = exp(ahead.mul(-1.4));
    return C.mul(phase.mul(through.mul(0.82).add(0.18)));
}

/**
 * One ribbon of light between two suns (A, B), its colour shading from one to the other: drawn in
 * the plane of the lens about the midpoint, a strand that winds across the chord between them
 * (two strands, half a turn apart, cross like a braid), `wind` the pace of its winding.
 */
function ribbonBetween(u, dir, A, B, CA, CB, wind) {
    const mid = normalize(A.add(B));
    const chord = B.sub(A).add(vec3(1e-5, 2e-5, 0.0));
    const ax = normalize(chord);
    const nrm = normalize(cross(mid, ax).add(vec3(0.0, 1e-6, 0.0)));
    // Coordinates round the midpoint: along the chord (−1 at A, 1 at B) and across it.
    const half = max(length(B.sub(A)).mul(0.5), 1e-4);
    const s = dot(dir.sub(mid), ax).div(half);
    const n = dot(dir, nrm).div(half);
    const inside = smoothstep(1.08, 0.9, abs(s)).mul(step(0.0, dot(dir, mid)));
    // The strands swing wider as the ribbons burn past full (a fever flings the braid out).
    const swing = float(1.0).sub(s.mul(s)).max(0.0).mul(clamp(u.ribbon.sub(1.0), 0.0, 1.0).mul(0.2).add(0.42));
    const w = s.mul(3.1).add(wind);
    const strand = (offset) => {
        const d = abs(n.sub(sin(w.add(offset)).mul(swing)));
        return exp(d.mul(d).mul(-900.0)).mul(0.9).add(exp(d.mul(-38.0)).mul(0.12));
    };
    const glow = strand(0.0).add(strand(3.14159)).mul(inside);
    const tint = mix(CA, CB, s.mul(0.5).add(0.5));
    return tint.mul(glow);
}

/** The braid made visible: ribbons of light between every pair of suns (u.ribbon's strength). */
export function braidRibbons(u, dir) {
    const wind = u.ribbonWind;
    const r = ribbonBetween(u, dir, u.sun0, u.sun1, u.col0, u.col1, wind)
        .add(ribbonBetween(u, dir, u.sun1, u.sun2, u.col1, u.col2, wind.add(2.1)))
        .add(ribbonBetween(u, dir, u.sun2, u.sun0, u.col2, u.col0, wind.add(4.2)));
    return r.mul(u.ribbon.mul(0.22));
}

/** The high cloud's fill from the dome (shares of the zenith's and the horizon's colour). */
export const CLOUD_FILL = Object.freeze({ zenith: 0.55, horizon: 0.2 });

/**
 * The sky's light along a unit direction (the land and the haze read the same function, without
 * the discs and the cloud deck). The dome away from the suns has colours of its own: a deep
 * cobalt-violet overhead over a rose-mauve horizon, so no part of the sky is ever grey.
 */
export function skyColor(u, dir, { discs = true, clouds = null, ribbons = false } = {}) {
    const up = max(dir.y, 0.0).toVar();
    const base = mix(u.horizon, u.zenith, pow(up, 0.38));
    const one = (S, C, G, share, cosR) => sunInSky(dir, S, C, G, share, discs ? cosR : float(2.0), up, u.blaze);
    const sky = base
        .add(one(u.sun0, u.col0, u.glow0, u.glowShare.x, u.discCos.x))
        .add(one(u.sun1, u.col1, u.glow1, u.glowShare.y, u.discCos.y))
        .add(one(u.sun2, u.col2, u.glow2, u.glowShare.z, u.discCos.z))
        .toVar();
    if (ribbons) sky.addAssign(braidRibbons(u, dir));
    if (!clouds) return sky;
    // The deck, where the ray meets its base, faded into the haze toward the horizon.
    const reach = u.cloudY.sub(u.eye.y).div(max(dir.y, 0.012)).toVar();
    const X = u.eye.xz.add(dir.xz.mul(reach)).toVar();
    const d = cloudDensity(u, clouds, X).toVar();
    // (Little grey fill: away from the suns the cloud is the sky's own deep colour in shade, toward
    // them it takes their light; with more fill every cloud was the same lavender-grey.)
    const lit = cloudLitBy(u, clouds, X, dir, u.sun0, u.col0)
        .add(cloudLitBy(u, clouds, X, dir, u.sun1, u.col1))
        .add(cloudLitBy(u, clouds, X, dir, u.sun2, u.col2))
        .add(u.zenith.mul(CLOUD_FILL.zenith))
        .add(u.horizon.mul(CLOUD_FILL.horizon))
        .toVar();
    // Thin edges glow where they stand before a sun (a silver lining); never brighter than 1.5.
    const edge = float(1.0).sub(d).mul(d).mul(4.0);
    const shaded = lit.mul(edge.mul(0.5).add(1.0));
    const peak = max(shaded.x, max(shaded.y, shaded.z));
    const capped = shaded.mul(min(float(1.0), float(1.5).div(max(peak, 1e-4))));
    const fade = exp(reach.div(-55000.0)).mul(smoothstep(0.0, 0.05, dir.y));
    return mix(sky, capped, d.mul(0.9).mul(fade));
}

/**
 * The valley mist between the eye and P: a layer thinning with height, lit by the suns that reach
 * P (`vis`), so the mist over a coloured shadow takes its colour and the shadows stand in the mist
 * as bands; forward scattering brightens it toward each sun.
 */
export function mist(u, colour, P, vis) {
    const V = P.sub(u.eye).toVar();
    const dist = length(V).toVar();
    const dir = V.div(max(dist, 1e-3)).toVar();
    // Optical depth of an exponential layer along the segment (closed form, guarded for a level ray).
    const hp = max(P.y.sub(u.groundY), 0.0);
    const he = max(u.eye.y.sub(u.groundY), 0.0);
    const H = u.mistHeight;
    const dy = he.sub(hp);
    const level = exp(hp.div(H).negate()).mul(dist);
    const flat = dy.abs().lessThan(0.5);
    const thinning = exp(hp.div(H).negate()).sub(exp(he.div(H).negate()));
    const slant = H.mul(thinning).mul(dist).div(select(flat, float(1.0), dy));
    const tau = u.mistDensity.mul(select(flat, level, slant));
    const amount = float(1.0).sub(exp(tau.negate())).toVar();
    const phase = (S) => {
        const mu = clamp(dot(dir, S), 0.0, 1.0);
        const m2 = mu.mul(mu);
        return m2.mul(m2).mul(1.6).add(0.32);
    };
    const lit = u.col0.mul(vis.x.mul(phase(u.sun0)))
        .add(u.col1.mul(vis.y.mul(phase(u.sun1))))
        .add(u.col2.mul(vis.z.mul(phase(u.sun2))))
        .mul(0.32)
        .add(mix(u.horizon, u.zenith, 0.3).mul(0.25));
    return mix(colour, lit.mul(float(1.0).sub(u.airMarch)), amount);
}

/**
 * Where a ray E + D·t (t in 0..T) runs through the shadow a flat-topped cylinder (axis A.x, A.z,
 * radius A.w, top y1) throws away from a sun S: the shadow is a wedge bounded by planes — the strip
 * the cylinder sweeps away from the sun, the far side of it, and the slanted plane through its top
 * edge — so the span is the intersection of four half-lines. Returns (t in, t out); empty when
 * out <= in.
 */
export const sbShadowSpan = /* @__PURE__ */ Fn(([E, D, T, A, y1, S]) => {
    const flat = max(length(S.xz), 1e-4);
    const h = S.xz.div(flat).toVar();
    const n = vec2(h.y.negate(), h.x);
    const tanEl = S.y.div(flat);
    const rel = E.xz.sub(A.xz).toVar();
    const a0 = dot(rel, n);
    const a1 = dot(D.xz, n);
    const b0 = dot(rel, h).toVar();
    const b1 = dot(D.xz, h).toVar();
    const lo = float(0.0).toVar();
    const hi = T.toVar();
    // One half-line p + q·t < 0 at a time.
    const clip = (p, q) => {
        const qq = select(abs(q).lessThan(1e-6), select(q.lessThan(0.0), float(-1e-6), float(1e-6)), q);
        const root = p.negate().div(qq);
        hi.assign(select(qq.greaterThan(0.0), min(hi, root), hi));
        lo.assign(select(qq.lessThan(0.0), max(lo, root), lo));
    };
    clip(a0.sub(A.w), a1);
    clip(a0.negate().sub(A.w), a1.negate());
    clip(b0, b1);
    clip(E.y.sub(tanEl.mul(b0)).sub(y1), D.y.sub(tanEl.mul(b1)));
    return vec2(lo, hi);
}).setLayout({
    name: 'sb_shadowSpan',
    type: 'vec2',
    inputs: [
        { name: 'E', type: 'vec3' }, { name: 'D', type: 'vec3' }, { name: 'T', type: 'float' },
        { name: 'A', type: 'vec4' }, { name: 'y1', type: 'float' }, { name: 'S', type: 'vec3' },
    ],
});

/**
 * The light the valley mist scatters toward the eye along a ray E + D·t (t in 0..T): each sun's
 * share is the mist's whole depth along the ray less the stretches inside that sun's shadow wedges,
 * so every tower's fan stands in the air as three coloured wedges of shade. The mist thins
 * exponentially with height (closed-form integrals; no march).
 */
export function mistLight(u, E, D, T) {
    const H = u.mistHeight;
    const k = D.y.div(H).toVar();
    const base = u.mistDensity.mul(exp(E.y.sub(u.groundY).div(H).negate())).toVar();
    const tiny = abs(k).lessThan(1e-5);
    const depthOf = (a, b) => select(
        tiny,
        base.mul(b.sub(a)),
        base.mul(exp(k.mul(a).negate()).sub(exp(k.mul(b).negate()))).div(select(tiny, float(1.0), k)),
    );
    const total = depthOf(float(0.0), T).toVar();
    const s0 = float(0.0).toVar();
    const s1 = float(0.0).toVar();
    const s2 = float(0.0).toVar();
    Loop({
        start: int(0), end: u.casterCount, type: 'int', condition: '<', name: 'mst',
    }, ({ mst }) => {
        const ra = u.casters.element(mst.mul(2)).toVar();
        const y1 = u.casters.element(mst.mul(2).add(1)).x.toVar();
        const add = (acc, S) => {
            const span = sbShadowSpan(E, D, T, ra, y1, S).toVar();
            acc.addAssign(select(span.y.greaterThan(span.x), depthOf(span.x, span.y), float(0.0)));
        };
        add(s0, u.sun0);
        add(s1, u.sun1);
        add(s2, u.sun2);
    });
    const phase = (S) => {
        const mu = clamp(dot(D, S), 0.0, 1.0);
        const m2 = mu.mul(mu);
        const m4 = m2.mul(m2);
        return m4.mul(m4).mul(1.4).add(m2.mul(0.35)).add(0.18);
    };
    // The light the mist sends toward the eye saturates as 1 − e^(−τ) (what lies behind is dimmed by
    // e^(−τ), so the two add to a veil, never past it); each sun's share of it is the lit share of
    // the depth. Linear in τ, a long ray low over the floor ran to a white wall across the valley.
    const veil = float(1.0).sub(exp(total.negate())).toVar();
    const perDepth = veil.div(max(total, 1e-6)).toVar();
    const lit = u.col0.mul(max(total.sub(s0), 0.0).mul(phase(u.sun0)))
        .add(u.col1.mul(max(total.sub(s1), 0.0).mul(phase(u.sun1))))
        .add(u.col2.mul(max(total.sub(s2), 0.0).mul(phase(u.sun2))))
        .mul(MIST_LIGHT.sun)
        .add(mix(u.horizon, u.zenith, 0.3).mul(total.mul(MIST_LIGHT.sky)));
    return lit.mul(perDepth);
}
/**
 * Aerial perspective: the air between the eye and P, lit by the suns (the sky low along the same
 * bearing is the colour it fades to). Thinner with height.
 */
export function haze(u, colour, P) {
    const V = P.sub(u.eye).toVar();
    const dist = length(V).toVar();
    const dir = V.div(max(dist, 1e-3));
    const mid = P.y.add(u.eye.y).mul(0.5).sub(u.groundY);
    const density = u.hazeDensity.mul(exp(max(mid, 0.0).div(u.hazeHeight).negate()));
    const amount = float(1.0).sub(exp(dist.mul(density).negate()));
    const low = normalize(vec3(dir.x, max(dir.y, 0.0).mul(0.35).add(0.015), dir.z));
    const air = skyColor(u, low, { discs: false });
    return mix(colour, air, amount);
}
